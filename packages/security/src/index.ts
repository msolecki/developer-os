import type { ProcessRequest } from "./process.js";
import type { RedactionResult } from "./redaction.js";

export {
  assertDisjointPaths,
  canonicalizePlannedPath,
  resolveOwnedPath,
  SecurityRefusalError,
} from "./paths.js";
export {
  PROTECTED_PATH_RULES,
  ProtectedPathPolicy,
} from "./protected-paths.js";
export type {
  ProtectedPathMatchV1,
  ProtectedPathRuleId,
  ProtectedPathRuleV1,
} from "./protected-paths.js";
export { createRedactor, REDACTION_CLASSES, redactText } from "./redaction.js";
export type {
  RedactionFinding,
  RedactionOptions,
  RedactionResult,
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
  FixedReleaseTransport,
  inspectPlannerGraph,
  nodeReleaseExchange,
  sampleNodePlannerProcess,
  spawnNodePlannerChild,
  TargetPlannerSupervisor,
  readOfflineReleaseTrustFd,
  ReleasePlanningScratchAttempt,
  ReleasePlanningScratchStore,
  ReleaseTransportError,
  renderOfflineReleaseTrustPipe,
  verifyReleaseMetadataChain,
  verifySignedReleaseDocument,
  ZstdUstarAdmission,
} from "./update/index.js";
export type {
  BoundedReleaseResponseV1,
  FixedReleaseTransportDependencies,
  OfflineTrustReaderDependencies,
  PlannerCapabilityV1,
  PlannerChildProcessV1,
  PlannerGraphFindingV1,
  PlannerGraphV1,
  PlannerProcessSampleV1,
  PlannerSpawnRequestV1,
  PlannerTranscriptIdentityV1,
  PlannerWireBoundsV1,
  ReleaseBodySink,
  ReleaseExchangeRequestV1,
  ReleaseExchangeResponseV1,
  ReleaseTransportRequestV1,
  ReleaseIndexDocumentV1,
  ReleaseKeyDelegationDocumentV1,
  ReleaseMetadataChainRequestV1,
  ReleaseMetadataChainV1,
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
  admitGitDistribution,
  expandGitArgv,
  hashGitProcessTable,
  parseGitAlternateObjectDirectory,
  parseGitConfigQuotedPath,
  SUPPORTED_GIT_DISTRIBUTION,
  validateSupportedGitDistribution,
  validateSupportedGitProcessTable,
} from "./git/index.js";
export type {
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
  GitProcessPhaseBudgetV1,
  ObservedGitDistributionV1,
  SupportedGitDistributionV1,
  SupportedGitExecutableV1,
  SupportedGitProcessTableV1,
} from "./git/index.js";

export interface SecurityPolicy {
  assertReadable(path: string): Promise<void>;
  assertWritable(path: string): Promise<void>;
  assertDisjoint(paths: readonly string[]): Promise<void>;
  redact(text: string): RedactionResult;
  assertCommand(request: ProcessRequest): void;
}
