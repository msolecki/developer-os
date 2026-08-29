import { createHash } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { EXIT_CODES } from "../result.js";
import { deriveBootstrapPayloadPath, deriveManifestPayloadPath, type BootstrapPayloadPathV1, type CanonicalAbsolutePathV1, type CanonicalPathEvidenceV1, type ManifestPayloadPathV1 } from "../update/paths.js";
import { parseLowerHexSha256, parseUInt64Decimal, type LowerHexSha256, type UInt64DecimalV1 } from "../update/scalars.js";
import { validateManifestBytes } from "./v2.js";
import type { ManifestAdmissionContextV1 } from "./types.js";

const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();

export type ManifestParticipantIdV1 = string & { readonly __manifestParticipantIdV1: unique symbol };
export type FreshV2InitIdV1 = string & { readonly __freshV2InitIdV1: unique symbol };
export type ManifestMigrationIdV1 = string & { readonly __manifestMigrationIdV1: unique symbol };
export type LifecycleCoordinatorIdV1 = string & { readonly __lifecycleCoordinatorIdV1: unique symbol };

export interface BootstrapExpectedPayloadRefV1 {
  readonly kind: "bootstrap_expected";
  readonly bootstrapId: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly ordinal: number;
  readonly path: BootstrapPayloadPathV1;
  readonly hash: LowerHexSha256;
  readonly bytes: number;
  readonly mode: 0o600 | 0o700;
}

export interface UpdateExpectedPayloadRefV1 {
  readonly kind: "update_expected";
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly ordinal: number;
  readonly path: CanonicalAbsolutePathV1;
  readonly hash: LowerHexSha256;
  readonly bytes: number;
  readonly mode: 0o600 | 0o700;
}

export type ManifestPayloadRefV1 = BootstrapExpectedPayloadRefV1 | (UpdateExpectedPayloadRefV1 & { readonly path: ManifestPayloadPathV1 });

export type ManifestBytesStateV1 =
  | { readonly state: "absent" }
  | {
      readonly state: "present";
      readonly hash: LowerHexSha256;
      readonly bytes: ManifestPayloadRefV1 | null;
      readonly ownerUid: number;
      readonly mode: 0o600;
      readonly nlink: 1;
      readonly size: UInt64DecimalV1;
      /** Bootstrap payloads do not have durable construction evidence until their outer journal reaches it. */
      readonly dev: UInt64DecimalV1 | null;
      readonly ino: UInt64DecimalV1 | null;
    };

export interface ManifestExternalEffectRefV1 {
  readonly kind: "codex_registration" | "git" | "launchd";
  readonly id: string;
  readonly planHash: LowerHexSha256;
}

export interface ManifestStatePlanV1 {
  readonly schemaVersion: 1;
  readonly participantId: ManifestParticipantIdV1;
  readonly envelope:
    | { readonly kind: "fresh_v2_init"; readonly id: FreshV2InitIdV1 }
    | { readonly kind: "v1_migration"; readonly id: ManifestMigrationIdV1 }
    | { readonly kind: "lifecycle"; readonly id: LifecycleCoordinatorIdV1 };
  readonly bindings: {
    readonly foundationTransactions: { readonly count: number; readonly orderedIdsHash: LowerHexSha256 };
    readonly externalEffects: readonly ManifestExternalEffectRefV1[];
  };
  readonly manifestPath: CanonicalAbsolutePathV1;
  readonly tombstonePath: CanonicalAbsolutePathV1;
  readonly before: ManifestBytesStateV1;
  readonly after: ManifestBytesStateV1;
  readonly maximumPlanBytes: number;
  readonly maximumJournalBytes: number;
}

export interface ManifestPayloadIdentityV1 { readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1; }

/** The outer durable plan owns bootstrap/lifecycle grammars; this participant only receives admitted authority. */
export interface ManifestStatePlanAdmissionContextV1 {
  readonly evidence: CanonicalPathEvidenceV1;
  readonly productHome: CanonicalAbsolutePathV1;
  readonly manifestRoot: CanonicalAbsolutePathV1;
  readonly foundationTransactionIds: readonly string[];
  readonly externalEffects: readonly ManifestExternalEffectRefV1[];
  readonly validateLifecycleCoordinatorId: (value: unknown) => LifecycleCoordinatorIdV1;
  readonly validateFreshV2InitId?: (value: unknown) => FreshV2InitIdV1;
  readonly validateManifestMigrationId?: (value: unknown) => ManifestMigrationIdV1;
  readonly bootstrapPayloadIdentity?: (value: BootstrapExpectedPayloadRefV1) => ManifestPayloadIdentityV1 | null;
  readonly updatePayloadIdentity?: (value: UpdateExpectedPayloadRefV1) => ManifestPayloadIdentityV1;
}

