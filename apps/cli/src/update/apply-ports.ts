import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readlink, realpath, rename, rm, stat, unlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MARKETPLACE_NAME, PLUGIN_NAME } from "@developer-os/adapter-codex";
import {
  assertUpdateCoordinatorDerivation,
  bindRetainedInversePlan,
  checkRetainedRollbackBlobSource,
  constructionPlanHash,
  decodeCanonicalJson,
  decodeRetainedInverseLeaf,
  EXIT_CODES,
  formatAllocatedLifecycleId,
  isRetainedRecordVerification,
  LifecycleRecoveryRequiredError,
  MAXIMUM_ROLLBACK_DOCUMENT_BYTES,
  retainedInversePlanHash,
  retainedRollbackBlobPath,
  rollbackPayloadMetadataPath,
  rollbackPayloadRoot,
  validateBoundedUpdateInversePlan,
  validateRollbackPayloadInventory,
  ManifestStateParticipant,
  MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES,
  MAXIMUM_CONSTRUCTION_PLAN_BYTES,
  MAXIMUM_LEAF_PLAN_BYTES,
  parseCanonicalAbsolutePathText,
  parseLifecycleCoordinatorId,
  parseLowerHexSha256,
  parsePositiveUInt32,
  reserveLifecycleIdBlock,
  TransactionExecutor,
  TransactionStore,
  updateConstructionEvidencePath,
  updateCoordinatorStagingRoot,
  updateLeafPlanHash,
  updateParticipantJournalPath,
  validateActiveReleaseRecord,
  validateBundleManifest,
  validateConstructionBijections,
  validateConstructionFileEvidence,
  validateManifestV2,
  validateReleaseTrustState,
  validateRollbackRecord,
  validateUpdateExecutionPlan,
  type BundlePublicationPlanV1,
  type BundleSourceStagingPlanV1,
  type CanonicalAbsolutePathV1,
  type CanonicalStateFilePlanV1,
  type HeldLifecycleStableLockV1,
  type ImmutableUpdatePlanRefV1,
  type InstallationManifestV2,
  type LifecycleCoordinatorIdV1,
  type LifecycleGuardedEntryV1,
  type LifecycleIdPrefixV1,
  type ExitCode,
  type LowerHexSha256,
  type ManifestPayloadIdentityV1,
  type ManifestStatePlanV1,
  type OwnerExternalEffectPlanV1,
  type OwnerExternalEffectProcessPolicyV1,
  type OwnerUpdatePlanV1,
  type ReleaseBundleManifestV1,
  type ReleaseIdentityV1,
  type RetainedOwnerInverseProjectionV1,
  type RetainedSchemaMigrationInverseProjectionV1,
  type RollbackRecordV1,
  type RollbackPayloadSourceStagingPlanV1,
  type RollbackPayloadStatePlanV1,
  type SchemaMigrationPlanV1,
  type TargetVerificationPlanV1,
  type UpdateCompactionEntryV1,
  type UpdateConstructionFilePlanV1,
  type UpdateConstructionJournalV1,
  type UpdateConstructionPlanV1,
  type UpdateConstructionRetainedRollbackBlobSourceV1,
  type UpdateExecutionPlanV1,
  type UpdateExpectedPayloadRefV1,
  type UpdateFallbackHandoffV1,
  type UpdateInitialJournalRefV1,
  type UpdateLeafPlanKindV1,
  type UpdateLifecycleCoordinatorDependenciesV1,
  type UpdateLifecycleCoordinatorPlanV2,
  type UpdateLifecycleCoordinatorStepV1,
  type UpdateParticipantObservationV1,
  type UpdateStepOwnerV1,
  type UpdateTerminalRetirementPlanV1,
} from "@developer-os/core";
import { inspectSystemPath } from "@developer-os/platform-macos";
import {
  createRedactor,
  nodeSupervisedProcessDependencies,
  sampleNodePlannerProcess,
  spawnNodePlannerChild,
  SupervisedProcessRunner,
  TargetVerifierSupervisor,
  type RedactionScope,
} from "@developer-os/security";

import { createCanonicalPathEvidence } from "../bootstrap/admission.js";
import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import { discoverEachAgent } from "../commands/doctor.js";
import { readConfigFile } from "../config-file.js";
import { readRedactionKey } from "../context.js";
import type { CliContext } from "../context.js";
import { codexPluginTreeHash, inspectCodexRegistration, validateCodexRegistrationRecord } from "../instructions/codex-registration.js";
import type { CodexRegistrationRecordV1 } from "../instructions/codex-registration.js";
import { codexInstructionPaths, resolveVendorHomes } from "../instructions/vendor-homes.js";
import type { VendorHomesV1 } from "../instructions/vendor-homes.js";
import { admitInstalledV2Home, type PreservedManifestV1 } from "../lifecycle/admission.js";
import { lifecycleHomeKeyFromAdmission, residueFrom } from "../lifecycle/context.js";
import type { CliLifecycleContext, LifecycleHomeKeyV1 } from "../lifecycle/context.js";
import { allocatedIdsFrom, cleanAllocatorTemp, gateManifestAdmission } from "../lifecycle/mutation-gate.js";
import type { UpdateApplyPortsV1 } from "./apply.js";
import { BundlePublicationParticipant } from "./bundle-publication.js";
import { BundleSourceExecutor, parentPath as parentOf, sha256Hex } from "./bundle-source.js";
import { codexExecutableResolver, codexRefreshPolicy, resolveCodexExecutable } from "./codex-refresh.js";
import type { CodexExecutableFileSystemV1, CodexExecutableIdentityV1 } from "./codex-refresh.js";
import { codexRegistrationObserver, supervisedOwnerEffectRun } from "./codex-effect-ports.js";
import { composeRollback, composeUpdate, updateManifestAdmission, updateManifestFoundationIds } from "./compose.js";
import type { ComposeDepsV1, ObservedPathV1, RetainedRollbackSetV1, UpdateComposedSourcesV1 } from "./compose.js";
import { UpdateConstructionStore } from "./construction.js";
import type { UpdateConstructionSourcePortV1 } from "./construction.js";
import type { UpdateCodexV1 } from "./context.js";
import { UpdateCoordinatorJournalStore, UpdateStepDispatcher } from "./coordinator.js";
import type { UpdateCompactionHandlersV1, UpdateStepHandlerV1, UpdateStepHandlersV1 } from "./coordinator.js";
import { OwnerExternalEffectParticipant } from "./external-effect.js";
import type { OwnerExternalEffectDependenciesV1, OwnerExternalEffectStepV1 } from "./external-effect.js";
import { UpdateFoundationPort } from "./foundation-port.js";
import { manifestStepHandlers } from "./manifest-handler.js";
import { SchemaMigrationParticipant } from "./migration-participant.js";
import { OwnerUpdateParticipant } from "./owner-participant.js";
import type { OwnerUpdateStepV1 } from "./owner-participant.js";
import { UpdatePlanningRefusal } from "./planning.js";
import type { UpdateHomeV1 } from "./planning.js";
import { removeOrphanTerminalExecutorRecord, UpdateRecoveryExecutorFiles } from "./recovery.js";
import { RollbackPayloadParticipant } from "./rollback-publication.js";
import { RollbackPayloadSourceExecutor } from "./rollback-source.js";
import { UpdateRetirementParticipant } from "./retirement-participant.js";
import { retirementResolvePort } from "./retirement-resolve.js";
import { CanonicalStateParticipant, constructionPayloadIdentity, participantPlanFileHash, runTargetVerifier, UpdateParticipantJournalStore } from "./state-participant.js";
import type { CanonicalStateStepV1, UpdatePayloadIdentityResolverV1 } from "./state-participant.js";

type StepOf<TKind extends UpdateLifecycleCoordinatorStepV1["kind"]> = Extract<UpdateLifecycleCoordinatorStepV1, { readonly kind: TKind }>;

const LOCK_LEAF = ".lifecycle.lock";
const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
const MAX_REGISTRATION_BYTES = 8 * 1024;
const MAX_MANIFEST_BYTES = 67_108_864;
/** The signed bundle manifest's bound, as planning fetches it (16 MiB). */
const MAXIMUM_RETAINED_BUNDLE_MANIFEST_BYTES = 16 * 1024 * 1024;
const APPLIED: UpdateParticipantObservationV1 = { state: "applied" };
const BEFORE: UpdateParticipantObservationV1 = { state: "before" };
const COMPENSATED: UpdateParticipantObservationV1 = { state: "compensated" };
const NODE_TRANSACTION_FILE_SYSTEM = { chmod, link, lstat, mkdir, open, readFile, rename, stat, unlink, utimes };
const decoder = new TextDecoder();

type ManifestFileIdentityV1 = Parameters<ManifestStateParticipant["dependencies"]["guardedUnlinkExact"]>[1];

function refuse(reason: string, code: Exclude<ExitCode, 0>, ...paths: readonly string[]): never {
  throw new UpdatePlanningRefusal(reason, code, paths);
}

