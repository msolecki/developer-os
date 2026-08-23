import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { basename, join } from "node:path";

import { EXIT_CODES } from "@developer-os/core";
import { detectSourceAgent, parseCaptureFile } from "@developer-os/brain";
import type { CaptureEnvelopeV1 } from "@developer-os/brain";
import { redactText } from "@developer-os/security";
import type { ProcessResult } from "@developer-os/security";

import { afterEach, describe, expect, it } from "vitest";

import { runCapture } from "./capture.js";
import { runInit } from "./init.js";
import { runReview } from "./review.js";
import type { ReviewOptions } from "./review.js";
import { createCommandFixture, removeCommandFixtures } from "./testing.js";
import type { CommandFixture } from "./testing.js";
import { loadOrCreateRedactionKey } from "../context.js";
import type { CliContext } from "../context.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

/** Synthetic, like every fixture here: no real client, project or repository. */
const PROJECT_DIRECTORY = "Sample Project";
const OBSERVATION = "an observation";
const SECRET = `ghp_${"a".repeat(36)}`;

/**
 * Synthetic editor paths, in the fixture's environment rather than the real
 * one. Spec §5.6 refuses to spawn `$EDITOR`, and an assertion that nothing was
 * spawned holds trivially in an environment where nothing *could* be: with
 * these set, an implementation that honoured either variable would spawn and
 * redden the case instead of passing on a technicality.
 */
const EDITOR = "/synthetic/bin/editor";
const VISUAL = "/synthetic/bin/visual-editor";

interface SeededCapture {
  readonly path: string;
  readonly id: string;
}

interface ReviewFixture extends CommandFixture {
  readonly quarantine: string;
  /** Every executable this fixture was asked to run, in order. */
  readonly spawned: readonly string[];
  seed(text: string): Promise<SeededCapture>;
  run(context: CliContext, options: ReviewOptions): ReturnType<typeof runReview>;
}

/**
 * A real installation, produced by the real `init`, holding real captures
 * written by the real `capture`: the files `review` reads have to be the ones a
 * user gets, and a hand-built envelope would let a rendering change pass
 * unnoticed here and fail on a real machine.
 */
async function installedFixture(
  label: string,
  options: { readonly now?: () => Date } = {},
): Promise<ReviewFixture> {
  const spawned: string[] = [];
  const fixture = await createCommandFixture(label, {
    env: { EDITOR, VISUAL },
    ...(options.now === undefined ? {} : { now: options.now }),
    runner: {
      run: (request): Promise<ProcessResult> => {
        spawned.push(request.executable);
        return Promise.reject(new Error("nothing in review should spawn"));
      },
    },
  });
  const installed = await runInit(fixture.context, ACCEPTED);
  expect(installed.ok, "the fixture must install before it reviews").toBe(true);

  const project = join(fixture.root, PROJECT_DIRECTORY);
  await nodeFs.mkdir(project, { recursive: true, mode: 0o700 });
  /** `init` verifies the installation; only what `review` spawns is at issue. */
  spawned.length = 0;

  return {
    ...fixture,
    quarantine: join(fixture.paths.brain, "content", "_raw", "quarantine"),
    spawned,
    seed: async (text: string): Promise<SeededCapture> => {
      const captured = await runCapture(
        fixture.context,
        { text },
        { cwd: () => project, detect: detectSourceAgent },
      );
      expect(captured.ok, `the fixture must capture ${text}`).toBe(true);
      if (!captured.ok) throw new Error("the fixture could not seed a capture");
      return { path: captured.data.path, id: captured.data.captureId };
    },
    run: (context, options) => runReview(context, options),
  };
}

/** Three captures, one per decision, so a sweep has something to sweep. */
async function seedThree(fixture: ReviewFixture): Promise<readonly SeededCapture[]> {
  const seeded = [
    await fixture.seed("the first observation"),
    await fixture.seed("the second observation"),
    await fixture.seed("the third observation"),
  ];
  expect(new Set(seeded.map((capture) => capture.id)).size).toBe(3);
  return seeded;
}

async function listQuarantine(fixture: ReviewFixture): Promise<readonly string[]> {
  const entries = await nodeFs.readdir(fixture.quarantine);
  return entries.filter((name) => name.endsWith(".md")).sort();
}

/**
 * The capture on disk, read back through the same parser `review` uses and
 * under the installation's own durable key — so `captureId` and
 * `deduplicationHash` here are the file's, not this test's idea of them.
 */
