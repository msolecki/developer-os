import { join } from "node:path";

import { containsPath } from "@developer-os/core";
import { ProtectedPathPolicy } from "@developer-os/security";

import { excerpt } from "../outcome.js";
import { editedPaths, HOOK_TOOL_MATCHERS } from "../payload.js";
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

/** Edited files that still exist inside the project and outside every protected path. */
async function formattable(root: string, paths: readonly string[], userHome: string): Promise<readonly string[]> {
  const policy = new ProtectedPathPolicy(userHome);
  const files: string[] = [];
  for (const path of paths) {
    try {
      const file = await resolveEditedPath(root, path);
      if (file === root || !containsPath(root, file) || !(await isRegularFile(file))) continue;
      await policy.assertWritable(file);
      files.push(file);
    } catch {
      continue;
    }
  }
  return files;
}

export const guardFormat: HookVerbHandler = async (payload, runtime) => {
  if (payload.toolName === null || !HOOK_TOOL_MATCHERS[runtime.vendor].file.includes(payload.toolName)) {
    return { kind: "allow" };
  }
  const paths = editedPaths(payload, runtime.vendor);
  if (paths === null) return { kind: "allow" };
  if (runtime.userHome === null) return { kind: "allow", note: "format skipped: user home is unknown" };
  const root = await resolveProjectRoot(runtime.cwd);
  const files = await formattable(root, paths, runtime.userHome);
  if (files.length === 0) return { kind: "allow" };
  const formatter = await formatterFor(root);
  if (formatter === null) return { kind: "allow" };
  const script = await localBin(root, formatter.name);
  if (script === null) return { kind: "allow" };
  let result;
  try {
    result = await runtime.runner.run({
      executable: runtime.nodeExecutable,
      args: [script, ...formatter.args, ...files],
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
    detail: `${formatter.name} could not format ${excerpt(paths.join(", "))}`,
  };
};
