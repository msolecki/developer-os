import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  describeReleaseAuthorityProblems,
  inspectReleaseAuthoritySurfaces,
  RELEASE_NETWORK_ENTRYPOINTS,
  RELEASE_TRANSPORT_COMPOSITION,
} from "./check.js";
import { ALLOWED_SPAWN_SITES, ALLOWED_SUPERVISED_SITES, inspectOptInAuthoritySurfaces } from "./opt-in-authority.js";

const run = promisify(execFile);

/**
 * The compiled entry, exercised as the lint gate actually invokes it. The unit
 * tests cover the matcher; nothing covered the *enumerator* until a reviewer
 * found that it could skip a file — or every file — and still exit 0. That is
 * the same "passes by scanning nothing" failure the matcher's own tests exist to
 * prevent, one module over, so it gets the same treatment.
 */
const CHECK_ENTRY = fileURLToPath(new URL("../dist/repository/check.js", import.meta.url));

/**
 * The forbidden spellings, assembled rather than written out, so this file stays
 * *inside* the rule it tests.
 *
 * `self-containment.ts` and its unit tests are allowlisted because they cannot
 * express the patterns without containing them. This file can: it only needs the
 * strings in fixture *content*, never in its own source. Every allowlist entry is
 * a permanent hole in the rule, and the file that proves the enumerator works is
 * the last one that should be exempt from it.
 */
const VAULT_TILDE = ["~", "brain"].join("/");
const VAULT_ABSOLUTE = ["/Users/example", "brain"].join("/");

const sandboxes: string[] = [];

afterEach(async () => {
  while (sandboxes.length > 0) {
    const path = sandboxes.pop();
    if (path !== undefined) await rm(path, { recursive: true, force: true });
  }
});

interface CheckOutcome {
  readonly exitCode: number;
  readonly stderr: string;
}

/**
 * A throwaway git repository. The checker resolves its own root with
 * `git rev-parse --show-toplevel` from the working directory, which is what lets
 * this run it against a fixture instead of against the repository under test.
 */
/**
 * The planner-graph gate is total: a checkout without the compiled planner
 * entrypoint fails. Every fixture gets a clean one unless it says otherwise, so
 * the cases above keep testing only their own rule.
 */
const PLANNER_ENTRY = "packages/core/dist/update/planner.js";
/** The owner and migration planners every target planner bundle composes (Spec 2 §2). */
const PROVIDER_PLANNER_ENTRIES: readonly string[] = [
  "packages/adapter-claude/dist/update/plan.js",
  "packages/adapter-codex/dist/update/plan.js",
  "packages/brain/dist/migrations/update/plan.js",
];

/**
 * The opt-in authority gate is total the same way: a checkout in which no file constructs a
 * Git supervisor, names `/bin/launchctl` or dispatches scheduled handlers fails. These three
 * stand in for the real entrypoints unless a case says otherwise.
 */
const OPT_IN_SEEDS: Readonly<Record<string, string>> = {
  "apps/cli/src/git-entry.ts": "export const supervisor = new GitProcessSupervisor();\n",
  "apps/cli/src/launchd-entry.ts": 'export const LAUNCHCTL = "/bin/launchctl";\n',
  "apps/cli/src/scheduled-entry.ts": "export type Handlers = ScheduledJobHandlersV1;\n",
};

/**
 * The release authority gate is total too: the release transport, its one composition and the
 * launcher's exec stand in for the real modules unless a case says otherwise.
 */
const RELEASE_SEEDS: Readonly<Record<string, string>> = {
  "packages/security/src/update/transport.ts": 'import { request } from "node:https";\nexport const exchange = request;\n',
  "apps/cli/src/update/context.ts": "export const transport = (): unknown => nodeReleaseExchange;\n",
  "apps/launcher/src/main.ts": "export const launch = (): unknown => execAdmittedRelease();\n",
};

