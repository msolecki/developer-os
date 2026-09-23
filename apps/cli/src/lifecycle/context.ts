/**
 * Spec 1 §8.1's CLI composition root: the one place the lifecycle kernel's injected ports —
 * the guarded filesystem, the stable and transaction lock providers, the clock and the
 * concrete leaf codecs — are bound to a real home. Every service it hands back is a factory
 * over one `LifecycleHomeKeyV1`, so nothing here acquires a lock or executes a coordinator.
 */
import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  utimes,
} from "node:fs/promises";

import {
  LifecycleCoordinatorStore,
  LifecycleRecoveryRequiredError,
  LifecycleRecoveryService,
  TransactionStore,
  createGitEffectLedgerCodec,
  createNodeLifecycleGuardedFileSystem,
  deriveLifecycleLedgerRoots,
  inspectLifecycleLedger,
  inspectLifecycleLedgerV2,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseUtcTimestamp,
  validateLifecyclePlanGrammar,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  LifecycleBookkeepingResidueV1,
  LifecycleCoordinatorJournalV1,
  LifecycleGuardedFileSystemV1,
  LifecycleInstallNonceV1,
  LifecycleLedgerDependenciesV1,
  LifecycleLedgerRootsV1,
  LifecycleLedgerV2SnapshotV1,
  LifecycleLedgerSnapshotV1,
  LifecycleParticipantAdaptersV1,
  LifecycleStableLockProviderV1,
  LifecycleValueCodec,
  PublishBootstrapInitialJournalNoReplace,
  RuntimePaths,
  TransactionLockProvider,
  UtcTimestampV1,
} from "@developer-os/core";
import { LAUNCHD_EFFECT_LEDGER_CODEC } from "@developer-os/platform-macos";

import { createCanonicalPathEvidence } from "../bootstrap/admission.js";
import { createLifecycleEffectPorts, REJECTING_LAUNCHD_HOST } from "./adapters.js";
import type { LaunchdHostV1, LifecycleEffectPortsV1 } from "./adapters.js";
import type { AdmittedV2HomeV1 } from "./admission.js";
import {
  createLifecycleExecutionCodecs,
  lifecycleHomeKeyFromCoordinatorId,
  lifecyclePushPlanHash,
  lifecycleVariantFacts,
  manifestBeforeHashOf,
  uninstallLeasePaths,
} from "./codecs.js";
import type { LifecycleExecutionPlanV1, LifecycleHomeKeyV1, LifecyclePlanPreviewV1 } from "./codecs.js";

export { lifecycleHomeKeyFromCoordinatorId };
export type { LifecycleHomeKeyV1 };

const COORDINATOR_LEAF_GRAMMAR = /^\.?lc_([0-9a-f]{64})_(?:0|[1-9][0-9]*)[.]/u;

export interface LifecycleResidueEvidenceV1 {
  readonly retainedPaths: readonly CanonicalAbsolutePathV1[];
  readonly retainedEnvelopes: readonly {
    readonly plan: { readonly foundationParticipants: readonly { readonly id: string }[] };
  }[];
}

export interface CliLifecycleContext {
  readonly fs: LifecycleGuardedFileSystemV1;
  /**
   * The bound retained rename. `TransactionExecutor` needs it to publish a Foundation
   * participant's staged initial journal into `state/transactions`, and the executor a
   * coordinator builds is constructed where the coordinator runs, not at this root — so the
   * capability travels with the rest of the bound ports rather than being reconstructed there
   * from the production singleton, which would bypass a fixture's own rename.
   */
  readonly renameNoReplace: PublishBootstrapInitialJournalNoReplace;
  readonly locks: LifecycleStableLockProviderV1;
  readonly transactionLocks: TransactionLockProvider;
  readonly roots: LifecycleLedgerRootsV1;
  readonly effectiveUid: number;
  readonly clock: () => UtcTimestampV1;
  readonly uuid: () => string;
  readonly nowMs: () => number;
  readonly sleepMs: (milliseconds: number) => Promise<void>;
  codecs(key: LifecycleHomeKeyV1): {
    readonly executionPlan: LifecycleValueCodec<LifecycleExecutionPlanV1>;
    readonly preview: LifecycleValueCodec<LifecyclePlanPreviewV1>;
    readonly coordinatorJournal: LifecycleValueCodec<LifecycleCoordinatorJournalV1>;
  };
  /** The Git, launchd and push ports every effect participant of this home runs through. */
  effectPorts(): LifecycleEffectPortsV1;
  inspectLedger(
    key: LifecycleHomeKeyV1,
    residue: LifecycleBookkeepingResidueV1,
  ): Promise<LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>>;
  /**
   * Spec 2 §9.2's closure V2. Its `snapshot` is the V1 ledger with update residue excluded, so
   * only an update arm consumer may act on it; `inspectLedger` keeps every V1 caller fail-closed.
   */
  inspectClosureV2(
    key: LifecycleHomeKeyV1,
    residue: LifecycleBookkeepingResidueV1,
  ): Promise<LifecycleLedgerV2SnapshotV1<LifecycleExecutionPlanV1>>;
  store(key: LifecycleHomeKeyV1): LifecycleCoordinatorStore<LifecycleExecutionPlanV1>;
  recovery(
    key: LifecycleHomeKeyV1,
    adapters: LifecycleParticipantAdaptersV1<LifecycleExecutionPlanV1>,
    residue: LifecycleBookkeepingResidueV1,
  ): LifecycleRecoveryService<LifecycleExecutionPlanV1>;
}

