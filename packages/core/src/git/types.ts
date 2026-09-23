/**
 * Spec 1 §2.4 and §4.4's closed Git domain records. Every validator here is an
 * exact-key admission: an unknown key, a missing key, an illegal arm
 * combination or an out-of-range literal refuses, and nothing is normalized.
 */
import { createHash } from "node:crypto";

import { parseValidatedGitBranch } from "../config/lifecycle.js";
import { hashCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import { parseEffectiveUid, type EffectiveUidV1 } from "../lifecycle/ids.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  parseLowerHexSha256,
  parseUInt64Decimal,
  type LowerHexSha256,
  type UInt64DecimalV1,
} from "../update/scalars.js";

declare const lowerHexSha1: unique symbol;

export type LowerHexSha1 = string & { readonly [lowerHexSha1]: true };
export type FullBranchRefV1 = `refs/heads/${string}`;

export interface GitMetadataBoundsV1 {
  readonly sourceConfigMaxBytes: 1048576;
  readonly destinationConfigMaxBytes: 1048576;
  readonly candidateConfigMaxBytes: 2097152;
  readonly sourceIndexMaxBytes: 536870912;
  readonly sourceHeadMaxBytes: 4096;
  readonly destinationHeadMaxBytes: 4096;
  readonly looseRefMaxBytes: 41;
  readonly sourceHeadReflogMaxBytes: 67108864;
  readonly sourceBranchReflogMaxBytes: 67108864;
  readonly destinationBranchReflogMaxBytes: 67108864;
  readonly reflogAppendMaxBytes: 4096;
  readonly reflogPostimageMaxBytes: 67112960;
}

export const GIT_METADATA_BOUNDS: GitMetadataBoundsV1 = Object.freeze({
  sourceConfigMaxBytes: 1048576,
  destinationConfigMaxBytes: 1048576,
  candidateConfigMaxBytes: 2097152,
  sourceIndexMaxBytes: 536870912,
  sourceHeadMaxBytes: 4096,
  destinationHeadMaxBytes: 4096,
  looseRefMaxBytes: 41,
  sourceHeadReflogMaxBytes: 67108864,
  sourceBranchReflogMaxBytes: 67108864,
  destinationBranchReflogMaxBytes: 67108864,
  reflogAppendMaxBytes: 4096,
  reflogPostimageMaxBytes: 67112960,
});

export interface GitPackReaderBudgetV1 {
  readonly compressedPackMaxBytes: 2147483648;
  readonly packHeaderObjectCount: number;
  readonly closedEffectObjectCount: number;
  readonly admittedObjectCount: number;
  readonly perObjectInflatedMaxBytes: 536870912;
  readonly aggregateInflatedMaxBytes: 8589934592;
  readonly deltaDepthMax: 50;
  readonly deltaInstructionMax: 10000000;
  readonly deltaWorkMaxBytes: 8589934592;
  readonly residentMemoryMaxBytes: 268435456;
  readonly additionalTempMaxBytes: 10737418240;
  readonly inheritedPushDeadlineMs: 600000;
}

export type GitSemanticStateV1 =
  | { readonly kind: "none" }
  | { readonly kind: "oid"; readonly value: LowerHexSha1 }
  | { readonly kind: "symbolic_ref"; readonly value: FullBranchRefV1 };

export type GitRefStateV1 =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly oid: LowerHexSha1; readonly bytesHash: LowerHexSha256 };

export type GitHeadStateV1 = {
  readonly state: "present";
  readonly bytesHash: LowerHexSha256;
  readonly semantic:
    | { readonly kind: "symbolic_ref"; readonly value: FullBranchRefV1 }
    | { readonly kind: "oid"; readonly value: LowerHexSha1 };
};

/**
 * Spec §4.4's exact persisted shape. The DIRC version and TREE-cache facts
 * are admission refusals in `inspectGitMetadata`, not reported fields,
 * because this record is byte-compared inside `PersistedGitPushPlanV1`.
 */
export type GitIndexStateV1 =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly bytesHash: LowerHexSha256 };

export type GitReflogStateV1 =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly bytesHash: LowerHexSha256; readonly size: number };

