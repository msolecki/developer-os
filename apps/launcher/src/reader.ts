import { createNodeLifecycleGuardedFileSystem } from "@developer-os/core";
import type { LauncherGuardedReaderV1 } from "@developer-os/platform-macos";

/**
 * Core's guarded filesystem, narrowed to the read surface: no-follow opens,
 * owner/type/size admitted before a bounded read, and the open handle's
 * device/inode/mode/link/size compared with the admitted entry before and
 * after every read, hash and directory listing (Spec 2 §3.1).
 */
export function createNodeLauncherReader(effectiveUid: number): LauncherGuardedReaderV1 {
  return createNodeLifecycleGuardedFileSystem({
    effectiveUid,
    renameNoReplace: () => Promise.reject(new Error("the launcher never publishes a bootstrap journal")),
  });
}
