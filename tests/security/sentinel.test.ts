import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { formatJsonResult } from "@developer-os/core";
import type { TransactionJournalV1 } from "@developer-os/core";
import { runIngest } from "@developer-os/cli/dist/commands/ingest.js";
import { run } from "@developer-os/cli/dist/main.js";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  filesUnder,
  installSecurityFixture,
  oneNote,
  readFilesUnder,
  removeSecurityFixtures,
  SENTINEL,
} from "./helpers.js";
import type { InstalledFixture } from "./helpers.js";

/**
 * **One planted secret, traced through every artifact it could reach.** Design
 * spec §17.5's release blocker and `BACKLOG.md` §3's gate, in one file.
 *
 * **Asserted per artifact, never in total.** A single assertion over a
 * concatenation of all nine would pass while eight of them were empty, which is
 * the shape of gate this repository has already shipped twice. The
 * `toBeGreaterThan(0)` line in each case is not decoration: it is what stops the
 * suite passing by collecting nothing.
 *
 * **`backups/transactions/` used to be out of the sweep and no longer is.**
 * `TransactionExecutor.backUp` writes the pre-edit file raw, and nothing pruned it — so a
 * secret removed from a vault file by a later edit survived there, which was a measured
 * defect this suite was not allowed to assert around. **That fix landed on 2026-08-17**
 * (Foundation request 2): every backup payload is pruned at `finalized` and at
 * `rolled_back`, both terminal, and a crash between the transition and the prune is swept
 * by the next resume. The exclusion's justification is gone, so the exclusion is gone.
 *
 * **Backups are their own artifact with their own floor, not appended to staging.**
 * Concatenating them would let the staging files satisfy the `toBeGreaterThan(0)` guard
 * while the backups half silently collected nothing — which is precisely the shape this
 * docblock rules out two paragraphs up, and which an earlier version of this change did.
 * Both are sampled from inside `afterPhase`, because a transaction that reaches a terminal
 * phase has already pruned by the time a command returns.
 *
 * **What `finalize` does *not* remove is the staging directory itself** — an earlier
 * version of this comment said it did, and `tests/e2e/foundation.test.ts` now asserts the
 * opposite: staged payloads survive uninstall. That is a separate residual, and it is why
 * sweeping this directory matters rather than trusting a lifecycle claim about it.
 */

const ARTIFACTS = [
  "the capture file",
  "the logs",
  "the --json output",
  "the deduplication hash",
  "the model input",
  "the staging directory",
  "the backup directory",
  "every validator report",
  "the canonical note",
] as const;

type Artifact = (typeof ARTIFACTS)[number];

type Evidence = Readonly<Record<Artifact, readonly string[]>>;

/** The two observations, both carrying the sentinel, in two different shapes. */
const CLEAN_TEXT = `an observation whose token is ${SENTINEL} and which becomes a note`;
const LEAKY_TEXT = `a second observation, also holding ${SENTINEL}, whose proposal leaks`;

/**
 * The `.tmp` files `writeDurableFile` puts beside a target before renaming over
 * it. They are gone by the time a phase hook runs — the rename is inside the
 * phase — so this reliably contributes nothing; it is here because "the staging
 * directory" means every place bytes wait to be applied, and a future executor
 * that held one across a phase boundary would be swept without anyone
 * remembering to add it.
 */
async function temporariesBeside(target: string): Promise<readonly string[]> {
  const directory = dirname(target);
  let names: readonly string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const staged = names.filter(
    (name) => name.startsWith(".") && name.endsWith(".tmp"),
  );
  return Promise.all(
    staged.map((name) => readFile(join(directory, name), "latin1")),
  );
}

