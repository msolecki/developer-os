import { createHash } from "node:crypto";
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readlink, realpath, rename, stat, unlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MARKETPLACE_NAME, PLUGIN_NAME } from "@developer-os/adapter-codex";
import {
  assertUpdateCoordinatorDerivation,
  constructionPlanHash,
  decodeCanonicalJson,
  EXIT_CODES,
  formatAllocatedLifecycleId,
  LifecycleRecoveryRequiredError,
  ManifestStateParticipant,
  MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES,
  MAXIMUM_CONSTRUCTION_PLAN_BYTES,
  MAXIMUM_LEAF_PLAN_BYTES,
  parseCanonicalAbsolutePathText,
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
  parseUInt64Decimal,
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
  type ManifestStatePlanV1,
  type OwnerExternalEffectPlanV1,
  type OwnerExternalEffectProcessPolicyV1,
  type OwnerUpdatePlanV1,
  type RollbackPayloadSourceStagingPlanV1,
  type RollbackPayloadStatePlanV1,
  type SchemaMigrationPlanV1,
  type TargetVerificationPlanV1,
  type UpdateCompactionEntryV1,
  type UpdateConstructionFilePlanV1,
  type UpdateConstructionJournalV1,
  type UpdateConstructionPlanV1,
  type UpdateExecutionPlanV1,
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
} from "@developer-os/security";

import { createCanonicalPathEvidence } from "../bootstrap/admission.js";
import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import { discoverEachAgent } from "../commands/doctor.js";
import { readConfigFile } from "../config-file.js";
import { readRedactionKey } from "../context.js";
import type { CliContext } from "../context.js";
import { codexPluginTreeHash, inspectCodexRegistration, validateCodexRegistrationRecord } from "../instructions/codex-registration.js";
import { codexInstructionPaths, resolveVendorHomes } from "../instructions/vendor-homes.js";
import type { VendorHomesV1 } from "../instructions/vendor-homes.js";
import { admitInstalledV2Home } from "../lifecycle/admission.js";
import { lifecycleHomeKeyFromAdmission, residueFrom } from "../lifecycle/context.js";
import type { CliLifecycleContext, LifecycleHomeKeyV1 } from "../lifecycle/context.js";
import { gateManifestAdmission } from "../lifecycle/mutation-gate.js";
import type { UpdateApplyPortsV1 } from "./apply.js";
import { BundlePublicationParticipant } from "./bundle-publication.js";
import { BundleSourceExecutor } from "./bundle-source.js";
import { codexExecutableResolver, codexRefreshPolicy, resolveCodexExecutable } from "./codex-refresh.js";
import type { CodexExecutableFileSystemV1, CodexExecutableIdentityV1 } from "./codex-refresh.js";
import { codexRegistrationObserver, supervisedOwnerEffectRun } from "./codex-effect-ports.js";
import { composeUpdate, updateManifestAdmission, updateManifestFoundationIds } from "./compose.js";
import type { ObservedPathV1, UpdateComposedSourcesV1 } from "./compose.js";
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
import { removeOrphanTerminalExecutorRecord, UpdateRecoveryExecutorFiles } from "./recovery.js";
import { RollbackPayloadParticipant } from "./rollback-publication.js";
import { RollbackPayloadSourceExecutor } from "./rollback-source.js";
import { UpdateRetirementParticipant } from "./retirement-participant.js";
import { retirementResolvePort } from "./retirement-resolve.js";
import { CanonicalStateParticipant, constructionPayloadIdentity, participantPlanFileHash, runTargetVerifier, UpdateParticipantJournalStore } from "./state-participant.js";
import type { CanonicalStateStepV1 } from "./state-participant.js";

type StepOf<TKind extends UpdateLifecycleCoordinatorStepV1["kind"]> = Extract<UpdateLifecycleCoordinatorStepV1, { readonly kind: TKind }>;

const LOCK_LEAF = ".lifecycle.lock";
const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
const MAX_REGISTRATION_BYTES = 8 * 1024;
const MAX_MANIFEST_BYTES = 67_108_864;
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

