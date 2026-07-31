import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES, loadConfig, serializeConfig } from "@developer-os/core";

import { runInit } from "./init.js";
import type { InitDependencies } from "./init.js";
import {
  createCommandFixture,
  exists,
  inventory,
  removeCommandFixtures,
} from "./testing.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

afterEach(removeCommandFixtures);

function failingVerifier(): InitDependencies {
  return {
    verify: () =>
      Promise.reject(new Error("synthetic post-apply verification failure")),
  };
}

describe("runInit", () => {
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
      verify: () =>
        Promise.resolve({
          schemaVersion: 1,
          checks: [
            {
              id: "synthetic",
              status: "fail",
              message: "synthetic failure",
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
});
