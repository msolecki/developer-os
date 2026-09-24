/**
 * Spec 1 §3 and §4's `git enable|disable|status|sync` over the plan-1a lifecycle kernel.
 * Previews are bounded observation only. Every apply and sync runs under a global lock the
 * caller already holds, recomputes its preview there, proves feasibility, reserves IDs, stages
 * every participant, persists the plan and hands it to the coordinator by ID.
 */
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  EXIT_CODES,
  FoundationParticipantExecutor,
  GitPlanner,
  LifecycleCoordinator,
  LifecycleRecoveryRequiredError,
  TransactionExecutor,
  allocatedCounterOf,
  appendGitRemoteSection,
  assertLifecycleExecutionFeasible,
  createGitEffectLedgerCodec,
  createNodeGitMetadataStream,
  decodeCanonicalJson,
  deriveManifestPayloadPath,
  encodeCanonicalJson,
  encodeLifecycleActivationRecord,
  formatAllocatedLifecycleId,
  gitEffectPlanHash,
  gitReflogAppendLine,
  gitScopeFingerprint,
  gitTreeFingerprintHash,
  lifecycleConfigHash,
  lifecycleReservationOrder,
  lifecyclePreviewHash,
  loadConfig,
  maximumCoordinatorJournalBytes,
  maximumGitEffectJournalBytes,
  parseCanonicalAbsolutePathText,
  parseFullBranchRef,
  parseLifecycleActivationRecord,
  parseLifecycleCoordinatorId,
  parseLowerHexSha1,
  parseNormalizedRemoteUrl,
  parseUInt64Decimal,
  parseValidatedGitBranch,
  planInitialGitDirectory,
  reserveLifecycleIdBlock,
  serializeConfig,
  validateGitEffectPlan,
  validateGitHeadState,
  validateGitReflogAppend,
  validateGitReflogPlan,
  validateGitScopeSnapshot,
  validateGitTreeFingerprint,
  validateManifestV2,
} from "@developer-os/core";
import type {
  LifecycleIdPrefixV1,
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  DeveloperOsConfigV1,
  ExitCode,
  FoundationParticipantRefV1,
  FullBranchRefV1,
  GitCommitterV1,
  GitEffectPlanV1,
  GitEffectTransitionV1,
  GitHeadStateV1,
  GitPlanPreviewV1,
  GitRefStateV1,
  GitReflogAppendV1,
  GitReflogStateV1,
  GitScopeSnapshotV1,
  GitSemanticStateV1,
  GitSyncConfigV1,
  GitSyncPlanningDraft,
  GuardedGitPathStateV1,
  HeldLifecycleStableLockV1,
  InstallationManifestV2,
  LifecycleActivationRecordV1,
  LifecycleBookkeepingResidueV1,
  LifecycleCoordinatorIdV1,
  LifecycleCoordinatorStepV1,
  LifecycleExecutionBuilderV1,
  LifecycleGuardedEntryV1,
  LifecycleLeafReservationV1,
  LifecycleLedgerSnapshotV1,
  LifecycleParticipantAdaptersV1,
  LifecyclePreviewFileChangeV1,
  LowerHexSha1,
  LowerHexSha256,
  ManagedArtifactV2,
  ManifestStatePlanV1,
  PlannedGitPathStateV1,
  UtcTimestampV1,
  VaultFreeRelativePathV1,
  AllocatedLifecycleIdV1,
  UInt64DecimalV1,
  GitEffectIdV1,
  FoundationTransactionIdV1,
} from "@developer-os/core";
import { PRIVATE_FOLDERS, discoverNotes, lintVault, resolveBrainConfig } from "@developer-os/brain";
import type { DirectoryEntry } from "@developer-os/brain";
import { PERSISTED_GIT_PUSH_PLAN_CODEC, SUPPORTED_GIT_DISTRIBUTION, createRedactor } from "@developer-os/security";
import type { PersistedGitPushPlanV1 } from "@developer-os/security";

import { createBootstrapEvidenceInspectionRequest } from "../../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../../bootstrap/report.js";
import { readRedactionKey } from "../../context.js";
import type { CliContext } from "../../context.js";
import { compareManifestRows } from "../../instructions/attach.js";
import { createLifecycleEffectAdapters, createLifecycleManifestAdapter } from "../../lifecycle/adapters.js";
import { admitInstalledV2Home } from "../../lifecycle/admission.js";
import type { AdmittedV2HomeV1 } from "../../lifecycle/admission.js";
import { lifecyclePushPlanHash, lifecycleVariantFacts } from "../../lifecycle/codecs.js";
import type { LifecycleExecutionPlanV1, LifecyclePlanPreviewV1 } from "../../lifecycle/codecs.js";
import { lifecycleHomeKeyFromAdmission, residueFrom } from "../../lifecycle/context.js";
import type { CliLifecycleContext, LifecycleHomeKeyV1 } from "../../lifecycle/context.js";
import { isCodeDefect, MANIFEST_ANCHOR_WARNING, readManifestAnchor, writeManifestAnchor } from "../../lifecycle/manifest-anchor.js";
import { gateManifestAdmission } from "../../lifecycle/mutation-gate.js";
import { GIT_SHADOW_TEMPLATE_HASHES } from "./runtime.js";
import type { GitCandidateObjectsV1, GitRuntimeV1 } from "./runtime.js";
import { encodeSyncRecord, nextSyncRecord, readSyncRecord, syncRecordPath } from "./sync-record.js";
import type { SyncRecordV1 } from "./sync-record.js";

export interface GitEnableCliRequestV1 {
  readonly remote: string;
  readonly branch: string | null;
}

export type GitCommandRequestV1 =
  | { readonly subcommand: "enable"; readonly remote: string; readonly branch: string | null; readonly apply: boolean }
  | { readonly subcommand: "disable"; readonly apply: boolean }
  | { readonly subcommand: "status" }
  | { readonly subcommand: "sync" };

export type GitCommandDataV1 =
  | {
      readonly kind: "preview";
      readonly command: "git_enable" | "git_disable";
      readonly preview: LifecyclePlanPreviewV1;
      readonly warning: string | null;
    }
  | {
      readonly kind: "applied";
      readonly operation: "git_enable" | "git_reconcile" | "git_disable";
      readonly transactionId: string;
      readonly previewHash: LowerHexSha256;
    }
  | {
      readonly kind: "status";
      readonly enabled: boolean;
      readonly activation: "absent" | "inactive" | "active" | "mismatched";
      readonly repositoryRoot: string | null;
      readonly branch: string | null;
      readonly remote: string | null;
      readonly transport: "local" | "https" | "ssh" | null;
      readonly scope: "current" | "scope_reconcile_required" | "repository_identity_changed" | null;
      readonly distribution: "supported" | "unsupported_git_distribution" | null;
      readonly closure: string;
      readonly lastSync: null | { readonly outcome: "pushed" | "no_changes"; readonly headOid: string; readonly completedAt: string };
    }
  | {
      readonly kind: "sync";
      readonly outcome: "pushed" | "no_changes" | "push_pending";
      readonly transactionId: string;
      readonly headOid: string;
    };

export interface GitCommandResultV1 {
  readonly exitCode: ExitCode;
  readonly data: GitCommandDataV1;
}

export interface GitService {
  previewEnable(request: GitEnableCliRequestV1): Promise<LifecyclePlanPreviewV1>;
  applyEnable(preview: LifecyclePlanPreviewV1, global: HeldLifecycleStableLockV1): Promise<GitCommandResultV1>;
  previewDisable(): Promise<LifecyclePlanPreviewV1>;
  applyDisable(preview: LifecyclePlanPreviewV1, global: HeldLifecycleStableLockV1): Promise<GitCommandResultV1>;
  status(): Promise<GitCommandResultV1>;
  sync(mode: "interactive" | "scheduled", global: HeldLifecycleStableLockV1): Promise<GitCommandResultV1>;
}

/**
 * `failureFrom` publishes `kindOf(name)`, so the name spells the reason — the rule
 * `LifecycleMutationRefusal` and `V2HomeAdmissionError` follow.
 */
export class GitCommandRefusal extends Error {
  readonly code: ExitCode;
  readonly reason: string;
  readonly paths: readonly string[];
  readonly recovery: string | undefined;

  constructor(reason: string, code: ExitCode, paths: readonly string[] = [], recovery?: string) {
    super(`git refused: ${reason}`);
    this.reason = reason;
    this.code = code;
    this.paths = [...paths];
    this.recovery = recovery;
    this.name = `${reason
      .split("_")
      .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
      .join("")}Error`;
  }
}

const GLOBAL_LOCK_LEAF = ".lifecycle.lock";
const ACTIVATION_LEAF = "lifecycle-activation.json";
const MAX_CONFIG_BYTES = 1_048_576;
const MAX_ACTIVATION_BYTES = 1_048_576;
const MAX_MANIFEST_BYTES = 67_108_864;
const MAX_PLAN_BYTES = 16_777_216;
const MAX_JOURNAL_BYTES = 1_048_576;
const MAX_GIT_CONTROL_BYTES = 67_108_864;
const MAX_FAST_FORWARD_WALK = 100_000;
const FOUNDATION_BINDINGS_DOMAIN = "developer-os/manifest-foundation-bindings/v1\0";
const WIDEST_UINT64 = parseUInt64Decimal("18446744073709551615");
const WIDEST_HASH = "f".repeat(64) as LowerHexSha256;
const ZERO_OID = "0000000000000000000000000000000000000000";
const REFLOG_MESSAGE = "developer-os sync";
const ACTIVATION_SOURCE = "generated/state/lifecycle-activation.json" as VaultFreeRelativePathV1;
const encoder = new TextEncoder();

function canonical(path: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(path);
}

