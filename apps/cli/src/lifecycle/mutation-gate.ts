/**
 * Spec 1 §2.3 and §2.4: the one door every Foundation mutation passes through on a V2 home.
 * It classifies the home, takes the global mutation lock, re-admits the installation under
 * that lock, runs the recovery and compaction preflight, requires closure `clear`, allocates
 * the standalone `tx` ID from the install allocator, and only then lets the caller's work
 * reach the unchanged `TransactionExecutor`. A V1 home and a manifest-absent home with no
 * global lock keep the legacy path unchanged; a manifest-absent home that still carries the
 * global lock refuses.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";

import {
  EXIT_CODES,
  FoundationParticipantExecutor,
  TransactionExecutor,
  allocatedCounterOf,
  assertLifecycleCapacity,
  cleanLifecycleAllocatorTemp,
  createNodeLifecycleGuardedFileSystem,
  formatAllocatedLifecycleId,
  hashBytes,
  LifecycleRecoveryRequiredError,
  inspectLifecycleAllocator,
  parseCanonicalAbsolutePathText,
  parseSafeReasonCode,
  reserveLifecycleIdBlock,
  standaloneFoundationLeafReservation,
} from "@developer-os/core";
import type {
  AllocatedLifecycleIdV1,
  CanonicalAbsolutePathV1,
  ExitCode,
  HeldLifecycleStableLockV1,
  LifecycleBookkeepingResidueV1,
  LifecycleLedgerSnapshotV1,
  LifecycleParticipantAdaptersV1,
  ManifestAdmissionContextV1,
  PlannedFileMutation,
  RuntimePaths,
  SafeReasonCodeV1,
  TransactionJournalV1,
  TransactionPlan,
} from "@developer-os/core";

import { createCanonicalPathEvidence, createOwnerPathAdmission } from "../bootstrap/admission.js";
import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import type { CliContext } from "../context.js";
import { resolveVendorHomes } from "../instructions/vendor-homes.js";
import { admitInstalledV2Home, observeManifestSchema } from "./admission.js";
import type { AdmittedV2HomeV1 } from "./admission.js";
import type { LifecycleExecutionPlanV1 } from "./codecs.js";
import { lifecycleHomeKeyFromAdmission, residueFrom } from "./context.js";
import type { CliLifecycleContext, LifecycleHomeKeyV1 } from "./context.js";
import {
  cleanManifestAnchorTemp,
  isCodeDefect,
  MANIFEST_ANCHOR_WARNING,
  readManifestAnchor,
  removeManifestAnchor,
  writeManifestAnchor,
} from "./manifest-anchor.js";
import type { ManifestAnchorReadV1 } from "./manifest-anchor.js";

const GLOBAL_LOCK_LEAF = ".lifecycle.lock";

export interface CliTransactionExecutor {
  execute(plan: TransactionPlan): Promise<TransactionJournalV1>;
  resume(id: string): Promise<TransactionJournalV1>;
  rollback(id: string): Promise<TransactionJournalV1>;
}

export type MutationHomeV1 =
  | { readonly kind: "v1" }
  | { readonly kind: "manifest_absent" }
  | { readonly kind: "manifest_absent_with_global_lock" }
  | { readonly kind: "v2"; readonly admitted: AdmittedV2HomeV1 };

export interface LifecycleMutationAuthorityV1 {
  readonly admitted: AdmittedV2HomeV1;
  readonly global: HeldLifecycleStableLockV1;
  readonly snapshot: LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>;
  allocateStandaloneFoundationId(
    mutations: readonly PlannedFileMutation[],
  ): Promise<AllocatedLifecycleIdV1<"tx">>;
}

export class LifecycleMutationRefusal extends Error {
  readonly code: ExitCode;
  readonly reason: SafeReasonCodeV1;
  readonly paths: readonly string[];
  readonly recovery: string | undefined;

  constructor(input: {
    readonly reason: string;
    readonly code: ExitCode;
    readonly paths: readonly string[];
    readonly recovery?: string | undefined;
  }) {
    super(`the lifecycle mutation gate refused: ${input.reason}`);
    this.code = input.code;
    this.reason = parseSafeReasonCode(input.reason);
    this.paths = [...input.paths];
    this.recovery = input.recovery;
    // failureFrom publishes kindOf(name), so the name is what yields the reason code.
    this.name = `${input.reason
      .split("_")
      .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
      .join("")}Error`;
  }
}

interface HeldAuthorityV1 {
  readonly productHome: string;
  readonly authority: LifecycleMutationAuthorityV1;
}

const HELD_AUTHORITY = new AsyncLocalStorage<HeldAuthorityV1>();
const GATED = new WeakSet<object>();

export function isGatedTransactionExecutor(value: unknown): boolean {
  return typeof value === "object" && value !== null && GATED.has(value);
}

function globalLockPath(paths: RuntimePaths): CanonicalAbsolutePathV1 {
  return join(paths.stateDir, GLOBAL_LOCK_LEAF) as CanonicalAbsolutePathV1;
}

/**
 * The same confined owner-path authority `uninstall` builds. It is constructed here rather
 * than imported from `commands/uninstall.ts`, which would make `context.ts` →
 * `lifecycle/mutation-gate.ts` → `commands/uninstall.ts` → `context.ts` a runtime import
 * cycle through the composition root.
 */