async function sandbox(
  files: Readonly<Record<string, string>>,
  options: { readonly stage?: boolean; readonly name?: string; readonly planner?: boolean; readonly optIn?: boolean; readonly release?: boolean } = {},
): Promise<string> {
  const root = await mkdtemp(join("/tmp", options.name ?? "dosSc"));
  sandboxes.push(root);

  await run("git", ["init", "-q"], { cwd: root });
  const planner = options.planner === false
    ? {}
    : Object.fromEntries([PLANNER_ENTRY, ...PROVIDER_PLANNER_ENTRIES].map((entry) => [entry, "export const planned = 1;\n"]));
  const optIn = options.optIn === false ? {} : OPT_IN_SEEDS;
  const release = options.release === false ? {} : RELEASE_SEEDS;
  for (const [path, content] of Object.entries({ ...planner, ...optIn, ...release, ...files })) {
    const full = join(root, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }
  if (options.stage !== false) {
    await run("git", ["add", "-A"], { cwd: root });
  }
  return root;
}

async function check(cwd: string): Promise<CheckOutcome> {
  try {
    const { stderr } = await run(process.execPath, [CHECK_ENTRY], { cwd });
    return { exitCode: 0, stderr };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string };
    return { exitCode: failure.code ?? -1, stderr: failure.stderr ?? "" };
  }
}

