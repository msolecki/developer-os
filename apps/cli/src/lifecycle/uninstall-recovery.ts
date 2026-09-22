/**
 * Spec 1 §6's uninstall dispatch and §2.1's recovery-only arm as amended by A3, A7, A14 and A15:
 * on any home this decides between the V1 Foundation revert, a V2 coordinator, resuming an
 * uninstall whose manifest is already moved, and §6's absent-manifest shapes — in that order.
 * The recovery-only arm builds its key from `coordinatorNonceOf`, never from admission, which
 * refuses `manifest_absent` at every point the arm can run.
 */
import { join } from "node:path";

import { EXIT_CODES, parseCanonicalAbsolutePathText, success } from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  CliResult,
  HeldLifecycleStableLockV1,
  LifecycleCoordinatorIdV1,
  LifecycleCoordinatorRecordV1,
  LifecycleGuardedEntryV1,
  LifecycleGuardedFileSystemV1,
  RuntimePaths,
} from "@developer-os/core";

import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import type { BootstrapEvidenceAdmissionV1 } from "../bootstrap/report.js";
import {
  manifestAdmissionFor,
  relocatedBrainRefusal,
  runCoordinatorUninstall,
  uninstallRuntimePaths,
  UninstallRefusal,
} from "../commands/uninstall.js";
import type { UninstallOptions, UninstallResultV1 } from "../commands/uninstall.js";
import type { CliContext } from "../context.js";
import { resolveVendorHomes } from "../instructions/vendor-homes.js";
import { admitInstalledV2Home, observeManifestSchema } from "./admission.js";
import type { AdmittedV2HomeV1 } from "./admission.js";
import type { LifecycleExecutionPlanV1 } from "./codecs.js";
import { coordinatorNonceOf, residueFrom } from "./context.js";
import type { CliLifecycleContext, LifecycleHomeKeyV1 } from "./context.js";
import {
  createUninstallAdapters,
  createUninstallParticipants,
  releaseUninstallHolds,
} from "./uninstall.js";
import type { LifecycleUninstallRequestV1, UninstallHoldsV1 } from "./uninstall.js";

const GLOBAL_LOCK_LEAF = ".lifecycle.lock";
const NONCE_LEAF = "lifecycle-install-nonce";
const ALLOCATOR_LEAF = "lifecycle-id-allocator.json";
const GLOBAL_LOCK_MODE = 0o600;

export type UninstallDispatchV1 =
  | { readonly kind: "v1_foundation" }
  | { readonly kind: "v2_coordinator"; readonly admitted: AdmittedV2HomeV1 }
  | {
      readonly kind: "recovery_only";
      readonly id: LifecycleCoordinatorIdV1;
      readonly key: LifecycleHomeKeyV1;
      readonly arm: "compensation" | "force_forward" | "envelope_suffix";
    }
  | { readonly kind: "absent_manifest" };

export type RecoveryOnlyUninstallV1 = Extract<UninstallDispatchV1, { kind: "recovery_only" }>;

type UninstallCoordinatorRecordV1 = LifecycleCoordinatorRecordV1<LifecycleExecutionPlanV1>;

function refuse(reason: string, ...paths: readonly string[]): never {
  throw new UninstallRefusal(
    EXIT_CODES.recoveryRequired,
    `the uninstall recovery-only arm refused: ${reason}`,
    paths,
    "developer-os doctor",
  );
}

/** identity-free stat: the guarded port takes a path and nothing else, and returns an already-exact decimal identity. */
function guardedEntry(
  fs: LifecycleGuardedFileSystemV1,
  path: CanonicalAbsolutePathV1,
): Promise<LifecycleGuardedEntryV1 | null> {
  return fs.lstat(path);
}

function stateLeaf(paths: RuntimePaths, leaf: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(join(paths.stateDir, leaf));
}

function evidenceFor(context: CliContext): Promise<BootstrapEvidenceAdmissionV1> {
  return inspectBootstrapEvidenceAdmission(
    createBootstrapEvidenceInspectionRequest({
      productHome: context.paths.home,
      stateDirectory: context.paths.stateDir,
      initialRoots: [context.paths.home, context.paths.stateDir, context.userHome],
    }),
  );
}

