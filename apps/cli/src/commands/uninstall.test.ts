import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import type { ManagedArtifactV1 } from "@developer-os/core";

import { runInit } from "./init.js";
import {
  createCommandFixture,
  exists,
  inventory,
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
   * Spec §2.5: uninstall never deletes a capture. There is no `capture`
   * command yet (DOS-P6 builds it after this task), so this plants a
   * synthetic quarantined file at the path captures will live at and checks
   * the same guarantee the Brain-preservation tests above already exercise
   * generally — the vault is an excluded root uninstall never writes into —
   * pinned specifically for the one directory a capture is never allowed to
   * vanish from.
   */
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
