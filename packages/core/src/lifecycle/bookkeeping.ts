/**
 * Spec 1 §2.1 (Amended 2026-09-17, A1/A12) and Spec 2 §6.1's companion
 * amendment: the closed bookkeeping set is never a manifest row and is never
 * removed by uninstall, so where no manifest exists it is admitted by exact
 * shape instead. Shape grants no authority — liveness of the lock is decided
 * by acquiring it, never by this rule.
 */
export const LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS = [
  "backups",
  "backups/transactions",
  "staging",
  "staging/lifecycle",
  "staging/transactions",
  "state/.lifecycle.lock",
  "state/git-effect-journals",
  "state/launchd-effect-journals",
  "state/lifecycle-journals",
  "state/manifest-anchor.json",
  "state/transactions",
] as const;

/**
 * D54: the manifest hash the mutation gate recorded after the last committed manifest-writing
 * transaction. It cannot be a manifest row (writing it would move the hash it records), so it
 * joins the bookkeeping set and is admitted by shape where no manifest exists.
 */
export const MANIFEST_ANCHOR_RELATIVE_PATH = "state/manifest-anchor.json";
/** The exact canonical encoding `{"manifestHash":"<64 hex>","schemaVersion":1}` plus its LF. */
export const MANIFEST_ANCHOR_BYTES = 102;

export type LifecycleBookkeepingObservationV1 =
  | {
      readonly kind: "regular_file";
      readonly ownerUid: number;
      readonly mode: number;
      readonly nlink: number;
      readonly size: bigint;
    }
  | {
      readonly kind: "directory";
      readonly ownerUid: number;
      readonly mode: number;
      readonly childNames: readonly string[];
    }
  | { readonly kind: "other" };

export interface LifecycleBookkeepingResidueV1 {
  /** Absolute paths of inert retained evidence and every descendant of it. */
  readonly retainedPaths: ReadonlySet<string>;
  /** Foundation participant IDs named by inert retained envelopes (`tx_fi_…_{f|c}`). */
  readonly bootstrapParticipantIds: ReadonlySet<string>;
}

export type LifecycleBookkeepingShapeResultV1 =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly offendingPath: string };

const LOCK_RELATIVE_PATH = "state/.lifecycle.lock";
const STATE_TRANSACTIONS_RELATIVE_PATH = "state/transactions";
const PARTICIPANT_DIRECTORY_RELATIVE_PATHS = ["staging/transactions", "backups/transactions"];
/** A12 spec §6.3: attach's whole-file backup (`attach.ts` `#backup`), kept after uninstall as evidence. */
const INSTRUCTION_BACKUP_NAME = /^instruction-(?:claude|codex)-[0-9a-f]{64}$/u;

const ADMITTED: LifecycleBookkeepingShapeResultV1 = { admitted: true };

function refuse(offendingPath: string): LifecycleBookkeepingShapeResultV1 {
  return { admitted: false, offendingPath };
}

export function lifecycleBookkeepingPaths(productHome: string): ReadonlySet<string> {
  return new Set(
    LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS.map((relative) => `${productHome}/${relative}`),
  );
}

function exactStableLock(
  observation: LifecycleBookkeepingObservationV1,
  effectiveUid: number,
): boolean {
  return observation.kind === "regular_file" && observation.ownerUid === effectiveUid &&
    observation.mode === 0o600 && observation.nlink === 1 && observation.size === 0n;
}

function ownedDirectory(
  observation: LifecycleBookkeepingObservationV1,
  effectiveUid: number,
): observation is Extract<LifecycleBookkeepingObservationV1, { readonly kind: "directory" }> {
  return observation.kind === "directory" && observation.ownerUid === effectiveUid;
}

function ancestorOfRetained(path: string, residue: LifecycleBookkeepingResidueV1): boolean {
  for (const retained of residue.retainedPaths) {
    if (retained.startsWith(`${path}/`)) return true;
  }
  return false;
}

