import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { containsPath } from "@developer-os/core";

import { excerpt } from "../outcome.js";
import { editedPaths, HOOK_TOOL_MATCHERS } from "../payload.js";
import { relativePathBase, resolveProjectRoot } from "../project-root.js";
import type { HookVerbHandler } from "../registry.js";

/** Resolves the path only; the file is never opened (`hooks.md` §3.4.1). */
export const guardEdit: HookVerbHandler = async (payload, runtime) => {
  if (payload.toolName === null || !HOOK_TOOL_MATCHERS[runtime.vendor].file.includes(payload.toolName)) {
    return { kind: "allow" };
  }
  const paths = editedPaths(payload, runtime.vendor);
  if (paths === null) return { kind: "allow" };
  const root = await resolveProjectRoot(runtime.cwd);
  const base = await relativePathBase(runtime.vendor, runtime.cwd, root);
  for (const path of paths) {
    if (path.includes("\0")) continue;
    const lexical = isAbsolute(path) ? resolve(path) : resolve(base, path);
    if (!containsPath(root, lexical)) continue;
    let real: string;
    try {
      real = await realpath(lexical);
    } catch {
      continue;
    }
    if (containsPath(root, real)) continue;
    return {
      kind: "advise",
      ruleId: "shared-file",
      detail: `${excerpt(runtime.redact(path))} resolves outside the project root; it is shared with other projects`,
    };
  }
  return { kind: "allow" };
};