function sha256(bytes: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function json(value: unknown): CanonicalJsonValue {
  return value as CanonicalJsonValue;
}

function sameJson(left: unknown, right: unknown): boolean {
  return encodeCanonicalJson(json(left)) === encodeCanonicalJson(json(right));
}

function recoveryRequired(reason: string, ...paths: readonly string[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

function refuse(reason: string, code: ExitCode, paths: readonly string[] = [], recovery?: string): never {
  throw new GitCommandRefusal(reason, code, paths, recovery);
}

export function foundationBindingsHash(ids: readonly string[]): LowerHexSha256 {
  return createHash("sha256").update(FOUNDATION_BINDINGS_DOMAIN).update(JSON.stringify(ids)).digest("hex") as LowerHexSha256;
}

// ---------------------------------------------------------------------------------------------
// Observation

export interface ObservedFileV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly entry: LifecycleGuardedEntryV1 | null;
  readonly bytes: Uint8Array | null;
  readonly hash: LowerHexSha256 | null;
}

async function observeFile(
  lifecycle: CliLifecycleContext,
  path: CanonicalAbsolutePathV1,
  maximumBytes: number,
): Promise<ObservedFileV1> {
  // identity-free stat: the guarded port already returns an exact decimal identity.
  const entry = await lifecycle.fs.lstat(path);
  if (entry === null) return { path, entry, bytes: null, hash: null };
  if (entry.kind !== "regular_file" || entry.ownerUid !== lifecycle.effectiveUid || BigInt(entry.size) > BigInt(maximumBytes)) {
    recoveryRequired("git_lifecycle_file_shape", path);
  }
  const bytes = await lifecycle.fs.readRegular(entry, maximumBytes);
  return { path, entry, bytes, hash: sha256(bytes) };
}

export interface GitHomeV1 {
  readonly admitted: AdmittedV2HomeV1;
  readonly key: LifecycleHomeKeyV1;
  readonly authority: {
    readonly productHome: CanonicalAbsolutePathV1;
    readonly configPath: CanonicalAbsolutePathV1;
    readonly activationPath: CanonicalAbsolutePathV1;
    readonly manifestPath: CanonicalAbsolutePathV1;
  };
  readonly config: DeveloperOsConfigV1;
  readonly configFile: ObservedFileV1 & { readonly bytes: Uint8Array; readonly hash: LowerHexSha256 };
  readonly activationFile: ObservedFileV1;
  readonly activation: LifecycleActivationRecordV1 | null;
  readonly manifestFile: ObservedFileV1 & { readonly entry: LifecycleGuardedEntryV1; readonly hash: LowerHexSha256 };
  readonly manifest: InstallationManifestV2;
  readonly syncRecord: SyncRecordV1 | null;
  /** The bytes at `state/git-sync.json`, empty for fresh `init`'s reservation; null when absent. */
  readonly syncRecordBytes: Uint8Array | null;
}

export async function observeHome(context: CliContext, lifecycle: CliLifecycleContext): Promise<GitHomeV1> {
  const admitted = await admitInstalledV2Home({
    fs: lifecycle.fs,
    paths: context.paths,
    manifestAdmission: gateManifestAdmission(context),
    effectiveUid: lifecycle.effectiveUid,
  });
  const key = lifecycleHomeKeyFromAdmission(admitted, context.paths);
  const authority = {
    productHome: key.productHome,
    configPath: canonical(context.paths.configFile),
    activationPath: canonical(join(context.paths.stateDir, ACTIVATION_LEAF)),
    manifestPath: canonical(context.paths.manifestFile),
  };
  const configFile = await observeFile(lifecycle, authority.configPath, MAX_CONFIG_BYTES);
  if (configFile.bytes === null || configFile.hash === null) refuse("configuration_invalid", EXIT_CODES.invalidInput, [authority.configPath]);
  let config: DeveloperOsConfigV1;
  try {
    config = loadConfig(new TextDecoder("utf-8", { fatal: true }).decode(configFile.bytes));
  } catch {
    return refuse("configuration_invalid", EXIT_CODES.invalidInput, [authority.configPath]);
  }
  const activationFile = await observeFile(lifecycle, authority.activationPath, MAX_ACTIVATION_BYTES);
  let activation: LifecycleActivationRecordV1 | null = null;
  if (activationFile.bytes !== null) {
    try {
      activation = parseLifecycleActivationRecord(activationFile.bytes);
    } catch {
      recoveryRequired("activation_record_invalid", authority.activationPath);
    }
  }
  const manifestFile = await observeFile(lifecycle, authority.manifestPath, MAX_MANIFEST_BYTES);
  if (manifestFile.entry === null || manifestFile.hash === null) recoveryRequired("manifest_absent", authority.manifestPath);
  const record = await readSyncRecord(lifecycle.fs, context.paths, lifecycle.effectiveUid).catch(() =>
    recoveryRequired("sync_record_invalid", syncRecordPath(context.paths)),
  );
  return {
    admitted,
    key,
    authority,
    config,
    configFile: { ...configFile, bytes: configFile.bytes, hash: configFile.hash },
    activationFile,
    activation,
    manifestFile: { ...manifestFile, entry: manifestFile.entry, hash: manifestFile.hash },
    manifest: admitted.manifest,
    syncRecord: record?.record ?? null,
    syncRecordBytes: record?.bytes ?? null,
  };
}

export async function residueOf(context: CliContext): Promise<LifecycleBookkeepingResidueV1> {
  return residueFrom(
    await inspectBootstrapEvidenceAdmission(
      createBootstrapEvidenceInspectionRequest({
        productHome: context.paths.home,
        stateDirectory: context.paths.stateDir,
        initialRoots: [context.paths.home, context.paths.stateDir, context.userHome],
      }),
    ),
  );
}

/** The in-repository scope the current Brain configuration defines. */
export function gitScopeOf(config: DeveloperOsConfigV1): GitScopeSnapshotV1 {
  const brain = resolveBrainConfig(config);
  const fields = {
    brainPath: config.brainPath,
    contentRoot: brain.contentRoot,
    topicFolders: [...brain.topicFolders],
    topicAliases: { ...brain.topicAliases },
    indexesDir: brain.indexesDir,
  };
  try {
    return validateGitScopeSnapshot({ ...fields, fingerprint: gitScopeFingerprint(fields as never) });
  } catch {
    return refuse("scope_outside_repository", EXIT_CODES.invalidInput, [config.brainPath]);
  }
}

function activationArm(home: GitHomeV1): "absent" | "inactive" | "active" | "mismatched" {
  const lifecycle = home.config.git.lifecycle;
  const arm = home.activation?.git;
  if (arm === undefined) return "absent";
  if (arm.state === "inactive") return "inactive";
  return lifecycle !== undefined && arm.configHash === lifecycleConfigHash("git", lifecycle) ? "active" : "mismatched";
}

/** Spec §4.5 row one: disabled, incomplete, or unproven provenance refuses before any Git process. */
function requireActiveGit(home: GitHomeV1): GitSyncConfigV1 {
  const lifecycle = home.config.git.lifecycle;
  if (!home.config.git.enabled) refuse("git_disabled", EXIT_CODES.capabilityUnavailable, [home.authority.configPath], "developer-os git enable --remote <url> --apply");
  if (lifecycle === undefined) refuse("git_lifecycle_incomplete", EXIT_CODES.recoveryRequired, [home.authority.configPath], "developer-os git enable --remote <url> --apply");
  if (activationArm(home) !== "active") refuse("git_activation_unproven", EXIT_CODES.recoveryRequired, [home.authority.activationPath], "developer-os git enable --remote <url> --apply");
  return lifecycle;
}

// ---------------------------------------------------------------------------------------------
// Brain scope ports

function brainConfigOf(scope: GitScopeSnapshotV1, config: DeveloperOsConfigV1): ReturnType<typeof resolveBrainConfig> {
  return {
    ...resolveBrainConfig(config),
    contentRoot: scope.contentRoot,
    topicFolders: [...scope.topicFolders],
    topicAliases: { ...scope.topicAliases },
    indexesDir: scope.indexesDir,
  };
}

function scopeEnumerator(context: CliContext, config: DeveloperOsConfigV1): GitPlannerDependencies["enumerator"] {
  const excluded = (segment: string, scope: GitScopeSnapshotV1): boolean =>
    segment.startsWith(".") || segment === scope.indexesDir || PRIVATE_FOLDERS.includes(segment);
  return {
    async canonicalNotes(scope) {
      const found = await discoverNotes({
        vaultRoot: scope.brainPath,
        config: brainConfigOf(scope, config),
        reader: {
          readDir: async (path: string): Promise<readonly DirectoryEntry[]> =>
            (await context.fs.readdir(path, { withFileTypes: true })).map((entry) => ({
              name: entry.name,
              isDirectory: entry.isDirectory(),
              isFile: entry.isFile(),
              isSymbolicLink: entry.isSymbolicLink(),
            })),
        },
        assertReadable: async (path: string): Promise<void> => {
          await context.guards.manifest.assertReadable(path);
        },
      });
      return found.notes.map((note) => note.vaultPath);
    },
    isCanonicalNote(scope, path) {
      const segments = path.split("/");
      const folders = [...scope.topicFolders, ...Object.keys(scope.topicAliases)];
      return (
        segments.length >= 3 &&
        segments[0] === scope.contentRoot &&
        folders.includes(segments[1] ?? "") &&
        path.endsWith(".md") &&
        segments.slice(1).every((segment) => !excluded(segment, scope))
      );
    },
  };
}

/** Brain lint over the secret-clean in-memory snapshot; a finding publishes class and path only. */
function snapshotLinter(context: CliContext, config: DeveloperOsConfigV1, scope: GitScopeSnapshotV1): GitPlannerDependencies["lintSnapshot"] {
  return async (files) => {
    const byPath = new Map(files.map((file) => [`${scope.brainPath}/${file.path}`, new TextDecoder().decode(file.bytes)]));
    const directories = new Map<string, Map<string, boolean>>();
    for (const absolute of byPath.keys()) {
      let path = absolute;
      while (path.length > scope.brainPath.length) {
        const parent = dirname(path);
        const children = directories.get(parent) ?? new Map<string, boolean>();
        children.set(path.slice(parent.length + 1), path !== absolute);
        directories.set(parent, children);
        path = parent;
      }
    }
    const result = await lintVault({
      build: {
        vaultRoot: scope.brainPath,
        config: brainConfigOf(scope, config),
        reader: {
          readDir: (path: string): Promise<readonly DirectoryEntry[]> =>
            Promise.resolve(
              [...(directories.get(path) ?? new Map<string, boolean>()).entries()].map(([name, directory]) => ({
                name,
                isDirectory: directory,
                isFile: !directory,
                isSymbolicLink: false,
              })),
            ),
        },
        readFile: (path: string) => {
          const text = byPath.get(path);
          return text === undefined ? Promise.reject(new Error("not in the sync snapshot")) : Promise.resolve(text);
        },
        assertReadable: () => Promise.resolve(),
        canonicalize: (path: string) => Promise.resolve(path),
        now: () => context.now().toISOString(),
      },
      readArtifact: (vaultPath: string) => Promise.resolve(byPath.get(`${scope.brainPath}/${vaultPath}`) ?? null),
      today: context.now().toISOString().slice(0, "YYYY-MM-DD".length),
    });
    const first = result.findings.find((finding) => finding.severity === "error");
    if (first !== undefined) refuse(`brain_lint_${first.class.replaceAll("-", "_")}`, EXIT_CODES.securityRefusal, [first.path]);
  };
}

type GitPlannerDependencies = ConstructorParameters<typeof GitPlanner>[0];

function redactorFor(context: CliContext, config: DeveloperOsConfigV1): (text: string) => string {
  const redactor = createRedactor(readRedactionKey(context.paths.stateDir) ?? randomBytes(32), {
    userPatterns: config.redaction?.patterns ?? [],
  });
  return (text) => redactor(text).text;
}

function plannerFor(context: CliContext, lifecycle: CliLifecycleContext, runtime: GitRuntimeV1, config: DeveloperOsConfigV1, scope: GitScopeSnapshotV1): GitPlanner {
  return new GitPlanner({
    fs: lifecycle.fs,
    streamRegular: createNodeGitMetadataStream(),
    redact: redactorFor(context, config),
    effectiveUid: lifecycle.effectiveUid,
    enumerator: scopeEnumerator(context, config),
    commitTree: (commit) => runtime.commitTree(canonical(`${scope.brainPath}/.git`), commit),
    lintSnapshot: snapshotLinter(context, config, scope),
  });
}

// ---------------------------------------------------------------------------------------------
// Remote resolution

const UNRESERVED = /^[A-Za-z0-9._~-]$/u;

function fileUrl(path: string): string {
  let encoded = "";
  for (const byte of encoder.encode(path)) {
    const character = String.fromCharCode(byte);
    encoded += UNRESERVED.test(character) || character === "/" ? character : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return `file://${encoded}`;
}

function localPathOf(raw: string): string | null {
  if (raw.startsWith("/")) return raw;
  for (const prefix of ["file://localhost/", "file:///"]) {
    if (raw.toLowerCase().startsWith(prefix)) return decodeURIComponent(`/${raw.slice(prefix.length)}`);
  }
  return null;
}

/** A bare local destination: `HEAD`, `config`, `objects` and `refs` directly inside, and no worktree. */
async function requireBareRepository(path: string): Promise<void> {
  for (const [leaf, directory] of [["HEAD", false], ["config", false], ["objects", true], ["refs", true]] as const) {
    const stats = await lstat(join(path, leaf), { bigint: true }).catch(() => null);
    if (stats === null || stats.isSymbolicLink() || stats.isDirectory() !== directory) {
      refuse("git_remote_not_bare", EXIT_CODES.invalidInput, [path]);
    }
  }
}

async function resolveRemote(raw: string, brainPath: string): Promise<GitSyncConfigV1["remote"]> {
  const local = localPathOf(raw);
  let transport: GitSyncConfigV1["remote"]["transport"];
  let url: string;
  if (local !== null) {
    let resolved: string;
    try {
      resolved = await realpath(local);
    } catch {
      return refuse("git_remote_absent", EXIT_CODES.invalidInput, [local]);
    }
    if (resolved === brainPath || resolved.startsWith(`${brainPath}/`) || brainPath.startsWith(`${resolved}/`)) {
      refuse("git_remote_overlaps_repository", EXIT_CODES.invalidInput, [resolved]);
    }
    await requireBareRepository(resolved);
    transport = "local";
    url = fileUrl(resolved);
  } else {
    transport = raw.toLowerCase().startsWith("https://") ? "https" : "ssh";
    url = raw;
  }
  let normalized;
  try {
    normalized = parseNormalizedRemoteUrl(url, transport);
  } catch {
    return refuse("git_remote_invalid", EXIT_CODES.invalidInput);
  }
  return { name: "developer-os", transport, declaredUrl: normalized, effectivePushUrl: normalized };
}

function localRemotePath(remote: GitSyncConfigV1["remote"]): CanonicalAbsolutePathV1 {
  const path = localPathOf(remote.effectivePushUrl);
  if (remote.transport !== "local" || path === null) return refuse("unsupported_git_distribution", EXIT_CODES.securityRefusal);
  return canonical(path);
}

// ---------------------------------------------------------------------------------------------
// Preview composition

function fileState(bytes: Uint8Array | null): LifecyclePreviewFileChangeV1["before"] {
  return bytes === null ? { state: "absent" } : { state: "present", hash: sha256(bytes), size: bytes.byteLength };
}

export function fileChange(
  role: "activation" | "config" | "manifest",
  targetPath: CanonicalAbsolutePathV1,
  before: Uint8Array | null,
  after: Uint8Array,
): LifecyclePreviewFileChangeV1 {
  const same = before !== null && Buffer.compare(Buffer.from(before), Buffer.from(after)) === 0;
  return {
    role,
    targetPath,
    operation: before === null ? "create" : same ? "keep" : "replace",
    before: fileState(before),
    after: fileState(after),
  };
}

function manifestWithActivation(home: GitHomeV1, activationBytes: Uint8Array): Uint8Array {
  const path = home.authority.activationPath;
  const previous = home.manifest.artifacts.find((artifact) => artifact.path === path);
  const row: ManagedArtifactV2 = {
    owner: "core",
    path,
    productVersion: home.manifest.productVersion,
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    source: ACTIVATION_SOURCE,
    mergeStrategy: "dedicated",
    verifiedAt: previous?.verifiedAt ?? home.manifest.installedAt,
    kind: "file",
    verification: { mode: "content", installedHash: sha256(activationBytes) },
  };
  const manifest: InstallationManifestV2 = {
    ...home.manifest,
    artifacts: [...home.manifest.artifacts.filter((artifact) => artifact !== previous), row].sort(compareManifestRows),
  };
  return encoder.encode(encodeCanonicalJson(json(manifest)));
}

interface LifecycleFilesV1 {
  readonly activation: Uint8Array;
  readonly config: Uint8Array;
  readonly manifest: Uint8Array;
}

/** The manifest postimage is admitted exactly as the manifest participant will read it back. */
export function admitManifestAfter(context: CliContext, bytes: Uint8Array): void {
  try {
    validateManifestV2(decodeCanonicalJson(bytes, MAX_MANIFEST_BYTES), gateManifestAdmission(context));
  } catch {
    recoveryRequired("manifest_invalid", context.paths.manifestFile);
  }
}

function lifecycleFiles(home: GitHomeV1, lifecycle: GitSyncConfigV1, enabled: boolean): LifecycleFilesV1 {
  const record: LifecycleActivationRecordV1 = {
    schemaVersion: 1,
    git: enabled ? { state: "active", configHash: lifecycleConfigHash("git", lifecycle) } : { state: "inactive" },
    automation: home.activation?.automation ?? { state: "inactive" },
  };
  const activation = encoder.encode(encodeLifecycleActivationRecord(record));
  return {
    activation,
    config: encoder.encode(serializeConfig({ ...home.config, git: { enabled, lifecycle } })),
    manifest: manifestWithActivation(home, activation),
  };
}

function previewFiles(home: GitHomeV1, files: LifecycleFilesV1): readonly LifecyclePreviewFileChangeV1[] {
  return [
    fileChange("activation", home.authority.activationPath, home.activationFile.bytes, files.activation),
    fileChange("config", home.authority.configPath, home.configFile.bytes, files.config),
    fileChange("manifest", home.authority.manifestPath, home.manifestFile.bytes, files.manifest),
  ].sort((left, right) => Buffer.compare(Buffer.from(left.targetPath), Buffer.from(right.targetPath)));
}

export function withPreviewHash(preview: Omit<LifecyclePlanPreviewV1, "previewHash">): LifecyclePlanPreviewV1 {
  const unhashed = { ...preview, previewHash: WIDEST_HASH } as LifecyclePlanPreviewV1;
  return { ...unhashed, previewHash: lifecyclePreviewHash(unhashed) };
}

// ---------------------------------------------------------------------------------------------
// Staging

async function mkdirOwned(path: string, mode = 0o700): Promise<void> {
  await mkdir(path, { mode });
  await chmod(path, mode);
}

async function writeOwned(path: string, bytes: Uint8Array, mode: number): Promise<void> {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode);
  try {
    await handle.writeFile(bytes);
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function identityOf(path: string): Promise<{ readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1; readonly mode: number; readonly ownerUid: number; readonly size: number }> {
  const stats = await lstat(path, { bigint: true });
  return {
    dev: parseUInt64Decimal(stats.dev.toString(10)),
    ino: parseUInt64Decimal(stats.ino.toString(10)),
    mode: Number(stats.mode & 0o777n),
    ownerUid: Number(stats.uid),
    size: Number(stats.size),
  };
}

async function stagedRegular(path: string, bytes: Uint8Array, mode: number, semantic: GitSemanticStateV1): Promise<GuardedGitPathStateV1> {
  await writeOwned(path, bytes, mode);
  const identity = await identityOf(path);
  return { state: "regular_file", hash: sha256(bytes), size: bytes.byteLength, mode, dev: identity.dev, ino: identity.ino, semantic };
}

function plannedOf(state: GuardedGitPathStateV1): PlannedGitPathStateV1 {
  if (state.state === "regular_file") return { state: "regular_file", hash: state.hash, size: state.size, mode: state.mode, semantic: state.semantic };
  if (state.state === "directory_tree") {
    return { state: "directory_tree", treeHash: state.treeHash, entryCount: state.entryCount, ownerUid: state.ownerUid, mode: state.mode, symbolicHead: state.symbolicHead };
  }
  return { state: "absent" };
}

async function guardedPreimage(path: CanonicalAbsolutePathV1, semantic: { readonly kind: "none" } | { readonly kind: "oid"; readonly value: LowerHexSha1 }): Promise<{ readonly state: GuardedGitPathStateV1; readonly bytes: Uint8Array | null }> {
  const stats = await lstat(path, { bigint: true }).catch(() => null);
  if (stats === null) return { state: { state: "absent" }, bytes: null };
  if (!stats.isFile() || stats.size > BigInt(MAX_GIT_CONTROL_BYTES)) recoveryRequired("concurrent_change", path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Uint8Array;
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== stats.dev || opened.ino !== stats.ino) recoveryRequired("concurrent_change", path);
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  return {
    state: {
      state: "regular_file",
      hash: sha256(bytes),
      size: bytes.byteLength,
      mode: Number(stats.mode & 0o777n),
      dev: parseUInt64Decimal(stats.dev.toString(10)),
      ino: parseUInt64Decimal(stats.ino.toString(10)),
      semantic,
    },
    bytes,
  };
}

interface EffectRootV1 {
  readonly quarantineRoot: CanonicalAbsolutePathV1;
  evidence(root: "post" | "before" | "after", index: number): CanonicalAbsolutePathV1;
}

async function createEffectRoot(
  productHome: CanonicalAbsolutePathV1,
  coordinatorId: string,
  side: "source" | "destination",
  id: string,
): Promise<EffectRootV1> {
  const git = join(productHome, "staging", "lifecycle", coordinatorId, "git");
  for (const directory of [git, join(git, side)]) {
    if ((await lstat(directory).catch(() => null)) === null) await mkdirOwned(directory);
  }
  const quarantineRoot = canonical(join(git, side, id));
  await mkdirOwned(quarantineRoot);
  return {
    quarantineRoot,
    evidence: (root, index) => canonical(join(quarantineRoot, root, index.toString(10))),
  };
}

async function ensureDirectory(path: string): Promise<void> {
  if ((await lstat(path).catch(() => null)) === null) await mkdirOwned(path);
}

/** Stages one regular-file transition's postimage; tombstone paths follow §2.4's closed evidence rule. */
async function stageRegularTransition(
  root: EffectRootV1,
  index: number,
  role: GitEffectTransitionV1["role"],
  path: CanonicalAbsolutePathV1,
  before: GuardedGitPathStateV1,
  bytes: Uint8Array,
  mode: number,
  semantic: { readonly kind: "none" } | { readonly kind: "oid"; readonly value: LowerHexSha1 },
): Promise<GitEffectTransitionV1> {
  await ensureDirectory(join(root.quarantineRoot, "post"));
  const staged = await stagedRegular(root.evidence("post", index), bytes, mode, semantic);
  const relinquishable = role === "source_object" || role === "destination_pack" || role === "destination_index";
  const operation = before.state === "absent" ? "create" : "replace";
  return {
    role,
    path,
    operation,
    before,
    after: plannedOf(staged),
    evidence: {
      stagedPostimagePath: root.evidence("post", index),
      stagedPostimage: staged,
      beforeTombstonePath: operation === "replace" ? root.evidence("before", index) : null,
      afterTombstonePath: operation === "replace" || !relinquishable ? root.evidence("after", index) : null,
    },
  };
}

/** Rebinds a transition's evidence to its staged position in the effect plan. */
async function publishGitEffectPlan(lifecycle: CliLifecycleContext, plan: GitEffectPlanV1): Promise<LowerHexSha256> {
  const codec = createGitEffectLedgerCodec(lifecycle.effectiveUid);
  const validated = validateGitEffectPlan(JSON.parse(codec.plan.encode(plan)) as unknown, lifecycle.effectiveUid);
  const bytes = encoder.encode(codec.plan.encode(validated));
  if (bytes.byteLength > MAX_PLAN_BYTES) refuse("git_plan_too_large", EXIT_CODES.capabilityUnavailable);
  const journalRoot = lifecycle.roots.gitEffectJournals;
  // identity-free stat: the guarded port already returns an exact decimal identity.
  const root = await lifecycle.fs.lstat(journalRoot);
  if (root === null) recoveryRequired("lifecycle_effect_root_missing", journalRoot);
  const path = canonical(join(journalRoot, `${validated.id}.plan.json`));
  if ((await lifecycle.fs.lstat(path)) !== null) recoveryRequired("lifecycle_effect_plan_exists", path);
  const temp = await lifecycle.fs.writeExclusive(canonical(join(journalRoot, `.${validated.id}.${lifecycle.uuid()}.plan.json.tmp`)), bytes);
  await lifecycle.fs.renameNoReplace(temp, path);
  await lifecycle.fs.syncDirectory(root);
  return gitEffectPlanHash(validated);
}

function effectPlanOf(
  unbound: Omit<GitEffectPlanV1, "maximumJournalBytes">,
  effectiveUid: number,
): { readonly plan: GitEffectPlanV1; readonly planHash: LowerHexSha256 } {
  const plan = validateGitEffectPlan(
    JSON.parse(encodeCanonicalJson(json({ ...unbound, maximumJournalBytes: maximumGitEffectJournalBytes(unbound) }))) as unknown,
    effectiveUid,
  );
  return { plan, planHash: gitEffectPlanHash(plan) };
}

/** The enable-only `.git`, built in quarantine and fingerprinted exactly as the effect executor re-walks it. */
async function stageInitialTree(
  root: EffectRootV1,
  branch: string,
  url: string,
  effectiveUid: number,
): Promise<GuardedGitPathStateV1> {
  const initial = planInitialGitDirectory(parseValidatedGitBranch(branch), url as never);
  await ensureDirectory(join(root.quarantineRoot, "post"));
  const tree = root.evidence("post", 0);
  await mkdirOwned(tree, 0o755);
  for (const entry of initial.entries) {
    const path = join(tree, entry.relativePath);
    if (entry.bytes === null) await mkdirOwned(path, entry.mode);
    else await writeOwned(path, entry.bytes, entry.mode);
  }
  const entries = [];
  for (const entry of initial.entries) {
    const identity = await identityOf(join(tree, entry.relativePath));
    const common = { relativePath: entry.relativePath, ownerUid: identity.ownerUid, mode: identity.mode, dev: identity.dev, ino: identity.ino };
    entries.push(entry.bytes === null ? { ...common, kind: "directory" } : { ...common, kind: "regular_file", nlink: 1, size: identity.size, hash: sha256(entry.bytes) });
  }
  const rootIdentity = await identityOf(tree);
  const fingerprint = validateGitTreeFingerprint(
    { root: { ownerUid: rootIdentity.ownerUid, mode: rootIdentity.mode, dev: rootIdentity.dev, ino: rootIdentity.ino }, entries },
    effectiveUid,
  );
  return {
    state: "directory_tree",
    treeHash: gitTreeFingerprintHash(fingerprint),
    entryCount: fingerprint.entries.length,
    ownerUid: fingerprint.root.ownerUid,
    mode: rootIdentity.mode,
    dev: fingerprint.root.dev,
    ino: fingerprint.root.ino,
    symbolicHead: parseFullBranchRef(`refs/heads/${branch}`),
  };
}

// ---------------------------------------------------------------------------------------------
// Coordinator plumbing

function allocatedIdsFrom(snapshot: LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>): readonly string[] {
  return [...snapshot.coordinators.map((record) => record.id as string), ...[...snapshot.foundation.journals.keys()].map(String)].filter((id) => {
    try {
      allocatedCounterOf(id);
      return true;
    } catch {
      return false;
    }
  });
}

export type NetworkPushV1 = NonNullable<LifecycleParticipantAdaptersV1<LifecycleExecutionPlanV1>["networkPush"]>;

/** Recovery never pushes: a bound network push is consumed only by `git sync`'s retry. */
export const NO_PUSH: NetworkPushV1 = { push: () => Promise.resolve("failed") };

export function gitAdapters(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  networkPush: NetworkPushV1,
): LifecycleParticipantAdaptersV1<LifecycleExecutionPlanV1> {
  const unsupported = (file: string): Promise<void> =>
    Promise.reject(new GitCommandRefusal("lifecycle_control_file_removal_unsupported", EXIT_CODES.capabilityUnavailable, [join(context.paths.stateDir, file)]));
  return {
    foundation: new FoundationParticipantExecutor({
      fs: lifecycle.fs,
      roots: lifecycle.roots,
      executor: new TransactionExecutor({
        stateDir: context.paths.stateDir,
        stagingDir: context.paths.stagingDir,
        backupsDir: context.paths.backupsDir,
        fs: context.fs,
        clock: () => context.now().toISOString(),
        generateId: () => {
          throw new Error("the Git coordinator allocates every Foundation transaction ID");
        },
        guards: context.guards.transaction,
        lockProvider: lifecycle.transactionLocks,
        publishBootstrapInitialJournalNoReplace: lifecycle.renameNoReplace,
      }),
      effectiveUid: lifecycle.effectiveUid,
    }),
    manifest: createLifecycleManifestAdapter(lifecycle, gateManifestAdmission(context)),
    redactionKey: null,
    ...createLifecycleEffectAdapters(lifecycle, lifecycle.effectPorts()),
    networkPush,
    drainRunners: null,
    controlFiles: {
      removeAllocator: () => unsupported("lifecycle-id-allocator.json"),
      removeNonce: () => unsupported("lifecycle-install-nonce"),
    },
  };
}

export interface PreparedV1 {
  readonly home: GitHomeV1;
  readonly residue: LifecycleBookkeepingResidueV1;
  readonly snapshot: LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>;
}

async function requireLifecycleStagingRoot(lifecycle: CliLifecycleContext, context: CliContext): Promise<void> {
  const root = lifecycle.roots.lifecycleStaging;
  // identity-free stat: the guarded port already returns an exact decimal identity.
  if ((await lifecycle.fs.lstat(root)) !== null) return;
  await lifecycle.fs.mkdirExclusive(root);
  const parent = await lifecycle.fs.lstat(canonical(context.paths.stagingDir));
  if (parent === null) recoveryRequired("lifecycle_guarded_parent", context.paths.stagingDir);
  await lifecycle.fs.syncDirectory(parent);
}

function requireGlobal(context: CliContext, global: HeldLifecycleStableLockV1): void {
  if (global.path !== join(context.paths.stateDir, GLOBAL_LOCK_LEAF)) {
    refuse("lifecycle_lock_identity", EXIT_CODES.recoveryRequired, [global.path]);
  }
}

/** Under the caller's global lock: re-admit, run the recovery pass and settle what can settle. */
export async function prepareUnderLock(context: CliContext, lifecycle: CliLifecycleContext, global: HeldLifecycleStableLockV1): Promise<PreparedV1> {
  requireGlobal(context, global);
  const home = await observeHome(context, lifecycle);
  if (home.admitted.globalLock.dev !== global.dev || home.admitted.globalLock.ino !== global.ino) {
    refuse("lifecycle_lock_identity", EXIT_CODES.recoveryRequired, [global.path], "developer-os doctor");
  }
  await requireLifecycleStagingRoot(lifecycle, context);
  const residue = await residueOf(context);
  const recovered = await lifecycle.recovery(home.key, gitAdapters(context, lifecycle, NO_PUSH), residue).recover(global, { resumeUninstall: false });
  if (recovered.global !== global) recoveryRequired("lifecycle_lock_identity", global.path);
  return { home: await observeHome(context, lifecycle), residue, snapshot: recovered.snapshot };
}

export function requireClear(prepared: PreparedV1, paths: { readonly home: string }): void {
  if (prepared.snapshot.closure.kind !== "clear") {
    refuse("lifecycle_closure_unresolved", EXIT_CODES.recoveryRequired, [paths.home], "developer-os doctor");
  }
}

export async function reserveIds(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  global: HeldLifecycleStableLockV1,
  snapshot: LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>,
  prefixes: readonly LifecycleIdPrefixV1[],
): Promise<readonly string[]> {
  const block = await reserveLifecycleIdBlock(
    {
      fs: lifecycle.fs,
      stateDirectory: canonical(context.paths.stateDir),
      effectiveUid: lifecycle.effectiveUid,
      uuid: lifecycle.uuid,
      held: global,
      allocatedIds: allocatedIdsFrom(snapshot),
    },
    prefixes.length,
  );
  return prefixes.map((prefix, index) => formatAllocatedLifecycleId(prefix, block.nonce, block.firstCounter + BigInt(index)));
}

/** Spec §2.4's reservation order, read off the builder's own placeholder plan. */
export function prefixesOf(builder: LifecycleExecutionBuilderV1<LifecycleExecutionPlanV1>): readonly LifecycleIdPrefixV1[] {
  const placeholders = Array.from({ length: builder.slotCount }, (_unused, index) => `tx_${"f".repeat(64)}_${String(index)}`);
  return lifecycleReservationOrder(builder.build(placeholders).plan).map((slot) => slot.prefix);
}

/**
 * The pre-intent quarantine of a reservation whose plan never became durable, removed child
 * first without following a link: a symlink is unlinked as itself, and a foreign-owned entry
 * refuses rather than being removed.
 */
async function removeOwnedTree(path: string, effectiveUid: number): Promise<void> {
  const stats = await lstat(path, { bigint: true }).catch(() => null);
  if (stats === null) return;
  if (Number(stats.uid) !== effectiveUid) recoveryRequired("lifecycle_staging_shape", path);
  if (!stats.isDirectory()) {
    await unlink(path);
    return;
  }
  for (const name of await readdir(path)) await removeOwnedTree(join(path, name), effectiveUid);
  await rmdir(path);
}

export async function destroyUnpublishedStaging(productHome: string, coordinatorId: string, effectiveUid: number): Promise<void> {
  await removeOwnedTree(join(productHome, "staging", "lifecycle", coordinatorId), effectiveUid);
}

async function executeCoordinator(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  key: LifecycleHomeKeyV1,
  id: LifecycleCoordinatorIdV1,
  global: HeldLifecycleStableLockV1,
  networkPush: NetworkPushV1,
): Promise<"finalized" | "push_pending"> {
  const coordinator = new LifecycleCoordinator<LifecycleExecutionPlanV1>({
    store: lifecycle.store(key),
    adapters: gitAdapters(context, lifecycle, networkPush),
    variantFacts: lifecycleVariantFacts,
    pushPlanHash: lifecyclePushPlanHash,
    clock: lifecycle.clock,
    fs: lifecycle.fs,
  });
  const result = await coordinator.execute(id, global);
  if (result.outcome.kind === "rolled_back") {
    refuse("git_lifecycle_rolled_back", EXIT_CODES.recoveryRequired, [key.productHome], "developer-os git status");
  }
  return result.outcome.kind;
}

export async function settle(context: CliContext, lifecycle: CliLifecycleContext, key: LifecycleHomeKeyV1, residue: LifecycleBookkeepingResidueV1, global: HeldLifecycleStableLockV1): Promise<void> {
  await lifecycle.recovery(key, gitAdapters(context, lifecycle, NO_PUSH), residue).recover(global, { resumeUninstall: false });
}

/** D54: a manifest the coordinator rewrote keeps its anchor current; a failure only warns. */
export async function reanchorManifest(context: CliContext, lifecycle: CliLifecycleContext, beforeHash: LowerHexSha256, afterBytes: Uint8Array): Promise<void> {
  try {
    const anchor = await readManifestAnchor(lifecycle.fs, context.paths.home, lifecycle.effectiveUid);
    if (anchor.kind !== "anchored" || anchor.manifestHash !== beforeHash) return;
    await writeManifestAnchor(lifecycle.fs, context.paths.home, context.paths.stateDir, lifecycle.effectiveUid, {
      manifestHash: sha256(afterBytes),
      bootstrapManifestHash: anchor.bootstrapManifestHash,
    });
  } catch (error) {
    if (isCodeDefect(error)) throw error;
    context.io.stderr(MANIFEST_ANCHOR_WARNING);
  }
}

// ---------------------------------------------------------------------------------------------
// Enable / reconcile / disable execution

interface LifecycleApplyInputsV1 {
  readonly home: GitHomeV1;
  readonly preview: LifecyclePlanPreviewV1;
  readonly operation: "git_enable" | "git_reconcile" | "git_disable";
  readonly files: LifecycleFilesV1;
  readonly createdAt: UtcTimestampV1;
  staged: null | {
    readonly foundation: readonly FoundationParticipantRefV1[];
    readonly source: { readonly id: string; readonly planHash: LowerHexSha256 } | null;
    readonly payload: { readonly dev: string; readonly ino: string };
  };
}

function manifestLeaf(inputs: LifecycleApplyInputsV1, coordinatorId: string, participantId: string, forwardIds: readonly string[], source: { readonly id: string; readonly planHash: LowerHexSha256 } | null): ManifestStatePlanV1 {
  const { home } = inputs;
  const before = home.manifestFile.entry;
  const payload = inputs.staged?.payload ?? { dev: WIDEST_UINT64, ino: WIDEST_UINT64 };
  return {
    schemaVersion: 1,
    participantId: participantId as ManifestStatePlanV1["participantId"],
    envelope: { kind: "lifecycle", id: coordinatorId as LifecycleCoordinatorIdV1 },
    bindings: {
      foundationTransactions: { count: forwardIds.length, orderedIdsHash: foundationBindingsHash(forwardIds) },
      externalEffects: source === null ? [] : [{ kind: "git", id: source.id, planHash: source.planHash }],
    },
    manifestPath: home.authority.manifestPath,
    tombstonePath: canonical(join(dirname(home.authority.manifestPath), `.installation-manifest.${participantId}.json.tombstone`)),
    before: {
      state: "present",
      hash: home.manifestFile.hash,
      bytes: null,
      ownerUid: before.ownerUid,
      mode: 0o600,
      nlink: 1,
      size: before.size,
      dev: before.dev,
      ino: before.ino,
    },
    after: {
      state: "present",
      hash: sha256(inputs.files.manifest),
      bytes: {
        kind: "update_expected",
        coordinatorId: coordinatorId as LifecycleCoordinatorIdV1,
        ordinal: 0,
        path: deriveManifestPayloadPath(home.key.productHome, coordinatorId as never, participantId as never),
        hash: sha256(inputs.files.manifest),
        bytes: inputs.files.manifest.byteLength,
        mode: 0o600,
      },
      ownerUid: before.ownerUid,
      mode: 0o600,
      nlink: 1,
      size: parseUInt64Decimal(String(inputs.files.manifest.byteLength)),
      dev: parseUInt64Decimal(payload.dev),
      ino: parseUInt64Decimal(payload.ino),
    },
    maximumPlanBytes: MAX_PLAN_BYTES,
    maximumJournalBytes: MAX_JOURNAL_BYTES,
  };
}

function placeholderFoundation(
  productHome: CanonicalAbsolutePathV1,
  coordinatorId: string,
  id: string,
  slot: FoundationParticipantRefV1["slot"],
  role: FoundationParticipantRefV1["role"],
  targetPath: CanonicalAbsolutePathV1,
  contentSize: number,
): FoundationParticipantRefV1 {
  return {
    id: id as FoundationParticipantRefV1["id"],
    slot,
    role,
    mutations: [{ targetPath, operation: "replace", expectedBeforeHash: WIDEST_HASH, contentHash: WIDEST_HASH, contentSize, stagedPath: canonical(`${productHome}/staging/transactions/${id}/0.bin`) }],
    maximumJournalBytes: MAX_JOURNAL_BYTES,
    planHash: WIDEST_HASH,
    initialJournal: {
      finalPath: canonical(`${productHome}/state/transactions/${id}.json`),
      plannedBytesHash: WIDEST_HASH,
      stagedPath: canonical(`${productHome}/staging/lifecycle/${coordinatorId}/foundation/${id}/journal.json`),
      stagedIdentity: { hash: WIDEST_HASH, size: MAX_JOURNAL_BYTES, mode: 384, dev: WIDEST_UINT64, ino: WIDEST_UINT64 },
    },
  };
}

const LIFECYCLE_RESERVATION: LifecycleLeafReservationV1 = {
  foundationJournals: 9,
  coordinatorJournals: 3,
  gitEffectJournals: 3,
  launchdEffectJournals: 0,
  foundationStaging: 12,
  foundationBackups: 18,
  lifecycleStaging: 2 + 2 * 3 + 4 + 5 + 1100,
};

function lifecycleBuilder(inputs: LifecycleApplyInputsV1): LifecycleExecutionBuilderV1<LifecycleExecutionPlanV1> {
  const withSource = inputs.operation !== "git_disable";
  return {
    slotCount: withSource ? 6 : 5,
    build(ids) {
      const [coordinatorId, activation, activationCompensation, config] = ids.map(String) as [string, string, string, string];
      const source = withSource ? String(ids[4]) : null;
      const participantId = String(ids.at(-1));
      const { authority } = inputs.home;
      const foundation =
        inputs.staged?.foundation ??
        [
          placeholderFoundation(authority.productHome, coordinatorId, activation, "activation", { kind: "forward", compensationId: activationCompensation as AllocatedLifecycleIdV1<"tx"> }, authority.activationPath, inputs.files.activation.byteLength),
          placeholderFoundation(authority.productHome, coordinatorId, activationCompensation, "activation", { kind: "compensation", forwardId: activation as AllocatedLifecycleIdV1<"tx"> }, authority.activationPath, inputs.files.activation.byteLength),
          placeholderFoundation(authority.productHome, coordinatorId, config, "config", { kind: "forward", compensationId: null }, authority.configPath, inputs.files.config.byteLength),
        ];
      const sourceRef = source === null ? null : (inputs.staged?.source ?? { id: source, planHash: WIDEST_HASH });
      const steps: LifecycleCoordinatorStepV1[] = [
        { kind: "manifest", transition: "preserve_before" },
        { kind: "foundation", slot: "activation", participantId: activation as AllocatedLifecycleIdV1<"tx"> },
        { kind: "manifest", transition: "publish_after" },
        ...(sourceRef === null ? [] : [{ kind: "source_git_effect" as const, participantId: sourceRef.id as GitEffectIdV1 }]),
        { kind: "foundation", slot: "config", participantId: config as AllocatedLifecycleIdV1<"tx"> },
        { kind: "manifest", transition: "finalize_tombstones" },
      ];
      const base: LifecycleExecutionPlanV1 = {
        schemaVersion: 1,
        id: coordinatorId as LifecycleCoordinatorIdV1,
        previewHash: inputs.preview.previewHash,
        operation: inputs.operation,
        maximumJournalBytes: 1,
        authority: { ...authority, repositoryRoot: inputs.preview.git?.repositoryRoot ?? null, plistPaths: [] },
        participants: {
          foundation: [...foundation].sort((left, right) => Buffer.compare(Buffer.from(left.id), Buffer.from(right.id))),
          manifest: manifestLeaf(inputs, coordinatorId, participantId, [activation, config], sourceRef),
          sourceGitEffect: sourceRef === null ? null : { id: sourceRef.id as GitEffectIdV1, planHash: sourceRef.planHash },
          destinationGitEffect: null,
          launchdBeforeFiles: null,
          launchdAfterFiles: null,
          launchd: null,
          redactionKey: null,
        },
        push: null,
        steps,
      };
      return { plan: { ...base, maximumJournalBytes: maximumCoordinatorJournalBytes(base) }, reservation: LIFECYCLE_RESERVATION };
    },
  };
}

export async function stageManifestPayload(productHome: CanonicalAbsolutePathV1, coordinatorId: string, participantId: string, bytes: Uint8Array): Promise<{ readonly dev: string; readonly ino: string }> {
  const participants = join(productHome, "staging", "lifecycle", coordinatorId, "participants");
  const directory = join(participants, "manifest", participantId);
  for (const path of [participants, join(participants, "manifest"), directory]) await mkdirOwned(path);
  const path = deriveManifestPayloadPath(productHome, coordinatorId as never, participantId as never);
  await writeOwned(path, bytes, 0o600);
  const identity = await identityOf(path);
  return { dev: identity.dev, ino: identity.ino };
}

/** §4.1: initialize publishes the minimal tree, adopt adds only the absent fixed remote; otherwise nothing moves. */
async function stageEnableEffect(
  lifecycle: CliLifecycleContext,
  runtime: GitRuntimeV1,
  inputs: LifecycleApplyInputsV1,
  coordinatorId: string,
  id: string,
): Promise<{ readonly plan: GitEffectPlanV1; readonly planHash: LowerHexSha256 }> {
  const git = inputs.preview.git as GitPlanPreviewV1;
  const root = await createEffectRoot(inputs.home.key.productHome, coordinatorId, "source", id);
  const gitDirectory = canonical(`${git.repositoryRoot}/.git`);
  const transitions: GitEffectTransitionV1[] = [];
  if (git.repositoryMode === "initialize") {
    const staged = await stageInitialTree(root, git.branch, git.remote.declaredUrl, lifecycle.effectiveUid);
    transitions.push({
      role: "source_git_directory_tree",
      path: gitDirectory,
      operation: "create",
      before: { state: "absent" },
      after: plannedOf(staged),
      evidence: { stagedPostimagePath: root.evidence("post", 0), stagedPostimage: staged, beforeTombstonePath: null, afterTombstonePath: null },
    });
  } else {
    const configChange = git.changes.find((change) => change.targetPath === `${gitDirectory}/config` && change.operation === "replace");
    if (configChange !== undefined) {
      const configPath = canonical(`${gitDirectory}/config`);
      const before = await guardedPreimage(configPath, { kind: "none" });
      if (before.bytes === null || before.state.state !== "regular_file" || configChange.before.state !== "present" || before.state.hash !== configChange.before.hash) {
        refuse("lifecycle_preview_stale", EXIT_CODES.decisionRequired, [configPath], "developer-os git enable --remote <url>");
      }
      const after = appendGitRemoteSection(before.bytes, git.remote.declaredUrl);
      transitions.push(await stageRegularTransition(root, 0, "source_config", configPath, before.state, after, before.state.mode, { kind: "none" }));
    }
  }
  return effectPlanOf(
    {
      schemaVersion: 1,
      id: id as GitEffectIdV1,
      coordinatorId: coordinatorId as LifecycleCoordinatorIdV1,
      side: "source",
      worktreeRoot: git.repositoryRoot,
      gitDirectory,
      quarantineRoot: root.quarantineRoot,
      processTableHash: runtime.processTableHash,
      planningTranscriptHash: sha256(encodeCanonicalJson(json(transitions.map((transition) => transition.after)))),
      reflogPlan: null,
      packReaderBudget: null,
      pushSourceProjection: null,
      transitions,
    },
    lifecycle.effectiveUid,
  );
}

async function stageLifecycleFoundation(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  inputs: LifecycleApplyInputsV1,
  coordinatorId: LifecycleCoordinatorIdV1,
  [activation, activationCompensation, config]: readonly string[],
): Promise<readonly FoundationParticipantRefV1[]> {
  const foundation = gitAdapters(context, lifecycle, NO_PUSH).foundation;
  const { home, files, createdAt } = inputs;
  const activationBefore = home.activationFile.bytes;
  const stage = (id: string | undefined, slot: FoundationParticipantRefV1["slot"], role: FoundationParticipantRefV1["role"], mutations: Parameters<FoundationParticipantExecutor["stage"]>[0]["mutations"]): Promise<FoundationParticipantRefV1> =>
    foundation.stage({ coordinatorId, id: id as FoundationTransactionIdV1, slot, role, createdAt, mutations });
  return [
    await stage(activation, "activation", { kind: "forward", compensationId: activationCompensation as AllocatedLifecycleIdV1<"tx"> }, [
      {
        targetPath: home.authority.activationPath,
        operation: activationBefore === null ? "create" : "replace",
        expectedBeforeHash: home.activationFile.hash,
        content: files.activation,
      },
    ]),
    await stage(activationCompensation, "activation", { kind: "compensation", forwardId: activation as AllocatedLifecycleIdV1<"tx"> }, [
      {
        targetPath: home.authority.activationPath,
        operation: activationBefore === null ? "remove" : "replace",
        expectedBeforeHash: sha256(files.activation),
        content: activationBefore,
      },
    ]),
    await stage(config, "config", { kind: "forward", compensationId: null }, [
      { targetPath: home.authority.configPath, operation: "replace", expectedBeforeHash: home.configFile.hash, content: files.config },
    ]),
  ];
}

// ---------------------------------------------------------------------------------------------
// Sync

interface BareDestinationV1 {
  readonly gitDirectory: CanonicalAbsolutePathV1;
  readonly configHash: LowerHexSha256;
  readonly headBytes: Uint8Array;
  readonly head: GitHeadStateV1;
  readonly targetRef: GitRefStateV1;
  readonly targetRefEntry: GuardedGitPathStateV1;
  readonly targetReflog: GitReflogStateV1;
  readonly targetReflogBytes: Uint8Array | null;
  readonly targetReflogEntry: GuardedGitPathStateV1;
}

async function observeBareDestination(gitDirectory: CanonicalAbsolutePathV1, branchRef: FullBranchRefV1): Promise<BareDestinationV1> {
  await requireBareRepository(gitDirectory);
  if ((await lstat(join(gitDirectory, "packed-refs")).catch(() => null)) !== null) {
    refuse("unsupported_repository_layout", EXIT_CODES.capabilityUnavailable, [gitDirectory]);
  }
  const config = await guardedPreimage(canonical(`${gitDirectory}/config`), { kind: "none" });
  const head = await guardedPreimage(canonical(`${gitDirectory}/HEAD`), { kind: "none" });
  if (config.bytes === null || head.bytes === null) refuse("git_remote_not_bare", EXIT_CODES.invalidInput, [gitDirectory]);
  const headText = new TextDecoder().decode(head.bytes);
  const symbolic = /^ref: (refs\/heads\/[^\n]+)\n$/u.exec(headText)?.[1];
  const detached = /^([0-9a-f]{40})\n$/u.exec(headText)?.[1];
  const headState = validateGitHeadState({
    state: "present",
    bytesHash: sha256(head.bytes),
    semantic: symbolic !== undefined ? { kind: "symbolic_ref", value: symbolic } : { kind: "oid", value: detached ?? refuse("unsupported_repository_layout", EXIT_CODES.capabilityUnavailable, [gitDirectory]) },
  });
  const refPath = canonical(`${gitDirectory}/${branchRef}`);
  const refProbe = await guardedPreimage(refPath, { kind: "none" });
  let targetRef: GitRefStateV1 = { state: "absent" };
  let targetRefEntry: GuardedGitPathStateV1 = { state: "absent" };
  if (refProbe.bytes !== null && refProbe.state.state === "regular_file") {
    const oid = /^([0-9a-f]{40})\n$/u.exec(new TextDecoder().decode(refProbe.bytes))?.[1];
    if (oid === undefined) refuse("unsupported_repository_layout", EXIT_CODES.capabilityUnavailable, [refPath]);
    targetRef = { state: "present", oid: parseLowerHexSha1(oid), bytesHash: sha256(refProbe.bytes) };
    targetRefEntry = { ...refProbe.state, semantic: { kind: "oid", value: parseLowerHexSha1(oid) } };
  }
  const reflog = await guardedPreimage(canonical(`${gitDirectory}/logs/${branchRef}`), { kind: "none" });
  return {
    gitDirectory,
    configHash: sha256(config.bytes),
    headBytes: head.bytes,
    head: headState,
    targetRef,
    targetRefEntry,
    targetReflog: reflog.bytes === null ? { state: "absent" } : { state: "present", bytesHash: sha256(reflog.bytes), size: reflog.bytes.byteLength },
    targetReflogBytes: reflog.bytes,
    targetReflogEntry: reflog.state,
  };
}

/**
 * §4.5 "non-fast-forward push": the destination tip must be the pushed commit or reachable from
 * `start` — the new commit's parent, which is already in the source repository, or the tip itself.
 */
async function requireFastForward(
  runtime: GitRuntimeV1,
  gitDirectory: CanonicalAbsolutePathV1,
  pushed: LowerHexSha1,
  start: LowerHexSha1 | null,
  target: GitRefStateV1,
): Promise<void> {
  if (target.state === "absent" || target.oid === pushed) return;
  const queue: LowerHexSha1[] = start === null ? [] : [start];
  const seen = new Set<string>();
  while (queue.length > 0 && seen.size < MAX_FAST_FORWARD_WALK) {
    const next = queue.shift() as LowerHexSha1;
    if (next === target.oid) return;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(await runtime.commitParents(gitDirectory, next)));
  }
  refuse("non_fast_forward", EXIT_CODES.decisionRequired, [], "resolve the destination branch history by hand, then run developer-os git sync");
}

/** Spec §4.5: a local destination on another device than product staging cannot be renamed into. */
async function requireSameDevice(productHome: CanonicalAbsolutePathV1, gitDirectory: CanonicalAbsolutePathV1): Promise<void> {
  const staging = await lstat(join(productHome, "staging"), { bigint: true });
  const destination = await lstat(gitDirectory, { bigint: true });
  if (staging.dev !== destination.dev) refuse("cross_device_git_state", EXIT_CODES.capabilityUnavailable, [gitDirectory]);
}

/** The repository's own `user.name`/`user.email`; the shadows read no global config. */
async function committerOf(context: CliContext, gitDirectory: CanonicalAbsolutePathV1): Promise<GitCommitterV1> {
  const config = await guardedPreimage(canonical(`${gitDirectory}/config`), { kind: "none" });
  const text = config.bytes === null ? "" : new TextDecoder().decode(config.bytes);
  let section = "";
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const header = /^\s*\[([^\]]+)\]\s*$/u.exec(line)?.[1];
    if (header !== undefined) {
      section = header.trim().toLowerCase();
      continue;
    }
    const pair = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*?)\s*$/u.exec(line);
    if (section === "user" && pair !== null) values[(pair[1] ?? "").toLowerCase()] = (pair[2] ?? "").replace(/^"(.*)"$/u, "$1");
  }
  const name = values.name;
  const email = values.email;
  if (name === undefined || email === undefined || name === "" || email === "") {
    refuse("git_identity_missing", EXIT_CODES.invalidInput, [gitDirectory], "git config user.name and user.email in the Brain repository");
  }
  return { name, email, unixSeconds: Math.floor(context.now().getTime() / 1000), utcOffset: "+0000" };
}

