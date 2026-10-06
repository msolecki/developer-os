import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "../result.js";
import { TransactionConflictError, TransactionExecutor } from "../transactions/executor.js";
import { encodeFoundationJournalJsonV1, TransactionStore, validateJournal } from "../transactions/store.js";
import { compactTerminalCoordinator } from "./coordinator-compaction.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseLowerHexSha256, parseUInt64Decimal } from "../update/scalars.js";
import {
  LifecycleCoordinator,
  type LifecycleCoordinatorBoundaryV1,
  type LifecycleCoordinatorDependenciesV1,
  type LifecycleEffectAdapterV1,
  type LifecycleEffectStateV1,
  type LifecycleParticipantAdaptersV1,
} from "./coordinator.js";
import { createLifecycleCodecs } from "./codecs.js";
import {
  deriveLifecycleLedgerRoots,
  type LifecycleLedgerRootsV1,
} from "./foundation-ledger.js";
import { FoundationParticipantExecutor } from "./foundation-participant.js";
import {
  LIFECYCLE_POINT_OF_NO_RETURN,
  LIFECYCLE_STEP_GRAMMAR,
  validateLifecyclePlanGrammar,
  type LifecycleOperationVariantV1,
  type LifecycleStepTemplateV1,
  type LifecycleVariantFactsV1,
} from "./grammar.js";
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
  type GitEffectIdV1,
  type LaunchdEffectIdV1,
} from "./ids.js";
import { inspectLifecycleLedger, type LifecycleLedgerSnapshotV1 } from "./ledger.js";
import type { HeldLifecycleStableLockV1 } from "./locks.js";
import { encodeLifecycleIdAllocator } from "./records.js";
import { LifecycleRecoveryService } from "./recovery.js";
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
  type SyntheticPush,
  UID,
  useSyntheticLifecycleHomes,
} from "./testing.js";
import type {
  FoundationParticipantRefV1,
  LifecycleCoordinatorJournalV1,
  LifecycleCoordinatorStepV1,
  LifecycleEffectRefV1,
} from "./types.js";

const NONCE = parseLowerHexSha256("3d".repeat(32));

const createSyntheticLifecycleHome = useSyntheticLifecycleHomes();

const PUSH_PLAN_HASH = parseLowerHexSha256("ab".repeat(32));
const PUSH: SyntheticPush = { marker: "push", planHash: PUSH_PLAN_HASH };

/** Every variant's PONR reduced to the template index it selects, so the generator needs no plan. */
function templateBoundaryIndex(
  variant: LifecycleOperationVariantV1,
  templates: readonly LifecycleStepTemplateV1[],
): number {
  const boundary = LIFECYCLE_POINT_OF_NO_RETURN[variant];
  const index = templates.findIndex((template) => {
    switch (boundary.kind) {
      case "terminal_foundation":
        return template.kind === "F" && template.slot === boundary.slot;
      case "effect_verified":
        return template.kind === boundary.step;
      case "push_succeeded":
        return template.kind === "N";
      case "manifest_commit_absence":
        return template.kind === "M" && template.transition === "commit_absence";
    }
  });
  if (index < 0) throw new Error(`no point-of-no-return template for ${variant}`);
  return index;
}

function variantFactsOf(variant: LifecycleOperationVariantV1): LifecycleVariantFactsV1 {
  switch (variant) {
    case "git_sync/no_changes":
      return {
        gitSync: { newCommit: false, transport: "network", noChanges: true },
        automationReconcile: null,
        uninstallLaunchdEvidence: null,
      };
    case "git_sync/new_network":
      return {
        gitSync: { newCommit: true, transport: "network", noChanges: false },
        automationReconcile: null,
        uninstallLaunchdEvidence: null,
      };
    case "git_sync/existing_network":
      return {
        gitSync: { newCommit: false, transport: "network", noChanges: false },
        automationReconcile: null,
        uninstallLaunchdEvidence: null,
      };
    case "git_sync/new_local":
      return {
        gitSync: { newCommit: true, transport: "local", noChanges: false },
        automationReconcile: null,
        uninstallLaunchdEvidence: null,
      };
    case "git_sync/existing_local":
      return {
        gitSync: { newCommit: false, transport: "local", noChanges: false },
        automationReconcile: null,
        uninstallLaunchdEvidence: null,
      };
    case "automation_reconcile/files":
      return { gitSync: null, automationReconcile: "files", uninstallLaunchdEvidence: null };
    case "automation_reconcile/live_only":
      return { gitSync: null, automationReconcile: "live_only", uninstallLaunchdEvidence: null };
    case "uninstall/present_manifest":
      return { gitSync: null, automationReconcile: null, uninstallLaunchdEvidence: true };
    case "uninstall/present_manifest_without_launchd":
      return { gitSync: null, automationReconcile: null, uninstallLaunchdEvidence: false };
    default:
      return { gitSync: null, automationReconcile: null, uninstallLaunchdEvidence: null };
  }
}

const LAUNCHD_PLAN_VARIANTS: ReadonlySet<LifecycleOperationVariantV1> = new Set([
  "automation_enable",
  "automation_reconcile/files",
  "automation_reconcile/live_only",
  "automation_disable",
  "uninstall/present_manifest",
]);

interface ParticipantLabelsV1 {
  readonly step: LifecycleCoordinatorStepV1;
  readonly label: string;
}

function stepLabel(step: LifecycleCoordinatorStepV1): string {
  switch (step.kind) {
    case "foundation":
      return `F(${step.slot})`;
    case "manifest":
      return `M(${step.transition})`;
    case "source_git_effect":
      return "S";
    case "destination_git_effect":
      return "D";
    case "launchd_before_files":
      return "P";
    case "launchd_after_files":
      return "Q";
    case "redaction_key":
      return `K(${step.transition})`;
    case "network_push":
      return "N";
    case "drain_runners":
      return "R";
  }
}

function compensationLabel(step: LifecycleCoordinatorStepV1): string | null {
  switch (step.kind) {
    case "foundation":
      return `F(${step.slot})^-1`;
    case "manifest":
      return `M(${step.transition})^-1`;
    case "source_git_effect":
      return "S^-1";
    case "destination_git_effect":
      return "D^-1";
    case "launchd_before_files":
      return "P^-1";
    case "launchd_after_files":
      return "Q^-1";
    case "redaction_key":
      return step.transition === "stage" ? "K(restore)" : "K(delete)^-1";
    case "network_push":
      return "N^-1";
    case "drain_runners":
      return null;
  }
}

interface RecordedCallV1 {
  readonly label: string;
  readonly journaled: boolean;
}

