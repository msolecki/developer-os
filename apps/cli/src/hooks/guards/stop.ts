import { lstat, readdir, readFile, realpath, rm, rmdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

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

/** Workspace globs from `pnpm-workspace.yaml` (`packages:` list) and `package.json` `workspaces`. */
async function workspaceGlobs(root: string): Promise<string[]> {
  const globs: string[] = [];
  try {
    let inPackages = false;
    for (const line of (await readFile(join(root, "pnpm-workspace.yaml"), "utf8")).split("\n")) {
      if (/^packages:\s*$/u.test(line)) inPackages = true;
      else if (/^\S/u.test(line)) inPackages = false;
      else if (inPackages) {
        const item = /^\s+-\s+["']?([^"'#\s]+)["']?/u.exec(line)?.[1];
        if (item !== undefined) globs.push(item);
      }
    }
  } catch {
    // no pnpm workspace
  }
  try {
    const { workspaces } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { workspaces?: unknown };
    const list = Array.isArray(workspaces) ? workspaces : (workspaces as { packages?: unknown } | undefined)?.packages;
    if (Array.isArray(list)) for (const item of list) if (typeof item === "string") globs.push(item);
  } catch {
    // no package.json workspaces
  }
  return globs;
}

/**
 * NEW-245: the `tsconfig.json` of each workspace package inside the repo root, sorted. A glob is
 * `dir` or `dir/*`; negations and deeper patterns are skipped.
 * ponytail: no `**`, brace or YAML flow-list (`packages: [a/*]`) globs, and a symlinked package directory
 * is skipped; a workspace declared only that way falls back to the root config.
 */
async function workspaceConfigs(root: string, realRoot: string): Promise<string[]> {
  const dirs = new Set<string>();
  for (const glob of await workspaceGlobs(root)) {
    const clean = glob.replace(/^\.\//u, "").replace(/\/$/u, "");
    if (clean.startsWith("!") || clean === "") continue;
    if (!clean.includes("*")) dirs.add(join(root, clean));
    else if (clean.endsWith("/*") && !clean.slice(0, -2).includes("*")) {
      try {
        const parent = join(root, clean.slice(0, -2));
        for (const entry of await readdir(parent, { withFileTypes: true })) {
          if (entry.isDirectory()) dirs.add(join(parent, entry.name));
        }
      } catch {
        // missing parent: nothing to check
      }
    }
  }
  const configs: string[] = [];
  for (const dir of dirs) {
    const config = join(dir, "tsconfig.json");
    try {
      if ((await isRegularFile(config)) && inside(realRoot, await realpath(config))) configs.push(config);
    } catch {
      // unresolvable: skipped
    }
  }
  return configs.sort();
}

const exists = (path: string) => lstat(path).then(() => true, () => false);

/**
 * tsc rejects `-b --noEmit` (TS5094 on older versions; TS6310 "may not disable emit" for a composite
 * reference, through 5.9), bare or with a `file(line,col): ` prefix.
 */
const BUILD_REJECTED = /(?:^|\): )error (TS5094|TS6310)\b/mu;
/** Every diagnostic code in tsc output, with or without a `file(line,col): ` prefix. */
const DIAGNOSTIC_CODE = /\berror (TS\d+)\b/gu;
const OK_RESULT: ProcessResult = { stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false };
/** Codes that mean "no real check ran": `-b --noEmit` rejected, stale (TS6310) or unbuilt (TS6305) references. */
const STALE_CODES = new Set(["TS5094", "TS6305", "TS6310"]);

function mergeResults(a: ProcessResult, b: ProcessResult): ProcessResult {
  return {
    ...b,
    exitCode: b.exitCode === 0 ? a.exitCode : b.exitCode,
    stdout: `${a.stdout}\n${b.stdout}`,
    stderr: `${a.stderr}\n${b.stderr}`,
  };
}

export const guardStop: HookVerbHandler = async (payload, runtime) => {
  if (payload.stopHookActive !== false) return { kind: "allow" };
  const root = await resolveProjectRoot(runtime.cwd);
  const rootScript = await localBin(root, "tsc");
  const realRoot = await realpath(root);
  const checkConfig = join(root, "tsconfig.check.json");
  const rootConfig = join(root, "tsconfig.json");
  const hasRootConfig = await isRegularFile(rootConfig);
  const config = (await isRegularFile(checkConfig)) ? checkConfig : rootConfig;
  let refs: string[] | "outside" = [];
  if (hasRootConfig) {
    try {
      refs = await referencedConfigs(config, realRoot);
    } catch {
      return { kind: "allow", note: "typecheck skipped: tsconfig could not be read" };
    }
    if (refs === "outside") return { kind: "allow", note: "typecheck skipped: a tsconfig reference leaves the repo" };
  }
  // NEW-245: without a check config or a solution, a workspace is checked per package, as its scripts do;
  // a root config that only globs package sources lacks their jsx, libs and types.
  const packages = config === checkConfig || refs.length > 0 ? [] : await workspaceConfigs(root, realRoot);
  if (rootScript === null || (packages.length === 0 && !hasRootConfig)) return { kind: "allow" };
  // Every target is a config with its references, checked one way: a package that is only `references`
  // (Vite's default) is still checked, and an unbuilt composite sibling is no error.
  const targets: { config: string; refs: string[] }[] = packages.length === 0 ? [{ config, refs }] : [];
  let skipped = 0;
  for (const pkg of packages) {
    try {
      const pkgRefs = await referencedConfigs(pkg, realRoot);
      if (pkgRefs === "outside") skipped++;
      else targets.push({ config: pkg, refs: pkgRefs });
    } catch {
      skipped++;
    }
  }
  // A stop hook must leave the tree as it found it: remove only build-info files, and the directories
  // holding them, that this run creates.
  // `-b` also writes build info for indirect references, so the walk follows them all.
  const configs = new Set(targets.flatMap((t) => [t.config, ...t.refs]));
  for (const seen of configs) {
    try {
      const nested = await referencedConfigs(seen, realRoot);
      if (nested !== "outside") for (const ref of nested) configs.add(ref);
    } catch {
      // unreadable: its own candidates are still covered
    }
  }
  const candidates = await buildInfoCandidates([...configs], realRoot);
  // Each candidate and its missing parent directories, up to the first that exists.
  const preexisting = new Set<string>();
  for (const path of candidates) {
    if (await exists(path)) preexisting.add(path);
    for (let dir = dirname(path); dir !== dirname(dir); dir = dirname(dir)) {
      if (await exists(dir)) {
        preexisting.add(dir);
        break;
      }
    }
  }
  let cleanupFailed = false;
  const deadline = Date.now() + TSC_TIMEOUT_MS;
  // Colour codes (`"pretty": true` in a tsconfig) would hide every diagnostic code from the matchers.
  const run = async (args: string[]): Promise<ProcessResult> => {
    const result = await runtime.runner.run({
      executable: runtime.nodeExecutable,
      args: [rootScript, ...args],
      cwd: root,
      stdin: "",
      timeoutMs: Math.max(1, deadline - Date.now()),
      env: HOOK_CHILD_ENV,
    });
    return { ...result, stdout: stripVTControlCharacters(result.stdout), stderr: stripVTControlCharacters(result.stderr) };
  };
  /** `-b --noEmit` for a solution; when tsc rejects it, each reference and then the config itself with `-p`. */
  const check = async (target: { config: string; refs: string[] }): Promise<ProcessResult | "stale"> => {
    if (target.refs.length === 0) return run(["--noEmit", "-p", target.config]);
    const built = await run(["-b", "--noEmit", target.config]);
    if (built.exitCode === 0 || built.timedOut || !BUILD_REJECTED.test(`${built.stdout}\n${built.stderr}`)) return built;
    let merged: ProcessResult = { ...built, exitCode: 0, stdout: "", stderr: "" };
    // A reference that itself references stale or unbuilt projects fails -p the same way: no real check ran.
    // Any failing ref without a TS code, or with any other code, is a real failure and still blocks.
    let onlyStale = true;
    for (const ref of [...target.refs, target.config]) {
      const one = await run(["--noEmit", "-p", ref]);
      if (one.timedOut || one.exitCode === null) {
        // Real errors found so far still block; stale or unbuilt noise does not outweigh a timeout.
        if (merged.exitCode !== 0 && !onlyStale) break;
        return one;
      }
      if (one.exitCode !== 0) {
        const codes = [...`${one.stdout}\n${one.stderr}`.matchAll(DIAGNOSTIC_CODE)].map((m) => m[1]);
        if (codes.length === 0 || codes.some((c) => c === undefined || !STALE_CODES.has(c))) onlyStale = false;
      }
      merged = mergeResults(merged, one);
    }
    return onlyStale && merged.exitCode !== 0 && !merged.timedOut ? "stale" : merged;
  };
  let result: ProcessResult = { ...OK_RESULT };
  let stale = false;
  try {
    for (const target of targets) {
      const one = await check(target);
      if (one === "stale") {
        stale = true;
        continue;
      }
      // A later timeout must not hide an earlier package's real errors.
      if ((one.timedOut || one.exitCode === null) && result.exitCode !== 0) break;
      result = mergeResults(result, one);
      if (one.timedOut || one.exitCode === null) break;
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
      // Only directories this run created, and only once empty: rmdir refuses anything else.
      for (let dir = dirname(path); !preexisting.has(dir) && dir !== dirname(dir); dir = dirname(dir)) {
        if (!(await rmdir(dir).then(() => true, () => false))) break;
      }
    }
  }
  if (result.exitCode === 0 && !result.timedOut) {
    if (stale) return { kind: "allow", note: "typecheck could not run: referenced projects are stale or unbuilt (TS6305, TS6310); run tsc -b" };
    if (skipped > 0) return { kind: "allow", note: `typecheck skipped ${String(skipped)} package(s): a tsconfig could not be read or leaves the repo` };
  }
  if (result.timedOut) return { kind: "allow", note: `typecheck timed out after ${String(TSC_TIMEOUT_MS)} ms` };
  if (result.exitCode === null) return { kind: "allow", note: "typecheck ended without an exit code" };
  if (result.exitCode === 0) {
    return cleanupFailed ? { kind: "allow", note: "build-info cleanup failed" } : { kind: "allow" };
  }
  // NEW-246: an absolute path under the project is shortened first, or the high-entropy screen eats it.
  const diagnostics = `${result.stdout}\n${result.stderr}`
    .replaceAll(`${realRoot}/`, "")
    .replaceAll(`${resolve(root)}/`, "")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(0, MAX_DIAGNOSTIC_LINES)
    .join("\n");
  return { kind: "block", ruleId: "typecheck", detail: capUtf8Bytes(runtime.redact(diagnostics), MAX_DIAGNOSTIC_BYTES) };
};