export function lifecycleHomeKeyFromAdmission(
  admitted: AdmittedV2HomeV1,
  paths: RuntimePaths,
): LifecycleHomeKeyV1 {
  return {
    productHome: parseCanonicalAbsolutePathText(paths.home),
    nonce: admitted.nonce,
  };
}

/**
 * The one allocated nonce named by every `lc_…` leaf in `state/lifecycle-journals`; null when
 * none. Two nonces in one root is a home no key can address, which is recovery-required.
 */
export async function coordinatorNonceOf(
  fs: LifecycleGuardedFileSystemV1,
  productHome: CanonicalAbsolutePathV1,
): Promise<LifecycleInstallNonceV1 | null> {
  const root = deriveLifecycleLedgerRoots(productHome).coordinatorJournals;
  const entry = await fs.lstat(root);
  if (entry === null) return null;
  let found: LifecycleInstallNonceV1 | null = null;
  for await (const name of fs.names(entry)) {
    const match = COORDINATOR_LEAF_GRAMMAR.exec(name);
    if (match === null) continue;
    const nonce = parseLowerHexSha256(match[1]);
    if (found !== null && found !== nonce) {
      throw new LifecycleRecoveryRequiredError("lifecycle_coordinator_nonce_conflict", [root]);
    }
    found = nonce;
  }
  return found;
}

export function residueFrom(evidence: LifecycleResidueEvidenceV1): LifecycleBookkeepingResidueV1 {
  const bootstrapParticipantIds = new Set<string>();
  for (const envelope of evidence.retainedEnvelopes) {
    for (const participant of envelope.plan.foundationParticipants) {
      bootstrapParticipantIds.add(participant.id);
    }
  }
  return { retainedPaths: new Set<string>(evidence.retainedPaths), bootstrapParticipantIds };
}

const NODE_TRANSACTION_FILE_SYSTEM = {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  utimes,
};

