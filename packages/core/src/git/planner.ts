/**
 * Spec 1 §4.1 and §4.4's allocation-free Git planning. `GitPlanner` reads
 * the real repository through guarded, bounded descriptors and returns
 * previews and drafts only: it holds no allocator, stages nothing and writes
 * nothing. `git sync` has no public preview; its draft is combined with the
 * Security draft by the CLI, which alone reserves IDs and binds the plans.
 */
import { createHash } from "node:crypto";

import {
  gitScopeFingerprint,
  parseNormalizedRemoteUrl,
  parseValidatedGitBranch,
  parseVaultSegment,
  type GitScopeSnapshotV1,
  type GitSyncConfigV1,
  type ValidatedGitBranchV1,
  type VaultSegmentV1,
} from "../config/lifecycle.js";
import { encodeCanonicalJson, type CanonicalJsonV1, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { LifecycleValueCodec } from "../lifecycle/codecs.js";
import type { LifecycleGuardedEntryV1, LifecycleGuardedFileSystemV1 } from "../lifecycle/guarded-fs.js";
import { LIFECYCLE_LEDGER_BOUNDS } from "../lifecycle/ids.js";
import {
  LIFECYCLE_PLAN_BOUNDS,
  LIFECYCLE_PREVIEW_FILE_OPERATIONS,
  LIFECYCLE_PREVIEW_FILE_ROLES,
  type LifecyclePreviewFileChangeV1,
  type LifecyclePreviewFileStateV1,
} from "../lifecycle/types.js";
import {
  parseCanonicalAbsolutePathText,
  parseVaultRelativePathText,
  type CanonicalAbsolutePathV1,
  type VaultRelativePathV1,
} from "../update/paths.js";
import { parseLowerHexSha256, type LowerHexSha256 } from "../update/scalars.js";
import { GitMetadataRefusalError, inspectGitMetadata, type GitMetadataStreamV1 } from "./metadata.js";
import {
  GIT_EMPTY_TREE_OID,
  GIT_HISTORY_OPERATION_MARKERS,
  GIT_SYNC_COMMIT_MESSAGE,
  appendGitRemoteSection,
  buildGitTree,
  compareBytes,
  gitCommitObject,
  gitIndexBytes,
  gitIndexEntry,
  gitObject,
  gitRemoteState,
  gitTreeNodes,
  looseObjectBytes,
  looseObjectRelativePath,
  parseAdmittedGitIndex,
  planInitialGitDirectory,
  type GitAdmittedIndexV1,
  type GitCommitterV1,
  type GitIndexEntryV1,
  type GitObjectV1,
  type GitTreeNodeV1,
} from "./repository.js";
import {
  assertGitSameDevice,
  assertGitScopeRoots,
  enumerateGitScopePaths,
  isGitScopePath,
  parseGitScopePath,
  readGitRetiringPath,
  readGitScopeSnapshot,
  refuseGitPlanning,
  type GitScopeDependenciesV1,
  type GitScopeFileV1,
} from "./scope.js";
import {
  GIT_METADATA_BOUNDS,
  GIT_OBJECT_COUNT_MAX,
  GIT_REFLOG_MESSAGE,
  GIT_TREE_FINGERPRINT_MAX_ENTRIES,
  GIT_ZERO_OID,
  compareUnsignedUtf8,
  gitReflogAppendLine,
  parseLowerHexSha1,
  validateGitReflogAppend,
  validateGitReflogPlan,
  validateGitSourceState,
  validateGuardedGitPathState,
  validatePlannedGitPathState,
  type GitReflogAppendV1,
  type GitReflogPlanV1,
  type GitReflogStateV1,
  type GitSemanticStateV1,
  type GitSourceStateV1,
  type GuardedGitPathStateV1,
  type LowerHexSha1,
  type PlannedGitPathStateV1,
} from "./types.js";

export interface GitSyncCardinalityV1 {
  readonly maxChanges: 100000;
  readonly maxNewBlobs: 100000;
  readonly maxNewTrees: 100000;
  readonly maxNewCommits: 1;
  readonly maxSourceObjectTransitions: 200001;
  readonly maxSourceControlTransitions: 4;
  readonly maxSourceReflogTransitions: 2;
  readonly maxDestinationControlTransitions: 2;
  readonly maxGitEffectTransitions: 200005;
  readonly maxNewGitTreeEntries: 511;
}

export const GIT_SYNC_CARDINALITY: GitSyncCardinalityV1 = Object.freeze({
  maxChanges: 100000,
  maxNewBlobs: 100000,
  maxNewTrees: 100000,
  maxNewCommits: 1,
  maxSourceObjectTransitions: GIT_OBJECT_COUNT_MAX,
  maxSourceControlTransitions: 4,
  maxSourceReflogTransitions: 2,
  maxDestinationControlTransitions: 2,
  maxGitEffectTransitions: 200005,
  maxNewGitTreeEntries: 511,
});

export interface GitSyncCountsV1 {
  readonly changes: number;
  readonly managedPaths: number;
  readonly newBlobs: number;
  readonly newTrees: number;
  readonly newCommits: number;
  readonly sourceControlTransitions: number;
}

/** Spec §4.4's one shared calculation: `O = B + T + C <= 200001`, plus at most four control transitions. */
export function deriveGitSyncCardinality(counts: GitSyncCountsV1): {
  readonly objects: number;
  readonly transitions: number;
} {
  const bounds = GIT_SYNC_CARDINALITY;
  const within = (value: number, maximum: number): boolean => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
  if (
    !within(counts.changes, bounds.maxChanges) ||
    !within(counts.managedPaths, bounds.maxChanges) ||
    !within(counts.newBlobs, bounds.maxNewBlobs) ||
    !within(counts.newTrees, bounds.maxNewTrees) ||
    !within(counts.newCommits, bounds.maxNewCommits) ||
    !within(counts.sourceControlTransitions, bounds.maxSourceControlTransitions)
  ) {
    refuseGitPlanning("git_cardinality_exceeded");
  }
  const objects = counts.newBlobs + counts.newTrees + counts.newCommits;
  if (objects > bounds.maxSourceObjectTransitions) refuseGitPlanning("git_cardinality_exceeded");
  const transitions = objects + counts.sourceControlTransitions;
  if (transitions > bounds.maxGitEffectTransitions) refuseGitPlanning("git_cardinality_exceeded");
  return { objects, transitions };
}

export const GIT_EFFECT_TRANSITION_ROLES = [
  "source_git_directory_tree",
  "source_head",
  "source_config",
  "source_index",
  "source_head_reflog",
  "source_branch_reflog",
  "source_branch_ref",
  "source_object",
  "destination_pack",
  "destination_index",
  "destination_branch_reflog",
  "destination_ref",
] as const;
export type GitEffectTransitionRoleV1 = (typeof GIT_EFFECT_TRANSITION_ROLES)[number];

export const GIT_EFFECT_TRANSITION_OPERATIONS = ["create", "replace", "remove", "reuse"] as const;
export type GitEffectTransitionOperationV1 = (typeof GIT_EFFECT_TRANSITION_OPERATIONS)[number];

export interface GitEffectEvidenceV1 {
  readonly stagedPostimagePath: CanonicalAbsolutePathV1 | null;
  readonly stagedPostimage: GuardedGitPathStateV1 | null;
  readonly beforeTombstonePath: CanonicalAbsolutePathV1 | null;
  readonly afterTombstonePath: CanonicalAbsolutePathV1 | null;
}

/** A draft transition's evidence: staging paths exist only after ID reservation binds them. */
export const GIT_EFFECT_EVIDENCE_UNBOUND: GitEffectEvidenceV1 = Object.freeze({
  stagedPostimagePath: null,
  stagedPostimage: null,
  beforeTombstonePath: null,
  afterTombstonePath: null,
});

export interface GitEffectTransitionV1 {
  readonly role: GitEffectTransitionRoleV1;
  readonly path: CanonicalAbsolutePathV1;
  readonly operation: GitEffectTransitionOperationV1;
  readonly before: GuardedGitPathStateV1;
  readonly after: PlannedGitPathStateV1;
  readonly evidence: GitEffectEvidenceV1;
}

export interface GitSyncChangeV1 {
  readonly path: VaultRelativePathV1;
  readonly operation: "create" | "replace" | "remove";
  readonly sourceHash: LowerHexSha256 | null;
  readonly blobOid: LowerHexSha1 | null;
}

/** Spec §4.4's `GitSyncPlanV1` with the Security-owned push record left generic. */
export interface GitSyncPlanCoreV1<TPushPlan> {
  readonly schemaVersion: 1;
  readonly repositoryRoot: CanonicalAbsolutePathV1;
  readonly scope: GitScopeSnapshotV1;
  readonly sourcePreconditions: GitSourceStateV1;
  readonly changes: readonly GitSyncChangeV1[];
  readonly managedPaths: readonly VaultRelativePathV1[];
  readonly candidateTreeOid: LowerHexSha1;
  readonly commit: null | {
    readonly parentOid: LowerHexSha1 | null;
    readonly commitOid: LowerHexSha1;
    readonly message: typeof GIT_SYNC_COMMIT_MESSAGE;
  };
  readonly sourceGitEffectPlanHash: LowerHexSha256 | null;
  readonly destinationGitEffectPlanHash: LowerHexSha256 | null;
  readonly push: TPushPlan | null;
}

export type GitRepositoryModeV1 = "initialize" | "adopt" | "preserve";

export interface GitPlanPreviewV1 {
  readonly repositoryMode: GitRepositoryModeV1;
  readonly repositoryRoot: CanonicalAbsolutePathV1;
  readonly branch: ValidatedGitBranchV1;
  readonly remote: GitSyncConfigV1["remote"];
  readonly scope: GitScopeSnapshotV1;
  readonly changes: readonly LifecyclePreviewFileChangeV1[];
}

/** Spec §7 "branch-history warning is explicit": printed with every enable plan. */
export const GIT_ENABLE_BRANCH_HISTORY_WARNING =
  "Developer OS stages only the Brain scope, but a push sends every commit reachable from the branch. " +
  "Commits made before enable or by hand on this branch, including out-of-scope paths, may reach the remote; " +
  "Developer OS neither scans nor rewrites that history.";

/** The CLI display names spec §4.1 gives the Git preview member. */
export interface GitEnablePlan {
  readonly preview: GitPlanPreviewV1;
  readonly warning: typeof GIT_ENABLE_BRANCH_HISTORY_WARNING;
}
export interface GitDisablePlan {
  readonly preview: GitPlanPreviewV1;
}

export function describeGitEnablePlan(preview: GitPlanPreviewV1): GitEnablePlan {
  return { preview, warning: GIT_ENABLE_BRANCH_HISTORY_WARNING };
}

const MAX_GIT_EFFECT_TRANSITIONS = GIT_SYNC_CARDINALITY.maxGitEffectTransitions;
const REFLOG_LINE_MIN_BYTES = gitReflogAppendLine({
  oldOid: GIT_ZERO_OID,
  newOid: GIT_ZERO_OID as LowerHexSha1,
  committer: { name: "n", email: "e", unixSeconds: 0, utcOffset: "+0000" },
}).length;
const encoder = new TextEncoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function exact(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).length !== keys.length || keys.some((key) => !Object.hasOwn(input, key))) {
    fail(`${label}: keys`);
  }
  return input;
}

