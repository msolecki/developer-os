import * as nodeFs from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXIT_CODES,
  formatJsonResult,
  loadConfig,
  serializeConfig,
} from "@developer-os/core";
import type { CliResult, TransactionPhase } from "@developer-os/core";
import {
  DEFAULT_BRAIN_CONFIG,
  detectSourceAgent,
  parseCaptureFile,
} from "@developer-os/brain";
import type { CaptureStatus, ProposedNote } from "@developer-os/brain";
import { redactText } from "@developer-os/security";
import type { ProcessResult, ProcessRunner } from "@developer-os/security";
import type { AgentDiscovery, AgentName } from "@developer-os/platform-macos";
import { loadWorkflow } from "@developer-os/workflow-schema";

import { afterEach, describe, expect, it } from "vitest";

import { runCapture } from "./capture.js";
import {
  INGEST_DECLARED_WRITE_SCOPES,
  renderIngest,
  renderValidationFinding,
  runIngest,
} from "./ingest.js";
import type { IngestOptions, IngestResultV1 } from "./ingest.js";
import { runInit } from "./init.js";
import { runReview } from "./review.js";
import { createCommandFixture, exists, removeCommandFixtures } from "./testing.js";
import type { CommandFixture } from "./testing.js";
import { loadOrCreateRedactionKey } from "../context.js";
import { run } from "../main.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

/** Synthetic, like every fixture here: no real client, project or repository. */
const PROJECT_DIRECTORY = "Sample Project";
const CLAUDE = "/synthetic/bin/claude";
const CODEX = "/synthetic/bin/codex";
const SECRET = `ghp_${"a".repeat(36)}`;

/** BEL, and RIGHT-TO-LEFT OVERRIDE: one invisible, one that reorders a line. */
const BELL = "\u0007";
const OVERRIDE = "\u202E";

/**
 * The four transactions one capture produces, in the order the four-transaction
 * ladder fixes them in. Transcribed rather than imported: the point of the
 * assertion is that the command's ladder matches a list written down
 * independently of it.
 */
const LADDER = [
  "ingest-stage",
  "ingest-apply",
  "ingest-reindex",
  "ingest-ingested",
] as const;

interface VendorCall {
  readonly executable: string;
  readonly args: readonly string[];
}

/**
 * What the fake vendor writes to stdout. An object is serialized into the
 * dialect that vendor's adapter parses; a string is written verbatim, which is
 * how a malformed result is staged.
 */
type VendorReply = unknown;

interface Seeded {
  readonly id: string;
  readonly path: string;
}

type IngestOutcome = CliResult<IngestResultV1>;

interface IngestFixture extends CommandFixture {
  readonly quarantine: string;
  readonly content: string;
  readonly calls: readonly VendorCall[];
  /** What every vendor call answers with, from here on. */
  reply(respond: (call: VendorCall) => VendorReply): void;
  /** Runs while a vendor call is in flight, so mid-run state is observable. */
  duringCall(observe: () => Promise<void>): void;
  seedAccepted(text: string): Promise<Seeded>;
  statusOf(id: string): Promise<CaptureStatus>;
  run(options?: IngestOptions): Promise<IngestOutcome>;
}

interface FixtureOptions {
  readonly claude?: boolean;
  readonly codex?: boolean;
  readonly interruptAfter?: TransactionPhase;
  readonly interruptKind?: string;
  /**
   * A `[brain]` section naming a content root that is not `content`, written
   * after `init` and applied by renaming the directory `init`'s template
   * created. Every glob this command declares is vault-relative and has to be
   * resolved against *this* value; a fixture that only ever uses the default
   * cannot tell a resolution from a passthrough.
   */
  readonly contentRoot?: string;
}

function discovery(name: AgentName, executable: string | null): AgentDiscovery {
  return {
    name,
    installed: executable !== null,
    executablePath: executable,
    version: null,
  };
}

/** A proposal that proposes nothing, which is a correct answer (spec §6.1). */
function nothingProposed(): VendorReply {
  return { schemaVersion: 1, notes: [] };
}

function proposedNote(
  captureId: string,
  path: string,
  title: string,
  body: string,
): ProposedNote {
  return {
    path,
    contents: [
      "---",
      "schemaVersion: 1",
      `title: ${title}`,
      "type: knowledge-note",
      "created: 2026-07-30",
      "tags: [dev]",
      `summary: ${title} is what this note records.`,
      "stage: emerging",
      "author: agent",
      "reviewed: null",
      "---",
      "",
      body,
      "",
    ].join("\n"),
    sourceCaptureId: captureId,
  };
}

function oneNote(
  captureId: string,
  path = "DEV/proposed-note.md",
  title = "Proposed note",
  body = "A note the ingest fixture proposes.",
): VendorReply {
  return {
    schemaVersion: 1,
    notes: [proposedNote(captureId, path, title, body)],
  };
}

/**
 * A real installation, produced by the real `init`, holding real captures
 * written by the real `capture` and moved to `accepted` by the real `review`.
 * The only fake is the vendor process, which is **scripted rather than
 * spawned**: Task 17 is the one task that spends a real model call.
 */
