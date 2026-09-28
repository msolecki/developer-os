import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { constants as zlibConstants, zstdCompressSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  admitTargetUpdateDraft,
  decodeCanonicalJson,
  EXIT_CODES,
  parseCanonicalAbsolutePathText,
  parsePositiveUInt32,
  parseUInt64Decimal,
} from "@developer-os/core";
import type {
  LifecycleCoordinatorIdV1,
  LifecycleGuardedEntryV1,
  LowerHexSha256,
  OwnerUpdatePlanV1,
  ReleaseBundleEntryV1,
  ReleaseBundleManifestV1,
  ReleaseBundleReferenceV1,
  UpdateFallbackHandoffV1,
} from "@developer-os/core";
import { ZstdUstarAdmission } from "@developer-os/security";
import { composeUpdate } from "@developer-os/cli/dist/update/compose.js";
import type { ComposeDepsV1, ObservedPathV1 } from "@developer-os/cli/dist/update/compose.js";
import { prepareUpdate, UpdatePlanningRefusal } from "@developer-os/cli/dist/update/planning.js";
import {
  CODEX_PLUGIN_FILE,
  CODEX_PLUGIN_ROOT,
  CODEX_REGISTRATION_PATH,
  codexRegistrationBytes,
  createUpdateFixture,
  DIRECTORY_PATH,
  FILE_A_PATH,
  FILE_B_PATH,
  NEW_PLUGIN,
  OLD_A,
  OLD_B,
  OLD_PLUGIN,
  SYNTHETIC_ARCHITECTURES,
  SYNTHETIC_CODEX_HOMES,
  SYNTHETIC_EVIDENCE,
  SYNTHETIC_HOME,
} from "@developer-os/cli/dist/update/testing.js";
import type { SyntheticArchitectureV1, SyntheticBundleV1, UpdateFixture } from "@developer-os/cli/dist/update/testing.js";

/**
 * Spec 2 §12's "archive is bounded" and "target planner is plan-only" rows at the seam between
 * them, for both architectures: a real zstd-ustar archive of each synthetic bundle through the
 * production admission, and the planner's request/result binding through `prepareUpdate`. The
 * byte-level archive corpus is `packages/security/src/update/archive.test.ts`'s; this file adds
 * what only the release shape can show. The Codex rows are D72 P6(c)-(e) over the same planner.
 */

const encoder = new TextEncoder();
const BLOCK = 512;

function sha256(bytes: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function ustarHeader(entry: ReleaseBundleEntryV1, size: number): Uint8Array {
  const header = new Uint8Array(BLOCK);
  const put = (offset: number, text: string): void => {
    header.set(encoder.encode(text), offset);
  };
  const boundary = entry.path.lastIndexOf("/");
  put(0, boundary < 0 ? entry.path : entry.path.slice(boundary + 1));
  put(100, octal(entry.mode, 8));
  put(108, octal(0, 8));
  put(116, octal(0, 8));
  put(124, octal(size, 12));
  put(136, octal(0o14_000_000_000, 12));
  put(156, entry.kind === "directory" ? "5" : "0");
  put(257, "ustar\0");
  put(263, "00");
  put(345, boundary < 0 ? "" : entry.path.slice(0, boundary));
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) sum += index >= 148 && index < 156 ? 0x20 : (header[index] as number);
  put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

/** The bundle's exact zstd-ustar archive: manifest order, padded content, two end blocks, one checksummed frame. */
function archiveOf(bundle: SyntheticBundleV1): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of bundle.manifest.entries) {
    const content = entry.kind === "file" ? (bundle.files.get(entry.path) ?? new Uint8Array()) : new Uint8Array();
    parts.push(ustarHeader(entry, content.byteLength), content, new Uint8Array((BLOCK - (content.byteLength % BLOCK)) % BLOCK));
  }
  parts.push(new Uint8Array(2 * BLOCK));
  return zstdCompressSync(Buffer.concat(parts), { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1, [zlibConstants.ZSTD_c_contentSizeFlag]: 1 } });
}

