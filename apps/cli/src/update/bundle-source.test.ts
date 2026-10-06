import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bundleAggregateBytes,
  bundleInventoryHash,
  bundleSourceJournalBytes,
  bundleSourcePaths,
  bundleSourceStagingPlanBytes,
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
  type UpdateConstructionJournalV1,
  type UpdateConstructionPlanV1,
} from "@developer-os/core";
import type { VerifiedScratchBundleV1 } from "@developer-os/security";
import { afterEach, describe, expect, it } from "vitest";

import { BUNDLE_SOURCE_DEATH_POINTS, BundleSourceExecutor, type BundleSourceDeathPointV1 } from "./bundle-source.js";
import { resolveSourceParent } from "./construction.js";
import { readConstructionJournal, stageSourceConstruction } from "./rollback-testing.js";

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
  readonly construction: UpdateConstructionPlanV1;
  readonly constructionJournal: UpdateConstructionJournalV1;
}

/** The state a real construction run leaves behind: its directories, the source plan's initial journal, and a verified scratch tree. */
async function fixture(): Promise<SourceFixture> {
  const home = parseCanonicalAbsolutePathText(await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "dos-bundle-source-"))));
  homes.push(home);
  const root = parseCanonicalAbsolutePathText(`${home}/staging/lifecycle/${coordinatorId}`);
  const paths = bundleSourcePaths(root, sourceId);
  const plan: BundleSourceStagingPlanV1 = {
    schemaVersion: 1,
    id: sourceId,
    coordinatorId,
    sourceRoot: paths.sourceRoot,
    evidenceRoot: paths.evidenceRoot,
    sourceRootBefore: { state: "absent" },
    entries,
    inventoryHash: bundleInventoryHash(entries),
    aggregateBytes: bundleAggregateBytes(entries),
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  };
  const journalBytes = bundleSourceJournalBytes(initialBundleSourceJournal(plan, at));
  const { plan: construction, journal: constructionJournal } = await stageSourceConstruction({
    root,
    coordinatorId,
    sources: [{ kind: "bundle_source_staging", id: sourceId, plan: bundleSourceStagingPlanBytes(plan), journal: journalBytes }],
    rollbackSource: null,
    candidate: null,
  });
  const journalPath = updateParticipantJournalPath(root, "bundle_source_staging", sourceId);
  await nodeFs.writeFile(journalPath, journalBytes, { mode: 0o600, flag: "wx" });
  const extracted = `${home}/scratch/extracted`;
  for (const directory of ["bin", "lib"]) await nodeFs.mkdir(`${extracted}/${directory}`, { recursive: true, mode: 0o700 });
  for (const file of files) {
    await nodeFs.writeFile(`${extracted}/${file.path}`, file.content, { flag: "wx" });
    await nodeFs.chmod(`${extracted}/${file.path}`, file.mode);
  }
  const scratch: VerifiedScratchBundleV1 = { id: "rp_synthetic", planHash: sha("scratch plan"), manifestHash: sha("manifest"), root: parseCanonicalAbsolutePathText(extracted), entries: entries.length };
  return { home, root, plan, scratch, journalPath, construction, constructionJournal };
}

function stageOf(value: SourceFixture, interrupt?: (point: BundleSourceDeathPointV1) => void): ReturnType<BundleSourceExecutor["stage"]> {
  return executor(value, interrupt).stage(value.plan, value.scratch, value.construction, value.constructionJournal);
}

function compensateOf(value: SourceFixture, interrupt?: (point: BundleSourceDeathPointV1) => void): Promise<void> {
  return executor(value, interrupt).compensate(value.plan, value.construction, value.constructionJournal);
}

