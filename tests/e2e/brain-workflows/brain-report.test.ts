import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import type {
  BrainLintResultV1,
  BrainSearchResultV1,
} from "@developer-os/cli/dist/commands/brain.js";
import type { CaptureResultV1 } from "@developer-os/cli/dist/commands/capture.js";

import { runJson } from "../../helpers/run-cli.js";
import {
  addedPaths,
  changedPaths,
  inventory,
  removeTempHome,
  removedPaths,
} from "../../helpers/temp-home.js";
import {
  acceptAndIngest,
  argvOf,
  commandOf,
  installCannedCodex,
  installedVault,
  okData,
  quarantineOnly,
  skillSteps,
} from "./harness.js";

const SUBJECT = "folders";
/** The template's INFRA example note: nothing links to it and it links to nothing. */
const ISOLATED_NOTE = "content/INFRA/example-compiled-note.md";

describe("brain-report, played from its rendered skill", () => {
  it("reports on a subject with its lint state, files the report back as one plain capture, and ingests it through the canned vendor", async () => {
    const { home: sandbox, contentRoot } = await installedVault();
    try {
      const steps = await skillSteps("brain-report");
      expect(steps.map((step) => step.verb)).toStrictEqual([
        "brain.readIndex",
        "brain.lint",
        "brain.search",
        "brain.readNote",
        null,
        null,
        "capture.write",
      ]);
      const before = await inventory(sandbox.root);

      const linted = await runJson<BrainLintResultV1>(
        sandbox,
        argvOf(commandOf(steps, "brain.lint"), "--json"),
      );
      expect(linted.exitCode, linted.stderr).toBe(EXIT_CODES.success);
      const isolated = okData(linted.result).findings.filter(
        (finding) => finding.class === "isolated" && finding.path === ISOLATED_NOTE,
      );
      expect(isolated).toHaveLength(1);

      const ranked = await runJson<BrainSearchResultV1>(sandbox, [
        ...argvOf(commandOf(steps, "brain.search"), SUBJECT),
        "--json",
      ]);
      expect(ranked.exitCode, ranked.stderr).toBe(EXIT_CODES.success);
      const read = okData(ranked.result).matches.map((match) => match.path);
      expect(read).toContain(ISOLATED_NOTE);
      /** brain.readNote: the agent reads every note it will cite. */
      for (const path of read) {
        expect((await readFile(join(sandbox.brain, path), "utf8")).length).toBeGreaterThan(0);
      }

      const report = [
        "## What the vault knows",
        `Only configured topic folders are indexed (${ISOLATED_NOTE}).`,
        "## Open questions",
        "The vault does not say how a topic folder is added.",
        "## Lint findings",
        `${ISOLATED_NOTE}: isolated, no link to or from this note.`,
        "## Notes worth revising",
        `${ISOLATED_NOTE}, to link it from the notes it summarises.`,
      ].join("\n");
      const captured = await runJson<CaptureResultV1>(
        sandbox,
        [...argvOf(commandOf(steps, "capture.write")), "--json"],
        { stdin: report },
      );
      expect(captured.exitCode, captured.stderr).toBe(EXIT_CODES.success);
      const { captureId, note } = okData(captured.result);
      expect(note).toBeNull();
      expect(
        quarantineOnly(addedPaths(before, await inventory(sandbox.root)), contentRoot),
      ).toBe(true);

      await installCannedCodex(sandbox, captureId);
      const ingested = await acceptAndIngest(sandbox, captureId);
      expect(ingested.exitCode, ingested.stderr).toBe(EXIT_CODES.success);
      expect(okData(ingested.result).agent).toBe("codex");
      expect(okData(ingested.result).applied.map((row) => row.captureId)).toStrictEqual([
        captureId,
      ]);

      const lint = await runJson<BrainLintResultV1>(sandbox, ["brain", "lint", "--json"]);
      expect(okData(lint.result).errorCount).toBe(0);
    } finally {
      await removeTempHome(sandbox);
    }
  });

  it("writes nothing when file-back is false", async () => {
    const { home: sandbox } = await installedVault();
    try {
      const steps = await skillSteps("brain-report");
      const before = await inventory(sandbox.root);

      const linted = await runJson<BrainLintResultV1>(
        sandbox,
        argvOf(commandOf(steps, "brain.lint"), "--json"),
      );
      expect(linted.exitCode, linted.stderr).toBe(EXIT_CODES.success);
      const ranked = await runJson<BrainSearchResultV1>(sandbox, [
        ...argvOf(commandOf(steps, "brain.search"), SUBJECT),
        "--json",
      ]);
      expect(ranked.exitCode, ranked.stderr).toBe(EXIT_CODES.success);

      const after = await inventory(sandbox.root);
      expect(addedPaths(before, after)).toStrictEqual([]);
      expect(removedPaths(before, after)).toStrictEqual([]);
      expect(changedPaths(before, after)).toStrictEqual([]);
    } finally {
      await removeTempHome(sandbox);
    }
  });
});