async function installedFixture(
  label: string,
  options: FixtureOptions = {},
): Promise<IngestFixture> {
  const calls: VendorCall[] = [];
  let respond: (call: VendorCall) => VendorReply = () => nothingProposed();
  let observe: (() => Promise<void>) | null = null;

  const runner: ProcessRunner = {
    run: async (request): Promise<ProcessResult> => {
      const call = { executable: request.executable, args: [...request.args] };
      calls.push(call);
      const hook = observe;
      if (hook !== null) await hook();

      const reply = respond(call);
      if (typeof reply === "string") {
        return { stdout: reply, stderr: "", exitCode: 0, signal: null, timedOut: false };
      }
      /**
       * Each vendor's own dialect, because each adapter parses a different one:
       * Codex streams JSONL and `invokeCodex` takes the last line that parses to
       * an object, while `invokeClaude` parses stdout as one JSON document. A
       * fake that spoke one dialect to both would let a bridge that confused
       * them pass.
       */
      const document = JSON.stringify(reply);
      const stdout =
        call.executable === CODEX
          ? [JSON.stringify({ type: "item.started" }), document, ""].join("\n")
          : document;
      return { stdout, stderr: "", exitCode: 0, signal: null, timedOut: false };
    },
  };

  const fixture = await createCommandFixture(label, {
    runner,
    agents: {
      claude: discovery("claude", options.claude === false ? null : CLAUDE),
      codex: discovery("codex", options.codex === false ? null : CODEX),
    },
    ...(options.interruptAfter === undefined
      ? {}
      : { interruptAfter: options.interruptAfter }),
    ...(options.interruptKind === undefined
      ? {}
      : { interruptKind: options.interruptKind }),
  });

  const installed = await runInit(fixture.context, ACCEPTED);
  expect(installed.ok, "the fixture must install before it ingests").toBe(true);

  const project = join(fixture.root, PROJECT_DIRECTORY);
  await nodeFs.mkdir(project, { recursive: true, mode: 0o700 });
  /** `init` verifies the installation; only what `ingest` spawns is at issue. */
  calls.length = 0;

  const contentRoot = options.contentRoot ?? "content";
  if (options.contentRoot !== undefined) {
    const config = loadConfig(
      await nodeFs.readFile(fixture.paths.configFile, "utf8"),
    );
    await nodeFs.writeFile(
      fixture.paths.configFile,
      serializeConfig({
        ...config,
        brain: { ...DEFAULT_BRAIN_CONFIG, contentRoot: options.contentRoot },
      }),
      { mode: 0o600 },
    );
    await nodeFs.rename(
      join(fixture.paths.brain, "content"),
      join(fixture.paths.brain, options.contentRoot),
    );
  }

  const content = join(fixture.paths.brain, contentRoot);
  const quarantine = join(content, "_raw", "quarantine");

  const statusOf = async (id: string): Promise<CaptureStatus> => {
    const fileName = `${id}.md`;
    const text = await nodeFs.readFile(join(quarantine, fileName), "utf8");
    const key = loadOrCreateRedactionKey(fixture.paths.stateDir);
    const outcome = parseCaptureFile(fileName, text, (value) =>
      redactText(value, key),
    );
    /**
     * `failed` is derived rather than read: a capture whose own envelope cannot
     * be parsed has no status line worth trusting, and spec §5.5's `any →
     * failed` row is the product *reporting* that rather than writing it.
     */
    return outcome.ok ? outcome.envelope.status : "failed";
  };

  return {
    ...fixture,
    quarantine,
    content,
    calls,
    reply: (next): void => {
      respond = next;
    },
    duringCall: (next): void => {
      observe = next;
    },
    seedAccepted: async (text: string): Promise<Seeded> => {
      const captured = await runCapture(
        fixture.context,
        { text },
        { cwd: () => project, detect: detectSourceAgent },
      );
      expect(captured.ok, `the fixture must capture ${text}`).toBe(true);
      if (!captured.ok) throw new Error("the fixture could not seed a capture");
      const accepted = await runReview(fixture.context, {
        id: captured.data.captureId,
        decision: "accept",
      });
      expect(accepted.ok, "the fixture must accept what it captured").toBe(true);
      return { id: captured.data.captureId, path: captured.data.path };
    },
    statusOf,
    run: (opts: IngestOptions = {}) => runIngest(fixture.context, opts),
  };
}

/** Moves a capture's status back the way a hand edit in Obsidian would. */
async function resetToAccepted(path: string): Promise<void> {
  const before = await nodeFs.readFile(path, "utf8");
  const after = before.replace(/^status: .*$/mu, "status: accepted");
  expect(after, `the reset must change ${basename(path)}`).not.toBe(before);
  await nodeFs.writeFile(path, after, { mode: 0o600 });
}

/** The ingest transaction kinds this run produced, in journal order. */
async function ladderOf(fixture: CommandFixture): Promise<readonly string[]> {
  const journalDir = join(fixture.paths.stateDir, "transactions");
  const entries = (await nodeFs.readdir(journalDir))
    .filter((name) => name.endsWith(".json"))
    .sort();
  /**
   * `init` wrote one before any of these cases ran, so an empty read here is a
   * fixture that never installed rather than a run that wrote nothing — the
   * negative direction of "a gate that can pass by scanning nothing is not a
   * gate".
   */
  expect(entries.length, "a sweep over no journals is not a sweep").toBeGreaterThan(0);

  const kinds: string[] = [];
  for (const entry of entries) {
    const journal = await fixture.context.transactions.read(
      entry.slice(0, -".json".length),
    );
    if (journal.kind.startsWith("ingest-")) kinds.push(journal.kind);
  }
  return kinds;
}

/** Every file under the content root, content-root-relative and sorted. */
async function vaultNotes(fixture: IngestFixture): Promise<readonly string[]> {
  const entries = await nodeFs.readdir(fixture.content, {
    recursive: true,
    withFileTypes: true,
  });
  const files = entries.filter((entry) => entry.isFile());
  expect(files.length, "a sweep over nothing is not a sweep").toBeGreaterThan(0);
  return files
    .map((entry) =>
      join(entry.parentPath, entry.name).slice(fixture.content.length + 1),
    )
    .sort();
}

/** Every byte this run left anywhere in the vault, concatenated. */
async function readWholeVault(fixture: IngestFixture): Promise<string> {
  const entries = await nodeFs.readdir(fixture.paths.brain, {
    recursive: true,
    withFileTypes: true,
  });
  const files = entries.filter((entry) => entry.isFile());
  expect(files.length, "a sweep over nothing is not a sweep").toBeGreaterThan(0);
  const contents = await Promise.all(
    files.map((entry) =>
      nodeFs.readFile(join(entry.parentPath, entry.name), "latin1"),
    ),
  );
  return contents.join("\n");
}

function argumentAfter(call: VendorCall | undefined, flag: string): string | null {
  if (call === undefined) return null;
  const index = call.args.indexOf(flag);
  return index < 0 ? null : (call.args[index + 1] ?? null);
}

function allowedTools(call: VendorCall | undefined): readonly string[] {
  if (call === undefined) return [];
  const index = call.args.indexOf("--allowedTools");
  return index < 0 ? [] : call.args.slice(index + 1);
}

function dataOf(result: IngestOutcome): IngestResultV1 {
  expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
  if (!result.ok) throw new Error("the run did not succeed");
  return result.data;
}

function byId(left: Seeded, right: Seeded): number {
  return left.id < right.id ? -1 : 1;
}