async function envelopeOf(
  fixture: ReviewFixture,
  path: string,
): Promise<CaptureEnvelopeV1> {
  const key = loadOrCreateRedactionKey(fixture.paths.stateDir);
  const outcome = parseCaptureFile(
    basename(path),
    await nodeFs.readFile(path, "utf8"),
    (text) => redactText(text, key),
  );
  if (!outcome.ok) {
    throw new Error(`the capture at ${path} did not parse: ${outcome.reason}`);
  }
  return outcome.envelope;
}

/**
 * The review transactions this run produced, read back from the journals the
 * executor actually wrote. Counting real journals — rather than a spy on a fake
 * executor — is what makes "through a transaction, not a bare write" an
 * observation instead of a restatement of the call the test just made.
 */
async function reviewTransactions(
  fixture: CommandFixture,
): Promise<readonly { readonly id: string; readonly phase: string }[]> {
  const journalDir = join(fixture.paths.stateDir, "transactions");
  const entries = (await nodeFs.readdir(journalDir))
    .filter((name) => name.endsWith(".json"))
    .sort();
  /**
   * The negative direction of "a gate that can pass by scanning nothing is not
   * a gate": every `toStrictEqual([])` below concludes that *no* journal was a
   * review, and an unread — or absent — directory would say the same thing.
   * `init` wrote one before any of these cases ran, so an empty read here is a
   * fixture that never installed rather than a run that wrote nothing.
   */
  expect(entries.length, "a sweep over no journals is not a sweep").toBeGreaterThan(0);

  const journals: { readonly id: string; readonly phase: string }[] = [];
  for (const entry of entries) {
    const journal = await fixture.context.transactions.read(
      entry.slice(0, -".json".length),
    );
    if (journal.kind === "review") {
      journals.push({ id: journal.id, phase: journal.phase });
    }
  }
  return journals;
}

