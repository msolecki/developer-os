import {
  decodeCanonicalJson,
  encodeCanonicalJson,
  hashCanonicalJson,
} from "../lifecycle/canonical-json.js";
import type { CanonicalJsonV1, CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import { parseCanonicalAbsolutePathText } from "../update/paths.js";
import type { CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseLowerHexSha256 } from "../update/scalars.js";
import type { LowerHexSha256 } from "../update/scalars.js";
import { pathSegmentViolation } from "./segment.js";

declare const validatedGitBranchV1: unique symbol;
declare const normalizedRemoteUrlV1: unique symbol;
declare const vaultSegmentV1: unique symbol;

export type ValidatedGitBranchV1 = string & { readonly [validatedGitBranchV1]: true };
export type NormalizedRemoteUrlV1 = string & { readonly [normalizedRemoteUrlV1]: true };
export type VaultSegmentV1 = string & { readonly [vaultSegmentV1]: true };

export type GitRemoteTransportV1 = "local" | "https" | "ssh";

export interface GitScopeSnapshotV1 {
  readonly brainPath: CanonicalAbsolutePathV1;
  readonly contentRoot: VaultSegmentV1;
  readonly topicFolders: readonly VaultSegmentV1[];
  readonly topicAliases: Readonly<Record<string, VaultSegmentV1>>;
  readonly indexesDir: VaultSegmentV1;
  readonly fingerprint: LowerHexSha256;
}

export interface GitSyncConfigV1 {
  readonly schemaVersion: 1;
  readonly repositoryRoot: CanonicalAbsolutePathV1;
  readonly branch: ValidatedGitBranchV1;
  readonly remote: {
    readonly name: "developer-os";
    readonly transport: GitRemoteTransportV1;
    readonly declaredUrl: NormalizedRemoteUrlV1;
    readonly effectivePushUrl: NormalizedRemoteUrlV1;
  };
  readonly scope: GitScopeSnapshotV1;
}

export type NormalizedScheduleV1 =
  | { readonly cadence: "hourly"; readonly minute: number }
  | { readonly cadence: "daily"; readonly hour: number; readonly minute: number }
  | {
      readonly cadence: "weekly";
      readonly day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
      readonly hour: number;
      readonly minute: number;
    };

export type ScheduledJobIdV1 = "brain-reindex" | "brain-lint" | "doctor" | "git-sync";

export interface AutomationConfigV1 {
  readonly schemaVersion: 1;
  readonly schedules: readonly {
    readonly job: ScheduledJobIdV1;
    readonly schedule: NormalizedScheduleV1;
  }[];
}

export type LifecycleActivationArmV1 =
  | { readonly state: "inactive" }
  | { readonly state: "active"; readonly configHash: LowerHexSha256 };

export interface LifecycleActivationRecordV1 {
  readonly schemaVersion: 1;
  readonly git: LifecycleActivationArmV1;
  readonly automation: LifecycleActivationArmV1;
}

/**
 * Reconciliation order, not an alphabetical set: Spec 1 §2.2 fixes the first three
 * entries as mandatory and `git-sync` as exactly the fourth when it was eligible at
 * apply, and Task 9's lease acquisition walks the same order.
 */
export const SCHEDULED_JOB_IDS: readonly ["brain-reindex", "brain-lint", "doctor", "git-sync"] = [
  "brain-reindex",
  "brain-lint",
  "doctor",
  "git-sync",
];

export const WEEKDAY_IDS: readonly ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

/**
 * Defensive, not §2.2: the activation record has no specified size bound and runs about
 * 200 bytes, but `decodeCanonicalJson` requires a ceiling, so this is the one place a
 * bound is chosen rather than copied. It is deliberately not §2.2's 1 MiB `config.toml`
 * lifecycle-record bound, which governs a different file for a different reason.
 */
const ACTIVATION_RECORD_MAX_BYTES = 1_048_576;
const REMOTE_URL_MAX_BYTES = 4096;
const GIT_BRANCH_MAX_BYTES = 255;
const VAULT_SEGMENT_MAX_BYTES = 255;
const SSH_SEGMENT_MAX_BYTES = 255;
const DNS_NAME_MAX_BYTES = 253;
const SSH_PATH_MAX_SEGMENTS = 32;

const encoder = new TextEncoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label}: not a string`);
  return value;
}

export function parseVaultSegment(value: unknown): VaultSegmentV1 {
  const text = requireString(value, "VaultSegmentV1");
  const violation = pathSegmentViolation(text);
  if (violation !== null) fail(`VaultSegmentV1: ${violation}`);
  if (byteLength(text) > VAULT_SEGMENT_MAX_BYTES) fail("VaultSegmentV1: byte length");
  return text as VaultSegmentV1;
}

/**
 * Git 2.50.1's `check-ref-format` rules for a branch name, as Spec 1 §2.2 enumerates
 * them. The control range stops at DEL because that is where Git's own check stops: a
 * C1 scalar is an ordinary UTF-8 byte sequence to `refs/heads`, and refusing it here
 * would refuse a branch the user's Git accepts.
 */
export function parseValidatedGitBranch(value: unknown): ValidatedGitBranchV1 {
  const text = requireString(value, "ValidatedGitBranchV1");
  const bytes = byteLength(text);
  if (bytes < 1 || bytes > GIT_BRANCH_MAX_BYTES) fail("ValidatedGitBranchV1: byte length");
  if (text.startsWith("-") || text === "@") fail("ValidatedGitBranchV1: option-shaped");
  for (const character of text) {
    const codePoint = character.codePointAt(0) as number;
    if (codePoint <= 0x20 || codePoint === 0x7f) fail("ValidatedGitBranchV1: control or space");
  }
  if (text.includes("..") || text.includes("@{") || /[~^:?*[\\]/.test(text)) {
    fail("ValidatedGitBranchV1: reserved sequence");
  }
  if (text.endsWith(".") || text.endsWith("/")) fail("ValidatedGitBranchV1: trailing dot or slash");
  for (const component of text.split("/")) {
    if (component.length === 0 || component.startsWith(".") || component.endsWith(".lock")) {
      fail("ValidatedGitBranchV1: component");
    }
  }
  return text as ValidatedGitBranchV1;
}

const UNRESERVED = /^[A-Za-z0-9._~-]$/;
const SSH_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;
const SSH_USERNAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Only uppercase `%HH` decodes, because §2.2 stores uppercase: a lowercase escape is a
 * spelling normalization would change, and this function admits stored normalized forms
 * only. A literal byte above ASCII is likewise never the stored form, since every
 * non-unreserved byte is escaped.
 */
function percentDecode(raw: string, label: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index] as string;
    if (character === "%") {
      const hex = raw.slice(index + 1, index + 3);
      if (!/^[0-9A-F]{2}$/.test(hex)) fail(`${label}: percent escape`);
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
      continue;
    }
    const codePoint = character.codePointAt(0) as number;
    if (codePoint > 0x7f) fail(`${label}: unescaped non-ASCII byte`);
    bytes.push(codePoint);
  }
  try {
    return strictUtf8.decode(Uint8Array.from(bytes));
  } catch {
    fail(`${label}: percent escapes are not UTF-8`);
  }
}

function percentEncode(value: string, keepSlash: boolean): string {
  let encoded = "";
  for (const byte of encoder.encode(value)) {
    const character = String.fromCharCode(byte);
    if (UNRESERVED.test(character) || (keepSlash && character === "/")) encoded += character;
    else encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return encoded;
}

function assertNoControl(value: string, label: string): void {
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) fail(`${label}: control`);
  }
}

/** A lowercase ASCII DNS name or a canonical dotted-decimal IPv4 literal, per §2.2. */
function parseRemoteHost(host: string, label: string): string {
  if (/^[0-9][0-9.]*$/.test(host)) {
    const octets = host.split(".");
    if (
      octets.length !== 4 ||
      octets.some((octet) => !/^(?:0|[1-9][0-9]{0,2})$/.test(octet) || Number(octet) > 255)
    ) {
      fail(`${label}: not canonical IPv4`);
    }
    return host;
  }
  if (byteLength(host) < 1 || byteLength(host) > DNS_NAME_MAX_BYTES) fail(`${label}: DNS name length`);
  for (const dnsLabel of host.split(".")) {
    if (!DNS_LABEL.test(dnsLabel)) fail(`${label}: DNS label`);
  }
  return host;
}

function parseAuthority(
  authority: string,
  defaultPort: number,
  allowUsername: boolean,
  label: string,
): string {
  let credential = "";
  let remainder = authority;
  const at = remainder.indexOf("@");
  if (at >= 0) {
    if (!allowUsername) fail(`${label}: userinfo`);
    const username = remainder.slice(0, at);
    if (!SSH_USERNAME.test(username)) fail(`${label}: username`);
    credential = `${username}@`;
    remainder = remainder.slice(at + 1);
  }
  const colon = remainder.indexOf(":");
  if (colon < 0) return `${credential}${parseRemoteHost(remainder, label)}`;
  const port = remainder.slice(colon + 1);
  if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535 || Number(port) === defaultPort) {
    fail(`${label}: port`);
  }
  return `${credential}${parseRemoteHost(remainder.slice(0, colon), label)}:${port}`;
}

/**
 * Re-encoding each decoded segment and demanding the original bytes back is what makes
 * every §2.2 escape rule one check: a lowercase escape, an escaped unreserved byte, an
 * escaped separator and a literal reserved byte all fail to round-trip.
 */
function parseUrlPath(
  path: string,
  label: string,
  admitSegment: ((decoded: string) => void) | null,
): string {
  if (!path.startsWith("/")) fail(`${label}: path`);
  const segments = path.slice(1).split("/");
  for (const segment of segments) {
    const decoded = percentDecode(segment, label);
    if (decoded === "." || decoded === "..") fail(`${label}: dot segment`);
    if (decoded.includes("/") || decoded.includes("\\")) fail(`${label}: encoded separator`);
    assertNoControl(decoded, label);
    if (percentEncode(decoded, false) !== segment) fail(`${label}: not normalized`);
    if (admitSegment !== null) admitSegment(decoded);
  }
  return path;
}

function parseLocalRemoteUrl(text: string): string {
  const label = "NormalizedRemoteUrlV1 (local)";
  if (!text.startsWith("file:///")) fail(`${label}: not a normalized file URL`);
  const raw = text.slice("file://".length);
  const path = parseCanonicalAbsolutePathText(percentDecode(raw, label));
  return `file://${percentEncode(path, true)}`;
}