describe("runIngest, the status ladder", () => {
  it("moves accepted → staging on entering the transaction, and → ingested only after finalize", async () => {
    const fixture = await installedFixture("ingest-ladder");
    const seeded = await fixture.seedAccepted("an observation worth a note");
    fixture.reply(() => oneNote(seeded.id));

    const statuses: CaptureStatus[] = [await fixture.statusOf(seeded.id)];
    fixture.duringCall(async () => {
      statuses.push(await fixture.statusOf(seeded.id));
    });

    const result = await fixture.run();
    statuses.push(await fixture.statusOf(seeded.id));

    expect(dataOf(result).applied.map((capture) => capture.captureId)).toStrictEqual([
      seeded.id,
    ]);
    expect(statuses).toStrictEqual(["accepted", "staging", "ingested"]);
    /**
     * Four transactions, in this order, because they answer to two different
     * ownership regimes and the executor's lock is per-execution. `ingested` is
     * last because a capture may not claim it before the note is findable.
     */
    expect(await ladderOf(fixture)).toStrictEqual([...LADDER]);
  });

  it.each([
    /**
     * A proposal that fails its own schema is malformed model output, which is
     * an operational failure. A secret coming back from a model, and a path
     * trying to leave the vault, are security refusals — different in kind from
     * a mistake, and collapsing all three either way would make every model
     * mistake read as an attempted escape or every escape read as a mistake.
     */
    ["schema-and-frontmatter", EXIT_CODES.operationalFailure],
    ["secret-scan", EXIT_CODES.securityRefusal],
    ["write-scope", EXIT_CODES.securityRefusal],
  ] as const)("leaves the capture accepted and retryable when %s refuses", async (
    validator,
    code,
  ) => {
    const fixture = await installedFixture(`ingest-refuse-${validator}`);
    const seeded = await fixture.seedAccepted(`an observation for ${validator}`);
    const before = await vaultNotes(fixture);

    fixture.reply(() => {
      if (validator === "schema-and-frontmatter") {
        return {
          schemaVersion: 1,
          notes: [
            {
              path: "DEV/broken.md",
              contents: "---\nschemaVersion: 1\ntitle: only a title\n---\n\nbody\n",
              sourceCaptureId: seeded.id,
            },
          ],
        };
      }
      if (validator === "secret-scan") {
        return oneNote(seeded.id, "DEV/leaky.md", "Leaky note", `token ${SECRET}`);
      }
      return oneNote(seeded.id, "_raw/quarantine/evil.md", "Evil note");
    });

    const result = await fixture.run();

    expect(result.code).toBe(code);
    expect(result.ok).toBe(false);
    expect(await fixture.statusOf(seeded.id)).toBe("accepted");
    expect(await vaultNotes(fixture)).toStrictEqual(before);
    /** The refusal names the validator that fired, not only an exit code. */
    if (result.ok) return;
    expect(result.error.message).toContain(validator);
  });

  /**
   * A secret the model handed back reaches neither the vault nor a diagnostic:
   * the finding names the class and the file, never the value.
   */
  it("keeps a secret the model returned out of the vault and out of the report", async () => {
    const fixture = await installedFixture("ingest-secret");
    const seeded = await fixture.seedAccepted("an observation about tokens");
    fixture.reply(() =>
      oneNote(seeded.id, "DEV/leaky.md", "Leaky note", `token ${SECRET}`),
    );

    const result = await fixture.run();

    expect(result.code).toBe(EXIT_CODES.securityRefusal);
    expect(await readWholeVault(fixture)).not.toContain(SECRET);
    expect(formatJsonResult(result)).not.toContain(SECRET);
    expect(formatJsonResult(result)).not.toContain("ghp_");
  });

  it("rolls a capture back from staging to accepted, never to failed", async () => {
    const fixture = await installedFixture("ingest-apply-throws", {
      interruptAfter: "staged",
      interruptKind: "ingest-apply",
    });
    const seeded = await fixture.seedAccepted("an observation whose apply fails");
    fixture.reply(() => oneNote(seeded.id));

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    expect(await fixture.statusOf(seeded.id)).toBe("accepted");
    expect(await ladderOf(fixture)).toStrictEqual([
      "ingest-stage",
      "ingest-apply",
      "ingest-rollback",
    ]);
  });

  /**
   * The other half of the rollback rule, and the half that is easy to get
   * wrong: once the notes are on disk a retry can no longer succeed, so
   * `accepted` would be a lie — a second run would meet its own output and
   * refuse. The capture is left at `staging`, which is the inert residual a
   * crash between the apply and the status write produces, reached here by a
   * caught failure instead.
   */
  it("does not roll back to accepted once the notes have landed", async () => {
    const fixture = await installedFixture("ingest-after-apply", {
      interruptAfter: "staged",
      interruptKind: "ingest-ingested",
    });
    const seeded = await fixture.seedAccepted("an observation applied then stuck");
    fixture.reply(() => oneNote(seeded.id, "DEV/stuck.md", "Stuck note"));

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    expect(await fixture.statusOf(seeded.id)).toBe("staging");
    expect(await ladderOf(fixture)).toStrictEqual([
      "ingest-stage",
      "ingest-apply",
      "ingest-reindex",
      "ingest-ingested",
    ]);
    /** The note it did write is still there, which is why `accepted` is wrong. */
    expect(await vaultNotes(fixture)).toContain("DEV/stuck.md");
  });

  /**
   * **The apply that wrote its notes and then failed to verify.** `execute`
   * writes every mutation and transitions to `applied` *before* `verifyDesired`
   * runs, and that call can raise `TransactionConflictError`
   * (`packages/core/src/transactions/executor.ts:586-611`) with the files already
   * on disk — so a throw out of `applyNotes` does **not** mean "wrote nothing".
   * Rolling the capture back to `accepted` there sends the next run at a path
   * that is now occupied, which `applyNotes` refuses permanently, while the
   * recovery text tells the user this run wrote nothing.
   *
   * Driven at the `applied` phase because that is the first phase the mutations
   * exist at, and by interruption because that is the shape of the event: the
   * verify failing and the process dying between the two are the same question
   * asked of the same code.
   */
  it("leaves a capture at staging when the apply wrote its notes and then threw", async () => {
    const fixture = await installedFixture("ingest-apply-verified-late", {
      interruptAfter: "applied",
      interruptKind: "ingest-apply",
    });
    const seeded = await fixture.seedAccepted("an observation applied then unverified");
    fixture.reply(() => oneNote(seeded.id, "DEV/unverified.md", "Unverified note"));

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    /** The notes are there, which is what makes `accepted` a lie. */
    expect(await vaultNotes(fixture)).toContain("DEV/unverified.md");
    expect(await fixture.statusOf(seeded.id)).toBe("staging");
    if (result.ok) return;
    expect(result.error.message).toContain("partly applied, left at staging");
    expect(result.error.message).toContain("DEV/unverified.md");
  });

  /**
   * The other side of that judgement, and the reason it is not simply "any
   * throw means applied": a failure *before* the mutations exist leaves the
   * vault untouched, and the capture must go back to `accepted` so the next run
   * retries it. `staged` is the last phase at which nothing has been written.
   */
  it("still rolls back to accepted when the apply threw before writing anything", async () => {
    const fixture = await installedFixture("ingest-apply-before-writing", {
      interruptAfter: "staged",
      interruptKind: "ingest-apply",
    });
    const seeded = await fixture.seedAccepted("an observation whose apply never wrote");
    fixture.reply(() => oneNote(seeded.id, "DEV/never-written.md", "Never written"));

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    expect(await vaultNotes(fixture)).not.toContain("DEV/never-written.md");
    expect(await fixture.statusOf(seeded.id)).toBe("accepted");
  });

  /**
   * A capture parked at `staging` with its notes already written is **not the
   * same event as a refusal that wrote nothing**, and the report has to say so:
   * `selectCaptures` never selects `staging`, so no later run will touch it, and
   * a line labelled `refused` beside a recovery promising a retry would tell a
   * user their vault was untouched and their capture queued — both false.
   */
  it("labels a post-apply failure as partly applied, and promises it no retry", async () => {
    const fixture = await installedFixture("ingest-partly-applied-report", {
      interruptAfter: "staged",
      interruptKind: "ingest-ingested",
    });
    const seeded = await fixture.seedAccepted("an observation applied then stuck");
    fixture.reply(() => oneNote(seeded.id, "DEV/stuck.md", "Stuck note"));

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("partly applied, left at staging");
    expect(result.error.message).not.toContain(`${seeded.id} refused`);
    /** It names the notes the user now has, because their vault did change. */
    expect(result.error.message).toContain("already in the vault");
    expect(result.error.message).toContain("DEV/stuck.md");
    /**
     * And the run-level recovery describes this state rather than only its
     * opposite: the old text said every refused capture "will be tried again",
     * which is the one thing that cannot happen from `staging`.
     */
    const recovery = result.error.recovery ?? "";
    expect(recovery).toContain("partly applied");
    expect(recovery).toContain("staging");
    expect(recovery).toContain("ingest never selects staging");
    expect(await fixture.statusOf(seeded.id)).toBe("staging");
    /**
     * And it describes **this** run rather than every run: no capture here was
     * left untouched, so the sentence promising a retry is absent. A recovery
     * that lists both states always is a recovery in which one of the two lines
     * is a lie on every run.
     */
    expect(recovery).not.toContain("wrote nothing");
  });

  /**
   * The mirror of the case above, and the state neither recovery line used to
   * describe: a capture refused *before* the apply is untouched and retryable,
   * and must not be told its notes are already in the vault.
   */
  it("gives a refusal that wrote nothing the recovery for that state alone", async () => {
    const fixture = await installedFixture("ingest-recovery-split");
    const seeded = await fixture.seedAccepted("an observation with a bad reply");
    fixture.reply(() => "not json at all");

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const recovery = result.error.recovery ?? "";
    expect(recovery).toContain("wrote nothing");
    expect(recovery).not.toContain("already in the vault");
    expect(await fixture.statusOf(seeded.id)).toBe("accepted");
  });

  /**
   * The distinction that is load-bearing and easy to collapse: **`failed` is not
   * what an ingest refusal produces.** It describes a capture whose *own*
   * envelope is unreadable, which no retry can fix without the user looking at
   * the file — so nothing is written to it and the run reports it rather than
   * repairing it.
   */
  it("marks failed only when the capture's own envelope cannot be parsed", async () => {
    const fixture = await installedFixture("ingest-failed");
    const first = await fixture.seedAccepted("an observation about to break");
    const second = await fixture.seedAccepted("an observation that survives");
    const [broken, readable] = [first, second];
    await nodeFs.writeFile(broken.path, "not a capture at all\n", { mode: 0o600 });
    fixture.reply(() => oneNote(readable.id));

    const result = await fixture.run();

    const reported = new Map(
      dataOf(result).captures.map((capture) => [capture.captureId, capture.status]),
    );
    expect(reported.get(broken.id)).toBe("failed");
    expect(reported.get(readable.id)).toBe("ingested");
    /** Reported, never rewritten: the bytes the user has to look at are theirs. */
    expect(await nodeFs.readFile(broken.path, "utf8")).toBe("not a capture at all\n");
    expect(result.ok && result.warnings.join(" ")).toContain(broken.id);
  });

  it("reindexes after applying, so the note is findable in the next invocation", async () => {
    const fixture = await installedFixture("ingest-reindexes");
    const seeded = await fixture.seedAccepted("an observation worth indexing");
    fixture.reply(() => oneNote(seeded.id, "DEV/findable.md", "Findable note"));

    const result = await fixture.run();

    expect(dataOf(result).applied).toHaveLength(1);
    const index = await nodeFs.readFile(
      join(fixture.content, "_indexes", "index.json"),
      "utf8",
    );
    expect(index).toContain("DEV/findable.md");
  });

  it("processes captures in captureId order, so two runs do the same work in the same sequence", async () => {
    const fixture = await installedFixture("ingest-order");
    const seeded = [
      await fixture.seedAccepted("the first observation"),
      await fixture.seedAccepted("the second observation"),
      await fixture.seedAccepted("the third observation"),
    ];
    expect(new Set(seeded.map((capture) => capture.id)).size).toBe(3);
    fixture.reply(() => nothingProposed());

    const first = dataOf(await fixture.run());
    for (const capture of seeded) await resetToAccepted(capture.path);
    const second = dataOf(await fixture.run());

    expect(first.order).toHaveLength(3);
    expect(first.order).toStrictEqual([...first.order].sort());
    expect(second.order).toStrictEqual(first.order);
  });

  it("bounds one invocation with --limit, leaving the rest accepted", async () => {
    const fixture = await installedFixture("ingest-limit");
    const order = [
      await fixture.seedAccepted("the first observation"),
      await fixture.seedAccepted("the second observation"),
      await fixture.seedAccepted("the third observation"),
    ].sort(byId);
    fixture.reply(() => nothingProposed());

    const result = await fixture.run({ limit: 1 });

    expect(dataOf(result).applied).toHaveLength(1);
    const statuses = await Promise.all(
      order.map((capture) => fixture.statusOf(capture.id)),
    );
    expect(statuses).toStrictEqual(["ingested", "accepted", "accepted"]);
  });

  it("ingests nothing, and refuses nothing, when no capture is accepted", async () => {
    const fixture = await installedFixture("ingest-empty");

    const result = await fixture.run();

    expect(result.code).toBe(EXIT_CODES.success);
    expect(dataOf(result).order).toStrictEqual([]);
    expect(fixture.calls).toStrictEqual([]);
  });
});

