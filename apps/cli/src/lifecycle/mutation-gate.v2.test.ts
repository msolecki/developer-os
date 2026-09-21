import { createHash, randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  EXIT_CODES,
  encodeLifecycleIdAllocator,
  formatAllocatedLifecycleId,
  foundationParticipantPlanHash,
  parseAllocatedLifecycleId,
  parseCanonicalAbsolutePathText,
  parseEffectiveUid,
  parseLifecycleCoordinatorId,
  parseLifecycleInstallNonce,
  parseLowerHexSha256,
  parseManifestParticipantId,
  parseUInt64Decimal,
} from "@developer-os/core";
import type {
  AllocatedLifecycleIdV1,
  CanonicalAbsolutePathV1,
  FoundationParticipantRefV1,
  FoundationParticipantSlotV1,
  LifecycleCoordinatorIdV1,
  LifecycleCoordinatorStepV1,
  LifecycleInstallNonceV1,
  LifecycleLedgerSnapshotV1,
  LowerHexSha256,
  ManifestStatePlanV1,
  TransactionJournalV1,
  UInt64DecimalV1,
} from "@developer-os/core";
import { MacOsStableLockProvider } from "@developer-os/platform-macos";

import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import { runInit } from "../commands/init.js";
import { runRepair } from "../commands/repair.js";
import { runStatus } from "../commands/status.js";
import { manifestAdmissionFor, runUninstall } from "../commands/uninstall.js";
import {
  createCommandFixture,
  exists,
  firstRegularFile,
  inventoryDigest,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
  retainedTombstones,
} from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import type { LifecycleExecutionPlanV1 } from "./codecs.js";
import { lifecycleHomeKeyFromAdmission, residueFrom } from "./context.js";
import type { CliLifecycleContext } from "./context.js";
import { admitInstalledV2Home } from "./admission.js";
import { classifyMutationHome, withLifecycleMutation } from "./mutation-gate.js";
import type { RedactionKeyStatePlanV1 } from "./redaction-key.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const UID = process.getuid?.() ?? 0;
const OWNER_UID = parseEffectiveUid(UID, UID);
const DEV: UInt64DecimalV1 = parseUInt64Decimal("16777232");
const INO: UInt64DecimalV1 = parseUInt64Decimal("184467440737095516");
const FOUNDATION_BINDINGS_DOMAIN = "developer-os/manifest-foundation-bindings/v1\0";

afterAll(removeCommandFixtures);

let sharedHome: Promise<CommandFixture> | null = null;

/** One real fresh V2 `init` per file; every case below restores the ledger through the gate. */
function sharedV2Home(): Promise<CommandFixture> {
  sharedHome ??= initialisedV2Home("gate-shared", {});
  return sharedHome;
}

async function initialisedV2Home(
  label: string,
  options: Parameters<typeof createCommandFixture>[1],
): Promise<CommandFixture> {
  const fixture = await createCommandFixture(label, { ...options, bootstrapAvailable: true });
  await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  const result = await runInit(fixture.context, ACCEPTED);
  if (!result.ok) {
    throw new Error(
      `fixture init failed: ${JSON.stringify({ result, trace: fixture.bootstrapTrace.slice(-30) })}`,
    );
  }
  return fixture;
}

async function admittedKeyOf(fixture: CommandFixture): Promise<ReturnType<typeof lifecycleHomeKeyFromAdmission>> {
  const lifecycle = lifecycleOf(fixture);
  return lifecycleHomeKeyFromAdmission(
    await admitInstalledV2Home({
      fs: lifecycle.fs,
      paths: fixture.paths,
      manifestAdmission: manifestAdmissionFor(fixture.paths, []),
      effectiveUid: lifecycle.effectiveUid,
    }),
    fixture.paths,
  );
}

