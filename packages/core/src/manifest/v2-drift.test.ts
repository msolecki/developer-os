import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildConflictEvidence, inspectDrift, ManifestStateError, renderInstructionBlock } from "./index.js";
import type { ConflictEvidenceRequest, DriftRequestV2, InstallationManifestV2, ManagedArtifactV2 } from "./index.js";

const hash = (bytes: string): string => createHash("sha256").update(bytes).digest("hex");
const guards = { assertReadable: (path: string): Promise<string> => Promise.resolve(path) };

function artifact(path: string, overrides: Record<string, unknown> = {}): ManagedArtifactV2 {
  return {
    owner: "core", path: path as never, productVersion: "1.2.3", existedBefore: false,
    beforeHash: null, backupRelativePath: null, source: "templates/file" as never,
    mergeStrategy: "dedicated", verifiedAt: "2026-08-29T12:00:00.000Z",
    kind: "file", verification: { mode: "content", installedHash: hash("installed") as never },
    ...overrides,
  } as unknown as ManagedArtifactV2;
}

function request(artifactValue: ManagedArtifactV2, options: Partial<DriftRequestV2> = {}): DriftRequestV2 {
  const manifest = { schemaVersion: 2, productVersion: "1.2.3", installedAt: "2026-08-29T12:00:00.000Z", artifacts: [artifactValue] } as unknown as InstallationManifestV2;
  return {
    manifest, fs: nodeFs, guards,
    schemas: { validate: () => undefined },
    ephemerals: { validate: () => undefined },
    ...options,
  };
}

