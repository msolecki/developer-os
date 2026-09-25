/**
 * The `@developer-os/core/planner-protocol` subpath: the pure values an owner or migration planner
 * needs. A target planner bundle imports this instead of the barrel, whose lifecycle, manifest and
 * transaction modules reach `node:fs` (Spec 2 §2's capability-absence gate scans this graph).
 */
export { planSchemaMigrations } from "./update/migration-planning.js";
export { isChangeableOwnerArtifact, planOwnedFileTree } from "./update/owner.js";
export { parseVaultRelativePathText } from "./update/paths.js";
export { compareUtf8, parseBundleRelativePath } from "./update/release.js";
export { parseLowerHexSha256 } from "./update/scalars.js";