describe("runIngest, a batch that is not uniform", () => {
  /**
   * **Containment, and the head-of-line blocking it prevents.** Without it the
   * middle capture's refusal propagates out of the loop and the third capture is
   * never attempted — and since the refused one stays `accepted` and sorts in the
   * same place next run, it blocks everything behind it forever, with `--limit`
   * bounding the same blocked head of the same list.
   *
   * "Nothing is left blocking" is observable as the second run's `order`: it
   * holds the refused capture **and nothing else**, because the two that ingested
   * are done rather than waiting behind it.
   */
  it("ingests around a capture that refuses, and blocks nothing behind it", async () => {
    const fixture = await installedFixture("ingest-mixed-batch");
    const seeded = [
      await fixture.seedAccepted("the first observation"),
      await fixture.seedAccepted("the second observation"),
      await fixture.seedAccepted("the third observation"),
    ].sort(byId);
    const middle = seeded[1];
    expect(middle, "the batch must have three distinct captures").toBeDefined();
    if (middle === undefined) return;

    const cleanNote = (id: string): VendorReply =>
      oneNote(id, `DEV/note-${id}.md`, `Note ${id}`, `The note for ${id}.`);
    fixture.reply((call) => {
      const target = seeded.find((capture) =>
        call.args.join("\n").includes(capture.id),
      );
      if (target === undefined) return nothingProposed();
      return target.id === middle.id
        ? oneNote(target.id, "DEV/leaky.md", "Leaky note", `token ${SECRET}`)
        : cleanNote(target.id);
    });

    const first = await fixture.run();

    expect(first.ok).toBe(false);
    if (first.ok) return;
    /** The refusal is the secret scan, so the run's code is 5 rather than 1. */
    expect(first.code).toBe(EXIT_CODES.securityRefusal);
    const statuses = await Promise.all(
      seeded.map((capture) => fixture.statusOf(capture.id)),
    );
    expect(statuses).toStrictEqual(["ingested", "accepted", "ingested"]);
    /** The message is the payload: every selected capture appears in it once. */
    for (const capture of seeded) {
      expect(first.error.message, capture.id).toContain(capture.id);
    }
    expect(first.error.message).toContain("ingested");
    expect(first.error.message).toContain("refused (exit 5)");
    expect(first.error.message).toContain("secret-scan");
    const notes = await vaultNotes(fixture);
    expect(notes).toContain(`DEV/note-${seeded[0]?.id ?? ""}.md`);
    expect(notes).toContain(`DEV/note-${seeded[2]?.id ?? ""}.md`);

    /** Retried on its own, with nothing queued behind it. */
    fixture.reply(() => cleanNote(middle.id));
    const second = await fixture.run();

    expect(dataOf(second).order).toStrictEqual([middle.id]);
    expect(dataOf(second).applied).toHaveLength(1);
    expect(await fixture.statusOf(middle.id)).toBe("ingested");
  });

  /**
   * The reason the code is the **severest** refusal rather than the first one in
   * order: here the operational refusal sorts first and the security refusal
   * sorts last, so `refused[0].code` would report 1 and hide the escape attempt.
   */
  it("reports the severest refusal, not the one that happened first", async () => {
    const fixture = await installedFixture("ingest-severest");
    const seeded = [
      await fixture.seedAccepted("the first observation"),
      await fixture.seedAccepted("the second observation"),
    ].sort(byId);
    const [earlier, later] = seeded;
    expect(earlier?.id).toBeDefined();
    expect(later?.id).toBeDefined();
    if (earlier === undefined || later === undefined) return;

    fixture.reply((call) => {
      const prompt = call.args.join("\n");
      if (prompt.includes(later.id)) {
        return oneNote(later.id, "DEV/leaky.md", "Leaky note", `token ${SECRET}`);
      }
      return {
        schemaVersion: 1,
        notes: [
          {
            path: "DEV/broken.md",
            contents: "---\nschemaVersion: 1\ntitle: only a title\n---\n\nbody\n",
            sourceCaptureId: earlier.id,
          },
        ],
      };
    });

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.securityRefusal);
    expect(result.error.message).toContain("refused (exit 1)");
    expect(result.error.message).toContain("refused (exit 5)");
    /** Both are still accepted, and both were attempted. */
    expect(await fixture.statusOf(earlier.id)).toBe("accepted");
    expect(await fixture.statusOf(later.id)).toBe("accepted");
    expect(fixture.calls).toHaveLength(2);
  });

  /**
   * `order` is the set this invocation **selected**, not the set that ingested.
   * The two were the same expression until a selected capture could end
   * somewhere other than `ingested`, and the field's docblock already said the
   * former.
   */
  it("puts every selected capture in order, whatever became of it", async () => {
    const fixture = await installedFixture("ingest-order-is-selection");
    const seeded = [
      await fixture.seedAccepted("the first observation"),
      await fixture.seedAccepted("the second observation"),
    ].sort(byId);
    fixture.reply(() => nothingProposed());

    const result = await fixture.run();

    expect(dataOf(result).order).toStrictEqual(seeded.map((capture) => capture.id));
  });
});

