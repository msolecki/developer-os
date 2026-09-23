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
import type { RenderedArtifact } from "@developer-os/workflow-schema";

/**
 * The target release's rendered plugin tree as target-bundle data: each file lands at its
 * plugin-root-relative path and is supplied by `<bundlePrefix>/<path>` in the signed bundle.
 */
export function claudeTargetEntries(tree: readonly RenderedArtifact[], bundlePrefix: BundleRelativePathV1): readonly OwnerTargetEntryV1[] {
  return [...tree]
    .sort((left, right) => compareCodePoints(left.path, right.path))
    .map((artifact): OwnerTargetEntryV1 => {
      const bytes = Buffer.from(artifact.contents, "utf8");
      return {
        path: parseVaultRelativePathText(artifact.path) as string as OwnerRelativePathV1,
        content: { kind: "target_bundle", path: parseBundleRelativePath(`${bundlePrefix}/${artifact.path}`), bytes: bytes.byteLength, sha256: parseLowerHexSha256(hashBytes(bytes)) },
      };
    });
}

/** Claude owns whole files under its plugin root and registers nothing, so it plans files only. */
export function planClaudeOwner(request: OwnerUpdateProviderRequestV1): OwnerUpdateDraftV1 {
  if (request.owner !== "claude") throw new Error("the Claude provider plans only the claude owner");
  return {
    owner: "claude",
    currentArtifacts: request.artifacts.map((artifact) => artifact.token),
    proposedOperations: planOwnedFileTree(request),
    externalEffects: [],
  };
}

/** Every replaceable Claude file, so a replace or remove carries the bytes its inverse needs. */
function claudeContentDependencies(snapshot: PlannerManifestSnapshotV1): readonly PlannerPathTokenV1[] {
  return snapshot.artifacts.filter((row) => row.owner === "claude" && isChangeableOwnerArtifact(row)).map((row) => row.token);
}

export const claudeOwnerUpdateProvider: OwnerUpdateProviderV1 = Object.freeze({
  owner: "claude",
  contentDependencies: claudeContentDependencies,
  plan: planClaudeOwner,
});
