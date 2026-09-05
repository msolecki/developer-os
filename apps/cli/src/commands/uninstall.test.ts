import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import type { ManagedArtifactV1 } from "@developer-os/core";

import { loadOrCreateRedactionKey } from "../context.js";
import { runInit } from "./init.js";
import {
  createCommandFixture,
  exists,
  inventory,
  inventoryDigest,
  removeCommandFixtures,
} from "./testing.js";
import type { CommandFixture } from "./testing.js";
import { runUninstall } from "./uninstall.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const SHARED_BEFORE = "vendor-line-one\nvendor-line-two\n";
const SHARED_INSTALLED = "vendor-line-one\ndeveloper-os-line\n";

afterEach(removeCommandFixtures);

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Adds an artifact of the shape Foundation never creates but every adapter will:
 * a file that existed before installation, was replaced, and whose original
 * bytes live in a backup.
 */
async function seedSharedArtifact(
  fixture: CommandFixture,
): Promise<{ readonly path: string; readonly backupRelativePath: string }> {
  const path = join(fixture.paths.home, "shared.json");
  await nodeFs.writeFile(path, SHARED_INSTALLED, { mode: 0o600 });

  const backupRelativePath = join("shared", "0.bin");
  const backupPath = join(fixture.paths.backupsDir, backupRelativePath);
  await nodeFs.mkdir(join(fixture.paths.backupsDir, "shared"), {
    recursive: true,
    mode: 0o700,
  });
  await nodeFs.writeFile(backupPath, SHARED_BEFORE, { mode: 0o600 });

  const manifest = await fixture.context.manifests.read();
  const artifact: ManagedArtifactV1 = {
    owner: "core",
    path,
    kind: "file",
    productVersion: fixture.context.productVersion,
    existedBefore: true,
    beforeHash: hashOf(SHARED_BEFORE),
    backupRelativePath,
    installedHash: hashOf(SHARED_INSTALLED),
    source: "generated/shared.json",
    mergeStrategy: "dedicated",
    verifiedAt: "2026-07-30T12:00:00.000Z",
  };
  await fixture.context.manifests.write({
    ...manifest,
    artifacts: [...manifest.artifacts, artifact],
  });

  return { path, backupRelativePath };
}

async function seedDirectoryArtifact(
  fixture: CommandFixture,
  path: string,
): Promise<void> {
  const manifest = await fixture.context.manifests.read();
  await fixture.context.manifests.write({
    ...manifest,
    artifacts: [
      ...manifest.artifacts,
      {
        owner: "core",
        path,
        kind: "directory",
        productVersion: fixture.context.productVersion,
        existedBefore: false,
        beforeHash: null,
        backupRelativePath: null,
        installedHash: hashOf(""),
        source: "generated/directory",
        mergeStrategy: "dedicated",
        verifiedAt: "2026-07-30T12:00:00.000Z",
      },
    ],
  });
}