function candidateOf(draft: GitSyncPlanningDraft, committer: GitCommitterV1): GitCandidateObjectsV1 {
  const blobs = draft.objects
    .filter((planned) => planned.object.type === "blob")
    .map((planned) => ({ oid: planned.object.oid, content: planned.object.raw.subarray(planned.object.raw.indexOf(0) + 1) }));
  const trees = [...draft.trees]
    .sort((left, right) => right.directory.byteLength - left.directory.byteLength)
    .map((node) => ({ oid: node.object.oid, mktreeInput: node.mktreeInput }));
  const commit = draft.sync.commit;
  return {
    blobs,
    trees,
    commit: commit === null ? null : { oid: commit.commitOid, treeOid: draft.sync.candidateTreeOid, parentOid: commit.parentOid, committer },
  };
}

/** Stages every planned source transition; reflog postimages are the exact preimage plus the one planned line. */
async function stageSourceEffect(
  lifecycle: CliLifecycleContext,
  runtime: GitRuntimeV1,
  draft: GitSyncPlanningDraft,
  productHome: CanonicalAbsolutePathV1,
  coordinatorId: string,
  id: string,
): Promise<{ readonly plan: GitEffectPlanV1; readonly planHash: LowerHexSha256 }> {
  const root = await createEffectRoot(productHome, coordinatorId, "source", id);
  const objects = new Map(draft.objects.map((planned) => [planned.path as string, planned.looseBytes]));
  const appends = draft.reflogPlan === null || draft.reflogPlan.side !== "source" ? [] : [draft.reflogPlan.head, draft.reflogPlan.branch];
  const transitions: GitEffectTransitionV1[] = [];
  for (const [index, planned] of draft.transitions.entries()) {
    if (planned.operation === "reuse") {
      transitions.push(planned);
      continue;
    }
    let bytes: Uint8Array;
    if (planned.role === "source_object") {
      bytes = objects.get(planned.path) ?? recoveryRequired("git_plan_object_missing", planned.path);
    } else if (planned.role === "source_index") {
      bytes = draft.candidateIndex ?? recoveryRequired("git_plan_index_missing", planned.path);
    } else if (planned.role === "source_branch_ref") {
      bytes = encoder.encode(`${draft.sync.commit?.commitOid ?? ""}\n`);
    } else {
      const append = appends.find((candidate) => candidate?.path === planned.path) ?? recoveryRequired("reflog_bijection", planned.path);
      const prior = (await guardedPreimage(planned.path, { kind: "none" })).bytes ?? new Uint8Array(0);
      bytes = Buffer.concat([prior, Buffer.from(gitReflogAppendLine(append))]);
    }
    const after = planned.after;
    if (after.state !== "regular_file" || sha256(bytes) !== after.hash) recoveryRequired("concurrent_change", planned.path);
    transitions.push(await stageRegularTransition(root, index, planned.role, planned.path, planned.before, bytes, after.mode, after.semantic.kind === "oid" ? { kind: "oid", value: after.semantic.value } : { kind: "none" }));
  }
  return effectPlanOf(
    {
      schemaVersion: 1,
      id: id as GitEffectIdV1,
      coordinatorId: coordinatorId as LifecycleCoordinatorIdV1,
      side: "source",
      worktreeRoot: draft.sync.repositoryRoot,
      gitDirectory: canonical(`${draft.sync.repositoryRoot}/.git`),
      quarantineRoot: root.quarantineRoot,
      processTableHash: runtime.processTableHash,
      planningTranscriptHash: sha256(encodeCanonicalJson(json({ tree: draft.sync.candidateTreeOid, commit: draft.sync.commit }))),
      reflogPlan: draft.reflogPlan,
      packReaderBudget: null,
      pushSourceProjection: { before: draft.sync.sourcePreconditions, after: draft.sourceAfter },
      transitions,
    },
    lifecycle.effectiveUid,
  );
}

