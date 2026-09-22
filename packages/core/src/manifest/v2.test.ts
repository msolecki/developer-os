import { describe, expect, it } from "vitest";

import { encodeCanonicalJson } from "../lifecycle/canonical-json.js";
import { admitCanonicalAbsolutePath, type CanonicalPathEvidenceV1 } from "../update/paths.js";
import {
  ManifestV1NotMigratableError,
  ManifestStateError,
  validateManifestBytes,
  validateManifestV2,
  validateMigratableManifestV1,
} from "./index.js";
import type { InstallationManifestV2, ManagedArtifactV2, ManifestAdmissionContextV1 } from "./index.js";

const hash = "a".repeat(64);
const evidence: CanonicalPathEvidenceV1 = {
  reopenCanonicalAbsolutePath: (path) => path,
  containsCanonicalPath: (root, candidate) => candidate === root || candidate.startsWith(`${root}/`),
  hasFoldedAlias: () => false,
};

function admission(overrides: Partial<ManifestAdmissionContextV1> = {}): ManifestAdmissionContextV1 {
  return {
    evidence,
    sourceRoot: admitCanonicalAbsolutePath("/synthetic/source", evidence),
    backupRoot: admitCanonicalAbsolutePath("/synthetic/backup", evidence),
    admitOwnerPath: (_owner, path) => path,
    ...overrides,
  };
}

function artifact(overrides: Record<string, unknown> = {}): ManagedArtifactV2 {
  return {
    owner: "core", path: "/synthetic/product/file", productVersion: "1.2.3",
    existedBefore: false, beforeHash: null, backupRelativePath: null,
    source: "templates/file", mergeStrategy: "dedicated", verifiedAt: "2026-08-29T12:00:00.000Z",
    kind: "file", verification: { mode: "content", installedHash: hash }, ...overrides,
  } as ManagedArtifactV2;
}

function manifestWith(...artifacts: readonly ManagedArtifactV2[]): InstallationManifestV2 {
  return { schemaVersion: 2, productVersion: "1.2.3", installedAt: "2026-08-29T12:00:00.000Z", artifacts } as InstallationManifestV2;
}

