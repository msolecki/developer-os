import { lstat, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { geteuid } from "node:process";

import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "@developer-os/core";
import type { SystemPathObservationV1 } from "@developer-os/security";

/** What the walk needs from the host; `T` lets a caller carry extra identity fields per observation. */
export interface ExecutableFileSystemV1<T extends SystemPathObservationV1 = SystemPathObservationV1> {
  readonly realpath: (path: string) => Promise<string>;
  /** No-follow observation of one path. */
  readonly inspect: (path: CanonicalAbsolutePathV1) => Promise<T>;
  readonly effectiveUid: number;
}

export class UntrustedExecutableError extends Error {
  constructor(readonly path: string) {
    super(`the executable is not trusted: ${path}`);
    this.name = "UntrustedExecutableError";
  }
}

export interface AdmittedExecutableV1<T extends SystemPathObservationV1> {
  readonly canonicalPath: CanonicalAbsolutePathV1;
  readonly target: Exclude<T, { kind: "absent" }>;
}

/**
 * Resolves the selected executable through every link to its real path, which must be a regular
 * executable file owned by the user or root with no group/other write and no setuid, setgid or
 * sticky bit; every ancestor up to `/` must be a directory owned by the user or root with no
 * group/other write (D72 Q2-A). The link's own directory chain is not inspected: the caller
 * spawns the real path, never the link. Identity is the caller's: codex pins `sha256`, capture
 * pins `ctimeNs` (D73 addendum).
 */
export async function admitOwnedExecutable<T extends SystemPathObservationV1>(
  selected: string,
  deps: ExecutableFileSystemV1<T>,
): Promise<AdmittedExecutableV1<T>> {
  const canonicalPath = parseCanonicalAbsolutePathText(await deps.realpath(selected));
  const owned = (uid: number): boolean => uid === deps.effectiveUid || uid === 0;
  for (let ancestor = dirname(canonicalPath); ; ancestor = dirname(ancestor)) {
    const entry: SystemPathObservationV1 = await deps.inspect(ancestor as CanonicalAbsolutePathV1);
    if (entry.kind !== "directory" || !owned(entry.ownerUid) || (entry.mode & 0o022) !== 0) throw new UntrustedExecutableError(ancestor);
    if (ancestor === "/") break;
  }
  const target: SystemPathObservationV1 = await deps.inspect(canonicalPath);
  if (target.kind !== "file" || !owned(target.ownerUid) || (target.mode & 0o7022) !== 0 || (target.mode & 0o100) === 0) {
    throw new UntrustedExecutableError(canonicalPath);
  }
  return { canonicalPath, target: target as Exclude<T, { kind: "absent" }> };
}

/** A no-follow observation carrying `ctimeNs` and never a hash: the vendor binary is not read. */
export type ProbePathObservationV1 =
  | { readonly kind: "absent" }
  | (Exclude<SystemPathObservationV1, { kind: "absent" }> & { readonly ctimeNs: string });

export type ProbeFileSystemV1 = ExecutableFileSystemV1<ProbePathObservationV1>;

/** `ctime` moves on any content or metadata write, so a same-uid swap or rewrite fails the recheck. */
const PINNED_PROBE_FIELDS = ["dev", "ino", "mode", "size", "ctimeNs"] as const;

export interface PinnedProbeExecutableV1 {
  readonly canonicalPath: CanonicalAbsolutePathV1;
  readonly identity: Pick<Exclude<ProbePathObservationV1, { kind: "absent" }>, (typeof PINNED_PROBE_FIELDS)[number]>;
}

async function inspectProbePath(path: CanonicalAbsolutePathV1): Promise<ProbePathObservationV1> {
  let stats;
  try {
    stats = await lstat(path, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    throw error;
  }
  const kind = stats.isSymbolicLink() ? "symlink" : stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other";
  return {
    kind,
    ownerUid: Number(stats.uid),
    mode: Number(stats.mode & 0o7777n),
    dev: stats.dev.toString(10),
    ino: stats.ino.toString(10),
    size: Number(stats.size),
    sha256: null,
    ctimeNs: stats.ctimeNs.toString(10),
  };
}

export const PROBE_FILE_SYSTEM: ProbeFileSystemV1 = {
  realpath,
  inspect: inspectProbePath,
  effectiveUid: geteuid?.() ?? -1,
};

/** `admitOwnedExecutable`, pinned by `{dev, ino, mode, size, ctimeNs}` (NEW-46, D73 addendum). */
export async function pinProbeExecutable(selected: CanonicalAbsolutePathV1, deps: ProbeFileSystemV1): Promise<PinnedProbeExecutableV1> {
  const { canonicalPath, target } = await admitOwnedExecutable(selected, deps);
  const { dev, ino, mode, size, ctimeNs } = target;
  return { canonicalPath, identity: { dev, ino, mode, size, ctimeNs } };
}

/** Re-admits the pinned real path immediately before a spawn; throws unless every pinned field still holds. */
export async function recheckProbeExecutable(pinned: PinnedProbeExecutableV1, deps: ProbeFileSystemV1): Promise<void> {
  const fresh = await pinProbeExecutable(pinned.canonicalPath, deps);
  const same =
    fresh.canonicalPath === pinned.canonicalPath &&
    PINNED_PROBE_FIELDS.every((field) => fresh.identity[field] === pinned.identity[field]);
  if (!same) throw new UntrustedExecutableError(pinned.canonicalPath);
}