function gateManifestAdmission(context: CliContext): ManifestAdmissionContextV1 {
  const { paths } = context;
  const productHome = paths.home as CanonicalAbsolutePathV1;
  return {
    evidence: createCanonicalPathEvidence(),
    sourceRoot: productHome,
    backupRoot: paths.backupsDir as CanonicalAbsolutePathV1,
    admitOwnerPath: createOwnerPathAdmission({
      kind: "confined",
      roots: [productHome, paths.brain as CanonicalAbsolutePathV1],
      vendors: resolveVendorHomes(context.env, context.userHome, paths.home),
    }),
  };
}

function guardedPortFor(
  lifecycle: CliLifecycleContext | undefined,
): { readonly fs: ReturnType<typeof createNodeLifecycleGuardedFileSystem>; readonly effectiveUid: number } {
  if (lifecycle !== undefined) return { fs: lifecycle.fs, effectiveUid: lifecycle.effectiveUid };
  // The composition root's own fallback: no file is owned by uid -1, so every guarded read refuses.
  const effectiveUid = process.getuid?.() ?? -1;
  return {
    fs: createNodeLifecycleGuardedFileSystem({
      renameNoReplace: () => Promise.reject(new Error("the mutation gate never renames")),
      effectiveUid,
    }),
    effectiveUid,
  };
}

/**
 * `lifecycle` is optional because `createProductionContext` leaves the capability absent on a
 * product home that is not a `CanonicalAbsolutePathV1` — a decomposed macOS user name makes
 * that ordinary. A home that looks V2 without one refuses: falling through to the legacy
 * executor would write an unallocated `tx_<uuid>` journal into a V2 ledger.
 */
export async function classifyMutationHome(
  context: CliContext,
  lifecycle: CliLifecycleContext | undefined,
): Promise<MutationHomeV1> {
  const { fs, effectiveUid } = guardedPortFor(lifecycle);
  const observed = await observeManifestSchema(fs, context.paths);
  if (observed.kind === "v1") return { kind: "v1" };
  if (observed.kind === "absent") {
    // identity-free stat: presence alone, and the guarded port takes a path and nothing else.
    const lock = await fs.lstat(globalLockPath(context.paths));
    return { kind: lock === null ? "manifest_absent" : "manifest_absent_with_global_lock" };
  }
  if (lifecycle === undefined) {
    throw new LifecycleMutationRefusal({
      reason: "lifecycle_context_unavailable",
      code: EXIT_CODES.capabilityUnavailable,
      paths: [context.paths.home],
      recovery: "move the product home to a canonical absolute path before mutating a V2 installation",
    });
  }
  return {
    kind: "v2",
    admitted: await admitInstalledV2Home({
      fs,
      paths: context.paths,
      manifestAdmission: gateManifestAdmission(context),
      effectiveUid,
    }),
  };
}

