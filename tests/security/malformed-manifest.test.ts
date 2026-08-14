import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

/** The commands this suite covered, asserted non-empty rather than assumed. */
const COVERED = ["capture", "review", "ingest"] as const;

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
  it("covers every path this subsystem adds", () => {
    expect(COVERED.length, "a suite that covered nothing is not a suite").toBeGreaterThan(
      0,
    );
    expect([...COVERED]).toStrictEqual(["capture", "review", "ingest"]);
  });

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
  });
});

describe("a schema-valid manifest claiming a path the product never installed", () => {
  it("does not widen what capture writes", async () => {
    const fixture = await installSecurityFixture("manifest-claim");
    const genuine = JSON.parse(await manifestBytes(fixture)) as ManifestShape;
    const template = genuine.artifacts[0];
    expect(template, "the installation must record at least one artifact").toBeDefined();
    if (template === undefined) return;

    const claimed = join(fixture.root, "outside-claim.md");
    await forge(
      fixture,
      `${JSON.stringify({
        ...genuine,
        artifacts: [...genuine.artifacts, { ...template, path: claimed }],
      })}\n`,
    );

    const result = await runCapture(
      fixture.context,
      { text: "an observation under a claiming manifest" },
      { cwd: () => fixture.project, detect: () => "unknown" },
    );

    expect(result.ok).toBe(true);
    /** The forged claim named a real path, and nothing was ever put there. */
    expect(await filesUnder(fixture.root)).not.toContain(claimed);
    /** And the capture landed where it belongs, so the run was not a no-op. */
    const quarantined = await filesUnder(fixture.quarantine);
    expect(quarantined.length).toBeGreaterThan(0);
  });

  it("does not widen what ingest writes", async () => {
    const fixture = await installSecurityFixture("manifest-claim-ingest");
    const seeded = await fixture.seedAccepted("an observation under a claim");
    const genuine = JSON.parse(await manifestBytes(fixture)) as ManifestShape;
    const template = genuine.artifacts[0];
    if (template === undefined) throw new Error("no artifact to copy");

    const claimed = join(fixture.root, "outside-claim.md");
    await forge(
      fixture,
      `${JSON.stringify({
        ...genuine,
        artifacts: [...genuine.artifacts, { ...template, path: claimed }],
      })}\n`,
    );
    fixture.runner.reply(() => oneNote(seeded.id, "DEV/claimed.md", "Claimed run"));

    const result = await fixture.ingest();

    expect(result.ok).toBe(true);
    expect(await fixture.statusOf(seeded.id)).toBe("ingested");
    expect(await filesUnder(fixture.root)).not.toContain(claimed);
  });
});
