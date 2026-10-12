import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createOwnerUpdateRegistry,
  keepOwnerUpdateProvider,
  ownerContentDependencies,
  plannerPathToken,
  validateReleaseIdentity,
  validateUpdatePlannerRequest,
} from "@developer-os/core";
import type { UpdatePlannerRequestV1 } from "@developer-os/core";
import { MARKETPLACE_RELATIVE_PATH, PLUGIN_TREE_PREFIX } from "../plugin.js";
import { codexOwnerUpdateProvider } from "./plan.js";

const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
const t = plannerPathToken;
const evidence = { reopenCanonicalAbsolutePath: (path: string) => path, containsCanonicalPath: () => true, hasFoldedAlias: () => false };
const release = (version: string, sequence: string) => validateReleaseIdentity({
  version, releaseSequence: sequence, releaseIdentityHash: sha(`identity-${version}`),
  delegationSequence: "1", delegationHash: sha("delegation"), releaseIndexSequence: sequence, releaseIndexHash: sha(`index-${sequence}`),
  bundleManifestHash: sha(`manifest-${version}`), bundleRoot: `/product/releases/${version}/darwin-arm64`,
  platform: "darwin", architecture: "arm64", launcherProtocol: 1, updateProtocol: 1,
}, evidence);


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
    schemaVersion: 1, protocol: 1, plannedAt: "2026-09-23T08:00:00.000Z", platform: "darwin", architecture: "arm64",
    currentRelease: release("1.0.0", "1"), targetRelease: release("2.0.0", "2"),
    manifest: { schemaVersion: 1, productVersion: "1.0.0", installedAt: "2026-09-01T08:00:00.000Z", artifacts: rows.map((row, index) => ({ token: t(index), ...columns(row), currentHash: row.contents === null ? null : sha(row.contents) })) },
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


function registry() {
  return createOwnerUpdateRegistry([keepOwnerUpdateProvider("core"), keepOwnerUpdateProvider("claude"), codexOwnerUpdateProvider, keepOwnerUpdateProvider("macos")]);
}

describe("codexOwnerUpdateProvider", () => {
  it("declares every replaceable Codex file as a content dependency", () => {
    const request = requestFor([{ owner: "core", kind: "file", source: "state/config.json", contents: "{}\n" }, ...codexRows]);
    expect(ownerContentDependencies(registry(), request.manifest)).toEqual([t(1), t(3), t(4)]);
  });
});
