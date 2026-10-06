/**
 * Spec 1 §2.1 "Admission of an installed V2 home" and §7 "V2 admission is
 * structural": a home is admitted by the manifest, the complete reservation
 * set, the nonce/allocator pair, the stable global lock and the three journal
 * roots. Drift, closure, the bootstrap plan and retained evidence are not read
 * here, because none of them decides whether the installation exists.
 */
import { join } from "node:path";

import {
  decodeCanonicalJson,
  EXIT_CODES,
  hashBytes,
  LifecycleRecoveryRequiredError,
  parseLifecycleActivationRecord,
  parseLifecycleIdAllocator,
  parseLifecycleInstallNonce,
  parseLowerHexSha256,
  SCHEDULED_JOB_IDS,
  validateManifestV2,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  ExitCode,
  InstallationManifestV2,
  LifecycleActivationRecordV1,
  LifecycleGuardedEntryV1,
  LifecycleGuardedFileSystemV1,
  LifecycleIdAllocatorV1,
  LifecycleInstallNonceV1,
  LowerHexSha256,
  ManifestAdmissionContextV1,
  RuntimePaths,
} from "@developer-os/core";

import { PULSE_REPORT_SLOTS } from "./runtime-records.js";

const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_ALLOCATOR_BYTES = 1_024;
const MAX_NONCE_BYTES = 65;
/** `parseLifecycleActivationRecord`'s own `decodeCanonicalJson` bound, so the read refuses at the byte the parser would. */
const MAX_ACTIVATION_BYTES = 1_048_576;
const GLOBAL_LOCK_BYTES = 0;
const LOG_SLOTS_PER_JOB = 10;

export type ManifestSchemaObservationV1 =
  | { readonly kind: "absent" }
  | { readonly kind: "v1" }
  | { readonly kind: "v2"; readonly entry: LifecycleGuardedEntryV1; readonly bytes: Uint8Array };

export type V2HomeAdmissionReasonV1 =
  | "manifest_absent"
  | "manifest_v1_not_migratable"
  | "manifest_invalid"
  | "reservations_incomplete"
  | "nonce_invalid"
  | "allocator_invalid"
  | "nonce_allocator_mismatch"
  | "global_lock_invalid"
  | "journal_root_invalid";

const REASON_EXIT_CODES: Readonly<Record<V2HomeAdmissionReasonV1, ExitCode>> = {
  manifest_absent: EXIT_CODES.invalidInput,
  manifest_v1_not_migratable: EXIT_CODES.capabilityUnavailable,
  manifest_invalid: EXIT_CODES.recoveryRequired,
  reservations_incomplete: EXIT_CODES.recoveryRequired,
  nonce_invalid: EXIT_CODES.recoveryRequired,
  allocator_invalid: EXIT_CODES.recoveryRequired,
  nonce_allocator_mismatch: EXIT_CODES.recoveryRequired,
  global_lock_invalid: EXIT_CODES.recoveryRequired,
  journal_root_invalid: EXIT_CODES.recoveryRequired,
};

export class V2HomeAdmissionError extends Error {
  readonly code: ExitCode;
  readonly reason: V2HomeAdmissionReasonV1;
  readonly paths: readonly string[];

  constructor(reason: V2HomeAdmissionReasonV1, paths: readonly string[]) {
    // Ruling 39 M3: a home installed before a reservation existed is fixed by reinstalling, so say so.
    super(`the product home is not an admitted V2 installation: ${reason}${reason === "reservations_incomplete" ? "; reinstall: developer-os init" : ""}`);
    this.code = REASON_EXIT_CODES[reason];
    this.reason = reason;
    this.paths = [...paths];
    // failureFrom publishes kindOf(name), so the name is what yields the reason code.
    this.name = `${reason.split("_").map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join("")}Error`;
  }
}

export interface AdmittedV2HomeV1 {
  readonly manifest: InstallationManifestV2;
  /** SHA-256 of the bytes `manifest` was decoded from, so a later locked read can prove it is the same file (NEW-175). */
  readonly manifestHash: LowerHexSha256;
  readonly nonce: LifecycleInstallNonceV1;
  readonly allocator: LifecycleIdAllocatorV1;
  readonly globalLock: LifecycleGuardedEntryV1;
  readonly journalRoots: readonly [
    LifecycleGuardedEntryV1,
    LifecycleGuardedEntryV1,
    LifecycleGuardedEntryV1,
  ];
}