function sha256(bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function lifecycleOf(context: CliContext): CliLifecycleContext {
  return context.lifecycle ?? refuse("update_lifecycle_unavailable", EXIT_CODES.capabilityUnavailable, context.paths.home);
}

/** The ledger key and bookkeeping residue the V2 closure reads, from the admitted home. */
async function ledgerAuthority(context: CliContext, lifecycle: CliLifecycleContext): Promise<{ readonly key: LifecycleHomeKeyV1; readonly residue: ReturnType<typeof residueFrom> }> {
  const { paths } = context;
  const admitted = await admitInstalledV2Home({ fs: lifecycle.fs, paths, manifestAdmission: gateManifestAdmission(context), effectiveUid: lifecycle.effectiveUid });
  const residue = residueFrom(await inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({ productHome: paths.home, stateDirectory: paths.stateDir, initialRoots: [paths.home, paths.stateDir, context.userHome] })));
  return { key: lifecycleHomeKeyFromAdmission(admitted, paths), residue };
}

/** A guarded observation with a content hash for a regular file and a target hash for a symlink. */
async function observePath(lifecycle: CliLifecycleContext, path: CanonicalAbsolutePathV1): Promise<ObservedPathV1 | null> {
  const entry = await lifecycle.fs.lstat(path);
  if (entry === null) return null;
  if (entry.kind === "regular_file") return { entry, sha256: await lifecycle.fs.hashRegular(entry, BigInt(entry.size)) };
  if (entry.kind === "other") {
    const target = await readlink(path, { encoding: "buffer" }).catch(() => null);
    return { entry: target === null ? entry : { ...entry, size: String(target.byteLength) as LifecycleGuardedEntryV1["size"] }, sha256: target === null ? null : sha256(target) };
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
  const tokens = { managedPluginRoot: codexInstructionPaths(homes).pluginRoot, pluginId: PLUGIN_ID, privateEffectTmp: await mkdtemp(join(tmpdir(), "developer-os-effect-")), managedVendorHome: homes.codexHome };
  const resolveExecutable = codexExecutableResolver(executable, fsDeps);
  const run = supervisedOwnerEffectRun(new SupervisedProcessRunner(nodeSupervisedProcessDependencies));
  const observe = codexRegistrationObserver({ policy: pinned, tokens, resolveExecutable, run, screen: (text) => redactor(text).findings.length > 0 });
  return { executable, effect: { tokens, observe, resolveExecutable, run, redact: (text) => redactor(text).text } };
}

/** `CliUpdateContext.codex`: the planning-time registration state, policy, and current projection. */
export function updateCodexPort(context: CliContext): () => Promise<UpdateCodexV1 | null> {
  return async () => {
    const lifecycle = lifecycleOf(context);
    const runtime = await codexRuntime(context, lifecycle, null);
    if (runtime === null) return null;
    const homes = codexHomes(context);
    const { pluginRoot, registrationFile } = codexInstructionPaths(homes);
    const policy = codexRefreshPolicy(runtime.executable);
    const manifestBytes = await readFile(context.paths.manifestFile);
    const manifest = decodeCanonicalJson(manifestBytes, MAX_MANIFEST_BYTES) as unknown as InstallationManifestV2;
    const tree = manifest.artifacts.flatMap((artifact) =>
      artifact.path.startsWith(`${pluginRoot}/`) && artifact.kind !== "directory" && artifact.verification.mode === "content"
        ? [{ path: artifact.path.slice(pluginRoot.length + 1), sha256: artifact.verification.installedHash }]
        : []);
    let record = null;
    try {
      const bytes = await readFile(registrationFile);
      record = bytes.byteLength > MAX_REGISTRATION_BYTES ? null : validateCodexRegistrationRecord(bytes);
    } catch {
      // An absent or malformed record is the `unregistered` state `inspectCodexRegistration` reports.
      record = null;
    }
    const registration = tree.length === 0
      ? "unregistered"
      : await inspectCodexRegistration({ runner: context.runner, codexExecutable: runtime.executable.canonicalPath, codexHome: homes.codexHome, pluginRoot, record, treeHash: codexPluginTreeHash(tree) });
    return { homes, registration, policy, projection: await runtime.effect.observe() };
  };
}

// ---------------------------------------------------------------------------------------------
// Reopened plans: every leaf is hash-bound by the outer plan, so bytes are rechecked, not trusted.
// ---------------------------------------------------------------------------------------------

async function readBound(lifecycle: CliLifecycleContext, path: CanonicalAbsolutePathV1, maximumBytes: number): Promise<Uint8Array | null> {
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

async function reopen(lifecycle: CliLifecycleContext, productHome: CanonicalAbsolutePathV1, plan: UpdateLifecycleCoordinatorPlanV2): Promise<ReopenedV1> {
  const evidence = createCanonicalPathEvidence();
  const raw = await readLeaf(lifecycle, plan.update);
  // ponytail: a leaf removed by its own compaction entry is absent; the entries after it never read it.
  if (raw === null) return { execution: null, construction: null, leaves: new Map(), owners: [] };
  const execution = validateUpdateExecutionPlan(raw, { productHome, evidence, fallback: executionFallback(raw) });
  const constructionBytes = await readBound(lifecycle, plan.construction.path, MAXIMUM_CONSTRUCTION_PLAN_BYTES);
  let construction: UpdateConstructionPlanV1 | null = null;
  if (constructionBytes !== null) {
    construction = decodeCanonicalJson(constructionBytes, MAXIMUM_CONSTRUCTION_PLAN_BYTES) as unknown as UpdateConstructionPlanV1;
    validateConstructionBijections(construction);
    if (constructionPlanHash(construction) !== plan.construction.hash) thirdState("update_construction_plan", plan.construction.path);
  }
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
    const entry = await fs.lstat(path);
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
  const manifestParticipant = manifestParticipantOf(dispatch, ownerPlans);
  const manifestHandlers = transitional === null || terminal === null
    ? { manifest: { apply: () => thirdState("update_manifest_plan_absent"), observe: () => thirdState("update_manifest_plan_absent"), compensate: () => thirdState("update_manifest_plan_absent") } }
    : manifestStepHandlers({ transitional, terminal }, retired, {
      participant: manifestParticipant,
      readManifest: async (path, hash) => {
        const bytes = await readBound(lifecycle, path, MAX_MANIFEST_BYTES) ?? thirdState("update_manifest_absent", path);
        if (sha256(bytes) !== hash) thirdState("update_manifest_hash", path);
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
      apply: async (step: StepOf<"bundle">) => {
        if (step.action !== "publish_target") return unsupported("update_rollback_apply_unavailable");
        await journals.open(bundleJournal);
        await bundle.apply(bundlePlan ?? thirdState("update_bundle_plan_absent", root));
        return APPLIED;
      },
      observe: async () => ((await journals.unreached(bundleJournal)) ? BEFORE : APPLIED),
      compensate: async () => {
        if (await journals.unreached(bundleJournal)) return BEFORE;
        await bundle.compensate(bundlePlan ?? thirdState("update_bundle_plan_absent", root));
        return COMPENSATED;
      },
    },
    owner_files: {
      apply: (step) => owners.applyFiles(ownerStep(step.owner)),
      observe: (step) => owners.observe(ownerStep(step.owner)),
      compensate: (step) => owners.compensate(ownerStep(step.owner)),
    },
    owner_external_effect: {
      apply: (step) => owners.applyEffects(ownerStep(step.owner)),
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
        if (step.transition !== "publish_proposed") return unsupported("update_rollback_apply_unavailable");
        await journals.open(payloadJournal);
        await payload.publish(payloadPlan ?? thirdState("update_rollback_payload_plan_absent", root));
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
        if (step.transition !== "publish_proposed") return unsupported("update_rollback_apply_unavailable");
        return stateHandler(recordStep, true).apply(step);
      },
    },
    active: {
      ...stateHandler(activeStep, false),
      apply: async (step: StepOf<"active">) => {
        if (step.transition !== "publish_target") return unsupported("update_rollback_apply_unavailable");
        return stateHandler(activeStep, false).apply(step);
      },
    },
    target_verifier: {
      apply: async (step: StepOf<"target_verifier">) => {
        if (step.release !== "target") return unsupported("update_rollback_apply_unavailable");
        return runTargetVerifier(verification ?? thirdState("update_verification_plan_absent", root), await verifierPort(context, lifecycle));
      },
      observe: () => Promise.resolve(BEFORE),
      compensate: () => Promise.resolve(BEFORE),
    },
  };

  const finalizeThenCompact = async (observe: () => Promise<UpdateParticipantObservationV1>, finalize: () => Promise<void>, compact: () => Promise<void>): Promise<void> => {
    if ((await observe()).state === "verified") await finalize();
    await compact();
  };
  const removeLeaf = async (ref: ImmutableUpdatePlanRefV1, plan: unknown, journal: UpdateInitialJournalRefV1 | null): Promise<void> => {
    if (journal !== null) {
      await journals.remove(journal.stagedPath);
      await journals.remove(journal.finalPath);
    }
    if (plan !== null) await journals.remove(ref.path, participantPlanFileHash(ref, plan));
  };
  const compaction: UpdateCompactionHandlersV1 = {
    owner_update: async (entry) => {
      const step = ownerSteps.get(entry.owner);
      if (step === undefined) return;
      await finalizeThenCompact(() => owners.observe(step), () => owners.finalize(step), () => owners.compact(step));
      await journals.remove(step.journal.stagedPath);
    },
    schema_migration: async (entry) => {
      const step = migrationSteps.get(entry.id);
      if (step === undefined) return;
      await finalizeThenCompact(() => migrations.observe(step), () => migrations.finalize(step), () => migrations.compact(step));
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
        if (payloadPlan !== null && !(await journals.unreached(payloadJournal))) await payload.compact(payloadPlan);
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
        await finalizeThenCompact(() => state.observe(step), () => state.finalize(step), () => state.compact(step));
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
  await lifecycle.fs.unlinkExact(entry);
  const parent = await lifecycle.fs.lstat(parseCanonicalAbsolutePathText(plan.path.slice(0, plan.path.lastIndexOf("/"))));
  if (parent !== null) await lifecycle.fs.syncDirectory(parent);
}

async function removeUnconsumedPayloads(journals: UpdateParticipantJournalStore, paths: readonly CanonicalAbsolutePathV1[]): Promise<void> {
  for (const path of paths) await journals.remove(path);
}

async function guardedUnlink(lifecycle: CliLifecycleContext, path: CanonicalAbsolutePathV1, expected: ManifestFileIdentityV1): Promise<void> {
  const entry = await lifecycle.fs.lstat(path);
  if (entry === null) return;
  if (entry.kind !== "regular_file" || entry.dev !== expected.dev || entry.ino !== expected.ino || entry.size !== expected.size) thirdState("manifest_bytes_identity", path);
  if ((await lifecycle.fs.hashRegular(entry, BigInt(expected.size))) !== expected.hash) thirdState("manifest_bytes_hash", path);
  await lifecycle.fs.unlinkExact(entry);
  const parent = await lifecycle.fs.lstat(parseCanonicalAbsolutePathText(path.slice(0, path.lastIndexOf("/"))));
  if (parent !== null) await lifecycle.fs.syncDirectory(parent);
}

/** The transitional manifest value is the construction row's own plan-derived bytes. */
function manifestValueOf(construction: UpdateConstructionPlanV1, plan: ManifestStatePlanV1): InstallationManifestV2 | null {
  if (plan.after.state !== "present" || plan.after.bytes === null) return null;
  const row = construction.files[plan.after.bytes.ordinal];
  if (row?.role.kind !== "payload" || row.role.source.kind !== "plan_derived" || row.role.source.role !== "manifest_after") return thirdState("update_manifest_row", plan.manifestPath);
  return decodeCanonicalJson(new TextEncoder().encode(row.role.source.value), MAX_MANIFEST_BYTES) as unknown as InstallationManifestV2;
}

function manifestParticipantOf(dispatch: DispatchContextV1, ownerPlans: readonly OwnerUpdatePlanV1[]): (plan: ManifestStatePlanV1) => ManifestStateParticipant {
  const { lifecycle, context, productHome } = dispatch;
  const construction = dispatch.reopened.construction;
  const identityOf = async (path: CanonicalAbsolutePathV1, expected: ManifestFileIdentityV1): Promise<LifecycleGuardedEntryV1> => {
    const entry = await lifecycle.fs.lstat(path);
    if (entry?.kind !== "regular_file" || entry.dev !== expected.dev || entry.ino !== expected.ino || entry.size !== expected.size || entry.ownerUid !== expected.ownerUid) return thirdState("manifest_bytes_identity", path);
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
        /**
         * The codec asks synchronously and, for `construction_evidence`, only requires the payload
         * to be this construction's row; the participant's guarded move re-proves the actual inode.
         * ponytail: a synchronous evidence reader would let the codec compare the inode itself.
         */
        updatePayloadIdentity: (ref) => {
          if (construction === null) return thirdState("update_construction_plan_absent", ref.path);
          const row = construction.files[ref.ordinal];
          if (row === undefined || row.path !== ref.path || row.sha256 !== ref.hash) thirdState("update_manifest_payload_row", ref.path);
          return { dev: parseUInt64Decimal("0"), ino: parseUInt64Decimal("0") };
        },
      }),
      uid: lifecycle.effectiveUid,
      manifestAdmission: gateManifestAdmission(context),
    });
  };
}