export type GitReflogOidV1 = LowerHexSha1 | "0000000000000000000000000000000000000000";

export type GitReflogRoleV1 = "source_head_reflog" | "source_branch_reflog" | "destination_branch_reflog";

export interface GitReflogAppendV1 {
  readonly role: GitReflogRoleV1;
  readonly path: CanonicalAbsolutePathV1;
  readonly before: GitReflogStateV1;
  readonly oldOid: GitReflogOidV1;
  readonly newOid: LowerHexSha1;
  readonly committer: {
    readonly name: string;
    readonly email: string;
    readonly unixSeconds: number;
    readonly utcOffset: string;
  };
  readonly message: "developer-os sync";
  readonly lineBytes: number;
  readonly lineHash: LowerHexSha256;
  readonly after: { readonly state: "present"; readonly bytesHash: LowerHexSha256; readonly size: number };
}

export type GitReflogPlanV1 =
  | {
      readonly side: "source";
      readonly head: GitReflogAppendV1 | null;
      readonly branch: GitReflogAppendV1 | null;
    }
  | { readonly side: "destination"; readonly branch: GitReflogAppendV1 | null };

export interface GitSourceStateV1 {
  readonly configHash: LowerHexSha256;
  readonly index: GitIndexStateV1;
  readonly head: GitHeadStateV1;
  readonly headReflog: GitReflogStateV1;
  readonly branchReflog: GitReflogStateV1;
  readonly branchRef: GitRefStateV1;
}

export type GitTreeRelativePathV1 = string;

export type GitTreeFingerprintEntryV1 =
  | {
      readonly relativePath: GitTreeRelativePathV1;
      readonly kind: "directory";
      readonly ownerUid: EffectiveUidV1;
      readonly mode: number;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    }
  | {
      readonly relativePath: GitTreeRelativePathV1;
      readonly kind: "regular_file";
      readonly ownerUid: EffectiveUidV1;
      readonly mode: number;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
      readonly nlink: 1;
      readonly size: number;
      readonly hash: LowerHexSha256;
    };

export interface GitTreeFingerprintV1 {
  readonly root: {
    readonly ownerUid: EffectiveUidV1;
    readonly mode: number;
    readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1;
  };
  readonly entries: readonly GitTreeFingerprintEntryV1[];
}

export type GuardedGitPathStateV1 =
  | { readonly state: "absent" }
  | {
      readonly state: "regular_file";
      readonly hash: LowerHexSha256;
      readonly size: number;
      readonly mode: number;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
      readonly semantic: GitSemanticStateV1;
    }
  | {
      readonly state: "directory_tree";
      readonly treeHash: LowerHexSha256;
      readonly entryCount: number;
      readonly ownerUid: EffectiveUidV1;
      readonly mode: number;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
      readonly symbolicHead: FullBranchRefV1;
    };

export interface GitRelinquishedDirectoryRootV1 {
  readonly state: "relinquished_directory_root";
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
  readonly observedOwnerUid: number;
  readonly observedMode: number;
}

export type PlannedGitPathStateV1 =
  | { readonly state: "absent" }
  | {
      readonly state: "regular_file";
      readonly hash: LowerHexSha256;
      readonly size: number;
      readonly mode: number;
      readonly semantic: GitSemanticStateV1;
    }
  | {
      readonly state: "directory_tree";
      readonly treeHash: LowerHexSha256;
      readonly entryCount: number;
      readonly ownerUid: EffectiveUidV1;
      readonly mode: number;
      readonly symbolicHead: FullBranchRefV1;
    };

export const GIT_ZERO_OID = "0000000000000000000000000000000000000000";
export const GIT_REFLOG_MESSAGE = "developer-os sync";
export const GIT_TREE_FINGERPRINT_MAX_ENTRIES = 511;
export const GIT_OBJECT_COUNT_MAX = 200001;

const GIT_TREE_FINGERPRINT_DOMAIN = "developer-os:git-tree-fingerprint:v1";
const MAX_UINT32 = 4_294_967_295;
const encoder = new TextEncoder();

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function exact(
  value: unknown,
  keys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).length !== keys.length || keys.some((key) => !Object.hasOwn(input, key))) {
    fail(`${label}: keys`);
  }
  return input;
}

