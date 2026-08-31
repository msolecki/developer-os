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
  MacOsRetainedRenameDependencies,
  RenameAtxRunner,
  RenameAtxRunRequestV1,
  RenameAtxRunResultV1,
  RenameSameParentNoReplace,
} from "./retained-rename.js";
export {
  MacOsTransactionLockOperationalError,
  MacOsTransactionLockProvider,
  MacOsTransactionLockUnavailableError,
} from "./transaction-lock.js";
