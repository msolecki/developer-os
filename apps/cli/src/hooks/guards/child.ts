import { access, constants, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

export const TSC_TIMEOUT_MS = 120_000;
export const FORMATTER_TIMEOUT_MS = 30_000;
export const HOOK_CHILD_ENV: Readonly<Record<string, string>> = Object.freeze({ DEVELOPER_OS_HOOK_ACTIVE: "1" });

/** The canonical script path of `<root>/node_modules/.bin/<name>` if it is an executable regular file inside root, else null. */
export async function localBin(projectRoot: string, name: "tsc" | "biome" | "prettier"): Promise<string | null> {
  try {
    const real = await realpath(join(projectRoot, "node_modules", ".bin", name));
    const rel = relative(projectRoot, real);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
    const info = await stat(real);
    if (!info.isFile()) return null;
    await access(real, constants.X_OK);
    return real;
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
