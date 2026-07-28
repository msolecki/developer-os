import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "../result.js";
import {
  buildConflictEvidence,
  detectDrift,
  ManifestMissingError,
  ManifestStateError,
  ManifestStore,
  ManifestUnsupportedArtifactError,
  validateManifest,
} from "./index.js";
import type { InstallationManifestV1, ManagedArtifactV1 } from "./index.js";

const PRODUCT_VERSION = "0.0.0";
const INSTALLED_TEXT = "installed-line-one\ninstalled-line-two\n";
const CURRENT_TEXT = "installed-line-one\nuser-edited-line\n";
const PROPOSED_TEXT = "installed-line-one\nproposed-line-two\n";

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

interface Fixture {
  readonly root: string;
  readonly homeDir: string;
  readonly manifestFile: string;
}

async function createFixture(label: string): Promise<Fixture> {
  const root = await nodeFs.mkdtemp(join(tmpdir(), `developer-os-manifest-${label}-`));
  const homeDir = join(root, "home");
  await nodeFs.mkdir(homeDir, { recursive: true, mode: 0o700 });
  return { root, homeDir, manifestFile: join(homeDir, "installation-manifest.json") };
}

async function removeFixture(fixture: Fixture): Promise<void> {
  await nodeFs.rm(fixture.root, { recursive: true, force: true });
}

function artifact(overrides: Partial<ManagedArtifactV1> = {}): ManagedArtifactV1 {
  return {
    owner: "claude",
    path: "/synthetic/home/.claude/settings.json",
    kind: "file",
    productVersion: PRODUCT_VERSION,
    existedBefore: true,
    beforeHash: hashOf("before"),
    backupRelativePath: "0.bin",
    installedHash: hashOf(INSTALLED_TEXT),
    source: "templates/claude/settings.json",
    mergeStrategy: "semantic-json",
    verifiedAt: "2026-07-27T12:00:00.000Z",
    ...overrides,
  };
}

function manifestOf(artifacts: readonly ManagedArtifactV1[]): InstallationManifestV1 {
  return {
    schemaVersion: 1,
    productVersion: PRODUCT_VERSION,
    installedAt: "2026-07-27T12:00:00.000Z",
    artifacts,
  };
}

async function readMode(path: string): Promise<number> {
  return (await nodeFs.lstat(path)).mode & 0o777;
}

const allowAll = { assertReadable: (path: string) => Promise.resolve(path) };

/**
 * The contract a real policy must satisfy: canonicalize every ancestor, keep
 * the final component verbatim. Used wherever a test depends on symlink
 * handling, so an identity stub cannot hide a regression.
 */
const ancestorCanonicalizing = {
  assertReadable: async (path: string): Promise<string> =>
    join(await nodeFs.realpath(dirname(path)), basename(path)),
};

function denyingGuards(denied: string): {
  assertReadable: (path: string) => Promise<string>;
} {
  return {
    assertReadable: (path: string) =>
      path === denied
        ? Promise.reject(new Error("synthetic read refusal"))
        : Promise.resolve(path),
  };
}

