import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EXIT_CODES,
  SCHEDULED_JOB_IDS,
  lifecycleBookkeepingPaths,
  parseCanonicalAbsolutePathText,
} from "@developer-os/core";

import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import type { BootstrapEvidenceAdmissionV1 } from "../bootstrap/report.js";
import { loadOrCreateRedactionKey } from "../context.js";
import { runInit } from "../commands/init.js";
import {
  createCommandFixture,
  exists,
  inventoryDigest,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
} from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import { runUninstall } from "../commands/uninstall.js";
import { runAbsentManifestUninstall } from "./absent-manifest-uninstall.js";
import type { CliLifecycleContext } from "./context.js";
import { observeSecretOpaqueKey, unlinkSecretOpaqueKey } from "./redaction-key.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const KEY_BYTES = new Uint8Array(32).fill(7);
const ARCHIVE = "archive the product home";
const LEAF = ".lifecycle-bootstrap.lock";

afterEach(removeCommandFixtures);

function lifecycleOf(fixture: CommandFixture): CliLifecycleContext {
  const lifecycle = fixture.context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture context has no lifecycle capability");
  return lifecycle;
}

function evidenceOf(fixture: CommandFixture): Promise<BootstrapEvidenceAdmissionV1> {
  return inspectBootstrapEvidenceAdmission(
    createBootstrapEvidenceInspectionRequest({
      productHome: fixture.paths.home,
      stateDirectory: fixture.paths.stateDir,
      initialRoots: [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
    }),
  );
}

async function plantStateHome(fixture: CommandFixture): Promise<void> {
  await nodeFs.mkdir(fixture.paths.stateDir, { recursive: true, mode: 0o700 });
  await nodeFs.chmod(fixture.paths.home, 0o700);
  await nodeFs.chmod(fixture.paths.stateDir, 0o700);
}

async function plantKey(fixture: CommandFixture): Promise<string> {
  const keyPath = join(fixture.paths.stateDir, "redaction.key");
  await nodeFs.writeFile(keyPath, KEY_BYTES, { mode: 0o600 });
  await nodeFs.chmod(keyPath, 0o600);
  return keyPath;
}

async function plantLeaf(fixture: CommandFixture): Promise<string> {
  const leafPath = join(fixture.paths.stateDir, LEAF);
  await nodeFs.writeFile(leafPath, new Uint8Array(), { mode: 0o600 });
  await nodeFs.chmod(leafPath, 0o600);
  return leafPath;
}

async function runArm(
  fixture: CommandFixture,
  overrides: {
    readonly options?: { readonly dryRun: boolean; readonly assumeYes: boolean };
    readonly lifecycle?: CliLifecycleContext;
    readonly evidence?: BootstrapEvidenceAdmissionV1;
  } = {},
): ReturnType<typeof runAbsentManifestUninstall> {
  return runAbsentManifestUninstall({
    context: fixture.context,
    lifecycle: overrides.lifecycle ?? lifecycleOf(fixture),
    options: overrides.options ?? ACCEPTED,
    evidence: overrides.evidence ?? (await evidenceOf(fixture)),
  });
}

describe("runAbsentManifestUninstall", () => {
  it("refuses a second V1 uninstall over V1 Foundation residue with D20's guidance and changes nothing (D27)", async () => {
    const fixture = await createCommandFixture("absent-manifest-v1-residue");
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    expect((await runUninstall(fixture.context, ACCEPTED)).ok).toBe(true);
    loadOrCreateRedactionKey(fixture.paths.stateDir);
    const before = await inventoryDigest(fixture.root);

    const again = await runUninstall(fixture.rebuildContext(), ACCEPTED);

    expect(again).toMatchObject({ ok: false, code: EXIT_CODES.recoveryRequired });
    expect(again.ok ? "" : again.error.recovery).toContain(ARCHIVE);
    expect(await inventoryDigest(fixture.root)).toStrictEqual(before);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("walks an empty state twice, creates nothing and reports key_absent", async () => {
    const fixture = await createCommandFixture("absent-manifest-empty");
    await plantStateHome(fixture);
    const before = await inventoryDigest(fixture.root);

    const outcome = await runArm(fixture);

    expect(outcome).toMatchObject({ arm: "key_absent", removed: [], transactionId: null });
    expect(await inventoryDigest(fixture.root)).toStrictEqual(before);
    expect(await exists(join(fixture.paths.stateDir, LEAF))).toBe(false);
    expect(fixture.stableLockEvents).toStrictEqual([]);
    expect(fixture.vendorProcesses).toStrictEqual([]);
  });

  it("deletes the orphaned key under the bootstrap leaf and keeps the whole bookkeeping set", async () => {
    const fixture = await createCommandFixture("absent-manifest-key-present");
    await plantStateHome(fixture);
    const bookkeeping = [...lifecycleBookkeepingPaths(fixture.paths.home)].sort();
    expect(bookkeeping.length).toBeGreaterThan(0);
    for (const path of bookkeeping) {
      if (path.endsWith("/.lifecycle.lock") || path.endsWith("/manifest-anchor.json")) {
        await nodeFs.writeFile(path, new Uint8Array(), { mode: 0o600 });
        await nodeFs.chmod(path, 0o600);
        continue;
      }
      await nodeFs.mkdir(path, { recursive: true, mode: 0o700 });
      await nodeFs.chmod(path, 0o700);
    }
    const keyPath = await plantKey(fixture);

    const result = await runUninstall(fixture.context, ACCEPTED);

    expect(result).toMatchObject({
      ok: true,
      data: { removed: [keyPath], restored: [], transactionId: null },
    });
    expect(await exists(keyPath)).toBe(false);
    expect(await exists(join(fixture.paths.stateDir, LEAF))).toBe(true);
    for (const path of bookkeeping) expect(await exists(path), path).toBe(true);
    expect(fixture.stableLockEvents).toStrictEqual([]);
    expect(fixture.vendorProcesses).toStrictEqual([]);
  });

  it("inspects and reports on a dry run without creating the leaf or deleting the key", async () => {
    const fixture = await createCommandFixture("absent-manifest-dry-run");
    await plantStateHome(fixture);
    const keyPath = await plantKey(fixture);
    const before = await inventoryDigest(fixture.root);

    const outcome = await runArm(fixture, { options: { dryRun: true, assumeYes: true } });

    expect(outcome).toMatchObject({ arm: "key_present", removed: [keyPath] });
    expect(await exists(join(fixture.paths.stateDir, LEAF))).toBe(false);
    expect(await inventoryDigest(fixture.root)).toStrictEqual(before);
  });

  const unusableKeys = [
    {
      label: "a symlink",
      plant: async (fixture: CommandFixture, keyPath: string): Promise<void> => {
        await nodeFs.writeFile(join(fixture.root, "elsewhere.bin"), KEY_BYTES, { mode: 0o600 });
        await nodeFs.symlink(join(fixture.root, "elsewhere.bin"), keyPath);
      },
    },
    {
      label: "a directory",
      plant: async (_fixture: CommandFixture, keyPath: string): Promise<void> => {
        await nodeFs.mkdir(keyPath, { mode: 0o700 });
      },
    },
    {
      label: "a second hard link",
      plant: async (fixture: CommandFixture, keyPath: string): Promise<void> => {
        await nodeFs.writeFile(keyPath, KEY_BYTES, { mode: 0o600 });
        await nodeFs.chmod(keyPath, 0o600);
        await nodeFs.link(keyPath, join(fixture.root, "second-link.bin"));
      },
    },
    {
      label: "thirty-one bytes",
      plant: async (_fixture: CommandFixture, keyPath: string): Promise<void> => {
        await nodeFs.writeFile(keyPath, new Uint8Array(31), { mode: 0o600 });
        await nodeFs.chmod(keyPath, 0o600);
      },
    },
    {
      label: "mode 0644",
      plant: async (_fixture: CommandFixture, keyPath: string): Promise<void> => {
        await nodeFs.writeFile(keyPath, KEY_BYTES, { mode: 0o644 });
        await nodeFs.chmod(keyPath, 0o644);
      },
    },
  ] as const;

  it.each(unusableKeys)("refuses a key that is $label and deletes nothing", async ({ plant }) => {
    const fixture = await createCommandFixture("absent-manifest-bad-key");
    await plantStateHome(fixture);
    const keyPath = join(fixture.paths.stateDir, "redaction.key");
    await plant(fixture, keyPath);
    const before = await inventoryDigest(fixture.root);

    const result = await runUninstall(fixture.context, ACCEPTED);

    expect(result).toMatchObject({ ok: false, code: EXIT_CODES.recoveryRequired });
    expect(result.ok ? "" : result.error.recovery).toContain(ARCHIVE);
    expect(await inventoryDigest(fixture.root)).toStrictEqual(before);
  });

  /**
   * §8.3 residual 8: the observation fstats a descriptor and the recheck lstats the pathname,
   * so a swap between them is detected rather than prevented. What must never happen is the
   * unlink going through against the replacement.
   */
  it("refuses to unlink a key whose identity changed after the observation", async () => {
    const fixture = await createCommandFixture("absent-manifest-identity-race");
    await plantStateHome(fixture);
    const keyPath = await plantKey(fixture);
    const canonicalKeyPath = parseCanonicalAbsolutePathText(keyPath);
    const observed = await observeSecretOpaqueKey(canonicalKeyPath, lifecycleOf(fixture).effectiveUid);
    if (observed.state !== "present") throw new Error("the planted key was not observed present");
    await nodeFs.unlink(keyPath);
    await nodeFs.writeFile(keyPath, KEY_BYTES, { mode: 0o600 });
    await nodeFs.chmod(keyPath, 0o600);
    const before = await inventoryDigest(fixture.root);

    await expect(unlinkSecretOpaqueKey(canonicalKeyPath, observed)).rejects.toMatchObject({
      code: EXIT_CODES.recoveryRequired,
    });

    expect(await inventoryDigest(fixture.root)).toStrictEqual(before);
  });

  it("leaves the key when the run dies before the unlink, and a rerun deletes it", async () => {
    const fixture = await createCommandFixture("absent-manifest-crash-before");
    await plantStateHome(fixture);
    const keyPath = await plantKey(fixture);
    const lifecycle = lifecycleOf(fixture);
    const dying: CliLifecycleContext = {
      ...lifecycle,
      transactionLocks: {
        acquire: async (path: string) => {
          await (await lifecycle.transactionLocks.acquire(path)).release();
          throw new Error("synthetic death before the unlink");
        },
      },
    };

    await expect(runArm(fixture, { lifecycle: dying })).rejects.toThrow(/synthetic death/u);

    expect(await exists(keyPath)).toBe(true);
    expect(await exists(join(fixture.paths.stateDir, LEAF))).toBe(true);
    expect(await runArm(fixture)).toMatchObject({ arm: "key_present", removed: [keyPath] });
    expect(await exists(keyPath)).toBe(false);
  });

  it("leaves no key when the run dies after the unlink, and a rerun is key_absent", async () => {
    const fixture = await createCommandFixture("absent-manifest-crash-after");
    await plantStateHome(fixture);
    const keyPath = await plantKey(fixture);
    const lifecycle = lifecycleOf(fixture);
    const dying: CliLifecycleContext = {
      ...lifecycle,
      fs: {
        ...lifecycle.fs,
        syncDirectory: () => Promise.reject(new Error("synthetic death after the unlink")),
      },
    };

    await expect(runArm(fixture, { lifecycle: dying })).rejects.toThrow(/synthetic death/u);

    expect(await exists(keyPath)).toBe(false);
    expect(await runArm(fixture)).toMatchObject({ arm: "key_absent", removed: [] });
  });

  const residues = [
    {
      label: "a configuration file",
      plant: (fixture: CommandFixture): Promise<void> =>
        nodeFs.writeFile(fixture.paths.configFile, "brainPath = \"/tmp/none\"\n", { mode: 0o600 }),
    },
    {
      label: "a legacy Foundation journal",
      plant: async (fixture: CommandFixture): Promise<void> => {
        const transactions = join(fixture.paths.stateDir, "transactions");
        await nodeFs.mkdir(transactions, { recursive: true, mode: 0o700 });
        await nodeFs.chmod(transactions, 0o700);
        await nodeFs.writeFile(
          join(transactions, "tx_00000000-0000-4000-8000-000000000001.json"),
          "{}\n",
          { mode: 0o600 },
        );
      },
    },
    {
      label: "an installed launch agent",
      plant: async (fixture: CommandFixture): Promise<void> => {
        const agents = join(fixture.userHome, "Library", "LaunchAgents");
        await nodeFs.mkdir(agents, { recursive: true, mode: 0o700 });
        await nodeFs.writeFile(
          join(agents, `com.developer-os.${SCHEDULED_JOB_IDS[0]}.plist`),
          "<plist/>\n",
          { mode: 0o600 },
        );
      },
    },
  ] as const;

  it.each(residues)("refuses $label beside the key and changes nothing", async ({ plant }) => {
    const fixture = await createCommandFixture("absent-manifest-residue");
    await plantStateHome(fixture);
    const keyPath = await plantKey(fixture);
    await plant(fixture);
    const before = await inventoryDigest(fixture.root);

    const result = await runUninstall(fixture.context, ACCEPTED);

    expect(result).toMatchObject({ ok: false, code: EXIT_CODES.recoveryRequired });
    expect(result.ok ? "" : result.error.recovery).toContain(ARCHIVE);
    expect(await exists(keyPath)).toBe(true);
    expect(await inventoryDigest(fixture.root)).toStrictEqual(before);
  });

  it("refuses a bootstrap leaf a retained envelope already claims", async () => {
    const fixture = await createCommandFixture("absent-manifest-attributed-leaf");
    await plantStateHome(fixture);
    const keyPath = await plantKey(fixture);
    const leafPath = await plantLeaf(fixture);
    const leaf = await nodeFs.lstat(leafPath, { bigint: true });
    const claimed = {
      ...(await evidenceOf(fixture)),
      retainedEnvelopes: [
        {
          plan: {
            bootstrapIdentity: { dev: leaf.dev.toString(10), ino: leaf.ino.toString(10) },
            foundationParticipants: [],
          },
        },
      ],
    } as unknown as BootstrapEvidenceAdmissionV1;
    const before = await inventoryDigest(fixture.root);

    await expect(runArm(fixture, { evidence: claimed })).rejects.toMatchObject({
      code: EXIT_CODES.recoveryRequired,
    });

    expect(await exists(keyPath)).toBe(true);
    expect(await inventoryDigest(fixture.root)).toStrictEqual(before);
  });

  it("refuses active bootstrap residue before it walks the home", async () => {
    const fixture = await createCommandFixture("absent-manifest-active-residue");
    await plantStateHome(fixture);
    const keyPath = await plantKey(fixture);
    const active = {
      ...(await evidenceOf(fixture)),
      active: { plan: {}, journal: null },
    } as unknown as BootstrapEvidenceAdmissionV1;
    const before = await inventoryDigest(fixture.root);

    await expect(runArm(fixture, { evidence: active })).rejects.toMatchObject({
      code: EXIT_CODES.recoveryRequired,
    });

    expect(await exists(keyPath)).toBe(true);
    expect(await inventoryDigest(fixture.root)).toStrictEqual(before);
  });

  it("refuses without a lifecycle capability rather than removing anything", async () => {
    const fixture = await createCommandFixture("absent-manifest-no-lifecycle");
    await plantStateHome(fixture);
    const keyPath = await plantKey(fixture);
    const before = await inventoryDigest(fixture.root);

    const result = await runUninstall({ ...fixture.context, lifecycle: undefined }, ACCEPTED);

    expect(result).toMatchObject({ ok: false, code: EXIT_CODES.recoveryRequired });
    expect(result.ok ? "" : result.error.recovery).toContain(ARCHIVE);
    expect(await exists(keyPath)).toBe(true);
    expect(await inventoryDigest(fixture.root)).toStrictEqual(before);
  });
});
