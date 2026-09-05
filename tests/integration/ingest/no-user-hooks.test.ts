import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { env as processEnv } from "node:process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invokeClaude } from "@developer-os/adapter-claude";
import type { ClaudeInvocation } from "@developer-os/adapter-claude";
import type {
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "@developer-os/security";
import {
  addedPaths,
  createTempHome,
  inventory,
  removeTempHome,
} from "../../helpers/temp-home.js";
import type { TempHome } from "../../helpers/temp-home.js";

const run = promisify(execFile);

/**
 * Resolved once, from `PATH`, in the parent — same reasoning as
 * `plugin-loads.test.ts`: a machine without Claude Code must still pass
 * `npm run check`, and a test that fails there converts "not installed" into
 * "broken".
 */
async function findClaude(): Promise<string | null> {
  try {
    const { stdout } = await run("/usr/bin/which", ["claude"]);
    const path = stdout.trim();
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/**
 * Resolved at module load, not in `beforeAll` — `it.skipIf(...)` runs while
 * the suite is being constructed, before any hook. See
 * `plugin-loads.test.ts` for the failure mode this avoids.
 */
const claude: string | null = await findClaude();

let temp: TempHome | null = null;

beforeAll(async () => {
  if (claude === null) return;
  temp = await createTempHome();
}, 120_000);

afterAll(async () => {
  if (temp !== null) await removeTempHome(temp);
});

function temporary(): TempHome {
  if (temp === null) {
    throw new Error(
      "the temporary HOME was not created; refusing to run against a real installation without one",
    );
  }
  return temp;
}

/**
 * The parent's `PATH`, not a fixed one — see `plugin-loads.test.ts`'s
 * `isolatedEnv` for why (`node`-shebang distributions break under a fixed
 * `PATH`). `HOME` and `TMPDIR` stay pinned to the sandbox.
 *
 * `ANTHROPIC_BASE_URL` points at a loopback port nothing listens on and
 * `ANTHROPIC_API_KEY` is obviously fake: the one request this process could
 * make to complete a model turn fails at connection time, before it leaves
 * the machine, which is what lets a real vendor session start — and fire its
 * startup hooks — without ever reaching a model or spending anything.
 */
function invocationEnv(home: TempHome): Record<string, string> {
  return {
    HOME: home.home,
    PATH: processEnv.PATH ?? "/usr/bin:/bin",
    TMPDIR: home.tempDir,
    ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
    ANTHROPIC_API_KEY: "sk-ant-test-do-not-use-00000000000000000000000000000000",
  };
}

const VENDOR_TIMEOUT_MS = 15_000;

/**
 * A `ProcessRunner` that never spawns anything: it records the request
 * `invokeClaude` built and resolves immediately with a synthetic result.
 * `invokeClaude` never sees the difference between this and a real spawn, so
 * the argv it hands the runner is the same argv it would hand `child_process`
 * in production.
 */
function capturingRunner(): {
  runner: ProcessRunner;
  seen: () => ProcessRequest | null;
} {
  let request: ProcessRequest | null = null;
  return {
    seen: () => request,
    runner: {
      run(incoming: ProcessRequest): Promise<ProcessResult> {
        request = incoming;
        return Promise.resolve({
          stdout: "",
          stderr: "",
          exitCode: 0,
          signal: null,
          timedOut: false,
        });
      },
    },
  };
}

/**
 * The argv `packages/adapter-claude/src/invoke.ts` builds today, derived by
 * actually calling `invokeClaude` against `capturingRunner` rather than
 * hand-copied as a literal (I5): a flag dropped from the shipped invocation —
 * `--restricted` included — changes what this function returns, which fails
 * every case built on it, instead of leaving a stale literal that still
 * exercises a flag list the product no longer sends. `installation` is
 * synthetic because nothing here spawns it; only the argv `invokeClaude`
 * assembles is read back.
 */
async function isolatedArgs(): Promise<readonly string[]> {
  const { runner, seen } = capturingRunner();
  const invocation: ClaudeInvocation = {
    prompt: "ping",
    maxTurns: 1,
    timeoutMs: VENDOR_TIMEOUT_MS,
  };
  await invokeClaude(
    { executable: "/opt/synthetic/bin/claude", version: "0.0.0" },
    invocation,
    { runner },
  );
  const args = seen()?.args;
  if (args === undefined) {
    throw new Error("invokeClaude did not reach the runner; no argv to derive");
  }
  return args;
}

/** The isolated argv with exactly the two flags under test removed. */
async function controlArgs(): Promise<readonly string[]> {
  return (await isolatedArgs()).filter(
    (arg) => arg !== "--restricted" && arg !== "--safe-mode",
  );
}

/**
 * Plants a `SessionStart` hook the way the installed Claude Code (2.1.261)
 * actually loads user hooks: `~/.claude/settings.json`, with the
 * matcher-plus-hooks-array shape the binary's own settings-validator error
 * message documents verbatim (`claude --help`'s `--tools` neighbour text
 * does not cover hooks, but the invalid-settings tip embedded in the binary
 * does — `docs/architecture/vendor-invocation.md`). `--restricted` is
 * documented to ignore exactly this file (row 18: "ignores user, project and
 * local settings files"), which is the mechanism this test exercises.
 */
async function plantSessionStartHook(
  home: TempHome,
  sentinelPath: string,
): Promise<void> {
  const settingsPath = join(home.home, ".claude", "settings.json");
  await mkdir(dirname(settingsPath), { recursive: true });
  const settings = {
    hooks: {
      SessionStart: [
        {
          matcher: "",
          hooks: [{ type: "command", command: `touch '${sentinelPath}'` }],
        },
      ],
    },
  };
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

/**
 * SIGKILL, not the default SIGTERM: manual verification against this
 * exact argv showed the process still running — with open outbound
 * connections — many seconds after the `SessionStart` hook had already
 * fired, so the harness needs a hard bound rather than a cooperative one.
 * A non-zero exit or a timeout kill is the expected outcome here, per the
 * unreachable `ANTHROPIC_BASE_URL` above: an exit 0 would mean a request
 * completed, which must never happen, so it is treated as a failure of the
 * harness's own safety assumption rather than swallowed.
 */
async function runVendorExpectingLocalFailure(
  executable: string,
  args: readonly string[],
  env: Record<string, string>,
): Promise<void> {
  let succeeded = false;
  try {
    await run(executable, [...args], {
      env,
      timeout: VENDOR_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    succeeded = true;
  } catch {
    // Expected: no request this process makes can succeed against the fake
    // credentials `invocationEnv` sets.
  }
  if (succeeded) {
    throw new Error(
      "the vendor invocation exited 0 against an unreachable ANTHROPIC_BASE_URL: " +
        "this harness's safety assumption does not hold and must not be trusted",
    );
  }
}

/**
 * **Observed, not assumed: three runs of the isolated argv against a genuinely fresh
 * `createTempHome()` — a home no other case in this file had touched — each wrote exactly
 * these eight paths under `HOME`, with only a pid, a session-key hash and a backup
 * timestamp varying between runs:**
 *
 * ```text
 * .claude
 * .claude.json
 * .claude/.last-cleanup
 * .claude/backups
 * .claude/backups/.claude.json.backup.<epoch-ms>
 * .claude/sessions
 * .claude/sessions/<pid>.<sha256-hex>.key
 * .claude/sessions/<pid>.json
 * ```
 *
 * **These are the vendor's own writes, not ours to suppress, and this list bounds the
 * blast radius of an isolated invocation — it does not claim the run writes nothing.**
 * `.claude.json` and a new timestamped entry under `.claude/backups/` land durably on
 * every run, despite nothing here asking Claude Code to persist anything; the two files
 * under `.claude/sessions/` land despite `--no-session-persistence`'s own help text
 * claiming sessions "will not be saved to disk" (the SIGKILL `runVendorExpectingLocalFailure`
 * sends catches them before the vendor's own cleanup removes them). A path outside this set
 * — in particular a sentinel a hook could plant anywhere else under `HOME` — is what the
 * assertion below refuses.
 */
const ENTITLED_CLAUDE_WRITES: readonly RegExp[] = [
  /^\.claude$/u,
  /^\.claude\.json$/u,
  /^\.claude\/\.last-cleanup$/u,
  /^\.claude\/backups$/u,
  /^\.claude\/backups\/\.claude\.json\.backup\.\d+$/u,
  /^\.claude\/sessions$/u,
  /^\.claude\/sessions\/\d+\.[0-9a-f]{64}\.key$/u,
  /^\.claude\/sessions\/\d+\.json$/u,
];

/** `path` relative to `home.home`, matched against the observed set above. */
function isEntitledClaudeWrite(home: TempHome, path: string): boolean {
  const prefix = `${home.home}/`;
  if (!path.startsWith(prefix)) return false;
  const relative = path.slice(prefix.length);
  return ENTITLED_CLAUDE_WRITES.some((pattern) => pattern.test(relative));
}

describe("a planted user hook against a real Claude Code installation", () => {
  /**
   * The positive control this whole file exists to require. Without it, the
   * negative assertion below would pass just as well against a hook that was
   * never wired up correctly — the unfalsifiable-assertion defect this
   * repository has already had to fix once (brief, Task 8).
   */
  it.skipIf(claude === null)(
    "fires the planted SessionStart hook when the isolation flags are absent",
    async () => {
      const home = temporary();
      const sentinel = join(home.home, "sentinel-control");
      await plantSessionStartHook(home, sentinel);

      await runVendorExpectingLocalFailure(
        claude ?? "",
        await controlArgs(),
        invocationEnv(home),
      );

      const after = await inventory(home.root);
      expect(after.has(sentinel)).toBe(true);
    },
    120_000,
  );

  it.skipIf(claude === null)(
    "never runs the planted user hook during an isolated ingest invocation",
    async () => {
      /**
       * **A home of its own, not the describe block's shared `temporary()`.** The
       * positive control above plants `.claude/settings.json` and its own sentinel in
       * the shared home; running against that same home here would let its writes
       * (`.claude.json`, `.claude/backups/`, `.claude/.last-cleanup`) already exist
       * before this case's own "before" snapshot, so they would never register as
       * added regardless of test order — the defect a fresh-context re-review found
       * (I1, round 2). A dedicated `createTempHome()` makes this case's before/after
       * bracket only its own run, independent of which sibling ran first or whether
       * it ran at all.
       */
      const home = await createTempHome();
      try {
        const sentinel = join(home.home, "sentinel-isolated");
        await plantSessionStartHook(home, sentinel);
        const before = await inventory(home.root);

        await runVendorExpectingLocalFailure(
          claude ?? "",
          await isolatedArgs(),
          invocationEnv(home),
        );

        const after = await inventory(home.root);
        expect(after.has(sentinel)).toBe(false);

        /**
         * **The property the plan asked for is "nothing was written outside the
         * paths this run is entitled to write", not "nothing was written outside
         * the sandbox"** — `added` is already computed from `inventory(home.root)`,
         * whose walk only ever records paths beneath the root it is given
         * (`tests/helpers/temp-home.ts`'s `walk`), so `isInside(home.root, path)`
         * over `added` could not fail regardless of what the invocation wrote (I1).
         * `isEntitledClaudeWrite` above is the entitled set, established by observing
         * this exact argv against a fresh home three times; anything outside it —
         * in particular a sentinel a hook could plant anywhere else under `HOME` —
         * fails the assertion below.
         */
        const added = addedPaths(before, after);
        const outside = added.filter((path) => !isEntitledClaudeWrite(home, path));
        expect(outside).toStrictEqual([]);
      } finally {
        await removeTempHome(home);
      }
    },
    120_000,
  );

  /**
   * The skip is itself a result worth reporting — see
   * `plugin-loads.test.ts`'s identical case.
   */
  it("reports whether it ran against a real installation", () => {
    if (claude === null) {
      expect(claude).toBeNull();
      return;
    }
    expect(claude).toMatch(/claude$/u);
  });
});
