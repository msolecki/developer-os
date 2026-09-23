export {
  admitGitDistribution,
  gitDistributionIdentity,
  SUPPORTED_GIT_DISTRIBUTION,
  validateSupportedGitDistribution,
} from "./distribution.js";
export {
  expandGitArgv,
  GIT_PACK_OBJECT_COUNT_MAX,
  hashGitProcessTable,
  parseGitAlternateObjectDirectory,
  parseGitConfigQuotedPath,
  SUPPORTED_GIT_DISTRIBUTION_ID,
  SUPPORTED_GIT_PROCESS_TABLE,
  validateSupportedGitProcessTable,
} from "./process-table.js";
export type { GitArgSlotValuesV1 } from "./process-table.js";
export {
  CLOSED_GATEWAY_BASENAMES,
  CLOSED_GIT_ENVIRONMENT_NAMES,
  CLOSED_GIT_PROCESS_EDGE_IDS,
  CLOSED_GIT_PROCESS_NODE_IDS,
  GIT_ARG_SLOTS,
  GIT_ENVIRONMENT_PROFILE_IDS,
  GIT_EXEC_PATH_LINK_NAMES,
  GIT_EXECUTABLE_IDS,
  GIT_PROCESS_IO_PROFILE_IDS,
  GIT_PROCESS_PHASE_BUDGET_IDS,
} from "./types.js";
export type {
  ClosedGatewayBasenameV1,
  ClosedGitEnvironmentNameV1,
  ClosedGitProcessEdgeIdV1,
  ClosedGitProcessNodeIdV1,
  ExecutableFileIdentityV1,
  GitAlternateObjectDirectoryV1,
  GitArgSlotV1,
  GitArgTokenV1,
  GitArgvGrammarV1,
  GitConfigQuotedPathV1,
  GitEnvironmentProfileIdV1,
  GitEnvironmentProfileV1,
  GitEnvironmentValueV1,
  GitExecPathLinkV1,
  GitExecutableIdV1,
  GitProcessEdgeV1,
  GitProcessImageV1,
  GitProcessIoProfileV1,
  GitProcessNodeV1,
  GitProcessPhaseBudgetV1,
  ObservedGitDistributionV1,
  SupportedGitDistributionV1,
  SupportedGitExecutableV1,
  SupportedGitProcessTableV1,
} from "./types.js";
export { admittingGitIdentityProbe, GitProcessSupervisor } from "./supervisor.js";
export type {
  GitConcreteProcessRequestV1,
  GitEnvironmentSlotValuesV1,
  GitExecutableIdentityProbeV1,
  GitProcessAdmissionV1,
  GitProcessEvidenceV1,
  GitProcessIntentV1,
  GitProcessPermitV1,
  GitProcessPhaseV1,
  GitProcessStdinClassV1,
  GitProcessSupervisorV1,
  GitPushPhaseV1,
} from "./supervisor.js";
export {
  bindShadowConfigToTemplate,
  createOpaqueGitLocalToken,
  deslotShadowConfig,
  hashShadowConfig,
  hashShadowConfigProjection,
  hashShadowConfigTemplate,
  instantiateShadowConfig,
  materializeSanitizedBareDestinationShadow,
  materializeSanitizedGitShadow,
  OPAQUE_LOCAL_SELECTOR_PREFIX,
  parseOpaqueGitLocalToken,
  renderGitConfigQuoted,
  renderShadowConfig,
  validateShadowConfig,
  validateShadowConfigTemplate,
  verifySanitizedGitShadow,
} from "./shadow.js";
export type {
  GitShadowIdentityV1,
  GitShadowSnapshotRefV1,
  InstantiatedGitShadowConfigV1,
  OpaqueGitLocalTokenV1,
  SanitizedBareDestinationShadowV1,
  SanitizedGitShadowConfigBytesV1,
  SanitizedGitShadowConfigTemplateV1,
  SanitizedGitShadowConfigV1,
  SanitizedGitShadowRequestV1,
  SanitizedGitShadowSlotsV1,
  SanitizedGitShadowV1,
  SanitizedShadowRemoteUrlV1,
} from "./shadow.js";
export {
  GIT_GATEWAY_TRAMPOLINE_TEMPLATE,
  hashGitGatewayTemplate,
  materializeGitExecGateway,
  renderGitGatewayTrampoline,
  runGitGateway,
  runSshBridge,
  SanitizedLocalRemoteHelper,
  sanitizedGitEnvironment,
  verifyGitExecGateway,
} from "./gateways.js";
export type {
  GitExecGatewayRequestV1,
  GitExecGatewayV1,
  GitGatewayInvocationV1,
  GitGatewayOutcomeV1,
  GitGatewayTransitionV1,
  GitGatewayTrampolineV1,
  GitLocalHelperStepV1,
  GitSshBridgeInvocationV1,
  SanitizedGitEnvironmentV1,
  SanitizedLocalRemoteHelperOptionsV1,
  SanitizedLocalRemoteHelperV1,
  SanitizedSshBridgeV1,
} from "./gateways.js";
export { PERSISTED_GIT_PUSH_PLAN_CODEC, validateGitSyncPlan, validatePersistedGitPushPlan } from "./push-plan.js";
export type { GitSyncPlanV1, PersistedGitPushDestinationV1, PersistedGitPushPlanV1 } from "./push-plan.js";
export {
  destroyGitQuarantine,
  GIT_PACK_READER_LIMITS,
  GIT_PACK_READER_TRANSIENT_BYTES,
  GitPackReaderLedger,
  gitPackReaderBudget,
  GuardedSha1PackReader,
} from "./pack-reader.js";
export type { GitPackClosureEvidenceV1, GitPackReaderLimitsV1, GitPackReadRequestV1 } from "./pack-reader.js";
export { prepareLocalReceive } from "./local-receive.js";
export type {
  GitLocalReceivePreparationV1,
  GitLocalReceiveProcessNodeV1,
  GitLocalReceiveRequestV1,
  GitLocalReceiveRunV1,
} from "./local-receive.js";
