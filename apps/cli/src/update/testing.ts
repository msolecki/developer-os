import { createHash, generateKeyPairSync, sign as signEd25519 } from "node:crypto";
import type { KeyObject } from "node:crypto";

import {
  admitTargetUpdateDraft,
  encodeCanonicalJson,
  PLANNER_PROTOCOL_V1,
  PLANNER_WIRE_BOUNDS_V1,
  parseCanonicalAbsolutePathText,
  parseStableSemver,
  parseUtcTimestamp,
  plannerBlobSetHash,
  plannerJsonBytes,
  plannerJsonHash,
  plannerPathToken,
  releaseIdentityHash,
  signedReleaseDocumentSigningBytes,
  validateBundleManifest,
  validateOfficialReleaseOrigin,
  validateReleaseIndex,
  validateReleaseKeyDelegation,
  validateReleaseTrustState,
  validateUpdatePlannerRequest,
} from "@developer-os/core";
import type {
  ActiveReleaseRecordV1,
  Base64UrlNoPaddingV1,
  CanonicalJsonValue,
  CanonicalPathEvidenceV1,
  InstallationManifestV2,
  LowerHexSha256,
  OfflineReleaseTrustV1,
  ReleaseBundleManifestV1,
  ReleaseIdentityV1,
  ReleaseIndexEntryV1,
  RollbackPayloadIdV1,
  RollbackPayloadRelativePathV1,
  SecretScreenedBlobV1,
  StableSemverV1,
  TargetUpdateDraftV1,
  UpdatePlannerRequestV1,
  UtcTimestampV1,
} from "@developer-os/core";
import type { BoundedReleaseResponseV1, ReleaseTransportRequestV1, VerifiedScratchBundleV1 } from "@developer-os/security";

import type { CliUpdateContext, UpdateScratchAttemptV1 } from "./context.js";
import type { RetainedRollbackEvidenceV1, RollbackRecordV1, UpdateCapacityObservationV1, UpdateHomeV1 } from "./planning.js";

/** Synthetic only: no key, host, path, or byte here belongs to a real release or person. */
export const SYNTHETIC_HOME = parseCanonicalAbsolutePathText("/synthetic/user/.developer-os");
export const SYNTHETIC_TEMP = "/synthetic/tmp/developer-os-release-planning-v1-501-00000000-0000-4000-8000-000000000000";
export const PLANNED_AT = parseUtcTimestamp("2026-09-23T12:00:00.000Z");

export const SYNTHETIC_EVIDENCE: CanonicalPathEvidenceV1 = {
  reopenCanonicalAbsolutePath: (value) => value,
  containsCanonicalPath: (root, candidate) => candidate === root || candidate.startsWith(`${root}/`),
  hasFoldedAlias: () => false,
};

const encoder = new TextEncoder();

export function sha256(value: string | Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(value).digest("hex") as LowerHexSha256;
}

function bytesOf(value: unknown): Uint8Array {
  return encoder.encode(encodeCanonicalJson(value as CanonicalJsonValue));
}

interface SyntheticKey {
  readonly keyId: LowerHexSha256;
  readonly publicKey: Base64UrlNoPaddingV1;
  readonly privateKey: KeyObject;
}

function generateKey(): SyntheticKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const encoded = (publicKey.export({ format: "jwk" }) as { readonly x: string }).x as Base64UrlNoPaddingV1;
  return { keyId: sha256(Buffer.from(encoded, "base64url")), publicKey: encoded, privateKey };
}

function signDocument(kind: string, signed: unknown, key: SyntheticKey): Uint8Array {
  const signature = signEd25519(null, signedReleaseDocumentSigningBytes(kind, signed as CanonicalJsonValue), key.privateKey).toString("base64url");
  return bytesOf({ schemaVersion: 1, kind, signed, signatures: [{ algorithm: "ed25519", keyId: key.keyId, signature }] });
}

const ORIGIN = validateOfficialReleaseOrigin({ scheme: "https", host: "releases.example", port: 443, pathPrefix: "/developer-os/" });
const LOCATOR = { origin: "https://releases.example", repositoryPath: "/developer-os/" } as const;

export interface SyntheticRelease {
  readonly version: StableSemverV1;
  readonly sequence: string;
  readonly manifest: ReleaseBundleManifestV1;
  readonly manifestBytes: Uint8Array;
  readonly archive: Uint8Array;
  readonly entry: ReleaseIndexEntryV1;
  readonly minimumLauncherProtocol?: number;
}

