import { createHash } from "node:crypto";

import {
  encodeCanonicalJson,
  validateBundleManifest,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  LifecycleGuardedEntryV1,
  LowerHexSha256,
  ReleaseBundleManifestV1,
  UInt64DecimalV1,
} from "@developer-os/core";
import type { LauncherGuardedReaderV1 } from "@developer-os/platform-macos";
import { describe, expect, it } from "vitest";

import {
  buildLauncherProcessRequest,
  selectLauncherCandidate,
  type LauncherSelectionRequestV1,
} from "./selection.js";

const EFFECTIVE_UID = 501;
const PRODUCT_HOME = "/Users/test/.developer-os" as CanonicalAbsolutePathV1;
const FALLBACK_ROOT = "/opt/homebrew/opt/developer-os/fallback" as CanonicalAbsolutePathV1;
const FALLBACK_MANIFEST = `${FALLBACK_ROOT}.manifest.json` as CanonicalAbsolutePathV1;

type FakeNode =
  | { readonly kind: "directory"; readonly ownerUid: number; readonly mode: number; readonly children: readonly string[] }
  | { readonly kind: "regular_file"; readonly ownerUid: number; readonly mode: number; readonly content: Buffer };

function sha256(content: Buffer): LowerHexSha256 {
  return createHash("sha256").update(content).digest("hex") as LowerHexSha256;
}

function entryOf(path: string, node: FakeNode): LifecycleGuardedEntryV1 {
  return {
    path: path as CanonicalAbsolutePathV1,
    kind: node.kind,
    ownerUid: node.ownerUid,
    mode: node.mode,
    nlink: node.kind === "directory" ? 2 : 1,
    size: (node.kind === "regular_file" ? node.content.byteLength : 0).toString() as UInt64DecimalV1,
    dev: "1" as UInt64DecimalV1,
    ino: "1" as UInt64DecimalV1,
  };
}

class FakeFileSystem implements LauncherGuardedReaderV1 {
  constructor(private readonly nodes: Map<string, FakeNode>) {}