function tagOf(value: unknown, field: string, label: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  return (value as Readonly<Record<string, unknown>>)[field];
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(label);
  }
  return value;
}

function literal<T>(value: unknown, expected: T, label: string): T {
  if (value !== expected) fail(label);
  return expected;
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

/** Unsigned UTF-8 byte order, the order spec §2.4 and §4.4 sort every path set by. */
export function compareUnsignedUtf8(left: string, right: string): number {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const shared = Math.min(a.byteLength, b.byteLength);
  for (let index = 0; index < shared; index += 1) {
    const difference = (a[index] as number) - (b[index] as number);
    if (difference !== 0) return difference;
  }
  return a.byteLength - b.byteLength;
}

export function parseLowerHexSha1(value: unknown): LowerHexSha1 {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) fail("LowerHexSha1");
  return value as LowerHexSha1;
}

export function parseFullBranchRef(value: unknown): FullBranchRefV1 {
  if (typeof value !== "string" || !value.startsWith("refs/heads/")) fail("FullBranchRefV1");
  parseValidatedGitBranch(value.slice("refs/heads/".length));
  return value as FullBranchRefV1;
}

function parseMode(value: unknown, label: string): number {
  return integer(value, 0, 0o7777, label);
}

function parseSize(value: unknown, label: string): number {
  return integer(value, 0, Number.MAX_SAFE_INTEGER, label);
}

export function validateGitMetadataBounds(value: unknown): GitMetadataBoundsV1 {
  const label = "GitMetadataBoundsV1";
  const keys = Object.keys(GIT_METADATA_BOUNDS) as (keyof GitMetadataBoundsV1)[];
  const input = exact(value, keys, label);
  for (const key of keys) literal(input[key], GIT_METADATA_BOUNDS[key], `${label}.${key}`);
  return GIT_METADATA_BOUNDS;
}

const PACK_READER_FIXED = {
  compressedPackMaxBytes: 2147483648,
  perObjectInflatedMaxBytes: 536870912,
  aggregateInflatedMaxBytes: 8589934592,
  deltaDepthMax: 50,
  deltaInstructionMax: 10000000,
  deltaWorkMaxBytes: 8589934592,
  residentMemoryMaxBytes: 268435456,
  additionalTempMaxBytes: 10737418240,
  inheritedPushDeadlineMs: 600000,
} as const;

/**
 * The reader's budget is persisted only after a successful pre-intent read,
 * and spec §4.2 defines success as all three counts equal, so a budget whose
 * counts disagree can never describe a real admitted pack.
 */
export function validateGitPackReaderBudget(value: unknown): GitPackReaderBudgetV1 {
  const label = "GitPackReaderBudgetV1";
  const input = exact(
    value,
    [...Object.keys(PACK_READER_FIXED), "packHeaderObjectCount", "closedEffectObjectCount", "admittedObjectCount"],
    label,
  );
  for (const [key, expected] of Object.entries(PACK_READER_FIXED)) {
    literal(input[key], expected, `${label}.${key}`);
  }
  const packHeaderObjectCount = integer(input.packHeaderObjectCount, 0, GIT_OBJECT_COUNT_MAX, `${label}.packHeaderObjectCount`);
  const closedEffectObjectCount = integer(input.closedEffectObjectCount, 0, GIT_OBJECT_COUNT_MAX, `${label}.closedEffectObjectCount`);
  const admittedObjectCount = integer(input.admittedObjectCount, 0, GIT_OBJECT_COUNT_MAX, `${label}.admittedObjectCount`);
  if (packHeaderObjectCount !== closedEffectObjectCount || closedEffectObjectCount !== admittedObjectCount) {
    fail(`${label}: counts`);
  }
  return { ...PACK_READER_FIXED, packHeaderObjectCount, closedEffectObjectCount, admittedObjectCount };
}