interface WorldV1 {
  readonly variant: LifecycleOperationVariantV1;
  readonly home: CanonicalAbsolutePathV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly plan: SyntheticPlan;
  readonly steps: readonly ParticipantLabelsV1[];
  readonly boundaryIndex: number;
  global: HeldLifecycleStableLockV1;
  readonly calls: readonly RecordedCallV1[];
  readonly reacquired: HeldLifecycleStableLockV1[];
  readonly hookCalls: string[];
  pushOutcome: "succeeded" | "failed";
  readonly pushAttempts: () => number;
  dependencies(options?: WorldOptionsV1): CoordinatorDependenciesV1;
  execute(options?: WorldOptionsV1): Promise<{
    readonly outcome: Awaited<ReturnType<LifecycleCoordinator<SyntheticPlan>["execute"]>>["outcome"];
    readonly global: HeldLifecycleStableLockV1;
  }>;
  recover(policy?: { resumeUninstall?: boolean }): Promise<LifecycleLedgerSnapshotV1<SyntheticPlan>>;
  inspect(): Promise<LifecycleLedgerSnapshotV1<SyntheticPlan>>;
  terminalState(): Promise<Readonly<Record<string, string>>>;
  expectedAfter(crossed: boolean): Promise<Readonly<Record<string, string>>>;
  compensationOrder(): readonly string[];
  unjournaledMutations(): readonly string[];
  journal(): Promise<LifecycleCoordinatorJournalV1 | null>;
}

type CoordinatorDependenciesV1 = LifecycleCoordinatorDependenciesV1<SyntheticPlan> & {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly foundationStore: TransactionStore;
};

interface WorldOptionsV1 {
  readonly afterBoundary?: (boundary: LifecycleCoordinatorBoundaryV1) => void | Promise<void>;
  readonly failAt?: string;
  /** A Foundation step label whose real executor throws once at `apply`, its journal `validated`. */
  readonly failFoundationApplyAt?: string;
  /** With `failFoundationApplyAt`, the executor's rollback of that participant then conflicts. */
  readonly failFoundationRollback?: boolean;
  readonly pushOutcome?: "succeeded" | "failed";
  readonly stepHooks?: LifecycleParticipantAdaptersV1<SyntheticPlan>["stepHooks"];
}

const DEFAULT_TIMEOUT_MS = 120_000;

