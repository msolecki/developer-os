import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { admitTargetUpdateDraft, decodePlannerInput, encodePlannerInput, plannerPathToken, validateUpdatePlannerRequest } from "./planner.js";
import type { UpdatePlannerRequestV1 } from "./planner.js";
import { planKeepAllRelease } from "./release-planner.js";
import { validateReleaseIdentity } from "./release.js";
import { parseLowerHexSha256 } from "./scalars.js";

const sha = (value: string) => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const evidence = {
  reopenCanonicalAbsolutePath: (value: string) => value,
  containsCanonicalPath: (root: string, candidate: string) => candidate === root || candidate.startsWith(`${root}/`),
  hasFoldedAlias: () => false,
};
const release = (version: string, sequence: string) =>
  validateReleaseIdentity({
    version, releaseSequence: sequence, releaseIdentityHash: sha(`identity-${version}`),
    delegationSequence: "1", delegationHash: sha("delegation"), releaseIndexSequence: sequence, releaseIndexHash: sha(`index-${sequence}`),
    bundleManifestHash: sha(`manifest-${version}`), bundleRoot: `/product/releases/${version}/darwin-arm64`,
    platform: "darwin", architecture: "arm64", launcherProtocol: 1, updateProtocol: 1,
  }, evidence);

/** Three synthetic rows over two owners: a schema file, a directory, a content file. */
function plannerRequest(): UpdatePlannerRequestV1 {
  const row = (ordinal: number, owner: string, kind: string, verification: object, source: string, currentHash: string | null) =>
    ({ token: plannerPathToken(ordinal), owner, kind, verification, productVersion: "1.0.0", source, mergeStrategy: "dedicated", currentHash });
  const rows = [
    row(0, "core", "file", { mode: "schema", schemaId: "developer-os-config-v1", installedHash: sha("config") }, "state/config.json", sha("config")),
    row(1, "core", "directory", { mode: "content" }, "state", null),
    row(2, "codex", "file", { mode: "content", installedHash: sha("skill") }, "codex/skill.md", sha("skill")),
  ];
  const input = (index: number, observed: object) => {
    const columns: Record<string, unknown> = { ...rows[index], observed };
    delete columns.currentHash;
    return columns;
  };
  return validateUpdatePlannerRequest({
    schemaVersion: 1, protocol: 1, plannedAt: "2026-09-23T08:00:00.000Z", platform: "darwin", architecture: "arm64",
    currentRelease: release("1.0.0", "1"), targetRelease: release("2.0.0", "2"),
    manifest: { schemaVersion: 1, productVersion: "1.0.0", installedAt: "2026-09-01T08:00:00.000Z", artifacts: rows },
    config: {
      schemaVersion: 1, brainRoot: "brain_root", adapters: { claude: false, codex: true }, git: { enabled: false }, automation: { enabled: false },
      brain: null, redactionPatternsCount: 2, telemetry: false,
    },
    installedOwners: ["core", "codex"],
    artifactInputs: [
      input(0, { state: "content", mode: 384, bytes: 6, sha256: sha("config"), blob: null }),
      input(1, { state: "directory", mode: 448 }),
      input(2, { state: "content", mode: 384, bytes: 5, sha256: sha("skill"), blob: null }),
    ],
    brain: { schemaVersion: 1, root: "brain_root", folderPolicyVersion: 1, aggregateBytes: 0, entries: [] },
  });
}

describe("planKeepAllRelease (Task 11b, Q3)", () => {
  it("keeps every installed owner's partition at the target version and admits", () => {
    const request = plannerRequest();
    const draft = planKeepAllRelease(request);
    expect(draft.ownerPlans.map((plan) => plan.owner)).toEqual(request.installedOwners);
    expect(draft.ownerPlans.every((plan) => plan.proposedOperations.length === 0 && plan.externalEffects.length === 0)).toBe(true);
    expect(draft.expectedManifest.productVersion).toBe(request.targetRelease.version);
    expect(() => admitTargetUpdateDraft(draft, request)).not.toThrow();
  });
  it("round-trips through the wire the shim speaks", () => {
    const request = plannerRequest();
    expect(decodePlannerInput(encodePlannerInput(request, [])).request).toEqual(request);
  });
});