function syntheticRelease(version: string, sequence: string, options: { readonly minimumLauncherProtocol?: number; readonly updateProtocol?: number } = {}): SyntheticRelease {
  const executable = encoder.encode(`synthetic ${version} executable\n`);
  const file = { kind: "file", mode: 448, bytes: String(executable.byteLength), sha256: sha256(executable) };
  const manifest = validateBundleManifest({
    schemaVersion: 1,
    version,
    releaseSequence: sequence,
    platform: "darwin",
    architecture: "arm64",
    launcherProtocol: 1,
    updateProtocol: options.updateProtocol ?? 1,
    entrypoint: "bin/cli",
    runtimeEntrypoint: "bin/runtime",
    plannerEntrypoint: "bin/planner",
    verifierEntrypoint: "bin/verifier",
    entries: [
      { path: "bin", kind: "directory", mode: 448 },
      { path: "bin/cli", ...file },
      { path: "bin/planner", ...file },
      { path: "bin/runtime", ...file },
      { path: "bin/verifier", ...file },
    ],
  });
  const manifestBytes = bytesOf(manifest);
  const archive = encoder.encode(`synthetic ${version} archive bytes\n`);
  const bundle = (architecture: "arm64" | "x64") => ({
    platform: "darwin",
    architecture,
    archiveFormat: "zstd-ustar-v1",
    archivePath: `${version}/darwin-${architecture}.tar.zst`,
    archiveBytes: String(archive.byteLength),
    archiveSha256: sha256(archive),
    manifestPath: `${version}/darwin-${architecture}.manifest.json`,
    manifestBytes: String(manifestBytes.byteLength),
    manifestSha256: sha256(manifestBytes),
  });
  const entry = {
    version,
    releaseSequence: sequence,
    minimumLauncherProtocol: options.minimumLauncherProtocol ?? 1,
    updateProtocol: options.updateProtocol ?? 1,
    bundles: [bundle("arm64"), bundle("x64")],
  } as unknown as ReleaseIndexEntryV1;
  return { version: parseStableSemver(version), sequence, manifest, manifestBytes, archive, entry };
}

function identityOf(release: SyntheticRelease, metadata: { readonly sequence: string; readonly delegationHash: LowerHexSha256; readonly indexHash: LowerHexSha256 }): ReleaseIdentityV1 {
  return {
    version: release.version,
    releaseSequence: release.sequence,
    releaseIdentityHash: releaseIdentityHash(release.entry, "arm64"),
    delegationSequence: metadata.sequence,
    delegationHash: metadata.delegationHash,
    releaseIndexSequence: metadata.sequence,
    releaseIndexHash: metadata.indexHash,
    bundleManifestHash: sha256(release.manifestBytes),
    bundleRoot: parseCanonicalAbsolutePathText(`${SYNTHETIC_HOME}/releases/${release.version}/darwin-arm64`),
    platform: "darwin",
    architecture: "arm64",
    launcherProtocol: 1,
    updateProtocol: 1,
  } as ReleaseIdentityV1;
}

export const OLD_A = encoder.encode("{\"schema\":\"a\",\"version\":1}\n");
export const OLD_B = encoder.encode("{\"schema\":\"b\",\"version\":1}\n");
export const NEW_A = encoder.encode("{\"schema\":\"a\",\"version\":2}\n");
export const NEW_B = encoder.encode("{\"schema\":\"b\",\"version\":2}\n");
export const DIRECTORY_PATH = parseCanonicalAbsolutePathText(`${SYNTHETIC_HOME}/schemas`);
export const FILE_A_PATH = parseCanonicalAbsolutePathText(`${SYNTHETIC_HOME}/schemas/a.json`);
export const FILE_B_PATH = parseCanonicalAbsolutePathText(`${SYNTHETIC_HOME}/schemas/b.json`);
const INSTALLED_AT = parseUtcTimestamp("2026-01-01T00:00:00.000Z");