function thirdState(reason: string, ...paths: readonly string[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

async function syncParent(lifecycle: CliLifecycleContext, path: CanonicalAbsolutePathV1): Promise<void> {
  const parent = await lifecycle.fs.lstat(parentOf(path));
  if (parent !== null) await lifecycle.fs.syncDirectory(parent);
}

async function unlinkAndSyncParent(lifecycle: CliLifecycleContext, entry: LifecycleGuardedEntryV1, path: CanonicalAbsolutePathV1): Promise<void> {
  await lifecycle.fs.unlinkExact(entry);
  await syncParent(lifecycle, path);
}

function lifecycleOf(context: CliContext): CliLifecycleContext {
  return context.lifecycle ?? refuse("update_lifecycle_unavailable", EXIT_CODES.capabilityUnavailable, context.paths.home);
}

/** The ledger key and bookkeeping residue the V2 closure reads, from the admitted home. */
async function ledgerAuthority(context: CliContext, lifecycle: CliLifecycleContext): Promise<{ readonly key: LifecycleHomeKeyV1; readonly residue: ReturnType<typeof residueFrom> }> {
  const { paths } = context;
  const productHome = parseCanonicalAbsolutePathText(paths.home);
  const preserved = (await lifecycle.fs.lstat(parseCanonicalAbsolutePathText(paths.manifestFile))) === null ? await preservedManifest(lifecycle, productHome) : null;
  const admitted = await admitInstalledV2Home({ fs: lifecycle.fs, paths, manifestAdmission: gateManifestAdmission(context), effectiveUid: lifecycle.effectiveUid, ...(preserved === null ? {} : { preservedManifest: preserved }) });
  const residue = residueFrom(await inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({ productHome: paths.home, stateDirectory: paths.stateDir, initialRoots: [paths.home, paths.stateDir, context.userHome] })));
  return { key: lifecycleHomeKeyFromAdmission(admitted, paths), residue };
}

const COORDINATOR_PLAN_LEAF = /^(lc_[0-9a-f]{64}_[0-9]+)\.plan\.json$/u;

/**
 * Spec 2 §5.3 (NEW-198): from a manifest step's preserve rename until its publish, the live
 * manifest is absent by design and its preimage sits at the plan's tombstone. When the ledger
 * holds exactly one update coordinator whose current cursor (forward or compensating) is a
 * `manifest` step, this returns that step's plan `before` at its tombstone path; admission then
 * reads the tombstone only if it is still that exact inode and hash. Anything else is null, and
 * the absent manifest refuses as before.
 */
async function preservedManifest(lifecycle: CliLifecycleContext, productHome: CanonicalAbsolutePathV1): Promise<PreservedManifestV1 | null> {
  const root = await lifecycle.fs.lstat(parseCanonicalAbsolutePathText(join(productHome, "state", "lifecycle-journals")));
  if (root?.kind !== "directory") return null;
  const ids = (await namesOf(lifecycle, root)).flatMap((name) => COORDINATOR_PLAN_LEAF.exec(name)?.[1] ?? []);
  if (ids.length !== 1) return null;
  const id = ids[0] as LifecycleCoordinatorIdV1;
  const store = new UpdateCoordinatorJournalStore({ fs: lifecycle.fs, productHome, effectiveUid: lifecycle.effectiveUid, uuid: lifecycle.uuid });
  if (await store.isEnvelopeSuffix(id)) return null;
  let read: Awaited<ReturnType<UpdateCoordinatorJournalStore["read"]>>;
  try {
    read = await store.read(id);
  } catch (error) {
    // A sole plan that is not an update plan (V1, malformed) grants no stand-in; the absence stays `manifest_absent`.
    if (error instanceof LifecycleRecoveryRequiredError) return null;
    throw error;
  }
  const { plan, journal } = read;
  const cursor = journal.direction === "forward" ? journal.nextStep : journal.compensationNext;
  const step = cursor === null ? undefined : plan.steps[cursor];
  if (step?.kind !== "manifest" || step.transition === "finalize_tombstones") return null;
  const { execution, leaves, construction } = await reopen(lifecycle, productHome, plan);
  if (execution === null) return null;
  const ref = step.transition === "publish_terminal" ? execution.manifest.terminal : execution.manifest.transitional;
  const manifestPlan = (leaves.get(ref.path) ?? null) as ManifestStatePlanV1 | null;
  const before = manifestPlan?.before;
  if (manifestPlan === null || before?.state !== "present") return null;
  // A staged `before` (the terminal plan's: the transitional postimage) carries no inode; construction evidence alone binds it (D72 P2).
  let identity: { readonly dev: string; readonly ino: string } | null = before.dev !== null && before.ino !== null ? { dev: before.dev, ino: before.ino } : null;
  if (identity === null && before.bytes?.kind === "update_expected" && construction !== null) {
    identity = await constructionPayloadIdentity(lifecycle.fs, lifecycle.effectiveUid, construction)(before.bytes);
  }
  if (identity === null) return null;
  // The cursor only selects the plan. The tombstone being the journalled preimage (exact decimal
  // dev/ino, owner, mode, links, length, hash) is what proves the preserve rename ran.
  const entry = await lifecycle.fs.lstat(manifestPlan.tombstonePath);
  if (
    entry?.kind !== "regular_file" || entry.dev !== identity.dev || entry.ino !== identity.ino || entry.ownerUid !== before.ownerUid ||
    entry.mode !== before.mode || entry.nlink !== before.nlink || entry.size !== before.size
  ) {
    return null;
  }
  const bytes = await lifecycle.fs.readRegular(entry, Number(before.size));
  return sha256Hex(bytes) === before.hash ? { entry, bytes } : null;
}

/** A guarded observation with a content hash for a regular file and a target hash for a symlink. */
async function observePath(lifecycle: CliLifecycleContext, path: CanonicalAbsolutePathV1): Promise<ObservedPathV1 | null> {
  const entry = await lifecycle.fs.lstat(path);
  if (entry === null) return null;
  if (entry.kind === "regular_file") return { entry, sha256: await lifecycle.fs.hashRegular(entry, BigInt(entry.size)) };
  if (entry.kind === "other") {
    const target = await readlink(path, { encoding: "buffer" }).catch(() => null);
    return { entry: target === null ? entry : { ...entry, size: String(target.byteLength) as LifecycleGuardedEntryV1["size"] }, sha256: target === null ? null : sha256Hex(target) };
  }
  return { entry, sha256: null };
}

function redactorOf(context: CliContext): Promise<ReturnType<typeof createRedactor>> {
  const key = readRedactionKey(context.paths.stateDir) ?? refuse("update_redaction_key_absent", EXIT_CODES.recoveryRequired, context.paths.stateDir);
  return readConfigFile(context, context.paths.configFile).then((config) => createRedactor(key, { userPatterns: config?.redaction?.patterns ?? [] }));
}

// ---------------------------------------------------------------------------------------------
// Codex (P6): the discovered `codex`, pinned at its real path, and the closed refresh's runtime.
// ---------------------------------------------------------------------------------------------

function codexFileSystem(lifecycle: CliLifecycleContext): CodexExecutableFileSystemV1 {
  return { realpath, inspect: inspectSystemPath, effectiveUid: lifecycle.effectiveUid };
}

async function discoveredCodex(context: CliContext): Promise<string | null> {
  const outcome = (await discoverEachAgent(context)).find((candidate) => candidate.name === "codex");
  return outcome?.discovery?.installed === true ? outcome.discovery.executablePath : null;
}

function codexHomes(context: CliContext): VendorHomesV1 {
  return resolveVendorHomes(context.env, context.userHome, context.paths.home);
}

interface CodexRuntimeV1 {
  readonly executable: CodexExecutableIdentityV1;
  readonly effect: Omit<OwnerExternalEffectDependenciesV1, "journals" | "stagingRoot" | "now">;
  /** Removes the private effect TMPDIR; the runtime's owner calls it once its effect work is done. */
  readonly dispose: () => Promise<void>;
}

/** The effect participant's ports for `policy`; the executable must still be the plan's pinned identity. */
async function codexRuntime(context: CliContext, lifecycle: CliLifecycleContext, policy: OwnerExternalEffectProcessPolicyV1 | null): Promise<CodexRuntimeV1 | null> {
  const discovered = await discoveredCodex(context);
  if (discovered === null) return null;
  const fsDeps = codexFileSystem(lifecycle);
  const executable = await resolveCodexExecutable(parseCanonicalAbsolutePathText(discovered), fsDeps);
  const pinned = policy ?? codexRefreshPolicy(executable);
  const homes = codexHomes(context);
  const redactor = await redactorOf(context);
  const privateEffectTmp = await mkdtemp(join(tmpdir(), "developer-os-effect-"));
  const tokens = { managedPluginRoot: codexInstructionPaths(homes).pluginRoot, pluginId: PLUGIN_ID, privateEffectTmp, managedVendorHome: homes.codexHome };
  const resolveExecutable = codexExecutableResolver(executable, fsDeps);
  const run = supervisedOwnerEffectRun(new SupervisedProcessRunner(nodeSupervisedProcessDependencies));
  const observe = codexRegistrationObserver({ policy: pinned, tokens, resolveExecutable, run, screen: (text) => redactor(text).findings.length > 0 });
  return { executable, effect: { tokens, observe, resolveExecutable, run, redact: (text) => redactor(text).text }, dispose: () => rm(privateEffectTmp, { recursive: true, force: true }) };
}

/** `CliUpdateContext.codex`: the planning-time registration state, policy, and current projection. */
export function updateCodexPort(context: CliContext): () => Promise<UpdateCodexV1 | null> {
  return async () => {
    const lifecycle = lifecycleOf(context);
    const runtime = await codexRuntime(context, lifecycle, null);
    if (runtime === null) return null;
    try {
      return await codexPlanningState(context, lifecycle, runtime);
    } finally {
      await runCleanups([runtime.dispose]);
    }
  };
}

/**
 * The installed manifest and the Codex registration record planning reads: bounded, never through a
 * symlink, and the manifest admitted by its validator (W2-PORTS-7).
 */
export async function codexPlanningInputs(
  lifecycle: Pick<CliLifecycleContext, "fs" | "effectiveUid">,
  manifestFile: CanonicalAbsolutePathV1,
  registrationFile: CanonicalAbsolutePathV1,
  admit: (value: unknown) => InstallationManifestV2,
): Promise<{ readonly manifest: InstallationManifestV2; readonly record: CodexRegistrationRecordV1 | null }> {
  const manifestBytes = await readBound(lifecycle, manifestFile, MAX_MANIFEST_BYTES) ?? thirdState("update_manifest_absent", manifestFile);
  const manifest = admit(decodeCanonicalJson(manifestBytes, MAX_MANIFEST_BYTES));
  // An absent, non-regular, oversized or malformed record is the `unregistered` state `inspectCodexRegistration` reports.
  const entry = await lifecycle.fs.lstat(registrationFile);
  if (entry?.kind !== "regular_file" || BigInt(entry.size) > BigInt(MAX_REGISTRATION_BYTES)) return { manifest, record: null };
  try {
    return { manifest, record: validateCodexRegistrationRecord(await lifecycle.fs.readRegular(entry, MAX_REGISTRATION_BYTES)) };
  } catch {
    return { manifest, record: null };
  }
}

async function codexPlanningState(context: CliContext, lifecycle: CliLifecycleContext, runtime: CodexRuntimeV1): Promise<UpdateCodexV1> {
  const homes = codexHomes(context);
  const { pluginRoot, registrationFile } = codexInstructionPaths(homes);
  const policy = codexRefreshPolicy(runtime.executable);
  const { manifest, record } = await codexPlanningInputs(lifecycle, parseCanonicalAbsolutePathText(context.paths.manifestFile), parseCanonicalAbsolutePathText(registrationFile), (value) => validateManifestV2(value, gateManifestAdmission(context)));
  const tree = manifest.artifacts.flatMap((artifact) =>
    artifact.path.startsWith(`${pluginRoot}/`) && artifact.kind !== "directory" && artifact.verification.mode === "content"
      ? [{ path: artifact.path.slice(pluginRoot.length + 1), sha256: artifact.verification.installedHash }]
      : []);
  const registration = tree.length === 0
    ? "unregistered"
    : await inspectCodexRegistration({ runner: context.runner, codexExecutable: runtime.executable.canonicalPath, codexHome: homes.codexHome, pluginRoot, record, treeHash: codexPluginTreeHash(tree) });
  return { homes, registration, policy, projection: await runtime.effect.observe() };
}

// ---------------------------------------------------------------------------------------------
// Reopened plans: every leaf is hash-bound by the outer plan, so bytes are rechecked, not trusted.
// ---------------------------------------------------------------------------------------------

async function readBound(lifecycle: Pick<CliLifecycleContext, "fs" | "effectiveUid">, path: CanonicalAbsolutePathV1, maximumBytes: number): Promise<Uint8Array | null> {
  const entry = await lifecycle.fs.lstat(path);
  if (entry === null) return null;
  if (entry.kind !== "regular_file" || entry.ownerUid !== lifecycle.effectiveUid || entry.mode !== 0o600 || entry.nlink !== 1 || BigInt(entry.size) > BigInt(maximumBytes)) thirdState("update_leaf_shape", path);
  return lifecycle.fs.readRegular(entry, maximumBytes);
}

async function readLeaf(lifecycle: CliLifecycleContext, ref: ImmutableUpdatePlanRefV1): Promise<unknown> {
  const bytes = await readBound(lifecycle, ref.path, MAXIMUM_LEAF_PLAN_BYTES);
  if (bytes === null) return null;
  if (bytes.byteLength !== ref.bytes || updateLeafPlanHash(ref.kind, bytes) !== ref.hash) thirdState("update_leaf_hash", ref.path);
  return decodeCanonicalJson(bytes, MAXIMUM_LEAF_PLAN_BYTES);
}

interface ReopenedV1 {
  readonly execution: UpdateExecutionPlanV1 | null;
  readonly construction: UpdateConstructionPlanV1 | null;
  readonly leaves: ReadonlyMap<string, unknown>;
  readonly owners: readonly UpdateStepOwnerV1[];
}

/** The execution leaf binds its own terminal fallback record, so a recovery admits it against that. */
function executionFallback(value: unknown): UpdateFallbackHandoffV1 {
  const executor = (value as { readonly recoveryExecutor?: { readonly terminal?: { readonly executor?: Record<string, unknown> } } }).recoveryExecutor?.terminal?.executor;
  if (executor === undefined) return thirdState("update_execution_shape");
  return { bundleManifestHash: parseLowerHexSha256(executor.bundleManifestHash), launcherProtocol: parsePositiveUInt32(executor.launcherProtocol), updateProtocol: parsePositiveUInt32(executor.updateProtocol) };
}

async function reopenConstruction(lifecycle: CliLifecycleContext, plan: UpdateLifecycleCoordinatorPlanV2): Promise<UpdateConstructionPlanV1 | null> {
  const bytes = await readBound(lifecycle, plan.construction.path, MAXIMUM_CONSTRUCTION_PLAN_BYTES);
  if (bytes === null) return null;
  const construction = decodeCanonicalJson(bytes, MAXIMUM_CONSTRUCTION_PLAN_BYTES) as unknown as UpdateConstructionPlanV1;
  validateConstructionBijections(construction);
  if (constructionPlanHash(construction) !== plan.construction.hash) thirdState("update_construction_plan", plan.construction.path);
  return construction;
}

async function reopen(lifecycle: CliLifecycleContext, productHome: CanonicalAbsolutePathV1, plan: UpdateLifecycleCoordinatorPlanV2): Promise<ReopenedV1> {
  const evidence = createCanonicalPathEvidence();
  const raw = await readLeaf(lifecycle, plan.update);
  const construction = await reopenConstruction(lifecycle, plan);
  // ponytail: a leaf removed by its own compaction entry is absent; only `coordinator_staging` still runs, over the construction plan.
  if (raw === null) return { execution: null, construction, leaves: new Map(), owners: [] };
  const execution = validateUpdateExecutionPlan(raw, { productHome, evidence, fallback: executionFallback(raw) });
  const leaves = new Map<string, unknown>();
  const refs: readonly ImmutableUpdatePlanRefV1[] = [execution.bundle, ...execution.owners, ...execution.migrations, execution.manifest.transitional, execution.manifest.terminal, ...(execution.trust === null ? [] : [execution.trust]), execution.active, execution.rollback, execution.rollbackPayload, execution.verification, execution.retirement];
  for (const ref of refs) leaves.set(ref.path, await readLeaf(lifecycle, ref));
  const owners: UpdateStepOwnerV1[] = [];
  for (const ref of execution.owners) {
    const owner = leaves.get(ref.path) as OwnerUpdatePlanV1 | null;
    if (owner === null) continue;
    for (const effect of owner.externalEffects) leaves.set(effect.path, await readLeaf(lifecycle, effect));
    owners.push({ id: owner.id, owner: owner.owner, externalEffects: owner.externalEffects.map((effect) => ({ id: effect.id })) });
  }
  return { execution, construction, leaves, owners };
}

// ---------------------------------------------------------------------------------------------
// The step dispatcher over the reopened plans.
// ---------------------------------------------------------------------------------------------

interface DispatchContextV1 {
  readonly context: CliContext;
  readonly lifecycle: CliLifecycleContext;
  readonly productHome: CanonicalAbsolutePathV1;
  readonly root: CanonicalAbsolutePathV1;
  readonly global: () => HeldLifecycleStableLockV1;
  readonly reopened: ReopenedV1;
  /** Runs `cleanup` when the global lock this dispatch runs under is released. */
  readonly defer: (cleanup: () => Promise<void>) => void;
}

function journalRef(execution: UpdateExecutionPlanV1, kind: UpdateInitialJournalRefV1["kind"], id: string): UpdateInitialJournalRefV1 {
  return execution.initialParticipantJournals.find((ref) => ref.kind === kind && ref.id === id) ?? thirdState("update_initial_journal_missing", id);
}

function unsupported(reason: string): never {
  return refuse(reason, EXIT_CODES.capabilityUnavailable);
}

/** Every forward step's production handler (Task 10); rollback's retained-verification arms are Task 11's. */
async function dispatcherOf(dispatch: DispatchContextV1): Promise<UpdateStepDispatcher> {
  const { context, lifecycle, root, reopened } = dispatch;
  const execution = reopened.execution ?? thirdState("update_execution_absent", root);
  const { fs, effectiveUid } = lifecycle;
  const now = (): Date => context.now();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a typed view over one heterogeneous, hash-checked leaf map
  const leaf = <T>(ref: ImmutableUpdatePlanRefV1): T | null => (reopened.leaves.get(ref.path) ?? null) as T | null;
  const journals = new UpdateParticipantJournalStore({ fs, effectiveUid });
  const constructionPlan = reopened.construction;
  const payloadIdentity = constructionPlan === null ? () => thirdState("update_construction_plan_absent", root) : constructionPayloadIdentity(fs, effectiveUid, constructionPlan);
  const hashTarget = async (path: CanonicalAbsolutePathV1): Promise<LowerHexSha256 | null> => {
    const entry = await lifecycle.fs.lstat(path);
    return entry?.kind === "regular_file" ? fs.hashRegular(entry, BigInt(entry.size)) : null;
  };
  const foundation = new UpdateFoundationPort({
    fs,
    roots: lifecycle.roots,
    executor: new TransactionExecutor({
      stateDir: context.paths.stateDir,
      stagingDir: context.paths.stagingDir,
      backupsDir: context.paths.backupsDir,
      fs: context.fs,
      clock: () => context.now().toISOString(),
      generateId: () => thirdState("update_foundation_id_allocated"),
      guards: context.guards.transaction,
      lockProvider: lifecycle.transactionLocks,
      publishBootstrapInitialJournalNoReplace: lifecycle.renameNoReplace,
    }),
    store: new TransactionStore({ stateDir: context.paths.stateDir, fs: NODE_TRANSACTION_FILE_SYSTEM, lockProvider: lifecycle.transactionLocks }),
    global: dispatch.global(),
    effectiveUid,
    evidence: async (ordinal) => {
      if (constructionPlan === null) return thirdState("update_construction_plan_absent", root);
      const path = updateConstructionEvidencePath(root, ordinal);
      const bytes = await readBound(lifecycle, path, MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES) ?? thirdState("update_construction_evidence_absent", path);
      const found = validateConstructionFileEvidence(bytes, constructionPlan, ordinal);
      return { dev: found.dev, ino: found.ino };
    },
  });

  // Owners and their Codex effect.
  const ownerSteps = new Map<string, OwnerUpdateStepV1>();
  let effectPolicy: OwnerExternalEffectProcessPolicyV1 | null = null;
  for (const ref of execution.owners) {
    const plan = leaf<OwnerUpdatePlanV1>(ref);
    if (plan === null) continue;
    const effectRef = plan.externalEffects[0];
    const effectPlan = effectRef === undefined ? null : leaf<OwnerExternalEffectPlanV1>(effectRef);
    const effect: OwnerExternalEffectStepV1 | null = effectRef === undefined || effectPlan === null ? null : { plan: effectPlan, planRef: effectRef, journal: journalRef(execution, "owner_external_effect", effectRef.id) };
    if (effect !== null) effectPolicy = effect.plan.processPolicy;
    ownerSteps.set(plan.owner, { plan, planRef: ref, journal: journalRef(execution, "owner_update", ref.id), effect });
  }
  const runtime = effectPolicy === null ? null : await codexRuntime(context, lifecycle, effectPolicy);
  if (runtime !== null) dispatch.defer(runtime.dispose);
  const effects = new OwnerExternalEffectParticipant({
    journals,
    stagingRoot: root,
    now,
    ...(runtime?.effect ?? {
      tokens: { managedPluginRoot: "", pluginId: PLUGIN_ID, privateEffectTmp: "", managedVendorHome: "" },
      observe: () => unsupported("update_codex_unavailable"),
      resolveExecutable: () => unsupported("update_codex_unavailable"),
      run: () => unsupported("update_codex_unavailable"),
      redact: (text: string) => text,
    }),
  });
  const owners = new OwnerUpdateParticipant({ journals, foundation, effects, hashTarget, now });
  const ownerStep = (owner: string): OwnerUpdateStepV1 => ownerSteps.get(owner) ?? thirdState("update_owner_plan_absent", owner);

  // Migrations.
  const migrationSteps = new Map<string, { readonly plan: SchemaMigrationPlanV1; readonly planRef: ImmutableUpdatePlanRefV1<"schema_migration">; readonly journal: UpdateInitialJournalRefV1 }>(execution.migrations.flatMap((ref) => {
    const plan = leaf<SchemaMigrationPlanV1>(ref);
    return plan === null ? [] : [[plan.id, { plan, planRef: ref, journal: journalRef(execution, "schema_migration", ref.id) }] as const];
  }));
  const migrations = new SchemaMigrationParticipant({ journals, foundation, hashTarget, brainRoot: brainRootOf(context), now });
  const migrationStep = (id: string) => migrationSteps.get(id) ?? thirdState("update_migration_plan_absent", id);

  // Canonical state files.
  const state = new CanonicalStateParticipant({ fs, journals, effectiveUid, now, payloadIdentity, validateBytes: (role, bytes) => {
    validateStateBytes(role, bytes);
  } });
  const stateStep = (ref: ImmutableUpdatePlanRefV1<"release_trust_state" | "active_release_state" | "rollback_record_state"> | null): CanonicalStateStepV1 | null => {
    const plan = ref === null ? null : leaf<CanonicalStateFilePlanV1>(ref);
    return ref === null || plan === null ? null : { plan, planRef: ref, journal: journalRef(execution, ref.kind, ref.id) };
  };
  const trustStep = stateStep(execution.trust);
  const activeStep = stateStep(execution.active);
  const recordStep = stateStep(execution.rollback);

  // Bundle, rollback payload, manifests, verifier, retirement.
  const bundleDeps = { fs, effectiveUid, now };
  const bundle = new BundlePublicationParticipant({ ...bundleDeps, payloadIdentity }, root);
  const bundlePlan = leaf<BundlePublicationPlanV1>(execution.bundle);
  const bundleJournal = journalRef(execution, "bundle_publication", execution.bundle.id);
  const payload = new RollbackPayloadParticipant(bundleDeps, root);
  const payloadPlan = leaf<RollbackPayloadStatePlanV1>(execution.rollbackPayload);
  const payloadJournal = journalRef(execution, "rollback_payload_state", execution.rollbackPayload.id);
  const transitional = leaf<ManifestStatePlanV1>(execution.manifest.transitional);
  const terminal = leaf<ManifestStatePlanV1>(execution.manifest.terminal);
  const retirementPlan = leaf<UpdateTerminalRetirementPlanV1>(execution.retirement);
  const verification = leaf<TargetVerificationPlanV1>(execution.verification);
  const transitionalManifest = constructionPlan === null || transitional === null ? null : manifestValueOf(constructionPlan, transitional);
  const retired = transitionalManifest === null || retirementPlan === null ? [] : transitionalManifest.artifacts.filter((row) => retirementPlan.entries.some((entry) => row.path === entry.root || row.path.startsWith(`${entry.root}/`)));
  const ownerPlans = [...ownerSteps.values()].map((step) => step.plan);
  const manifestParticipant = await manifestParticipantOf(dispatch, ownerPlans, [transitional, terminal].filter((plan) => plan !== null), payloadIdentity);
  const manifestHandlers = transitional === null || terminal === null
    ? { manifest: { apply: () => thirdState("update_manifest_plan_absent"), observe: () => thirdState("update_manifest_plan_absent"), compensate: () => thirdState("update_manifest_plan_absent") } }
    : manifestStepHandlers({ transitional, terminal }, retired, {
      participant: manifestParticipant,
      readManifest: async (path, hash) => {
        const bytes = await readBound(lifecycle, path, MAX_MANIFEST_BYTES) ?? thirdState("update_manifest_absent", path);
        if (sha256Hex(bytes) !== hash) thirdState("update_manifest_hash", path);
        return decodeCanonicalJson(bytes, MAX_MANIFEST_BYTES) as unknown as InstallationManifestV2;
      },
      removeTombstone: (path, expected) => guardedUnlink(lifecycle, path, expected),
    });

  const stateHandler = (step: CanonicalStateStepV1 | null, releaseReservation: boolean): UpdateStepHandlerV1<unknown> => ({
    apply: async () => {
      const found = step ?? thirdState("update_state_plan_absent", root);
      if (releaseReservation) await releaseEmptyReservation(lifecycle, found.plan);
      return state.apply(found);
    },
    observe: () => state.observe(step ?? thirdState("update_state_plan_absent", root)),
    compensate: () => state.compensate(step ?? thirdState("update_state_plan_absent", root)),
  });

  const steps: UpdateStepHandlersV1 = {
    bundle: {
      // `verify_previous` walks the retained bundle through the same participant and mutates nothing.
      apply: async (step: StepOf<"bundle">) => {
        const plan = bundlePlan ?? thirdState("update_bundle_plan_absent", root);
        if (plan.action !== step.action) thirdState("update_bundle_action", root);
        await journals.open(bundleJournal);
        await bundle.apply(plan);
        return APPLIED;
      },
      observe: async () => ((await journals.unreached(bundleJournal)) ? BEFORE : APPLIED),
      compensate: async () => {
        if (await journals.unreached(bundleJournal)) return BEFORE;
        await bundle.compensate(bundlePlan ?? thirdState("update_bundle_plan_absent", root));
        return COMPENSATED;
      },
    },
    // Either inverse step restores the files, then refreshes Codex over the previous tree; the journal makes the second a no-op.
    owner_files: {
      apply: (step) => (step.direction === "inverse" ? owners.apply(ownerStep(step.owner)) : owners.applyFiles(ownerStep(step.owner))),
      observe: (step) => owners.observe(ownerStep(step.owner)),
      compensate: (step) => owners.compensate(ownerStep(step.owner)),
    },
    owner_external_effect: {
      apply: (step) => (step.direction === "inverse" ? owners.apply(ownerStep(step.owner)) : owners.applyEffects(ownerStep(step.owner))),
      observe: (step) => owners.observe(ownerStep(step.owner)),
      compensate: (step) => owners.compensate(ownerStep(step.owner)),
    },
    schema_migration: {
      apply: (step) => migrations.apply(migrationStep(step.id)),
      observe: (step) => migrations.observe(migrationStep(step.id)),
      compensate: (step) => migrations.compensate(migrationStep(step.id)),
    },
    manifest: manifestHandlers.manifest,
    trust: stateHandler(trustStep, false),
    rollback_payload: {
      apply: async (step: StepOf<"rollback_payload">) => {
        const plan = payloadPlan ?? thirdState("update_rollback_payload_plan_absent", root);
        if ((plan.publish === null) !== (step.transition === "verify_retained")) thirdState("update_rollback_payload_transition", root);
        await journals.open(payloadJournal);
        if (plan.publish === null) await payload.verifyRetained(plan);
        else await payload.publish(plan);
        return APPLIED;
      },
      observe: async () => ((await journals.unreached(payloadJournal)) ? BEFORE : APPLIED),
      compensate: async () => {
        if (await journals.unreached(payloadJournal)) return BEFORE;
        await payload.compensate(payloadPlan ?? thirdState("update_rollback_payload_plan_absent", root));
        return COMPENSATED;
      },
    },
    rollback_record: {
      ...stateHandler(recordStep, true),
      apply: async (step: StepOf<"rollback_record">) => {
        const found = recordStep ?? thirdState("update_state_plan_absent", root);
        if (isRetainedRecordVerification(found.plan) !== (step.transition === "verify_retained")) thirdState("update_rollback_record_transition", root);
        if (step.transition === "verify_retained") return state.verifyRetained(found);
        return stateHandler(recordStep, true).apply(step);
      },
    },
    // `publish_previous` is the same state transition over the previous release's record.
    active: stateHandler(activeStep, false),
    // The execution's target is the update target, or the previous release a rollback returns to.
    target_verifier: {
      apply: async (step: StepOf<"target_verifier">) => {
        const plan = verification ?? thirdState("update_verification_plan_absent", root);
        const release = execution.operation === "update_apply" ? "target" : "previous";
        if (step.release !== release || plan.release.releaseIdentityHash !== execution.target.releaseIdentityHash) thirdState("update_verification_release", root);
        // The bounded read-only snapshot of the home: the installed manifest (no-follow, at most `plan.inputBytes`) and the reopened owner and migration plans with their effects.
        const manifest = await readBound(lifecycle, parseCanonicalAbsolutePathText(context.paths.manifestFile), plan.inputBytes) ?? thirdState("update_manifest_absent", context.paths.manifestFile);
        const snapshot = {
          manifest: Buffer.from(manifest).toString("base64"),
          owners: execution.owners.flatMap((ref) => {
            const ownerPlan = leaf<OwnerUpdatePlanV1>(ref);
            return ownerPlan === null ? [] : [{ ref, plan: ownerPlan, effects: ownerPlan.externalEffects.map((effect) => ({ ref: effect, plan: leaf<OwnerExternalEffectPlanV1>(effect) ?? thirdState("update_owner_effect_plan_absent", effect.id) })) }];
          }),
          migrations: execution.migrations.flatMap((ref) => {
            const migrationPlan = leaf<SchemaMigrationPlanV1>(ref);
            return migrationPlan === null ? [] : [{ ref, plan: migrationPlan }];
          }),
        };
        return runTargetVerifier(plan, await verifierPort(context, lifecycle, snapshot));
      },
      observe: () => Promise.resolve(BEFORE),
      compensate: () => Promise.resolve(BEFORE),
    },
  };

  // A final journal this entry already removed must not be reopened: only its plan leaf remains.
  const finalizeThenCompact = async (journal: UpdateInitialJournalRefV1, observe: () => Promise<UpdateParticipantObservationV1>, finalize: () => Promise<void>, compact: () => Promise<void>): Promise<void> => {
    if ((await journals.exists(journal.finalPath)) && (await observe()).state === "verified") await finalize();
    await compact();
  };
  // The plan leaf goes first: a retry that still opens it would compact against a journal already gone.
  const removeLeaf = async (ref: ImmutableUpdatePlanRefV1, plan: unknown, journal: UpdateInitialJournalRefV1 | null): Promise<void> => {
    if (plan !== null) await journals.remove(ref.path, participantPlanFileHash(ref, plan));
    if (journal !== null) {
      await journals.remove(journal.stagedPath);
      await journals.remove(journal.finalPath);
    }
  };
  const compaction: UpdateCompactionHandlersV1 = {
    owner_update: async (entry) => {
      const step = ownerSteps.get(entry.owner);
      if (step === undefined) return;
      await finalizeThenCompact(step.journal, () => owners.observe(step), () => owners.finalize(step), () => owners.compact(step));
      await journals.remove(step.journal.stagedPath);
    },
    schema_migration: async (entry) => {
      const step = migrationSteps.get(entry.id);
      if (step === undefined) return;
      await finalizeThenCompact(step.journal, () => migrations.observe(step), () => migrations.finalize(step), () => migrations.compact(step));
      await journals.remove(step.journal.stagedPath);
    },
    owner_external_effect: async (entry) => {
      const step = [...ownerSteps.values()].find((candidate) => candidate.effect?.plan.id === entry.id)?.effect;
      if (step === undefined || step === null) return;
      await effects.compact(step);
      await journals.remove(step.journal.stagedPath);
    },
    state_participant: async (entry) => {
      await compactState(entry);
    },
    coordinator_staging: async () => {
      await compactStaging(dispatch);
    },
  };

  async function compactState(entry: Extract<UpdateCompactionEntryV1, { readonly kind: "state_participant" }>): Promise<void> {
    switch (entry.participant) {
      case "bundle": {
        if (bundlePlan !== null && !(await journals.unreached(bundleJournal))) await bundle.compact(bundlePlan);
        await removeUnconsumedPayloads(journals, bundlePlan?.metadata.flatMap((row) => (row.after.state === "present" && row.after.payload !== null ? [row.after.payload.path] : [])) ?? []);
        await removeLeaf(entry.plan, bundlePlan, bundleJournal);
        return;
      }
      case "rollback_payload": {
        const phase = payloadPlan === null || (await journals.unreached(payloadJournal)) ? null : (await journals.readAt(payloadJournal.finalPath) as { readonly phase?: unknown }).phase;
        // A verify-only plan published nothing and `terminal_retire` alone owns the consumed payload; a compensated publication left nothing.
        if (payloadPlan !== null && payloadPlan.publish !== null && phase !== null && phase !== "rolled_back") await payload.compact(payloadPlan);
        await removeLeaf(entry.plan, payloadPlan, payloadJournal);
        return;
      }
      case "manifest": {
        const plan = leaf<ManifestStatePlanV1>(entry.plan);
        if (plan !== null && plan.after.state === "present" && plan.after.bytes !== null) await removeUnconsumedPayloads(journals, [plan.after.bytes.path]);
        await removeLeaf(entry.plan, plan, null);
        return;
      }
      default: {
        const step = entry.participant === "trust" ? trustStep : entry.participant === "active" ? activeStep : recordStep;
        if (step === null) return;
        await finalizeThenCompact(step.journal, () => state.observe(step), () => state.finalize(step), () => state.compact(step));
        await journals.remove(step.journal.stagedPath);
      }
    }
  }

  const retirement = retirementPlan === null || transitionalManifest === null
    ? { leaves: () => thirdState("update_retirement_plan_absent"), retire: () => thirdState("update_retirement_plan_absent") }
    : new UpdateRetirementParticipant({ fs, effectiveUid, resolve: retirementResolvePort(dispatch.productHome, transitionalManifest) }, root, execution.retirement);
  return new UpdateStepDispatcher(steps, compaction, retirement);
}

function brainRootOf(context: CliContext): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(context.paths.brain);
}

