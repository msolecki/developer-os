import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  decodeCanonicalJson,
  deriveBootstrapEnvelopePaths,
  deriveBootstrapPayloadPath,
  deriveBootstrapRetentionLocations,
  encodeCanonicalJson,
  EXIT_CODES,
  validateBootstrapJournal,
} from "@developer-os/core";
import type {
  BootstrapExecutionPlanV1,
  BootstrapExternalShapeProjectionV1,
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  FreshV2InitIdV1,
  LowerHexSha256,
  ManifestMigrationIdV1,
  SafeReasonCodeV1,
  UInt64DecimalV1,
  UtcTimestampV1,
} from "@developer-os/core";

import { runInit } from "../commands/init.js";
import { runDoctorReport } from "../commands/doctor.js";
import { createCommandFixture, firstRegularFile, inventoryDigest, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures, retainedTombstones } from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import { inspectPackagedRelease } from "../update/packaged-release.js";
import {
  createBootstrapEvidenceInspectionRequest,
  NodeBootstrapEvidenceGuardedReader,
} from "./context.js";
import { planV1ToV2Migration } from "./migration.js";
import type { BootstrapEvidenceGuardedEntryV1, BootstrapEvidenceGuardedReaderV1 } from "./report.js";
import { inspectBootstrapEvidence, inspectBootstrapEvidenceAdmission } from "./report.js";
import { projectBootstrapRetentionPostimage, projectRetainedDirectoryTreeOnce } from "./retention.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const RETAINED_SECRET = "synthetic retained secret";
const FRESH_ID = "fi_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as FreshV2InitIdV1;
const MIGRATION_ID = "mm_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as ManifestMigrationIdV1;
const PLANNED_AT = "2026-09-08T00:00:00.000Z";

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
  }, REAL_FILESYSTEM_TIMEOUT_MS);

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
  }, REAL_FILESYSTEM_TIMEOUT_MS);

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
  }, REAL_FILESYSTEM_TIMEOUT_MS);

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
  }, REAL_FILESYSTEM_TIMEOUT_MS);

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
  }, REAL_FILESYSTEM_TIMEOUT_MS);

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
  }, REAL_FILESYSTEM_TIMEOUT_MS);

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
  }, REAL_FILESYSTEM_TIMEOUT_MS);

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
  }, REAL_FILESYSTEM_TIMEOUT_MS);

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
  }, REAL_FILESYSTEM_TIMEOUT_MS);

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
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

function sha256(value: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(value).digest("hex") as LowerHexSha256;
}

interface InterruptedEnvelope {
  readonly fixture: CommandFixture;
  readonly plan: BootstrapExecutionPlanV1;
}

async function freshInitInterruptedAfterInitialJournal(label: string): Promise<InterruptedEnvelope> {
  const fixture = await createCommandFixture(label, {
    bootstrapAvailable: true,
    bootstrapInterruptAfter: "after_initial_state_sync",
  });
  await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
  const planName = (await nodeFs.readdir(fixture.paths.stateDir))
    .find((name) => name.startsWith("fresh-v2-init.") && name.endsWith(".plan.json"));
  if (planName === undefined) throw new Error("interrupted fresh init left no plan");
  const bytes = await nodeFs.readFile(join(fixture.paths.stateDir, planName));
  return { fixture, plan: decodeCanonicalJson(bytes, bytes.byteLength) as unknown as BootstrapExecutionPlanV1 };
}

function inodeOf(stats: BigIntStats): { readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 } {
  return { dev: String(stats.dev) as UInt64DecimalV1, ino: String(stats.ino) as UInt64DecimalV1 };
}

function externalShapeRow(role: string, path: string, stats: BigIntStats) {
  return {
    role,
    pathHash: sha256(path),
    kind: stats.isDirectory() ? "directory" : "regular_file",
    ownerUid: Number(stats.uid),
    mode: Number(stats.mode & 0o777n),
    nlink: Number(stats.nlink),
    size: String(stats.size),
    ...inodeOf(stats),
  };
}