function list(value: unknown, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(label);
  return value as readonly unknown[];
}

function literal<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) fail(label);
  return value;
}

function nullable<T>(value: unknown, parse: (input: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

function sha256(bytes: Uint8Array): LowerHexSha256 {
  return parseLowerHexSha256(createHash("sha256").update(bytes).digest("hex"));
}

function json(value: unknown): CanonicalJsonValue {
  return value as CanonicalJsonValue;
}

function sameJson(left: unknown, right: unknown): boolean {
  return encodeCanonicalJson(json(left)) === encodeCanonicalJson(json(right));
}

export const GIT_LOOSE_OBJECT_FAN_OUT: readonly string[] = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, "0"));
const EMPTY_DIRECTORY_PREVIEW: LifecyclePreviewFileStateV1 = { state: "present", hash: sha256(new Uint8Array()), size: 0 };

function child(parent: CanonicalAbsolutePathV1, relative: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${parent}/${relative}`);
}

function assertSortedUnique(paths: readonly string[], label: string): void {
  for (let index = 1; index < paths.length; index += 1) {
    if (compareUnsignedUtf8(paths[index - 1] as string, paths[index] as string) >= 0) fail(`${label}: order`);
  }
}

export function validateGitScopeSnapshot(value: unknown): GitScopeSnapshotV1 {
  const label = "GitScopeSnapshotV1";
  const input = exact(value, ["brainPath", "contentRoot", "topicFolders", "topicAliases", "indexesDir", "fingerprint"], label);
  const topicFolders = list(input.topicFolders, 256, `${label}.topicFolders`).map(parseVaultSegment);
  if (topicFolders.length === 0) fail(`${label}.topicFolders`);
  const aliasesInput = exact(input.topicAliases, Object.keys(input.topicAliases ?? {}), `${label}.topicAliases`);
  const topicAliases: Record<string, VaultSegmentV1> = {};
  for (const [alias, target] of Object.entries(aliasesInput)) topicAliases[parseVaultSegment(alias)] = parseVaultSegment(target);
  const scope = {
    brainPath: parseCanonicalAbsolutePathText(input.brainPath),
    contentRoot: parseVaultSegment(input.contentRoot),
    topicFolders,
    topicAliases,
    indexesDir: parseVaultSegment(input.indexesDir),
  };
  const fingerprint = parseLowerHexSha256(input.fingerprint);
  if (gitScopeFingerprint(scope) !== fingerprint) fail(`${label}.fingerprint`);
  return { ...scope, fingerprint };
}

function validateRemote(value: unknown): GitSyncConfigV1["remote"] {
  const label = "GitSyncConfigV1.remote";
  const input = exact(value, ["name", "transport", "declaredUrl", "effectivePushUrl"], label);
  if (input.name !== "developer-os") fail(`${label}.name`);
  const transport = literal(input.transport, ["local", "https", "ssh"] as const, `${label}.transport`);
  const declaredUrl = parseNormalizedRemoteUrl(input.declaredUrl, transport);
  const effectivePushUrl = parseNormalizedRemoteUrl(input.effectivePushUrl, transport);
  if (declaredUrl !== effectivePushUrl) fail(`${label}: effectivePushUrl`);
  return { name: "developer-os", transport, declaredUrl, effectivePushUrl };
}

function validatePreviewFileState(value: unknown, label: string): LifecyclePreviewFileStateV1 {
  if (typeof value === "object" && value !== null && (value as { state?: unknown }).state === "absent") {
    exact(value, ["state"], label);
    return { state: "absent" };
  }
  const input = exact(value, ["state", "hash", "size"], label);
  if (input.state !== "present") fail(`${label}.state`);
  const size = input.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) fail(`${label}.size`);
  return { state: "present", hash: parseLowerHexSha256(input.hash), size };
}

export function validateGitPlanPreview(value: unknown): GitPlanPreviewV1 {
  const label = "GitPlanPreviewV1";
  const input = exact(value, ["repositoryMode", "repositoryRoot", "branch", "remote", "scope", "changes"], label);
  const scope = validateGitScopeSnapshot(input.scope);
  const repositoryRoot = parseCanonicalAbsolutePathText(input.repositoryRoot);
  if (repositoryRoot !== scope.brainPath) fail(`${label}.repositoryRoot`);
  const changes = list(input.changes, MAX_GIT_EFFECT_TRANSITIONS, `${label}.changes`).map((entry) => {
    const change = exact(entry, ["role", "targetPath", "operation", "before", "after"], `${label}.changes`);
    return {
      role: literal(change.role, LIFECYCLE_PREVIEW_FILE_ROLES, `${label}.changes.role`),
      targetPath: parseCanonicalAbsolutePathText(change.targetPath),
      operation: literal(change.operation, LIFECYCLE_PREVIEW_FILE_OPERATIONS, `${label}.changes.operation`),
      before: validatePreviewFileState(change.before, `${label}.changes.before`),
      after: validatePreviewFileState(change.after, `${label}.changes.after`),
    };
  });
  const keys = changes.map((change) => `${change.role}\u0000${change.targetPath}`);
  if (new Set(keys).size !== keys.length) fail(`${label}.changes: duplicate`);
  return {
    repositoryMode: literal(input.repositoryMode, ["initialize", "adopt", "preserve"] as const, `${label}.repositoryMode`),
    repositoryRoot,
    branch: parseValidatedGitBranch(input.branch),
    remote: validateRemote(input.remote),
    scope,
    changes,
  };
}

/** The `gitPreview` leaf Task 14 hands to `createLifecycleCodecs`. */
export const GIT_PLAN_PREVIEW_CODEC: LifecycleValueCodec<GitPlanPreviewV1> = Object.freeze({
  validate: validateGitPlanPreview,
  encode: (preview: GitPlanPreviewV1): CanonicalJsonV1 => encodeCanonicalJson(json(preview)),
});

function validateEvidence(value: unknown, effectiveUid: number): GitEffectEvidenceV1 {
  const label = "GitEffectEvidenceV1";
  const input = exact(value, ["stagedPostimagePath", "stagedPostimage", "beforeTombstonePath", "afterTombstonePath"], label);
  const stagedPostimagePath = nullable(input.stagedPostimagePath, parseCanonicalAbsolutePathText);
  const stagedPostimage = nullable(input.stagedPostimage, (state) => validateGuardedGitPathState(state, effectiveUid));
  if ((stagedPostimagePath === null) !== (stagedPostimage === null)) fail(`${label}: staged postimage`);
  return {
    stagedPostimagePath,
    stagedPostimage,
    beforeTombstonePath: nullable(input.beforeTombstonePath, parseCanonicalAbsolutePathText),
    afterTombstonePath: nullable(input.afterTombstonePath, parseCanonicalAbsolutePathText),
  };
}

export function validateGitEffectTransition(value: unknown, effectiveUid: number): GitEffectTransitionV1 {
  const label = "GitEffectTransitionV1";
  const input = exact(value, ["role", "path", "operation", "before", "after", "evidence"], label);
  const operation = literal(input.operation, GIT_EFFECT_TRANSITION_OPERATIONS, `${label}.operation`);
  const before = validateGuardedGitPathState(input.before, effectiveUid);
  const after = validatePlannedGitPathState(input.after, effectiveUid);
  const beforeAbsent = before.state === "absent";
  const afterAbsent = after.state === "absent";
  const coherent =
    (operation === "create" && beforeAbsent && !afterAbsent) ||
    (operation === "remove" && !beforeAbsent && afterAbsent) ||
    ((operation === "replace" || operation === "reuse") && !beforeAbsent && !afterAbsent);
  if (!coherent) fail(`${label}: operation and states`);
  return {
    role: literal(input.role, GIT_EFFECT_TRANSITION_ROLES, `${label}.role`),
    path: parseCanonicalAbsolutePathText(input.path),
    operation,
    before,
    after,
    evidence: validateEvidence(input.evidence, effectiveUid),
  };
}

function reflogTransitionMatches(transition: GitEffectTransitionV1 | undefined, append: GitReflogAppendV1): boolean {
  return (
    transition !== undefined &&
    transition.path === append.path &&
    transition.after.state === "regular_file" &&
    transition.after.hash === append.after.bytesHash &&
    transition.after.size === append.after.size
  );
}

/**
 * Spec §4.4's sync grammar: source objects in canonical path order, then the
 * optional index, HEAD reflog and branch reflog, and the branch ref last.
 * Every reflog append binds exactly one reflog transition and the one ref
 * transition to its new OID; anything else is `reflog_bijection`.
 */
export function assertGitSyncSourceTransitions(
  transitions: readonly GitEffectTransitionV1[],
  reflogPlan: GitReflogPlanV1 | null,
): void {
  const label = "GitSyncSourceTransitions";
  if (transitions.length > MAX_GIT_EFFECT_TRANSITIONS) fail(`${label}: count`);
  let index = 0;
  let previousObject: string | null = null;
  while (index < transitions.length && (transitions[index] as GitEffectTransitionV1).role === "source_object") {
    const path = (transitions[index] as GitEffectTransitionV1).path;
    if (previousObject !== null && compareUnsignedUtf8(previousObject, path) >= 0) fail(`${label}: object order`);
    previousObject = path;
    index += 1;
  }
  const control = transitions.slice(index);
  const roles = control.map((transition) => transition.role);
  const expected = ["source_index", "source_head_reflog", "source_branch_reflog", "source_branch_ref"].filter((role) =>
    roles.includes(role as GitEffectTransitionRoleV1),
  );
  if (roles.length !== expected.length || roles.some((role, position) => role !== expected[position])) {
    fail(`${label}: control order`);
  }
  const byRole = (role: GitEffectTransitionRoleV1): GitEffectTransitionV1 | undefined =>
    control.find((transition) => transition.role === role);
  const headLog = byRole("source_head_reflog");
  const branchLog = byRole("source_branch_reflog");
  const ref = byRole("source_branch_ref");
  if (reflogPlan === null) {
    if (headLog !== undefined || branchLog !== undefined || ref !== undefined) fail(`${label}: reflog_bijection`);
    return;
  }
  if (reflogPlan.side !== "source") fail(`${label}: reflog_bijection`);
  const appends = [reflogPlan.head, reflogPlan.branch];
  const logs = [headLog, branchLog];
  for (const [position, append] of appends.entries()) {
    const log = logs[position];
    if (append === null ? log !== undefined : !reflogTransitionMatches(log, append)) fail(`${label}: reflog_bijection`);
  }
  const newOid = (reflogPlan.head ?? reflogPlan.branch)?.newOid;
  if (ref === undefined || ref.after.state !== "regular_file" || ref.after.semantic.kind !== "oid" || ref.after.semantic.value !== newOid) {
    fail(`${label}: reflog_bijection`);
  }
}

function reflogSize(state: GitReflogStateV1): number {
  return state.state === "absent" ? 0 : state.size;
}

/**
 * Spec §4.4: with a commit, both reflogs grow by exactly one identical
 * append and the branch ref lands on `commitOid`; without one, `sourceAfter`
 * is byte-identical to `sourceBefore`.
 */
function assertSourceProjection(
  label: string,
  before: GitSourceStateV1,
  after: GitSourceStateV1,
  commit: GitSyncPlanCoreV1<unknown>["commit"],
): void {
  if (commit === null) {
    if (!sameJson(before, after)) fail(`${label}: sourceAfter`);
    return;
  }
  if (after.configHash !== before.configHash || !sameJson(before.head, after.head) || after.index.state !== "present") {
    fail(`${label}: sourceAfter`);
  }
  if (after.headReflog.state !== "present" || after.branchReflog.state !== "present") fail(`${label}: reflog_bijection`);
  const headDelta = after.headReflog.size - reflogSize(before.headReflog);
  const branchDelta = after.branchReflog.size - reflogSize(before.branchReflog);
  if (
    headDelta !== branchDelta ||
    headDelta < REFLOG_LINE_MIN_BYTES ||
    headDelta > GIT_METADATA_BOUNDS.reflogAppendMaxBytes
  ) {
    fail(`${label}: reflog_bijection`);
  }
  if (after.branchRef.state !== "present" || after.branchRef.oid !== commit.commitOid) fail(`${label}: reflog_bijection`);
}

function validateChange(value: unknown): GitSyncChangeV1 {
  const label = "GitSyncChangeV1";
  const input = exact(value, ["path", "operation", "sourceHash", "blobOid"], label);
  const operation = literal(input.operation, ["create", "replace", "remove"] as const, `${label}.operation`);
  const sourceHash = nullable(input.sourceHash, parseLowerHexSha256);
  const blobOid = nullable(input.blobOid, parseLowerHexSha1);
  if ((operation === "remove") !== (sourceHash === null) || (sourceHash === null) !== (blobOid === null)) {
    fail(`${label}: hashes`);
  }
  return { path: parseVaultRelativePathText(input.path), operation, sourceHash, blobOid };
}

/**
 * The strict Core half of `GitSyncPlanV1`. The push record is the codec's;
 * Core checks only the two source projections spec §4.4 binds to its own
 * fields (`sourceBefore` and `sourceAfter`).
 */
export function validateGitSyncPlanCore<T>(value: unknown, push: LifecycleValueCodec<T>): GitSyncPlanCoreV1<T> {
  const label = "GitSyncPlanCoreV1";
  const input = exact(
    value,
    [
      "schemaVersion",
      "repositoryRoot",
      "scope",
      "sourcePreconditions",
      "changes",
      "managedPaths",
      "candidateTreeOid",
      "commit",
      "sourceGitEffectPlanHash",
      "destinationGitEffectPlanHash",
      "push",
    ],
    label,
  );
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  const scope = validateGitScopeSnapshot(input.scope);
  const repositoryRoot = parseCanonicalAbsolutePathText(input.repositoryRoot);
  if (repositoryRoot !== scope.brainPath) fail(`${label}.repositoryRoot`);
  const sourcePreconditions = validateGitSourceState(input.sourcePreconditions);
  const changes = list(input.changes, GIT_SYNC_CARDINALITY.maxChanges, `${label}.changes`).map(validateChange);
  assertSortedUnique(
    changes.map((change) => change.path),
    `${label}.changes`,
  );
  const managedPaths = list(input.managedPaths, GIT_SYNC_CARDINALITY.maxChanges, `${label}.managedPaths`).map(
    parseVaultRelativePathText,
  );
  assertSortedUnique(managedPaths, `${label}.managedPaths`);
  const managed = new Set(managedPaths);
  if (changes.some((change) => (change.operation === "remove") === managed.has(change.path))) {
    fail(`${label}.changes: managed paths`);
  }
  const commit =
    input.commit === null
      ? null
      : (() => {
          const commitInput = exact(input.commit, ["parentOid", "commitOid", "message"], `${label}.commit`);
          if (commitInput.message !== GIT_SYNC_COMMIT_MESSAGE) fail(`${label}.commit.message`);
          return {
            parentOid: nullable(commitInput.parentOid, parseLowerHexSha1),
            commitOid: parseLowerHexSha1(commitInput.commitOid),
            message: GIT_SYNC_COMMIT_MESSAGE,
          };
        })();
  const expectedParent = sourcePreconditions.branchRef.state === "present" ? sourcePreconditions.branchRef.oid : null;
  if (commit !== null && commit.parentOid !== expectedParent) fail(`${label}.commit.parentOid`);
  if ((commit === null) !== (changes.length === 0)) fail(`${label}.commit`);
  const sourceGitEffectPlanHash = nullable(input.sourceGitEffectPlanHash, parseLowerHexSha256);
  const destinationGitEffectPlanHash = nullable(input.destinationGitEffectPlanHash, parseLowerHexSha256);
  if ((commit === null) !== (sourceGitEffectPlanHash === null)) fail(`${label}.sourceGitEffectPlanHash`);
  const pushPlan = input.push === null ? null : push.validate(input.push);
  if (pushPlan === null) {
    if (commit !== null || destinationGitEffectPlanHash !== null) fail(`${label}.push`);
  } else {
    const projection = exact(input.push, Object.keys(input.push as object), `${label}.push`);
    const sourceBefore = validateGitSourceState(projection.sourceBefore);
    const sourceAfter = validateGitSourceState(projection.sourceAfter);
    if (!sameJson(sourceBefore, sourcePreconditions)) fail(`${label}.sourcePreconditions`);
    assertSourceProjection(label, sourceBefore, sourceAfter, commit);
  }
  return {
    schemaVersion: 1,
    repositoryRoot,
    scope,
    sourcePreconditions,
    changes,
    managedPaths,
    candidateTreeOid: parseLowerHexSha1(input.candidateTreeOid),
    commit,
    sourceGitEffectPlanHash,
    destinationGitEffectPlanHash,
    push: pushPlan,
  };
}

/** The last successful `SyncRecordV1` facts planning needs; Task 15 owns the record itself. */
export interface GitSyncBaselineV1 {
  readonly lastPushedHeadOid: LowerHexSha1;
  readonly managedPaths: readonly VaultRelativePathV1[];
}

export interface GitEnableRequestV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  /** The scope derived from the current Brain configuration. */
  readonly scope: GitScopeSnapshotV1;
  readonly remote: GitSyncConfigV1["remote"];
  readonly branch: ValidatedGitBranchV1 | null;
  /** The retained `GitSyncConfigV1`, present for re-enable and reconcile. */
  readonly recorded: GitSyncConfigV1 | null;
  readonly baseline: GitSyncBaselineV1 | null;
  /** True while the closure is `retry_only` with a bound push. */
  readonly pushPending: boolean;
}

export interface GitDisableRequestV1 {
  readonly config: GitSyncConfigV1;
}

export interface GitSyncRequestV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly config: GitSyncConfigV1;
  readonly scope: GitScopeSnapshotV1;
  readonly committer: GitCommitterV1;
  readonly baseline: GitSyncBaselineV1 | null;
}

export interface GitPlannerDependenciesV1 extends GitScopeDependenciesV1 {
  readonly fs: Pick<LifecycleGuardedFileSystemV1, "lstat" | "readRegular" | "hashRegular">;
  readonly streamRegular: GitMetadataStreamV1;
  /** A commit's root tree, read through Security's read-only shadow; Core never spawns Git. */
  readonly commitTree: (commit: LowerHexSha1) => Promise<LowerHexSha1>;
  /** Brain lint over the secret-clean snapshot, run before any byte is hashed. */
  readonly lintSnapshot: (files: readonly GitScopeFileV1[]) => Promise<void>;
}

export interface GitPlannedObjectV1 {
  readonly object: GitObjectV1;
  readonly path: CanonicalAbsolutePathV1;
  readonly looseBytes: Uint8Array;
}

export type GitSyncPlanCoreDraftV1 = Omit<
  GitSyncPlanCoreV1<never>,
  "sourceGitEffectPlanHash" | "destinationGitEffectPlanHash" | "push"
>;

/**
 * Every Core-owned, allocation-free sync input. It has no codec, so it
 * cannot be persisted, and nothing binds execution from it except the CLI's
 * combination with the Security draft after reservation.
 */
export interface GitSyncPlanningDraft {
  readonly kind: "no_changes" | "push_only" | "commit";
  readonly sync: GitSyncPlanCoreDraftV1;
  readonly sourceAfter: GitSourceStateV1;
  readonly objects: readonly GitPlannedObjectV1[];
  readonly trees: readonly GitTreeNodeV1[];
  readonly candidateIndex: Uint8Array | null;
  readonly reflogPlan: GitReflogPlanV1 | null;
  readonly transitions: readonly GitEffectTransitionV1[];
  readonly counts: GitSyncCountsV1;
}

export interface GitCoreSyncFeasibility {
  readonly objects: number;
  readonly transitions: number;
  readonly stagingLeaves: number;
  readonly corePlanBytes: number;
  readonly transitionBytes: number;
}

interface GuardedBytesV1 {
  readonly entry: LifecycleGuardedEntryV1;
  readonly bytes: Uint8Array;
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

function ancestorDirectories(path: Uint8Array): readonly string[] {
  const directories = [""];
  for (let index = 0; index < path.byteLength; index += 1) {
    if (path[index] === 0x2f) directories.push(latin1(path.subarray(0, index)));
  }
  return directories;
}

function regularState(entry: LifecycleGuardedEntryV1, hash: LowerHexSha256, semantic: GitSemanticStateV1): GuardedGitPathStateV1 {
  return { state: "regular_file", hash, size: Number(entry.size), mode: entry.mode, dev: entry.dev, ino: entry.ino, semantic };
}

function plannedFile(bytesHash: LowerHexSha256, size: number, mode: number, oid: LowerHexSha1 | null): PlannedGitPathStateV1 {
  return {
    state: "regular_file",
    hash: bytesHash,
    size,
    mode,
    semantic: oid === null ? { kind: "none" } : { kind: "oid", value: oid },
  };
}

function stagingLeaves(transitions: readonly GitEffectTransitionV1[]): number {
  const perOperation: Readonly<Record<GitEffectTransitionOperationV1, number>> = {
    create: 1,
    replace: 3,
    remove: 2,
    reuse: 0,
  };
  return transitions.reduce((sum, transition) => sum + perOperation[transition.operation], 0);
}

export class GitPlanner {
  readonly #dependencies: GitPlannerDependenciesV1;

  constructor(dependencies: GitPlannerDependenciesV1) {
    this.#dependencies = dependencies;
  }

  /** The exact public surface, for the exhaustive method-set test. */
  publicMethods(): readonly string[] {
    return Object.getOwnPropertyNames(GitPlanner.prototype)
      .filter((name) => name !== "constructor" && name !== "publicMethods")
      .sort();
  }

  async previewEnable(request: GitEnableRequestV1): Promise<GitPlanPreviewV1> {
    const { scope, remote, recorded } = request;
    const root = scope.brainPath;
    if (recorded !== null) {
      if (recorded.repositoryRoot !== root || recorded.scope.brainPath !== root) {
        refuseGitPlanning("repository_identity_changed");
      }
      if (!sameJson(recorded.remote, remote) || (request.branch !== null && request.branch !== recorded.branch)) {
        refuseGitPlanning("retained_identity_mismatch");
      }
    }
    await assertGitSameDevice(this.#dependencies.fs, request.productHome, root);
    await assertGitScopeRoots(this.#dependencies, scope);
    const gitDirectory = child(root, ".git");
    if ((await this.#dependencies.fs.lstat(gitDirectory)) === null) {
      if (recorded !== null) throw new GitMetadataRefusalError("git_repository_absent");
      const branch = request.branch ?? parseValidatedGitBranch("main");
      const initial = planInitialGitDirectory(branch, remote.declaredUrl);
      if (initial.entries.length > GIT_TREE_FINGERPRINT_MAX_ENTRIES) refuseGitPlanning("git_cardinality_exceeded");
      return {
        repositoryMode: "initialize",
        repositoryRoot: root,
        branch,
        remote,
        scope,
        changes: [
          {
            role: "source_git",
            targetPath: gitDirectory,
            operation: "create",
            before: { state: "absent" },
            after: { state: "present", hash: initial.treeHash, size: initial.totalBytes },
          },
        ],
      };
    }
    const source = await this.#inspect(root, request.branch ?? recorded?.branch ?? null);
    if (source.head.semantic.kind !== "symbolic_ref") throw new GitMetadataRefusalError("detached_head");
    const branch = parseValidatedGitBranch(source.head.semantic.value.slice("refs/heads/".length));
    const changes: LifecyclePreviewFileChangeV1[] = [
      await this.#remoteChange(gitDirectory, source, remote),
      ...(await this.#missingFanOut(gitDirectory)),
    ];
    if (recorded !== null && recorded.scope.fingerprint !== scope.fingerprint) {
      changes.push(...(await this.#retirements(request, source)));
    }
    return {
      repositoryMode: recorded === null ? "adopt" : "preserve",
      repositoryRoot: root,
      branch,
      remote,
      scope,
      changes,
    };
  }

  async previewDisable(request: GitDisableRequestV1): Promise<GitPlanPreviewV1> {
    const { config } = request;
    return Promise.resolve({
      repositoryMode: "preserve",
      repositoryRoot: config.repositoryRoot,
      branch: config.branch,
      remote: config.remote,
      scope: config.scope,
      changes: [],
    });
  }

  async planSync(request: GitSyncRequestV1): Promise<GitSyncPlanningDraft> {
    const { config, scope } = request;
    const root = config.repositoryRoot;
    if (scope.brainPath !== config.scope.brainPath || root !== scope.brainPath) {
      refuseGitPlanning("repository_identity_changed");
    }
    if (scope.fingerprint !== config.scope.fingerprint) refuseGitPlanning("scope_reconcile_required");
    await assertGitSameDevice(this.#dependencies.fs, request.productHome, root);
    await assertGitScopeRoots(this.#dependencies, scope);
    const sourceBefore = await this.#inspect(root, config.branch);
    const gitDirectory = child(root, ".git");
    for (const marker of GIT_HISTORY_OPERATION_MARKERS) {
      if ((await this.#dependencies.fs.lstat(child(gitDirectory, marker))) !== null) {
        refuseGitPlanning("history_operation_in_progress");
      }
    }
    const indexRead =
      sourceBefore.index.state === "absent"
        ? null
        : await this.#readBound(child(gitDirectory, "index"), GIT_METADATA_BOUNDS.sourceIndexMaxBytes, sourceBefore.index.bytesHash);
    const index: GitAdmittedIndexV1 =
      indexRead === null ? { entries: [], hasTreeCache: false } : parseAdmittedGitIndex(indexRead.bytes);
    const indexTree = buildGitTree(index.entries);
    const headTree =
      sourceBefore.branchRef.state === "present"
        ? await this.#dependencies.commitTree(sourceBefore.branchRef.oid)
        : GIT_EMPTY_TREE_OID;
    if (indexTree.object.oid !== headTree) refuseGitPlanning("dirty_index");

    const paths = await enumerateGitScopePaths(this.#dependencies.enumerator, scope);
    const files = await readGitScopeSnapshot(this.#dependencies, scope, paths);
    await this.#dependencies.lintSnapshot(files);

    const { changes, candidateEntries, blobs } = await this.#diff(request, index, files);
    const managedPaths = files.map((file) => file.path);
    const counts = (newBlobs: number, newTrees: number, newCommits: number, control: number): GitSyncCountsV1 => ({
      changes: changes.length,
      managedPaths: managedPaths.length,
      newBlobs,
      newTrees,
      newCommits,
      sourceControlTransitions: control,
    });

    if (changes.length === 0) {
      if (sourceBefore.branchRef.state === "absent") refuseGitPlanning("unborn_branch_empty");
      const pushed = request.baseline?.lastPushedHeadOid === sourceBefore.branchRef.oid;
      return {
        kind: pushed ? "no_changes" : "push_only",
        sync: {
          schemaVersion: 1,
          repositoryRoot: root,
          scope,
          sourcePreconditions: sourceBefore,
          changes,
          managedPaths,
          candidateTreeOid: headTree,
          commit: null,
        },
        sourceAfter: sourceBefore,
        objects: [],
        trees: [],
        candidateIndex: null,
        reflogPlan: null,
        transitions: [],
        counts: counts(0, 0, 0, 0),
      };
    }

    const tree = buildGitTree(candidateEntries);
    const changedDirectories = new Set(changes.flatMap((change) => ancestorDirectories(encoder.encode(change.path))));
    const trees = gitTreeNodes(tree).filter((node) => changedDirectories.has(latin1(node.directory)));
    const parentOid = sourceBefore.branchRef.state === "present" ? sourceBefore.branchRef.oid : null;
    const commit = gitCommitObject(tree.object.oid, parentOid, request.committer);
    const objectsByOid = new Map<string, GitObjectV1>();
    for (const object of [...blobs, ...trees.map((node) => node.object), commit]) objectsByOid.set(object.oid, object);
    const objects = [...objectsByOid.values()]
      .map((object) => ({
        object,
        path: child(gitDirectory, looseObjectRelativePath(object.oid)),
        looseBytes: looseObjectBytes(object),
      }))
      .sort((left, right) => compareUnsignedUtf8(left.path, right.path));
    const candidateIndex = gitIndexBytes(candidateEntries, index.hasTreeCache ? tree : null);
    const reflogPlan = await this.#reflogPlan(gitDirectory, sourceBefore, config.branch, commit.oid, request.committer);
    const head = reflogPlan.head as GitReflogAppendV1;
    const branchLog = reflogPlan.branch as GitReflogAppendV1;
    const refBytes = encoder.encode(`${commit.oid}\n`);
    const sourceAfter = validateGitSourceState({
      configHash: sourceBefore.configHash,
      index: { state: "present", bytesHash: sha256(candidateIndex) },
      head: sourceBefore.head,
      headReflog: head.after,
      branchReflog: branchLog.after,
      branchRef: { state: "present", oid: commit.oid, bytesHash: sha256(refBytes) },
    });
    const transitions = await this.#sourceTransitions({
      gitDirectory,
      branch: config.branch,
      sourceBefore,
      indexEntry: indexRead?.entry ?? null,
      objects,
      candidateIndex,
      reflogPlan,
      refBytes,
      commitOid: commit.oid,
    });
    const sync: GitSyncPlanCoreDraftV1 = {
      schemaVersion: 1,
      repositoryRoot: root,
      scope,
      sourcePreconditions: sourceBefore,
      changes,
      managedPaths,
      candidateTreeOid: tree.object.oid,
      commit: { parentOid, commitOid: commit.oid, message: GIT_SYNC_COMMIT_MESSAGE },
    };
    const uniqueBlobs = new Set(blobs.map((blob) => blob.oid)).size;
    const uniqueTrees = new Set(trees.map((node) => node.object.oid)).size;
    return {
      kind: "commit",
      sync,
      sourceAfter,
      objects,
      trees,
      candidateIndex,
      reflogPlan,
      transitions,
      counts: counts(uniqueBlobs, uniqueTrees, 1, transitions.length - objects.length),
    };
  }

  assertCoreSyncFeasible(draft: GitSyncPlanningDraft): GitCoreSyncFeasibility {
    const { objects, transitions } = deriveGitSyncCardinality(draft.counts);
    if (transitions !== draft.transitions.length) refuseGitPlanning("git_cardinality_exceeded");
    assertGitSyncSourceTransitions(draft.transitions, draft.reflogPlan);
    const leaves = stagingLeaves(draft.transitions);
    if (leaves > LIFECYCLE_LEDGER_BOUNDS.lifecycleStagingPerCoordinatorLeaves) refuseGitPlanning("git_cardinality_exceeded");
    const corePlanBytes = encoder.encode(
      encodeCanonicalJson(
        json({
          ...draft.sync,
          sourceGitEffectPlanHash: draft.sync.commit === null ? null : "0".repeat(64),
          destinationGitEffectPlanHash: null,
          push: null,
        }),
      ),
    ).byteLength;
    const transitionBytes = encoder.encode(encodeCanonicalJson(json(draft.transitions))).byteLength;
    const ceiling = LIFECYCLE_PLAN_BOUNDS.planBytes.maximum;
    if (corePlanBytes > ceiling || transitionBytes > ceiling) refuseGitPlanning("git_plan_too_large");
    return { objects, transitions, stagingLeaves: leaves, corePlanBytes, transitionBytes };
  }

  async #inspect(root: CanonicalAbsolutePathV1, branch: ValidatedGitBranchV1 | null): Promise<GitSourceStateV1> {
    const { fs, streamRegular, redact, effectiveUid } = this.#dependencies;
    return inspectGitMetadata({ fs, streamRegular, redact, effectiveUid }, { repositoryRoot: root, branch });
  }

  /** Re-reads a leaf `inspectGitMetadata` admitted and binds it to the admitted hash. */
  async #readBound(path: CanonicalAbsolutePathV1, maximumBytes: number, expected: LowerHexSha256): Promise<GuardedBytesV1> {
    const entry = await this.#dependencies.fs.lstat(path);
    if (entry === null || entry.kind !== "regular_file" || BigInt(entry.size) > BigInt(maximumBytes)) {
      refuseGitPlanning("concurrent_change");
    }
    const bytes = await this.#dependencies.fs.readRegular(entry, maximumBytes);
    if (sha256(bytes) !== expected) refuseGitPlanning("concurrent_change");
    return { entry, bytes };
  }

  async #remoteChange(
    gitDirectory: CanonicalAbsolutePathV1,
    source: GitSourceStateV1,
    remote: GitSyncConfigV1["remote"],
  ): Promise<LifecyclePreviewFileChangeV1> {
    const configPath = child(gitDirectory, "config");
    const { bytes } = await this.#readBound(configPath, GIT_METADATA_BOUNDS.sourceConfigMaxBytes, source.configHash);
    const before: LifecyclePreviewFileStateV1 = { state: "present", hash: source.configHash, size: bytes.byteLength };
    const state = gitRemoteState(strictUtf8.decode(bytes));
    if (state.state === "absent") {
      const after = appendGitRemoteSection(bytes, remote.declaredUrl);
      return {
        role: "source_git",
        targetPath: configPath,
        operation: "replace",
        before,
        after: { state: "present", hash: sha256(after), size: after.byteLength },
      };
    }
    let url: string | null = null;
    try {
      if (state.urls.length === 1) url = parseNormalizedRemoteUrl(state.urls[0], remote.transport);
    } catch {
      url = null;
    }
    if (state.pushUrls !== 0 || url !== remote.declaredUrl) refuseGitPlanning("remote_conflict");
    return { role: "source_git", targetPath: configPath, operation: "keep", before, after: before };
  }

  /**
   * Git creates `objects/xx` only when an object lands there, and a sync effect publishes no
   * directory; enable publishes each absent one as an empty directory so every later loose object
   * has its parent (D62 (3), review I2).
   */
  async #missingFanOut(gitDirectory: CanonicalAbsolutePathV1): Promise<LifecyclePreviewFileChangeV1[]> {
    const changes: LifecyclePreviewFileChangeV1[] = [];
    for (const prefix of GIT_LOOSE_OBJECT_FAN_OUT) {
      const targetPath = child(gitDirectory, `objects/${prefix}`);
      if ((await this.#dependencies.fs.lstat(targetPath)) !== null) continue;
      changes.push({ role: "source_git", targetPath, operation: "create", before: { state: "absent" }, after: EMPTY_DIRECTORY_PREVIEW });
    }
    return changes;
  }

  /**
   * Spec §4.1 reconcile: the last managed inventory minus the new scope is
   * displayed as leaving the next Git tree; the local files stay.
   */
  async #retirements(request: GitEnableRequestV1, source: GitSourceStateV1): Promise<LifecyclePreviewFileChangeV1[]> {
    if (request.pushPending) refuseGitPlanning("reconcile_push_pending");
    const { baseline, scope } = request;
    if (baseline === null) return [];
    if (source.branchRef.state !== "present" || source.branchRef.oid !== baseline.lastPushedHeadOid) {
      refuseGitPlanning("reconcile_local_history");
    }
    const current = new Set(await enumerateGitScopePaths(this.#dependencies.enumerator, scope));
    const changes: LifecyclePreviewFileChangeV1[] = [];
    for (const path of baseline.managedPaths) {
      if (current.has(path)) continue;
      const bytes = await readGitRetiringPath(this.#dependencies, scope.brainPath, path);
      changes.push({
        role: "source_git",
        targetPath: child(scope.brainPath, path),
        operation: "remove",
        before: bytes === null ? { state: "absent" } : { state: "present", hash: sha256(bytes), size: bytes.byteLength },
        after: { state: "absent" },
      });
    }
    return changes;
  }

  async #diff(
    request: GitSyncRequestV1,
    index: GitAdmittedIndexV1,
    files: readonly GitScopeFileV1[],
  ): Promise<{
    readonly changes: readonly GitSyncChangeV1[];
    readonly candidateEntries: readonly GitIndexEntryV1[];
    readonly blobs: readonly GitObjectV1[];
  }> {
    const { scope, baseline } = request;
    const tracked = new Map(index.entries.map((entry) => [latin1(entry.name), entry]));
    const current = new Set<string>(files.map((file) => file.path));
    const retired = new Set<string>((baseline?.managedPaths ?? []).filter((path) => !current.has(path)));
    const changes: GitSyncChangeV1[] = [];
    const replaced = new Map<string, GitIndexEntryV1 | null>();
    const blobs: GitObjectV1[] = [];
    for (const file of files) {
      const blob = gitObject("blob", file.bytes);
      const name = encoder.encode(file.path);
      const mode = file.executable ? 0o100755 : 0o100644;
      const existing = tracked.get(latin1(name));
      if (existing !== undefined && existing.oid === blob.oid && existing.mode === mode) continue;
      changes.push({
        path: file.path,
        operation: existing === undefined ? "create" : "replace",
        sourceHash: sha256(file.bytes),
        blobOid: blob.oid,
      });
      replaced.set(latin1(name), gitIndexEntry(name, mode, blob.oid, file.bytes.byteLength));
      blobs.push(blob);
    }
    for (const entry of index.entries) {
      let path: string;
      try {
        path = strictUtf8.decode(entry.name);
      } catch {
        continue;
      }
      if (current.has(path)) continue;
      const scoped = isGitScopePath(this.#dependencies.enumerator, scope, path);
      if (!scoped && !retired.has(path)) continue;
      const relative = parseGitScopePath(path);
      if (!retired.has(path) && (await this.#dependencies.fs.lstat(child(scope.brainPath, relative))) !== null) {
        refuseGitPlanning("concurrent_change", relative);
      }
      changes.push({ path: relative, operation: "remove", sourceHash: null, blobOid: null });
      replaced.set(latin1(entry.name), null);
    }
    changes.sort((left, right) => compareUnsignedUtf8(left.path, right.path));
    const candidateEntries = [
      ...index.entries.filter((entry) => !replaced.has(latin1(entry.name))),
      ...[...replaced.values()].filter((entry): entry is GitIndexEntryV1 => entry !== null),
    ].sort((left, right) => compareBytes(left.name, right.name));
    return { changes, candidateEntries, blobs };
  }

  async #reflogPlan(
    gitDirectory: CanonicalAbsolutePathV1,
    sourceBefore: GitSourceStateV1,
    branch: ValidatedGitBranchV1,
    newOid: LowerHexSha1,
    committer: GitCommitterV1,
  ): Promise<GitReflogPlanV1 & { readonly side: "source" }> {
    const oldOid = sourceBefore.branchRef.state === "present" ? sourceBefore.branchRef.oid : GIT_ZERO_OID;
    const line = encoder.encode(gitReflogAppendLine({ oldOid, newOid, committer }));
    const append = async (
      role: "source_head_reflog" | "source_branch_reflog",
      relative: string,
      before: GitReflogStateV1,
    ): Promise<GitReflogAppendV1> => {
      const path = child(gitDirectory, relative);
      const prior =
        before.state === "absent"
          ? new Uint8Array(0)
          : (await this.#readBound(path, GIT_METADATA_BOUNDS.sourceHeadReflogMaxBytes, before.bytesHash)).bytes;
      const after = new Uint8Array(prior.byteLength + line.byteLength);
      after.set(prior, 0);
      after.set(line, prior.byteLength);
      return validateGitReflogAppend({
        role,
        path,
        before,
        oldOid,
        newOid,
        committer,
        message: GIT_REFLOG_MESSAGE,
        lineBytes: line.byteLength,
        lineHash: sha256(line),
        after: { state: "present", bytesHash: sha256(after), size: after.byteLength },
      });
    };
    const plan = validateGitReflogPlan({
      side: "source",
      head: await append("source_head_reflog", "logs/HEAD", sourceBefore.headReflog),
      branch: await append("source_branch_reflog", `logs/refs/heads/${branch}`, sourceBefore.branchReflog),
    });
    if (plan.side !== "source") fail("GitReflogPlanV1.side");
    return plan;
  }

  /** `expected` is the admitted hash, `"absent"` when admission saw no file, or null when unknown. */
  async #existingState(
    path: CanonicalAbsolutePathV1,
    expected: LowerHexSha256 | "absent" | null,
    oid: LowerHexSha1 | null,
  ): Promise<{ readonly before: GuardedGitPathStateV1; readonly mode: number | null }> {
    const entry = await this.#dependencies.fs.lstat(path);
    if (entry === null) {
      if (expected !== null && expected !== "absent") refuseGitPlanning("concurrent_change");
      return { before: { state: "absent" }, mode: null };
    }
    if (entry.kind !== "regular_file" || expected === "absent") refuseGitPlanning("concurrent_change");
    const bytesHash = expected ?? (await this.#dependencies.fs.hashRegular(entry, BigInt(entry.size)));
    return {
      before: regularState(entry, bytesHash, oid === null ? { kind: "none" } : { kind: "oid", value: oid }),
      mode: entry.mode,
    };
  }

  async #sourceTransitions(input: {
    readonly gitDirectory: CanonicalAbsolutePathV1;
    readonly branch: ValidatedGitBranchV1;
    readonly sourceBefore: GitSourceStateV1;
    readonly indexEntry: LifecycleGuardedEntryV1 | null;
    readonly objects: readonly GitPlannedObjectV1[];
    readonly candidateIndex: Uint8Array;
    readonly reflogPlan: GitReflogPlanV1 & { readonly side: "source" };
    readonly refBytes: Uint8Array;
    readonly commitOid: LowerHexSha1;
  }): Promise<readonly GitEffectTransitionV1[]> {
    const transitions: GitEffectTransitionV1[] = [];
    const push = (
      role: GitEffectTransitionRoleV1,
      path: CanonicalAbsolutePathV1,
      before: GuardedGitPathStateV1,
      after: PlannedGitPathStateV1,
      reuse = false,
    ): void => {
      const operation = reuse ? "reuse" : before.state === "absent" ? "create" : "replace";
      transitions.push({ role, path, operation, before, after, evidence: GIT_EFFECT_EVIDENCE_UNBOUND });
    };
    for (const planned of input.objects) {
      const { before } = await this.#existingState(planned.path, null, null);
      if (before.state === "regular_file") {
        push("source_object", planned.path, before, { state: "regular_file", hash: before.hash, size: before.size, mode: before.mode, semantic: { kind: "none" } }, true);
      } else {
        push("source_object", planned.path, before, plannedFile(sha256(planned.looseBytes), planned.looseBytes.byteLength, 0o444, null));
      }
    }
    const { sourceBefore, reflogPlan } = input;
    const indexPath = child(input.gitDirectory, "index");
    const indexBefore =
      input.indexEntry === null || sourceBefore.index.state === "absent"
        ? ({ before: { state: "absent" }, mode: null } as const)
        : { before: regularState(input.indexEntry, sourceBefore.index.bytesHash, { kind: "none" }), mode: input.indexEntry.mode };
    push(
      "source_index",
      indexPath,
      indexBefore.before,
      plannedFile(sha256(input.candidateIndex), input.candidateIndex.byteLength, indexBefore.mode ?? 0o644, null),
    );
    for (const append of [reflogPlan.head, reflogPlan.branch]) {
      if (append === null) continue;
      const hash = append.before.state === "absent" ? "absent" : append.before.bytesHash;
      const existing = await this.#existingState(append.path, hash, null);
      push(append.role, append.path, existing.before, plannedFile(append.after.bytesHash, append.after.size, existing.mode ?? 0o644, null));
    }
    const refPath = child(input.gitDirectory, `refs/heads/${input.branch}`);
    const ref = sourceBefore.branchRef;
    const refState = await this.#existingState(
      refPath,
      ref.state === "present" ? ref.bytesHash : "absent",
      ref.state === "present" ? ref.oid : null,
    );
    push(
      "source_branch_ref",
      refPath,
      refState.before,
      plannedFile(sha256(input.refBytes), input.refBytes.byteLength, refState.mode ?? 0o644, input.commitOid),
    );
    assertGitSyncSourceTransitions(transitions, reflogPlan);
    /**
     * The effect publishes no directory. Enable's own tree publishes every fan-out and reflog
     * parent, but `git gc`, `prune` or `prune-packed` removes an emptied `objects/xx` again; a
     * repository that lacks one refuses here, before any ID is reserved, instead of as
     * `git_effect_parent` after intent, and a repeated `git enable` republishes it.
     */
    for (const transition of transitions) {
      if (transition.operation === "reuse") continue;
      const parent = transition.path.slice(0, transition.path.lastIndexOf("/"));
      if ((await this.#dependencies.fs.lstat(parseCanonicalAbsolutePathText(parent)))?.kind !== "directory") {
        refuseGitPlanning("git_object_parent_absent", parent);
      }
    }
    return transitions;
  }
}
