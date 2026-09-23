import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createOwnerUpdateRegistry,
  keepOwnerUpdateProvider,
  ownerContentDependencies,
  parseBundleRelativePath,
  planOwners,
  plannerPathToken,
  validateOwnerDraft,
  validateReleaseIdentity,
  validateUpdatePlannerRequest,
} from "@developer-os/core";
import type { OwnerTargetEntryV1, OwnerUpdateProviderRequestV1, UpdatePlannerRequestV1 } from "@developer-os/core";
import type { RenderedArtifact } from "@developer-os/workflow-schema";
import { MARKETPLACE_RELATIVE_PATH, PLUGIN_TREE_PREFIX } from "../plugin.js";
import type { MarketplaceRootArtifact } from "../plugin.js";
import { codexOwnerUpdateProvider, codexTargetEntries, planCodexOwner } from "./plan.js";

const productHome = "/synthetic/home/.developer-os";
const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
const t = plannerPathToken;
const evidence = { reopenCanonicalAbsolutePath: (path: string) => path, containsCanonicalPath: () => true, hasFoldedAlias: () => false };
const release = (version: string, sequence: string) => validateReleaseIdentity({
  version, releaseSequence: sequence, releaseIdentityHash: sha(`identity-${version}`),
  delegationSequence: "1", delegationHash: sha("delegation"), releaseIndexSequence: sequence, releaseIndexHash: sha(`index-${sequence}`),
  bundleManifestHash: sha(`manifest-${version}`), bundleRoot: `/product/releases/${version}/darwin-arm64`,
  platform: "darwin", architecture: "arm64", launcherProtocol: 1, updateProtocol: 1,
}, evidence);

function asInstallTree(tree: readonly RenderedArtifact[]): readonly MarketplaceRootArtifact[] {
  return tree as readonly MarketplaceRootArtifact[];
}

const marketplace = '{"name":"developer-os"}\n';
const skill = "codex skill v1\n";
const retired = "retired skill\n";

interface Row { readonly owner: string; readonly kind: string; readonly source: string; readonly contents: string | null }

/** Synthetic installed rows: sources are owner-root-relative, as `proposeCodexInstall` records them. */
function requestFor(rows: readonly Row[]): UpdatePlannerRequestV1 {
  let blob = 0;
  const columns = (row: Row) => ({
    owner: row.owner, kind: row.kind,
    verification: row.contents === null ? { mode: "content" } : { mode: "content", installedHash: sha(row.contents) },
    productVersion: "1.0.0", source: row.source, mergeStrategy: "dedicated",
  });
  const observed = (row: Row) => {
    if (row.contents === null) return { state: "directory", mode: 448 };
    const bytes = Buffer.byteLength(row.contents);
    const ref = { stream: "input", ordinal: blob, bytes, sha256: sha(row.contents) };
    blob += 1;
    return { state: "content", mode: 384, bytes, sha256: sha(row.contents), blob: ref };
  };
  const owners = ["core", "claude", "codex", "macos"].filter((owner) => rows.some((row) => row.owner === owner));
  return validateUpdatePlannerRequest({
    schemaVersion: 1, protocol: 1, plannedAt: "2026-09-23T08:00:00Z", platform: "darwin", architecture: "arm64",
    currentRelease: release("1.0.0", "1"), targetRelease: release("2.0.0", "2"),
    manifest: { schemaVersion: 1, productVersion: "1.0.0", installedAt: "2026-09-01T08:00:00Z", artifacts: rows.map((row, index) => ({ token: t(index), ...columns(row), currentHash: row.contents === null ? null : sha(row.contents) })) },
    config: { schemaVersion: 1, brainRoot: "brain_root", adapters: { claude: owners.includes("claude"), codex: true }, git: { enabled: false }, automation: { enabled: false }, brain: null, redactionPatternsCount: 0, telemetry: false },
    installedOwners: owners,
    artifactInputs: rows.map((row, index) => ({ token: t(index), ...columns(row), observed: observed(row) })),
    brain: { schemaVersion: 1, root: "brain_root", folderPolicyVersion: 1, aggregateBytes: 0, entries: [] },
  });
}

const codexRows: readonly Row[] = [
  { owner: "codex", kind: "file", source: MARKETPLACE_RELATIVE_PATH, contents: marketplace },
  { owner: "codex", kind: "directory", source: PLUGIN_TREE_PREFIX, contents: null },
  { owner: "codex", kind: "file", source: `${PLUGIN_TREE_PREFIX}/skills/a.md`, contents: skill },
  { owner: "codex", kind: "file", source: `${PLUGIN_TREE_PREFIX}/skills/old.md`, contents: retired },
];

const targetTree = asInstallTree([
  { path: `${PLUGIN_TREE_PREFIX}/skills/b.md`, contents: "new skill\n" },
  { path: MARKETPLACE_RELATIVE_PATH, contents: marketplace },
  { path: `${PLUGIN_TREE_PREFIX}/skills/a.md`, contents: "codex skill v2\n" },
]);
const bundlePrefix = parseBundleRelativePath("payload/codex");
const target = codexTargetEntries(targetTree, bundlePrefix);