async function snapshotOf(
  fixture: CommandFixture,
): Promise<LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>> {
  const residue = residueFrom(
    await inspectBootstrapEvidenceAdmission(
      createBootstrapEvidenceInspectionRequest({
        productHome: fixture.paths.home,
        stateDirectory: fixture.paths.stateDir,
        initialRoots: [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
      }),
    ),
  );
  return lifecycleOf(fixture).inspectLedger(await admittedKeyOf(fixture), residue);
}

function lifecycleOf(fixture: CommandFixture): CliLifecycleContext {
  const lifecycle = fixture.context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
  return lifecycle;
}

function globalLockPath(fixture: CommandFixture): string {
  return join(fixture.paths.stateDir, ".lifecycle.lock");
}

function allocatorPath(fixture: CommandFixture): string {
  return join(fixture.paths.stateDir, "lifecycle-id-allocator.json");
}

async function nonceOf(fixture: CommandFixture): Promise<LifecycleInstallNonceV1> {
  return parseLifecycleInstallNonce(
    await nodeFs.readFile(join(fixture.paths.stateDir, "lifecycle-install-nonce")),
  );
}

async function allocatorCounter(fixture: CommandFixture): Promise<bigint> {
  const value = JSON.parse(await nodeFs.readFile(allocatorPath(fixture), "utf8")) as {
    readonly nextCounter: string;
  };
  return BigInt(value.nextCounter);
}

async function journalIds(fixture: CommandFixture): Promise<readonly string[]> {
  const names = await nodeFs
    .readdir(join(fixture.paths.stateDir, "transactions"))
    .catch(() => [] as string[]);
  return names
    .filter((name) => !name.startsWith(".") && name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
}

function probePlan(fixture: CommandFixture, name: string): {
  readonly kind: string;
  readonly mutations: readonly {
    readonly targetPath: string;
    readonly operation: "create";
    readonly content: Uint8Array;
  }[];
} {
  return {
    kind: "capture",
    mutations: [
      {
        targetPath: join(fixture.paths.home, `${name}.probe.json`),
        operation: "create" as const,
        content: new TextEncoder().encode(`{"probe":"${name}"}\n`),
      },
    ],
  };
}

/**
 * Spec 1 scope decision 5's mutators reach the gate through `context.executor`, but on a V2
 * home `capture`, `ingest`, `review` and `reindex` fail before it at
 * `ManifestStore.readOptional()`, whose zero-argument overload refuses a V2 manifest. The
 * contract under test is the executor's, so these cases drive it directly; `uninstall` and
 * `repair` below are the command-level proofs.
 */
function mutate(fixture: CommandFixture, name: string): Promise<TransactionJournalV1> {
  return fixture.context.executor.execute(probePlan(fixture, name));
}

interface RefusalObservationV1 {
  readonly refused: boolean;
  readonly reason: unknown;
  readonly code: unknown;
  readonly recovery: string;
}

async function refusalOf(attempt: Promise<unknown>): Promise<RefusalObservationV1> {
  return attempt.then(
    () => ({ refused: false, reason: null, code: null, recovery: "" }),
    (error: unknown) => {
      const refusal = error as {
        readonly reason?: unknown;
        readonly code?: unknown;
        readonly recovery?: unknown;
      };
      return {
        refused: true,
        reason: refusal.reason ?? null,
        code: refusal.code ?? null,
        recovery: typeof refusal.recovery === "string" ? refusal.recovery : "",
      };
    },
  );
}

async function restoring(
  apply: () => Promise<void>,
  revert: () => Promise<void>,
  body: () => Promise<void>,
): Promise<void> {
  try {
    await apply();
    await body();
  } finally {
    await revert();
  }
}

function hash(seed: string): LowerHexSha256 {
  return parseLowerHexSha256(seed.repeat(64).slice(0, 64));
}

function fileHash(text: string): LowerHexSha256 {
  return parseLowerHexSha256(createHash("sha256").update(text).digest("hex"));
}

function foundationBindingsHash(ids: readonly string[]): LowerHexSha256 {
  return parseLowerHexSha256(
    createHash("sha256").update(FOUNDATION_BINDINGS_DOMAIN).update(JSON.stringify(ids)).digest("hex"),
  );
}

/**
 * `uninstall/present_manifest_without_launchd`, the one variant plan 1a's codec admits. It is
 * published as a plan leaf alone, with no journal, lock or staging, which is §2.4's
 * `envelope_suffix_plan_only`.
 */
function syntheticUninstallPlan(
  productHome: CanonicalAbsolutePathV1,
  nonce: LifecycleInstallNonceV1,
  base: bigint,
): { readonly id: LifecycleCoordinatorIdV1; readonly plan: LifecycleExecutionPlanV1 } {
  const path = (text: string): CanonicalAbsolutePathV1 => parseCanonicalAbsolutePathText(text);
  const transactionId = (counter: bigint): AllocatedLifecycleIdV1<"tx"> =>
    parseAllocatedLifecycleId("tx", formatAllocatedLifecycleId("tx", nonce, counter), nonce);
  const id = parseLifecycleCoordinatorId(formatAllocatedLifecycleId("lc", nonce, base), nonce);
  const manifestParticipantId = parseManifestParticipantId(
    formatAllocatedLifecycleId("mf", nonce, base + 5n),
    nonce,
  );
  const markerForward = transactionId(base + 1n);
  const markerCompensation = transactionId(base + 2n);
  const artifactsForward = transactionId(base + 3n);
  const artifactsCompensation = transactionId(base + 4n);
  const manifestPath = path(`${productHome}/installation-manifest.json`);
  const manifestBytes = "{}\n";

  const participantRef = (options: {
    readonly id: AllocatedLifecycleIdV1<"tx">;
    readonly slot: FoundationParticipantSlotV1;
    readonly role: FoundationParticipantRefV1["role"];
  }): FoundationParticipantRefV1 => {
    const core = {
      slot: options.slot,
      role: options.role,
      mutations:
        options.role.kind === "forward"
          ? [
              {
                targetPath: path(`${productHome}/state/${options.slot}.json`),
                operation: "create" as const,
                expectedBeforeHash: null,
                contentHash: hash("4"),
                contentSize: 16,
                stagedPath: path(`${productHome}/staging/transactions/${options.id}/0.bin`),
              },
            ]
          : [
              {
                targetPath: path(`${productHome}/state/${options.slot}.json`),
                operation: "remove" as const,
                expectedBeforeHash: hash("4"),
                contentHash: null,
                contentSize: null,
                stagedPath: null,
              },
            ],
      maximumJournalBytes: 4_096,
      initialJournal: {
        finalPath: path(`${productHome}/state/transactions/${options.id}.json`),
        plannedBytesHash: hash("6"),
        stagedPath: path(
          `${productHome}/staging/lifecycle/${id}/foundation/${options.id}/journal.json`,
        ),
        stagedIdentity: { hash: hash("7"), size: 512, mode: 384 as const, dev: DEV, ino: INO },
      },
    };
    return { id: options.id, ...core, planHash: foundationParticipantPlanHash(core) };
  };

  const steps: readonly LifecycleCoordinatorStepV1[] = [
    { kind: "foundation", slot: "uninstall_marker", participantId: markerForward },
    { kind: "drain_runners" },
    { kind: "foundation", slot: "uninstall_artifacts", participantId: artifactsForward },
    { kind: "redaction_key", transition: "stage" },
    { kind: "manifest", transition: "preserve_before" },
    { kind: "manifest", transition: "commit_absence" },
    { kind: "redaction_key", transition: "delete" },
    { kind: "manifest", transition: "finalize_tombstones" },
  ];

  const manifest: ManifestStatePlanV1 = {
    schemaVersion: 1,
    participantId: manifestParticipantId,
    envelope: { kind: "lifecycle", id },
    bindings: {
      foundationTransactions: {
        count: 2,
        orderedIdsHash: foundationBindingsHash([markerForward, artifactsForward]),
      },
      externalEffects: [],
    },
    manifestPath,
    tombstonePath: path(
      `${productHome}/.installation-manifest.${manifestParticipantId}.json.tombstone`,
    ),
    before: {
      state: "present",
      hash: fileHash(manifestBytes),
      bytes: null,
      ownerUid: UID,
      mode: 0o600,
      nlink: 1,
      size: parseUInt64Decimal(String(manifestBytes.length)),
      dev: DEV,
      ino: INO,
    },
    after: { state: "absent" },
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  };

  const redactionKey: RedactionKeyStatePlanV1 = {
    schemaVersion: 1,
    coordinatorId: id,
    sourcePath: path(`${productHome}/state/redaction.key`),
    tombstonePath: path(`${productHome}/state/.redaction.key.${id}.tombstone`),
    before: {
      state: "present",
      kind: "regular_file",
      ownerUid: OWNER_UID,
      mode: 384,
      nlink: 1,
      size: 32,
      dev: DEV,
      ino: INO,
    },
  };

  return {
    id,
    plan: {
      schemaVersion: 1,
      id,
      previewHash: null,
      operation: "uninstall",
      maximumJournalBytes: 8_192,
      authority: {
        productHome,
        configPath: path(`${productHome}/config.toml`),
        activationPath: path(`${productHome}/state/lifecycle-activation.json`),
        manifestPath,
        repositoryRoot: null,
        plistPaths: [],
      },
      participants: {
        foundation: [
          participantRef({
            id: markerForward,
            slot: "uninstall_marker",
            role: { kind: "forward", compensationId: markerCompensation },
          }),
          participantRef({
            id: markerCompensation,
            slot: "uninstall_marker",
            role: { kind: "compensation", forwardId: markerForward },
          }),
          participantRef({
            id: artifactsForward,
            slot: "uninstall_artifacts",
            role: { kind: "forward", compensationId: artifactsCompensation },
          }),
          participantRef({
            id: artifactsCompensation,
            slot: "uninstall_artifacts",
            role: { kind: "compensation", forwardId: artifactsForward },
          }),
        ].sort((left, right) => (left.id < right.id ? -1 : 1)),
        manifest,
        sourceGitEffect: null,
        destinationGitEffect: null,
        launchdBeforeFiles: null,
        launchdAfterFiles: null,
        launchd: null,
        redactionKey,
      },
      push: null,
      steps,
    },
  };
}

describe("the mutation gate on a real V2 home", () => {
  it("runs a V2 mutation under the global lock with one allocated transaction ID", async () => {
    const fixture = await sharedV2Home();
    const nonce = await nonceOf(fixture);
    const before = await allocatorCounter(fixture);
    const events = fixture.stableLockEvents.length;

    const journal = await mutate(fixture, "allocated");

    expect(journal.id).toBe(`tx_${nonce}_${String(before)}`);
    expect(journal.phase).toBe("finalized");
    expect(await allocatorCounter(fixture)).toBe(before + 1n);
    expect(await journalIds(fixture)).toContain(`tx_${nonce}_${String(before)}`);
    expect(fixture.stableLockEvents.slice(events)).toStrictEqual([
      `acquire ${globalLockPath(fixture)}`,
      `release ${globalLockPath(fixture)}`,
    ]);
    expect(fixture.vendorProcesses).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("compacts the previous mutation's terminal journal in the next mutation's preflight", async () => {
    const fixture = await sharedV2Home();

    const first = await mutate(fixture, "compacted-first");
    expect(await journalIds(fixture)).toContain(first.id);

    await mutate(fixture, "compacted-second");

    expect(await journalIds(fixture)).not.toContain(first.id);
    for (const path of [
      join(fixture.paths.stateDir, "transactions", `${first.id}.json`),
      join(fixture.paths.stateDir, "transactions", `.${first.id}.lock`),
      join(fixture.paths.stagingDir, "transactions", first.id),
      join(fixture.paths.backupsDir, "transactions", first.id),
    ]) {
      expect(await exists(path), path).toBe(false);
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses interactive contention on the global lock with exit 6 and writes nothing", async () => {
    const fixture = await sharedV2Home();
    const held = await new MacOsStableLockProvider().acquireExisting(
      globalLockPath(fixture) as CanonicalAbsolutePathV1,
    );
    try {
      const before = await inventoryDigest(fixture.paths.home);

      expect(await refusalOf(mutate(fixture, "contended"))).toMatchObject({
        refused: true,
        reason: "lifecycle_lock_busy",
        code: EXIT_CODES.recoveryRequired,
      });

      expect(await inventoryDigest(fixture.paths.home)).toStrictEqual(before);
    } finally {
      await held.release();
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reuses the held authority for a nested execute instead of re-acquiring the global lock", async () => {
    const fixture = await sharedV2Home();
    const nonce = await nonceOf(fixture);
    const before = await allocatorCounter(fixture);
    const events = fixture.stableLockEvents.length;

    const nested = await withLifecycleMutation(fixture.context, lifecycleOf(fixture), async () => {
      const held = fixture.stableLockEvents.length;
      const journal = await mutate(fixture, "nested");
      return { journal, acquiredWhileHeld: fixture.stableLockEvents.slice(held) };
    });

    expect(nested.acquiredWhileHeld).toStrictEqual([]);
    expect(nested.journal.id).toBe(`tx_${nonce}_${String(before)}`);
    expect(fixture.stableLockEvents.slice(events)).toStrictEqual([
      `acquire ${globalLockPath(fixture)}`,
      `release ${globalLockPath(fixture)}`,
    ]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a malformed leaf in state/lifecycle-journals with exit 6 and writes nothing", async () => {
    const fixture = await sharedV2Home();
    const planted = join(fixture.paths.stateDir, "lifecycle-journals", "synthetic-orphan.json");
    /** The gate materialises `staging/lifecycle` on its first mutation; the digest is taken after that. */
    await mutate(fixture, "malformed-preparation");

    await restoring(
      () => nodeFs.writeFile(planted, "{}\n", { mode: 0o600 }),
      () => nodeFs.rm(planted, { force: true }),
      async () => {
        const before = await inventoryDigest(fixture.paths.home);

        expect(await refusalOf(mutate(fixture, "malformed"))).toMatchObject({
          refused: true,
          code: EXIT_CODES.recoveryRequired,
        });

        expect(await inventoryDigest(fixture.paths.home)).toStrictEqual(before);
      },
    );
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("cleans an allocator temp in a mutator's preflight and leaves it untouched under status", async () => {
    const fixture = await sharedV2Home();
    const temp = join(fixture.paths.stateDir, `.lifecycle-id-allocator.${randomUUID()}.json.tmp`);
    await nodeFs.writeFile(
      temp,
      encodeLifecycleIdAllocator({
        schemaVersion: 1,
        installNonce: await nonceOf(fixture),
        nextCounter: parseUInt64Decimal(String(await allocatorCounter(fixture))),
      }),
      { mode: 0o600 },
    );

    expect((await runStatus(fixture.context)).ok).toBe(true);
    expect(await exists(temp)).toBe(true);

    await mutate(fixture, "allocator-temp");

    expect(await exists(temp)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("completes a coordinator plan-only orphan in the preflight and lets the mutation proceed", async () => {
    const fixture = await sharedV2Home();
    const nonce = await nonceOf(fixture);
    /**
     * The planted block is the six counters the allocator has not issued yet, and the counter
     * is then advanced past them: §7 admits a gap, never a rewind, and no surviving journal
     * can carry an ID the allocator has never handed out.
     */
    const base = await allocatorCounter(fixture);
    const floor = base + 6n;
    await nodeFs.writeFile(
      allocatorPath(fixture),
      encodeLifecycleIdAllocator({
        schemaVersion: 1,
        installNonce: nonce,
        nextCounter: parseUInt64Decimal(String(floor)),
      }),
      { mode: 0o600 },
    );
    const key = await admittedKeyOf(fixture);
    const orphan = syntheticUninstallPlan(key.productHome, nonce, base);
    const planPath = join(fixture.paths.stateDir, "lifecycle-journals", `${orphan.id}.plan.json`);
    await nodeFs.writeFile(
      planPath,
      lifecycleOf(fixture).codecs(key).executionPlan.encode(orphan.plan),
      { mode: 0o600 },
    );

    const planted = await snapshotOf(fixture);
    expect(planted.findings).toStrictEqual([]);
    expect(planted.coordinators.map((record) => record.state)).toStrictEqual([
      "envelope_suffix_plan_only",
    ]);

    const journal = await mutate(fixture, "orphan-completed");

    expect(journal.id).toBe(`tx_${nonce}_${String(floor)}`);
    expect(await exists(planPath)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * A retained file whose bytes changed costs its envelope the `verified` status, so
   * `inspectBootstrapEvidenceAdmission` publishes no retained envelope, `residueFrom` derives
   * no `bootstrapParticipantIds`, and the ledger can no longer attribute the retained
   * participant's own staging tree. `bootstrap/executor.ts` derives that same set to admit a
   * fresh `init`, so naming participants from an unverified envelope here would leave two
   * writers of one derived fact disagreeing.
   */
  it("refuses a mutation once a retained bootstrap file no longer verifies, and writes nothing", async () => {
    const fixture = await sharedV2Home();
    /** The gate materialises `staging/lifecycle` on its first mutation; the digest is taken after that. */
    await mutate(fixture, "retained-preparation");
    const tombstones = await retainedTombstones(fixture.root);
    expect(tombstones.length).toBeGreaterThan(0);
    const target = await firstRegularFile(tombstones);
    if (target === null) throw new Error("the fixture retained no regular-file tombstone");
    const original = await nodeFs.readFile(target);
    const altered = new Uint8Array(original.byteLength + 1);
    altered.set(original);
    altered[original.byteLength] = 0x21;

    await restoring(
      () => nodeFs.writeFile(target, altered),
      () => nodeFs.writeFile(target, original),
      async () => {
        const before = await inventoryDigest(fixture.paths.home);

        expect(await refusalOf(mutate(fixture, "retained-altered"))).toStrictEqual({
          refused: true,
          reason: "lifecycle_ledger_finding",
          code: EXIT_CODES.recoveryRequired,
          recovery: "developer-os doctor",
        });

        expect(await inventoryDigest(fixture.paths.home)).toStrictEqual(before);
      },
    );

    expect(await refusalOf(mutate(fixture, "retained-restored"))).toMatchObject({ refused: false });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

});

/**
 * Its own pristine home: the shipped downcast reads the V2 allocator row back through the V1
 * drift comparison, so a home whose counter has already advanced refuses exit 3 before the
 * gate is reached.
 */
describe("the V2 downcast uninstall", () => {
  it("runs through the gate with an allocated journal ID and leaves the global lock behind", async () => {
    const fixture = await initialisedV2Home("gate-uninstall", {});
    const nonce = await nonceOf(fixture);
    const before = await allocatorCounter(fixture);

    const removed = await runUninstall(fixture.rebuildContext(), ACCEPTED);

    expect(removed.ok, JSON.stringify(removed)).toBe(true);
    expect(fixture.stableLockEvents).toStrictEqual([
      `acquire ${globalLockPath(fixture)}`,
      `release ${globalLockPath(fixture)}`,
    ]);
    expect(await exists(globalLockPath(fixture))).toBe(true);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
    expect(await journalIds(fixture)).toContain(`tx_${nonce}_${String(before)}`);
    expect(fixture.vendorProcesses).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("the mutation gate around a non-terminal standalone Foundation journal", () => {
  let interrupted: Promise<CommandFixture> | null = null;

  const interruptedHome = (): Promise<CommandFixture> => {
    interrupted ??= initialisedV2Home("gate-repair-resolution", {
      interruptAfter: "applied",
      interruptKind: "capture",
    });
    return interrupted;
  };

  it("names repair as the way out of a non-terminal standalone journal, and repair resolves it", async () => {
    const fixture = await interruptedHome();

    expect(await refusalOf(mutate(fixture, "interrupted"))).toMatchObject({ refused: true });

    const refused = await refusalOf(mutate(fixture, "blocked"));
    expect(refused).toMatchObject({
      refused: true,
      reason: "lifecycle_standalone_transaction_incomplete",
      code: EXIT_CODES.recoveryRequired,
    });
    const id = /--resume (tx_\S+)/u.exec(refused.recovery)?.[1];
    expect(id).toMatch(/^tx_[0-9a-f]{64}_[0-9]+$/u);

    expect(await runRepair(fixture.rebuildContext(), { resume: id ?? "", rollback: null })).toMatchObject({
      ok: true,
    });
    expect(await classifyMutationHome(fixture.context, lifecycleOf(fixture))).toMatchObject({
      kind: "v2",
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /** Last on this home: it leaves two non-terminal journals, which no gated verb can pass. */
  it("refuses repair --resume of an ID that is not the only non-terminal entry with exit 6", async () => {
    const fixture = await interruptedHome();

    const ids = await withLifecycleMutation(fixture.context, lifecycleOf(fixture), async (authority) => {
      const first = await authority.allocateStandaloneFoundationId(probePlan(fixture, "pair-one").mutations);
      const second = await authority.allocateStandaloneFoundationId(probePlan(fixture, "pair-two").mutations);
      await refusalOf(mutate(fixture, "pair-one"));
      await refusalOf(mutate(fixture, "pair-two"));
      return [first, second];
    });

    expect(ids).toHaveLength(2);
    const nonTerminal = (await journalIds(fixture)).filter((id) => id.startsWith("tx_"));
    expect(nonTerminal.length).toBeGreaterThanOrEqual(2);

    const [first] = nonTerminal;
    const refused = await runRepair(fixture.rebuildContext(), { resume: first ?? "", rollback: null });

    expect(refused).toMatchObject({ ok: false, code: EXIT_CODES.recoveryRequired });
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
