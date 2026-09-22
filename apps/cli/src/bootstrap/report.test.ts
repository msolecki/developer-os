import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BOOTSTRAP_RETAINED_MAX_IDS,
  deriveBootstrapRetentionLocations,
  encodeCanonicalJson,
  EXIT_CODES,
} from "@developer-os/core";
import type { CanonicalAbsolutePathV1, UInt64DecimalV1 } from "@developer-os/core";

import { runInit } from "../commands/init.js";
import { runDoctorReport } from "../commands/doctor.js";
import { runUninstall } from "../commands/uninstall.js";
import { createCommandFixture, firstRegularFile, inventoryDigest, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures, retainedTombstones } from "../commands/testing.js";
import {
  createBootstrapEvidenceInspectionRequest,
  NodeBootstrapEvidenceGuardedReader,
} from "./context.js";
import type { BootstrapEvidenceGuardedEntryV1, BootstrapEvidenceGuardedReaderV1 } from "./report.js";
import {
  assertOrdinaryCommandAdmitted,
  BootstrapRootInvalidError,
  inspectBootstrapEvidence,
  inspectBootstrapEvidenceAdmission,
  NON_REGULAR_BOOTSTRAP_LEAF,
} from "./report.js";
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

  it("scopes each retained envelope's inventory to its own entries after a round trip", async () => {
    const fixture = await createCommandFixture("bootstrap-report-two-envelopes", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    expect((await runUninstall(fixture.rebuildContext(), ACCEPTED)).ok).toBe(true);
    expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok).toBe(true);

    const admission = await inspectBootstrapEvidenceAdmission(requestFor(fixture));

    expect(admission.report.ids).toHaveLength(2);
    const counts = admission.report.ids.map((summary) => summary.entryCount);
    const bytes = admission.report.ids.map((summary) => BigInt(summary.regularFileBytes));
    expect(counts.every((count) => count > 0)).toBe(true);
    expect(bytes.every((count) => count > 0n)).toBe(true);
    /**
     * Two envelopes that each reported the whole home would sum past the
     * aggregate, which counts every entry once. That sum is the observable
     * form of NEW-99's union.
     */
    expect(counts.reduce((total, count) => total + count, 0)).toBeLessThanOrEqual(
      admission.report.aggregate.entryCount,
    );
    expect(bytes.reduce((total, count) => total + count, 0n)).toBeLessThanOrEqual(
      BigInt(admission.report.aggregate.regularFileBytes),
    );
    expect(admission.report.ids.map((summary) => summary.status)).toStrictEqual([
      "verified",
      "verified",
    ]);
    expect(admission.retainedEnvelopes.map((envelope) => envelope.plan.id).toSorted()).toStrictEqual(
      admission.report.ids.map((summary) => summary.id).toSorted(),
    );
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
    const arities: number[] = [];
    const countingReader: BootstrapEvidenceGuardedReaderV1 = {
      inventoryExactNamespaces: (roots) => {
        arities.push(roots.length);
        return real.inventoryExactNamespaces(roots);
      },
      readRegularFile: (entry, maximumBytes) => real.readRegularFile(entry, maximumBytes),
    };

    await inspectBootstrapEvidenceAdmission({ ...requestFor(fixture), reader: countingReader });
    const walks = arities.length;

    /**
     * The grouping is the contract, so it is asserted directly and not only
     * through the total above: one call carries every retention root and row
     * parent, and no second call carries a subset of them.
     */
    expect(arities.filter((arity) => arity > 2)).toStrictEqual([4, 322]);

    /**
     * Measured against this fixture's 159-location plan: the outer
     * `initialRoots` walk (1), the plan's journal-slot walk (1), one walk per
     * payload/created-path/foundation-participant evidence read (67 + 86 + 1),
     * the manifest-handoff check (1) — and, until the roots/row-parents walks are
     * grouped into one call, two more instead of one. 158 is that total with
     * the group, whose one call carries 322 roots (159 sources, 159 tombstones,
     * 4 row parents); it moves in lockstep with the fixture's shape, not a fixed
     * constant, so a future change to the fixture is expected to move it too.
     * It was 155 against a 156-location plan until plan 1a Task 1 (2026-09-17)
     * moved D19's release layout under `state/release-metadata`: its three
     * `<hash>.json` files are three more created paths, so three more
     * creation-evidence reads and three more locations.
     */
    expect(walks).toBe(158);
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

describe("assertOrdinaryCommandAdmitted over the production reader", () => {
  async function bareHome(body: (home: string) => Promise<void>): Promise<void> {
    const home = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-ordinary-admission-"));
    try {
      await nodeFs.mkdir(join(home, "state"), { recursive: true, mode: 0o700 });
      await body(home);
    } finally {
      await nodeFs.rm(home, { recursive: true, force: true });
    }
  }

  function requestForHome(home: string) {
    return createBootstrapEvidenceInspectionRequest({
      productHome: home,
      stateDirectory: join(home, "state"),
      initialRoots: [home, join(home, "state")],
    });
  }

  it("refuses a symlink at the manifest path instead of reading past it (NEW-82)", async () => {
    await bareHome(async (home) => {
      const manifest = join(home, "installation-manifest.json");
      await nodeFs.writeFile(join(home, "elsewhere.json"), "{}\n", { mode: 0o600 });
      await nodeFs.symlink(join(home, "elsewhere.json"), manifest);

      await expect(assertOrdinaryCommandAdmitted(requestForHome(home))).rejects.toMatchObject({
        code: EXIT_CODES.recoveryRequired,
        name: "BootstrapRecoveryRequiredError",
        message: NON_REGULAR_BOOTSTRAP_LEAF,
        paths: [manifest],
      });
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * NEW-82, open half, so this states the contract and `it.fails` records that
   * the product does not meet it yet: it goes red the moment it does.
   * `inventoryExactNamespaces` inventories a directory root by its children,
   * and a directory here has no child matching the bootstrap-evidence
   * namespace, so the inventory comes back empty and the gate cannot tell it
   * from an absent manifest. On a bare home that merely admits; on an installed
   * home the absent-manifest arm finds the installed files as live residue and
   * refuses exit 6 with `BOOTSTRAP_MANUAL_ARCHIVE`, telling the user to archive
   * bootstrap evidence when the fault is a directory at their manifest path.
   * Closing it means recording the root entry itself in the reader's
   * direct-namespace branch, the way its tree branch already does, which
   * changes what every other exact-namespace caller inventories.
   */
  it.fails("distinguishes a directory at the manifest path from an absent one (NEW-82, open)", async () => {
    await bareHome(async (home) => {
      const manifest = join(home, "installation-manifest.json");
      await nodeFs.mkdir(manifest, { mode: 0o700 });

      await expect(assertOrdinaryCommandAdmitted(requestForHome(home))).rejects.toMatchObject({
        code: EXIT_CODES.recoveryRequired,
        paths: [manifest],
      });
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("assertOrdinaryCommandAdmitted", () => {
  const SYNTHETIC_HOME = "/developer-os-synthetic-admission";
  const SYNTHETIC_STATE = `${SYNTHETIC_HOME}/state`;
  const SYNTHETIC_MANIFEST = `${SYNTHETIC_HOME}/installation-manifest.json`;
  const PLAN_NAME = "fresh-v2-init.fi_00000000-0000-4000-8000-000000000000.plan.json";
  const SYNTHETIC_PLAN = `${SYNTHETIC_STATE}/${PLAN_NAME}`;

  const manifestBytes = new TextEncoder().encode(encodeCanonicalJson({
    schemaVersion: 2,
    productVersion: "1.0.0",
    installedAt: "2026-09-20T00:00:00.000Z",
    artifacts: [{
      owner: "core",
      path: `${SYNTHETIC_HOME}/config.toml`,
      productVersion: "1.0.0",
      existedBefore: false,
      beforeHash: null,
      backupRelativePath: null,
      source: "templates/config.toml",
      mergeStrategy: "dedicated",
      verifiedAt: "2026-09-20T00:00:00.000Z",
      kind: "file",
      verification: { mode: "content", installedHash: "a".repeat(64) },
    }],
  }));

  function entryAt(
    path: string,
    kind: "regular_file" | "directory",
  ): BootstrapEvidenceGuardedEntryV1 {
    return {
      path: path as CanonicalAbsolutePathV1,
      kind,
      ownerUid: 501,
      mode: kind === "directory" ? 0o700 : 0o600,
      nlink: 1,
      bytes: String(kind === "directory" ? 0 : manifestBytes.byteLength) as UInt64DecimalV1,
      dev: "1" as UInt64DecimalV1,
      ino: "2" as UInt64DecimalV1,
    };
  }

  function requestReporting(entries: readonly BootstrapEvidenceGuardedEntryV1[], names: readonly string[]) {
    const asked: string[] = [];
    const reader: BootstrapEvidenceGuardedReaderV1 = {
      inventoryExactNamespaces: (roots) => {
        asked.push(...roots);
        return Promise.resolve(entries.filter((candidate) => roots.includes(candidate.path)));
      },
      readRegularFile: (expected) =>
        expected.path === SYNTHETIC_MANIFEST
          ? Promise.resolve(manifestBytes)
          : Promise.reject(new Error("no synthetic bytes at that path")),
    };
    return {
      asked,
      request: createBootstrapEvidenceInspectionRequest({
        productHome: SYNTHETIC_HOME,
        stateDirectory: SYNTHETIC_STATE,
        initialRoots: [],
        reader,
        listNames: () => Promise.resolve(names),
      }),
    };
  }

  it("enumerates plan envelopes through the injected listNames", async () => {
    const { request, asked } = requestReporting(
      [entryAt(SYNTHETIC_MANIFEST, "regular_file")],
      [PLAN_NAME, "unrelated.json"],
    );

    await expect(assertOrdinaryCommandAdmitted(request)).resolves.toBeUndefined();

    expect(new Set(asked)).toStrictEqual(new Set([SYNTHETIC_MANIFEST, SYNTHETIC_PLAN]));
  });

  it("lets a programming error in the reader escape instead of blaming the leaf (NEW-82)", async () => {
    const { request } = requestReporting([entryAt(SYNTHETIC_MANIFEST, "regular_file")], [PLAN_NAME]);
    const defective = {
      ...request,
      reader: {
        ...request.reader,
        inventoryExactNamespaces: () => {
          throw new TypeError("synthetic");
        },
      },
    };

    await expect(assertOrdinaryCommandAdmitted(defective)).rejects.toBeInstanceOf(TypeError);
  });

  it("refuses a non-regular leaf the injected listNames and reader report", async () => {
    const plan = requestReporting(
      [entryAt(SYNTHETIC_MANIFEST, "regular_file"), entryAt(SYNTHETIC_PLAN, "directory")],
      [PLAN_NAME],
    );
    await expect(assertOrdinaryCommandAdmitted(plan.request)).rejects.toMatchObject({
      code: EXIT_CODES.recoveryRequired,
      name: "BootstrapRecoveryRequiredError",
      message: NON_REGULAR_BOOTSTRAP_LEAF,
      paths: [SYNTHETIC_PLAN],
    });

    const manifest = requestReporting([entryAt(SYNTHETIC_MANIFEST, "directory")], [PLAN_NAME]);
    await expect(assertOrdinaryCommandAdmitted(manifest.request)).rejects.toMatchObject({
      code: EXIT_CODES.recoveryRequired,
      name: "BootstrapRecoveryRequiredError",
      message: NON_REGULAR_BOOTSTRAP_LEAF,
      paths: [SYNTHETIC_MANIFEST],
    });
  });

  /**
   * NEW-81 §3: a root the reader refuses as not a usable directory/file (a
   * symlinked product home, `$HOME`, or state directory) is invalid input
   * naming the offending root, not the gate's generic archive-manually
   * refusal — `BootstrapRootInvalidError` already carries both, so it is
   * rethrown unwrapped rather than folded into `BootstrapRecoveryRequiredError`.
   */
  it("rethrows a root-shape refusal from the reader as invalid input, unwrapped", async () => {
    const request = createBootstrapEvidenceInspectionRequest({
      productHome: SYNTHETIC_HOME,
      stateDirectory: SYNTHETIC_STATE,
      initialRoots: [SYNTHETIC_HOME, SYNTHETIC_STATE],
      reader: {
        inventoryExactNamespaces: (queried) =>
          queried.length > 1
            ? Promise.reject(new BootstrapRootInvalidError([SYNTHETIC_HOME]))
            : Promise.resolve([]),
        readRegularFile: () => Promise.reject(new Error("no synthetic bytes at that path")),
      },
      listNames: () => Promise.resolve([]),
    });

    await expect(assertOrdinaryCommandAdmitted(request)).rejects.toMatchObject({
      code: EXIT_CODES.invalidInput,
      name: "BootstrapRootInvalidError",
      paths: [SYNTHETIC_HOME],
    });
  });

  /**
   * NEW-81 §5: every other inspection failure used to collapse into the same
   * archive-manually text regardless of cause, which told a `status` run
   * during a concurrent `init` to go archive evidence when the real fault was
   * an unrelated bug in the inspector. Only the failure's constructor name is
   * published — never its message, which may quote a path or file content.
   */
  it("publishes the inspection failure's redacted class and the gate's roots, never its message", async () => {
    class SyntheticInspectionFailure extends Error {}
    const secretMessage = "synthetic secret detail that must never reach the user";
    const request = createBootstrapEvidenceInspectionRequest({
      productHome: SYNTHETIC_HOME,
      stateDirectory: SYNTHETIC_STATE,
      initialRoots: [SYNTHETIC_HOME, SYNTHETIC_STATE],
      reader: {
        inventoryExactNamespaces: (queried) =>
          queried.length > 1
            ? Promise.reject(new SyntheticInspectionFailure(secretMessage))
            : Promise.resolve([]),
        readRegularFile: () => Promise.reject(new Error("no synthetic bytes at that path")),
      },
      listNames: () => Promise.resolve([]),
    });

    let caught: unknown;
    try {
      await assertOrdinaryCommandAdmitted(request);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: EXIT_CODES.recoveryRequired,
      name: "BootstrapRecoveryRequiredError",
    });
    const message = caught instanceof Error ? caught.message : "";
    expect(message).toContain("SyntheticInspectionFailure");
    expect(message).not.toContain(secretMessage);
    expect((caught as { readonly paths?: readonly string[] }).paths).toEqual(request.initialRoots);
  });
});

/**
 * NEW-81 §2: the gate does a full plan admission attempt per retained envelope
 * ID, up to `BOOTSTRAP_RETAINED_MAX_IDS` (256) — the product's own enforced
 * cap on how many bootstrap envelopes an install can ever retain
 * (`packages/core/src/manifest/bootstrap-retention.ts:26`). This measures a
 * command's gate check at that cap with the cheapest-to-construct realistic
 * shape: `BOOTSTRAP_RETAINED_MAX_IDS` durable-but-never-attributed plan files
 * (each fails its own structural admission immediately, the same shape a
 * crashed pre-write `init` leaves behind and the same fixture this suite
 * already uses for that at `apps/cli/src/main.test.ts`'s "plan no longer
 * validates" case). A verified/retained envelope costs strictly more per ID
 * (it also builds a full retention-evidence table), so this undercounts the
 * worst case per envelope, but the growth this row asks about is *with
 * envelope count*, and every ID here pays the one cost every ID pays
 * regardless of status: a bounded read plus one admission attempt.
 */
describe("gate cost with many retained envelope ids (NEW-81 §2)", () => {
  it("measures assertOrdinaryCommandAdmitted's cost against the cap on retained envelope ids", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-gate-cost-"));
    const home = join(root, "product-home");
    const state = join(home, "state");
    try {
      await nodeFs.mkdir(state, { recursive: true, mode: 0o700 });
      for (let index = 0; index < BOOTSTRAP_RETAINED_MAX_IDS; index += 1) {
        const hex = index.toString(16).padStart(8, "0");
        const id = `fi_${hex}-0000-4000-8000-000000000000`;
        await nodeFs.writeFile(
          join(state, `fresh-v2-init.${id}.plan.json`),
          "{}\n",
          { mode: 0o600 },
        );
      }
      const request = createBootstrapEvidenceInspectionRequest({
        productHome: home,
        stateDirectory: state,
        initialRoots: [home, state, root],
      });

      const started = performance.now();
      await assertOrdinaryCommandAdmitted(request).catch(() => undefined);
      const elapsedMs = performance.now() - started;

      /**
       * No bound or short-circuit is added for this row: measured below
       * `MEASURED_TOLERANCE_MS`, an ordinary command's gate check at the
       * product's own hard cap on retained envelopes is not something a CLI
       * user would notice, let alone find unusable — evidence against
       * building unneeded complexity for a problem this measurement does not
       * show.
       */
      const MEASURED_TOLERANCE_MS = 3000;
      console.log(
        `NEW-81 §2 measured: ${elapsedMs.toFixed(1)}ms for ${String(BOOTSTRAP_RETAINED_MAX_IDS)} retained envelope ids (tolerance ${String(MEASURED_TOLERANCE_MS)}ms)`,
      );
      expect(elapsedMs).toBeLessThan(MEASURED_TOLERANCE_MS);
    } finally {
      await nodeFs.rm(root, { recursive: true, force: true });
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