export function validateGitSemanticState(value: unknown): GitSemanticStateV1 {
  const label = "GitSemanticStateV1";
  const kind = tagOf(value, "kind", label);
  if (kind === "none") {
    exact(value, ["kind"], label);
    return { kind: "none" };
  }
  const input = exact(value, ["kind", "value"], label);
  if (kind === "oid") return { kind: "oid", value: parseLowerHexSha1(input.value) };
  if (kind === "symbolic_ref") return { kind: "symbolic_ref", value: parseFullBranchRef(input.value) };
  return fail(`${label}.kind`);
}

export function validateGitRefState(value: unknown): GitRefStateV1 {
  const label = "GitRefStateV1";
  const state = tagOf(value, "state", label);
  if (state === "absent") {
    exact(value, ["state"], label);
    return { state: "absent" };
  }
  if (state !== "present") fail(`${label}.state`);
  const input = exact(value, ["state", "oid", "bytesHash"], label);
  return { state: "present", oid: parseLowerHexSha1(input.oid), bytesHash: parseLowerHexSha256(input.bytesHash) };
}

export function validateGitHeadState(value: unknown): GitHeadStateV1 {
  const label = "GitHeadStateV1";
  const input = exact(value, ["state", "bytesHash", "semantic"], label);
  literal(input.state, "present", `${label}.state`);
  const semantic = validateGitSemanticState(input.semantic);
  if (semantic.kind === "none") fail(`${label}.semantic`);
  return { state: "present", bytesHash: parseLowerHexSha256(input.bytesHash), semantic };
}

export function validateGitIndexState(value: unknown): GitIndexStateV1 {
  const label = "GitIndexStateV1";
  const state = tagOf(value, "state", label);
  if (state === "absent") {
    exact(value, ["state"], label);
    return { state: "absent" };
  }
  if (state !== "present") fail(`${label}.state`);
  const input = exact(value, ["state", "bytesHash"], label);
  return { state: "present", bytesHash: parseLowerHexSha256(input.bytesHash) };
}

export function validateGitReflogState(value: unknown): GitReflogStateV1 {
  const label = "GitReflogStateV1";
  const state = tagOf(value, "state", label);
  if (state === "absent") {
    exact(value, ["state"], label);
    return { state: "absent" };
  }
  if (state !== "present") fail(`${label}.state`);
  const input = exact(value, ["state", "bytesHash", "size"], label);
  return {
    state: "present",
    bytesHash: parseLowerHexSha256(input.bytesHash),
    size: integer(input.size, 0, GIT_METADATA_BOUNDS.reflogPostimageMaxBytes, `${label}.size`),
  };
}

function parseReflogOid(value: unknown): GitReflogOidV1 {
  return value === GIT_ZERO_OID ? GIT_ZERO_OID : parseLowerHexSha1(value);
}

function parseReflogName(value: unknown): string {
  const label = "GitReflogNameV1";
  if (typeof value !== "string") fail(label);
  const bytes = byteLength(value);
  if (bytes < 1 || bytes > 256 || !value.isWellFormed()) fail(label);
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    const control = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    if (control || codePoint === 0x2028 || codePoint === 0x2029 || character === "<" || character === ">") {
      fail(label);
    }
  }
  return value;
}

function parseReflogEmail(value: unknown): string {
  if (typeof value !== "string" || !/^[\x21-\x3b\x3d\x3f-\x7e]{1,320}$/.test(value)) fail("GitReflogEmailV1");
  return value;
}

function parseReflogUtcOffset(value: unknown): string {
  if (typeof value !== "string" || !/^[+-](?:0[0-9]|1[0-4])[0-5][0-9]$/.test(value)) fail("GitReflogUtcOffsetV1");
  return value;
}

/** The exact spec §2.4 append line, the only bytes `lineBytes`/`lineHash` may describe. */
export function gitReflogAppendLine(append: Pick<GitReflogAppendV1, "oldOid" | "newOid" | "committer">): string {
  const { name, email, unixSeconds, utcOffset } = append.committer;
  return `${append.oldOid} ${append.newOid} ${name} <${email}> ${unixSeconds.toString(10)} ${utcOffset}\t${GIT_REFLOG_MESSAGE}\n`;
}

const REFLOG_ROLES: readonly GitReflogRoleV1[] = ["source_head_reflog", "source_branch_reflog", "destination_branch_reflog"];