function legacyBytes(rows: readonly Record<string, unknown>[], overrides: Record<string, unknown> = {}): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify({ schemaVersion: 1, productVersion: "1.2.3", installedAt: "2026-08-29T12:00:00.000Z", artifacts: rows, ...overrides })}\n`);
}

function legacyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { owner: "core", path: "/synthetic/product/file", kind: "file", productVersion: "1.2.3", existedBefore: false, beforeHash: null, backupRelativePath: null, installedHash: hash, source: "templates/file", mergeStrategy: "dedicated", verifiedAt: "2026-08-29T12:00:00.000Z", ...overrides };
}

function expectMigratableRefusal(bytes: Uint8Array, context = admission()): void {
  expect(() => validateMigratableManifestV1(bytes, context)).toThrow(ManifestV1NotMigratableError);
  expect(() => validateMigratableManifestV1(bytes, context)).toThrow(expect.objectContaining({ reason: "manifest_v1_not_migratable" }));
}

describe("InstallationManifestV2", () => {
  it("requires one admission context to bind owner, source, and backup authority", () => {
    const value = manifestWith(artifact({ existedBefore: true, beforeHash: hash, backupRelativePath: "before/file" }));
    expect(validateManifestV2(value, admission())).toStrictEqual(value);
    expect(() => validateManifestV2(manifestWith(artifact({ source: "templates/file" })), admission({
      evidence: { ...evidence, hasFoldedAlias: () => true },
    }))).toThrow(ManifestStateError);
    expect(() => validateManifestV2(value, admission({ admitOwnerPath: (_owner, path) => `${path}/other` as never }))).toThrow(ManifestStateError);
  });

  it.each([
    { name: "file content", arm: artifact() },
    { name: "file schema", arm: artifact({ verification: { mode: "schema", schemaId: "developer-os-config-v1", installedHash: hash } }) },
    { name: "file ephemeral", arm: artifact({ verification: { mode: "ephemeral" } }) },
    { name: "directory content", arm: artifact({ kind: "directory", verification: { mode: "content" } }) },
    { name: "symlink content", arm: artifact({ kind: "symlink", verification: { mode: "content", installedHash: hash } }) },
  ])("admits exactly the legal restore-field states for $name", ({ name, arm }) => {
    for (const existedBefore of [false, true]) for (const beforeHash of [null, hash]) for (const backupRelativePath of [null, "before/file"]) {
      const legal = (name === "file content" || name === "file schema")
        ? (!existedBefore && beforeHash === null && backupRelativePath === null) || (existedBefore && beforeHash === hash && backupRelativePath === "before/file")
        : !existedBefore && beforeHash === null && backupRelativePath === null;
      const value = manifestWith(artifact({ ...arm, existedBefore, beforeHash, backupRelativePath }));
      if (legal) expect(validateManifestV2(value, admission())).toStrictEqual(value);
      else expect(() => validateManifestV2(value, admission())).toThrow(ManifestStateError);
    }
  });

  it("maps every migratable V1 refusal to the content-free reason", () => {
    const bytes = new TextEncoder().encode(`${JSON.stringify({ schemaVersion: 1, productVersion: "1.2.3", installedAt: "2026-08-29T12:00:00.000Z", artifacts: [{ owner: "core", path: "/synthetic/product/file", kind: "symlink", productVersion: "1.2.3", existedBefore: false, beforeHash: null, backupRelativePath: null, installedHash: hash, source: "templates/file", mergeStrategy: "dedicated", verifiedAt: "2026-08-29T12:00:00.000Z" }] })}\n`);
    expect(() => validateMigratableManifestV1(bytes, admission())).toThrow(ManifestV1NotMigratableError);
    expect(() => validateMigratableManifestV1(bytes, admission())).toThrow(expect.objectContaining({ reason: "manifest_v1_not_migratable" }));
  });

  it("accepts a fully admitted positive migratable V1 row", () => {
    const legacy = { schemaVersion: 1, productVersion: "1.2.3", installedAt: "2026-08-29T12:00:00.000Z", artifacts: [{ owner: "core", path: "/synthetic/product/file", kind: "file", productVersion: "1.2.3", existedBefore: true, beforeHash: hash, backupRelativePath: "before/file", installedHash: hash, source: "templates/file", mergeStrategy: "dedicated", verifiedAt: "2026-08-29T12:00:00.000Z" }] };
    expect(validateMigratableManifestV1(new TextEncoder().encode(`${JSON.stringify(legacy)}\n`), admission())).toStrictEqual(legacy);
  });

  it("isolates source and backup root evidence refusals", () => {
    const sourceFailure = admission({ evidence: { ...evidence, containsCanonicalPath: (root, candidate) => root !== "/synthetic/source" && (candidate === root || candidate.startsWith(`${root}/`)) } });
    expect(() => validateManifestV2(manifestWith(artifact()), sourceFailure)).toThrow(ManifestStateError);
    const backupFailure = admission({ evidence: { ...evidence, containsCanonicalPath: (root, candidate) => root !== "/synthetic/backup" && (candidate === root || candidate.startsWith(`${root}/`)) } });
    expect(() => validateManifestV2(manifestWith(artifact({ existedBefore: true, beforeHash: hash, backupRelativePath: "before/file" })), backupFailure)).toThrow(ManifestStateError);
  });
  it.each([
    artifact(),
    artifact({ path: "/synthetic/product/schema", verification: { mode: "schema", schemaId: "developer-os-config-v1", installedHash: hash } }),
    artifact({ path: "/synthetic/product/reservation", verification: { mode: "ephemeral" } }),
    artifact({ path: "/synthetic/product/dir", kind: "directory", verification: { mode: "content" } }),
    artifact({ path: "/synthetic/product/link", kind: "symlink", verification: { mode: "content", installedHash: hash } }),
  ])("round-trips closed arm", (value) => {
    expect(validateManifestV2(manifestWith(value), admission())).toStrictEqual(manifestWith(value));
  });

  it.each([
    artifact({ verification: { mode: "ephemeral" }, existedBefore: true, beforeHash: hash, backupRelativePath: "backup/file" }),
    artifact({ kind: "directory", verification: { mode: "content" }, existedBefore: true, beforeHash: hash, backupRelativePath: "backup/file" }),
    artifact({ kind: "symlink", verification: { mode: "content", installedHash: hash }, existedBefore: true, beforeHash: hash, backupRelativePath: "backup/file" }),
  ])("refuses illegal restore combinations", (value) => {
    expect(() => validateManifestV2(manifestWith(value), admission())).toThrow(ManifestStateError);
  });

  it("rejects exact duplicate paths", () => {
    expect(() => validateManifestV2(manifestWith(artifact(), artifact()), admission())).toThrow(ManifestStateError);
  });

  it("rejects a non-NFC path before collision analysis", () => {
    expect(() => validateManifestV2(manifestWith(artifact({ path: "/synthetic/product/e\u0301" })), admission())).toThrow(ManifestStateError);
  });

  it("reaches folded-collision validation after UTF-8 ordering", () => {
    expect(() => validateManifestV2(manifestWith(artifact({ path: "/synthetic/product/FILE" }), artifact({ path: "/synthetic/product/file" })), admission())).toThrow(ManifestStateError);
  });

  it("accepts only canonical V2 bytes", () => {
    const bytes = new TextEncoder().encode(encodeCanonicalJson(manifestWith(artifact()) as never));
    expect(validateManifestBytes(bytes, admission())).toStrictEqual(manifestWith(artifact()));
    expect(() => validateManifestBytes(new TextEncoder().encode(JSON.stringify(manifestWith(artifact())) + "\n"), admission())).toThrow(ManifestStateError);
  });

  it.each([
    { name: "root", value: { ...manifestWith(artifact()), extra: true } },
    { name: "common artifact", value: manifestWith({ ...artifact(), extra: true } as never) },
    { name: "content verification", value: manifestWith(artifact({ verification: { mode: "content", installedHash: hash, extra: true } })) },
    { name: "schema verification", value: manifestWith(artifact({ verification: { mode: "schema", schemaId: "developer-os-config-v1", installedHash: hash, extra: true } })) },
  ])("refuses an unknown $name key", ({ value }) => {
    expect(() => validateManifestV2(value, admission())).toThrow(ManifestStateError);
  });

  it.each(["developer-os-config-v1", "lifecycle-id-allocator-v1", "active-release-record-v1", "release-trust-state-v1", "codex-registration-v1"])("accepts closed schema ID %s", (schemaId) => {
    expect(validateManifestV2(manifestWith(artifact({ verification: { mode: "schema", schemaId, installedHash: hash } })), admission()).artifacts[0]?.verification.mode).toBe("schema");
  });

  it.each([
    { name: "unstable version", value: manifestWith(artifact({ productVersion: "1.02.3" })) },
    { name: "invalid timestamp", value: manifestWith(artifact({ verifiedAt: "2026-02-29T12:00:00.000Z" })) },
    { name: "bad hash", value: manifestWith(artifact({ verification: { mode: "content", installedHash: "A".repeat(64) } })) },
    { name: "unsafe source", value: manifestWith(artifact({ source: "../private" })) },
    { name: "noncanonical path", value: manifestWith(artifact({ path: "/synthetic/e\u0301" })) },
    { name: "empty artifacts", value: manifestWith() },
    { name: "over maximum artifacts", value: { ...manifestWith(), artifacts: new Array(1_000_001).fill(artifact()) } },
  ])("refuses $name", ({ value }) => {
    expect(() => validateManifestV2(value, admission())).toThrow(ManifestStateError);
  });

  it("checks UTF-8 path order and returns a detached clone", () => {
    const value = manifestWith(artifact({ path: "/synthetic/product/a" }), artifact({ path: "/synthetic/product/z" }));
    const validated = validateManifestV2(value, admission());
    expect(validated).toStrictEqual(value);
    expect(validated.artifacts).not.toBe(value.artifacts);
    expect(() => validateManifestV2(manifestWith(artifact({ path: "/synthetic/product/z" }), artifact({ path: "/synthetic/product/a" })), admission())).toThrow(ManifestStateError);
  });

  it("enforces source and backup byte/component boundaries", () => {
    const maximum = [...Array.from({ length: 15 }, () => "a".repeat(255)), "a".repeat(254), "a"].join("/");
    const components128 = Array.from({ length: 128 }, () => "a").join("/");
    const components129 = Array.from({ length: 129 }, () => "a").join("/");
    const restoring = artifact({ existedBefore: true, beforeHash: hash, backupRelativePath: maximum, source: maximum });
    expect(validateManifestV2(manifestWith(restoring), admission())).toStrictEqual(manifestWith(restoring));
    expect(validateManifestV2(manifestWith(artifact({ source: components128 })), admission())).toBeDefined();
    expect(() => validateManifestV2(manifestWith(artifact({ source: `${maximum}a` })), admission())).toThrow(ManifestStateError);
    expect(() => validateManifestV2(manifestWith(artifact({ source: components129 })), admission())).toThrow(ManifestStateError);
    expect(() => validateManifestV2(manifestWith(artifact({ existedBefore: true, beforeHash: hash, backupRelativePath: "a\\b" })), admission())).toThrow(ManifestStateError);
  });

  it("counts a byte-level artifacts array before canonical materialization", () => {
    const prefix = '{"artifacts":[';
    const suffix = '],"installedAt":"2026-08-29T12:00:00.000Z","productVersion":"1.2.3","schemaVersion":2}\n';
    const tooMany = `${prefix}${new Array(1_000_001).fill("0").join(",")}${suffix}`;
    expect(() => validateManifestBytes(new TextEncoder().encode(tooMany), admission())).toThrow(ManifestStateError);
  });

  it("enforces cardinality before element work while a one-million row shape reaches it", () => {
    let oneMillionReads = 0;
    const oneMillion = new Proxy([], {
      get(_target, key) {
        if (key === "length") return 1_000_000;
        if (key === "0") oneMillionReads += 1;
        return undefined;
      },
      getOwnPropertyDescriptor(_target, key) {
        if (key === "length") return { configurable: false, enumerable: false, value: 1_000_000, writable: true };
        if (key === "0") return { configurable: true, enumerable: true, value: "not-an-artifact", writable: true };
        return undefined;
      },
    });
    expect(() => validateManifestV2({ ...manifestWith(), artifacts: oneMillion }, admission())).toThrow(ManifestStateError);
    expect(oneMillionReads).toBeGreaterThan(0);
    let firstOverReads = 0;
    const firstOver = new Proxy([], { get(_target, key) { if (key === "length") return 1_000_001; if (key === "0") firstOverReads += 1; return undefined; } });
    expect(() => validateManifestV2({ ...manifestWith(), artifacts: firstOver }, admission())).toThrow(ManifestStateError);
    expect(firstOverReads).toBe(0);
  });

  it("checks the byte cap before raw scanning", () => {
    let exactReads = 0;
    const exact = new Proxy({ byteLength: 67_108_864 }, { get(target, key) { if (key === "0") exactReads += 1; return target[key as keyof typeof target]; } }) as unknown as Uint8Array;
    expect(() => validateManifestBytes(exact, admission())).toThrow(ManifestStateError);
    expect(exactReads).toBeGreaterThan(0);
    let firstOverReads = 0;
    const firstOver = new Proxy({ byteLength: 67_108_865 }, { get(target, key) { if (key === "0") firstOverReads += 1; return target[key as keyof typeof target]; } }) as unknown as Uint8Array;
    expect(() => validateManifestBytes(firstOver, admission())).toThrow(ManifestStateError);
    expect(firstOverReads).toBe(0);
  });

  it("accepts compact V1 bytes but rejects duplicate, trailing, and BOM variants", () => {
    const legacy = { schemaVersion: 1, productVersion: "legacy", installedAt: "2026-08-29T12:00:00.000Z", artifacts: [] };
    const compact = new TextEncoder().encode(`${JSON.stringify(legacy)}\n`);
    expect(validateManifestBytes(compact, admission())).toStrictEqual(legacy);
    expect(() => validateManifestBytes(new TextEncoder().encode('{"schemaVersion":1,"schemaVersion":1,"productVersion":"legacy","installedAt":"2026-08-29T12:00:00.000Z","artifacts":[]}\n'), admission())).toThrow(ManifestStateError);
    expect(() => validateManifestBytes(new TextEncoder().encode(`${JSON.stringify(legacy)}\nnull`), admission())).toThrow(ManifestStateError);
    expect(() => validateManifestBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...compact]), admission())).toThrow(ManifestStateError);
  });

  it("rejects an unknown manifest schema version before any V2 admission", () => {
    const unknown = new TextEncoder().encode(encodeCanonicalJson({ schemaVersion: 3, productVersion: "1.2.3", installedAt: "2026-08-29T12:00:00.000Z", artifacts: [] }));
    expect(() => validateManifestBytes(unknown)).toThrow(ManifestStateError);
  });

  it.each([
    { name: "symlink", patch: { kind: "symlink" } },
    { name: "config entry", patch: { kind: "config-entry" } },
    { name: "pre-existing directory", patch: { kind: "directory", existedBefore: true, beforeHash: hash, backupRelativePath: "backups/file" } },
    { name: "directory without empty sentinel", patch: { kind: "directory", installedHash: hash } },
    { name: "unsafe source", patch: { source: "../private" } },
    { name: "unsafe backup", patch: { existedBefore: true, beforeHash: hash, backupRelativePath: "../backup" } },
  ])("refuses non-migratable V1 $name", ({ patch }) => {
    expectMigratableRefusal(legacyBytes([legacyRow(patch)]));
  });

  it.each([
    { name: "empty", bytes: legacyBytes([]) },
    { name: "manifest unstable semver", bytes: legacyBytes([legacyRow()], { productVersion: "1.02.3" }) },
    { name: "artifact unstable semver", bytes: legacyBytes([legacyRow({ productVersion: "1.02.3" })]) },
    { name: "loose installed timestamp", bytes: legacyBytes([legacyRow()], { installedAt: "2026-08-29T12:00:00Z" }) },
    { name: "loose verified timestamp", bytes: legacyBytes([legacyRow({ verifiedAt: "2026-08-29T12:00:00Z" })]) },
    { name: "exact collision", bytes: legacyBytes([legacyRow(), legacyRow()]) },
    { name: "folded collision", bytes: legacyBytes([legacyRow({ path: "/synthetic/product/FILE" }), legacyRow({ path: "/synthetic/product/file" })]) },
    { name: "non NFC path", bytes: legacyBytes([legacyRow({ path: "/synthetic/product/e\u0301" })]) },
  ])("gives only the migration refusal reason for V1 $name", ({ bytes }) => {
    expectMigratableRefusal(bytes);
  });

  it("accepts both V1 restore variants", () => {
    expect(validateMigratableManifestV1(legacyBytes([legacyRow()]), admission())).toMatchObject({ artifacts: [legacyRow()] });
    expect(validateMigratableManifestV1(legacyBytes([legacyRow({ existedBefore: true, beforeHash: hash, backupRelativePath: "before/file" })]), admission())).toMatchObject({ artifacts: [legacyRow({ existedBefore: true, beforeHash: hash, backupRelativePath: "before/file" })] });
  });

  it("does no admission work for byte and cardinality refusal before content could be read", () => {
    let admissions = 0;
    const context = admission({ admitOwnerPath: (_owner, path) => { admissions += 1; return path; } });
    expectMigratableRefusal(new TextEncoder().encode('{\n}'), context);
    expect(admissions).toBe(0);
    let elementReads = 0;
    const firstOver = new Proxy([], {
      get(_target, key) {
        if (key === "length") return 1_000_001;
        if (key === "0") elementReads += 1;
        return undefined;
      },
    });
    expect(Array.isArray(firstOver)).toBe(true);
    expect(() => validateManifestV2({ ...manifestWith(), artifacts: firstOver }, context)).toThrow(ManifestStateError);
    expect(elementReads).toBe(0);
    expect(admissions).toBe(0);
  });

  it("refuses a legacy alternate encoding before artifact bytes are read", () => {
    const legacy = { schemaVersion: 1, productVersion: "1.2.3", installedAt: "2026-08-29T12:00:00.000Z", artifacts: [{ owner: "core", path: "/synthetic/product/file", kind: "file", productVersion: "1.2.3", existedBefore: false, beforeHash: null, backupRelativePath: null, installedHash: hash, source: "templates/file", mergeStrategy: "dedicated", verifiedAt: "2026-08-29T12:00:00.000Z" }] };
    let admissions = 0;
    const context = admission({ admitOwnerPath: (_owner, path) => { admissions += 1; return path; } });
    expectMigratableRefusal(new TextEncoder().encode(JSON.stringify(legacy, null, 2) + "\n"), context);
    expect(admissions).toBe(0);
  });
});

describe("InstallationManifestV2 instruction arms", () => {
  const member = (category: string, id: string): Record<string, unknown> => ({ category, id, source: "default", sha256: hash });
  function contentRow(overrides: Record<string, unknown> = {}): ManagedArtifactV2 {
    return artifact({
      owner: "claude", path: "/synthetic/product/claude/skills/debugging/SKILL.md", kind: "instruction",
      instruction: { category: "skill", id: "debugging", source: "default" },
      verification: { mode: "content", installedHash: hash }, ...overrides,
    });
  }
  function blockRow(overrides: Record<string, unknown> = {}, identity: Record<string, unknown> = {}): ManagedArtifactV2 {
    return artifact({
      owner: "claude", path: "/synthetic/product/CLAUDE.md", kind: "instruction", mergeStrategy: "marked-block",
      instruction: { category: "vendor-file", id: "claude-md", source: "default", members: [member("rule", "careful"), member("skill", "debugging")], ...identity },
      verification: { mode: "block", blockHash: hash }, ...overrides,
    });
  }
  const refuses = (...rows: readonly ManagedArtifactV2[]): void => {
    expect(() => validateManifestV2(manifestWith(...rows), admission())).toThrow(ManifestStateError);
  };

  it.each([
    { name: "content", row: contentRow() },
    { name: "user content", row: contentRow({ instruction: { category: "scoped-rule", id: "careful", source: "user" } }) },
    { name: "created block", row: blockRow() },
    { name: "adopted block", row: blockRow({ existedBefore: true, beforeHash: hash, backupRelativePath: "before/CLAUDE.md" }) },
    { name: "one-member block", row: blockRow({}, { members: [member("command", "commit")] }) },
  ])("round-trips the $name arm strictly", ({ row }) => {
    const value = manifestWith(row);
    const validated = validateManifestV2(value, admission());
    expect(validated).toStrictEqual(value);
    expect(validateManifestBytes(new TextEncoder().encode(encodeCanonicalJson(value as never)), admission())).toStrictEqual(value);
  });

  it("passes each row's arm to admitOwnerPath", () => {
    const arms: unknown[] = [];
    const context = admission({ admitOwnerPath: (_owner, path, arm) => { arms.push(arm); return path; } });
    validateManifestV2(manifestWith(
      blockRow(),
      artifact({ path: "/synthetic/product/claude", kind: "directory", verification: { mode: "content" } }),
      contentRow(),
    ), context);
    expect(arms).toStrictEqual([
      { kind: "instruction", mode: "block", category: "vendor-file" },
      { kind: "directory" },
      { kind: "instruction", mode: "content", category: "skill" },
    ]);
  });

  it.each([
    { name: "an extra artifact key", row: { ...contentRow(), extra: true } as never },
    { name: "a missing instruction key", row: artifact({ owner: "claude", kind: "instruction", verification: { mode: "content", installedHash: hash } }) },
    { name: "an instruction key on a file row", row: artifact({ instruction: { category: "skill", id: "debugging", source: "default" } }) },
    { name: "an extra content identity key", row: contentRow({ instruction: { category: "skill", id: "debugging", source: "default", extra: true } }) },
    { name: "members on a content identity", row: contentRow({ instruction: { category: "skill", id: "debugging", source: "default", members: [member("rule", "careful")] } }) },
    { name: "an extra content verification key", row: contentRow({ verification: { mode: "content", installedHash: hash, extra: true } }) },
    { name: "an extra block identity key", row: blockRow({}, { extra: true }) },
    { name: "an extra member key", row: blockRow({}, { members: [{ ...member("rule", "careful"), extra: true }] }) },
    { name: "an extra block verification key", row: blockRow({ verification: { mode: "block", blockHash: hash, extra: true } }) },
    { name: "installedHash on a block", row: blockRow({ verification: { mode: "block", installedHash: hash } }) },
  ])("refuses $name", ({ row }) => { refuses(row); });

  it.each([
    { name: "an unknown category", row: contentRow({ instruction: { category: "hook", id: "debugging", source: "default" } }) },
    { name: "a numeric id", row: contentRow({ instruction: { category: "skill", id: 7, source: "default" } }) },
    { name: "a product-prefixed id", row: contentRow({ instruction: { category: "skill", id: "developer-os-capture", source: "default" } }) },
    { name: "a 65-character id", row: contentRow({ instruction: { category: "skill", id: "a".repeat(65), source: "default" } }) },
    { name: "an unknown source", row: contentRow({ instruction: { category: "skill", id: "debugging", source: "vendor" } }) },
    { name: "an unknown verification mode", row: contentRow({ verification: { mode: "schema", schemaId: "developer-os-config-v1", installedHash: hash } }) },
  ])("refuses an instruction identity with $name", ({ row }) => { refuses(row); });

  it.each(["semantic-json", "semantic-toml", "marked-block"])("refuses a content row with mergeStrategy %s", (mergeStrategy) => {
    refuses(contentRow({ mergeStrategy }));
  });

  it.each([
    { existedBefore: true, beforeHash: hash, backupRelativePath: "before/file" },
    { existedBefore: true, beforeHash: null, backupRelativePath: null },
    { existedBefore: false, beforeHash: hash, backupRelativePath: null },
    { existedBefore: false, beforeHash: null, backupRelativePath: "before/file" },
  ])("refuses a content row with restore fields %o", (fields) => { refuses(contentRow(fields)); });

  it("admits a block row's restore fields only as a complete pair matching existedBefore", () => {
    for (const existedBefore of [false, true]) for (const beforeHash of [null, hash]) for (const backupRelativePath of [null, "before/CLAUDE.md"]) {
      const row = blockRow({ existedBefore, beforeHash, backupRelativePath });
      const legal = existedBefore ? beforeHash !== null && backupRelativePath !== null : beforeHash === null && backupRelativePath === null;
      if (legal) expect(validateManifestV2(manifestWith(row), admission())).toStrictEqual(manifestWith(row));
      else refuses(row);
    }
  });

  it.each(["dedicated", "semantic-json", "semantic-toml"])("refuses a block row with mergeStrategy %s", (mergeStrategy) => {
    refuses(blockRow({ mergeStrategy }));
  });

  it.each([
    { name: "file content", row: artifact({ mergeStrategy: "marked-block" }) },
    { name: "file schema", row: artifact({ mergeStrategy: "marked-block", verification: { mode: "schema", schemaId: "developer-os-config-v1", installedHash: hash } }) },
    { name: "file ephemeral", row: artifact({ mergeStrategy: "marked-block", verification: { mode: "ephemeral" } }) },
    { name: "directory", row: artifact({ mergeStrategy: "marked-block", kind: "directory", verification: { mode: "content" } }) },
    { name: "symlink", row: artifact({ mergeStrategy: "marked-block", kind: "symlink", verification: { mode: "content", installedHash: hash } }) },
  ])("refuses marked-block on a $name row", ({ row }) => { refuses(row); });

  it.each(["core", "macos"])("refuses a block row owned by %s", (owner) => { refuses(blockRow({ owner })); });

  it.each([
    { name: "a skill category", identity: { category: "skill" } },
    { name: "a user source", identity: { source: "user" } },
    { name: "no members", identity: { members: [] } },
    { name: "members that are not an array", identity: { members: member("rule", "careful") } },
    { name: "65 members", identity: { members: Array.from({ length: 65 }, (_, i) => member("rule", `m${String(i).padStart(2, "0")}`)) } },
    { name: "unsorted ids", identity: { members: [member("rule", "zeta"), member("rule", "alpha")] } },
    { name: "unsorted categories", identity: { members: [member("skill", "alpha"), member("rule", "zeta")] } },
    { name: "a duplicate member", identity: { members: [member("rule", "careful"), member("rule", "careful")] } },
    { name: "a duplicate id under different sources", identity: { members: [member("rule", "careful"), { ...member("rule", "careful"), source: "user" }] } },
    { name: "a vendor-file member", identity: { members: [member("vendor-file", "careful")] } },
    { name: "a member with a bad hash", identity: { members: [{ ...member("rule", "careful"), sha256: "A".repeat(64) }] } },
    { name: "a member with a numeric id", identity: { members: [{ ...member("rule", "careful"), id: 1 }] } },
  ])("refuses a block row with $name", ({ identity }) => { refuses(blockRow({}, identity)); });

  it("admits exactly 64 sorted members", () => {
    const members = Array.from({ length: 64 }, (_, i) => member("rule", `m${String(i).padStart(2, "0")}`));
    expect(members.length).toBe(64);
    const row = blockRow({}, { members });
    expect(validateManifestV2(manifestWith(row), admission())).toStrictEqual(manifestWith(row));
  });

  it("admits one block row per owner and refuses a second for the same owner", () => {
    const claude = blockRow();
    const codex = blockRow({ owner: "codex", path: "/synthetic/product/codex/AGENTS.md" });
    expect(validateManifestV2(manifestWith(claude, codex), admission())).toStrictEqual(manifestWith(claude, codex));
    refuses(claude, blockRow({ path: "/synthetic/product/claude/CLAUDE.md" }));
  });

  it("orders instruction rows by path like every other arm", () => {
    const first = contentRow({ path: "/synthetic/product/a" });
    const second = contentRow({ path: "/synthetic/product/b" });
    expect(validateManifestV2(manifestWith(first, second), admission())).toStrictEqual(manifestWith(first, second));
    refuses(second, first);
  });
});
