import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { ProcessResult } from "@developer-os/security";

import { capUtf8Bytes } from "../outcome.js";
import { resolveProjectRoot } from "../project-root.js";
import type { HookVerbHandler } from "../registry.js";
import { HOOK_CHILD_ENV, isRegularFile, localBin, TSC_TIMEOUT_MS } from "./child.js";

const MAX_DIAGNOSTIC_LINES = 40;
const MAX_DIAGNOSTIC_BYTES = 1800;

/** Strip JSONC comments and trailing commas, string-aware. ponytail: no BOM or unterminated-string repair. */
function stripJsonc(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else out += c;
  }
  return out.replace(/,(\s*[\]}])/gu, "$1");
}

/** Absolute tsconfig paths of the config's `references`; throws when the config is not a JSONC object. */
async function referencedConfigs(config: string): Promise<string[]> {
  const parsed: unknown = JSON.parse(stripJsonc(await readFile(config, "utf8")));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("tsconfig is not an object");
  const refs = (parsed as { references?: unknown }).references;
  if (!Array.isArray(refs)) return [];
  return refs.flatMap((ref: unknown) => {
    const path = (ref as { path?: unknown } | null)?.path;
    if (typeof path !== "string" || path === "") return [];
    const abs = isAbsolute(path) ? path : resolve(dirname(config), path);
    return [abs.endsWith(".json") ? abs : join(abs, "tsconfig.json")];
  });
}

/** Older tsc rejects `-b --noEmit` with a location-less option error. */
const BUILD_REJECTED = /^error TS\d+:.*(noEmit|build)/imu;

export const guardStop: HookVerbHandler = async (payload, runtime) => {
  if (payload.stopHookActive !== false) return { kind: "allow" };
  const root = await resolveProjectRoot(runtime.cwd);
  if (!(await isRegularFile(join(root, "tsconfig.json")))) return { kind: "allow" };
  const script = await localBin(root, "tsc");
  if (script === null) return { kind: "allow" };
  const checkConfig = join(root, "tsconfig.check.json");
  const config = (await isRegularFile(checkConfig)) ? checkConfig : join(root, "tsconfig.json");
  let refs: string[];
  try {
    refs = await referencedConfigs(config);
  } catch {
    return { kind: "allow", note: "typecheck skipped: tsconfig could not be read" };
  }
  const deadline = Date.now() + TSC_TIMEOUT_MS;
  const run = (args: string[]) =>
    runtime.runner.run({
      executable: runtime.nodeExecutable,
      args: [script, ...args],
      cwd: root,
      stdin: "",
      timeoutMs: Math.max(1, deadline - Date.now()),
      env: HOOK_CHILD_ENV,
    });
  let result;
  try {
    if (refs.length === 0) result = await run(["--noEmit", "-p", config]);
    else {
      result = await run(["-b", "--noEmit", config]);
      if (result.exitCode !== 0 && !result.timedOut && BUILD_REJECTED.test(`${result.stdout}\n${result.stderr}`)) {
        let merged: ProcessResult = { ...result, exitCode: 0, stdout: "", stderr: "" };
        for (const ref of refs) {
          const one = await run(["--noEmit", "-p", ref]);
          merged = {
            ...one,
            exitCode: one.exitCode === 0 ? merged.exitCode : one.exitCode,
            stdout: `${merged.stdout}\n${one.stdout}`,
            stderr: `${merged.stderr}\n${one.stderr}`,
          };
          if (one.timedOut || one.exitCode === null) break;
        }
        result = merged;
      }
    }
  } catch {
    return { kind: "allow", note: "typecheck could not run" };
  }
  if (result.timedOut) return { kind: "allow", note: `typecheck timed out after ${String(TSC_TIMEOUT_MS)} ms` };
  if (result.exitCode === null) return { kind: "allow", note: "typecheck ended without an exit code" };
  if (result.exitCode === 0) return { kind: "allow" };
  const diagnostics = `${result.stdout}\n${result.stderr}`
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(0, MAX_DIAGNOSTIC_LINES)
    .join("\n");
  return { kind: "block", ruleId: "typecheck", detail: capUtf8Bytes(runtime.redact(diagnostics), MAX_DIAGNOSTIC_BYTES) };
};
