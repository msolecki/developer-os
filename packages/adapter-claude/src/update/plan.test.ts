import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createOwnerUpdateRegistry,
  keepOwnerUpdateProvider,
  ownerContentDependencies,
  parseBundleRelativePath,
  plannerPathToken,
  validateReleaseIdentity,
  validateUpdatePlannerRequest,
} from "@developer-os/core";
import type { UpdatePlannerRequestV1 } from "@developer-os/core";
import { claudeOwnerUpdateProvider, claudeTargetEntries } from "./plan.js";

const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
const t = plannerPathToken;
const evidence = { reopenCanonicalAbsolutePath: (path: string) => path, containsCanonicalPath: () => true, hasFoldedAlias: () => false };
const release = (version: string, sequence: string) => validateReleaseIdentity({
  version, releaseSequence: sequence, releaseIdentityHash: sha(`identity-${version}`),
  delegationSequence: "1", delegationHash: sha("delegation"), releaseIndexSequence: sequence, releaseIndexHash: sha(`index-${sequence}`),
  bundleManifestHash: sha(`manifest-${version}`), bundleRoot: `/product/releases/${version}/darwin-arm64`,
  platform: "darwin", architecture: "arm64", launcherProtocol: 1, updateProtocol: 1,
}, evidence);

interface Row { readonly owner: string; readonly kind: string; readonly source: string; readonly contents: string | null }

/** Synthetic installed rows: sources are plugin-root-relative, as `proposeClaudeInstall` records them. */
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
    config: { schemaVersion: 1, brainRoot: "brain_root", adapters: { claude: true, codex: owners.includes("codex") }, git: { enabled: false }, automation: { enabled: false }, brain: null, redactionPatternsCount: 0, telemetry: false },
    installedOwners: owners,
    artifactInputs: rows.map((row, index) => ({ token: t(index), ...columns(row), observed: observed(row) })),
    brain: { schemaVersion: 1, root: "brain_root", folderPolicyVersion: 1, aggregateBytes: 0, entries: [] },
  });
}

const claudeRows: readonly Row[] = [
  { owner: "claude", kind: "file", source: "SKILL.md", contents: "shared v1\n" },
  { owner: "claude", kind: "directory", source: "skills", contents: null },
  { owner: "claude", kind: "file", source: "skills/old/SKILL.md", contents: "retired\n" },
];

const bundlePrefix = parseBundleRelativePath("payload/claude");
const target = claudeTargetEntries([
  { path: "skills/new/SKILL.md", contents: "new\n" },
  { path: "SKILL.md", contents: "shared v2\n" },
], bundlePrefix);

function registry() {
  return createOwnerUpdateRegistry([keepOwnerUpdateProvider("core"), claudeOwnerUpdateProvider, keepOwnerUpdateProvider("codex"), keepOwnerUpdateProvider("macos")]);
}

describe("claudeTargetEntries", () => {
  it("maps the rendered plugin tree onto sorted, hashed target-bundle entries", () => {
    expect(target).toEqual([
      { path: "SKILL.md", content: { kind: "target_bundle", path: "payload/claude/SKILL.md", bytes: Buffer.byteLength("shared v2\n"), sha256: sha("shared v2\n") } },
      { path: "skills/new/SKILL.md", content: { kind: "target_bundle", path: "payload/claude/skills/new/SKILL.md", bytes: 4, sha256: sha("new\n") } },
    ]);
  });

  it("refuses an escaping rendered path", () => {
    expect(() => claudeTargetEntries([{ path: "../escape.md", contents: "x" }], bundlePrefix)).toThrow();
  });
});

describe("claudeOwnerUpdateProvider", () => {
  it("declares every replaceable Claude file as a content dependency", () => {
    expect(ownerContentDependencies(registry(), requestFor(claudeRows).manifest)).toEqual([t(0), t(2)]);
  });
});