describe("V2 manifest drift", () => {
  it.each([
    ["ephemeral absent", (path: string) => artifact(path, { verification: { mode: "ephemeral" } }), null],
    ["schema valid with changed bytes", (path: string) => artifact(path, { verification: { mode: "schema", schemaId: "developer-os-config-v1", installedHash: hash("installed") } }), null],
    ["schema invalid", (path: string) => artifact(path, { verification: { mode: "schema", schemaId: "developer-os-config-v1", installedHash: hash("installed") } }), "schema_invalid"],
  ])("classifies %s", async (name, create, expected) => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-v2-drift-"));
    const path = join(root, "artifact");
    try {
      if (name !== "ephemeral absent") await nodeFs.writeFile(path, "changed");
      const options = name === "schema invalid"
        ? { schemas: { validate: (): void => { throw new Error(path); } } }
        : {};
      expect((await inspectDrift(request(create(path), options)))[0]?.kind ?? null).toBe(expected);
    } finally { await nodeFs.rm(root, { recursive: true, force: true }); }
  });

  it("accepts a present ephemeral reservation only after metadata validation without reading bytes", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-v2-ephemeral-"));
    const path = join(root, "reservation");
    try {
      await nodeFs.writeFile(path, "unread secret", { mode: 0o600 });
      const readsForbidden = { ...nodeFs, open: (): Promise<never> => Promise.reject(new Error("must not read ephemeral bytes")) };
      await expect(inspectDrift(request(artifact(path, { verification: { mode: "ephemeral" } }), { fs: readsForbidden }))).resolves.toStrictEqual([]);
      await expect(inspectDrift(request(artifact(path, { verification: { mode: "ephemeral" } }), { ephemerals: { validate: (): void => { throw new Error(path); } } }))).resolves.toMatchObject([{ kind: "schema_invalid" }]);
    } finally { await nodeFs.rm(root, { recursive: true, force: true }); }
  });

  it("binds schema bytes and ephemeral owner metadata to the admitted artifact path", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-v2-binding-"));
    const canonicalParent = join(root, "canonical"); const canonicalPath = join(canonicalParent, "artifact");
    try {
      await nodeFs.mkdir(canonicalParent); await nodeFs.writeFile(canonicalPath, "changed", { mode: 0o600 });
      let received: readonly unknown[] = [];
      const canonicalGuards = { assertReadable: (): Promise<string> => Promise.resolve(canonicalPath) };
      await expect(inspectDrift(request(artifact(canonicalPath, { verification: { mode: "schema", schemaId: "developer-os-config-v1", installedHash: hash("installed") } }), { guards: canonicalGuards, schemas: { validate: (id, bytes): void => { received = [id, bytes]; } } }))).resolves.toStrictEqual([]);
      expect(received).toStrictEqual(["developer-os-config-v1", new TextEncoder().encode("changed")]);

      const stats = await nodeFs.lstat(canonicalPath); let observed: unknown;
      const noReadFs = { ...nodeFs, open: (): Promise<never> => Promise.reject(new Error("bytes must stay unread")) };
      await expect(inspectDrift(request(artifact(canonicalPath, { verification: { mode: "ephemeral" } }), { guards: canonicalGuards, fs: noReadFs, ephemerals: { validate: (owner, value): void => { observed = [owner, value]; } } }))).resolves.toStrictEqual([]);
      expect(observed).toStrictEqual(["core", { path: canonicalPath, uid: stats.uid, mode: stats.mode & 0o777, nlink: stats.nlink }]);
    } finally { await nodeFs.rm(root, { recursive: true, force: true }); }
  });

  it("reports complete content and target findings through the admitted artifact path and refuses a short descriptor read", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-v2-evidence-"));
    const canonicalParent = join(root, "canonical"); const canonicalPath = join(canonicalParent, "artifact");
    try {
      await nodeFs.mkdir(canonicalParent); await nodeFs.writeFile(canonicalPath, "changed");
      const seen: string[] = [];
      const fs = { ...nodeFs, lstat: (path: Parameters<typeof nodeFs.lstat>[0], options: { readonly bigint: true }) => { seen.push(String(path)); return nodeFs.lstat(path, options); } };
      const guarded = { assertReadable: (): Promise<string> => Promise.resolve(canonicalPath) };
      const content = await inspectDrift(request(artifact(canonicalPath), { guards: guarded, fs: fs as unknown as DriftRequestV2["fs"] }));
      expect(content).toStrictEqual([{ path: canonicalPath, owner: "core", kind: "content_changed", expectedHash: hash("installed"), actualHash: hash("changed") }]);
      expect(seen[0]).toBe(canonicalPath);
      await nodeFs.unlink(canonicalPath); await nodeFs.symlink("target", canonicalPath);
      const target = await inspectDrift(request(artifact(canonicalPath, { kind: "symlink", verification: { mode: "content", installedHash: hash("other") } }), { guards: guarded }));
      expect(target).toStrictEqual([{ path: canonicalPath, owner: "core", kind: "target_changed", expectedHash: hash("other"), actualHash: hash("target") }]);

      await nodeFs.unlink(canonicalPath); await nodeFs.writeFile(canonicalPath, "installed");
      const shortReadFs = { ...nodeFs, open: (path: Parameters<typeof nodeFs.open>[0], flags: Parameters<typeof nodeFs.open>[1]) => nodeFs.open(path, flags).then((handle) => ({ close: handle.close.bind(handle), stat: handle.stat.bind(handle), read: (): Promise<{ bytesRead: number; buffer: Uint8Array }> => Promise.resolve({ bytesRead: 0, buffer: new Uint8Array() }) } as unknown as typeof handle)) };
      await expect(inspectDrift(request(artifact(canonicalPath), { guards: guarded, fs: shortReadFs }))).rejects.toBeInstanceOf(Error);
    } finally { await nodeFs.rm(root, { recursive: true, force: true }); }
  });

  it("refuses a different guard result before filesystem or registry access", async () => {
    const admittedPath = "/synthetic/admitted/artifact";
    const alternativePath = "/synthetic/alternate/artifact";
    let lstatCalls = 0;
    let registryCalls = 0;
    const result = inspectDrift(request(artifact(admittedPath, { verification: { mode: "ephemeral" } }), {
      guards: { assertReadable: (): Promise<string> => Promise.resolve(alternativePath) },
      fs: { ...nodeFs, lstat: (): Promise<never> => { lstatCalls += 1; return Promise.reject(new Error(alternativePath)); } },
      ephemerals: { validate: (): void => { registryCalls += 1; } },
    }));
    const error = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(alternativePath);
    expect(lstatCalls).toBe(0);
    expect(registryCalls).toBe(0);
  });

  it("distinguishes wrong kinds and symlink target changes", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-v2-kind-"));
    const path = join(root, "artifact");
    try {
      await nodeFs.mkdir(path);
      await expect(inspectDrift(request(artifact(path)))).resolves.toMatchObject([{ kind: "type_changed" }]);
      await nodeFs.rm(path, { recursive: true });
      await nodeFs.symlink("target", path);
      await expect(inspectDrift(request(artifact(path, { kind: "symlink", verification: { mode: "content", installedHash: hash("other") } })))).resolves.toMatchObject([{ kind: "target_changed" }]);
    } finally { await nodeFs.rm(root, { recursive: true, force: true }); }
  });

  it("redacts a post-readlink identity failure and bounds target bytes at 4096", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-v2-link-bound-"));
    const path = join(root, "artifact");
    try {
      await nodeFs.symlink("target", path);
      let calls = 0;
      const raceFs = {
        ...nodeFs,
        lstat: async (candidate: Parameters<typeof nodeFs.lstat>[0]) => {
          calls += 1;
          if (calls === 2) throw Object.assign(new Error(path), { code: "EIO" });
          return nodeFs.lstat(candidate);
        },
      };
      const race = inspectDrift(request(artifact(path, { kind: "symlink", verification: { mode: "content", installedHash: hash("target") } }), { fs: raceFs as never }));
      await expect(race).rejects.toBeInstanceOf(Error);
      await expect(race).rejects.not.toThrow(path);

      const oversized = inspectDrift(request(artifact(path, { kind: "symlink", verification: { mode: "content", installedHash: hash("target") } }), { fs: { ...nodeFs, readlink: (): Promise<string> => Promise.resolve("x".repeat(4097)) } as never }));
      await expect(oversized).rejects.toBeInstanceOf(Error);
    } finally { await nodeFs.rm(root, { recursive: true, force: true }); }
  });

  it.each([
    ["missing content", (path: string) => artifact(path), "missing"],
    ["missing schema", (path: string) => artifact(path, { verification: { mode: "schema", schemaId: "developer-os-config-v1", installedHash: hash("installed") } }), "missing"],
    ["missing directory", (path: string) => artifact(path, { kind: "directory", verification: { mode: "content" } }), "missing"],
  ])("reports %s without reading another artifact arm", async (_name, create, expected) => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-v2-missing-"));
    try { await expect(inspectDrift(request(create(join(root, "missing"))))).resolves.toMatchObject([{ kind: expected }]); }
    finally { await nodeFs.rm(root, { recursive: true, force: true }); }
  });

  it("separates clean and changed content from directory and ephemeral type changes", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-v2-arms-"));
    const clean = join(root, "clean"); const changed = join(root, "changed"); const directory = join(root, "directory"); const ephemeral = join(root, "ephemeral");
    try {
      await nodeFs.writeFile(clean, "installed"); await nodeFs.writeFile(changed, "changed"); await nodeFs.mkdir(directory); await nodeFs.mkdir(ephemeral);
      await expect(inspectDrift(request(artifact(clean)))).resolves.toStrictEqual([]);
      await expect(inspectDrift(request(artifact(changed)))).resolves.toMatchObject([{ kind: "content_changed" }]);
      await expect(inspectDrift(request(artifact(directory, { kind: "directory", verification: { mode: "content" } })))).resolves.toStrictEqual([]);
      await expect(inspectDrift(request(artifact(clean, { kind: "directory", verification: { mode: "content" } })))).resolves.toMatchObject([{ kind: "type_changed" }]);
      await expect(inspectDrift(request(artifact(ephemeral, { verification: { mode: "ephemeral" } })))).resolves.toMatchObject([{ kind: "type_changed" }]);
      await expect(inspectDrift(request(artifact(directory, { verification: { mode: "schema", schemaId: "developer-os-config-v1", installedHash: hash("installed") } })))).resolves.toMatchObject([{ kind: "type_changed" }]);
    } finally { await nodeFs.rm(root, { recursive: true, force: true }); }
  });

  it("opens regular files with O_NOFOLLOW and rejects descriptor size or identity changes before and after reads", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-v2-descriptor-"));
    const path = join(root, "artifact");
    try {
      await nodeFs.writeFile(path, "installed");
      let flags = 0;
      const flagFs = { ...nodeFs, open: (candidate: Parameters<typeof nodeFs.open>[0], openFlags: Parameters<typeof nodeFs.open>[1]) => { if (typeof openFlags === "number") flags = openFlags; return nodeFs.open(candidate, openFlags); } };
      await expect(inspectDrift(request(artifact(path), { fs: flagFs }))).resolves.toStrictEqual([]);
      expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);

      let opened = false;
      const sizeFs = { ...nodeFs, lstat: (candidate: Parameters<typeof nodeFs.lstat>[0]) => nodeFs.lstat(candidate).then((stats) => Object.assign(Object.create(stats), { size: 8 * 1024 * 1024 + 1 }) as unknown as typeof stats), open: () => { opened = true; return nodeFs.open(path, "r"); } };
      await expect(inspectDrift(request(artifact(path), { fs: sizeFs as unknown as DriftRequestV2["fs"] }))).rejects.toBeInstanceOf(Error);
      expect(opened).toBe(false);

      let legacyReadCalled = false;
      const extraDataFs = {
        ...nodeFs,
        lstat: (candidate: Parameters<typeof nodeFs.lstat>[0]) => nodeFs.lstat(candidate).then((stats) => Object.assign(Object.create(stats), { size: 1 }) as unknown as typeof stats),
        open: (candidate: Parameters<typeof nodeFs.open>[0], openFlags: Parameters<typeof nodeFs.open>[1]) => nodeFs.open(candidate, openFlags).then((handle) => ({ close: handle.close.bind(handle), read: handle.read.bind(handle), readFile: (): Promise<never> => { legacyReadCalled = true; return Promise.reject(new Error("unbounded read")); }, stat: () => handle.stat().then((stats) => Object.assign(Object.create(stats), { size: 1 }) as unknown as typeof stats) } as unknown as typeof handle)),
      };
      await expect(inspectDrift(request(artifact(path), { fs: extraDataFs as unknown as DriftRequestV2["fs"] }))).rejects.toBeInstanceOf(Error);
      expect(legacyReadCalled).toBe(false);

      const mismatchedHandle = (afterRead: boolean) => ({
        ...nodeFs,
        open: (candidate: Parameters<typeof nodeFs.open>[0], openFlags: Parameters<typeof nodeFs.open>[1]) => nodeFs.open(candidate, openFlags).then((handle) => {
          let stats = 0;
          return {
            close: handle.close.bind(handle),
            read: handle.read.bind(handle),
            readFile: handle.readFile.bind(handle),
            stat: () => handle.stat().then((value) => {
              stats += 1;
              const changed = Object.assign(Object.create(value), stats === (afterRead ? 2 : 1) ? { ino: value.ino + 1 } : {}) as unknown as typeof value;
              return changed;
            }),
          } as unknown as typeof handle;
        }),
      });
      await expect(inspectDrift(request(artifact(path), { fs: mismatchedHandle(false) }))).rejects.toBeInstanceOf(Error);
      await expect(inspectDrift(request(artifact(path), { fs: mismatchedHandle(true) }))).rejects.toBeInstanceOf(Error);
    } finally { await nodeFs.rm(root, { recursive: true, force: true }); }
  });

  describe("instruction arms", () => {
    const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
    const hashOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
    const render = (body: string): Uint8Array => renderInstructionBlock({ productHome: "/synthetic/product", vendor: "claude", body });
    const block = render("installed rules\n");
    const around = (inner: Uint8Array, top = "top\n", bottom = "bottom\n"): Uint8Array => new Uint8Array([...encode(top), ...inner, ...encode(bottom)]);
    const blockRow = (path: string): ManagedArtifactV2 => artifact(path, {
      owner: "claude", kind: "instruction", mergeStrategy: "marked-block",
      instruction: { category: "vendor-file", id: "claude-md", source: "default", members: [{ category: "rule", id: "careful", source: "default", sha256: hashOf(encode("installed rules\n")) }] },
      verification: { mode: "block", blockHash: hashOf(block) },
    });
    const contentRow = (path: string): ManagedArtifactV2 => artifact(path, {
      owner: "claude", kind: "instruction",
      instruction: { category: "skill", id: "debugging", source: "default" },
    });

    async function inspectFile(row: (path: string) => ManagedArtifactV2, bytes: Uint8Array | null): Promise<readonly unknown[]> {
      const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-v2-instruction-"));
      const path = join(root, "artifact.md");
      try {
        if (bytes !== null) await nodeFs.writeFile(path, bytes);
        return (await inspectDrift(request(row(path)))).map(({ kind, expectedHash, actualHash }) => ({ kind, expectedHash, actualHash }));
      } finally { await nodeFs.rm(root, { recursive: true, force: true }); }
    }

    it("treats a content row exactly like a file content row", async () => {
      await expect(inspectFile(contentRow, encode("installed"))).resolves.toStrictEqual([]);
      await expect(inspectFile(contentRow, encode("changed"))).resolves.toStrictEqual([{ kind: "content_changed", expectedHash: hash("installed"), actualHash: hash("changed") }]);
      await expect(inspectFile(contentRow, null)).resolves.toStrictEqual([{ kind: "missing", expectedHash: hash("installed"), actualHash: null }]);
    });

    it("hashes only the block and ignores every byte outside it", async () => {
      await expect(inspectFile(blockRow, around(block))).resolves.toStrictEqual([]);
      await expect(inspectFile(blockRow, block)).resolves.toStrictEqual([]);
      await expect(inspectFile(blockRow, around(block, "user edited the top\r\n", "and the bottom"))).resolves.toStrictEqual([]);
    });

    it("reports an edited block as content_changed with both block hashes", async () => {
      const edited = render("edited rules\n");
      await expect(inspectFile(blockRow, around(edited))).resolves.toStrictEqual([{ kind: "content_changed", expectedHash: hashOf(block), actualHash: hashOf(edited) }]);
    });

    it("reports absent markers and an absent file as missing", async () => {
      await expect(inspectFile(blockRow, encode("top\nbottom\n"))).resolves.toStrictEqual([{ kind: "missing", expectedHash: hashOf(block), actualHash: null }]);
      await expect(inspectFile(blockRow, encode(""))).resolves.toStrictEqual([{ kind: "missing", expectedHash: hashOf(block), actualHash: null }]);
      await expect(inspectFile(blockRow, null)).resolves.toStrictEqual([{ kind: "missing", expectedHash: hashOf(block), actualHash: null }]);
    });

    it.each([
      ["two blocks", (): Uint8Array => around(new Uint8Array([...block, ...block]))],
      ["a begin marker without an end", (): Uint8Array => around(encode("<!-- developer-os:begin v1 -->\n"))],
      ["an end marker before the begin marker", (): Uint8Array => around(encode("<!-- developer-os:end v1 -->\nx\n<!-- developer-os:begin v1 -->\n"))],
    ])("reports %s as block_malformed", async (_name, bytes) => {
      await expect(inspectFile(blockRow, bytes())).resolves.toStrictEqual([{ kind: "block_malformed", expectedHash: hashOf(block), actualHash: null }]);
    });

    it("reports a block file replaced by a directory as type_changed", async () => {
      const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-v2-instruction-kind-"));
      const path = join(root, "artifact.md");
      try {
        await nodeFs.mkdir(path);
        await expect(inspectDrift(request(blockRow(path)))).resolves.toMatchObject([{ kind: "type_changed" }]);
      } finally { await nodeFs.rm(root, { recursive: true, force: true }); }
    });
  });

  describe("block conflict evidence", () => {
    const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
    const hashOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
    const render = (body: string): Uint8Array => renderInstructionBlock({ productHome: "/synthetic/product", vendor: "codex", body });
    const base = render("installed-rule\n");
    type BlockRow = Extract<ConflictEvidenceRequest, { block: unknown }>["block"]["artifact"];
    const blockRow = (backupRelativePath: string | null = null): BlockRow => artifact("/synthetic/home/.codex/AGENTS.md", {
      owner: "codex", kind: "instruction", mergeStrategy: "marked-block", backupRelativePath,
      instruction: { category: "vendor-file", id: "agents-md", source: "default", members: [{ category: "rule", id: "careful", source: "default", sha256: hashOf(encode("installed-rule\n")) }] },
      verification: { mode: "block", blockHash: hashOf(base) },
    }) as BlockRow;
    const noFs = new Proxy({}, { get: (): never => { throw new Error("the block arm must not touch the filesystem"); } }) as typeof nodeFs;
    const noGuards = { assertReadable: (): Promise<never> => Promise.reject(new Error("the block arm must not read a path")) };
    const evidence = (current: Uint8Array, proposedBlock: Uint8Array, options: { readonly row?: BlockRow; readonly redact?: (text: string) => string } = {}) => buildConflictEvidence({
      block: { artifact: options.row ?? blockRow(), fileBytes: new Uint8Array([...encode("user top\r\n"), ...current, ...encode("user bottom")]), proposedBlock },
      fs: noFs, guards: noGuards, redactDiagnostic: options.redact ?? ((text) => text),
    });

    it("reports the base, current and proposed block hashes and a redacted current-to-proposed diff", async () => {
      const current = render("installed-rule\nuser-added synthetic-secret-token\n");
      const proposed = render("proposed-rule\n");
      const result = await evidence(current, proposed, { redact: (text) => text.replaceAll("synthetic-secret-token", "[REDACTED]") });
      expect(result).toMatchObject({
        path: "/synthetic/home/.codex/AGENTS.md",
        baselineBackupRelativePath: null,
        baselineHash: hashOf(base),
        currentHash: hashOf(current),
        proposedHash: hashOf(proposed),
      });
      expect(result.diff).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/mu);
      expect(result.diff).toContain("-installed-rule");
      expect(result.diff).toContain("+proposed-rule");
      expect(result.diff).toContain("[REDACTED]");
      expect(result.diff).not.toContain("synthetic-secret-token");
      expect(result.diff).not.toContain("user top");
      expect(result.diff).not.toContain("user bottom");
    });

    it("names the row's whole-file backup without reading it", async () => {
      await expect(evidence(render("edited\n"), base, { row: blockRow("backups/7.bin") })).resolves.toMatchObject({ baselineBackupRelativePath: "backups/7.bin", baselineHash: hashOf(base) });
    });

    it.each([
      ["oversized bytes", (): Uint8Array => render(`${"x".repeat(1024 * 1024)}\n`), "[content too large to diff]"],
      ["too many lines", (): Uint8Array => render("line\n".repeat(1001)), "[content too large to diff]"],
      ["binary content", (): Uint8Array => render("nul\u0000byte\n"), "[binary content omitted]"],
    ])("keeps the %s notice", async (_name, proposed, notice) => {
      const proposedBlock = proposed();
      const result = await evidence(render("edited\n"), proposedBlock);
      expect(result.diff).toBe(notice);
      expect(result.proposedHash).toBe(hashOf(proposedBlock));
    });

    it.each([
      ["absent", encode("")],
      ["malformed", encode("<!-- developer-os:begin v1 -->\n")],
    ])("refuses a file whose markers are %s", async (_name, current) => {
      await expect(evidence(current, base)).rejects.toBeInstanceOf(ManifestStateError);
    });
  });
});