async function syntheticWorld(
  variant: LifecycleOperationVariantV1,
  options: {
    readonly pushOutcome?: "succeeded" | "failed";
    readonly artifactSteps?: number;
    /** Allocates each compensation ID before its forward's, so compaction meets the inverse first. */
    readonly inverseIdFirst?: boolean;
  } = {},
): Promise<WorldV1> {
  const { created, home } = await createSyntheticLifecycleHome("coordinator");
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
  let global: HeldLifecycleStableLockV1 = {
    path: lockPath,
    dev: parseUInt64Decimal(lockStats.dev.toString(10)),
    ino: parseUInt64Decimal(lockStats.ino.toString(10)),
    release: () => Promise.resolve(),
  };
  const reacquired: HeldLifecycleStableLockV1[] = [];

  const lockProvider = new FixtureLockProvider();
  const applyFailure: { value: FoundationParticipantRefV1 | null; applied: boolean; rollback: boolean } = {
    value: null,
    applied: false,
    rollback: false,
  };
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
    guards: {
      /**
       * The executor asserts a target at backup, validate, apply and restore; only the one taken
       * while the participant's own journal reads `validated` is the apply.
       */
      assertTarget: async (target) => {
        const failing = applyFailure.value;
        if (failing === null || target !== failing.mutations[0]?.targetPath) return;
        const journal = JSON.parse(await nodeFs.readFile(failing.initialJournal.finalPath, "utf8")) as {
          readonly phase: string;
        };
        if (journal.phase !== "validated") return;
        if (applyFailure.applied) {
          applyFailure.value = null;
          if (applyFailure.rollback) throw new TransactionConflictError();
          return;
        }
        applyFailure.applied = true;
        if (!applyFailure.rollback) applyFailure.value = null;
        throw new SyntheticDeath(`apply ${failing.id}`);
      },
      redactDiagnostic: (text) => text,
    },
    lockProvider,
    publishBootstrapInitialJournalNoReplace: (request) => publisher.publish(request),
  });
  const participants = new FoundationParticipantExecutor({
    fs,
    roots,
    executor,
    effectiveUid: UID,
  });

  let counter = 512n;
  const nextId = <P extends "tx" | "ge" | "le" | "mf">(prefix: P): AllocatedLifecycleIdV1<P> => {
    counter += 1n;
    return parseAllocatedLifecycleId(prefix, formatAllocatedLifecycleId(prefix, NONCE, counter), NONCE);
  };
  const coordinatorId = parseLifecycleCoordinatorId(
    formatAllocatedLifecycleId("lc", NONCE, counter),
    NONCE,
  );

  /** D45: the row's one `F(uninstall_artifacts)` repeated in place, as a chunked uninstall plans it. */
  const artifactSteps = options.artifactSteps ?? 1;
  const templates = LIFECYCLE_STEP_GRAMMAR[variant].flatMap((template) =>
    template.kind === "F" && template.slot === "uninstall_artifacts"
      ? Array.from({ length: artifactSteps }, () => template)
      : [template],
  );
  const boundaryIndex = templateBoundaryIndex(variant, templates);

  const manifestPath = parseCanonicalAbsolutePathText(join(created, "state", "installation.json"));
  const manifestBytes = encoder.encode('{"synthetic":"manifest"}\n');
  await nodeFs.writeFile(manifestPath, manifestBytes, { mode: 0o600 });

  const steps: LifecycleCoordinatorStepV1[] = [];
  const refs: FoundationParticipantRefV1[] = [];
  const targets: CanonicalAbsolutePathV1[] = [];
  let sourceGitEffect: LifecycleEffectRefV1<GitEffectIdV1> | null = null;
  let destinationGitEffect: LifecycleEffectRefV1<GitEffectIdV1> | null = null;
  let launchdBeforeFiles: LifecycleEffectRefV1<LaunchdEffectIdV1> | null = null;
  let launchdAfterFiles: LifecycleEffectRefV1<LaunchdEffectIdV1> | null = null;

  for (const [index, template] of templates.entries()) {
    switch (template.kind) {
      case "F": {
        const reversible = index < boundaryIndex;
        const early = reversible && options.inverseIdFirst === true ? nextId("tx") : null;
        const forwardId = nextId("tx");
        const compensationId = reversible ? (early ?? nextId("tx")) : null;
        const repeat = steps.filter(
          (step) => step.kind === "foundation" && step.slot === template.slot,
        ).length;
        const target = parseCanonicalAbsolutePathText(
          join(created, "targets", repeat === 0 ? `${template.slot}.json` : `${template.slot}-${String(repeat)}.json`),
        );
        targets.push(target);
        const content = encoder.encode(`{"slot":"${template.slot}"}\n`);
        const forward = await participants.stage({
          coordinatorId,
          id: forwardId,
          slot: template.slot,
          role: { kind: "forward", compensationId },
          createdAt: CREATED_AT,
          mutations: [
            { targetPath: target, operation: "create", expectedBeforeHash: null, content },
          ],
        });
        refs.push(forward);
        if (compensationId !== null) {
          refs.push(
            await participants.stage({
              coordinatorId,
              id: compensationId,
              slot: template.slot,
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
            }),
          );
        }
        steps.push({ kind: "foundation", slot: template.slot, participantId: forwardId });
        break;
      }
      case "M":
        steps.push({ kind: "manifest", transition: template.transition });
        break;
      case "K":
        steps.push({ kind: "redaction_key", transition: template.transition });
        break;
      case "S": {
        sourceGitEffect = { id: nextId("ge"), planHash: parseLowerHexSha256("1c".repeat(32)) };
        steps.push({ kind: "source_git_effect", participantId: sourceGitEffect.id });
        break;
      }
      case "D": {
        destinationGitEffect = { id: nextId("ge"), planHash: parseLowerHexSha256("2c".repeat(32)) };
        steps.push({
          kind: "destination_git_effect",
          participantId: destinationGitEffect.id,
          pushPlanHash: PUSH_PLAN_HASH,
        });
        break;
      }
      case "P": {
        launchdBeforeFiles = { id: nextId("le"), planHash: parseLowerHexSha256("3c".repeat(32)) };
        steps.push({ kind: "launchd_before_files", participantId: launchdBeforeFiles.id });
        break;
      }
      case "Q": {
        launchdAfterFiles = { id: nextId("le"), planHash: parseLowerHexSha256("4c".repeat(32)) };
        steps.push({ kind: "launchd_after_files", participantId: launchdAfterFiles.id });
        break;
      }
      case "N":
        steps.push({ kind: "network_push", pushPlanHash: PUSH_PLAN_HASH });
        break;
      case "R":
        steps.push({ kind: "drain_runners" });
        break;
    }
  }

  const hasManifest = templates.some((template) => template.kind === "M");
  const hasKey = templates.some((template) => template.kind === "K");
  const hasPush = templates.some(
    (template) => template.kind === "N" || template.kind === "D",
  );
  const plistPaths =
    variant === "automation_reconcile/files"
      ? [parseCanonicalAbsolutePathText(join(created, "targets", "job.plist"))]
      : [];

  const base: SyntheticPlan = {
    schemaVersion: 1,
    id: coordinatorId,
    previewHash: null,
    operation: variant.split("/")[0] as SyntheticPlan["operation"],
    maximumJournalBytes: 1,
    authority: {
      productHome: home,
      configPath: parseCanonicalAbsolutePathText(join(created, "config.toml")),
      activationPath: parseCanonicalAbsolutePathText(
        join(created, "state", "lifecycle-activation.json"),
      ),
      manifestPath,
      repositoryRoot: null,
      plistPaths,
    },
    participants: {
      foundation: [...refs].sort((left, right) => (left.id < right.id ? -1 : 1)),
      manifest: hasManifest ? { marker: "manifest" } : null,
      sourceGitEffect,
      destinationGitEffect,
      launchdBeforeFiles,
      launchdAfterFiles,
      launchd: LAUNCHD_PLAN_VARIANTS.has(variant) ? { marker: "launchd" } : null,
      redactionKey: hasKey ? { marker: "redaction-key" } : null,
    },
    push: hasPush ? PUSH : null,
    steps,
  };
  const plan: SyntheticPlan = { ...base, maximumJournalBytes: maximumCoordinatorJournalBytes(base) };

  const store = new LifecycleCoordinatorStore<SyntheticPlan>({
    fs,
    roots,
    executionPlanCodec: codecs.executionPlan,
    coordinatorJournalCodec: codecs.coordinatorJournal,
    uuid: uuidFactory(),
    clock: () => CLOCK,
    locks: {
      acquire: async (text) => {
        await lockProvider.acquire(text);
        return { release: () => Promise.resolve() };
      },
    },
  });
  await store.publish(plan, global);

  const calls: RecordedCallV1[] = [];
  const hookCalls: string[] = [];
  const events: LifecycleCoordinatorBoundaryV1[] = [];

  const readJournal = async (): Promise<LifecycleCoordinatorJournalV1 | null> => {
    const path = parseCanonicalAbsolutePathText(
      join(created, "state", "lifecycle-journals", `${coordinatorId}.json`),
    );
    const entry = await fs.lstat(path);
    if (entry === null) return null;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      await fs.readRegular(entry, PLAN_BYTE_CEILING),
    );
    return codecs.coordinatorJournal.validate(JSON.parse(text) as unknown);
  };

  /**
   * A boundary crossing finalizes every earlier verified effect while the cursor still points at
   * the boundary step, so a finalize is journaled by a cursor at or past its own step rather than
   * exactly on it.
   */
  const record = async (
    label: string,
    index: number,
    direction: "forward" | "finalize" | "compensation",
  ) => {
    const journal = await readJournal();
    const forward =
      journal !== null && journal.phase !== "compensating" && journal.phase !== "rolled_back";
    const journaled =
      journal !== null &&
      (direction === "compensation"
        ? journal.phase === "compensating" && journal.compensationNext === index
        : direction === "finalize"
          ? forward && journal.nextStep >= index
          : forward && journal.nextStep === index);
    calls.push({ label, journaled });
  };

  const manifestState = { value: "before" as "before" | "preimage_preserved" | "applied" | "compaction_pending" };
  const keyState = { value: "before" as "before" | "staged" | "deleted" };
  const pushState = { value: "none" as "none" | "succeeded" | "failed" };
  const pushChoice: { value: "succeeded" | "failed" } = {
    value: options.pushOutcome ?? "succeeded",
  };
  let pushAttempts = 0;
  const effects = new Map<string, { state: LifecycleEffectStateV1 }>();

  const indexOfLabel = (label: string): number =>
    steps.findIndex((step) => stepLabel(step) === label);

  /**
   * A compensation call carries no index of its own, so the journal's reverse cursor is what says
   * which step authorized it — and that it is a step of the kind the adapter belongs to.
   */
  const recordCompensation = async (
    kind: LifecycleCoordinatorStepV1["kind"],
    label: string,
  ): Promise<void> => {
    const journal = await readJournal();
    if (journal === null) {
      calls.push({ label, journaled: false });
      return;
    }
    const cursor =
      journal.phase === "compensating" ? (journal.compensationNext ?? -1) : journal.nextStep;
    const step = cursor >= 0 ? steps[cursor] : undefined;
    calls.push({ label, journaled: step !== undefined && step.kind === kind });
  };

  const effectAdapterFor = (
    label: string,
    ref: LifecycleEffectRefV1<string> | null,
  ): LifecycleEffectAdapterV1 | null => {
    if (ref === null) return null;
    effects.set(label, { state: "future" });
    const slot = effects.get(label);
    if (slot === undefined) throw new Error("unreachable effect slot");
    const index = indexOfLabel(label);
    const stepKind = steps[index]?.kind;
    if (stepKind === undefined) throw new Error(`no step for effect ${label}`);
    return {
      apply: async () => {
        await record(label, index, "forward");
        slot.state = "verified";
      },
      finalize: async () => {
        await record(`${label}!`, index, "finalize");
        slot.state = "finalized";
      },
      compensate: async () => {
        await recordCompensation(stepKind, `${label}^-1`);
        slot.state = "rolled_back";
      },
      observe: () => Promise.resolve(slot.state),
      compact: () => Promise.resolve(),
    };
  };

  const adapters: LifecycleParticipantAdaptersV1<SyntheticPlan> = {
    foundation: participants,
    manifest: hasManifest
      ? {
          preserveBefore: async () => {
            await record("M(preserve_before)", indexOfLabel("M(preserve_before)"), "forward");
            manifestState.value = "preimage_preserved";
          },
          publishAfter: async () => {
            await record("M(publish_after)", indexOfLabel("M(publish_after)"), "forward");
            manifestState.value = "applied";
          },
          commitAbsence: async () => {
            await record("M(commit_absence)", indexOfLabel("M(commit_absence)"), "forward");
            await nodeFs.rm(manifestPath, { force: true });
            manifestState.value = "applied";
          },
          finalizeTombstones: async () => {
            await record("M(finalize_tombstones)", indexOfLabel("M(finalize_tombstones)"), "forward");
            manifestState.value = "compaction_pending";
          },
          compensate: async () => {
            await recordCompensation("manifest", "M^-1");
            if ((await fs.lstat(manifestPath)) === null) {
              await nodeFs.writeFile(manifestPath, manifestBytes, { mode: 0o600 });
            }
            manifestState.value = "before";
          },
          observe: () => Promise.resolve(manifestState.value),
        }
      : null,
    redactionKey: hasKey
      ? {
          stage: async () => {
            await record("K(stage)", indexOfLabel("K(stage)"), "forward");
            keyState.value = "staged";
          },
          delete: async () => {
            await record("K(delete)", indexOfLabel("K(delete)"), "forward");
            keyState.value = "deleted";
          },
          restore: async () => {
            await recordCompensation("redaction_key", "K(restore)");
            keyState.value = "before";
          },
          observe: () => Promise.resolve(keyState.value),
        }
      : null,
    sourceGitEffect: effectAdapterFor("S", sourceGitEffect),
    destinationGitEffect: effectAdapterFor("D", destinationGitEffect),
    launchdBeforeFiles: effectAdapterFor("P", launchdBeforeFiles),
    launchdAfterFiles: effectAdapterFor("Q", launchdAfterFiles),
    networkPush: hasPush && templates.some((template) => template.kind === "N")
      ? {
          push: async () => {
            pushAttempts += 1;
            await record("N", indexOfLabel("N"), "forward");
            pushState.value = pushChoice.value;
            return pushChoice.value;
          },
        }
      : null,
    drainRunners: templates.some((template) => template.kind === "R")
      ? {
          drain: async (_plan, held) => {
            await record("R", indexOfLabel("R"), "forward");
            await held.release();
            const next: HeldLifecycleStableLockV1 = { ...held, release: () => Promise.resolve() };
            reacquired.push(next);
            return next;
          },
        }
      : null,
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
        variantFacts: () => variantFactsOf(variant),
        pushPlanHash: (value) => (value.push === null ? null : value.push.planHash),
        gitEffectPlanCodec: null,
        launchdEffectPlanCodec: null,
        residue: NO_RESIDUE,
        manifestBeforeHash: () => digest(manifestBytes),
        leasePaths: () => [],
      },
      roots,
    );

  const dependencies = (worldOptions: WorldOptionsV1 = {}): CoordinatorDependenciesV1 => {
    const failing = worldOptions.failAt;
    const failingApply = worldOptions.failFoundationApplyAt;
    if (failingApply !== undefined) {
      const step = steps.find((candidate) => stepLabel(candidate) === failingApply);
      if (step?.kind !== "foundation") throw new Error(`no Foundation step labelled ${failingApply}`);
      applyFailure.value = refs.find((ref) => ref.id === step.participantId) ?? null;
      applyFailure.applied = false;
      applyFailure.rollback = worldOptions.failFoundationRollback === true;
    }
    const wrapped: LifecycleParticipantAdaptersV1<SyntheticPlan> =
      failing === undefined
        ? adapters
        : failingAdapters(adapters, failing, steps);
    return {
      store,
      fs,
      roots,
      foundationStore,
      adapters: {
        ...wrapped,
        ...(worldOptions.stepHooks === undefined ? {} : { stepHooks: worldOptions.stepHooks }),
      },
      variantFacts: () => variantFactsOf(variant),
      pushPlanHash: (value) => (value.push === null ? null : value.push.planHash),
      clock: () => CLOCK,
      afterBoundary: async (boundary) => {
        events.push(boundary);
        await worldOptions.afterBoundary?.(boundary);
      },
    };
  };

  const world: WorldV1 = {
    variant,
    home,
    roots,
    fs,
    plan,
    steps: steps.map((step) => ({ step, label: stepLabel(step) })),
    boundaryIndex,
    get global() {
      return global;
    },
    set global(next: HeldLifecycleStableLockV1) {
      global = next;
    },
    calls,
    reacquired,
    hookCalls,
    get pushOutcome() {
      return pushChoice.value;
    },
    set pushOutcome(next: "succeeded" | "failed") {
      pushChoice.value = next;
    },
    pushAttempts: () => pushAttempts,
    dependencies,
    execute: async (worldOptions = {}) => {
      const result = await new LifecycleCoordinator<SyntheticPlan>(
        dependencies(worldOptions),
      ).execute(coordinatorId, global);
      global = result.global;
      return result;
    },
    recover: async (policy = {}) => {
      const service = new LifecycleRecoveryService<SyntheticPlan>({
        ...dependencies(),
        inspect,
      });
      const result = await service.recover(global, {
        resumeUninstall: policy.resumeUninstall ?? true,
      });
      global = result.global;
      return result.snapshot;
    },
    inspect,
    journal: readJournal,
    terminalState: async () => {
      const state: Record<string, string> = {
        manifest: (await fs.lstat(manifestPath)) === null ? "absent" : "present",
        redactionKey: keyState.value,
      };
      for (const target of targets) {
        state[target.slice(home.length)] = (await fs.lstat(target)) === null ? "absent" : "present";
      }
      for (const [label, slot] of effects) state[label] = slot.state;
      return state;
    },
    expectedAfter: (crossed) => {
      const removesManifest = templates.some(
        (template) => template.kind === "M" && template.transition === "commit_absence",
      );
      const state: Record<string, string> = {
        manifest: crossed && removesManifest ? "absent" : "present",
        redactionKey: hasKey && crossed ? "deleted" : "before",
      };
      for (const target of targets) {
        state[target.slice(home.length)] = crossed ? "present" : "absent";
      }
      for (const label of effects.keys()) {
        const started = calls.some((call) => call.label === label);
        state[label] = crossed ? "finalized" : started ? "rolled_back" : "future";
      }
      return Promise.resolve(state);
    },
    compensationOrder: () => {
      const order: string[] = [];
      for (const event of events) {
        if (event.kind !== "participant_returned" || event.direction !== "compensation") continue;
        const step = steps[event.step];
        const label = step === undefined ? null : compensationLabel(step);
        if (label !== null) order.push(label);
      }
      return order;
    },
    unjournaledMutations: () =>
      calls.filter((call) => !call.journaled).map((call) => call.label),
  };
  return world;
}

