import { describe, expect, it } from "vitest";

import { EXIT_CODES, parseStableSemver } from "@developer-os/core";
import type { OfflineReleaseTrustV1 } from "@developer-os/core";
import { FixedReleaseTransport } from "@developer-os/security";
import type { ReleaseExchangeRequestV1, ReleaseExchangeResponseV1 } from "@developer-os/security";
import type { CliUpdateContext } from "@developer-os/cli/dist/update/context.js";
import { prepareUpdate } from "@developer-os/cli/dist/update/planning.js";
import { createUpdateFixture, SYNTHETIC_ARCHITECTURES } from "@developer-os/cli/dist/update/testing.js";
import type { SyntheticArchitectureV1, UpdateFixture, UpdateFixtureOptions } from "@developer-os/cli/dist/update/testing.js";

/**
 * Spec 2 §12's "signature chain is exact" and "transport is closed" rows, joined: the signed
 * synthetic metadata and bundles reach `prepareUpdate` through the production
 * `FixedReleaseTransport` over a scripted exchange, so origin, redirect, length and hash policy
 * run against the same bytes the signature chain verifies — for both architectures.
 */

const METADATA_BASE = "https://github.com/msolecki/developer-os/releases/latest/download/";
const ASSET_BASE = "https://releases.example/developer-os/";

type Route = (url: string) => { readonly status: number; readonly headers?: readonly string[]; readonly body?: Uint8Array } | null;

interface Wired {
  readonly fixture: UpdateFixture;
  readonly update: CliUpdateContext;
  /** Every URL the exchange was asked for, in order. */
  readonly urls: string[];
}

async function bytesOf(fixture: UpdateFixture, kind: "release_key_delegation" | "release_index"): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await fixture.update.createTransport(null as unknown as OfflineReleaseTrustV1).get({ kind, sink: (chunk) => Promise.resolve(void chunks.push(chunk)) });
  return Buffer.concat(chunks);
}

/** Serves exactly what the fixture signed, at the URLs the launcher handoff and delegation name. */
async function served(fixture: UpdateFixture): Promise<ReadonlyMap<string, Uint8Array>> {
  const routes = new Map<string, Uint8Array>([
    [`${METADATA_BASE}release-key-delegation-v1.json`, await bytesOf(fixture, "release_key_delegation")],
    [`${METADATA_BASE}release-index-v1.json`, await bytesOf(fixture, "release_index")],
  ]);
  for (const release of fixture.releases.values()) {
    for (const [architecture, bundle] of release.bundles) {
      routes.set(`${ASSET_BASE}${release.version}/darwin-${architecture}.tar.zst`, bundle.archive);
      routes.set(`${ASSET_BASE}${release.version}/darwin-${architecture}.manifest.json`, bundle.manifestBytes);
    }
  }
  return routes;
}

async function* chunks(body: Uint8Array): AsyncIterable<Uint8Array> {
  yield await Promise.resolve(body);
}

/** `script` sees the fixture, so a route can serve bytes the fixture signed for another request. */
async function wire(options: UpdateFixtureOptions, script: (fixture: UpdateFixture) => Route = () => () => null): Promise<Wired> {
  const fixture = createUpdateFixture(options);
  const routes = await served(fixture);
  const route = script(fixture);
  const urls: string[] = [];
  const exchange = (request: ReleaseExchangeRequestV1): Promise<ReleaseExchangeResponseV1> => {
    urls.push(request.url);
    const scripted = route(request.url);
    const body = scripted?.body ?? routes.get(request.url);
    if (body === undefined) return Promise.resolve({ status: 404, effectiveUrl: request.url, rawHeaders: ["content-length", "0"], body: chunks(new Uint8Array()) });
    return Promise.resolve({
      status: scripted?.status ?? 200,
      effectiveUrl: request.url,
      rawHeaders: scripted?.headers ?? ["content-length", String(body.byteLength)],
      body: chunks(body),
    });
  };
  const update: CliUpdateContext = {
    ...fixture.update,
    createTransport: (trust) => new FixedReleaseTransport({
      trust,
      exchange,
      now: () => performance.now(),
      setTimer: (callback, milliseconds) => {
        const timer = setTimeout(callback, milliseconds);
        return () => {
          clearTimeout(timer);
        };
      },
    }),
  };
  return { fixture, update, urls };
}

function signedArchive(fixture: UpdateFixture): Uint8Array {
  const archive = fixture.releases.get("1.1.0")?.bundles.get("arm64")?.archive;
  if (archive === undefined) throw new Error("the fixture signs the arm64 bundle");
  return archive;
}

