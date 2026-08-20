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
  MAX_PROPOSED_PATH_CHARS,
  parseCaptureFile,
} from "@developer-os/brain";
import type { CaptureStatus, ProposedNote } from "@developer-os/brain";
import type { CliContext } from "../context.js";
import { redactText } from "@developer-os/security";
import type { ProcessResult, ProcessRunner } from "@developer-os/security";
import { MacOsPlatformTrustError } from "@developer-os/platform-macos";
import type { AgentDiscovery, AgentName } from "@developer-os/platform-macos";
import { loadWorkflow } from "@developer-os/workflow-schema";

import { afterEach, describe, expect, it } from "vitest";

import { runCapture } from "./capture.js";
import {
  INGEST_DECLARED_WRITE_SCOPES,
  renderIngest,
  CAPTURE_LEFT_AT,
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
  /** Makes the platform refuse the discovered binary (BACKLOG NEW-15). */
  readonly untrustedExecutable?: Error;
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
    ...(options.untrustedExecutable === undefined
      ? {}
      : { untrustedExecutable: options.untrustedExecutable }),
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
   * (`packages/core/src/transactions/executor.ts:835-853`) with the files already
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
    /**
     * **And as fields, which is the whole point of the slot.** This run reaches the one state
     * `leftAt` and `appliedNotes` exist to describe, and every assertion above it reads the
     * *prose* channel the field was added to replace — so `leftAt` could be hardcoded
     * `"untouched"`, `appliedNotes` emptied, and `message`/`recovery` blanked, all with the
     * suite green. The only other `data` assertion of `leftAt` reads `"untouched"` on a run
     * whose true value is `"untouched"`, which cannot fail.
     */
    const report = result.error.data as unknown as {
      readonly refused: readonly {
        readonly leftAt: string;
        readonly appliedNotes: readonly string[];
        readonly message: string;
        readonly recovery: string | null;
      }[];
      readonly ingested: readonly { readonly notes: readonly string[] }[];
    };
    expect(report.refused).toHaveLength(1);
    expect(report.refused[0]?.leftAt).toBe("staging");
    expect(report.refused[0]?.appliedNotes).toStrictEqual(["DEV/stuck.md"]);
    /**
     * The per-capture `message` is *this capture's* failure, not the run-level prose above —
     * which is the distinction the field exists for: a consumer reading the run's message
     * gets every capture's outcome concatenated, and reading this gets one capture's.
     */
    expect(report.refused[0]?.message).toContain("synthetic interruption");
    /**
     * `recovery` is genuinely `null` on this path — an interruption carries no per-capture
     * advice — so it is asserted where it *is* populated instead, in the security-refusal
     * case above, which is the run that can tell a dropped field from an honest absence.
     */
    expect(report.refused[0]?.recovery).toBeNull();
  });

  /**
   * **The third state, which had reporting and no coverage until now.** A
   * rollback that itself fails leaves the capture at `staging` with nothing
   * applied — reachable in production from a `replace` whose
   * `expectedBeforeHash` no longer matches, or a full disk. It is driven here by
   * interrupting the compensating transaction and nothing else: the vendor's
   * reply is what refuses the capture, so the rollback is reached for an
   * ordinary reason and then denied.
   */
  it("labels a capture whose rollback failed as left at staging, with no notes", async () => {
    const fixture = await installedFixture("ingest-rollback-fails", {
      interruptAfter: "planned",
      interruptKind: "ingest-rollback",
    });
    const seeded = await fixture.seedAccepted("an observation whose rollback fails");
    fixture.reply(() => "not json at all");

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    /** The state: at staging, and its vault untouched. */
    expect(await fixture.statusOf(seeded.id)).toBe("staging");
    expect(await vaultNotes(fixture)).not.toContain("DEV/proposed-note.md");
    if (result.ok) return;
    expect(result.error.message).toContain("refused, left at staging");
    expect(result.error.message).not.toContain("partly applied");
    const recovery = result.error.recovery ?? "";
    expect(recovery).toContain("wrote no notes and did not get its status back");
    /** And not the line for the state it is not in. */
    expect(recovery).not.toContain("already in the vault");
  });

  /**
   * **The fourth transaction is the one whose failure leaves a *finished*
   * capture**, and the report has to say so rather than inferring `staging` from
   * "notes were applied and no rollback ran". `ingest-ingested` writes the
   * status and then verifies it; interrupted after `applied`, the bytes on disk
   * say `ingested` while the run reports a failure.
   */
  it("reads the capture's own status rather than inferring it, when the last write landed", async () => {
    const fixture = await installedFixture("ingest-ingested-verify-fails", {
      interruptAfter: "applied",
      interruptKind: "ingest-ingested",
    });
    const seeded = await fixture.seedAccepted("an observation whose last write threw");
    fixture.reply(() => oneNote(seeded.id, "DEV/finished.md", "Finished note"));

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    expect(await fixture.statusOf(seeded.id)).toBe("ingested");
    expect(await vaultNotes(fixture)).toContain("DEV/finished.md");
    if (result.ok) return;
    expect(result.error.message).toContain("applied and ingested");
    /** The two labels that would be false of it. */
    expect(result.error.message).not.toContain("left at staging");
    const recovery = result.error.recovery ?? "";
    expect(recovery).toContain("nothing to redo");
    /**
     * And **only** that line. The partly-applied line is gated on notes having
     * landed, which is true here too — so without a second condition this run
     * emits "set the status by hand … or accepted after removing them" beside
     * "there is nothing to redo for it", and the first tells the user to undo
     * finished work. One recovery in which one sentence is false on every run is
     * the defect `refusedRecovery` was written to end.
     */
    expect(recovery).not.toContain("partly applied");
    expect(recovery).not.toContain("already in the vault");
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

describe("the published vocabularies", () => {
  /**
   * **`leftAt` is on `CliError.data`, so its members are a contract**, and two of the three
   * collide by name with `CaptureStatus` while meaning something different — where the
   * capture's *file* was left, not what status it holds. Pinned here so a fourth member
   * cannot join the type silently, and so the collision stays a deliberate one.
   */
  it("pins the three places a refused capture can be left", () => {
    expect([...CAPTURE_LEFT_AT]).toStrictEqual(["untouched", "staging", "ingested"]);
    /**
     * **And frozen, which the spread above cannot see.** The docblock said "named and
     * frozen"; `as const` is a type-level claim and compiles to a mutable array, so an
     * importer could `push` a fourth state and this case — which spreads at import time —
     * would never look again. `EXIT_CODES` in `result.ts` states exactly this rule; this
     * constant broke it one file over.
     */
    expect(() => {
      (CAPTURE_LEFT_AT as unknown as string[]).push("elsewhere");
    }).toThrow(TypeError);
  });
});

describe("runIngest, a batch that is not uniform", () => {
  /**
   * **The same run, read as fields rather than as prose.** `CliResult`'s failure arm
   * carried no data, so a mixed batch shipped its per-capture outcomes as lines inside
   * `error.message` and a consumer had to parse them — `ingest`'s own docblock said "a
   * mixed batch that reported only the first error would leave a caller unable to learn
   * that anything was written at all", and the workaround was the message (BACKLOG,
   * Foundation request 3).
   *
   * **The prose stays.** The field is added beside `message`, not instead of it, because
   * the message is what a person reads and the field is what a script reads.
   */
  it("reports per-capture outcomes as fields rather than only as lines in a message", async () => {
    const fixture = await installedFixture("ingest-failure-data");
    const seeded = [
      await fixture.seedAccepted("the first observation"),
      await fixture.seedAccepted("the second observation"),
    ].sort(byId);
    const refusing = seeded[1];
    expect(refusing).toBeDefined();
    if (refusing === undefined) return;

    fixture.reply((call) => {
      const target = seeded.find((capture) =>
        call.args.join("\n").includes(capture.id),
      );
      if (target === undefined) return nothingProposed();
      return target.id === refusing.id
        ? oneNote(target.id, "DEV/leaky.md", "Leaky note", `token ${SECRET}`)
        : oneNote(target.id, `DEV/note-${target.id}.md`, `Note ${target.id}`, "Clean.");
    });

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.data).toMatchObject({
      schemaVersion: 1,
      /** Attributable, exactly as the success arm is. */
      agent: "claude",
      order: seeded.map((capture) => capture.id),
      /**
       * **`notes` too, and it is the field a consumer reads to learn what landed.** Two
       * earlier versions of this comment described a `screened` helper — the first with its
       * mechanism backwards, the second after the helper had been deleted. The report copies
       * every field and transforms none now, so what naming the note here catches is the
       * copy losing an entry, which `IngestedCaptureV1` would not catch because an empty
       * array satisfies the type.
       */
      ingested: [
        {
          captureId: seeded[0]?.id,
          status: "ingested",
          notes: [`DEV/note-${seeded[0]?.id ?? ""}.md`],
        },
      ],
      refused: [
        {
          captureId: refusing.id,
          code: EXIT_CODES.securityRefusal,
          leftAt: "untouched",
        },
      ],
      /**
       * Structured, not prose. The first version published the run's English warning
       * lines here, which reproduced inside the new contract the exact defect the contract
       * exists to close.
       */
      unreadable: [],
    });
    /**
     * **The per-capture `recovery`, which only a refusal like this one carries.** An
     * interruption leaves it `null`, so the partly-applied case cannot tell a dropped field
     * from an honest absence; this one can, and without it `recovery: null` was a change the
     * whole suite accepted.
     */
    const refusedHere = (
      result.error.data as unknown as {
        readonly refused: readonly { readonly recovery: string | null }[];
      }
    ).refused;
    expect(refusedHere[0]?.recovery).toContain("the capture is unchanged");
    /** The human-readable half is untouched. */
    expect(result.error.message).toContain("refused (exit 5)");
  });

  /**
   * **`unreadable` carries the broken captures, and the case above cannot say so.** That
   * run has none, so its `unreadable: []` passes with the field hardcoded empty — the
   * fixture cannot distinguish the mapping from its absence. This run has one of each, which
   * is the state the field exists for: `selectCaptures`' warnings ride the success path
   * only, so on a refusing run this field is the *only* machine-readable record that a file
   * could not be read.
   *
   * **`captureId` is published byte-exact, and it is the one field here a human never chose.**
   * `selectCaptures` derives it as `fileName.slice(0, -3)` with no shape check, so a
   * filename carrying a bidi override or a control byte reaches `--json` through it. The
   * guard's own docblock says it "was published raw"; nothing asserted the fix.
   */
  it("reports an unreadable capture as a field, byte-exact", async () => {
    const fixture = await installedFixture("ingest-unreadable-data");
    const broken = await fixture.seedAccepted("an observation about to break");
    const refusing = await fixture.seedAccepted("an observation that refuses");
    await nodeFs.writeFile(broken.path, "not a capture at all\n", { mode: 0o600 });
    fixture.reply(() =>
      oneNote(refusing.id, "DEV/leaky.md", "Leaky note", `token ${SECRET}`),
    );

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const report = result.error.data as unknown as {
      readonly unreadable: readonly {
        readonly captureId: string;
        readonly status: string;
        readonly notes: readonly string[];
      }[];
    };
    expect(report.unreadable.length).toBeGreaterThan(0);
    expect(report.unreadable[0]?.captureId).toBe(broken.id);
    /**
     * **`failed`, and this is the only entry in the report that is ever anything but
     * `ingested`.** Hardcoding the status was once a change the whole suite accepted, because
     * every other capture reaching the report really is `ingested` and this is the one that
     * is not.
     */
    expect(report.unreadable[0]?.status).toBe("failed");
    expect(report.unreadable[0]?.notes).toStrictEqual([]);
  });

  /**
   * **A capture id is published byte-exact, and both arms agree.** An earlier version of this
   * case asserted the opposite — that `data` screened a hostile filename — and it was the
   * wrong contract twice over. The screen it pinned was `screenAndCap`, which collapses
   * `/\s+/` and trims, so it corrupted an *ordinary* filename (`cap  two.md` → `cap two`,
   * naming no file) while the success arm published the identical value raw. `data` was the
   * only one of four renderings that was wrong.
   *
   * `threat-model.md`'s rule is byte-exact everywhere and screened at the terminal. What that
   * leaves open — `JSON.stringify` escapes `\p{Cc}` and not `\p{Cf}`, so an override survives
   * into `--json` — is NEW-38, and the screen never closed it: the success arm always
   * published the same bytes. This asserts the agreement, which is the property
   * `RunReportV1`'s docblock calls the point of having two renderings.
   */
  it("publishes a capture id byte-exact, as the success arm does", async () => {
    const fixture = await installedFixture("ingest-capture-id-bytes");
    const refusing = await fixture.seedAccepted("an observation that refuses");
    const awkward = "cap  two";
    await nodeFs.writeFile(
      join(fixture.quarantine, `${awkward}.md`),
      "not a capture at all\n",
      { mode: 0o600 },
    );
    fixture.reply(() =>
      oneNote(refusing.id, "DEV/leaky.md", "Leaky note", `token ${SECRET}`),
    );

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const report = result.error.data as unknown as {
      readonly unreadable: readonly { readonly captureId: string }[];
    };
    expect(report.unreadable[0]?.captureId).toBe(awkward);
    /** And the id really does name the file, which is what byte-exact is for. */
    await expect(
      nodeFs.stat(join(fixture.quarantine, `${awkward}.md`)),
    ).resolves.toBeDefined();
  });

  /**
   * **The longest id a filesystem permits passes through whole**, which is what the report
   * carrying values untransformed has to mean at the boundary. A filename is limited to 255
   * **UTF-16 code units** (measured on darwin/APFS — `"漢".repeat(255)` is 765 bytes and
   * creates, 256 gives `ENAMETOOLONG`), so no id can reach a length any consumer would have
   * to truncate. A `screenAndCap` here once capped at 512 and collapsed whitespace; the cap
   * could never fire for exactly this reason, and the collapse fired on ordinary names.
   */
  it("passes through the longest capture id a filesystem permits", async () => {
    const fixture = await installedFixture("ingest-longest-capture-id");
    const refusing = await fixture.seedAccepted("an observation that refuses");
    /** 252, because the `.md` suffix shares the 255-code-unit filename budget. */
    const longest = "c".repeat(252);
    await nodeFs.writeFile(
      join(fixture.quarantine, `${longest}.md`),
      "not a capture at all\n",
      { mode: 0o600 },
    );
    fixture.reply(() =>
      oneNote(refusing.id, "DEV/leaky.md", "Leaky note", `token ${SECRET}`),
    );

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const report = result.error.data as unknown as {
      readonly unreadable: readonly { readonly captureId: string }[];
    };
    expect(report.unreadable[0]?.captureId).toBe(longest);
    expect(longest.length).toBeLessThan(MAX_PROPOSED_PATH_CHARS);
  });

  /**
   * **A legitimate note path is carried byte-exact, and screening it was corrupting it.**
   * `screenAndCap` collapses `/\s+/` to one space and trims, so a vault file at
   * `DEV/two  spaces.md` was published on `data` as `DEV/two spaces.md` — a path that does
   * not exist — while the success arm published it correctly and the terminal printed it
   * correctly. A `--json` consumer opening it gets `ENOENT`, and the partly-applied recovery
   * names a note it calls "already in the vault".
   *
   * A double space is an ordinary artefact of a title-derived filename, and a non-breaking
   * space an ordinary artefact of pasted content; neither is refused by `pathViolation`,
   * which is what makes them the reachable case. The characters screening exists to catch are
   * refused there before a note can exist.
   */
  it("carries a note path with repeated whitespace byte-exact onto the report", async () => {
    const fixture = await installedFixture("ingest-note-path-bytes");
    const clean = await fixture.seedAccepted("an observation that lands");
    const refusing = await fixture.seedAccepted("an observation that refuses");
    const spaced = "DEV/two  spaces.md";
    fixture.reply((call) =>
      call.args.join("\n").includes(refusing.id)
        ? oneNote(refusing.id, "DEV/leaky.md", "Leaky note", `token ${SECRET}`)
        : oneNote(clean.id, spaced, "Two spaces", "Clean."),
    );

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const report = result.error.data as unknown as {
      readonly ingested: readonly { readonly notes: readonly string[] }[];
    };
    expect(report.ingested[0]?.notes).toStrictEqual([spaced]);
    /** And the path really is the one on disk, which is what makes the byte match matter. */
    await expect(
      nodeFs.stat(join(fixture.content, spaced)),
    ).resolves.toBeDefined();
    /**
     * **The human half too, which the first fix left collapsed.** `reportLines` screened note
     * paths with `screenAndCap`, so the message named `DEV/two spaces.md` for a file called
     * `DEV/two  spaces.md` — and the partly-applied line calls such a path "already in the
     * vault". Fixing only `data` made the failure terminal the one rendering of four that
     * corrupts a path. It renders through `renderPath` now, which substitutes and truncates
     * without collapsing.
     */
    expect(result.error.message).toContain(spaced);
  });

  /**
   * **`error.paths` is the fourth rendering, and it was the last one still collapsing.**
   * `refusalFrom` and `applyNotes` built it with `screenAndCap`, so a refusal about
   * `DEV/two  spaces.md` named `DEV/two spaces.md` — while `data`, the success arm and the
   * message all carried the file that exists. Three successive rounds each fixed one
   * rendering and left this one, which is why the case asserts against `nodeFs.stat` rather
   * than against a sibling field.
   */
  it("names a refused path byte-exact, against the file on disk", async () => {
    const fixture = await installedFixture("ingest-refused-path-bytes");
    const first = await fixture.seedAccepted("an observation that lands");
    const spaced = "DEV/two  spaces.md";
    fixture.reply(() => oneNote(first.id, spaced, "Two spaces", "Clean."));
    expect((await fixture.run()).ok).toBe(true);

    /** The second run proposes the same path, which now exists, so the write is refused. */
    const second = await fixture.seedAccepted("an observation that collides");
    fixture.reply(() => oneNote(second.id, spaced, "Two spaces again", "Clean."));
    const result = await fixture.run();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.paths).toContain(spaced);
    await expect(
      nodeFs.stat(join(fixture.content, spaced)),
    ).resolves.toBeDefined();
  });

  /**
   * **A hostile note path never reaches the report, and that is the finding.** `appliedNotes`
   * and `notes` both run their entries through `screenAndCap`, and the product's own path
   * cannot exercise it: the proposal **parser**'s `pathViolation` refuses a path carrying a right-to-left override
   * as `unsafe-path` *before* any note is applied, so the fields are empty by the time they
   * are screened. Measured — the run below refuses at `unsafe-path` and publishes
   * `"appliedNotes":[]`.
   *
   * So the screening on those two fields is a second layer under a validator that already
   * refuses, and it is recorded as such rather than pinned by a construct that reaches it
   * some other way. The layer that *is* reachable — `captureId`, whose value comes from a
   * filename and passes through no validator at all — is pinned by the case above.
   */
  it("refuses a hostile note path before it can reach the report", async () => {
    const fixture = await installedFixture("ingest-hostile-note-path");
    const seeded = await fixture.seedAccepted("an observation with a hostile note path");
    fixture.reply(() => oneNote(seeded.id, "DEV/stu\u202Eck.md", "Stuck note"));

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("unsafe-path");
    const published = JSON.stringify(result.error.data);
    expect(published).not.toContain("\u202E");
    expect(published).toContain('"appliedNotes":[]');
  });

  /**
   * **That the published detail carries no sentinel, end to end.**
   *
   * It does **not** prove the redaction: this path's refusal message names the finding's
   * class rather than quoting the secret, so the case stays green with `redactDeep`
   * removed — mutation-tested, and the reason the guarantee itself is asserted against
   * `failureFrom` directly in `context.test.ts` with a nested payload that does carry one.
   * What this pins is the property a reader of `--json` actually cares about: run the real
   * pipeline over a leaking proposal, and the structured half comes back clean.
   */
  it("publishes structured detail that carries no sentinel", async () => {
    const fixture = await installedFixture("ingest-failure-data-redacted");
    const seeded = await fixture.seedAccepted("an observation");
    fixture.reply(() =>
      oneNote(seeded.id, "DEV/leaky.md", "Leaky note", `token ${SECRET}`),
    );

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error.data)).not.toContain(SECRET);
    expect(JSON.stringify(result.error.data ?? {}).length).toBeGreaterThan(2);
  });

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

  /**
   * **The failure arm is attributable too, and nothing asked.** Every failing-run fixture uses
   * the default vendor, which *is* claude — so the report's `agent` could be hardcoded
   * `"claude"` with all 122 files green, and a `--agent codex` run that partly refused would
   * publish the wrong vendor. The field's own docblock says "a run that failed is no less in
   * need of attribution than one that succeeded, and the first version dropped both"; the two
   * cases that do read a non-default agent both read the **success** arm.
   */
  it("attributes a refusing run to the agent that ran it", async () => {
    const fixture = await installedFixture("ingest-agent-attribution", {
      codex: true,
    });
    const seeded = await fixture.seedAccepted("an observation a second vendor refuses");
    fixture.reply(() =>
      oneNote(seeded.id, "DEV/leaky.md", "Leaky note", `token ${SECRET}`),
    );

    const result = await fixture.run({ agent: "codex" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.data).toMatchObject({ agent: "codex" });
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
   * **The other half of the same seam, inverted on 2026-08-17 (BACKLOG
   * NEW-12).** `workingRoot` is this vault's own content root, derived from the
   * user's `brainPath`. It used to keep the argv word list, so a user whose
   * vault path contained `permission`, `danger` or `bypass` had every `codex`
   * ingest refused — permanently, under a recovery line telling them to run it
   * again. This case pinned that refusal by putting the word in the fixture's
   * own path; it pins the acceptance now, from the same fixture, which is why
   * the fixture name is unchanged.
   *
   * **One coverage residual, recorded rather than papered over.** This was also
   * the only end-to-end assertion that `invokeVendor` propagates a refusal's
   * `detail` into its message — behaviour DOS-P6 Task 19 added after finding it
   * discarded. Closing NEW-12 makes a *screening* refusal unreachable from
   * `ingest` by construction: the prompt is prefixed with a heading so the dash
   * rule cannot fire, both paths are derived, and spec §3.3 gives the agent zero
   * write scopes, so no value ingest passes keeps the word list. The detail
   * strings themselves stay pinned in `adapter-codex/src/invoke.test.ts`'s
   * dash-rule cases. What is no longer covered end-to-end is the interpolation,
   * and no fixture can reach it without an injection point that does not exist.
   *
   * **BACKLOG NEW-16's sharpest claim: a configured client name must not reach a vendor
   * model.** `buildIngestPrompt` puts the capture body in front of one, so this is the
   * single path where spec §8.2's user-extensible class earns its keep.
   *
   * The capture is seeded **before** the table is written, so the name is genuinely on
   * disk and this exercises `ingest`'s own redactor rather than `capture`'s. Revert
   * `ingest.ts`'s `userPatterns: config.redaction?.patterns ?? []` and this goes red on
   * the argv the fixture recorded.
   */
  it("keeps a configured client name out of the prompt it sends a vendor", async () => {
    const fixture = await installedFixture("ingest-user-redaction");
    const seeded = await fixture.seedAccepted(
      "the Northwind Traders migration needs a rollback plan",
    );
    /**
     * The seed is genuine, asserted rather than assumed. Without this a future change to
     * `seedAccepted` that started redacting would hollow the case out silently: it would
     * still pass `not.toContain`, and `[REDACTED:user-pattern]` would keep it green from
     * `capture`'s side rather than `ingest`'s.
     */
    expect(await nodeFs.readFile(seeded.path, "utf8")).toContain("Northwind Traders");

    await nodeFs.appendFile(
      fixture.paths.configFile,
      '\n[redaction]\npatterns = ["Northwind Traders"]\n',
      "utf8",
    );
    fixture.reply(() => oneNote(seeded.id));

    const result = await fixture.run({ agent: "codex" });

    expect(result.ok, "the ingest must reach the vendor").toBe(true);
    const sent = fixture.calls.map((call) => call.args.join("\n")).join("\n");
    expect(sent, "the vendor was not called").not.toBe("");
    expect(sent).not.toContain("Northwind Traders");
    expect(sent).toContain("[REDACTED:user-pattern]");
    /** The rest of the observation still reaches the model. */
    expect(sent).toContain("migration needs a rollback plan");
  });

  /**
   * **BACKLOG NEW-15, on the command whose contract is to refuse.** `ingest` hands the
   * discovered binary the user's captured observation and read access to the whole vault,
   * on the strength of a name match — so a binary the platform will not vouch for stops
   * the run rather than degrading it.
   *
   * The refusal is raised **outside** `selectVendor`'s `catch`, which maps any throw to
   * "not installed"; inside it, this would silently fall through to the other vendor.
   */
  it("refuses at exit 5 when the discovered binary is not trusted", async () => {
    const fixture = await installedFixture("ingest-untrusted-binary", {
      /**
       * **The real class, not a stand-in.** Injecting `SecurityRefusalError` made this
       * assertion pass on the strength of duck-typed `.code`, so deleting
       * `MacOsPlatformTrustError`'s own `code` left every suite green while `ingest`
       * silently started exiting 1 on an untrusted binary. This pins the class and the
       * plumbing together.
       */
      untrustedExecutable: new MacOsPlatformTrustError(
        "The executable is not trusted: /synthetic/bin is writable by any user",
      ),
    });
    const seeded = await fixture.seedAccepted("an observation to ingest");
    fixture.reply(() => oneNote(seeded.id));

    const result = await fixture.run({ agent: "codex" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.securityRefusal);
    /** Nothing was spawned, and the capture is untouched and retryable. */
    expect(fixture.calls).toStrictEqual([]);
    expect(await fixture.statusOf(seeded.id)).toBe("accepted");
  });

  it("ingests from a vault whose own path names a word-list term", async () => {
    const fixture = await installedFixture("ingest-danger-in-the-path");
    const seeded = await fixture.seedAccepted("an observation under a danger path");
    fixture.reply(() => oneNote(seeded.id));

    const result = await fixture.run({ agent: "codex" });

    expect(result.ok).toBe(true);
    /** The vendor was actually reached, which is the whole of what was broken. */
    expect(fixture.calls).not.toStrictEqual([]);
    expect(await fixture.statusOf(seeded.id)).toBe("ingested");
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
    /**
     * **And it names the verb rather than a hand edit.** This string said "set the capture's
     * status back to quarantined by hand and then developer-os review …" because a capture
     * was rejectable only from `quarantined`; spec §5.5 gained `accepted → rejected`, and the
     * capture this line describes is at `accepted`. Its sibling at the run level was pinned
     * and this one was not, so reverting it alone left the suite green.
     */
    expect(text).toContain("or developer-os review --id <id> --decision reject");
    expect(text).not.toContain("back to quarantined by hand");
    expect(text).toContain(seeded.id);
  });

  /**
   * **The same read-to-write window `review` closes, on the same files.** `ingest` reads a
   * capture, renders it at `staging`, and writes it back through one `replace` — so a hand
   * edit landing between that read and the transaction was read, ignored and overwritten,
   * non-idempotently. The command's own docblock said so and pointed at this Foundation
   * change as the thing that would close it; the change shipped, so it does.
   *
   * Only the *first* write of a run carries a precondition: the later ones follow a write
   * this run made itself, and the executor's own snapshot is the right one for those.
   */
  it("refuses when a hand edit lands between the read and the staging write", async () => {
    const fixture = await installedFixture("ingest-read-window");
    const seeded = await fixture.seedAccepted("an observation about to be edited");
    const edited = `${await nodeFs.readFile(seeded.path, "utf8")}\nedited by hand\n`;

    /**
     * **The *second* read of the capture is the one to race.** `selectCaptures` reads every
     * file first to learn its status; the read whose digest becomes the precondition is the
     * one in `decide`, immediately before the staging write. Racing the first would put the
     * edit before that read, which would then hash the edited bytes and match — a fixture
     * that cannot fail.
     *
     * **The read to race is the one that supplies the precondition**, and it is identifiable
     * because it is the only read of a capture that passes a `reader` — that hook exists to
     * hash the bytes. `selectCaptures` reads every file first to learn its status; racing
     * that one puts the edit *before* the read whose digest is pinned, which then hashes the
     * edited bytes and matches. A fixture that cannot fail.
     */
    let raced = false;
    const guards = fixture.context.guards;
    const context: CliContext = {
      ...fixture.context,
      guards: {
        ...guards,
        readText: async (
          path: string,
          reader?: Parameters<typeof guards.readText>[1],
        ): Promise<string> => {
          const text = await guards.readText(path, reader);
          if (path === seeded.path && reader !== undefined && !raced) {
            raced = true;
            await nodeFs.writeFile(seeded.path, edited, { mode: 0o600 });
          }
          return text;
        },
      },
    };

    const result = await runIngest(context, {});

    expect(raced, "the edit must land after the read whose digest is pinned").toBe(true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    /**
     * **The user's words survive, which is the point of refusing.** This assertion is what
     * caught the compensating write: the executor declined to overwrite the hand edit, and
     * the rollback then wrote the pre-read envelope over it two lines later, because
     * `staged` was set before the staging write rather than after it.
     */
    await expect(nodeFs.readFile(seeded.path, "utf8")).resolves.toBe(edited);
  });

  /**
   * **A model-chosen path cannot decide this command's control flow.** The compensating path
   * asks whether a refusal came from the plan phase, and the first version asked by matching
   * the refusal *message* — which interpolates the model's proposed note path. A proposal
   * naming the marker phrase made a refusal raised *after* the staging bytes landed read as
   * one raised before them, so the rollback was skipped and the capture stayed at `staging`,
   * which `selectCaptures` never selects again: stranded until a hand edit of its frontmatter.
   *
   * The phrase arrives through the capture body and the prompt, which is the untrusted path
   * this command's threat model is written against.
   */
  it("rolls back a refusal whose path spells the precondition marker", async () => {
    const fixture = await installedFixture("ingest-marker-path");
    const seeded = await fixture.seedAccepted("an observation with a steering path");
    fixture.reply(() =>
      oneNote(seeded.id, "_raw/quarantine/before ingest moved it.md", "Steered"),
    );

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    /** Rolled back, not stranded: the write landed, so the compensation must run. */
    expect(await fixture.statusOf(seeded.id)).toBe("accepted");
  });

  /**
   * **A capture holding a byte that is not valid UTF-8 still ingests**, the counterpart of
   * `review`'s case. The precondition is a digest of what was read, and hashing a *re-encode*
   * of the decoded text is lossy — `0x93` becomes U+FFFD and re-encodes to `EF BF BD` — so
   * such a capture would hash to bytes the file never held and refuse for ever, with a
   * message saying it had changed on disk. `ingest` reads through the same hook `review`
   * does, so it needs the same proof.
   */
  it("ingests a capture whose body holds a byte that is not valid UTF-8", async () => {
    const fixture = await installedFixture("ingest-invalid-utf8");
    const seeded = await fixture.seedAccepted("an observation with an odd byte");
    const original = await nodeFs.readFile(seeded.path);
    await nodeFs.writeFile(
      seeded.path,
      Buffer.concat([original, Buffer.from([0x93])]),
      { mode: 0o600 },
    );
    fixture.reply(() => oneNote(seeded.id, "DEV/odd.md", "Odd note", "Clean."));

    const result = await fixture.run();

    expect(result.ok, "a lossy digest would refuse this for ever").toBe(true);
  });

  /**
   * **The run-level recovery names the verb, and no longer a hand edit.** Both strings said
   * "set its status back to quarantined by hand and then developer-os review …", because a
   * capture was rejectable only from `quarantined`. Spec §5.5 gained `accepted → rejected`,
   * and every capture these lines describe is at `accepted` — so the verb works from where
   * the capture already is. Nothing pinned either string, so reverting them was silent.
   */
  it("recovers a refused capture by naming the verb, not a hand edit", async () => {
    const fixture = await installedFixture("ingest-recovery-verb");
    const seeded = await fixture.seedAccepted("an observation that refuses");
    fixture.reply(() =>
      oneNote(seeded.id, "DEV/leaky.md", "Leaky note", `token ${SECRET}`),
    );

    const result = await fixture.run();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const recovery = result.error.recovery ?? "";
    expect(recovery).toContain("developer-os review --id <id> --decision reject");
    expect(recovery).not.toContain("by hand");
    /** And the capture really is at the status the verb now accepts. */
    expect(await fixture.statusOf(seeded.id)).toBe("accepted");
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
