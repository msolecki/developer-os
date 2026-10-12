export {
  assertTrustedDirectoryEntry,
  MacOsPlatformAdapter,
  MacOsPlatformDiscoveryError,
  MacOsPlatformTrustError,
} from "./macos.js";
export {
  parseVendorSearchPath,
  VENDOR_SEARCH_PATH_VARIABLE,
  vendorSearchPathOption,
} from "./vendor-search-path.js";
export { parseVendorHomeVariables, VENDOR_HOME_VARIABLES, VendorHomeVariableError } from "./vendor-home-variables.js";
export type { VendorHomeVariable } from "./vendor-home-variables.js";
export { DARWIN_SYSTEM_EXECUTABLES, inspectSystemPath, inspectSystemPathSync } from "./system-executables.js";
export type {
  AgentDiscovery,
  AgentName,
  PlatformAdapter,
  PlatformFacts,
} from "./types.js";
export {
  MacOsRetainedRename,
  MacOsRetainedRenameRefusalError,
  MacOsRetainedRenameUnavailableError,
  SpawnRenameAtxRunner,
} from "./retained-rename.js";
export type {
  ExactNoReplaceRenameRequestV1,
  RenameNoReplace,
  RenameAtxRunner,
  RenameAtxRunRequestV1,
  RenameSameParentNoReplace,
} from "./retained-rename.js";
export {
  admitLauncherPlatformIdentity,
  LauncherBundleAdmission,
} from "./launcher/index.js";
export type {
  AdmittedReleaseBundleV1,
  LauncherGuardedReaderV1,
  LauncherPlatformIdentityV1,
} from "./launcher/index.js";
export { MacOsStableLockProvider } from "./stable-lock.js";
export {
  MacOsTransactionLockProvider,
  MacOsTransactionLockUnavailableError,
  SpawnLockfRunner,
} from "./transaction-lock.js";
export {
  LAUNCHD_JOBS,
  LaunchdInputError,
  MAX_LAUNCHD_PLIST_BYTES,
  buildLaunchdPlanPreview,
  encodeLaunchdPlist,
  encodeRetainedLaunchdPlist,
  generatedLabel,
  gitSyncEligible,
  launchdCalendarInterval,
  launchdGeneration,
  launchdGuiDomain,
  launchdJob,
  launchdLogPath,
  launchdPlistDictionary,
  launchdPlistPath,
  launchdStatusPath,
  parseGeneratedLabel,
  parseScheduleFlag,
  parseScheduledProductHome,
  reconcileAutomationSchedules,
  scheduledArgvParts,
  scheduledBaseArgv,
  scheduledProgramArguments,
} from "./launchd/index.js";
export type {
  GeneratedLaunchdLabelV1,
  LaunchdCalendarIntervalV1,
  LaunchdGenerationV1,
  LaunchdGuiDomainV1,
  LaunchdLiveStateV1,
  LaunchdPlanPreviewEntryV1,
  LaunchdPlanPreviewV1,
  LaunchdPlistDictionaryV1,
  LaunchdPriorJobStateV1,
} from "./launchd/index.js";
export {
  LAUNCHD_PREVIEW_OBSERVATION_TABLE,
  LaunchdDistributionUnsupportedError,
  LaunchdObserver,
  SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
  admitLaunchdHost,
  expandLaunchdProcessTable,
  launchdObservationProcessTableHash,
  launchdProcessTableHash,
  launchdProcessTableTemplateHash,
} from "./launchd/index.js";
export type {
  LaunchdEmptyDirectoryObservationV1,
  LaunchdHostObserverV1,
  LaunchdLiveObservationV1,
  LaunchdProcessDirectoryIdentityV1,
  SupportedLaunchdProcessTableTemplateV1,
} from "./launchd/index.js";
export { LaunchdPathBootstrapper } from "./launchd/index.js";
export type {
  LaunchdBootstrapPlistIdentityV1,
  LaunchdBootstrapRequestV1,
} from "./launchd/index.js";
export {
  LAUNCHD_EFFECT_LEDGER_CODEC,
  LAUNCHD_PLAN_CODEC,
  LAUNCHD_PLAN_PREVIEW_CODEC,
  LaunchdBootoutRunner,
  LaunchdEffectExecutor,
  LaunchdEffectJournalStore,
  NodeLaunchdPlistReader,
  assertLaunchdPlanBindings,
  launchdEffectPlan,
  launchdPlanVariant,
  launchdPlistBytesHash,
  loadLaunchdProcessTable,
  parseCanonicalLaunchdPlist,
  planLaunchdTransitions,
} from "./launchd/index.js";
export type {
  LaunchdBootstrapPlistsV1,
  LaunchdEffectDependenciesV1,
  LaunchdPlanV1,
  LaunchdPlistPortV1,
  LifecycleFileBindingV1,
} from "./launchd/index.js";