describe("runIngest, resolved against this vault rather than a default", () => {
  /**
   * **The per-install resolution, driven.** Every other fixture uses the default
   * `contentRoot`, where `resolveScopeGlob("content/**", brainConfig)` returns
   * its input unchanged — so all of them stay green if the resolution is deleted
   * and the declared globs are used raw. A user whose `config.toml` names a
   * different root would then have `write-scope` refuse every note the model
   * proposes, which is a total silent failure of the command.
   */
  it("resolves the declared write scopes against a non-default contentRoot", async () => {
    const fixture = await installedFixture("ingest-content-root", {
      contentRoot: "vault",
    });
    const seeded = await fixture.seedAccepted("an observation in a renamed root");
    fixture.reply(() => oneNote(seeded.id, "DEV/renamed.md", "Renamed root note"));

    const result = await fixture.run();

    expect(dataOf(result).applied).toHaveLength(1);
    expect(await fixture.statusOf(seeded.id)).toBe("ingested");
    expect(await vaultNotes(fixture)).toContain("DEV/renamed.md");
    /**
     * And there is no `content/` left to have matched by accident, so a
     * hard-coded root could not have produced this pass.
     */
    expect(await exists(join(fixture.paths.brain, "content"))).toBe(false);
    const index = await nodeFs.readFile(
      join(fixture.content, "_indexes", "index.json"),
      "utf8",
    );
    expect(index).toContain("DEV/renamed.md");
  });
});

