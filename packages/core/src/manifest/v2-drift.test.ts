import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { inspectDrift } from "./index.js";
import type { DriftRequestV2, InstallationManifestV2, ManagedArtifactV2 } from "./index.js";

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

  it("binds schema bytes and ephemeral owner metadata to the guarded canonical path", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-v2-binding-"));
    const canonicalParent = join(root, "canonical"); const rawParent = join(root, "raw"); const rawPath = join(rawParent, "artifact"); const canonicalPath = join(canonicalParent, "artifact");
    try {
      await nodeFs.mkdir(canonicalParent); await nodeFs.symlink(canonicalParent, rawParent); await nodeFs.writeFile(canonicalPath, "changed", { mode: 0o600 });
      let received: readonly unknown[] = [];
      const canonicalGuards = { assertReadable: (): Promise<string> => Promise.resolve(canonicalPath) };
      await expect(inspectDrift(request(artifact(rawPath, { verification: { mode: "schema", schemaId: "developer-os-config-v1", installedHash: hash("installed") } }), { guards: canonicalGuards, schemas: { validate: (id, bytes): void => { received = [id, bytes]; } } }))).resolves.toStrictEqual([]);
      expect(received).toStrictEqual(["developer-os-config-v1", new TextEncoder().encode("changed")]);

      const stats = await nodeFs.lstat(canonicalPath); let observed: unknown;
      const noReadFs = { ...nodeFs, open: (): Promise<never> => Promise.reject(new Error("bytes must stay unread")) };
      await expect(inspectDrift(request(artifact(rawPath, { verification: { mode: "ephemeral" } }), { guards: canonicalGuards, fs: noReadFs, ephemerals: { validate: (owner, value): void => { observed = [owner, value]; } } }))).resolves.toStrictEqual([]);
      expect(observed).toStrictEqual(["core", { path: canonicalPath, uid: stats.uid, mode: stats.mode & 0o777, nlink: stats.nlink }]);
    } finally { await nodeFs.rm(root, { recursive: true, force: true }); }
  });

  it("reports complete content and target findings through a canonicalized ancestor and refuses a short descriptor read", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-v2-evidence-"));
    const canonicalParent = join(root, "canonical"); const rawParent = join(root, "raw"); const rawPath = join(rawParent, "artifact"); const canonicalPath = join(canonicalParent, "artifact");
    try {
      await nodeFs.mkdir(canonicalParent); await nodeFs.symlink(canonicalParent, rawParent); await nodeFs.writeFile(canonicalPath, "changed");
      const seen: string[] = [];
      const fs = { ...nodeFs, lstat: (path: Parameters<typeof nodeFs.lstat>[0]) => { seen.push(String(path)); return nodeFs.lstat(path); } };
      const guarded = { assertReadable: (): Promise<string> => Promise.resolve(canonicalPath) };
      const content = await inspectDrift(request(artifact(rawPath), { guards: guarded, fs: fs as unknown as DriftRequestV2["fs"] }));
      expect(content).toStrictEqual([{ path: rawPath, owner: "core", kind: "content_changed", expectedHash: hash("installed"), actualHash: hash("changed") }]);
      expect(seen[0]).toBe(canonicalPath);
      await nodeFs.unlink(canonicalPath); await nodeFs.symlink("target", canonicalPath);
      const target = await inspectDrift(request(artifact(rawPath, { kind: "symlink", verification: { mode: "content", installedHash: hash("other") } }), { guards: guarded }));
      expect(target).toStrictEqual([{ path: rawPath, owner: "core", kind: "target_changed", expectedHash: hash("other"), actualHash: hash("target") }]);

      await nodeFs.unlink(canonicalPath); await nodeFs.writeFile(canonicalPath, "installed");
      const shortReadFs = { ...nodeFs, open: (path: Parameters<typeof nodeFs.open>[0], flags: Parameters<typeof nodeFs.open>[1]) => nodeFs.open(path, flags).then((handle) => ({ close: handle.close.bind(handle), stat: handle.stat.bind(handle), read: (): Promise<{ bytesRead: number; buffer: Uint8Array }> => Promise.resolve({ bytesRead: 0, buffer: new Uint8Array() }) } as unknown as typeof handle)) };
      await expect(inspectDrift(request(artifact(rawPath), { guards: guarded, fs: shortReadFs }))).rejects.toBeInstanceOf(Error);
    } finally { await nodeFs.rm(root, { recursive: true, force: true }); }
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
});