/** The strict codec of each state role, over reopened bytes. */
function validateStateBytes(role: CanonicalStateFilePlanV1["role"], bytes: Uint8Array): void {
  const value = decodeCanonicalJson(bytes, 67_108_864);
  if (role === "active_release") validateActiveReleaseRecord(value, createCanonicalPathEvidence());
  else if (role === "release_trust") validateReleaseTrustState(value);
  else if (role === "rollback_record") validateRollbackRecord(value, createCanonicalPathEvidence());
  else thirdState("update_state_role");
}

/**
 * §6.4's empty reservation holds no record, so the plan names it absent; its exact empty inode is
 * released before the first transition so the no-replace publication can land.
 * ponytail: the release is unjournaled; a compensated update leaves the reservation absent, which
 * the ephemeral manifest row admits (P5).
 */
async function releaseEmptyReservation(lifecycle: CliLifecycleContext, plan: CanonicalStateFilePlanV1): Promise<void> {
  if (plan.before.state !== "absent") return;
  const entry = await lifecycle.fs.lstat(plan.path);
  if (entry === null) return;
  if (entry.kind !== "regular_file" || entry.size !== "0" || entry.ownerUid !== lifecycle.effectiveUid || entry.nlink !== 1) return;
  await unlinkAndSyncParent(lifecycle, entry, plan.path);
}