function admitRetainedAncestor(
  path: string,
  observe: (path: string) => LifecycleBookkeepingObservationV1,
  effectiveUid: number,
  residue: LifecycleBookkeepingResidueV1,
): LifecycleBookkeepingShapeResultV1 {
  const observation = observe(path);
  if (!ownedDirectory(observation, effectiveUid)) return refuse(path);
  for (const name of observation.childNames) {
    const child = `${path}/${name}`;
    if (residue.retainedPaths.has(child)) continue;
    if (!ancestorOfRetained(child, residue)) return refuse(child);
    const nested = admitRetainedAncestor(child, observe, effectiveUid, residue);
    if (!nested.admitted) return nested;
  }
  return ADMITTED;
}

function admitParticipantDirectory(
  path: string,
  observe: (path: string) => LifecycleBookkeepingObservationV1,
  effectiveUid: number,
  residue: LifecycleBookkeepingResidueV1,
): LifecycleBookkeepingShapeResultV1 {
  const observation = observe(path);
  if (!ownedDirectory(observation, effectiveUid)) return refuse(path);
  for (const name of observation.childNames) {
    const child = `${path}/${name}`;
    if (!residue.retainedPaths.has(child)) return refuse(child);
  }
  return ADMITTED;
}

function admitChild(
  productHome: string,
  parent: string,
  name: string,
  observe: (path: string) => LifecycleBookkeepingObservationV1,
  effectiveUid: number,
  residue: LifecycleBookkeepingResidueV1,
): LifecycleBookkeepingShapeResultV1 {
  const child = `${parent}/${name}`;
  if (lifecycleBookkeepingPaths(productHome).has(child)) {
    return inspectLifecycleBookkeepingShape(productHome, child, observe, effectiveUid, residue);
  }
  if (residue.retainedPaths.has(child)) return ADMITTED;
  if (ancestorOfRetained(child, residue)) {
    return admitRetainedAncestor(child, observe, effectiveUid, residue);
  }
  if (parent === `${productHome}/${STATE_TRANSACTIONS_RELATIVE_PATH}`) {
    const participantId = name.startsWith(".") && name.endsWith(".lock")
      ? name.slice(1, -".lock".length)
      : null;
    if (participantId === null || !residue.bootstrapParticipantIds.has(participantId)) {
      return refuse(child);
    }
    return exactStableLock(observe(child), effectiveUid) ? ADMITTED : refuse(child);
  }
  if (
    PARTICIPANT_DIRECTORY_RELATIVE_PATHS.some((relative) => parent === `${productHome}/${relative}`) &&
    residue.bootstrapParticipantIds.has(name)
  ) {
    return admitParticipantDirectory(child, observe, effectiveUid, residue);
  }
  if (parent === `${productHome}/backups` && INSTRUCTION_BACKUP_NAME.test(name)) {
    const observation = observe(child);
    return observation.kind === "regular_file" && observation.ownerUid === effectiveUid &&
      observation.mode === 0o600 && observation.nlink === 1
      ? ADMITTED
      : refuse(child);
  }
  return refuse(child);
}

/** Pure: `observe` returns the no-follow observation of any absolute path the rule needs to inspect. */
export function inspectLifecycleBookkeepingShape(
  productHome: string,
  path: string,
  observe: (path: string) => LifecycleBookkeepingObservationV1,
  effectiveUid: number,
  residue: LifecycleBookkeepingResidueV1,
): LifecycleBookkeepingShapeResultV1 {
  if (!lifecycleBookkeepingPaths(productHome).has(path)) return refuse(path);
  const observation = observe(path);
  if (path === `${productHome}/${LOCK_RELATIVE_PATH}`) {
    return exactStableLock(observation, effectiveUid) ? ADMITTED : refuse(path);
  }
  if (path === `${productHome}/${MANIFEST_ANCHOR_RELATIVE_PATH}`) {
    // A create interrupted before its write leaves a shorter file; its content is never authority here.
    return observation.kind === "regular_file" && observation.ownerUid === effectiveUid &&
      observation.mode === 0o600 && observation.nlink === 1 && observation.size <= BigInt(MANIFEST_ANCHOR_BYTES)
      ? ADMITTED
      : refuse(path);
  }
  if (!ownedDirectory(observation, effectiveUid) || observation.mode !== 0o700) return refuse(path);
  for (const name of observation.childNames) {
    const result = admitChild(productHome, path, name, observe, effectiveUid, residue);
    if (!result.admitted) return result;
  }
  return ADMITTED;
}