describe("validateManifest", () => {
  it("accepts the valid baseline and returns a detached copy", () => {
    const source = manifestOf([artifact()]);
    const validated = validateManifest(JSON.parse(JSON.stringify(source)) as unknown);

    expect(validated).toStrictEqual(source);
    expect(validated.artifacts).not.toBe(source.artifacts);
  });

  it.each([
    { name: "a non-object", value: "manifest" },
    { name: "an array", value: [] },
    { name: "a wrong schema version", value: { ...manifestOf([artifact()]), schemaVersion: 2 } },
    { name: "an unknown top-level key", value: { ...manifestOf([artifact()]), extra: true } },
    { name: "a missing key", value: { schemaVersion: 1, productVersion: PRODUCT_VERSION, artifacts: [] } },
    { name: "a non-array artifact list", value: { ...manifestOf([]), artifacts: {} } },
    { name: "an unknown artifact key", value: manifestOf([{ ...artifact(), extra: true } as never]) },
    { name: "an unknown owner", value: manifestOf([artifact({ owner: "vendor" as never })]) },
    { name: "an unknown kind", value: manifestOf([artifact({ kind: "socket" as never })]) },
    { name: "an unknown merge strategy", value: manifestOf([artifact({ mergeStrategy: "clobber" as never })]) },
    { name: "a relative artifact path", value: manifestOf([artifact({ path: "relative/settings.json" })]) },
    { name: "a NUL byte in the artifact path", value: manifestOf([artifact({ path: "/synthetic/a\0b" })]) },
    { name: "a malformed installed hash", value: manifestOf([artifact({ installedHash: "nope" })]) },
    { name: "a malformed verification timestamp", value: manifestOf([artifact({ verifiedAt: "yesterday" })]) },
    { name: "two artifacts on one path", value: manifestOf([artifact(), artifact()]) },
    {
      name: "a pre-existing artifact without a prior hash",
      value: manifestOf([artifact({ existedBefore: true, beforeHash: null })]),
    },
    {
      name: "a new artifact that still claims a backup",
      value: manifestOf([artifact({ existedBefore: false, beforeHash: null, backupRelativePath: "0.bin" })]),
    },
    {
      name: "a new artifact that still claims a prior hash",
      value: manifestOf([artifact({ existedBefore: false, beforeHash: hashOf("x"), backupRelativePath: null })]),
    },
  ])("rejects $name", ({ value }) => {
    expect(() => validateManifest(value)).toThrow(
      expect.objectContaining({ code: EXIT_CODES.recoveryRequired }),
    );
  });

  it("names no artifact path or hash in the rejection message", () => {
    const error = (() => {
      try {
        validateManifest(manifestOf([artifact({ installedHash: "nope" })]));
        return undefined;
      } catch (caught: unknown) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(ManifestStateError);
    expect(String(error)).not.toContain("settings.json");
  });
});

describe("ManifestStore", () => {
  it("writes an owner-only manifest, reads it back exactly, and leaves no temporary file", async () => {
    const fixture = await createFixture("round-trip");
    const store = new ManifestStore({ manifestFile: fixture.manifestFile, fs: nodeFs });
    const source = manifestOf([artifact()]);

    try {
      await store.write(source);

      expect(await readMode(fixture.manifestFile)).toBe(0o600);
      expect(await store.read()).toStrictEqual(source);
      expect(
        (await nodeFs.readdir(fixture.homeDir)).filter((entry) => entry.endsWith(".tmp")),
      ).toStrictEqual([]);

      const serialized = await nodeFs.readFile(fixture.manifestFile, "utf8");
      expect(serialized.endsWith("\n")).toBe(true);
      expect(JSON.parse(serialized)).toStrictEqual(source);
    } finally {
      await removeFixture(fixture);
    }
  });

  it("replaces an existing manifest without widening its permissions", async () => {
    const fixture = await createFixture("replace");
    const store = new ManifestStore({ manifestFile: fixture.manifestFile, fs: nodeFs });

    try {
      await store.write(manifestOf([artifact()]));
      await store.write(manifestOf([]));

      expect((await store.read()).artifacts).toStrictEqual([]);
      expect(await readMode(fixture.manifestFile)).toBe(0o600);
    } finally {
      await removeFixture(fixture);
    }
  });

  it("refuses to persist a manifest that does not validate", async () => {
    const fixture = await createFixture("write-invalid");
    const store = new ManifestStore({ manifestFile: fixture.manifestFile, fs: nodeFs });

    try {
      await expect(
        store.write(manifestOf([artifact({ installedHash: "nope" })])),
      ).rejects.toBeInstanceOf(ManifestStateError);
      await expect(nodeFs.lstat(fixture.manifestFile)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await removeFixture(fixture);
    }
  });

  it.each([
    { name: "unparseable JSON", write: "{" },
    { name: "a forged manifest", write: JSON.stringify(manifestOf([artifact({ installedHash: "nope" })])) },
  ])("rejects reading $name with code 6", async ({ write }) => {
    const fixture = await createFixture("read-invalid");
    const store = new ManifestStore({ manifestFile: fixture.manifestFile, fs: nodeFs });

    try {
      await nodeFs.writeFile(fixture.manifestFile, write, { mode: 0o600 });
      await expect(store.read()).rejects.toMatchObject({
        code: EXIT_CODES.recoveryRequired,
      });
      await expect(store.readOptional()).rejects.toMatchObject({
        code: EXIT_CODES.recoveryRequired,
      });
    } finally {
      await removeFixture(fixture);
    }
  });

  it("separates a never-installed machine from a corrupted manifest", async () => {
    const fixture = await createFixture("read-absent");
    const store = new ManifestStore({ manifestFile: fixture.manifestFile, fs: nodeFs });

    try {
      expect(await store.readOptional()).toBeNull();
      const error: unknown = await store.read().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ManifestMissingError);
      expect(error).toMatchObject({ code: EXIT_CODES.invalidInput });
      expect(error).not.toBeInstanceOf(ManifestStateError);
    } finally {
      await removeFixture(fixture);
    }
  });
});

describe("detectDrift", () => {
  it("reports nothing when every managed artifact still matches its record", async () => {
    const fixture = await createFixture("drift-clean");
    const filePath = join(fixture.homeDir, "settings.json");
    const directoryPath = join(fixture.homeDir, "agents");
    const linkPath = join(fixture.homeDir, "current");

    try {
      await nodeFs.writeFile(filePath, INSTALLED_TEXT, { mode: 0o600 });
      await nodeFs.mkdir(directoryPath, { mode: 0o700 });
      await nodeFs.symlink("/synthetic/target", linkPath);

      const findings = await detectDrift({
        manifest: manifestOf([
          artifact({ path: filePath }),
          artifact({ path: directoryPath, kind: "directory", installedHash: hashOf("") }),
          artifact({ path: linkPath, kind: "symlink", installedHash: hashOf("/synthetic/target") }),
        ]),
        fs: nodeFs,
        guards: allowAll,
      });

      expect(findings).toStrictEqual([]);
    } finally {
      await removeFixture(fixture);
    }
  });

  it("reports a missing artifact", async () => {
    const fixture = await createFixture("drift-missing");
    const filePath = join(fixture.homeDir, "settings.json");

    try {
      const findings = await detectDrift({
        manifest: manifestOf([artifact({ path: filePath })]),
        fs: nodeFs,
        guards: allowAll,
      });

      expect(findings).toStrictEqual([
        {
          path: filePath,
          owner: "claude",
          kind: "missing",
          expectedHash: hashOf(INSTALLED_TEXT),
          actualHash: null,
        },
      ]);
    } finally {
      await removeFixture(fixture);
    }
  });

  it("reports changed content with both hashes", async () => {
    const fixture = await createFixture("drift-content");
    const filePath = join(fixture.homeDir, "settings.json");

    try {
      await nodeFs.writeFile(filePath, CURRENT_TEXT, { mode: 0o600 });

      const findings = await detectDrift({
        manifest: manifestOf([artifact({ path: filePath })]),
        fs: nodeFs,
        guards: allowAll,
      });

      expect(findings).toStrictEqual([
        {
          path: filePath,
          owner: "claude",
          kind: "content_changed",
          expectedHash: hashOf(INSTALLED_TEXT),
          actualHash: hashOf(CURRENT_TEXT),
        },
      ]);
    } finally {
      await removeFixture(fixture);
    }
  });

  it.each([
    { name: "a file replaced by a directory", recorded: "file" as const },
    { name: "a directory replaced by a file", recorded: "directory" as const },
  ])("reports $name as a type change", async ({ recorded }) => {
    const fixture = await createFixture("drift-type");
    const path = join(fixture.homeDir, "settings.json");

    try {
      if (recorded === "file") {
        await nodeFs.mkdir(path, { mode: 0o700 });
      } else {
        await nodeFs.writeFile(path, INSTALLED_TEXT, { mode: 0o600 });
      }

      const findings = await detectDrift({
        manifest: manifestOf([artifact({ path, kind: recorded })]),
        fs: nodeFs,
        guards: allowAll,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]?.kind).toBe("type_changed");
    } finally {
      await removeFixture(fixture);
    }
  });

  it("reports a file that a symlink now shadows as a type change without following it", async () => {
    const fixture = await createFixture("drift-symlink-shadow");
    const filePath = join(fixture.homeDir, "settings.json");
    const decoyPath = join(fixture.homeDir, "decoy.json");

    try {
      await nodeFs.writeFile(decoyPath, INSTALLED_TEXT, { mode: 0o600 });
      await nodeFs.symlink(decoyPath, filePath);

      const findings = await detectDrift({
        manifest: manifestOf([artifact({ path: filePath })]),
        fs: nodeFs,
        guards: allowAll,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]?.kind).toBe("type_changed");
    } finally {
      await removeFixture(fixture);
    }
  });

  it("reports a repointed symlink as a target change", async () => {
    const fixture = await createFixture("drift-target");
    const linkPath = join(fixture.homeDir, "current");

    try {
      await nodeFs.symlink("/synthetic/elsewhere", linkPath);

      const findings = await detectDrift({
        manifest: manifestOf([
          artifact({
            path: linkPath,
            kind: "symlink",
            installedHash: hashOf("/synthetic/target"),
          }),
        ]),
        fs: nodeFs,
        guards: allowAll,
      });

      expect(findings).toStrictEqual([
        {
          path: linkPath,
          owner: "claude",
          kind: "target_changed",
          expectedHash: hashOf("/synthetic/target"),
          actualHash: hashOf("/synthetic/elsewhere"),
        },
      ]);
    } finally {
      await removeFixture(fixture);
    }
  });

  it("refuses a config-entry artifact instead of reporting it as unchanged", () => {
    expect(() =>
      validateManifest(
        manifestOf([
          artifact({ kind: "config-entry", mergeStrategy: "semantic-toml" }),
        ]),
      ),
    ).toThrow(ManifestUnsupportedArtifactError);
  });

  it("reads through the ancestors the guards canonicalized, not the recorded ancestors", async () => {
    const fixture = await createFixture("drift-canonical");
    const realDir = join(fixture.root, "real");
    const linkDir = join(fixture.homeDir, "via-link");

    try {
      await nodeFs.mkdir(realDir, { mode: 0o700 });
      await nodeFs.writeFile(join(realDir, "settings.json"), INSTALLED_TEXT, {
        mode: 0o600,
      });
      await nodeFs.symlink(realDir, linkDir);

      const findings = await detectDrift({
        manifest: manifestOf([artifact({ path: join(linkDir, "settings.json") })]),
        fs: nodeFs,
        guards: ancestorCanonicalizing,
      });

      expect(findings).toStrictEqual([]);
    } finally {
      await removeFixture(fixture);
    }
  });

  it("still sees a managed file swapped for a symlink under a real policy", async () => {
    const fixture = await createFixture("drift-leaf-symlink");
    const filePath = join(fixture.homeDir, "settings.json");
    const decoyPath = join(fixture.homeDir, "decoy.json");

    try {
      await nodeFs.writeFile(decoyPath, INSTALLED_TEXT, { mode: 0o600 });
      await nodeFs.symlink(decoyPath, filePath);

      const findings = await detectDrift({
        manifest: manifestOf([artifact({ path: filePath })]),
        fs: nodeFs,
        guards: ancestorCanonicalizing,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]?.kind).toBe("type_changed");
    } finally {
      await removeFixture(fixture);
    }
  });

  it("still verifies a managed symlink by its own target under a real policy", async () => {
    const fixture = await createFixture("drift-symlink-kind");
    const linkPath = join(fixture.homeDir, "current");
    const targetPath = join(fixture.homeDir, "release-1");

    try {
      // The target must exist: against a dangling link a leaf-resolving guard
      // falls back to ancestors-only and this test would pass either way.
      await nodeFs.writeFile(targetPath, INSTALLED_TEXT, { mode: 0o600 });
      await nodeFs.symlink(targetPath, linkPath);

      const findings = await detectDrift({
        manifest: manifestOf([
          artifact({
            path: linkPath,
            kind: "symlink",
            installedHash: hashOf(targetPath),
          }),
        ]),
        fs: nodeFs,
        guards: ancestorCanonicalizing,
      });

      expect(findings).toStrictEqual([]);
    } finally {
      await removeFixture(fixture);
    }
  });

  it("refuses a backup reached through a symlinked directory inside the backups root", async () => {
    const fixture = await createFixture("conflict-backup-link");
    const filePath = join(fixture.homeDir, "settings.json");
    const backupsDir = join(fixture.root, "backups");
    const outsideDir = join(fixture.root, "outside");

    try {
      await nodeFs.mkdir(backupsDir, { recursive: true, mode: 0o700 });
      await nodeFs.mkdir(outsideDir, { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(join(outsideDir, "0.bin"), "synthetic-outside\n", {
        mode: 0o600,
      });
      await nodeFs.symlink(outsideDir, join(backupsDir, "linkdir"));
      await nodeFs.writeFile(filePath, CURRENT_TEXT, { mode: 0o600 });

      await expect(
        buildConflictEvidence({
          artifact: artifact({ path: filePath, backupRelativePath: "linkdir/0.bin" }),
          backupsDir,
          proposed: new TextEncoder().encode(PROPOSED_TEXT),
          fs: nodeFs,
          guards: ancestorCanonicalizing,
          redactDiagnostic: (text) => text,
        }),
      ).rejects.toBeInstanceOf(ManifestStateError);
    } finally {
      await removeFixture(fixture);
    }
  });

  it("refuses to read an artifact the guards deny", async () => {
    const fixture = await createFixture("drift-denied");
    const filePath = join(fixture.homeDir, "settings.json");

    try {
      await nodeFs.writeFile(filePath, CURRENT_TEXT, { mode: 0o600 });

      await expect(
        detectDrift({
          manifest: manifestOf([artifact({ path: filePath })]),
          fs: nodeFs,
          guards: denyingGuards(filePath),
        }),
      ).rejects.toThrow("synthetic read refusal");
    } finally {
      await removeFixture(fixture);
    }
  });

  it("never mutates the filesystem while detecting drift", async () => {
    const fixture = await createFixture("drift-read-only");
    const filePath = join(fixture.homeDir, "settings.json");
    const mutating = ["chmod", "mkdir", "rename", "rm", "unlink", "utimes", "writeFile"] as const;
    const calls: string[] = [];
    const openFlags: number[] = [];
    const guardedFs = {
      ...Object.fromEntries(
        mutating.map((name) => [
          name,
          () => {
            calls.push(name);
            return Promise.reject(new Error(`unexpected ${name}`));
          },
        ]),
      ),
      open: ((path: Parameters<typeof nodeFs.open>[0], flags: number) => {
        openFlags.push(flags);
        return nodeFs.open(path, flags);
      }) as typeof nodeFs.open,
    };

    try {
      await nodeFs.writeFile(filePath, CURRENT_TEXT, { mode: 0o600 });
      const before = await nodeFs.lstat(filePath);

      const findings = await detectDrift({
        manifest: manifestOf([artifact({ path: filePath })]),
        fs: { ...nodeFs, ...guardedFs },
        guards: allowAll,
      });

      const after = await nodeFs.lstat(filePath);
      expect(findings).toHaveLength(1);
      expect(calls).toStrictEqual([]);
      expect(openFlags).not.toStrictEqual([]);
      for (const flags of openFlags) {
        expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
        expect(flags & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT)).toBe(0);
      }
      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(after.mode).toBe(before.mode);
    } finally {
      await removeFixture(fixture);
    }
  });
});

describe("buildConflictEvidence", () => {
  it("reports baseline, current, and proposed evidence with a redacted unified diff", async () => {
    const fixture = await createFixture("conflict");
    const filePath = join(fixture.homeDir, "settings.json");
    const backupsDir = join(fixture.root, "backups");
    const backupPath = join(backupsDir, "0.bin");

    try {
      await nodeFs.mkdir(backupsDir, { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(backupPath, INSTALLED_TEXT, { mode: 0o600 });
      await nodeFs.writeFile(filePath, CURRENT_TEXT, { mode: 0o600 });

      const evidence = await buildConflictEvidence({
        artifact: artifact({ path: filePath }),
        backupsDir,
        proposed: new TextEncoder().encode(PROPOSED_TEXT),
        fs: nodeFs,
        guards: allowAll,
        redactDiagnostic: (text) => text.replaceAll("user-edited-line", "[REDACTED]"),
      });

      expect(evidence.path).toBe(filePath);
      expect(evidence.baselineHash).toBe(hashOf(INSTALLED_TEXT));
      expect(evidence.currentHash).toBe(hashOf(CURRENT_TEXT));
      expect(evidence.proposedHash).toBe(hashOf(PROPOSED_TEXT));
      expect(evidence.baselineBackupRelativePath).toBe("0.bin");
      expect(evidence.diff).toContain("[REDACTED]");
      expect(evidence.diff).not.toContain("user-edited-line");
      expect(evidence.diff).toContain("proposed-line-two");
      expect(evidence.diff).toContain("installed-line-one");
    } finally {
      await removeFixture(fixture);
    }
  });

  it("emits unified hunk headers around the changed region", async () => {
    const fixture = await createFixture("conflict-hunks");
    const filePath = join(fixture.homeDir, "settings.json");
    const backupsDir = join(fixture.root, "backups");
    const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].join("\n");
    const after = ["a", "b", "c", "d", "CHANGED", "f", "g", "h", "i"].join("\n");

    try {
      await nodeFs.mkdir(backupsDir, { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(filePath, before, { mode: 0o600 });

      const evidence = await buildConflictEvidence({
        artifact: artifact({
          path: filePath,
          existedBefore: false,
          beforeHash: null,
          backupRelativePath: null,
        }),
        backupsDir,
        proposed: new TextEncoder().encode(after),
        fs: nodeFs,
        guards: allowAll,
        redactDiagnostic: (text) => text,
      });

      expect(evidence.diff).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/mu);
      expect(evidence.diff).toContain("-e");
      expect(evidence.diff).toContain("+CHANGED");
      expect(evidence.diff).toContain(" b");
      expect(evidence.diff).not.toContain(" a");
    } finally {
      await removeFixture(fixture);
    }
  });

  it.each([
    { name: "the managed path", useLink: "target" as const },
    { name: "the recorded backup", useLink: "backup" as const },
  ])("refuses to follow a symlink standing in for $name", async ({ useLink }) => {
    const fixture = await createFixture("conflict-symlink");
    const filePath = join(fixture.homeDir, "settings.json");
    const backupsDir = join(fixture.root, "backups");
    const backupPath = join(backupsDir, "0.bin");
    const secretPath = join(fixture.root, "secret.txt");

    try {
      await nodeFs.mkdir(backupsDir, { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(secretPath, "synthetic-secret-material\n", { mode: 0o600 });

      if (useLink === "target") {
        await nodeFs.writeFile(backupPath, INSTALLED_TEXT, { mode: 0o600 });
        await nodeFs.symlink(secretPath, filePath);
      } else {
        await nodeFs.writeFile(filePath, CURRENT_TEXT, { mode: 0o600 });
        await nodeFs.symlink(secretPath, backupPath);
      }

      await expect(
        buildConflictEvidence({
          artifact: artifact({ path: filePath }),
          backupsDir,
          proposed: new TextEncoder().encode(PROPOSED_TEXT),
          fs: nodeFs,
          guards: allowAll,
          redactDiagnostic: (text) => text,
        }),
      ).rejects.toBeInstanceOf(ManifestStateError);
    } finally {
      await removeFixture(fixture);
    }
  });

  it("resolves no evidence outside the backups root", async () => {
    const fixture = await createFixture("conflict-escape");
    const filePath = join(fixture.homeDir, "settings.json");
    const backupsDir = join(fixture.root, "backups");

    try {
      await nodeFs.mkdir(backupsDir, { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(filePath, CURRENT_TEXT, { mode: 0o600 });

      await expect(
        buildConflictEvidence({
          artifact: artifact({ path: filePath, backupRelativePath: "../home/settings.json" }),
          backupsDir,
          proposed: new TextEncoder().encode(PROPOSED_TEXT),
          fs: nodeFs,
          guards: allowAll,
          redactDiagnostic: (text) => text,
        }),
      ).rejects.toBeInstanceOf(ManifestStateError);
    } finally {
      await removeFixture(fixture);
    }
  });

  it("reports a null baseline for an artifact that did not exist before install", async () => {
    const fixture = await createFixture("conflict-created");
    const filePath = join(fixture.homeDir, "agent.md");
    const backupsDir = join(fixture.root, "backups");

    try {
      await nodeFs.mkdir(backupsDir, { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(filePath, CURRENT_TEXT, { mode: 0o600 });

      const evidence = await buildConflictEvidence({
        artifact: artifact({
          path: filePath,
          existedBefore: false,
          beforeHash: null,
          backupRelativePath: null,
        }),
        backupsDir,
        proposed: new TextEncoder().encode(PROPOSED_TEXT),
        fs: nodeFs,
        guards: allowAll,
        redactDiagnostic: (text) => text,
      });

      expect(evidence.baselineHash).toBeNull();
      expect(evidence.baselineBackupRelativePath).toBeNull();
      expect(evidence.currentHash).toBe(hashOf(CURRENT_TEXT));
    } finally {
      await removeFixture(fixture);
    }
  });
});
