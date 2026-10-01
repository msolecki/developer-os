import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  createNodeLifecycleGuardedFileSystem,
  encodeCanonicalJson,
  EXIT_CODES,
  inspectDrift,
  loadConfig,
  decodeCanonicalJson,
  parseLifecycleIdAllocator,
  parseLifecycleInstallNonce,
  SCHEDULED_JOB_IDS,
  validateActiveReleaseRecord,
  validateReleaseTrustState,
} from "@developer-os/core";
import type {
  CanonicalJsonValue,
  DriftRequestV2,
  InstallationManifestV2,
  LifecycleGuardedFileSystemV1,
  RuntimePaths,
} from "@developer-os/core";

import { createCanonicalPathEvidence } from "../bootstrap/admission.js";
import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { assertOrdinaryCommandAdmitted } from "../bootstrap/report.js";
import type { BootstrapEvidenceInspectionRequestV1 } from "../bootstrap/report.js";
import { runDoctorReport } from "../commands/doctor.js";
import { runInit } from "../commands/init.js";
import { runStatus } from "../commands/status.js";
import { manifestAdmissionFor } from "./manifest-admission.js";
import {
  createCommandFixture,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
  retainedTombstones,
} from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import { failureFrom } from "../context.js";
import {
  admitInstalledV2Home,
  LIFECYCLE_RESERVATION_ROWS,
  observeLifecycleActivationRecord,
} from "./admission.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const MAX_RELEASE_RECORD_BYTES = 16 * 1024;

afterAll(removeCommandFixtures);

function effectiveUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("uid inspection unavailable in test");
  return uid;
}

function portFor(): LifecycleGuardedFileSystemV1 {
  return createNodeLifecycleGuardedFileSystem({
    renameNoReplace: () => Promise.reject(new Error("structural admission never renames")),
    effectiveUid: effectiveUid(),
  });
}

function throwingPort(error: Error): LifecycleGuardedFileSystemV1 {
  const refuse = (): never => {
    throw error;
  };
  return {
    lstat: refuse,
    readRegular: refuse,
    hashRegular: refuse,
    names: refuse,
    writeExclusive: refuse,
    mkdirExclusive: refuse,
    renameOver: refuse,
    renameNoReplace: refuse,
    unlinkExact: refuse,
    rmdirExactEmpty: refuse,
    syncDirectory: refuse,
  };
}

let initializedV2: Promise<CommandFixture> | null = null;

function sharedInitializedV2Fixture(): Promise<CommandFixture> {
  initializedV2 ??= (async () => {
    const fixture = await createCommandFixture("lifecycle-admission", { bootstrapAvailable: true });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const result = await runInit(fixture.context, ACCEPTED);
    if (!result.ok) {
      throw new Error(`fixture init failed: ${JSON.stringify({ result, trace: fixture.bootstrapTrace.slice(-30) })}`);
    }
    return fixture;
  })();
  return initializedV2;
}

function inputFor(fixture: CommandFixture): {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly paths: RuntimePaths;
  readonly manifestAdmission: ReturnType<typeof manifestAdmissionFor>;
  readonly effectiveUid: number;
} {
  return {
    fs: portFor(),
    paths: fixture.paths,
    manifestAdmission: manifestAdmissionFor(fixture.paths, []),
    effectiveUid: effectiveUid(),
  };
}