async function stageDestinationEffect(
  lifecycle: CliLifecycleContext,
  runtime: GitRuntimeV1,
  input: {
    readonly draft: GitSyncPlanningDraft;
    readonly commitOid: LowerHexSha1;
    readonly branchRef: FullBranchRefV1;
    readonly destination: BareDestinationV1;
    readonly committer: GitCommitterV1;
    readonly productHome: CanonicalAbsolutePathV1;
    readonly coordinatorId: string;
    readonly id: string;
    readonly sourceGitDirectory: CanonicalAbsolutePathV1;
  },
): Promise<{ readonly plan: GitEffectPlanV1; readonly planHash: LowerHexSha256 }> {
  const { destination, commitOid, branchRef } = input;
  const root = await createEffectRoot(input.productHome, input.coordinatorId, "destination", input.id);
  const prepared = await runtime.prepareLocalPush({
    sourceGitDirectory: input.sourceGitDirectory,
    candidate: candidateOf(input.draft, input.committer),
    commitOid,
    branchRef,
    destination: { gitDirectory: destination.gitDirectory, head: destination.headBytes, target: destination.targetRef },
    quarantineRoot: root.quarantineRoot,
    effectiveUid: lifecycle.effectiveUid,
  });
  const transitions: GitEffectTransitionV1[] = [...prepared.preparation.destinationTransitions];
  let reflogAppend: GitReflogAppendV1 | null = null;
  if (prepared.preparation.kind === "pack_received") {
    const oldOid = destination.targetRef.state === "present" ? destination.targetRef.oid : ZERO_OID;
    if (destination.targetReflogBytes !== null) {
      const line = gitReflogAppendLine({ oldOid, newOid: commitOid, committer: input.committer });
      const after = Buffer.concat([destination.targetReflogBytes, Buffer.from(line)]);
      reflogAppend = validateGitReflogAppend({
        role: "destination_branch_reflog",
        path: canonical(`${destination.gitDirectory}/logs/${branchRef}`),
        before: destination.targetReflog,
        oldOid,
        newOid: commitOid,
        committer: input.committer,
        message: REFLOG_MESSAGE,
        lineBytes: Buffer.byteLength(line),
        lineHash: sha256(line),
        after: { state: "present", bytesHash: sha256(after), size: after.byteLength },
      });
      const mode = destination.targetReflogEntry.state === "regular_file" ? destination.targetReflogEntry.mode : 0o644;
      transitions.push(await stageRegularTransition(root, transitions.length, "destination_branch_reflog", reflogAppend.path, destination.targetReflogEntry, after, mode, { kind: "none" }));
    }
    const refPath = canonical(`${destination.gitDirectory}/${branchRef}`);
    const mode = destination.targetRefEntry.state === "regular_file" ? destination.targetRefEntry.mode : 0o644;
    transitions.push(await stageRegularTransition(root, transitions.length, "destination_ref", refPath, destination.targetRefEntry, encoder.encode(`${commitOid}\n`), mode, { kind: "oid", value: commitOid }));
  }
  return effectPlanOf(
    {
      schemaVersion: 1,
      id: input.id as GitEffectIdV1,
      coordinatorId: input.coordinatorId as LifecycleCoordinatorIdV1,
      side: "destination",
      worktreeRoot: null,
      gitDirectory: destination.gitDirectory,
      quarantineRoot: root.quarantineRoot,
      processTableHash: runtime.processTableHash,
      planningTranscriptHash: prepared.planningTranscriptHash,
      reflogPlan: reflogAppend === null ? null : validateGitReflogPlan({ side: "destination", branch: reflogAppend }),
      packReaderBudget: prepared.preparation.packReaderBudget,
      pushSourceProjection: null,
      transitions,
    },
    lifecycle.effectiveUid,
  );
}

