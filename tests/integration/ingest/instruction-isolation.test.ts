import { execFile, spawn } from "node:child_process";
import * as nodeFs from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { env as processEnv } from "node:process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  invokeClaude,
  renderClaudeVendorTree,
  renderInstructionTree as renderClaudeInstructions,
} from "@developer-os/adapter-claude";
import {
  invokeCodex,
  proposeCodexInstall,
  renderCodexVendorTree,
  renderInstructionTree as renderCodexInstructions,
} from "@developer-os/adapter-codex";
import {
  INSTRUCTION_BLOCK_BEGIN,
  INSTRUCTION_BLOCK_END,
  insertInstructionBlock,
  renderInstructionBlock,
} from "@developer-os/core";
import { prepareCodexIngestHome, sweepCodexIngestHome } from "@developer-os/cli/dist/commands/ingest.js";
import type { CliContext } from "@developer-os/cli/dist/context.js";
import type { ProcessRequest, ProcessRunner } from "@developer-os/security";
import { createTempHome, removeTempHome } from "../../helpers/temp-home.js";
import type { TempHome } from "../../helpers/temp-home.js";
import {
  loadDefaultInstructionSources,
  loadRepositoryWorkflows,
} from "../../contracts/adapters/claude/render-all.js";

/**
 * NEW-65 / D8 (A12's "ingest stays isolated" gate, codex-adapter.md §15): with every default instruction installed in a
 * disposable home, each vendor's **ingest argv** yields a model request carrying neither block
 * marker nor any managed file's text. A failure here stops the phase: D8 outranks A12.
 *
 * Method, per vendor (Task 2, pinned in the adapter notes):
 * - Claude (claude-adapter.md §14): `ANTHROPIC_BASE_URL` points at a loopback listener in this
 *   process that records request bodies and answers 500. Nothing leaves the machine.
 * - Codex (codex-adapter.md §15): a dead `model_providers` entry on `127.0.0.1:9` and
 *   `RUST_LOG=codex_http_client=trace`; the trace logs each request body the model would receive.
 *   The ingest `CODEX_HOME` is the product's own D52 home, prepared by `prepareCodexIngestHome`.
 *
 * Every negative has a positive control in the same file: the same install, observed through the
 * same capture, with the isolation removed, must carry the managed text.
 *
 * **Founder caveats, not claims.** (1) Both product vendors spawn without `HOME` (Claude `USER`/`LOGNAME` only,
 * Codex `CODEX_HOME` alone), so they resolve the real home; this file pins a disposable `HOME`,
 * which is not the product's exact environment (the D52 note's caveat, and NEW-103 for Claude).
 * (2) `codex exec` contacts github.com and chatgpt.com at startup for plugin sync (§15); nothing is
 * billed, but a network-denying sandbox is what the adapter note ran under. Real-vendor runs are
 * founder-only (Task 21 Step 4).
 */

const run = promisify(execFile);

async function find(name: string): Promise<string | null> {
  try {
    const { stdout } = await run("/usr/bin/which", [name]);
    const path = stdout.trim();
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/** Resolved at module load: `it.skipIf` is evaluated before any hook (see `plugin-loads.test.ts`). */
const claude: string | null = await find("claude");
const codex: string | null = await find("codex");

const PROMPT = "A12 isolation probe 5e2b: reply with an empty object.";
const RUN_TIMEOUT_MS = 30_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function put(path: string, contents: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

/** The argv an adapter builds, read back from a runner that never spawns. */
function capturingRunner(): { runner: ProcessRunner; seen: () => ProcessRequest } {
  let request: ProcessRequest | null = null;
  return {
    seen: () => {
      if (request === null) throw new Error("the adapter did not reach the runner; no argv to derive");
      return request;
    },
    runner: {
      run(incoming) {
        request = incoming;
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false });
      },
    },
  };
}

/** Every string in a JSON request body, joined: the model-visible text with escaping undone. */
function strings(body: string): string {
  const texts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") texts.push(value);
    else if (typeof value === "object" && value !== null) Object.values(value).forEach(walk);
  };
  walk(JSON.parse(body));
  return texts.join("\n");
}

/**
 * One distinctive line per managed file, its longest non-blank one. Single lines, because a
 * multi-line needle would depend on how each vendor serialises newlines.
 */
function needlesOf(files: readonly { readonly path: string; readonly contents: string }[]): Map<string, string> {
  const needles = new Map<string, string>();
  for (const file of files) {
    const [line] = file.contents
      .split("\n")
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate.length >= 20)
      .sort((left, right) => right.length - left.length);
    if (line !== undefined) needles.set(file.path, line);
  }
  return needles;
}