describe("runUninstall", () => {
  it("uninstalls successfully while preserving every retained bootstrap evidence inode", async () => {
    const fixture = await createCommandFixture("uninstall-bootstrap-evidence", {
      bootstrapAvailable: true,
    });
    const initialized = await runInit(fixture.context, ACCEPTED);
    expect(initialized.ok).toBe(true);
    const before = await fixture.bootstrapEvidenceIdentities();
    expect(before.length).toBeGreaterThan(0);

    const result = await runUninstall(fixture.context, ACCEPTED);

    if (!result.ok) throw new Error(result.error.message);
    expect(result.ok).toBe(true);
    expect(result.data.retainedBootstrapEvidence).toHaveLength(1);
    expect(await fixture.bootstrapEvidenceIdentities()).toEqual(before);
    expect(await exists(fixture.paths.home)).toBe(true);
  }, 300_000);

  it("dry-runs and reports retained evidence without changing a byte", async () => {
    const fixture = await createCommandFixture("uninstall-bootstrap-dry-run", {
      bootstrapAvailable: true,
    });
    const initialized = await runInit(fixture.context, ACCEPTED);
    expect(initialized.ok).toBe(true);
    const before = await fixture.bootstrapEvidenceIdentities();
    const allBefore = await inventoryDigest(fixture.root);

    const result = await runUninstall(fixture.context, {
      dryRun: true,
      assumeYes: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.retainedBootstrapEvidence).toHaveLength(1);
    expect(await fixture.bootstrapEvidenceIdentities()).toEqual(before);
    expect(await inventoryDigest(fixture.root)).toEqual(allBefore);
  }, 300_000);

  it("still reports and preserves retained evidence when the manifest is absent", async () => {
    const fixture = await createCommandFixture("uninstall-bootstrap-no-manifest", {
      bootstrapAvailable: true,
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    expect((await runUninstall(fixture.context, ACCEPTED)).ok).toBe(true);
    const before = await fixture.bootstrapEvidenceIdentities();
    expect(before.length).toBeGreaterThan(0);

    const result = await runUninstall(fixture.rebuildContext(), ACCEPTED);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.removed).toEqual([]);
    expect(result.data.retainedBootstrapEvidence).toHaveLength(1);
    expect(await fixture.bootstrapEvidenceIdentities()).toEqual(before);
  }, 300_000);

  it("refuses a directory artifact that reaches the Brain through a symlinked ancestor", async () => {
    const fixture = await createCommandFixture("uninstall-symlink-escape");
    await runInit(fixture.context, ACCEPTED);

    const vaultDirectory = join(fixture.paths.brain, "Daily");
    await nodeFs.mkdir(vaultDirectory, { recursive: true, mode: 0o700 });
    await nodeFs.symlink(fixture.paths.brain, join(fixture.paths.home, "link"));

    const manifest = await fixture.context.manifests.read();
    await fixture.context.manifests.write({
      ...manifest,
      artifacts: [
        ...manifest.artifacts,
        {
          owner: "core",
          path: join(fixture.paths.home, "link", "Daily"),
          kind: "directory",
          productVersion: fixture.context.productVersion,
          existedBefore: false,
          beforeHash: null,
          backupRelativePath: null,
          installedHash: hashOf(""),
          source: "generated/directory",
          mergeStrategy: "dedicated",
          verifiedAt: "2026-07-30T12:00:00.000Z",
        },
      ],
    });

    const result = await runUninstall(fixture.context, {
      dryRun: false,
      assumeYes: true,
    });

    expect(result.ok).toBe(true);
    expect(await exists(vaultDirectory)).toBe(true);
  });

  it("refuses a directory artifact whose ancestor becomes a symlink after the ownership decision", async () => {
    const fixture = await createCommandFixture("uninstall-symlink-race");
    await runInit(fixture.context, ACCEPTED);

    const claimed = join(fixture.paths.home, "vault", "Daily");
    const victim = join(fixture.paths.brain, "Daily");
    let planted = false;

    // The window the exploit uses: every ownership decision is already made, the
    // transaction has run, and only the directory removals are left.
    const context = {
      ...fixture.context,
      guards: {
        ...fixture.context.guards,
        transaction: {
          ...fixture.context.guards.transaction,
          assertTarget: async (path: string): Promise<void> => {
            if (!planted) {
              planted = true;
              await nodeFs.mkdir(victim, { recursive: true, mode: 0o700 });
              await nodeFs.symlink(
                fixture.paths.brain,
                join(fixture.paths.home, "vault"),
              );
            }
            await fixture.context.guards.transaction.assertTarget(path);
          },
        },
      },
    };

    await seedDirectoryArtifact(fixture, claimed);

    await runUninstall(context, { dryRun: false, assumeYes: true });

    expect(planted).toBe(true);
    expect(await exists(victim)).toBe(true);
  });

  it("refuses a directory artifact swapped for a relocated ancestor after the ownership decision", async () => {
    const fixture = await createCommandFixture("uninstall-relocate-race");
    await runInit(fixture.context, ACCEPTED);

    const parent = join(fixture.paths.home, "keep");
    const claimed = join(parent, "inner");
    const victim = join(fixture.paths.brain, "inner");
    await nodeFs.mkdir(claimed, { recursive: true, mode: 0o700 });
    await nodeFs.mkdir(victim, { recursive: true, mode: 0o700 });
    let planted = false;

    const context = {
      ...fixture.context,
      guards: {
        ...fixture.context.guards,
        transaction: {
          ...fixture.context.guards.transaction,
          assertTarget: async (path: string): Promise<void> => {
            if (!planted) {
              planted = true;
              await nodeFs.rmdir(claimed);
              await nodeFs.rmdir(parent);
              await nodeFs.symlink(fixture.paths.brain, parent);
            }
            await fixture.context.guards.transaction.assertTarget(path);
          },
        },
      },
    };

    await seedDirectoryArtifact(fixture, claimed);

    await runUninstall(context, { dryRun: false, assumeYes: true });

    expect(planted).toBe(true);
    expect(await exists(victim)).toBe(true);
  });

  it("refuses on a dry run when a managed artifact was edited", async () => {
    const fixture = await createCommandFixture("uninstall-dry-run-drift");
    await runInit(fixture.context, ACCEPTED);
    await nodeFs.writeFile(fixture.paths.configFile, "schemaVersion = 1\n", {
      mode: 0o600,
    });

    const result = await runUninstall(fixture.context, {
      dryRun: true,
      assumeYes: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
  });

  it("never renders a control character from a manifest path", async () => {
    const fixture = await createCommandFixture("uninstall-escape-render", {
      answers: [false],
    });
    await runInit(fixture.context, ACCEPTED);
    const hostile = join(
      fixture.paths.home,
      `x\u001b[2JDeveloper OS will remove nothing.`,
    );
    await nodeFs.writeFile(hostile, "", { mode: 0o600 });

    const manifest = await fixture.context.manifests.read();
    await fixture.context.manifests.write({
      ...manifest,
      artifacts: [
        ...manifest.artifacts,
        {
          owner: "core",
          path: hostile,
          kind: "file",
          productVersion: fixture.context.productVersion,
          existedBefore: false,
          beforeHash: null,
          backupRelativePath: null,
          installedHash: hashOf(""),
          source: "generated/hostile",
          mergeStrategy: "dedicated",
          verifiedAt: "2026-07-30T12:00:00.000Z",
        },
      ],
    });

    await runUninstall(fixture.context, { dryRun: false, assumeYes: false });

    expect(fixture.io.questions).toHaveLength(1);
    expect(fixture.io.questions[0]).not.toContain("\u001b");
    expect(fixture.io.questions[0]).toContain("\uFFFD");
  });

  it("lists only manifest-owned artifacts on a dry run and changes nothing", async () => {
    const fixture = await createCommandFixture("uninstall-dry-run");
    await runInit(fixture.context, ACCEPTED);
    const unrelated = join(fixture.paths.home, "unrelated.txt");
    await nodeFs.writeFile(unrelated, "not ours\n", { mode: 0o600 });
    const before = await inventory(fixture.root);

    const result = await runUninstall(fixture.context, {
      dryRun: true,
      assumeYes: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transactionId).toBeNull();
    expect(result.data.removed).toContain(fixture.paths.configFile);
    expect(result.data.removed).not.toContain(unrelated);
    expect(result.data.preserved).toContain(fixture.paths.brain);
    expect(await inventory(fixture.root)).toEqual(before);
  });

  it("removes product artifacts and keeps the Brain", async () => {
    const fixture = await createCommandFixture("uninstall-accepted");
    await runInit(fixture.context, ACCEPTED);
    const note = join(fixture.paths.brain, "note.md");
    await nodeFs.writeFile(note, "synthetic user note\n", { mode: 0o600 });

    const result = await runUninstall(fixture.context, {
      dryRun: false,
      assumeYes: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await exists(fixture.paths.configFile)).toBe(false);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
    expect(await exists(fixture.paths.brain)).toBe(true);
    expect(await exists(join(fixture.paths.brain, ".gitkeep"))).toBe(true);
    expect(await nodeFs.readFile(note, "utf8")).toBe("synthetic user note\n");
    expect(result.data.preserved).toContain(fixture.paths.brain);
  });

  it("keeps transaction backups and unrelated files", async () => {
    const fixture = await createCommandFixture("uninstall-preserves");
    await runInit(fixture.context, ACCEPTED);
    const unrelated = join(fixture.paths.home, "unrelated.txt");
    await nodeFs.writeFile(unrelated, "not ours\n", { mode: 0o600 });
    const backupsBefore = await inventory(fixture.paths.backupsDir);
    const journalsBefore = await inventory(
      join(fixture.paths.stateDir, "transactions"),
    );
    expect(backupsBefore.length).toBeGreaterThan(0);
    expect(journalsBefore.length).toBeGreaterThan(0);

    await runUninstall(fixture.context, { dryRun: false, assumeYes: true });

    expect(await nodeFs.readFile(unrelated, "utf8")).toBe("not ours\n");
    for (const entry of backupsBefore) {
      expect(await exists(join(fixture.paths.backupsDir, entry))).toBe(true);
    }
    for (const entry of journalsBefore) {
      expect(
        await exists(join(fixture.paths.stateDir, "transactions", entry)),
      ).toBe(true);
    }
  });

  it("restores the original bytes of a file that existed before installation", async () => {
    const fixture = await createCommandFixture("uninstall-restore");
    await runInit(fixture.context, ACCEPTED);
    const shared = await seedSharedArtifact(fixture);

    const result = await runUninstall(fixture.context, {
      dryRun: false,
      assumeYes: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.restored).toContain(shared.path);
    expect(await nodeFs.readFile(shared.path, "utf8")).toBe(SHARED_BEFORE);
  });

  it("refuses when a managed artifact was edited after installation", async () => {
    const fixture = await createCommandFixture("uninstall-drift");
    await runInit(fixture.context, ACCEPTED);
    await nodeFs.writeFile(fixture.paths.configFile, "schemaVersion = 1\n", {
      mode: 0o600,
    });

    const result = await runUninstall(fixture.context, {
      dryRun: false,
      assumeYes: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
    expect(result.error.paths).toContain(fixture.paths.configFile);
    expect(await exists(fixture.paths.configFile)).toBe(true);
    expect(await exists(fixture.paths.manifestFile)).toBe(true);
  });

  it("changes nothing when the confirmation is declined", async () => {
    const fixture = await createCommandFixture("uninstall-declined", {
      answers: [false],
    });
    await runInit(fixture.context, ACCEPTED);
    const before = await inventory(fixture.root);

    const result = await runUninstall(fixture.context, {
      dryRun: false,
      assumeYes: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
    expect(await inventory(fixture.root)).toEqual(before);
  });

  it("is idempotent", async () => {
    const fixture = await createCommandFixture("uninstall-idempotent");
    await runInit(fixture.context, ACCEPTED);
    await runUninstall(fixture.context, { dryRun: false, assumeYes: true });
    const before = await inventory(fixture.root);

    const result = await runUninstall(fixture.context, {
      dryRun: false,
      assumeYes: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.removed).toEqual([]);
    expect(result.data.transactionId).toBeNull();
    expect(await inventory(fixture.root)).toEqual(before);
  });

  it("removes the redaction key file, which the manifest never named", async () => {
    const fixture = await createCommandFixture("uninstall-redaction-key");
    await runInit(fixture.context, ACCEPTED);
    const keyFile = join(fixture.paths.stateDir, "redaction.key");
    expect(await exists(keyFile)).toBe(true);

    const result = await runUninstall(fixture.context, {
      dryRun: false,
      assumeYes: true,
    });

    expect(result.ok).toBe(true);
    expect(await exists(keyFile)).toBe(false);
  });

  /**
   * Decision 5: `uninstall` removes exactly one path outside the manifest.
   * This pins the width of that exception directly, rather than trusting the
   * previous test's absence check alone — every *other* path this run removed
   * must have come from the manifest it read.
   */
  it("removes no path beyond the manifest and the redaction key", async () => {
    const fixture = await createCommandFixture("uninstall-redaction-key-scope");
    await runInit(fixture.context, ACCEPTED);
    const manifest = await fixture.context.manifests.read();
    const manifestPaths = new Set(
      manifest.artifacts.map((artifact) => artifact.path),
    );
    const keyFile = join(fixture.paths.stateDir, "redaction.key");
    const before = await inventory(fixture.root);

    await runUninstall(fixture.context, { dryRun: false, assumeYes: true });

    const after = new Set(await inventory(fixture.root));
    const removed = before
      .filter((entry) => !after.has(entry))
      .map((entry) => join(fixture.root, entry));

    /**
     * The manifest file itself is the other unavoidable exception: it never
     * names itself as a managed artifact, and removing it is what makes the
     * machine look uninitialized again. `redaction.key` is the only exception
     * this task adds.
     */
    expect(removed).toContain(keyFile);
    for (const path of removed) {
      expect(
        path === keyFile ||
          path === fixture.paths.manifestFile ||
          manifestPaths.has(path),
      ).toBe(true);
    }
  });

  /**
   * The trap the first implementation left behind, and the reason removal moved
   * above `runUninstall`'s early return. `uninstall` removed the key, the next
   * command of any kind put it back — and from then on the key could never be
   * removed again, because with the manifest already gone `runUninstall`
   * returns before it reaches the removal. The same trap caught an `init` that
   * failed and reverted: an orphaned secret nothing in the product would ever
   * clean up.
   */
  it("removes the redaction key even when no manifest is left to read", async () => {
    const fixture = await createCommandFixture("uninstall-key-no-manifest");
    await runInit(fixture.context, ACCEPTED);
    await runUninstall(fixture.context, ACCEPTED);
    const keyFile = join(fixture.paths.stateDir, "redaction.key");
    loadOrCreateRedactionKey(fixture.paths.stateDir);
    expect(await exists(keyFile)).toBe(true);
    expect(await fixture.context.manifests.readOptional()).toBeNull();

    const result = await runUninstall(fixture.context, ACCEPTED);

    expect(result.ok).toBe(true);
    expect(await exists(keyFile)).toBe(false);
  });

  it.each([true, false])(
    "leaves the redaction key alone on a dry run (manifest present: %s)",
    async (withManifest) => {
      const fixture = await createCommandFixture(
        `uninstall-key-dry-run-${String(withManifest)}`,
      );
      await runInit(fixture.context, ACCEPTED);
      const keyFile = join(fixture.paths.stateDir, "redaction.key");
      if (!withManifest) {
        await nodeFs.unlink(fixture.paths.manifestFile);
        loadOrCreateRedactionKey(fixture.paths.stateDir);
      }

      const result = await runUninstall(fixture.context, {
        dryRun: true,
        assumeYes: true,
      });

      expect(result.ok).toBe(true);
      expect(await exists(keyFile)).toBe(true);
    },
  );

  /**
   * Ordering, pinned directly rather than inferred from an outcome. The key is
   * removed *before* `revertArtifacts`, so `rmdir(stateDir)` can succeed when
   * the directory is otherwise empty; the reverse order leaves a state
   * directory holding one secret and nothing else, which `rmdir` then refuses
   * forever.
   */
  it("removes the redaction key before it reverts a single artifact", async () => {
    const fixture = await createCommandFixture("uninstall-key-ordering");
    await runInit(fixture.context, ACCEPTED);
    const keyFile = join(fixture.paths.stateDir, "redaction.key");
    const order: string[] = [];
    const context = {
      ...fixture.context,
      fs: {
        ...fixture.context.fs,
        unlink: async (
          path: Parameters<typeof nodeFs.unlink>[0],
        ): Promise<void> => {
          order.push(`unlink ${String(path)}`);
          await fixture.context.fs.unlink(path);
        },
        rmdir: async (
          path: Parameters<typeof nodeFs.rmdir>[0],
          options?: Parameters<typeof nodeFs.rmdir>[1],
        ): Promise<void> => {
          order.push(`rmdir ${String(path)}`);
          await fixture.context.fs.rmdir(path, options);
        },
      },
    };

    await runUninstall(context, ACCEPTED);

    const removedKeyAt = order.indexOf(`unlink ${keyFile}`);
    const firstRevert = order.findIndex(
      (entry) => entry !== `unlink ${keyFile}`,
    );
    expect(removedKeyAt).toBe(0);
    expect(firstRevert).toBeGreaterThan(removedKeyAt);
  });

  /**
   * Knowledge-pipeline architecture note §4: uninstall never deletes a capture.
   * This plants a synthetic quarantined file at the path captures live at and checks
   * the same guarantee the Brain-preservation tests above already exercise
   * generally — the vault is an excluded root uninstall never writes into —
   * pinned specifically for the one directory a capture is never allowed to
   * vanish from.
   */
  /**
   * `excludedRoots` used to carry every retained file and directory
   * (`evidence.retainedPaths`), which made every removability check pay for
   * the size of whatever the retained tree collapsed to. `isRemovableAt`
   * already prefix-matches, so the maximal roots
   * `deriveBootstrapRetentionLocations` produces (`evidence.retainedRoots`)
   * cover the same ground without listing each descendant.
   */
  it("keeps retention roots rather than every descendant of a retained tree", async () => {
    const fixture = await createCommandFixture("uninstall-retention-roots", {
      bootstrapAvailable: true,
    });
    const initialized = await runInit(fixture.context, ACCEPTED);
    expect(initialized.ok).toBe(true);
    if (fixture.context.bootstrap?.state !== "available") {
      throw new Error("fixture bootstrap is not available");
    }

    const identities = await fixture.bootstrapEvidenceIdentities();
    const retainedDirectory = identities.find(
      (candidate) =>
        candidate.kind === "directory" &&
        candidate.path.includes(".developer-os-retained."),
    );
    if (retainedDirectory === undefined) {
      throw new Error("no retained directory tombstone in the fixture");
    }

    const plantedPaths: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const nested = join(
        retainedDirectory.path,
        `sub-${String(index % 4)}`,
        `file-${String(index)}.txt`,
      );
      await nodeFs.mkdir(join(nested, ".."), { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(nested, `synthetic retained file ${String(index)}\n`, {
        mode: 0o600,
      });
      plantedPaths.push(nested);
    }

    const evidence = await fixture.context.bootstrap.inspectEvidence();

    /**
     * Every planted descendant is genuinely retained content — this is what
     * makes the roots-only exclusion meaningful rather than vacuous.
     */
    expect(evidence.retainedPaths).toEqual(expect.arrayContaining(plantedPaths));
    expect(evidence.retainedRoots).toContain(retainedDirectory.path);
    for (const path of plantedPaths) {
      expect(evidence.retainedRoots).not.toContain(path);
    }
  }, 300_000);

  /**
   * The assertion that keeps the roots-only exclusion honest: a manifest
   * artifact planted deep inside a retained tombstoned tree must still be
   * refused, because `containsPathLoosely` has to actually cover the
   * descendant, not merely the root itself.
   */
  it("still refuses to remove a manifest artifact deep inside a retained tree", async () => {
    const fixture = await createCommandFixture("uninstall-retention-deep-file", {
      bootstrapAvailable: true,
    });
    const initialized = await runInit(fixture.context, ACCEPTED);
    expect(initialized.ok).toBe(true);

    const identities = await fixture.bootstrapEvidenceIdentities();
    const retainedDirectory = identities.find(
      (candidate) =>
        candidate.kind === "directory" &&
        candidate.path.includes(".developer-os-retained."),
    );
    if (retainedDirectory === undefined) {
      throw new Error("no retained directory tombstone in the fixture");
    }

    const deepFile = join(
      retainedDirectory.path,
      "level-one",
      "level-two",
      "level-three",
      "level-four",
      "deep.txt",
    );
    await nodeFs.mkdir(join(deepFile, ".."), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(deepFile, "deeply retained\n", { mode: 0o600 });

    /**
     * A `bootstrapAvailable` install writes a schema-v2 manifest, which
     * `context.manifests.read()` cannot parse without the admission context
     * `readUninstallManifest`'s fallback supplies. This test only needs
     * `runUninstall` to see one manifest-owned artifact deep in the retained
     * tree, so it writes a fresh schema-v1 manifest rather than merging into
     * the v2 one.
     */
    await fixture.context.manifests.write({
      schemaVersion: 1,
      productVersion: fixture.context.productVersion,
      installedAt: "2026-07-30T12:00:00.000Z",
      artifacts: [
        {
          owner: "core",
          path: deepFile,
          kind: "file",
          productVersion: fixture.context.productVersion,
          existedBefore: false,
          beforeHash: null,
          backupRelativePath: null,
          installedHash: hashOf("deeply retained\n"),
          source: "generated/deep",
          mergeStrategy: "dedicated",
          verifiedAt: "2026-07-30T12:00:00.000Z",
        },
      ],
    });

    const result = await runUninstall(fixture.context, ACCEPTED);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.removed).not.toContain(deepFile);
    expect(await nodeFs.readFile(deepFile, "utf8")).toBe("deeply retained\n");
  }, 300_000);

  /**
   * NEW-59: `readUninstallManifest` used to reach every `schemaVersion === 2`
   * manifest through a catch that re-parsed it with an identity
   * `admitOwnerPath` and downcast `ephemeral` artifacts to a fixed
   * empty-content hash. `.lifecycle.lock` is recorded that way, and a real
   * fresh init leaves it at exactly zero bytes — matching the fixed
   * placeholder by coincidence. Writing real bytes into it afterwards, the
   * way a lock residue legitimately can, exposes the bug: the fallback's
   * expected hash stays the hash of empty content, so `detectDrift` reports
   * `content_changed` and `planUninstall` refuses removal as if the artifact
   * had been edited since install. Reading through the store's V2-aware path
   * records the artifact's real, current hash instead, which keeps the
   * comparison a no-op and lets uninstall proceed.
   */
  it("removes an ephemeral V2 artifact holding real content instead of refusing on a phantom edit", async () => {
    const fixture = await createCommandFixture("uninstall-v2-ephemeral-hash", {
      bootstrapAvailable: true,
    });
    const initialized = await runInit(fixture.context, ACCEPTED);
    expect(initialized.ok).toBe(true);

    const lockFile = join(fixture.paths.stateDir, ".lifecycle.lock");
    expect(await exists(lockFile)).toBe(true);
    await nodeFs.writeFile(lockFile, "stale-lock-residue", { mode: 0o600 });

    const result = await runUninstall(fixture.context, ACCEPTED);

    if (!result.ok) throw new Error(result.error.message);
    expect(result.ok).toBe(true);
    expect(result.data.removed).toContain(lockFile);
    expect(await exists(lockFile)).toBe(false);
  }, 300_000);

  it("leaves every quarantined capture in place, because a capture is never deleted", async () => {
    const fixture = await createCommandFixture("uninstall-quarantine");
    await runInit(fixture.context, ACCEPTED);
    const quarantineDir = join(
      fixture.paths.brain,
      "content",
      "_raw",
      "quarantine",
    );
    await nodeFs.mkdir(quarantineDir, { recursive: true, mode: 0o700 });
    const capturePath = join(quarantineDir, "synthetic-capture.md");
    await nodeFs.writeFile(capturePath, "synthetic quarantined capture\n", {
      mode: 0o600,
    });

    const result = await runUninstall(fixture.context, {
      dryRun: false,
      assumeYes: true,
    });

    expect(result.ok).toBe(true);
    expect(await nodeFs.readFile(capturePath, "utf8")).toBe(
      "synthetic quarantined capture\n",
    );
  });
});