function uuidFactory(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${counter.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
  };
}

function failingAdapters(
  adapters: LifecycleParticipantAdaptersV1<SyntheticPlan>,
  failAt: string,
  steps: readonly LifecycleCoordinatorStepV1[],
): LifecycleParticipantAdaptersV1<SyntheticPlan> {
  const index = steps.findIndex((step) => stepLabel(step) === failAt);
  if (index < 0) throw new Error(`no step labelled ${failAt}`);
  const step = steps[index];
  if (step === undefined) throw new Error("unreachable step");
  const boom = (): never => {
    throw new SyntheticDeath(failAt);
  };
  if (step.kind === "manifest" && adapters.manifest !== null) {
    const manifest = adapters.manifest;
    const transition = step.transition;
    return {
      ...adapters,
      manifest: {
        ...manifest,
        preserveBefore: (value) =>
          transition === "preserve_before" ? boom() : manifest.preserveBefore(value),
        publishAfter: (value) =>
          transition === "publish_after" ? boom() : manifest.publishAfter(value),
        commitAbsence: (value) =>
          transition === "commit_absence" ? boom() : manifest.commitAbsence(value),
        finalizeTombstones: (value) =>
          transition === "finalize_tombstones" ? boom() : manifest.finalizeTombstones(value),
      },
    };
  }
  if (step.kind === "redaction_key" && adapters.redactionKey !== null) {
    const key = adapters.redactionKey;
    const transition = step.transition;
    return {
      ...adapters,
      redactionKey: {
        ...key,
        stage: (value) => (transition === "stage" ? boom() : key.stage(value)),
        delete: (value) => (transition === "delete" ? boom() : key.delete(value)),
      },
    };
  }
  if (step.kind === "destination_git_effect" && adapters.destinationGitEffect !== null) {
    return {
      ...adapters,
      destinationGitEffect: { ...adapters.destinationGitEffect, apply: boom },
    };
  }
  if (step.kind === "source_git_effect" && adapters.sourceGitEffect !== null) {
    return { ...adapters, sourceGitEffect: { ...adapters.sourceGitEffect, apply: boom } };
  }
  throw new Error(`failAt ${failAt} is not a supported synthetic failure point`);
}

