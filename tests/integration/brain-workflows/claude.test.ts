import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env as processEnv } from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";

import { runJson } from "../../helpers/run-cli.js";
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
 * Spec §7.3: each workflow's rendered skill, loaded into a real Claude Code
 * through `--plugin-dir`, drives the built CLI against a disposable vault.
 * **Every case spends the founder's credits**, so `npm run test:vendor-brain`
 * runs it by hand and neither `test:suite` nor `check` does.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PLUGIN_DIR = join(ROOT, "plugins", "claude");
const CLI_ENTRY = join(ROOT, "apps", "cli", "dist", "bin.js");
const ROWS_FILE = join(tmpdir(), "brain-vendor-rows.json");
const VENDOR_TIMEOUT_MS = 300_000;

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
 * Resolved at module load: `it.skipIf` is evaluated while the suite is built,
 * before any hook (see `tests/integration/claude/plugin-loads.test.ts`).
 *
 * The key is handed in rather than found, because a disposable `HOME` carries
 * no Claude credentials (Plan decision 9, D47).
 */
const claude: string | null = await findClaude();
const apiKey = processEnv.DEVELOPER_OS_VENDOR_BRAIN_API_KEY ?? "";
const live = claude !== null && apiKey.length > 0;

const PROMPTS = {
  "brain-answer":
    "Use the developer-os-brain-answer skill. question: what do the brain commands do? file-back: true",
  "brain-report":
    "Use the developer-os-brain-report skill. subject: tools. file-back: true",
  "brain-compile": "Use the developer-os-brain-compile skill. topic: dev",
  "brain-enhance":
    "Use the developer-os-brain-enhance skill. note: DEV/example-knowledge-note.md",
  "brain-garden": "Use the developer-os-brain-garden skill. limit: 1",
} as const;

let sandbox: TempHome | null = null;
let claudeVersion = "";

function temporary(): TempHome {
  if (sandbox === null) {
    throw new Error(
      "the temporary HOME was not created; refusing to run against a real installation without one",
    );
  }
  return sandbox;
}

function vendorEnv(temp: TempHome): Record<string, string> {
  return {
    HOME: temp.home,
    DEVELOPER_OS_HOME: temp.productHome,
    DEVELOPER_OS_BRAIN: temp.brain,
    TMPDIR: temp.tempDir,
    PATH: `${temp.binDir}:${processEnv.PATH ?? "/usr/bin:/bin"}`,
    ANTHROPIC_API_KEY: apiKey,
  };
}

beforeAll(async () => {
  if (!live) return;
  sandbox = await createTempHome();
  const installed = await runJson(sandbox, ["init", "--yes", "--json"]);
  expect(installed.exitCode).toBe(EXIT_CODES.success);
  const indexed = await runJson(sandbox, ["brain", "reindex", "--json"]);
  expect(indexed.exitCode).toBe(EXIT_CODES.success);
  await writeFile(
    join(sandbox.binDir, "developer-os"),
    `#!/bin/sh\nexec '${process.execPath}' '${CLI_ENTRY}' "$@"\n`,
    { mode: 0o755 },
  );
  const { stdout } = await run(claude, ["--version"], {
    env: vendorEnv(sandbox),
    timeout: 30_000,
  });
  claudeVersion = stdout.trim();
}, 180_000);

afterAll(async () => {
  if (sandbox !== null) await removeTempHome(sandbox);
});

/** One compatibility-matrix row per passing case (spec §7.3), for Task 16. */
async function record(workflow: string, command: string): Promise<void> {
  const yaml = await readFile(
    join(ROOT, "workflows", workflow, "workflow.yaml"),
    "utf8",
  );
  const { stdout: head } = await run("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
  });
  let rows: unknown[] = [];
  try {
    rows = JSON.parse(await readFile(ROWS_FILE, "utf8")) as unknown[];
  } catch {
    rows = [];
  }
  rows.push({
    workflow,
    version: /^version: (.+)$/mu.exec(yaml)?.[1] ?? null,
    vendor: "claude",
    vendorVersion: claudeVersion,
    date: new Date().toISOString().slice(0, 10),
    commit: head.trim(),
    result: "pass",
    command,
  });
  await writeFile(ROWS_FILE, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

describe("the five brain workflows on a real Claude Code", () => {
  it.skipIf(!live).each(Object.entries(PROMPTS))(
    "%s loads and drives the CLI on a real Claude",
    async (id, prompt) => {
      const temp = temporary();
      const before = await inventory(temp.root);
      const args = [
        "--plugin-dir",
        PLUGIN_DIR,
        "-p",
        prompt,
        "--output-format",
        "json",
        "--allowedTools",
        "Read",
        "Bash(developer-os:*)",
      ];
      const { stdout } = await run(claude ?? "", args, {
        env: vendorEnv(temp),
        timeout: VENDOR_TIMEOUT_MS,
        killSignal: "SIGKILL",
        cwd: temp.root,
        maxBuffer: 32 * 1024 * 1024,
      });
      expect(stdout).toMatch(/(DEV|INFRA|PROJECTS|TOOLS)\/example-[a-z-]+\.md/u);

      // The vendor's own home state, the child's TMPDIR, and the product's
      // transaction bookkeeping are not the workflow's writes; the same
      // internal roots `tests/e2e/foundation.test.ts` exempts.
      const exempt = [
        temp.tempDir,
        join(temp.productHome, "state"),
        join(temp.productHome, "staging"),
        join(temp.productHome, "backups"),
        join(temp.productHome, "logs"),
      ];
      const added = addedPaths(before, await inventory(temp.root)).filter(
        (path) =>
          !path.startsWith(join(temp.home, ".claude")) &&
          !exempt.some((root) => isInside(root, path)),
      );
      expect(added.every((path) => path.includes("/content/_raw/quarantine/"))).toBe(true);
      // Every prompt asks for at most one capture.
      expect(added.length).toBeLessThanOrEqual(1);
      await record(id, ["claude", ...args].join(" "));
    },
    VENDOR_TIMEOUT_MS + 60_000,
  );

  it("reports whether it ran against a real installation", () => {
    if (!live) {
      expect(live).toBe(false);
      return;
    }
    expect(claude).toMatch(/claude$/u);
  });
});