export function createLifecycleContext(input: {
  readonly paths: RuntimePaths;
  readonly renameNoReplace: PublishBootstrapInitialJournalNoReplace;
  readonly locks: LifecycleStableLockProviderV1;
  readonly transactionLocks: TransactionLockProvider;
  readonly effectiveUid: number;
  readonly now: () => Date;
  readonly uuid?: () => string;
  readonly sleepMs?: (milliseconds: number) => Promise<void>;
  /** Absent, every launchd probe and spawn rejects: only the production root injects the real host. */
  readonly launchdHost?: LaunchdHostV1;
  /** Replaces the composed ports outright, for fixtures that record every effect call. */
  readonly effectPorts?: (context: CliLifecycleContext) => LifecycleEffectPortsV1;
}): CliLifecycleContext {
  const fs = createNodeLifecycleGuardedFileSystem({
    renameNoReplace: input.renameNoReplace,
    effectiveUid: input.effectiveUid,
  });
  const roots = deriveLifecycleLedgerRoots(parseCanonicalAbsolutePathText(input.paths.home));
  const clock = (): UtcTimestampV1 => parseUtcTimestamp(input.now().toISOString());
  const uuid = input.uuid ?? ((): string => randomUUID());
  const sleepMs =
    input.sleepMs ??
    ((milliseconds: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const foundationStore = new TransactionStore({
    stateDir: input.paths.stateDir,
    fs: NODE_TRANSACTION_FILE_SYSTEM,
    lockProvider: input.transactionLocks,
  });

  const codecs = (
    key: LifecycleHomeKeyV1,
  ): ReturnType<typeof createLifecycleExecutionCodecs> =>
    createLifecycleExecutionCodecs({ productHome: key.productHome, nonce: key.nonce });

  const ledgerDependencies = (
    key: LifecycleHomeKeyV1,
    residue: LifecycleBookkeepingResidueV1,
  ): LifecycleLedgerDependenciesV1<LifecycleExecutionPlanV1> => {
    const leaves = codecs(key);
    return {
      fs,
      effectiveUid: input.effectiveUid,
      executionPlanCodec: leaves.executionPlan,
      coordinatorJournalCodec: leaves.coordinatorJournal,
      variantFacts: lifecycleVariantFacts,
      pushPlanHash: lifecyclePushPlanHash,
      gitEffectPlanCodec: createGitEffectLedgerCodec(input.effectiveUid),
      launchdEffectPlanCodec: LAUNCHD_EFFECT_LEDGER_CODEC,
      residue,
      manifestBeforeHash: manifestBeforeHashOf,
      leasePaths: (plan) => uninstallLeasePaths(plan.authority.productHome),
    };
  };

  const inspectLedger = (
    key: LifecycleHomeKeyV1,
    residue: LifecycleBookkeepingResidueV1,
  ): Promise<LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>> =>
    inspectLifecycleLedger(ledgerDependencies(key, residue), deriveLifecycleLedgerRoots(key.productHome));

  const inspectClosureV2 = (
    key: LifecycleHomeKeyV1,
    residue: LifecycleBookkeepingResidueV1,
  ): Promise<LifecycleLedgerV2SnapshotV1<LifecycleExecutionPlanV1>> =>
    inspectLifecycleLedgerV2(
      { ...ledgerDependencies(key, residue), evidence: createCanonicalPathEvidence() },
      deriveLifecycleLedgerRoots(key.productHome),
    );

  /**
   * Task 14 left `publish` unable to check the grammar — the store has no `variantFacts` and
   * `encode` does not validate — so a grammar-invalid plan could become durable and the
   * ledger would then classify it `lifecycle_coordinator_plan_grammar` for good. The guard
   * sits on the store's own codec rather than on `validate`, which every ledger read goes
   * through: refusing there would report a grammar fault as `lifecycle_coordinator_plan_bytes`.
   */
  const store = (key: LifecycleHomeKeyV1): LifecycleCoordinatorStore<LifecycleExecutionPlanV1> => {
    const leaves = codecs(key);
    return new LifecycleCoordinatorStore<LifecycleExecutionPlanV1>({
      fs,
      roots: deriveLifecycleLedgerRoots(key.productHome),
      executionPlanCodec: {
        validate: (value) => leaves.executionPlan.validate(value),
        encode: (plan) => {
          validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan));
          return leaves.executionPlan.encode(plan);
        },
      },
      coordinatorJournalCodec: leaves.coordinatorJournal,
      uuid,
      clock,
      locks: input.transactionLocks,
    });
  };

  let ports: LifecycleEffectPortsV1 | null = null;
  const context: CliLifecycleContext = {
    fs,
    renameNoReplace: input.renameNoReplace,
    locks: input.locks,
    transactionLocks: input.transactionLocks,
    roots,
    effectiveUid: input.effectiveUid,
    clock,
    uuid,
    nowMs: () => input.now().getTime(),
    sleepMs,
    codecs,
    effectPorts: () => {
      ports ??=
        input.effectPorts?.(context) ??
        createLifecycleEffectPorts(context, input.launchdHost ?? REJECTING_LAUNCHD_HOST);
      return ports;
    },
    inspectLedger,
    inspectClosureV2,
    store,
    recovery: (key, adapters, residue) =>
      new LifecycleRecoveryService<LifecycleExecutionPlanV1>({
        fs,
        roots: deriveLifecycleLedgerRoots(key.productHome),
        foundationStore,
        store: store(key),
        adapters,
        variantFacts: lifecycleVariantFacts,
        pushPlanHash: lifecyclePushPlanHash,
        clock,
        inspect: () => inspectLedger(key, residue),
      }),
  };
  return context;
}