async function migrationInterruptedAfterInitialJournal(label: string): Promise<InterruptedEnvelope> {
  const fixture = await createCommandFixture(label, { bootstrapProductionLocks: true });
  expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
  const released = await createCommandFixture(label, { root: fixture.root, bootstrapAvailable: true });
  if (released.context.bootstrap?.state !== "available") throw new Error("packaged release fixture is unavailable");
  const packaged = await inspectPackagedRelease(released.context.bootstrap.packagedRelease);
  const { paths } = fixture;
  const envelope = deriveBootstrapEnvelopePaths(paths.home as CanonicalAbsolutePathV1, "v1_to_v2", MIGRATION_ID);
  const lockPath = join(paths.stateDir, ".lifecycle-bootstrap.lock") as CanonicalAbsolutePathV1;
  for (const path of [lockPath, ...envelope.journalSlots]) {
    await nodeFs.writeFile(path, "", { mode: 0o600, flag: "wx" });
  }
  const [home, state, lock, slot0, slot1] = await Promise.all(
    [paths.home, paths.stateDir, lockPath, ...envelope.journalSlots].map((path) => nodeFs.lstat(path, { bigint: true })),
  ) as [BigIntStats, BigIntStats, BigIntStats, BigIntStats, BigIntStats];
  const plan = await planV1ToV2Migration({ paths, packaged, now: () => new Date(PLANNED_AT) }, {
    id: MIGRATION_ID,
    nonce: sha256("synthetic install nonce"),
    bootstrapIdentity: {
      path: lockPath,
      ownerUid: Number(lock.uid),
      mode: 0o600,
      nlink: 1,
      size: 0,
      ...inodeOf(lock),
    },
    externalShape: {
      entries: [
        externalShapeRow("product_home", paths.home, home),
        externalShapeRow("state_directory", paths.stateDir, state),
        externalShapeRow("bootstrap_lock", lockPath, lock),
      ],
    } as unknown as BootstrapExternalShapeProjectionV1,
    journalSlots: [inodeOf(slot0), inodeOf(slot1)],
    admittedPreexistingPaths: [],
  });
  const planBytes = encodeCanonicalJson(plan as unknown as CanonicalJsonValue);
  await nodeFs.writeFile(envelope.plan, planBytes, { mode: 0o600, flag: "wx" });
  const journal = validateBootstrapJournal(plan, {
    schemaVersion: 1,
    id: plan.id,
    planHash: sha256(planBytes),
    slot: 0,
    sequence: "0",
    previousJournalHash: null,
    phase: "planned",
    direction: "forward",
    nextPayload: 0,
    payloadWriteState: { state: "idle" },
    nextCreatedPath: 0,
    nextFoundationParticipant: 0,
    nextLaunchabilityPath: 0,
    manifestCursor: 0,
    compensationNext: null,
    payloadRetentionPart: null,
    terminalOutcome: null,
    retentionNext: null,
    createdAt: PLANNED_AT as UtcTimestampV1,
    updatedAt: PLANNED_AT as UtcTimestampV1,
  });
  await nodeFs.writeFile(envelope.journalSlots[0], encodeCanonicalJson(journal as unknown as CanonicalJsonValue));
  return { fixture, plan };
}

const BOOTSTRAP_OPERATIONS = [
  { operation: "fresh_v2_init", id: FRESH_ID, interrupt: freshInitInterruptedAfterInitialJournal },
  { operation: "v1_to_v2", id: MIGRATION_ID, interrupt: migrationInterruptedAfterInitialJournal },
] as const;

