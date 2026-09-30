import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import type { CliResult } from "@developer-os/core";
import type { CaptureResultV1 } from "@developer-os/cli/dist/commands/capture.js";
import type { IngestResultV1, RunReportV1 } from "@developer-os/cli/dist/commands/ingest.js";
import type { InitResultV1 } from "@developer-os/cli/dist/commands/init.js";
import type { ReviewResultV1 } from "@developer-os/cli/dist/commands/review.js";

import { runJson } from "../helpers/run-cli.js";
import type { CliRun } from "../helpers/run-cli.js";
import {
  addedPaths,
  changedPaths,
  createTempHome,
  filesContaining,
  installFakeExecutable,
  inventory,
  isInside,
  removeTempHome,
} from "../helpers/temp-home.js";
import type { TempHome } from "../helpers/temp-home.js";

import { oneNote, SENTINEL, statusOfText } from "./helpers.js";

/**
 * `threat-model.md` §5.4 and `brain.md` §6.13, the capture and ingest half: a note
 * capture is refused before it can escape a topic folder, is redacted before it lands, and replaces only the bytes it
 * was taken against. Every case runs the compiled binary under a temporary HOME.
 */

const VENDOR = "codex";
const EXISTING_NOTE = "DEV/example-knowledge-note.md";

const NEW_NOTE = [
  "---",
  "schemaVersion: 1",
  "title: Note capture fixture",
  "type: knowledge-note",
  "created: 2026-09-22",
  "tags: [dev]",
  "summary: Note capture fixture is what this note records.",
  "stage: emerging",
  "author: agent",
  "reviewed: null",
  "---",
  "",
  "A note the security suite captures whole.",
  "",
].join("\n");

const sandboxes: TempHome[] = [];

afterEach(async () => {
  while (sandboxes.length > 0) {
    const sandbox = sandboxes.pop();
    if (sandbox !== undefined) await removeTempHome(sandbox);
  }
});

/** `withVendor` plants a fake Codex that answers with whatever `replyFileOf` holds. */
async function installedHome(withVendor = false): Promise<TempHome> {
  const sandbox = await createTempHome();
  sandboxes.push(sandbox);
  if (withVendor) await installFakeExecutable(sandbox, VENDOR, vendorScript(replyFileOf(sandbox)));
  const installed = await runJson<InitResultV1>(sandbox, ["init", "--yes", "--json"]);
  expect(installed.exitCode, installed.stderr).toBe(EXIT_CODES.success);
  return sandbox;
}

/**
 * Runtime state a refused command may still touch: locks, transaction records and
 * logs under the product home. The vault and everything else must stay byte-identical.
 */
function isVolatile(sandbox: TempHome, path: string): boolean {
  return isInside(sandbox.productHome, path);
}

