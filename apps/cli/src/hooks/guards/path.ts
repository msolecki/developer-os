import { isAbsolute, resolve } from "node:path";

import { ProtectedPathPolicy, SecurityRefusalError } from "@developer-os/security";

import { excerpt } from "../outcome.js";
import { editedPaths, HOOK_TOOL_MATCHERS } from "../payload.js";
import { relativePathBase, resolveEditedPath, resolveProjectRoot } from "../project-root.js";
import type { HookVerbHandler } from "../registry.js";

/**
 * Both the lexical and the canonical path are checked: canonicalizing alone would let a project
 * symlink named `.env` that points at an ordinary file through.
 */
export const guardPath: HookVerbHandler = async (payload, runtime) => {
  if (payload.toolName === null || !HOOK_TOOL_MATCHERS[runtime.vendor].file.includes(payload.toolName)) {
    return { kind: "allow" };
  }
  const paths = editedPaths(payload, runtime.vendor);
  if (paths === null) {
    return runtime.vendor === "codex"
      ? { kind: "block", ruleId: "patch-malformed", detail: "patch outside the observed apply_patch grammar" }
      : { kind: "block", ruleId: "payload-malformed", detail: "file path field absent" };
  }
  if (runtime.userHome === null) return { kind: "block", ruleId: "hook-failed-closed", detail: "user home unavailable" };
  const base = await relativePathBase(runtime.vendor, runtime.cwd, await resolveProjectRoot(runtime.cwd));
  const policy = new ProtectedPathPolicy(runtime.userHome);
  for (const path of paths) {
    const canonical = await resolveEditedPath(base, path);
    const lexical = isAbsolute(path) ? path : resolve(base, path);
    try {
      await policy.assertWritable(lexical);
      await policy.assertWritable(canonical);
    } catch (error) {
      if (error instanceof SecurityRefusalError) return { kind: "block", ruleId: "protected-path", detail: excerpt(runtime.redact(path)) };
      throw error;
    }
  }
  return { kind: "allow" };
};
