import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bundleAggregateBytes,
  bundleInventoryHash,
  bundleSourceJournalBytes,
  bundleSourcePaths,
  createNodeLifecycleGuardedFileSystem,
  decodeCanonicalJson,
  initialBundleSourceJournal,
  LifecycleRecoveryRequiredError,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseSafeReasonCode,
  parseUInt64Decimal,
  parseUtcTimestamp,
  updateParticipantJournalPath,
  validateBundleSourceJournal,
  type BundleRelativePathV1,
  type BundleSourceStagingJournalV1,
  type BundleSourceStagingPlanV1,
  type CanonicalAbsolutePathV1,
  type LifecycleCoordinatorIdV1,
  type LowerHexSha256,
  type ReleaseBundleEntryV1,
} from "@developer-os/core";
import type { VerifiedScratchBundleV1 } from "@developer-os/security";
import { afterEach, describe, expect, it } from "vitest";

import { BUNDLE_SOURCE_DEATH_POINTS, BundleSourceExecutor, type BundleSourceDeathPointV1 } from "./bundle-source.js";

const encoder = new TextEncoder();
const sha = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const at = parseUtcTimestamp("2026-09-23T10:00:00.000Z");
const coordinatorId = `lc_${"d".repeat(64)}_21` as LifecycleCoordinatorIdV1;
const sourceId = parseSafeReasonCode("bundle_source");
const uid = process.getuid?.() ?? -1;
const homes: string[] = [];
const files: readonly { readonly path: string; readonly mode: 384 | 448; readonly content: string }[] = [
  { path: "bin/developer-os", mode: 448, content: "#!/bin/sh\nexit 0\n" },
  { path: "lib/runtime.js", mode: 384, content: "export const synthetic = true;\n" },
  { path: "readme.txt", mode: 384, content: "synthetic bundle\n" },
];
const entries: readonly ReleaseBundleEntryV1[] = [
  { path: "bin" as BundleRelativePathV1, kind: "directory", mode: 448 },
  ...files.slice(0, 1).map((file) => fileEntry(file)),
  { path: "lib" as BundleRelativePathV1, kind: "directory", mode: 448 },
  ...files.slice(1).map((file) => fileEntry(file)),
];

class Killed extends Error {}

function fileEntry(file: (typeof files)[number]): ReleaseBundleEntryV1 {
  const bytes = encoder.encode(file.content);
  return { path: file.path as BundleRelativePathV1, kind: "file", mode: file.mode, bytes: parseUInt64Decimal(bytes.byteLength.toString(10)), sha256: sha(bytes) };
}

afterEach(async () => {
  for (const home of homes.splice(0)) await nodeFs.rm(home, { recursive: true, force: true });
});

interface SourceFixture {
  readonly home: CanonicalAbsolutePathV1;
  readonly root: CanonicalAbsolutePathV1;
  readonly plan: BundleSourceStagingPlanV1;
  readonly scratch: VerifiedScratchBundleV1;
  readonly journalPath: CanonicalAbsolutePathV1;
}