async function removeUnconsumedPayloads(journals: UpdateParticipantJournalStore, paths: readonly CanonicalAbsolutePathV1[]): Promise<void> {
  for (const path of paths) await journals.remove(path);
}

/** Temporary-directory cleanups, each isolated: none may replace the operation's result or skip the rest. */
export async function runCleanups(cleanups: readonly (() => Promise<void>)[]): Promise<void> {
  for (const cleanup of cleanups) {
    // Swallowed on purpose: a leaked temporary directory is inert, while failing a finalized update over it is not.
    await cleanup().catch(() => undefined);
  }
}

export function matchesManifestFileIdentity(entry: LifecycleGuardedEntryV1 | null, expected: ManifestFileIdentityV1): entry is LifecycleGuardedEntryV1 {
  return entry?.kind === "regular_file" && entry.dev === expected.dev && entry.ino === expected.ino && entry.size === expected.size && entry.ownerUid === expected.ownerUid && entry.mode === expected.mode && entry.nlink === expected.nlink;
}

async function guardedUnlink(lifecycle: CliLifecycleContext, path: CanonicalAbsolutePathV1, expected: ManifestFileIdentityV1): Promise<void> {
  const entry = await lifecycle.fs.lstat(path);
  if (entry === null) return;
  if (!matchesManifestFileIdentity(entry, expected)) thirdState("manifest_bytes_identity", path);
  if ((await lifecycle.fs.hashRegular(entry, BigInt(expected.size))) !== expected.hash) thirdState("manifest_bytes_hash", path);
  await unlinkAndSyncParent(lifecycle, entry, path);
}

