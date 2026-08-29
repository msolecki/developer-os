export { parseAgentPromptArgs } from "./agent-prompt/index.js";
export { decodeCanonicalJson, encodeCanonicalJson } from "./lifecycle/canonical-json.js";
export type { CanonicalJsonV1, CanonicalJsonValue } from "./lifecycle/canonical-json.js";
export * from "./update/index.js";
export type {
  AgentPromptArgs,
  AgentPromptOutcome,
} from "./agent-prompt/index.js";
export { CAPABILITY_STATES, PROBE_OBSERVATIONS } from "./capabilities/index.js";
export type { CapabilityState, ProbeObservation } from "./capabilities/index.js";
export {
  EXIT_CODES,
  failure,
  formatJsonResult,
  publish,
  redactPayload,
  success,
} from "./result.js";
export type { CliError, CliResult, ExitCode, RedactedPayload } from "./result.js";
export {
  loadConfig,
  pathSegmentViolation,
  resolveRuntimePaths,
  serializeConfig,
} from "./config/index.js";
export type {
  BrainConfigV1,
  DeveloperOsConfigV1,
  PathEnvironment,
  RuntimePaths,
} from "./config/index.js";
export {
  buildConflictEvidence,
  containsPath,
  containsPathLoosely,
  foldPath,
  detectDrift,
  hashBytes,
  ManifestMissingError,
  ManifestStateError,
  ManifestStore,
  ManifestUnsupportedArtifactError,
  validateManifest,
  validateManifestBytes,
  validateManifestV1,
  validateManifestV2,
  validateMigratableManifestV1,
} from "./manifest/index.js";
export type {
  ArtifactKind,
  ArtifactOwner,
  ConflictEvidence,
  ConflictEvidenceRequest,
  DriftFileSystem,
  DriftFinding,
  DriftKind,
  DriftRequest,
  InstallationManifestV1,
  ManagedArtifactV1,
  ManifestFileSystem,
  ManifestGuards,
  ManifestStoreDependencies,
  MergeStrategy,
  InstallationManifest,
  InstallationManifestV2,
  ManagedArtifactCommonV2,
  ManagedArtifactSchemaIdV1,
  ManagedArtifactV2,
  MigratableInstallationManifestV1,
} from "./manifest/index.js";
export { ChangePlanError, validateChangePlan } from "./plans/index.js";
export type {
  ChangeOperationKind,
  ChangePlanContext,
  ChangePlanOperationV1,
  ChangePlanRefusalReason,
  ChangePlanV1,
  ValidatedChangePlanOperationV1,
} from "./plans/index.js";
export { compareVersions, tablePermits } from "./versions/index.js";
export type { CapabilityVersionTable } from "./versions/index.js";
export {
  recoverTransaction,
  TransactionBackupRetentionError,
  TransactionConflictError,
  TransactionExecutor,
  TransactionGuardError,
  TransactionPlanError,
  TransactionPreconditionError,
  TransactionStateError,
  TransactionStore,
  validateJournal,
} from "./transactions/index.js";
export type {
  FileMutation,
  PlannedFileMutation,
  TransactionAfterPhase,
  TransactionExecutorDependencies,
  TransactionFileSystem,
  TransactionGuards,
  TransactionJournalV1,
  TransactionLockHandle,
  TransactionLockProvider,
  TransactionPhase,
  TransactionPlan,
  TransactionRecoveryRequest,
  TransactionRecoveryResult,
  TransactionStoreDependencies,
} from "./transactions/index.js";
