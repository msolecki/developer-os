import { lstat, mkdir, readFile, rename, rm, symlink } from "node:fs/promises";
import { join } from "node:path";

import { EXIT_CODES } from "@developer-os/core";
import { runCapture } from "@developer-os/cli/dist/commands/capture.js";

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
 * closes it is an absolute anchor: `resolveContainedRoot` proves the quarantine
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

/**
 * **The same relocation, met by the command that *writes* the capture.**
 *
 * `ingest` and `review` refuse it; `capture` did not, because it built its
 * quarantine path textually and handed it straight to `validateChangePlan` as an
 * owned root (`apps/cli/src/commands/capture.ts:578`). A **sideways** relocation
 * passes every check that validator makes — the root neither grows authority nor
 * lands in `excludedRoots` — so `developer-os capture` wrote the user's redacted
 * observation into an attacker-chosen directory, one file per capture, forever.
 *
 * **The primitive is bounded and worth stating so the case is not read as more
 * than it is.** The model cannot reach it: it holds zero write scopes and every
 * path it proposes is refused out of the private folders, so planting the link
 * needs prior local write access to the vault. What it then buys is silent
 * exfiltration of every future capture — into a synced folder, say. It cannot
 * overwrite, cannot choose the file name, and cannot reach outside a directory
 * the attacker already controls.
 *
 * The operational absurdity is its own reason to refuse: with two of the three
 * commands refusing at exit 5 and the third writing happily, captures pile up
 * somewhere nothing will ever read them.
 */
describe("a quarantine directory that resolves outside the vault, met by capture", () => {
  interface Captured {
    readonly quarantineIsALink: boolean;
    readonly relocatedInsideVault: boolean;
    readonly code: number;
    readonly destinationBefore: readonly string[];
    readonly destinationAfter: readonly string[];
    readonly filesInTheVault: readonly string[];
  }

  let captured: Captured;

  beforeAll(async () => {
    const fixture = await installSecurityFixture("symlink-quarantine-capture");

    const stolen = join(fixture.root, "stolen");
    await mkdir(stolen, { recursive: true, mode: 0o700 });
    await rename(fixture.quarantine, join(stolen, "quarantine"));
    await symlink(join(stolen, "quarantine"), fixture.quarantine);

    /**
     * The relocation carries `init`'s own `.gitkeep` with it, so "nothing was
     * written" is the set being **unchanged** rather than empty — an empty
     * expectation here would be false on both sides of the fix.
     */
    const destination = join(stolen, "quarantine");
    const destinationBefore = await filesUnder(destination);

    const result = await runCapture(
      fixture.context,
      { text: "an observation nobody agreed to relocate" },
      { cwd: () => fixture.project, detect: () => "unknown" },
    );

    captured = {
      quarantineIsALink: (await lstat(fixture.quarantine)).isSymbolicLink(),
      relocatedInsideVault: destination.startsWith(`${fixture.paths.brain}/`),
      code: result.code,
      destinationBefore,
      destinationAfter: await filesUnder(destination),
      filesInTheVault: await filesUnder(fixture.content),
    };
  }, 120_000);

  it("reaches the state the finding is about", () => {
    expect(captured.quarantineIsALink, "quarantine must be a symlink").toBe(true);
    expect(captured.relocatedInsideVault, "the target must be outside the vault").toBe(
      false,
    );
    /** The vault is real, so "nothing was written" is measured against a vault. */
    expect(
      captured.filesInTheVault.length,
      "a sweep over an empty vault is not a sweep",
    ).toBeGreaterThan(0);
  });

  it("is refused at exit 5, and no observation is written at the destination", () => {
    /** The harm first, so a failure here names the file that was written. */
    expect(captured.destinationAfter).toStrictEqual(captured.destinationBefore);
    expect(
      captured.destinationAfter.some((path) => path.endsWith(".md")),
      "no capture file may exist at the destination",
    ).toBe(false);
    expect(captured.code).toBe(EXIT_CODES.securityRefusal);
  });
});

/**
 * **The relocation that stays inside the vault**, which no containment check
 * refuses: `containsPath` is same-or-descendant
 * (`packages/core/src/manifest/store.ts:111-114`, `fromRoot === ""`), so a
 * quarantine symlinked to the content root resolves *inside* the content root
 * and passes. Both spellings are driven — `content` would put a capture where
 * discovery reads it, `content/_raw` one level above quarantine.
 *
 * **What refuses it, measured rather than assumed.** Not the ownership check
 * this case was written for. `init` records the Brain skeleton's **directories**
 * as managed artifacts — `/content`, `/content/_raw`, `/content/_raw/quarantine`
 * among them — and `validateChangePlan` canonicalizes every artifact path before
 * it reaches ownership, refusing when two collide
 * (`packages/core/src/plans/validate.ts:296-306`). A quarantine linked to either
 * ancestor makes exactly that collision, so both spellings end at exit 6 —
 * `installation manifest is malformed or incomplete` — with nothing written.
 *
 * **So this case is a pin, not a regression test**, and it passed the day it was
 * written. It went in with the fix that stopped handing `validateChangePlan` a
 * pre-canonicalized owned root, which re-arms the ancestor check in
 * `assertUsableRoots` (`:200-205`) — a check that compares the canonical root
 * against the declared one and therefore cannot fire when they are the same
 * string. That check is depth behind the collision above, not the thing standing
 * today; the report for this round records the probe both ways round.
 *
 * The assertions are therefore about the **property** — refused, nothing written
 * — rather than about which of the three guards got there first, so the case
 * survives any of them changing and reddens if the last one goes.
 */