/** The transitional manifest value is the construction row's own plan-derived bytes. */
function manifestValueOf(construction: UpdateConstructionPlanV1, plan: ManifestStatePlanV1): InstallationManifestV2 | null {
  if (plan.after.state !== "present" || plan.after.bytes === null) return null;
  const row = construction.files[plan.after.bytes.ordinal];
  if (row?.role.kind !== "payload" || row.role.source.kind !== "plan_derived" || row.role.source.role !== "manifest_after") return thirdState("update_manifest_row", plan.manifestPath);
  return decodeCanonicalJson(new TextEncoder().encode(row.role.source.value), MAX_MANIFEST_BYTES) as unknown as InstallationManifestV2;
}

/** The codec asks synchronously, so every manifest plan's `update_expected` payload inode is read from its construction evidence up front. */
export async function manifestPayloadIdentities(plans: readonly ManifestStatePlanV1[], resolve: UpdatePayloadIdentityResolverV1): Promise<(ref: UpdateExpectedPayloadRefV1) => ManifestPayloadIdentityV1> {
  const resolved = new Map<number, ManifestPayloadIdentityV1>();
  for (const plan of plans) {
    for (const state of [plan.before, plan.after]) {
      if (state.state !== "present" || state.bytes?.kind !== "update_expected" || resolved.has(state.bytes.ordinal)) continue;
      resolved.set(state.bytes.ordinal, await resolve(state.bytes));
    }
  }
  return (ref) => resolved.get(ref.ordinal) ?? thirdState("update_manifest_payload_row", ref.path);
}

async function manifestParticipantOf(dispatch: DispatchContextV1, ownerPlans: readonly OwnerUpdatePlanV1[], plans: readonly ManifestStatePlanV1[], payloadIdentity: UpdatePayloadIdentityResolverV1): Promise<(plan: ManifestStatePlanV1) => ManifestStateParticipant> {
  const { lifecycle, context, productHome } = dispatch;
  const updatePayloadIdentity = await manifestPayloadIdentities(plans, payloadIdentity);
  const identityOf = async (path: CanonicalAbsolutePathV1, expected: ManifestFileIdentityV1): Promise<LifecycleGuardedEntryV1> => {
    const entry = await lifecycle.fs.lstat(path);
    if (!matchesManifestFileIdentity(entry, expected)) return thirdState("manifest_bytes_identity", path);
    if ((await lifecycle.fs.hashRegular(entry, BigInt(expected.size))) !== expected.hash) thirdState("manifest_bytes_hash", path);
    return entry;
  };
  return (plan) => {
    const terminalPlan = plan.bindings.foundationTransactions.count === 0 && plan.bindings.externalEffects.length === 0;
    return new ManifestStateParticipant({
      fs: { lstat, open },
      guardedMoveNoReplace: async (source, destination, expected) => {
        await lifecycle.fs.renameNoReplace(await identityOf(source, expected), destination);
      },
      guardedUnlinkExact: async (path, expected) => {
        await lifecycle.fs.unlinkExact(await identityOf(path, expected));
      },
      admission: updateManifestAdmission({
        productHome,
        evidence: createCanonicalPathEvidence(),
        coordinatorId: plan.envelope.id as LifecycleCoordinatorIdV1,
        foundationTransactionIds: terminalPlan ? [] : updateManifestFoundationIds(ownerPlans),
        externalEffects: plan.bindings.externalEffects,
        updatePayloadIdentity,
      }),
      uid: lifecycle.effectiveUid,
      manifestAdmission: gateManifestAdmission(context),
    });
  };
}

