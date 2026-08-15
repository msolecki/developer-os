import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import type { CliResult } from "@developer-os/core";
import type { BrainSearchResultV1 } from "@developer-os/cli/dist/commands/brain.js";
import type { CaptureResultV1 } from "@developer-os/cli/dist/commands/capture.js";
import type { IngestResultV1 } from "@developer-os/cli/dist/commands/ingest.js";
import type { InitResultV1 } from "@developer-os/cli/dist/commands/init.js";
import type { ReviewResultV1 } from "@developer-os/cli/dist/commands/review.js";

import { runJson } from "../../helpers/run-cli.js";
import {
  createTempHome,
  installFakeExecutable,
  removeTempHome,
} from "../../helpers/temp-home.js";
import type { TempHome } from "../../helpers/temp-home.js";

/**
 * The sandbox is deliberately not called `home`, for the reason
 * `tests/e2e/brain.test.ts` records at length: the self-containment rule flags a
 * variable of that name sitting within forty characters of a quoted vault
 * directory, and every invocation below passes the CLI's own subcommands as
 * arguments right beside it. Renaming the variable costs nothing and keeps that
 * guard at full strength; an allowlist entry would cost it everything.
 */

/**
 * **Named, rather than left to `VENDOR_ORDER`.** `ingest` falls back to the
 * first installed vendor, and a suite that relied on that would be asserting
 * something about an ordering constant it does not own — and would silently
 * change which vendor it exercises the day that constant does. Codex is the
 * named one because its invocation is the one that carries `--output-schema`,
 * which is the file `init` installs and therefore the half of the pipeline a
 * run that skipped `init` would not have.
 */
const VENDOR = "codex";

const OBSERVATION = "Vitest fake timers leak across files";
const QUERY = "fake timers";
/** Content-root-relative, exactly as the canned proposal names it. */
const PROPOSED_NOTE = "DEV/vitest-fake-timers.md";
/** The canned proposal's title, which restates the observation. */
const PROPOSED_TITLE = OBSERVATION;
/** The canned proposal's body, verbatim: what the vault must end up holding. */
const PROPOSED_BODY =
  "Restore the clock in an after-each hook, so the next file starts on a real one.";

const PROPOSAL_FIXTURE = fileURLToPath(
  new URL("../../fixtures/knowledge/ingest-proposal.json", import.meta.url),
);
const CAPTURE_ID_PLACEHOLDER = "__CAPTURE_ID__";

/**
 * Above every documented floor, because nothing in this lifecycle reads the
 * version and a fake that sat exactly on one would go red the day a floor rose.
 */
const VENDOR_VERSION = "9999.0.0";

/** One record per spawn, ahead of that spawn's arguments. See `callsFrom`. */
const CALL_MARKER = "%%%call%%%";

function dataOf<T>(run: { readonly result: CliResult<T> }): T {
  const { result } = run;
  if (!result.ok) {
    throw new Error(
      `expected success, got exit ${String(result.code)}: ${result.error.message}`,
    );
  }
  return result.data;
}

/**
 * The scripted vendor: a shell script on the disposable `PATH`, under a real
 * vendor's name, that answers all three things the product asks a vendor.
 *
 * 1. **Discovery** — `/usr/bin/which codex`, answered by existing and being
 *    executable rather than by anything the script prints.
 * 2. **The version probe** — `codex --version`, which `discoverCli` parses. No
 *    invocation in this lifecycle spawns one today: `AGENT_DETECTION_ROWS`
 *    carries only Claude's row since Task 17 (2026-08-15) and this lifecycle
 *    runs under a scripted Codex, so `capture` matches nothing and probes
 *    nothing, and `doctor` is not part of the five. But a vendor that answered
 *    only the model call would be discovered as absent the moment one did — and
 *    a Codex row is exactly what Task 17 still owes — so the failure would name
 *    neither this file nor the probe.
 * 3. **The model call** — `codex exec --json …`, whose reply is Codex's own
 *    dialect: JSONL, one event per line, of which the last line that parses to
 *    an object is the payload. Claude's is a single JSON document, and a fake
 *    that spoke one dialect to a vendor expecting the other would prove nothing.
 *
 * It records every spawn's argv into `argvLog`, NUL-separated, because the
 * prompt is multi-line and a newline-separated log could not be split back into
 * arguments. `/bin/cat` by absolute path: the runner hands the child an empty
 * environment, so there is no `PATH` to resolve a bare name against.
 */