interface SyncInputsV1 {
  readonly home: GitHomeV1;
  readonly config: GitSyncConfigV1;
  readonly draft: GitSyncPlanningDraft;
  readonly record: SyncRecordV1;
  readonly createdAt: UtcTimestampV1;
  readonly destination: BareDestinationV1 | null;
  readonly processTableHash: LowerHexSha256;
  staged: null | {
    readonly foundation: FoundationParticipantRefV1;
    readonly source: { readonly id: string; readonly planHash: LowerHexSha256 } | null;
    readonly destination: { readonly id: string; readonly planHash: LowerHexSha256 } | null;
  };
}

/** The feasibility pass carries placeholder IDs, so only the bound plan is validated. */
function pushPlanOf(inputs: SyncInputsV1, destinationRef: { readonly id: string; readonly planHash: LowerHexSha256 }): PersistedGitPushPlanV1 {
  const { config, draft, destination } = inputs;
  if (destination === null) return recoveryRequired("unsupported_git_distribution", config.repositoryRoot);
  const plan = {
    schemaVersion: 1,
    repositoryRoot: config.repositoryRoot,
    branchRef: `refs/heads/${config.branch}`,
    commitOid: inputs.record.headOid,
    remoteName: "developer-os",
    sourceShadowConfigTemplateHash: GIT_SHADOW_TEMPLATE_HASHES.sourceLocal,
    destination: {
      transport: "local",
      effectivePushUrl: config.remote.effectivePushUrl,
      repositoryRoot: destination.gitDirectory,
      configHash: destination.configHash,
      head: destination.head,
      targetRef: destination.targetRef,
      targetReflog: destination.targetReflog,
      destinationShadowConfigTemplateHash: GIT_SHADOW_TEMPLATE_HASHES.destination,
      destinationGitEffect: destinationRef,
    },
    sourceBefore: draft.sync.sourcePreconditions,
    sourceAfter: draft.sourceAfter,
    distributionId: SUPPORTED_GIT_DISTRIBUTION.id,
    processTableHash: inputs.processTableHash,
  };
  return inputs.staged === null ? (plan as unknown as PersistedGitPushPlanV1) : PERSISTED_GIT_PUSH_PLAN_CODEC.validate(plan);
}