async function swapSourceParent(value: SourceFixture): Promise<void> {
  const parent = bundleSourcePaths(value.root, sourceId).parent;
  await nodeFs.rmdir(parent);
  await nodeFs.mkdir(parent, { mode: 0o700 });
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
  return stageOf(value);
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
    await expect(stageOf(value, dieAt(point))).rejects.toBeInstanceOf(Killed);
    await compensateOf(value);
    expect((await journalOf(value)).phase).toBe("rolled_back");
    expect(await nodeFs.readdir(bundleSourcePaths(value.root, sourceId).parent)).toEqual([]);
    expect(await listTree(value.scratch.root)).toHaveLength(entries.length);
  });

  it("compensates a source_ready envelope with no outer plan, ready evidence first", async () => {
    const value = await fixture();
    await stageSource(value);
    await compensateOf(value);
    expect((await journalOf(value)).phase).toBe("rolled_back");
    expect(await nodeFs.readdir(bundleSourcePaths(value.root, sourceId).parent)).toEqual([]);
  });

  it.each(["compensation_step", "ready_removed", "journal_rewritten"] as const)("resumes compensation after death at %s", async (point) => {
    const value = await fixture();
    await stageSource(value);
    await expect(compensateOf(value, dieAt(point))).rejects.toBeInstanceOf(Killed);
    await compensateOf(value);
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
    await compensateOf(value);
    expect(await nodeFs.readdir(bundleSourcePaths(value.root, sourceId).parent)).toEqual([]);
  });

  it("refuses a second stage and a nonempty unbound structure", async () => {
    const value = await fixture();
    await stageSource(value);
    await expect(stageSource(value)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);

    const squatted = await fixture();
    await expect(stageOf(squatted, dieAt("structure_made"))).rejects.toBeInstanceOf(Killed);
    await nodeFs.writeFile(`${bundleSourcePaths(squatted.root, sourceId).envelope}/foreign`, "x");
    await expect(compensateOf(squatted)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(`${bundleSourcePaths(squatted.root, sourceId).envelope}/foreign`)).toBe(true);
  });

  it.each([
    ["torn", (bytes: Buffer) => bytes.subarray(0, bytes.byteLength - 7)],
    ["non-canonical", (bytes: Buffer) => Buffer.from(` ${bytes.toString("utf8")}`)],
  ] as const)("refuses a %s participant journal as bundle_not_canonical, exit 6 (W2-PORTS-2)", async (_name, mangle) => {
    const value = await fixture();
    await stageSource(value);
    await nodeFs.writeFile(value.journalPath, mangle(await nodeFs.readFile(value.journalPath)));
    const error: unknown = await compensateOf(value).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect((error as LifecycleRecoveryRequiredError).reason).toBe("bundle_not_canonical");
  });

  it("refuses a partial file whose recorded identity was swapped", async () => {
    const value = await fixture();
    await expect(stageOf(value, dieAt("entry_written"))).rejects.toBeInstanceOf(Killed);
    const swapped = `${value.plan.sourceRoot}/bin/developer-os`;
    await nodeFs.rm(swapped);
    await nodeFs.writeFile(swapped, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await expect(compensateOf(value)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(swapped)).toBe(true);
  });
});

describe("BundleSourceExecutor source parent (P1)", () => {
  it("stages under the construction-created update/source/bundle with no hand mkdir", async () => {
    const value = await fixture();
    const parent = resolveSourceParent(value.constructionJournal, value.construction, "bundle");
    const paths = bundleSourcePaths(value.root, sourceId);
    expect(value.construction.directories[parent.ordinal]?.path).toBe(paths.parent);
    const observed = await nodeFs.lstat(paths.parent, { bigint: true });
    expect({ dev: observed.dev.toString(10), ino: observed.ino.toString(10) }).toStrictEqual({ dev: parent.dev, ino: parent.ino });
    expect((await stageSource(value)).entryCount).toBe(entries.length);
  });

  it("recovers in a fresh process from the persisted construction journal's directoryIdentities", async () => {
    const value = await fixture();
    await expect(stageOf(value, dieAt("structure_made"))).rejects.toBeInstanceOf(Killed);
    const fresh = await readConstructionJournal(value.root, value.construction);
    expect(fresh.directoryIdentities).toStrictEqual(value.constructionJournal.directoryIdentities);
    await executor(value).compensate(value.plan, value.construction, fresh);
    expect((await journalOf(value)).phase).toBe("rolled_back");
    expect(await nodeFs.readdir(bundleSourcePaths(value.root, sourceId).parent)).toEqual([]);
  });

  it("refuses a swapped parent inode before the first structure, exit 6", async () => {
    const value = await fixture();
    await swapSourceParent(value);
    await expect(stageSource(value)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect((await journalOf(value)).phase).toBe("planned");
    expect(await nodeFs.readdir(bundleSourcePaths(value.root, sourceId).parent)).toEqual([]);
  });

  it("refuses a swapped parent inode on recovery, before binding or removing anything, exit 6", async () => {
    const value = await fixture();
    await expect(stageOf(value, dieAt("journal_rewritten"))).rejects.toBeInstanceOf(Killed);
    await swapSourceParent(value);
    await expect(executor(value).compensate(value.plan, value.construction, await readConstructionJournal(value.root, value.construction))).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect((await journalOf(value)).phase).toBe("structure_staging");
  });

  it("refuses a construction journal of another plan", async () => {
    const value = await fixture();
    const other = await fixture();
    await expect(executor(value).stage(value.plan, value.scratch, value.construction, other.constructionJournal)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });
});
