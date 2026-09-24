import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createOwnerUpdateRegistry,
  keepOwnerUpdateProvider,
  ownerContentDependencies,
  planOwnedFileTree,
  planOwners,
  rehydrateOwnerCreates,
  validateOwnerDraft,
  type OwnerTargetEntryV1,
  type OwnerUpdateProviderRequestV1,
  type OwnerUpdateProviderV1,
  type OwnerUpdateRegistryV1,
} from "./owner.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1, type CanonicalPathEvidenceV1, type OwnerRelativePathV1 } from "./paths.js";
import { plannerPathToken, validateUpdatePlannerRequest, type OwnerUpdateDraftV1, type PlannerChangePlanOperationV1, type PlannerPathTokenV1, type UpdatePlannerRequestV1 } from "./planner.js";
import { parseBundleRelativePath, validateReleaseIdentity, type ReleaseIdentityV1 } from "./release.js";
import { parseLowerHexSha256, type LowerHexSha256 } from "./scalars.js";

const encoder = new TextEncoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);
const sha = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const t = (ordinal: number): PlannerPathTokenV1 => plannerPathToken(ordinal);
const evidence: CanonicalPathEvidenceV1 = {
  reopenCanonicalAbsolutePath: (value) => value,
  containsCanonicalPath: (root, candidate) => candidate === root || candidate.startsWith(`${root}/`),
  hasFoldedAlias: () => false,
};

function release(version: string, sequence: string): ReleaseIdentityV1 {
  return validateReleaseIdentity({
    version, releaseSequence: sequence, releaseIdentityHash: sha(`identity-${version}`),
    delegationSequence: "1", delegationHash: sha("delegation"), releaseIndexSequence: sequence, releaseIndexHash: sha(`index-${sequence}`),
    bundleManifestHash: sha(`manifest-${version}`), bundleRoot: `/product/releases/${version}/darwin-arm64`,
    platform: "darwin", architecture: "arm64", launcherProtocol: 1, updateProtocol: 1,
  }, evidence);
}

const configBytes = bytes('{"schemaVersion":1}\n');
const marketplaceBytes = bytes('{"name":"developer-os"}\n');
const skillBytes = bytes("codex skill v1\n");
const oldBytes = bytes("retired skill\n");
const linkHash = sha("skills/a.md");

interface Row {
  readonly owner: string;
  readonly kind: string;
  readonly verification: object;
  readonly source: string;
  readonly currentHash: string | null;
  readonly observed: object;
}

let blobOrdinal = 0;
function content(value: Uint8Array): object {
  const ref = { stream: "input", ordinal: blobOrdinal, bytes: value.byteLength, sha256: sha(value) };
  blobOrdinal += 1;
  return { state: "content", mode: 384, bytes: value.byteLength, sha256: sha(value), blob: ref };
}

function rows(): readonly Row[] {
  blobOrdinal = 0;
  return [
    { owner: "core", kind: "file", verification: { mode: "schema", schemaId: "developer-os-config-v1", installedHash: sha(configBytes) }, source: "state/config.json", currentHash: sha(configBytes), observed: content(configBytes) },
    { owner: "core", kind: "directory", verification: { mode: "content" }, source: "state", currentHash: null, observed: { state: "directory", mode: 448 } },
    { owner: "core", kind: "file", verification: { mode: "ephemeral" }, source: "state/lock", currentHash: null, observed: { state: "absent" } },
    { owner: "codex", kind: "file", verification: { mode: "content", installedHash: sha(marketplaceBytes) }, source: ".agents/plugins/marketplace.json", currentHash: sha(marketplaceBytes), observed: content(marketplaceBytes) },
    { owner: "codex", kind: "directory", verification: { mode: "content" }, source: "plugins/developer-os", currentHash: null, observed: { state: "directory", mode: 448 } },
    { owner: "codex", kind: "symlink", verification: { mode: "content", installedHash: linkHash }, source: "plugins/developer-os/link", currentHash: linkHash, observed: { state: "symlink", targetBytes: 11, targetHash: linkHash } },
    { owner: "codex", kind: "file", verification: { mode: "content", installedHash: sha(oldBytes) }, source: "plugins/developer-os/skills/old.md", currentHash: sha(oldBytes), observed: content(oldBytes) },
    { owner: "codex", kind: "file", verification: { mode: "content", installedHash: sha(skillBytes) }, source: "plugins/developer-os/skills/a.md", currentHash: sha(skillBytes), observed: content(skillBytes) },
  ];
}