/**
 * The relocated-Brain diagnosis belongs to every admission `uninstall` performs, not just the one
 * `runCoordinatorUninstall` used to make for itself: `readOptional` collapses a refused owner path
 * into the same generic malformed-manifest error as a corrupted file, and the recorded path is the
 * only thing that tells them apart.
 */
async function admitV2Home(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  paths: RuntimePaths,
): Promise<AdmittedV2HomeV1> {
  const refusedOwnerPaths: string[] = [];
  try {
    return await admitInstalledV2Home({
      fs: lifecycle.fs,
      paths,
      manifestAdmission: manifestAdmissionFor(
        paths,
        refusedOwnerPaths,
        resolveVendorHomes(context.env, context.userHome, paths.home),
      ),
      effectiveUid: lifecycle.effectiveUid,
    });
  } catch (error) {
    const recordedPath = refusedOwnerPaths[0];
    if (recordedPath === undefined) throw error;
    throw relocatedBrainRefusal(recordedPath, paths.brain);
  }
}

/**
 * §2.3's exact stable lock, read by shape alone. The identity is re-proved under the hold by
 * `requireHeldGlobalLock`; this only decides whether a hold is worth taking at all.
 */
async function hasExactGlobalLock(
  lifecycle: CliLifecycleContext,
  paths: RuntimePaths,
): Promise<boolean> {
  const entry = await guardedEntry(lifecycle.fs, stateLeaf(paths, GLOBAL_LOCK_LEAF));
  return (
    entry !== null &&
    entry.kind === "regular_file" &&
    entry.ownerUid === lifecycle.effectiveUid &&
    entry.mode === GLOBAL_LOCK_MODE &&
    entry.nlink === 1 &&
    BigInt(entry.size) === 0n
  );
}

export async function dispatchUninstall(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  evidence?: BootstrapEvidenceAdmissionV1,
): Promise<UninstallDispatchV1> {
  const paths = await uninstallRuntimePaths(context);
  const observed = await observeManifestSchema(lifecycle.fs, paths);
  if (observed.kind === "v1") return { kind: "v1_foundation" };
  if (observed.kind === "v2") {
    return { kind: "v2_coordinator", admitted: await admitV2Home(context, lifecycle, paths) };
  }
  if (!(await hasExactGlobalLock(lifecycle, paths))) return { kind: "absent_manifest" };

  /**
   * §6: `uninstall/absent_manifest` never acquires the permanent global lock, so the coordinator
   * journal root — one guarded directory read — decides before any hold is taken.
   */
  const productHome = parseCanonicalAbsolutePathText(paths.home);
  if ((await coordinatorNonceOf(lifecycle.fs, productHome)) === null) {
    return { kind: "absent_manifest" };
  }

  const held = await lifecycle.locks.acquireExisting(stateLeaf(paths, GLOBAL_LOCK_LEAF));
  try {
    return (
      (await admitRecoveryOnlyUninstall(context, lifecycle, held, evidence)) ?? {
        kind: "absent_manifest",
      }
    );
  } finally {
    await held.release();
  }
}

/**
 * §2.1's recovery-only arm. `null` means this home carries no uninstall coordinator at all, which
 * is §6's absent-manifest question; every other disagreement with the arm's microstates refuses.
 */
export async function admitRecoveryOnlyUninstall(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  global: HeldLifecycleStableLockV1,
  evidence?: BootstrapEvidenceAdmissionV1,
): Promise<RecoveryOnlyUninstallV1 | null> {
  const paths = await uninstallRuntimePaths(context);
  const lockPath = stateLeaf(paths, GLOBAL_LOCK_LEAF);
  if (global.path !== lockPath) refuse("lifecycle_global_lock_identity", global.path);
  if ((await observeManifestSchema(lifecycle.fs, paths)).kind !== "absent") {
    refuse("uninstall_manifest_reappeared", paths.manifestFile);
  }

  const productHome = parseCanonicalAbsolutePathText(paths.home);
  const nonce = await coordinatorNonceOf(lifecycle.fs, productHome);
  if (nonce === null) return null;
  const key: LifecycleHomeKeyV1 = { productHome, nonce };

  const admitted = evidence ?? (await evidenceFor(context));
  const snapshot = await lifecycle.inspectLedger(key, residueFrom(admitted));
  const [finding] = snapshot.findings;
  if (finding !== undefined) refuse(finding.reason, finding.path);

  const record = selectUninstallCoordinator(snapshot.coordinators, paths.home);
  if (record === null) return null;
  return {
    kind: "recovery_only",
    id: record.id,
    key,
    arm: await admitRecoveryOnlyState(lifecycle, paths, record),
  };
}