function vendorScript(replyFile: string, argvLog: string): string {
  return [
    "#!/bin/sh",
    `printf '%s\\0' '${CALL_MARKER}' >> '${argvLog}'`,
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

/**
 * The log back into one argv per spawn. An argument recorded outside a call is
 * raised rather than dropped: it would mean the marker and the arguments had
 * drifted apart, and every assertion below would then be made against a
 * silently truncated argv.
 */
function callsFrom(log: string): readonly (readonly string[])[] {
  const records = log.split("\0");
  if (records.at(-1) === "") records.pop();

  const calls: string[][] = [];
  for (const record of records) {
    if (record === CALL_MARKER) {
      calls.push([]);
      continue;
    }
    const current = calls.at(-1);
    if (current === undefined) {
      throw new Error("the scripted vendor logged an argument outside a call");
    }
    current.push(record);
  }
  return calls;
}

function isVersionProbe(call: readonly string[]): boolean {
  return call.length === 1 && call[0] === "--version";
}

function valueAfter(call: readonly string[], flag: string): string {
  const value = call[call.indexOf(flag) + 1];
  if (value === undefined) {
    throw new Error(`the vendor was invoked without a value for ${flag}`);
  }
  return value;
}

describe("the knowledge pipeline, against the compiled binary", () => {
  it("initializes, captures, reviews, ingests and retrieves in five invocations", async () => {
    const sandbox: TempHome = await createTempHome();
    try {
      const replyFile = join(sandbox.root, "vendor-reply.json");
      const argvLog = join(sandbox.root, "vendor-argv.log");
      await installFakeExecutable(
        sandbox,
        VENDOR,
        vendorScript(replyFile, argvLog),
      );

      /** 1. The vault, the configuration, and the ingest output schema. */
      const initialized = await runJson<InitResultV1>(sandbox, [
        "init",
        "--yes",
        "--json",
      ]);
      expect(initialized.exitCode).toBe(EXIT_CODES.success);
      expect(initialized.result.code).toBe(EXIT_CODES.success);
      /** Everything below reads this vault; nothing else may have been built. */
      expect(dataOf(initialized).brainPath).toBe(sandbox.brain);

      /** 2. One observation, redacted before it is written, into quarantine. */
      const captured = await runJson<CaptureResultV1>(sandbox, [
        "capture",
        "--text",
        OBSERVATION,
        "--json",
      ]);
      expect(captured.exitCode).toBe(EXIT_CODES.success);
      expect(captured.result.code).toBe(EXIT_CODES.success);
      const { captureId } = dataOf(captured);
      expect(captureId).toMatch(/^[0-9a-f]{16}$/u);

      /**
       * The canned proposal, with the one field that cannot be canned filled in:
       * a capture id is a content hash, and a proposal naming any other capture
       * is refused by the `source-and-provenance` validator. The placeholder is
       * asserted present before it is replaced, so a fixture that stopped
       * carrying it fails here rather than at that validator.
       *
       * **The `JSON.parse` → `JSON.stringify` round trip is load-bearing**, not
       * tidiness: it collapses the pretty-printed fixture onto one line, which
       * is what makes the reply JSONL. Writing the template through would leave
       * a document no single line of which parses, and `invokeCodex` would read
       * it as `malformed-output`.
       */
      const template = await readFile(PROPOSAL_FIXTURE, "utf8");
      expect(template).toContain(CAPTURE_ID_PLACEHOLDER);
      await writeFile(
        replyFile,
        JSON.stringify(
          JSON.parse(template.replaceAll(CAPTURE_ID_PLACEHOLDER, captureId)),
        ),
      );

      /** 3. The human gate: accepted, one capture, by id. */
      const reviewed = await runJson<ReviewResultV1>(sandbox, [
        "review",
        "--id",
        captureId,
        "--decision",
        "accept",
        "--json",
      ]);
      expect(reviewed.exitCode).toBe(EXIT_CODES.success);
      expect(reviewed.result.code).toBe(EXIT_CODES.success);
      expect(dataOf(reviewed).captures).toStrictEqual([
        { captureId, status: "accepted" },
      ]);

      /** 4. One agent call, nine validators, four transactions, a reindex. */
      const ingested = await runJson<IngestResultV1>(sandbox, [
        "ingest",
        "--agent",
        VENDOR,
        "--json",
      ]);
      expect(ingested.exitCode, ingested.stderr).toBe(EXIT_CODES.success);
      expect(ingested.result.code).toBe(EXIT_CODES.success);
      const applied = dataOf(ingested).applied;
      expect(applied).toHaveLength(1);
      expect(applied[0]).toStrictEqual({
        captureId,
        status: "ingested",
        notes: [PROPOSED_NOTE],
      });

      /** The note is in the vault, carrying the body the proposal named. */
      const note = join(sandbox.brain, "content", PROPOSED_NOTE);
      expect(await readFile(note, "utf8")).toContain(PROPOSED_BODY);

      /**
       * And the model was invoked **once**, with the flags the workflow
       * declares: its vendor's read-only sandbox, no write scope, and the output
       * schema `init` installed. Asserted from the vendor's own argv, which is
       * where those three are observable from outside the process.
       */
      const calls = callsFrom(await readFile(argvLog, "utf8"));
      const modelCalls = calls.filter((call) => !isVersionProbe(call));
      expect(modelCalls).toHaveLength(1);
      const [invoked] = modelCalls;
      if (invoked === undefined) throw new Error("the vendor was never invoked");

      expect(invoked[0]).toBe("exec");
      expect(invoked).toContain("--json");
      expect(invoked).toContain("--skip-git-repo-check");
      expect(invoked).not.toContain("--add-dir");
      expect(valueAfter(invoked, "-s")).toBe("read-only");

      /**
       * Tied to invocation 1's own report rather than to a path this file
       * reassembles: `init` names every file it installed, so the schema the
       * vendor was pointed at is the schema `init` says it wrote.
       */
      const schemaFile = valueAfter(invoked, "--output-schema");
      expect(dataOf(initialized).created).toContain(schemaFile);
      expect((await readFile(schemaFile, "utf8")).length).toBeGreaterThan(0);
      expect(invoked.at(-1)).toContain(OBSERVATION);

      /**
       * 5. **The point of the whole suite.** A note ingested by the previous
       * invocation is returned by this one, which is what proves the reindex
       * step is wired rather than declared: nothing else in this run builds the
       * index `search` reads, and `brain search` refuses outright when none
       * exists.
       */
      const found = await runJson<BrainSearchResultV1>(sandbox, [
        "brain",
        "search",
        QUERY,
        "--json",
      ]);
      expect(found.exitCode, found.stderr).toBe(EXIT_CODES.success);
      expect(found.result.code).toBe(EXIT_CODES.success);
      const matches = dataOf(found).matches;
      expect(matches.length).toBeGreaterThan(0);

      /**
       * The ingested note itself, not merely something. Its title is the
       * observation restated, which is what carries the query through the
       * funnel's `title` door — and asserting it proves the index holds the
       * note's own content rather than only its path.
       */
      const retrieved = matches.filter(
        (match) => match.path === `content/${PROPOSED_NOTE}`,
      );
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]?.title).toBe(PROPOSED_TITLE);
    } finally {
      await removeTempHome(sandbox);
    }
  });
});
