import { createHash, generateKeyPairSync, randomUUID, sign as signEd25519 } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  admitTargetUpdateDraft,
  buildUpdateCoordinatorPlan,
  deriveUpdateExecutorRecordPath,
  deriveUpdateSteps,
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseRollbackPayloadId,
  parseSafeReasonCode,
  parseUInt64Decimal,
  updateConstructionEnvelopePaths,
  updateCoordinatorStagingRoot,
  updateExecutionBindingHash,
  updateLeafPlanPath,
  updateRecoveryExecutorRecordBytes,
  updateRecoveryExecutorRecordHash,
  updateRecoveryExecutorStagedPath,
  validateReleaseIdentity,
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
  rollbackStepListHash,
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
  CanonicalAbsolutePathV1,
  ImmutableUpdatePlanRefV1,
  LifecycleCoordinatorIdV1,
  UpdateExecutionPlanV1,
  UpdateFallbackHandoffV1,
  UpdateLeafPlanKindV1,
  UpdateLifecycleCoordinatorPlanV2,
  UpdateOperationV1,
  UpdateRecoveryExecutorRecordV1,
  UpdateStepOwnerV1,
  Base64UrlNoPaddingV1,
  CanonicalJsonValue,
  CanonicalPathEvidenceV1,
  InstallationManifestV2,
  LowerHexSha256,
  ManagedArtifactV2,
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

