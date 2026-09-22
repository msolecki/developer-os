import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { canonicalizePlannedPath } from "@developer-os/security";

export async function resolveProjectRoot(cwd: string): Promise<string> {
  const start = await canonicalizePlannedPath(cwd);
  for (let dir = start; ; dir = dirname(dir)) {
    try {
      await lstat(join(dir, ".git"));
      return dir;
    } catch {
      if (dirname(dir) === dir) return start;
    }
  }
}

/** A relative payload path resolves against the project root, never the user home (G7). */
export async function resolveEditedPath(projectRoot: string, filePath: string): Promise<string> {
  if (filePath.includes("\0")) throw new Error("edited path contains a NUL byte");
  return await canonicalizePlannedPath(isAbsolute(filePath) ? filePath : resolve(projectRoot, filePath));
}
