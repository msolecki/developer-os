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

  it.each(["developer-os-config-v1", "lifecycle-id-allocator-v1", "active-release-record-v1", "release-trust-state-v1"])("accepts closed schema ID %s", (schemaId) => {
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