import { runInit } from "../commands/init.js";
import { createCommandFixture } from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import type { CliContext } from "../context.js";
import { productionUpdateApplyPorts } from "./apply-ports.js";
import { applyUpdate } from "./apply.js";
import type { UpdateApplyResultV1 } from "./apply.js";
import { prepareUpdate, releaseIdentityOf } from "./planning.js";
import { createCliUpdateContext } from "./context.js";
import type { CliUpdateContext, UpdateCodexV1, UpdateScratchAttemptV1 } from "./context.js";
import { CODEX_REFRESH_PROVIDER_PROTOCOL, codexRefreshPolicy } from "./codex-refresh.js";
import type { CodexExecutableIdentityV1 } from "./codex-refresh.js";
import { codexPluginTreeHash } from "../instructions/codex-registration.js";
import type { CodexRegistrationStateV1 } from "../instructions/codex-registration.js";
import { codexInstructionPaths } from "../instructions/vendor-homes.js";
import type { VendorHomesV1 } from "../instructions/vendor-homes.js";
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
/** Spec 2 pins both metadata locators; only the asset origins are fixture-chosen. */
const LOCATOR = { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/" } as const;

export type SyntheticArchitectureV1 = "arm64" | "x64";

/** The index lists both bundles in this order; `selectRelease` takes ordinal 0 for arm64 and 1 for x64. */
export const SYNTHETIC_ARCHITECTURES: readonly SyntheticArchitectureV1[] = ["arm64", "x64"];

export interface SyntheticBundleV1 {
  readonly manifest: ReleaseBundleManifestV1;
  readonly manifestBytes: Uint8Array;
  readonly archive: Uint8Array;
  /** Every bundle file's exact bytes by bundle-relative path. */
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export interface SyntheticRelease extends SyntheticBundleV1 {
  readonly version: StableSemverV1;
  readonly sequence: string;
  /** The fixture's architecture; the inherited bundle fields are that architecture's bundle. */
  readonly architecture: SyntheticArchitectureV1;
  /** Both architectures' bundles, each with distinct bytes. */
  readonly bundles: ReadonlyMap<SyntheticArchitectureV1, SyntheticBundleV1>;
  readonly entry: ReleaseIndexEntryV1;
  readonly minimumLauncherProtocol?: number;
}

export interface SyntheticReleaseOptionsV1 {
  readonly minimumLauncherProtocol?: number;
  readonly updateProtocol?: number;
  /** Replaces a bundle file's placeholder bytes, e.g. with a runnable runtime and verifier. */
  readonly files?: (architecture: SyntheticArchitectureV1) => ReadonlyMap<string, Uint8Array>;
}

const BUNDLE_FILES: readonly string[] = ["bin/cli", "bin/planner", "bin/runtime", "bin/verifier"];

function syntheticBundle(version: string, sequence: string, architecture: SyntheticArchitectureV1, options: SyntheticReleaseOptionsV1): SyntheticBundleV1 {
  const replaced = options.files?.(architecture);
  const files = new Map(BUNDLE_FILES.map((path) => [path, replaced?.get(path) ?? encoder.encode(`synthetic ${version} ${architecture} ${path}\n`)]));
  const manifest = validateBundleManifest({
    schemaVersion: 1,
    version,
    releaseSequence: sequence,
    platform: "darwin",
    architecture,
    launcherProtocol: 1,
    updateProtocol: options.updateProtocol ?? 1,
    entrypoint: "bin/cli",
    runtimeEntrypoint: "bin/runtime",
    plannerEntrypoint: "bin/planner",
    verifierEntrypoint: "bin/verifier",
    entries: [
      { path: "bin", kind: "directory", mode: 448 },
      ...[...files].map(([path, bytes]) => ({ path, kind: "file", mode: 448, bytes: String(bytes.byteLength), sha256: sha256(bytes) })),
    ],
  });
  return { manifest, manifestBytes: bytesOf(manifest), archive: encoder.encode(`synthetic ${version} ${architecture} archive bytes\n`), files };
}

function syntheticRelease(version: string, sequence: string, options: SyntheticReleaseOptionsV1 = {}, architecture: SyntheticArchitectureV1 = "arm64"): SyntheticRelease {
  const bundles = new Map(SYNTHETIC_ARCHITECTURES.map((candidate) => [candidate, syntheticBundle(version, sequence, candidate, options)]));
  const bundleOf = (candidate: SyntheticArchitectureV1): SyntheticBundleV1 => bundles.get(candidate) ?? (() => { throw new Error(`no ${candidate} bundle`); })();
  const reference = (candidate: SyntheticArchitectureV1) => ({
    platform: "darwin",
    architecture: candidate,
    archiveFormat: "zstd-ustar-v1",
    archivePath: `${version}/darwin-${candidate}.tar.zst`,
    archiveBytes: String(bundleOf(candidate).archive.byteLength),
    archiveSha256: sha256(bundleOf(candidate).archive),
    manifestPath: `${version}/darwin-${candidate}.manifest.json`,
    manifestBytes: String(bundleOf(candidate).manifestBytes.byteLength),
    manifestSha256: sha256(bundleOf(candidate).manifestBytes),
  });
  const entry = {
    version,
    releaseSequence: sequence,
    minimumLauncherProtocol: options.minimumLauncherProtocol ?? 1,
    updateProtocol: options.updateProtocol ?? 1,
    bundles: SYNTHETIC_ARCHITECTURES.map(reference),
  } as unknown as ReleaseIndexEntryV1;
  return { version: parseStableSemver(version), sequence, architecture, ...bundleOf(architecture), bundles, entry };
}

/** The one bundle, of either architecture, whose signed archive hash a transport request names. */
function servedBundle(releases: Iterable<SyntheticRelease>, archiveSha256: LowerHexSha256): SyntheticBundleV1 {
  for (const release of releases) {
    for (const bundle of release.bundles.values()) if (sha256(bundle.archive) === archiveSha256) return bundle;
  }
  throw new Error("fixture served an unknown bundle");
}

function identityOf(release: SyntheticRelease, metadata: { readonly sequence: string; readonly delegationHash: LowerHexSha256; readonly indexHash: LowerHexSha256 }, home: CanonicalAbsolutePathV1 = SYNTHETIC_HOME): ReleaseIdentityV1 {
  return {
    version: release.version,
    releaseSequence: release.sequence,
    releaseIdentityHash: releaseIdentityHash(release.entry, release.architecture),
    delegationSequence: metadata.sequence,
    delegationHash: metadata.delegationHash,
    releaseIndexSequence: metadata.sequence,
    releaseIndexHash: metadata.indexHash,
    bundleManifestHash: sha256(release.manifestBytes),
    bundleRoot: parseCanonicalAbsolutePathText(`${home}/releases/${release.version}/darwin-${release.architecture}`),
    platform: "darwin",
    architecture: release.architecture,
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

/** The Codex owner's synthetic partition (P6): one plugin file under the managed plugin root, and its registration record. */
export const SYNTHETIC_CODEX_HOMES: VendorHomesV1 = {
  userHome: parseCanonicalAbsolutePathText("/synthetic/user"),
  productHome: SYNTHETIC_HOME,
  codexHome: parseCanonicalAbsolutePathText("/synthetic/user/.codex"),
};
export const CODEX_PLUGIN_ROOT = parseCanonicalAbsolutePathText(codexInstructionPaths(SYNTHETIC_CODEX_HOMES).pluginRoot);
export const CODEX_PLUGIN_FILE = parseCanonicalAbsolutePathText(`${CODEX_PLUGIN_ROOT}/plugin.json`);
export const CODEX_REGISTRATION_PATH = parseCanonicalAbsolutePathText(codexInstructionPaths(SYNTHETIC_CODEX_HOMES).registrationFile);
export const OLD_PLUGIN = encoder.encode("{\"name\":\"developer-os\",\"version\":\"1.0.0\"}\n");
export const NEW_PLUGIN = encoder.encode("{\"name\":\"developer-os\",\"version\":\"1.0.0\",\"skills\":2}\n");

/** The record `init` wrote for the installed tree: `registered` names exactly this tree hash. */
export function codexRegistrationBytes(plugin: Uint8Array): Uint8Array {
  return encoder.encode(encodeCanonicalJson({ codexHome: SYNTHETIC_CODEX_HOMES.codexHome, treeHash: codexPluginTreeHash([{ path: "plugin.json", sha256: sha256(plugin) }]) }));
}

interface FixtureRowV1 {
  readonly artifact: ManagedArtifactV2;
  /** The installed bytes a content or schema row pins; null for a directory. */
  readonly bytes: Uint8Array | null;
}

/** The installed rows in the current process's snapshot order: owner order, then path. */
function fixtureRows(codex: boolean): readonly FixtureRowV1[] {
  const common = (owner: "core" | "codex") => ({
    owner,
    productVersion: "1.0.0",
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    mergeStrategy: "dedicated",
    verifiedAt: INSTALLED_AT,
  }) as const;
  const row = (artifact: unknown, bytes: Uint8Array | null): FixtureRowV1 => ({ artifact: artifact as ManagedArtifactV2, bytes });
  const registration = codexRegistrationBytes(OLD_PLUGIN);
  return [
    row({ ...common("core"), path: DIRECTORY_PATH, source: "generated/schemas", kind: "directory", verification: { mode: "content" } }, null),
    row({ ...common("core"), path: FILE_A_PATH, source: "schemas/a.json", kind: "file", verification: { mode: "content", installedHash: sha256(OLD_A) } }, OLD_A),
    row({ ...common("core"), path: FILE_B_PATH, source: "schemas/b.json", kind: "file", verification: { mode: "content", installedHash: sha256(OLD_B) } }, OLD_B),
    ...(codex
      ? [
          row({ ...common("codex"), path: CODEX_PLUGIN_ROOT, source: "codex/plugins/developer-os", kind: "directory", verification: { mode: "content" } }, null),
          row({ ...common("codex"), path: CODEX_PLUGIN_FILE, source: "codex/plugins/developer-os/plugin.json", kind: "file", verification: { mode: "content", installedHash: sha256(OLD_PLUGIN) } }, OLD_PLUGIN),
          row({ ...common("codex"), path: CODEX_REGISTRATION_PATH, source: "generated/codex/registration.json", kind: "file", verification: { mode: "schema", schemaId: "codex-registration-v1", installedHash: sha256(registration) } }, registration),
        ]
      : []),
  ];
}

function currentManifest(codex = false): InstallationManifestV2 {
  const artifacts = fixtureRows(codex).map((row) => row.artifact).sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  return { schemaVersion: 2, productVersion: parseStableSemver("1.0.0"), installedAt: INSTALLED_AT, artifacts } as unknown as InstallationManifestV2;
}

function plannerRequest(releases: { readonly current: ReleaseIdentityV1; readonly target: ReleaseIdentityV1; readonly plannedAt: UtcTimestampV1 }, codex = false): UpdatePlannerRequestV1 {
  const rows = fixtureRows(codex);
  const artifacts = rows.map(({ artifact: row }, ordinal) => ({
    token: plannerPathToken(ordinal),
    owner: row.owner,
    kind: row.kind,
    verification: row.verification,
    productVersion: row.productVersion,
    source: row.source,
    mergeStrategy: row.mergeStrategy,
    currentHash: "installedHash" in row.verification ? row.verification.installedHash : null,
  }));
  let blobs = 0;
  const observed = rows.map(({ bytes }) => {
    if (bytes === null) return { state: "directory", mode: 448 };
    const ordinal = blobs;
    blobs += 1;
    return { state: "content", mode: 384, bytes: bytes.byteLength, sha256: sha256(bytes), blob: { stream: "input", ordinal, bytes: bytes.byteLength, sha256: sha256(bytes) } };
  });
  return validateUpdatePlannerRequest({
    schemaVersion: 1,
    protocol: PLANNER_PROTOCOL_V1,
    plannedAt: releases.plannedAt,
    platform: "darwin",
    architecture: releases.current.architecture,
    currentRelease: releases.current,
    targetRelease: releases.target,
    manifest: { schemaVersion: 1, productVersion: parseStableSemver("1.0.0"), installedAt: INSTALLED_AT, artifacts },
    config: {
      schemaVersion: 1,
      brainRoot: "brain_root",
      adapters: { claude: false, codex },
      git: { enabled: false },
      automation: { enabled: false },
      brain: null,
      redactionPatternsCount: 0,
      telemetry: false,
    },
    installedOwners: codex ? ["core", "codex"] : ["core"],
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

/**
 * Replaces both schema files with two output blobs; `reversed` lists the operations b-then-a. With
 * a Codex owner it also replaces the plugin file (a third blob) and drafts the one closed refresh.
 */
function plannerDraft(request: UpdatePlannerRequestV1, reversed: boolean): TargetUpdateDraftV1 {
  const [directory, fileA, fileB, pluginRoot, plugin, registration] = request.manifest.artifacts;
  if (directory === undefined || fileA === undefined || fileB === undefined) throw new Error("fixture manifest changed shape");
  const replace = (token: typeof fileA.token, expectedHash: LowerHexSha256 | null, ordinal: number, bytes: Uint8Array) => ({
    operation: "replace" as const,
    target: { kind: "installed" as const, token },
    expectedHash,
    content: { kind: "output_blob" as const, blob: { stream: "output" as const, ordinal, bytes: bytes.byteLength } },
  });
  const operations = [replace(fileA.token, fileA.currentHash, 0, NEW_A), replace(fileB.token, fileB.currentHash, 1, NEW_B)];
  const row = (owner: string, token: typeof fileA.token, source: string) => ({ owner, path: { kind: "installed", token }, productVersion: request.targetRelease.version, source, mergeStrategy: "dedicated" });
  const codex = pluginRoot !== undefined && plugin !== undefined && registration !== undefined;
  const pluginReplace = codex ? replace(plugin.token, plugin.currentHash, 2, NEW_PLUGIN) : null;
  return admitTargetUpdateDraft({
    schemaVersion: 1,
    protocol: request.protocol,
    currentRelease: request.currentRelease,
    targetRelease: request.targetRelease,
    ownerPlans: [
      {
        owner: "core",
        currentArtifacts: [directory.token, fileA.token, fileB.token],
        proposedOperations: reversed ? [...operations].reverse() : operations,
        externalEffects: [],
      },
      ...(codex && pluginReplace !== null
        ? [{
            owner: "codex",
            currentArtifacts: [pluginRoot.token, plugin.token, registration.token],
            proposedOperations: [pluginReplace],
            externalEffects: [{ kind: "codex_registration_refresh", owner: "codex", artifactTokens: [pluginRoot.token, plugin.token, registration.token] }],
          }]
        : []),
    ],
    migrations: [],
    expectedManifest: {
      schemaVersion: 2,
      productVersion: request.targetRelease.version,
      artifacts: [
        { ...row("core", directory.token, "generated/schemas"), kind: "directory", verification: { mode: "content" } },
        { ...row("core", fileA.token, "schemas/a.json"), kind: "file", verification: { mode: "content", installed: operations[0]?.content } },
        { ...row("core", fileB.token, "schemas/b.json"), kind: "file", verification: { mode: "content", installed: operations[1]?.content } },
        ...(codex && pluginReplace !== null
          ? [
              { ...row("codex", pluginRoot.token, "codex/plugins/developer-os"), kind: "directory", verification: { mode: "content" } },
              { ...row("codex", plugin.token, "codex/plugins/developer-os/plugin.json"), kind: "file", verification: { mode: "content", installed: pluginReplace.content } },
              { ...row("codex", registration.token, "generated/codex/registration.json"), kind: "file", verification: { mode: "schema", schemaId: "codex-registration-v1", installed: { kind: "installed", token: registration.token } } },
            ]
          : []),
      ],
    },
  }, request).draft;
}

function screened(blobs: readonly Uint8Array[]): readonly SecretScreenedBlobV1[] {
  return blobs.map((content, ordinal) => ({ ordinal, bytes: content.byteLength, sha256: sha256(content), content }) as unknown as SecretScreenedBlobV1);
}

interface SignedReleaseMetadataV1 {
  readonly delegationBytes: Uint8Array;
  readonly indexBytes: Uint8Array;
  readonly offline: OfflineReleaseTrustV1;
  readonly releaseKey: SyntheticKey;
}

/** A fresh Ed25519 root, its delegation of a fresh release key, and the index over `releases`. */
function signedReleaseMetadata(releases: readonly SyntheticRelease[], latestVersion: string, forgedIndex: boolean): SignedReleaseMetadataV1 {
  const root = generateKey();
  const releaseKey = generateKey();
  const delegation = validateReleaseKeyDelegation({
    sequence: "2",
    releaseKey: { algorithm: "ed25519", keyId: releaseKey.keyId, publicKey: releaseKey.publicKey },
    metadataOrigins: [ORIGIN],
    assetOrigins: [ORIGIN],
  });
  const index = validateReleaseIndex({ sequence: "2", latestVersion, releases: releases.map((release) => release.entry) });
  const offline = {
    schemaVersion: 1,
    handoffProtocol: 1,
    onlineRootKeyId: root.keyId,
    acceptedRoots: [{ role: "online_current", algorithm: "ed25519", keyId: root.keyId, publicKey: root.publicKey }],
    delegationLocator: { ...LOCATOR, assetName: "release-key-delegation-v1.json" },
    indexLocator: { ...LOCATOR, assetName: "release-index-v1.json" },
    metadataRedirectOrigins: [ORIGIN],
  } as unknown as OfflineReleaseTrustV1;
  return {
    delegationBytes: signDocument("release-key-delegation", delegation, root),
    indexBytes: signDocument("release-index", index, forgedIndex ? generateKey() : releaseKey),
    offline,
    releaseKey,
  };
}

/** The recording transport: both metadata documents, and either architecture's manifest or archive by its signed hash. */
function syntheticReleaseServer(input: {
  readonly delegationBytes: Uint8Array;
  readonly indexBytes: Uint8Array;
  readonly releases: ReadonlyMap<string, SyntheticRelease>;
  readonly requests: string[];
  readonly events: string[];
  readonly substitutedManifest?: Uint8Array;
}): (request: ReleaseTransportRequestV1) => Promise<BoundedReleaseResponseV1> {
  return async (request) => {
    input.requests.push(request.kind);
    input.events.push(`transport:${request.kind}`);
    let body: Uint8Array;
    if (!("bundle" in request)) {
      body = request.kind === "release_key_delegation" ? input.delegationBytes : input.indexBytes;
    } else {
      const selected = servedBundle(input.releases.values(), request.bundle.archiveSha256);
      body = request.kind === "archive" ? selected.archive : input.substitutedManifest ?? selected.manifestBytes;
    }
    await request.sink(body);
    return { kind: request.kind, bodyBytes: String(body.byteLength) as BoundedReleaseResponseV1["bodyBytes"], bodyHash: sha256(body), redirected: false };
  };
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
  /** The installed release's architecture; the index always carries both bundles. */
  readonly architecture?: SyntheticArchitectureV1;
  /** Installs the Codex owner partition in this registration state; the target changes its plugin file. */
  readonly codex?: { readonly registration: CodexRegistrationStateV1 };
}

/** A pinned identity for a `codex` no test ever spawns. */
export const SYNTHETIC_CODEX_EXECUTABLE: CodexExecutableIdentityV1 = {
  canonicalPath: parseCanonicalAbsolutePathText("/synthetic/opt/codex/bin/codex"),
  identity: { dev: parseUInt64Decimal("7"), ino: parseUInt64Decimal("4242"), mode: 493, sha256: sha256("synthetic codex executable") },
};

function syntheticCodexPort(registration: CodexRegistrationStateV1): () => Promise<UpdateCodexV1> {
  return () => Promise.resolve({
    homes: SYNTHETIC_CODEX_HOMES,
    registration,
    policy: codexRefreshPolicy(SYNTHETIC_CODEX_EXECUTABLE),
    projection: { pluginId: parseSafeReasonCode("developer_os"), enabled: true, protocol: CODEX_REFRESH_PROVIDER_PROTOCOL, version: null, source: "managed_plugin_root" },
  });
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

/**
 * §10.2's rollback step template over these retained leaves, derived exactly as `update --apply`
 * derives the `exactStepListHash` it retains; `reorder` swaps two steps for a refusal vector.
 */
export function rollbackTemplateHash(
  retained: Pick<RetainedRollbackEvidenceV1, "owners" | "migrations">,
  reorder = false,
): LowerHexSha256 {
  const owners = retained.owners.map((owner) => ({ id: owner.id, owner: owner.owner, externalEffects: owner.externalEffects.length > 0 ? [{ id: owner.id }] : [] }));
  const steps = [...deriveUpdateSteps({
    operation: "update_rollback",
    owners: owners.map((owner) => ({ id: owner.id })),
    migrations: retained.migrations.map((migration) => ({ id: migration.id })),
  } as unknown as UpdateExecutionPlanV1, owners as never)];
  if (reorder) steps.splice(0, 2, steps[1] as never, steps[0] as never);
  return rollbackStepListHash(steps);
}

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
  const specs = options.releases ?? [{ version: "1.0.0", sequence: "1" }, { version: "1.1.0", sequence: "2" }];
  const releases = new Map(specs.map((spec) => [spec.version, syntheticRelease(spec.version, spec.sequence, spec, options.architecture)]));
  const release = (version: string): SyntheticRelease => releases.get(version) ?? (() => { throw new Error(`fixture has no ${version}`); })();
  const { delegationBytes, indexBytes, offline, releaseKey } = signedReleaseMetadata(
    specs.map((spec) => release(spec.version)),
    options.latestVersion ?? specs[specs.length - 1]?.version ?? "1.1.0",
    options.forgedIndex === true,
  );

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
  const codex = options.codex !== undefined;
  const home: UpdateHomeV1 = {
    manifest: currentManifest(codex),
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
  const serve = syntheticReleaseServer({ delegationBytes, indexBytes, releases, requests, events, ...(options.substitutedManifest === undefined ? {} : { substitutedManifest: options.substitutedManifest }) });

  const attempt = (manifest: ReleaseBundleManifestV1): UpdateScratchAttemptV1 => ({
    download: async (receive) => {
      events.push("scratch.download");
      await receive(() => Promise.resolve());
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
      const rows = fixtureRows(codex);
      const request = plannerRequest(releasesInput, codex);
      const tokenPaths = new Map(rows.map((row, ordinal) => [plannerPathToken(ordinal), row.artifact.path]));
      const inputBlobs = rows.flatMap((row) => (row.bytes === null ? [] : [row.bytes]));
      return Promise.resolve({ request, inputBlobs, tokenPaths, ownerRoots: codex ? { core: SYNTHETIC_HOME, codex: SYNTHETIC_CODEX_HOMES.codexHome } : { core: SYNTHETIC_HOME } });
    },
    planner: {
      run: (run) => {
        events.push("planner");
        if (options.plannerFailure !== undefined) return Promise.reject(options.plannerFailure);
        const draft = plannerDraft(run.request, options.reversedOperations === true);
        const outputs = codex ? [NEW_A, NEW_B, NEW_PLUGIN] : [NEW_A, NEW_B];
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
    ...(options.codex === undefined ? {} : { codex: syntheticCodexPort(options.codex.registration) }),
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

// ---------------------------------------------------------------------------------------------
// The on-disk release world: the same signed metadata, served to a real installed home.
// ---------------------------------------------------------------------------------------------

/** `bin/runtime` execs this Node binary: the verifier supervisor spawns it with an empty environment. */
function runtimeScript(): Uint8Array {
  return encoder.encode(`#!/bin/sh\nexec '${process.execPath}' "$@"\n`);
}

/**
 * A verifier that reads the counted request and echoes the three snapshot digests: the target
 * verifier protocol with no opinion of its own, so only the current process's checks decide.
 */
function verifierScript(): Uint8Array {
  const core = pathToFileURL(createRequire(import.meta.url).resolve("@developer-os/core")).href;
  return encoder.encode([
    "\"use strict\";",
    "(async () => {",
    `  const core = await import(${JSON.stringify(core)});`,
    "  const decoder = new core.PlannerWireDecoder(\"input\", core.PLANNER_WIRE_BOUNDS_V1);",
    "  let request = null;",
    "  for await (const chunk of process.stdin) {",
    "    for (const frame of decoder.push(new Uint8Array(chunk))) {",
    "      if (frame.kind === \"json\") request = core.decodePlannerJson(frame.payload, frame.payload.byteLength);",
    "    }",
    "  }",
    "  const { manifestHash, migrationPostimagesHash, ownerPostimagesHash } = request.snapshot;",
    "  const payload = core.plannerJsonBytes({ manifestHash, migrationPostimagesHash, ownerPostimagesHash });",
    "  const encoder = new core.PlannerWireEncoder(\"output\", core.PLANNER_WIRE_BOUNDS_V1);",
    "  process.stdout.write(Buffer.concat([encoder.magic(), encoder.json(payload), payload, encoder.end()]));",
    "})().catch(() => {",
    "  process.exitCode = 3;",
    "});",
    "",
  ].join("\n"));
}

/** A verifier that disagrees: a clean non-zero exit, which the coordinator compensates (exit 5). */
function rejectingVerifierScript(): Uint8Array {
  return encoder.encode("\"use strict\";\nprocess.stdin.resume();\nprocess.stdin.on(\"end\", () => {\n  process.exitCode = 1;\n});\n");
}

/** Every bundle of the on-disk world carries a runnable runtime and verifier; the rest stay placeholders. */
function runnableBundleFiles(rejecting: boolean): ReadonlyMap<string, Uint8Array> {
  return new Map([["bin/runtime", runtimeScript()], ["bin/verifier", rejecting ? rejectingVerifierScript() : verifierScript()]]);
}

/** Every current row kept byte-identical at the target version; a row the draft grammar cannot express throws. */
function keptManifestRow(row: UpdatePlannerRequestV1["manifest"]["artifacts"][number], version: StableSemverV1): unknown {
  const installed = { kind: "installed", token: row.token };
  const common = { owner: row.owner, path: installed, productVersion: version, source: row.source, mergeStrategy: row.mergeStrategy, kind: row.kind };
  const { verification } = row;
  if (row.kind === "directory") return { ...common, verification: { mode: "content" } };
  if (row.kind === "symlink") return { ...common, verification: { mode: "content", installed } };
  if (row.kind === "file" && verification.mode === "content") return { ...common, verification: { mode: "content", installed } };
  if (row.kind === "file" && verification.mode === "schema") return { ...common, verification: { mode: "schema", schemaId: verification.schemaId, installed } };
  if (row.kind === "file" && verification.mode === "ephemeral") return { ...common, verification: { mode: "ephemeral" } };
  throw new Error(`the synthetic planner has no draft arm for a ${row.kind} row in ${verification.mode} mode`);
}

/**
 * The on-disk world's target planner: every installed owner keeps its whole partition, so the
 * update is the release itself (bundle, metadata, trust, active, rollback payload, verifier).
 */
function keepAllDraft(request: UpdatePlannerRequestV1): TargetUpdateDraftV1 {
  return admitTargetUpdateDraft({
    schemaVersion: 1,
    protocol: request.protocol,
    currentRelease: request.currentRelease,
    targetRelease: request.targetRelease,
    ownerPlans: request.installedOwners.map((owner) => ({
      owner,
      currentArtifacts: request.artifactInputs.filter((input) => input.owner === owner).map((input) => input.token),
      proposedOperations: [],
      externalEffects: [],
    })),
    migrations: [],
    expectedManifest: {
      schemaVersion: 2,
      productVersion: request.targetRelease.version,
      artifacts: request.manifest.artifacts.map((row) => keptManifestRow(row, request.targetRelease.version)),
    },
  }, request).draft;
}

export interface OnDiskReleaseWorldV1 {
  readonly architecture: SyntheticArchitectureV1;
  readonly releases: ReadonlyMap<string, SyntheticRelease>;
  /** Transport request kinds, in order: the only network this world has. */
  readonly requests: string[];
  /** Planner runs, in order: rollback and recovery must never add one. */
  readonly plannerRuns: string[];
  /** Every scratch attempt directory this world ever created, removed or not. */
  readonly scratchDirectories: readonly string[];
  /** The ports an installed home's update context replaces; every other port stays production. */
  readonly ports: Pick<CliUpdateContext, "readOfflineTrust" | "createTransport" | "scratch" | "planner">;
  /** Removes every scratch extraction this world made. */
  readonly cleanup: () => Promise<void>;
}

/**
 * A signed release index over `releases` for an installed home of `architecture`: fresh Ed25519
 * keys, a recording transport, a scratch that extracts the selected bundle's exact files into a
 * private temporary directory, and a planner that keeps every owner's partition.
 */
export function createOnDiskReleaseWorld(options: {
  readonly architecture: SyntheticArchitectureV1;
  readonly releases: readonly { readonly version: string; readonly sequence: string }[];
  readonly latestVersion?: string;
  /** Releases whose verifier rejects every update to them. */
  readonly rejectingVersions?: readonly string[];
}): OnDiskReleaseWorldV1 {
  const files = (version: string) => () => runnableBundleFiles(options.rejectingVersions?.includes(version) === true);
  const releases = new Map(options.releases.map((spec) => [spec.version, syntheticRelease(spec.version, spec.sequence, { files: files(spec.version) }, options.architecture)]));
  const { delegationBytes, indexBytes, offline } = signedReleaseMetadata([...releases.values()], options.latestVersion ?? options.releases[options.releases.length - 1]?.version ?? "1.1.0", false);
  const requests: string[] = [];
  const plannerRuns: string[] = [];
  const directories: string[] = [];
  const created: string[] = [];
  const serve = syntheticReleaseServer({ delegationBytes, indexBytes, releases, requests, events: [] });

  const attempt = (): UpdateScratchAttemptV1 => {
    let directory: string | null = null;
    return {
      download: async (receive) => {
        await receive(() => Promise.resolve());
      },
      extract: async (bundle) => {
        const selected = servedBundle(releases.values(), bundle.archiveSha256);
        directory = await realpath(await mkdtemp(join(tmpdir(), "developer-os-release-planning-")));
        directories.push(directory);
        created.push(directory);
        const root = join(directory, "extracted");
        await mkdir(join(root, "bin"), { recursive: true, mode: 0o700 });
        for (const [path, bytes] of selected.files) await writeFile(join(root, path), bytes, { mode: 0o700 });
        return {
          id: `rp_${randomUUID()}`,
          planHash: sha256("synthetic scratch plan"),
          manifestHash: bundle.manifestSha256,
          root: parseCanonicalAbsolutePathText(root),
          entries: selected.manifest.entries.length,
        };
      },
      cleanup: async () => {
        if (directory !== null) await rm(directory, { recursive: true, force: true });
      },
    };
  };

  return {
    architecture: options.architecture,
    releases,
    requests,
    plannerRuns,
    scratchDirectories: created,
    ports: {
      readOfflineTrust: () => Promise.resolve(offline),
      createTransport: () => ({ get: serve, remainingMilliseconds: () => 600_000 }),
      scratch: {
        create: () => Promise.resolve(attempt()),
        listRecoverableAttempts: () => Promise.resolve([]),
        recoverCleanup: () => Promise.resolve(),
      },
      planner: {
        run: (run) => {
          plannerRuns.push(run.request.targetRelease.version);
          const draft = keepAllDraft(run.request);
          return Promise.resolve({
            draft,
            outputBlobs: [],
            transcript: {
              protocol: PLANNER_PROTOCOL_V1,
              bounds: PLANNER_WIRE_BOUNDS_V1,
              requestHash: plannerJsonHash("input", plannerJsonBytes(run.request)),
              inputBlobsHash: plannerBlobSetHash("input", run.inputBlobs),
              resultHash: plannerJsonHash("output", plannerJsonBytes(draft)),
              outputBlobsHash: plannerBlobSetHash("output", []),
            },
          });
        },
      },
    },
    cleanup: async () => {
      for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
    },
  };
}

/**
 * An installed home's production update context with only the release world's ports replaced,
 * and `--apply` bound to the real ports with `fallback` as the launcher's handoff (D72 P7(d)).
 */
export function onDiskUpdateContext(context: CliContext, world: OnDiskReleaseWorldV1, fallback: UpdateFallbackHandoffV1): CliUpdateContext {
  return { ...createCliUpdateContext(context), ...world.ports, apply: productionUpdateApplyPorts(context, () => fallback) };
}

export interface UpdatableHomeV1 {
  readonly fixture: CommandFixture;
  readonly world: OnDiskReleaseWorldV1;
  /** The packaged release `init` installed. */
  readonly installed: ReleaseIdentityV1;
  readonly fallback: UpdateFallbackHandoffV1;
  /** A fresh process's update context over this home; `context` swaps the CLI context, e.g. a dying one. */
  readonly update: (context?: CliContext) => CliUpdateContext;
}

export const ON_DISK_RELEASES = [{ version: "1.1.0", sequence: "2" }, { version: "1.2.0", sequence: "3" }] as const;

/** A real `init` from the packaged release of `architecture`, a Brain, and a signed world above it. */
export async function installUpdatableHome(label: string, architecture: SyntheticArchitectureV1, options: { readonly rejectingVersions?: readonly string[] } = {}): Promise<UpdatableHomeV1> {
  const fixture = await createCommandFixture(label, { bootstrapAvailable: true, architecture });
  await mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  const initialized = await runInit(fixture.context, { dryRun: false, assumeYes: true });
  if (!initialized.ok) throw new Error(`fixture init failed: ${JSON.stringify(initialized)}`);
  const world = createOnDiskReleaseWorld({ architecture, releases: ON_DISK_RELEASES, ...options });
  const installed = releaseIdentityOf((await createCliUpdateContext(fixture.context).readHome()).active);
  const fallback = packagedFallback(installed);
  return { fixture, world, installed, fallback, update: (context = fixture.context) => onDiskUpdateContext(context, world, fallback) };
}

/** Preview then apply `version` in one invocation, as `update --apply` does. */
export async function updateTo(update: CliUpdateContext, version: string): Promise<UpdateApplyResultV1> {
  const prepared = await prepareUpdate(update, { version: parseStableSemver(version) });
  if (prepared.apply === null) throw new Error(`no update to ${version} was prepared`);
  return applyUpdate(update, prepared.apply);
}

export class SyntheticDeathError extends Error {
  constructor() {
    super("synthetic process death");
    this.name = "SyntheticDeathError";
  }
}

export interface DyingContextV1 {
  readonly context: CliContext;
  /** True once the chosen mutation landed and the process model died. */
  readonly died: () => boolean;
  /** Durable mutations landed so far; with an unreachable `count` it measures a whole run. */
  readonly landed: () => number;
}

const DURABLE_MUTATIONS = ["writeExclusive", "mkdirExclusive", "renameOver", "renameNoReplace", "unlinkExact", "rmdirExactEmpty", "syncDirectory"] as const;

/**
 * The same CLI context whose guarded filesystem dies after its `count`-th durable mutation: that
 * mutation lands, it and every later one throw, as a killed process leaves the disk. Every outer
 * and nested cursor of the update is a guarded mutation, so sweeping `count` reaches all of them.
 */
export function dieAfterMutations(context: CliContext, count: number): DyingContextV1 {
  const lifecycle = context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture has no lifecycle ports");
  let landed = 0;
  const fs: Record<string, unknown> = { ...lifecycle.fs };
  for (const name of DURABLE_MUTATIONS) {
    const real = lifecycle.fs[name].bind(lifecycle.fs) as (...args: readonly unknown[]) => Promise<unknown>;
    fs[name] = async (...args: readonly unknown[]): Promise<unknown> => {
      if (landed >= count) throw new SyntheticDeathError();
      const result = await real(...args);
      landed += 1;
      if (landed === count) throw new SyntheticDeathError();
      return result;
    };
  }
  return {
    context: { ...context, lifecycle: { ...lifecycle, fs: fs as unknown as typeof lifecycle.fs } },
    died: () => landed >= count,
    landed: () => landed,
  };
}

/** The handoff Task 11b's launcher will supply: the packaged release `init` installed, read from its fresh active record. */
export function packagedFallback(installed: ReleaseIdentityV1): UpdateFallbackHandoffV1 {
  return { bundleManifestHash: parseLowerHexSha256(installed.bundleManifestHash), launcherProtocol: parsePositiveUInt32(installed.launcherProtocol), updateProtocol: parsePositiveUInt32(installed.updateProtocol) };
}

export const SYNTHETIC_COORDINATOR_ID =`lc_${"c".repeat(64)}_5` as LifecycleCoordinatorIdV1;

export interface SyntheticUpdateCoordinatorV1 {
  readonly execution: UpdateExecutionPlanV1;
  readonly plan: UpdateLifecycleCoordinatorPlanV2;
  readonly owners: readonly UpdateStepOwnerV1[];
  readonly fallback: UpdateFallbackHandoffV1;
  readonly current: ReleaseIdentityV1;
  readonly target: ReleaseIdentityV1;
}

function syntheticCoordinatorRelease(home: CanonicalAbsolutePathV1, version: string, sequence: string, architecture: SyntheticArchitectureV1): ReleaseIdentityV1 {
  const suffix = architecture === "arm64" ? "" : `-${architecture}`;
  return validateReleaseIdentity({
    version,
    releaseSequence: sequence,
    releaseIdentityHash: sha256(`identity-${version}${suffix}`),
    delegationSequence: "1",
    delegationHash: sha256("delegation"),
    releaseIndexSequence: sequence,
    releaseIndexHash: sha256(`index-${version}`),
    bundleManifestHash: sha256(`manifest-${version}${suffix}`),
    bundleRoot: `${home}/releases/${version}/darwin-${architecture}`,
    platform: "darwin",
    architecture,
    launcherProtocol: 1,
    updateProtocol: 1,
  }, SYNTHETIC_EVIDENCE);
}

/**
 * A complete synthetic V2 coordinator under `home`: an execution leaf with two owners, one Codex
 * effect, two migrations, both recovery records, and the one outer plan derived from them.
 */
export function syntheticUpdateCoordinator(
  home: CanonicalAbsolutePathV1,
  operation: UpdateOperationV1 = "update_apply",
  fallbackManifestHash: LowerHexSha256 = sha256("fallback-manifest"),
  architecture: SyntheticArchitectureV1 = "arm64",
): SyntheticUpdateCoordinatorV1 {
  const id = SYNTHETIC_COORDINATOR_ID;
  const nonce = "c".repeat(64);
  const root = updateCoordinatorStagingRoot(home, id);
  const ref = <TKind extends UpdateLeafPlanKindV1>(kind: TKind, leaf: string): ImmutableUpdatePlanRefV1<TKind> =>
    ({ kind, id: leaf, path: updateLeafPlanPath(root, kind, leaf), hash: sha256(`${kind}/${leaf}`), bytes: 128 }) as ImmutableUpdatePlanRefV1<TKind>;
  const current = syntheticCoordinatorRelease(home, "1.0.0", "1", architecture);
  const target = syntheticCoordinatorRelease(home, "1.1.0", "2", architecture);
  const fallback: UpdateFallbackHandoffV1 = { bundleManifestHash: parseLowerHexSha256(fallbackManifestHash), launcherProtocol: parsePositiveUInt32(1), updateProtocol: parsePositiveUInt32(1) };
  const executionBindingHash = updateExecutionBindingHash({ coordinatorId: id, operation, previewHash: sha256("preview"), current, target });
  const common = { schemaVersion: 1, coordinatorId: id, operation, executionBindingHash, createdAt: PLANNED_AT } as const;
  const initial: UpdateRecoveryExecutorRecordV1 = { ...common, state: "executing", executor: { kind: "release_bundle", release: current } };
  const terminal: UpdateRecoveryExecutorRecordV1 = { ...common, state: "terminal_cleanup", executor: { kind: "package_fallback", ...fallback } };
  const staged = (record: UpdateRecoveryExecutorRecordV1, ordinal: number) => ({
    constructionOrdinal: ordinal,
    path: updateRecoveryExecutorStagedPath(root, record.state) as UpdateExecutionPlanV1["recoveryExecutor"]["initialStaged"]["path"],
    bytes: updateRecoveryExecutorRecordBytes(record).byteLength,
    hash: updateRecoveryExecutorRecordHash(record),
    mode: 384 as const,
  });
  const owners: readonly UpdateStepOwnerV1[] = [
    { id: ref("owner_update", "owner_core").id, owner: "core", externalEffects: [] },
    { id: ref("owner_update", "owner_codex").id, owner: "codex", externalEffects: [{ id: ref("owner_external_effect", `oe_${nonce}_9`).id }] },
  ];
  const execution: UpdateExecutionPlanV1 = {
    schemaVersion: 1,
    coordinatorId: id,
    operation,
    previewHash: sha256("preview"),
    executionBindingHash,
    maximumPlanBytes: 16_777_216,
    current,
    target,
    metadata: { delegationSequence: current.delegationSequence, delegationHash: current.delegationHash, delegatedReleaseKeyId: sha256("release-key"), releaseIndexSequence: target.releaseIndexSequence, releaseIndexHash: target.releaseIndexHash },
    planner: operation === "update_apply" ? { protocol: PLANNER_PROTOCOL_V1, bounds: PLANNER_WIRE_BOUNDS_V1, requestHash: sha256("request"), inputBlobsHash: sha256("input-blobs"), resultHash: sha256("result"), outputBlobsHash: sha256("output-blobs") } : null,
    bundle: ref("bundle_publication", "bundle"),
    owners: [ref("owner_update", "owner_core"), ref("owner_update", "owner_codex")],
    migrations: [ref("schema_migration", "migration_product-v2"), ref("schema_migration", "migration_brain-v2")],
    manifest: { transitional: ref("manifest_state", `mf_${nonce}_6`), terminal: ref("manifest_state", `mf_${nonce}_7`) },
    trust: operation === "update_apply" ? ref("release_trust_state", "trust") : null,
    active: ref("active_release_state", "active"),
    rollback: ref("rollback_record_state", "rollback_record"),
    rollbackPayload: ref("rollback_payload_state", "rollback_payload"),
    initialParticipantJournals: [{
      kind: "bundle_publication",
      id: ref("bundle_publication", "bundle").id,
      planHash: sha256("bundle_publication/bundle"),
      finalPath: parseCanonicalAbsolutePathText(`${root}/update/journals/bundle_publication/bundle.json`),
      stagedPath: parseCanonicalAbsolutePathText(`${root}/update/initial-journals/bundle_publication/bundle.json`),
      stagedExpected: { constructionOrdinal: 9, hash: sha256("initial-journal"), bytes: 256, mode: 384 },
    }],
    recoveryExecutor: { finalPath: deriveUpdateExecutorRecordPath(home), initial, initialStaged: staged(initial, 10), terminal, terminalStaged: staged(terminal, 11), maximumRecordBytes: 16_384 },
    verification: ref("target_verification", "verification"),
    retirement: ref("terminal_retirement", "retirement"),
  };
  const plan = buildUpdateCoordinatorPlan({
    execution,
    executionRef: ref("update_execution", "execution"),
    construction: { path: updateConstructionEnvelopePaths(root).plan, hash: sha256("construction"), bytes: 4096 },
    owners,
    retainPayloadId: operation === "update_apply" ? parseRollbackPayloadId(`rb_${nonce}_8`) : null,
  });
  return { execution, plan, owners, fallback, current, target };
}
