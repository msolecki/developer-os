import { createHash } from "node:crypto";

import {
  encodeCanonicalJson,
  PACKAGE_CHANNEL_DELEGATION_BYTES,
  PACKAGE_CHANNEL_RELEASE_KEY_ID,
  releaseIdentityHash,
  rollbackBindingHash,
  validateBundleManifest,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  LifecycleGuardedEntryV1,
  LowerHexSha256,
  ReleaseBundleManifestV1,
  RollbackPayloadIdV1,
  UInt64DecimalV1,
} from "@developer-os/core";
import type { LauncherGuardedReaderV1 } from "@developer-os/platform-macos";
import { describe, expect, it } from "vitest";

import {
  buildLauncherProcessRequest,
  selectLauncherCandidate,
  type LauncherSelectionRequestV1,
  type LauncherSelectionV1,
  type LauncherUpdateEnvelopeV1,
} from "./selection.js";

const EFFECTIVE_UID = 501;
const PRODUCT_HOME = "/Users/test/.developer-os" as CanonicalAbsolutePathV1;
/** The canonical keg `opt/developer-os` resolves to, and its packaged fallback (D84 K2/K3). */
const KEG_FALLBACK = "/opt/homebrew/Cellar/developer-os/1.0.0/libexec/fallback";
const FALLBACK_ROOT = `${KEG_FALLBACK}/bundle` as CanonicalAbsolutePathV1;
const FALLBACK_MANIFEST = `${KEG_FALLBACK}/metadata/bundle-manifest.json` as CanonicalAbsolutePathV1;

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

class FakeFileSystem implements LauncherGuardedReaderV1 {
  /** Bytes `readRegular` hands back in place of the file's content, which `hashRegular` still hashes. */
  readonly substitutedReads = new Map<string, Buffer>();

  constructor(private readonly nodes: Map<string, FakeNode>) {}

