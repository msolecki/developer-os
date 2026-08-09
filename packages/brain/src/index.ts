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
  buildIndex,
  extractLinks,
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
  artifactPaths,
  canonicalizeArtifact,
  firstDifferingLine,
  GENERATED_AT_SENTINEL,
  lintVault,
} from "./lint/index.js";
export type {
  ArtifactPaths,
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
export { DEFAULT_BRAIN_CONFIG, resolveBrainConfig } from "./schema/config.js";
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
