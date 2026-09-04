import * as nodeFs from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { runDoctorReport } from "@developer-os/cli/dist/commands/doctor.js";
import { runBrain } from "@developer-os/cli/dist/commands/brain.js";
import { runInit } from "@developer-os/cli/dist/commands/init.js";
import { runStatus } from "@developer-os/cli/dist/commands/status.js";
import {
  createCommandFixture,
  firstRegularFile,
  removeCommandFixtures,
  retainedTombstones,
} from "@developer-os/cli/dist/commands/testing.js";
import { runUninstall } from "@developer-os/cli/dist/commands/uninstall.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const RETAINED_SECRET = "synthetic retained secret";

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
    /**
     * Planted and reverted around the one call whose disclosure is asserted:
     * the rest of this lifecycle (uninstall, reinstall) compares retained
     * identities against `before`, which a lingering mutation would desync
     * from the real tree without exercising anything this residual covers.
     */
    const tombstones = await retainedTombstones(fixture.root);
    const target = await firstRegularFile(tombstones);
    if (target === null) throw new Error("fixture retained no regular-file tombstone");
    const original = await nodeFs.readFile(target);
    await nodeFs.writeFile(target, RETAINED_SECRET, { mode: 0o600 });

    const doctor = await runDoctorReport(fixture.context);
    expect(doctor.retainedBootstrapEvidence).toHaveLength(1);
    expect(JSON.stringify(doctor)).not.toContain(RETAINED_SECRET);
    await nodeFs.writeFile(target, original, { mode: 0o600 });

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