/** The target verifier over its retained bundle: its runtime entrypoint, an empty cwd, and the manifest digest. */
async function verifierPort(context: CliContext, lifecycle: CliLifecycleContext): Promise<Parameters<typeof runTargetVerifier>[1]> {
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
      const manifestPath = parseCanonicalAbsolutePathText(`${lifecycle.roots.productHome}/state/release-metadata/bundles/${plan.release.bundleManifestHash}.json`);
      const bytes = await readBound(lifecycle, manifestPath, 16_777_216) ?? thirdState("update_verifier_bundle_manifest", manifestPath);
      if (sha256(bytes) !== plan.release.bundleManifestHash) thirdState("update_verifier_bundle_manifest", manifestPath);
      const bundleManifest = validateBundleManifest(decodeCanonicalJson(bytes, 16_777_216));
      // ponytail: the snapshot is the plan's own digests; the bounded read-only home snapshot joins with the real verifier (A16).
      return supervisor.run({
        runtime: `${plan.release.bundleRoot}/${bundleManifest.runtimeEntrypoint}`,
        cwd: await mkdtemp(join(tmpdir(), "developer-os-verifier-")),
        plan,
        snapshot: { manifestHash: plan.manifestHash, ownerPostimagesHash: plan.ownerPostimagesHash, migrationPostimagesHash: plan.migrationPostimagesHash },
        inputBlobs: [],
        remainingMilliseconds: plan.wallMilliseconds,
      });
    },
  };
}