function referenceFor(fixture: UpdateFixture, architecture: SyntheticArchitectureV1, archive: Uint8Array): ReleaseBundleReferenceV1 {
  const signed = fixture.releases.get("1.1.0")?.entry.bundles[architecture === "arm64" ? 0 : 1];
  if (signed === undefined) throw new Error("the fixture signs both bundles");
  return { ...signed, archiveBytes: parseUInt64Decimal(String(archive.byteLength)), archiveSha256: sha256(archive) };
}

function bundleOf(fixture: UpdateFixture, architecture: SyntheticArchitectureV1): SyntheticBundleV1 {
  const bundle = fixture.releases.get("1.1.0")?.bundles.get(architecture);
  if (bundle === undefined) throw new Error("the fixture carries both bundles");
  return bundle;
}

async function admit(archive: Uint8Array, manifest: ReleaseBundleManifestV1, bundle: ReleaseBundleReferenceV1): Promise<ReadonlyMap<number, Uint8Array>> {
  const contents = new Map<number, Uint8Array[]>();
  let current = -1;
  await new ZstdUstarAdmission().extract({
    bundle,
    manifest,
    source: Readable.from([archive]) as AsyncIterable<Uint8Array>,
    sink: {
      begin: (ordinal) => {
        current = ordinal;
        contents.set(ordinal, []);
        return Promise.resolve();
      },
      write: (chunk) => {
        contents.get(current)?.push(Uint8Array.from(chunk));
        return Promise.resolve();
      },
      end: () => Promise.resolve(),
    },
  });
  return new Map([...contents].map(([ordinal, chunks]) => [ordinal, Buffer.concat(chunks)]));
}

