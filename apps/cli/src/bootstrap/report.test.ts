import * as nodeFs from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { deriveBootstrapRetentionLocations } from "@developer-os/core";
import type { CanonicalAbsolutePathV1, UInt64DecimalV1 } from "@developer-os/core";

import { runInit } from "../commands/init.js";
import { runDoctorReport } from "../commands/doctor.js";
import {
  createCommandFixture,
  firstRegularFile,
  inventoryDigest,
  removeCommandFixtures,
  retainedTombstones,
} from "../commands/testing.js";
import {
  createBootstrapEvidenceInspectionRequest,
  NodeBootstrapEvidenceGuardedReader,
} from "./context.js";
import type { BootstrapEvidenceGuardedEntryV1, BootstrapEvidenceGuardedReaderV1 } from "./report.js";
import { inspectBootstrapEvidence, inspectBootstrapEvidenceAdmission } from "./report.js";
import { projectBootstrapRetentionPostimage, projectRetainedDirectoryTreeOnce } from "./retention.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const RETAINED_SECRET = "synthetic retained secret";

afterEach(removeCommandFixtures);

function requestFor(fixture: Awaited<ReturnType<typeof createCommandFixture>>) {
  return createBootstrapEvidenceInspectionRequest({
    productHome: fixture.paths.home,
    stateDirectory: fixture.paths.stateDir,
    initialRoots: [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
  });
}

async function firstExternalRegularFile(
  paths: readonly string[],
  initialRoots: readonly string[],
): Promise<string | null> {
  for (const path of paths) {
    if (initialRoots.includes(dirname(path))) continue;
    if ((await nodeFs.lstat(path)).isFile()) return path;
  }
  return null;
}

describe("inspectBootstrapEvidence", () => {
  it("reports a retained envelope as altered without reading its contents into the report", async () => {
    const fixture = await createCommandFixture("bootstrap-report-verified", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const initialized = await runInit(fixture.context, ACCEPTED);
    expect(initialized.ok).toBe(true);
    const tombstones = await retainedTombstones(fixture.root);
    expect(tombstones.length).toBeGreaterThan(0);
    const target = await firstRegularFile(tombstones);
    if (target === null) throw new Error("fixture retained no regular-file tombstone");
    await nodeFs.writeFile(target, RETAINED_SECRET, { mode: 0o600 });

    const report = await inspectBootstrapEvidence(requestFor(fixture));

    expect(report.schemaVersion).toBe(1);
    expect(report.ids).toHaveLength(1);
    expect(report.ids[0]).toMatchObject({
      status: "altered",
      operation: "fresh_v2_init",
    });
    expect(report.ids[0]?.vaultPath).toContain(".plan.json");
    expect(typeof report.ids[0]?.entryCount).toBe("number");
    expect(typeof report.ids[0]?.regularFileBytes).toBe("string");
    expect(report.ids[0]?.entryCount).toBeGreaterThan(0);
    expect(report.aggregate).toEqual({
      idCount: 1,
      entryCount: report.ids[0]?.entryCount,
      regularFileBytes: report.ids[0]?.regularFileBytes,
    });
    expect(JSON.stringify(report)).not.toContain(RETAINED_SECRET);
  }, 300_000);

  it("reports an interrupted legal cursor as incomplete and leaves every byte unchanged", async () => {
    const fixture = await createCommandFixture("bootstrap-report-incomplete", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "during_retention",
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const interrupted = await runInit(fixture.context, ACCEPTED);
    expect(interrupted.ok).toBe(false);
    const before = await inventoryDigest(fixture.root);

    const report = await inspectBootstrapEvidence(requestFor(fixture));

    expect(report.ids).toHaveLength(1);
    expect(report.ids[0]).toMatchObject({
      status: "incomplete",
      operation: "fresh_v2_init",
      terminalOutcome: "finalized",
    });
    expect(await inventoryDigest(fixture.root)).toEqual(before);
    const bootstrap = fixture.context.bootstrap;
    if (bootstrap?.state !== "available") throw new Error("bootstrap fixture is unavailable");
    await bootstrap.executor.close();
    fixture.disableBootstrapInterrupt();

    const completed = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(completed.ok).toBe(true);
  }, 300_000);

  it("reports changed retained bytes as altered without disclosing them", async () => {
    const fixture = await createCommandFixture("bootstrap-report-altered", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const initialized = await runInit(fixture.context, ACCEPTED);
    expect(initialized.ok).toBe(true);
    const tombstones = await retainedTombstones(fixture.root);
    const target = await firstRegularFile(tombstones);
    if (target === null) throw new Error("fixture retained no regular-file tombstone");
    await nodeFs.writeFile(target, RETAINED_SECRET, { mode: 0o600 });

    const doctor = await runDoctorReport(fixture.context);

    expect(doctor.retainedBootstrapEvidence).toHaveLength(1);
    expect(doctor.retainedBootstrapEvidence[0]?.status, `mutated retained path: ${target}`).toBe("altered");
    expect(JSON.stringify(doctor)).not.toContain(RETAINED_SECRET);
    expect(doctor.retainedBootstrapEvidence[0]?.status).toBe("altered");
    expect(doctor.checks.find((check) => check.id.startsWith("bootstrap-evidence:"))?.status).toBe("warn");
    expect(doctor.checks.find((check) => check.id === "drift")?.status).not.toBe("fail");
  }, 300_000);

  it("reports missing and extra retained rows as altered without changing unrelated siblings", async () => {
    const fixture = await createCommandFixture("bootstrap-report-row-set", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    const target = await firstExternalRegularFile(
      await retainedTombstones(fixture.root),
      [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
    );
    if (target === null) throw new Error("fixture retained no external-parent regular-file tombstone");
    const id = /^\.developer-os-retained\.(fi_[0-9a-f-]+)\./u.exec(basename(target))?.[1];
    if (id === undefined) throw new Error("fixture tombstone has no bootstrap ID");
    const hidden = `${target}.synthetic-missing`;
    await nodeFs.rename(target, hidden);

    const missing = await inspectBootstrapEvidence(requestFor(fixture));

    expect(missing.ids[0]?.status).toBe("altered");
    await nodeFs.rename(hidden, target);
    const unrelated = join(dirname(target), "unrelated-user-sibling.txt");
    await nodeFs.writeFile(unrelated, "unrelated sibling\n", { mode: 0o600 });
    const extra = join(dirname(target), `.developer-os-retained.${id}.9999999999.tombstone`);
    await nodeFs.writeFile(extra, RETAINED_SECRET, { mode: 0o600 });

    const added = await inspectBootstrapEvidence(requestFor(fixture));

    expect(added.ids[0]?.status).toBe("altered");
    expect(JSON.stringify(added)).not.toContain(RETAINED_SECRET);
    expect(await nodeFs.readFile(unrelated, "utf8")).toBe("unrelated sibling\n");
  }, 300_000);

  it("reports a pre-plan prefix as unverified without adopting or changing it", async () => {
    const fixture = await createCommandFixture("bootstrap-report-unverified", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "during_plan_write",
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const interrupted = await runInit(fixture.context, ACCEPTED);
    expect(interrupted.ok).toBe(false);
    const before = await inventoryDigest(fixture.root);

    const report = await inspectBootstrapEvidence(requestFor(fixture));

    expect(report.ids).toHaveLength(1);
    expect(report.ids[0]).toMatchObject({
      status: "unverified",
      operation: "fresh_v2_init",
      terminalOutcome: null,
    });
    expect(report.ids[0]?.vaultPath).toContain(".plan.json");
    expect(await inventoryDigest(fixture.root)).toEqual(before);
  }, 300_000);

  it("emits exactly the rows Core derives, in Core order", async () => {
    const fixture = await createCommandFixture("bootstrap-report-single-derivation", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    const report = await inspectBootstrapEvidence(requestFor(fixture));
    const id = report.ids[0];
    if (id === undefined) throw new Error("fixture retained no envelope");
    const admission = await inspectBootstrapEvidenceAdmission(requestFor(fixture));
    const envelope = admission.retainedEnvelopes.find((candidate) => candidate.plan.id === id.id);
    if (envelope === undefined) throw new Error("admission lost the envelope");

    const expected = deriveBootstrapRetentionLocations(envelope.plan, envelope.terminalJournal)
      .map((location) => [location.role, location.sourcePath]);
    const actual = envelope.evidence.rows.map((row) => [row.role, row.sourcePath]);

    expect(actual).toEqual(expected);
  }, 300_000);

  it("classifies a finalized envelope instead of throwing when the handoff manifest cannot be inventoried", async () => {
    const fixture = await createCommandFixture("bootstrap-report-manifest-read-failure", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    /**
     * `exactV2Handoff`/`exactRestoredBase` read this path with
     * `inventoryExactNamespaces`, which throws when a root is neither a file
     * nor a directory (a dangling symlink, here) — exactly the shape a
     * partially-restored or adversarial filesystem can leave behind.
     */
    await nodeFs.rm(fixture.paths.manifestFile);
    await nodeFs.symlink("/nonexistent-manifest-target", fixture.paths.manifestFile);

    const report = await inspectBootstrapEvidence(requestFor(fixture));

    expect(report.ids[0]?.status).toBe("verified");
  }, 300_000);

  it("projects a retained directory tree exactly twice per inspection", async () => {
    const fixture = await createCommandFixture("bootstrap-report-projection-count", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    const tombstones = await retainedTombstones(fixture.root);
    let retainedDirectory: string | null = null;
    for (const tombstone of tombstones) {
      if ((await nodeFs.lstat(tombstone)).isDirectory()) {
        retainedDirectory = tombstone;
        break;
      }
    }
    if (retainedDirectory === null) throw new Error("fixture retained no directory tombstone");
    let walks = 0;
    const countingWalk = (root: CanonicalAbsolutePathV1) => {
      if (root === retainedDirectory) walks += 1;
      return projectRetainedDirectoryTreeOnce(root);
    };
    const request = {
      ...requestFor(fixture),
      projectPostimage: (path: CanonicalAbsolutePathV1) => projectBootstrapRetentionPostimage(path, countingWalk),
    };

    await inspectBootstrapEvidenceAdmission(request);

    expect(walks).toBe(2);
  }, 300_000);

  it("walks a plan's retention roots and row parents in a single inventory call", async () => {
    const fixture = await createCommandFixture("bootstrap-report-walk-count", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);

    const real = new NodeBootstrapEvidenceGuardedReader();
    let walks = 0;
    const countingReader: BootstrapEvidenceGuardedReaderV1 = {
      inventoryExactNamespaces: (roots) => {
        walks += 1;
        return real.inventoryExactNamespaces(roots);
      },
      readRegularFile: (entry, maximumBytes) => real.readRegularFile(entry, maximumBytes),
    };

    await inspectBootstrapEvidenceAdmission({ ...requestFor(fixture), reader: countingReader });

    /**
     * Measured against this fixture's 156-location plan: the outer
     * `initialRoots` walk (1), the plan's journal-slot walk (1), one walk per
     * payload/created-path/foundation-participant evidence read, the
     * manifest-handoff check (1) — and, until the roots/row-parents walks are
     * grouped into one call, two more instead of one. 155 is that total with
     * the group; it moves in lockstep with the fixture's shape, not a fixed
     * constant, so a future change to the fixture is expected to move it too.
     */
    expect(walks).toBe(155);
  }, 300_000);

  it("looks up retained rows by key instead of scanning them per location", async () => {
    const fixture = await createCommandFixture("bootstrap-report-row-lookup-scale", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    const admission = await inspectBootstrapEvidenceAdmission(requestFor(fixture));
    const envelope = admission.retainedEnvelopes[0];
    if (envelope === undefined) throw new Error("fixture retained no envelope");
    const locations = deriveBootstrapRetentionLocations(envelope.plan, envelope.terminalJournal);
    const reference = locations[0];
    if (reference === undefined) throw new Error("fixture plan retains no locations");
    const junkDirectory = dirname(reference.tombstonePath);

    /**
     * `retained` is a plain array built from reader output and scanned with
     * `Array#find` inside `inspectPlan`, a closure not exposed to callers the
     * way `reader`/`projectPostimage` are, so there is no injectable seam to
     * count *which* comparisons ran. Wrapping every
     * `BootstrapEvidenceGuardedEntryV1` in a counting accessor was tried and
     * rejected: those objects also flow through `encodeCanonicalJson`,
     * structural cloning, and Map/Set keys elsewhere in this file, so an
     * accessor would count every one of those unrelated reads too, not just
     * the scan this test targets. A wall-time bound was tried next and also
     * rejected: at 500,000 padding rows the fix's own share of the work
     * measured at only ~300ms against a ~2.5s baseline dominated by this
     * file's other O(retained) costs (the Map dedup, `sumEntries`, and the
     * canonical-JSON fingerprint over every entry) — a margin this file's
     * own noise (a 2x swing recorded elsewhere between otherwise identical
     * runs) would make flaky in either direction.
     *
     * What is directly countable is *how many times* `Array#find` runs
     * against the padded array, independent of how expensive each run is.
     * `Array.prototype.find` is patched for the duration of this call to
     * count invocations on arrays longer than `retained` could plausibly be
     * without the padding below, then restored. `retained.find` at two
     * call sites survives this fix on purpose — a single per-plan lookup for
     * the live/tombstone bootstrap lock, not one multiplied by location count
     * — so the exact count is 2 (that pair) once the per-location scan is
     * gone, not 0.
     */
    const junkRowCount = 2_000;
    const junk: BootstrapEvidenceGuardedEntryV1[] = Array.from({ length: junkRowCount }, (_, index) => ({
      path: `${junkDirectory}/.developer-os-retained.${envelope.plan.id}.${String(index).padStart(10, "0")}.tombstone` as CanonicalAbsolutePathV1,
      kind: "regular_file",
      ownerUid: 0,
      mode: 0o600,
      nlink: 1,
      bytes: "0" as UInt64DecimalV1,
      dev: "1" as UInt64DecimalV1,
      ino: `9${String(index)}` as UInt64DecimalV1,
    }));
    const real = new NodeBootstrapEvidenceGuardedReader();
    const paddedReader: BootstrapEvidenceGuardedReaderV1 = {
      inventoryExactNamespaces: async (roots) => {
        const found = await real.inventoryExactNamespaces(roots);
        return roots.length > 50 ? [...junk, ...found] : found;
      },
      readRegularFile: (entry, maximumBytes) => real.readRegularFile(entry, maximumBytes),
    };

    const LARGE_ARRAY_THRESHOLD = 500;
    const nativeFind = Array.prototype.find;
    let largeArrayFindCalls = 0;
    Array.prototype.find = function countingFind(
      this: readonly unknown[],
      predicate: (value: unknown, index: number, array: readonly unknown[]) => boolean,
      thisArg?: unknown,
    ): unknown {
      if (this.length > LARGE_ARRAY_THRESHOLD) largeArrayFindCalls += 1;
      return nativeFind.call(this, predicate, thisArg);
    } as typeof Array.prototype.find;
    try {
      await inspectBootstrapEvidenceAdmission({ ...requestFor(fixture), reader: paddedReader });
    } finally {
      Array.prototype.find = nativeFind;
    }

    expect(largeArrayFindCalls).toBe(2);
  }, 300_000);
});
