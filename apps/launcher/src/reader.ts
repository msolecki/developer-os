import { createNodeLifecycleGuardedFileSystem } from "@developer-os/core";
import type { LauncherGuardedReaderV1 } from "@developer-os/platform-macos";

/**
 * Core's guarded filesystem, narrowed to the read surface: no-follow opens,
 * owner/type/size admitted before a bounded read, and the open handle's
 * device/inode/mode/link/size compared with the admitted entry before and
 * after every read, hash and directory listing (Spec 2 §3.1).
 *
 * A root-owned entry is read through a second guarded reader bound to uid 0: a
 * keg Homebrew installed as root is owned by root (D84 K2). Which entries may
 * be root-owned is the caller's admission (`selection.ts` admits it only for
 * the keg); every other uid but the effective one still refuses here.
 */
export function createNodeLauncherReader(effectiveUid: number): LauncherGuardedReaderV1 {
  const renameNoReplace = () => Promise.reject(new Error("the launcher never publishes a bootstrap journal"));
  const own = createNodeLifecycleGuardedFileSystem({ effectiveUid, renameNoReplace });
  const root = createNodeLifecycleGuardedFileSystem({ effectiveUid: 0, renameNoReplace });
  const by = (ownerUid: number) => (ownerUid === 0 ? root : own);
  return {
    lstat: (path) => own.lstat(path),
    names: (directory) => own.names(directory),
    readRegular: (entry, maximumBytes) => by(entry.ownerUid).readRegular(entry, maximumBytes),
    hashRegular: (entry, maximumBytes) => by(entry.ownerUid).hashRegular(entry, maximumBytes),
  };
}
