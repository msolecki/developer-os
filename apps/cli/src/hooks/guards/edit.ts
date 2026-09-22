import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { containsPath } from "@developer-os/core";

import { excerpt } from "../outcome.js";
import { HOOK_TOOL_MATCHERS } from "../payload.js";
import { resolveProjectRoot } from "../project-root.js";
import type { HookVerbHandler } from "../registry.js";

/** Resolves the path only; the file is never opened (§5.3). */
export const guardEdit: HookVerbHandler = async (payload, runtime) => {
  const matchers = HOOK_TOOL_MATCHERS[runtime.vendor];
  if (matchers === null || payload.toolName === null || !matchers.file.includes(payload.toolName)) {
    return { kind: "allow" };
  }
  const path = payload.filePath;
  if (path === null || path.includes("\0")) return { kind: "allow" };
  const root = await resolveProjectRoot(runtime.cwd);
  const lexical = isAbsolute(path) ? resolve(path) : resolve(root, path);
  if (!containsPath(root, lexical)) return { kind: "allow" };
  let real: string;
  try {
    real = await realpath(lexical);
  } catch {
    return { kind: "allow" };
  }
  if (containsPath(root, real)) return { kind: "allow" };
  return {
    kind: "advise",
    ruleId: "shared-file",
    detail: `${excerpt(path)} resolves outside the project root; it is shared with other projects`,
  };
};
