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
  readOfflineReleaseTrustFd,
  renderOfflineReleaseTrustPipe,
  verifyReleaseMetadataChain,
  verifySignedReleaseDocument,
} from "./update/index.js";
export type {
  OfflineTrustReaderDependencies,
  ReleaseIndexDocumentV1,
  ReleaseKeyDelegationDocumentV1,
  ReleaseMetadataChainRequestV1,
  ReleaseMetadataChainV1,
} from "./update/index.js";

export interface SecurityPolicy {
  assertReadable(path: string): Promise<void>;
  assertWritable(path: string): Promise<void>;
  assertDisjoint(paths: readonly string[]): Promise<void>;
  redact(text: string): RedactionResult;
  assertCommand(request: ProcessRequest): void;
}