function parseHttpsRemoteUrl(text: string): string {
  const label = "NormalizedRemoteUrlV1 (https)";
  if (!text.startsWith("https://")) fail(`${label}: not a normalized HTTPS URL`);
  const remainder = text.slice("https://".length);
  const slash = remainder.indexOf("/");
  if (slash < 0) fail(`${label}: empty path`);
  const authority = parseAuthority(remainder.slice(0, slash), 443, false, label);
  return `https://${authority}${parseUrlPath(remainder.slice(slash), label, null)}`;
}

function admitSshPathSegment(decoded: string): void {
  if (!SSH_PATH_SEGMENT.test(decoded)) fail("NormalizedRemoteUrlV1 (ssh): repository segment");
}

function parseSshUrlRemote(text: string): string {
  const label = "NormalizedRemoteUrlV1 (ssh)";
  const remainder = text.slice("ssh://".length);
  const slash = remainder.indexOf("/");
  if (slash < 0) fail(`${label}: empty repository path`);
  const authority = parseAuthority(remainder.slice(0, slash), 22, true, label);
  const path = remainder.slice(slash);
  const segments = path.slice(1).split("/");
  if (segments.length < 1 || segments.length > SSH_PATH_MAX_SEGMENTS) {
    fail(`${label}: repository segment count`);
  }
  return `ssh://${authority}${parseUrlPath(path, label, admitSshPathSegment)}`;
}

