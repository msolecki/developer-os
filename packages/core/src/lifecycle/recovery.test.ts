import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "../result.js";
import { TransactionExecutor } from "../transactions/executor.js";
import { TransactionStore, encodeFoundationJournalJsonV1 } from "../transactions/store.js";
import type {
  TransactionJournalV1,
  TransactionLockHandle,
  TransactionLockProvider,
} from "../transactions/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  parseLowerHexSha256,
  parseUInt64Decimal,
  parseUtcTimestamp,
  type LowerHexSha256,
} from "../update/scalars.js";
import { reserveLifecycleIdBlock } from "./allocator.js";
import type { LifecycleBookkeepingResidueV1 } from "./bookkeeping.js";
import { encodeCanonicalJson, type CanonicalJsonValue } from "./canonical-json.js";
import {
  createLifecycleCodecs,
  type LifecycleLeafCodecsV1,
  type LifecycleValueCodec,
} from "./codecs.js";
import {
  LifecycleCoordinator,
  type LifecycleCoordinatorDependenciesV1,
  type LifecycleParticipantAdaptersV1,
} from "./coordinator.js";
import { deriveLifecycleLedgerRoots, type LifecycleLedgerRootsV1 } from "./foundation-ledger.js";
import { FoundationParticipantExecutor } from "./foundation-participant.js";
import type { LifecycleVariantFactsV1 } from "./grammar.js";
import {
  createNodeLifecycleGuardedFileSystem,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import {
  formatAllocatedLifecycleId,
  parseAllocatedLifecycleId,
  parseLifecycleCoordinatorId,
  type AllocatedLifecycleIdV1,
} from "./ids.js";
import { inspectLifecycleLedger, type LifecycleLedgerSnapshotV1 } from "./ledger.js";
import type { HeldLifecycleStableLockV1 } from "./locks.js";
import { LifecycleRecoveryRefusalError, LifecycleRecoveryService } from "./recovery.js";
import { encodeLifecycleIdAllocator } from "./records.js";
import { LifecycleCoordinatorStore, maximumCoordinatorJournalBytes } from "./store.js";
import {
  createInMemoryLifecycleGuardedFileSystem,
  createLinkUnlinkRenameNoReplace,
} from "./testing.js";
import type {
  FoundationParticipantRefV1,
  LifecycleCoordinatorPlanCoreV1,
  LifecycleCoordinatorStepV1,
} from "./types.js";

const UID = process.getuid?.() ?? 0;
const NONCE = parseLowerHexSha256("6f".repeat(32));
const CREATED_AT = parseUtcTimestamp("2026-09-20T12:00:00.000Z");
const CLOCK = parseUtcTimestamp("2026-09-20T12:00:01.000Z");
const encoder = new TextEncoder();

const NO_RESIDUE: LifecycleBookkeepingResidueV1 = {
  retainedPaths: new Set(),
  bootstrapParticipantIds: new Set(),
};

const HOME_DIRECTORIES = [
  "state",
  "state/transactions",
  "state/lifecycle-journals",
  "state/git-effect-journals",
  "state/launchd-effect-journals",
  "staging",
  "staging/transactions",
  "staging/lifecycle",
  "backups",
  "backups/transactions",
  "targets",
] as const;

class FixtureLockProvider implements TransactionLockProvider {
  async acquire(path: string): Promise<TransactionLockHandle> {
    await nodeFs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(path, "", { mode: 0o600, flag: "a" });
    return { release: (): Promise<void> => Promise.resolve() };
  }
}

const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) {
    await nodeFs.rm(home, { recursive: true, force: true });
  }
});

function digest(bytes: Uint8Array): LowerHexSha256 {
  return parseLowerHexSha256(createHash("sha256").update(bytes).digest("hex"));
}

interface SyntheticLeaf {
  readonly marker: string;
}
interface SyntheticPush extends SyntheticLeaf {
  readonly planHash: LowerHexSha256;
}
type SyntheticPlan = LifecycleCoordinatorPlanCoreV1<
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticPush
>;

function leafCodec<T extends SyntheticLeaf>(label: string): LifecycleValueCodec<T> {
  return {
    validate(value: unknown): T {
      if (typeof value !== "object" || value === null || !("marker" in value)) {
        throw new Error(`invalid synthetic ${label} leaf`);
      }
      return value as T;
    },
    encode: (value) => encodeCanonicalJson(value as unknown as CanonicalJsonValue),
  };
}