describe("bootstrap evidence over every bootstrap operation", () => {
  it("enumerates both bootstrap operations", () => {
    expect(BOOTSTRAP_OPERATIONS.map(({ operation }) => operation)).toStrictEqual(["fresh_v2_init", "v1_to_v2"]);
  });

  it.each(BOOTSTRAP_OPERATIONS)(
    "admits an interrupted $operation envelope as active and attributes its staging and payload names to it",
    async ({ operation, interrupt }) => {
      const { fixture, plan } = await interrupt(`bootstrap-report-interrupted-${operation}`);
      const stagingRoot = deriveBootstrapEnvelopePaths(fixture.paths.home as CanonicalAbsolutePathV1, plan.operation, plan.id).stagingRoot;
      const stagedSource = join(stagingRoot, "staged-source");
      const payload = plan.payloads[0]?.ref.path;
      if (payload === undefined) throw new Error("plan stages no payload");
      await nodeFs.mkdir(stagingRoot, { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(stagedSource, "synthetic staged bytes\n", { mode: 0o600 });
      await nodeFs.writeFile(payload, "synthetic payload bytes\n", { mode: 0o600 });

      const admission = await inspectBootstrapEvidenceAdmission(requestFor(fixture));

      expect(admission.active?.plan).toMatchObject({ operation, id: plan.id });
      expect(admission.report.ids).toStrictEqual([
        expect.objectContaining({ id: plan.id, operation, status: "incomplete", terminalOutcome: null }),
      ]);
      expect(admission.retainedPaths).toEqual(expect.arrayContaining([payload, stagingRoot, stagedSource]));
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  const liveResidue = BOOTSTRAP_OPERATIONS.flatMap(({ operation, id }) => [
    {
      operation,
      id,
      residue: "staging subtree",
      arrange: async (home: CanonicalAbsolutePathV1) => {
        const stagingRoot = deriveBootstrapEnvelopePaths(home, operation, id).stagingRoot;
        await nodeFs.mkdir(stagingRoot, { recursive: true, mode: 0o700 });
        await nodeFs.writeFile(join(stagingRoot, "live-source"), "synthetic live residue\n", { mode: 0o600 });
      },
    },
    {
      operation,
      id,
      residue: "payload source",
      arrange: async (home: CanonicalAbsolutePathV1) => {
        const payload = deriveBootstrapPayloadPath(home, operation, id as unknown as SafeReasonCodeV1, 0);
        await nodeFs.mkdir(dirname(payload), { recursive: true, mode: 0o700 });
        await nodeFs.writeFile(payload, "synthetic live residue\n", { mode: 0o600 });
      },
    },
  ]);

  it("enumerates live residue for every bootstrap operation", () => {
    for (const { operation } of BOOTSTRAP_OPERATIONS) {
      expect(liveResidue.filter((candidate) => candidate.operation === operation).length).toBeGreaterThan(0);
    }
  });

  it.each(liveResidue)("reports a $operation $residue without a plan as blocking unverified evidence", async ({ operation, id, arrange }) => {
    const fixture = await createCommandFixture(`bootstrap-report-residue-${operation}`);
    const home = fixture.paths.home as CanonicalAbsolutePathV1;
    await arrange(home);

    const admission = await inspectBootstrapEvidenceAdmission(requestFor(fixture));

    expect(admission.report.ids).toStrictEqual([{
      id,
      status: "unverified",
      operation,
      terminalOutcome: null,
      vaultPath: deriveBootstrapEnvelopePaths(home, operation, id).plan,
      entryCount: expect.any(Number) as number,
      regularFileBytes: expect.any(String) as string,
    }]);
    expect(admission.blocksNewIntent).toBe(true);
  });

  const unrecognisedNames = [
    { scope: "state", name: "manifest-migration.not-a-bootstrap-id.plan.json" },
    { scope: "state", name: `fresh-v2-init.${MIGRATION_ID}.plan.json` },
    { scope: "state", name: `.manifest-migration.${FRESH_ID}.0000000000.payload` },
    { scope: "staging", name: join("manifest-migration", FRESH_ID) },
    { scope: "staging", name: join("fresh-v2-init", "not-a-bootstrap-id") },
  ] as const;

  it("enumerates unrecognised names in every bootstrap namespace scope", () => {
    for (const scope of ["state", "staging"] as const) {
      expect(unrecognisedNames.filter((candidate) => candidate.scope === scope).length).toBeGreaterThan(0);
    }
  });

  it.each(unrecognisedNames)("refuses $name in the $scope namespace as recovery-required", async ({ scope, name }) => {
    const fixture = await createCommandFixture("bootstrap-report-unrecognised");
    const path = join(scope === "state" ? fixture.paths.stateDir : fixture.paths.stagingDir, name);
    await nodeFs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(path, "", { mode: 0o600 });

    await expect(inspectBootstrapEvidenceAdmission(requestFor(fixture))).rejects.toMatchObject({
      code: EXIT_CODES.recoveryRequired,
    });
  });
});