/**
 * scp-like SSH is deliberately not folded into `ssh://`: §2.2 keeps it a separate stored
 * form because a relative scp-like path and an absolute SSH-URL path have different Git
 * semantics. It carries no port and no percent escapes.
 */
function parseScpLikeRemote(text: string): string {
  const label = "NormalizedRemoteUrlV1 (scp-like ssh)";
  if (text.includes("%")) fail(`${label}: percent escape`);
  const colon = text.indexOf(":");
  if (colon < 0) fail(`${label}: no path separator`);
  const authority = text.slice(0, colon);
  const path = text.slice(colon + 1);
  let credential = "";
  let hostText = authority;
  const at = authority.indexOf("@");
  if (at >= 0) {
    const username = authority.slice(0, at);
    if (!SSH_USERNAME.test(username)) fail(`${label}: username`);
    credential = `${username}@`;
    hostText = authority.slice(at + 1);
  }
  const host = parseRemoteHost(hostText, label);
  const segments = (path.startsWith("/") ? path.slice(1) : path).split("/");
  if (segments.length < 1 || segments.length > SSH_PATH_MAX_SEGMENTS) {
    fail(`${label}: repository segment count`);
  }
  for (const segment of segments) {
    if (
      !SSH_PATH_SEGMENT.test(segment) ||
      segment === "." ||
      segment === ".." ||
      byteLength(segment) > SSH_SEGMENT_MAX_BYTES
    ) {
      fail(`${label}: repository segment`);
    }
  }
  return `${credential}${host}:${path}`;
}