/** Spec 1 §2.1's table rows plus nonce and allocator, relative to the product home. */
export const LIFECYCLE_RESERVATION_ROWS: readonly {
  readonly path: string;
  readonly kind: "file";
  readonly mode: "ephemeral" | "content" | "schema";
}[] = [
  { path: "state/lifecycle-install-nonce", kind: "file", mode: "content" },
  { path: "state/lifecycle-id-allocator.json", kind: "file", mode: "schema" },
  { path: "state/git-sync.json", kind: "file", mode: "ephemeral" },
  { path: "state/uninstalling.json", kind: "file", mode: "ephemeral" },
  ...SCHEDULED_JOB_IDS.flatMap((job) => [
    { path: `state/automation-${job}.status.json`, kind: "file" as const, mode: "ephemeral" as const },
    { path: `state/.automation-${job}.lock`, kind: "file" as const, mode: "ephemeral" as const },
    ...Array.from({ length: LOG_SLOTS_PER_JOB }, (_unused, ordinal) => ({
      path: `logs/automation-${job}.${String(ordinal)}.json`,
      kind: "file" as const,
      mode: "ephemeral" as const,
    })),
  ]),
  ...Array.from({ length: PULSE_REPORT_SLOTS }, (_unused, slot) => ({
    path: `state/pulse.${String(slot)}.md`,
    kind: "file" as const,
    mode: "ephemeral" as const,
  })),
];

function refuse(reason: V2HomeAdmissionReasonV1, path: string): never {
  throw new V2HomeAdmissionError(reason, [path]);
}

function parsing<T>(reason: V2HomeAdmissionReasonV1, path: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    // NEW-82: a validator's own refusal is a refusal; a defect inside it is not.
    if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError) throw error;
    return refuse(reason, path);
  }
}

function declaredSchemaVersion(bytes: Uint8Array): unknown {
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>).schemaVersion
      : null;
  } catch {
    return null;
  }
}

export async function observeManifestSchema(
  fs: LifecycleGuardedFileSystemV1,
  paths: RuntimePaths,
): Promise<ManifestSchemaObservationV1> {
  const path = paths.manifestFile as CanonicalAbsolutePathV1;
  const entry = await fs.lstat(path);
  if (entry === null) return { kind: "absent" };
  if (entry.kind !== "regular_file" || BigInt(entry.size) > BigInt(MAX_MANIFEST_BYTES)) {
    return refuse("manifest_invalid", path);
  }
  const bytes = await fs.readRegular(entry, MAX_MANIFEST_BYTES);
  const declared = declaredSchemaVersion(bytes);
  if (declared === 1) return { kind: "v1" };
  if (declared !== 2) return refuse("manifest_invalid", path);
  return { kind: "v2", entry, bytes };
}

/** Three-state: a non-regular entry at the path throws LifecycleRecoveryRequiredError("activation_record_invalid"), never "absent". */
export async function observeLifecycleActivationRecord(
  fs: LifecycleGuardedFileSystemV1,
  paths: RuntimePaths,
): Promise<
  { readonly state: "absent" } | { readonly state: "present"; readonly record: LifecycleActivationRecordV1 }
> {
  const path = join(paths.stateDir, "lifecycle-activation.json") as CanonicalAbsolutePathV1;
  const entry = await fs.lstat(path);
  if (entry === null) return { state: "absent" };
  if (entry.kind !== "regular_file") {
    throw new LifecycleRecoveryRequiredError("activation_record_invalid", [path]);
  }
  const bytes = await fs.readRegular(entry, MAX_ACTIVATION_BYTES);
  try {
    return { state: "present", record: parseLifecycleActivationRecord(bytes) };
  } catch {
    throw new LifecycleRecoveryRequiredError("activation_record_invalid", [path]);
  }
}

export function assertCompleteLifecycleReservations(
  manifest: InstallationManifestV2,
  productHome: string,
): void {
  const reserved = new Map(manifest.artifacts.map((artifact) => [artifact.path as string, artifact] as const));
  for (const row of LIFECYCLE_RESERVATION_ROWS) {
    const path = join(productHome, row.path);
    const artifact = reserved.get(path);
    if (artifact === undefined || artifact.kind !== row.kind || artifact.verification.mode !== row.mode) {
      refuse("reservations_incomplete", path);
    }
  }
}

/**
 * The byte bound is checked here rather than left to the port, so an over-long
 * record publishes the reason that names it instead of the port's
 * `lifecycle_guarded_size`.
 */