const VARIANTS = Object.keys(LIFECYCLE_STEP_GRAMMAR) as LifecycleOperationVariantV1[];

describe("the synthetic coordinator plan generator", () => {
  it("covers every variant of the closed step grammar", () => {
    expect(VARIANTS.length).toBe(14);
  });

  it.each(VARIANTS)("builds a grammar-valid %s plan", async (variant) => {
    const world = await syntheticWorld(variant);
    expect(validateLifecyclePlanGrammar(world.plan, variantFactsOf(variant))).toBe(variant);
    const snapshot = await world.inspect();
    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinators.map((record) => record.state)).toStrictEqual(["active"]);
  }, DEFAULT_TIMEOUT_MS);
});

describe("coordinator execution", () => {
  it.each(VARIANTS)(
    "drives %s to a finalized terminal outcome with every mutation journaled",
    async (variant) => {
      const world = await syntheticWorld(variant);
      const { outcome } = await world.execute();

      expect(outcome).toStrictEqual({ kind: "finalized", id: world.plan.id });
      expect(world.unjournaledMutations()).toStrictEqual([]);
      const journal = await world.journal();
      expect(journal?.phase).toBe("finalized");
      expect(journal?.nextStep).toBe(world.plan.steps.length);
    },
    DEFAULT_TIMEOUT_MS,
  );

  /**
   * A compacted uninstall has removed the allocator and the nonce on purpose, and the ledger
   * admits that absence only while the compacting envelope cursor is still on disk, so `clear` is
   * unreachable once recovery finishes one: its exact residue is asserted instead.
   */
  async function expectRecovered(world: WorldV1): Promise<void> {
    const snapshot = await world.recover();
    expect(snapshot.coordinators).toStrictEqual([]);
    expect(snapshot.coordinatorOrphans).toStrictEqual([]);
    expect(snapshot.foundation.journals.size).toBe(0);
    if (world.plan.operation === "uninstall") {
      expect(snapshot.findings.map((finding) => finding.reason)).toStrictEqual([
        "lifecycle_id_allocator_shape",
      ]);
      return;
    }
    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({ kind: "clear" });
  }

  it.each(VARIANTS)(
    "recovers %s from death at every boundary to the direction its point of no return selects",
    (variant) => recoversFromEveryBoundary(variant),
    600_000,
  );

  /**
   * D45: across a run of artifact steps the forward cursor advances step by step and the reverse
   * cursor walks back through every one of them, so a death anywhere in the run must still route
   * to the direction the single boundary selects.
   */
  it.each(["uninstall/present_manifest", "uninstall/present_manifest_without_launchd"] as const)(
    "recovers %s with three artifact steps from death at every boundary (D45)",
    (variant) => recoversFromEveryBoundary(variant, 3),
    600_000,
  );

  async function recoversFromEveryBoundary(
    variant: LifecycleOperationVariantV1,
    artifactSteps = 1,
  ): Promise<void> {
    const reference = await syntheticWorld(variant, { artifactSteps });
    const boundaries: LifecycleCoordinatorBoundaryV1[] = [];
    await reference.execute({ afterBoundary: (boundary) => void boundaries.push(boundary) });
    expect(boundaries.length).toBeGreaterThan(0);

    /**
     * A successful `N(h)` is the one point of no return with no durable representation of its
     * own — §2.4 journals it only through `push_pending` or the cursor advance — so a death
     * between the push and that rewrite is indistinguishable from a push that never ran, and
     * the crossing is read from the advance rather than from the participant's return.
     */
    const durablyCrossed = (prefix: readonly LifecycleCoordinatorBoundaryV1[]): boolean =>
      LIFECYCLE_POINT_OF_NO_RETURN[variant].kind === "push_succeeded"
        ? prefix.some(
            (boundary) =>
              boundary.kind === "journal_rewritten" &&
              boundary.nextStep > reference.boundaryIndex,
          )
        : prefix.some(
            (boundary) =>
              boundary.kind === "participant_returned" &&
              boundary.direction === "forward" &&
              boundary.step === reference.boundaryIndex,
          );

    for (let at = 0; at < boundaries.length; at += 1) {
      const crossed = durablyCrossed(boundaries.slice(0, at + 1));
      const world = await syntheticWorld(variant, { artifactSteps });
      let seen = 0;
      await expect(
        world.execute({
          afterBoundary: () => {
            seen += 1;
            if (seen === at + 1) throw new SyntheticDeath(`boundary ${String(at)}`);
          },
        }),
      ).rejects.toThrow(SyntheticDeath);

      await expectRecovered(world);
      expect(world.unjournaledMutations()).toStrictEqual([]);
      expect(await world.terminalState()).toStrictEqual(await world.expectedAfter(crossed));
    }
  }
});

