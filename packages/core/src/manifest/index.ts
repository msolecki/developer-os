export { buildConflictEvidence, detectDrift } from "./drift.js";
export {
  containsPath,
  containsPathLoosely,
  foldPath,
  hashBytes,
  isMissing,
  ManifestMissingError,
  ManifestStateError,
  ManifestStore,
  ManifestUnsupportedArtifactError,
  validateManifest,
} from "./store.js";
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
} from "./types.js";