function leaks(text: string, needles: ReadonlyMap<string, string>): string[] {
  return [...needles].filter(([, needle]) => text.includes(needle)).map(([label]) => label);
}

function requireHome(home: TempHome | null): TempHome {
  if (home === null) throw new Error("the temporary HOME was not created; refusing to run a vendor without one");
  return home;
}

// ---------------------------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------------------------

interface ClaudeInstall {
  readonly needles: ReadonlyMap<string, string>;
  /** Rules load at session start; each one's needle must reach an unisolated request. */
  readonly ruleNeedles: ReadonlyMap<string, string>;
  readonly importLine: string;
}

/** `foundation.md` §12.5 layout: the plugin, `rules/`, `output-styles/`, the imports, and the `CLAUDE.md` block. */
async function installClaude(home: TempHome): Promise<ClaudeInstall> {
  const workflows = await loadRepositoryWorkflows();
  const { defaults, none } = await loadDefaultInstructionSources("claude", workflows);
  const render = renderClaudeInstructions(defaults, none, home.productHome);
  const claudeDir = join(home.home, ".claude");
  const plugin = renderClaudeVendorTree(workflows, render).map((artifact) => ({
    path: join(claudeDir, "skills", "developer-os", artifact.path),
    contents: artifact.contents,
  }));
  const imports = render.importFiles.map((file) => ({
    path: join(home.productHome, "claude", "instructions", file.path),
    contents: file.contents,
  }));
  const homeFiles = render.homeFiles.map((file) => ({
    path: join(claudeDir, file.target, file.path),
    contents: file.contents,
  }));
  for (const file of [...plugin, ...imports, ...homeFiles]) await put(file.path, file.contents);
  const block = renderInstructionBlock({ productHome: home.productHome, vendor: "claude", body: render.block.body });
  await put(join(claudeDir, "CLAUDE.md"), insertInstructionBlock(encoder.encode("A user line outside the block.\n"), block));

  expect(imports.length).toBeGreaterThan(0);
  const needles = needlesOf([...plugin, ...imports, ...homeFiles]);
  needles.set("begin marker", INSTRUCTION_BLOCK_BEGIN);
  needles.set("end marker", INSTRUCTION_BLOCK_END);
  for (const artifact of render.pluginFiles) {
    const skill = /^skills\/([^/]+)\/SKILL\.md$/u.exec(artifact.path)?.[1];
    if (skill !== undefined) needles.set(`skill ${skill}`, `developer-os:${skill}`);
  }
  return {
    needles,
    ruleNeedles: needlesOf(imports),
    importLine: `@${home.productHome}/claude/instructions/`,
  };
}

async function claudeIngestArgs(): Promise<readonly string[]> {
  const { runner, seen } = capturingRunner();
  await invokeClaude(
    { executable: "/opt/synthetic/bin/claude", version: "0.0.0" },
    { prompt: PROMPT, maxTurns: 1, timeoutMs: RUN_TIMEOUT_MS },
    { runner },
  );
  return seen().args;
}

/**
 * Runs Claude against a loopback listener and returns the text of every request body. The child
 * is killed once a body carrying the prompt arrives, or at the timeout.
 */