  lstat(path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1 | null> {
    const node = this.nodes.get(path);
    return Promise.resolve(node === undefined ? null : entryOf(path, node));
  }

  readRegular(entry: LifecycleGuardedEntryV1): Promise<Uint8Array> {
    const node = this.nodes.get(entry.path);
    if (node === undefined || node.kind !== "regular_file") throw new Error("not a file");
    return Promise.resolve(new Uint8Array(node.content));
  }

  hashRegular(entry: LifecycleGuardedEntryV1): Promise<LowerHexSha256> {
    const node = this.nodes.get(entry.path);
    if (node === undefined || node.kind !== "regular_file") throw new Error("not a file");
    return Promise.resolve(sha256(node.content));
  }

  names(directory: LifecycleGuardedEntryV1): AsyncIterable<string> {
    const node = this.nodes.get(directory.path);
    if (node === undefined || node.kind !== "directory") throw new Error("not a directory");
    const { children } = node;
    return (async function* generate(): AsyncGenerator<string> {
      await Promise.resolve();
      for (const name of children) yield name;
    })();
  }

  setFile(path: string, content: Buffer, ownerUid = EFFECTIVE_UID, mode = 0o600): void {
    this.nodes.set(path, { kind: "regular_file", ownerUid, mode, content });
  }

  setDirectory(path: string, children: readonly string[], ownerUid = EFFECTIVE_UID, mode = 0o700): void {
    this.nodes.set(path, { kind: "directory", ownerUid, mode, children });
  }

  deletePath(path: string): void {
    this.nodes.delete(path);
  }

  directoryChildren(path: string): readonly string[] {
    const node = this.nodes.get(path);
    return node?.kind === "directory" ? node.children : [];
  }

  addChild(directoryPath: string, name: string): void {
    const node = this.nodes.get(directoryPath);
    if (node?.kind === "directory") this.setDirectory(directoryPath, [...node.children, name], node.ownerUid, node.mode);
  }

  removeChild(directoryPath: string, name: string): void {
    const node = this.nodes.get(directoryPath);
    if (node?.kind === "directory") {
      this.setDirectory(directoryPath, node.children.filter((child) => child !== name), node.ownerUid, node.mode);
    }
  }
}

function canonicalBytes(value: CanonicalJsonValue): Buffer {
  return Buffer.from(encodeCanonicalJson(value), "utf8");
}

function writeBundle(
  fs: FakeFileSystem,
  bundleRoot: string,
  architecture: "arm64" | "x64",
  version: string,
  releaseSequence: string,
): ReleaseBundleManifestV1 {
  const cli = Buffer.from("#!/bin/sh\n# cli\n");
  const runtime = Buffer.from("#!/bin/sh\n# runtime\n");
  const planner = Buffer.from("#!/bin/sh\n# planner\n");
  const verifier = Buffer.from("#!/bin/sh\n# verifier\n");
  const manifest = validateBundleManifest({
    schemaVersion: 1,
    version,
    releaseSequence,
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

  fs.setDirectory(bundleRoot, ["bin"]);
  fs.setDirectory(`${bundleRoot}/bin`, ["cli", "planner", "runtime", "verifier"], EFFECTIVE_UID, 448);
  fs.setFile(`${bundleRoot}/bin/cli`, cli, EFFECTIVE_UID, 448);
  fs.setFile(`${bundleRoot}/bin/planner`, planner, EFFECTIVE_UID, 448);
  fs.setFile(`${bundleRoot}/bin/runtime`, runtime, EFFECTIVE_UID, 448);
  fs.setFile(`${bundleRoot}/bin/verifier`, verifier, EFFECTIVE_UID, 448);
  return manifest;
}

function baseRequest(fs: FakeFileSystem): LauncherSelectionRequestV1 {
  return {
    productHome: PRODUCT_HOME,
    platform: { platform: "darwin", architecture: "arm64" },
    effectiveUid: EFFECTIVE_UID,
    fs,
    packagedFallback: { bundleRoot: FALLBACK_ROOT, manifestPath: FALLBACK_MANIFEST },
    bootstrapClosure: { kind: "handoff_complete" },
    verifyRetainedDocument: () => undefined,
  };
}

function absentActiveFixture(): LauncherSelectionRequestV1 {
  const fs = new FakeFileSystem(new Map());
  const manifest = writeBundle(fs, FALLBACK_ROOT, "arm64", "1.0.0", "1");
  fs.setFile(FALLBACK_MANIFEST, canonicalBytes(manifest as unknown as CanonicalJsonValue));
  return baseRequest(fs);
}

function activeFixture() {
  const fs = new FakeFileSystem(new Map());
  const bundleRoot = `${PRODUCT_HOME}/releases/2.0.0/darwin-arm64`;
  const manifest = writeBundle(fs, bundleRoot, "arm64", "2.0.0", "2");

  const delegationBytes = canonicalBytes({
    schemaVersion: 1,
    kind: "release-key-delegation",
    signed: { ok: true },
    signatures: [{ ok: true }],
  });
  const delegationHash = sha256(delegationBytes);
  const indexBytes = canonicalBytes({
    schemaVersion: 1,
    kind: "release-index",
    signed: { ok: true },
    signatures: [{ ok: true }],
  });
  const releaseIndexHash = sha256(indexBytes);
  const bundleManifestBytes = canonicalBytes(manifest as unknown as CanonicalJsonValue);
  const bundleManifestHash = sha256(bundleManifestBytes);

  const active = {
    schemaVersion: 1,
    version: "2.0.0",
    releaseSequence: "2",
    releaseIdentityHash: sha256(Buffer.from("release-identity")),
    delegationSequence: "1",
    delegationHash,
    releaseIndexSequence: "1",
    releaseIndexHash,
    bundleManifestHash,
    bundleRoot: bundleRoot as CanonicalAbsolutePathV1,
    platform: "darwin",
    architecture: "arm64",
    launcherProtocol: 1,
    updateProtocol: 1,
    activatedAt: "2026-09-22T00:00:00.000Z",
  };
  const trust = {
    schemaVersion: 1,
    highestDelegationSequence: "1",
    delegationHash,
    delegatedReleaseKeyId: sha256(Buffer.from("delegated-key")),
    highestReleaseIndexSequence: "1",
    releaseIndexHash,
    highestAcceptedReleaseSequence: "2",
    releaseIdentityHash: active.releaseIdentityHash,
  };

  fs.setFile(`${PRODUCT_HOME}/state/active-release.json`, canonicalBytes(active));
  fs.setFile(`${PRODUCT_HOME}/state/release-trust.json`, canonicalBytes(trust));

  fs.setDirectory(`${PRODUCT_HOME}/state/release-metadata/delegations`, [`${delegationHash}.json`]);
  fs.setFile(`${PRODUCT_HOME}/state/release-metadata/delegations/${delegationHash}.json`, delegationBytes);
  fs.setDirectory(`${PRODUCT_HOME}/state/release-metadata/indexes`, [`${releaseIndexHash}.json`]);
  fs.setFile(`${PRODUCT_HOME}/state/release-metadata/indexes/${releaseIndexHash}.json`, indexBytes);
  fs.setDirectory(`${PRODUCT_HOME}/state/release-metadata/bundles`, [`${bundleManifestHash}.json`]);
  fs.setFile(`${PRODUCT_HOME}/state/release-metadata/bundles/${bundleManifestHash}.json`, bundleManifestBytes);

  return { fs, active, bundleRoot, trust };
}

function malformedActiveFixture(): LauncherSelectionRequestV1 {
  const fs = new FakeFileSystem(new Map());
  fs.setFile(`${PRODUCT_HOME}/state/active-release.json`, Buffer.from("not json\n"));
  return baseRequest(fs);
}

describe("selectLauncherCandidate", () => {
  it("falls back only when active state is absent", async () => {
    const result = await selectLauncherCandidate(absentActiveFixture());
    expect(result.kind).toBe("package_fallback");
  });

  it("rejects malformed active state with recovery-required", async () => {
    await expect(selectLauncherCandidate(malformedActiveFixture())).rejects.toMatchObject({ code: 6 });
  });

  it("selects the active release when it is valid", async () => {
    const { fs } = activeFixture();
    const result = await selectLauncherCandidate(baseRequest(fs));
    expect(result.kind).toBe("active_release");
    if (result.kind === "active_release") {
      expect(result.bundle.entrypoint.endsWith("/bin/cli")).toBe(true);
      expect(result.bundle.runtimeEntrypoint.endsWith("/bin/runtime")).toBe(true);
    }
  });

  it("refuses an active record not dominated by trust", async () => {
    const { fs } = activeFixture();
    const trustPath = `${PRODUCT_HOME}/state/release-trust.json`;
    const tampered = {
      schemaVersion: 1,
      highestDelegationSequence: "0",
      delegationHash: sha256(Buffer.from("delegation")),
      delegatedReleaseKeyId: sha256(Buffer.from("other-key")),
      highestReleaseIndexSequence: "0",
      releaseIndexHash: sha256(Buffer.from("index")),
      highestAcceptedReleaseSequence: "1",
      releaseIdentityHash: sha256(Buffer.from("stale")),
    };
    fs.setFile(trustPath, canonicalBytes(tampered));
    await expect(selectLauncherCandidate(baseRequest(fs))).rejects.toMatchObject({ code: 6 });
  });

  it("never launches a home whose trust state is unsigned-local", async () => {
    const { fs, trust } = activeFixture();
    fs.setFile(`${PRODUCT_HOME}/state/release-trust.json`, canonicalBytes({ ...trust, trust: "unsigned-local" }));
    await expect(selectLauncherCandidate(baseRequest(fs))).rejects.toMatchObject({
      code: 6,
      reason: "launcher_retained_document_unverified",
    });
  });

  it("refuses when the retained delegation store holds an extra file", async () => {
    const { fs } = activeFixture();
    const directory = `${PRODUCT_HOME}/state/release-metadata/delegations`;
    fs.setFile(`${directory}/extra.json`, canonicalBytes({ rogue: true }));
    fs.addChild(directory, "extra.json");
    await expect(selectLauncherCandidate(baseRequest(fs))).rejects.toMatchObject({ code: 6 });
  });

  it("refuses when the retained bundle manifest hash does not match the active record", async () => {
    const { fs, active } = activeFixture();
    const path = `${PRODUCT_HOME}/state/release-metadata/bundles/${active.bundleManifestHash}.json`;
    fs.setFile(path, Buffer.from("tampered bytes\n"));
    await expect(selectLauncherCandidate(baseRequest(fs))).rejects.toMatchObject({ code: 6 });
  });

  it("routes strictly to init during a non-terminal bootstrap envelope", async () => {
    const request = { ...absentActiveFixture(), bootstrapClosure: { kind: "non_terminal" as const } };
    const result = await selectLauncherCandidate(request);
    expect(result.kind).toBe("bootstrap_recovery");
    if (result.kind === "bootstrap_recovery") expect(result.argv).toEqual(["init"]);
  });

  it("refuses an active record published before the launchability suffix completes", async () => {
    const { fs } = activeFixture();
    const request = { ...baseRequest(fs), bootstrapClosure: { kind: "non_terminal" as const } };
    await expect(selectLauncherCandidate(request)).rejects.toMatchObject({ code: 6 });
  });

  it("refuses malformed bootstrap residue", async () => {
    const request = { ...absentActiveFixture(), bootstrapClosure: { kind: "malformed" as const } };
    await expect(selectLauncherCandidate(request)).rejects.toMatchObject({ code: 6 });
  });
});

describe("buildLauncherProcessRequest", () => {
  it("builds a shell-free absolute execution request with one read-only FD 3 reservation", async () => {
    const result = await selectLauncherCandidate(absentActiveFixture());
    const request = buildLauncherProcessRequest(result, { HOME: "/Users/test", DEVELOPER_OS_HOME: PRODUCT_HOME }, ["status"], true);

    expect(request.executable).toBe(result.bundle.runtimeEntrypoint);
    expect(request.executable.startsWith("/")).toBe(true);
    expect(request.argv[0]).toBe(result.bundle.entrypoint);
    expect(request.argv[1]).toBe("--offline-release-trust-fd=3");
    expect(request.argv.slice(2)).toEqual(["status"]);
    expect(request.extraDescriptors).toEqual([{ fd: 3, mode: "read_only_pipe" }]);
  });

  it("omits the trust-fd flag and the FD 3 reservation when no trust pipe is handed over", async () => {
    const result = await selectLauncherCandidate(absentActiveFixture());
    const request = buildLauncherProcessRequest(result, { HOME: "/Users/test", DEVELOPER_OS_HOME: PRODUCT_HOME }, ["status"], false);

    expect(request.argv).toEqual([result.bundle.entrypoint, "status"]);
    expect(request.extraDescriptors).toEqual([]);
  });

  it("forces bootstrap recovery argv to exactly init, ignoring the public argv", async () => {
    const request = { ...absentActiveFixture(), bootstrapClosure: { kind: "non_terminal" as const } };
    const result = await selectLauncherCandidate(request);
    const processRequest = buildLauncherProcessRequest(result, { HOME: "/Users/test", DEVELOPER_OS_HOME: PRODUCT_HOME }, [
      "update",
      "--apply",
    ], true);
    expect(processRequest.argv.slice(2)).toEqual(["init"]);
  });
});
