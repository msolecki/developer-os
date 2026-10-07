import { createHash } from "node:crypto";

import { validateBundleManifest } from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  LifecycleGuardedEntryV1,
  LowerHexSha256,
  ReleaseBundleManifestV1,
  UInt64DecimalV1,
} from "@developer-os/core";
import { describe, expect, it } from "vitest";

import {
  admitLauncherPlatformIdentity,
  LauncherBundleAdmission,
  LauncherBundleRecoveryRequiredError,
  LauncherPlatformUnsupportedError,
} from "./admission.js";
import type { LauncherGuardedReaderV1 } from "./types.js";

const EFFECTIVE_UID = 501;
const BUNDLE_ROOT = "/Users/test/.developer-os/releases/2.0.0/darwin-arm64" as CanonicalAbsolutePathV1;

type FakeNode =
  | { readonly kind: "directory"; readonly ownerUid: number; readonly mode: number; readonly children: readonly string[] }
  | { readonly kind: "regular_file"; readonly ownerUid: number; readonly mode: number; readonly content: Buffer; readonly nlink?: number };

function sha256(content: Buffer): LowerHexSha256 {
  return createHash("sha256").update(content).digest("hex") as LowerHexSha256;
}

function entryOf(path: string, node: FakeNode): LifecycleGuardedEntryV1 {
  return {
    path: path as CanonicalAbsolutePathV1,
    kind: node.kind,
    ownerUid: node.ownerUid,
    mode: node.mode,
    nlink: node.kind === "directory" ? 2 : (node.nlink ?? 1),
    size: (node.kind === "regular_file" ? node.content.byteLength : 0).toString() as UInt64DecimalV1,
    dev: "1" as UInt64DecimalV1,
    ino: "1" as UInt64DecimalV1,
  };
}

function makeReader(nodes: Map<string, FakeNode>): LauncherGuardedReaderV1 {
  return {
    lstat: (path) => {
      const node = nodes.get(path);
      return Promise.resolve(node === undefined ? null : entryOf(path, node));
    },
    readRegular: (entry) => {
      const node = nodes.get(entry.path);
      if (node === undefined || node.kind !== "regular_file") throw new Error("not a file");
      return Promise.resolve(new Uint8Array(node.content));
    },
    hashRegular: (entry) => {
      const node = nodes.get(entry.path);
      if (node === undefined || node.kind !== "regular_file") throw new Error("not a file");
      return Promise.resolve(sha256(node.content));
    },
    names: (directory) => {
      const node = nodes.get(directory.path);
      if (node === undefined || node.kind !== "directory") throw new Error("not a directory");
      return (async function* generate(): AsyncGenerator<string> {
        await Promise.resolve();
        for (const name of node.children) yield name;
      })();
    },
  };
}

function binaryContent(label: string): Buffer {
  return Buffer.from(`#!/bin/sh\n# ${label}\n`, "utf8");
}

function validBundleFixture(architecture: "arm64" | "x64" = "arm64"): {
  readonly bundleRoot: CanonicalAbsolutePathV1;
  readonly manifest: ReleaseBundleManifestV1;
  readonly nodes: Map<string, FakeNode>;
} {
  const bundleRoot = (architecture === "arm64" ? BUNDLE_ROOT : (BUNDLE_ROOT.replace("arm64", "x64") as CanonicalAbsolutePathV1));
  const cli = binaryContent("cli");
  const runtime = binaryContent("runtime");
  const planner = binaryContent("planner");
  const verifier = binaryContent("verifier");
  const manifest = validateBundleManifest({
    schemaVersion: 1,
    version: "2.0.0",
    releaseSequence: "1",
    platform: "darwin",
    architecture,
    launcherProtocol: 1,
    updateProtocol: 1,
    entrypoint: "bin/cli",
    runtimeEntrypoint: "bin/runtime",
    plannerEntrypoint: "bin/planner",
    verifierEntrypoint: "bin/verifier",
    entries: [
      { path: "bin", kind: "directory", mode: 448 },
      { path: "bin/cli", kind: "file", mode: 448, bytes: cli.byteLength.toString() as UInt64DecimalV1, sha256: sha256(cli) },
      { path: "bin/planner", kind: "file", mode: 448, bytes: planner.byteLength.toString() as UInt64DecimalV1, sha256: sha256(planner) },
      { path: "bin/runtime", kind: "file", mode: 448, bytes: runtime.byteLength.toString() as UInt64DecimalV1, sha256: sha256(runtime) },
      { path: "bin/verifier", kind: "file", mode: 448, bytes: verifier.byteLength.toString() as UInt64DecimalV1, sha256: sha256(verifier) },
    ],
  });

  const nodes = new Map<string, FakeNode>([
    [bundleRoot, { kind: "directory", ownerUid: EFFECTIVE_UID, mode: 0o700, children: ["bin"] }],
    [`${bundleRoot}/bin`, { kind: "directory", ownerUid: EFFECTIVE_UID, mode: 448, children: ["cli", "planner", "runtime", "verifier"] }],
    [`${bundleRoot}/bin/cli`, { kind: "regular_file", ownerUid: EFFECTIVE_UID, mode: 448, content: cli }],
    [`${bundleRoot}/bin/planner`, { kind: "regular_file", ownerUid: EFFECTIVE_UID, mode: 448, content: planner }],
    [`${bundleRoot}/bin/runtime`, { kind: "regular_file", ownerUid: EFFECTIVE_UID, mode: 448, content: runtime }],
    [`${bundleRoot}/bin/verifier`, { kind: "regular_file", ownerUid: EFFECTIVE_UID, mode: 448, content: verifier }],
  ]);

  return { bundleRoot, manifest, nodes };
}