function dataOf<T>(result: CliResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected success, got exit ${String(result.code)}: ${result.error.message}`);
  }
  return result.data;
}

function vaultPath(sandbox: TempHome, notePath: string): string {
  return join(sandbox.brain, "content", ...notePath.split("/"));
}

function quarantined(sandbox: TempHome, captureId: string): string {
  return join(sandbox.brain, "content", "_raw", "quarantine", `${captureId}.md`);
}

async function captureNote(sandbox: TempHome, notePath: string, text: string): Promise<CaptureResultV1> {
  const run = await runJson<CaptureResultV1>(sandbox, ["capture", "--note", notePath, "--json"], {
    stdin: text,
  });
  expect(run.exitCode, run.stderr).toBe(EXIT_CODES.success);
  return dataOf(run.result);
}

async function accept(sandbox: TempHome, captureId: string): Promise<CliRun> {
  const run = await runJson<ReviewResultV1>(sandbox, [
    "review",
    "--id",
    captureId,
    "--decision",
    "accept",
    "--json",
  ]);
  expect(run.exitCode, run.stderr).toBe(EXIT_CODES.success);
  return run;
}

async function assertNothingWritten(
  sandbox: TempHome,
  before: Awaited<ReturnType<typeof inventory>>,
): Promise<void> {
  const after = await inventory(sandbox.root);
  expect(addedPaths(before, after).filter((p) => !isVolatile(sandbox, p))).toStrictEqual([]);
  expect(changedPaths(before, after).filter((p) => !isVolatile(sandbox, p))).toStrictEqual([]);
}

describe("a note capture aimed outside a topic folder", () => {
  it.each([
    ["_raw/x.md", EXIT_CODES.securityRefusal, "capture_note_path_refused"],
    ["_indexes/x.md", EXIT_CODES.securityRefusal, "capture_note_path_refused"],
    ["_RAW/x.md", EXIT_CODES.securityRefusal, "capture_note_path_refused"],
    ["../x.md", EXIT_CODES.invalidInput, "capture_note_invalid"],
  ] as const)("refuses --note %s with exit %i (%s) and writes nothing", async (path, code, kind) => {
    const sandbox = await installedHome();
    const before = await inventory(sandbox.root);
    const run = await runJson<CaptureResultV1>(sandbox, ["capture", "--note", path, "--json"], {
      stdin: NEW_NOTE,
    });
    // Exact code and kind, never `not.toBe(success)`: on the base commit `--note` is an unknown
    // option (usage, exit 2, kind invalid_input), and a weak assertion would pass there.
    expect([run.exitCode, !run.result.ok && run.result.error.kind]).toStrictEqual([code, kind]);
    await assertNothingWritten(sandbox, before);
  });

  it("refuses an in-vault symlink as exit 5 capture_note_path_refused and writes nothing", async () => {
    const sandbox = await installedHome();
    await symlink(join(sandbox.brain, "content", "_raw"), vaultPath(sandbox, "DEV/link"), "dir");
    const before = await inventory(sandbox.root);
    const run = await runJson<CaptureResultV1>(
      sandbox,
      ["capture", "--note", "DEV/link/x.md", "--json"],
      { stdin: NEW_NOTE },
    );
    expect([run.exitCode, !run.result.ok && run.result.error.kind]).toStrictEqual([
      EXIT_CODES.securityRefusal,
      "capture_note_path_refused",
    ]);
    await assertNothingWritten(sandbox, before);
  });
});

describe("a note capture carrying a secret", () => {
  it("redacts the sentinel secret in the applied note and in every report", async () => {
    const sandbox = await installedHome();
    const notePath = "DEV/note-capture-sentinel.md";
    const withSecret = NEW_NOTE.replace(
      "A note the security suite captures whole.",
      `A note the security suite captures whole, carrying ${SENTINEL} in its body.`,
    );
    expect(withSecret).toContain(SENTINEL);

    const captured = await runJson<CaptureResultV1>(sandbox, ["capture", "--note", notePath, "--json"], {
      stdin: withSecret,
    });
    expect(captured.exitCode, captured.stderr).toBe(EXIT_CODES.success);
    const capture = dataOf(captured.result);
    expect(capture.redactionCount).toBeGreaterThan(0);

    const reviewed = await accept(sandbox, capture.captureId);
    const ingested = await runJson<IngestResultV1>(sandbox, ["ingest", "--json"]);
    expect(ingested.exitCode, ingested.stderr).toBe(EXIT_CODES.success);
    expect(dataOf(ingested.result).applied).toStrictEqual([
      { captureId: capture.captureId, status: "ingested", notes: [notePath] },
    ]);

    const applied = await readFile(vaultPath(sandbox, notePath), "utf8");
    expect(applied).toContain("A note the security suite captures whole, carrying ");
    expect(applied).not.toContain(SENTINEL);

    const reports = [captured, reviewed, ingested];
    expect(reports.length).toBeGreaterThan(0);
    for (const run of reports) {
      expect(run.stdout).not.toContain(SENTINEL);
      expect(run.stderr).not.toContain(SENTINEL);
    }
    expect(await filesContaining(sandbox.root, SENTINEL)).toStrictEqual([]);
  });
});

describe("a replacing note capture whose target changed after capture", () => {
  it("refuses: exit 3, reason note_changed_since_capture, bytes intact, capture accepted", async () => {
    const sandbox = await installedHome();
    const target = vaultPath(sandbox, EXISTING_NOTE);
    const original = await readFile(target, "utf8");
    const replacement = original.replace(
      "Delete these four example notes whenever you like",
      "Keep these four example notes as long as they help",
    );
    expect(replacement).not.toBe(original);

    const capture = await captureNote(sandbox, EXISTING_NOTE, replacement);
    expect(capture.note).not.toBeNull();
    expect(capture.note?.beforeSha256).not.toBeNull();

    const edited = `${original}\nA line the person added after the capture was taken.\n`;
    await writeFile(target, edited);
    await accept(sandbox, capture.captureId);

    const run = await runJson<IngestResultV1>(sandbox, ["ingest", "--json"]);
    expect(run.exitCode, run.stderr).toBe(EXIT_CODES.decisionRequired);
    if (run.result.ok) throw new Error("ingest applied a replace against a changed note");
    const report = run.result.error.data as unknown as RunReportV1;
    expect(
      report.refused.map((refusal) => [refusal.captureId, refusal.code, refusal.reason]),
    ).toStrictEqual([
      [capture.captureId, EXIT_CODES.decisionRequired, "note_changed_since_capture"],
    ]);

    expect(await readFile(target, "utf8")).toBe(edited);
    expect(statusOfText(await readFile(quarantined(sandbox, capture.captureId), "utf8"))).toBe(
      "accepted",
    );
  });
});

function replyFileOf(sandbox: TempHome): string {
  return join(sandbox.root, "vendor-reply.json");
}

/** Answers the version probe and the model call in Codex's JSONL dialect (as `tests/e2e/import.test.ts`). */
function vendorScript(replyFile: string): string {
  return [
    "#!/bin/sh",
    'if [ "$1" = "--version" ]; then',
    "  printf '%s\\n' '9999.0.0'",
    "  exit 0",
    "fi",
    `printf '%s\\n' '{"type":"item.started"}'`,
    `/bin/cat '${replyFile}'`,
    "printf '\\n'",
    "",
  ].join("\n");
}

describe("a plain capture after note captures landed", () => {
  it("leaves malformed-manifest.test.ts's plain-capture replace refusal in force", async () => {
    const probe = await installedHome(true);

    const target = vaultPath(probe, EXISTING_NOTE);
    const original = await readFile(target, "utf8");

    const captured = await runJson<CaptureResultV1>(probe, [
      "capture",
      "--text",
      "an observation whose proposal names an existing note",
      "--json",
    ]);
    expect(captured.exitCode, captured.stderr).toBe(EXIT_CODES.success);
    const { captureId, note } = dataOf(captured.result);
    expect(note).toBeNull();

    await writeFile(
      replyFileOf(probe),
      [
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_0",
            type: "agent_message",
            text: JSON.stringify(oneNote(captureId, EXISTING_NOTE, "Replacing run")),
          },
        }),
        JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }),
      ].join("\n"),
    );
    await accept(probe, captureId);

    const run = await runJson<IngestResultV1>(probe, ["ingest", "--agent", VENDOR, "--json"]);
    expect(await readFile(target, "utf8")).toBe(original);
    if (run.result.ok) throw new Error("ingest replaced a note from a plain capture");
    expect(run.result.error.message).toContain("ingest creates notes and never replaces one");
    const report = run.result.error.data as unknown as RunReportV1;
    expect(report.refused.map((refusal) => [refusal.captureId, refusal.reason])).toStrictEqual([
      [captureId, null],
    ]);
    expect(statusOfText(await readFile(quarantined(probe, captureId), "utf8"))).toBe("accepted");
  });
});
