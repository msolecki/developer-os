import { Buffer } from "node:buffer";
import { hashBytes, isChangeableOwnerArtifact, parseBundleRelativePath, parseLowerHexSha256, parseVaultRelativePathText, planOwnedFileTree } from "@developer-os/core";
import type {
  BundleRelativePathV1,
  OwnerRelativePathV1,
  OwnerTargetEntryV1,
  OwnerUpdateDraftV1,
  OwnerUpdateProviderRequestV1,
  OwnerUpdateProviderV1,
  PlannerManifestSnapshotV1,
  PlannerPathTokenV1,
} from "@developer-os/core";
import { compareCodePoints } from "@developer-os/workflow-schema";
import { MARKETPLACE_RELATIVE_PATH, PLUGIN_TREE_PREFIX } from "../plugin.js";
import type { MarketplaceRootArtifact } from "../plugin.js";

/** The same boundary `proposeCodexInstall` holds: a marketplace-root path outside it under-nests silently. */
function marketplaceRelative(path: string): OwnerRelativePathV1 {
  if (path !== MARKETPLACE_RELATIVE_PATH && !path.startsWith(`${PLUGIN_TREE_PREFIX}/`)) {
    throw new Error(`target path must be MARKETPLACE_RELATIVE_PATH or under PLUGIN_TREE_PREFIX: ${path}`);
  }
  return parseVaultRelativePathText(path) as string as OwnerRelativePathV1;
}

/**
 * The target release's marketplace-root install tree as target-bundle data: each file lands at
 * its marketplace-root-relative path and is supplied by `<bundlePrefix>/<path>` in the signed bundle.
 */
export function codexTargetEntries(tree: readonly MarketplaceRootArtifact[], bundlePrefix: BundleRelativePathV1): readonly OwnerTargetEntryV1[] {
  return [...tree]
    .sort((left, right) => compareCodePoints(left.path, right.path))
    .map((artifact): OwnerTargetEntryV1 => {
      const bytes = Buffer.from(artifact.contents, "utf8");
      return {
        path: marketplaceRelative(artifact.path),
        content: { kind: "target_bundle", path: parseBundleRelativePath(`${bundlePrefix}/${artifact.path}`), bytes: bytes.byteLength, sha256: parseLowerHexSha256(hashBytes(bytes)) },
      };
    });
}

/**
 * Codex caches an installed plugin, so any file change requests the one closed registration
 * refresh over the exact Codex partition; the current provider observes and executes it.
 */
export function planCodexOwner(request: OwnerUpdateProviderRequestV1): OwnerUpdateDraftV1 {
  if (request.owner !== "codex") throw new Error("the Codex provider plans only the codex owner");
  for (const entry of request.target) marketplaceRelative(entry.path);
  const currentArtifacts = request.artifacts.map((artifact) => artifact.token);
  const proposedOperations = planOwnedFileTree(request);
  return {
    owner: "codex",
    currentArtifacts,
    proposedOperations,
    externalEffects: proposedOperations.length === 0 ? [] : [{ kind: "codex_registration_refresh", owner: "codex", artifactTokens: currentArtifacts }],
  };
}

/** Every replaceable Codex file, so a replace or remove carries the bytes its inverse needs. */
function codexContentDependencies(snapshot: PlannerManifestSnapshotV1): readonly PlannerPathTokenV1[] {
  return snapshot.artifacts.filter((row) => row.owner === "codex" && isChangeableOwnerArtifact(row)).map((row) => row.token);
}

export const codexOwnerUpdateProvider: OwnerUpdateProviderV1 = Object.freeze({
  owner: "codex",
  contentDependencies: codexContentDependencies,
  plan: planCodexOwner,
});