/**
 * §2.1 requires "exactly one valid present-manifest uninstall journal". In plan 1a the CLI plan
 * codec admits no operation but `uninstall` and binds every coordinator leaf name to its own plan
 * id in both directions, so neither population below is constructible on a real home; both are
 * pinned over synthetic records.
 */
export function selectUninstallCoordinator(
  coordinators: readonly UninstallCoordinatorRecordV1[],
  productHome: string,
): UninstallCoordinatorRecordV1 | null {
  const uninstalls = coordinators.filter((record) => record.plan.operation === "uninstall");
  if (uninstalls.length !== coordinators.length) {
    refuse("lifecycle_coordinator_not_uninstall", productHome);
  }
  if (uninstalls.length > 1) refuse("lifecycle_uninstall_journal_count", productHome);
  return uninstalls[0] ?? null;
}

function stepIndexOf(
  plan: LifecycleExecutionPlanV1,
  kind: "manifest" | "redaction_key",
  transition: string,
): number {
  const index = plan.steps.findIndex(
    (step) => step.kind === kind && step.transition === transition,
  );
  if (index < 0) refuse(`lifecycle_coordinator_step_${transition}`, plan.authority.productHome);
  return index;
}

/**
 * §2.1 and A15's microstates for a leaf the step at `collectedAt` removes: present while the
 * cursor precedes that step, either while the cursor is at it — a death between the removal and
 * the journal rewrite is legal — and absent once the cursor is past it. A leaf the plan never
 * creates passes `collectedAt` below every cursor, so it is required absent throughout.
 */
async function admitCollectedLeaf(
  lifecycle: CliLifecycleContext,
  path: CanonicalAbsolutePathV1,
  cursor: number,
  collectedAt: number,
  reason: string,
): Promise<void> {
  if (cursor === collectedAt) return;
  const present = (await guardedEntry(lifecycle.fs, path)) !== null;
  if (present === cursor < collectedAt) return;
  refuse(reason, path);
}

/** §2.4 collects the allocator before the nonce, so a nonce alone is the one illegal pair. */
async function admitControlFileMicrostate(
  lifecycle: CliLifecycleContext,
  paths: RuntimePaths,
  required: "microstate" | "absent",
): Promise<void> {
  const nonce = await guardedEntry(lifecycle.fs, stateLeaf(paths, NONCE_LEAF));
  const allocator = await guardedEntry(lifecycle.fs, stateLeaf(paths, ALLOCATOR_LEAF));
  if (required === "absent") {
    if (nonce !== null) refuse("lifecycle_install_nonce_retained", nonce.path);
    if (allocator !== null) refuse("lifecycle_id_allocator_retained", allocator.path);
    return;
  }
  if (nonce === null && allocator !== null) {
    refuse("lifecycle_control_file_state", allocator.path);
  }
}

