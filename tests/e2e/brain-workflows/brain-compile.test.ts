import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import type {
  BrainLintResultV1,
  BrainSearchResultV1,
} from "@developer-os/cli/dist/commands/brain.js";
import type { CaptureResultV1 } from "@developer-os/cli/dist/commands/capture.js";

import { runJson, runShell } from "../../helpers/run-cli.js";
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

  it("keeps a hostile note path and a bare heredoc word inert when a shell runs the printed command", async () => {
    const { home: sandbox, contentRoot } = await installedVault();
    try {
      await installForbiddenVendor(sandbox, "claude");
      await installForbiddenVendor(sandbox, "codex");
      /** `:` is a shell builtin: the sandbox PATH holds no `touch`. */
      const hostilePath = "INFRA/x$(:>pwned).md";
      const tail = "The line after a bare NOTE is still part of the note.";
      const body = [COMPILED_NOTE, "NOTE", tail].join("\n");

      const skill = await readFile(
        new URL("../../../plugins/claude/skills/developer-os-brain-compile/SKILL.md", import.meta.url),
        "utf8",
      );
      const printed = /developer-os capture --note \S+ <<'[^']*' \.\.\. \S+/u.exec(skill)?.[0];
      expect(printed).toBeDefined();
      const [head = "", word = ""] = (printed ?? "").split(" ... ");
      /** The agent's choice the prose asks for: a word on no line of the note. */
      const chosen = "END_OF_COMPILED_NOTE";
      expect(body.split("\n")).not.toContain(chosen);
      const script = [
        head.replace("<path>", hostilePath).replace("<word>", chosen),
        body,
        word.replace("<word>", chosen),
        "",
      ].join("\n");

      const before = await inventory(sandbox.root);
      const run = await runShell(sandbox, script);
      expect(run.exitCode, run.stderr).toBe(EXIT_CODES.success);
      await expect(access(join(sandbox.root, "pwned"))).rejects.toThrow();
      const added = addedPaths(before, await inventory(sandbox.root));
      expect(quarantineOnly(added, contentRoot)).toBe(true);
      const quarantine = join(contentRoot, "_raw", "quarantine");
      const stored = (
        await Promise.all(
          added
            .filter((path) => path.startsWith(quarantine))
            .map(async (path) => readFile(path, "utf8").catch(() => "")),
        )
      ).join("\n");
      expect(stored).toContain(tail);
      expect(stored).toContain(JSON.stringify(hostilePath).slice(1, -1));
    } finally {
      await removeTempHome(sandbox);
    }
  });
});