export function validateGitReflogAppend(value: unknown): GitReflogAppendV1 {
  const label = "GitReflogAppendV1";
  const input = exact(
    value,
    ["role", "path", "before", "oldOid", "newOid", "committer", "message", "lineBytes", "lineHash", "after"],
    label,
  );
  if (!REFLOG_ROLES.includes(input.role as GitReflogRoleV1)) fail(`${label}.role`);
  const role = input.role as GitReflogRoleV1;
  const path = parseCanonicalAbsolutePathText(input.path);
  const pathMatchesRole = role === "source_head_reflog" ? path.endsWith("/logs/HEAD") : path.includes("/logs/refs/heads/");
  if (!pathMatchesRole) fail(`${label}.path`);
  const before = validateGitReflogState(input.before);
  if (before.state === "present" && before.size > GIT_METADATA_BOUNDS.sourceHeadReflogMaxBytes) {
    fail(`${label}.before.size`);
  }
  const committerInput = exact(input.committer, ["name", "email", "unixSeconds", "utcOffset"], `${label}.committer`);
  const committer = {
    name: parseReflogName(committerInput.name),
    email: parseReflogEmail(committerInput.email),
    unixSeconds: integer(committerInput.unixSeconds, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "GitReflogUnixSecondsV1"),
    utcOffset: parseReflogUtcOffset(committerInput.utcOffset),
  };
  const oldOid = parseReflogOid(input.oldOid);
  const newOid = parseLowerHexSha1(input.newOid);
  const message = literal(input.message, GIT_REFLOG_MESSAGE, `${label}.message`);
  const line = gitReflogAppendLine({ oldOid, newOid, committer });
  const lineBytes = integer(input.lineBytes, 1, GIT_METADATA_BOUNDS.reflogAppendMaxBytes, `${label}.lineBytes`);
  if (lineBytes !== byteLength(line)) fail(`${label}.lineBytes`);
  const lineHash = parseLowerHexSha256(input.lineHash);
  if (lineHash !== createHash("sha256").update(line, "utf8").digest("hex")) fail(`${label}.lineHash`);
  const afterInput = exact(input.after, ["state", "bytesHash", "size"], `${label}.after`);
  literal(afterInput.state, "present", `${label}.after.state`);
  const afterSize = integer(afterInput.size, 1, GIT_METADATA_BOUNDS.reflogPostimageMaxBytes, `${label}.after.size`);
  if (afterSize !== (before.state === "absent" ? lineBytes : before.size + lineBytes)) fail(`${label}.after.size`);
  return {
    role,
    path,
    before,
    oldOid,
    newOid,
    committer,
    message,
    lineBytes,
    lineHash,
    after: { state: "present", bytesHash: parseLowerHexSha256(afterInput.bytesHash), size: afterSize },
  };
}

function nullableAppend(value: unknown, role: GitReflogRoleV1, label: string): GitReflogAppendV1 | null {
  if (value === null) return null;
  const append = validateGitReflogAppend(value);
  if (append.role !== role) fail(`${label}: role`);
  return append;
}

export function validateGitReflogPlan(value: unknown): GitReflogPlanV1 {
  const label = "GitReflogPlanV1";
  const side = tagOf(value, "side", label);
  if (side === "destination") {
    const input = exact(value, ["side", "branch"], label);
    const branch = nullableAppend(input.branch, "destination_branch_reflog", `${label}.branch`);
    if (branch === null) fail(`${label}: no append`);
    return { side: "destination", branch };
  }
  if (side !== "source") fail(`${label}.side`);
  const input = exact(value, ["side", "head", "branch"], label);
  const head = nullableAppend(input.head, "source_head_reflog", `${label}.head`);
  const branch = nullableAppend(input.branch, "source_branch_reflog", `${label}.branch`);
  if (head === null && branch === null) fail(`${label}: no append`);
  if (head !== null && branch !== null) {
    if (head.path === branch.path) fail(`${label}: duplicate path`);
    if (head.oldOid !== branch.oldOid || head.newOid !== branch.newOid) fail(`${label}: controlling ref OIDs`);
    if (gitReflogAppendLine(head) !== gitReflogAppendLine(branch)) fail(`${label}: committer`);
  }
  return { side: "source", head, branch };
}