/** The state construction leaves behind: the source parent, the source plan's initial journal, and a verified scratch tree. */
async function fixture(): Promise<SourceFixture> {
  const home = parseCanonicalAbsolutePathText(await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "dos-bundle-source-"))));
  homes.push(home);
  const root = parseCanonicalAbsolutePathText(`${home}/staging/lifecycle/${coordinatorId}`);
  const paths = bundleSourcePaths(root, sourceId);
  await nodeFs.mkdir(paths.parent, { recursive: true, mode: 0o700 });
  await nodeFs.mkdir(`${root}/update/journals/bundle_source_staging`, { recursive: true, mode: 0o700 });
  const parent = await nodeFs.lstat(paths.parent, { bigint: true });
  const plan: BundleSourceStagingPlanV1 = {
    schemaVersion: 1,
    id: sourceId,
    coordinatorId,
    sourceRoot: paths.sourceRoot,
    evidenceRoot: paths.evidenceRoot,
    sourceRootBefore: { state: "absent" },
    sourceParentDev: parseUInt64Decimal(parent.dev.toString(10)),
    sourceParentIno: parseUInt64Decimal(parent.ino.toString(10)),
    entries,
    inventoryHash: bundleInventoryHash(entries),
    aggregateBytes: bundleAggregateBytes(entries),
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  };
  const journalPath = updateParticipantJournalPath(root, "bundle_source_staging", sourceId);
  await nodeFs.writeFile(journalPath, bundleSourceJournalBytes(initialBundleSourceJournal(plan, at)), { mode: 0o600, flag: "wx" });
  const extracted = `${home}/scratch/extracted`;
  for (const directory of ["bin", "lib"]) await nodeFs.mkdir(`${extracted}/${directory}`, { recursive: true, mode: 0o700 });
  for (const file of files) {
    await nodeFs.writeFile(`${extracted}/${file.path}`, file.content, { flag: "wx" });
    await nodeFs.chmod(`${extracted}/${file.path}`, file.mode);
  }
  const scratch: VerifiedScratchBundleV1 = { id: "rp_synthetic", planHash: sha("scratch plan"), manifestHash: sha("manifest"), root: parseCanonicalAbsolutePathText(extracted), entries: entries.length };
  return { home, root, plan, scratch, journalPath };
}

function executor(value: SourceFixture, interrupt?: (point: BundleSourceDeathPointV1) => void): BundleSourceExecutor {
  const fs = createNodeLifecycleGuardedFileSystem({
    effectiveUid: uid,
    renameNoReplace: async ({ sourcePath, destinationPath }) => {
      await nodeFs.link(sourcePath, destinationPath);
      await nodeFs.unlink(sourcePath);
    },
  });
  return new BundleSourceExecutor({ fs, effectiveUid: uid, now: () => new Date("2026-09-23T10:00:05.000Z"), ...(interrupt === undefined ? {} : { interrupt }) }, value.root);
}

/** Dies the first time `point` fires. */
function dieAt(point: BundleSourceDeathPointV1): (reached: BundleSourceDeathPointV1) => void {
  return (reached) => {
    if (reached === point) throw new Killed(point);
  };
}

async function journalOf(value: SourceFixture): Promise<BundleSourceStagingJournalV1> {
  return validateBundleSourceJournal(decodeCanonicalJson(await nodeFs.readFile(value.journalPath), 1_048_576), value.plan);
}

async function listTree(path: string): Promise<readonly string[]> {
  const names = await nodeFs.readdir(path, { recursive: true });
  return names.map(String).sort();
}

async function exists(path: string): Promise<boolean> {
  return nodeFs.lstat(path).then(() => true, () => false);
}

async function stageSource(value: SourceFixture): Promise<Awaited<ReturnType<BundleSourceExecutor["stage"]>>> {
  return executor(value).stage(value.plan, value.scratch);
}

const FORWARD_DEATHS = BUNDLE_SOURCE_DEATH_POINTS.filter((point) => !["compensation_step", "compaction_step", "ready_removed"].includes(point));

