import { createHash } from "node:crypto";
import { appendFileSync, existsSync } from "node:fs";
import { mkdir, realpath, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";

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
  PACKAGE_CHANNEL_DELEGATION_BYTES,
  PACKAGE_CHANNEL_LAYOUT,
  PACKAGE_CHANNEL_RELEASE_KEY_ID,
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
  validateBundleManifest,
  validateReleaseIndex,
  validateReleaseTrustState,
  validateUpdatePlannerRequest,
  MAXIMUM_RECOVERY_EXECUTOR_BYTES,
  rollbackBindingHash,
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
  CanonicalJsonValue,
  CanonicalPathEvidenceV1,
  InstallationManifestV2,
  LowerHexSha256,
  ManagedArtifactV2,
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
import { planKeepAllRelease } from "@developer-os/core/planner-protocol";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";

import { runInit } from "../commands/init.js";
import { createCommandFixture, repositoryWorkflowFiles, runnableBundleFiles } from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import type { CliContext } from "../context.js";
import { productionUpdateApplyPorts } from "./apply-ports.js";
import { applyUpdate } from "./apply.js";
import type { UpdateApplyResultV1 } from "./apply.js";
import { prepareUpdate, releaseIdentityOf } from "./planning.js";
import { createCliUpdateContext, packageSourcePorts, readPackageChannelSource } from "./context.js";
import type { CliUpdateContext, UpdateCodexV1 } from "./context.js";
import { writePackageChannelRelease } from "./local-release.js";
import type { AdmittedPackagedReleaseV1 } from "./packaged-release.js";
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

export type SyntheticArchitectureV1 = "arm64" | "x64";

/** The index lists both bundles in this order; `selectRelease` takes ordinal 0 for arm64 and 1 for x64. */
export const SYNTHETIC_ARCHITECTURES: readonly SyntheticArchitectureV1[] = ["arm64", "x64"];

export interface SyntheticBundleV1 {
  readonly manifest: ReleaseBundleManifestV1;
  readonly manifestBytes: Uint8Array;
  readonly manifestHash: LowerHexSha256;
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
  /** Adds `0600` files beside `BUNDLE_FILES`, e.g. `instructions/` and `workflows/`; their parents become directory entries. */
  readonly extraFiles?: (architecture: SyntheticArchitectureV1) => ReadonlyMap<string, Uint8Array>;
}

const BUNDLE_FILES: readonly string[] = ["bin/cli", "bin/planner", "bin/runtime", "bin/verifier"];

function syntheticBundle(version: string, sequence: string, architecture: SyntheticArchitectureV1, options: SyntheticReleaseOptionsV1): SyntheticBundleV1 {
  const replaced = options.files?.(architecture);
  const files = new Map(BUNDLE_FILES.map((path) => [path, replaced?.get(path) ?? encoder.encode(`synthetic ${version} ${architecture} ${path}\n`)]));
  const extra = options.extraFiles?.(architecture) ?? new Map<string, Uint8Array>();
  for (const [path, bytes] of extra) files.set(path, bytes);
  const directories = new Set(["bin"]);
  for (const path of extra.keys()) {
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) directories.add(parts.slice(0, depth).join("/"));
  }
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
      ...[...directories].map((path) => ({ path, kind: "directory", mode: 448 })),
      ...[...files].map(([path, bytes]) => ({ path, kind: "file", mode: extra.has(path) ? 384 : 448, bytes: String(bytes.byteLength), sha256: sha256(bytes) })),
    ].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))),
  });
  const manifestBytes = bytesOf(manifest);
  return { manifest, manifestBytes, manifestHash: sha256(manifestBytes), archive: encoder.encode(`synthetic ${version} ${architecture} archive bytes\n`), files };
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

/**
 * The keg's one-row release index (D84 K2): its sequence is the release's, so `releaseSequence`
 * and `releaseIndexSequence` both increase across published releases.
 */
function kegIndexBytes(release: SyntheticRelease): Uint8Array {
  return bytesOf(validateReleaseIndex({ sequence: release.sequence, latestVersion: release.version, releases: [release.entry] }));
}