async function refusal(work: Promise<unknown>): Promise<{ readonly code: number; readonly reason: string | null }> {
  try {
    await work;
  } catch (error) {
    if (error instanceof UpdatePlanningRefusal) return { code: error.code, reason: error.reason };
    if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "number") return { code: error.code, reason: null };
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("each architecture's signed bundle archive (Spec 2 §4.4, §12 'archive is bounded')", () => {
  it.each(SYNTHETIC_ARCHITECTURES)("admits the %s archive entry for entry against its own signed manifest", async (architecture) => {
    const fixture = createUpdateFixture({ architecture });
    const bundle = bundleOf(fixture, architecture);
    const archive = archiveOf(bundle);

    const admitted = await admit(archive, bundle.manifest, referenceFor(fixture, architecture, archive));

    expect(bundle.manifest.architecture).toBe(architecture);
    expect([...admitted.keys()]).toEqual(bundle.manifest.entries.map((_, ordinal) => ordinal));
    bundle.manifest.entries.forEach((entry, ordinal) => {
      if (entry.kind === "file") expect(admitted.get(ordinal)).toEqual(Buffer.from(bundle.files.get(entry.path) ?? new Uint8Array()));
    });
  });

  it.each(SYNTHETIC_ARCHITECTURES)("refuses the other architecture's archive against the %s manifest", async (architecture) => {
    const fixture = createUpdateFixture({ architecture });
    const other = architecture === "arm64" ? "x64" : "arm64";
    const archive = archiveOf(bundleOf(fixture, other));
    await expect(admit(archive, bundleOf(fixture, architecture).manifest, referenceFor(fixture, architecture, archive))).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
  });

  it.each(SYNTHETIC_ARCHITECTURES)("refuses a %s manifest admitted under the other architecture's signed reference", async (architecture) => {
    const fixture = createUpdateFixture({ architecture });
    const other = architecture === "arm64" ? "x64" : "arm64";
    const archive = archiveOf(bundleOf(fixture, architecture));
    await expect(admit(archive, bundleOf(fixture, architecture).manifest, referenceFor(fixture, other, archive))).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
  });
});

describe("the planner's request and result are bound before allocation (Spec 2 §8.2)", () => {
  it.each(SYNTHETIC_ARCHITECTURES)("admits the %s draft only for the release identities of its own request", async (architecture) => {
    const fixture = createUpdateFixture({ architecture });
    const planned = await prepareUpdate(fixture.update, { version: null });
    const materialized = planned.apply?.materialized;
    if (materialized === undefined) throw new Error("the fixture previews an update");
    const { request } = materialized.snapshot;
    const { draft } = materialized.run;

    expect(request.architecture).toBe(architecture);
    expect(admitTargetUpdateDraft(draft, request).draft).toEqual(draft);
    const other = architecture === "arm64" ? "x64" : "arm64";
    expect(() => admitTargetUpdateDraft({ ...draft, targetRelease: { ...draft.targetRelease, architecture: other } }, request)).toThrow();
    expect(() => admitTargetUpdateDraft({ ...draft, currentRelease: draft.targetRelease }, request)).toThrow();
  });

  it("refuses a transcript whose result hash is not the draft the planner returned", async () => {
    const fixture = createUpdateFixture();
    const lying = {
      ...fixture.update,
      planner: {
        run: async (run: Parameters<typeof fixture.update.planner.run>[0]) => {
          const honest = await fixture.update.planner.run(run);
          return { ...honest, transcript: { ...honest.transcript, resultHash: sha256("another draft") } };
        },
      },
    };

    expect(await refusal(prepareUpdate(lying, { version: null }))).toEqual({ code: EXIT_CODES.securityRefusal, reason: "update_planner_output_invalid" });
    expect(fixture.events).toContain("scratch.cleanup");
  });

  it("refuses a transcript whose request hash is not the request the current process sent", async () => {
    const fixture = createUpdateFixture();
    const lying = {
      ...fixture.update,
      planner: {
        run: async (run: Parameters<typeof fixture.update.planner.run>[0]) => {
          const honest = await fixture.update.planner.run(run);
          return { ...honest, transcript: { ...honest.transcript, requestHash: sha256("another request") } };
        },
      },
    };

    expect(await refusal(prepareUpdate(lying, { version: null }))).toEqual({ code: EXIT_CODES.securityRefusal, reason: "update_planner_output_invalid" });
  });
});

const UID = 501;
const COORDINATOR = `lc_${"d".repeat(64)}_10` as LifecycleCoordinatorIdV1;
const STAGING_ROOT = `${SYNTHETIC_HOME}/staging/lifecycle/${COORDINATOR}`;
const FALLBACK: UpdateFallbackHandoffV1 = { bundleManifestHash: sha256("fallback manifest"), launcherProtocol: parsePositiveUInt32(1), updateProtocol: parsePositiveUInt32(1) };

let inode = 900;

function observed(path: string, kind: LifecycleGuardedEntryV1["kind"], content: Uint8Array | null): ObservedPathV1 {
  inode += 1;
  return {
    entry: { path: parseCanonicalAbsolutePathText(path), kind, ownerUid: UID, mode: kind === "directory" ? 0o700 : 0o600, nlink: 1, size: parseUInt64Decimal(String(content?.byteLength ?? 0)), dev: parseUInt64Decimal("7"), ino: parseUInt64Decimal(String(inode)) },
    sha256: content === null ? null : sha256(content),
  };
}

describe("a Codex tree change (D72 P6, NEW-61)", () => {
  it.each(["unregistered", "stale"] as const)("refuses an update while Codex is %s, as owner drift before any capacity read", async (registration) => {
    const fixture = createUpdateFixture({ codex: { registration } });

    expect(await refusal(prepareUpdate(fixture.update, { version: null }))).toEqual({ code: EXIT_CODES.decisionRequired, reason: `update_codex_registration_${registration}` });
    expect(fixture.events).toContain("planner");
    expect(fixture.events).not.toContain("capacity");
    expect(fixture.events).toContain("scratch.cleanup");
  });

  it("previews exactly one registration refresh for the Codex owner", async () => {
    const fixture = createUpdateFixture({ codex: { registration: "registered" } });
    const planned = await prepareUpdate(fixture.update, { version: null });
    expect(planned.result.outcome).toBe("preview");
    if (planned.result.outcome !== "preview") return;
    const owners = planned.result.plan.owners;
    expect(owners.map((owner) => [owner.owner, owner.counts.externalEffects])).toEqual([["core", 0], ["codex", 1]]);
    expect(owners.find((owner) => owner.owner === "codex")?.paths.replace).toContain(CODEX_PLUGIN_FILE);
    await planned.apply?.scratch.cleanup();
  });

  it("composes one refresh leaf and rewrites the registration record to the postimage tree, so it reads registered after", async () => {
    const fixture = createUpdateFixture({ codex: { registration: "registered" } });
    const prepared = (await prepareUpdate(fixture.update, { version: null })).apply;
    if (prepared === null) throw new Error("the fixture previews an update");
    const canonical = (value: unknown): Uint8Array => encoder.encode(`${JSON.stringify(value)}\n`);
    const world = new Map<string, ObservedPathV1>([
      [STAGING_ROOT, observed(STAGING_ROOT, "directory", null)],
      [`${SYNTHETIC_HOME}/installation-manifest.json`, observed(`${SYNTHETIC_HOME}/installation-manifest.json`, "regular_file", canonical(prepared.home.manifest))],
      [DIRECTORY_PATH, observed(DIRECTORY_PATH, "directory", null)],
      [FILE_A_PATH, observed(FILE_A_PATH, "regular_file", OLD_A)],
      [FILE_B_PATH, observed(FILE_B_PATH, "regular_file", OLD_B)],
      [CODEX_PLUGIN_ROOT, observed(CODEX_PLUGIN_ROOT, "directory", null)],
      [CODEX_PLUGIN_FILE, observed(CODEX_PLUGIN_FILE, "regular_file", OLD_PLUGIN)],
      [CODEX_REGISTRATION_PATH, observed(CODEX_REGISTRATION_PATH, "regular_file", codexRegistrationBytes(OLD_PLUGIN))],
      [`${SYNTHETIC_HOME}/state/release-trust.json`, observed(`${SYNTHETIC_HOME}/state/release-trust.json`, "regular_file", canonical(prepared.home.trust))],
      [`${SYNTHETIC_HOME}/state/active-release.json`, observed(`${SYNTHETIC_HOME}/state/active-release.json`, "regular_file", canonical(prepared.home.active))],
    ]);
    const deps: ComposeDepsV1 = {
      productHome: SYNTHETIC_HOME,
      effectiveUid: UID,
      evidence: SYNTHETIC_EVIDENCE,
      fallback: FALLBACK,
      brainRoot: parseCanonicalAbsolutePathText("/synthetic/user/brain"),
      observe: (path) => Promise.resolve(world.get(path) ?? null),
      admitManifest: (value) => value as never,
      codexHomes: SYNTHETIC_CODEX_HOMES,
    };

    const composed = await composeUpdate({ coordinatorId: COORDINATOR, home: prepared.home, inputs: prepared.inputs, materialized: prepared.materialized }, deps);

    const plans = (kind: string): readonly unknown[] => composed.construction.files.flatMap((file) => {
      if (file.role.kind !== "immutable_plan" || file.role.planKind !== kind) return [];
      const bytes = composed.sources.rowBytes.get(file.ordinal);
      return bytes === undefined ? [] : [decodeCanonicalJson(bytes, bytes.byteLength)];
    });
    expect(plans("owner_external_effect")).toHaveLength(1);
    const codex = (plans("owner_update") as readonly OwnerUpdatePlanV1[]).find((plan) => plan.owner === "codex");
    expect(codex?.externalEffects).toHaveLength(1);
    const record = codex?.operations.find((operation) => operation.targetPath === CODEX_REGISTRATION_PATH);
    expect(record?.operation).toBe("replace");
    expect(record?.content?.sha256).toBe(sha256(codexRegistrationBytes(NEW_PLUGIN)));
    expect(codex?.operations.find((operation) => operation.targetPath === CODEX_PLUGIN_FILE)?.content?.sha256).toBe(sha256(NEW_PLUGIN));
  });
});
