import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import type { CliResult } from "@developer-os/core";
import type { BrainReindexResultV1 } from "@developer-os/cli/dist/commands/brain.js";
import type { IngestResultV1 } from "@developer-os/cli/dist/commands/ingest.js";
import type { InitResultV1 } from "@developer-os/cli/dist/commands/init.js";
import type { ReviewResultV1 } from "@developer-os/cli/dist/commands/review.js";

import { runJson } from "../../helpers/run-cli.js";
import type { JsonRun } from "../../helpers/run-cli.js";
import {
  createTempHome,
  installFakeExecutable,
  isInside,
} from "../../helpers/temp-home.js";
import type { TempHome } from "../../helpers/temp-home.js";

/**
 * A sandbox that runs `brain` subcommands is never named `home` here: the
 * self-containment rule flags that name within forty characters of a quoted
 * vault segment. `tests/e2e/brain.test.ts` records the full reasoning.
 */

/** Vitest runs the `.ts` sources in place, three levels below the root. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const PROPOSAL_FIXTURE = join(ROOT, "tests/fixtures/knowledge/ingest-proposal.json");
const CAPTURE_ID_PLACEHOLDER = "__CAPTURE_ID__";
const VENDOR_VERSION = "9999.0.0";

export interface SkillStep {
  readonly id: string;
  readonly verb: string | null;
  readonly command: string | null;
}

export function okData<T>(result: CliResult<T>): T {
  if (!result.ok) {
    throw new Error(
      `expected success, got exit ${String(result.code)}: ${result.error.message}`,
    );
  }
  return result.data;
}

/** Parses "## Steps" of the rendered Claude skill: each "### <id>", its "Effect: `<verb>`", and the first ```text block. */
export async function skillSteps(workflowId: string): Promise<readonly SkillStep[]> {
  const text = await readFile(
    join(ROOT, "plugins/claude/skills", `developer-os-${workflowId}`, "SKILL.md"),
    "utf8",
  );
  const start = text.indexOf("\n## Steps\n");
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + "\n## Steps\n".length);
  const end = rest.indexOf("\n## ");
  const body = end === -1 ? rest : rest.slice(0, end);

  const steps = body
    .split("\n### ")
    .slice(1)
    .map((section): SkillStep => {
      const newline = section.indexOf("\n");
      return {
        id: (newline === -1 ? section : section.slice(0, newline)).trim(),
        verb: /Effect: `(.+?)`/u.exec(section)?.[1] ?? null,
        command: /```text\n(.+?)\n```/su.exec(section)?.[1] ?? null,
      };
    });
  expect(steps.length).toBeGreaterThan(0);
  return steps;
}

/** The rendered command of the first step with this effect verb. */
export function commandOf(steps: readonly SkillStep[], verb: string): string {
  const command = steps.find((step) => step.verb === verb)?.command;
  if (command === null || command === undefined) {
    throw new Error(`the rendered skill names no command for ${verb}`);
  }
  return command;
}

/** createTempHome + init --yes + brain reindex; returns the content root. */
export async function installedVault(): Promise<{
  readonly home: TempHome;
  readonly contentRoot: string;
}> {
  const sandbox = await createTempHome();
  const initialized = await runJson<InitResultV1>(sandbox, ["init", "--yes", "--json"]);
  expect(initialized.exitCode, initialized.stderr).toBe(EXIT_CODES.success);
  expect(okData(initialized.result).brainPath).toBe(sandbox.brain);
  const reindexed = await runJson<BrainReindexResultV1>(sandbox, [
    "brain",
    "reindex",
    "--json",
  ]);
  expect(reindexed.exitCode, reindexed.stderr).toBe(EXIT_CODES.success);
  return { home: sandbox, contentRoot: join(sandbox.brain, "content") };
}

/** argv for a rendered command: drops the leading "developer-os", appends extra args. */
export function argvOf(command: string, ...extra: readonly string[]): readonly string[] {
  const [binary, ...rest] = command.split(" ");
  expect(binary).toBe("developer-os");
  return [...rest, ...extra];
}

/**
 * Moved from `tests/e2e/knowledge-lifecycle/lifecycle.test.ts`'s `vendorScript`,
 * which documents why the reply is Codex's JSONL dialect: the proposal is a
 * string in the `text` of an `item.completed` `agent_message`.
 */
function vendorScript(replyFile: string, argvLog: string): string {
  return [
    "#!/bin/sh",
    `printf '%s\\0' '%%%call%%%' >> '${argvLog}'`,
    `for argument in "$@"; do printf '%s\\0' "$argument" >> '${argvLog}'; done`,
    'if [ "$1" = "--version" ]; then',
    `  printf '%s\\n' '${VENDOR_VERSION}'`,
    "  exit 0",
    "fi",
    `printf '%s\\n' '{"type":"item.started"}'`,
    `/bin/cat '${replyFile}'`,
    "printf '\\n'",
    "",
  ].join("\n");
}

/** A codex that answers with the canned proposal (lifecycle.test.ts's vendorScript, moved here). */
export async function installCannedCodex(home: TempHome, captureId: string): Promise<void> {
  const replyFile = join(home.root, "vendor-reply.json");
  const argvLog = join(home.root, "vendor-argv.log");
  const template = await readFile(PROPOSAL_FIXTURE, "utf8");
  expect(template).toContain(CAPTURE_ID_PLACEHOLDER);
  const payload = JSON.stringify(
    JSON.parse(template.replaceAll(CAPTURE_ID_PLACEHOLDER, captureId)),
  );
  await writeFile(
    replyFile,
    [
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_0", type: "agent_message", text: payload },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    ].join("\n"),
  );
  await installFakeExecutable(home, "codex", vendorScript(replyFile, argvLog));
}

/** A vendor that exits 97 if executed (installFakeExecutable's default body). */
export async function installForbiddenVendor(
  home: TempHome,
  name: "claude" | "codex",
): Promise<void> {
  await installFakeExecutable(home, name);
}

/** review --decision accept, then ingest; returns the ingest run. */
export async function acceptAndIngest(
  home: TempHome,
  captureId: string,
): Promise<JsonRun<IngestResultV1>> {
  const reviewed = await runJson<ReviewResultV1>(home, [
    "review",
    "--id",
    captureId,
    "--decision",
    "accept",
    "--json",
  ]);
  expect(reviewed.exitCode, reviewed.stderr).toBe(EXIT_CODES.success);
  expect(okData(reviewed.result).captures.map((row) => row.status)).toStrictEqual([
    "accepted",
  ]);
  return runJson<IngestResultV1>(home, ["ingest", "--json"]);
}

/**
 * True when every added path inside the vault lies in quarantine, and at least
 * one does. Paths outside the vault — the product's own state and journals —
 * are the executor's bookkeeping, not the workflow step's writes.
 */
export function quarantineOnly(added: readonly string[], contentRoot: string): boolean {
  const vault = join(contentRoot, "..");
  const quarantine = join(contentRoot, "_raw", "quarantine");
  const inVault = added.filter((path) => isInside(vault, path));
  return (
    inVault.some((path) => path !== quarantine && isInside(quarantine, path)) &&
    inVault.every((path) => isInside(quarantine, path))
  );
}
