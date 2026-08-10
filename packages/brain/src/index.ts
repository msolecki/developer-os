export {
  compareCanonical,
  compareRawBytes,
  discoverNotes,
  PRIVATE_FOLDERS,
} from "./discovery/index.js";
export type {
  DirectoryEntry,
  DirectoryReader,
  DiscoveredNote,
  DiscoveryRequest,
  DiscoveryResult,
} from "./discovery/index.js";
export {
  artifactPaths,
  buildIndex,
  extractLinks,
  renderArtifacts,
  frontmatterExceeds,
  MAX_FRONTMATTER_CHARS,
  renderCatalog,
  renderVaultMap,
  TOP_TAGS_PER_FOLDER,
  serializeGraph,
  serializeIndex,
  tokenize,
} from "./indexes/index.js";
export type {
  AmbiguousLink,
  ArtifactPaths,
  GraphDocumentV1,
  GraphEdge,
  GraphNode,
  IndexBuildRequest,
  IndexBuildResult,
  IndexDocumentV1,
  IndexedFolder,
  IndexedFolderType,
  IndexedNote,
  IndexedTag,
  IndexedTerm,
  NoteIssues,
  UnresolvedLink,
} from "./indexes/index.js";
export {
  canonicalizeArtifact,
  firstDifferingLine,
  GENERATED_AT_SENTINEL,
  lintVault,
} from "./lint/index.js";
export type {
  LintClass,
  LintFinding,
  LintRequest,
  LintResult,
  LintSeverity,
} from "./lint/index.js";
export {
  FIELD_WEIGHTS,
  FUNNEL_STAGES,
  search,
} from "./retrieval/index.js";
export type {
  RetrievalFieldMatch,
  RetrievalMatch,
  RetrievalQuery,
  RetrievalResult,
} from "./retrieval/index.js";
export { BRAIN_MIGRATIONS } from "./migrations/index.js";
export type { BrainMigration, VaultSnapshot } from "./migrations/index.js";
export { CAPTURE_STATUSES } from "./schema/capture.js";
export type {
  CaptureEnvelopeV1,
  CaptureRedactionFinding,
  CaptureStatus,
} from "./schema/capture.js";
export { DEFAULT_BRAIN_CONFIG, resolveBrainConfig } from "./schema/config.js";
export { BrainService } from "./service.js";
export type {
  BrainArtifacts,
  BrainIndexUnavailable,
  BrainSearchOutcome,
  BrainServiceDependencies,
  BrainStatusReportV1,
} from "./service.js";
export {
  MAX_SUMMARY_LENGTH,
  NOTE_AUTHORS,
  NOTE_STAGES,
  NOTE_TYPES,
  parseNote,
  renderNote,
  RESERVED_KEYS,
} from "./schema/note.js";
export type { BrainConfigV1 } from "@developer-os/core";
export type {
  NoteAuthor,
  NoteFrontmatterV1,
  NoteIssueCode,
  NoteParseIssue,
  NoteParseResult,
  NoteStage,
  NoteType,
  ParsedNote,
} from "./schema/note.js";