function requestValue(): Record<string, unknown> {
  const all = rows();
  const common = (row: Row) => ({ owner: row.owner, kind: row.kind, verification: row.verification, productVersion: "1.0.0", source: row.source, mergeStrategy: "dedicated" });
  return {
    schemaVersion: 1,
    protocol: 1,
    plannedAt: "2026-09-23T08:00:00.000Z",
    platform: "darwin",
    architecture: "arm64",
    currentRelease: release("1.0.0", "1"),
    targetRelease: release("2.0.0", "2"),
    manifest: { schemaVersion: 1, productVersion: "1.0.0", installedAt: "2026-09-01T08:00:00.000Z", artifacts: all.map((row, index) => ({ token: t(index), ...common(row), currentHash: row.currentHash })) },
    config: {
      schemaVersion: 1, brainRoot: "brain_root", adapters: { claude: false, codex: true }, git: { enabled: false }, automation: { enabled: false },
      brain: null, redactionPatternsCount: 0, telemetry: false,
    },
    installedOwners: ["core", "codex"],
    artifactInputs: all.map((row, index) => ({ token: t(index), ...common(row), observed: row.observed })),
    brain: { schemaVersion: 1, root: "brain_root", folderPolicyVersion: 1, aggregateBytes: 0, entries: [] },
  };
}

const request = (): UpdatePlannerRequestV1 => validateUpdatePlannerRequest(requestValue());
const snapshot = () => request().manifest;
const rel = (path: string): OwnerRelativePathV1 => path as OwnerRelativePathV1;
const bundle = (path: string, size = 3): OwnerTargetEntryV1["content"] => ({ kind: "target_bundle", path: parseBundleRelativePath(path), bytes: size, sha256: sha(path) });
const installed = (ordinal: number) => ({ kind: "installed" as const, token: t(ordinal) });
const create = (path: string, size = 3): PlannerChangePlanOperationV1 => ({ operation: "create", target: { kind: "owner_relative", owner: "codex", path: rel(path) }, content: bundle(`payload/${path}`, size) });
const codexPartition = [t(3), t(4), t(5), t(6), t(7)];

function codexDraft(operations: readonly PlannerChangePlanOperationV1[], effects: OwnerUpdateDraftV1["externalEffects"] = []): OwnerUpdateDraftV1 {
  return { owner: "codex", currentArtifacts: codexPartition, proposedOperations: operations, externalEffects: effects };
}

const refresh = { kind: "codex_registration_refresh", owner: "codex", artifactTokens: codexPartition } as const;

interface CountingProvider extends OwnerUpdateProviderV1 {
  readonly calls: number;
}

function counting(provider: OwnerUpdateProviderV1): CountingProvider {
  const state = { calls: 0 };
  return {
    owner: provider.owner,
    contentDependencies: provider.contentDependencies,
    plan: (input) => {
      state.calls += 1;
      return provider.plan(input);
    },
    get calls() {
      return state.calls;
    },
  };
}

const codexFiles: OwnerUpdateProviderV1 = {
  owner: "codex",
  contentDependencies: (manifest) => manifest.artifacts.filter((row) => row.owner === "codex" && row.kind === "file").map((row) => row.token),
  plan: (input) => {
    const operations = planOwnedFileTree(input);
    return { owner: "codex", currentArtifacts: input.artifacts.map((row) => row.token), proposedOperations: operations, externalEffects: operations.length === 0 ? [] : [refresh] };
  },
};

const codexTarget: readonly OwnerTargetEntryV1[] = [
  { path: rel(".agents/plugins/marketplace.json"), content: { kind: "target_bundle", path: parseBundleRelativePath("payload/codex/.agents/plugins/marketplace.json"), bytes: marketplaceBytes.byteLength, sha256: sha(marketplaceBytes) } },
  { path: rel("plugins/developer-os/skills/a.md"), content: bundle("payload/codex/plugins/developer-os/skills/a.md", 15) },
  { path: rel("plugins/developer-os/skills/b.md"), content: bundle("payload/codex/plugins/developer-os/skills/b.md") },
];

