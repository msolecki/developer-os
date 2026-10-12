import { isChangeableOwnerArtifact } from "@developer-os/core/planner-protocol";
import type { OwnerUpdateProviderV1, PlannerManifestSnapshotV1, PlannerPathTokenV1 } from "@developer-os/core";

/** Every replaceable Claude file, so a replace or remove carries the bytes its inverse needs. */
function claudeContentDependencies(snapshot: PlannerManifestSnapshotV1): readonly PlannerPathTokenV1[] {
  return snapshot.artifacts.filter((row) => row.owner === "claude" && isChangeableOwnerArtifact(row)).map((row) => row.token);
}

export const claudeOwnerUpdateProvider: OwnerUpdateProviderV1 = Object.freeze({
  owner: "claude",
  contentDependencies: claudeContentDependencies,
});