function currentManifest(): InstallationManifestV2 {
  const common = {
    owner: "core",
    productVersion: "1.0.0",
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    mergeStrategy: "dedicated",
    verifiedAt: INSTALLED_AT,
  } as const;
  return {
    schemaVersion: 2,
    productVersion: parseStableSemver("1.0.0"),
    installedAt: INSTALLED_AT,
    artifacts: [
      { ...common, path: DIRECTORY_PATH, source: "generated/schemas", kind: "directory", verification: { mode: "content" } },
      { ...common, path: FILE_A_PATH, source: "schemas/a.json", kind: "file", verification: { mode: "content", installedHash: sha256(OLD_A) } },
      { ...common, path: FILE_B_PATH, source: "schemas/b.json", kind: "file", verification: { mode: "content", installedHash: sha256(OLD_B) } },
    ],
  } as unknown as InstallationManifestV2;
}

function plannerRequest(releases: { readonly current: ReleaseIdentityV1; readonly target: ReleaseIdentityV1; readonly plannedAt: UtcTimestampV1 }): UpdatePlannerRequestV1 {
  const manifest = currentManifest();
  const artifacts = manifest.artifacts.map((row, ordinal) => ({
    token: plannerPathToken(ordinal),
    owner: row.owner,
    kind: row.kind,
    verification: row.verification,
    productVersion: row.productVersion,
    source: row.source,
    mergeStrategy: row.mergeStrategy,
    currentHash: "installedHash" in row.verification ? row.verification.installedHash : null,
  }));
  const content = (bytes: Uint8Array, ordinal: number) => ({
    state: "content",
    mode: 384,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    blob: { stream: "input", ordinal, bytes: bytes.byteLength, sha256: sha256(bytes) },
  });
  const observed = [{ state: "directory", mode: 448 }, content(OLD_A, 0), content(OLD_B, 1)];
  return validateUpdatePlannerRequest({
    schemaVersion: 1,
    protocol: PLANNER_PROTOCOL_V1,
    plannedAt: releases.plannedAt,
    platform: "darwin",
    architecture: "arm64",
    currentRelease: releases.current,
    targetRelease: releases.target,
    manifest: { schemaVersion: 1, productVersion: manifest.productVersion, installedAt: manifest.installedAt, artifacts },
    config: {
      schemaVersion: 1,
      brainRoot: "brain_root",
      adapters: { claude: false, codex: false },
      git: { enabled: false },
      automation: { enabled: false },
      brain: null,
      redactionPatternsCount: 0,
      telemetry: false,
    },
    installedOwners: ["core"],
    artifactInputs: artifacts.map((row, ordinal) => ({
      token: row.token,
      owner: row.owner,
      kind: row.kind,
      verification: row.verification,
      productVersion: row.productVersion,
      source: row.source,
      mergeStrategy: row.mergeStrategy,
      observed: observed[ordinal],
    })),
    brain: { schemaVersion: 1, root: "brain_root", folderPolicyVersion: 1, entries: [], aggregateBytes: 0 },
  });
}

/** Replaces both schema files with two output blobs; `reversed` lists the operations b-then-a. */
function plannerDraft(request: UpdatePlannerRequestV1, reversed: boolean): TargetUpdateDraftV1 {
  const [directory, fileA, fileB] = request.manifest.artifacts;
  if (directory === undefined || fileA === undefined || fileB === undefined) throw new Error("fixture manifest changed shape");
  const replace = (token: typeof fileA.token, expectedHash: LowerHexSha256 | null, ordinal: number, bytes: Uint8Array) => ({
    operation: "replace" as const,
    target: { kind: "installed" as const, token },
    expectedHash,
    content: { kind: "output_blob" as const, blob: { stream: "output" as const, ordinal, bytes: bytes.byteLength } },
  });
  const operations = [replace(fileA.token, fileA.currentHash, 0, NEW_A), replace(fileB.token, fileB.currentHash, 1, NEW_B)];
  const row = (token: typeof fileA.token, source: string) => ({ owner: "core", path: { kind: "installed", token }, productVersion: request.targetRelease.version, source, mergeStrategy: "dedicated" });
  return admitTargetUpdateDraft({
    schemaVersion: 1,
    protocol: request.protocol,
    currentRelease: request.currentRelease,
    targetRelease: request.targetRelease,
    ownerPlans: [{
      owner: "core",
      currentArtifacts: [directory.token, fileA.token, fileB.token],
      proposedOperations: reversed ? [...operations].reverse() : operations,
      externalEffects: [],
    }],
    migrations: [],
    expectedManifest: {
      schemaVersion: 2,
      productVersion: request.targetRelease.version,
      artifacts: [
        { ...row(directory.token, "generated/schemas"), kind: "directory", verification: { mode: "content" } },
        { ...row(fileA.token, "schemas/a.json"), kind: "file", verification: { mode: "content", installed: operations[0]?.content } },
        { ...row(fileB.token, "schemas/b.json"), kind: "file", verification: { mode: "content", installed: operations[1]?.content } },
      ],
    },
  }, request).draft;
}