/** The identity a package-channel install of `release` records: the delegation stand-in at sequence 0, the keg's own index. */
function identityOf(release: SyntheticRelease, home: CanonicalAbsolutePathV1 = SYNTHETIC_HOME): ReleaseIdentityV1 {
  return {
    version: release.version,
    releaseSequence: release.sequence,
    releaseIdentityHash: releaseIdentityHash(release.entry, release.architecture),
    delegationSequence: "0",
    delegationHash: sha256(PACKAGE_CHANNEL_DELEGATION_BYTES),
    releaseIndexSequence: release.sequence,
    releaseIndexHash: sha256(kegIndexBytes(release)),
    bundleManifestHash: release.manifestHash,
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
/** The Brain note the optional schema migration rewrites (NEW-192), relative to the Brain root. */
export const NOTE_PATH = "notes/a.md";
export const OLD_NOTE = encoder.encode("---\nschema: 1\n---\nnote\n");
export const NEW_NOTE = encoder.encode("---\nschema: 2\n---\nnote\n");
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

function currentManifest(codex = false, extra: readonly ManagedArtifactV2[] = []): InstallationManifestV2 {
  const artifacts = [...fixtureRows(codex).map((row) => row.artifact), ...extra].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  return { schemaVersion: 2, productVersion: parseStableSemver("1.0.0"), installedAt: INSTALLED_AT, artifacts } as unknown as InstallationManifestV2;
}

function plannerRequest(releases: { readonly current: ReleaseIdentityV1; readonly target: ReleaseIdentityV1; readonly plannedAt: UtcTimestampV1 }, codex = false, migration = false): UpdatePlannerRequestV1 {
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
    brain: migration
      ? { schemaVersion: 1, root: "brain_root", folderPolicyVersion: 1, entries: [{ path: NOTE_PATH, mode: 384, bytes: OLD_NOTE.byteLength, sha256: sha256(OLD_NOTE), blob: { stream: "input", ordinal: blobs, bytes: OLD_NOTE.byteLength, sha256: sha256(OLD_NOTE) } }], aggregateBytes: OLD_NOTE.byteLength }
      : { schemaVersion: 1, root: "brain_root", folderPolicyVersion: 1, entries: [], aggregateBytes: 0 },
  });
}

/**
 * Replaces both schema files with two output blobs; `reversed` lists the operations b-then-a. With
 * a Codex owner it also replaces the plugin file (a third blob) and drafts the one closed refresh.
 */