let fixture: InstalledFixture;
let evidence: Evidence;
let refused = false;
/**
 * **A floor on payloads, because the artifact floor cannot be one.** `ARTIFACTS`' guard is
 * `backups.length > 0`, and `backUp` writes `<index>.json` metadata for **every** mutation
 * whether or not a payload accompanies it — so a create-only transaction leaves two files
 * in its backup directory and satisfies that guard on metadata alone. It proves the
 * directory was read; it cannot prove a payload was collected, which is the only thing in
 * there that can carry the secret. The regression it exists to catch — payloads no longer
 * reaching the sweep — would leave it green.
 */
let payloadsSeen = 0;

async function collect(): Promise<Evidence> {
  const staging: string[] = [];
  const backups: string[] = [];
  let watch: ((journal: TransactionJournalV1) => Promise<void>) | null = null;

  fixture = await installSecurityFixture("sentinel", {
    afterPhase: async (_phase, journal): Promise<void> => {
      if (watch !== null) await watch(journal);
    },
  });
  watch = async (journal: TransactionJournalV1): Promise<void> => {
    staging.push(...(await readFilesUnder(fixture.paths.stagingDir)));
    /**
     * **`backups/` joined the sweep on 2026-08-17**, when the defect that excluded it was
     * fixed. `TransactionExecutor` now prunes every backup payload at both terminal
     * phases, so this directory is a place a sentinel must not survive rather than a
     * measured hole the suite had to route around.
     *
     * Swept from inside `afterPhase`, like staging, because that is the only way to see
     * the mid-transaction state: by the time a command returns, a finalized transaction
     * has already pruned. So this observes the payload *while it exists* and the
     * assertion is that even then it carries no sentinel.
     */
    backups.push(...(await readFilesUnder(fixture.paths.backupsDir)));
    payloadsSeen += (await filesUnder(fixture.paths.backupsDir)).filter((path) =>
      path.endsWith(".bin"),
    ).length;
    for (const mutation of journal.mutations) {
      staging.push(...(await temporariesBeside(mutation.targetPath)));
    }
  };

  const { context, io } = fixture;

  /** Pass one, human mode: this is what a person sees on stdout and stderr. */
  const clean = await fixture.capture(CLEAN_TEXT);
  await run(
    ["review", "--id", clean.id, "--decision", "accept"],
    io,
    () => context,
  );
  fixture.runner.reply(() =>
    oneNote(clean.id, "DEV/sentinel-note.md", "Sentinel note"),
  );
  await run(["ingest"], io, () => context);
  const humanOut = [...io.out];
  const humanErr = [...io.err];

  /** Pass two, machine mode: the same pipeline, published as `--json`. */
  const leaky = await fixture.capture(LEAKY_TEXT);
  await run(
    ["review", "--id", leaky.id, "--decision", "accept", "--json"],
    io,
    () => context,
  );
  /**
   * The vendor hands the sentinel *back*, so the secret scan fires and the run
   * produces validation findings. That is the only way to collect the
   * "every validator report" artifact with something in it.
   */
  /**
   * **The sentinel goes in the note's body and deliberately not in its path**, and that is a
   * measured exclusion rather than an oversight. Planting it in the path turns the `--json`
   * case red: `failureFrom` redacts `message`, `data` and `recovery`, and passes `paths`
   * through untouched. The fix is not to redact the field — the redactor's `high-entropy`
   * class fires on a sixteen-hex capture id, so redacting paths publishes
   * `[REDACTED:high-entropy].md` for `_raw/quarantine/<id>.md` — but a redactor that applies
   * the pattern classes alone, which is **NEW-36**'s registered gap.
   *
   * **BACKLOG NEW-39** carries the leak with this measurement. The exclusion is named here
   * because a suite that quietly stops planting where it leaks is the shape this file's own
   * docblock warns about; when NEW-39 closes, the plant moves into the path and this
   * paragraph goes.
   */
  fixture.runner.reply(() =>
    oneNote(leaky.id, "DEV/leaky.md", "Leaky note", `the token is ${SENTINEL}`),
  );
  const refusal = await runIngest(context, {});
  /**
   * Recorded rather than asserted here. An assertion in the collector would
   * abort every per-artifact case below on the one change most likely to break
   * them — a redactor that stopped recognising the sentinel — and a suite whose
   * eight cases all report "suite failed to collect" tells a reviewer nothing
   * about which artifact leaked. It is asserted as its own case instead.
   */
  refused = !refusal.ok;
  const jsonOut = io.out.slice(humanOut.length);

  const cleanFile = await fixture.captureText(clean.id);
  const leakyFile = await fixture.captureText(leaky.id);
  const notes = await readFilesUnder(fixture.content);

  return {
    "the capture file": [cleanFile, leakyFile],
    "the logs": [
      ...humanOut,
      ...humanErr,
      ...(await readFilesUnder(fixture.paths.logsDir)),
    ],
    "the --json output": [...jsonOut, formatJsonResult(refusal)],
    /**
     * The two content-derived identifiers a capture carries. Both are computed
     * from the *redacted* body, so a product that hashed before redacting would
     * publish a fingerprint of the secret — which is why the hash is an artifact
     * in its own right rather than part of the capture file above.
     */
    "the deduplication hash": [
      clean.id,
      leaky.id,
      hashLineOf(cleanFile),
      hashLineOf(leakyFile),
    ],
    "the model input": fixture.runner.calls.map((call) => call.args.join("\n")),
    "the staging directory": staging,
    "the backup directory": backups,
    "every validator report": refusal.ok
      ? []
      : [refusal.error.message, refusal.error.recovery ?? ""],
    "the canonical note": notes,
  };
}

