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
import { addedPaths, inventory, removeTempHome } from "../../helpers/temp-home.js";
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

/** Ranks both template notes that `SOURCES` names. */
const TOPIC = "brain index";
const DESTINATION = "INFRA/compiled-dev-tools.md";
/** Both notes the agent reads, content-root-relative as `sources` names them. */
const SOURCES = ["INFRA/example-compiled-note.md", "TOOLS/example-reference-note.md"];

/** The note the agent drafts, with no trailing newline: `ingest` appends exactly one. */
const COMPILED_NOTE = [
  "---",
  "schemaVersion: 1",
  "title: Folders and brain commands, compiled",
  "type: compiled-note",
  "created: 2026-09-22",
  "tags: [infra, tools]",
  "summary: Which folders the index reads, and the commands that build and query it.",
  "stage: emerging",
  "author: agent",
  "reviewed: null",
  `sources: [${SOURCES.join(", ")}]`,
  "---",
  "",
  "Only configured topic folders are indexed; see [[INFRA/example-compiled-note]].",
  "The index is built by reindex and read by search; see [[TOOLS/example-reference-note]].",
].join("\n");

describe("brain-compile, played from its rendered skill", () => {
  it("captures one compiled note verbatim and ingests it with no vendor call", async () => {
    const { home: sandbox, contentRoot } = await installedVault();
    try {
      await installForbiddenVendor(sandbox, "claude");
      await installForbiddenVendor(sandbox, "codex");

      const steps = await skillSteps("brain-compile");
      expect(steps.map((step) => step.verb)).toStrictEqual([
        "brain.readIndex",
        "brain.search",
        "brain.readNote",
        null,
        "capture.writeNote",
      ]);
      const before = await inventory(sandbox.root);

      const ranked = await runJson<BrainSearchResultV1>(sandbox, [
        ...argvOf(commandOf(steps, "brain.search"), TOPIC),
        "--json",
      ]);
      expect(ranked.exitCode, ranked.stderr).toBe(EXIT_CODES.success);
      const ranks = okData(ranked.result).matches.map((match) => match.path);
      expect(ranks).toStrictEqual(
        expect.arrayContaining(SOURCES.map((source) => `content/${source}`)),
      );
      /** brain.readNote: the agent reads each note it names in `sources`. */
      for (const source of SOURCES) {
        expect((await readFile(join(contentRoot, source), "utf8")).length).toBeGreaterThan(0);
      }

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
      expect(okData(ingested.result).applied).toStrictEqual([
        { captureId, status: "ingested", notes: [DESTINATION] },
      ]);
      expect(await readFile(join(contentRoot, DESTINATION), "utf8")).toBe(`${COMPILED_NOTE}\n`);

      const lint = await runJson<BrainLintResultV1>(sandbox, ["brain", "lint", "--json"]);
      expect(okData(lint.result).errorCount).toBe(0);
    } finally {
      await removeTempHome(sandbox);
    }
  });
});
