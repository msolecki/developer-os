import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { EXIT_CODES } from "@developer-os/core";
import { runCapture } from "@developer-os/cli/dist/commands/capture.js";
import { runReview } from "@developer-os/cli/dist/commands/review.js";

import { afterEach, describe, expect, it } from "vitest";

import {
  filesUnder,
  installSecurityFixture,
  oneNote,
  removeSecurityFixtures,
} from "./helpers.js";
import type { InstalledFixture } from "./helpers.js";

/**
 * **A forged installation manifest refuses rather than applies**, on every path
 * this subsystem adds.
 *
 * Two forgeries, because they fail in two different places and only one of them
 * is caught by a schema:
 *
 * - **Unparseable**, which `ManifestStore.readOptional` refuses outright. Every
 *   command that reads the manifest then refuses at exit 6, and — the half worth
 *   asserting — **none of them rewrites it**. A command that repaired a manifest
 *   it could not read would be inventing an ownership record.
 * - **Schema-valid but forged**, an extra artifact entry claiming a path the
 *   product never installed. Nothing widens: the claim is inert, the claimed
 *   path is never created, and the command writes exactly what it would have
 *   written without it.
 *
 * **`review` is the one path here that reads no manifest at all.** `review.ts`
 * has no `context.manifests` call, so a malformed one neither stops it nor is
 * honoured by it. That is recorded rather than asserted away: the case below
 * pins what is actually true — the decision completes, the forged bytes are left
 * exactly as they were, and nothing outside quarantine changes.
 *
 * **"Stale" in the sense of a manifest recording files that are gone is not a
 * refusal** and is deliberately not asserted as one: `writeIndexArtifacts`
 * reconciles the manifest towards the disk before it plans anything
 * (`apps/cli/src/commands/reindex.ts:152-170`), which is documented behaviour
 * with a documented reason. Asserting a refusal there would pin the opposite of
 * the design.
 */

const FORGERY = "not json at all\n";

/**
 * **What this suite reached, recorded by the case that reached it.**
 *
 * It was a literal compared against itself, which is a gate that passes by
 * scanning nothing — inside the one directory whose subject is exactly that.
 *
 * **Keyed by the case, not by the command.** Keying it by the command made the
 * promise below false for two of the five cases: `capture` was recorded twice
 * and `ingest` twice, so deleting either forgery case left the set complete and
 * this gate green. A label per case is what makes "delete a case and the set
 * shrinks" true.
 *
 * **Each `add` runs after the assertions it vouches for**, so a case that fails
 * part-way does not record itself — which is what makes the coverage case go red
 * beside the case that broke, rather than reporting coverage the run did not
 * have.
 */
const exercised = new Set<string>();

/**
 * Written out here rather than derived from the cases, so the two can disagree.
 * The command each case exercises is the prefix, which is how the brief's own
 * requirement — capture, review and ingest each get a case — is still checked
 * without a second literal to drift.
 */
const EVERY_CASE: readonly string[] = [
  "capture · unreadable manifest",
  "review · unreadable manifest",
  "ingest · unreadable manifest",
  "capture · forged ownership claim",
  "ingest · forged ownership claim",
];

const EVERY_PATH: readonly string[] = ["capture", "review", "ingest"];

interface ManifestShape {
  readonly artifacts: readonly Record<string, unknown>[];
  readonly [key: string]: unknown;
}

async function forge(fixture: InstalledFixture, text: string): Promise<void> {
  await writeFile(fixture.paths.manifestFile, text, { mode: 0o600 });
}

async function manifestBytes(fixture: InstalledFixture): Promise<string> {
  return readFile(fixture.paths.manifestFile, "utf8");
}

afterEach(removeSecurityFixtures);