/**
 * The source `HEAD` is always symbolic (spec §4.4), and an absent index is
 * legal only for the unborn repository, whose branch ref is absent.
 */
export function validateGitSourceState(value: unknown): GitSourceStateV1 {
  const label = "GitSourceStateV1";
  const input = exact(value, ["configHash", "index", "head", "headReflog", "branchReflog", "branchRef"], label);
  const head = validateGitHeadState(input.head);
  if (head.semantic.kind !== "symbolic_ref") fail(`${label}.head: detached`);
  const index = validateGitIndexState(input.index);
  const branchRef = validateGitRefState(input.branchRef);
  if (index.state === "absent" && branchRef.state !== "absent") fail(`${label}.index: absent on a born branch`);
  return {
    configHash: parseLowerHexSha256(input.configHash),
    index,
    head,
    headReflog: validateGitReflogState(input.headReflog),
    branchReflog: validateGitReflogState(input.branchReflog),
    branchRef,
  };
}

export function parseGitTreeRelativePath(value: unknown): GitTreeRelativePathV1 {
  const label = "GitTreeRelativePathV1";
  if (typeof value !== "string" || !value.isWellFormed()) fail(label);
  const bytes = byteLength(value);
  if (bytes < 1 || bytes > 4096 || value.includes("\0") || value.includes("\\")) fail(label);
  const components = value.split("/");
  if (components.length > 128) fail(`${label}: component count`);
  if (components.some((component) => component.length === 0 || component === "." || component === "..")) {
    fail(`${label}: component`);
  }
  return value;
}

function parseTreeFingerprintEntry(value: unknown, effectiveUid: number): GitTreeFingerprintEntryV1 {
  const label = "GitTreeFingerprintEntryV1";
  const kind = tagOf(value, "kind", label);
  if (kind === "directory") {
    const input = exact(value, ["relativePath", "kind", "ownerUid", "mode", "dev", "ino"], label);
    return {
      relativePath: parseGitTreeRelativePath(input.relativePath),
      kind: "directory",
      ownerUid: parseEffectiveUid(input.ownerUid, effectiveUid),
      mode: parseMode(input.mode, `${label}.mode`),
      dev: parseUInt64Decimal(input.dev),
      ino: parseUInt64Decimal(input.ino),
    };
  }
  if (kind !== "regular_file") fail(`${label}.kind`);
  const input = exact(
    value,
    ["relativePath", "kind", "ownerUid", "mode", "dev", "ino", "nlink", "size", "hash"],
    label,
  );
  return {
    relativePath: parseGitTreeRelativePath(input.relativePath),
    kind: "regular_file",
    ownerUid: parseEffectiveUid(input.ownerUid, effectiveUid),
    mode: parseMode(input.mode, `${label}.mode`),
    dev: parseUInt64Decimal(input.dev),
    ino: parseUInt64Decimal(input.ino),
    nlink: literal(input.nlink, 1, `${label}.nlink`),
    size: parseSize(input.size, `${label}.size`),
    hash: parseLowerHexSha256(input.hash),
  };
}

export function validateGitTreeFingerprint(value: unknown, effectiveUid: number): GitTreeFingerprintV1 {
  const label = "GitTreeFingerprintV1";
  const input = exact(value, ["root", "entries"], label);
  const root = exact(input.root, ["ownerUid", "mode", "dev", "ino"], `${label}.root`);
  if (!Array.isArray(input.entries)) fail(`${label}.entries`);
  const rawEntries = input.entries as readonly unknown[];
  if (rawEntries.length < 1 || rawEntries.length > GIT_TREE_FINGERPRINT_MAX_ENTRIES) fail(`${label}.entries: count`);
  const entries = rawEntries.map((entry) => parseTreeFingerprintEntry(entry, effectiveUid));
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1] as GitTreeFingerprintEntryV1;
    const current = entries[index] as GitTreeFingerprintEntryV1;
    if (compareUnsignedUtf8(previous.relativePath, current.relativePath) >= 0) fail(`${label}.entries: order`);
  }
  return {
    root: {
      ownerUid: parseEffectiveUid(root.ownerUid, effectiveUid),
      mode: parseMode(root.mode, `${label}.root.mode`),
      dev: parseUInt64Decimal(root.dev),
      ino: parseUInt64Decimal(root.ino),
    },
    entries,
  };
}

