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

const QUESTION = "brain commands";

describe("brain-answer, played from its rendered skill", () => {
  it("answers from the vault, files the answer back as one plain capture, and ingests it through the canned vendor", async () => {
    const { home: sandbox, contentRoot } = await installedVault();
    try {
      const steps = await skillSteps("brain-answer");
      expect(steps.map((step) => step.verb)).toStrictEqual([
        "brain.readIndex",
        "brain.search",
        "brain.readNote",
        null,
        null,
        "capture.write",
      ]);
      const before = await inventory(sandbox.root);

      const ranked = await runJson<BrainSearchResultV1>(sandbox, [
        ...argvOf(commandOf(steps, "brain.search"), QUESTION),
        "--json",
      ]);
      expect(ranked.exitCode, ranked.stderr).toBe(EXIT_CODES.success);
      const notePath = okData(ranked.result).matches[0]?.path;
      if (notePath === undefined) throw new Error("the search matched nothing");
      /** brain.readNote: the agent reads the note it will cite. */
      expect((await readFile(join(sandbox.brain, notePath), "utf8")).length).toBeGreaterThan(0);

      const answer = `developer-os brain commands are listed in ${notePath}.`;
      const captured = await runJson<CaptureResultV1>(
        sandbox,
        [...argvOf(commandOf(steps, "capture.write")), "--json"],
        { stdin: answer },
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
      const steps = await skillSteps("brain-answer");
      const before = await inventory(sandbox.root);

      const ranked = await runJson<BrainSearchResultV1>(sandbox, [
        ...argvOf(commandOf(steps, "brain.search"), QUESTION),
        "--json",
      ]);
      expect(ranked.exitCode, ranked.stderr).toBe(EXIT_CODES.success);
      expect(okData(ranked.result).matches.length).toBeGreaterThan(0);

      const after = await inventory(sandbox.root);
      expect(addedPaths(before, after)).toStrictEqual([]);
      expect(removedPaths(before, after)).toStrictEqual([]);
      expect(changedPaths(before, after)).toStrictEqual([]);
    } finally {
      await removeTempHome(sandbox);
    }
  });
});
