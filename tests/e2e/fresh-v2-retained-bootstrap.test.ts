import * as nodeFs from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { runDoctorReport } from "@developer-os/cli/dist/commands/doctor.js";
import { runBrain } from "@developer-os/cli/dist/commands/brain.js";
import { runInit } from "@developer-os/cli/dist/commands/init.js";
import { runStatus } from "@developer-os/cli/dist/commands/status.js";
import {
  createCommandFixture,
  removeCommandFixtures,
} from "@developer-os/cli/dist/commands/testing.js";
import { runUninstall } from "@developer-os/cli/dist/commands/uninstall.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

afterEach(removeCommandFixtures);

describe("fresh V2 retained bootstrap lifecycle", () => {
  it("reports, preserves, uninstalls, and reinstalls beside retained evidence without external processes", async () => {
    const fixture = await createCommandFixture("e2e-retained-bootstrap", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const initialized = await runInit(fixture.context, ACCEPTED);
    expect(initialized.ok).toBe(true);
    const before = await fixture.bootstrapEvidenceIdentities();
    expect(before.length).toBeGreaterThan(0);

    const doctor = await runDoctorReport(fixture.context);
    expect(doctor.retainedBootstrapEvidence).toHaveLength(1);
    expect(JSON.stringify(doctor)).not.toContain("synthetic retained secret");

    const statusInspections = fixture.bootstrapEvidenceInspections;
    await runStatus(fixture.context);
    await runBrain(fixture.context, {
      subcommand: "search",
      query: "retained evidence inertness",
      limit: 1,
      dryRun: false,
    });
    expect(fixture.bootstrapEvidenceInspections).toBe(statusInspections);

    const removed = await runUninstall(fixture.context, ACCEPTED);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.data.retainedBootstrapEvidence).toHaveLength(1);
    expect(await fixture.bootstrapEvidenceIdentities()).toEqual(before);

    const reinstalled = await runInit(fixture.rebuildContext(), ACCEPTED);
    if (!reinstalled.ok) throw new Error(reinstalled.error.message);
    expect(reinstalled.ok).toBe(true);
    const after = await fixture.bootstrapEvidenceIdentities();
    expect(new Set(after.map((entry) => entry.id)).size).toBe(2);
    for (const entry of before) expect(after).toContainEqual(entry);
    expect(fixture.vendorProcesses).toStrictEqual([]);
  }, 600_000);
});
