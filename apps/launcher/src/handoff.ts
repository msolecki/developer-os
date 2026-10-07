import { spawn } from "node:child_process";
import { constants } from "node:os";

import type { LauncherProcessRequestV1 } from "./selection.js";

/**
 * Execs the admitted release with stdio only: the launcher hands the child no
 * other descriptor (D84 K3; NEW-112 closes by deletion). It waits for the
 * child's own exit status, which the caller mirrors as its own: the child's
 * code, or 128 plus the number of the signal that killed it, as a shell does.
 */
export async function execAdmittedRelease(request: LauncherProcessRequestV1): Promise<number> {
  const child = spawn(request.executable, [...request.argv], {
    env: { ...request.env },
    stdio: ["inherit", "inherit", "inherit"],
  });
  const { code, signal } = await new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, exitSignal) => {
        resolve({ code: exitCode, signal: exitSignal });
      });
    },
  );
  return code ?? (signal === null ? 1 : 128 + constants.signals[signal]);
}
