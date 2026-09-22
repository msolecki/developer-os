import { join } from "node:path";

import { containsPath } from "@developer-os/core";
import { ProtectedPathPolicy } from "@developer-os/security";

import { excerpt } from "../outcome.js";
import { HOOK_TOOL_MATCHERS } from "../payload.js";
import { resolveEditedPath, resolveProjectRoot } from "../project-root.js";
import type { HookVerbHandler } from "../registry.js";
import { FORMATTER_TIMEOUT_MS, HOOK_CHILD_ENV, isRegularFile, localBin } from "./child.js";

/** A `package.json` `"prettier"` key deliberately does not count. */
export const PRETTIER_CONFIG_FILES: readonly string[] = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.json5",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
];

async function formatterFor(
  root: string,
): Promise<{ readonly name: "biome" | "prettier"; readonly args: readonly string[] } | null> {
  if (await isRegularFile(join(root, "biome.json"))) return { name: "biome", args: ["format", "--write"] };
  for (const file of PRETTIER_CONFIG_FILES) {
    if (await isRegularFile(join(root, file))) return { name: "prettier", args: ["--write"] };
  }
  return null;
}

export const guardFormat: HookVerbHandler = async (payload, runtime) => {
  const matchers = HOOK_TOOL_MATCHERS[runtime.vendor];
  if (matchers === null || payload.toolName === null || !matchers.file.includes(payload.toolName)) {
    return { kind: "allow" };
  }
  if (payload.filePath === null) return { kind: "allow" };
  if (runtime.userHome === null) return { kind: "allow", note: "format skipped: user home is unknown" };
  const root = await resolveProjectRoot(runtime.cwd);
  let file: string;
  try {
    file = await resolveEditedPath(root, payload.filePath);
    if (file === root || !containsPath(root, file)) return { kind: "allow" };
    await new ProtectedPathPolicy(runtime.userHome).assertWritable(file);
  } catch {
    return { kind: "allow" };
  }
  const formatter = await formatterFor(root);
  if (formatter === null) return { kind: "allow" };
  const script = await localBin(root, formatter.name);
  if (script === null) return { kind: "allow" };
  let result;
  try {
    result = await runtime.runner.run({
      executable: runtime.nodeExecutable,
      args: [script, ...formatter.args, file],
      cwd: root,
      stdin: "",
      timeoutMs: FORMATTER_TIMEOUT_MS,
      env: HOOK_CHILD_ENV,
    });
  } catch {
    return { kind: "allow", note: `${formatter.name} could not run` };
  }
  if (result.timedOut) return { kind: "allow", note: `${formatter.name} timed out after ${String(FORMATTER_TIMEOUT_MS)} ms` };
  if (result.exitCode === 0) return { kind: "allow" };
  return {
    kind: "advise",
    ruleId: "format-failed",
    detail: `${formatter.name} could not format ${excerpt(payload.filePath)}`,
  };
};