export interface ManifestStateParticipantDependencies {
  readonly fs: {
    readonly link: (existingPath: string, newPath: string) => Promise<void>;
    readonly lstat: (path: string) => Promise<Stats>;
    readonly open: (path: string, flags: number) => Promise<FileHandle>;
    readonly unlink: (path: string) => Promise<void>;
  };
  readonly admission: ManifestStatePlanAdmissionContextV1;
  readonly uid: number;
  readonly manifestAdmission?: ManifestAdmissionContextV1;
}

export type ManifestParticipantObservationV1 = { readonly state: "before" | "preimage_preserved" | "applied" | "compensated"; };

export class ManifestStateParticipantError extends Error {
  readonly code = EXIT_CODES.recoveryRequired;
  constructor(message = "manifest direct-write state is malformed or conflicted") { super(message); this.name = "ManifestStateParticipantError"; }
}

function fail(): never { throw new ManifestStateParticipantError(); }
function object(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) fail(); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: readonly string[]): void { const actual = Object.keys(value).sort(); const wanted = [...keys].sort(); if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(); }
function integer(value: unknown, minimum: number, maximum: number): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(); return value; }
function hash(value: unknown): LowerHexSha256 { try { return parseLowerHexSha256(value); } catch { return fail(); } }
function identity(value: unknown): UInt64DecimalV1 { try { return parseUInt64Decimal(value); } catch { return fail(); } }
function path(value: unknown, context: ManifestStatePlanAdmissionContextV1): CanonicalAbsolutePathV1 { try { if (typeof value !== "string" || context.evidence.reopenCanonicalAbsolutePath(value) !== value) fail(); return value as CanonicalAbsolutePathV1; } catch { return fail(); } }
function equal(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function digestFoundation(ids: readonly string[]): LowerHexSha256 { return createHash("sha256").update("developer-os/manifest-foundation-bindings/v1\0").update(JSON.stringify(ids)).digest("hex") as LowerHexSha256; }
function isLifecycleId(value: string): boolean { return /^lc_[0-9a-f]{61}$/.test(value); }
function isFreshId(value: string): boolean { return /^fi_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function isMigrationId(value: string): boolean { return /^mm_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }

function payload(value: unknown, envelope: ManifestStatePlanV1["envelope"], context: ManifestStatePlanAdmissionContextV1, participantId: ManifestParticipantIdV1): ManifestPayloadRefV1 {
  const input = object(value);
  if (input.kind === "update_expected") {
    exact(input, ["bytes", "coordinatorId", "hash", "kind", "mode", "ordinal", "path"]);
    if (envelope.kind !== "lifecycle") fail();
    const coordinatorId = context.validateLifecycleCoordinatorId(input.coordinatorId);
    if (coordinatorId !== envelope.id || !isLifecycleId(coordinatorId)) fail();
    const result: UpdateExpectedPayloadRefV1 = { kind: "update_expected", coordinatorId, ordinal: integer(input.ordinal, 0, 1_099_999), path: path(input.path, context), hash: hash(input.hash), bytes: integer(input.bytes, 0, 536_870_912), mode: input.mode === 0o600 || input.mode === 0o700 ? input.mode : fail() };
    if (result.path !== deriveManifestPayloadPath(context.productHome, coordinatorId as never, participantId as never)) fail();
    if (context.updatePayloadIdentity === undefined) fail();
    const evidenced = context.updatePayloadIdentity(result);
    identity(evidenced.dev); identity(evidenced.ino);
    return result as ManifestPayloadRefV1;
  }
  if (input.kind === "bootstrap_expected") {
    exact(input, ["bootstrapId", "bytes", "hash", "kind", "mode", "ordinal", "path"]);
    if (envelope.kind === "lifecycle") fail();
    const bootstrapId = envelope.kind === "fresh_v2_init"
      ? context.validateFreshV2InitId?.(input.bootstrapId)
      : context.validateManifestMigrationId?.(input.bootstrapId);
    if (bootstrapId === undefined || bootstrapId !== envelope.id) fail();
    const result: BootstrapExpectedPayloadRefV1 = { kind: "bootstrap_expected", bootstrapId, ordinal: integer(input.ordinal, 0, 999_999), path: path(input.path, context) as BootstrapPayloadPathV1, hash: hash(input.hash), bytes: integer(input.bytes, 0, 536_870_912), mode: input.mode === 0o600 || input.mode === 0o700 ? input.mode : fail() };
    const operation = envelope.kind === "fresh_v2_init" ? "fresh_v2_init" : "v1_to_v2";
    if (result.path !== deriveBootstrapPayloadPath(context.productHome, operation, bootstrapId as never, result.ordinal)) fail();
    return result;
  }
  return fail();
}

function state(value: unknown, role: "before" | "after", envelope: ManifestStatePlanV1["envelope"], context: ManifestStatePlanAdmissionContextV1, participantId: ManifestParticipantIdV1): ManifestBytesStateV1 {
  const input = object(value);
  if (input.state === "absent") { exact(input, ["state"]); return { state: "absent" }; }
  exact(input, ["bytes", "dev", "hash", "ino", "mode", "nlink", "ownerUid", "size", "state"]);
  if (input.state !== "present" || input.mode !== 0o600 || input.nlink !== 1 || !Number.isSafeInteger(input.ownerUid) || (role === "before" && input.bytes !== null)) fail();
  const nullableIdentity = input.dev === null && input.ino === null;
  if ((input.dev === null) !== (input.ino === null) || (nullableIdentity && (role !== "after" || envelope.kind === "lifecycle"))) fail();
  const result = { state: "present" as const, hash: hash(input.hash), bytes: input.bytes === null ? null : payload(input.bytes, envelope, context, participantId), ownerUid: input.ownerUid as number, mode: 0o600 as const, nlink: 1 as const, size: identity(input.size), dev: nullableIdentity ? null : identity(input.dev), ino: nullableIdentity ? null : identity(input.ino) };
  if (role === "after" && result.bytes === null) fail();
  return result;
}

function envelope(value: unknown, context: ManifestStatePlanAdmissionContextV1): ManifestStatePlanV1["envelope"] {
  const input = object(value); exact(input, ["id", "kind"]);
  if (input.kind === "lifecycle") { const id = context.validateLifecycleCoordinatorId(input.id); if (!isLifecycleId(id)) fail(); return { kind: "lifecycle", id }; }
  if (input.kind === "fresh_v2_init") { const id = context.validateFreshV2InitId?.(input.id); if (id === undefined || !isFreshId(id)) fail(); return { kind: "fresh_v2_init", id }; }
  if (input.kind === "v1_migration") { const id = context.validateManifestMigrationId?.(input.id); if (id === undefined || !isMigrationId(id)) fail(); return { kind: "v1_migration", id }; }
  return fail();
}

export function validateManifestStatePlan(value: unknown, context: ManifestStatePlanAdmissionContextV1): ManifestStatePlanV1 {
  try {
    const input = object(value); exact(input, ["after", "before", "bindings", "envelope", "manifestPath", "maximumJournalBytes", "maximumPlanBytes", "participantId", "schemaVersion", "tombstonePath"]);
    if (input.schemaVersion !== 1 || typeof input.participantId !== "string") fail();
    const admittedEnvelope = envelope(input.envelope, context);
    const participantId = input.participantId as ManifestParticipantIdV1;
    if ((admittedEnvelope.kind === "lifecycle" && !/^mf_[0-9a-f]{61}$/.test(participantId)) || (admittedEnvelope.kind === "fresh_v2_init" && participantId !== `mf_${admittedEnvelope.id}`) || (admittedEnvelope.kind === "v1_migration" && participantId !== `mf_${admittedEnvelope.id}`)) fail();
    const manifestPath = path(input.manifestPath, context);
    if (!context.evidence.containsCanonicalPath(context.manifestRoot, manifestPath)) fail();
    const tombstonePath = path(input.tombstonePath, context);
    if (tombstonePath !== join(dirname(manifestPath), `.installation-manifest.${participantId}.json.tombstone`) || basename(tombstonePath) === basename(manifestPath)) fail();
    const bindings = object(input.bindings); exact(bindings, ["externalEffects", "foundationTransactions"]);
    const foundation = object(bindings.foundationTransactions); exact(foundation, ["count", "orderedIdsHash"]);
    if (integer(foundation.count, 0, 1_000_000) !== context.foundationTransactionIds.length || hash(foundation.orderedIdsHash) !== digestFoundation(context.foundationTransactionIds) || new Set(context.foundationTransactionIds).size !== context.foundationTransactionIds.length) fail();
    if (!Array.isArray(bindings.externalEffects) || bindings.externalEffects.length > 1 || !equal(bindings.externalEffects, context.externalEffects)) fail();
    const before = state(input.before, "before", admittedEnvelope, context, participantId);
    const after = state(input.after, "after", admittedEnvelope, context, participantId);
    if (after.state === "present" && after.bytes?.kind === "update_expected") {
      const evidenced = context.updatePayloadIdentity?.(after.bytes);
      if (evidenced === undefined || after.dev !== evidenced.dev || after.ino !== evidenced.ino) fail();
    }
    const plan = { schemaVersion: 1 as const, participantId, envelope: admittedEnvelope, bindings: { foundationTransactions: { count: foundation.count as number, orderedIdsHash: foundation.orderedIdsHash as LowerHexSha256 }, externalEffects: bindings.externalEffects as readonly ManifestExternalEffectRefV1[] }, manifestPath, tombstonePath, before, after, maximumPlanBytes: integer(input.maximumPlanBytes, 1, 16_777_216), maximumJournalBytes: integer(input.maximumJournalBytes, 1, 1_048_576) };
    if (encoder.encode(JSON.stringify(plan)).byteLength > plan.maximumPlanBytes) fail();
    return structuredClone(plan);
  } catch (error) { if (error instanceof ManifestStateParticipantError) throw error; return fail(); }
}

type FileState = "missing" | "before" | "after" | "invalid";

export class ManifestStateParticipant {
  constructor(readonly dependencies: ManifestStateParticipantDependencies) {}

  async observe(plan: ManifestStatePlanV1): Promise<ManifestParticipantObservationV1> {
    const admitted = validateManifestStatePlan(plan, this.dependencies.admission);
    const manifest = await this.fileState(admitted.manifestPath, admitted, "manifest");
    const tombstone = await this.fileState(admitted.tombstonePath, admitted, "tombstone");
    if (manifest === "invalid" || tombstone === "invalid") fail();
    if (this.matchesBeforeStart(admitted, manifest, tombstone)) return { state: "before" };
    if (manifest === "missing" && tombstone === "before") return { state: "preimage_preserved" };
    if (this.matchesAfter(admitted, manifest, tombstone)) return { state: "applied" };
    fail();
  }

  async apply(plan: ManifestStatePlanV1): Promise<ManifestParticipantObservationV1> {
    const admitted = validateManifestStatePlan(plan, this.dependencies.admission);
    const initial = await this.observe(admitted);
    if (initial.state === "applied") return initial;
    if (initial.state === "before" && admitted.before.state === "present") await this.move(admitted.manifestPath, admitted.tombstonePath, admitted.before);
    const manifest = await this.fileState(admitted.manifestPath, admitted, "manifest");
    if (manifest !== "missing") fail();
    if (admitted.after.state === "present") {
      const payload = admitted.after.bytes;
      if (payload === null) fail();
      await this.move(payload.path, admitted.manifestPath, admitted.after, true);
    }
    else return { state: "applied" };
    return this.observe(admitted);
  }

  async compensate(plan: ManifestStatePlanV1): Promise<ManifestParticipantObservationV1> {
    const admitted = validateManifestStatePlan(plan, this.dependencies.admission);
    const current = await this.observe(admitted);
    if (current.state === "before") return { state: "compensated" };
    if (admitted.after.state === "present") {
      const manifest = await this.fileState(admitted.manifestPath, admitted, "manifest");
      const payload = admitted.after.bytes;
      if (payload === null) fail();
      if (manifest === "after") await this.move(admitted.manifestPath, payload.path, admitted.after);
      else if (manifest !== "missing") fail();
    }
    if (admitted.before.state === "present") await this.move(admitted.tombstonePath, admitted.manifestPath, admitted.before);
    const restored = await this.observe(admitted);
    if (restored.state !== "before") fail();
    return { state: "compensated" };
  }

  async compact(plan: ManifestStatePlanV1): Promise<void> {
    const admitted = validateManifestStatePlan(plan, this.dependencies.admission);
    const current = await this.observe(admitted);
    if (current.state !== "applied") fail();
    if (admitted.before.state === "present") {
      const tombstone = await this.fileState(admitted.tombstonePath, admitted, "tombstone");
      if (tombstone !== "before") fail();
      await this.dependencies.fs.unlink(admitted.tombstonePath);
      await this.syncDirectory(dirname(admitted.tombstonePath));
    }
  }

  private matchesBeforeStart(plan: ManifestStatePlanV1, manifest: FileState, tombstone: FileState): boolean {
    return (plan.before.state === "absent" ? manifest === "missing" : manifest === "before") && tombstone === "missing";
  }
  private matchesAfter(plan: ManifestStatePlanV1, manifest: FileState, tombstone: FileState): boolean {
    return (plan.after.state === "absent" ? manifest === "missing" : manifest === "after") && (plan.before.state === "present" ? tombstone === "before" : tombstone === "missing");
  }

  private async fileState(target: string, plan: ManifestStatePlanV1, role: "manifest" | "tombstone"): Promise<FileState> {
    let stat: Awaited<ReturnType<ManifestStateParticipantDependencies["fs"]["lstat"]>>;
    try { stat = await this.dependencies.fs.lstat(target); } catch (error) { if (typeof error === "object" && error !== null && "code" in error && ((error as { code?: unknown }).code === "ENOENT" || (error as { code?: unknown }).code === "ENOTDIR")) return "missing"; return "invalid"; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode % 0o1000 !== 0o600 || stat.nlink !== 1 || stat.uid !== this.dependencies.uid || stat.size > MAX_MANIFEST_BYTES) return "invalid";
    const expected = role === "tombstone" ? plan.before : undefined;
    const handle = await this.dependencies.fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) return "invalid";
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || bytes.byteLength !== opened.size) return "invalid";
      const candidate = expected ?? plan.before;
      if (candidate.state === "present" && this.equalState(candidate, bytes, stat)) {
        try { validateManifestBytes(bytes, this.dependencies.manifestAdmission); } catch { return "invalid"; }
        return "before";
      }
      if (role === "manifest" && plan.after.state === "present" && this.equalState(plan.after, bytes, stat)) {
        try { validateManifestBytes(bytes, this.dependencies.manifestAdmission); } catch { return "invalid"; }
        return "after";
      }
      return "invalid";
    } catch { return "invalid"; } finally { await handle.close(); }
  }

  private equalState(expected: Extract<ManifestBytesStateV1, { state: "present" }>, bytes: Uint8Array, stat: { uid: number; mode: number; nlink: number; size: number; dev: number; ino: number }): boolean {
    const evidence = expected.dev === null || expected.ino === null
      ? expected.bytes?.kind === "bootstrap_expected" ? this.dependencies.admission.bootstrapPayloadIdentity?.(expected.bytes) ?? null : null
      : { dev: expected.dev, ino: expected.ino };
    return evidence !== null && createHash("sha256").update(bytes).digest("hex") === expected.hash && stat.uid === expected.ownerUid && stat.mode % 0o1000 === expected.mode && stat.nlink === expected.nlink && String(stat.size) === expected.size && String(stat.dev) === evidence.dev && String(stat.ino) === evidence.ino;
  }

  private async move(source: string, destination: string, expected: Extract<ManifestBytesStateV1, { state: "present" }>, validateAfter = false): Promise<void> {
    if ((await this.fileState(source, { ...({} as ManifestStatePlanV1), before: expected, after: expected }, "manifest")) === "missing") fail();
    try { await this.dependencies.fs.lstat(destination); fail(); } catch (error) { if (error instanceof ManifestStateParticipantError) throw error; if (!(typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT")) fail(); }
    try {
      // `link` + `unlink` is the portable same-device no-replace move: no existing destination can be overwritten.
      await this.dependencies.fs.link(source, destination);
      await this.dependencies.fs.unlink(source);
    } catch { fail(); }
    await this.syncDirectory(dirname(destination));
    const plan = { before: expected, after: expected } as ManifestStatePlanV1;
    if (await this.fileState(destination, plan, "manifest") !== "before") fail();
    if (validateAfter) {
      const handle = await this.dependencies.fs.open(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { validateManifestBytes(await handle.readFile(), this.dependencies.manifestAdmission); } catch { fail(); } finally { await handle.close(); }
    }
  }

  private async syncDirectory(directory: string): Promise<void> {
    const handle = await this.dependencies.fs.open(directory, constants.O_RDONLY);
    try { await handle.sync(); } catch { fail(); } finally { await handle.close(); }
  }
}