export function gitTreeFingerprintHash(fingerprint: GitTreeFingerprintV1): LowerHexSha256 {
  return hashCanonicalJson(GIT_TREE_FINGERPRINT_DOMAIN, fingerprint as unknown as CanonicalJsonValue);
}

export function validateGuardedGitPathState(value: unknown, effectiveUid: number): GuardedGitPathStateV1 {
  const label = "GuardedGitPathStateV1";
  const state = tagOf(value, "state", label);
  if (state === "absent") {
    exact(value, ["state"], label);
    return { state: "absent" };
  }
  if (state === "regular_file") {
    const input = exact(value, ["state", "hash", "size", "mode", "dev", "ino", "semantic"], label);
    return {
      state: "regular_file",
      hash: parseLowerHexSha256(input.hash),
      size: parseSize(input.size, `${label}.size`),
      mode: parseMode(input.mode, `${label}.mode`),
      dev: parseUInt64Decimal(input.dev),
      ino: parseUInt64Decimal(input.ino),
      semantic: validateGitSemanticState(input.semantic),
    };
  }
  if (state !== "directory_tree") fail(`${label}.state`);
  const input = exact(
    value,
    ["state", "treeHash", "entryCount", "ownerUid", "mode", "dev", "ino", "symbolicHead"],
    label,
  );
  return {
    state: "directory_tree",
    treeHash: parseLowerHexSha256(input.treeHash),
    entryCount: integer(input.entryCount, 1, GIT_TREE_FINGERPRINT_MAX_ENTRIES, `${label}.entryCount`),
    ownerUid: parseEffectiveUid(input.ownerUid, effectiveUid),
    mode: parseMode(input.mode, `${label}.mode`),
    dev: parseUInt64Decimal(input.dev),
    ino: parseUInt64Decimal(input.ino),
    symbolicHead: parseFullBranchRef(input.symbolicHead),
  };
}

export function validatePlannedGitPathState(value: unknown, effectiveUid: number): PlannedGitPathStateV1 {
  const label = "PlannedGitPathStateV1";
  const state = tagOf(value, "state", label);
  if (state === "absent") {
    exact(value, ["state"], label);
    return { state: "absent" };
  }
  if (state === "regular_file") {
    const input = exact(value, ["state", "hash", "size", "mode", "semantic"], label);
    return {
      state: "regular_file",
      hash: parseLowerHexSha256(input.hash),
      size: parseSize(input.size, `${label}.size`),
      mode: parseMode(input.mode, `${label}.mode`),
      semantic: validateGitSemanticState(input.semantic),
    };
  }
  if (state !== "directory_tree") fail(`${label}.state`);
  const input = exact(value, ["state", "treeHash", "entryCount", "ownerUid", "mode", "symbolicHead"], label);
  return {
    state: "directory_tree",
    treeHash: parseLowerHexSha256(input.treeHash),
    entryCount: integer(input.entryCount, 1, GIT_TREE_FINGERPRINT_MAX_ENTRIES, `${label}.entryCount`),
    ownerUid: parseEffectiveUid(input.ownerUid, effectiveUid),
    mode: parseMode(input.mode, `${label}.mode`),
    symbolicHead: parseFullBranchRef(input.symbolicHead),
  };
}

export function validateGitRelinquishedDirectoryRoot(value: unknown): GitRelinquishedDirectoryRootV1 {
  const label = "GitRelinquishedDirectoryRootV1";
  const input = exact(value, ["state", "dev", "ino", "observedOwnerUid", "observedMode"], label);
  literal(input.state, "relinquished_directory_root", `${label}.state`);
  return {
    state: "relinquished_directory_root",
    dev: parseUInt64Decimal(input.dev),
    ino: parseUInt64Decimal(input.ino),
    observedOwnerUid: integer(input.observedOwnerUid, 0, MAX_UINT32, `${label}.observedOwnerUid`),
    observedMode: parseMode(input.observedMode, `${label}.observedMode`),
  };
}
