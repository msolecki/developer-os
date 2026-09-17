import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
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
  it("reports, preserves, uninstalls, and refuses reinstall over the downcast uninstall's Foundation residue", async () => {
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

    /**
     * Scope decision 11 of plan 1a: the shipped downcast uninstall leaves its
     * own terminal Foundation journal, lock and staging behind, which Spec 1
     * §2.1's A12 shape admission refuses. Task 22 replaces that uninstall with
     * the coordinator, which leaves only the bookkeeping set, and restores the
     * successful reinstall this case asserted until then.
     */
    const reinstalled = await runInit(fixture.rebuildContext(), ACCEPTED);
    expect(reinstalled.ok).toBe(false);
    if (reinstalled.ok) return;
    expect(reinstalled.code).toBe(EXIT_CODES.recoveryRequired);
    expect(reinstalled.error.message).toContain("bookkeeping residue of an unadmitted shape");
    /**
     * The refused path is asserted on disk rather than in the message: the
     * diagnostic guard redacts every high-entropy segment, and this residue's
     * own names carry the transaction IDs, so the published message names no
     * readable path at all.
     */
    const residueRoots = [
      join("state", "transactions"),
      join("staging", "transactions"),
      join("backups", "transactions"),
    ];
    const residue = (await Promise.all(residueRoots.map((relative) =>
      nodeFs.readdir(join(fixture.paths.home, relative)).catch(() => [] as string[]),
    ))).flat();
    expect(residue).not.toStrictEqual([]);
    expect(
      residue.filter((name) => /^\.?tx_fixture_[0-9]+(\.json|\.lock)?$/u.test(name)),
      residue.join(","),
    ).not.toStrictEqual([]);
    const after = await fixture.bootstrapEvidenceIdentities();
    for (const entry of before) expect(after).toContainEqual(entry);
    expect(fixture.vendorProcesses).toStrictEqual([]);
  }, 600_000);
});