async function captureClaude(home: TempHome, args: readonly string[]): Promise<string[]> {
  const bodies: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => {
      if (body.length > 0) {
        // A body that is not JSON is kept raw rather than thrown inside the listener.
        try {
          bodies.push(strings(body));
        } catch {
          bodies.push(body);
        }
      }
      response.writeHead(500, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const work = join(home.home, "work");
  await mkdir(work, { recursive: true });
  const child = spawn(claude ?? "", [...args], {
    cwd: work,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      HOME: home.home,
      PATH: processEnv.PATH ?? "/usr/bin:/bin",
      TMPDIR: home.tempDir,
      XDG_CONFIG_HOME: join(home.home, ".config"),
      CODEX_HOME: join(home.home, ".codex"),
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${String(port)}`,
      ANTHROPIC_API_KEY: "sk-ant-test-do-not-use-00000000000000000000000000000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_TELEMETRY: "1",
      DISABLE_AUTOUPDATER: "1",
    },
  });
  try {
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    while (Date.now() < deadline && !bodies.some((body) => body.includes(PROMPT))) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } finally {
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
  return bodies;
}

describe("Claude ingest against the installed instructions (D8)", () => {
  it.skipIf(claude === null)(
    "carries the imported rules into the request when the isolation flags are absent",
    async () => {
      let home: TempHome | null = null;
      try {
        home = await createTempHome();
        const install = await installClaude(home);
        const control = (await claudeIngestArgs()).filter(
          (arg) => arg !== "--restricted" && arg !== "--safe-mode",
        );
        const text = (await captureClaude(requireHome(home), control)).join("\n");
        expect(text, "no request carried the prompt; the capture itself failed").toContain(PROMPT);
        expect(text).toContain(install.importLine);
        expect(leaks(text, install.ruleNeedles).length).toBe(install.ruleNeedles.size);
      } finally {
        if (home !== null) await removeTempHome(home);
      }
    },
    120_000,
  );

  it.skipIf(claude === null)(
    "keeps every managed instruction out of the request under the ingest argv",
    async () => {
      let home: TempHome | null = null;
      try {
        home = await createTempHome();
        const install = await installClaude(home);
        const text = (await captureClaude(requireHome(home), await claudeIngestArgs())).join("\n");
        expect(text, "no request carried the prompt; the capture itself failed").toContain(PROMPT);
        expect(text).not.toContain(install.importLine);
        expect(leaks(text, install.needles)).toStrictEqual([]);
      } finally {
        if (home !== null) await removeTempHome(home);
      }
    },
    120_000,
  );

  it("reports whether it ran against a real installation", () => {
    if (claude === null) {
      expect(claude).toBeNull();
      return;
    }
    expect(claude).toMatch(/claude$/u);
  });
});

// ---------------------------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------------------------

interface CodexInstall {
  readonly userCodexHome: string;
  readonly needles: ReadonlyMap<string, string>;
  readonly roles: readonly string[];
}

function codexEnv(home: TempHome, codexHome: string): Record<string, string> {
  return {
    HOME: home.home,
    PATH: processEnv.PATH ?? "/usr/bin:/bin",
    TMPDIR: home.tempDir,
    XDG_CONFIG_HOME: join(home.home, ".config"),
    CODEX_HOME: codexHome,
  };
}

/**
 * `foundation.md` §12.5 layout in the user's `C = H/.codex`: the marketplace tree under the product home,
 * registered through the vendor CLI, `C/agents/*.toml`, and the `C/AGENTS.md` block.
 */
async function installCodex(home: TempHome): Promise<CodexInstall> {
  const userCodexHome = join(home.home, ".codex");
  await mkdir(userCodexHome, { recursive: true, mode: 0o700 });
  const workflows = await loadRepositoryWorkflows();
  const { defaults, none } = await loadDefaultInstructionSources("codex", workflows);
  const render = renderCodexInstructions(defaults, none);
  const tree = renderCodexVendorTree(workflows, render, { home: home.productHome });
  const proposal = proposeCodexInstall(tree, { home: home.productHome, productVersion: "0.0.0" });
  const written: { path: string; contents: string }[] = [];
  tree.forEach((artifact, index) => {
    const target = proposal.operations[index]?.targetPath;
    if (target?.endsWith(`/${artifact.path}`) !== true) {
      throw new Error(`proposeCodexInstall is not index-aligned with the tree at ${artifact.path}`);
    }
    written.push({ path: target, contents: artifact.contents });
  });
  for (const agent of render.agentFiles) {
    written.push({ path: join(userCodexHome, agent.path), contents: agent.contents });
  }
  for (const file of written) await put(file.path, file.contents);
  const block = decoder.decode(
    renderInstructionBlock({ productHome: home.productHome, vendor: "codex", body: render.block.body }),
  );
  await put(join(userCodexHome, "AGENTS.md"), `A user line outside the block.\n${block}`);
  for (const step of proposal.registration) {
    await run(codex ?? "", [...step.args], {
      env: codexEnv(home, userCodexHome),
      cwd: home.root,
      timeout: 60_000,
    });
  }

  const roles = render.agentFiles.map((agent) => `developer-os-${agent.id}`);
  expect(roles.length).toBeGreaterThan(0);
  expect(render.block.members.length).toBeGreaterThan(0);
  const needles = needlesOf([...written, { path: "AGENTS.md block", contents: block }]);
  needles.set("begin marker", INSTRUCTION_BLOCK_BEGIN);
  needles.set("end marker", INSTRUCTION_BLOCK_END);
  for (const role of roles) needles.set(`role ${role}`, role);
  for (const artifact of render.pluginFiles) {
    const skill = /^plugins\/developer-os\/skills\/([^/]+)\/SKILL\.md$/u.exec(artifact.path)?.[1];
    if (skill !== undefined) needles.set(`skill ${skill}`, `developer-os:${skill}`);
  }
  return { userCodexHome, needles, roles };
}

/** Just enough of `CliContext` for `prepareCodexIngestHome`: paths, env, user home, and `fs`. */
function ingestContext(home: TempHome, userCodexHome: string): CliContext {
  return {
    paths: { home: home.productHome },
    env: { CODEX_HOME: userCodexHome },
    userHome: home.home,
    fs: nodeFs,
  } as unknown as CliContext;
}

const TRACE_PREFIX = "POST to http://127.0.0.1:9/v1/responses: ";

/**
 * The ingest invocation `invokeCodex` builds for this `CODEX_HOME`, run with the §15 dead provider
 * spliced in before the trailing prompt, killed at the timeout. Returns each traced request body.
 */
async function captureCodex(home: TempHome, codexHome: string): Promise<string[]> {
  const work = join(home.home, "work");
  const schema = join(home.home, "schema.json");
  await mkdir(work, { recursive: true });
  await writeFile(schema, '{"type":"object","properties":{},"additionalProperties":false}\n');
  const { runner, seen } = capturingRunner();
  await invokeCodex(
    { executable: "/opt/synthetic/bin/codex", version: "0.0.0" },
    { prompt: PROMPT, workingRoot: work, writeScopes: [], outputSchemaPath: schema, timeoutMs: RUN_TIMEOUT_MS, codexHome },
    { runner },
  );
  const request = seen();
  expect(request.env).toStrictEqual({ CODEX_HOME: codexHome });
  const args = [...request.args];
  const prompt = args.pop();
  expect(prompt).toBe(PROMPT);
  args.push(
    "-c",
    "model_provider=a12probe",
    "-c",
    'model_providers.a12probe={name="a12probe",base_url="http://127.0.0.1:9/v1",wire_api="responses",env_key="OPENAI_API_KEY"}',
    PROMPT,
  );

  let output = "";
  try {
    const pending = run(codex ?? "", args, {
      cwd: work,
      env: {
        ...codexEnv(home, codexHome),
        OPENAI_API_KEY: "sk-test-do-not-use-0000000000000000",
        RUST_LOG: "codex_http_client=trace",
      },
      timeout: RUN_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 256 * 1024 * 1024,
    });
    // Codex 0.155.1 blocks on "Reading additional input from stdin..." until EOF, as `invoke.ts`
    // records; an open pipe here meant no request was ever sent (observed 2026-09-26).
    pending.child.stdin?.end();
    const result = await pending;
    output = `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    // Expected: nothing listens on the provider port, so the run ends at the timeout.
    const failure = error as { stdout?: string; stderr?: string };
    output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
  }
  return output
    .split("\n")
    .flatMap((line) => {
      const at = line.indexOf(TRACE_PREFIX);
      return at === -1 ? [] : [strings(line.slice(at + TRACE_PREFIX.length))];
    });
}

describe("Codex ingest against the installed instructions (D8, D52)", () => {
  it.skipIf(codex === null)(
    "carries the AGENTS.md block and the agent roles into the request from the user's own CODEX_HOME",
    async () => {
      let home: TempHome | null = null;
      try {
        home = await createTempHome();
        const install = await installCodex(home);
        const bodies = await captureCodex(requireHome(home), install.userCodexHome);
        expect(bodies.length, "no request body was traced; the capture itself failed").toBeGreaterThan(0);
        const text = bodies.join("\n");
        expect(text).toContain(INSTRUCTION_BLOCK_BEGIN);
        for (const role of install.roles) expect(text, `role ${role}`).toContain(role);
      } finally {
        if (home !== null) await removeTempHome(home);
      }
    },
    180_000,
  );

  it.skipIf(codex === null)(
    "keeps every managed instruction out of the request under the ingest CODEX_HOME",
    async () => {
      let home: TempHome | null = null;
      try {
        home = await createTempHome();
        const install = await installCodex(home);
        await mkdir(join(home.productHome, "state"), { recursive: true, mode: 0o700 });
        const context = ingestContext(home, install.userCodexHome);
        const codexHome = await prepareCodexIngestHome(context);
        expect(codexHome.startsWith(`${home.productHome}/`)).toBe(true);
        let bodies: string[];
        try {
          bodies = await captureCodex(requireHome(home), codexHome);
        } finally {
          await sweepCodexIngestHome(context, codexHome);
        }
        expect(bodies.length, "no request body was traced; the capture itself failed").toBeGreaterThan(0);
        expect(leaks(bodies.join("\n"), install.needles)).toStrictEqual([]);
      } finally {
        if (home !== null) await removeTempHome(home);
      }
    },
    180_000,
  );

  it("reports whether it ran against a real installation", () => {
    if (codex === null) {
      expect(codex).toBeNull();
      return;
    }
    expect(codex).toMatch(/codex$/u);
  });
});