function registry(overrides: Partial<Record<"core" | "claude" | "codex" | "macos", OwnerUpdateProviderV1>> = {}): OwnerUpdateRegistryV1 {
  return createOwnerUpdateRegistry([
    overrides.core ?? keepOwnerUpdateProvider("core"),
    overrides.claude ?? keepOwnerUpdateProvider("claude"),
    overrides.codex ?? codexFiles,
    overrides.macos ?? keepOwnerUpdateProvider("macos"),
  ]);
}

describe("owner registry", () => {
  it("orders exactly one provider per closed owner", () => {
    expect(registry().map((provider) => provider.owner)).toEqual(["core", "claude", "codex", "macos"]);
  });

  it("refuses a missing, duplicate, or unknown provider", () => {
    const core = keepOwnerUpdateProvider("core");
    const claude = keepOwnerUpdateProvider("claude");
    const macos = keepOwnerUpdateProvider("macos");
    expect(() => createOwnerUpdateRegistry([core, claude, macos])).toThrow(/missing provider for codex/u);
    expect(() => createOwnerUpdateRegistry([core, claude, codexFiles, codexFiles, macos])).toThrow(/duplicate provider/u);
    expect(() => createOwnerUpdateRegistry([core, claude, codexFiles, macos, { ...macos, owner: "brain" as never }])).toThrow(/unknown owner/u);
  });
});

describe("planOwners", () => {
  it("calls exactly one provider for every installed owner and none for absent owners", () => {
    const core = counting(keepOwnerUpdateProvider("core"));
    const absentProvider = counting(keepOwnerUpdateProvider("claude"));
    const macos = counting(keepOwnerUpdateProvider("macos"));
    const codex = counting(codexFiles);
    const result = planOwners(registry({ core, claude: absentProvider, codex, macos }), { request: request(), targets: { codex: codexTarget } });
    expect(result.map((row) => row.owner)).toEqual(["core", "codex"]);
    expect([core.calls, codex.calls, absentProvider.calls, macos.calls]).toEqual([1, 1, 0, 0]);
  });

  it("plans keep, replace, remove, and create with one refresh over the exact Codex partition", () => {
    const [, codex] = planOwners(registry(), { request: request(), targets: { codex: codexTarget } });
    expect(codex?.proposedOperations).toEqual([
      { operation: "remove", target: installed(6), expectedHash: sha(oldBytes) },
      { operation: "replace", target: installed(7), expectedHash: sha(skillBytes), content: codexTarget[1]?.content },
      { operation: "create", target: { kind: "owner_relative", owner: "codex", path: "plugins/developer-os/skills/b.md" }, content: codexTarget[2]?.content },
    ]);
    expect(codex?.externalEffects).toEqual([refresh]);
  });

  it("returns an empty plan without an effect when every artifact is byte-identical", () => {
    const unchanged: readonly OwnerTargetEntryV1[] = [
      codexTarget[0] as OwnerTargetEntryV1,
      { path: rel("plugins/developer-os/skills/a.md"), content: { kind: "target_bundle", path: parseBundleRelativePath("payload/a.md"), bytes: skillBytes.byteLength, sha256: sha(skillBytes) } },
      { path: rel("plugins/developer-os/skills/old.md"), content: { kind: "target_bundle", path: parseBundleRelativePath("payload/old.md"), bytes: oldBytes.byteLength, sha256: sha(oldBytes) } },
    ];
    const [, codex] = planOwners(registry(), { request: request(), targets: { codex: unchanged } });
    expect(codex).toEqual(codexDraft([]));
  });

  it("refuses a change to a token its provider did not declare as a content dependency", () => {
    const undeclared: OwnerUpdateProviderV1 = { ...codexFiles, contentDependencies: () => [] };
    expect(() => planOwners(registry({ codex: undeclared }), { request: request(), targets: { codex: codexTarget } })).toThrow(/declared content dependency/u);
  });

  it("refuses a keep provider handed files to ship", () => {
    expect(() => planOwners(registry(), { request: request(), targets: { core: [{ path: rel("state/new.json"), content: bundle("payload/new.json") }], codex: codexTarget } })).toThrow(/cannot plan/u);
  });

  it("refuses a provider that answers for another owner", () => {
    const impostor: OwnerUpdateProviderV1 = { ...codexFiles, plan: () => ({ owner: "core", currentArtifacts: [t(0), t(1), t(2)], proposedOperations: [], externalEffects: [] }) };
    expect(() => planOwners(registry({ codex: impostor }), { request: request(), targets: {} })).toThrow();
  });
});

