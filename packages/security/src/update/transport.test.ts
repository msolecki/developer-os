import { createHash, generateKeyPairSync } from "node:crypto";

import {
  parseLowerHexSha256,
  parseOfficialReleaseRelativePath,
  parseUInt64Decimal,
  validateOfficialReleaseOrigin,
  validateReleaseKeyDelegation,
} from "@developer-os/core";
import type {
  Base64UrlNoPaddingV1,
  LowerHexSha256,
  OfflineReleaseTrustV1,
  ReleaseBundleReferenceV1,
  ReleaseKeyDelegationV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  FixedReleaseTransport,
  type ReleaseExchangeRequestV1,
  type ReleaseExchangeResponseV1,
  type ReleaseTransportRequestV1,
} from "./transport.js";

const LATEST = "https://github.com/msolecki/developer-os/releases/latest/download/";
const RELEASES = "https://github.com/msolecki/developer-os/releases/download/";
const ASSETS = "https://objects.example-assets.com/developer-os/";
const METADATA_BLOBS = "https://metadata.example-assets.com/developer-os/";
const CLOSED_HEADERS = {
  accept: "application/octet-stream",
  "accept-encoding": "identity",
  "user-agent": "developer-os-update/1",
};

const encoder = new TextEncoder();

function sha256(bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function syntheticKey(): { readonly publicKey: Base64UrlNoPaddingV1; readonly keyId: LowerHexSha256 } {
  const { publicKey } = generateKeyPairSync("ed25519");
  const x = (publicKey.export({ format: "jwk" }) as { readonly x: string }).x as Base64UrlNoPaddingV1;
  return { publicKey: x, keyId: sha256(Buffer.from(x, "base64url")) };
}

function origin(host: string, pathPrefix: string) {
  return validateOfficialReleaseOrigin({ scheme: "https", host, port: 443, pathPrefix });
}

const LATEST_ORIGIN = origin("github.com", "/msolecki/developer-os/releases/latest/download/");
const RELEASES_ORIGIN = origin("github.com", "/msolecki/developer-os/releases/download/");
const ASSET_ORIGIN = origin("objects.example-assets.com", "/developer-os/");
const METADATA_BLOB_ORIGIN = origin("metadata.example-assets.com", "/developer-os/");

function validTrust(): OfflineReleaseTrustV1 {
  const root = syntheticKey();
  return {
    schemaVersion: 1,
    handoffProtocol: 1,
    onlineRootKeyId: root.keyId,
    acceptedRoots: [{ role: "online_current", algorithm: "ed25519", ...root }],
    delegationLocator: {
      origin: "https://github.com",
      repositoryPath: "/msolecki/developer-os/releases/latest/download/",
      assetName: "release-key-delegation-v1.json",
    },
    indexLocator: {
      origin: "https://github.com",
      repositoryPath: "/msolecki/developer-os/releases/latest/download/",
      assetName: "release-index-v1.json",
    },
    metadataRedirectOrigins: [LATEST_ORIGIN, METADATA_BLOB_ORIGIN, RELEASES_ORIGIN, ASSET_ORIGIN],
  };
}

function validDelegation(assetOrigins = [ASSET_ORIGIN]): ReleaseKeyDelegationV1 {
  const key = syntheticKey();
  return validateReleaseKeyDelegation({
    sequence: "1",
    releaseKey: { algorithm: "ed25519", ...key },
    metadataOrigins: [RELEASES_ORIGIN],
    assetOrigins,
  });
}

const ARCHIVE_BODY = encoder.encode("synthetic zstd-ustar archive bytes");
const MANIFEST_BODY = encoder.encode('{"schemaVersion":1}\n');

function bundle(overrides: Partial<Record<keyof ReleaseBundleReferenceV1, string>> = {}): ReleaseBundleReferenceV1 {
  return {
    platform: "darwin",
    architecture: "arm64",
    archiveFormat: "zstd-ustar-v1",
    archivePath: parseOfficialReleaseRelativePath(overrides.archivePath ?? "v1.2.3/developer-os-darwin-arm64.tar.zst"),
    archiveBytes: parseUInt64Decimal(overrides.archiveBytes ?? String(ARCHIVE_BODY.byteLength)),
    archiveSha256: parseLowerHexSha256(overrides.archiveSha256 ?? sha256(ARCHIVE_BODY)),
    manifestPath: parseOfficialReleaseRelativePath(overrides.manifestPath ?? "v1.2.3/bundle-manifest-darwin-arm64.json"),
    manifestBytes: parseUInt64Decimal(overrides.manifestBytes ?? String(MANIFEST_BODY.byteLength)),
    manifestSha256: parseLowerHexSha256(overrides.manifestSha256 ?? sha256(MANIFEST_BODY)),
  };
}

interface Route {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly rawHeaders?: readonly string[];
  readonly chunks?: readonly Uint8Array[];
  readonly effectiveUrl?: string;
  readonly contentLength?: string | null;
  readonly hang?: "exchange" | "body";
  readonly fail?: boolean;
}

/**
 * The local server: an in-memory exchange keyed by exact URL that records every
 * request it is handed. A URL with no route is a refused connection, so a
 * request the transport should never have made fails loudly.
 */
function createServer(routes: Readonly<Record<string, Route>>) {
  const server = {
    requests: [] as ReleaseExchangeRequestV1[],
    headers: {} as Record<string, string>,
    aborted: 0,
    exchange: (request: ReleaseExchangeRequestV1): Promise<ReleaseExchangeResponseV1> => {
      server.requests.push(request);
      server.headers = { ...request.headers };
      request.signal.addEventListener("abort", () => {
        server.aborted += 1;
      });
      const route = routes[request.url];
      if (route === undefined || route.fail === true) {
        return Promise.reject(new Error(`connect ECONNREFUSED ${request.url}`));
      }
      if (route.hang === "exchange") return new Promise(() => undefined);
      const chunks = route.chunks ?? [];
      const status = route.status ?? 200;
      const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
      const headers: Record<string, string> = { ...(route.headers ?? {}) };
      const contentLength = route.contentLength === undefined ? String(length) : route.contentLength;
      if (status === 200 && contentLength !== null) headers["Content-Length"] = contentLength;
      const hang = route.hang;
      return Promise.resolve({
        status,
        effectiveUrl: route.effectiveUrl ?? request.url,
        rawHeaders: route.rawHeaders ?? Object.entries(headers).flat(),
        body: (async function* () {
          for (const chunk of chunks) {
            request.progress();
            yield chunk;
          }
          if (hang === "body") await new Promise(() => undefined);
        })(),
      });
    },
  };
  return server;
}

function manualClock(start = 0) {
  let time = start;
  const timers = new Set<{ readonly at: number; readonly callback: () => void }>();
  return {
    now: () => time,
    setTimer: (callback: () => void, milliseconds: number) => {
      const timer = { at: time + milliseconds, callback };
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },
    advance(milliseconds: number) {
      time += milliseconds;
      for (const timer of [...timers]) {
        if (timer.at <= time) {
          timers.delete(timer);
          timer.callback();
        }
      }
    },
  };
}

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

function collecting(): { readonly chunks: Uint8Array[]; readonly sink: (chunk: Uint8Array) => Promise<void> } {
  const chunks: Uint8Array[] = [];
  return {
    chunks,
    sink: (chunk) => {
      chunks.push(chunk);
      return Promise.resolve();
    },
  };
}

function build(routes: Readonly<Record<string, Route>>, clock = manualClock()) {
  const server = createServer(routes);
  const transport = new FixedReleaseTransport({ trust: validTrust(), exchange: server.exchange, now: clock.now, setTimer: clock.setTimer });
  return { server, transport, clock };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

const ARCHIVE_URL = `${RELEASES}v1.2.3/developer-os-darwin-arm64.tar.zst`;
const MANIFEST_URL = `${RELEASES}v1.2.3/bundle-manifest-darwin-arm64.json`;
const INDEX_URL = `${LATEST}release-index-v1.json`;
const DELEGATION_URL = `${LATEST}release-key-delegation-v1.json`;

describe("FixedReleaseTransport", () => {
  const delegation = validDelegation();
  const validRedirectRequest: ReleaseTransportRequestV1 = { kind: "archive", delegation, bundle: bundle(), sink: collecting().sink };
  const twoRedirectRequest: ReleaseTransportRequestV1 = { kind: "bundle_manifest", delegation, bundle: bundle(), sink: collecting().sink };
  const expectedHash = sha256(ARCHIVE_BODY);

  it("fetches the fixed metadata locators with the closed header set and hashes the streamed body", async () => {
    const body = encoder.encode('{"index":true}\n');
    const { server, transport } = build({ [INDEX_URL]: { chunks: [body.subarray(0, 4), body.subarray(4)] } });
    const sink = collecting();

    const response = await transport.get({ kind: "release_index", sink: sink.sink });

    expect(response).toStrictEqual({ kind: "release_index", bodyBytes: String(body.byteLength), bodyHash: sha256(body), redirected: false });
    expect(Buffer.concat(sink.chunks)).toStrictEqual(Buffer.from(body));
    expect(server.requests.map((request) => request.url)).toStrictEqual([INDEX_URL]);
    expect(server.headers).toStrictEqual(CLOSED_HEADERS);
    expect(server.requests[0]?.maximumHeaderBytes).toBe(65_536);
  });

  it("follows one metadata redirect to an exact handoff redirect origin", async () => {
    const body = encoder.encode("{}\n");
    const target = `${METADATA_BLOBS}delegation-blob`;
    const { server, transport } = build({
      [DELEGATION_URL]: { status: 302, headers: { Location: target } },
      [target]: { chunks: [body] },
    });

    expect(await transport.get({ kind: "release_key_delegation", sink: collecting().sink })).toMatchObject({ bodyHash: sha256(body), redirected: true });
    expect(server.requests.map((request) => request.url)).toStrictEqual([DELEGATION_URL, target]);
  });

  it("follows one delegated redirect and no second redirect", async () => {
    const { transport } = build({
      [ARCHIVE_URL]: { status: 302, headers: { Location: `${ASSETS}archive-blob` } },
      [`${ASSETS}archive-blob`]: { chunks: [ARCHIVE_BODY] },
      [MANIFEST_URL]: { status: 301, headers: { Location: `${ASSETS}manifest-blob` } },
      [`${ASSETS}manifest-blob`]: { status: 307, headers: { Location: `${ASSETS}manifest-blob-2` } },
      [`${ASSETS}manifest-blob-2`]: { chunks: [MANIFEST_BODY] },
    });

    expect((await transport.get(validRedirectRequest)).bodyHash).toBe(expectedHash);
    await expect(transport.get(twoRedirectRequest)).rejects.toMatchObject({ code: 5 });
  });

  it("accepts every permitted redirect status and nothing else as a redirect", async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const { transport } = build({
        [ARCHIVE_URL]: { status, headers: { Location: `${ASSETS}archive-blob` } },
        [`${ASSETS}archive-blob`]: { chunks: [ARCHIVE_BODY] },
      });
      expect((await transport.get(validRedirectRequest)).redirected).toBe(true);
    }
    const { server, transport } = build({ [ARCHIVE_URL]: { status: 300, headers: { Location: `${ASSETS}archive-blob` } } });
    await expect(transport.get(validRedirectRequest)).rejects.toMatchObject({ code: 1, reason: "http_status" });
    expect(server.requests).toHaveLength(1);
  });

  describe("with ambient proxy and credential variables", () => {
    const names = ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NETRC", "GITHUB_TOKEN"] as const;
    const before = new Map(names.map((name) => [name, process.env[name]]));
    afterEach(() => {
      for (const [name, value] of before) {
        if (value === undefined) Reflect.deleteProperty(process.env, name);
        else process.env[name] = value;
      }
    });

    /**
     * The plan sketched `get(request, env)`; the transport takes no environment
     * at all, so the ambient one is seeded where it would actually leak from.
     */
    it("inherits no proxy or credential environment", async () => {
      process.env["HTTPS_PROXY"] = "http://127.0.0.1:1";
      process.env["HTTP_PROXY"] = "http://127.0.0.1:1";
      process.env["ALL_PROXY"] = "http://127.0.0.1:1";
      process.env["NETRC"] = "secret";
      process.env["GITHUB_TOKEN"] = "ghp_synthetic000000000000000000000000000";
      const { server, transport } = build({ [INDEX_URL]: { chunks: [encoder.encode("{}\n")] } });

      await transport.get({ kind: "release_index", sink: collecting().sink });

      expect(server.headers).not.toHaveProperty("authorization");
      expect(server.headers).not.toHaveProperty("proxy-authorization");
      expect(server.headers).not.toHaveProperty("cookie");
      expect(server.headers).toStrictEqual(CLOSED_HEADERS);
      expect(Object.keys(server.requests[0] ?? {}).sort()).toStrictEqual(["headers", "maximumHeaderBytes", "progress", "signal", "url"]);
      expect(JSON.stringify(server.requests[0])).not.toContain("127.0.0.1");
      expect(JSON.stringify(server.requests[0])).not.toContain("secret");
    });
  });

  it.each([
    ["plain HTTP", "http://objects.example-assets.com/developer-os/archive-blob"],
    ["userinfo", "https://user:pass@objects.example-assets.com/developer-os/archive-blob"],
    ["a query", `${ASSETS}archive-blob?token=abc`],
    ["an empty query", `${ASSETS}archive-blob?`],
    ["a fragment", `${ASSETS}archive-blob#part`],
    ["an explicit default port", "https://objects.example-assets.com:443/developer-os/archive-blob"],
    ["another port", "https://objects.example-assets.com:8443/developer-os/archive-blob"],
    ["an undelegated host", "https://evil.example.com/developer-os/archive-blob"],
    ["an uppercase host alias", "https://OBJECTS.example-assets.com/developer-os/archive-blob"],
    ["a path outside the prefix", "https://objects.example-assets.com/other/archive-blob"],
    ["a dot-segment traversal", "https://objects.example-assets.com/developer-os/../other/archive-blob"],
    ["an encoded traversal", "https://objects.example-assets.com/developer-os/%2e%2e/archive-blob"],
    ["a relative reference", "/developer-os/archive-blob"],
    ["the bare prefix", ASSETS],
    ["a handoff-only origin not in the delegation", `${METADATA_BLOBS}archive-blob`],
  ])("refuses a redirect to %s before a second request", async (_label, location) => {
    const { server, transport } = build({ [ARCHIVE_URL]: { status: 302, headers: { Location: location } } });

    const error = await rejection(transport.get(validRedirectRequest));

    expect(error).toMatchObject({ code: 5 });
    expect(server.requests).toHaveLength(1);
    expect(error.message).not.toContain(location);
    expect(error.message).not.toContain("example");
  });

  it("refuses a metadata redirect to a delegated asset origin the handoff does not carry", async () => {
    const trust = validTrust();
    const server = createServer({ [INDEX_URL]: { status: 302, headers: { Location: `${ASSETS}index-blob` } } });
    const clock = manualClock();
    const transport = new FixedReleaseTransport({
      trust: { ...trust, metadataRedirectOrigins: [LATEST_ORIGIN] },
      exchange: server.exchange,
      now: clock.now,
      setTimer: clock.setTimer,
    });

    await expect(transport.get({ kind: "release_index", sink: collecting().sink })).rejects.toMatchObject({ code: 5 });
    expect(server.requests).toHaveLength(1);
  });

  it("refuses a redirect without a target and a repeated Location header", async () => {
    const missing = build({ [ARCHIVE_URL]: { status: 302 } });
    await expect(missing.transport.get(validRedirectRequest)).rejects.toMatchObject({ code: 5 });
    const repeated = build({
      [ARCHIVE_URL]: { status: 302, rawHeaders: ["Location", `${ASSETS}archive-blob`, "location", `${ASSETS}other-blob`] },
    });
    await expect(repeated.transport.get(validRedirectRequest)).rejects.toMatchObject({ code: 5 });
    expect(repeated.server.requests).toHaveLength(1);
  });

  it("refuses a delegation whose origins are not a subset of the handoff set before any request", async () => {
    const outside = validDelegation([origin("cdn.example.org", "/developer-os/")]);
    const { server, transport } = build({});

    await expect(transport.get({ kind: "archive", delegation: outside, bundle: bundle(), sink: collecting().sink })).rejects.toMatchObject({ code: 5 });
    expect(server.requests).toStrictEqual([]);
  });

  it("refuses an effective URL that differs from the requested URL", async () => {
    const { transport } = build({ [INDEX_URL]: { chunks: [encoder.encode("{}\n")], effectiveUrl: `${LATEST}other.json` } });

    await expect(transport.get({ kind: "release_index", sink: collecting().sink })).rejects.toMatchObject({ code: 5 });
  });

  it("caps response headers at 64 KiB", async () => {
    const atCap = build({ [INDEX_URL]: { chunks: [encoder.encode("{}\n")], headers: { "x-pad": "a".repeat(65_536 - 5 - 4 - 14 - 1 - 4) } } });
    await expect(atCap.transport.get({ kind: "release_index", sink: collecting().sink })).resolves.toMatchObject({ bodyBytes: "3" });
    const over = build({ [INDEX_URL]: { chunks: [encoder.encode("{}\n")], headers: { "x-pad": "a".repeat(65_536) } } });
    await expect(over.transport.get({ kind: "release_index", sink: collecting().sink })).rejects.toMatchObject({ code: 5 });
  });

  it("enforces the declared and observed body bounds", async () => {
    const sink = collecting().sink;
    const cases: readonly (readonly [Route, ReleaseTransportRequestV1])[] = [
      [{ chunks: [encoder.encode("{}\n")], contentLength: null }, { kind: "release_index", sink }],
      [{ chunks: [encoder.encode("{}\n")], contentLength: "03" }, { kind: "release_index", sink }],
      [{ chunks: [encoder.encode("{}\n")], contentLength: "65537" }, { kind: "release_key_delegation", sink }],
      [{ chunks: [new Uint8Array(65_537)] }, { kind: "release_key_delegation", sink }],
      [{ chunks: [encoder.encode("{}\n")], contentLength: "2" }, { kind: "release_index", sink }],
      [{ chunks: [encoder.encode("{}\n")], contentLength: "4" }, { kind: "release_index", sink }],
      [{ chunks: [encoder.encode("{}\n")], headers: { "Content-Encoding": "gzip" } }, { kind: "release_index", sink }],
    ];
    for (const [route, request] of cases) {
      const url = request.kind === "release_index" ? INDEX_URL : DELEGATION_URL;
      const { transport } = build({ [url]: route });
      await expect(transport.get(request)).rejects.toMatchObject({ code: 5 });
    }
    const atBound = build({ [DELEGATION_URL]: { chunks: [new Uint8Array(65_536)] } });
    await expect(atBound.transport.get({ kind: "release_key_delegation", sink })).resolves.toMatchObject({ bodyBytes: "65536" });
  });

  it("requires the exact signed asset size and hash", async () => {
    const wrongSize = build({ [ARCHIVE_URL]: { chunks: [ARCHIVE_BODY, encoder.encode("x")] } });
    await expect(wrongSize.transport.get(validRedirectRequest)).rejects.toMatchObject({ code: 5 });

    const tampered = new Uint8Array(ARCHIVE_BODY);
    tampered[0] = (tampered[0] as number) ^ 1;
    const wrongHash = build({ [ARCHIVE_URL]: { chunks: [tampered] } });
    await expect(wrongHash.transport.get(validRedirectRequest)).rejects.toMatchObject({ code: 5 });

    const direct = build({ [MANIFEST_URL]: { chunks: [MANIFEST_BODY] } });
    await expect(direct.transport.get(twoRedirectRequest)).resolves.toMatchObject({ bodyHash: sha256(MANIFEST_BODY), redirected: false });
  });

  it("classifies status and network faults without content", async () => {
    const missing = build({ [INDEX_URL]: { status: 404 } });
    await expect(missing.transport.get({ kind: "release_index", sink: collecting().sink })).rejects.toMatchObject({ code: 1, reason: "http_status" });

    const refused = build({ [INDEX_URL]: { fail: true } });
    const error = await rejection(refused.transport.get({ kind: "release_index", sink: collecting().sink }));
    expect(error).toMatchObject({ code: 1, reason: "network" });
    expect(error.message).not.toContain("github.com");
    expect(error.message).not.toContain("ECONNREFUSED");
  });

  it("times out a stalled DNS/connect/TLS/header phase at the 30-second idle bound and aborts the exchange", async () => {
    const { server, transport, clock } = build({ [INDEX_URL]: { hang: "exchange" } });
    const pending = rejection(transport.get({ kind: "release_index", sink: collecting().sink }));
    await settle();

    clock.advance(29_999);
    await settle();
    expect(server.aborted).toBe(0);

    server.requests[0]?.progress();
    clock.advance(29_999);
    await settle();
    expect(server.aborted).toBe(0);

    clock.advance(1);
    expect(await pending).toMatchObject({ code: 1, reason: "timeout" });
    expect(server.aborted).toBe(1);
  });

  it("times out an idle body and aborts the exchange", async () => {
    const { server, transport, clock } = build({ [INDEX_URL]: { chunks: [encoder.encode("{")], contentLength: "3", hang: "body" } });
    const pending = rejection(transport.get({ kind: "release_index", sink: collecting().sink }));
    await settle();

    clock.advance(30_000);
    expect(await pending).toMatchObject({ code: 1, reason: "timeout" });
    expect(server.aborted).toBe(1);
  });

  it("shares one 15-minute wall deadline across requests that no request can reset", async () => {
    const clock = manualClock(1_000);
    const { server, transport } = build({ [INDEX_URL]: { hang: "exchange" }, [DELEGATION_URL]: { chunks: [encoder.encode("{}\n")] } }, clock);
    expect(transport.remainingMilliseconds()).toBe(900_000);

    await transport.get({ kind: "release_key_delegation", sink: collecting().sink });
    clock.advance(899_000);
    expect(transport.remainingMilliseconds()).toBe(1_000);

    const pending = rejection(transport.get({ kind: "release_index", sink: collecting().sink }));
    await settle();
    server.requests[1]?.progress();
    clock.advance(1_000);
    expect(await pending).toMatchObject({ code: 1, reason: "timeout" });

    const after = await rejection(transport.get({ kind: "release_key_delegation", sink: collecting().sink }));
    expect(after).toMatchObject({ code: 1, reason: "timeout" });
    expect(server.requests).toHaveLength(2);
    expect(transport.remainingMilliseconds()).toBe(0);
  });
});
