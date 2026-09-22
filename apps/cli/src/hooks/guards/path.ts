import { isAbsolute, resolve } from "node:path";

import { ProtectedPathPolicy, SecurityRefusalError } from "@developer-os/security";

import { excerpt } from "../outcome.js";
import { HOOK_TOOL_MATCHERS } from "../payload.js";
import { resolveEditedPath, resolveProjectRoot } from "../project-root.js";
import type { HookVerbHandler } from "../registry.js";

/**
 * Both the lexical and the canonical path are checked: canonicalizing alone would let a project
 * symlink named `.env` that points at an ordinary file through.
 */
export const guardPath: HookVerbHandler = async (payload, runtime) => {
  const file = HOOK_TOOL_MATCHERS[runtime.vendor]?.file ?? [];
  if (payload.toolName === null || !file.includes(payload.toolName)) return { kind: "allow" };
  if (payload.filePath === null) return { kind: "block", ruleId: "payload-malformed", detail: "file path field absent" };
  if (runtime.userHome === null) return { kind: "block", ruleId: "hook-failed-closed", detail: "user home unavailable" };
  const root = await resolveProjectRoot(runtime.cwd);
  const canonical = await resolveEditedPath(root, payload.filePath);
  const lexical = isAbsolute(payload.filePath) ? payload.filePath : resolve(root, payload.filePath);
  const policy = new ProtectedPathPolicy(runtime.userHome);
  try {
    await policy.assertWritable(lexical);
    await policy.assertWritable(canonical);
  } catch (error) {
    if (error instanceof SecurityRefusalError) {
      return { kind: "block", ruleId: "protected-path", detail: excerpt(payload.filePath) };
    }
    throw error;
  }
  return { kind: "allow" };
};
