import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import type {
  BrainLintResultV1,
  BrainSearchResultV1,
} from "@developer-os/cli/dist/commands/brain.js";
import type { CaptureResultV1 } from "@developer-os/cli/dist/commands/capture.js";
import type { ReviewResultV1 } from "@developer-os/cli/dist/commands/review.js";

import { runJson } from "../../helpers/run-cli.js";
import { addedPaths, inventory, removeTempHome } from "../../helpers/temp-home.js";
import type { TempHome } from "../../helpers/temp-home.js";
import {
  acceptAndIngest,
  argvOf,
  commandOf,
  installForbiddenVendor,
  installedVault,
  okData,
  quarantineOnly,
  skillSteps,
} from "./harness.js";

const TARGET = "DEV/example-knowledge-note.md";
const TITLE = "Write the note you wanted to find";
const TAGS = ["dev", "writing"];

/** One header line the revision must change, asserted present so a template edit fails loudly. */
function replaceLine(text: string, line: string, next: string): string {
  expect(text).toContain(`\n${line}\n`);
  return text.replace(`\n${line}\n`, `\n${next}\n`);
}

/**
 * The whole revised note, with no trailing newline: `ingest` appends exactly
 * one. Every other header line, `created` included, stays byte-exact.
 */
function revise(original: string): string {
  let revised = replaceLine(original.trimEnd(), "updated: 2026-08-10", "updated: 2026-09-22");
  revised = replaceLine(revised, "aliases: [note writing]", "aliases: [note writing, knowledge note]");
  return `${revised}\n\nThe commands that check those links are listed in [[TOOLS/example-reference-note]].`;
}

/** Plays the read steps and the capture step; returns the capture id and the revision. */
async function captureRevision(
  sandbox: TempHome,
  contentRoot: string,
): Promise<{ readonly captureId: string; readonly revision: string }> {
  const steps = await skillSteps("brain-enhance");
  expect(steps.map((step) => step.verb)).toStrictEqual([
    "brain.readNote",
    "brain.readIndex",
    null,
    "brain.search",
    "brain.readNote",
    null,
    "capture.writeNote",
  ]);
  const before = await inventory(sandbox.root);

  /** brain.readNote: the target, byte for byte. */
  const original = await readFile(join(contentRoot, TARGET));

  /** related + rank: once with the title and once with each tag. */
  const related = new Set<string>();
  for (const query of [TITLE, ...TAGS]) {
    const ranked = await runJson<BrainSearchResultV1>(sandbox, [
      ...argvOf(commandOf(steps, "brain.search"), query),
      "--json",
    ]);
    expect(ranked.exitCode, ranked.stderr).toBe(EXIT_CODES.success);
    for (const match of okData(ranked.result).matches) {
      if (match.path !== `content/${TARGET}`) related.add(match.path);
    }
  }
  /** read-related: every match that is not the note itself. */
  for (const path of related) {
    expect((await readFile(join(sandbox.brain, path), "utf8")).length).toBeGreaterThan(0);
  }

  const revision = revise(original.toString("utf8"));
  const captured = await runJson<CaptureResultV1>(
    sandbox,
    [...argvOf(commandOf(steps, "capture.writeNote"), TARGET), "--json"],
    { stdin: revision },
  );
  expect(captured.exitCode, captured.stderr).toBe(EXIT_CODES.success);
  const { captureId, note } = okData(captured.result);
  expect(note).toStrictEqual({
    path: TARGET,
    beforeSha256: createHash("sha256").update(original).digest("hex"),
  });
  expect(
    quarantineOnly(addedPaths(before, await inventory(sandbox.root)), contentRoot),
  ).toBe(true);
  return { captureId, revision };
}

describe("brain-enhance, played from its rendered skill", () => {
  it("revises one note as a note capture bound to its hash and ingests it with no vendor call", async () => {
    const { home: sandbox, contentRoot } = await installedVault();
    try {
      await installForbiddenVendor(sandbox, "claude");
      await installForbiddenVendor(sandbox, "codex");

      const { captureId, revision } = await captureRevision(sandbox, contentRoot);

      const ingested = await acceptAndIngest(sandbox, captureId);
      expect(ingested.exitCode, ingested.stderr).toBe(EXIT_CODES.success);
      expect(okData(ingested.result).agent).toBeNull();
      expect(okData(ingested.result).applied).toStrictEqual([
        { captureId, status: "ingested", notes: [TARGET] },
      ]);
      expect(await readFile(join(contentRoot, TARGET), "utf8")).toBe(`${revision}\n`);

      const lint = await runJson<BrainLintResultV1>(sandbox, ["brain", "lint", "--json"]);
      expect(okData(lint.result).errorCount).toBe(0);
    } finally {
      await removeTempHome(sandbox);
    }
  });

  it("refuses exit 3 note_changed_since_capture when the note is edited after capture, keeping the edit and the accepted capture", async () => {
    const { home: sandbox, contentRoot } = await installedVault();
    try {
      await installForbiddenVendor(sandbox, "claude");
      await installForbiddenVendor(sandbox, "codex");

      const { captureId } = await captureRevision(sandbox, contentRoot);
      const target = join(contentRoot, TARGET);
      await appendFile(target, "\nA hand edit made after the capture.\n");
      const edited = await readFile(target);

      const ingested = await acceptAndIngest(sandbox, captureId);
      expect(ingested.exitCode, ingested.stderr).toBe(EXIT_CODES.decisionRequired);
      expect(JSON.stringify(ingested.result)).toContain("note_changed_since_capture");
      expect(await readFile(target)).toStrictEqual(edited);

      const accepted = await runJson<ReviewResultV1>(sandbox, [
        "review",
        "--status",
        "accepted",
        "--json",
      ]);
      expect(accepted.exitCode, accepted.stderr).toBe(EXIT_CODES.success);
      expect(
        okData(accepted.result).captures.map((row) => [row.captureId, row.status]),
      ).toStrictEqual([[captureId, "accepted"]]);
    } finally {
      await removeTempHome(sandbox);
    }
  });
});
