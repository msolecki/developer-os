/**
 * The `darwin` rows of Spec 1 §4.2's `SystemExecutableTableV1` (amended 2026-09-28, D71;
 * NEW-113) and the no-follow inspector their `posix_root_owned` admission reads. Only
 * standard fixed paths: nothing here consults `PATH`, `DEVELOPER_DIR` or `xcrun`.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "@developer-os/core";
import type { SystemExecutableRowV1, SystemPathObservationV1 } from "@developer-os/security";

/** Every admitted Apple binary is far below this; a larger file is observed but not hashed. */
const MAX_HASHED_BYTES = 64 * 1024 * 1024;

/** `CanonicalAbsolutePathV1`'s grammar refuses a trailing `/`, so the root is the one literal cast. */
const ROOT = "/" as CanonicalAbsolutePathV1;
const USR = parseCanonicalAbsolutePathText("/usr");
const USR_BIN = parseCanonicalAbsolutePathText("/usr/bin");
const BIN = parseCanonicalAbsolutePathText("/bin");

export const DARWIN_SYSTEM_EXECUTABLES: readonly SystemExecutableRowV1[] = [
  { platform: "darwin", id: "git", path: "/usr/bin/git", ancestors: [ROOT, USR, USR_BIN], admission: "posix_root_owned", status: "implemented" },
  { platform: "darwin", id: "scheduler", path: "/bin/launchctl", ancestors: [ROOT, BIN], admission: "posix_root_owned", status: "implemented" },
  { platform: "darwin", id: "ssh", path: "/usr/bin/ssh", ancestors: [ROOT, USR, USR_BIN], admission: "posix_root_owned", status: "implemented" },
];

function kindOf(stats: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): "file" | "directory" | "symlink" | "other" {
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isDirectory()) return "directory";
  return stats.isFile() ? "file" : "other";
}

/**
 * `lstat` without following a link, then, for a regular file, a hash read through an
 * `O_NOFOLLOW` descriptor whose `dev`/`ino`/`size` match that `lstat`. A mismatch leaves
 * `sha256` null, which admission refuses. `ENOENT` is `absent`; any other error propagates.
 */
export async function inspectSystemPath(path: CanonicalAbsolutePathV1): Promise<SystemPathObservationV1> {
  let observed;
  try {
    observed = await lstat(path, { bigint: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    throw error;
  }
  const common = {
    kind: kindOf(observed),
    ownerUid: Number(observed.uid),
    mode: Number(observed.mode & 0o7777n),
    dev: observed.dev.toString(10),
    ino: observed.ino.toString(10),
    size: Number(observed.size),
  };
  if (!observed.isFile() || observed.size > BigInt(MAX_HASHED_BYTES)) return { ...common, sha256: null };
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== observed.dev || opened.ino !== observed.ino || opened.size !== observed.size) {
      return { ...common, sha256: null };
    }
    const bytes = await handle.readFile();
    return { ...common, sha256: createHash("sha256").update(bytes).digest("hex") };
  } finally {
    await handle.close();
  }
}