describe("ownerContentDependencies", () => {
  it("unions installed owners' declared tokens in token order", () => {
    expect(ownerContentDependencies(registry(), snapshot())).toEqual([t(3), t(6), t(7)]);
  });

  it("never consults an absent owner's provider", () => {
    const absent: OwnerUpdateProviderV1 = { ...keepOwnerUpdateProvider("claude"), contentDependencies: () => { throw new Error("called"); } };
    expect(() => ownerContentDependencies(registry({ claude: absent }), snapshot())).not.toThrow();
  });

  it("refuses a dependency outside the partition or on a keep-only artifact", () => {
    expect(() => ownerContentDependencies(registry({ codex: { ...codexFiles, contentDependencies: () => [t(0)] } }), snapshot())).toThrow(/outside the owner's partition/u);
    expect(() => ownerContentDependencies(registry({ codex: { ...codexFiles, contentDependencies: () => [t(4)] } }), snapshot())).toThrow(/not a regular content file/u);
    expect(() => ownerContentDependencies(registry({ codex: { ...codexFiles, contentDependencies: () => [t(3), t(3)] } }), snapshot())).toThrow(/repeated token/u);
  });
});

describe("validateOwnerDraft", () => {
  it("accepts every target arm against a non-empty partition", () => {
    const draft = codexDraft([
      { operation: "keep", target: installed(3), expectedHash: sha(marketplaceBytes) },
      { operation: "keep", target: installed(4), expectedHash: null },
      { operation: "remove", target: installed(6), expectedHash: sha(oldBytes) },
      { operation: "replace", target: installed(7), expectedHash: sha(skillBytes), content: { kind: "output_blob", blob: { stream: "output", ordinal: 0, bytes: 10 } } },
      create("plugins/developer-os/skills/b.md"),
    ], [refresh]);
    expect(validateOwnerDraft(draft, snapshot())).toEqual(draft);
  });

  it("refuses an absent owner and an incomplete partition", () => {
    expect(() => validateOwnerDraft({ owner: "claude", currentArtifacts: [], proposedOperations: [], externalEffects: [] }, snapshot())).toThrow(/not installed/u);
    expect(() => validateOwnerDraft({ ...codexDraft([]), currentArtifacts: [t(3), t(4)] }, snapshot())).toThrow(/complete partition/u);
  });

  it.each([
    ["another owner's token", [{ operation: "keep", target: installed(0), expectedHash: sha(configBytes) }]],
    ["a repeated token", [{ operation: "keep", target: installed(3), expectedHash: sha(marketplaceBytes) }, { operation: "remove", target: installed(3), expectedHash: sha(marketplaceBytes) }]],
    ["a stale expected hash", [{ operation: "remove", target: installed(7), expectedHash: sha(oldBytes) }]],
    ["a removed directory", [{ operation: "remove", target: installed(4), expectedHash: null }]],
    ["a replaced symlink", [{ operation: "replace", target: installed(5), expectedHash: linkHash, content: bundle("payload/link") }]],
    ["a create over an installed source", [create("plugins/developer-os/skills/a.md")]],
    ["a case-folded duplicate create", [create("plugins/developer-os/B.md"), create("plugins/developer-os/b.md")]],
    ["a create for another owner", [{ operation: "create", target: { kind: "owner_relative", owner: "core", path: rel("x.md") }, content: bundle("payload/x.md") }]],
    ["a create through an installed token", [{ operation: "create", target: installed(7), content: bundle("payload/x.md") }]],
    ["a traversal create", [{ operation: "create", target: { kind: "owner_relative", owner: "codex", path: rel("plugins/../escape.md") }, content: bundle("payload/escape.md") }]],
    ["a changed file over 16 MiB", [create("plugins/developer-os/big.bin", 16_777_217)]],
    ["an output blob over 16 MiB", [{ operation: "replace", target: installed(7), expectedHash: sha(skillBytes), content: { kind: "output_blob", blob: { stream: "output", ordinal: 0, bytes: 16_777_217 } } }]],
  ] as unknown as [string, PlannerChangePlanOperationV1[]][])("refuses %s", (_name, operations) => {
    expect(() => validateOwnerDraft(codexDraft(operations), snapshot())).toThrow();
  });

  it("keeps an ephemeral reservation keep-only", () => {
    const draft: OwnerUpdateDraftV1 = { owner: "core", currentArtifacts: [t(0), t(1), t(2)], proposedOperations: [{ operation: "remove", target: installed(2), expectedHash: null }], externalEffects: [] };
    expect(() => validateOwnerDraft(draft, snapshot())).toThrow(/keep-only/u);
  });

  it("refuses a second effect, a non-Codex effect, a partial token set, and an effect without a change", () => {
    const change = [create("plugins/developer-os/skills/b.md")];
    expect(() => validateOwnerDraft(codexDraft(change, [refresh, refresh]), snapshot())).toThrow(/second external effect/u);
    expect(() => validateOwnerDraft(codexDraft(change, [{ ...refresh, artifactTokens: [t(3), t(7)] }]), snapshot())).toThrow(/exact Codex partition/u);
    expect(() => validateOwnerDraft(codexDraft([], [refresh]), snapshot())).toThrow(/without a file change/u);
    const coreEffect: OwnerUpdateDraftV1 = { owner: "core", currentArtifacts: [t(0), t(1), t(2)], proposedOperations: [], externalEffects: [{ ...refresh, artifactTokens: [t(0), t(1), t(2)] }] };
    expect(() => validateOwnerDraft(coreEffect, snapshot())).toThrow(/closed Codex refresh/u);
  });

  it("refuses extra keys", () => {
    expect(() => validateOwnerDraft({ ...codexDraft([]), root: "/Users/synthetic" } as unknown as OwnerUpdateDraftV1, snapshot())).toThrow(/not exact/u);
  });
});

describe("planOwnedFileTree", () => {
  const providerRequest = (target: readonly OwnerTargetEntryV1[]): OwnerUpdateProviderRequestV1 => {
    const value = request();
    return { owner: "codex", manifest: value.manifest, artifacts: value.artifactInputs.filter((row) => row.owner === "codex"), target };
  };

  it("refuses an unsorted target and a collision with a keep-only artifact", () => {
    expect(() => planOwnedFileTree(providerRequest([codexTarget[1] as OwnerTargetEntryV1, codexTarget[0] as OwnerTargetEntryV1]))).toThrow(/sorted/u);
    expect(() => planOwnedFileTree(providerRequest([{ path: rel("plugins/developer-os/link"), content: bundle("payload/link") }]))).toThrow(/keep-only/u);
  });
});

describe("rehydrateOwnerCreates", () => {
  const root = parseCanonicalAbsolutePathText("/synthetic/home/codex");
  const tokenPaths = new Map<PlannerPathTokenV1, CanonicalAbsolutePathV1>(
    snapshot().artifacts.map((row) => [row.token, parseCanonicalAbsolutePathText(row.owner === "codex" ? `${root}/${row.source}` : `/synthetic/home/${row.source}`)]),
  );
  const context = { ownerRoot: root, tokenPaths, evidence };

  it("rehydrates a create under a kept directory", () => {
    expect(rehydrateOwnerCreates(codexDraft([create("plugins/developer-os/skills/b.md")], [refresh]), snapshot(), context)).toEqual([`${root}/plugins/developer-os/skills/b.md`]);
  });

  it("refuses an uncontained create", () => {
    const escaping = { ...context, evidence: { ...evidence, containsCanonicalPath: () => false } };
    expect(() => rehydrateOwnerCreates(codexDraft([create("plugins/developer-os/skills/b.md")]), snapshot(), escaping)).toThrow(/not canonically contained/u);
  });

  it("refuses a create beneath an installed file or a removed row", () => {
    expect(() => rehydrateOwnerCreates(codexDraft([create("plugins/developer-os/skills/a.md/inner.md")]), snapshot(), context)).toThrow(/kept directory/u);
    const removal: PlannerChangePlanOperationV1 = { operation: "remove", target: installed(6), expectedHash: sha(oldBytes) };
    expect(() => rehydrateOwnerCreates(codexDraft([removal, create("plugins/developer-os/skills/old.md/inner.md")]), snapshot(), context)).toThrow(/kept directory/u);
  });

  it("refuses a create that aliases another owner's installed path", () => {
    const aliased = new Map(tokenPaths);
    aliased.set(t(0), parseCanonicalAbsolutePathText(`${root}/plugins/developer-os/skills/b.md`));
    expect(() => rehydrateOwnerCreates(codexDraft([create("plugins/developer-os/skills/B.md")]), snapshot(), { ...context, tokenPaths: aliased })).toThrow(/collides/u);
  });
});