describe("BundleSourceExecutor", () => {
  it("copies verified scratch into a durable source before outer intent", async () => {
    const value = await fixture();
    const ready = await stageSource(value);
    expect(ready.inventoryHash).toBe(value.plan.inventoryHash);
    expect(ready.entryCount).toBe(entries.length);
    expect(await listTree(value.plan.sourceRoot)).toEqual(entries.map((entry) => entry.path).sort());
    expect(await listTree(value.plan.evidenceRoot)).toHaveLength(entries.length);
    for (const file of files) expect(await nodeFs.readFile(`${value.plan.sourceRoot}/${file.path}`, "utf8")).toBe(file.content);
    expect(((await nodeFs.lstat(`${value.plan.sourceRoot}/bin/developer-os`)).mode & 0o777)).toBe(0o700);
    const journal = await journalOf(value);
    expect(journal.phase).toBe("source_ready");
    expect(journal.structureIdentities.map((identity) => identity.role)).toEqual(["source_envelope", "source_payload_root", "source_evidence_root"]);
    expect(decodeCanonicalJson(await nodeFs.readFile(bundleSourcePaths(value.root, sourceId).ready), 16_384)).toEqual(ready);
  });

  it("keeps the construction-evidenced journal inode across every rewrite", async () => {
    const value = await fixture();
    const before = await nodeFs.lstat(value.journalPath, { bigint: true });
    await stageSource(value);
    const after = await nodeFs.lstat(value.journalPath, { bigint: true });
    expect(after.ino).toBe(before.ino);
  });

  it.each(FORWARD_DEATHS)("compensates planlessly after death at %s", async (point) => {
    const value = await fixture();
    await expect(executor(value, dieAt(point)).stage(value.plan, value.scratch)).rejects.toBeInstanceOf(Killed);
    await executor(value).compensate(value.plan);
    expect((await journalOf(value)).phase).toBe("rolled_back");
    expect(await nodeFs.readdir(bundleSourcePaths(value.root, sourceId).parent)).toEqual([]);
    expect(await listTree(value.scratch.root)).toHaveLength(entries.length);
  });

  it("compensates a source_ready envelope with no outer plan, ready evidence first", async () => {
    const value = await fixture();
    await stageSource(value);
    await executor(value).compensate(value.plan);
    expect((await journalOf(value)).phase).toBe("rolled_back");
    expect(await nodeFs.readdir(bundleSourcePaths(value.root, sourceId).parent)).toEqual([]);
  });

  it.each(["compensation_step", "ready_removed", "journal_rewritten"] as const)("resumes compensation after death at %s", async (point) => {
    const value = await fixture();
    await stageSource(value);
    await expect(executor(value, dieAt(point)).compensate(value.plan)).rejects.toBeInstanceOf(Killed);
    await executor(value).compensate(value.plan);
    expect((await journalOf(value)).phase).toBe("rolled_back");
    expect(await nodeFs.readdir(bundleSourcePaths(value.root, sourceId).parent)).toEqual([]);
  });

  it("compacts ready evidence, entries with their evidence, then structures", async () => {
    const value = await fixture();
    await stageSource(value);
    await expect(executor(value, dieAt("compaction_step")).compact(value.plan)).rejects.toBeInstanceOf(Killed);
    await executor(value).compact(value.plan);
    const journal = await journalOf(value);
    expect(journal.phase).toBe("compacting");
    expect(journal.compactionNext).toBe(2 * entries.length + 4);
    expect(await nodeFs.readdir(bundleSourcePaths(value.root, sourceId).parent)).toEqual([]);
    expect(await exists(value.journalPath)).toBe(true);
  });

  it("refuses scratch bytes that differ from the signed inventory and then compensates", async () => {
    const value = await fixture();
    await nodeFs.writeFile(`${value.scratch.root}/readme.txt`, "tampered bundle!\n");
    await expect(stageSource(value)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    await executor(value).compensate(value.plan);
    expect(await nodeFs.readdir(bundleSourcePaths(value.root, sourceId).parent)).toEqual([]);
  });

  it("refuses a second stage, a moved source parent, and a nonempty unbound structure", async () => {
    const value = await fixture();
    await stageSource(value);
    await expect(stageSource(value)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);

    const moved = await fixture();
    const wrongParent = { ...moved.plan, sourceParentIno: parseUInt64Decimal("1") };
    await expect(executor(moved).stage(wrongParent, moved.scratch)).rejects.toThrow();

    const squatted = await fixture();
    await expect(executor(squatted, dieAt("structure_made")).stage(squatted.plan, squatted.scratch)).rejects.toBeInstanceOf(Killed);
    await nodeFs.writeFile(`${bundleSourcePaths(squatted.root, sourceId).envelope}/foreign`, "x");
    await expect(executor(squatted).compensate(squatted.plan)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(`${bundleSourcePaths(squatted.root, sourceId).envelope}/foreign`)).toBe(true);
  });

  it("refuses a partial file whose recorded identity was swapped", async () => {
    const value = await fixture();
    await expect(executor(value, dieAt("entry_written")).stage(value.plan, value.scratch)).rejects.toBeInstanceOf(Killed);
    const swapped = `${value.plan.sourceRoot}/bin/developer-os`;
    await nodeFs.rm(swapped);
    await nodeFs.writeFile(swapped, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await expect(executor(value).compensate(value.plan)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(swapped)).toBe(true);
  });
});