async function ownedRegular(
  fs: LifecycleGuardedFileSystemV1,
  path: string,
  effectiveUid: number,
  maximumBytes: number,
  reason: V2HomeAdmissionReasonV1,
): Promise<LifecycleGuardedEntryV1> {
  const entry = await fs.lstat(path as CanonicalAbsolutePathV1);
  if (
    entry === null || entry.kind !== "regular_file" || entry.ownerUid !== effectiveUid ||
    BigInt(entry.size) > BigInt(maximumBytes)
  ) {
    return refuse(reason, path);
  }
  return entry;
}

async function ownedJournalRoot(
  fs: LifecycleGuardedFileSystemV1,
  path: string,
  effectiveUid: number,
): Promise<LifecycleGuardedEntryV1> {
  const entry = await fs.lstat(path as CanonicalAbsolutePathV1);
  if (entry === null || entry.kind !== "directory" || entry.ownerUid !== effectiveUid || entry.mode !== 0o700) {
    return refuse("journal_root_invalid", path);
  }
  return entry;
}

/**
 * The allocator is parsed against the nonce it names rather than the installed
 * one, so a record that is well-formed but bound elsewhere reports
 * `nonce_allocator_mismatch` instead of collapsing into `allocator_invalid`.
 */
function declaredInstallNonce(bytes: Uint8Array): LifecycleInstallNonceV1 {
  const value = decodeCanonicalJson(bytes, MAX_ALLOCATOR_BYTES);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("the lifecycle allocator is not a JSON object");
  }
  return (value as Record<string, CanonicalJsonValue>).installNonce as LifecycleInstallNonceV1;
}

export async function admitInstalledV2Home(input: {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly paths: RuntimePaths;
  readonly manifestAdmission: ManifestAdmissionContextV1;
  readonly effectiveUid: number;
}): Promise<AdmittedV2HomeV1> {
  const { fs, paths, effectiveUid } = input;
  const observed = await observeManifestSchema(fs, paths);
  if (observed.kind === "absent") refuse("manifest_absent", paths.manifestFile);
  if (observed.kind === "v1") refuse("manifest_v1_not_migratable", paths.manifestFile);
  const manifest = parsing("manifest_invalid", paths.manifestFile, () =>
    validateManifestV2(decodeCanonicalJson(observed.bytes, MAX_MANIFEST_BYTES), input.manifestAdmission));
  assertCompleteLifecycleReservations(manifest, paths.home);

  const noncePath = join(paths.stateDir, "lifecycle-install-nonce");
  const nonceEntry = await ownedRegular(fs, noncePath, effectiveUid, MAX_NONCE_BYTES, "nonce_invalid");
  const nonceBytes = await fs.readRegular(nonceEntry, MAX_NONCE_BYTES);
  const nonce = parsing("nonce_invalid", noncePath, () => parseLifecycleInstallNonce(nonceBytes));

  const allocatorPath = join(paths.stateDir, "lifecycle-id-allocator.json");
  const allocatorEntry = await ownedRegular(fs, allocatorPath, effectiveUid, MAX_ALLOCATOR_BYTES, "allocator_invalid");
  const allocatorBytes = await fs.readRegular(allocatorEntry, MAX_ALLOCATOR_BYTES);
  const allocator = parsing("allocator_invalid", allocatorPath, () =>
    parseLifecycleIdAllocator(allocatorBytes, declaredInstallNonce(allocatorBytes)));
  if (allocator.installNonce !== nonce) refuse("nonce_allocator_mismatch", allocatorPath);

  const lockPath = join(paths.stateDir, ".lifecycle.lock");
  const globalLock = await ownedRegular(fs, lockPath, effectiveUid, GLOBAL_LOCK_BYTES, "global_lock_invalid");
  if (globalLock.mode !== 0o600 || globalLock.nlink !== 1) refuse("global_lock_invalid", lockPath);

  return {
    manifest,
    manifestHash: parseLowerHexSha256(hashBytes(observed.bytes)),
    nonce,
    allocator,
    globalLock,
    journalRoots: [
      await ownedJournalRoot(fs, join(paths.stateDir, "lifecycle-journals"), effectiveUid),
      await ownedJournalRoot(fs, join(paths.stateDir, "git-effect-journals"), effectiveUid),
      await ownedJournalRoot(fs, join(paths.stateDir, "launchd-effect-journals"), effectiveUid),
    ],
  };
}
