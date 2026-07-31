import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";

import { runDoctor, runDoctorReport } from "./doctor.js";
import { runInit } from "./init.js";
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

describe("runDoctor", () => {
  it("passes every check on a healthy installation", async () => {
    const fixture = await createCommandFixture("doctor-healthy");
    await runInit(fixture.context, ACCEPTED);

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe(EXIT_CODES.success);
    expect(
      result.data.checks.filter((check) => check.status !== "pass"),
    ).toEqual([]);
    expect(result.data.checks.map((check) => check.id)).toEqual([
      "platform",
      "product-home",
      "configuration",
      "manifest",
      "transactions",
      "drift",
      "brain",
      "agents",
    ]);
  });

  it("reports an uninitialized machine as an operational failure", async () => {
    const fixture = await createCommandFixture("doctor-fresh");

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.operationalFailure);
    expect(result.error.recovery).toBe("developer-os init");
  });

  it("returns the recovery code and both recovery commands for an incomplete transaction", async () => {
    const fixture = await createCommandFixture("doctor-incomplete");
    await seedIncompleteTransaction(fixture, "tx_fixture_001");

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.recoveryRequired);
    expect(result.error.recovery).toBe(
      "developer-os repair --resume tx_fixture_001 | developer-os repair --rollback tx_fixture_001",
    );
  });

  it("reports drift as a decision the user must make", async () => {
    const fixture = await createCommandFixture("doctor-drift");
    await runInit(fixture.context, ACCEPTED);
    await nodeFs.writeFile(fixture.paths.configFile, "schemaVersion = 1\n", {
      mode: 0o600,
    });

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
    expect(result.error.paths).toContain(fixture.paths.configFile);
  });

  it("reports an unsupported platform as a capability failure", async () => {
    const unsupported = Object.assign(
      new Error("Developer OS supports macOS only; this host reports linux"),
      { code: EXIT_CODES.capabilityUnavailable },
    );
    const fixture = await createCommandFixture("doctor-platform", {
      inspectFailure: unsupported,
    });
    await createCommandFixture("doctor-platform-install");

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.capabilityUnavailable);
  });

  it("reports rather than rejects when a journal is unparseable", async () => {
    const fixture = await createCommandFixture("doctor-corrupt-journal");
    await runInit(fixture.context, ACCEPTED);
    const journalDir = join(fixture.paths.stateDir, "transactions");
    await nodeFs.writeFile(join(journalDir, "tx_fixture_bad.json"), "{}\n", {
      mode: 0o600,
    });

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.recoveryRequired);
  });

  it("reports rather than rejects when a managed artifact is too large to read", async () => {
    const fixture = await createCommandFixture("doctor-unreadable");
    await runInit(fixture.context, ACCEPTED);
    await nodeFs.writeFile(
      fixture.paths.configFile,
      Buffer.alloc(9 * 1024 * 1024, 0x61),
      { mode: 0o600 },
    );

    const report = await runDoctorReport(fixture.context);
    const drift = report.checks.find((check) => check.id === "drift");

    expect(drift?.status).toBe("fail");
    expect((await runDoctor(fixture.context)).ok).toBe(false);
  });

  it("never repairs what it reports", async () => {
    const fixture = await createCommandFixture("doctor-read-only");
    await runInit(fixture.context, ACCEPTED);
    await nodeFs.writeFile(fixture.paths.configFile, "schemaVersion = 1\n", {
      mode: 0o600,
    });
    await seedIncompleteTransaction(fixture, "tx_fixture_007");
    const before = await inventory(fixture.root);

    await runDoctor(fixture.context);

    expect(await inventory(fixture.root)).toEqual(before);
    expect(await nodeFs.readFile(fixture.paths.configFile, "utf8")).toBe(
      "schemaVersion = 1\n",
    );
  });
});