describe("the repository check gate", () => {
  it("passes a repository that names nothing forbidden", async () => {
    const root = await sandbox({
      "src/fine.ts": 'export const brainPath = "DeveloperBrain";\n',
      "docs/notes.md": "The Brain is the user's vault.\n",
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  it("fails, and names file and line, on a tracked violation", async () => {
    const root = await sandbox({
      "src/bad.ts": `const a = 1;\nexport const v = "${VAULT_ABSOLUTE}";\n`,
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("src/bad.ts:2");
  });

  /**
   * The bug this file was written for. `#` terminates a URL path, so splicing a
   * filename into a `file://` URL made `readFile` miss it — and the error was
   * swallowed, so the run reported success.
   */
  it("scans a file whose name would truncate a URL", async () => {
    const root = await sandbox({
      "src/issue#12.ts": `export const v = "${VAULT_TILDE}/x";\n`,
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("issue#12.ts");
  });

  /**
   * The same defect at the other end: when the *repository root* contained a
   * `#`, every `readFile` resolved to the wrong place, every file was skipped,
   * and the gate went green on a repository full of violations.
   */
  it("scans everything when the repository root would truncate a URL", async () => {
    const parent = await mkdtemp(join("/tmp", "dosHash"));
    sandboxes.push(parent);
    const root = join(parent, "re#po");
    await mkdir(root, { recursive: true });
    await run("git", ["init", "-q"], { cwd: root });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/bad.ts"), `const v = "${VAULT_TILDE}";\n`);
    await run("git", ["add", "-A"], { cwd: root });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("src/bad.ts");
  });

  it("scans a file that has been written but never staged", async () => {
    const root = await sandbox(
      { "src/new.ts": `export const v = "${VAULT_TILDE}/x";\n` },
      { stage: false },
    );

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("src/new.ts");
  });

  it("respects .gitignore, which is why git does the enumerating", async () => {
    const root = await sandbox({
      ".gitignore": "generated/\n",
      "generated/vendored.ts": `const v = "${VAULT_TILDE}";\n`,
    });

    expect((await check(root)).exitCode).toBe(0);
  });

  it("tolerates a file deleted from the tree but still in the index", async () => {
    const root = await sandbox({ "src/fine.ts": "export const a = 1;\n" });
    await rm(join(root, "src/fine.ts"));

    expect((await check(root)).exitCode).toBe(0);
  });

  it("ignores binary content rather than reading paths out of it", async () => {
    const root = await sandbox({
      "assets/blob.bin": `PNG${String.fromCharCode(0)}${VAULT_TILDE}\n`,
    });

    expect((await check(root)).exitCode).toBe(0);
  });

  it("fails when it cannot read a file at all, rather than skipping it", async () => {
    const root = await sandbox({ "src/secret.ts": "export const a = 1;\n" });
    await run("chmod", ["000", join(root, "src/secret.ts")]);

    const outcome = await check(root);

    try {
      expect(outcome.exitCode).toBe(1);
      expect(outcome.stderr).toContain("could not be read");
    } finally {
      await run("chmod", ["644", join(root, "src/secret.ts")]);
    }
  });

  it("fails, and names file and line, on an identity rendered through a number", async () => {
    const root = await sandbox({
      "src/record.ts": `const stats = await lstat(path);\nconst ino = String(stats.ino);\n`,
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("src/record.ts:2");
  });

  it("accepts the exact encoding, and the banned spelling in prose", async () => {
    const root = await sandbox({
      "src/record.ts":
        `// String(stats.ino) rounds above 2^53.\n` +
        `const message = "String(stats.dev)";\n` +
        `const ino = stats.ino.toString(10);\n`,
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  /**
   * The three shapes the rendering rule cannot see. Each is as lossy as the
   * banned spelling and compiles clean, so the stat call itself is what has to
   * fail.
   */
  it.each([
    { name: "an exact-looking rendering of a number", body: "const ino = stats.ino.toString(10);" },
    { name: "template interpolation", body: "const key = `${stats.dev}:${stats.ino}`;" },
    { name: "destructuring", body: "const { dev, ino } = stats;" },
  ])("fails on a number-valued stat behind $name", async ({ body }) => {
    const root = await sandbox({
      "src/record.ts": `const stats = await nodeFs.lstat(path);\n${body}\n`,
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("src/record.ts:1");
  });

  it("accepts the same module once the stat asks for bigint fields", async () => {
    const root = await sandbox({
      "src/record.ts":
        "const stats = await nodeFs.lstat(path, { bigint: true });\n" +
        "const key = `${stats.dev}:${stats.ino}`;\n",
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  it("leaves a module that records no identity alone", async () => {
    const root = await sandbox({
      "src/read.ts": `const stats = await nodeFs.lstat(path);\nexport const big = stats.size > 10;\n`,
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  it("accepts a call that states why it must stay on number-valued stats", async () => {
    const root = await sandbox({
      "src/record.ts":
        `// identity-free stat: mtimeMs's fraction, never dev/ino.\n` +
        `const stats = await nodeFs.stat(path);\n` +
        `export const when = stats.mtimeMs;\nexport const ino = other.ino;\n`,
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  /**
   * The one path exemption the bigint rule needs, exercised so that removing it
   * breaks a test rather than silently widening the rule: this port's `lstat`
   * takes a path and nothing else.
   */
  it("exempts the lifecycle guarded port's own callers", async () => {
    const root = await sandbox({
      "packages/core/src/lifecycle/allocator.ts":
        `const entry = await fs.lstat(path);\nexport const ino = entry.ino;\n`,
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  /**
   * NEW-90: the exemption covers the port's receiver, not the whole file. A
   * direct `node:fs` stat inside an exempted module renders exactly like the
   * approved encoder, so only the stat call can fail it.
   */
  /**
   * The update ports module also holds `context.fs`, the CLI's own filesystem, whose receiver is
   * spelled `fs` too; there only the lifecycle port's `lifecycle.fs` is exempt.
   */
  it("exempts only the lifecycle port's receiver in the update ports module", async () => {
    const root = await sandbox({
      "apps/cli/src/update/apply-ports.ts":
        `const entry = await lifecycle.fs.lstat(path);\n` +
        `const stats = await context.fs.lstat(path);\n` +
        `export const ino = [entry.ino, stats.ino];\n`,
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("apps/cli/src/update/apply-ports.ts:2");
    expect(outcome.stderr).not.toContain("apps/cli/src/update/apply-ports.ts:1");
  });

  it("fails on a direct number-valued stat inside a guarded port caller", async () => {
    const root = await sandbox({
      "packages/core/src/lifecycle/allocator.ts":
        `const entry = await fs.lstat(path);\n` +
        `const stats = await nodeFs.lstat(path);\n` +
        `export const ino = parseUInt64Decimal(stats.ino.toString(10));\n`,
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("packages/core/src/lifecycle/allocator.ts:2");
    expect(outcome.stderr).not.toContain("packages/core/src/lifecycle/allocator.ts:1");
  });

  /** NEW-119: the exemption keys on the receiver's name, so `fs` may only ever be the guarded port. */
  it.each([
    { name: "a namespace import", source: 'import * as fs from "node:fs";' },
    { name: "a default import", source: 'import fs from "node:fs";' },
    { name: "a named import from node:fs/promises", source: 'import {\n  lstat,\n  promises as fs,\n} from "node:fs/promises";' },
    { name: "a bare fs specifier", source: "import fs, { constants } from 'fs';" },
  ])("fails when a guarded port caller binds node:fs to fs through $name", async ({ source }) => {
    const root = await sandbox({
      "packages/core/src/lifecycle/allocator.ts":
        `${source}\nconst entry = await fs.lstat(path);\nexport const ino = entry.ino;\n`,
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("packages/core/src/lifecycle/allocator.ts:1");
  });

  it("accepts a guarded port caller whose fs is the port and whose node:fs has another name", async () => {
    const root = await sandbox({
      "packages/core/src/lifecycle/allocator.ts":
        'import * as nodeFs from "node:fs/promises";\n' +
        'import { constants, lstat as fsLstat } from "node:fs";\n' +
        "export async function allocate(fs: LifecycleGuardedFs): Promise<string> {\n" +
        "  const entry = await fs.lstat(path);\n" +
        "  const stats = await nodeFs.lstat(path, { bigint: true });\n" +
        "  return `${entry.ino}:${stats.ino}:${String(constants.O_RDONLY)}:${typeof fsLstat}`;\n" +
        "}\n",
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  it("fails when the compiled planner entrypoint is missing", async () => {
    const root = await sandbox({ "src/fine.ts": "export const a = 1;\n" }, { planner: false });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("planner-graph");
    expect(outcome.stderr).toContain(PLANNER_ENTRY);
  });

  it.each([
    { name: "an environment read", source: "export const home = process.env.HOME;\n", capability: "environment" },
    { name: "a filesystem import", source: 'import { readFileSync } from "node:fs";\nexport const read = readFileSync;\n', capability: "filesystem" },
    { name: "a clock read", source: "export const now = Date.now();\n", capability: "clock" },
    { name: "a dynamic import", source: 'export const later = import("./later.js");\n', capability: "dynamic_import" },
  ])("fails, and names the module, on $name in the planner graph", async ({ source, capability }) => {
    const root = await sandbox({ [PLANNER_ENTRY]: source });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`${PLANNER_ENTRY}: ${capability}`);
  });

  it.each(PROVIDER_PLANNER_ENTRIES)("fails on a filesystem import in the %s provider planner graph", async (entry) => {
    const root = await sandbox({ [entry]: 'import { readFileSync } from "node:fs";\nexport const read = readFileSync;\n' });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`${entry}: ${entry}: filesystem`);
  });

  it("follows the planner graph transitively", async () => {
    const root = await sandbox({
      [PLANNER_ENTRY]: 'export { value } from "./helper.js";\n',
      "packages/core/dist/update/helper.js": "export const value = Math.random();\n",
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("packages/core/dist/update/helper.js: randomness");
  });

  it("fails, and names the file and symbol, on a spawn outside every entrypoint and the allowlist", async () => {
    const root = await sandbox({
      "packages/core/src/stray.ts": 'import { execFile } from "node:child_process";\nexport function probe(): void {\n  execFile("/usr/bin/true");\n}\n',
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("opt-in-authority");
    expect(outcome.stderr).toContain("unexpected spawn site: packages/core/src/stray.ts::probe");
  });

  it.each([
    { name: "a namespace import", source: 'import * as cp from "child_process";\nexport const go = () => cp.spawn("x");\n', symbol: "go" },
    { name: "an aliased import handed to promisify", source: 'import { promisify } from "node:util";\nimport { execFile as run } from "node:child_process";\nexport const exec = promisify(run);\n', symbol: "exec" },
    { name: "a dynamic load", source: 'export async function later(): Promise<unknown> {\n  return import("node:child_process");\n}\n', symbol: "later (dynamic child_process load)" },
    { name: "the supervised primitive's real dependencies", source: "export const runner = new SupervisedProcessRunner(nodeSupervisedProcessDependencies);\n", symbol: "runner (nodeSupervisedProcessDependencies)" },
  ])("resolves $name through its binding and reports it", async ({ source, symbol }) => {
    const root = await sandbox({ "apps/cli/src/stray.ts": source });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`unexpected spawn site: apps/cli/src/stray.ts::${symbol}`);
  });

  it("does not read a regex exec, an injected dependency's spawn or a type-only import as a spawn", async () => {
    const root = await sandbox({
      "packages/core/src/benign.ts": [
        'import type { ChildProcess } from "node:child_process";',
        'import { type SpawnOptions } from "node:child_process";',
        "export const match = /x/u.exec(\"x\");",
        "export function start(dependencies: { spawn(): ChildProcess }, options: SpawnOptions): ChildProcess {",
        "  void options;",
        "  return dependencies.spawn();",
        "}",
        "",
      ].join("\n"),
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  it("classifies the supervised primitive's dependencies inside a Git or launchd entrypoint", async () => {
    const root = await sandbox({
      "apps/cli/src/git-entry.ts":
        "export const supervisor = new GitProcessSupervisor(new SupervisedProcessRunner(nodeSupervisedProcessDependencies));\n",
      "apps/cli/src/launchd-entry.ts":
        'export const LAUNCHCTL = "/bin/launchctl";\nexport const runner = new SupervisedProcessRunner(nodeSupervisedProcessDependencies);\n',
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  it("keeps a raw spawn in a Git entrypoint unexpected unless its symbol is allowlisted", async () => {
    const root = await sandbox({
      "apps/cli/src/git-entry.ts": [
        'import { spawn } from "node:child_process";',
        "export const supervisor = new GitProcessSupervisor();",
        'export function bypass(): void {\n  spawn("/usr/bin/git");\n}',
        "",
      ].join("\n"),
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("unexpected spawn site: apps/cli/src/git-entry.ts::bypass");
  });

  it("accepts an allowlisted spawn at its exact file and symbol", async () => {
    const root = await sandbox({
      "packages/security/src/process.ts":
        'import { spawn } from "node:child_process";\nexport class NodeProcessRunner {\n  run(): void {\n    spawn("/usr/bin/true");\n  }\n}\n',
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  it("keeps a raw spawn unexpected at a site allowlisted only for the supervised primitive", async () => {
    const root = await sandbox({
      "apps/cli/src/update/apply-ports.ts": 'import { spawn } from "node:child_process";\nexport function codexRuntime(): void {\n  spawn("/usr/bin/true");\n}\n',
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("unexpected spawn site: apps/cli/src/update/apply-ports.ts::codexRuntime");
  });

  it("accepts the supervised primitive at its allowlisted site", async () => {
    const root = await sandbox({
      "apps/cli/src/update/apply-ports.ts": "export function codexRuntime(): unknown {\n  return new SupervisedProcessRunner(nodeSupervisedProcessDependencies);\n}\n",
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  it("keeps the supervised primitive unexpected at a site allowlisted only for a raw spawn", async () => {
    const root = await sandbox({
      "packages/security/src/process.ts": "export class NodeProcessRunner {\n  run(): unknown {\n    return new SupervisedProcessRunner(nodeSupervisedProcessDependencies);\n  }\n}\n",
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("unexpected spawn site: packages/security/src/process.ts::NodeProcessRunner (nodeSupervisedProcessDependencies)");
  });

  it.each([
    { removed: "apps/cli/src/git-entry.ts", problem: "no file constructs a GitProcessSupervisor" },
    { removed: "apps/cli/src/launchd-entry.ts", problem: "no file names /bin/launchctl" },
    { removed: "apps/cli/src/scheduled-entry.ts", problem: "no file dispatches ScheduledJobHandlersV1" },
  ])("fails when an enumerator is empty: $problem", async ({ removed, problem }) => {
    const seeds = Object.fromEntries(Object.entries(OPT_IN_SEEDS).filter(([path]) => path !== removed));
    const root = await sandbox(seeds, { optIn: false });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(problem);
  });

  it.each([
    { removed: "packages/security/src/update/transport.ts", problem: "no module reaches the release transport's network" },
    { removed: "apps/cli/src/update/context.ts", problem: "no module composes the release transport" },
    { removed: "apps/launcher/src/main.ts", problem: "no launcher module execs an admitted release" },
  ])("fails when a release authority scope is empty: $problem", async ({ removed, problem }) => {
    const seeds = Object.fromEntries(Object.entries(RELEASE_SEEDS).filter(([path]) => path !== removed));
    const root = await sandbox(seeds, { release: false });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("release-authority");
    expect(outcome.stderr).toContain(problem);
  });

  it.each([
    { name: "a global fetch", path: "packages/core/src/stray-fetch.ts", source: "export const load = (url: string): unknown => fetch(url);\n" },
    { name: "globalThis.fetch", path: "packages/core/src/stray-global-this.ts", source: "export const load = (url: string): unknown => globalThis.fetch(url);\n" },
    { name: "self.fetch", path: "packages/core/src/stray-self.ts", source: "export const load = (url: string): unknown => self.fetch(url);\n" },
    { name: "window.fetch", path: "packages/core/src/stray-window.ts", source: "export const load = (url: string): unknown => window.fetch (url);\n" },
    { name: "fetch.call", path: "packages/core/src/stray-call.ts", source: "export const load = (url: string): unknown => fetch.call(globalThis, url);\n" },
    { name: "fetch.apply", path: "packages/core/src/stray-apply.ts", source: "export const load = (url: string): unknown => fetch . apply(globalThis, [url]);\n" },
    { name: "globalThis?.fetch", path: "packages/core/src/stray-optional.ts", source: "export const load = (url: string): unknown => globalThis?.fetch(url);\n" },
    { name: "self?.fetch", path: "packages/core/src/stray-optional-self.ts", source: "export const load = (url: string): unknown => self?.fetch(url);\n" },
    { name: "window?.fetch", path: "packages/core/src/stray-optional-window.ts", source: "export const load = (url: string): unknown => window?.fetch?.(url);\n" },
    { name: "an https import", path: "apps/cli/src/commands/stray-https.ts", source: 'import { get } from "node:https";\nexport const probe = get;\n' },
    { name: "a dynamic tls import", path: "apps/cli/src/stray-tls.ts", source: 'export const later = (): unknown => import("node:tls");\n' },
  ])("fails, and names the module, on $name outside the release transport", async ({ path, source }) => {
    const root = await sandbox({ [path]: source });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`unexpected network entrypoint: ${path}`);
  });

  it("fails when a command other than update composes the release transport", async () => {
    const root = await sandbox({ "apps/cli/src/commands/doctor-network.ts": "export const probe = (): unknown => new FixedReleaseTransport();\n" });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("unexpected release transport composition: apps/cli/src/commands/doctor-network.ts");
  });

  it("does not read the composer's name in a comment or a string as a composition", async () => {
    const root = await sandbox({ "apps/cli/src/commands/notes.ts": '// nodeReleaseExchange is update-only\nexport const label = "FixedReleaseTransport";\n' });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  it("fails outside a git checkout instead of finding nothing", async () => {
    const root = await mkdtemp(join("/tmp", "dosNoGit"));
    sandboxes.push(root);

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("git checkout");
  });
});

describe("the opt-in authority surfaces of this repository", () => {
  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

  it("asserts every authority enumerator is non-empty and there is no stray spawn site", async () => {
    const report = await inspectOptInAuthoritySurfaces(repositoryRoot);
    expect(report.gitEntrypoints.length).toBeGreaterThan(0);
    expect(report.launchdEntrypoints.length).toBeGreaterThan(0);
    expect(report.scheduledEntrypoints.length).toBeGreaterThan(0);
    expect(report.unexpectedSpawnSites).toEqual([]);
  });

  it("observes every allowlisted spawn site, so the allowlist cannot outlive the code it names", async () => {
    expect(ALLOWED_SPAWN_SITES.length).toBeGreaterThan(0);
    expect(ALLOWED_SUPERVISED_SITES.length).toBeGreaterThan(0);
    const report = await inspectOptInAuthoritySurfaces(repositoryRoot);
    expect(report.allowedSpawnSites).toStrictEqual([...ALLOWED_SPAWN_SITES, ...ALLOWED_SUPERVISED_SITES].sort());
  });

  it("finds the Git supervisor composition, the launchd adapters and the scheduled runner", async () => {
    const report = await inspectOptInAuthoritySurfaces(repositoryRoot);
    expect(report.gitEntrypoints).toContain("apps/cli/src/commands/git/runtime.ts");
    expect(report.launchdEntrypoints).toContain("apps/cli/src/lifecycle/adapters.ts");
    expect(report.scheduledEntrypoints).toContain("apps/cli/src/commands/automation/runner.ts");
  });
});

describe("the release authority surfaces of this repository (Spec 2 §12, D72 P7(f))", () => {
  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

  it("enumerates every network, launcher and planner-graph scope non-empty", async () => {
    const report = await inspectReleaseAuthoritySurfaces(repositoryRoot);
    expect(report.networkEntrypoints.length).toBeGreaterThan(0);
    expect(report.transportCompositions.length).toBeGreaterThan(0);
    expect(report.launcherEntrypoints.length).toBeGreaterThan(0);
    expect(report.plannerGraphs.length).toBeGreaterThan(0);
    expect(report.plannerGraphs.every((graph) => graph.modules.length > 0)).toBe(true);
    expect(describeReleaseAuthorityProblems(report)).toEqual([]);
  });

  it("finds the network in exactly the release transport, composed only by the update context", async () => {
    const report = await inspectReleaseAuthoritySurfaces(repositoryRoot);
    expect(report.networkEntrypoints).toStrictEqual([...RELEASE_NETWORK_ENTRYPOINTS]);
    expect(report.transportCompositions).toStrictEqual([...RELEASE_TRANSPORT_COMPOSITION]);
  });

  it("finds the launcher's exec and each planner entrypoint in its own graph", async () => {
    const report = await inspectReleaseAuthoritySurfaces(repositoryRoot);
    expect(report.launcherEntrypoints).toEqual(expect.arrayContaining(["apps/launcher/src/handoff.ts", "apps/launcher/src/main.ts"]));
    for (const graph of report.plannerGraphs) expect(graph.modules).toContain(graph.entrypoint);
  });
});