describe("compensation order", () => {
  it("compensates the exact reverse prefix before the point of no return", async () => {
    const world = await syntheticWorld("uninstall/present_manifest");
    const { outcome } = await world.execute({ failAt: "M(commit_absence)" });

    expect(outcome.kind).toBe("rolled_back");
    expect(world.compensationOrder()).toStrictEqual([
      "M(preserve_before)^-1",
      "K(restore)",
      "F(uninstall_artifacts)^-1",
      "P^-1",
      "F(uninstall_marker)^-1",
    ]);
    expect(world.unjournaledMutations()).toStrictEqual([]);
  }, 120_000);

  it("compensates the without-launchd variant with no `P` arm", async () => {
    const world = await syntheticWorld("uninstall/present_manifest_without_launchd");
    const { outcome } = await world.execute({ failAt: "M(commit_absence)" });

    expect(outcome.kind).toBe("rolled_back");
    expect(world.compensationOrder()).toStrictEqual([
      "M(preserve_before)^-1",
      "K(restore)",
      "F(uninstall_artifacts)^-1",
      "F(uninstall_marker)^-1",
    ]);
  }, 120_000);

  it("compensates every repeated artifact step in reverse step order (D45)", async () => {
    const world = await syntheticWorld("uninstall/present_manifest_without_launchd", { artifactSteps: 3 });
    const { outcome } = await world.execute({ failAt: "M(commit_absence)" });

    expect(outcome.kind).toBe("rolled_back");
    expect(world.compensationOrder()).toStrictEqual([
      "M(preserve_before)^-1",
      "K(restore)",
      "F(uninstall_artifacts)^-1",
      "F(uninstall_artifacts)^-1",
      "F(uninstall_artifacts)^-1",
      "F(uninstall_marker)^-1",
    ]);
    const artifactSteps = world.steps
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.label === "F(uninstall_artifacts)")
      .map(({ index }) => index);
    expect(artifactSteps).toHaveLength(3);
    expect(await world.terminalState()).toStrictEqual(await world.expectedAfter(false));
    expect(world.unjournaledMutations()).toStrictEqual([]);
  }, 120_000);

  it("finalizes an uninstall with the full 31 artifact steps (D45)", async () => {
    const world = await syntheticWorld("uninstall/present_manifest_without_launchd", { artifactSteps: 31 });
    expect(validateLifecyclePlanGrammar(world.plan, variantFactsOf(world.variant))).toBe(world.variant);
    expect(world.plan.participants.foundation).toHaveLength(64);

    const { outcome } = await world.execute();

    expect(outcome).toStrictEqual({ kind: "finalized", id: world.plan.id });
    expect(await world.terminalState()).toStrictEqual(await world.expectedAfter(true));
    expect(world.unjournaledMutations()).toStrictEqual([]);
  }, 120_000);

  it("leaves `R` out of the reverse prefix while still passing its cursor", async () => {
    const world = await syntheticWorld("uninstall/present_manifest_without_launchd");
    await world.execute({ failAt: "M(commit_absence)" });

    const drainIndex = world.steps.findIndex((entry) => entry.label === "R");
    expect(drainIndex).toBeGreaterThan(0);
    expect(world.compensationOrder()).not.toContain("R");
    const journal = await world.journal();
    expect(journal?.phase).toBe("rolled_back");
    expect(journal?.compensationNext).toBe(-1);
  }, 120_000);
});

describe("the bounded runner drain", () => {
  it("returns the handle the drain reacquired and hands it to every later step", async () => {
    const world = await syntheticWorld("uninstall/present_manifest_without_launchd");
    const before = world.global;
    const { global } = await world.execute();

    expect(world.reacquired.length).toBe(1);
    expect(global).toBe(world.reacquired[0]);
    expect(global).not.toBe(before);
  }, 120_000);
});

