import { constants } from "node:fs";
import * as nodeFs from "node:fs/promises";

import { EXIT_CODES } from "@developer-os/core";
import { EX_TEMPFAIL, SpawnLockfRunner } from "@developer-os/platform-macos";
import type { LockfRunner } from "@developer-os/platform-macos";

import { UpdatePlanningRefusal } from "./planning.js";

/**
 * The scratch attempt lock (NEW-173): `/usr/bin/lockf -s -t 0` on our descriptor, the global
 * lock's primitive, so the flock lives on this process's open file and dies with it. A lock
 * whose name no longer reaches its inode was dropped by a finishing holder: nothing to recover.
 */
export async function tryLockScratchAttempt(
  path: string,
  runner: LockfRunner = new SpawnLockfRunner(),
): Promise<{ release(): Promise<void> } | null> {
  const handle = await nodeFs.open(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  let held = false;
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.uid !== BigInt(process.getuid?.() ?? -1)) throw new UpdatePlanningRefusal("update_scratch_lock_identity", EXIT_CODES.recoveryRequired, [path]);
    const result = await runner.acquire(handle.fd);
    if (result.exitCode === EX_TEMPFAIL && result.signal === null) return null;
    if (result.exitCode !== 0 || result.signal !== null) throw new UpdatePlanningRefusal("update_scratch_lock_failed", EXIT_CODES.operationalFailure, [path]);
    const named = await nodeFs.lstat(path, { bigint: true }).catch(() => null);
    if (named?.dev !== opened.dev || named.ino !== opened.ino) return null;
    held = true;
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        await handle.close();
      },
    };
  } finally {
    if (!held) await handle.close();
  }
}