/** Every byte this run left anywhere in the vault, concatenated. */
async function readWholeVault(fixture: ReviewFixture): Promise<string> {
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

/**
 * The `deduplicationHash` **as the file carries it**, quotes stripped — the
 * emitter quotes any scalar whose plain form would resolve as another type, and
 * a 64-character hex digest can be one.
 *
 * This exists because `parseCaptureFile` *recomputes* `deduplicationHash`,
 * `content` and `redaction` from the body rather than reading them
 * (`packages/brain/src/capture/parse.ts`), so an envelope parsed back off disk
 * cannot see a stale frontmatter hash at all: it reports what the bytes *should*
 * hash to, not what the file says they do. Only the raw line distinguishes a
 * command that rewrote the envelope from one that wrote the file's own bytes
 * back.
 */
function persistedHash(text: string): string {
  const match = /^deduplicationHash: (.*)$/mu.exec(text);
  expect(match, "the capture must carry a deduplicationHash line").not.toBeNull();
  return (match?.[1] ?? "").replace(/^["']|["']$/gu, "");
}

async function appendToFile(path: string, text: string): Promise<void> {
  const before = await nodeFs.readFile(path, "utf8");
  await nodeFs.writeFile(path, `${before}${text}`, { mode: 0o600 });
}

async function replaceInFile(
  path: string,
  find: string,
  replacement: string,
): Promise<void> {
  const before = await nodeFs.readFile(path, "utf8");
  const after = before.replace(find, replacement);
  expect(after, `the hand edit must change ${basename(path)}`).not.toBe(before);
  await nodeFs.writeFile(path, after, { mode: 0o600 });
}

/** Moves a capture's status the way a hand edit in Obsidian would. */
function setStatus(path: string, status: string): Promise<void> {
  return replaceInFile(path, "status: quarantined\n", `status: ${status}\n`);
}

describe("runReview", () => {
  /**
   * **BACKLOG NEW-16 on the verb that exists for exactly this.**
   * `review --decision edit` re-reads a capture and re-redacts it, and its whole purpose
   * is removing something a user put in the file by hand. A client name no built-in class
   * catches is the case spec §8.2 describes, so it must be the case `edit` handles.
   *
   * Seeded before the table is written, so the name is genuinely on disk and this
   * exercises `review`'s own redactor. Revert `review.ts`'s
   * `userPatterns: config.redaction?.patterns ?? []` and this goes red.
   */
  it("re-redacts a configured client name on edit", async () => {
    const fixture = await installedFixture("review-user-redaction");
    const seeded = await fixture.seed(
      "the Northwind Traders migration needs a rollback plan",
    );
    expect(await nodeFs.readFile(seeded.path, "utf8")).toContain("Northwind Traders");

    await nodeFs.appendFile(
      fixture.paths.configFile,
      '\n[redaction]\npatterns = ["Northwind Traders"]\n',
      "utf8",
    );

    const result = await fixture.run(fixture.context, {
      id: seeded.id,
      decision: "edit",
    });

    expect(result.ok, "the edit must succeed").toBe(true);
    const after = await nodeFs.readFile(seeded.path, "utf8");
    expect(after).not.toContain("Northwind Traders");
    expect(after).toContain("[REDACTED:user-pattern]");
    expect(after).toContain("migration needs a rollback plan");
  });

  it("lists quarantined captures and nothing else", async () => {
    const fixture = await installedFixture("review-list");
    const quarantined = await fixture.seed(OBSERVATION);
    const ingested = await fixture.seed("an observation already ingested");
    await setStatus(ingested.path, "ingested");

    const result = await fixture.run(fixture.context, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.captures).toHaveLength(1);
    expect(result.data.captures[0]).toStrictEqual({
      captureId: quarantined.id,
      status: "quarantined",
    });
    expect(result.data.reviewed).toBe(0);
  });

  it("lists a chosen status, so an accepted capture's id is reachable", async () => {
    /**
     * **`BACKLOG.md` §1 NEW-41.** Task 9 gave spec §5.5 the
     * `accepted → rejected` row so that a user who accepts a capture and then
     * changes their mind has a verb instead of a hand edit. The listing filtered
     * to `quarantined`, so **that user could not find the id through the product
     * at all** — they had the verb and no route to it, and the headline reason
     * for the transition was served only by `ingest`'s refusal printing the id.
     *
     * **The bare command is unchanged**, which the case above pins: `review`
     * with no arguments is still the pending queue. What is added is a way to
     * ask for another status, so widening the default — a display decision the
     * row declined to take — is not taken here either.
     */
    const fixture = await installedFixture("review-list-status");
    const quarantined = await fixture.seed(OBSERVATION);
    const accepted = await fixture.seed("an observation already accepted");
    await setStatus(accepted.path, "accepted");

    const result = await fixture.run(fixture.context, { status: "accepted" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.captures).toStrictEqual([
      { captureId: accepted.id, status: "accepted" },
    ]);
    expect(
      result.data.captures.map((capture) => capture.captureId),
      "the quarantined one must not appear under an explicit status",
    ).not.toContain(quarantined.id);
  });

  it("refuses a status that is not a capture status", async () => {
    /**
     * **The exit code is asserted, not only `ok === false`.** A first version
     * asserted the refusal alone, which this fixture would have satisfied by
     * refusing for any other reason.
     *
     * **It does not pin *where* the validation runs, and an earlier title
     * claimed it did.** `installedFixture` runs `init`, so a redaction key
     * already exists before `runReview` is called and this case cannot observe
     * one being created either way — it stays green with the check back in the
     * listing branch. What pins the position is the uninstalled-fixture case in
     * `main.test.ts`, where the two answers differ.
     */
    const fixture = await installedFixture("review-list-status-bad");
    await fixture.seed(OBSERVATION);

    const result = await fixture.run(fixture.context, { status: "pending" });

    expect(result.ok).toBe(false);
    expect(result.code).toBe(EXIT_CODES.invalidInput);
    if (result.ok) return;
    expect(result.error.message).toContain("not a capture status");
  });

  it("refuses --status beside a decision, rather than ignoring it", async () => {
    /**
     * `--status` chooses what a listing shows; a decision names one capture by
     * id. Together they describe two different commands, and accepting the
     * combination silently would also leave the value unvalidated, since the
     * decision path never reaches the listing. `resolveTarget` sets the same
     * convention for `--id` without `--decision`.
     */
    const fixture = await installedFixture("review-status-with-decision");
    const seeded = await fixture.seed(OBSERVATION);

    const result = await fixture.run(fixture.context, {
      id: seeded.id,
      decision: "accept",
      status: "accepted",
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe(EXIT_CODES.invalidInput);
  });

  it("changes nothing at all while listing", async () => {
    const fixture = await installedFixture("review-list-writes-nothing");
    const seeded = await seedThree(fixture);
    const before = await Promise.all(
      seeded.map((capture) => nodeFs.readFile(capture.path, "utf8")),
    );

    const result = await fixture.run(fixture.context, {});

    expect(result.ok && result.data.captures).toHaveLength(3);
    expect(await reviewTransactions(fixture)).toStrictEqual([]);
    for (const [index, capture] of seeded.entries()) {
      expect(await nodeFs.readFile(capture.path, "utf8")).toBe(before[index]);
    }
  });

  it("lists nothing, and refuses nothing, when no capture is waiting", async () => {
    const fixture = await installedFixture("review-list-empty");

    const result = await fixture.run(fixture.context, {});

    expect(result.code).toBe(EXIT_CODES.success);
    expect(result.ok && result.data.captures).toStrictEqual([]);
  });

  /**
   * A capture whose *own envelope* is unreadable is `failed` (spec §5.5), and
   * `failed` is not `quarantined`, so it is not listed. It is warned about
   * rather than skipped in silence: a user with a broken file in their vault
   * needs to be told which file and why, and no other decision is available to
   * a command that cannot read it.
   */
  it("warns about a capture it cannot read rather than listing it", async () => {
    const fixture = await installedFixture("review-list-broken");
    const readable = await fixture.seed(OBSERVATION);
    const broken = await fixture.seed("an observation about to break");
    await nodeFs.writeFile(broken.path, "not a capture at all\n", { mode: 0o600 });

    const result = await fixture.run(fixture.context, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.captures.map((capture) => capture.captureId)).toStrictEqual([
      readable.id,
    ]);
    expect(result.warnings.join(" ")).toContain(broken.id);
    expect(result.warnings.join(" ")).toContain("unparseable");
  });

  it.each([
    ["accept", "accepted"],
    ["reject", "rejected"],
  ] as const)("moves a quarantined capture to %s through a transaction", async (
    decision,
    status,
  ) => {
    const fixture = await installedFixture(`review-${decision}`);
    const seeded = await fixture.seed(OBSERVATION);

    const result = await fixture.run(fixture.context, { id: seeded.id, decision });

    expect(result.code).toBe(EXIT_CODES.success);
    expect(result.ok && result.data.reviewed).toBe(1);
    expect(result.ok && result.data.captures[0]?.status).toBe(status);
    const transactions = await reviewTransactions(fixture);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.phase).toBe("finalized");
    const after = await envelopeOf(fixture, seeded.path);
    expect(after.status).toBe(status);
    /** The observation itself survives the decision: no source is discarded. */
    expect(after.content).toBe(OBSERVATION);
  });

  it("re-redacts on edit, so a secret pasted into the vault does not survive review", async () => {
    const fixture = await installedFixture("review-edit-redacts");
    const seeded = await fixture.seed(OBSERVATION);
    await appendToFile(seeded.path, `\n${SECRET}\n`);
    expect(await nodeFs.readFile(seeded.path, "utf8")).toContain(SECRET);

    const result = await fixture.run(fixture.context, {
      id: seeded.id,
      decision: "edit",
    });

    expect(result.code).toBe(EXIT_CODES.success);
    const written = await nodeFs.readFile(seeded.path, "utf8");
    expect(written).not.toContain("ghp_");
    expect(written).toContain("[REDACTED:provider-token]");
    /** Nowhere else in the vault either, and not in what the command returns. */
    expect(await readWholeVault(fixture)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(fixture.io.out.join("\n") + fixture.io.err.join("\n")).not.toContain(
      SECRET,
    );
  });

  /**
   * The founder's amendment of 2026-08-13 (spec §5.3 and §5.6), driven. As the
   * spec was approved the id was recomputed on every hand edit and a mismatch
   * refused — and since the id is `H(redacted content)`, *any* content-changing
   * edit refused, which left the pasted secret in the vault file while the
   * returned value looked clean. The id is now assigned once and never
   * recomputed, so an edit succeeds and rewrites in place.
   */
  it("keeps the id and updates the hash on a content edit, because the id is assigned once", async () => {
    const fixture = await installedFixture("review-edit-id");
    const seeded = await fixture.seed(OBSERVATION);
    const before = await nodeFs.readFile(seeded.path, "utf8");
    await appendToFile(seeded.path, "\nmore words\n");

    const result = await fixture.run(fixture.context, {
      id: seeded.id,
      decision: "edit",
    });

    expect(result.code).toBe(EXIT_CODES.success);
    const after = await nodeFs.readFile(seeded.path, "utf8");
    /**
     * The persisted line, never the parsed field: `parseCaptureFile` recomputes
     * the hash from the body, so a command that wrote the file's own bytes back
     * — leaving a frontmatter hash describing the pre-edit body — is invisible
     * to a parsed envelope and visible here.
     */
    expect(persistedHash(after)).not.toBe(persistedHash(before));
    /** And what it now says is what the persisted body actually hashes to. */
    const envelope = await envelopeOf(fixture, seeded.path);
    expect(persistedHash(after)).toBe(
      createHash("sha256").update(envelope.content, "utf8").digest("hex"),
    );
    expect(envelope.content).toContain("more words");
    /**
     * `captureId` **is** read from frontmatter rather than recomputed, and
     * `parseCaptureFile` refuses when it disagrees with the filename — so a
     * parsed envelope carrying the seeded id is the persisted id, and the file
     * still answers to its own name.
     */
    expect(envelope.captureId).toBe(seeded.id);
    expect(await listQuarantine(fixture)).toStrictEqual([`${seeded.id}.md`]);
    expect(envelope.status).toBe("quarantined");
  });

  /**
   * The other half of the race `writeCapture`'s docblock describes — the half
   * the executor *does* catch — driven rather than argued.
   *
   * The fixture's clock is the seam the race is staged through: the executor
   * calls it once between taking its own snapshot of the target and re-checking
   * it, so a write from inside the clock lands in that window. That ordering is
   * checked by this test rather than only described by it — if it changes,
   * `raced` still holds and the assertions below fail.
   *
   * The user must meet this as a sentence about their capture rather than as an
   * opaque class name, and the newer file must survive — the lost update this
   * command is at greatest risk of is precisely the one the user just made by
   * hand.
   *
   * **Exit 3, which is `TransactionConflictError`'s own.** The exit table is
   * part of Foundation's contract and glosses 3 as "user decision or conflict
   * resolution required"; a command that reported some other code for a shared
   * executor event would make two commands disagree about one thing that
   * happened. This case exists partly to keep that propagation honest, so it
   * asserts the code rather than merely that the run failed.
   *
   * The recovery is asserted **in the order it must be followed**, by position
   * and not by presence: `repair` first, because a second review moves the file
   * the incomplete transaction is still holding.
   *
   * **The window *before* the transaction, which the case below does not reach.** That one
   * races the edit into the middle of the run, where the executor's own verification catches
   * it. This one lands the edit between `decide`'s read and `execute` — a window the executor
   * could not see at all, because it snapshotted the target when `execute()` ran and took
   * whatever was there as the "before" state. A hand edit made in that gap was read, ignored,
   * and overwritten by the re-rendered capture, in the verb whose whole purpose is to bring a
   * hand edit under this product's guarantees.
   *
   * `review` now supplies the digest of the bytes it read, so the executor refuses. Hooking
   * `readText` is what puts the write in the gap rather than in the transaction: the wrapper
   * returns what the command asked for, and then somebody else changes the file.
   *
   * **A capture holding a byte that is not valid UTF-8 still reviews.** The precondition is a
   * digest of what was read, and the first version digested a *re-encode* of the decoded
   * text. Node's `utf8` decode is lossy — `0x93`, the cp1252 smart quote a paste produces,
   * becomes U+FFFD and re-encodes to `EF BF BD` — so the digest described bytes the file
   * never held and the executor refused every time. Permanently: the message said the file
   * had changed on disk, the recovery said to run it again, and running it again refused
   * identically, pinning an unredacted capture in quarantine for ever.
   *
   * `parseCaptureFile` does not stop it, which the first version's comment claimed: it
   * validates frontmatter and passes the body through as text.
   */
  it("accepts a capture whose body holds a byte that is not valid UTF-8", async () => {
    const fixture = await installedFixture("review-invalid-utf8");
    const seeded = await fixture.seed(OBSERVATION);
    const original = await nodeFs.readFile(seeded.path);
    await nodeFs.writeFile(
      seeded.path,
      Buffer.concat([original, Buffer.from([0x93])]),
      { mode: 0o600 },
    );

    const result = await fixture.run(fixture.context, {
      id: seeded.id,
      decision: "accept",
    });

    expect(result.ok, "a lossy digest made this refuse for ever").toBe(true);
  });

  it("refuses, keeping the hand edit, when it lands between the read and the write", async () => {
    const fixture = await installedFixture("review-read-window");
    const seeded = await fixture.seed(OBSERVATION);
    const edited = (await nodeFs.readFile(seeded.path, "utf8")).replace(
      OBSERVATION,
      "an observation the user edited by hand before the write",
    );

    let raced = false;
    const guards = fixture.context.guards;
    const context: CliContext = {
      ...fixture.context,
      guards: {
        ...guards,
        /**
         * **The `reader` must be forwarded, and the first version dropped it.** `readCapture`
         * passes a reader so it can hash the bytes; a wrapper declared `(path)` discards it
         * silently, `asRead` stays `""`, and the executor then refuses whatever the file
         * contains — so the case passed without the race and proved nothing. Gating on
         * `reader !== undefined` also identifies the read whose digest is pinned, rather than
         * the earlier one that only resolves the path.
         */
        readText: async (
          path: string,
          reader?: Parameters<typeof guards.readText>[1],
        ): Promise<string> => {
          const text = await guards.readText(path, reader);
          if (path === seeded.path && reader !== undefined && !raced) {
            raced = true;
            writeFileSync(seeded.path, edited, { mode: 0o600 });
          }
          return text;
        },
      },
    };

    const result = await fixture.run(context, {
      id: seeded.id,
      decision: "accept",
    });

    expect(raced, "the hand edit must actually have landed in the window").toBe(true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
    expect(result.error.message).toContain("changed on disk");
    /**
     * And it promises what only a plan-phase refusal can: nothing was written. The
     * mid-transaction case below deliberately promises neither.
     */
    expect(result.error.message).toContain("your edit is intact");
    expect(result.error.recovery ?? "").not.toContain("repair");
    /** And the user's words are still on disk, which is the point of refusing. */
    await expect(nodeFs.readFile(seeded.path, "utf8")).resolves.toBe(edited);
  });

  it("refuses, keeping the newer file, when a hand edit lands mid-transaction", async () => {
    let onClock: (() => void) | null = null;
    let tick = 0;
    const fixture = await installedFixture("review-conflict", {
      now: (): Date => {
        const hook = onClock;
        onClock = null;
        hook?.();
        tick += 1;
        return new Date(Date.UTC(2026, 6, 30, 12, 0, 0) + tick);
      },
    });
    const seeded = await fixture.seed(OBSERVATION);
    const concurrent = (await nodeFs.readFile(seeded.path, "utf8")).replace(
      OBSERVATION,
      "an observation someone edited by hand a moment later",
    );
    let raced = false;
    onClock = (): void => {
      raced = true;
      writeFileSync(seeded.path, concurrent, { mode: 0o600 });
    };

    const result = await fixture.run(fixture.context, {
      id: seeded.id,
      decision: "accept",
    });

    expect(raced, "the concurrent edit must actually have been staged").toBe(true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
    expect(result.error.message).toContain("changed on disk");
    expect(result.error.message).toContain("did not complete");
    const recovery = result.error.recovery ?? "";
    const repairAt = recovery.indexOf("developer-os repair");
    const reviewAgainAt = recovery.indexOf("run the same review again");
    expect(repairAt).toBeGreaterThan(-1);
    expect(reviewAgainAt).toBeGreaterThan(-1);
    expect(repairAt, recovery).toBeLessThan(reviewAgainAt);
    /** The hand edit survived, and nothing was applied. */
    expect(await nodeFs.readFile(seeded.path, "utf8")).toBe(concurrent);
    const transactions = await reviewTransactions(fixture);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.phase).toBe("planned");
  });

  /**
   * The narrower job the mismatch refusal keeps: a frontmatter `captureId` that
   * disagrees with the filename — a rename, or a hand-edited id field.
   */
  /**
   * **A user who changes their mind can say so, without editing their own data.** Spec §5.5
   * gained `accepted → rejected` on 2026-08-20: before it, the only way to stop `ingest`
   * retrying a capture was to hand-edit the frontmatter back to `quarantined` — which is what
   * both of `ingest`'s recovery strings told people to do. A product recommending a hand edit
   * of its own data is the gap.
   */
  it("rejects a capture the user already accepted", async () => {
    const fixture = await installedFixture("review-accepted-reject");
    const seeded = await fixture.seed(OBSERVATION);

    const accepted = await fixture.run(fixture.context, {
      id: seeded.id,
      decision: "accept",
    });
    expect(accepted.ok).toBe(true);
    expect((await envelopeOf(fixture, seeded.path)).status).toBe("accepted");

    const rejected = await fixture.run(fixture.context, {
      id: seeded.id,
      decision: "reject",
    });

    expect(rejected.ok).toBe(true);
    expect((await envelopeOf(fixture, seeded.path)).status).toBe("rejected");
  });

  /**
   * **And the refusal names what is available instead of recommending a hand edit.** `accept`
   * from `accepted` is still illegal — `accepted → accepted` is not a transition this table
   * can hold — but the message must now say which decision *does* move the capture
   * from where it is, because one does.
   */
  it("names the decision that is available when the one asked for is not", async () => {
    const fixture = await installedFixture("review-available-decision");
    const seeded = await fixture.seed(OBSERVATION);
    await fixture.run(fixture.context, { id: seeded.id, decision: "accept" });

    const result = await fixture.run(fixture.context, {
      id: seeded.id,
      decision: "accept",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("--decision accept does not move");
    expect(result.error.recovery ?? "").toContain("--decision reject");
    /** And it no longer tells the user to edit their own frontmatter. */
    expect(result.error.recovery ?? "").not.toContain("by hand");
  });

  /**
   * **The zero-decision fallback, which was untested and wrong for two statuses.** When no
   * verb moves a capture the refusal falls back to a hand edit — and it named `quarantined`
   * for all four such statuses. `ingest`'s own recovery strings say a `staging` capture goes
   * back to **`accepted`**; following the old advice set it to `quarantined`, then `accept`,
   * and then `ingest` met its own notes at a path `create` refuses — permanently stuck,
   * having done exactly what the product said.
   */
  it.each([
    /**
     * `staging` is two states and `review` cannot tell them apart, so the advice must name
     * both — the partly-applied case needs the notes removed before `accepted`, and giving it
     * the stranded advice alone strands it exactly as the old string did.
     */
    ["staging", "remove them and set accepted"],
    ["ingested", "already in the vault"],
    ["failed", "quarantined"],
    ["rejected", "quarantined"],
  ])("advises the right hand edit for a capture at %s", async (status, advice) => {
    const fixture = await installedFixture(`review-fallback-${status}`);
    const seeded = await fixture.seed(OBSERVATION);
    await setStatus(seeded.path, status);

    const result = await fixture.run(fixture.context, {
      id: seeded.id,
      decision: "reject",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.recovery ?? "").toContain(advice);
    if (status === "staging") {
      /** Never `quarantined`, which was the original defect. */
      expect(result.error.recovery ?? "").not.toContain("quarantined");
      /** And the stranded half too, so neither sub-state is left without its target. */
      expect(result.error.recovery ?? "").toContain("if none did, set accepted");
    }
  });

  it("refuses an edit whose frontmatter id stops matching the filename", async () => {
    const fixture = await installedFixture("review-edit-mismatch");
    const seeded = await fixture.seed(OBSERVATION);
    await replaceInFile(
      seeded.path,
      `captureId: ${seeded.id}`,
      `captureId: ${"0".repeat(16)}`,
    );

    const result = await fixture.run(fixture.context, {
      id: seeded.id,
      decision: "edit",
    });

    expect(result.code).toBe(EXIT_CODES.invalidInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.recovery).toContain("restore");
    /** Refused, so nothing was written and the file is still the user's. */
    expect(await reviewTransactions(fixture)).toStrictEqual([]);
    expect(await nodeFs.readFile(seeded.path, "utf8")).toContain(
      `captureId: ${"0".repeat(16)}`,
    );
  });

  /**
   * Spec §5.6's own validator: **no decision deletes a source.** Three captures
   * are seeded and the count asserted before anything runs — over an empty
   * directory `before[0]` is `undefined` and `expect([]).toEqual([])` holds, so
   * the case would prove nothing about deletion at all.
   */
  it.each(["accept", "reject", "edit"] as const)(
    "deletes no source under %s",
    async (decision) => {
      const fixture = await installedFixture(`review-keeps-${decision}`);
      const seeded = await seedThree(fixture);
      const before = await listQuarantine(fixture);
      expect(before).toHaveLength(3);

      const result = await fixture.run(fixture.context, {
        id: seeded[0]?.id ?? "",
        decision,
      });

      expect(result.code).toBe(EXIT_CODES.success);
      expect(await listQuarantine(fixture)).toStrictEqual(before);
    },
  );

  /**
   * Spec §5.6: `edit` re-validates, it does not open an editor. Spawning
   * `$EDITOR` was rejected because it adds an interactive escape hatch to a
   * command that must stay `--json`- and `--yes`-driveable.
   */
  it.each(["accept", "reject", "edit"] as const)(
    "does not open an editor under %s",
    async (decision) => {
      const fixture = await installedFixture(`review-no-editor-${decision}`);
      /** Or an implementation honouring either variable could not be seen to. */
      expect(fixture.context.env.EDITOR).toBe(EDITOR);
      expect(fixture.context.env.VISUAL).toBe(VISUAL);
      const seeded = await fixture.seed(OBSERVATION);

      const result = await fixture.run(fixture.context, {
        id: seeded.id,
        decision,
      });

      expect(result.code).toBe(EXIT_CODES.success);
      expect(fixture.spawned).toStrictEqual([]);
    },
  );

  it.each(["accepted", "rejected", "ingested"])(
    "refuses a decision against a capture already at %s",
    async (status) => {
      const fixture = await installedFixture(`review-illegal-${status}`);
      const seeded = await fixture.seed(OBSERVATION);
      await setStatus(seeded.path, status);
      const before = await nodeFs.readFile(seeded.path, "utf8");

      const result = await fixture.run(fixture.context, {
        id: seeded.id,
        decision: "accept",
      });

      expect(result.code).toBe(EXIT_CODES.invalidInput);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain(status);
      expect(await nodeFs.readFile(seeded.path, "utf8")).toBe(before);
      expect(await reviewTransactions(fixture)).toStrictEqual([]);
    },
  );

  /**
   * Spec §5.6, stated as a refusal rather than as a default: a `--decision`
   * with no `--id` is invalid input, **not** "apply to all". The seeded
   * captures are what makes it observable — over an empty vault an
   * apply-to-all implementation would also write nothing.
   */
  it("refuses a decision with no id, rather than applying it to every capture", async () => {
    const fixture = await installedFixture("review-decision-without-id");
    const seeded = await seedThree(fixture);
    const before = await Promise.all(
      seeded.map((capture) => nodeFs.readFile(capture.path, "utf8")),
    );

    const result = await fixture.run(fixture.context, { decision: "accept" });

    expect(result.code).toBe(EXIT_CODES.invalidInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("--id");
    expect(await reviewTransactions(fixture)).toStrictEqual([]);
    for (const [index, capture] of seeded.entries()) {
      expect(await nodeFs.readFile(capture.path, "utf8")).toBe(before[index]);
    }
  });

  it("refuses an id with no decision, rather than guessing one", async () => {
    const fixture = await installedFixture("review-id-without-decision");
    const seeded = await fixture.seed(OBSERVATION);

    const result = await fixture.run(fixture.context, { id: seeded.id });

    expect(result.code).toBe(EXIT_CODES.invalidInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("--decision");
    expect(await reviewTransactions(fixture)).toStrictEqual([]);
  });

  it.each(["approve", "ACCEPT", "", "accept "])(
    "refuses %s, which is not one of the three decisions",
    async (decision) => {
      const fixture = await installedFixture(
        `review-bad-decision-${decision.trim() || "empty"}`,
      );
      const seeded = await fixture.seed(OBSERVATION);

      const result = await fixture.run(fixture.context, { id: seeded.id, decision });

      expect(result.code).toBe(EXIT_CODES.invalidInput);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      /**
       * The message, not only the code: a decision this command does not know
       * would also refuse further down — at a capture it then failed to find —
       * and the two refusals mean opposite things to the user.
       */
      expect(result.error.message).toContain("a decision is one of");
      expect(await reviewTransactions(fixture)).toStrictEqual([]);
    },
  );

  /**
   * The id names a file, so it is checked as one before it is joined to a path.
   * A traversal is the case that matters — `--id` is user input, and the only
   * thing between it and an arbitrary path is this shape check.
   */
  it.each(["../../etc/passwd", "0f1e2d3c4b5a697", "0F1E2D3C4B5A6978", "a/b", ""])(
    "refuses %s, which is not the name of a capture",
    async (id) => {
      const fixture = await installedFixture(
        `review-bad-id-${id.replace(/\W/gu, "-") || "empty"}`,
      );
      await fixture.seed(OBSERVATION);

      const result = await fixture.run(fixture.context, { id, decision: "accept" });

      expect(result.code).toBe(EXIT_CODES.invalidInput);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      /**
       * Refused **for its shape**, which the exit code alone does not say: with
       * the shape check removed, four of these five ids are joined to a path
       * and refused only because no file happens to be there — a different
       * rule, a different guarantee, and the same exit code.
       */
      expect(result.error.message).toContain("16 lowercase hexadecimal");
      expect(await reviewTransactions(fixture)).toStrictEqual([]);
    },
  );

  it("refuses an id no capture is filed under", async () => {
    const fixture = await installedFixture("review-missing-capture");
    await fixture.seed(OBSERVATION);

    const result = await fixture.run(fixture.context, {
      id: "0".repeat(16),
      decision: "accept",
    });

    expect(result.code).toBe(EXIT_CODES.invalidInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("no capture is filed under");
    expect(await reviewTransactions(fixture)).toStrictEqual([]);
  });

  it("refuses when no vault exists, at exit 1", async () => {
    const fixture = await createCommandFixture("review-no-vault");

    const result = await runReview(fixture.context, {});

    expect(result.code).toBe(EXIT_CODES.operationalFailure);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.recovery).toContain("developer-os init");
  });
});
