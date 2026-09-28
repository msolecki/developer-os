/**
 * The platform-neutral system executable contract (Spec 1 §4.2 and §5.3 as amended
 * 2026-09-28, D71; NEW-113). A row names an operating system's standard fixed path, and
 * admission is a predicate over ownership and mode, not an exact build or binary hash:
 * `size` and `sha256` are per-invocation evidence, rechecked before each real exec. The
 * platform package owns the rows; callers map `SystemExecutableRefusalError` to their
 * own refusal code.
 */
import {
  encodeCanonicalJson,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseUInt64Decimal,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonValue,
  type LowerHexSha256,
  type UInt64DecimalV1,
} from "@developer-os/core";

export type SystemPlatformV1 = "darwin" | "linux" | "win32";
export type SystemExecutableIdV1 = "git" | "git-receive-pack" | "ssh" | "scheduler";

export interface SystemExecutableRowV1 {
  readonly platform: SystemPlatformV1;
  readonly id: SystemExecutableIdV1;
  readonly path: string;
  readonly ancestors: readonly CanonicalAbsolutePathV1[];
  readonly admission: "posix_root_owned";
  readonly status: "implemented" | "intended";
}

export type SystemPathObservationV1 =
  | { readonly kind: "absent" }
  | {
      readonly kind: "file" | "directory" | "symlink" | "other";
      readonly ownerUid: number;
      readonly mode: number;
      readonly dev: string;
      readonly ino: string;
      readonly size: number;
      readonly sha256: string | null;
    };

/** Observes a path without following a link at it; `sha256` is non-null only for a regular file. */
export type SystemPathInspectorV1 = (path: CanonicalAbsolutePathV1) => Promise<SystemPathObservationV1>;
/** The same observation, synchronously, for a recheck inside a synchronous permit consumption. */
export type SystemPathInspectorSyncV1 = (path: CanonicalAbsolutePathV1) => SystemPathObservationV1;

export interface AdmittedSystemExecutableV1 {
  readonly platform: SystemPlatformV1;
  readonly id: SystemExecutableIdV1;
  readonly canonicalPath: CanonicalAbsolutePathV1;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
  readonly size: number;
  readonly sha256: LowerHexSha256;
}

export class SystemExecutableRefusalError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(`system executable refused: ${detail}`);
    this.name = "SystemExecutableRefusalError";
    this.detail = detail;
  }
}

function refuse(detail: string): never {
  throw new SystemExecutableRefusalError(detail);
}

const writableByOthers = (mode: number): boolean => (mode & 0o022) !== 0;

function implementedPath(row: SystemExecutableRowV1): CanonicalAbsolutePathV1 {
  if (row.status !== "implemented") refuse(`${row.platform}/${row.id} is not implemented`);
  return parseCanonicalAbsolutePathText(row.path);
}

function requireRootOwnedAncestor(ancestor: CanonicalAbsolutePathV1, entry: SystemPathObservationV1): void {
  if (entry.kind !== "directory" || entry.ownerUid !== 0 || writableByOthers(entry.mode)) {
    refuse(`${ancestor} is not a root-owned directory without group/other write`);
  }
}

function admittedTarget(row: SystemExecutableRowV1, path: CanonicalAbsolutePathV1, target: SystemPathObservationV1): AdmittedSystemExecutableV1 {
  if (
    target.kind !== "file" ||
    target.ownerUid !== 0 ||
    writableByOthers(target.mode) ||
    (target.mode & 0o6000) !== 0 ||
    (target.mode & 0o100) === 0 ||
    !Number.isSafeInteger(target.size) ||
    target.size < 1 ||
    target.sha256 === null
  ) {
    refuse(`${path} is not a root-owned executable regular file`);
  }
  return {
    platform: row.platform,
    id: row.id,
    canonicalPath: path,
    dev: parseUInt64Decimal(target.dev),
    ino: parseUInt64Decimal(target.ino),
    size: target.size,
    sha256: parseLowerHexSha256(target.sha256),
  };
}

/**
 * `posix_root_owned`: every listed ancestor is a root-owned directory without group/other
 * write, and the standard path itself is a root-owned regular file (a link refuses) with
 * the owner-execute bit, no group/other write and neither setuid nor setgid.
 */
export async function admitPosixRootOwned(
  row: SystemExecutableRowV1,
  inspect: SystemPathInspectorV1,
): Promise<AdmittedSystemExecutableV1> {
  const path = implementedPath(row);
  for (const ancestor of row.ancestors) requireRootOwnedAncestor(ancestor, await inspect(ancestor));
  return admittedTarget(row, path, await inspect(path));
}

/** `admitPosixRootOwned` over a synchronous inspector: the same predicate, step for step. */
export function admitPosixRootOwnedSync(row: SystemExecutableRowV1, inspect: SystemPathInspectorSyncV1): AdmittedSystemExecutableV1 {
  const path = implementedPath(row);
  for (const ancestor of row.ancestors) requireRootOwnedAncestor(ancestor, inspect(ancestor));
  return admittedTarget(row, path, inspect(path));
}

const identityBytes = (admitted: AdmittedSystemExecutableV1): string =>
  encodeCanonicalJson(admitted as unknown as CanonicalJsonValue);

function requireUnchanged(fresh: AdmittedSystemExecutableV1, admitted: AdmittedSystemExecutableV1): void {
  if (identityBytes(fresh) !== identityBytes(admitted)) refuse(`${fresh.canonicalPath} changed since admission`);
}

/** Re-admits and refuses any difference from the invocation's admitted evidence. */
export async function recheckSystemExecutable(
  row: SystemExecutableRowV1,
  inspect: SystemPathInspectorV1,
  admitted: AdmittedSystemExecutableV1,
): Promise<void> {
  requireUnchanged(await admitPosixRootOwned(row, inspect), admitted);
}

export function recheckSystemExecutableSync(
  row: SystemExecutableRowV1,
  inspect: SystemPathInspectorSyncV1,
  admitted: AdmittedSystemExecutableV1,
): void {
  requireUnchanged(admitPosixRootOwnedSync(row, inspect), admitted);
}