describe("step hooks", () => {
  function hooksRecording(
    calls: string[],
    handles: HeldLifecycleStableLockV1[],
    options: { readonly refuseAt?: number } = {},
  ): NonNullable<LifecycleParticipantAdaptersV1<SyntheticPlan>["stepHooks"]> {
    return {
      before: (_plan, index, _step, global) => {
        calls.push(`before:${String(index)}`);
        handles.push(global);
        if (options.refuseAt === index) throw new SyntheticDeath(`hook refused ${String(index)}`);
        const next: HeldLifecycleStableLockV1 = { ...global, release: () => Promise.resolve() };
        return Promise.resolve(next);
      },
      after: (_plan, index) => {
        calls.push(`after:${String(index)}`);
        return Promise.resolve();
      },
    };
  }

  it("brackets every forward step and threads the handle `before` returns", async () => {
    const world = await syntheticWorld("git_sync/existing_network");
    const calls: string[] = [];
    const handles: HeldLifecycleStableLockV1[] = [];
    await world.execute({ stepHooks: hooksRecording(calls, handles) });

    expect(calls).toStrictEqual(["before:0", "after:0", "before:1", "after:1"]);
    expect(handles.length).toBe(2);
    expect(handles[1]).not.toBe(handles[0]);
  }, 120_000);

  it("leaves the cursor unchanged when `before` refuses", async () => {
    const world = await syntheticWorld("git_sync/existing_network");
    const calls: string[] = [];
    await expect(
      world.execute({ stepHooks: hooksRecording(calls, [], { refuseAt: 0 }) }),
    ).rejects.toThrow(SyntheticDeath);

    expect(calls).toStrictEqual(["before:0"]);
    const journal = await world.journal();
    expect(journal?.nextStep).toBe(0);
    expect(world.pushAttempts()).toBe(0);
  }, 120_000);

  it("calls `before` again when recovery resumes a step that has not completed", async () => {
    const world = await syntheticWorld("git_sync/no_changes");
    await expect(
      world.execute({
        afterBoundary: (boundary) => {
          if (boundary.kind === "participant_returned") throw new SyntheticDeath("returned");
        },
      }),
    ).rejects.toThrow(SyntheticDeath);

    const calls: string[] = [];
    const { outcome } = await world.execute({ stepHooks: hooksRecording(calls, []) });

    expect(outcome.kind).toBe("finalized");
    expect(calls).toStrictEqual(["before:0", "after:0"]);
  }, 120_000);
});

describe("the push arms", () => {
  it("sets `push_pending` with an unchanged cursor and retries only the bound push", async () => {
    const world = await syntheticWorld("git_sync/existing_network", { pushOutcome: "failed" });
    const first = await world.execute();

    expect(first.outcome).toStrictEqual({
      kind: "push_pending",
      id: world.plan.id,
      pushPlanHash: PUSH_PLAN_HASH,
    });
    const pending = await world.journal();
    expect(pending?.phase).toBe("push_pending");
    expect(pending?.nextStep).toBe(0);
    expect(await world.inspect()).toMatchObject({
      closure: { kind: "retry_only", transactionId: world.plan.id, pushPlanHash: PUSH_PLAN_HASH },
    });

    world.pushOutcome = "succeeded";
    const snapshot = await world.recover();
    expect(snapshot.closure).toStrictEqual({ kind: "clear" });
    expect(world.pushAttempts()).toBe(2);
  }, 120_000);

  it("tolerates a coordinator still `push_pending` on a retried recover() call instead of refusing it", async () => {
    const world = await syntheticWorld("git_sync/existing_network", { pushOutcome: "failed" });
    await world.execute();

    const snapshot = await world.recover();

    expect(snapshot.closure).toStrictEqual({
      kind: "retry_only",
      transactionId: world.plan.id,
      pushPlanHash: PUSH_PLAN_HASH,
    });
    const journal = await world.journal();
    expect(journal?.phase).toBe("push_pending");
    expect(journal?.nextStep).toBe(0);
    expect(world.pushAttempts()).toBe(2);
  }, 120_000);

  it("keeps a destination effect with no journal in `push_pending` and one with a journal in ordinary recovery", async () => {
    const pending = await syntheticWorld("git_sync/existing_local");
    const { outcome } = await pending.execute({ failAt: "D" });
    expect(outcome).toStrictEqual({
      kind: "push_pending",
      id: pending.plan.id,
      pushPlanHash: PUSH_PLAN_HASH,
    });

    const journalled = await syntheticWorld("git_sync/existing_local");
    await journalled.execute({
      afterBoundary: (boundary) => {
        if (boundary.kind === "participant_returned") throw new SyntheticDeath("returned");
      },
    }).catch(() => undefined);
    const snapshot = await journalled.inspect();
    expect(snapshot.closure).not.toStrictEqual({
      kind: "retry_only",
      transactionId: journalled.plan.id,
      pushPlanHash: PUSH_PLAN_HASH,
    });
  }, 120_000);
});