async function exitCodeOf(work: Promise<unknown>): Promise<number> {
  try {
    await work;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "number") return error.code;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("the signed chain over the fixed-origin transport, per architecture", () => {
  it.each(SYNTHETIC_ARCHITECTURES)("previews 1.0.0 -> 1.1.0 on %s from exactly that architecture's signed bundle", async (architecture: SyntheticArchitectureV1) => {
    const { update, urls } = await wire({ architecture });

    const planned = await prepareUpdate(update, { version: null });

    expect(planned.result).toMatchObject({ outcome: "preview", plan: { current: { architecture }, target: { version: "1.1.0", architecture } } });
    expect(planned.apply?.inputs.target.bundleRoot.endsWith(`/releases/1.1.0/darwin-${architecture}`)).toBe(true);
    expect(urls).toEqual([
      `${METADATA_BASE}release-key-delegation-v1.json`,
      `${METADATA_BASE}release-index-v1.json`,
      `${ASSET_BASE}1.1.0/darwin-${architecture}.manifest.json`,
      `${ASSET_BASE}1.1.0/darwin-${architecture}.tar.zst`,
    ]);
  });

  it.each(SYNTHETIC_ARCHITECTURES)("refuses the other architecture's archive served for a %s home, before any scratch extraction", async (architecture) => {
    const other = architecture === "arm64" ? "x64" : "arm64";
    const { fixture, update, urls } = await wire({ architecture }, (signed) => {
      const substitute = signed.releases.get("1.1.0")?.bundles.get(other)?.archive;
      if (substitute === undefined) throw new Error("the fixture signs both bundles");
      return (url) => (url.endsWith(`/1.1.0/darwin-${architecture}.tar.zst`) ? { status: 200, body: substitute } : null);
    });

    expect(await exitCodeOf(prepareUpdate(update, { version: null }))).toBe(EXIT_CODES.securityRefusal);
    expect(urls).toContain(`${ASSET_BASE}1.1.0/darwin-${architecture}.tar.zst`);
    expect(fixture.events).not.toContain("scratch.extract");
  });
});

describe("the signature chain refuses before any asset is requested", () => {
  it("refuses an index signed by a key the delegation never named", async () => {
    const { update, urls, fixture } = await wire({ forgedIndex: true });
    expect(await exitCodeOf(prepareUpdate(update, { version: null }))).toBe(EXIT_CODES.securityRefusal);
    expect(urls.filter((url) => url.startsWith(ASSET_BASE))).toEqual([]);
    expect(fixture.events).not.toContain("scratch.create");
  });

  it("refuses replayed metadata below the trusted high watermarks", async () => {
    const { update, urls } = await wire({ trustSequence: "3" });
    expect(await exitCodeOf(prepareUpdate(update, { version: null }))).toBe(EXIT_CODES.securityRefusal);
    expect(urls.filter((url) => url.startsWith(ASSET_BASE))).toEqual([]);
  });

  it("refuses a bundle manifest whose bytes are not the signed ones", async () => {
    const { update, fixture } = await wire({}, () => (url) => (url.endsWith(".manifest.json") ? { status: 200, body: new TextEncoder().encode("{\"schemaVersion\":1}") } : null));
    expect(await exitCodeOf(prepareUpdate(update, { version: null }))).toBe(EXIT_CODES.securityRefusal);
    expect(fixture.events).not.toContain("scratch.create");
  });

  it("refuses a downgrade as invalid input", async () => {
    const { update } = await wire({ active: "1.1.0" });
    expect(await exitCodeOf(prepareUpdate(update, { version: parseStableSemver("1.0.0") }))).toBe(EXIT_CODES.invalidInput);
  });
});

describe("the transport is closed (Spec 2 §4.5)", () => {
  it("follows one redirect into the delegated asset origin", async () => {
    const target = `${ASSET_BASE}mirror/1.1.0/darwin-arm64.tar.zst`;
    const { update, urls } = await wire({}, (signed) => {
      const archive = signedArchive(signed);
      return (url) => {
        if (url.endsWith("/1.1.0/darwin-arm64.tar.zst") && url !== target) return { status: 302, headers: ["location", target, "content-length", "0"], body: new Uint8Array() };
        return url === target ? { status: 200, body: archive } : null;
      };
    });

    const planned = await prepareUpdate(update, { version: null });

    expect(planned.result.outcome).toBe("preview");
    expect(urls).toContain(target);
  });

  it.each([
    { name: "a redirect outside every permitted origin", location: "https://elsewhere.example/developer-os/1.1.0/darwin-arm64.tar.zst" },
    { name: "a plain-HTTP redirect", location: "http://releases.example/developer-os/1.1.0/darwin-arm64.tar.zst" },
    { name: "a redirect carrying a query", location: `${ASSET_BASE}1.1.0/darwin-arm64.tar.zst?token=x` },
    { name: "a second redirect", location: `${ASSET_BASE}again/1.1.0/darwin-arm64.tar.zst` },
  ])("refuses $name as a security refusal", async ({ location }) => {
    const { update } = await wire({}, () => (url) => (url.endsWith("darwin-arm64.tar.zst") ? { status: 302, headers: ["location", location, "content-length", "0"], body: new Uint8Array() } : null));
    expect(await exitCodeOf(prepareUpdate(update, { version: null }))).toBe(EXIT_CODES.securityRefusal);
  });

  it.each([
    { name: "a content length other than the signed size", headers: (bytes: number) => ["content-length", String(bytes + 1)] },
    { name: "no content length", headers: () => [] },
    { name: "a content encoding", headers: (bytes: number) => ["content-length", String(bytes), "content-encoding", "gzip"] },
    { name: "a repeated content length", headers: (bytes: number) => ["content-length", String(bytes), "content-length", String(bytes)] },
  ])("refuses an archive response with $name", async ({ headers }) => {
    const { update } = await wire({}, (signed) => {
      const archive = signedArchive(signed);
      return (url) => (url.endsWith("darwin-arm64.tar.zst") ? { status: 200, headers: headers(archive.byteLength), body: archive } : null);
    });
    expect(await exitCodeOf(prepareUpdate(update, { version: null }))).toBe(EXIT_CODES.securityRefusal);
  });

  it("reports a server error as an operational failure, not a refusal", async () => {
    const { update } = await wire({}, () => (url) => (url.endsWith("release-index-v1.json") ? { status: 500, body: new Uint8Array() } : null));
    expect(await exitCodeOf(prepareUpdate(update, { version: null }))).toBe(EXIT_CODES.operationalFailure);
  });
});