/**
 * `coordinator_staging` (§9.2): the rollback then bundle source envelopes, their journals and plans,
 * participant-made empty directories, the construction rows and directories, the construction
 * envelope, and finally the allocator-reserved staging root.
 */
async function compactStaging(dispatch: DispatchContextV1): Promise<void> {
  const { lifecycle, context, root } = dispatch;
  const construction = dispatch.reopened.construction;
  if (construction === null) return removeEmptyDirectory(lifecycle, root);
  const deps = { fs: lifecycle.fs, effectiveUid: lifecycle.effectiveUid, now: () => context.now() };
  const journals = new UpdateParticipantJournalStore({ fs: lifecycle.fs, effectiveUid: lifecycle.effectiveUid });
  const sources = await sourcePlansOf(lifecycle, construction);
  if (sources.rollback !== null) {
    await new RollbackPayloadSourceExecutor(deps, root).compact(sources.rollback.plan);
    await journals.remove(updateParticipantJournalPath(root, "rollback_payload_source", sources.rollback.plan.id));
    await journals.remove(sources.rollback.row.path, sources.rollback.row.sha256);
  }
  if (sources.bundle !== null) {
    await new BundleSourceExecutor(deps, root).compact(sources.bundle.plan);
    await journals.remove(updateParticipantJournalPath(root, "bundle_source_staging", sources.bundle.plan.id));
    await journals.remove(sources.bundle.row.path, sources.bundle.row.sha256);
  }
  await removeParticipantDirectories(lifecycle, construction);
  const store = new UpdateConstructionStore({ fs: lifecycle.fs, effectiveUid: lifecycle.effectiveUid, now: () => context.now(), screen: () => undefined, sources: recoverySources(lifecycle, root) }, root);
  await store.compact(construction);
  await store.removeEnvelope(construction);
  await removeEmptyDirectory(lifecycle, root);
}