/**
 * Admits stored normalized forms only. It never resolves anything: turning a raw local
 * path into a bare repository needs the filesystem, which is `git enable`'s job, not a
 * configuration load's. Normalizing an already normalized value is byte-idempotent, so
 * re-emitting the parse and demanding the input back is the whole admission rule.
 */
const REMOTE_PARSERS: Readonly<Record<GitRemoteTransportV1, (text: string) => string>> = {
  local: parseLocalRemoteUrl,
  https: parseHttpsRemoteUrl,
  ssh: (text) => (text.startsWith("ssh://") ? parseSshUrlRemote(text) : parseScpLikeRemote(text)),
};

export function parseNormalizedRemoteUrl(
  value: unknown,
  transport: GitRemoteTransportV1,
): NormalizedRemoteUrlV1 {
  const label = "NormalizedRemoteUrlV1";
  const text = requireString(value, label);
  const bytes = byteLength(text);
  if (bytes < 1 || bytes > REMOTE_URL_MAX_BYTES) fail(`${label}: byte length`);
  assertNoControl(text, label);
  if (!Object.hasOwn(REMOTE_PARSERS, transport)) fail(`${label}: transport`);
  if (REMOTE_PARSERS[transport](text) !== text) fail(`${label}: not normalized`);
  return text as NormalizedRemoteUrlV1;
}

/** The digest of exactly the five displayed scope fields, never a sixth. */
export function gitScopeFingerprint(scope: Omit<GitScopeSnapshotV1, "fingerprint">): LowerHexSha256 {
  return hashCanonicalJson("developer-os:git-scope:v1", {
    brainPath: scope.brainPath,
    contentRoot: scope.contentRoot,
    indexesDir: scope.indexesDir,
    topicAliases: { ...scope.topicAliases },
    topicFolders: [...scope.topicFolders],
  });
}

const LIFECYCLE_HASH_DOMAINS: Readonly<Record<"git" | "automation", string>> = {
  git: "developer-os:lifecycle:git:v1",
  automation: "developer-os:lifecycle:automation:v1",
};

export function lifecycleConfigHash(
  subsystem: "git" | "automation",
  lifecycle: GitSyncConfigV1 | AutomationConfigV1,
): LowerHexSha256 {
  if (!Object.hasOwn(LIFECYCLE_HASH_DOMAINS, subsystem)) fail("lifecycle subsystem");
  return hashCanonicalJson(LIFECYCLE_HASH_DOMAINS[subsystem], {
    enabled: true,
    lifecycle: lifecycle as unknown as CanonicalJsonValue,
  });
}

function exactKeys(value: CanonicalJsonValue, keys: readonly string[], label: string): Record<string, CanonicalJsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const object = value as Record<string, CanonicalJsonValue>;
  const present = Object.keys(object);
  if (present.length !== keys.length || keys.some((key) => !present.includes(key))) fail(label);
  return object;
}

function parseActivationArm(value: CanonicalJsonValue, label: string): LifecycleActivationArmV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const state = (value as Record<string, CanonicalJsonValue>).state;
  if (state === "inactive") {
    exactKeys(value, ["state"], label);
    return { state: "inactive" };
  }
  if (state === "active") {
    const object = exactKeys(value, ["state", "configHash"], label);
    return { state: "active", configHash: parseLowerHexSha256(object.configHash) };
  }
  return fail(label);
}

export function parseLifecycleActivationRecord(bytes: Uint8Array): LifecycleActivationRecordV1 {
  const decoded = decodeCanonicalJson(bytes, ACTIVATION_RECORD_MAX_BYTES);
  const label = "LifecycleActivationRecordV1";
  const object = exactKeys(decoded, ["schemaVersion", "git", "automation"], label);
  if (object.schemaVersion !== 1) fail(`${label}: schemaVersion`);
  return {
    schemaVersion: 1,
    git: parseActivationArm(object.git as CanonicalJsonValue, `${label}.git`),
    automation: parseActivationArm(object.automation as CanonicalJsonValue, `${label}.automation`),
  };
}

export function encodeLifecycleActivationRecord(
  record: LifecycleActivationRecordV1,
): CanonicalJsonV1 {
  const canonical = encodeCanonicalJson(record as unknown as CanonicalJsonValue);
  parseLifecycleActivationRecord(encoder.encode(canonical));
  return canonical;
}
