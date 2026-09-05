import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { env as processEnv } from "node:process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addedPaths,
  createTempHome,
  inventory,
  isInside,
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

/**
 * The exact fixed flags `packages/adapter-claude/src/invoke.ts` builds today
 * (its `-p`/prompt and `--max-turns` value are literals here since this test
 * calls the binary directly, not through `invokeClaude`).
 */
function isolatedArgs(): readonly string[] {
  return [
    "-p",
    "ping",
    "--output-format",
    "json",
    "--max-turns",
    "1",
    "--tools",
    "",
    "--strict-mcp-config",
    "--restricted",
    "--safe-mode",
    "--no-session-persistence",
    "--permission-prompts",
    "none",
  ];
}

/** The isolated argv with exactly the two flags under test removed. */
function controlArgs(): readonly string[] {
  return isolatedArgs().filter(
    (arg) => arg !== "--restricted" && arg !== "--safe-mode",
  );
}

const VENDOR_TIMEOUT_MS = 15_000;

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
        controlArgs(),
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
      const home = temporary();
      const sentinel = join(home.home, "sentinel-isolated");
      await plantSessionStartHook(home, sentinel);
      const before = await inventory(home.root);

      await runVendorExpectingLocalFailure(
        claude ?? "",
        isolatedArgs(),
        invocationEnv(home),
      );

      const after = await inventory(home.root);
      expect(after.has(sentinel)).toBe(false);

      const added = addedPaths(before, after);
      expect(added.every((path) => isInside(home.root, path))).toBe(true);
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