const LEAVES: LifecycleLeafCodecsV1<
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticPush,
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticLeaf & {
    readonly tableHashes: {
      readonly observation: LowerHexSha256;
      readonly mutationTemplate: LowerHexSha256;
    };
  }
> = {
  manifest: leafCodec("manifest"),
  launchd: leafCodec("launchd"),
  redactionKey: leafCodec("redactionKey"),
  push: leafCodec<SyntheticPush>("push"),
  pushPlanHash: (push) => push.planHash,
  projection: leafCodec("projection"),
  gitPreview: leafCodec("gitPreview"),
  launchdPreview: leafCodec("launchdPreview"),
  projectionSubsystem: () => "git",
  launchdPreviewTableHashes: (preview) => preview.tableHashes,
};

const UNINSTALL_FACTS: LifecycleVariantFactsV1 = {
  gitSync: null,
  automationReconcile: null,
  uninstallLaunchdEvidence: false,
};

type Dependencies = LifecycleCoordinatorDependenciesV1<SyntheticPlan> & {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly foundationStore: TransactionStore;
};

interface RecoveryWorldV1 {
  readonly home: CanonicalAbsolutePathV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly plan: SyntheticPlan;
  readonly global: HeldLifecycleStableLockV1;
  readonly foundationStore: TransactionStore;
  dependencies(): Dependencies;
  inspect(): Promise<LifecycleLedgerSnapshotV1<SyntheticPlan>>;
  recovery(): LifecycleRecoveryService<SyntheticPlan>;
  execute(): Promise<void>;
  standalone(id: string): Promise<void>;
  standaloneNonTerminal(id: string): Promise<string>;
  removeCoordinatorJournal(): Promise<void>;
  plantUnknownLeaf(): Promise<void>;
  exists(relative: string): Promise<boolean>;
  allocatorCounter(): Promise<string>;
}

