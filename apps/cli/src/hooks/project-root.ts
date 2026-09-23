import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { canonicalizePlannedPath } from "@developer-os/security";

import type { HookVendor } from "./argv.js";

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

/**
 * The directory a relative edited path resolves against. A Claude payload path is absolute, and a
 * relative one resolves against the project root, never the user home (G7). A Codex `apply_patch`
 * path is relative to the session `cwd` (hooks.md §1 question 4), which Codex itself writes under,
 * even when that `cwd` is below the project root or inside the user home.
 */
export async function relativePathBase(vendor: HookVendor, cwd: string, projectRoot: string): Promise<string> {
  return vendor === "codex" ? await canonicalizePlannedPath(cwd) : projectRoot;
}

export async function resolveEditedPath(base: string, filePath: string): Promise<string> {
  if (filePath.includes("\0")) throw new Error("edited path contains a NUL byte");
  return await canonicalizePlannedPath(isAbsolute(filePath) ? filePath : resolve(base, filePath));
}