describe("admitLauncherPlatformIdentity", () => {
  it("admits darwin arm64", () => {
    expect(admitLauncherPlatformIdentity({ platform: "darwin", architecture: "arm64" })).toEqual({
      platform: "darwin",
      architecture: "arm64",
    });
  });

  it("admits darwin x64", () => {
    expect(admitLauncherPlatformIdentity({ platform: "darwin", architecture: "x64" })).toEqual({
      platform: "darwin",
      architecture: "x64",
    });
  });

  it("refuses an unsupported platform", () => {
    try {
      admitLauncherPlatformIdentity({ platform: "linux", architecture: "arm64" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LauncherPlatformUnsupportedError);
      expect((error as LauncherPlatformUnsupportedError).code).toBe(4);
    }
  });

  it("refuses an unsupported architecture", () => {
    try {
      admitLauncherPlatformIdentity({ platform: "darwin", architecture: "ia32" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LauncherPlatformUnsupportedError);
      expect((error as LauncherPlatformUnsupportedError).code).toBe(4);
    }
  });
});

describe("LauncherBundleAdmission", () => {
  it("admits a valid darwin arm64 bundle with absolute, PATH-free entrypoints", async () => {
    const { bundleRoot, manifest, nodes } = validBundleFixture("arm64");
    const admission = new LauncherBundleAdmission();
    const admitted = await admission.admit({
      platform: { platform: "darwin", architecture: "arm64" },
      bundleRoot,
      manifest,
      effectiveUid: EFFECTIVE_UID,
      modes: "exact",
      fs: makeReader(nodes),
    });

    expect(admitted.runtimeEntrypoint).toBe(`${bundleRoot}/bin/runtime`);
    expect(admitted.entrypoint).toBe(`${bundleRoot}/bin/cli`);
    expect(admitted.runtimeEntrypoint.startsWith("/")).toBe(true);
    expect(admitted.entrypoint.startsWith(bundleRoot)).toBe(true);
  });

  it("admits a valid darwin x64 bundle", async () => {
    const { bundleRoot, manifest, nodes } = validBundleFixture("x64");
    const admission = new LauncherBundleAdmission();
    const admitted = await admission.admit({
      platform: { platform: "darwin", architecture: "x64" },
      bundleRoot,
      manifest,
      effectiveUid: EFFECTIVE_UID,
      modes: "exact",
      fs: makeReader(nodes),
    });

    expect(admitted.manifest.architecture).toBe("x64");
  });

  it("refuses when the manifest architecture does not match the running platform", async () => {
    const { bundleRoot, manifest, nodes } = validBundleFixture("x64");
    const admission = new LauncherBundleAdmission();
    await expect(
      admission.admit({
        platform: { platform: "darwin", architecture: "arm64" },
        bundleRoot,
        manifest,
        effectiveUid: EFFECTIVE_UID,
        modes: "exact",
        fs: makeReader(nodes),
      }),
    ).rejects.toMatchObject({ code: 4 });
  });

  it("refuses an unknown extra bundle member (exact inventory set)", async () => {
    const { bundleRoot, manifest, nodes } = validBundleFixture("arm64");
    const rogue = Buffer.from("rogue", "utf8");
    nodes.set(`${bundleRoot}/bin/rogue`, { kind: "regular_file", ownerUid: EFFECTIVE_UID, mode: 384, content: rogue });
    const dir = nodes.get(`${bundleRoot}/bin`);
    if (dir?.kind === "directory") nodes.set(`${bundleRoot}/bin`, { ...dir, children: [...dir.children, "rogue"] });

    const admission = new LauncherBundleAdmission();
    await expect(
      admission.admit({
        platform: { platform: "darwin", architecture: "arm64" },
        bundleRoot,
        manifest,
        effectiveUid: EFFECTIVE_UID,
        modes: "exact",
        fs: makeReader(nodes),
      }),
    ).rejects.toBeInstanceOf(LauncherBundleRecoveryRequiredError);
  });

  it("refuses a declared member missing from disk", async () => {
    const { bundleRoot, manifest, nodes } = validBundleFixture("arm64");
    nodes.delete(`${bundleRoot}/bin/verifier`);
    const dir = nodes.get(`${bundleRoot}/bin`);
    if (dir?.kind === "directory") {
      nodes.set(`${bundleRoot}/bin`, { ...dir, children: dir.children.filter((name) => name !== "verifier") });
    }

    const admission = new LauncherBundleAdmission();
    await expect(
      admission.admit({
        platform: { platform: "darwin", architecture: "arm64" },
        bundleRoot,
        manifest,
        effectiveUid: EFFECTIVE_UID,
        modes: "exact",
        fs: makeReader(nodes),
      }),
    ).rejects.toBeInstanceOf(LauncherBundleRecoveryRequiredError);
  });

  it("refuses a present-but-invalid member instead of silently accepting it (wrong content hash)", async () => {
    const { bundleRoot, manifest, nodes } = validBundleFixture("arm64");
    nodes.set(`${bundleRoot}/bin/cli`, { kind: "regular_file", ownerUid: EFFECTIVE_UID, mode: 448, content: Buffer.from("tampered") });

    const admission = new LauncherBundleAdmission();
    await expect(
      admission.admit({
        platform: { platform: "darwin", architecture: "arm64" },
        bundleRoot,
        manifest,
        effectiveUid: EFFECTIVE_UID,
        modes: "exact",
        fs: makeReader(nodes),
      }),
    ).rejects.toMatchObject({ code: 6 });
  });

  it("refuses a hard-linked member", async () => {
    const { bundleRoot, manifest, nodes } = validBundleFixture("arm64");
    const cli = nodes.get(`${bundleRoot}/bin/cli`);
    if (cli?.kind === "regular_file") nodes.set(`${bundleRoot}/bin/cli`, { ...cli, nlink: 2 });

    const admission = new LauncherBundleAdmission();
    await expect(
      admission.admit({
        platform: { platform: "darwin", architecture: "arm64" },
        bundleRoot,
        manifest,
        effectiveUid: EFFECTIVE_UID,
        modes: "exact",
        fs: makeReader(nodes),
      }),
    ).rejects.toBeInstanceOf(LauncherBundleRecoveryRequiredError);
  });

  it("refuses a member owned by a different uid", async () => {
    const { bundleRoot, manifest, nodes } = validBundleFixture("arm64");
    const cli = nodes.get(`${bundleRoot}/bin/cli`);
    if (cli?.kind === "regular_file") nodes.set(`${bundleRoot}/bin/cli`, { ...cli, ownerUid: EFFECTIVE_UID + 1 });

    const admission = new LauncherBundleAdmission();
    await expect(
      admission.admit({
        platform: { platform: "darwin", architecture: "arm64" },
        bundleRoot,
        manifest,
        effectiveUid: EFFECTIVE_UID,
        modes: "exact",
        fs: makeReader(nodes),
      }),
    ).rejects.toBeInstanceOf(LauncherBundleRecoveryRequiredError);
  });

  it("refuses a missing bundle root", async () => {
    const { bundleRoot, manifest } = validBundleFixture("arm64");
    const admission = new LauncherBundleAdmission();
    await expect(
      admission.admit({
        platform: { platform: "darwin", architecture: "arm64" },
        bundleRoot,
        manifest,
        effectiveUid: EFFECTIVE_UID,
        modes: "exact",
        fs: makeReader(new Map()),
      }),
    ).rejects.toBeInstanceOf(LauncherBundleRecoveryRequiredError);
  });
});

/** A keg as Homebrew installs it: directories 0755, files 0755 or 0644 by class, owned by `owner`. */
function homebrewFixture(owner: number) {
  const fixture = validBundleFixture("arm64");
  for (const [path, node] of fixture.nodes) {
    fixture.nodes.set(path, { ...node, ownerUid: owner, mode: 0o755 });
  }
  return fixture;
}

describe("LauncherBundleAdmission homebrew modes (D84 K3)", () => {
  const admit = (fixture: ReturnType<typeof validBundleFixture>, modes: "exact" | "homebrew") =>
    new LauncherBundleAdmission().admit({
      platform: { platform: "darwin", architecture: "arm64" },
      bundleRoot: fixture.bundleRoot,
      manifest: fixture.manifest,
      effectiveUid: EFFECTIVE_UID,
      modes,
      fs: makeReader(fixture.nodes),
    });

  it("admits a homebrew keg owned by the user or by root, and only in homebrew mode", async () => {
    await expect(admit(homebrewFixture(EFFECTIVE_UID), "homebrew")).resolves.toMatchObject({ bundleRoot: BUNDLE_ROOT });
    await expect(admit(homebrewFixture(0), "homebrew")).resolves.toMatchObject({ bundleRoot: BUNDLE_ROOT });
    await expect(admit(homebrewFixture(EFFECTIVE_UID), "exact")).rejects.toBeInstanceOf(LauncherBundleRecoveryRequiredError);
    await expect(admit(homebrewFixture(EFFECTIVE_UID + 1), "homebrew")).rejects.toBeInstanceOf(LauncherBundleRecoveryRequiredError);
  });

  it("refuses a homebrew keg whose permission class disagrees with the manifest", async () => {
    const fixture = homebrewFixture(EFFECTIVE_UID);
    fixture.nodes.set(`${BUNDLE_ROOT}/bin/cli`, { ...(fixture.nodes.get(`${BUNDLE_ROOT}/bin/cli`) as FakeNode), mode: 0o644 });
    await expect(admit(fixture, "homebrew")).rejects.toBeInstanceOf(LauncherBundleRecoveryRequiredError);
    const writable = homebrewFixture(EFFECTIVE_UID);
    writable.nodes.set(`${BUNDLE_ROOT}/bin`, { ...(writable.nodes.get(`${BUNDLE_ROOT}/bin`) as FakeNode), mode: 0o775 });
    await expect(admit(writable, "homebrew")).rejects.toBeInstanceOf(LauncherBundleRecoveryRequiredError);
  });

  it("admits a 0644 file whose manifest mode is 0600 in homebrew mode", async () => {
    const fixture = homebrewFixture(EFFECTIVE_UID);
    const data = Buffer.from("data\n");
    const manifest = validateBundleManifest({
      ...fixture.manifest,
      entries: [...fixture.manifest.entries, { path: "bin/data", kind: "file" as const, mode: 384, bytes: data.byteLength.toString(), sha256: sha256(data) }].sort((a, b) => (a.path < b.path ? -1 : 1)),
    });
    const bin = fixture.nodes.get(`${BUNDLE_ROOT}/bin`) as Extract<FakeNode, { kind: "directory" }>;
    fixture.nodes.set(`${BUNDLE_ROOT}/bin`, { ...bin, children: [...bin.children, "data"] });
    fixture.nodes.set(`${BUNDLE_ROOT}/bin/data`, { kind: "regular_file", ownerUid: EFFECTIVE_UID, mode: 0o644, content: data });
    await expect(admit({ ...fixture, manifest }, "homebrew")).resolves.toMatchObject({ bundleRoot: BUNDLE_ROOT });
    fixture.nodes.set(`${BUNDLE_ROOT}/bin/data`, { kind: "regular_file", ownerUid: EFFECTIVE_UID, mode: 0o755, content: data });
    await expect(admit({ ...fixture, manifest }, "homebrew")).rejects.toBeInstanceOf(LauncherBundleRecoveryRequiredError);
  });
});
