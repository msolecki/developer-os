import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { CliResult } from "@developer-os/core";

import type { TempHome } from "./temp-home.js";

/**
 * The compiled binary, not the source. These tests exist to prove that what
 * `pnpm build` produces behaves correctly at the process boundary; running the
 * TypeScript directly would prove something else.
 */
const CLI_ENTRY = fileURLToPath(
  new URL("../../apps/cli/dist/bin.js", import.meta.url),
);

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * A closed port. Every outbound protocol Node reads from the environment points
 * here, so a command that reaches the network fails loudly instead of quietly
 * succeeding against whatever the host happens to be able to reach.
 */
const DEAD_PROXY = "http://127.0.0.1:1";

/** Variables a caller may override but never remove. See `environmentFor`. */
const SEALED = new Set(["HOME", "PATH", "TMPDIR"]);

export interface CliRun {
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface RunOptions {
  /** Merged over the sealed base. A key set to `undefined` is removed. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdin?: string;
  readonly timeoutMs?: number;
  readonly cwd?: string;
}

/**
 * The complete environment of the child. Nothing is inherited: an inherited
 * `HOME`, `PATH`, or `DEVELOPER_OS_*` would point the run at the developer's
 * real machine, which is the one outcome these tests exist to make impossible.
 */
function environmentFor(
  home: TempHome,
  overrides: Readonly<Record<string, string | undefined>> = {},
): NodeJS.ProcessEnv {
  const base: Record<string, string> = {
    HOME: home.home,
    DEVELOPER_OS_HOME: home.productHome,
    DEVELOPER_OS_BRAIN: home.brain,
    PATH: home.binDir,
    TMPDIR: home.tempDir,
    HTTP_PROXY: DEAD_PROXY,
    HTTPS_PROXY: DEAD_PROXY,
    ALL_PROXY: DEAD_PROXY,
    http_proxy: DEAD_PROXY,
    https_proxy: DEAD_PROXY,
    all_proxy: DEAD_PROXY,
    NO_PROXY: "",
    no_proxy: "",
    NODE_USE_ENV_PROXY: "1",
  };

  const resolved = new Map(Object.entries(base));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      /**
       * These three are what confine the run to the sandbox. Removing `HOME` in
       * particular would leave `bin.ts`'s "HOME is not set" guard as the only
       * thing between `os.homedir()`'s `getpwuid` fallback and the developer's
       * real home — and this helper exists to make that unreachable, not merely
       * unlikely.
       */
      if (SEALED.has(key)) {
        throw new Error(`${key} may not be removed from the sandbox environment`);
      }
      resolved.delete(key);
      continue;
    }
    resolved.set(key, value);
  }
  return Object.fromEntries(resolved);
}

async function assertBinaryBuilt(): Promise<void> {
  try {
    await access(CLI_ENTRY);
  } catch {
    throw new Error(
      `${CLI_ENTRY} does not exist. Run \`pnpm build\` before the end-to-end suite.`,
    );
  }
}

/**
 * Runs the compiled CLI as a real process with no shell, so argv reaches the
 * binary verbatim and nothing a test writes can be reinterpreted as a command.
 *
 * `stdin` is a closed pipe by default. That is not incidental: with no TTY the
 * CLI's `confirm` declines without asking, which is exactly the unattended
 * behaviour the confirmation cases assert.
 */
export async function runCli(
  home: TempHome,
  args: readonly string[],
  options: RunOptions = {},
): Promise<CliRun> {
  await assertBinaryBuilt();

  return new Promise<CliRun>((resolve, reject) => {
    /**
     * `detached` so the child leads its own process group. On timeout the group
     * is signalled, not just the child: the CLI spawns `/usr/bin/lockf` and
     * `/usr/bin/which`, and a surviving `lockf` would hold a lock on a file
     * inside the sandbox that cleanup is about to remove.
     */
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
      cwd: options.cwd ?? home.root,
      env: environmentFor(home, options.env),
      shell: false,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid === undefined) throw new Error("no pid");
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The group is already gone, or was never created. Fall back to the
        // child alone rather than leaving the run hanging.
        child.kill("SIGKILL");
      }
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        signal,
        stdout,
        stderr,
        timedOut,
      });
    });

    child.stdin.on("error", () => {
      // A command that exits before reading stdin closes the pipe. That is a
      // normal outcome here, not a failure of the run.
    });
    child.stdin.end(options.stdin ?? "");
  });
}

/**
 * Parses the single line `--json` promises. The strictness is the point: a
 * second line on stdout would mean the CLI printed something a machine consumer
 * cannot parse, and silently taking the first line would hide it.
 */
export function parseJsonResult<T>(run: CliRun): CliResult<T> {
  const lines = run.stdout.split("\n").filter((line) => line.length > 0);
  const [line] = lines;

  if (lines.length !== 1 || line === undefined) {
    throw new Error(
      `expected exactly one line of JSON on stdout, got ${String(lines.length)}.\n` +
        `stdout: ${JSON.stringify(run.stdout)}\nstderr: ${JSON.stringify(run.stderr)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    throw new Error(`stdout was not valid JSON: ${JSON.stringify(line)}`);
  }
  return parsed as CliResult<T>;
}

export type JsonRun<T> = CliRun & { readonly result: CliResult<T> };

export async function runJson<T>(
  home: TempHome,
  args: readonly string[],
  options: RunOptions = {},
): Promise<JsonRun<T>> {
  const run = await runCli(home, args, options);
  if (run.timedOut) {
    throw new Error(`developer-os ${args.join(" ")} timed out`);
  }
  return { ...run, result: parseJsonResult<T>(run) };
}