function hashLineOf(text: string): string {
  return /^deduplicationHash:.*$/mu.exec(text)?.[0] ?? "";
}

beforeAll(async () => {
  evidence = await collect();
}, 120_000);

afterAll(removeSecurityFixtures);

describe("a planted sentinel, per artifact", () => {
  it.each(ARTIFACTS)("keeps the sentinel out of %s", (artifact) => {
    const contents = evidence[artifact];
    expect(
      contents.length,
      `${artifact} produced nothing to scan`,
    ).toBeGreaterThan(0);
    for (const [index, content] of contents.entries()) {
      expect(content, `${artifact}, entry ${String(index)}`).not.toContain(
        SENTINEL,
      );
    }
  });

  /**
   * The negative direction, and it is load-bearing: without it every case above
   * would still pass if `SENTINEL` were a string this product never saw. The
   * sentinel really did travel through the pipeline, and what reaches these
   * artifacts is the redactor's marker in its place.
   */
  it("planted a sentinel the redactor actually recognised", () => {
    const marker = "[REDACTED:provider-token]";
    expect(evidence["the capture file"].join("\n")).toContain(marker);
    expect(evidence["the model input"].join("\n")).toContain(marker);
    expect(evidence["the staging directory"].join("\n")).toContain(marker);
    /**
     * And the model really did hand it back, so the validator report exists
     * because the secret scan fired rather than because some other validator
     * happened to complain.
     */
    expect(refused, "the model's reply must have been refused").toBe(true);
    expect(evidence["every validator report"].join("\n")).toContain(
      "secret-scan",
    );
    expect(evidence["the canonical note"].length).toBeGreaterThan(1);
  });

  /**
   * **The backup sweep's real floor.** `"the backup directory"` is satisfied by the
   * `<index>.json` metadata `backUp` writes for every mutation, payload or not — so once
   * any transaction has run, that guard can never fail, and a change that stopped payloads
   * reaching the sweep would leave the whole suite green.
   *
   * `review --decision accept` replaces an existing capture file, so `backUp` writes a
   * payload for it, and `afterPhase` fires inside `transition` — before `pruneBackups` —
   * so the sweep observes the pre-image while it exists. This asserts it observed one.
   */
  it("collected a backup payload, not only its metadata", () => {
    expect(payloadsSeen).toBeGreaterThan(0);
  });
});
