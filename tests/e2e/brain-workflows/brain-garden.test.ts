import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import type {
  BrainLintResultV1,
  BrainReindexResultV1,
} from "@developer-os/cli/dist/commands/brain.js";
import type { CaptureResultV1 } from "@developer-os/cli/dist/commands/capture.js";
import type { BrainRefactorResultV1 } from "@developer-os/cli/dist/commands/refactor.js";

import { runJson } from "../../helpers/run-cli.js";
import {
  addedPaths,
  changedPaths,
  inventory,
  removeTempHome,
  removedPaths,
} from "../../helpers/temp-home.js";
import type { Inventory } from "../../helpers/temp-home.js";
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

const TAG = "gardening";
/** Planted per test after `init`; `templates/brain` is not extended (Plan decision 1). */
const GARDEN = ["DEV/garden-a.md", "DEV/garden-b.md", "DEV/garden-c.md"];
/** The template's two notes that nothing links to and that link to nothing. */
const ISOLATED = ["content/INFRA/example-compiled-note.md", "content/PROJECTS/example-project-note.md"];
const RETIRED = "PROJECTS/example-project-note.md";
const DESTINATION = "INFRA/gardening.md";

function gardenNote(letter: string): string {
  return [
    "---",
    "schemaVersion: 1",
    `title: Gardening practice ${letter}`,
    "type: knowledge-note",
    "created: 2026-09-01",
    "updated: 2026-09-01",
    `tags: [${TAG}]`,
    `summary: One thing learned about gardening, number ${letter}.`,
    "stage: emerging",
    "author: human",
    "reviewed: 2026-09-01",
    "---",
    "",
    `Gardening lesson ${letter}: water in the morning, not at noon.`,
    "",
  ].join("\n");
}

/** The note the agent drafts for the gap, with no trailing newline: `ingest` appends exactly one. */
const COMPILED_NOTE = [
  "---",
  "schemaVersion: 1",
  "title: Gardening, compiled",
  "type: compiled-note",
  "created: 2026-09-22",
  `tags: [${TAG}]`,
  "summary: What the three gardening notes agree on.",
  "stage: emerging",
  "author: agent",
  "reviewed: null",
  `sources: [${GARDEN.join(", ")}]`,
  "---",
  "",
  "All three gardening notes water in the morning; see [[DEV/garden-a]], [[DEV/garden-b]] and [[DEV/garden-c]].",
].join("\n");

function expectUnchanged(before: Inventory, after: Inventory): void {
  expect(addedPaths(before, after)).toStrictEqual([]);
  expect(removedPaths(before, after)).toStrictEqual([]);
  expect(changedPaths(before, after)).toStrictEqual([]);
}

describe("brain-garden, played from its rendered skill", () => {
  it("fills a gap with one note capture, prints structural fixes only as dry runs, and never applies them inside an agent session", async () => {
    const { home: sandbox, contentRoot } = await installedVault();
    try {
      await installForbiddenVendor(sandbox, "claude");
      await installForbiddenVendor(sandbox, "codex");
      for (const [index, path] of GARDEN.entries()) {
        await writeFile(join(contentRoot, path), gardenNote("ABC"[index] as string), {
          mode: 0o600,
        });
      }
      const reindexed = await runJson<BrainReindexResultV1>(sandbox, [
        "brain",
        "reindex",
        "--json",
      ]);
      expect(reindexed.exitCode, reindexed.stderr).toBe(EXIT_CODES.success);

      const steps = await skillSteps("brain-garden");
      expect(steps.map((step) => step.verb)).toStrictEqual([
        "brain.lint",
        "brain.readIndex",
        "brain.readNote",
        null,
        "capture.writeNote",
      ]);
      const before = await inventory(sandbox.root);

      const linted = await runJson<BrainLintResultV1>(
        sandbox,
        argvOf(commandOf(steps, "brain.lint"), "--json"),
      );
      expect(linted.exitCode, linted.stderr).toBe(EXIT_CODES.success);
      const findings = okData(linted.result).findings;
      const gaps = (all: typeof findings) =>
        all.filter((finding) => finding.class === "gap" && finding.message.includes(TAG));
      expect(gaps(findings)).toHaveLength(1);
      const isolated = findings
        .filter((finding) => finding.class === "isolated")
        .map((finding) => finding.path);
      expect(isolated).toStrictEqual(expect.arrayContaining(ISOLATED));
      /** brain.readNote: the agent reads every note the gap names. */
      for (const path of GARDEN) {
        expect((await readFile(join(contentRoot, path), "utf8")).length).toBeGreaterThan(0);
      }

      /**
       * The structural half runs before the gap note is ingested: once
       * INFRA/gardening.md cites DEV/garden-a.md in `sources`, merging that note
       * is refused as refactor_postcondition_failed (Plan decision 10).
       */
      const retired = await runJson<BrainRefactorResultV1>(sandbox, [
        "brain",
        "retire",
        RETIRED,
        "--dry-run",
        "--json",
      ]);
      expect(retired.exitCode, retired.stderr).toBe(EXIT_CODES.success);
      expect(okData(retired.result).transactionId).toBeNull();
      const merged = await runJson<BrainRefactorResultV1>(sandbox, [
        "brain",
        "refactor",
        "--merge",
        "DEV/garden-a.md",
        "DEV/garden-b.md",
        "--dry-run",
        "--json",
      ]);
      expect(merged.exitCode, merged.stderr).toBe(EXIT_CODES.success);
      expect(okData(merged.result).transactionId).toBeNull();
      expectUnchanged(before, await inventory(sandbox.root));

      const applied = await runJson<BrainRefactorResultV1>(
        sandbox,
        ["brain", "retire", RETIRED, "--json"],
        { env: { CLAUDECODE: "1" } },
      );
      expect(applied.exitCode, applied.stderr).toBe(EXIT_CODES.securityRefusal);
      expect(!applied.result.ok && applied.result.error.kind).toBe(
        "brain_refactor_in_agent_session",
      );
      expectUnchanged(before, await inventory(sandbox.root));

      /** limit: 1 — one note capture, for the gap. */
      const captured = await runJson<CaptureResultV1>(
        sandbox,
        [...argvOf(commandOf(steps, "capture.writeNote"), DESTINATION), "--json"],
        { stdin: COMPILED_NOTE },
      );
      expect(captured.exitCode, captured.stderr).toBe(EXIT_CODES.success);
      const { captureId, note } = okData(captured.result);
      expect(note).toStrictEqual({ path: DESTINATION, beforeSha256: null });
      expect(
        quarantineOnly(addedPaths(before, await inventory(sandbox.root)), contentRoot),
      ).toBe(true);

      const ingested = await acceptAndIngest(sandbox, captureId);
      expect(ingested.exitCode, ingested.stderr).toBe(EXIT_CODES.success);
      expect(okData(ingested.result).agent).toBeNull();
      expect(await readFile(join(contentRoot, DESTINATION), "utf8")).toBe(`${COMPILED_NOTE}\n`);

      const relinted = await runJson<BrainLintResultV1>(sandbox, ["brain", "lint", "--json"]);
      expect(relinted.exitCode, relinted.stderr).toBe(EXIT_CODES.success);
      expect(okData(relinted.result).errorCount).toBe(0);
      expect(gaps(okData(relinted.result).findings)).toStrictEqual([]);
    } finally {
      await removeTempHome(sandbox);
    }
  });
});
