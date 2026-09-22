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