describe("an unreadable installation manifest", () => {
  it("stops capture at exit 6, and leaves the forgery for a person to look at", async () => {
    const fixture = await installSecurityFixture("manifest-capture");
    await forge(fixture, FORGERY);
    const before = await filesUnder(fixture.quarantine);

    const result = await runCapture(
      fixture.context,
      { text: "an observation under a forged manifest" },
      { cwd: () => fixture.project, detect: () => "unknown" },
    );

    expect(result.code).toBe(EXIT_CODES.recoveryRequired);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("manifest");
    /** No capture was written, and the manifest was not repaired under us. */
    expect(await filesUnder(fixture.quarantine)).toStrictEqual(before);
    expect(await manifestBytes(fixture)).toBe(FORGERY);
    exercised.add("capture · unreadable manifest");
  });

  it("stops ingest at exit 6, and leaves the forgery for a person to look at", async () => {
    const fixture = await installSecurityFixture("manifest-ingest");
    const seeded = await fixture.seedAccepted("an observation before the forgery");
    await forge(fixture, FORGERY);
    fixture.runner.reply(() => oneNote(seeded.id, "DEV/forged.md", "Forged run"));

    const result = await fixture.ingest();

    expect(result.code).toBe(EXIT_CODES.recoveryRequired);
    expect(await fixture.statusOf(seeded.id)).not.toBe("ingested");
    expect(await manifestBytes(fixture)).toBe(FORGERY);
    exercised.add("ingest · unreadable manifest");
  });

  /**
   * `review` reads no manifest. The assertion is therefore containment rather
   * than refusal, and saying which is the point: a case written as "review
   * refuses a forged manifest" would be asserting a property this product does
   * not have, and would have to be made green by changing `review`.
   */
  it("neither stops review nor is honoured by it, and review still writes only the capture", async () => {
    const fixture = await installSecurityFixture("manifest-review");
    const seeded = await fixture.capture("an observation awaiting a decision");
    await forge(fixture, FORGERY);
    const before = await filesUnder(fixture.paths.brain);
    expect(before.length, "a sweep over an empty vault is not a sweep").toBeGreaterThan(
      0,
    );

    const result = await runReview(fixture.context, {
      id: seeded.id,
      decision: "accept",
    });

    expect(result.ok).toBe(true);
    expect(await fixture.statusOf(seeded.id)).toBe("accepted");
    /** Exactly the files that were there before: one changed, none added. */
    expect(await filesUnder(fixture.paths.brain)).toStrictEqual(before);
    expect(await manifestBytes(fixture)).toBe(FORGERY);
    exercised.add("review · unreadable manifest");
  });
});

