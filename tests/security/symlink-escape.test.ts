import { lstat, mkdir, readFile, rename, symlink } from "node:fs/promises";
import { join } from "node:path";

import { EXIT_CODES } from "@developer-os/core";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  filesUnder,
  installSecurityFixture,
  oneNote,
  removeSecurityFixtures,
} from "./helpers.js";

/**
 * **A proposal whose path resolves through a symlink out of `content/`.**
 *
 * Asserted on the **resolved destination**, never on the written path, because a
 * check on the written path is exactly the bug this suite exists to catch: a
 * proposal naming `DEV/escape/note.md` is inside `content/**` by every textual
 * measure, and lands outside the vault.
 */

afterEach(removeSecurityFixtures);

describe("a symlink out of the content root", () => {
  it("refuses at exit 5, leaves the capture accepted, and writes nothing at the destination", async () => {
    const fixture = await installSecurityFixture("symlink-proposal");
    const outside = join(fixture.root, "outside");
    await mkdir(outside, { recursive: true, mode: 0o700 });
    await mkdir(join(fixture.content, "DEV"), { recursive: true, mode: 0o700 });
    await symlink(outside, join(fixture.content, "DEV", "escape"));

    const seeded = await fixture.seedAccepted("an observation about a symlink");
    fixture.runner.reply(() =>
      oneNote(seeded.id, "DEV/escape/note.md", "Escaping note"),
    );
    const before = await filesUnder(fixture.root);

    const result = await fixture.ingest();

    expect(result.code).toBe(EXIT_CODES.securityRefusal);
    expect(await fixture.statusOf(seeded.id)).toBe("accepted");

    /** The destination, which is the only place the escape could show up. */
    const destination = join(outside, "note.md");
    expect(await filesUnder(outside)).toStrictEqual([]);
    expect(await filesUnder(fixture.root)).not.toContain(destination);

    /**
     * And nothing landed under the link's own name either, which is what a
     * product that refused the *written* path and then followed it would leave.
     */
    expect(before.length, "a sweep over nothing is not a sweep").toBeGreaterThan(0);
    expect(await filesUnder(fixture.content)).toStrictEqual(
      before.filter((path) => path.startsWith(`${fixture.content}/`)),
    );

    if (result.ok) return;
    expect(result.error.message).toContain("write-scope");
    expect(result.error.message).toContain("once symlinks are followed");
  });

  /**
   * The other direction, and the one that is about the capture rather than the
   * proposal: **one capture file inside quarantine replaced by a link out of the
   * vault.**
   *
   * A symlink is not a capture. `captureFileNames` enumerates with
   * `withFileTypes` and keeps `entry.isFile()`, which is false for a symlink, so
   * the entry is never selected, never read, and never written back — the link
   * is not followed at all rather than followed and then refused. **That is the
   * guard this case pins**, which is why the assertions are `ok` with an empty
   * `order` rather than a refusal: there is nothing to refuse.
   *
   * **There is a second guard behind it, measured rather than assumed.**
   * Widening the filter to `!entry.isDirectory()` makes the entry selectable,
   * and `resolveCapturePath` then refuses it at exit 5 — "the capture resolves
   * outside the quarantine directory" — because `canonicalizePlannedPath` does
   * resolve the link. Recorded here because an earlier version of this comment
   * claimed the opposite, and a wrong reason beside a right assertion is how the
   * next reader deletes the wrong one.
   */
  it("never follows a symlink standing where a capture file should be", async () => {
    const fixture = await installSecurityFixture("symlink-capture");
    const seeded = await fixture.seedAccepted("an observation about to be moved");

    const stolen = join(fixture.root, "stolen");
    await mkdir(stolen, { recursive: true, mode: 0o700 });
    const elsewhere = join(stolen, `${seeded.id}.md`);
    await rename(seeded.path, elsewhere);
    await symlink(elsewhere, seeded.path);
    const outsideBefore = await readFile(elsewhere, "utf8");

    fixture.runner.reply(() => oneNote(seeded.id));

    const result = await fixture.ingest();

    /** Nothing got as far as an agent call, so nothing was proposed. */
    expect(fixture.runner.calls).toStrictEqual([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.order).toStrictEqual([]);
    /** And the file the link pointed at is byte-identical, status and all. */
    expect(await readFile(elsewhere, "utf8")).toBe(outsideBefore);
    expect(outsideBefore).toContain("status: accepted");
  });

});

/**
 * **The quarantine directory itself replaced by a link out of the vault** —
 * NEW-14, parked here as an `it.fails` until DOS-P6 Task 19's review closed it.
 *
 * What made it work: `resolveCapturePath` canonicalized both the quarantine root
 * and the target and compared them **against each other**, so a quarantine that
 * had moved took its containment check along with it and every target under it
 * passed. `ProtectedPathPolicy` did not catch it either — it is a
 * protected-**name** policy rather than a containment one, and returns early for
 * any path outside `$HOME` (`packages/security/src/protected-paths.ts:125`). What
 * closes it is an absolute anchor: `resolveQuarantineRoot` proves the quarantine
 * directory is inside the configured content root before anything is measured
 * against it.
 *
 * **Still two cases, and still for the reason the parking needed.** The scenario
 * runs once in `beforeAll`; the first asserts the setup reached the state the
 * finding is about, so a broken fixture fails where it cannot be mistaken for
 * the defect, and the second holds the refusal and the absence of the harm.
 */
describe("a quarantine directory that resolves outside the vault", () => {
  interface Observed {
    readonly quarantineIsALink: boolean;
    readonly relocatedInsideVault: boolean;
    readonly before: string;
    readonly after: string;
    readonly code: number;
    readonly vaultNotes: readonly string[];
  }

  let observed: Observed;

  beforeAll(async () => {
    const fixture = await installSecurityFixture("symlink-quarantine");
    const seeded = await fixture.seedAccepted("an observation in real quarantine");

    const stolen = join(fixture.root, "stolen");
    await mkdir(stolen, { recursive: true, mode: 0o700 });
    await rename(fixture.quarantine, join(stolen, "quarantine"));
    await symlink(join(stolen, "quarantine"), fixture.quarantine);

    const relocated = join(stolen, "quarantine", `${seeded.id}.md`);
    const before = await readFile(relocated, "utf8");

    fixture.runner.reply(() => oneNote(seeded.id, "DEV/escaped-quarantine.md"));
    const result = await fixture.ingest();

    observed = {
      quarantineIsALink: (await lstat(fixture.quarantine)).isSymbolicLink(),
      relocatedInsideVault: relocated.startsWith(`${fixture.paths.brain}/`),
      before,
      after: await readFile(relocated, "utf8"),
      code: result.code,
      vaultNotes: (await filesUnder(fixture.content)).map((path) =>
        path.slice(fixture.content.length),
      ),
    };
  }, 120_000);

  it("reaches the state the finding is about", () => {
    /** The setup, asserted where a failure cannot be mistaken for the defect. */
    expect(observed.quarantineIsALink, "quarantine must be a symlink").toBe(true);
    expect(observed.relocatedInsideVault, "the target must be outside the vault").toBe(
      false,
    );
    expect(observed.before).toContain("status: accepted");
    expect(observed.vaultNotes.length, "a sweep over an empty vault is not a sweep")
      .toBeGreaterThan(0);
  });

  it("is refused at exit 5, and neither the capture nor the vault is touched", () => {
    expect(observed.code).toBe(EXIT_CODES.securityRefusal);

    /**
     * **The harm, asserted absent.** The file outside the vault is byte for byte
     * what it was — status included — and no note was written from it.
     */
    expect(observed.after).toBe(observed.before);
    expect(observed.after).toContain("status: accepted");
    expect(observed.vaultNotes).not.toContain("/DEV/escaped-quarantine.md");
  });
});