/** The target verifier over its retained bundle: its runtime entrypoint, an empty cwd, and the manifest digest. */
async function verifierPort(context: CliContext, lifecycle: CliLifecycleContext, snapshot: unknown): Promise<Parameters<typeof runTargetVerifier>[1]> {
  const redactor = await redactorOf(context);
  const supervisor = new TargetVerifierSupervisor({
    spawn: spawnNodePlannerChild,
    now: () => performance.now(),
    setTimer: (callback, milliseconds) => {
      const timer = setTimeout(callback, milliseconds);
      return () => {
        clearTimeout(timer);
      };
    },
    sample: sampleNodePlannerProcess,
    redactor,
  });
  return {
    verify: async (plan) => {
      const bundleManifest = await retainedBundleManifest(lifecycle, plan.release, "update_verifier_bundle_manifest");
      const cwd = await mkdtemp(join(tmpdir(), "developer-os-verifier-"));
      try {
        return await supervisor.run({
          runtime: `${plan.release.bundleRoot}/${bundleManifest.runtimeEntrypoint}`,
          cwd,
          plan,
          snapshot,
          inputBlobs: [],
          remainingMilliseconds: plan.wallMilliseconds,
        });
      } finally {
        await runCleanups([() => rm(cwd, { recursive: true, force: true })]);
      }
    },
  };
}

/**
 * `coordinator_staging` (§9.2): the rollback then bundle source envelopes, their journals and plans,
 * participant-made empty directories, the construction rows and directories, the construction
 * envelope, and finally the allocator-reserved staging root.
 */
async function compactStaging(dispatch: Pick<DispatchContextV1, "lifecycle" | "context" | "root" | "reopened">): Promise<void> {
  const { lifecycle, context, root } = dispatch;
  const construction = dispatch.reopened.construction;
  if (construction === null) return removeEmptyDirectory(lifecycle, root);
  const deps = { fs: lifecycle.fs, effectiveUid: lifecycle.effectiveUid, now: () => context.now() };
  const journals = new UpdateParticipantJournalStore({ fs: lifecycle.fs, effectiveUid: lifecycle.effectiveUid });
  const sources = await sourcePlansOf(lifecycle, construction, construction.files.length);
  // A plan row whose journal is gone died between the two removals: its source already compacted.
  if (sources.rollback !== null) {
    const journal = updateParticipantJournalPath(root, "rollback_payload_source", sources.rollback.plan.id);
    if (await journals.exists(journal)) await new RollbackPayloadSourceExecutor(deps, root).compact(sources.rollback.plan);
    await journals.remove(journal);
    await journals.remove(sources.rollback.row.path, sources.rollback.row.sha256);
  }
  if (sources.bundle !== null) {
    const journal = updateParticipantJournalPath(root, "bundle_source_staging", sources.bundle.plan.id);
    if (await journals.exists(journal)) await new BundleSourceExecutor(deps, root).compact(sources.bundle.plan);
    await journals.remove(journal);
    await journals.remove(sources.bundle.row.path, sources.bundle.row.sha256);
  }
  await removeParticipantDirectories(lifecycle, construction);
  const store = new UpdateConstructionStore({ fs: lifecycle.fs, effectiveUid: lifecycle.effectiveUid, now: () => context.now(), screen: () => undefined, sources: recoverySources(lifecycle, root, () => context.now()) }, root);
  await store.compact(construction);
  await store.removeEnvelope(construction);
  await removeEmptyDirectory(lifecycle, root);
}

interface SourcePlansV1 {
  readonly bundle: { readonly plan: BundleSourceStagingPlanV1; readonly row: UpdateConstructionFilePlanV1 } | null;
  readonly rollback: { readonly plan: RollbackPayloadSourceStagingPlanV1; readonly row: UpdateConstructionFilePlanV1 } | null;
}

/**
 * Both source plans, reopened from their construction rows by exact hash. A row at or past
 * `nextFile` is unwritten or in flight (possibly an empty exclusive create): its source never ran.
 */
async function sourcePlansOf(lifecycle: CliLifecycleContext, construction: UpdateConstructionPlanV1, nextFile: number): Promise<SourcePlansV1> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- each source kind decodes to its own plan type
  const open = async <T>(kind: UpdateLeafPlanKindV1): Promise<{ readonly plan: T; readonly row: UpdateConstructionFilePlanV1 } | null> => {
    const row = construction.files.find((file) => file.role.kind === "immutable_plan" && file.role.planKind === kind);
    if (row === undefined || row.ordinal >= nextFile) return null;
    const bytes = await readBound(lifecycle, row.path, MAXIMUM_LEAF_PLAN_BYTES);
    if (bytes === null) return null;
    if (sha256Hex(bytes) !== row.sha256) thirdState("update_source_plan_hash", row.path);
    return { plan: decodeCanonicalJson(bytes, MAXIMUM_LEAF_PLAN_BYTES) as unknown as T, row };
  };
  return { bundle: await open<BundleSourceStagingPlanV1>("bundle_source_staging"), rollback: await open<RollbackPayloadSourceStagingPlanV1>("rollback_payload_source") };
}

async function removeEmptyDirectory(lifecycle: CliLifecycleContext, path: CanonicalAbsolutePathV1): Promise<void> {
  const entry = await lifecycle.fs.lstat(path);
  if (entry === null) return;
  for await (const name of lifecycle.fs.names(entry)) thirdState("update_staging_not_empty", `${path}/${name}`);
  await lifecycle.fs.rmdirExactEmpty(entry);
  await syncParent(lifecycle, path);
}

/**
 * Participants create `update/journals/<kind>` and `update/evidence/**` beside the construction
 * directories; once every participant compacted, each must be empty and is removed deepest first.
 */
async function removeParticipantDirectories(lifecycle: CliLifecycleContext, construction: UpdateConstructionPlanV1): Promise<void> {
  const planned = new Set(construction.directories.map((directory) => directory.path as string));
  const found: CanonicalAbsolutePathV1[] = [];
  const walk = async (path: CanonicalAbsolutePathV1): Promise<void> => {
    const entry = await lifecycle.fs.lstat(path);
    if (entry?.kind !== "directory") return;
    const names: string[] = [];
    for await (const name of lifecycle.fs.names(entry)) names.push(name);
    for (const name of names) await walk(parseCanonicalAbsolutePathText(`${path}/${name}`));
    if (!planned.has(path)) found.push(path);
  };
  for (const top of ["update/journals", "update/evidence"]) await walk(parseCanonicalAbsolutePathText(`${construction.stagingRoot.path}/${top}`));
  for (const path of found) await removeEmptyDirectory(lifecycle, path);
}

interface LiveSourcesV1 {
  readonly sources: UpdateComposedSourcesV1;
  readonly screen: ConstructionScreenV1;
  /** The verified scratch extraction; null for a rollback, which reads no scratch. */
  readonly scratch: Parameters<BundleSourceExecutor["stage"]>[1] | null;
}

/**
 * P9 (D72): a retained blob, reopened no-follow under `rollback/<payload-id>/blobs/` on construction
 * and on every recovery, and bound to the reopened retained inventory; any mismatch is exit 6.
 */
async function readRetainedBlob(lifecycle: CliLifecycleContext, productHome: CanonicalAbsolutePathV1, source: UpdateConstructionRetainedRollbackBlobSourceV1): Promise<Uint8Array> {
  const inventoryPath = rollbackPayloadMetadataPath(rollbackPayloadRoot(productHome, source.payloadId), 1);
  const inventoryBytes = await readBound(lifecycle, inventoryPath, MAXIMUM_ROLLBACK_DOCUMENT_BYTES) ?? thirdState("update_retained_inventory_absent", inventoryPath);
  try {
    checkRetainedRollbackBlobSource(source, validateRollbackPayloadInventory(decodeCanonicalJson(inventoryBytes, MAXIMUM_ROLLBACK_DOCUMENT_BYTES)));
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError || error instanceof LifecycleRecoveryRequiredError) throw error;
    thirdState("update_retained_blob_inventory", inventoryPath);
  }
  const blobPath = retainedRollbackBlobPath(productHome, source);
  const bytes = await readBound(lifecycle, blobPath, source.bytes) ?? thirdState("update_retained_blob_absent", blobPath);
  if (bytes.byteLength !== source.bytes || sha256Hex(bytes) !== source.sha256) thirdState("update_retained_blob_changed", blobPath);
  return bytes;
}