function screened(blobs: readonly Uint8Array[]): readonly SecretScreenedBlobV1[] {
  return blobs.map((content, ordinal) => ({ ordinal, bytes: content.byteLength, sha256: sha256(content), content }) as unknown as SecretScreenedBlobV1);
}

export interface UpdateFixtureOptions {
  /** The index's releases; the first is the active one unless `active` names another. */
  readonly releases?: readonly { readonly version: string; readonly sequence: string; readonly minimumLauncherProtocol?: number; readonly updateProtocol?: number }[];
  readonly latestVersion?: string;
  readonly active?: string;
  /** Signs the index with a key the delegation never named. */
  readonly forgedIndex?: boolean;
  /** Serves these bytes in place of the selected bundle manifest. */
  readonly substitutedManifest?: Uint8Array;
  readonly trustSequence?: string;
  readonly reversedOperations?: boolean;
  readonly residue?: readonly string[];
  readonly capacity?: UpdateCapacityObservationV1;
  readonly plannerFailure?: Error;
  /** A retained rollback set: `active` then names the installed release and this the previous one. */
  readonly rollbackPrevious?: string;
  readonly rollbackEvidenceFailure?: Error;
}

export interface UpdateFixture {
  readonly update: CliUpdateContext;
  readonly home: UpdateHomeV1;
  /** Ordered port calls: the observable sequence every ordering test reads. */
  readonly events: string[];
  /** Transport request kinds only; empty proves no network was reached. */
  readonly requests: string[];
  readonly current: ReleaseIdentityV1;
  readonly releases: ReadonlyMap<string, SyntheticRelease>;
}

const AMPLE: UpdateCapacityObservationV1 = {
  availableBytes: "1099511627776" as UpdateCapacityObservationV1["availableBytes"],
  availableEntries: "10000000" as UpdateCapacityObservationV1["availableEntries"],
  reservationGranularityBytes: "4096" as UpdateCapacityObservationV1["reservationGranularityBytes"],
};

export function rollbackEvidenceFor(record: RollbackRecordV1): RetainedRollbackEvidenceV1 {
  const written = (bytes: Uint8Array) => ({ state: "file", mode: 384, bytes: bytes.byteLength, sha256: sha256(bytes), payload: null }) as const;
  const restored = (bytes: Uint8Array, ordinal: number) => ({
    state: "file",
    mode: 384,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    payload: {
      chunks: [{ path: `blobs/${String(ordinal).padStart(10, "0")}.bin` as RollbackPayloadRelativePathV1, bytes: bytes.byteLength, sha256: sha256(bytes) }],
      aggregateBytes: bytes.byteLength,
      sha256: sha256(bytes),
    },
  }) as const;
  return {
    payload: { payloadId: record.payloadId, entryCount: 3, aggregateBytes: OLD_A.byteLength + OLD_B.byteLength + 512 },
    owners: [{
      schemaVersion: 1,
      kind: "owner_inverse",
      id: "owner_core" as RetainedRollbackEvidenceV1["owners"][number]["id"],
      owner: "core",
      operations: [
        { path: FILE_A_PATH, expectedCurrent: written(NEW_A), restore: restored(OLD_A, 0) },
        { path: FILE_B_PATH, expectedCurrent: written(NEW_B), restore: restored(OLD_B, 1) },
      ],
      externalEffects: [],
      maximumPlanBytes: 16_777_216,
    }],
    migrations: [],
  };
}

/**
 * A complete synthetic update world behind `CliUpdateContext`: signed metadata over a fresh
 * Ed25519 root, a recording transport, a scratch that only records, and a planner answering
 * with a real admitted draft and a transcript that hashes exactly what it returns.
 */