function refuseNonV2(home: MutationHomeV1, paths: RuntimePaths): never {
  if (home.kind === "manifest_absent_with_global_lock") {
    throw new LifecycleMutationRefusal({
      reason: "manifest_absent",
      code: EXIT_CODES.invalidInput,
      paths: [paths.manifestFile, globalLockPath(paths)],
      recovery: "developer-os init",
    });
  }
  throw new LifecycleMutationRefusal({
    reason: "lifecycle_mutation_home_not_v2",
    code: EXIT_CODES.invalidInput,
    paths: [paths.manifestFile],
    recovery: "developer-os init",
  });
}

/**
 * Every ID the allocator's counter must already cover. A legacy `tx_<uuid>` journal carries
 * no counter and cannot constrain the allocator, so it is left out rather than refused here.
 */
function allocatedIdsFrom(snapshot: LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>): readonly string[] {
  const candidates = [
    ...snapshot.coordinators.map((record) => record.id as string),
    ...[...snapshot.foundation.journals.keys()].map((id) => id as string),
  ];
  return candidates.filter((id) => {
    try {
      allocatedCounterOf(id);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * In plan 1a the CLI codec admits no operation but `uninstall` and no effect leaf at all, and
 * `assertRecoverable` refuses every active coordinator before the recovery loop reaches one —
 * so the only adapters the preflight can reach are the Foundation participant's
 * `discardUnstarted`, which touches the guarded port alone. Completing an uninstall
 * coordinator's control files is Task 22's, and refuses here rather than deleting them.
 */
function gateAdapters(
  context: CliContext,
  lifecycle: CliLifecycleContext,
): LifecycleParticipantAdaptersV1<LifecycleExecutionPlanV1> {
  const unsupported = (file: string): never => {
    throw new LifecycleMutationRefusal({
      reason: "lifecycle_control_file_removal_unsupported",
      code: EXIT_CODES.capabilityUnavailable,
      paths: [join(context.paths.stateDir, file)],
      recovery: "developer-os uninstall",
    });
  };
  return {
    foundation: new FoundationParticipantExecutor({
      fs: lifecycle.fs,
      roots: lifecycle.roots,
      executor: new TransactionExecutor({
        stateDir: context.paths.stateDir,
        stagingDir: context.paths.stagingDir,
        backupsDir: context.paths.backupsDir,
        fs: context.fs,
        clock: () => context.now().toISOString(),
        generateId: () => {
          throw new Error("the mutation gate allocates every Foundation transaction ID");
        },
        guards: context.guards.transaction,
        lockProvider: lifecycle.transactionLocks,
      }),
      effectiveUid: lifecycle.effectiveUid,
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
      removeAllocator: () => unsupported("lifecycle-id-allocator.json"),
      removeNonce: () => unsupported("lifecycle-install-nonce"),
    },
  };
}

/**
 * A12 lists `staging/lifecycle` in the closed bookkeeping set and `inspectLifecycleLedger`
 * refuses its absence as `lifecycle_ledger_root_shape`, but the fresh V2 coordinator creates
 * every other bookkeeping root and not this one (`apps/cli/src/bootstrap/executor.ts`,
 * `ordinaryDirectories`) — so without this no mutation on a real fresh V2 home can pass the
 * preflight. Materialising it under the held global lock restores the shape the ledger was
 * written against; the durable fix belongs in that fresh layout.
 */
async function requireLifecycleStagingRoot(
  lifecycle: CliLifecycleContext,
  paths: RuntimePaths,
): Promise<void> {
  const root = lifecycle.roots.lifecycleStaging;
  // identity-free stat: presence and kind only, and the guarded port takes a path and nothing else.
  if ((await lifecycle.fs.lstat(root)) !== null) return;
  try {
    await lifecycle.fs.mkdirExclusive(root);
  } catch (error) {
    // identity-free stat: the losing side of a create race reads the kind, never an identity.
    if ((await lifecycle.fs.lstat(root))?.kind !== "directory") throw error;
  }
  // identity-free stat: `syncDirectory` reopens and re-checks the entry it is handed.
  const parent = await lifecycle.fs.lstat(parseCanonicalAbsolutePathText(paths.stagingDir));
  if (parent === null) {
    throw new LifecycleRecoveryRequiredError("lifecycle_guarded_parent", [paths.stagingDir]);
  }
  await lifecycle.fs.syncDirectory(parent);
}

/**
 * §2.4 admits exactly one pre-rename allocator temp and the ledger reports it as a finding,
 * which `assertRecoverable` would refuse — so a mutator cleans it before the recovery pass.
 * The cheap inspection runs first because the temp is absent on every healthy home, and the
 * full ledger read is only needed for the surviving allocated IDs the cleanup re-verifies.
 */
async function cleanAllocatorTemp(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  key: LifecycleHomeKeyV1,
  residue: LifecycleBookkeepingResidueV1,
  held: HeldLifecycleStableLockV1,
): Promise<void> {
  const stateDirectory = parseCanonicalAbsolutePathText(context.paths.stateDir);
  const observed = await inspectLifecycleAllocator(lifecycle.fs, stateDirectory, lifecycle.effectiveUid, []);
  if (observed.temp === null) return;
  const allocatedIds = allocatedIdsFrom(await lifecycle.inspectLedger(key, residue));
  const rechecked = await inspectLifecycleAllocator(
    lifecycle.fs,
    stateDirectory,
    lifecycle.effectiveUid,
    allocatedIds,
  );
  await cleanLifecycleAllocatorTemp(lifecycle.fs, rechecked, held, allocatedIds);
}

/**
 * The digest the executor persisted beside a staged postimage, `<hash>\n`, or `null` when it
 * is not there in the owned shape.
 */
async function stagedDigest(
  lifecycle: CliLifecycleContext,
  stagingDirectory: string,
  transactionId: string,
  stagedRelativePath: string,
): Promise<string | null> {
  const path = parseCanonicalAbsolutePathText(
    join(stagingDirectory, "transactions", transactionId, `${stagedRelativePath}.sha256`),
  );
  // identity-free stat: the guarded port's entry, read through the same port; no dev/ino is recorded.
  const entry = await lifecycle.fs.lstat(path);
  if (entry?.kind !== "regular_file" || entry.ownerUid !== lifecycle.effectiveUid || BigInt(entry.size) !== 65n) {
    return null;
  }
  const text = new TextDecoder().decode(await lifecycle.fs.readRegular(entry, 65));
  return /^[0-9a-f]{64}\n$/u.test(text) ? text.slice(0, 64) : null;
}

/**
 * D54 crash safety: a committed manifest-writing journal whose anchor write never happened is
 * still present here, because only the `recover` below compacts it. The anchor is derived only
 * when it is absent (or malformed, which the owned-shape write safely replaces) or still names
 * that journal's before-hash — so an anchor written after the journal (the ordinary case, where
 * the journal waits for the next gate entry to be compacted) is never overwritten with a hand
 * edit. The manifest on disk is anchored only when it is byte-for-byte the postimage the
 * journal staged, proven by the persisted `.sha256` (D54 review, finding 2); anything else
 * leaves the anchor as it is and `init` refuses (exit 6).
 *
 * An anchor this cannot read in the owned shape is reported and skipped, never a refusal of the
 * gate entry: it is evidence for `init`, not a lifecycle precondition (finding 3).
 */
async function deriveManifestAnchor(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  key: LifecycleHomeKeyV1,
  residue: LifecycleBookkeepingResidueV1,
): Promise<void> {
  const { fs, effectiveUid } = lifecycle;
  let anchor: ManifestAnchorReadV1;
  try {
    await cleanManifestAnchorTemp(fs, context.paths.stateDir, effectiveUid);
    anchor = await readManifestAnchor(fs, context.paths.home, effectiveUid);
  } catch (error) {
    if (isCodeDefect(error)) throw error;
    context.io.stderr(MANIFEST_ANCHOR_WARNING);
    return;
  }
  // identity-free stat: the guarded port's entry, hashed through the same port; no dev/ino is recorded.
  const manifest = await fs.lstat(parseCanonicalAbsolutePathText(context.paths.manifestFile));
  if (manifest?.kind !== "regular_file") return;
  const manifestHash = await fs.hashRegular(manifest, BigInt(manifest.size));
  if (anchor.kind === "anchored" && anchor.manifestHash === manifestHash) return;

  const snapshot = await lifecycle.inspectLedger(key, residue);
  let latest: {
    readonly counter: bigint;
    readonly id: string;
    readonly beforeHash: string | null;
    readonly stagedRelativePath: string | null;
  } | null = null;
  for (const compaction of snapshot.standaloneTerminalFoundation) {
    if (compaction.terminalPhase !== "finalized") continue;
    const journal = snapshot.foundation.journals.get(compaction.transactionId)?.journal;
    const write = journal?.mutations.find((mutation) => mutation.targetPath === context.paths.manifestFile);
    if (write === undefined) continue;
    let counter: bigint;
    try {
      counter = allocatedCounterOf(compaction.transactionId);
    } catch {
      continue;
    }
    if (latest === null || counter > latest.counter) {
      latest = {
        counter,
        id: compaction.transactionId,
        beforeHash: write.expectedBeforeHash,
        stagedRelativePath: write.stagedRelativePath,
      };
    }
  }
  if (latest?.stagedRelativePath == null) return;
  if (anchor.kind === "anchored" && anchor.manifestHash !== latest.beforeHash) return;
  const bootstrapManifestHash = anchor.kind === "anchored" ? anchor.bootstrapManifestHash : latest.beforeHash;
  if (bootstrapManifestHash === null) return;
  try {
    if (await stagedDigest(lifecycle, context.paths.stagingDir, latest.id, latest.stagedRelativePath) !== manifestHash) {
      return;
    }
    await writeManifestAnchor(fs, context.paths.home, context.paths.stateDir, effectiveUid, {
      manifestHash,
      bootstrapManifestHash,
    });
  } catch (error) {
    if (isCodeDefect(error)) throw error;
    context.io.stderr(MANIFEST_ANCHOR_WARNING);
  }
}

/**
 * §2.2's closure prerequisite. The one admitted exception is the standalone Foundation
 * journal the caller is explicitly resolving, and only while it is the sole thing left: every
 * other non-clear cause either refused inside `recover` or is unrecoverable here.
 */
function requireResolvedClosure(
  snapshot: LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>,
  resolution: { readonly standaloneFoundationId: string } | undefined,
  paths: RuntimePaths,
): void {
  if (snapshot.closure.kind === "clear") return;
  const [standalone] = snapshot.standaloneNonTerminalFoundation;
  const sole =
    resolution !== undefined &&
    snapshot.standaloneNonTerminalFoundation.length === 1 &&
    standalone?.id === resolution.standaloneFoundationId &&
    snapshot.findings.length === 0 &&
    snapshot.coordinators.length === 0 &&
    snapshot.coordinatorOrphans.length === 0 &&
    snapshot.foundation.orphans.length === 0 &&
    !snapshot.foundation.overflow;
  if (sole) return;
  throw new LifecycleMutationRefusal({
    reason: "lifecycle_closure_unresolved",
    code: EXIT_CODES.recoveryRequired,
    paths: [paths.home],
    recovery: "developer-os doctor",
  });
}

export async function withLifecycleMutation<T>(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  work: (authority: LifecycleMutationAuthorityV1) => Promise<T>,
  resolution?: { readonly standaloneFoundationId: string },
): Promise<T> {
  const home = await classifyMutationHome(context, lifecycle);
  if (home.kind !== "v2") refuseNonV2(home, context.paths);

  const lockPath = globalLockPath(context.paths);
  let held = await lifecycle.locks.acquireExisting(lockPath);
  let live = true;
  try {
    const admitted = await admitInstalledV2Home({
      fs: lifecycle.fs,
      paths: context.paths,
      manifestAdmission: gateManifestAdmission(context),
      effectiveUid: lifecycle.effectiveUid,
    });
    if (admitted.globalLock.dev !== held.dev || admitted.globalLock.ino !== held.ino) {
      throw new LifecycleMutationRefusal({
        reason: "lifecycle_lock_identity",
        code: EXIT_CODES.recoveryRequired,
        paths: [lockPath],
        recovery: "developer-os doctor",
      });
    }

    await requireLifecycleStagingRoot(lifecycle, context.paths);
    const key = lifecycleHomeKeyFromAdmission(admitted, context.paths);
    const residue = residueFrom(
      await inspectBootstrapEvidenceAdmission(
        createBootstrapEvidenceInspectionRequest({
          productHome: context.paths.home,
          stateDirectory: context.paths.stateDir,
          initialRoots: [context.paths.home, context.paths.stateDir, context.userHome],
        }),
      ),
    );
    await cleanAllocatorTemp(context, lifecycle, key, residue, held);
    await deriveManifestAnchor(context, lifecycle, key, residue);

    const recovered = await lifecycle
      .recovery(key, gateAdapters(context, lifecycle), residue)
      .recover(held, {
        resumeUninstall: false,
        ...(resolution === undefined
          ? {}
          : { standaloneFoundationId: resolution.standaloneFoundationId }),
      });
    held = recovered.global;
    requireResolvedClosure(recovered.snapshot, resolution, context.paths);

    const snapshot = recovered.snapshot;
    const authority: LifecycleMutationAuthorityV1 = {
      admitted,
      global: held,
      snapshot,
      allocateStandaloneFoundationId: async (mutations) => {
        if (!live) {
          throw new LifecycleMutationRefusal({
            reason: "lifecycle_mutation_authority_released",
            code: EXIT_CODES.recoveryRequired,
            paths: [lockPath],
            recovery: "developer-os doctor",
          });
        }
        assertLifecycleCapacity(snapshot, standaloneFoundationLeafReservation(mutations));
        const block = await reserveLifecycleIdBlock(
          {
            fs: lifecycle.fs,
            stateDirectory: parseCanonicalAbsolutePathText(context.paths.stateDir),
            effectiveUid: lifecycle.effectiveUid,
            uuid: lifecycle.uuid,
            held,
            allocatedIds: allocatedIdsFrom(snapshot),
          },
          1,
        );
        return formatAllocatedLifecycleId("tx", block.nonce, block.firstCounter);
      },
    };
    return await HELD_AUTHORITY.run({ productHome: context.paths.home, authority }, () =>
      work(authority),
    );
  } finally {
    live = false;
    await held.release();
  }
}

/**
 * `allocated(id)` is supplied by the composition root rather than derived here: only the root
 * holds the legacy executor's dependencies, including a fixture's `afterPhase` interruption
 * hook, and `TransactionExecutor` does not expose them.
 */
export function createGatedTransactionExecutor(input: {
  readonly context: () => CliContext;
  readonly lifecycle: CliLifecycleContext | undefined;
  readonly legacy: TransactionExecutor;
  readonly allocated: (id: string) => TransactionExecutor;
}): CliTransactionExecutor {
  const heldFor = (context: CliContext): LifecycleMutationAuthorityV1 | null => {
    const store = HELD_AUTHORITY.getStore();
    return store !== undefined && store.productHome === context.paths.home ? store.authority : null;
  };

  const gated = async <T>(
    resolution: { readonly standaloneFoundationId: string } | undefined,
    run: (authority: LifecycleMutationAuthorityV1) => Promise<T>,
    legacyRun: () => Promise<T>,
  ): Promise<T> => {
    const context = input.context();
    const held = heldFor(context);
    if (held !== null) return run(held);
    const home = await classifyMutationHome(context, input.lifecycle);
    if (home.kind === "v1" || home.kind === "manifest_absent") return legacyRun();
    if (home.kind !== "v2") refuseNonV2(home, context.paths);
    if (input.lifecycle === undefined) throw new Error("an admitted V2 home has no lifecycle context");
    return withLifecycleMutation(context, input.lifecycle, run, resolution);
  };

  /**
   * D54: under the held global lock and before any later gate entry can compact the journal,
   * a committed manifest write records the manifest hash it produced. A resumed transaction
   * carries no postimage any more, so its anchor is the manifest it just left on disk.
   *
   * The chain's `bootstrapManifestHash` carries forward only while the anchor still names this
   * write's before-hash; otherwise the chain restarts at that before-hash, which settles a plan
   * only when it is the plan's own manifest (finding 1). A transaction that leaves no manifest
   * ends the installation the anchor describes, so it removes the anchor.
   *
   * Never a throw: the transaction has committed, and a throw here means "nothing happened" to
   * every caller (finding 3). A failure is reported and the anchor is left for the next write.
   */
  const anchorCommitted = async (
    journal: TransactionJournalV1,
    postimage: Uint8Array | null | undefined,
  ): Promise<TransactionJournalV1> => {
    const context = input.context();
    const lifecycle = input.lifecycle;
    if (lifecycle === undefined || journal.phase !== "finalized") return journal;
    const write = journal.mutations.find((mutation) => mutation.targetPath === context.paths.manifestFile);
    if (write === undefined) return journal;
    const { fs, effectiveUid } = lifecycle;
    try {
      // identity-free stat: the guarded port's entry, hashed through the same port; no dev/ino is recorded.
      const manifest = await fs.lstat(parseCanonicalAbsolutePathText(context.paths.manifestFile));
      if (manifest?.kind !== "regular_file") {
        await removeManifestAnchor(fs, context.paths.home, effectiveUid);
        return journal;
      }
      const manifestHash = postimage === null || postimage === undefined
        ? await fs.hashRegular(manifest, BigInt(manifest.size))
        : hashBytes(postimage);
      const previous = await readManifestAnchor(fs, context.paths.home, effectiveUid);
      const bootstrapManifestHash = previous.kind === "anchored" && previous.manifestHash === write.expectedBeforeHash
        ? previous.bootstrapManifestHash
        : write.expectedBeforeHash;
      if (bootstrapManifestHash === null) {
        await removeManifestAnchor(fs, context.paths.home, effectiveUid);
        return journal;
      }
      await writeManifestAnchor(fs, context.paths.home, context.paths.stateDir, effectiveUid, {
        manifestHash,
        bootstrapManifestHash,
      });
    } catch (error) {
      if (isCodeDefect(error)) throw error;
      context.io.stderr(MANIFEST_ANCHOR_WARNING);
    }
    return journal;
  };
  const manifestPostimage = (plan: TransactionPlan): Uint8Array | null | undefined =>
    plan.mutations.find((mutation) => mutation.targetPath === input.context().paths.manifestFile)?.content;

  const executor: CliTransactionExecutor = {
    execute: (plan) =>
      gated(
        undefined,
        async (authority) =>
          anchorCommitted(
            await input.allocated(await authority.allocateStandaloneFoundationId(plan.mutations)).execute(plan),
            manifestPostimage(plan),
          ),
        () => input.legacy.execute(plan),
      ),
    resume: (id) =>
      gated(
        { standaloneFoundationId: id },
        async () => anchorCommitted(await input.legacy.resume(id), null),
        () => input.legacy.resume(id),
      ),
    rollback: (id) =>
      gated({ standaloneFoundationId: id }, () => input.legacy.rollback(id), () => input.legacy.rollback(id)),
  };
  GATED.add(executor);
  return executor;
}