/** Recovery's source port: it never reads a row, and it compensates both nested sources from their plans. */
function recoverySources(lifecycle: CliLifecycleContext, root: CanonicalAbsolutePathV1, now: () => Date, live?: LiveSourcesV1): UpdateConstructionSourcePortV1 {
  const deps = { fs: lifecycle.fs, effectiveUid: lifecycle.effectiveUid, now };
  const liveOnly = (): never => thirdState("update_construction_source_not_live", root);
  return {
    readRow: async (plan, row) => {
      const bytes = live?.sources.rowBytes.get(row.ordinal);
      if (bytes !== undefined) return bytes;
      if (row.role.kind !== "payload") return liveOnly();
      const source = row.role.source;
      if (source.kind === "guarded_preimage") return readGuarded(lifecycle, source.path, source.dev, source.ino, source.bytes);
      if (source.kind === "retained_rollback_blob") return readRetainedBlob(lifecycle, lifecycle.roots.productHome, source);
      if (source.kind === "signed_bundle_entry") {
        const rootEntry = await lifecycle.fs.lstat(source.root);
        if (rootEntry?.kind !== "directory" || rootEntry.dev !== source.rootDev || rootEntry.ino !== source.rootIno) return thirdState("update_bundle_source_changed", source.root);
        return readGuarded(lifecycle, parseCanonicalAbsolutePathText(`${source.root}/${source.relativePath}`), source.sourceDev, source.sourceIno, source.sourceBytes);
      }
      return thirdState("update_construction_row_source", plan.stagingRoot.path, row.path);
    },
    // A rollback construction stages no source envelope; its sources are null.
    prepareSources: async (plan, journal) => {
      const { sources, scratch } = live ?? liveOnly();
      if (sources.bundleSource !== null) await new BundleSourceExecutor(deps, root).stage(sources.bundleSource, scratch ?? liveOnly(), plan, journal);
      if (sources.rollbackSource !== null) await new RollbackPayloadSourceExecutor(deps, root).prepare(sources.rollbackSource, plan, journal, sources.documents ?? liveOnly());
    },
    consumeRollbackEntry: async (plan, ordinal, frame) => {
      const source = (live ?? liveOnly()).sources.rollbackSource ?? liveOnly();
      await new RollbackPayloadSourceExecutor(deps, root).consume(source, plan, ordinal, frame);
    },
    finishSources: async (plan, journal: UpdateConstructionJournalV1) => {
      const source = (live ?? liveOnly()).sources.rollbackSource;
      if (source !== null) await new RollbackPayloadSourceExecutor(deps, root).finish(source, plan, journal);
    },
    compensateSources: async (plan, journal) => {
      const sources = await sourcePlansOf(lifecycle, plan, journal.nextFile);
      const reached = async (kind: "rollback_payload_source" | "bundle_source_staging", id: string): Promise<boolean> => (await lifecycle.fs.lstat(updateParticipantJournalPath(root, kind, id))) !== null;
      if (sources.rollback !== null && (await reached("rollback_payload_source", sources.rollback.plan.id))) await new RollbackPayloadSourceExecutor(deps, root).compensate(sources.rollback.plan, plan, journal);
      if (sources.bundle !== null && (await reached("bundle_source_staging", sources.bundle.plan.id))) await new BundleSourceExecutor(deps, root).compensate(sources.bundle.plan, plan, journal);
    },
    // ponytail: the store asks only once the row is already absent; the nested owner's own compaction removed it.
    nestedTerminal: () => Promise.resolve(true),
  };
}

async function readGuarded(lifecycle: CliLifecycleContext, path: CanonicalAbsolutePathV1, dev: string, ino: string, bytes: number): Promise<Uint8Array> {
  const entry = await lifecycle.fs.lstat(path);
  if (entry?.kind !== "regular_file" || entry.dev !== dev || entry.ino !== ino || entry.size !== String(bytes)) return thirdState("update_construction_source_changed", path);
  return lifecycle.fs.readRegular(entry, bytes);
}

// ---------------------------------------------------------------------------------------------
// `update rollback --apply`'s retained evidence, reopened under the lock (Spec 2 §10.1).
// ---------------------------------------------------------------------------------------------

/** Validator throws over retained bytes are exit 6; a JavaScript defect propagates. */
function retainedEvidence<T>(root: CanonicalAbsolutePathV1, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError || error instanceof LifecycleRecoveryRequiredError) throw error;
    return thirdState("update_rollback_evidence_invalid", root);
  }
}

/** The inverse plan, inventory, and every retained leaf, each bound to the record by hash. */
async function retainedRollbackSet(lifecycle: CliLifecycleContext, productHome: CanonicalAbsolutePathV1, record: RollbackRecordV1): Promise<RetainedRollbackSetV1> {
  const root = rollbackPayloadRoot(productHome, record.payloadId);
  const document = async (ordinal: 0 | 1, hash: LowerHexSha256): Promise<unknown> => {
    const at = rollbackPayloadMetadataPath(root, ordinal);
    const bytes = await readBound(lifecycle, at, MAXIMUM_ROLLBACK_DOCUMENT_BYTES) ?? thirdState("update_rollback_evidence_absent", at);
    if (sha256Hex(bytes) !== hash) thirdState("update_rollback_evidence_changed", at);
    return retainedEvidence(at, () => decodeCanonicalJson(bytes, MAXIMUM_ROLLBACK_DOCUMENT_BYTES));
  };
  const plan =await document(0, record.inversePlanHash).then((value) => retainedEvidence(root, () => validateBoundedUpdateInversePlan(value)));
  const inventory = await document(1, record.payloadInventoryHash).then((value) => retainedEvidence(root, () => validateRollbackPayloadInventory(value)));
  if (plan.payloadId !== record.payloadId || plan.rollbackBindingHash !== record.rollbackBindingHash || inventory.payloadId !== record.payloadId || inventory.inversePlanHash !== record.inversePlanHash) thirdState("update_rollback_evidence_binding", root);
  const owners: RetainedOwnerInverseProjectionV1[] = [];
  const migrations: RetainedSchemaMigrationInverseProjectionV1[] = [];
  for (const ref of [...plan.ownerPlans, ...plan.migrationPlans]) {
    const at = parseCanonicalAbsolutePathText(`${root}/${ref.path}`);
    const bytes = await readBound(lifecycle, at, MAXIMUM_LEAF_PLAN_BYTES) ?? thirdState("update_rollback_evidence_absent", at);
    const leaf = retainedEvidence(at, () => decodeRetainedInverseLeaf(ref.kind, bytes));
    if (bytes.byteLength !== ref.bytes || leaf.id !== ref.id || retainedInversePlanHash(bindRetainedInversePlan(leaf, record.rollbackBindingHash, ref.sourcePlanHash)) !== ref.retainedHash) thirdState("update_rollback_evidence_leaf", at);
    if (leaf.kind === "owner_inverse") owners.push(leaf);
    else migrations.push(leaf);
  }
  return { owners, migrations, entryCount: inventory.entries.length, aggregateBytes: inventory.aggregateBytes, exactStepListHash: plan.exactStepListHash };
}

/** A release's retained signed bundle manifest, by its content hash. */
/** `state/release-metadata/bundles/<hash>.json`: the retained signed bundle manifest, hash-checked; exit 6 otherwise. */
async function retainedBundleManifest(lifecycle: CliLifecycleContext, release: ReleaseIdentityV1, reason = "update_rollback_bundle_manifest"): Promise<ReleaseBundleManifestV1> {
  const at = parseCanonicalAbsolutePathText(`${lifecycle.roots.productHome}/state/release-metadata/bundles/${release.bundleManifestHash}.json`);
  const bytes = await readBound(lifecycle, at, MAXIMUM_RETAINED_BUNDLE_MANIFEST_BYTES) ?? thirdState(reason, at);
  if (sha256Hex(bytes) !== release.bundleManifestHash) thirdState(reason, at);
  return retainedEvidence(at, () => validateBundleManifest(decodeCanonicalJson(bytes, MAXIMUM_RETAINED_BUNDLE_MANIFEST_BYTES)));
}

// ---------------------------------------------------------------------------------------------
// The production ports.
// ---------------------------------------------------------------------------------------------

/**
 * Spec 2 §9's production `update --apply` ports. `fallback` is the launcher's FD 3 handoff; until
 * Task 11b extends it, production passes `() => null` and `allocate` refuses before any write
 * (D72 P7(d)). Every port runs under the one global lock `withGlobalLock` holds.
 */
