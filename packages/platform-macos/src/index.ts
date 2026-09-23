export {
  MacOsPlatformAdapter,
  MacOsPlatformDiscoveryError,
  MacOsPlatformTrustError,
  MacOsPlatformInputError,
  MacOsPlatformUnsupportedError,
} from "./macos.js";
export type {
  MacOsPlatformAdapterOptions,
  MacOsPlatformEnvironment,
} from "./macos.js";
export type {
  AgentDiscovery,
  AgentName,
  PlatformAdapter,
  PlatformFacts,
} from "./types.js";
export {
  MacOsRetainedRename,
  MacOsRetainedRenameRefusalError,
  MacOsRetainedRenameThirdStateError,
  MacOsRetainedRenameUnavailableError,
  SpawnRenameAtxRunner,
} from "./retained-rename.js";
export type {
  ExactNoReplaceRenameRequestV1,
  ExactRenameParentIdentityV1,
  MacOsRetainedRenameDependencies,
  RenameNoReplace,
  RenameAtxRunner,
  RenameAtxRunRequestV1,
  RenameAtxRunResultV1,
  RenameSameParentNoReplace,
} from "./retained-rename.js";
export {
  admitLauncherPlatformIdentity,
  LauncherBundleAdmission,
  LauncherBundleRecoveryRequiredError,
  LauncherPlatformUnsupportedError,
} from "./launcher/index.js";
export type {
  AdmittedReleaseBundleV1,
  LauncherBundleAdmissionRequestV1,
  LauncherGuardedReaderV1,
  LauncherPlatformIdentityV1,
} from "./launcher/index.js";
export { MacOsStableLockProvider } from "./stable-lock.js";
export type {
  MacOsStableLockDependencies,
  MacOsStableLockFileSystem,
} from "./stable-lock.js";
export {
  EX_TEMPFAIL,
  MacOsTransactionLockOperationalError,
  MacOsTransactionLockProvider,
  MacOsTransactionLockUnavailableError,
  SpawnLockfRunner,
} from "./transaction-lock.js";
export type { LockfResult, LockfRunner } from "./transaction-lock.js";
export {
  LAUNCHD_JOBS,
  LaunchdInputError,
  MAX_LAUNCHD_PLIST_BYTES,
  boundedCanonicalPlistXml,
  buildLaunchdPlanPreview,
  eligibleLaunchdJobs,
  encodeLaunchdPlist,
  generatedLabel,
  gitSyncEligible,
  launchdCalendarInterval,
  launchdGeneration,
  launchdGuiDomain,
  launchdJob,
  launchdLogPath,
  launchdPlistDictionary,
  launchdPlistPath,
  launchdPriorStateFingerprint,
  launchdStatusPath,
  parseGeneratedLabel,
  parseScheduleFlag,
  parseScheduledProductHome,
  reconcileAutomationSchedules,
  scheduledBaseArgv,
  scheduledProgramArguments,
} from "./launchd/index.js";
export type {
  BoundedCanonicalPlistXmlV1,
  ClosedLaunchdBaseLabelV1,
  GeneratedLaunchdLabelV1,
  LaunchdBaseArgvV1,
  LaunchdCalendarIntervalV1,
  LaunchdGeneratedServiceTargetV1,
  LaunchdGenerationProjectionV1,
  LaunchdGenerationV1,
  LaunchdGuiDomainV1,
  LaunchdJobDefinitionV1,
  LaunchdLiveStateV1,
  LaunchdObservedLabelV1,
  LaunchdObservedServiceTargetV1,
  LaunchdPlanOperationV1,
  LaunchdPlanPreviewEntryV1,
  LaunchdPlanPreviewV1,
  LaunchdPlistDictionaryV1,
  LaunchdPreviewRequestV1,
  LaunchdPriorJobStateV1,
  LaunchdProgramArgumentsV1,
  LaunchdScheduledProductHomeV1,
} from "./launchd/index.js";
