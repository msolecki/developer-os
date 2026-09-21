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
  createNodeLifecycleGuardedFileSystem,
  deriveLifecycleLedgerRoots,
  inspectLifecycleLedger,
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
  LifecycleLedgerRootsV1,
  LifecycleLedgerSnapshotV1,
  LifecycleParticipantAdaptersV1,
  LifecycleStableLockProviderV1,
  LifecycleValueCodec,
  PublishBootstrapInitialJournalNoReplace,
  RuntimePaths,
  TransactionLockProvider,
  UtcTimestampV1,
} from "@developer-os/core";

import type { AdmittedV2HomeV1 } from "./admission.js";
import {
  createLifecycleExecutionCodecs,
  lifecyclePushPlanHash,
  lifecycleVariantFacts,
  manifestBeforeHashOf,
  uninstallLeasePaths,
} from "./codecs.js";
import type { LifecycleExecutionPlanV1 } from "./codecs.js";

const COORDINATOR_ID_GRAMMAR = /^lc_([0-9a-f]{64})_(?:0|[1-9][0-9]*)$/u;
const COORDINATOR_LEAF_GRAMMAR = /^\.?lc_([0-9a-f]{64})_(?:0|[1-9][0-9]*)[.]/u;

/**
 * What the lifecycle services need to know about a home. It never requires an admitted
 * manifest: recovery after `M(preserve_before)` runs with the manifest gone, and after the
 * uninstall control-file steps with the nonce gone.
 */
export interface LifecycleHomeKeyV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly nonce: LifecycleInstallNonceV1;
}

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
    readonly coordinatorJournal: LifecycleValueCodec<LifecycleCoordinatorJournalV1>;
  };
  inspectLedger(
    key: LifecycleHomeKeyV1,
    residue: LifecycleBookkeepingResidueV1,
  ): Promise<LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>>;
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

/** Parses the nonce out of `lc_<nonce>_<counter>`; refuses any other grammar. */
export function lifecycleHomeKeyFromCoordinatorId(
  productHome: CanonicalAbsolutePathV1,
  coordinatorId: string,
): LifecycleHomeKeyV1 {
  const match = COORDINATOR_ID_GRAMMAR.exec(coordinatorId);
  if (match === null) throw new Error("invalid LifecycleCoordinatorIdV1");
  return { productHome, nonce: parseLowerHexSha256(match[1]) };
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

  const inspectLedger = (
    key: LifecycleHomeKeyV1,
    residue: LifecycleBookkeepingResidueV1,
  ): Promise<LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>> => {
    const leaves = codecs(key);
    return inspectLifecycleLedger(
      {
        fs,
        effectiveUid: input.effectiveUid,
        executionPlanCodec: leaves.executionPlan,
        coordinatorJournalCodec: leaves.coordinatorJournal,
        variantFacts: lifecycleVariantFacts,
        pushPlanHash: lifecyclePushPlanHash,
        gitEffectPlanCodec: null,
        launchdEffectPlanCodec: null,
        residue,
        manifestBeforeHash: manifestBeforeHashOf,
        leasePaths: (plan) => uninstallLeasePaths(plan.authority.productHome),
      },
      deriveLifecycleLedgerRoots(key.productHome),
    );
  };

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

  return {
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
    inspectLedger,
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
}
