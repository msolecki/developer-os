import type { ProcessRequest } from "./process.js";
import type { RedactionResult } from "./redaction.js";

export {
  assertDisjointPaths,
  canonicalizePlannedPath,
  resolveOwnedPath,
  SecurityRefusalError,
} from "./paths.js";
export { ProtectedPathPolicy } from "./protected-paths.js";
export { REDACTION_CLASSES, redactText } from "./redaction.js";
export type {
  RedactionFinding,
  RedactionOptions,
  RedactionResult,
} from "./redaction.js";
export { assertSafeCommand, NodeProcessRunner } from "./process.js";
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
export { boundedProse, fenced, screenParagraphs } from "./markdown.js";

export interface SecurityPolicy {
  assertReadable(path: string): Promise<void>;
  assertWritable(path: string): Promise<void>;
  assertDisjoint(paths: readonly string[]): Promise<void>;
  redact(text: string): RedactionResult;
  assertCommand(request: ProcessRequest): void;
}