const SYNC_RESERVATION: LifecycleLeafReservationV1 = {
  foundationJournals: 3,
  coordinatorJournals: 3,
  gitEffectJournals: 6,
  launchdEffectJournals: 0,
  foundationStaging: 4,
  foundationBackups: 6,
  lifecycleStaging: 1_000_000,
};

function syncBuilder(inputs: SyncInputsV1, reservation: LifecycleLeafReservationV1): LifecycleExecutionBuilderV1<LifecycleExecutionPlanV1> {
  const newCommit = inputs.draft.kind === "commit";
  const pushed = inputs.draft.kind !== "no_changes";
  return {
    slotCount: 2 + (newCommit ? 1 : 0) + (pushed ? 1 : 0),
    build(ids) {
      const coordinatorId = String(ids[0]);
      const syncRecord = String(ids[1]);
      const sourceId = newCommit ? String(ids[2]) : null;
      const destinationId = pushed ? String(ids.at(-1)) : null;
      const { authority } = inputs.home;
      const foundation =
        inputs.staged?.foundation ??
        placeholderFoundation(authority.productHome, coordinatorId, syncRecord, "sync_record", { kind: "forward", compensationId: null }, syncRecordPath({ stateDir: `${authority.productHome}/state` }), encodeSyncRecord(inputs.record).byteLength);
      const source = sourceId === null ? null : (inputs.staged?.source ?? { id: sourceId, planHash: WIDEST_HASH });
      const destination = destinationId === null ? null : (inputs.staged?.destination ?? { id: destinationId, planHash: WIDEST_HASH });
      const push = destination === null ? null : pushPlanOf(inputs, destination);
      const pushPlanHash = push === null ? null : PERSISTED_GIT_PUSH_PLAN_CODEC.hash(push);
      const steps: LifecycleCoordinatorStepV1[] = [
        ...(source === null ? [] : [{ kind: "source_git_effect" as const, participantId: source.id as GitEffectIdV1 }]),
        ...(destination === null || pushPlanHash === null ? [] : [{ kind: "destination_git_effect" as const, participantId: destination.id as GitEffectIdV1, pushPlanHash }]),
        { kind: "foundation", slot: "sync_record", participantId: syncRecord as AllocatedLifecycleIdV1<"tx"> },
      ];
      const base: LifecycleExecutionPlanV1 = {
        schemaVersion: 1,
        id: coordinatorId as LifecycleCoordinatorIdV1,
        previewHash: null,
        operation: "git_sync",
        maximumJournalBytes: 1,
        authority: { ...authority, repositoryRoot: inputs.config.repositoryRoot, plistPaths: [] },
        participants: {
          foundation: [foundation],
          manifest: null,
          sourceGitEffect: source === null ? null : { id: source.id as GitEffectIdV1, planHash: source.planHash },
          destinationGitEffect: destination === null ? null : { id: destination.id as GitEffectIdV1, planHash: destination.planHash },
          launchdBeforeFiles: null,
          launchdAfterFiles: null,
          launchd: null,
          redactionKey: null,
        },
        push,
        steps,
      };
      return { plan: { ...base, maximumJournalBytes: maximumCoordinatorJournalBytes(base) }, reservation };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The service

export function createGitService(context: CliContext, lifecycle: CliLifecycleContext): GitService {
  const runtime = (): GitRuntimeV1 => lifecycle.effectPorts().gitRuntime;

  const previewEnable = async (request: GitEnableCliRequestV1): Promise<LifecyclePlanPreviewV1> => {
    const home = await observeHome(context, lifecycle);
    const scope = gitScopeOf(home.config);
    const recorded = home.config.git.lifecycle ?? null;
    const remote = await resolveRemote(request.remote, scope.brainPath);
    const branch = request.branch === null ? null : parseValidatedGitBranch(request.branch);
    const snapshot = await lifecycle.inspectLedger(home.key, await residueOf(context));
    const baseline = home.syncRecord !== null && home.syncRecord.repositoryRoot === scope.brainPath ? home.syncRecord : null;
    const git = await plannerFor(context, lifecycle, runtime(), home.config, scope).previewEnable({
      productHome: home.key.productHome,
      scope,
      remote,
      branch,
      recorded,
      baseline,
      pushPending: snapshot.closure.kind === "retry_only",
    });
    const config: GitSyncConfigV1 = { schemaVersion: 1, repositoryRoot: scope.brainPath, branch: git.branch, remote, scope };
    if (home.config.git.enabled && activationArm(home) === "active" && recorded !== null && sameJson(recorded, config)) {
      refuse("git_already_enabled", EXIT_CODES.invalidInput, [home.authority.configPath]);
    }
    const reconcile = recorded !== null && recorded.scope.fingerprint !== scope.fingerprint;
    const files = lifecycleFiles(home, config, true);
    admitManifestAfter(context, files.manifest);
    const preview = withPreviewHash({
      schemaVersion: 1,
      command: "git_enable",
      executionOperation: reconcile ? "git_reconcile" : "git_enable",
      normalizedProjection: { subsystem: "git", enabledAfter: true, lifecycle: config },
      authority: home.authority,
      processTableTemplateHashes: { git: runtime().processTableHash, launchd: null },
      files: previewFiles(home, files),
      git,
      launchd: null,
    });
    return lifecycle.codecs(home.key).preview.validate(JSON.parse(lifecycle.codecs(home.key).preview.encode(preview)));
  };

  const previewDisable = async (): Promise<LifecyclePlanPreviewV1> => {
    const home = await observeHome(context, lifecycle);
    const recorded = home.config.git.lifecycle;
    if (recorded === undefined || !home.config.git.enabled) {
      refuse("git_already_disabled", EXIT_CODES.invalidInput, [home.authority.configPath]);
    }
    const git = await plannerFor(context, lifecycle, runtime(), home.config, recorded.scope).previewDisable({ config: recorded });
    const files = lifecycleFiles(home, recorded, false);
    admitManifestAfter(context, files.manifest);
    const preview = withPreviewHash({
      schemaVersion: 1,
      command: "git_disable",
      executionOperation: "git_disable",
      normalizedProjection: { subsystem: "git", enabledAfter: false, lifecycle: recorded },
      authority: home.authority,
      processTableTemplateHashes: { git: runtime().processTableHash, launchd: null },
      files: previewFiles(home, files),
      git,
      launchd: null,
    });
    return lifecycle.codecs(home.key).preview.validate(JSON.parse(lifecycle.codecs(home.key).preview.encode(preview)));
  };

  const applyPreview = async (preview: LifecyclePlanPreviewV1, global: HeldLifecycleStableLockV1): Promise<GitCommandResultV1> => {
    const prepared = await prepareUnderLock(context, lifecycle, global);
    requireClear(prepared, context.paths);
    const git = preview.git;
    if (git === null || preview.normalizedProjection.subsystem !== "git") refuse("lifecycle_preview_invalid", EXIT_CODES.invalidInput);
    const recomputed =
      preview.command === "git_enable"
        ? await previewEnable({ remote: git.remote.declaredUrl, branch: git.branch })
        : await previewDisable();
    if (recomputed.previewHash !== preview.previewHash) {
      refuse("lifecycle_preview_stale", EXIT_CODES.decisionRequired, [context.paths.home], "plan again with the same command without --apply");
    }
    const operation = recomputed.executionOperation as "git_enable" | "git_reconcile" | "git_disable";
    const lifecycleConfig = recomputed.normalizedProjection.lifecycle as GitSyncConfigV1;
    const inputs: LifecycleApplyInputsV1 = {
      home: prepared.home,
      preview: recomputed,
      operation,
      files: lifecycleFiles(prepared.home, lifecycleConfig, preview.command === "git_enable"),
      createdAt: lifecycle.clock(),
      staged: null,
    };
    const builder = lifecycleBuilder(inputs);
    const codec = lifecycle.codecs(prepared.home.key).executionPlan;
    assertLifecycleExecutionFeasible(builder, prepared.snapshot, codec);
    const ids = await reserveIds(context, lifecycle, global, prepared.snapshot, prefixesOf(builder));
    const coordinatorId = parseLifecycleCoordinatorId(ids[0], prepared.home.key.nonce);
    const store = lifecycle.store(prepared.home.key);
    await store.ensureStagingDirectory(coordinatorId, global);
    let published = false;
    try {
      const participantId = String(ids.at(-1));
      const source = operation === "git_disable" ? null : await stageEnableEffect(lifecycle, runtime(), inputs, coordinatorId, String(ids[4]));
      const payload = await stageManifestPayload(prepared.home.key.productHome, coordinatorId, participantId, inputs.files.manifest);
      const foundation = await stageLifecycleFoundation(context, lifecycle, inputs, coordinatorId, ids.slice(1, 4));
      inputs.staged = { foundation, source: source === null ? null : { id: source.plan.id, planHash: source.planHash }, payload };
      const { plan } = builder.build(ids);
      if (source !== null) await publishGitEffectPlan(lifecycle, source.plan);
      published = true;
      await store.publish(plan, global);
    } catch (error) {
      if (!published) await destroyUnpublishedStaging(context.paths.home, coordinatorId, lifecycle.effectiveUid);
      throw error;
    }
    await executeCoordinator(context, lifecycle, prepared.home.key, coordinatorId, global, NO_PUSH);
    await settle(context, lifecycle, prepared.home.key, prepared.residue, global);
    await reanchorManifest(context, lifecycle, prepared.home.manifestFile.hash, inputs.files.manifest);
    return {
      exitCode: EXIT_CODES.success,
      data: { kind: "applied", operation, transactionId: coordinatorId, previewHash: recomputed.previewHash },
    };
  };

  const status = async (): Promise<GitCommandResultV1> => {
    const home = await observeHome(context, lifecycle);
    const lifecycleConfig = home.config.git.lifecycle ?? null;
    let distribution: "supported" | "unsupported_git_distribution" | null = null;
    let scope: "current" | "scope_reconcile_required" | "repository_identity_changed" | null = null;
    if (lifecycleConfig !== null) {
      try {
        await runtime().admitDistribution(lifecycleConfig.remote.transport);
        distribution = "supported";
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "unsupported_git_distribution") throw error;
        distribution = "unsupported_git_distribution";
      }
      const current = gitScopeOf(home.config);
      scope =
        current.brainPath !== lifecycleConfig.repositoryRoot
          ? "repository_identity_changed"
          : current.fingerprint !== lifecycleConfig.scope.fingerprint
            ? "scope_reconcile_required"
            : "current";
    }
    const snapshot = await lifecycle.inspectLedger(home.key, await residueOf(context));
    const record = home.syncRecord;
    return {
      exitCode: EXIT_CODES.success,
      data: {
        kind: "status",
        enabled: home.config.git.enabled,
        activation: activationArm(home),
        repositoryRoot: lifecycleConfig?.repositoryRoot ?? null,
        branch: lifecycleConfig?.branch ?? null,
        remote: lifecycleConfig?.remote.effectivePushUrl ?? null,
        transport: lifecycleConfig?.remote.transport ?? null,
        scope,
        distribution,
        closure: snapshot.closure.kind,
        lastSync: record === null ? null : { outcome: record.outcome, headOid: record.headOid, completedAt: record.completedAt },
      },
    };
  };

  /** §4.4 step 1's retry branch: only the exact persisted push, validated before any spawn. */
  const retry = async (prepared: PreparedV1, global: HeldLifecycleStableLockV1): Promise<GitCommandResultV1> => {
    const closure = prepared.snapshot.closure;
    if (closure.kind !== "retry_only") return recoveryRequired("lifecycle_recovery_required", context.paths.home);
    const { plan } = await lifecycle.store(prepared.home.key).read(closure.transactionId);
    const push = plan.push;
    const config = requireActiveGit(prepared.home);
    if (
      push === null ||
      lifecyclePushPlanHash(plan) !== closure.pushPlanHash ||
      push.repositoryRoot !== config.repositoryRoot ||
      push.branchRef !== `refs/heads/${config.branch}` ||
      push.processTableHash !== runtime().processTableHash ||
      push.sourceShadowConfigTemplateHash !== GIT_SHADOW_TEMPLATE_HASHES.sourceLocal ||
      push.destination.transport !== "local" ||
      push.destination.destinationShadowConfigTemplateHash !== GIT_SHADOW_TEMPLATE_HASHES.destination ||
      push.destination.effectivePushUrl !== config.remote.effectivePushUrl
    ) {
      recoveryRequired("lifecycle_recovery_required", context.paths.home);
    }
    await runtime().admitDistribution(push.destination.transport);
    const tip = await guardedPreimage(canonical(`${config.repositoryRoot}/.git/${push.branchRef}`), { kind: "none" });
    const after = push.sourceAfter.branchRef;
    if (tip.bytes === null || after.state !== "present" || sha256(tip.bytes) !== after.bytesHash) {
      recoveryRequired("lifecycle_recovery_required", config.repositoryRoot);
    }
    const outcome = await executeCoordinator(context, lifecycle, prepared.home.key, closure.transactionId, global, lifecycle.effectPorts().push);
    if (outcome === "finalized") await settle(context, lifecycle, prepared.home.key, prepared.residue, global);
    return {
      exitCode: outcome === "finalized" ? EXIT_CODES.success : EXIT_CODES.recoveryRequired,
      data: { kind: "sync", outcome: outcome === "finalized" ? "pushed" : "push_pending", transactionId: closure.transactionId, headOid: push.commitOid },
    };
  };

  const sync = async (_mode: "interactive" | "scheduled", global: HeldLifecycleStableLockV1): Promise<GitCommandResultV1> => {
    const prepared = await prepareUnderLock(context, lifecycle, global);
    if (prepared.snapshot.closure.kind === "retry_only") return retry(prepared, global);
    requireClear(prepared, context.paths);
    const { home } = prepared;
    const config = requireActiveGit(home);
    await runtime().admitDistribution(config.remote.transport);
    const scope = gitScopeOf(home.config);
    const gitDirectory = canonical(`${config.repositoryRoot}/.git`);
    const committer = await committerOf(context, gitDirectory);
    const baseline =
      home.syncRecord !== null && home.syncRecord.repositoryRoot === config.repositoryRoot && home.syncRecord.branch === config.branch
        ? home.syncRecord
        : null;
    const planner = plannerFor(context, lifecycle, runtime(), home.config, scope);
    const request = { productHome: home.key.productHome, config, scope, committer, baseline };
    const draft = await planner.planSync(request);
    planner.assertCoreSyncFeasible(draft);
    const headOid =
      draft.sync.commit?.commitOid ??
      (draft.sync.sourcePreconditions.branchRef.state === "present" ? draft.sync.sourcePreconditions.branchRef.oid : recoveryRequired("unborn_branch_empty", gitDirectory));
    const branchRef = parseFullBranchRef(`refs/heads/${config.branch}`);
    const destination = draft.kind === "no_changes" ? null : await observeBareDestination(localRemotePath(config.remote), branchRef);
    if (destination !== null) {
      await requireSameDevice(home.key.productHome, destination.gitDirectory);
      const start = draft.sync.commit === null ? headOid : draft.sync.commit.parentOid;
      await requireFastForward(runtime(), gitDirectory, headOid, start, destination.targetRef);
    }
    const inputs: SyncInputsV1 = {
      home,
      config,
      draft,
      record: nextSyncRecord({
        previous: baseline,
        pushed: draft.kind !== "no_changes",
        repositoryRoot: config.repositoryRoot,
        branch: config.branch,
        scopeFingerprint: scope.fingerprint,
        headOid,
        managedPaths: draft.sync.managedPaths,
        completedAt: lifecycle.clock(),
      }),
      createdAt: lifecycle.clock(),
      destination,
      processTableHash: runtime().processTableHash,
      staged: null,
    };
    const builder = syncBuilder(inputs, SYNC_RESERVATION);
    assertLifecycleExecutionFeasible(builder, prepared.snapshot, lifecycle.codecs(home.key).executionPlan);
    const ids = await reserveIds(context, lifecycle, global, prepared.snapshot, prefixesOf(builder));
    const coordinatorId = parseLifecycleCoordinatorId(ids[0], home.key.nonce);
    const store = lifecycle.store(home.key);
    await store.ensureStagingDirectory(coordinatorId, global);
    let published = false;
    try {
      const source = draft.kind === "commit" ? await stageSourceEffect(lifecycle, runtime(), draft, home.key.productHome, coordinatorId, String(ids[2])) : null;
      const staged =
        destination === null
          ? null
          : await stageDestinationEffect(lifecycle, runtime(), {
              draft,
              commitOid: headOid,
              branchRef,
              destination,
              committer,
              productHome: home.key.productHome,
              coordinatorId,
              id: String(ids.at(-1)),
              sourceGitDirectory: gitDirectory,
            });
      const replanned = await planner.planSync(request);
      if (!sameJson({ sync: replanned.sync, after: replanned.sourceAfter }, { sync: draft.sync, after: draft.sourceAfter })) {
        refuse("concurrent_change", EXIT_CODES.recoveryRequired, [config.repositoryRoot], "developer-os git sync");
      }
      const foundation = await gitAdapters(context, lifecycle, NO_PUSH).foundation.stage({
        coordinatorId,
        id: ids[1] as FoundationTransactionIdV1,
        slot: "sync_record",
        role: { kind: "forward", compensationId: null },
        createdAt: inputs.createdAt,
        mutations: [
          {
            targetPath: syncRecordPath(context.paths),
            operation: home.syncRecordBytes === null ? "create" : "replace",
            expectedBeforeHash: home.syncRecordBytes === null ? null : sha256(home.syncRecordBytes),
            content: encodeSyncRecord(inputs.record),
          },
        ],
      });
      inputs.staged = {
        foundation,
        source: source === null ? null : { id: source.plan.id, planHash: source.planHash },
        destination: staged === null ? null : { id: staged.plan.id, planHash: staged.planHash },
      };
      const { plan } = builder.build(ids);
      if (source !== null) await publishGitEffectPlan(lifecycle, source.plan);
      if (staged !== null) await publishGitEffectPlan(lifecycle, staged.plan);
      published = true;
      await store.publish(plan, global);
    } catch (error) {
      if (!published) await destroyUnpublishedStaging(context.paths.home, coordinatorId, lifecycle.effectiveUid);
      throw error;
    }
    const outcome = await executeCoordinator(context, lifecycle, home.key, coordinatorId, global, lifecycle.effectPorts().push);
    if (outcome === "finalized") await settle(context, lifecycle, home.key, prepared.residue, global);
    return {
      exitCode: outcome === "finalized" ? EXIT_CODES.success : EXIT_CODES.recoveryRequired,
      data: {
        kind: "sync",
        outcome: outcome === "push_pending" ? "push_pending" : draft.kind === "no_changes" ? "no_changes" : "pushed",
        transactionId: coordinatorId,
        headOid,
      },
    };
  };

  return {
    previewEnable,
    applyEnable: (preview, global) => {
      if (preview.command !== "git_enable") refuse("lifecycle_preview_invalid", EXIT_CODES.invalidInput);
      return applyPreview(preview, global);
    },
    previewDisable,
    applyDisable: (preview, global) => {
      if (preview.command !== "git_disable") refuse("lifecycle_preview_invalid", EXIT_CODES.invalidInput);
      return applyPreview(preview, global);
    },
    status,
    sync,
  };
}

