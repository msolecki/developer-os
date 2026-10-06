import { lstat, readFile, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { containsPath } from "@developer-os/core";
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
  return resolve(root) !== resolve(path) && containsPath(root, path);
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

/** outDir / tsBuildInfoFile of a config, following relative `extends` chains (package extends: given up silently). */
async function buildOptions(config: string): Promise<{ outDir?: string; tsBuildInfoFile?: string }> {
  const found: { outDir?: string; tsBuildInfoFile?: string } = {};
  let current = config;
  for (let depth = 0; depth < 10; depth++) {
    const parsed = await readConfig(current);
    const dir = dirname(current);
    const { outDir, tsBuildInfoFile } = parsed.compilerOptions ?? {};
    if (found.outDir === undefined && typeof outDir === "string") found.outDir = resolve(dir, outDir);
    if (found.tsBuildInfoFile === undefined && typeof tsBuildInfoFile === "string") found.tsBuildInfoFile = resolve(dir, tsBuildInfoFile);
    const ext = (parsed as { extends?: unknown }).extends;
    if (typeof ext !== "string" || !ext.startsWith(".")) break;
    current = resolve(dir, ext.endsWith(".json") ? ext : `${ext}.json`);
  }
  return found;
}

/** Real location of a path that may not exist yet: the nearest existing ancestor, realpath'd, plus the rest. */
async function realish(path: string): Promise<string> {
  const rest: string[] = [];
  for (let cur = path; ; cur = dirname(cur)) {
    try {
      return join(await realpath(cur), ...rest);
    } catch {
      if (dirname(cur) === cur) throw new Error("no existing ancestor");
      rest.unshift(basename(cur));
    }
  }
}

/** Build-info files tsc may write for these configs (default name, `tsBuildInfoFile`, under `outDir`), inside `root` only. */
async function buildInfoCandidates(configs: string[], root: string): Promise<string[]> {
  const found = new Set<string>();
  for (const config of configs) {
    const name = `${basename(config, ".json")}.tsbuildinfo`;
    found.add(join(dirname(config), name));
    try {
      const { outDir, tsBuildInfoFile } = await buildOptions(config);
      if (outDir !== undefined) found.add(join(outDir, name));
      if (tsBuildInfoFile !== undefined) found.add(tsBuildInfoFile);
    } catch {
      // unreadable config: the default name is still covered
    }
  }
  const kept: string[] = [];
  for (const path of found) {
    try {
      if (path.endsWith(".tsbuildinfo") && inside(root, await realish(path))) kept.push(path);
    } catch {
      // unresolvable: not a candidate
    }
  }
  return kept;
}

const exists = (path: string) => lstat(path).then(() => true, () => false);

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
  const realRoot = await realpath(root);
  const candidates = await buildInfoCandidates([config, ...refs], realRoot);
  const preexisting = new Set<string>();
  for (const path of candidates) if (await exists(path)) preexisting.add(path);
  let cleanupFailed = false;
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
    for (const path of candidates) {
      if (preexisting.has(path)) continue;
      try {
        if ((await lstat(path)).isFile() && inside(realRoot, await realish(path))) await rm(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleanupFailed = true;
      }
    }
  }
  if (result.timedOut) return { kind: "allow", note: `typecheck timed out after ${String(TSC_TIMEOUT_MS)} ms` };
  if (result.exitCode === null) return { kind: "allow", note: "typecheck ended without an exit code" };
  if (result.exitCode === 0) {
    return cleanupFailed ? { kind: "allow", note: "build-info cleanup failed" } : { kind: "allow" };
  }
  const diagnostics = `${result.stdout}\n${result.stderr}`
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(0, MAX_DIAGNOSTIC_LINES)
    .join("\n");
  return { kind: "block", ruleId: "typecheck", detail: capUtf8Bytes(runtime.redact(diagnostics), MAX_DIAGNOSTIC_BYTES) };
};
