import { admitTargetUpdateDraft } from "./planner.js";
import type { TargetUpdateDraftV1, UpdatePlannerRequestV1 } from "./planner.js";
import type { StableSemverV1 } from "./scalars.js";

/** Every current row kept byte-identical at the target version; a row the draft grammar cannot express throws. */
function keptManifestRow(row: UpdatePlannerRequestV1["manifest"]["artifacts"][number], version: StableSemverV1): unknown {
  const installed = { kind: "installed", token: row.token };
  const common = { owner: row.owner, path: installed, productVersion: version, source: row.source, mergeStrategy: row.mergeStrategy, kind: row.kind };
  const { verification } = row;
  if (row.kind === "directory") return { ...common, verification: { mode: "content" } };
  if (row.kind === "symlink") return { ...common, verification: { mode: "content", installed } };
  if (row.kind === "file" && verification.mode === "content") return { ...common, verification: { mode: "content", installed } };
  if (row.kind === "file" && verification.mode === "schema") return { ...common, verification: { mode: "schema", schemaId: verification.schemaId, installed } };
  if (row.kind === "file" && verification.mode === "ephemeral") return { ...common, verification: { mode: "ephemeral" } };
  throw new Error(`the keep-all planner has no draft arm for a ${row.kind} row in ${verification.mode} mode`);
}

/**
 * The release's target planner (Task 11b K2, Q3): every installed owner keeps its whole partition,
 * so the update is the release itself (bundle, metadata, trust, active, rollback payload, verifier).
 */
export function planKeepAllRelease(request: UpdatePlannerRequestV1): TargetUpdateDraftV1 {
  return admitTargetUpdateDraft({
    schemaVersion: 1,
    protocol: request.protocol,
    currentRelease: request.currentRelease,
    targetRelease: request.targetRelease,
    ownerPlans: request.installedOwners.map((owner) => ({
      owner,
      currentArtifacts: request.artifactInputs.filter((input) => input.owner === owner).map((input) => input.token),
      proposedOperations: [],
      externalEffects: [],
    })),
    migrations: [],
    expectedManifest: {
      schemaVersion: 2,
      productVersion: request.targetRelease.version,
      artifacts: request.manifest.artifacts.map((row) => keptManifestRow(row, request.targetRelease.version)),
    },
  }, request).draft;
}
