import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "../result.js";
import { TransactionExecutor } from "../transactions/executor.js";
import { TransactionStore } from "../transactions/store.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseLowerHexSha256, parseUInt64Decimal } from "../update/scalars.js";
import { createLifecycleCodecs } from "./codecs.js";
import {
  LifecycleCoordinator,
  type LifecycleCoordinatorBoundaryV1,
  type LifecycleCoordinatorDependenciesV1,
  type LifecycleParticipantAdaptersV1,
} from "./coordinator.js";
import { compactTerminalCoordinator } from "./coordinator-compaction.js";
import { deriveLifecycleLedgerRoots, type LifecycleLedgerRootsV1 } from "./foundation-ledger.js";
import { FoundationParticipantExecutor } from "./foundation-participant.js";
import { deriveTerminalCompaction } from "./grammar.js";
import {
  createNodeLifecycleGuardedFileSystem,
  LifecycleRecoveryRequiredError,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import {
  formatAllocatedLifecycleId,
  parseAllocatedLifecycleId,
  parseLifecycleCoordinatorId,
  type AllocatedLifecycleIdV1,
} from "./ids.js";
import {
  inspectLifecycleLedger,
  type LifecycleCoordinatorRecordV1,
  type LifecycleLedgerSnapshotV1,
} from "./ledger.js";
import type { HeldLifecycleStableLockV1 } from "./locks.js";
import { encodeLifecycleIdAllocator } from "./records.js";
import { LifecycleCoordinatorStore, maximumCoordinatorJournalBytes } from "./store.js";
import {
  CLOCK,
  CREATED_AT,
  createLinkUnlinkRenameNoReplace,
  digest,
  encoder,
  FixtureLockProvider,
  LEAVES,
  NO_RESIDUE,
  PLAN_BYTE_CEILING,
  SyntheticDeath,
  type SyntheticPlan,
  UID,
  UNINSTALL_FACTS,
  useSyntheticLifecycleHomes,
} from "./testing.js";
import type {
  FoundationParticipantRefV1,
  LifecycleCoordinatorJournalV1,
  LifecycleCoordinatorStepV1,
} from "./types.js";

const NONCE = parseLowerHexSha256("5e".repeat(32));

const createSyntheticLifecycleHome = useSyntheticLifecycleHomes();

type Dependencies = LifecycleCoordinatorDependenciesV1<SyntheticPlan> & {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly foundationStore: TransactionStore;
};

interface UninstallWorldV1 {
  readonly home: CanonicalAbsolutePathV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly plan: SyntheticPlan;
  readonly global: HeldLifecycleStableLockV1;
  readonly removedControlFiles: string[];
  dependencies(afterBoundary?: (boundary: LifecycleCoordinatorBoundaryV1) => void): Dependencies;
  execute(): Promise<void>;
  inspect(): Promise<LifecycleLedgerSnapshotV1<SyntheticPlan>>;
  journal(): Promise<LifecycleCoordinatorJournalV1 | null>;
  exists(relative: string): Promise<boolean>;
}

/** `uninstall/present_manifest_without_launchd`: the one variant whose compaction carries the control-file suffix. */
async function uninstallWorld(
  label: string,
  options: { readonly failCommitAbsence?: boolean } = {},
): Promise<UninstallWorldV1> {
  const { created, home } = await createSyntheticLifecycleHome(label);
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
  const executor = new TransactionExecutor({
    stateDir: join(created, "state"),
    stagingDir: join(created, "staging"),
    backupsDir: join(created, "backups"),
    fs: nodeFs,
    clock: () => CLOCK,
    generateId: () => {
      throw new Error("the lifecycle participant bridge must not generate an ID");
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
  const steps: LifecycleCoordinatorStepV1[] = [];
  const slots = ["uninstall_marker", "uninstall_artifacts"] as const;
  const forwardIds: AllocatedLifecycleIdV1<"tx">[] = [];
  for (const slot of slots) {
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
  steps.push(
    { kind: "foundation", slot: "uninstall_marker", participantId: markerId },
    { kind: "drain_runners" },
    { kind: "foundation", slot: "uninstall_artifacts", participantId: artifactsId },
    { kind: "redaction_key", transition: "stage" },
    { kind: "manifest", transition: "preserve_before" },
    { kind: "manifest", transition: "commit_absence" },
    { kind: "redaction_key", transition: "delete" },
    { kind: "manifest", transition: "finalize_tombstones" },
  );

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
      redactionKey: { marker: "redaction-key", payloads: [] },
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
  await store.publish(plan, global);

  const removedControlFiles: string[] = [];
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
        if (options.failCommitAbsence === true) throw new SyntheticDeath("M(commit_absence)");
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
      removeAllocator: async (_plan, outcome) => {
        removedControlFiles.push(`allocator:${outcome}`);
        if (outcome === "rolled_back") return;
        await nodeFs.rm(join(created, "state", "lifecycle-id-allocator.json"), { force: true });
      },
      removeNonce: async (_plan, outcome) => {
        removedControlFiles.push(`nonce:${outcome}`);
        if (outcome === "rolled_back") return;
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

  const dependencies = (
    afterBoundary?: (boundary: LifecycleCoordinatorBoundaryV1) => void,
  ): Dependencies => ({
    store,
    fs,
    roots,
    foundationStore,
    adapters,
    variantFacts: () => UNINSTALL_FACTS,
    pushPlanHash: () => null,
    clock: () => CLOCK,
    ...(afterBoundary === undefined ? {} : { afterBoundary }),
  });

  return {
    home,
    roots,
    fs,
    plan,
    global,
    removedControlFiles,
    dependencies,
    execute: async () => {
      await new LifecycleCoordinator<SyntheticPlan>(dependencies()).execute(coordinatorId, global);
    },
    inspect,
    journal: async () => {
      const entry = await fs.lstat(
        parseCanonicalAbsolutePathText(
          join(created, "state", "lifecycle-journals", `${coordinatorId}.json`),
        ),
      );
      if (entry === null) return null;
      return codecs.coordinatorJournal.validate(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await fs.readRegular(entry, PLAN_BYTE_CEILING),
          ),
        ) as unknown,
      );
    },
    exists: async (relative) =>
      (await fs.lstat(parseCanonicalAbsolutePathText(join(created, relative)))) !== null,
  };
}

async function terminalRecord(
  world: UninstallWorldV1,
): Promise<LifecycleCoordinatorRecordV1<SyntheticPlan>> {
  const snapshot = await world.inspect();
  const [record] = snapshot.coordinators;
  if (record === undefined) throw new Error("no coordinator record");
  return record;
}

/**
 * A fully collected uninstall envelope has deliberately removed the allocator and the nonce, and
 * `admitsControlFileAbsence` only admits that absence while the compacting envelope cursor is
 * still on disk. Once the envelope is gone the ledger therefore reports the missing allocator —
 * `clear` is unreachable for a compacted uninstall, so the residue is asserted exactly.
 */
async function expectFullyCollected(world: UninstallWorldV1): Promise<void> {
  const snapshot = await world.inspect();
  expect(snapshot.coordinators).toStrictEqual([]);
  expect(snapshot.coordinatorOrphans).toStrictEqual([]);
  expect(snapshot.standaloneTerminalFoundation).toStrictEqual([]);
  expect(snapshot.foundation.journals.size).toBe(0);
  expect(snapshot.findings.map((finding) => finding.reason)).toStrictEqual([
    "lifecycle_id_allocator_shape",
  ]);
  expect(await world.exists("state/lifecycle-id-allocator.json")).toBe(false);
  expect(await world.exists("state/lifecycle-install-nonce")).toBe(false);
  expect(await world.exists("state/.lifecycle.lock")).toBe(true);
}

describe("terminal coordinator compaction", () => {
  it("derives its entries in the one order the spec fixes and advances one entry at a time", async () => {
    const world = await uninstallWorld("compaction-order");
    await world.execute();
    const entries = deriveTerminalCompaction(world.plan, "finalized").entries;
    expect(entries.length).toBeGreaterThan(0);

    const cursors: number[] = [];
    const removed: number[] = [];
    await compactTerminalCoordinator(
      {
        ...world.dependencies((boundary) => {
          if (boundary.kind === "compaction_entry_removed") removed.push(boundary.index);
          if (boundary.kind === "journal_rewritten") cursors.push(boundary.nextStep);
        }),
      },
      await terminalRecord(world),
      world.global,
    );

    expect(removed).toStrictEqual(entries.map((_entry, index) => index));
    expect(cursors.length).toBeGreaterThan(0);
    await expectFullyCollected(world);
  }, 120_000);

  it("removes the uninstall control files before the envelope, allocator first", async () => {
    const world = await uninstallWorld("compaction-control-files");
    await world.execute();
    const order: string[] = [];
    await compactTerminalCoordinator(
      world.dependencies((boundary) => {
        if (boundary.kind === "control_file_removed") order.push(boundary.file);
        if (boundary.kind === "envelope_leaf_removed") order.push(boundary.leaf);
      }),
      await terminalRecord(world),
      world.global,
    );

    expect(order).toStrictEqual(["allocator", "nonce", "journal", "lock", "plan"]);
    expect(world.removedControlFiles).toStrictEqual(["allocator:finalized", "nonce:finalized"]);
    expect(await world.exists("state/.lifecycle.lock")).toBe(true);
  }, 120_000);

  it("hands a rolled-back uninstall's terminal outcome to the control-file adapter (NEW-97)", async () => {
    const world = await uninstallWorld("compaction-rolled-back", { failCommitAbsence: true });
    await world.execute();
    expect((await world.journal())?.phase).toBe("rolled_back");

    await compactTerminalCoordinator(world.dependencies(), await terminalRecord(world), world.global);

    expect(world.removedControlFiles).toStrictEqual(["allocator:rolled_back", "nonce:rolled_back"]);
  }, 120_000);

  it("emits no control_file_removed boundary for a rolled-back uninstall that keeps its control files (NEW-122)", async () => {
    const world = await uninstallWorld("compaction-rolled-back-boundaries", { failCommitAbsence: true });
    await world.execute();
    expect((await world.journal())?.phase).toBe("rolled_back");

    const order: string[] = [];
    await compactTerminalCoordinator(
      world.dependencies((boundary) => {
        if (boundary.kind === "control_file_removed") order.push(boundary.file);
        if (boundary.kind === "envelope_leaf_removed") order.push(boundary.leaf);
      }),
      await terminalRecord(world),
      world.global,
    );

    expect(order).toStrictEqual(["journal", "lock", "plan"]);
    expect(await world.exists("state/lifecycle-id-allocator.json")).toBe(true);
    expect(await world.exists("state/lifecycle-install-nonce")).toBe(true);
  }, 120_000);

  it("accepts each entry's exact absence when it dies after the deletion and before the rewrite", async () => {
    const entryCount = deriveTerminalCompaction(
      (await uninstallWorld("compaction-count")).plan,
      "finalized",
    ).entries.length;
    expect(entryCount).toBeGreaterThan(0);

    for (let at = 0; at < entryCount; at += 1) {
      const world = await uninstallWorld(`compaction-death-${String(at)}`);
      await world.execute();
      await expect(
        compactTerminalCoordinator(
          world.dependencies((boundary) => {
            if (boundary.kind === "compaction_entry_removed" && boundary.index === at) {
              throw new SyntheticDeath(`entry ${String(at)}`);
            }
          }),
          await terminalRecord(world),
          world.global,
        ),
      ).rejects.toThrow(SyntheticDeath);

      const snapshot = await world.inspect();
      const record = snapshot.coordinators[0];
      if (record !== undefined) {
        expect(snapshot.findings).toStrictEqual([]);
        await compactTerminalCoordinator(world.dependencies(), record, world.global);
      }
      await expectFullyCollected(world);
    }
  }, 300_000);

  it("removes an empty uninstall `payloads` directory with the coordinator staging (NEW-210)", async () => {
    const world = await uninstallWorld("compaction-payloads-empty");
    await world.execute();
    await nodeFs.mkdir(join(world.home, "staging", "lifecycle", world.plan.id, "payloads"), {
      recursive: true,
      mode: 0o700,
    });
    const record = await terminalRecord(world);

    await compactTerminalCoordinator(world.dependencies(), record, world.global);

    expect(await world.exists(`staging/lifecycle/${world.plan.id}`)).toBe(false);
    await expectFullyCollected(world);
  }, 120_000);

  it("refuses a non-empty `payloads` directory and preserves the payload (NEW-210)", async () => {
    const world = await uninstallWorld("compaction-payloads-full");
    await world.execute();
    const payloads = join(world.home, "staging", "lifecycle", world.plan.id, "payloads");
    await nodeFs.mkdir(payloads, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(join(payloads, "0"), "payload\n", { mode: 0o600 });
    const record = await terminalRecord(world);

    await expect(compactTerminalCoordinator(world.dependencies(), record, world.global)).rejects.toThrow(
      expect.objectContaining({ reason: "lifecycle_guarded_not_empty" }),
    );

    expect(await nodeFs.readFile(join(payloads, "0"), "utf8")).toBe("payload\n");
  }, 120_000);

  it("refuses a non-empty `payloads` before it removes any other staging piece (NEW-210)", async () => {
    const world = await uninstallWorld("compaction-payloads-first");
    await world.execute();
    const staging = join(world.home, "staging", "lifecycle", world.plan.id);
    const foundation = join(staging, "foundation", world.plan.participants.foundation[0]?.id ?? "");
    const participants = join(staging, "participants");
    await nodeFs.mkdir(foundation, { recursive: true, mode: 0o700 });
    await nodeFs.mkdir(participants, { recursive: true, mode: 0o700 });
    await nodeFs.mkdir(join(staging, "payloads"), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(join(staging, "payloads", "0"), "payload\n", { mode: 0o600 });
    const record = await terminalRecord(world);

    await expect(compactTerminalCoordinator(world.dependencies(), record, world.global)).rejects.toThrow(
      expect.objectContaining({ reason: "lifecycle_guarded_not_empty" }),
    );

    expect((await nodeFs.stat(foundation)).isDirectory()).toBe(true);
    expect((await nodeFs.stat(participants)).isDirectory()).toBe(true);
    expect(await nodeFs.readFile(join(staging, "payloads", "0"), "utf8")).toBe("payload\n");
  }, 120_000);

  it("refuses a coordinator whose journal is not terminal and changes nothing", async () => {
    const world = await uninstallWorld("compaction-non-terminal");
    const record = await terminalRecord(world);
    await expect(
      compactTerminalCoordinator(world.dependencies(), record, world.global),
    ).rejects.toThrow(LifecycleRecoveryRequiredError);
    await expect(
      compactTerminalCoordinator(world.dependencies(), record, world.global),
    ).rejects.toThrow(
      expect.objectContaining({
        reason: "lifecycle_coordinator_not_terminal",
        code: EXIT_CODES.recoveryRequired,
      }),
    );
    expect(await world.exists("state/lifecycle-id-allocator.json")).toBe(true);
  }, 120_000);
});