interface SourcePlansV1 {
  readonly bundle: { readonly plan: BundleSourceStagingPlanV1; readonly row: UpdateConstructionFilePlanV1 } | null;
  readonly rollback: { readonly plan: RollbackPayloadSourceStagingPlanV1; readonly row: UpdateConstructionFilePlanV1 } | null;
}

/** Both source plans, reopened from their construction rows by exact hash; an unwritten row is absent. */
async function sourcePlansOf(lifecycle: CliLifecycleContext, construction: UpdateConstructionPlanV1): Promise<SourcePlansV1> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- each source kind decodes to its own plan type
  const open = async <T>(kind: UpdateLeafPlanKindV1): Promise<{ readonly plan: T; readonly row: UpdateConstructionFilePlanV1 } | null> => {
    const row = construction.files.find((file) => file.role.kind === "immutable_plan" && file.role.planKind === kind);
    if (row === undefined) return null;
    const bytes = await readBound(lifecycle, row.path, MAXIMUM_LEAF_PLAN_BYTES);
    if (bytes === null) return null;
    if (sha256(bytes) !== row.sha256) thirdState("update_source_plan_hash", row.path);
    return { plan: decodeCanonicalJson(bytes, MAXIMUM_LEAF_PLAN_BYTES) as unknown as T, row };
  };
  return { bundle: await open<BundleSourceStagingPlanV1>("bundle_source_staging"), rollback: await open<RollbackPayloadSourceStagingPlanV1>("rollback_payload_source") };
}

