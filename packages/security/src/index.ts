import type { ProcessRequest } from "./process.js";
import type { RedactionResult } from "./redaction.js";

export {
  assertDisjointPaths,
  canonicalizePlannedPath,
  resolveOwnedPath,
  SecurityRefusalError,
} from "./paths.js";
export {
  foldPathName,
  PROTECTED_PATH_RULES,
  ProtectedPathPolicy,
} from "./protected-paths.js";
export type {
  ProtectedPathMatchV1,
  ProtectedPathRuleId,
  ProtectedPathRuleV1,
} from "./protected-paths.js";
export {
  createRedactor,
  REDACTION_CLASSES,
  REDACTION_MARKER_PATTERN,
  redactText,
} from "./redaction.js";
export type {
  RedactionFinding,
  RedactionOptions,
  RedactionResult,
  RedactionScope,
  Redactor,
} from "./redaction.js";
export { assertSafeCommand, NodeProcessRunner } from "./process.js";
export { normalizeShellCommand } from "./shell-command.js";
export { nodeSupervisedProcessDependencies, SupervisedProcessRunner } from "./supervised-process.js";
export type {
  SupervisedChildHandleV1,
  SupervisedChildSpawnV1,
  SupervisedPhaseV1,
  SupervisedProcessDependenciesV1,
  SupervisedProcessEvidenceV1,
  SupervisedSpawnRequestV1,
  SupervisedTerminationV1,
} from "./supervised-process.js";
export type { NormalizedShellCommand } from "./shell-command.js";
export {
  admitPosixRootOwned,
  recheckSystemExecutable,
  recheckSystemExecutableSync,
  SystemExecutableRefusalError,
} from "./system-executables.js";
export type {
  AdmittedSystemExecutableV1,
  SystemExecutableIdV1,
  SystemExecutableRowV1,
  SystemPathInspectorSyncV1,
  SystemPathInspectorV1,
  SystemPathObservationV1,
  SystemPlatformV1,
} from "./system-executables.js";
export type {
  CommandPolicy,
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "./process.js";
export {
  discoverCli,
  parseStructuredPayload,
  screenDerivedPathArgument,
  screenProseArgument,
  screenValueArgument,
} from "./cli.js";
export type { CliInstallation, DiscoverCliDependencies } from "./cli.js";
export { capGraphemes, screenAndCap, screenControlCharacters } from "./screen.js";
export { isVisuallyBlank, perceptualKey } from "./text.js";
export { boundedProse, fenced, screenParagraphs } from "./markdown.js";
export {
  inspectPlannerGraph,
  sampleNodePlannerProcess,
  spawnNodePlannerChild,
  TargetPlannerSupervisor,
  ReleasePlanningScratchAttempt,
  ReleasePlanningScratchStore,
  ZstdUstarAdmission,
} from "./update/index.js";
export type {
  PlannerCapabilityV1,
  PlannerChildProcessV1,
  PlannerGraphFindingV1,
  PlannerGraphV1,
  PlannerProcessSampleV1,
  PlannerSpawnRequestV1,
  PlannerTranscriptIdentityV1,
  PlannerWireBoundsV1,
  ReleasePlanningAttemptIdV1,
  ReleasePlanningScratchJournalV1,
  ReleasePlanningScratchRequestV1,
  ReleasePlanningScratchStoreDependencies,
  ReleasePlanningScratchV1,
  VerifiedScratchBundleV1,
  TargetPlannerRunRequestV1,
  TargetPlannerRunResultV1,
  TargetPlannerSupervisorDependencies,
} from "./update/index.js";

export {
  admitGitCapability,
  admitGitExecutables,
  expandGitArgv,
  GIT_DISTRIBUTION_POLICY,
  GIT_DISTRIBUTION_POLICY_ID,
  hashGitProcessTable,
  parseGitAlternateObjectDirectory,
  parseGitConfigQuotedPath,
  parseGitVersionLine,
  validateSupportedGitProcessTable,
} from "./git/index.js";
export type {
  AdmittedGitDistributionV1,
  AdmittedGitExecutablesV1,
  GitAlternateObjectDirectoryV1,
  GitArgSlotV1,
  GitArgSlotValuesV1,
  GitArgTokenV1,
  GitArgvGrammarV1,
  GitConfigQuotedPathV1,
  GitEnvironmentProfileV1,
  GitProcessEdgeV1,
  GitProcessIoProfileV1,
  GitProcessNodeV1,
  GitDistributionPolicyV2,
  GitProcessPhaseBudgetV1,
  SupportedGitProcessTableV1,
} from "./git/index.js";
export { PERSISTED_GIT_PUSH_PLAN_CODEC, validateGitSyncPlan } from "./git/index.js";
export type { GitSyncPlanV1, PersistedGitPushPlanV1 } from "./git/index.js";
export {
  GuardedSha1PackReader,
  materializeSanitizedBareDestinationShadow,
  prepareLocalReceive,
  validateShadowConfigTemplate,
} from "./git/index.js";
export type {
  GitLocalReceivePreparationV1,
  GitLocalReceiveRequestV1,
  GitLocalReceiveRunV1,
  GitPackClosureEvidenceV1,
  SanitizedBareDestinationShadowV1,
} from "./git/index.js";
export { admittingGitIdentityProbe, GitProcessSupervisor } from "./git/index.js";
export type {
  GitConcreteProcessRequestV1,
  GitExecutableIdentityProbeV1,
  GitProcessAdmissionV1,
  GitProcessEvidenceV1,
  GitProcessIntentV1,
  GitProcessPermitV1,
  GitProcessPhaseV1,
  GitProcessSupervisorV1,
  GitPushPhaseV1,
} from "./git/index.js";
export {
  createOpaqueGitLocalToken,
  hashShadowConfigTemplate,
  materializeGitExecGateway,
  materializeSanitizedGitShadow,
  runGitGateway,
  SanitizedLocalRemoteHelper,
  sanitizedGitEnvironment,
} from "./git/index.js";
export type {
  GitEnvironmentSlotValuesV1,
  GitExecGatewayV1,
  SanitizedGitShadowConfigTemplateV1,
} from "./git/index.js";

export interface SecurityPolicy {
  assertReadable(path: string): Promise<void>;
  assertWritable(path: string): Promise<void>;
  assertDisjoint(paths: readonly string[]): Promise<void>;
  redact(text: string): RedactionResult;
  assertCommand(request: ProcessRequest): void;
}
export { TargetVerifierSupervisor } from "./update/index.js";
export type { TargetVerifierRunRequestV1, TargetVerifierRunResultV1, TargetVerifierSupervisorDependencies } from "./update/index.js";