describe("a Foundation participant that fails mid-apply (NEW-151)", () => {
  it.each([false, true])("rolls its journal back, compensates the prefix, and compacts to an empty ledger (inverse ID first: %s)", async (inverseIdFirst) => {
    const world = await syntheticWorld("git_disable", { inverseIdFirst });
    const failing = world.plan.steps[1];
    if (failing?.kind !== "foundation") throw new Error("no Foundation step at 1");

    const { outcome } = await world.execute({ failFoundationApplyAt: "F(activation)" });

    expect(outcome.kind).toBe("rolled_back");
    const journal = await world.journal();
    expect(journal?.phase).toBe("rolled_back");
    expect(journal?.nextStep).toBe(1);
    const participant = world.plan.participants.foundation.find((ref) => ref.id === failing.participantId);
    if (participant === undefined) throw new Error("no participant ref");
    const final = JSON.parse(await nodeFs.readFile(participant.initialJournal.finalPath, "utf8")) as {
      readonly phase: string;
    };
    expect(final.phase).toBe("rolled_back");
    expect(world.compensationOrder()).toStrictEqual(["M(preserve_before)^-1"]);
    expect(await world.terminalState()).toStrictEqual(await world.expectedAfter(false));

    const snapshot = await world.recover();
    expect(snapshot.coordinators).toStrictEqual([]);
    expect(snapshot.coordinatorOrphans).toStrictEqual([]);
    expect(snapshot.foundation.journals.size).toBe(0);
    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({ kind: "clear" });
  }, 120_000);

  it("refuses to compact a cursor journal that is not rolled back and leaves it in place", async () => {
    const world = await syntheticWorld("git_disable");
    const failing = world.plan.steps[1];
    if (failing?.kind !== "foundation") throw new Error("no Foundation step at 1");
    const participant = world.plan.participants.foundation.find((ref) => ref.id === failing.participantId);
    if (participant === undefined) throw new Error("no participant ref");
    const { outcome } = await world.execute({ failFoundationApplyAt: "F(activation)" });
    expect(outcome.kind).toBe("rolled_back");
    const [record] = (await world.inspect()).coordinators;
    if (record === undefined) throw new Error("no coordinator record");

    const finalPath = participant.initialJournal.finalPath;
    const rolledBack = validateJournal(JSON.parse(await nodeFs.readFile(finalPath, "utf8")) as unknown);
    await nodeFs.writeFile(finalPath, encodeFoundationJournalJsonV1({ ...rolledBack, phase: "validated" }), {
      mode: 0o600,
    });

    /** The ledger refuses this state first; compaction is pinned directly as the second line. */
    await expect(world.recover()).rejects.toThrow(
      expect.objectContaining({ reason: "lifecycle_standalone_transaction_incomplete" }),
    );
    await expect(compactTerminalCoordinator(world.dependencies(), record, world.global)).rejects.toThrow(
      expect.objectContaining({ reason: "lifecycle_coordinator_participant_state" }),
    );
    expect(await world.fs.lstat(finalPath)).not.toBeNull();
  }, 120_000);

  it("refuses with a reason code when the participant's own rollback conflicts", async () => {
    const world = await syntheticWorld("git_disable");
    await expect(
      world.execute({ failFoundationApplyAt: "F(activation)", failFoundationRollback: true }),
    ).rejects.toThrow(
      expect.objectContaining({
        reason: "lifecycle_foundation_participant_not_terminal",
        code: EXIT_CODES.recoveryRequired,
      }),
    );
  }, 120_000);

  it("finishes compaction clear after a death between the cursor journal's unlink and its lock's", async () => {
    const world = await syntheticWorld("git_disable");
    const failing = world.plan.steps[1];
    if (failing?.kind !== "foundation") throw new Error("no Foundation step at 1");
    const participant = world.plan.participants.foundation.find((ref) => ref.id === failing.participantId);
    if (participant === undefined) throw new Error("no participant ref");
    const target = participant.mutations[0]?.targetPath;
    if (target === undefined) throw new Error("no participant target");
    const { outcome } = await world.execute({ failFoundationApplyAt: "F(activation)" });
    expect(outcome.kind).toBe("rolled_back");
    const [record] = (await world.inspect()).coordinators;
    if (record === undefined) throw new Error("no coordinator record");

    const dependencies = world.dependencies();
    const fs: LifecycleGuardedFileSystemV1 = Object.assign(Object.create(dependencies.fs) as LifecycleGuardedFileSystemV1, {
      unlinkExact: async (entry: Parameters<LifecycleGuardedFileSystemV1["unlinkExact"]>[0]) => {
        await dependencies.fs.unlinkExact(entry);
        if (entry.path === participant.initialJournal.finalPath) throw new SyntheticDeath("journal_unlinked");
      },
    });
    await expect(compactTerminalCoordinator({ ...dependencies, fs }, record, world.global)).rejects.toThrow(
      SyntheticDeath,
    );
    expect(await world.fs.lstat(participant.initialJournal.finalPath)).toBeNull();
    /** Rolled back, the target is the user's again: a file they create there must not wedge recovery. */
    await nodeFs.writeFile(target, "user\n", { mode: 0o600 });

    const snapshot = await world.recover();
    expect(snapshot.coordinators).toStrictEqual([]);
    expect(snapshot.foundation.journals.size).toBe(0);
    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({ kind: "clear" });
    expect(await nodeFs.readFile(target, "utf8")).toBe("user\n");
  }, 120_000);
});

describe("third states and the caller obligations Task 15 carried forward", () => {
  function futureForwardRef(world: WorldV1): FoundationParticipantRefV1 {
    const step = world.plan.steps[1];
    if (step === undefined || step.kind !== "foundation") throw new Error("no future step");
    const ref = world.plan.participants.foundation.find(
      (candidate) => candidate.id === step.participantId,
    );
    if (ref === undefined) throw new Error("no participant ref");
    return ref;
  }

  it("refuses a future participant that already holds a final journal and changes nothing", async () => {
    const world = await syntheticWorld("git_enable");
    const ref = futureForwardRef(world);
    await nodeFs.copyFile(ref.initialJournal.stagedPath, ref.initialJournal.finalPath);

    await expect(world.execute()).rejects.toThrow(LifecycleRecoveryRequiredError);
    await expect(world.execute()).rejects.toThrow(
      expect.objectContaining({
        reason: "lifecycle_coordinator_participant_state",
        code: EXIT_CODES.recoveryRequired,
      }),
    );
    const journal = await world.journal();
    expect(journal?.phase).toBe("planned");
    expect(journal?.nextStep).toBe(0);
  }, 120_000);

  it("refuses when the global lock it was handed is no longer that inode", async () => {
    const world = await syntheticWorld("git_sync/no_changes");
    world.global = { ...world.global, ino: parseUInt64Decimal("1") };

    await expect(world.execute()).rejects.toThrow(LifecycleRecoveryRequiredError);
    await expect(world.execute()).rejects.toThrow(
      expect.objectContaining({
        reason: "lifecycle_global_lock_identity",
        code: EXIT_CODES.recoveryRequired,
      }),
    );
  }, 120_000);

  /**
   * `FoundationParticipantStateV1` spells both "the initial journal is still staged" and the
   * published phase `staged` as the same value, so both directions are pinned: a published
   * `staged` journal must not be read as unstarted, and a staged file with no final journal must.
   */
  it("reads a published `staged` phase and a staged initial journal apart", async () => {
    const published = await syntheticWorld("git_enable");
    const publishedRef = futureForwardRef(published);
    await nodeFs.copyFile(
      publishedRef.initialJournal.stagedPath,
      publishedRef.initialJournal.finalPath,
    );
    const staged = JSON.parse(
      await nodeFs.readFile(publishedRef.initialJournal.finalPath, "utf8"),
    ) as Record<string, unknown>;
    await nodeFs.writeFile(
      publishedRef.initialJournal.finalPath,
      `${JSON.stringify({ ...staged, phase: "staged" })}\n`,
      { mode: 0o600 },
    );

    await expect(published.execute()).rejects.toThrow(
      expect.objectContaining({ reason: "lifecycle_coordinator_participant_state" }),
    );

    const unstarted = await syntheticWorld("git_sync/no_changes");
    const unstartedRef = unstarted.plan.participants.foundation[0];
    if (unstartedRef === undefined) throw new Error("no participant ref");
    expect(await unstarted.fs.lstat(unstartedRef.initialJournal.stagedPath)).not.toBeNull();
    expect(await unstarted.fs.lstat(unstartedRef.initialJournal.finalPath)).toBeNull();
    const { outcome } = await unstarted.execute();
    expect(outcome.kind).toBe("finalized");
  }, 120_000);

  it("never touches the control files for a non-uninstall coordinator", async () => {
    const world = await syntheticWorld("git_enable");
    await world.execute();
    await world.recover();

    expect(
      await world.fs.lstat(
        parseCanonicalAbsolutePathText(`${world.home}/state/lifecycle-id-allocator.json`),
      ),
    ).not.toBeNull();
    expect(
      await world.fs.lstat(
        parseCanonicalAbsolutePathText(`${world.home}/state/lifecycle-install-nonce`),
      ),
    ).not.toBeNull();
  }, 120_000);
});
