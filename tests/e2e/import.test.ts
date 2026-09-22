import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import type { CliResult } from "@developer-os/core";
import type { BrainSearchResultV1 } from "@developer-os/cli/dist/commands/brain.js";
import type { ImportResultV1 } from "@developer-os/cli/dist/commands/import.js";
import type { IngestResultV1 } from "@developer-os/cli/dist/commands/ingest.js";
import type { InitResultV1 } from "@developer-os/cli/dist/commands/init.js";
import type { ReviewResultV1 } from "@developer-os/cli/dist/commands/review.js";

import { runJson } from "../helpers/run-cli.js";
import {
  createTempHome,
  installFakeExecutable,
  removeTempHome,
} from "../helpers/temp-home.js";
import type { TempHome } from "../helpers/temp-home.js";

/**
 * `import`, against the compiled binary: two inbox notes become two captures, one
 * of them goes through review and ingest, and search finds it. The arrangement is
 * `knowledge-lifecycle/lifecycle.test.ts`'s, including why the sandbox is not
 * called `home`.
 */

const VENDOR = "codex";
const VENDOR_VERSION = "9999.0.0";
/** The first note restates the canned proposal's observation. */
const OBSERVATION = "Vitest fake timers leak across files";
const QUERY = "fake timers";
const PROPOSED_NOTE = "DEV/vitest-fake-timers.md";
const FIRST = "a-first.md";
const SECOND = "b-second.md";

const PROPOSAL_FIXTURE = fileURLToPath(
  new URL("../fixtures/knowledge/ingest-proposal.json", import.meta.url),
);
const CAPTURE_ID_PLACEHOLDER = "__CAPTURE_ID__";

function dataOf<T>(run: { readonly result: CliResult<T> }): T {
  const { result } = run;
  if (!result.ok) {
    throw new Error(
      `expected success, got exit ${String(result.code)}: ${result.error.message}`,
    );
  }
  return result.data;
}

/** Answers the version probe and the model call in Codex's JSONL dialect. */
function vendorScript(replyFile: string): string {
  return [
    "#!/bin/sh",
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

describe("import, against the compiled binary", () => {
  it("imports the inbox, ingests one capture, finds it, and deduplicates a rerun", async () => {
    const sandbox: TempHome = await createTempHome();
    try {
      const replyFile = join(sandbox.root, "vendor-reply.json");
      await installFakeExecutable(sandbox, VENDOR, vendorScript(replyFile));

      const initialized = await runJson<InitResultV1>(sandbox, ["init", "--yes", "--json"]);
      expect(initialized.exitCode, initialized.stderr).toBe(EXIT_CODES.success);
      expect(dataOf(initialized).brainPath).toBe(sandbox.brain);

      const inbox = join(sandbox.brain, "content", "_raw", "inbox");
      await writeFile(join(inbox, FIRST), `${OBSERVATION}\n`, { flag: "wx", mode: 0o600 });
      await writeFile(
        join(inbox, SECOND),
        "A second inbox note that stays captured.\n",
        { flag: "wx", mode: 0o600 },
      );

      const imported = await runJson<ImportResultV1>(sandbox, ["import", "--json"]);
      expect(imported.exitCode, imported.stderr).toBe(EXIT_CODES.success);
      const files = dataOf(imported).files;
      expect(files.map((file) => [file.path, file.outcome])).toStrictEqual([
        [FIRST, "imported"],
        [SECOND, "imported"],
      ]);
      const captureId = files.find((file) => file.path === FIRST)?.captureId ?? "";
      expect(captureId).toMatch(/^[0-9a-f]{16}$/u);

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

      const reviewed = await runJson<ReviewResultV1>(sandbox, [
        "review",
        "--id",
        captureId,
        "--decision",
        "accept",
        "--json",
      ]);
      expect(reviewed.exitCode, reviewed.stderr).toBe(EXIT_CODES.success);

      const ingested = await runJson<IngestResultV1>(sandbox, [
        "ingest",
        "--agent",
        VENDOR,
        "--json",
      ]);
      expect(ingested.exitCode, ingested.stderr).toBe(EXIT_CODES.success);
      expect(dataOf(ingested).applied).toStrictEqual([
        { captureId, status: "ingested", notes: [PROPOSED_NOTE] },
      ]);

      const found = await runJson<BrainSearchResultV1>(sandbox, [
        "brain",
        "search",
        QUERY,
        "--json",
      ]);
      expect(found.exitCode, found.stderr).toBe(EXIT_CODES.success);
      expect(
        dataOf(found).matches.filter((match) => match.path === `content/${PROPOSED_NOTE}`),
      ).toHaveLength(1);

      const rerun = await runJson<ImportResultV1>(sandbox, ["import", "--json"]);
      expect(rerun.exitCode, rerun.stderr).toBe(EXIT_CODES.success);
      expect(dataOf(rerun).files).toStrictEqual([]);
      expect(dataOf(rerun).duplicateCount).toBe(2);
    } finally {
      await removeTempHome(sandbox);
    }
  });
});
