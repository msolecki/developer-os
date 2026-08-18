import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { run } from "@developer-os/cli/dist/main.js";

import { afterEach, describe, expect, it } from "vitest";

import {
  filesUnder,
  installSecurityFixture,
  removeSecurityFixtures,
  SENTINEL,
} from "./helpers.js";

/**
 * **The measurement the architecture documents claim, actually performed.**
 *
 * `docs/architecture/threat-model.md` records "a secret removed from a vault file is gone
 * from the machine" as a boundary, and `apps/cli/src/commands/review.ts` says the claim was
 * re-measured by sweeping a fixture root after an edit. Neither was backed by anything that
 * runs: the evidence cell named `tests/security/sentinel.test.ts`, which samples from inside
 * `afterPhase` — that is, *before* the prune — and therefore passes with `pruneBackups`
 * disabled entirely. A boundary whose cited evidence cannot fail is an unbacked claim
 * (found by fresh-context review, 2026-08-17).
 *
 * **The sweep here is after the command returns, which is the only time it means anything.**
 * `review --decision edit` exists to remove a secret a user pasted into a vault file by
 * hand, and `TransactionExecutor.backUp` writes that pre-edit file raw to
 * `backups/transactions/<id>/<n>.bin` before the edit lands. That copy is what this asserts
 * is gone — from the whole product home, not from a directory named in advance, so a future
 * executor that parked the bytes somewhere else is caught by the same case.
 *
 * **The paste is written straight to the capture file**, rather than passed through
 * `capture`, because `capture` redacts on the way in: a secret that arrived that route was
 * never in the file to be backed up, and the case would pass without the product doing
 * anything. Hand-editing the file on disk is both the real scenario and the only one that
 * puts raw bytes where `backUp` will copy them.
 */

afterEach(removeSecurityFixtures);

describe("a secret removed from a vault file leaves the machine", () => {
  it("holds nowhere under the product home once the edit finalizes", async () => {
    const fixture = await installSecurityFixture("backup-prune");
    const seeded = await fixture.capture("an observation with nothing sensitive in it");
    const capturePath = join(fixture.quarantine, `${seeded.id}.md`);

    /** The hand-paste: raw bytes in the file, exactly as a user would leave them. */
    const before = await readFile(capturePath, "utf8");
    await writeFile(
      capturePath,
      before.replace(
        "an observation with nothing sensitive in it",
        `an observation whose token is ${SENTINEL}`,
      ),
      "utf8",
    );

    /**
     * **The sweep is non-vacuous, proved before the edit rather than argued.** If the paste
     * silently failed to land, every assertion below would pass on an empty premise — the
     * failure shape this whole directory exists to refuse.
     */
    const planted = await occurrences(fixture.paths.home, fixture.content);
    expect(planted, "the paste must reach the capture file").toBeGreaterThan(0);

    const result = await run(
      ["review", "--id", seeded.id, "--decision", "edit"],
      fixture.io,
      () => fixture.context,
    );
    expect(result).toBe(0);

    expect(await occurrences(fixture.paths.home, fixture.content)).toBe(0);
  });
});

/** Every file under both trees that carries the sentinel, counted rather than located. */
async function occurrences(...roots: readonly string[]): Promise<number> {
  let seen = 0;
  for (const root of roots) {
    for (const path of await filesUnder(root)) {
      if ((await readFile(path, "latin1")).includes(SENTINEL)) seen += 1;
    }
  }
  return seen;
}