async function recoveryWorld(
  label: string,
  options: { readonly publish?: boolean } = {},
): Promise<RecoveryWorldV1> {
  const created = await nodeFs.mkdtemp(join(tmpdir(), `developer-os-${label}-`));
  homes.push(created);
  await nodeFs.chmod(created, 0o700);
  for (const relative of HOME_DIRECTORIES) {
    await nodeFs.mkdir(join(created, relative));
    await nodeFs.chmod(join(created, relative), 0o700);
  }
  const home = parseCanonicalAbsolutePathText(created);
  const roots = deriveLifecycleLedgerRoots(home);
  const publisher = createLinkUnlinkRenameNoReplace();
  const fs = createNodeLifecycleGuardedFileSystem({
    renameNoReplace: publisher.publish,
    effectiveUid: UID,
  });
  const codecs = createLifecycleCodecs(LEAVES, { productHome: home, nonce: NONCE });

  const lockPath = parseCanonicalAbsolutePathText(join(created, "state", ".lifecycle.lock"));
  await nodeFs.writeFile(lockPath, "", { mode: 0o600 });
  await nodeFs.writeFile(join(created, "state", "lifecycle-install-nonce"), `${NONCE}\n`, {
    mode: 0o600,
  });
  await nodeFs.writeFile(
    join(created, "state", "lifecycle-id-allocator.json"),
    encodeLifecycleIdAllocator({
      schemaVersion: 1,
      installNonce: NONCE,
      nextCounter: parseUInt64Decimal("1000"),
    }),
    { mode: 0o600 },
  );
  const lockStats = await nodeFs.lstat(lockPath, { bigint: true });
  const global: HeldLifecycleStableLockV1 = {
    path: lockPath,
    dev: parseUInt64Decimal(lockStats.dev.toString(10)),
    ino: parseUInt64Decimal(lockStats.ino.toString(10)),
    release: () => Promise.resolve(),
  };

  const lockProvider = new FixtureLockProvider();
  const foundationStore = new TransactionStore({
    stateDir: join(created, "state"),
    fs: nodeFs,
    lockProvider,
  });
  let standaloneCounter = 0;
  const executor = new TransactionExecutor({
    stateDir: join(created, "state"),
    stagingDir: join(created, "staging"),
    backupsDir: join(created, "backups"),
    fs: nodeFs,
    clock: () => CLOCK,
    generateId: () => {
      standaloneCounter += 1;
      return formatAllocatedLifecycleId("tx", NONCE, BigInt(900 + standaloneCounter));
    },
    guards: { assertTarget: () => Promise.resolve(), redactDiagnostic: (text) => text },
    lockProvider,
    publishBootstrapInitialJournalNoReplace: (request) => publisher.publish(request),
  });
  const participants = new FoundationParticipantExecutor({ fs, roots, executor, effectiveUid: UID });

  let counter = 512n;
  const nextTx = (): AllocatedLifecycleIdV1<"tx"> => {
    counter += 1n;
    return parseAllocatedLifecycleId("tx", formatAllocatedLifecycleId("tx", NONCE, counter), NONCE);
  };
  const coordinatorId = parseLifecycleCoordinatorId(
    formatAllocatedLifecycleId("lc", NONCE, counter),
    NONCE,
  );

  const manifestPath = parseCanonicalAbsolutePathText(join(created, "state", "installation.json"));
  const manifestBytes = encoder.encode('{"synthetic":"manifest"}\n');
  await nodeFs.writeFile(manifestPath, manifestBytes, { mode: 0o600 });

  const refs: FoundationParticipantRefV1[] = [];
  const forwardIds: AllocatedLifecycleIdV1<"tx">[] = [];
  for (const slot of ["uninstall_marker", "uninstall_artifacts"] as const) {
    const forwardId = nextTx();
    const compensationId = nextTx();
    forwardIds.push(forwardId);
    const target = parseCanonicalAbsolutePathText(join(created, "targets", `${slot}.json`));
    const content = encoder.encode(`{"slot":"${slot}"}\n`);
    const forward = await participants.stage({
      coordinatorId,
      id: forwardId,
      slot,
      role: { kind: "forward", compensationId },
      createdAt: CREATED_AT,
      mutations: [{ targetPath: target, operation: "create", expectedBeforeHash: null, content }],
    });
    const inverse = await participants.stage({
      coordinatorId,
      id: compensationId,
      slot,
      role: { kind: "compensation", forwardId },
      createdAt: CREATED_AT,
      mutations: [
        {
          targetPath: target,
          operation: "remove",
          expectedBeforeHash: digest(content),
          content: null,
        },
      ],
    });
    refs.push(forward, inverse);
  }
  const [markerId, artifactsId] = forwardIds;
  if (markerId === undefined || artifactsId === undefined) throw new Error("unreachable ids");
  const steps: readonly LifecycleCoordinatorStepV1[] = [
    { kind: "foundation", slot: "uninstall_marker", participantId: markerId },
    { kind: "drain_runners" },
    { kind: "foundation", slot: "uninstall_artifacts", participantId: artifactsId },
    { kind: "redaction_key", transition: "stage" },
    { kind: "manifest", transition: "preserve_before" },
    { kind: "manifest", transition: "commit_absence" },
    { kind: "redaction_key", transition: "delete" },
    { kind: "manifest", transition: "finalize_tombstones" },
  ];

  const base: SyntheticPlan = {
    schemaVersion: 1,
    id: coordinatorId,
    previewHash: null,
    operation: "uninstall",
    maximumJournalBytes: 1,
    authority: {
      productHome: home,
      configPath: parseCanonicalAbsolutePathText(join(created, "config.toml")),
      activationPath: parseCanonicalAbsolutePathText(
        join(created, "state", "lifecycle-activation.json"),
      ),
      manifestPath,
      repositoryRoot: null,
      plistPaths: [],
    },
    participants: {
      foundation: [...refs].sort((left, right) => (left.id < right.id ? -1 : 1)),
      manifest: { marker: "manifest" },
      sourceGitEffect: null,
      destinationGitEffect: null,
      launchdBeforeFiles: null,
      launchdAfterFiles: null,
      launchd: null,
      redactionKey: { marker: "redaction-key" },
    },
    push: null,
    steps,
  };
  const plan: SyntheticPlan = { ...base, maximumJournalBytes: maximumCoordinatorJournalBytes(base) };

  let uuidCounter = 0;
  const store = new LifecycleCoordinatorStore<SyntheticPlan>({
    fs,
    roots,
    executionPlanCodec: codecs.executionPlan,
    coordinatorJournalCodec: codecs.coordinatorJournal,
    uuid: () => {
      uuidCounter += 1;
      return `${uuidCounter.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
    },
    clock: () => CLOCK,
    locks: {
      acquire: async (text) => {
        await lockProvider.acquire(text);
        return { release: () => Promise.resolve() };
      },
    },
  });
  if (options.publish !== false) await store.publish(plan, global);

  const keyState = { value: "before" as "before" | "staged" | "deleted" };
  const manifestState = {
    value: "before" as "before" | "preimage_preserved" | "applied" | "compaction_pending",
  };
  const adapters: LifecycleParticipantAdaptersV1<SyntheticPlan> = {
    foundation: participants,
    manifest: {
      preserveBefore: () => {
        manifestState.value = "preimage_preserved";
        return Promise.resolve();
      },
      publishAfter: () => Promise.resolve(),
      commitAbsence: async () => {
        await nodeFs.rm(manifestPath, { force: true });
        manifestState.value = "applied";
      },
      finalizeTombstones: () => {
        manifestState.value = "compaction_pending";
        return Promise.resolve();
      },
      compensate: async () => {
        if ((await fs.lstat(manifestPath)) === null) {
          await nodeFs.writeFile(manifestPath, manifestBytes, { mode: 0o600 });
        }
        manifestState.value = "before";
      },
      observe: () => Promise.resolve(manifestState.value),
    },
    redactionKey: {
      stage: () => {
        keyState.value = "staged";
        return Promise.resolve();
      },
      delete: () => {
        keyState.value = "deleted";
        return Promise.resolve();
      },
      restore: () => {
        keyState.value = "before";
        return Promise.resolve();
      },
      observe: () => Promise.resolve(keyState.value),
    },
    sourceGitEffect: null,
    destinationGitEffect: null,
    launchdBeforeFiles: null,
    launchdAfterFiles: null,
    networkPush: null,
    drainRunners: {
      drain: async (_plan, held) => {
        await held.release();
        return { ...held, release: () => Promise.resolve() };
      },
    },
    controlFiles: {
      removeAllocator: async () => {
        await nodeFs.rm(join(created, "state", "lifecycle-id-allocator.json"), { force: true });
      },
      removeNonce: async () => {
        await nodeFs.rm(join(created, "state", "lifecycle-install-nonce"), { force: true });
      },
    },
  };

  const inspect = (): Promise<LifecycleLedgerSnapshotV1<SyntheticPlan>> =>
    inspectLifecycleLedger(
      {
        fs,
        effectiveUid: UID,
        executionPlanCodec: codecs.executionPlan,
        coordinatorJournalCodec: codecs.coordinatorJournal,
        variantFacts: () => UNINSTALL_FACTS,
        pushPlanHash: () => null,
        gitEffectPlanCodec: null,
        launchdEffectPlanCodec: null,
        residue: NO_RESIDUE,
        manifestBeforeHash: () => digest(manifestBytes),
        leasePaths: () => [],
      },
      roots,
    );

  const dependencies = (): Dependencies => ({
    store,
    fs,
    roots,
    foundationStore,
    adapters,
    variantFacts: () => UNINSTALL_FACTS,
    pushPlanHash: () => null,
    clock: () => CLOCK,
  });

  return {
    home,
    roots,
    fs,
    plan,
    global,
    foundationStore,
    dependencies,
    inspect,
    recovery: () => new LifecycleRecoveryService<SyntheticPlan>({ ...dependencies(), inspect }),
    execute: async () => {
      await new LifecycleCoordinator<SyntheticPlan>(dependencies()).execute(coordinatorId, global);
    },
    standalone: async (id) => {
      const target = join(created, "targets", `${id}.json`);
      await executor.execute({
        kind: "synthetic.standalone",
        mutations: [
          {
            targetPath: target,
            operation: "create",
            content: encoder.encode(`{"id":"${id}"}\n`),
          },
        ],
      });
    },
    standaloneNonTerminal: async (id) => {
      const transactionId = formatAllocatedLifecycleId("tx", NONCE, BigInt(800 + id.length));
      const journal: TransactionJournalV1 = {
        schemaVersion: 1,
        id: transactionId,
        kind: "synthetic.standalone",
        phase: "applied",
        createdAt: CREATED_AT,
        updatedAt: CLOCK,
        mutations: [
          {
            targetPath: join(created, "targets", `${id}.json`),
            operation: "create",
            expectedBeforeHash: null,
            stagedRelativePath: "0.bin",
          },
        ],
      };
      await nodeFs.writeFile(
        join(created, "state", "transactions", `${transactionId}.json`),
        encodeFoundationJournalJsonV1(journal),
        { mode: 0o600 },
      );
      return transactionId;
    },
    removeCoordinatorJournal: async () => {
      await nodeFs.rm(join(created, "state", "lifecycle-journals", `${coordinatorId}.json`));
      await nodeFs.rm(join(created, "state", "lifecycle-journals", `.${coordinatorId}.lock`), {
        force: true,
      });
    },
    plantUnknownLeaf: async () => {
      await nodeFs.writeFile(join(created, "state", "lifecycle-journals", "unknown.txt"), "", {
        mode: 0o600,
      });
    },
    exists: async (relative) =>
      (await fs.lstat(parseCanonicalAbsolutePathText(join(created, relative)))) !== null,
    allocatorCounter: async () => {
      const text = await nodeFs.readFile(
        join(created, "state", "lifecycle-id-allocator.json"),
        "utf8",
      );
      const parsed = JSON.parse(text) as { readonly nextCounter: string };
      return parsed.nextCounter;
    },
  };
}

describe("recovery policy refusals", () => {
  it("refuses a non-terminal uninstall coordinator with `developer-os uninstall` and touches nothing", async () => {
    const world = await recoveryWorld("recovery-uninstall-refusal");
    const before = await world.inspect();
    expect(before.coordinators.map((record) => record.state)).toStrictEqual(["active"]);

    const attempt = (): Promise<unknown> =>
      world.recovery().recover(world.global, { resumeUninstall: false });

    await expect(attempt()).rejects.toThrow(LifecycleRecoveryRefusalError);
    await expect(attempt()).rejects.toThrow(
      expect.objectContaining({
        reason: "lifecycle_uninstall_incomplete",
        code: EXIT_CODES.recoveryRequired,
        recovery: "developer-os uninstall",
      }),
    );
    expect(await world.exists("state/lifecycle-id-allocator.json")).toBe(true);
    expect((await world.inspect()).coordinators.map((record) => record.state)).toStrictEqual([
      "active",
    ]);
  }, 120_000);

  /**
   * A compacted uninstall has deliberately removed the allocator and the nonce, and the ledger
   * only admits that absence while the compacting envelope cursor is still on disk, so the one
   * residue an uninstall can end on is the missing allocator — never `clear`.
   */
  it("resumes the same coordinator and collects every leaf it owns", async () => {
    const world = await recoveryWorld("recovery-uninstall-resume");
    const { snapshot } = await world.recovery().recover(world.global, { resumeUninstall: true });

    expect(snapshot.coordinators).toStrictEqual([]);
    expect(snapshot.coordinatorOrphans).toStrictEqual([]);
    expect(snapshot.foundation.journals.size).toBe(0);
    expect(snapshot.findings.map((finding) => finding.reason)).toStrictEqual([
      "lifecycle_id_allocator_shape",
    ]);
    expect(await world.exists("state/.lifecycle.lock")).toBe(true);
    expect(await world.exists("targets/uninstall_marker.json")).toBe(true);
  }, 120_000);
});

describe("standalone Foundation journals", () => {
  it("compacts every terminal standalone transaction and the global lock survives", async () => {
    const world = await recoveryWorld("recovery-standalone-terminal", { publish: false });
    await world.standalone("alpha");
    const before = await world.inspect();
    expect(before.standaloneTerminalFoundation.length).toBeGreaterThan(0);

    const { snapshot } = await world.recovery().recover(world.global, { resumeUninstall: false });

    expect(snapshot.closure).toStrictEqual({ kind: "clear" });
    expect(snapshot.standaloneTerminalFoundation).toStrictEqual([]);
    expect(await world.exists("state/.lifecycle.lock")).toBe(true);
  }, 120_000);

  it("leaves the one journal the caller is resolving and still refuses a second", async () => {
    const world = await recoveryWorld("recovery-standalone-resolving", { publish: false });
    const first = await world.standaloneNonTerminal("beta");
    const opening = await world.inspect();
    expect(opening.standaloneNonTerminalFoundation.map((entry) => entry.id)).toStrictEqual([first]);

    const { snapshot } = await world
      .recovery()
      .recover(world.global, { resumeUninstall: false, standaloneFoundationId: first });
    expect(snapshot.standaloneNonTerminalFoundation.map((entry) => entry.id)).toStrictEqual([
      first,
    ]);

    const second = await world.standaloneNonTerminal("gamma");
    const attempt = (): Promise<unknown> =>
      world
        .recovery()
        .recover(world.global, { resumeUninstall: false, standaloneFoundationId: first });
    await expect(attempt()).rejects.toThrow(LifecycleRecoveryRefusalError);
    await expect(attempt()).rejects.toThrow(
      expect.objectContaining({
        reason: "lifecycle_standalone_transaction_incomplete",
        code: EXIT_CODES.recoveryRequired,
        recovery: `developer-os repair --resume ${second} or developer-os repair --rollback ${second}`,
      }),
    );
  }, 120_000);
});

describe("coordinator orphans", () => {
  it("removes a planless coordinator staging tree once every participant journal is absent", async () => {
    const world = await recoveryWorld("recovery-planless-staging", { publish: false });
    const opening = await world.inspect();
    expect(opening.coordinatorOrphans.map((orphan) => orphan.kind)).toStrictEqual([
      "planless_staging",
    ]);

    const { snapshot } = await world.recovery().recover(world.global, { resumeUninstall: false });

    expect(snapshot.coordinatorOrphans).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({ kind: "clear" });
    expect(await world.exists(`staging/lifecycle/${world.plan.id}`)).toBe(false);
  }, 120_000);

  it("removes a pre-journal coordinator plan orphan and the staging it owns", async () => {
    const world = await recoveryWorld("recovery-pre-journal-orphan");
    await world.removeCoordinatorJournal();
    const opening = await world.inspect();
    expect(opening.coordinators.map((record) => record.state)).toStrictEqual([
      "pre_journal_orphan",
    ]);

    const { snapshot } = await world.recovery().recover(world.global, { resumeUninstall: false });

    expect(snapshot.coordinators).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({ kind: "clear" });
    expect(await world.exists(`state/lifecycle-journals/${world.plan.id}.plan.json`)).toBe(false);
    expect(await world.exists("state/lifecycle-id-allocator.json")).toBe(true);
  }, 120_000);

  it("refuses on any ledger finding and deletes nothing", async () => {
    const world = await recoveryWorld("recovery-finding", { publish: false });
    await world.plantUnknownLeaf();

    const attempt = (): Promise<unknown> =>
      world.recovery().recover(world.global, { resumeUninstall: false });
    await expect(attempt()).rejects.toThrow(LifecycleRecoveryRefusalError);
    await expect(attempt()).rejects.toThrow(
      expect.objectContaining({
        reason: "lifecycle_ledger_finding",
        code: EXIT_CODES.recoveryRequired,
        recovery: "developer-os doctor",
      }),
    );
    expect(await world.exists("state/lifecycle-journals/unknown.txt")).toBe(true);
    expect(await world.allocatorCounter()).toBe("1000");
  }, 120_000);
});

describe("Foundation overflow recovery through the in-memory port", () => {
  const ROOT = parseCanonicalAbsolutePathText("/product");
  const ROOTS = deriveLifecycleLedgerRoots(ROOT);
  const MEMORY_DIRECTORIES = [
    "state",
    "state/transactions",
    "state/lifecycle-journals",
    "state/git-effect-journals",
    "state/launchd-effect-journals",
    "staging",
    "staging/transactions",
    "staging/lifecycle",
    "backups",
    "backups/transactions",
  ] as const;

  function journalOf(id: string, mutationCount: number): TransactionJournalV1 {
    return {
      schemaVersion: 1,
      id,
      kind: "synthetic.overflow",
      phase: "finalized",
      createdAt: CREATED_AT,
      updatedAt: CLOCK,
      mutations: Array.from({ length: mutationCount }, (_value, index) => ({
        targetPath: `/product/targets/${id}-${String(index)}.json`,
        operation: "create" as const,
        expectedBeforeHash: null,
        stagedRelativePath: `${String(index)}.bin`,
      })),
    };
  }

  async function overflowHome(options: {
    readonly mutationCounts: readonly number[];
    readonly staging: boolean;
    readonly nonTerminalAt?: number;
    /**
     * An allocated ID admits mutation indices `0..255`, so a staging inventory of 100,000 leaves
     * would need 800 ID directories; §2.4's legacy `tx_<uuid>` grammar carries the wider index
     * range that keeps the fixture's directory count — and the O(entries) enumeration it drives —
     * small enough to run inside the `suite` budget.
     */
    readonly legacyIds?: boolean;
  }): Promise<{
    readonly fs: ReturnType<typeof createInMemoryLifecycleGuardedFileSystem>;
    readonly recovery: LifecycleRecoveryService<SyntheticPlan>;
    readonly global: HeldLifecycleStableLockV1;
    inspect(): Promise<LifecycleLedgerSnapshotV1<SyntheticPlan>>;
  }> {
    const fs = createInMemoryLifecycleGuardedFileSystem({ effectiveUid: UID, root: ROOT });
    for (const relative of MEMORY_DIRECTORIES) {
      await fs.mkdirExclusive(parseCanonicalAbsolutePathText(`${ROOT}/${relative}`));
    }
    const lockPath = parseCanonicalAbsolutePathText(`${ROOT}/state/.lifecycle.lock`);
    const lock = await fs.writeExclusive(lockPath, new Uint8Array(0));
    await fs.writeExclusive(
      parseCanonicalAbsolutePathText(`${ROOT}/state/lifecycle-install-nonce`),
      encoder.encode(`${NONCE}\n`),
    );
    await fs.writeExclusive(
      parseCanonicalAbsolutePathText(`${ROOT}/state/lifecycle-id-allocator.json`),
      encoder.encode(
        encodeLifecycleIdAllocator({
          schemaVersion: 1,
          installNonce: NONCE,
          nextCounter: parseUInt64Decimal("100000"),
        }),
      ),
    );
    for (const [index, mutations] of options.mutationCounts.entries()) {
      const id =
        options.legacyIds === true
          ? `tx_${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`
          : formatAllocatedLifecycleId("tx", NONCE, BigInt(index + 1));
      const terminal = journalOf(id, mutations);
      const journal =
        options.nonTerminalAt === index ? { ...terminal, phase: "applied" as const } : terminal;
      await fs.writeExclusive(
        parseCanonicalAbsolutePathText(`${ROOT}/state/transactions/${id}.json`),
        encoder.encode(encodeFoundationJournalJsonV1(journal)),
      );
      if (!options.staging) continue;
      const directory = parseCanonicalAbsolutePathText(`${ROOT}/staging/transactions/${id}`);
      await fs.mkdirExclusive(directory);
      for (let mutation = 0; mutation < mutations; mutation += 1) {
        const payload = encoder.encode(`${id}-${String(mutation)}\n`);
        await fs.writeExclusive(
          parseCanonicalAbsolutePathText(`${directory}/${String(mutation)}.bin`),
          payload,
        );
        await fs.writeExclusive(
          parseCanonicalAbsolutePathText(`${directory}/${String(mutation)}.bin.sha256`),
          encoder.encode(`${digest(payload)}\n`),
        );
      }
    }
    const codecs = createLifecycleCodecs(LEAVES, { productHome: ROOT, nonce: NONCE });
    const global: HeldLifecycleStableLockV1 = {
      path: lockPath,
      dev: lock.dev,
      ino: lock.ino,
      release: () => Promise.resolve(),
    };
    const inspect = (): Promise<LifecycleLedgerSnapshotV1<SyntheticPlan>> =>
      inspectLifecycleLedger(
        {
          fs,
          effectiveUid: UID,
          executionPlanCodec: codecs.executionPlan,
          coordinatorJournalCodec: codecs.coordinatorJournal,
          variantFacts: () => UNINSTALL_FACTS,
          pushPlanHash: () => null,
          gitEffectPlanCodec: null,
          launchdEffectPlanCodec: null,
          residue: NO_RESIDUE,
          manifestBeforeHash: () => null,
          leasePaths: () => [],
        },
        ROOTS,
      );
    const store = new LifecycleCoordinatorStore<SyntheticPlan>({
      fs,
      roots: ROOTS,
      executionPlanCodec: codecs.executionPlan,
      coordinatorJournalCodec: codecs.coordinatorJournal,
      uuid: () => "00000001-0000-4000-8000-000000000000",
      clock: () => CLOCK,
      locks: { acquire: () => Promise.resolve({ release: () => Promise.resolve() }) },
    });
    const foundationStore = new TransactionStore({
      stateDir: `${ROOT}/state`,
      fs: nodeFs,
      lockProvider: { acquire: () => Promise.resolve({ release: () => Promise.resolve() }) },
    });
    const recovery = new LifecycleRecoveryService<SyntheticPlan>({
      store,
      fs,
      roots: ROOTS,
      foundationStore,
      adapters: {
        foundation: new FoundationParticipantExecutor({
          fs,
          roots: ROOTS,
          executor: undefined as never,
          effectiveUid: UID,
        }),
        manifest: null,
        redactionKey: null,
        sourceGitEffect: null,
        destinationGitEffect: null,
        launchdBeforeFiles: null,
        launchdAfterFiles: null,
        networkPush: null,
        drainRunners: null,
        controlFiles: {
          removeAllocator: () => Promise.resolve(),
          removeNonce: () => Promise.resolve(),
        },
      },
      variantFacts: () => UNINSTALL_FACTS,
      pushPlanHash: () => null,
      clock: () => CLOCK,
      inspect,
    });
    return { fs, recovery, global, inspect };
  }

  const single = (count: number): readonly number[] => Array.from({ length: count }, () => 1);

  async function reserveOne(home: {
    readonly fs: ReturnType<typeof createInMemoryLifecycleGuardedFileSystem>;
    readonly global: HeldLifecycleStableLockV1;
  }): Promise<number> {
    const block = await reserveLifecycleIdBlock(
      {
        fs: home.fs,
        stateDirectory: ROOTS.stateDirectory,
        effectiveUid: UID,
        uuid: () => "00000002-0000-4000-8000-000000000000",
        held: home.global,
        allocatedIds: [],
      },
      1,
    );
    return block.size;
  }

  it(
    "leaves a journal root of exactly 10,000 leaves alone and compacts 10,001 below the cap",
    async () => {
      const inside = await overflowHome({ mutationCounts: single(10_000), staging: false });
      expect((await inside.inspect()).foundation.overflow).toBe(false);

      const outside = await overflowHome({ mutationCounts: single(10_001), staging: false });
      expect((await outside.inspect()).foundation.overflow).toBe(true);

      const { snapshot } = await outside.recovery.recover(outside.global, {
        resumeUninstall: false,
      });
      expect(snapshot.foundation.counts.journalRoot).toBe(0);
      expect(snapshot.closure).toStrictEqual({ kind: "clear" });
      expect(await reserveOne(outside)).toBe(1);
    },
    600_000,
  );

  /**
   * A staging leaf count is `directories + 2 × staged mutations`, so the exact boundary needs an
   * odd factorisation: 32 × (1 + 2 × 1562) is 100,000 and 31 × 3125 + 2 × 1563 is 100,001.
   */
  it(
    "leaves Foundation staging of exactly 100,000 leaves alone and compacts 100,001 below the cap",
    async () => {
      const inside = await overflowHome({
        mutationCounts: Array.from({ length: 32 }, () => 1562),
        staging: true,
        legacyIds: true,
      });
      const opening = await inside.inspect();
      expect(opening.foundation.counts.staging).toBe(100_000);
      expect(opening.foundation.overflow).toBe(false);

      const outside = await overflowHome({
        mutationCounts: [...Array.from({ length: 31 }, () => 1562), 781, 781],
        staging: true,
        legacyIds: true,
      });
      const before = await outside.inspect();
      expect(before.foundation.counts.staging).toBe(100_001);
      expect(before.findings).toStrictEqual([]);
      expect(before.foundation.overflow).toBe(true);

      const { snapshot } = await outside.recovery.recover(outside.global, {
        resumeUninstall: false,
      });
      expect(snapshot.foundation.counts.staging).toBe(0);
      expect(snapshot.closure).toStrictEqual({ kind: "clear" });
      expect(await reserveOne(outside)).toBe(1);
    },
    600_000,
  );

  it(
    "refuses one non-terminal transaction inside an otherwise compactable overflow and deletes nothing",
    async () => {
      const home = await overflowHome({
        mutationCounts: single(10_001),
        staging: false,
        nonTerminalAt: 7,
      });
      const before = await home.inspect();
      expect(before.foundation.overflow).toBe(true);
      expect(before.standaloneNonTerminalFoundation.length).toBe(1);

      const attempt = (): Promise<unknown> =>
        home.recovery.recover(home.global, { resumeUninstall: false });
      await expect(attempt()).rejects.toThrow(LifecycleRecoveryRefusalError);
      await expect(attempt()).rejects.toThrow(
        expect.objectContaining({
          reason: "lifecycle_standalone_transaction_incomplete",
          code: EXIT_CODES.recoveryRequired,
        }),
      );

      const after = await home.inspect();
      expect(after.foundation.counts.journalRoot).toBe(before.foundation.counts.journalRoot);
      expect(after.allocator?.allocator.nextCounter).toBe("100000");
    },
    600_000,
  );
});
