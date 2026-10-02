import { readFile, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { ProcessResult } from "@developer-os/security";

import { capUtf8Bytes } from "../outcome.js";
import { resolveProjectRoot } from "../project-root.js";
import type { HookVerbHandler } from "../registry.js";
import { HOOK_CHILD_ENV, isRegularFile, localBin, TSC_TIMEOUT_MS } from "./child.js";

const MAX_DIAGNOSTIC_LINES = 40;
const MAX_DIAGNOSTIC_BYTES = 1800;

/** Strip a BOM, JSONC comments and trailing commas; both passes skip string literals. */
function stripJsonc(text: string): string {
  const strings = String.raw`"(?:\\.|[^"\\])*"`;
  const noComments = text
    .replace(/^\uFEFF/u, "")
    .replace(new RegExp(`${strings}|//[^\\n]*|/\\*[\\s\\S]*?\\*/`, "gu"), (m) => (m.startsWith('"') ? m : " "));
  return noComments.replace(new RegExp(`${strings}|,(?=\\s*[\\]}])`, "gu"), (m) => (m === "," ? "" : m));
}

interface TsConfigShape {
  references?: unknown;
  compilerOptions?: { outDir?: unknown; tsBuildInfoFile?: unknown };
}

/** Parse a tsconfig as JSONC; throws when it is not an object. */
async function readConfig(config: string): Promise<TsConfigShape> {
  const parsed: unknown = JSON.parse(stripJsonc(await readFile(config, "utf8")));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("tsconfig is not an object");
  return parsed;
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Real tsconfig paths of the config's `references`, or "outside" when one is missing,
 * unresolvable or leaves the repo root (`tsc -b` would follow it). Throws on an unreadable config.
 */
async function referencedConfigs(config: string, root: string): Promise<string[] | "outside"> {
  const refs = (await readConfig(config)).references;
  if (!Array.isArray(refs)) return [];
  const out: string[] = [];
  for (const ref of refs) {
    const path = (ref as { path?: unknown } | null)?.path;
    if (typeof path !== "string" || path === "") continue;
    const abs = resolve(dirname(config), path);
    try {
      const real = await realpath(abs.endsWith(".json") ? abs : join(abs, "tsconfig.json"));
      if (!inside(root, real)) return "outside";
      out.push(real);
    } catch {
      return "outside";
    }
  }
  return out;
}

/** Build-info files tsc may write for these configs: default name, `tsBuildInfoFile`, and under `outDir`. */
async function buildInfoCandidates(configs: string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const config of configs) {
    const dir = dirname(config);
    const name = `${basename(config, ".json")}.tsbuildinfo`;
    found.add(join(dir, name));
    try {
      const { outDir, tsBuildInfoFile } = (await readConfig(config)).compilerOptions ?? {};
      if (typeof outDir === "string") found.add(resolve(dir, outDir, name));
      if (typeof tsBuildInfoFile === "string") found.add(resolve(dir, tsBuildInfoFile));
    } catch {
      // unreadable config: the default name is still covered
    }
  }
  return [...found].filter((path) => path.endsWith(".tsbuildinfo"));
}

/** Older tsc rejects `-b --noEmit` (TS5094, TS6310). */
const BUILD_REJECTED = /^error (TS5094|TS6310)\b/mu;

export const guardStop: HookVerbHandler = async (payload, runtime) => {
  if (payload.stopHookActive !== false) return { kind: "allow" };
  const root = await resolveProjectRoot(runtime.cwd);
  if (!(await isRegularFile(join(root, "tsconfig.json")))) return { kind: "allow" };
  const script = await localBin(root, "tsc");
  if (script === null) return { kind: "allow" };
  const checkConfig = join(root, "tsconfig.check.json");
  const config = (await isRegularFile(checkConfig)) ? checkConfig : join(root, "tsconfig.json");
  let refs: string[] | "outside";
  try {
    refs = await referencedConfigs(config, await realpath(root));
  } catch {
    return { kind: "allow", note: "typecheck skipped: tsconfig could not be read" };
  }
  if (refs === "outside") return { kind: "allow", note: "typecheck skipped: a tsconfig reference leaves the repo" };
  // A stop hook must leave the tree as it found it: remove only build-info files this run creates.
  const candidates = await buildInfoCandidates([config, ...refs]);
  const preexisting = new Set<string>();
  for (const path of candidates) if (await isRegularFile(path)) preexisting.add(path);
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
  } finally {
    for (const path of candidates) if (!preexisting.has(path)) await rm(path, { force: true });
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
