import { mkdir, readFile, rename, symlink } from "node:fs/promises";
import { join } from "node:path";

import { EXIT_CODES } from "@developer-os/core";

import { afterEach, describe, expect, it } from "vitest";

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
   * vault.** A symlink is not a capture. `captureFileNames` enumerates with
   * `withFileTypes` and keeps `entry.isFile()`, which is false for a symlink, so
   * the entry is never selected, never read, and never written back — the link
   * is not followed at all rather than followed and then refused.
   *
   * The distinction matters because the refusal that *would* catch it,
   * `resolveCapturePath`, cannot: `canonicalizePlannedPath` resolves a path's
   * directory components and keeps its final segment, so a link at the leaf
   * survives canonicalization unchanged and compares as inside quarantine.
   * Selection is the guard here, and this case is what pins it.
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

  /**
   * **A finding, parked rather than asserted.** Replacing the *quarantine
   * directory itself* with a link out of the vault is followed, not refused:
   * `resolveCapturePath` canonicalizes both the quarantine root and the target
   * and compares them against each other, so a quarantine that has moved takes
   * its containment check with it — and `ProtectedPathPolicy` is a protected-name
   * policy rather than a containment one, returning early for any path outside
   * `$HOME` (`packages/security/src/protected-paths.ts:125`). `ingest` therefore
   * completes, and the capture file it rewrites is the one outside the vault.
   *
   * Recorded as `it.fails` rather than corrected here, because correcting it is
   * a production change this task may not make. It goes red the day the
   * behaviour changes, which is the notification a comment alone cannot give.
   */
  it.fails(
    "does not yet refuse a quarantine directory that resolves outside the vault",
    async () => {
      const fixture = await installSecurityFixture("symlink-quarantine");
      const seeded = await fixture.seedAccepted("an observation in real quarantine");

      const stolen = join(fixture.root, "stolen");
      await mkdir(stolen, { recursive: true, mode: 0o700 });
      await rename(fixture.quarantine, join(stolen, "quarantine"));
      await symlink(join(stolen, "quarantine"), fixture.quarantine);

      fixture.runner.reply(() => oneNote(seeded.id));

      const result = await fixture.ingest();

      expect(result.code).toBe(EXIT_CODES.securityRefusal);
    },
  );
});
