import { readFile, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { containsPath } from "@developer-os/core";

export const TSC_TIMEOUT_MS = 120_000;
export const FORMATTER_TIMEOUT_MS = 30_000;
export const HOOK_CHILD_ENV: Readonly<Record<string, string>> = Object.freeze({ DEVELOPER_OS_HOOK_ACTIVE: "1" });

const TOOL_PACKAGES = { tsc: "typescript", biome: "@biomejs/biome", prettier: "prettier" } as const;

function strictlyInside(parent: string, child: string): boolean {
  return resolve(parent) !== resolve(child) && containsPath(parent, child);
}

/**
 * The canonical JS entry that `<root>/node_modules/<package>/package.json` declares as
 * the tool's `bin`, for the hook's node to run. `node_modules/.bin/<tool>` is not used:
 * under pnpm it is a `#!/bin/sh` wrapper that node cannot execute. Null (tool absent)
 * unless the package resolves inside root and its bin target is a regular file inside
 * the package.
 */
export async function localBin(projectRoot: string, name: keyof typeof TOOL_PACKAGES): Promise<string | null> {
  try {
    const pkg = TOOL_PACKAGES[name];
    const pkgDir = await realpath(join(projectRoot, "node_modules", pkg));
    if (!strictlyInside(projectRoot, pkgDir)) return null;
    const manifest = await realpath(join(pkgDir, "package.json"));
    if (!strictlyInside(pkgDir, manifest) || !(await stat(manifest)).isFile()) return null;
    const { bin } = JSON.parse(await readFile(manifest, "utf8")) as { bin?: unknown };
    // A string `bin` names the command after the package, scope dropped.
    const entry =
      typeof bin === "string"
        ? pkg.replace(/^@[^/]+\//u, "") === name
          ? bin
          : undefined
        : typeof bin === "object" && bin !== null && Object.hasOwn(bin, name)
          ? (bin as Record<string, unknown>)[name]
          : undefined;
    if (typeof entry !== "string" || entry === "") return null;
    const real = await realpath(join(pkgDir, entry));
    if (!strictlyInside(pkgDir, real)) return null;
    return (await stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}

export async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