function plannerDraft(request: UpdatePlannerRequestV1, reversed: boolean): TargetUpdateDraftV1 {
  const note = request.brain.entries[0];
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
    // The note's new bytes, then its inverse (the exact before bytes), after every owner output.
    migrations: note === undefined
      ? []
      : [{
          id: "migration_notes-v2",
          domain: "brain",
          fromVersion: 1,
          toVersion: 2,
          mutations: [{
            path: { domain: "brain", path: note.path },
            beforeHash: note.sha256,
            afterBlob: { stream: "output", ordinal: codex ? 3 : 2, bytes: NEW_NOTE.byteLength },
            inverseBlob: { stream: "output", ordinal: codex ? 4 : 3, bytes: OLD_NOTE.byteLength },
          }],
        }],
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

export interface UpdateFixtureOptions {
  /** The index's releases; the first is the active one unless `active` names another. */
  readonly releases?: readonly { readonly version: string; readonly sequence: string; readonly minimumLauncherProtocol?: number; readonly updateProtocol?: number }[];
  readonly latestVersion?: string;
  readonly active?: string;
  /** The installed keg's version (D84 K2); absent, the latest release. A version the releases lack is synthesized. */
  readonly kegVersion?: string;
  /** The synthesized keg's release sequence; absent, `"1"`. */
  readonly kegSequence?: string;
  /** The keg is `kegVersion` rebuilt with other bytes: same version, another bundle manifest. */
  readonly rebuilt?: boolean;
  /** No keg at the table's path: `readPackageSource` refuses `update_package_source_absent`. */
  readonly kegAbsent?: boolean;
  /** The keg retains these bytes in place of its bundle manifest. */
  readonly substitutedManifest?: Uint8Array;
  /** The keg retains these bytes in place of its delegation stand-in. */
  readonly substitutedDelegation?: Uint8Array;
  readonly trustSequence?: string;
  readonly reversedOperations?: boolean;
  readonly capacity?: UpdateCapacityObservationV1;
  readonly plannerFailure?: Error;
  /** A retained rollback set: `active` then names the installed release and this the previous one. */
  readonly rollbackPrevious?: string;
  readonly rollbackEvidenceFailure?: Error;
  /** The installed release's architecture; the index always carries both bundles. */
  readonly architecture?: SyntheticArchitectureV1;
  /** Installs the Codex owner partition in this registration state; the target changes its plugin file. */
  readonly codex?: { readonly registration: CodexRegistrationStateV1 };
  /** Adds one Brain note to the snapshot and drafts one Brain schema migration over it (NEW-192). */
  readonly migration?: boolean;
  /** Installed rows the planner snapshot never carries (an attached instruction); NEW-171. */
  readonly manifestRows?: readonly ManagedArtifactV2[];
}

/** An attached instruction row: it lives in the manifest but never in a planner request (NEW-171). */
export function syntheticInstructionRow(): ManagedArtifactV2 {
  return {
    owner: "claude",
    path: parseCanonicalAbsolutePathText("/synthetic/user/.claude/skills/code-review/SKILL.md"),
    kind: "instruction",
    productVersion: "1.0.0",
    source: "skills/code-review/SKILL.md",
    mergeStrategy: "dedicated",
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    verifiedAt: INSTALLED_AT,
    instruction: { category: "skill", id: "code-review", source: "default" },
    verification: { mode: "content", installedHash: sha256(encoder.encode("synthetic skill")) },
  } as unknown as ManagedArtifactV2;
}

/** A pinned identity for a `codex` no test ever spawns. */
export const SYNTHETIC_CODEX_EXECUTABLE: CodexExecutableIdentityV1 = {
  canonicalPath: parseCanonicalAbsolutePathText("/synthetic/opt/codex/bin/codex"),
  identity: { dev: parseUInt64Decimal("7"), ino: parseUInt64Decimal("4242"), mode: 493, sha256: sha256("synthetic codex executable") },
};

/** The registered Codex plugin's current projection, as the synthetic port reports it. */
export const SYNTHETIC_CODEX_PROJECTION: UpdateCodexV1["projection"] = { pluginId: parseSafeReasonCode("developer_os"), enabled: true, protocol: CODEX_REFRESH_PROVIDER_PROTOCOL, version: null, source: "managed_plugin_root" };

function syntheticCodexPort(registration: CodexRegistrationStateV1): () => Promise<UpdateCodexV1> {
  return () => Promise.resolve({
    homes: SYNTHETIC_CODEX_HOMES,
    registration,
    policy: codexRefreshPolicy(SYNTHETIC_CODEX_EXECUTABLE),
    projection: SYNTHETIC_CODEX_PROJECTION,
  });
}

export interface UpdateFixture {
  readonly update: CliUpdateContext;
  readonly home: UpdateHomeV1;
  /** Ordered port calls: the observable sequence every ordering test reads. */
  readonly events: string[];
  /** The canonical keg path `readPackageSource` admits, as the preview's `packageSource` names it. */
  readonly kegPath: CanonicalAbsolutePathV1;
  /** Every request the snapshot port produced for the planner. */
  readonly plannerRequests: UpdatePlannerRequestV1[];
  readonly current: ReleaseIdentityV1;
  readonly releases: ReadonlyMap<string, SyntheticRelease>;
  /** The Codex projection the synthetic port reports (the current, pre-update state). */
  readonly codexProjection: UpdateCodexV1["projection"];
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

/** The table a missing keg resolves through: nothing exists under it (D84 K2, exit 4). */
const ABSENT_PACKAGE_TABLE = {
  arm64: { prefix: parseCanonicalAbsolutePathText("/synthetic/absent-prefix"), opt: parseCanonicalAbsolutePathText("/synthetic/absent-prefix/opt/developer-os"), fallback: "libexec/fallback" },
  x64: { prefix: parseCanonicalAbsolutePathText("/synthetic/absent-prefix"), opt: parseCanonicalAbsolutePathText("/synthetic/absent-prefix/opt/developer-os"), fallback: "libexec/fallback" },
} as const;

/**
 * The admitted keg as `inspectPackagedRelease` hands it over, served from memory: the unsigned
 * delegation stand-in, the one-row index and the bundle manifest, with no Ed25519 anywhere.
 */
function syntheticKeg(release: SyntheticRelease, kegPath: CanonicalAbsolutePathV1, substitutes: { readonly delegation?: Uint8Array; readonly manifest?: Uint8Array }): AdmittedPackagedReleaseV1 {
  const layout = PACKAGE_CHANNEL_LAYOUT;
  const delegation = substitutes.delegation ?? PACKAGE_CHANNEL_DELEGATION_BYTES;
  const index = kegIndexBytes(release);
  const manifest = substitutes.manifest ?? release.manifestBytes;
  const documents = new Map<string, Uint8Array>([[layout.delegation, delegation], [layout.releaseIndex, index], [layout.bundleManifest, manifest]]);
  return {
    trust: "package-channel",
    packageRoot: `${kegPath}/libexec/fallback`,
    packageRootDev: "7",
    packageRootIno: "4243",
    packageInventoryHash: sha256(`synthetic keg ${release.version} ${release.architecture}`),
    retainedMetadata: { delegation: layout.delegation, releaseIndex: layout.releaseIndex, bundleManifest: layout.bundleManifest },
    bundleRoot: layout.bundleRoot,
    identity: {
      version: release.version,
      releaseSequence: release.sequence,
      releaseIdentityHash: releaseIdentityHash(release.entry, release.architecture),
      delegationSequence: "0",
      delegationHash: sha256(delegation),
      delegatedReleaseKeyId: PACKAGE_CHANNEL_RELEASE_KEY_ID,
      releaseIndexSequence: release.sequence,
      releaseIndexHash: sha256(index),
      bundleManifestHash: sha256(manifest),
      platform: "darwin",
      architecture: release.architecture,
      launcherProtocol: release.manifest.launcherProtocol,
      updateProtocol: release.manifest.updateProtocol,
    },
    files: [],
    readFile: (relativePath) => {
      const bytes = documents.get(relativePath);
      return bytes === undefined ? Promise.reject(new Error("synthetic keg read escaped its documents")) : Promise.resolve(bytes);
    },
  };
}

/**
 * A complete synthetic update world behind `CliUpdateContext`: a package-channel home, one keg
 * served from memory, and a planner answering with a real admitted draft and a transcript that
 * hashes exactly what it returns. No port reaches a network (D84 K1).
 */
export function createUpdateFixture(options: UpdateFixtureOptions = {}): UpdateFixture {
  const specs = options.releases ?? [{ version: "1.0.0", sequence: "1" }, { version: "1.1.0", sequence: "2" }];
  const releases = new Map(specs.map((spec) => [spec.version, syntheticRelease(spec.version, spec.sequence, spec, options.architecture)]));
  const release = (version: string): SyntheticRelease => releases.get(version) ?? (() => { throw new Error(`fixture has no ${version}`); })();
  const kegVersion = options.kegVersion ?? options.latestVersion ?? specs[specs.length - 1]?.version ?? "1.1.0";
  const kegRelease = options.rebuilt === true || !releases.has(kegVersion)
    ? syntheticRelease(kegVersion, options.kegSequence ?? releases.get(kegVersion)?.sequence ?? "1", options.rebuilt === true ? { files: () => new Map([["bin/cli", encoder.encode(`rebuilt ${kegVersion}\n`)]]) } : {}, options.architecture)
    : release(kegVersion);
  const kegPath = parseCanonicalAbsolutePathText(`/synthetic/opt/homebrew/Cellar/developer-os/${kegVersion}`);
  const keg = syntheticKeg(kegRelease, kegPath, {
    ...(options.substitutedDelegation === undefined ? {} : { delegation: options.substitutedDelegation }),
    ...(options.substitutedManifest === undefined ? {} : { manifest: options.substitutedManifest }),
  });

  const activeRelease = release(options.active ?? specs[0]?.version ?? "1.0.0");
  const current = identityOf(activeRelease);
  const active: ActiveReleaseRecordV1 = { schemaVersion: 1, ...current, activatedAt: INSTALLED_AT };
  const rollbackPrevious = options.rollbackPrevious === undefined ? null : identityOf(release(options.rollbackPrevious));
  const rollbackPayloadId = `rb_${sha256("synthetic nonce")}_7` as RollbackPayloadIdV1;
  const rollback: RollbackRecordV1 | null = rollbackPrevious === null
    ? null
    : {
        schemaVersion: 1,
        installed: current,
        previous: rollbackPrevious,
        executionBindingHash: sha256("synthetic execution binding"),
        rollbackBindingHash: rollbackBindingHash({ executionBindingHash: sha256("synthetic execution binding"), payloadId: rollbackPayloadId, installedReleaseIdentityHash: current.releaseIdentityHash, previousReleaseIdentityHash: rollbackPrevious.releaseIdentityHash }),
        payloadId: rollbackPayloadId,
        payloadInventoryHash: sha256("synthetic inventory"),
        inversePlanHash: sha256("synthetic inverse plan"),
        createdAt: INSTALLED_AT,
      };
  const trustSequence = options.trustSequence ?? current.releaseSequence;
  const codex = options.codex !== undefined;
  const migration = options.migration === true;
  const home: UpdateHomeV1 = {
    manifest: currentManifest(codex, options.manifestRows),
    active,
    trust: validateReleaseTrustState({
      schemaVersion: 1,
      highestDelegationSequence: current.delegationSequence,
      delegationHash: current.delegationHash,
      delegatedReleaseKeyId: PACKAGE_CHANNEL_RELEASE_KEY_ID,
      highestReleaseIndexSequence: options.trustSequence ?? current.releaseIndexSequence,
      releaseIndexHash: current.releaseIndexHash,
      highestAcceptedReleaseSequence: trustSequence,
      releaseIdentityHash: current.releaseIdentityHash,
      trust: "package-channel",
    }),
    rollback,
  };

  const events: string[] = [];
  const plannerRequests: UpdatePlannerRequestV1[] = [];

  const update: CliUpdateContext = {
    productHome: SYNTHETIC_HOME,
    pathEvidence: SYNTHETIC_EVIDENCE,
    clock: () => PLANNED_AT,
    readHome: () => {
      events.push("home");
      return Promise.resolve(home);
    },
    readPackageSource: () => {
      events.push("package_source");
      return options.kegAbsent === true ? readPackageChannelSource("arm64", ABSENT_PACKAGE_TABLE) : Promise.resolve(keg);
    },
    snapshot: (_home, releasesInput) => {
      events.push("snapshot");
      const rows = fixtureRows(codex);
      const request = plannerRequest(releasesInput, codex, migration);
      plannerRequests.push(request);
      const tokenPaths = new Map(rows.map((row, ordinal) => [plannerPathToken(ordinal), row.artifact.path]));
      const inputBlobs = [...rows.flatMap((row) => (row.bytes === null ? [] : [row.bytes])), ...(migration ? [OLD_NOTE] : [])];
      return Promise.resolve({ request, inputBlobs, tokenPaths, ownerRoots: codex ? { core: SYNTHETIC_HOME, codex: SYNTHETIC_CODEX_HOMES.codexHome } : { core: SYNTHETIC_HOME } });
    },
    planner: {
      run: (run) => {
        events.push("planner");
        if (options.plannerFailure !== undefined) return Promise.reject(options.plannerFailure);
        const draft = plannerDraft(run.request, options.reversedOperations === true);
        const outputs = [NEW_A, NEW_B, ...(codex ? [NEW_PLUGIN] : []), ...(migration ? [NEW_NOTE, OLD_NOTE] : [])];
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
  return { update, home, events, kegPath, plannerRequests, current, releases, codexProjection: SYNTHETIC_CODEX_PROJECTION };
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
    readPackageSource: never,
    snapshot: never,
    planner: { run: never },
    readRollbackEvidence: never,
    capacity: never,
    admitManifest: never,
  };
}

// ---------------------------------------------------------------------------------------------
// The on-disk release world: real kegs under a fixture prefix behind the fixed-path seam (K6).
// ---------------------------------------------------------------------------------------------

export interface OnDiskReleaseWorldV1 {
  readonly architecture: SyntheticArchitectureV1;
  readonly releases: ReadonlyMap<string, SyntheticRelease>;
  /** The fixture's Homebrew prefix: `Cellar/developer-os/<version>` kegs and the `opt/developer-os` link. */
  readonly prefix: string;
  /** One entry per keg read (`readPackageSource`): the whole update source; rollback and recovery never add one. */
  readonly requests: string[];
  /** Planner runs, in order: rollback and recovery must never add one. */
  readonly plannerRuns: string[];
  /** `brew upgrade`: repoints `<prefix>/opt/developer-os` at `version`'s keg. */
  readonly install: (version: string) => Promise<void>;
  /** The ports an installed home's update context replaces; every other port stays production. */
  readonly ports: Pick<CliUpdateContext, "readPackageSource" | "planner">;
}

/**
 * Real kegs for `releases` under `prefix`, written as a formula installs them and admitted with
 * the production admission through a fixture table over that prefix: the fixed-path seam of K6.
 * The `opt` link starts at the first release, as if `brew upgrade` had just landed it; the
 * planner keeps every owner's partition.
 */
export async function createOnDiskReleaseWorld(options: {
  readonly architecture: SyntheticArchitectureV1;
  readonly prefix: string;
  readonly releases: readonly { readonly version: string; readonly sequence: string }[];
  /** Releases whose verifier rejects every update to them. */
  readonly rejectingVersions?: readonly string[];
  /** Every release also carries `workflows/` and `instructions/` (`releaseTree`), so a refresh renders from it. */
  readonly instructions?: boolean;
}): Promise<OnDiskReleaseWorldV1> {
  const files = (version: string) => () => runnableBundleFiles(options.rejectingVersions?.includes(version) === true);
  const tree = options.instructions === true ? await releaseTree() : null;
  const releases = new Map(options.releases.map((spec) => [spec.version, syntheticRelease(spec.version, spec.sequence, { files: files(spec.version), ...(tree === null ? {} : { extraFiles: () => tree(spec.version) }) }, options.architecture)]));
  const prefix = await realpath(options.prefix);
  for (const release of releases.values()) {
    const libexec = join(prefix, "Cellar", "developer-os", release.version, "libexec");
    await mkdir(libexec, { recursive: true, mode: 0o755 });
    await writePackageChannelRelease({
      outDir: join(libexec, "fallback"),
      index: { sequence: release.sequence, latestVersion: release.version, releases: [release.entry] } as unknown as CanonicalJsonValue,
      manifest: release.manifest,
      bundleFiles: [...release.files].map(([relativePath, bytes]) => ({ relativePath, bytes, mode: release.manifest.entries.some((entry) => entry.path === relativePath && entry.mode === 448) ? 0o700 : 0o600 })),
    });
  }
  const link = join(prefix, "opt", "developer-os");
  await mkdir(join(prefix, "opt"), { recursive: true, mode: 0o755 });
  const install = async (version: string): Promise<void> => {
    if (!releases.has(version)) throw new Error(`the world has no ${version} keg`);
    await rm(link, { force: true });
    await symlink(`../Cellar/developer-os/${version}`, link);
  };
  await install(options.releases[0]?.version ?? "1.1.0");
  const at = parseCanonicalAbsolutePathText(prefix);
  const entry = { prefix: at, opt: parseCanonicalAbsolutePathText(link), fallback: "libexec/fallback" } as const;
  const requests: string[] = [];
  const plannerRuns: string[] = [];

  return {
    architecture: options.architecture,
    releases,
    prefix,
    requests,
    plannerRuns,
    install,
    ports: {
      readPackageSource: () => {
        requests.push("package_source");
        return readPackageChannelSource(options.architecture, { arm64: entry, x64: entry });
      },
      planner: {
        run: (run) => {
          plannerRuns.push(run.request.targetRelease.version);
          const draft = admitTargetUpdateDraft(planKeepAllRelease(run.request), run.request).draft;
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
  };
}

/** Which world an on-disk update context reads its keg from, so `updateTo` can `brew upgrade` first. */
const WORLD_OF = new WeakMap<CliUpdateContext, OnDiskReleaseWorldV1>();

/**
 * An installed home's production update context with only the release world's ports replaced.
 * `--apply` runs the real ports, with the fallback handoff bound from the keg planning admitted
 * (D84 K3), exactly as `createCliUpdateContext` binds it.
 */
export function onDiskUpdateContext(context: CliContext, world: OnDiskReleaseWorldV1): CliUpdateContext {
  const source = packageSourcePorts(world.ports.readPackageSource);
  const update: CliUpdateContext = {
    ...createCliUpdateContext(context),
    planner: world.ports.planner,
    readPackageSource: source.readPackageSource,
    apply: productionUpdateApplyPorts(context, source.fallback),
    // K8's child, in process: plain `init` over this context renders from the active bundle (C2).
    // The synthetic `bin/cli` cannot load a CLI, and the fixture's vendors are invisible to a child.
    refresh: async () => {
      // The child is a fresh process: once `brew cleanup` removed the prefix, `bin.ts` admits no keg.
      const child: CliContext = existsSync(world.prefix) ? context : { ...context, bootstrap: { state: "unavailable_until_packaged_handoff" } };
      return (await runInit(child, { dryRun: false, assumeYes: true })).code;
    },
  };
  WORLD_OF.set(update, world);
  return update;
}

export interface UpdatableHomeV1 {
  readonly fixture: CommandFixture;
  readonly world: OnDiskReleaseWorldV1;
  /** The packaged release `init` installed. */
  readonly installed: ReleaseIdentityV1;
  /** A fresh process's update context over this home; `context` swaps the CLI context, e.g. a dying one. */
  readonly update: (context?: CliContext) => CliUpdateContext;
}

export const ON_DISK_RELEASES = [{ version: "1.1.0", sequence: "2" }, { version: "1.2.0", sequence: "3" }] as const;

/** The synthetic `claude` an instruction-attaching home discovers; nothing ever spawns it but `--version`. */
const SYNTHETIC_CLAUDE = "/synthetic/opt/bin/claude";
/** The synthetic `codex` an instruction-attaching home discovers; `syntheticVendorRunner` answers for it. */
const SYNTHETIC_CODEX = "/synthetic/opt/bin/codex";

/** One skill for both vendors the first keg carries, so `init --adapters claude,codex` attaches instruction rows (NEW-171). */
const SYNTHETIC_INSTRUCTIONS = [
  { relativePath: "catalog.json", bytes: encoder.encode(`${JSON.stringify({ schemaVersion: 1, artifacts: [{ category: "skill", id: "triage", legacyName: "triage", vendors: ["claude", "codex"], thinCommand: false }] })}\n`), mode: 0o600 },
  { relativePath: "skills/triage/SKILL.md", bytes: encoder.encode("---\nname: triage\ndescription: Triage a defect.\n---\nTriage.\n"), mode: 0o600 },
] as const;

/** Release 1.2.0's triage skill: the rendered change an update brings and a rollback takes back (NEW-200). */
const TRIAGE_1_2_0 = encoder.encode("---\nname: triage\ndescription: Triage a defect.\n---\nTriage, then reproduce.\n");

/** Every release's `workflows/` (the repository's) and `instructions/`; 1.2.0 changes the triage skill. */
async function releaseTree(): Promise<(version: string) => ReadonlyMap<string, Uint8Array>> {
  const workflows = (await repositoryWorkflowFiles()).map((file) => [file.relativePath.slice("bundle/".length), file.bytes] as const);
  return (version) => new Map([
    ...workflows,
    ...SYNTHETIC_INSTRUCTIONS.map((file) => [`instructions/${file.relativePath}`, version === "1.2.0" && file.relativePath === "skills/triage/SKILL.md" ? TRIAGE_1_2_0 : file.bytes] as const),
  ]);
}

/**
 * The vendor CLIs a fixture's in-process `init`, `doctor` and `uninstall` run: Claude answers
 * `--version`; Codex keeps its marketplace and plugin state across calls.
 */
function syntheticVendorRunner(pluginRoot: () => string): ProcessRunner {
  const codex = { marketplace: false, registered: false };
  const ok = (stdout: string): ProcessResult => ({ stdout, stderr: "", exitCode: 0, signal: null, timedOut: false });
  return {
    run(request: ProcessRequest): Promise<ProcessResult> {
      const argv = request.args.join(" ");
      if (argv === "--version") return Promise.resolve(ok(request.executable === SYNTHETIC_CODEX ? "codex-cli 0.155.1\n" : "2.1.280 (Claude Code)\n"));
      switch (argv) {
        case "plugin list --json":
          return Promise.resolve(ok(JSON.stringify({ installed: codex.registered ? [{ name: "developer-os", enabled: true, source: { source: "local", path: pluginRoot() } }] : [] })));
        case "plugin marketplace list":
          return Promise.resolve(ok(codex.marketplace ? `developer-os  ${dirname(dirname(pluginRoot()))}\n` : "No plugin marketplaces in scope.\n"));
        case "plugin add developer-os@developer-os --json":
          codex.registered = true;
          return Promise.resolve(ok("{}"));
        case "plugin remove developer-os@developer-os":
          codex.registered = false;
          return Promise.resolve(ok(""));
        case "plugin marketplace remove developer-os":
          codex.marketplace = false;
          return Promise.resolve(ok(""));
        case "debug prompt-input probe":
          return Promise.resolve(ok(""));
        default:
          if (argv.startsWith("plugin marketplace add ")) {
            codex.marketplace = true;
            return Promise.resolve(ok(""));
          }
          return Promise.reject(new Error(`unexpected spawn: ${argv}`));
      }
    },
  };
}

/**
 * A real `init` from the prefix's first keg (`1.0.0`, Task 3's `<fixture root>/prefix`), a Brain,
 * and the `ON_DISK_RELEASES` kegs written into that same prefix. With `instructions`, `init
 * --adapters claude,codex` also attaches the keg's one skill for both vendors, and every later
 * keg carries its own `instructions/` and `workflows/` for the K8 refresh to render.
 */
export async function installUpdatableHome(label: string, architecture: SyntheticArchitectureV1, options: { readonly rejectingVersions?: readonly string[]; readonly instructions?: boolean } = {}): Promise<UpdatableHomeV1> {
  const instructions = options.instructions === true;
  let pluginRoot = "";
  const fixture = await createCommandFixture(label, {
    bootstrapAvailable: true,
    architecture,
    ...(instructions
      ? {
          instructions: SYNTHETIC_INSTRUCTIONS,
          agents: {
            claude: { name: "claude", installed: true, executablePath: SYNTHETIC_CLAUDE, version: null },
            codex: { name: "codex", installed: true, executablePath: SYNTHETIC_CODEX, version: null },
          },
          runner: syntheticVendorRunner(() => pluginRoot),
        }
      : {}),
  });
  pluginRoot = join(fixture.paths.home, "codex", "plugins", "developer-os");
  await mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  const initialized = await runInit(fixture.context, { dryRun: false, assumeYes: true, ...(instructions ? { adapters: ["claude", "codex"] as const } : {}) });
  if (!initialized.ok) throw new Error(`fixture init failed: ${JSON.stringify(initialized)}`);
  const world = await createOnDiskReleaseWorld({ architecture, prefix: join(fixture.root, "prefix"), releases: ON_DISK_RELEASES, instructions, ...(options.rejectingVersions === undefined ? {} : { rejectingVersions: options.rejectingVersions }) });
  const installed = releaseIdentityOf((await createCliUpdateContext(fixture.context).readHome()).active);
  return { fixture, world, installed, update: (context = fixture.context) => onDiskUpdateContext(context, world) };
}

/** `brew upgrade` to `version` (an on-disk world's context), then preview and apply it in one invocation, as `update --apply` does. */
export async function updateTo(update: CliUpdateContext, version: string): Promise<UpdateApplyResultV1> {
  await WORLD_OF.get(update)?.install(version);
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

/**
 * The same CLI context whose first publication onto the installed manifest is followed by one
 * appended byte: the manifest the verifier snapshots then differs from the transitional manifest
 * the plan verifies (NEW-118 (4)). The wrapping pattern is `dieAfterMutations`'.
 */
export function tamperManifestBeforeVerifier(context: CliContext): CliContext {
  const lifecycle = context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture has no lifecycle ports");
  // After the active record's payload is retained, the journal writes the step's completion and then the point of no return; the verifier runs right after the second, so the byte lands just before it.
  let journalWrites = -1;
  const fs: Record<string, unknown> = { ...lifecycle.fs };
  for (const name of DURABLE_MUTATIONS) {
    const real = lifecycle.fs[name].bind(lifecycle.fs) as (...args: readonly unknown[]) => Promise<unknown>;
    fs[name] = async (...args: readonly unknown[]): Promise<unknown> => {
      if (journalWrites >= 0 && name === "writeExclusive" && (journalWrites += 1) === 1) appendFileSync(context.paths.manifestFile, " ");
      const result = await real(...args);
      const source = (args[0] as { readonly path?: string }).path ?? "";
      if (journalWrites < 0 && name === "renameNoReplace" && source.includes("/update/payloads/state/active_release/")) journalWrites = 0;
      return result;
    };
  }
  return { ...context, lifecycle: { ...lifecycle, fs: fs as unknown as typeof lifecycle.fs } };
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
    recoveryExecutor: { finalPath: deriveUpdateExecutorRecordPath(home), initial, initialStaged: staged(initial, 10), terminal, terminalStaged: staged(terminal, 11), maximumRecordBytes: MAXIMUM_RECOVERY_EXECUTOR_BYTES },
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
