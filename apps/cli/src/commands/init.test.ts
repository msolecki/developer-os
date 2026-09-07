import fsSync from "node:fs";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { EXIT_CODES, loadConfig, serializeConfig } from "@developer-os/core";
import { MacOsTransactionLockProvider } from "@developer-os/platform-macos";
import { structuredResultVerbs } from "@developer-os/workflow-schema";
import type * as SecurityModule from "@developer-os/security";

import { runInit } from "./init.js";
import type { InitDependencies } from "./init.js";
import { createCommandFixture, exists, inventory, inventoryDigest, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "./testing.js";

/**
 * Which key a redaction used is not observable from any value the CLI returns —
 * the replacement text is identical under every key — so the key `redactText`
 * is handed is recorded here. The fixture's own guards carry a constant key
 * that is deliberately not the one on disk, which is what makes "init redacts
 * with the key it just created" a claim this file can fail on. The wrapper
 * delegates, so every other suite here runs production behaviour unchanged.
 */
const { redactionKeyUses } = vi.hoisted(() => ({
  redactionKeyUses: [] as Uint8Array[],
}));

vi.mock("@developer-os/security", async (importOriginal) => {
  const actual =
    await importOriginal<typeof SecurityModule>();

  /**
   * **Spies on `createRedactor`, not on `redactText`.** `createRedactor` calls
   * `redactText` *inside* `redaction.ts`, and a module-internal call is not intercepted
   * by mocking the package barrel — so a spy on `redactText` sees nothing once the
   * commands route through the redactor, and the case silently stops observing the thing
   * it names. The claim being pinned is **almost** unchanged, and the difference is worth stating: the
   * old spy recorded the key an actual redaction ran under, this one records the key a
   * redactor was *constructed* with. Code that built `createRedactor(durableKey)` and
   * then wired a *different* redactor into the guards would pass. Nothing in the tree
   * does that — every site constructs and uses in one expression — but a future one
   * could, and a reader should not take this for the stronger claim.
   */
  return {
    ...actual,
    createRedactor: (key: Uint8Array, options?: SecurityModule.RedactionOptions) => {
      redactionKeyUses.push(Uint8Array.from(key));
      return actual.createRedactor(key, options);
    },
  };
});

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

afterEach(removeCommandFixtures);

function failingVerifier(): InitDependencies {
  return {
    verify: () =>
      Promise.reject(new Error("synthetic post-apply verification failure")),
  };
}

describe("runInit", () => {
  it("starts a distinct ID beside a valid rolled-back retained envelope", async () => {
    const fixture = await createCommandFixture("init-bootstrap-retained-retry", {
      bootstrapAvailable: true,
      bootstrapFailureAfter: "after_global_lock",
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const rolledBack = await runInit(fixture.context, ACCEPTED);
    expect(rolledBack.ok).toBe(false);
    const retainedBefore = await fixture.bootstrapEvidenceIdentities();
    expect(retainedBefore.length).toBeGreaterThan(0);
    const oldIds = new Set(retainedBefore.map((entry) => entry.id));
    expect(oldIds.size).toBe(1);
    const unrelated = join(fixture.userHome, "unrelated-user-sibling.txt");
    await nodeFs.writeFile(unrelated, "unrelated sibling\n", { mode: 0o600 });
    const retainedBootstrap = fixture.context.bootstrap;
    const rolledBackReport = retainedBootstrap?.state === "available"
      ? await retainedBootstrap.inspectEvidence()
      : null;
    expect(rolledBackReport?.blocksNewIntent).toBe(false);
    expect(rolledBackReport?.report.ids[0]).toMatchObject({
      status: "verified",
      terminalOutcome: "rolled_back",
    });
    expect(JSON.stringify(rolledBackReport)).not.toContain("unrelated sibling");
    expect(await nodeFs.readFile(unrelated, "utf8")).toBe("unrelated sibling\n");
    fixture.disableBootstrapFailure();
    fixture.setBootstrapInterrupt("after_journal");

    const retried = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(retried.ok).toBe(false);
    const retainedAfter = await fixture.bootstrapEvidenceIdentities();
    const newIds = new Set(retainedAfter.map((entry) => entry.id));
    expect(newIds.size).toBe(2);
    for (const entry of retainedBefore) expect(retainedAfter).toContainEqual(entry);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each([
    { aggregate: { idCount: 257, entryCount: 3, regularFileBytes: "0" }, reason: "bootstrap IDs" },
    { aggregate: { idCount: 1, entryCount: 1_000_001, regularFileBytes: "0" }, reason: "filesystem entries" },
    { aggregate: { idCount: 1, entryCount: 3, regularFileBytes: "12884901889" }, reason: "regular-file bytes" },
  ])("refuses reinstall first-over $reason before mutation", async ({ aggregate }) => {
    const fixture = await createCommandFixture("init-bootstrap-cap", {
      bootstrapAvailable: true,
      bootstrapEvidenceAggregate: aggregate,
    });
    const before = await inventoryDigest(fixture.root);

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("manual archive");
    expect(await inventoryDigest(fixture.root)).toEqual(before);
    expect(fixture.bootstrapTrace).toStrictEqual([]);
  });

  it.each([
    "live bootstrap lock",
    "live staging subtree",
    "live payload source",
  ] as const)("refuses %s before publishing a new intent", async (residue) => {
    const fixture = await createCommandFixture(`init-bootstrap-${residue.replaceAll(" ", "-")}`, {
      bootstrapAvailable: true,
      bootstrapProductionLocks: residue === "live bootstrap lock",
    });
    const residueId = "fi_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    /**
     * Held, not merely present. Retention never unlinks the bootstrap lock, so
     * a bare file of the same name is ordinary residue that Spec 2 lets a later
     * init start beside; only a lock another process still holds is live.
     */
    let heldResidueLock: { release(): Promise<void> } | null = null;
    if (residue === "live bootstrap lock") {
      await nodeFs.mkdir(fixture.paths.stateDir, { recursive: true, mode: 0o700 });
      heldResidueLock = await new MacOsTransactionLockProvider().acquire(
        join(fixture.paths.stateDir, ".lifecycle-bootstrap.lock"),
      );
    } else if (residue === "live staging subtree") {
      const staging = join(fixture.paths.stagingDir, "fresh-v2-init", residueId);
      await nodeFs.mkdir(staging, { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(join(staging, "live-source"), "synthetic live residue\n", { mode: 0o600 });
    } else {
      await nodeFs.mkdir(fixture.paths.stateDir, { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(
        join(fixture.paths.stateDir, `.fresh-v2-init.${residueId}.0000000000.payload`),
        "synthetic live residue\n",
        { mode: 0o600 },
      );
    }
    if (residue !== "live bootstrap lock") {
      const bootstrap = fixture.context.bootstrap;
      if (bootstrap?.state !== "available") throw new Error("bootstrap fixture is unavailable");
      const evidence = await bootstrap.inspectEvidence();
      expect(evidence.report.ids).toContainEqual(expect.objectContaining({
        id: residueId,
        status: "unverified",
      }));
      expect(evidence.blocksNewIntent).toBe(true);
    }
    const before = await inventoryDigest(fixture.root);

    const result = await runInit(fixture.context, ACCEPTED);

    try {
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(EXIT_CODES.recoveryRequired);
      expect(await inventoryDigest(fixture.root)).toEqual(before);
      expect(fixture.bootstrapTrace).toStrictEqual([]);
    } finally {
      await heldResidueLock?.release();
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a non-fresh, non-resumable init when evidence blocks a new intent", async () => {
    const fixture = await createCommandFixture("init-blocks-non-fresh", {
      bootstrapAvailable: true,
    });
    const residueId = "fi_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const staging = join(fixture.paths.stagingDir, "fresh-v2-init", residueId);
    await nodeFs.mkdir(staging, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(join(staging, "live-source"), "synthetic live residue\n", { mode: 0o600 });
    /**
     * A config file already on disk is what makes this `init` non-fresh
     * without a completed V2 install, so `resumableBootstrap` is false too —
     * the exact combination the executor regression case reaches by
     * interrupting a rollback instead.
     */
    const config = {
      schemaVersion: 1 as const,
      brainPath: fixture.paths.brain,
      adapters: { claude: false, codex: false },
      git: { enabled: false },
      automation: { enabled: false },
      telemetry: false as const,
    };
    await nodeFs.writeFile(fixture.paths.configFile, serializeConfig(config), { mode: 0o600 });

    const bootstrap = fixture.context.bootstrap;
    if (bootstrap?.state !== "available") throw new Error("bootstrap fixture is unavailable");
    const evidence = await bootstrap.inspectEvidence();
    expect(evidence.active).toBeNull();
    expect(evidence.blocksNewIntent).toBe(true);

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.recoveryRequired);
  });

  it("accepts the exact aggregate boundary projected by the publication plan", async () => {
    const aggregate = { idCount: 0, entryCount: 0, regularFileBytes: "0" };
    const fixture = await createCommandFixture("init-bootstrap-cap-exact", {
      bootstrapAvailable: true,
      bootstrapEvidenceAggregate: aggregate,
    });
    if (fixture.context.bootstrap?.state !== "available") throw new Error("bootstrap fixture is unavailable");
    const config = {
      schemaVersion: 1 as const,
      brainPath: fixture.paths.brain,
      adapters: { claude: false, codex: false },
      git: { enabled: false },
      automation: { enabled: false },
      telemetry: false as const,
    };
    const projected = await fixture.context.bootstrap.executor.projectFreshInitRetentionCapacity({
      config,
      brainPath: config.brainPath,
    });
    aggregate.idCount = 256 - projected.idCount;
    aggregate.entryCount = 1_000_000 - projected.entryCount;
    aggregate.regularFileBytes = (12_884_901_888n - BigInt(projected.regularFileBytes)).toString();

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("routes an unavailable packaged handoff to the fresh V1 compatibility arm", async () => {
    const unavailable = await createCommandFixture("init-bootstrap-unavailable");
    const compatible = await runInit(unavailable.context, {
      dryRun: true,
      assumeYes: true,
    });
    expect(compatible.ok && compatible.data.schemaVersion).toBe(1);
  });

  it("routes an available packaged handoff to fresh V2", async () => {
    const available = await createCommandFixture("init-bootstrap-available", {
      bootstrapAvailable: true,
    });
    const initialized = await runInit(available.context, {
      dryRun: true,
      assumeYes: true,
    });
    expect(initialized.ok && initialized.data.schemaVersion).toBe(2);
  });

  it("starts a distinct durable bootstrap beside an untouched noncanonical pre-plan envelope", async () => {
    const fixture = await createCommandFixture("init-bootstrap-pre-plan-residue", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "during_plan_write",
    });
    const interrupted = await runInit(fixture.context, ACCEPTED);
    expect(interrupted.ok).toBe(false);
    const partialName = (await nodeFs.readdir(fixture.paths.stateDir)).find((name) =>
      /^fresh-v2-init\.fi_.+\.plan\.json$/u.test(name),
    );
    if (partialName === undefined) throw new Error("pre-plan death left no plan prefix");
    const partialPath = join(fixture.paths.stateDir, partialName);
    const partialBefore = await nodeFs.readFile(partialPath);
    const partialStats = await nodeFs.lstat(partialPath, { bigint: true });
    const partialId = /^fresh-v2-init\.(fi_[^.]+)\./u.exec(partialName)?.[1];
    const bootstrap = fixture.context.bootstrap;
    if (bootstrap?.state === "available") await bootstrap.executor.close();
    fixture.setBootstrapInterrupt("after_plan");
    const durablePlanContext = fixture.rebuildContext();
    const durablePlanInterrupted = await runInit(durablePlanContext, ACCEPTED);
    expect(durablePlanInterrupted.ok).toBe(false);
    const durableBootstrap = durablePlanContext.bootstrap;
    if (durableBootstrap?.state === "available") await durableBootstrap.executor.close();
    fixture.disableBootstrapInterrupt();

    const installed = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(installed.ok).toBe(true);
    const durableIds = new Set<string>();
    for (const relative of await inventory(fixture.root)) {
      const path = join(fixture.root, relative);
      try {
        const value = JSON.parse(await nodeFs.readFile(path, "utf8")) as Record<string, unknown>;
        if (value.operation === "fresh_v2_init" && typeof value.id === "string") {
          durableIds.add(value.id);
        }
      } catch {
        // Directories and intentionally noncanonical pre-plan residue are inert.
      }
    }
    expect(durableIds.size).toBe(1);
    expect(durableIds.has(String(partialId))).toBe(false);
    const partialAfter = await nodeFs.lstat(partialPath, { bigint: true });
    expect({ dev: partialAfter.dev, ino: partialAfter.ino }).toEqual({
      dev: partialStats.dev,
      ino: partialStats.ino,
    });
    expect(await nodeFs.readFile(partialPath)).toEqual(partialBefore);

    const repeated = await runInit(fixture.rebuildContext(), ACCEPTED);
    expect(repeated.ok).toBe(true);
    expect(await nodeFs.readFile(partialPath)).toEqual(partialBefore);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses invalid available package authority without falling back to V1", async () => {
    const invalid = await createCommandFixture("init-bootstrap-invalid", {
      bootstrapAvailable: true,
    });
    await nodeFs.chmod(
      join(invalid.root, "packaged-release", "bundle", "bin", "developer-os"),
      0o600,
    );
    const before = await inventory(invalid.root);
    const refused = await runInit(invalid.context, {
      dryRun: true,
      assumeYes: true,
    });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.code).toBe(EXIT_CODES.securityRefusal);
    expect(await inventory(invalid.root)).toStrictEqual(before);
  });

  it("changes nothing on a dry run and declares the plan it would apply", async () => {
    const fixture = await createCommandFixture("init-dry-run");
    const before = await inventory(fixture.root);

    const result = await runInit(fixture.context, {
      dryRun: true,
      assumeYes: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transactionId).toBeNull();
    expect(result.data.productHome).toBe(fixture.paths.home);
    expect(result.data.brainPath).toBe(fixture.paths.brain);
    expect(result.data.created).toContain(fixture.paths.configFile);
    expect(await inventory(fixture.root)).toEqual(before);
  });

  it("changes nothing when the confirmation is declined", async () => {
    const fixture = await createCommandFixture("init-declined", {
      answers: [false],
    });
    const before = await inventory(fixture.root);

    const result = await runInit(fixture.context, {
      dryRun: false,
      assumeYes: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
    expect(await inventory(fixture.root)).toEqual(before);
  });

  it("installs product state, a Brain skeleton, and a manifest when accepted", async () => {
    const fixture = await createCommandFixture("init-accepted");

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transactionId).not.toBeNull();

    const config = loadConfig(
      await nodeFs.readFile(fixture.paths.configFile, "utf8"),
    );
    expect(config.brainPath).toBe(fixture.paths.brain);
    expect(config.adapters).toEqual({ claude: false, codex: false });
    expect(config.telemetry).toBe(false);

    expect(await exists(fixture.paths.stateDir)).toBe(true);
    expect(await exists(fixture.paths.stagingDir)).toBe(true);
    expect(await exists(fixture.paths.backupsDir)).toBe(true);
    expect(await exists(fixture.paths.logsDir)).toBe(true);
    expect(await exists(join(fixture.paths.brain, ".gitkeep"))).toBe(true);

    const manifest = await fixture.context.manifests.read();
    expect(manifest.productVersion).toBe(fixture.context.productVersion);
    const managed = manifest.artifacts.map((artifact) => artifact.path).sort();
    expect(managed).toContain(fixture.paths.configFile);
    expect(managed).toContain(fixture.paths.home);
  });

  it("installs one output schema per structured-result verb, as managed artifacts", async () => {
    /**
     * `codex-adapter.md` §11.13: `init` owns writing the managed schemas,
     * `ingest` selects their installed paths, and `invokeCodex` only screens
     * and forwards one. The set is derived from `EFFECT_VOCABULARY` rather than listed, and the
     * assertion is an equality rather than a non-empty check: a non-empty
     * check over a one-element set proves nothing, and pinning the member
     * makes a second one a decision somebody has to make here.
     */
    const fixture = await createCommandFixture("init-output-schemas");

    const result = await runInit(fixture.context, ACCEPTED);
    expect(result.ok).toBe(true);

    const verbs = structuredResultVerbs();
    expect(verbs).toStrictEqual(["ingest.stage"]);

    const manifest = await fixture.context.manifests.read();
    const managed = manifest.artifacts.map((artifact) => artifact.path);
    expect(managed).toContain(join(fixture.paths.home, "schemas"));

    for (const verb of verbs) {
      const file = join(fixture.paths.home, "schemas", `${verb}.schema.json`);
      expect(await nodeFs.readFile(file, "utf8")).toContain('"$schema"');
      expect(managed).toContain(file);
      expect(result.ok && result.data.created).toContain(file);
    }
  });

  it("leaves an installed output schema alone on a second run", async () => {
    /**
     * `init` is the upgrade path as well as the install path, so the schemas
     * are planned per file rather than gated on "this run created the vault".
     * The second run must find them unchanged: a `create` operation over a
     * file that already exists is refused by the change-plan validator, so an
     * unconditional plan would make `init` fail on every machine it had
     * already succeeded on.
     */
    const fixture = await createCommandFixture("init-output-schemas-twice");
    const file = join(
      fixture.paths.home,
      "schemas",
      "ingest.stage.schema.json",
    );

    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    const first = await nodeFs.readFile(file, "utf8");

    const repeated = await runInit(fixture.context, ACCEPTED);
    expect(repeated.ok).toBe(true);
    if (!repeated.ok) return;
    expect(repeated.data.created).toStrictEqual([]);
    expect(repeated.data.unchanged).toContain(file);
    expect(await nodeFs.readFile(file, "utf8")).toBe(first);
  });

  it("creates a redaction key that installation-manifest.json does not name", async () => {
    const fixture = await createCommandFixture("init-redaction-key");
    const keyFile = join(fixture.paths.stateDir, "redaction.key");

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(true);
    expect(await exists(keyFile)).toBe(true);
    expect(fsSync.statSync(keyFile).mode & 0o777).toBe(0o600);

    const manifest = await fixture.context.manifests.read();
    const managed = manifest.artifacts.map((artifact) => artifact.path);
    expect(managed).not.toContain(keyFile);

    const serializedManifest = await nodeFs.readFile(
      fixture.paths.manifestFile,
      "utf8",
    );
    expect(serializedManifest).not.toContain("redaction.key");
  });

  /**
   * **The decision, pinned.** `init --dry-run` neither creates the key nor
   * names it in `plan.created`, and the gap is accepted rather than closed.
   *
   * `created` enumerates the *managed artifacts* a run installs, and naming a
   * non-artifact there would imply the manifest owns it — which is precisely
   * the claim `installation-manifest.json` must never make about this file.
   * The key belongs with the transaction journals and lock files under
   * `stateDir` that the end-to-end suite already tolerates as internal.
   */
  it("neither creates nor declares the redaction key on a dry run", async () => {
    const fixture = await createCommandFixture("init-redaction-key-dry-run");
    const keyFile = join(fixture.paths.stateDir, "redaction.key");

    const result = await runInit(fixture.context, {
      dryRun: true,
      assumeYes: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.created).not.toContain(keyFile);
    expect(await exists(keyFile)).toBe(false);
  });

  /**
   * **`init` is the recovery `doctor` names, so it has to be one.** On an
   * installed machine whose key was deleted, `plan.created` is empty — and the
   * key creation used to sit below `runInit`'s early return for that case, so
   * the one production caller of `loadOrCreateRedactionKey` in the tree was
   * unreachable on exactly the machines that needed it. `doctor` then reported
   * "one will be created on next use" forever, and every broken-state remedy
   * it prints ("remove it, and run init") moved a machine from a reportable
   * state into a permanent one. Nothing escalated: `doctor` exits 0 for all of
   * them.
   */
  it("restores a deleted redaction key on an already installed machine", async () => {
    const fixture = await createCommandFixture("init-redaction-key-restore");
    await runInit(fixture.context, ACCEPTED);
    const keyFile = join(fixture.paths.stateDir, "redaction.key");
    await nodeFs.unlink(keyFile);

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.created).toEqual([]);
    expect(result.data.transactionId).toBeNull();
    expect(await exists(keyFile)).toBe(true);
    expect(fsSync.statSync(keyFile).mode & 0o777).toBe(0o600);
  });

  /** The companion: recovery is a real run, never a dry one. */
  it("restores nothing on a dry run, even when the key is the only thing missing", async () => {
    const fixture = await createCommandFixture("init-redaction-key-restore-dry");
    await runInit(fixture.context, ACCEPTED);
    const keyFile = join(fixture.paths.stateDir, "redaction.key");
    await nodeFs.unlink(keyFile);
    const before = await inventory(fixture.root);

    const result = await runInit(fixture.context, {
      dryRun: true,
      assumeYes: true,
    });

    expect(result.ok).toBe(true);
    expect(await exists(keyFile)).toBe(false);
    expect(await inventory(fixture.root)).toEqual(before);
  });

  /**
   * `createGuards` and `NodeProcessRunner.redact` close over whatever key
   * existed when the context was built — an ephemeral one on a machine `init`
   * is about to initialize.
   *
   * What this pins is `runInit`'s terminal diagnostic specifically, which is
   * the extent of the rebinding: the executor and the runner were built with
   * the ephemeral key and cannot be corrected from inside the command. The
   * rule Task 8 inherits is the one `init.ts` states — redact with the key you
   * loaded, at the point you loaded it — not "swap the guards".
   */
  it("redacts with the key it just created, not with the context's", async () => {
    const fixture = await createCommandFixture("init-redaction-key-point-of-use");
    redactionKeyUses.length = 0;

    const result = await runInit(
      fixture.context,
      ACCEPTED,
      failingVerifier(),
    );

    expect(result.ok).toBe(false);
    const durable = await nodeFs.readFile(
      join(fixture.paths.stateDir, "redaction.key"),
    );
    const used = redactionKeyUses.at(-1);
    expect(used).toBeDefined();
    expect([...(used ?? [])]).toEqual([...durable]);
  });

  it("records the Brain skeleton it created so a failed init can undo it", async () => {
    const fixture = await createCommandFixture("init-brain-owned");

    await runInit(fixture.context, ACCEPTED);

    const manifest = await fixture.context.manifests.read();
    const managed = manifest.artifacts.map((artifact) => artifact.path);
    expect(managed).toContain(fixture.paths.brain);
    expect(managed).toContain(join(fixture.paths.brain, ".gitkeep"));
  });

  it("accepts an existing Brain without writing into it", async () => {
    const fixture = await createCommandFixture("init-existing-brain");
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const note = join(fixture.paths.brain, "note.md");
    await nodeFs.writeFile(note, "synthetic user note\n", { mode: 0o600 });

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.unchanged).toContain(fixture.paths.brain);
    expect(await exists(join(fixture.paths.brain, ".gitkeep"))).toBe(false);
    expect(await nodeFs.readFile(note, "utf8")).toBe("synthetic user note\n");
  });

  it("refuses a Brain path that is not a directory", async () => {
    const fixture = await createCommandFixture("init-brain-file");
    await nodeFs.writeFile(fixture.paths.brain, "not a vault\n", {
      mode: 0o600,
    });

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
  });

  it("refuses a Brain that overlaps the product home", async () => {
    const fixture = await createCommandFixture("init-overlap", {
      env: {},
    });
    const overlapping = await createCommandFixture("init-overlap-env", {
      env: {
        DEVELOPER_OS_HOME: join(fixture.userHome, "product"),
        DEVELOPER_OS_BRAIN: join(fixture.userHome, "product", "vault"),
      },
    });

    const result = await runInit(overlapping.context, ACCEPTED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.securityRefusal);
  });

  /**
   * `verify()` runs before retention, so a retention row naming an installed
   * target retires it after the install has already been declared good. The
   * manifest then names artifacts that are absent, `init` still exits 0, and
   * the next run reads a `config.toml` that is not there. Spec 2 §6.4:
   * installed targets are never retention rows.
   */
  it("leaves every artifact its manifest names present after a V2 bootstrap init", async () => {
    const fixture = await createCommandFixture("init-v2-artifacts-present", {
      bootstrapAvailable: true,
    });

    const result = await runInit(fixture.context, ACCEPTED);

    if (!result.ok) throw new Error(result.error.message);
    const manifest = JSON.parse(
      await nodeFs.readFile(fixture.paths.manifestFile, "utf8"),
    ) as { readonly artifacts: readonly { readonly path: string }[] };
    expect(manifest.artifacts.length).toBeGreaterThan(0);
    const absent: string[] = [];
    for (const artifact of manifest.artifacts) {
      if (!(await exists(artifact.path))) absent.push(artifact.path);
    }
    expect(absent).toStrictEqual([]);
  }, 900_000);

  /**
   * The V1 path is covered below. This is the V2 bootstrap path, where a second
   * `init` must recognise the finished envelope and report the existing
   * installation rather than falling through to the drift check and refusing
   * over artifacts retention has already tombstoned.
   */
  it("is idempotent when re-run on a completed V2 bootstrap installation", async () => {
    const fixture = await createCommandFixture("init-v2-idempotent", {
      bootstrapAvailable: true,
    });
    const first = await runInit(fixture.context, ACCEPTED);
    expect(first.ok).toBe(true);

    const second = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (!second.ok) throw new Error(second.error.message);
    expect(second.ok).toBe(true);
  }, 900_000);

  it("is idempotent when re-run with the same inputs", async () => {
    const fixture = await createCommandFixture("init-idempotent");

    const first = await runInit(fixture.context, ACCEPTED);
    expect(first.ok).toBe(true);
    const afterFirst = await inventory(fixture.root);

    const second = await runInit(fixture.context, ACCEPTED);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.created).toEqual([]);
    expect(second.data.transactionId).toBeNull();
    expect(second.data.unchanged).toContain(fixture.paths.configFile);
    expect(await inventory(fixture.root)).toEqual(afterFirst);
  });

  it("refuses to re-initialize over a drifted managed file", async () => {
    const fixture = await createCommandFixture("init-drift");
    await runInit(fixture.context, ACCEPTED);
    await nodeFs.writeFile(fixture.paths.configFile, "schemaVersion = 1\n", {
      mode: 0o600,
    });

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
    expect(result.error.paths).toContain(fixture.paths.configFile);
  });

  it("rolls back and removes the manifest when post-apply verification fails", async () => {
    const fixture = await createCommandFixture("init-rollback");

    const result = await runInit(
      fixture.context,
      ACCEPTED,
      failingVerifier(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.operationalFailure);
    expect(await exists(fixture.paths.configFile)).toBe(false);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
    expect(await exists(join(fixture.paths.brain, ".gitkeep"))).toBe(false);
    expect(await exists(fixture.paths.brain)).toBe(false);

    const journal = await fixture.context.transactions.read("tx_fixture_001");
    expect(journal.phase).toBe("finalized");
  });

  it("preserves transaction evidence when it reverts a failed install", async () => {
    const fixture = await createCommandFixture("init-revert-evidence");

    await runInit(fixture.context, ACCEPTED, failingVerifier());

    expect(await exists(fixture.paths.stateDir)).toBe(true);
    expect(await exists(fixture.paths.backupsDir)).toBe(true);
  });

  it("never renders a control character from a configured Brain path", async () => {
    const fixture = await createCommandFixture("init-escape-render", {
      answers: [false],
    });
    await nodeFs.mkdir(fixture.paths.home, { recursive: true, mode: 0o700 });
    const hostile = join(
      fixture.userHome,
      `vault\u001b[2JDeveloper OS will make no changes.`,
    );
    await nodeFs.writeFile(
      fixture.paths.configFile,
      serializeConfig({
        schemaVersion: 1,
        brainPath: hostile,
        adapters: { claude: false, codex: false },
        git: { enabled: false },
        automation: { enabled: false },
        telemetry: false,
      }),
      { mode: 0o600 },
    );

    await runInit(fixture.context, { dryRun: false, assumeYes: false });

    expect(fixture.io.questions).toHaveLength(1);
    expect(fixture.io.questions[0]).not.toContain("\u001b");
    expect(fixture.io.questions[0]).toContain("\uFFFD");
  });

  it("refuses before installing anything when a transaction is incomplete", async () => {
    const fixture = await createCommandFixture("init-incomplete");
    const journalDir = join(fixture.paths.stateDir, "transactions");
    await nodeFs.mkdir(journalDir, { recursive: true, mode: 0o700 });
    const timestamp = "2026-07-30T12:00:00.000Z";
    await nodeFs.writeFile(
      join(journalDir, "tx_fixture_stale.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id: "tx_fixture_stale",
        kind: "init",
        phase: "staged",
        createdAt: timestamp,
        updatedAt: timestamp,
        mutations: [
          {
            targetPath: fixture.paths.configFile,
            operation: "create",
            expectedBeforeHash: null,
            stagedRelativePath: "0.bin",
          },
        ],
      })}\n`,
      { mode: 0o600 },
    );

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.recoveryRequired);
    expect(result.error.recovery).toContain("developer-os repair");
    expect(await exists(fixture.paths.configFile)).toBe(false);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
    expect(await exists(fixture.paths.brain)).toBe(false);
  });

  it("reverts when the verifier returns a failing report rather than throwing", async () => {
    const fixture = await createCommandFixture("init-failing-report");

    const result = await runInit(fixture.context, ACCEPTED, {
      /**
       * A real check id, not an invented one. This case pins that a failing
       * report *returned* rather than thrown still reverts; since the gate was
       * scoped to the checks init is answerable for, an id nothing recognises
       * would no longer block, and the case would pass for the wrong reason.
       */
      verify: () =>
        Promise.resolve({
          schemaVersion: 1,
          retainedBootstrapEvidence: [],
          checks: [
            {
              id: "manifest",
              status: "fail",
              message: "no installation manifest exists",
              paths: [],
            },
          ],
        }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.operationalFailure);
    expect(await exists(fixture.paths.configFile)).toBe(false);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
  });

  it("completes despite a failing check it is not answerable for", async () => {
    const fixture = await createCommandFixture("init-unowned-failure");

    const result = await runInit(fixture.context, ACCEPTED, {
      verify: () =>
        Promise.resolve({
          schemaVersion: 1,
          retainedBootstrapEvidence: [],
          checks: [
            {
              id: "agents",
              status: "fail",
              message: "discovery exploded",
              paths: [],
            },
          ],
        }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transactionId).not.toBeNull();
    expect(await exists(fixture.paths.configFile)).toBe(true);
    /** Not blocking is not the same as not worth saying. */
    expect(result.warnings).toContain("agents: discovery exploded");
  });

  it("carries a warning out of a check that could not answer", async () => {
    const fixture = await createCommandFixture("init-warned");

    const result = await runInit(fixture.context, ACCEPTED, {
      verify: () =>
        Promise.resolve({
          schemaVersion: 1,
          retainedBootstrapEvidence: [],
          checks: [
            {
              id: "agents",
              status: "warn",
              message: "agent discovery returned an unusable path",
              paths: [],
            },
          ],
        }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toStrictEqual([
      "agents: agent discovery returned an unusable path",
    ]);
  });

  it("reports an unsupported platform as a capability failure", async () => {
    const unsupported = Object.assign(
      new Error("Developer OS supports macOS only"),
      { code: EXIT_CODES.capabilityUnavailable },
    );
    const fixture = await createCommandFixture("init-unsupported", {
      inspectFailure: unsupported,
    });

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.capabilityUnavailable);
  });

  it("refuses with capabilityUnavailable when a persisted V2 plan exists and the bootstrap capability is absent", async () => {
    const seeded = await createCommandFixture("init-v2-plan-no-capability-seed", { bootstrapAvailable: true });
    await nodeFs.mkdir(seeded.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(seeded.context, ACCEPTED)).ok).toBe(true);

    const fixture = await createCommandFixture("init-v2-plan-no-capability", { root: seeded.root });

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.capabilityUnavailable);
  }, 600_000);

  it("admits a stray retained tombstone in the user's home instead of refusing the plan grammar", async () => {
    const fixture = await createCommandFixture("init-stray-tombstone-in-user-home", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(
      join(fixture.userHome, ".developer-os-retained.fi_00000000-0000-4000-8000-000000000000.0000000000.tombstone"),
      "",
      { mode: 0o600 },
    );

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