export function productionUpdateApplyPorts(context: CliContext, fallback: () => UpdateFallbackHandoffV1 | null): UpdateApplyPortsV1 {
  const productHome = parseCanonicalAbsolutePathText(context.paths.home);
  const composedSources = new Map<LifecycleCoordinatorIdV1, LiveSourcesV1>();
  let held: HeldLifecycleStableLockV1 | null = null;
  const deferred: (() => Promise<void>)[] = [];
  let authority: Promise<Awaited<ReturnType<typeof ledgerAuthority>>> | null = null;
  const lifecycle = (): CliLifecycleContext => lifecycleOf(context);
  const global = (): HeldLifecycleStableLockV1 => held ?? thirdState("update_global_lock_not_held", context.paths.stateDir);
  const ledger = (): Promise<Awaited<ReturnType<typeof ledgerAuthority>>> => {
    authority ??= ledgerAuthority(context, lifecycle());
    return authority;
  };
  const composeDeps = (home: UpdateHomeV1): ComposeDepsV1 => {
    const handoff = fallback() ?? refuse("update_fallback_unavailable", EXIT_CODES.capabilityUnavailable, context.paths.stateDir);
    const current = lifecycle();
    return {
      productHome,
      effectiveUid: current.effectiveUid,
      evidence: createCanonicalPathEvidence(),
      fallback: handoff,
      brainRoot: brainRootOf(context),
      observe: (path) => observePath(current, path),
      admitManifest: (value) => validateManifestV2(value, gateManifestAdmission(context)),
      codexHomes: home.manifest.artifacts.some((row) => row.owner === "codex") ? codexHomes(context) : null,
    };
  };
  const journalStore = (): UpdateCoordinatorJournalStore => new UpdateCoordinatorJournalStore({ fs: lifecycle().fs, productHome, effectiveUid: lifecycle().effectiveUid, uuid: lifecycle().uuid });

  const coordinator = (id: LifecycleCoordinatorIdV1): UpdateLifecycleCoordinatorDependenciesV1 => {
    const store = journalStore();
    const root = updateCoordinatorStagingRoot(productHome, id);
    let loaded: Promise<{ readonly reopened: ReopenedV1; readonly dispatcher: UpdateStepDispatcher | null }> | null = null;
    const load = (plan?: UpdateLifecycleCoordinatorPlanV2): Promise<{ readonly reopened: ReopenedV1; readonly dispatcher: UpdateStepDispatcher | null }> => {
      loaded ??= (async () => {
        const outer = plan ?? (await store.read(id)).plan;
        const reopened = await reopen(lifecycle(), productHome, outer);
        const dispatcher = reopened.execution === null ? null : await dispatcherOf({ context, lifecycle: lifecycle(), productHome, root, global, reopened, defer: (cleanup) => deferred.push(cleanup) });
        return { reopened, dispatcher };
      })();
      return loaded;
    };
    const dispatcher = async (): Promise<UpdateStepDispatcher> => (await load()).dispatcher ?? thirdState("update_execution_absent", root);
    const executor = async (): Promise<UpdateRecoveryExecutorFiles> => {
      const execution = (await load()).reopened.execution ?? thirdState("update_execution_absent", root);
      return new UpdateRecoveryExecutorFiles({ fs: lifecycle().fs, effectiveUid: lifecycle().effectiveUid, descriptor: execution.recoveryExecutor });
    };
    return {
      store,
      participants: {
        apply: async (step) => (await dispatcher()).apply(step),
        observe: async (step) => (await dispatcher()).observe(step),
        compensate: async (step) => (await dispatcher()).compensate(step),
        compact: async (entry) => {
          const { reopened } = await load();
          // Its own row compaction removed the execution leaf; the construction plan still drives the rest.
          if (entry.kind === "coordinator_staging" && reopened.execution === null) return compactStaging({ context, lifecycle: lifecycle(), root, reopened });
          return (await dispatcher()).compact(entry);
        },
        retirementLeaves: async (step) => (await dispatcher()).retirementLeaves(step),
        retireLeaf: async (step, ordinal) => (await dispatcher()).retireLeaf(step, ordinal),
      },
      executor: {
        publishInitial: async (plan) => {
          const execution = (await load(plan)).reopened.execution ?? thirdState("update_execution_absent", root);
          await releaseExecutorReservation(lifecycle(), execution);
          await (await executor()).publishInitial(plan);
        },
        switchToFallback: async (plan) => (await executor()).switchToFallback(plan),
        removeRecord: async (plan) => {
          const execution = (await load(plan)).reopened.execution;
          if (execution === null) return removeOrphanTerminalExecutorRecord(lifecycle().fs, productHome, lifecycle().effectiveUid, createCanonicalPathEvidence(), plan.id);
          return (await executor()).removeRecord(plan);
        },
      },
      verifyPlan: async (plan, journal) => {
        const { reopened } = await load(plan);
        // Compaction removes the owner leaves first; once one is gone the hash-bound outer plan alone remains.
        if (reopened.execution === null) return;
        if (journal.phase === "compacting" && reopened.owners.length !== reopened.execution.owners.length) return;
        assertUpdateCoordinatorDerivation(plan, reopened.execution, reopened.owners);
      },
      requireLock: () => {
        global();
        return Promise.resolve();
      },
      clock: () => lifecycle().clock(),
    };
  };

  return {
    withGlobalLock: async (work) => {
      const acquired = await lifecycle().locks.acquireExisting(parseCanonicalAbsolutePathText(join(context.paths.stateDir, LOCK_LEAF)));
      held = acquired;
      try {
        return await work();
      } finally {
        held = null;
        authority = null;
        try {
          await runCleanups(deferred.splice(0));
        } finally {
          await acquired.release();
        }
      }
    },
    // The production `closure` port: Spec 2 §9.2's V2 closure, re-inspected on every call.
    closure: async () => {
      const { key, residue } = await ledger();
      return (await lifecycle().inspectClosureV2(key, residue)).closure;
    },
    allocate: async (prefixes: readonly LifecycleIdPrefixV1[]) => {
      if (fallback() === null) refuse("update_fallback_unavailable", EXIT_CODES.capabilityUnavailable, context.paths.stateDir);
      if (prefixes[0] !== "lc") return thirdState("update_allocation_prefixes");
      const current = lifecycle();
      const { key, residue } = await ledger();
      const allocatedIds = allocatedIdsFrom(await current.inspectLedger(key, residue));
      const block = await reserveLifecycleIdBlock({ fs: current.fs, stateDirectory: parseCanonicalAbsolutePathText(context.paths.stateDir), effectiveUid: current.effectiveUid, uuid: current.uuid, held: global(), allocatedIds }, prefixes.length);
      const id = formatAllocatedLifecycleId("lc", block.nonce, block.firstCounter) as unknown as LifecycleCoordinatorIdV1;
      await createStagingRoot(current, id);
      return id;
    },
    compose: async (input) => {
      const screen = await constructionScreen(context);
      const composed = await composeUpdate(input, composeDeps(input.home));
      composedSources.set(input.coordinatorId, { sources: composed.sources, scratch: input.inputs.verified, screen });
      return composed;
    },
    // Local evidence only: the retained set and previous bundle manifest are reopened here, under the lock.
    composeRollback: async (input) => {
      const deps = composeDeps(input.home);
      const record = input.home.rollback ?? refuse("update_rollback_unavailable", EXIT_CODES.capabilityUnavailable);
      const screen = await constructionScreen(context);
      const composed = await composeRollback(input, {
        ...deps,
        plannedAt: lifecycle().clock(),
        retained: await retainedRollbackSet(lifecycle(), productHome, record),
        previousBundle: await retainedBundleManifest(lifecycle(), input.preview.target),
      });
      composedSources.set(input.coordinatorId, { sources: composed.sources, scratch: null, screen });
      return composed;
    },
    construction: (id) => {
      const current = lifecycle();
      const root = updateCoordinatorStagingRoot(productHome, id);
      const live = composedSources.get(id);
      // Recovery stages no bytes, so only a live construction has a screen to run.
      const screen = live?.screen ?? ((): never => thirdState("update_construction_source_not_live", root));
      return new UpdateConstructionStore({ fs: current.fs, effectiveUid: current.effectiveUid, now: () => context.now(), screen, sources: recoverySources(current, root, () => context.now(), live) }, root);
    },
    coordinator,
    envelope: {
      isEnvelopeSuffix: (id) => journalStore().isEnvelopeSuffix(id),
      completeEnvelopeSuffix: (id) => journalStore().completeEnvelopeSuffix(id),
    },
    executorCleanup: (id) => removeOrphanTerminalExecutorRecord(lifecycle().fs, productHome, lifecycle().effectiveUid, createCanonicalPathEvidence(), id),
    removeEmptyStagingRoots: () => removeEmptyStagingRoots(lifecycle()),
    cleanAllocatorTemp: async () => {
      const { key, residue } = await ledger();
      await cleanAllocatorTemp(context, lifecycle(), key, residue, global());
    },
  };
}

async function namesOf(lifecycle: CliLifecycleContext, directory: LifecycleGuardedEntryV1): Promise<readonly string[]> {
  const names: string[] = [];
  for await (const name of lifecycle.fs.names(directory)) names.push(name);
  return names;
}

function isCoordinatorId(name: string): boolean {
  try {
    parseLifecycleCoordinatorId(name, null);
    return true;
  } catch {
    // Any other name is not an allocator reservation and is never this sweep's to remove.
    return false;
  }
}

/**
 * An owner-owned, empty `staging/lifecycle/<lc>` under the held lock that no coordinator plan or
 * journal claims has no other owner. The ledger reports exactly that root as `planless_staging`,
 * so the closure is never clear while it exists and the sweep cannot wait for one.
 */
async function removeEmptyStagingRoots(lifecycle: CliLifecycleContext): Promise<void> {
  const parent = await lifecycle.fs.lstat(lifecycle.roots.lifecycleStaging);
  if (parent?.kind !== "directory") return;
  const journals = await lifecycle.fs.lstat(lifecycle.roots.coordinatorJournals);
  const claimed = journals?.kind === "directory" ? await namesOf(lifecycle, journals) : [];
  let removed = false;
  for (const name of await namesOf(lifecycle, parent)) {
    if (!isCoordinatorId(name) || claimed.some((journal) => journal.startsWith(`${name}.`))) continue;
    const entry = await lifecycle.fs.lstat(parseCanonicalAbsolutePathText(`${parent.path}/${name}`));
    if (entry?.kind !== "directory" || entry.ownerUid !== lifecycle.effectiveUid || (await namesOf(lifecycle, entry)).length > 0) continue;
    await lifecycle.fs.rmdirExactEmpty(entry);
    removed = true;
  }
  if (removed) await lifecycle.fs.syncDirectory(parent);
}

type ConstructionScreenV1 = (bytes: Uint8Array, scope: RedactionScope) => void;

/**
 * The Security secret screen over staged construction bytes: any finding refuses before a byte
 * lands. Built from `redactorOf`, so it refuses without a key and carries the user's patterns.
 */
export async function constructionScreen(context: CliContext, redactorFor: typeof redactorOf = redactorOf): Promise<ConstructionScreenV1> {
  const redactor = await redactorFor(context);
  return (bytes, scope) => {
    if (redactor(decoder.decode(bytes), scope).findings.length > 0) refuse("update_construction_secret", EXIT_CODES.securityRefusal);
  };
}

/** Spec 1's allocator-reserved coordinator staging root: `staging/lifecycle/<lc>`, empty and owner-only. */
async function createStagingRoot(lifecycle: CliLifecycleContext, id: LifecycleCoordinatorIdV1): Promise<void> {
  const parentPath = lifecycle.roots.lifecycleStaging;
  let parent = await lifecycle.fs.lstat(parentPath);
  if (parent === null) {
    await lifecycle.fs.mkdirExclusive(parentPath);
    await syncParent(lifecycle, parentPath);
    parent = await lifecycle.fs.lstat(parentPath);
  }
  if (parent?.kind !== "directory") return thirdState("lifecycle_guarded_parent", parentPath);
  await lifecycle.fs.mkdirExclusive(parseCanonicalAbsolutePathText(`${parentPath}/${id}`));
  await lifecycle.fs.syncDirectory(parent);
}

/**
 * §6.4 reserves `state/update-executor.json` as an empty file; the executor protocol admits only an
 * absent final path, so the exact empty reservation is released before the initial record lands.
 */
async function releaseExecutorReservation(lifecycle: CliLifecycleContext, execution: UpdateExecutionPlanV1): Promise<void> {
  const entry = await lifecycle.fs.lstat(execution.recoveryExecutor.finalPath);
  if (entry?.kind !== "regular_file" || entry.size !== "0" || entry.ownerUid !== lifecycle.effectiveUid || entry.nlink !== 1) return;
  await unlinkAndSyncParent(lifecycle, entry, execution.recoveryExecutor.finalPath);
}