/** The gate `main.ts` runs for every command but `init`, built exactly as the commands build it. */
function ordinaryCommandRequestFor(fixture: CommandFixture): BootstrapEvidenceInspectionRequestV1 {
  return createBootstrapEvidenceInspectionRequest({
    productHome: fixture.paths.home,
    stateDirectory: fixture.paths.stateDir,
    initialRoots: [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
  });
}

function admit(fixture: CommandFixture): Promise<unknown> {
  return admitInstalledV2Home(inputFor(fixture));
}

async function driftRequestFor(
  fixture: CommandFixture,
  manifest: InstallationManifestV2,
): Promise<DriftRequestV2> {
  const nonce = parseLifecycleInstallNonce(
    await nodeFs.readFile(join(fixture.paths.stateDir, "lifecycle-install-nonce")),
  );
  const uid = effectiveUid();
  return {
    manifest,
    fs: fixture.context.fs,
    guards: fixture.context.guards.manifest,
    schemas: {
      validate: (schemaId, bytes) => {
        if (schemaId === "developer-os-config-v1") {
          loadConfig(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        } else if (schemaId === "lifecycle-id-allocator-v1") {
          parseLifecycleIdAllocator(bytes, nonce);
        } else if (schemaId === "active-release-record-v1") {
          validateActiveReleaseRecord(
            decodeCanonicalJson(bytes, MAX_RELEASE_RECORD_BYTES),
            createCanonicalPathEvidence(),
          );
        } else {
          validateReleaseTrustState(decodeCanonicalJson(bytes, MAX_RELEASE_RECORD_BYTES));
        }
      },
    },
    ephemerals: {
      validate: (owner, observed) => {
        if (owner !== "core" || observed.uid !== uid || observed.mode !== 0o600 || observed.nlink !== 1) {
          throw new Error("runtime reservation changed shape");
        }
      },
    },
  };
}

/**
 * `apply` runs inside the guarded region, so a half-applied change still
 * reverts: every case here shares one initialised home, and an unreverted
 * `rename` would poison every later case in the file rather than fail its own.
 */
async function restoring(apply: () => Promise<void>, revert: () => Promise<void>, body: () => Promise<void>): Promise<void> {
  try {
    await apply();
    await body();
  } finally {
    await revert();
  }
}

async function present(path: string): Promise<boolean> {
  return await nodeFs.lstat(path).then(() => true, () => false);
}

function withDirectoryAt(fixture: CommandFixture, relative: string, body: () => Promise<void>): Promise<void> {
  const path = join(fixture.paths.home, relative);
  return restoring(
    async () => {
      await nodeFs.rename(path, `${path}.hidden`);
      await nodeFs.mkdir(path, { mode: 0o700 });
    },
    async () => {
      if (!(await present(`${path}.hidden`))) return;
      await nodeFs.rm(path, { recursive: true, force: true });
      await nodeFs.rename(`${path}.hidden`, path);
    },
    body,
  );
}

function withAbsent(fixture: CommandFixture, relative: string, body: () => Promise<void>): Promise<void> {
  const path = join(fixture.paths.home, relative);
  return restoring(
    () => nodeFs.rename(path, `${path}.hidden`),
    async () => {
      if (await present(`${path}.hidden`)) await nodeFs.rename(`${path}.hidden`, path);
    },
    body,
  );
}

function withBytesAt(path: string, replacement: Uint8Array | string, body: () => Promise<void>): Promise<void> {
  let original: Buffer | undefined;
  return restoring(
    async () => {
      original = await nodeFs.readFile(path);
      await nodeFs.writeFile(path, replacement);
    },
    async () => {
      if (original !== undefined) await nodeFs.writeFile(path, original);
    },
    body,
  );
}

async function bundleFile(fixture: CommandFixture): Promise<string> {
  const releaseRoot = join(fixture.paths.home, "releases", "1.0.0");
  const [platform] = await nodeFs.readdir(releaseRoot);
  if (platform === undefined) throw new Error("fixture installed no release bundle");
  return join(releaseRoot, platform, "bin", "developer-os");
}

async function withDriftedBundleFile(fixture: CommandFixture, body: () => Promise<void>): Promise<void> {
  const path = await bundleFile(fixture);
  const bytes = await nodeFs.readFile(path);
  await withBytesAt(path, Buffer.from(bytes.toString("utf8").replace("exit 0", "exit 1")), body);
}

async function withEveryRetainedTombstoneAltered(
  fixture: CommandFixture,
  body: () => Promise<void>,
): Promise<void> {
  const tombstones = await retainedTombstones(fixture.root);
  expect(tombstones.length).toBeGreaterThan(0);
  const altered: { readonly path: string; readonly bytes: Buffer }[] = [];
  for (const path of tombstones) {
    if (!(await nodeFs.lstat(path)).isFile()) continue;
    altered.push({ path, bytes: await nodeFs.readFile(path) });
  }
  expect(altered.length).toBeGreaterThan(0);
  return restoring(
    async () => {
      for (const { path } of altered) await nodeFs.writeFile(path, "altered retained evidence\n", { mode: 0o600 });
    },
    async () => {
      for (const { path, bytes } of altered) await nodeFs.writeFile(path, bytes);
    },
    body,
  );
}

function withPlantedLifecyclePlan(fixture: CommandFixture, body: () => Promise<void>): Promise<void> {
  const path = join(fixture.paths.stateDir, "lifecycle-journals", "synthetic-orphan.json");
  return restoring(
    () => nodeFs.writeFile(path, "{}\n", { mode: 0o600 }),
    () => nodeFs.rm(path, { force: true }),
    body,
  );
}

async function manifestValue(fixture: CommandFixture): Promise<Record<string, CanonicalJsonValue>> {
  const bytes = await nodeFs.readFile(fixture.paths.manifestFile);
  return JSON.parse(bytes.toString("utf8")) as Record<string, CanonicalJsonValue>;
}

function artifactRows(manifest: Record<string, CanonicalJsonValue>): Record<string, CanonicalJsonValue>[] {
  return manifest.artifacts as unknown as Record<string, CanonicalJsonValue>[];
}

describe("structural V2 home admission", () => {
  it("admits a fresh V2 home and binds to no bootstrap plan, drift or retained evidence", async () => {
    const fixture = await sharedInitializedV2Fixture();

    await expect(admit(fixture)).resolves.toMatchObject({ manifest: { schemaVersion: 2 } });

    await withDriftedBundleFile(fixture, async () => {
      await withEveryRetainedTombstoneAltered(fixture, async () => {
        await expect(admit(fixture)).resolves.toMatchObject({ manifest: { schemaVersion: 2 } });
      });
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("keeps the Spec 2 §6.4 handoff set as a fact of a fresh init", async () => {
    const fixture = await sharedInitializedV2Fixture();
    const admitted = await admit(fixture) as {
      readonly manifest: InstallationManifestV2;
      readonly allocator: { readonly nextCounter: string };
    };

    expect(await inspectDrift(await driftRequestFor(fixture, admitted.manifest))).toStrictEqual([]);
    expect(admitted.allocator.nextCounter).toBe("0");
    expect(await observeLifecycleActivationRecord(portFor(), fixture.paths)).toStrictEqual({ state: "absent" });
    for (const name of ["update-rollback.json", "update-executor.json"]) {
      expect((await nodeFs.lstat(join(fixture.paths.stateDir, name))).size).toBe(0);
    }
    expect(await nodeFs.readdir(join(fixture.paths.home, "rollback"))).toStrictEqual([]);
    for (const root of ["lifecycle-journals", "git-effect-journals", "launchd-effect-journals"]) {
      expect(await nodeFs.readdir(join(fixture.paths.stateDir, root))).toStrictEqual([]);
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each([
    ["state/lifecycle-install-nonce", "nonce_invalid"],
    ["state/lifecycle-id-allocator.json", "allocator_invalid"],
    ["state/.lifecycle.lock", "global_lock_invalid"],
    ["installation-manifest.json", "manifest_invalid"],
  ] as const)("refuses a directory at %s as %s instead of treating it as absent (NEW-82)", async (relative, reason) => {
    const fixture = await sharedInitializedV2Fixture();

    await withDirectoryAt(fixture, relative, async () => {
      await expect(admit(fixture)).rejects.toMatchObject({ reason, code: EXIT_CODES.recoveryRequired });
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("lets a programming error escape instead of relabelling it (NEW-82)", async () => {
    const fixture = await sharedInitializedV2Fixture();

    await expect(
      admitInstalledV2Home({ ...inputFor(fixture), fs: throwingPort(new TypeError("synthetic")) }),
    ).rejects.toBeInstanceOf(TypeError);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * The port reads the record and a parser consumes it, so a defect in the port
   * surfaces inside the parse rather than at an `fs` call. Without the rethrow
   * in `parsing` this publishes `nonce_invalid`, exit 6, on an intact home.
   */
  it("lets a programming error inside a record parse escape instead of refusing (NEW-82)", async () => {
    const fixture = await sharedInitializedV2Fixture();
    const real = portFor();
    const noncePath = join(fixture.paths.stateDir, "lifecycle-install-nonce");
    const defective: LifecycleGuardedFileSystemV1 = {
      ...real,
      readRegular: (entry, maximumBytes) =>
        entry.path === noncePath
          ? Promise.resolve(null as unknown as Uint8Array)
          : real.readRegular(entry, maximumBytes),
    };

    await expect(admitInstalledV2Home({ ...inputFor(fixture), fs: defective }))
      .rejects.toBeInstanceOf(TypeError);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a V1 manifest with manifest_v1_not_migratable and publishes that kind", async () => {
    const fixture = await createCommandFixture("lifecycle-admission-v1");
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);

    const refusal: unknown = await admit(fixture).then(() => null, (error: unknown) => error);

    expect(refusal).toMatchObject({
      reason: "manifest_v1_not_migratable",
      code: EXIT_CODES.capabilityUnavailable,
    });
    const published = failureFrom(fixture.context, refusal);
    expect(published.ok).toBe(false);
    if (published.ok) return;
    expect(published.code).toBe(EXIT_CODES.capabilityUnavailable);
    expect(published.error.kind).toBe("manifest_v1_not_migratable");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an absent manifest with manifest_absent before any member", async () => {
    const fixture = await sharedInitializedV2Fixture();

    await withAbsent(fixture, "installation-manifest.json", async () => {
      await expect(admit(fixture)).rejects.toMatchObject({
        reason: "manifest_absent",
        code: EXIT_CODES.invalidInput,
      });
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each([
    ["state/lifecycle-install-nonce", "nonce_invalid"],
    ["state/lifecycle-id-allocator.json", "allocator_invalid"],
    ["state/.lifecycle.lock", "global_lock_invalid"],
    ["state/lifecycle-journals", "journal_root_invalid"],
    ["state/git-effect-journals", "journal_root_invalid"],
    ["state/launchd-effect-journals", "journal_root_invalid"],
  ] as const)("refuses a missing %s with its own reason %s", async (relative, reason) => {
    const fixture = await sharedInitializedV2Fixture();

    await withAbsent(fixture, relative, async () => {
      await expect(admit(fixture)).rejects.toMatchObject({ reason, code: EXIT_CODES.recoveryRequired });
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an allocator bound to another nonce and admits one past counter zero", async () => {
    const fixture = await sharedInitializedV2Fixture();
    const allocatorFile = join(fixture.paths.stateDir, "lifecycle-id-allocator.json");
    const nonce = (await nodeFs.readFile(join(fixture.paths.stateDir, "lifecycle-install-nonce"), "utf8")).trim();
    const allocatorWith = (installNonce: string, nextCounter: string): string =>
      encodeCanonicalJson({ schemaVersion: 1, installNonce, nextCounter });

    await withBytesAt(allocatorFile, allocatorWith("0".repeat(64), "0"), async () => {
      await expect(admit(fixture)).rejects.toMatchObject({
        reason: "nonce_allocator_mismatch",
        code: EXIT_CODES.recoveryRequired,
      });
    });
    await withBytesAt(allocatorFile, "{not canonical}\n", async () => {
      await expect(admit(fixture)).rejects.toMatchObject({
        reason: "allocator_invalid",
        code: EXIT_CODES.recoveryRequired,
      });
    });
    await withBytesAt(allocatorFile, allocatorWith(nonce, "7"), async () => {
      await expect(admit(fixture)).resolves.toMatchObject({ allocator: { nextCounter: "7" } });
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an over-long nonce and an over-long allocator by their own reasons", async () => {
    const fixture = await sharedInitializedV2Fixture();
    const noncePath = join(fixture.paths.stateDir, "lifecycle-install-nonce");
    const allocatorPath = join(fixture.paths.stateDir, "lifecycle-id-allocator.json");

    await withBytesAt(noncePath, `${"0".repeat(64)}\n\n`, async () => {
      await expect(admit(fixture)).rejects.toMatchObject({
        reason: "nonce_invalid",
        code: EXIT_CODES.recoveryRequired,
      });
    });
    await withBytesAt(
      allocatorPath,
      encodeCanonicalJson({ schemaVersion: 1, installNonce: "0".repeat(64), nextCounter: "0".padStart(1_024, "9") }),
      async () => {
        await expect(admit(fixture)).rejects.toMatchObject({
          reason: "allocator_invalid",
          code: EXIT_CODES.recoveryRequired,
        });
      },
    );
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an incomplete reservation set by completeness rather than by hash (NEW-82)", async () => {
    const fixture = await sharedInitializedV2Fixture();
    const manifest = await manifestValue(fixture);
    const reservation = join(fixture.paths.stateDir, "git-sync.json");
    const allocator = join(fixture.paths.stateDir, "lifecycle-id-allocator.json");
    const rows = artifactRows(manifest);
    expect(rows.some((row) => row.path === reservation)).toBe(true);
    const allocatorRow = rows.find((row) => row.path === allocator);
    if (allocatorRow === undefined) throw new Error("fixture manifest reserves no allocator row");

    await withBytesAt(
      fixture.paths.manifestFile,
      encodeCanonicalJson({
        ...manifest,
        artifacts: rows.filter((row) => row.path !== reservation) as unknown as CanonicalJsonValue,
      }),
      async () => {
        await expect(admit(fixture)).rejects.toMatchObject({
          reason: "reservations_incomplete",
          code: EXIT_CODES.recoveryRequired,
        });
      },
    );
    await withBytesAt(
      fixture.paths.manifestFile,
      encodeCanonicalJson({
        ...manifest,
        artifacts: rows.map((row) =>
          row.path === allocator
            ? {
                ...row,
                verification: {
                  mode: "content",
                  installedHash: (allocatorRow.verification as unknown as { readonly installedHash: string })
                    .installedHash,
                },
              }
            : row
        ) as unknown as CanonicalJsonValue,
      }),
      async () => {
        await expect(admit(fixture)).rejects.toMatchObject({
          reason: "reservations_incomplete",
          code: EXIT_CODES.recoveryRequired,
        });
      },
    );
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an installation made before brain-garden, brain-pulse and the pulse slots existed", async () => {
    const fixture = await sharedInitializedV2Fixture();
    const manifest = await manifestValue(fixture);
    const rows = artifactRows(manifest);
    const newRow = (path: unknown): boolean => typeof path === "string" && (
      /automation-brain-(garden|pulse)\./u.test(path) || /[/]pulse\.[0-7]\.md$/u.test(path));
    const pulse7 = join(fixture.paths.stateDir, "pulse.7.md");
    expect(rows.some((row) => row.path === pulse7)).toBe(true);
    expect(rows.filter((row) => newRow(row.path))).toHaveLength(32);

    for (const keep of [(path: unknown) => !newRow(path), (path: unknown) => path !== pulse7]) {
      await withBytesAt(
        fixture.paths.manifestFile,
        encodeCanonicalJson({
          ...manifest,
          artifacts: rows.filter((row) => keep(row.path)) as unknown as CanonicalJsonValue,
        }),
        async () => {
          await expect(admit(fixture)).rejects.toMatchObject({
            reason: "reservations_incomplete",
            code: EXIT_CODES.recoveryRequired,
          });
          await expect(admit(fixture)).rejects.toThrow(/; reinstall: developer-os init$/u);
        },
      );
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reports an unreadable activation record as recovery-required rather than absent (NEW-82)", async () => {
    const fixture = await sharedInitializedV2Fixture();
    const activation = join(fixture.paths.stateDir, "lifecycle-activation.json");

    await restoring(
      () => nodeFs.mkdir(activation, { mode: 0o700 }),
      () => nodeFs.rm(activation, { recursive: true, force: true }),
      async () => {
        await expect(observeLifecycleActivationRecord(portFor(), fixture.paths)).rejects.toMatchObject({
          reason: "activation_record_invalid",
          code: EXIT_CODES.recoveryRequired,
        });
      },
    );
    await restoring(
      () => nodeFs.writeFile(activation, "{ \"schemaVersion\": 1 }\n", { mode: 0o600 }),
      () => nodeFs.rm(activation, { force: true }),
      async () => {
        await expect(observeLifecycleActivationRecord(portFor(), fixture.paths)).rejects.toMatchObject({
          reason: "activation_record_invalid",
          code: EXIT_CODES.recoveryRequired,
        });
      },
    );
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("admits a home carrying a missing schema file, altered retained evidence and a planted lifecycle plan", async () => {
    const fixture = await sharedInitializedV2Fixture();

    await withAbsent(fixture, join("schemas", "ingest.stage.schema.json"), async () => {
      await expect(admit(fixture)).resolves.toMatchObject({ manifest: { schemaVersion: 2 } });
    });
    await withPlantedLifecyclePlan(fixture, async () => {
      await expect(admit(fixture)).resolves.toMatchObject({ manifest: { schemaVersion: 2 } });
    });
    const tombstones = await retainedTombstones(fixture.root);
    expect(tombstones.length).toBeGreaterThan(0);
    const [tombstone] = tombstones;
    if (tombstone === undefined) throw new Error("fixture retained no tombstone");
    await restoring(
      () => nodeFs.rename(tombstone, `${tombstone}.hidden`),
      async () => {
        if (await present(`${tombstone}.hidden`)) await nodeFs.rename(`${tombstone}.hidden`, tombstone);
      },
      async () => {
        await expect(admit(fixture)).resolves.toMatchObject({ manifest: { schemaVersion: 2 } });
      },
    );
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reserves exactly the closed lifecycle set Spec 1 §2.1 enumerates", () => {
    expect(LIFECYCLE_RESERVATION_ROWS.length).toBeGreaterThan(0);
    expect(LIFECYCLE_RESERVATION_ROWS).toHaveLength(84);
    expect(LIFECYCLE_RESERVATION_ROWS.filter((row) => row.mode === "ephemeral")).toHaveLength(82);
    expect(LIFECYCLE_RESERVATION_ROWS.filter((row) => row.mode === "content").map((row) => row.path))
      .toStrictEqual(["state/lifecycle-install-nonce"]);
    expect(LIFECYCLE_RESERVATION_ROWS.filter((row) => row.mode === "schema").map((row) => row.path))
      .toStrictEqual(["state/lifecycle-id-allocator.json"]);
    expect(new Set(LIFECYCLE_RESERVATION_ROWS.map((row) => row.path)).size).toBe(84);
    expect(SCHEDULED_JOB_IDS.length).toBeGreaterThan(0);
    for (const job of SCHEDULED_JOB_IDS) {
      expect(
        LIFECYCLE_RESERVATION_ROWS.filter((row) => row.path.includes(`automation-${job}.`)),
        job,
      ).toHaveLength(12);
    }
  });

  it("reserves eight ephemeral pulse report slots beside the six jobs", () => {
    const pulse = LIFECYCLE_RESERVATION_ROWS.filter((row) => row.path.startsWith("state/pulse."));
    expect(pulse.map((row) => row.path)).toStrictEqual(
      Array.from({ length: 8 }, (_unused, n) => `state/pulse.${String(n)}.md`),
    );
    expect(pulse.every((row) => row.mode === "ephemeral")).toBe(true);
    expect(SCHEDULED_JOB_IDS).toContain("brain-garden");
    expect(SCHEDULED_JOB_IDS).toContain("brain-pulse");
  });

  it("admits status and doctor on a drifted V2 home whose closure is recovery-required (A7)", async () => {
    const fixture = await sharedInitializedV2Fixture();

    await withDriftedBundleFile(fixture, async () => {
      await withPlantedLifecyclePlan(fixture, async () => {
        await expect(assertOrdinaryCommandAdmitted(ordinaryCommandRequestFor(fixture))).resolves.toBeUndefined();
        await expect(admit(fixture)).resolves.toMatchObject({ manifest: { schemaVersion: 2 } });
        const status = await runStatus(fixture.context);
        expect(status.ok).toBe(true);
        const report = await runDoctorReport(fixture.context);
        expect(report.schemaVersion).toBe(1);
        expect(report.checks.length).toBeGreaterThan(0);
      });
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