function providerRequest(request: UpdatePlannerRequestV1, entries: readonly OwnerTargetEntryV1[] = target): OwnerUpdateProviderRequestV1 {
  return { owner: "codex", manifest: request.manifest, artifacts: request.artifactInputs.filter((row) => row.owner === "codex"), target: entries };
}

function registry() {
  return createOwnerUpdateRegistry([keepOwnerUpdateProvider("core"), keepOwnerUpdateProvider("claude"), codexOwnerUpdateProvider, keepOwnerUpdateProvider("macos")]);
}

describe("codexTargetEntries", () => {
  it("maps the marketplace-root tree onto sorted, hashed target-bundle entries", () => {
    expect(target.map((entry) => entry.path)).toEqual([MARKETPLACE_RELATIVE_PATH, `${PLUGIN_TREE_PREFIX}/skills/a.md`, `${PLUGIN_TREE_PREFIX}/skills/b.md`]);
    expect(target[1]?.content).toEqual({ kind: "target_bundle", path: `payload/codex/${PLUGIN_TREE_PREFIX}/skills/a.md`, bytes: Buffer.byteLength("codex skill v2\n"), sha256: sha("codex skill v2\n") });
  });

  it("refuses a path outside the plugin tree, which would under-nest silently", () => {
    expect(() => codexTargetEntries(asInstallTree([{ path: ".codex-plugin/plugin.json", contents: "{}\n" }]), bundlePrefix)).toThrow(/PLUGIN_TREE_PREFIX/u);
  });
});

describe("planCodexOwner", () => {
  it("plans files plus exactly one registration refresh over the exact Codex partition", () => {
    const request = requestFor(codexRows);
    const draft = validateOwnerDraft(planCodexOwner(providerRequest(request)), request.manifest);
    expect(draft.proposedOperations.map((operation) => operation.operation)).toEqual(["replace", "remove", "create"]);
    expect(draft.externalEffects).toEqual([{ kind: "codex_registration_refresh", owner: "codex", artifactTokens: [t(0), t(1), t(2), t(3)] }]);
  });

  it("requests no refresh when every file is byte-identical", () => {
    const request = requestFor(codexRows);
    const unchanged = codexTargetEntries(asInstallTree([
      { path: MARKETPLACE_RELATIVE_PATH, contents: marketplace },
      { path: `${PLUGIN_TREE_PREFIX}/skills/a.md`, contents: skill },
      { path: `${PLUGIN_TREE_PREFIX}/skills/old.md`, contents: retired },
    ]), bundlePrefix);
    expect(planCodexOwner(providerRequest(request, unchanged))).toEqual({ owner: "codex", currentArtifacts: [t(0), t(1), t(2), t(3)], proposedOperations: [], externalEffects: [] });
  });

  it("keeps adapter drafts root-free", () => {
    const request = requestFor(codexRows);
    expect(JSON.stringify(planCodexOwner(providerRequest(request)))).not.toContain(productHome);
    expect(JSON.stringify(planCodexOwner(providerRequest(request)))).not.toContain("/synthetic");
  });

  it("plans only the codex owner", () => {
    const request = requestFor(codexRows);
    expect(() => planCodexOwner({ ...providerRequest(request), owner: "claude" })).toThrow(/only the codex owner/u);
  });

  it("declares every replaceable Codex file as a content dependency", () => {
    const request = requestFor([{ owner: "core", kind: "file", source: "state/config.json", contents: "{}\n" }, ...codexRows]);
    expect(ownerContentDependencies(registry(), request.manifest)).toEqual([t(1), t(3), t(4)]);
  });
});

describe("owner matrices", () => {
  it("plans a Codex-only installation", () => {
    const drafts = planOwners(registry(), { request: requestFor(codexRows), targets: { codex: target } });
    expect(drafts.map((draft) => draft.owner)).toEqual(["codex"]);
    expect(drafts[0]?.externalEffects).toHaveLength(1);
  });

  it("plans a dual installation without touching the Claude partition", () => {
    const rows: readonly Row[] = [{ owner: "claude", kind: "file", source: "SKILL.md", contents: "claude skill\n" }, ...codexRows];
    const drafts = planOwners(registry(), { request: requestFor(rows), targets: { codex: target } });
    expect(drafts.map((draft) => draft.owner)).toEqual(["claude", "codex"]);
    expect(drafts[0]?.proposedOperations).toEqual([]);
    expect(drafts[1]?.currentArtifacts).toEqual([t(1), t(2), t(3), t(4)]);
    expect(drafts.flatMap((draft) => draft.externalEffects)).toHaveLength(1);
  });

  it("leaves an absent Codex owner absent", () => {
    const rows: readonly Row[] = [{ owner: "claude", kind: "file", source: "SKILL.md", contents: "claude skill\n" }];
    const drafts = planOwners(registry(), { request: requestFor(rows), targets: { codex: target } });
    expect(drafts.map((draft) => draft.owner)).toEqual(["claude"]);
  });
});