  lstat(path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1 | null> {
    const node = this.nodes.get(path);
    return Promise.resolve(node === undefined ? null : entryOf(path, node));
  }

  readRegular(entry: LifecycleGuardedEntryV1): Promise<Uint8Array> {
    const node = this.nodes.get(entry.path);
    if (node === undefined || node.kind !== "regular_file") throw new Error("not a file");
    return Promise.resolve(new Uint8Array(this.substitutedReads.get(entry.path) ?? node.content));
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

  setFile(path: string, content: Buffer, ownerUid = EFFECTIVE_UID, mode = 0o600, nlink = 1): void {
    this.nodes.set(path, { kind: "regular_file", ownerUid, mode, content, nlink });
  }

  setDirectory(path: string, children: readonly string[], ownerUid = EFFECTIVE_UID, mode = 0o700): void {
    this.nodes.set(path, { kind: "directory", ownerUid, mode, children });
  }

  readBytes(path: string): Buffer {
    const node = this.nodes.get(path);
    if (node?.kind !== "regular_file") throw new Error("not a file");
    return node.content;
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
  modes: { readonly owner: number; readonly homebrew: boolean } = { owner: EFFECTIVE_UID, homebrew: false },
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

  // Homebrew installs directories and executables 0755; a product-home release keeps the manifest's 0700.
  const mode = modes.homebrew ? 0o755 : 448;
  fs.setDirectory(bundleRoot, ["bin"], modes.owner, modes.homebrew ? 0o755 : 0o700);
  fs.setDirectory(`${bundleRoot}/bin`, ["cli", "planner", "runtime", "verifier"], modes.owner, mode);
  fs.setFile(`${bundleRoot}/bin/cli`, cli, modes.owner, mode);
  fs.setFile(`${bundleRoot}/bin/planner`, planner, modes.owner, mode);
  fs.setFile(`${bundleRoot}/bin/runtime`, runtime, modes.owner, mode);
  fs.setFile(`${bundleRoot}/bin/verifier`, verifier, modes.owner, mode);
  return manifest;
}

function indexEntry(version: string, releaseSequence: string, arm64ManifestHash: LowerHexSha256) {
  const bundle = (architecture: "arm64" | "x64", manifestSha256: string) => ({
    platform: "darwin",
    architecture,
    archiveFormat: "zstd-ustar-v1",
    archivePath: `darwin-${architecture}.tar.zst`,
    archiveBytes: "1",
    archiveSha256: "a".repeat(64),
    manifestPath: `darwin-${architecture}-manifest.json`,
    manifestBytes: "1",
    manifestSha256,
  });
  return { version, releaseSequence, minimumLauncherProtocol: 1, updateProtocol: 1, bundles: [bundle("arm64", arm64ManifestHash), bundle("x64", "d".repeat(64))] };
}

/** The keg's plain, unsigned one-row `ReleaseIndexV1` (D84 K2). */
function plainIndex(entry: ReturnType<typeof indexEntry>): Buffer {
  return canonicalBytes({ sequence: "1", latestVersion: entry.version, releases: [entry] });
}

const noEnvelope = (): Promise<LauncherUpdateEnvelopeV1> => Promise.resolve({ kind: "absent" });
const envelopeOf = (envelope: LauncherUpdateEnvelopeV1) => (): Promise<LauncherUpdateEnvelopeV1> => Promise.resolve(envelope);

function baseRequest(fs: FakeFileSystem): LauncherSelectionRequestV1 {
  return {
    productHome: PRODUCT_HOME,
    platform: { platform: "darwin", architecture: "arm64" },
    effectiveUid: EFFECTIVE_UID,
    fs,
    packagedFallback: { bundleRoot: FALLBACK_ROOT, manifestPath: FALLBACK_MANIFEST },
    bootstrapClosure: { kind: "handoff_complete" },
    readUpdateEnvelope: noEnvelope,
  };
}

/** No active record: only the keg's packaged fallback, in Homebrew's modes and owned by `owner`. */
function absentActiveFixture(owner = EFFECTIVE_UID): LauncherSelectionRequestV1 {
  const fs = new FakeFileSystem(new Map());
  const manifest = writeBundle(fs, FALLBACK_ROOT, "arm64", "1.0.0", "1", { owner, homebrew: true });
  fs.setFile(FALLBACK_MANIFEST, canonicalBytes(manifest as unknown as CanonicalJsonValue), owner, 0o644);
  return baseRequest(fs);
}

function activeFixture() {
  const fs = new FakeFileSystem(new Map());
  const bundleRoot = `${PRODUCT_HOME}/releases/2.0.0/darwin-arm64`;
  const manifest = writeBundle(fs, bundleRoot, "arm64", "2.0.0", "2");

  const delegationBytes = Buffer.from(PACKAGE_CHANNEL_DELEGATION_BYTES);
  const delegationHash = sha256(delegationBytes);
  const bundleManifestBytes = canonicalBytes(manifest as unknown as CanonicalJsonValue);
  const bundleManifestHash = sha256(bundleManifestBytes);
  const entry = indexEntry("2.0.0", "2", bundleManifestHash);
  const indexBytes = plainIndex(entry);
  const releaseIndexHash = sha256(indexBytes);

  const active = {
    schemaVersion: 1,
    version: "2.0.0",
    releaseSequence: "2",
    releaseIdentityHash: releaseIdentityHash(entry, "arm64"),
    delegationSequence: "0",
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
    trust: "package-channel",
    highestDelegationSequence: "0",
    delegationHash,
    delegatedReleaseKeyId: PACKAGE_CHANNEL_RELEASE_KEY_ID,
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

  return { fs, active, bundleRoot, trust, delegationBytes };
}

/** Replaces the retained index with `bytes` and repoints the active record and trust at it. */
function retainIndex(fixture: ReturnType<typeof activeFixture>, bytes: Buffer): void {
  const { fs, active, trust } = fixture;
  const indexes = `${PRODUCT_HOME}/state/release-metadata/indexes`;
  const releaseIndexHash = sha256(bytes);
  fs.deletePath(`${indexes}/${active.releaseIndexHash}.json`);
  fs.setDirectory(indexes, [`${releaseIndexHash}.json`]);
  fs.setFile(`${indexes}/${releaseIndexHash}.json`, bytes);
  fs.setFile(`${PRODUCT_HOME}/state/active-release.json`, canonicalBytes({ ...active, releaseIndexHash }));
  fs.setFile(`${PRODUCT_HOME}/state/release-trust.json`, canonicalBytes({ ...trust, releaseIndexHash }));
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
      trust: "package-channel",
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

  it("never launches a home whose trust state names no channel (the withdrawn signed state)", async () => {
    const { fs, trust } = activeFixture();
    fs.setFile(`${PRODUCT_HOME}/state/release-trust.json`, canonicalBytes(Object.fromEntries(Object.entries(trust).filter(([key]) => key !== "trust"))));
    await expect(selectLauncherCandidate(baseRequest(fs))).rejects.toMatchObject({
      code: 6,
      reason: "launcher_retained_document_unverified",
    });
  });

  it("refuses an active bundle root outside the product home's releases", async () => {
    const { fs, active } = activeFixture();
    const foreignRoot = "/Users/test/elsewhere/2.0.0/darwin-arm64";
    writeBundle(fs, foreignRoot, "arm64", "2.0.0", "2");
    fs.setFile(`${PRODUCT_HOME}/state/active-release.json`, canonicalBytes({ ...active, bundleRoot: foreignRoot }));
    await expect(selectLauncherCandidate(baseRequest(fs))).rejects.toMatchObject({
      code: 6,
      reason: "launcher_release_root_invalid",
    });
  });

  it("admits the retained rollback release's metadata beside the active release's", async () => {
    const { fs, active } = activeFixture();
    const installed = Object.fromEntries(Object.entries(active).filter(([key]) => key !== "schemaVersion" && key !== "activatedAt"));
    const previous = {
      ...installed,
      version: "1.0.0",
      releaseSequence: "1",
      releaseIdentityHash: sha256(Buffer.from("previous-identity")),
      delegationHash: sha256(Buffer.from("previous-delegation")),
      releaseIndexHash: sha256(Buffer.from("previous-index")),
      bundleManifestHash: sha256(Buffer.from("previous-bundle")),
      bundleRoot: `${PRODUCT_HOME}/releases/1.0.0/darwin-arm64`,
    };
    fs.setFile(`${PRODUCT_HOME}/state/update-rollback.json`, canonicalBytes({
      schemaVersion: 1,
      installed,
      previous,
      executionBindingHash: sha256(Buffer.from("execution-binding")),
      // The binding the record's own fields derive, as `buildRollbackPayload` writes it (W2-ROLLBACK-2).
      rollbackBindingHash: rollbackBindingHash({
        executionBindingHash: sha256(Buffer.from("execution-binding")),
        payloadId: `rb_${"d".repeat(64)}_1` as RollbackPayloadIdV1,
        installedReleaseIdentityHash: installed.releaseIdentityHash as LowerHexSha256,
        previousReleaseIdentityHash: previous.releaseIdentityHash,
      }),
      payloadId: `rb_${"d".repeat(64)}_1`,
      payloadInventoryHash: sha256(Buffer.from("inventory")),
      inversePlanHash: sha256(Buffer.from("inverse-plan")),
      createdAt: "2026-09-22T00:00:00.000Z",
    }));
    for (const [store, hash] of [["delegations", previous.delegationHash], ["indexes", previous.releaseIndexHash], ["bundles", previous.bundleManifestHash]] as const) {
      fs.setFile(`${PRODUCT_HOME}/state/release-metadata/${store}/${hash}.json`, canonicalBytes({ previous: true }));
      fs.addChild(`${PRODUCT_HOME}/state/release-metadata/${store}`, `${hash}.json`);
    }

    await expect(selectLauncherCandidate(baseRequest(fs))).resolves.toMatchObject({ kind: "active_release" });
  });

  it("never admits the delegation stand-in retained in the index slot as the index", async () => {
    const fixture = activeFixture();
    retainIndex(fixture, fixture.delegationBytes);
    await expect(selectLauncherCandidate(baseRequest(fixture.fs))).rejects.toMatchObject({
      code: 6,
      reason: "launcher_retained_document_unverified",
    });
  });

  it("refuses a trust watermark naming another key at the active delegation's sequence", async () => {
    const { fs, trust } = activeFixture();
    fs.setFile(`${PRODUCT_HOME}/state/release-trust.json`, canonicalBytes({ ...trust, delegatedReleaseKeyId: sha256(Buffer.from("other-key")) }));
    await expect(selectLauncherCandidate(baseRequest(fs))).rejects.toMatchObject({
      code: 6,
      reason: "launcher_active_release_not_dominated_by_trust",
    });
  });

  it("refuses a valid index that does not list the active bundle manifest", async () => {
    const fixture = activeFixture();
    retainIndex(fixture, plainIndex(indexEntry("2.0.0", "2", sha256(Buffer.from("another-manifest")))));
    await expect(selectLauncherCandidate(baseRequest(fixture.fs))).rejects.toMatchObject({ code: 6, reason: "launcher_bundle_manifest_identity_mismatch" });
  });

  it("parses the retained bundle manifest bytes it hash-pinned, not a second read", async () => {
    const { fs, active } = activeFixture();
    const path = `${PRODUCT_HOME}/state/release-metadata/bundles/${active.bundleManifestHash}.json`;
    const manifest = JSON.parse(fs.readBytes(path).toString("utf8")) as Record<string, unknown>;
    fs.substitutedReads.set(path, canonicalBytes({ ...manifest, entrypoint: "bin/planner" }));
    await expect(selectLauncherCandidate(baseRequest(fs))).rejects.toMatchObject({ code: 6, reason: "launcher_bundle_manifest_hash_mismatch" });
  });

  it("refuses a hard-linked retained document", async () => {
    const { fs, active } = activeFixture();
    const path = `${PRODUCT_HOME}/state/release-metadata/delegations/${active.delegationHash}.json`;
    fs.setFile(path, fs.readBytes(path), EFFECTIVE_UID, 0o600, 2);
    await expect(selectLauncherCandidate(baseRequest(fs))).rejects.toMatchObject({ code: 6, reason: "launcher_retained_document_missing" });
  });

  it("refuses a group-readable active release record", async () => {
    const { fs } = activeFixture();
    const path = `${PRODUCT_HOME}/state/active-release.json`;
    fs.setFile(path, fs.readBytes(path), EFFECTIVE_UID, 0o644);
    await expect(selectLauncherCandidate(baseRequest(fs))).rejects.toMatchObject({ code: 6, reason: "launcher_active_release_record_invalid" });
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

const COORDINATOR_ID = `lc_${"c".repeat(64)}_5`;
const EXECUTOR_RECORD = `${PRODUCT_HOME}/state/update-executor.json`;

function executorRecord(state: "executing" | "terminal_cleanup", executor: CanonicalJsonValue): Buffer {
  return canonicalBytes({
    schemaVersion: 1,
    state,
    coordinatorId: COORDINATOR_ID,
    operation: "update_apply",
    executor,
    executionBindingHash: sha256(Buffer.from("execution-binding")),
    createdAt: "2026-09-23T12:00:00.000Z",
  });
}

/** An update mid-flight: the recorded original release plus target metadata already retained beside it. */
function executingFixture(): LauncherSelectionRequestV1 & { readonly current: CanonicalJsonValue } {
  const { fs, active } = activeFixture();
  const current = Object.fromEntries(Object.entries(active).filter(([key]) => key !== "schemaVersion" && key !== "activatedAt")) as CanonicalJsonValue;
  const directory = `${PRODUCT_HOME}/state/release-metadata/delegations`;
  fs.setFile(`${directory}/${sha256(Buffer.from("target-delegation"))}.json`, canonicalBytes({ target: true }));
  fs.addChild(directory, `${sha256(Buffer.from("target-delegation"))}.json`);
  fs.setFile(EXECUTOR_RECORD, executorRecord("executing", { kind: "release_bundle", release: current }));
  return { ...baseRequest(fs), readUpdateEnvelope: envelopeOf({ kind: "present", coordinatorId: COORDINATOR_ID }), current };
}

/** After the post-verifier rewrite: the record names the package-owned fallback. */
function cleanupFixture(manifestHash?: LowerHexSha256): LauncherSelectionRequestV1 {
  const request = absentActiveFixture();
  const fs = request.fs as FakeFileSystem;
  const fallbackHash = sha256(Buffer.from(fs.readBytes(FALLBACK_MANIFEST)));
  fs.setFile(EXECUTOR_RECORD, executorRecord("terminal_cleanup", { kind: "package_fallback", bundleManifestHash: manifestHash ?? fallbackHash, launcherProtocol: 1, updateProtocol: 1 }));
  return request;
}

describe("update recovery-executor routing", () => {
  it("routes executing to the original bundle and terminal cleanup to fallback", async () => {
    const executing = executingFixture();
    const selected = await selectLauncherCandidate(executing);
    expect(selected.kind).toBe("update_executor");
    if (selected.kind === "update_executor") {
      expect(selected.release).toEqual(executing.current);
      expect(selected.bundle.bundleRoot).toBe(`${PRODUCT_HOME}/releases/2.0.0/darwin-arm64`);
    }
    expect((await selectLauncherCandidate(cleanupFixture())).kind).toBe("package_fallback");
    const suffix = { ...cleanupFixture(), readUpdateEnvelope: envelopeOf({ kind: "present", coordinatorId: COORDINATOR_ID }) };
    expect((await selectLauncherCandidate(suffix)).kind).toBe("package_fallback");
  });

  it("refuses an executing record without its own coordinator envelope", async () => {
    const orphan = { ...executingFixture(), readUpdateEnvelope: noEnvelope };
    await expect(selectLauncherCandidate(orphan)).rejects.toMatchObject({ code: 6, reason: "launcher_update_executor_orphan" });
    const foreign = { ...executingFixture(), readUpdateEnvelope: envelopeOf({ kind: "present", coordinatorId: `lc_${"c".repeat(64)}_6` }) };
    await expect(selectLauncherCandidate(foreign)).rejects.toMatchObject({ code: 6 });
  });

  it("refuses a fallback whose manifest or protocol differs from the terminal record", async () => {
    await expect(selectLauncherCandidate(cleanupFixture(sha256(Buffer.from("other-manifest"))))).rejects.toMatchObject({ code: 6, reason: "launcher_update_fallback_mismatch" });
  });

  it("selects normally over fresh init's empty executor-record reservation", async () => {
    const { fs } = activeFixture();
    const expected = await selectLauncherCandidate(baseRequest(fs));
    fs.setFile(EXECUTOR_RECORD, Buffer.alloc(0));
    await expect(selectLauncherCandidate(baseRequest(fs))).resolves.toStrictEqual(expected);
  });

  it("never ignores a malformed record or envelope in favour of normal selection", async () => {
    const { fs } = activeFixture();
    fs.setFile(EXECUTOR_RECORD, Buffer.from("not json\n"));
    await expect(selectLauncherCandidate(baseRequest(fs))).rejects.toMatchObject({ code: 6, reason: "launcher_update_executor_record_invalid" });
    const malformed = { ...executingFixture(), readUpdateEnvelope: envelopeOf({ kind: "malformed" }) };
    await expect(selectLauncherCandidate(malformed)).rejects.toMatchObject({ code: 6 });
  });

  it("passes the public argv through to the recorded executor", async () => {
    const selected = await selectLauncherCandidate(executingFixture());
    const request = buildLauncherProcessRequest(selected, { HOME: "/Users/test", DEVELOPER_OS_HOME: PRODUCT_HOME }, ["update", "--apply"]);
    expect(request.argv).toEqual([selected.bundle.entrypoint, "update", "--apply"]);
  });
});

describe("buildLauncherProcessRequest", () => {
  it("builds a shell-free absolute execution request", async () => {
    const result = await selectLauncherCandidate(absentActiveFixture());
    const request = buildLauncherProcessRequest(result, { HOME: "/Users/test", DEVELOPER_OS_HOME: PRODUCT_HOME }, ["status"]);

    expect(request.executable).toBe(result.bundle.runtimeEntrypoint);
    expect(request.executable.startsWith("/")).toBe(true);
    expect(request.argv).toEqual([result.bundle.entrypoint, "status"]);
  });

  it("forces bootstrap recovery argv to exactly init, ignoring the public argv", async () => {
    const request = { ...absentActiveFixture(), bootstrapClosure: { kind: "non_terminal" as const } };
    const result = await selectLauncherCandidate(request);
    const processRequest = buildLauncherProcessRequest(result, { HOME: "/Users/test", DEVELOPER_OS_HOME: PRODUCT_HOME }, [
      "update",
      "--apply",
    ]);
    expect(processRequest.argv).toEqual([result.bundle.entrypoint, "init"]);
  });
});

describe("package-channel launcher selection (D84 K3)", () => {
  const env = { HOME: "/Users/test", DEVELOPER_OS_HOME: PRODUCT_HOME } as const;

  it("(a) admits a package-channel active release by inventory and hash with no verifier", async () => {
    const selection = await selectLauncherCandidate(baseRequest(activeFixture().fs));
    expect(selection.kind).toBe("active_release");
  });

  it("(b) routes a changed retained index to recovery", async () => {
    const { fs, active } = activeFixture();
    const path = `${PRODUCT_HOME}/state/release-metadata/indexes/${active.releaseIndexHash}.json`;
    fs.setFile(path, Buffer.concat([fs.readBytes(path), Buffer.from(" ")]));
    await expect(selectLauncherCandidate(baseRequest(fs))).rejects.toMatchObject({ code: 6 });
  });

  it("(c) admits a Homebrew-mode fallback when no active record exists, owned by the user or by root", async () => {
    expect((await selectLauncherCandidate(absentActiveFixture())).kind).toBe("package_fallback");
    expect((await selectLauncherCandidate(absentActiveFixture(0))).kind).toBe("package_fallback");
    await expect(selectLauncherCandidate(absentActiveFixture(EFFECTIVE_UID + 1))).rejects.toMatchObject({ code: 6 });
  });

  it("(d) builds argv without the FD 3 flag and reserves no descriptor", async () => {
    const selection: LauncherSelectionV1 = await selectLauncherCandidate(absentActiveFixture());
    const built = buildLauncherProcessRequest(selection, env, ["doctor"]);
    expect(built.argv).toEqual([selection.bundle.entrypoint, "doctor"]);
    expect("extraDescriptors" in built).toBe(false);
  });

  it("(e) refuses a terminal-cleanup record whose fallback hash is not the current keg's", async () => {
    // Review Focus 1: `brew upgrade` replaced the keg after the record pinned the old fallback.
    await expect(selectLauncherCandidate(cleanupFixture("f".repeat(64) as LowerHexSha256))).rejects.toMatchObject({
      code: 6,
      reason: "launcher_update_fallback_mismatch",
    });
  });
});