async function removeEmptyDirectory(lifecycle: CliLifecycleContext, path: CanonicalAbsolutePathV1): Promise<void> {
  const entry = await lifecycle.fs.lstat(path);
  if (entry === null) return;
  for await (const name of lifecycle.fs.names(entry)) thirdState("update_staging_not_empty", `${path}/${name}`);
  await lifecycle.fs.rmdirExactEmpty(entry);
  const parent = await lifecycle.fs.lstat(parseCanonicalAbsolutePathText(path.slice(0, path.lastIndexOf("/"))));
  if (parent !== null) await lifecycle.fs.syncDirectory(parent);
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

/** Recovery's source port: it never reads a row, and it compensates both nested sources from their plans. */
function recoverySources(lifecycle: CliLifecycleContext, root: CanonicalAbsolutePathV1, live?: { readonly sources: UpdateComposedSourcesV1; readonly scratch: Parameters<BundleSourceExecutor["stage"]>[1] }): UpdateConstructionSourcePortV1 {
  const deps = { fs: lifecycle.fs, effectiveUid: lifecycle.effectiveUid, now: () => new Date() };
  const liveOnly = (): never => thirdState("update_construction_source_not_live", root);
  return {
    readRow: async (plan, row) => {
      const bytes = live?.sources.rowBytes.get(row.ordinal);
      if (bytes !== undefined) return bytes;
      if (row.role.kind !== "payload") return liveOnly();
      const source = row.role.source;
      if (source.kind === "guarded_preimage") return readGuarded(lifecycle, source.path, source.dev, source.ino, source.bytes);
      if (source.kind === "signed_bundle_entry") {
        const rootEntry = await lifecycle.fs.lstat(source.root);
        if (rootEntry?.kind !== "directory" || rootEntry.dev !== source.rootDev || rootEntry.ino !== source.rootIno) return thirdState("update_bundle_source_changed", source.root);
        return readGuarded(lifecycle, parseCanonicalAbsolutePathText(`${source.root}/${source.relativePath}`), source.sourceDev, source.sourceIno, source.sourceBytes);
      }
      return thirdState("update_construction_row_source", plan.stagingRoot.path, row.path);
    },
    prepareSources: async (plan, journal) => {
      const current = live ?? liveOnly();
      await new BundleSourceExecutor(deps, root).stage(current.sources.bundleSource, current.scratch, plan, journal);
      await new RollbackPayloadSourceExecutor(deps, root).prepare(current.sources.rollbackSource, plan, journal, current.sources.documents);
    },
    consumeRollbackEntry: async (plan, ordinal, frame) => {
      const current = live ?? liveOnly();
      await new RollbackPayloadSourceExecutor(deps, root).consume(current.sources.rollbackSource, plan, ordinal, frame);
    },
    finishSources: async (plan, journal: UpdateConstructionJournalV1) => {
      const current = live ?? liveOnly();
      await new RollbackPayloadSourceExecutor(deps, root).finish(current.sources.rollbackSource, plan, journal);
    },
    compensateSources: async (plan, journal) => {
      const sources = await sourcePlansOf(lifecycle, plan);
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
// The production ports.
// ---------------------------------------------------------------------------------------------

/**
 * Spec 2 §9's production `update --apply` ports. `fallback` is the launcher's FD 3 handoff; until
 * Task 11b extends it, production passes `() => null` and `allocate` refuses before any write
 * (D72 P7(d)). Every port runs under the one global lock `withGlobalLock` holds.
 */
export function productionUpdateApplyPorts(context: CliContext, fallback: () => UpdateFallbackHandoffV1 | null): UpdateApplyPortsV1 {
  const productHome = parseCanonicalAbsolutePathText(context.paths.home);
  const composedSources = new Map<LifecycleCoordinatorIdV1, { readonly sources: UpdateComposedSourcesV1; readonly scratch: Parameters<BundleSourceExecutor["stage"]>[1] }>();
  let held: HeldLifecycleStableLockV1 | null = null;
  let authority: Promise<Awaited<ReturnType<typeof ledgerAuthority>>> | null = null;
  const lifecycle = (): CliLifecycleContext => lifecycleOf(context);
  const global = (): HeldLifecycleStableLockV1 => held ?? thirdState("update_global_lock_not_held", context.paths.stateDir);
  const ledger = (): Promise<Awaited<ReturnType<typeof ledgerAuthority>>> => {
    authority ??= ledgerAuthority(context, lifecycle());
    return authority;
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
        const dispatcher = reopened.execution === null ? null : await dispatcherOf({ context, lifecycle: lifecycle(), productHome, root, global, reopened });
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
        compact: async (entry) => (await dispatcher()).compact(entry),
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
      verifyPlan: async (plan) => {
        const { reopened } = await load(plan);
        // After `coordinator_staging` the leaves are gone; the hash-bound outer plan alone remains.
        if (reopened.execution === null) return;
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
        await acquired.release();
      }
    },
    closure: async () => {
      const { key, residue } = await ledger();
      return (await lifecycle().inspectClosureV2(key, residue)).closure;
    },
    allocate: async (prefixes: readonly LifecycleIdPrefixV1[]) => {
      if (fallback() === null) refuse("update_fallback_unavailable", EXIT_CODES.capabilityUnavailable, context.paths.stateDir);
      if (prefixes[0] !== "lc") return thirdState("update_allocation_prefixes");
      const current = lifecycle();
      const { key, residue } = await ledger();
      const snapshot = await current.inspectLedger(key, residue);
      const allocatedIds = [...snapshot.coordinators.map((record) => record.id as string), ...[...snapshot.foundation.journals.keys()].map(String)];
      const block = await reserveLifecycleIdBlock({ fs: current.fs, stateDirectory: parseCanonicalAbsolutePathText(context.paths.stateDir), effectiveUid: current.effectiveUid, uuid: current.uuid, held: global(), allocatedIds: allocatedIds.filter((allocated) => /^[a-z]{2}_[0-9a-f]{64}_[0-9]+$/u.test(allocated)) }, prefixes.length);
      const id = formatAllocatedLifecycleId("lc", block.nonce, block.firstCounter) as unknown as LifecycleCoordinatorIdV1;
      await createStagingRoot(current, id);
      return id;
    },
    compose: async (input) => {
      const handoff = fallback() ?? refuse("update_fallback_unavailable", EXIT_CODES.capabilityUnavailable, context.paths.stateDir);
      const current = lifecycle();
      const hasCodex = input.home.manifest.artifacts.some((row) => row.owner === "codex");
      const composed = await composeUpdate(input, {
        productHome,
        effectiveUid: current.effectiveUid,
        evidence: createCanonicalPathEvidence(),
        fallback: handoff,
        brainRoot: brainRootOf(context),
        observe: (path) => observePath(current, path),
        admitManifest: (value) => validateManifestV2(value, gateManifestAdmission(context)),
        codexHomes: hasCodex ? codexHomes(context) : null,
      });
      composedSources.set(input.coordinatorId, { sources: composed.sources, scratch: input.inputs.verified });
      return composed;
    },
    construction: (id) => {
      const current = lifecycle();
      const root = updateCoordinatorStagingRoot(productHome, id);
      const screen = screenOf(context);
      return new UpdateConstructionStore({ fs: current.fs, effectiveUid: current.effectiveUid, now: () => context.now(), screen, sources: recoverySources(current, root, composedSources.get(id)) }, root);
    },
    coordinator,
    envelope: {
      isEnvelopeSuffix: (id) => journalStore().isEnvelopeSuffix(id),
      completeEnvelopeSuffix: (id) => journalStore().completeEnvelopeSuffix(id),
    },
    executorCleanup: (id) => removeOrphanTerminalExecutorRecord(lifecycle().fs, productHome, lifecycle().effectiveUid, createCanonicalPathEvidence(), id),
  };
}

/** The Security secret screen over staged construction bytes: any finding refuses before a byte lands. */
function screenOf(context: CliContext): (bytes: Uint8Array) => void {
  let redactor: ReturnType<typeof createRedactor> | null = null;
  const key = readRedactionKey(context.paths.stateDir);
  if (key !== null) redactor = createRedactor(key, { userPatterns: [] });
  return (bytes) => {
    if (redactor === null) return;
    if (redactor(decoder.decode(bytes)).findings.length > 0) refuse("update_construction_secret", EXIT_CODES.securityRefusal);
  };
}

/** Spec 1's allocator-reserved coordinator staging root: `staging/lifecycle/<lc>`, empty and owner-only. */
async function createStagingRoot(lifecycle: CliLifecycleContext, id: LifecycleCoordinatorIdV1): Promise<void> {
  const parentPath = lifecycle.roots.lifecycleStaging;
  let parent = await lifecycle.fs.lstat(parentPath);
  if (parent === null) {
    await lifecycle.fs.mkdirExclusive(parentPath);
    const staging = await lifecycle.fs.lstat(parseCanonicalAbsolutePathText(parentPath.slice(0, parentPath.lastIndexOf("/"))));
    if (staging !== null) await lifecycle.fs.syncDirectory(staging);
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
  await lifecycle.fs.unlinkExact(entry);
  const parent = await lifecycle.fs.lstat(parseCanonicalAbsolutePathText(execution.recoveryExecutor.finalPath.slice(0, execution.recoveryExecutor.finalPath.lastIndexOf("/"))));
  if (parent !== null) await lifecycle.fs.syncDirectory(parent);
}