describe("a quarantine directory that resolves to an ancestor of itself", () => {
  interface Relocated {
    readonly label: string;
    readonly code: number;
    readonly newFilesInTheVault: readonly string[];
  }

  const relocations: readonly string[] = ["content", "content/_raw"];
  const observed: Relocated[] = [];

  beforeAll(async () => {
    for (const relocation of relocations) {
      const fixture = await installSecurityFixture(
        `symlink-quarantine-ancestor-${relocation.replace(/\W+/gu, "-")}`,
      );
      const ancestor = join(fixture.paths.brain, relocation);

      await rm(fixture.quarantine, { recursive: true });
      await symlink(ancestor, fixture.quarantine);

      const before = await filesUnder(fixture.paths.brain);
      const result = await runCapture(
        fixture.context,
        { text: `an observation aimed at ${relocation}` },
        { cwd: () => fixture.project, detect: () => "unknown" },
      );
      const after = await filesUnder(fixture.paths.brain);
      const known = new Set(before);

      observed.push({
        label: relocation,
        code: result.code,
        newFilesInTheVault: after.filter((path) => !known.has(path)),
      });
    }
  }, 120_000);

  it("reaches the state the finding is about", () => {
    expect(observed.map((entry) => entry.label)).toStrictEqual([...relocations]);
    /** Each run must have been a real one, against a real installation. */
    expect(observed).toHaveLength(2);
  });

  it("refuses each spelling, and writes no capture anywhere in the vault", () => {
    for (const entry of observed) {
      expect(
        entry.newFilesInTheVault,
        `${entry.label} must leave the vault unchanged`,
      ).toStrictEqual([]);
      expect(entry.code, `${entry.label} must be refused`).not.toBe(
        EXIT_CODES.success,
      );
    }
  });
});

/**
 * **`content/_indexes` itself replaced by a link out of the vault** — NEW-19.
 * `writeIndexArtifacts` built its `ownedRoots` entry the same way
 * `resolveQuarantineRoot` once did: textually, from `vaultRoot` and
 * `indexesDir`, never proven to resolve inside the vault. `brain reindex` and
 * `ingest`'s third transaction are the two writers; this drives the one this
 * suite already has a helper for.
 *
 * **The second assertion is the one that matters.** A refusal alone would also
 * be satisfied by `ingest` failing for an unrelated reason; an empty
 * `outside-indexes` is what says nothing was written outside the vault.
 *
 * **The exit code is asserted too, not only `result.ok`.** The quarantine
 * containment refusal three commands share is `EXIT_CODES.securityRefusal`;
 * this one used to be constructed at `EXIT_CODES.operationalFailure` through
 * `IndexWriteRequest.refuse`, which is built for an unrelated internal
 * invariant (a validated plan losing its staged content), so a bare
 * `result.ok === false` could not tell a containment escape from an ordinary
 * operational failure. This is the assertion that would have caught that.
 */
describe("a symlink out of the index root", () => {
  it("refuses at exit 5 to write index artifacts through a relocated _indexes directory", async () => {
    const fixture = await installSecurityFixture("symlink-indexes");
    const outside = join(fixture.root, "outside-indexes");
    await mkdir(outside, { recursive: true, mode: 0o700 });

    const indexes = join(fixture.content, "_indexes");
    await rm(indexes, { recursive: true, force: true });
    await symlink(outside, indexes);

    const seeded = await fixture.seedAccepted("an observation about the index root");
    fixture.runner.reply(() => oneNote(seeded.id, "DEV/note.md", "An ordinary note"));

    const result = await fixture.ingest();

    expect(result.ok).toBe(false);
    expect(result.code).toBe(EXIT_CODES.securityRefusal);
    expect(await filesUnder(outside)).toStrictEqual([]);
  });
});

/**
 * **The regression the NEW-19 fix must not introduce** — a user whose
 * `brainPath` is, say, `~/DeveloperBrain` with `~/DeveloperBrain/content` a
 * symlink to an existing vault elsewhere — an external volume, a pre-existing
 * Obsidian vault — is a real layout, not a hostile one, and `writeIndexArtifacts`
 * anchoring on `vaultRoot` (the brain root) instead of the content root refused
 * it. That regression is pinned at `apps/cli/src/commands/reindex.test.ts`,
 * **not here**, and deliberately at the `writeIndexArtifacts` level rather than
 * through `brain reindex` or `ingest`: both commands call
 * `BrainService.reindex()` before this suite's code ever runs, and
 * `BrainService`'s own note discovery
 * (`packages/brain/src/discovery/discover.ts`'s `refuseEscapingLink`) refuses
 * *any* content root reached through a symlink, vault-escaping or not — a
 * separate, pre-existing guard, unrelated to NEW-19 and out of this task's
 * scope, that a full command-level fixture here would trip on for a reason
 * that has nothing to do with the anchor this task fixed.
 */
