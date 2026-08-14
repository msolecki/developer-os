import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { formatJsonResult } from "@developer-os/core";
import type { TransactionJournalV1 } from "@developer-os/core";
import { runIngest } from "@developer-os/cli/dist/commands/ingest.js";
import { run } from "@developer-os/cli/dist/main.js";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
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
 * concatenation of all eight would pass while seven of them were empty, which is
 * the shape of gate this repository has already shipped twice. The
 * `toBeGreaterThan(0)` line in each case is not decoration: it is what stops the
 * suite passing by collecting nothing.
 *
 * **`backups/transactions/` is deliberately out of the sweep**, and not because
 * it is out of scope. `TransactionExecutor.backUp` writes the pre-edit file raw,
 * and nothing prunes it, so a secret removed from a vault file by a later edit
 * survives there. That is a measured, known defect with a named fix pending in
 * Foundation (`docs/superpowers/ORDER.md`), not a property this suite may assert
 * or work around. "The staging directory" below therefore means the executor's
 * own staging area — the bytes it is about to apply — which `finalize` removes.
 */

const ARTIFACTS = [
  "the capture file",
  "the logs",
  "the --json output",
  "the deduplication hash",
  "the model input",
  "the staging directory",
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

async function collect(): Promise<Evidence> {
  const staging: string[] = [];
  let watch: ((journal: TransactionJournalV1) => Promise<void>) | null = null;

  fixture = await installSecurityFixture("sentinel", {
    afterPhase: async (_phase, journal): Promise<void> => {
      if (watch !== null) await watch(journal);
    },
  });
  watch = async (journal: TransactionJournalV1): Promise<void> => {
    staging.push(...(await readFilesUnder(fixture.paths.stagingDir)));
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
});
