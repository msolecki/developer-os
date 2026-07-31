import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runInit } from "./init.js";
import { runStatus } from "./status.js";
import {
  createCommandFixture,
  inventory,
  removeCommandFixtures,
} from "./testing.js";
import type { CommandFixture } from "./testing.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

afterEach(removeCommandFixtures);

async function seedIncompleteTransaction(
  fixture: CommandFixture,
  id: string,
): Promise<void> {
  const journalDir = join(fixture.paths.stateDir, "transactions");
  await nodeFs.mkdir(journalDir, { recursive: true, mode: 0o700 });
  const timestamp = "2026-07-30T12:00:00.000Z";
  await nodeFs.writeFile(
    join(journalDir, `${id}.json`),
    `${JSON.stringify({
      schemaVersion: 1,
      id,
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
}

describe("runStatus", () => {
  it("reports an uninitialized machine without changing it", async () => {
    const fixture = await createCommandFixture("status-fresh");
    const before = await inventory(fixture.root);

    const result = await runStatus(fixture.context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.installed).toBe(false);
    expect(result.data.configPresent).toBe(false);
    expect(result.data.brainPresent).toBe(false);
    expect(result.data.managedArtifacts).toBe(0);
    expect(result.data.driftCount).toBe(0);
    expect(result.data.incompleteTransactions).toEqual([]);
    expect(await inventory(fixture.root)).toEqual(before);
  });

  it("reports an installed machine and discovered agents", async () => {
    const fixture = await createCommandFixture("status-installed", {
      agents: {
        claude: {
          name: "claude",
          installed: true,
          executablePath: "/synthetic/bin/claude",
          version: null,
        },
        codex: {
          name: "codex",
          installed: false,
          executablePath: null,
          version: null,
        },
      },
    });
    await runInit(fixture.context, ACCEPTED);
    const before = await inventory(fixture.root);

    const result = await runStatus(fixture.context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.installed).toBe(true);
    expect(result.data.productVersion).toBe(fixture.context.productVersion);
    expect(result.data.configPresent).toBe(true);
    expect(result.data.brainPresent).toBe(true);
    expect(result.data.managedArtifacts).toBeGreaterThan(0);
    expect(result.data.driftCount).toBe(0);
    expect(result.data.agents.map((agent) => agent.installed)).toEqual([
      true,
      false,
    ]);
    expect(await inventory(fixture.root)).toEqual(before);
  });

  it("counts drift without repairing it", async () => {
    const fixture = await createCommandFixture("status-drift");
    await runInit(fixture.context, ACCEPTED);
    await nodeFs.writeFile(fixture.paths.configFile, "schemaVersion = 1\n", {
      mode: 0o600,
    });
    const before = await inventory(fixture.root);

    const result = await runStatus(fixture.context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.driftCount).toBe(1);
    expect(await nodeFs.readFile(fixture.paths.configFile, "utf8")).toBe(
      "schemaVersion = 1\n",
    );
    expect(await inventory(fixture.root)).toEqual(before);
  });

  it("names every incomplete transaction", async () => {
    const fixture = await createCommandFixture("status-incomplete");
    await seedIncompleteTransaction(fixture, "tx_fixture_001");

    const result = await runStatus(fixture.context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.incompleteTransactions).toEqual(["tx_fixture_001"]);
  });

  it("warns rather than fails when the configuration is unreadable", async () => {
    const fixture = await createCommandFixture("status-bad-config");
    await runInit(fixture.context, ACCEPTED);
    await nodeFs.writeFile(fixture.paths.configFile, "this is not toml =\n", {
      mode: 0o600,
    });

    const result = await runStatus(fixture.context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.configPresent).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("never quotes configuration content back into its own output", async () => {
    const fixture = await createCommandFixture("status-config-leak");
    await runInit(fixture.context, ACCEPTED);
    await nodeFs.writeFile(
      fixture.paths.configFile,
      "DATABASE_URL=postgres://svc:hunter2@db.internal/app\nnot toml [[[\n",
      { mode: 0o600 },
    );

    const result = await runStatus(fixture.context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(result)).not.toContain("db.internal");
  });
});