export function createUpdateFixture(options: UpdateFixtureOptions = {}): UpdateFixture {
  const root = generateKey();
  const releaseKey = generateKey();
  const stranger = generateKey();
  const specs = options.releases ?? [{ version: "1.0.0", sequence: "1" }, { version: "1.1.0", sequence: "2" }];
  const releases = new Map(specs.map((spec) => [spec.version, syntheticRelease(spec.version, spec.sequence, spec)]));
  const release = (version: string): SyntheticRelease => releases.get(version) ?? (() => { throw new Error(`fixture has no ${version}`); })();

  const delegation = validateReleaseKeyDelegation({
    sequence: "2",
    releaseKey: { algorithm: "ed25519", keyId: releaseKey.keyId, publicKey: releaseKey.publicKey },
    metadataOrigins: [ORIGIN],
    assetOrigins: [ORIGIN],
  });
  const index = validateReleaseIndex({
    sequence: "2",
    latestVersion: options.latestVersion ?? specs[specs.length - 1]?.version,
    releases: specs.map((spec) => release(spec.version).entry),
  });
  const delegationBytes = signDocument("release-key-delegation", delegation, root);
  const indexBytes = signDocument("release-index", index, options.forgedIndex === true ? stranger : releaseKey);
  const offline: OfflineReleaseTrustV1 = {
    schemaVersion: 1,
    handoffProtocol: 1,
    onlineRootKeyId: root.keyId,
    acceptedRoots: [{ role: "online_current", algorithm: "ed25519", keyId: root.keyId, publicKey: root.publicKey }],
    delegationLocator: { ...LOCATOR, assetName: "release-key-delegation-v1.json" },
    indexLocator: { ...LOCATOR, assetName: "release-index-v1.json" },
    metadataRedirectOrigins: [ORIGIN],
  } as unknown as OfflineReleaseTrustV1;

  const previousMetadata = { sequence: "1", delegationHash: sha256("synthetic delegation 1"), indexHash: sha256("synthetic index 1") };
  const activeRelease = release(options.active ?? specs[0]?.version ?? "1.0.0");
  const current = identityOf(activeRelease, options.rollbackPrevious === undefined ? previousMetadata : { sequence: "2", delegationHash: sha256(delegationBytes), indexHash: sha256(indexBytes) });
  const active: ActiveReleaseRecordV1 = { schemaVersion: 1, ...current, activatedAt: INSTALLED_AT };
  const rollback: RollbackRecordV1 | null = options.rollbackPrevious === undefined
    ? null
    : {
        schemaVersion: 1,
        installed: current,
        previous: identityOf(release(options.rollbackPrevious), previousMetadata),
        executionBindingHash: sha256("synthetic execution binding"),
        rollbackBindingHash: sha256("synthetic rollback binding"),
        payloadId: `rb_${sha256("synthetic nonce")}_7` as RollbackPayloadIdV1,
        payloadInventoryHash: sha256("synthetic inventory"),
        inversePlanHash: sha256("synthetic inverse plan"),
        createdAt: INSTALLED_AT,
      };
  const trustSequence = options.trustSequence ?? current.releaseSequence;
  const home: UpdateHomeV1 = {
    manifest: currentManifest(),
    active,
    trust: validateReleaseTrustState({
      schemaVersion: 1,
      highestDelegationSequence: options.trustSequence ?? current.delegationSequence,
      delegationHash: current.delegationHash,
      delegatedReleaseKeyId: releaseKey.keyId,
      highestReleaseIndexSequence: options.trustSequence ?? current.releaseIndexSequence,
      releaseIndexHash: current.releaseIndexHash,
      highestAcceptedReleaseSequence: trustSequence,
      releaseIdentityHash: current.releaseIdentityHash,
    }),
    rollback,
  };

  const events: string[] = [];
  const requests: string[] = [];
  const serve = async (request: ReleaseTransportRequestV1): Promise<BoundedReleaseResponseV1> => {
    requests.push(request.kind);
    events.push(`transport:${request.kind}`);
    let body: Uint8Array;
    if (!("bundle" in request)) {
      body = request.kind === "release_key_delegation" ? delegationBytes : indexBytes;
    } else {
      const archiveSha256 = request.bundle.archiveSha256;
      const selected = [...releases.values()].find((candidate) => candidate.entry.bundles[0].archiveSha256 === archiveSha256);
      if (selected === undefined) throw new Error("fixture served an unknown bundle");
      body = request.kind === "archive" ? selected.archive : options.substitutedManifest ?? selected.manifestBytes;
    }
    await request.sink(body);
    return { kind: request.kind, bodyBytes: String(body.byteLength) as BoundedReleaseResponseV1["bodyBytes"], bodyHash: sha256(body), redirected: false };
  };

  const attempt = (manifest: ReleaseBundleManifestV1): UpdateScratchAttemptV1 => ({
    download: async (fetch) => {
      events.push("scratch.download");
      await fetch(() => Promise.resolve());
    },
    extract: (bundle) => {
      events.push("scratch.extract");
      const verified: VerifiedScratchBundleV1 = {
        id: "rp_00000000-0000-4000-8000-000000000000",
        planHash: sha256("synthetic scratch plan"),
        manifestHash: bundle.manifestSha256,
        root: parseCanonicalAbsolutePathText(`${SYNTHETIC_TEMP}/extracted`),
        entries: manifest.entries.length,
      };
      return Promise.resolve(verified);
    },
    cleanup: () => {
      events.push("scratch.cleanup");
      return Promise.resolve();
    },
  });

  const update: CliUpdateContext = {
    productHome: SYNTHETIC_HOME,
    pathEvidence: SYNTHETIC_EVIDENCE,
    clock: () => PLANNED_AT,
    readHome: () => {
      events.push("home");
      return Promise.resolve(home);
    },
    readOfflineTrust: () => {
      events.push("trust");
      return Promise.resolve(offline);
    },
    createTransport: () => {
      events.push("transport");
      return { get: serve, remainingMilliseconds: () => 600_000 };
    },
    scratch: {
      create: (request) => {
        events.push("scratch.create");
        return Promise.resolve(attempt(request.manifest));
      },
      listRecoverableAttempts: () => {
        events.push("scratch.list");
        return Promise.resolve((options.residue ?? []) as never);
      },
      recoverCleanup: (id) => {
        events.push(`scratch.recover:${id}`);
        return Promise.resolve();
      },
    },
    snapshot: (_home, releasesInput) => {
      events.push("snapshot");
      const request = plannerRequest(releasesInput);
      const tokenPaths = new Map(currentManifest().artifacts.map((row, ordinal) => [plannerPathToken(ordinal), row.path]));
      return Promise.resolve({ request, inputBlobs: [OLD_A, OLD_B], tokenPaths, ownerRoots: { core: SYNTHETIC_HOME } });
    },
    planner: {
      run: (run) => {
        events.push("planner");
        if (options.plannerFailure !== undefined) return Promise.reject(options.plannerFailure);
        const draft = plannerDraft(run.request, options.reversedOperations === true);
        const outputs = [NEW_A, NEW_B];
        return Promise.resolve({
          draft,
          outputBlobs: screened(outputs),
          transcript: {
            protocol: PLANNER_PROTOCOL_V1,
            bounds: PLANNER_WIRE_BOUNDS_V1,
            requestHash: plannerJsonHash("input", plannerJsonBytes(run.request)),
            inputBlobsHash: plannerBlobSetHash("input", run.inputBlobs),
            resultHash: plannerJsonHash("output", plannerJsonBytes(draft)),
            outputBlobsHash: plannerBlobSetHash("output", outputs),
          },
        });
      },
    },
    readRollbackEvidence: (_home, record) => {
      events.push("rollback.evidence");
      if (options.rollbackEvidenceFailure !== undefined) return Promise.reject(options.rollbackEvidenceFailure);
      return Promise.resolve(rollbackEvidenceFor(record));
    },
    capacity: () => {
      events.push("capacity");
      return Promise.resolve(options.capacity ?? AMPLE);
    },
    admitManifest: (value) => value as InstallationManifestV2,
  };
  return { update, home, events, requests, current, releases };
}

/** A context whose every port fails loudly: proves a refusal happened before any of them. */
export function unreachableUpdateContext(): CliUpdateContext {
  const never = (): never => {
    throw new Error("an update port was reached");
  };
  return {
    productHome: SYNTHETIC_HOME,
    pathEvidence: SYNTHETIC_EVIDENCE,
    clock: never,
    readHome: never,
    readOfflineTrust: never,
    createTransport: never,
    scratch: { create: never, listRecoverableAttempts: never, recoverCleanup: never },
    snapshot: never,
    planner: { run: never },
    readRollbackEvidence: never,
    capacity: never,
    admitManifest: never,
  };
}