describe("a schema-valid manifest claiming a path the run actually writes", () => {
  /**
   * **The claim has to name a path the run attempts**, or the forgery is never
   * exercised as the widening it claims to test. An earlier version of these two
   * cases claimed `<root>/outside-claim.md` while the run wrote somewhere else
   * entirely, so the assertion "the claimed path was not created" held for a
   * path nothing had ever named — true, and about nothing.
   *
   * A manifest entry does not cause a file to be created; it is an ownership
   * record. So each case below points the claim at the exact path its run is
   * about to write, and asserts the write is refused anyway.
   *
   * **The two paths refuse for different reasons, and the difference is the
   * point.** On the capture path the forged entry really is consulted:
   * `validateChangePlan` reads it and `assertOwnership` refuses a `create` over
   * a managed path (`packages/core/src/plans/validate.ts:244-246`). On the
   * ingest path it is **inert** — `applyNotes` runs no `validateChangePlan` at
   * all, and says so in terms (`apps/cli/src/commands/ingest.ts:706-713`),
   * because a note is the user's own content and recording one as managed would
   * report every legitimate edit as drift. What refuses there is the
   * create-never-replace `exists()` check, which owes nothing to the manifest.
   *
   * A reader who took "ownership guards both" from this comment would be taking
   * the ingest path's safety on credit for a mechanism that is not running on
   * it.
   */
  it("refuses to create a capture at a path a forged manifest claims to own", async () => {
    const fixture = await installSecurityFixture("manifest-claim-capture");
    const genuine = JSON.parse(await manifestBytes(fixture)) as ManifestShape;
    const template = genuine.artifacts[0];
    expect(template, "the installation must record at least one artifact").toBeDefined();
    if (template === undefined) return;

    /**
     * `captureId` is `H(redacted, normalized content)` and nothing else
     * (`packages/brain/src/capture/build.ts:202-207`), so the same text names
     * the same file twice. The first capture is how this case learns the path
     * the second one will write; removing it makes `create` legal on disk again,
     * which leaves the manifest as the only thing standing in the way.
     */
    const text = "an observation a forged manifest claims to own";
    const first = await fixture.capture(text);
    await rm(first.path);
    const emptied = await filesUnder(fixture.quarantine);
    expect(emptied, "the sweep must be able to see the directory").not.toStrictEqual([]);
    expect(emptied).not.toContain(first.path);

    await forge(
      fixture,
      `${JSON.stringify({
        ...genuine,
        artifacts: [...genuine.artifacts, { ...template, path: first.path }],
      })}\n`,
    );

    const result = await runCapture(
      fixture.context,
      { text },
      { cwd: () => fixture.project, detect: () => "unknown" },
    );

    expect(result.ok).toBe(false);
    /** The write was attempted at the claimed path, and refused there. */
    expect(await filesUnder(fixture.quarantine)).not.toContain(first.path);
    exercised.add("capture · forged ownership claim");
  });

  it("refuses to replace a note a forged manifest claims to own", async () => {
    const fixture = await installSecurityFixture("manifest-claim-ingest");
    const seeded = await fixture.seedAccepted("an observation over a claimed note");
    const genuine = JSON.parse(await manifestBytes(fixture)) as ManifestShape;
    const template = genuine.artifacts[0];
    if (template === undefined) throw new Error("no artifact to copy");

    /**
     * A note the user already has, claimed by the forgery as a product-managed
     * artifact — the shape that would authorize a replace if ownership were what
     * this path consulted. The vendor is then scripted to propose **that exact
     * path**, so the run really does attempt the write.
     */
    const claimed = join(fixture.content, "DEV", "claimed.md");
    const theirs = "# A note the user wrote\n\nTheir words, not the model's.\n";
    await mkdir(dirname(claimed), { recursive: true, mode: 0o700 });
    await writeFile(claimed, theirs, { mode: 0o600 });

    await forge(
      fixture,
      `${JSON.stringify({
        ...genuine,
        artifacts: [...genuine.artifacts, { ...template, path: claimed }],
      })}\n`,
    );
    fixture.runner.reply(() => oneNote(seeded.id, "DEV/claimed.md", "Claimed run"));

    const result = await fixture.ingest();

    /** The user's bytes, untouched: `ingest` creates notes and never replaces one. */
    expect(await readFile(claimed, "utf8")).toBe(theirs);
    expect(result.ok).toBe(false);
    expect(await fixture.statusOf(seeded.id)).toBe("accepted");
    if (result.ok) return;
    expect(result.error.message).toContain("ingest creates notes and never replaces one");
    exercised.add("ingest · forged ownership claim");
  });
});

/**
 * Last in the file, and derived rather than declared: the set is whatever the
 * cases above actually reached, recorded by each of them after its own
 * assertions passed. `EVERY_CASE` is the independent list it is measured
 * against — a second copy on purpose, because a set compared against its own
 * producer is the gate this directory exists to refuse.
 *
 * **A filtered run does not redden this case — it hides it, which is worse.**
 * Vitest 4.1.8 *skips* non-matching cases rather than failing them, and a `-t`
 * pattern chosen to select the cases above will not normally select this one:
 * `npx vitest run security/malformed-manifest.test.ts -t "review"` reports
 * `1 passed | 5 skipped`, **green**, having driven one case of five. This case
 * cannot warn about that, because it was filtered out along with the coverage it
 * measures. Measured, not assumed — an earlier version of this paragraph claimed
 * the opposite.
 *
 * The one filtered form that *does* redden is a pattern matching this case's own
 * name too. `--shard` never triggers it at all — vitest shards at file
 * granularity, so a selected file runs whole.
 */
describe("what this suite covered", () => {
  it("reached every case it declares, and every path this subsystem adds", () => {
    expect(exercised.size, "a suite that reached nothing is not a suite").toBeGreaterThan(
      0,
    );
    expect([...exercised].sort()).toStrictEqual([...EVERY_CASE].sort());
    /**
     * And the brief's own requirement, read back off the labels rather than off
     * a third literal: capture, review and ingest each got a case.
     */
    const paths = new Set([...exercised].map((label) => label.split(" · ")[0]));
    expect([...paths].sort()).toStrictEqual([...EVERY_PATH].sort());
  });
});