async function admitRecoveryOnlyState(
  lifecycle: CliLifecycleContext,
  paths: RuntimePaths,
  record: UninstallCoordinatorRecordV1,
): Promise<RecoveryOnlyUninstallV1["arm"]> {
  const plan = record.plan;
  const manifest = plan.participants.manifest;
  const key = plan.participants.redactionKey;
  if (manifest === null || key === null) {
    refuse("lifecycle_coordinator_manifest_arm", plan.authority.productHome);
  }

  if (
    record.state === "envelope_suffix_plan_and_lock" ||
    record.state === "envelope_suffix_plan_only"
  ) {
    await admitControlFileMicrostate(lifecycle, paths, "absent");
    await admitCollectedLeaf(lifecycle, manifest.tombstonePath, 0, -1, "manifest_tombstone_retained");
    await admitCollectedLeaf(lifecycle, key.tombstonePath, 0, -1, "redaction_key_tombstone_retained");
    return "envelope_suffix";
  }
  if (record.state === "pre_journal_orphan") {
    refuse("lifecycle_coordinator_pre_journal_orphan", plan.authority.productHome);
  }

  const journal = record.journal;
  if (journal === null) refuse("lifecycle_coordinator_journal_absent", plan.authority.productHome);
  const cursor = journal.nextStep;
  const preserveBefore = stepIndexOf(plan, "manifest", "preserve_before");
  const commitAbsence = stepIndexOf(plan, "manifest", "commit_absence");
  const finalize = stepIndexOf(plan, "manifest", "finalize_tombstones");
  const keyDelete = stepIndexOf(plan, "redaction_key", "delete");
  if (cursor < preserveBefore) {
    refuse("uninstall_cursor_before_preimage", plan.authority.productHome);
  }

  await admitCollectedLeaf(
    lifecycle,
    manifest.tombstonePath,
    cursor,
    finalize,
    "manifest_tombstone_state",
  );
  await admitCollectedLeaf(
    lifecycle,
    key.tombstonePath,
    cursor,
    key.before.state === "present" ? keyDelete : -1,
    "redaction_key_tombstone_state",
  );

  /**
   * `ManifestStateParticipant` classifies the same inventory — manifest absent, tombstone
   * present — for `after: absent` on either side of `M(commit_absence)`, so `boundaryCrossed`
   * reads `preimage_preserved` while the cursor still rests on that step and compensates. The
   * cursor is therefore the whole witness, and "durable" means it has advanced past it.
   */
  if (cursor <= commitAbsence) return "compensation";
  await admitControlFileMicrostate(lifecycle, paths, "microstate");
  return "force_forward";
}

export async function recoverUninstall(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  dispatch: Extract<UninstallDispatchV1, { kind: "recovery_only" | "v2_coordinator" }>,
  options: UninstallOptions,
  evidence?: BootstrapEvidenceAdmissionV1,
): Promise<CliResult<UninstallResultV1>> {
  const admitted = evidence ?? (await evidenceFor(context));
  return dispatch.kind === "v2_coordinator"
    ? runCoordinatorUninstall(context, lifecycle, dispatch.admitted, admitted, options)
    : resumeUninstall(context, lifecycle, dispatch, admitted, options);
}

async function resumeUninstall(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  dispatch: RecoveryOnlyUninstallV1,
  evidence: BootstrapEvidenceAdmissionV1,
  options: UninstallOptions,
): Promise<CliResult<UninstallResultV1>> {
  const paths = await uninstallRuntimePaths(context);
  if (options.dryRun) {
    return success({
      schemaVersion: 1,
      removed: [],
      restored: [],
      preserved: evidence.retainedPaths,
      retainedBootstrapEvidence: evidence.report.ids,
      transactionId: dispatch.id,
    });
  }

  const request: LifecycleUninstallRequestV1 = {
    context,
    lifecycle,
    key: dispatch.key,
    admitted: null,
    evidence,
    options,
  };
  const holds: UninstallHoldsV1 = {
    global: await lifecycle.locks.acquireExisting(stateLeaf(paths, GLOBAL_LOCK_LEAF)),
    leases: [],
  };
  const removed: string[] = [];
  const preserved: string[] = [];
  try {
    const global = holds.global;
    if (global === null) throw new Error("the uninstall recovery released its global lock");
    /**
     * The hold `dispatchUninstall` inspected under was released before this one was taken, so
     * the arm is re-proved here rather than trusted across the gap.
     */
    const readmitted = await admitRecoveryOnlyUninstall(context, lifecycle, global, evidence);
    if (readmitted === null || readmitted.id !== dispatch.id) {
      refuse("uninstall_recovery_arm_moved", paths.home);
    }
    const recovered = await lifecycle
      .recovery(
        dispatch.key,
        createUninstallAdapters({
          request,
          ...createUninstallParticipants(request),
          afterBoundary: (boundary) => {
            if (boundary.kind === "empty_directory_removed") removed.push(boundary.path);
          },
          holds,
          preserved,
        }),
        residueFrom(evidence),
      )
      .recover(global, { resumeUninstall: true });
    holds.global = recovered.global;
  } finally {
    await releaseUninstallHolds(holds);
  }

  return success({
    schemaVersion: 1,
    removed,
    restored: [],
    preserved: [...new Set([...evidence.retainedPaths, ...preserved])],
    retainedBootstrapEvidence: evidence.report.ids,
    transactionId: dispatch.id,
  });
}