describe("runIngest, the agent call", () => {
  it("invokes the first installed vendor in the fixed order claude, then codex", async () => {
    const fixture = await installedFixture("ingest-default-vendor");
    const seeded = await fixture.seedAccepted("an observation for the default");
    fixture.reply(() => oneNote(seeded.id));

    const result = await fixture.run();

    expect(dataOf(result).agent).toBe("claude");
    expect(fixture.calls.map((call) => call.executable)).toStrictEqual([CLAUDE]);
  });

  it("falls to codex when claude is not installed", async () => {
    const fixture = await installedFixture("ingest-codex-fallback", {
      claude: false,
    });
    const seeded = await fixture.seedAccepted("an observation for codex");
    fixture.reply(() => oneNote(seeded.id));

    const result = await fixture.run();

    expect(dataOf(result).agent).toBe("codex");
    expect(fixture.calls.map((call) => call.executable)).toStrictEqual([CODEX]);
  });

  it("honours --agent, so a second vendor is reachable without uninstalling one", async () => {
    const fixture = await installedFixture("ingest-agent-flag");
    const seeded = await fixture.seedAccepted("an observation for a named agent");
    fixture.reply(() => oneNote(seeded.id));

    const result = await fixture.run({ agent: "codex" });

    expect(dataOf(result).agent).toBe("codex");
    expect(fixture.calls.map((call) => call.executable)).toStrictEqual([CODEX]);
  });

  /**
   * Neither vendor installed is the `capability-missing` refusal the `ingest`
   * contract declares, in the only sense this command can honour — and it is
   * answered from the two-gate table rather than from a probe, because probing
   * is opt-in and would spend a process to learn what discovery already said.
   */
  it("refuses at exit 4 when neither vendor is installed, without probing", async () => {
    const fixture = await installedFixture("ingest-no-vendor", {
      claude: false,
      codex: false,
    });
    const seeded = await fixture.seedAccepted("an observation with no agent");

    const result = await fixture.run();

    expect(result.code).toBe(EXIT_CODES.capabilityUnavailable);
    expect(fixture.calls).toStrictEqual([]);
    expect(await fixture.statusOf(seeded.id)).toBe("accepted");
  });

  it("refuses at exit 4 when the named vendor is the one that is missing", async () => {
    const fixture = await installedFixture("ingest-named-missing", {
      claude: false,
    });
    await fixture.seedAccepted("an observation for a missing agent");

    const result = await fixture.run({ agent: "claude" });

    expect(result.code).toBe(EXIT_CODES.capabilityUnavailable);
    expect(fixture.calls).toStrictEqual([]);
  });

  it.each(["Claude", "gemini", "", "claude codex"])(
    "refuses %s, which is not a vendor this product invokes",
    async (agent) => {
      const fixture = await installedFixture(
        `ingest-bad-agent-${agent.replace(/\W/gu, "-") || "empty"}`,
      );
      await fixture.seedAccepted("an observation for a bad agent");

      const result = await fixture.run({ agent });

      expect(result.code).toBe(EXIT_CODES.invalidInput);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("claude");
      expect(fixture.calls).toStrictEqual([]);
    },
  );

  /**
   * Spec §3.3 and §6.1: the model is invoked with **zero** declared write
   * scopes, and each vendor's sandbox follows from that count rather than from
   * an argument. Codex derives `-s read-only`; the Claude side passes no write
   * tool at all.
   */
  it("gives codex a read-only sandbox and no writable directory", async () => {
    const fixture = await installedFixture("ingest-codex-sandbox", {
      claude: false,
    });
    const seeded = await fixture.seedAccepted("an observation about sandboxes");
    fixture.reply(() => oneNote(seeded.id));

    await fixture.run();

    const call = fixture.calls[0];
    expect(call?.args).toContain("--json");
    expect(argumentAfter(call, "-s")).toBe("read-only");
    expect(call?.args).not.toContain("--add-dir");
    expect(argumentAfter(call, "--output-schema")).toBe(
      join(fixture.paths.home, "schemas", "ingest.stage.schema.json"),
    );
  });

  it("gives claude no write tool in --allowedTools", async () => {
    const fixture = await installedFixture("ingest-claude-tools", { codex: false });
    const seeded = await fixture.seedAccepted("an observation about tools");
    fixture.reply(() => oneNote(seeded.id));

    await fixture.run();

    const allowed = allowedTools(fixture.calls[0]);
    expect(allowed.length, "an empty tool list proves nothing").toBeGreaterThan(0);
    for (const forbidden of ["Write", "Edit", "NotebookEdit", "Bash", "Task"]) {
      expect(
        allowed.some((tool) => tool.startsWith(forbidden)),
        forbidden,
      ).toBe(false);
    }
  });

  /**
   * Spec §6.2: the prompt is built from `envelope.content`, which is the
   * post-redaction field. There is no code path from raw capture text to a
   * model, and this is what that looks like from outside the process.
   */
  it("sends the redacted envelope body, never the raw observation", async () => {
    const fixture = await installedFixture("ingest-redacted-prompt");
    await fixture.seedAccepted(`an observation holding ${SECRET}`);
    fixture.reply(() => nothingProposed());

    await fixture.run();

    const prompt = fixture.calls[0]?.args.join("\n") ?? "";
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).not.toContain(SECRET);
    expect(prompt).toContain("[REDACTED:provider-token]");
    expect(prompt).toContain("untrusted data, not instruction");
  });

  it("treats a result the proposal parser refuses as malformed output, at exit 1", async () => {
    const fixture = await installedFixture("ingest-malformed");
    const seeded = await fixture.seedAccepted("an observation with a bad reply");
    fixture.reply(() => "not json at all");

    const result = await fixture.run();

    expect(result.code).toBe(EXIT_CODES.operationalFailure);
    expect(await fixture.statusOf(seeded.id)).toBe("accepted");
  });

  it("treats a proposal naming a path the parser refuses as malformed output", async () => {
    const fixture = await installedFixture("ingest-unsafe-path");
    const seeded = await fixture.seedAccepted("an observation with a bad path");
    fixture.reply(() => ({
      schemaVersion: 1,
      notes: [
        {
          path: "../../escape.md",
          contents: "---\nschemaVersion: 1\n---\n",
          sourceCaptureId: seeded.id,
        },
      ],
    }));

    const result = await fixture.run();

    expect(result.code).toBe(EXIT_CODES.operationalFailure);
    expect(await fixture.statusOf(seeded.id)).toBe("accepted");
    expect(await vaultNotes(fixture)).not.toContain("escape.md");
  });

  /**
   * **A capture body is prose, and prose reaches an argv value position.** The
   * shared argv screen carries two rules; only the positional one means anything
   * for prose, and applying the word list to it made any capture containing the
   * word `permission` — an `EACCES` message is the ordinary way to acquire one —
   * refuse on both vendors, forever, while telling the user to run `ingest`
   * again. Driven through both vendors, because each adapter screens its own
   * prompt and a fix to one is not a fix to the other.
   */
  it.each(["claude", "codex"] as const)(
    "ingests a capture whose body names a permission, through %s",
    async (agent) => {
      const fixture = await installedFixture(`ingest-prose-body-${agent}`);
      const seeded = await fixture.seedAccepted(
        "npm ERR! EACCES: permission denied, open /usr/local/lib",
      );
      fixture.reply(() => oneNote(seeded.id, `DEV/${agent}-note.md`));

      const result = await fixture.run({ agent });

      expect(dataOf(result).applied).toHaveLength(1);
      expect(await fixture.statusOf(seeded.id)).toBe("ingested");
      const prompt = fixture.calls.map((call) => call.args.join("\n")).join("\n");
      expect(prompt, "the body must have reached the model").toContain(
        "permission denied",
      );
    },
  );

  /**
   * The other half of the same seam: a value position that *does* keep the word
   * list, and whose refusal detail used to be discarded. `workingRoot` is this
   * vault's own content root, so a user whose vault path contains one of the
   * three words meets this — which is why the message has to say which value was
   * refused rather than only that something was.
   */
  it("names the value a vendor refusal was about, rather than dropping the reason", async () => {
    const fixture = await installedFixture("ingest-danger-in-the-path");
    const seeded = await fixture.seedAccepted("an observation under a danger path");
    fixture.reply(() => oneNote(seeded.id));

    const result = await fixture.run({ agent: "codex" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("refused");
    expect(result.error.message).toContain("the working root");
    /** And nothing was spawned, so the detail is the only account of the run. */
    expect(fixture.calls).toStrictEqual([]);
    expect(await fixture.statusOf(seeded.id)).toBe("accepted");
  });

  it("makes one agent call per capture, so a prompt is bounded by one envelope", async () => {
    const fixture = await installedFixture("ingest-one-call-each");
    await fixture.seedAccepted("the first observation");
    await fixture.seedAccepted("the second observation");
    fixture.reply(() => nothingProposed());

    await fixture.run();

    expect(fixture.calls).toHaveLength(2);
  });

  it("accepts --yes and changes nothing by it, because ingest never asks", async () => {
    const fixture = await installedFixture("ingest-yes");
    const seeded = await fixture.seedAccepted("an observation for --yes");
    fixture.reply(() => oneNote(seeded.id));

    const result = await fixture.run({ assumeYes: true });

    expect(dataOf(result).applied).toHaveLength(1);
    expect(fixture.io.questions).toStrictEqual([]);
  });
});

describe("runIngest, the contract it is pinned against", () => {
  /**
   * The declared, **unresolved** list is what is fixed between releases:
   * resolution is per-install, because `resolveScopeGlob` splices this vault's
   * own `contentRoot` and `indexesDir` into each glob. So the parity is against
   * the contract file, and a contract edit that does not update the constant
   * goes red here.
   */
  it("declares exactly the write scopes workflows/ingest/workflow.yaml declares", async () => {
    const file = "workflows/ingest/workflow.yaml";
    const text = await nodeFs.readFile(
      fileURLToPath(new URL(`../../../../${file}`, import.meta.url)),
      "utf8",
    );

    const result = loadWorkflow({ file, text });

    expect(result.errorCount, JSON.stringify(result.findings)).toBe(0);
    expect(result.contract?.scopes.write).toStrictEqual([
      ...INGEST_DECLARED_WRITE_SCOPES,
    ]);
  });

  /**
   * `packages/brain` keeps a finding's path byte-exact and delegates screening
   * to the terminal, which is `brain.md` §5's stated exemption and right there.
   * This command is where a finding becomes a string on stderr **and** in
   * `--json`, and `--json` is deliberately not passed through `renderPath` — so
   * the screen belongs here.
   *
   * Driven at the seam because it is unreachable through the parser today:
   * `parseIngestProposal` refuses `\p{Cc}` and `\p{Cf}` in a path outright, so
   * no proposal that survives it can carry one into a finding. That ordering is
   * a property of the current call path, not a guarantee — a finding's path can
   * also name a generated artifact from the vault, and a future producer owes
   * nothing to that parser.
   */
  it("screens a control byte and a bidi override out of a rendered finding", () => {
    const line = renderValidationFinding({
      validator: "write-scope",
      path: `DEV/a${BELL}b${OVERRIDE}c.md`,
      message: "this path falls outside the write scopes the ingest workflow declares",
    });

    expect(line).not.toContain(BELL);
    expect(line).not.toContain(OVERRIDE);
    expect(line).toContain("write-scope");
  });

  it("carries neither byte into the --json payload of a refusal", async () => {
    const fixture = await installedFixture("ingest-control-bytes");
    const seeded = await fixture.seedAccepted("an observation with a hostile path");
    fixture.reply(() => ({
      schemaVersion: 1,
      notes: [
        {
          path: `DEV/a${BELL}b${OVERRIDE}c.md`,
          contents: "---\nschemaVersion: 1\n---\n",
          sourceCaptureId: seeded.id,
        },
      ],
    }));

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    const payload = formatJsonResult(result);
    expect(payload).not.toContain(BELL);
    expect(payload).not.toContain(OVERRIDE);
  });
});

describe("renderIngest, what a human is shown", () => {
  it("names the vendor, every capture, and the notes each one wrote", () => {
    const lines = renderIngest({
      schemaVersion: 1,
      agent: "codex",
      order: ["0f1e2d3c4b5a6978"],
      captures: [
        {
          captureId: "0f1e2d3c4b5a6978",
          status: "ingested",
          notes: ["DEV/one.md", "QA/two.md"],
        },
        { captureId: "00112233445566aa", status: "failed", notes: [] },
      ],
      applied: [
        {
          captureId: "0f1e2d3c4b5a6978",
          status: "ingested",
          notes: ["DEV/one.md", "QA/two.md"],
        },
      ],
    });

    const text = lines.join("\n");
    expect(text).toContain("codex");
    expect(text).toContain("1 capture");
    expect(text).toContain("0f1e2d3c4b5a6978");
    expect(text).toContain("DEV/one.md");
    expect(text).toContain("QA/two.md");
    /** The unreadable one is shown too, at the status it holds. */
    expect(text).toContain("00112233445566aa");
    expect(text).toContain("failed");
  });

  /**
   * **An unreadable capture's id is a file name, not a hash.** `selectCaptures`
   * slices it out of whatever `*.md` is sitting in quarantine, with no shape
   * check — every other id in this payload has been through `parseCaptureFile`
   * and is provably sixteen hex characters, and this one has not. Reaching it
   * needs local write access to the quarantine directory, which the model does
   * not have, so this is the smallest of the screens and still the one place a
   * byte a human never chose reaches stdout unmangled.
   */
  it("screens a control byte and a bidi override out of an unreadable capture's id", () => {
    const lines = renderIngest({
      schemaVersion: 1,
      agent: "claude",
      order: [],
      captures: [
        { captureId: `a${BELL}b${OVERRIDE}c`, status: "failed", notes: [] },
      ],
      applied: [],
    });

    const text = lines.join("\n");
    expect(text).not.toContain(BELL);
    expect(text).not.toContain(OVERRIDE);
    expect(text).toContain("failed");
  });

  it("says nothing was waiting rather than printing an empty list", () => {
    const lines = renderIngest({
      schemaVersion: 1,
      agent: "claude",
      order: [],
      captures: [],
      applied: [],
    });

    expect(lines).toStrictEqual(["No captures are waiting to be ingested."]);
  });

  /**
   * Through `main.ts` rather than by calling the renderer, because the renderer
   * is only half of what a human sees: dispatch, `emit` and `renderPath` are the
   * rest, and `main.test.ts`'s ingest cases all stop at "not initialized".
   */
  it("reaches stdout through dispatch on a successful run", async () => {
    const fixture = await installedFixture("ingest-render-success");
    const seeded = await fixture.seedAccepted("an observation to render");
    fixture.reply(() => oneNote(seeded.id, "DEV/rendered.md", "Rendered note"));

    const code = await run(["ingest"], fixture.io, () => fixture.context);

    expect(code).toBe(EXIT_CODES.success);
    const text = fixture.io.out.join("\n");
    expect(text).toContain("Ingested 1 capture through claude");
    expect(text).toContain(seeded.id);
    expect(text).toContain("DEV/rendered.md");
  });

  /**
   * **A capture's own recovery has to reach the person it is about.** Nearly
   * every refusal on this path carries advice specific to one capture, and an
   * earlier version of the containment collected only `captureId`, `code`,
   * `message` and `paths` — so every capture-specific escape became unreachable
   * at runtime while the run-level string looked like it had covered them.
   *
   * The "already holds a file" recovery is the one this is pinned on because it
   * is the string the loss was most visible on, and because it shares no words
   * with `REFUSED_RECOVERY`: a case asserting `--decision reject` would have
   * stayed green through the whole regression.
   */
  it("puts the capture's own recovery on stderr, not only the run's", async () => {
    const fixture = await installedFixture("ingest-per-capture-recovery");
    const seeded = await fixture.seedAccepted("an observation over an existing note");
    /** A path `init`'s own template already filled, so `applyNotes` refuses. */
    expect(await vaultNotes(fixture)).toContain("DEV/example-knowledge-note.md");
    fixture.reply(() =>
      oneNote(
        seeded.id,
        "DEV/example-knowledge-note.md",
        "A note proposed over an existing one",
      ),
    );

    const code = await run(["ingest"], fixture.io, () => fixture.context);

    expect(code).toBe(EXIT_CODES.operationalFailure);
    const text = fixture.io.err.join("\n");
    expect(text).toContain("ingest creates notes and never replaces one");
    /** The capture's own advice, which no run-level string contains. */
    expect(text).toContain("move or delete the existing note");
    expect(text).toContain(seeded.id);
  });

  /**
   * **A capture nothing could be read from must not vanish because another one
   * refused.** `selectCaptures`'s warnings ride on the success path only, and
   * the refused report iterates the selected captures, which unreadable ones are
   * deliberately not among — so a run with one of each said nothing at all about
   * the broken file, in exactly the run where a user is already looking.
   */
  it("still reports an unreadable capture when another capture refuses", async () => {
    const fixture = await installedFixture("ingest-unreadable-and-refused");
    const broken = await fixture.seedAccepted("an observation about to break");
    const refusing = await fixture.seedAccepted("an observation that refuses");
    await nodeFs.writeFile(broken.path, "not a capture at all\n", { mode: 0o600 });
    fixture.reply(() =>
      oneNote(refusing.id, "DEV/leaky.md", "Leaky note", `token ${SECRET}`),
    );

    const code = await run(["ingest"], fixture.io, () => fixture.context);

    expect(code).toBe(EXIT_CODES.securityRefusal);
    const text = fixture.io.err.join("\n");
    expect(text).toContain(refusing.id);
    expect(text).toContain("secret-scan");
    /** And the broken one, by name and by reason, rather than silently dropped. */
    expect(text).toContain(broken.id);
    expect(text).toContain("could not be read at all");
    expect(text).toContain("unparseable");
  });

  /**
   * The other half, and the one where a screened `finding.path` reaches a
   * person: a refusal is not rendered by `renderIngest` at all — `emit` writes
   * the message and its paths to stderr, line by line, through `renderPath`.
   */
  it("puts the refusal, its validator and its path on stderr through dispatch", async () => {
    const fixture = await installedFixture("ingest-render-refusal");
    const seeded = await fixture.seedAccepted("an observation that escapes");
    fixture.reply(() =>
      oneNote(seeded.id, "_raw/quarantine/evil.md", "Evil note"),
    );

    const code = await run(["ingest"], fixture.io, () => fixture.context);

    expect(code).toBe(EXIT_CODES.securityRefusal);
    const text = fixture.io.err.join("\n");
    expect(text).toContain(seeded.id);
    expect(text).toContain("refused (exit 5)");
    expect(text).toContain("write-scope");
    expect(text).toContain("_raw/quarantine/evil.md");
    /** And the recovery names an escape that a user can actually follow. */
    expect(text).toContain("--decision reject");
    expect(fixture.io.out).toStrictEqual([]);
  });
});

describe("runIngest, before there is anything to ingest", () => {
  it("refuses when Developer OS is not initialized, at exit 1", async () => {
    const fixture = await createCommandFixture("ingest-no-config");

    const result = await runIngest(fixture.context, {});

    expect(result.code).toBe(EXIT_CODES.operationalFailure);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.recovery).toContain("developer-os init");
  });
});
