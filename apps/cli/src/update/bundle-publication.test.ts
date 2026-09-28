import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bundleAggregateBytes,
  bundleInventoryHash,
  bundleMetadataPath,
  bundlePublicationEvidenceDirectory,
  bundlePublicationJournalBytes,
  bundleSourceJournalBytes,
  bundleSourcePaths,
  bundleSourceStagingPlanBytes,
  bundleSourceStagingPlanRef,
  createNodeLifecycleGuardedFileSystem,
  decodeCanonicalJson,
  deriveCanonicalStatePayloadPath,
  initialBundlePublicationJournal,
  initialBundleSourceJournal,
  LifecycleRecoveryRequiredError,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseSafeReasonCode,
  parseUInt64Decimal,
  parseUtcTimestamp,
  updateParticipantJournalPath,
  validateBundlePublicationJournal,
  type BundleMetadataStatePlanV1,
  type BundlePublicationJournalV1,
  type BundlePublicationPlanV1,
  type BundleRelativePathV1,
  type BundleSourceStagingPlanV1,
  type CanonicalAbsolutePathV1,
  type EffectiveUidV1,
  type LifecycleCoordinatorIdV1,
  type LifecycleGuardedFileSystemV1,
  type LowerHexSha256,
  type ReleaseBundleEntryV1,
  type ReleaseIdentityV1,
  type SafeReasonCodeV1,
} from "@developer-os/core";
import type { VerifiedScratchBundleV1 } from "@developer-os/security";
import { afterEach, describe, expect, it } from "vitest";

import { BUNDLE_PUBLICATION_DEATH_POINTS, BundlePublicationParticipant, type BundlePublicationDeathPointV1 } from "./bundle-publication.js";
import { BundleSourceExecutor } from "./bundle-source.js";
import { stageSourceConstruction, type SourceConstructionV1 } from "./rollback-testing.js";

const encoder = new TextEncoder();
const sha = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const u64 = parseUInt64Decimal;
const at = parseUtcTimestamp("2026-09-23T10:00:00.000Z");
const coordinatorId = `lc_${"e".repeat(64)}_31` as LifecycleCoordinatorIdV1;
const sourceId = parseSafeReasonCode("bundle_source");
const publicationId = parseSafeReasonCode("bundle_publication");
const uid = process.getuid?.() ?? -1;
const homes: string[] = [];
const files: readonly { readonly path: string; readonly mode: 384 | 448; readonly content: string }[] = [
  { path: "bin/developer-os", mode: 448, content: "#!/bin/sh\nexit 0\n" },
  { path: "readme.txt", mode: 384, content: "synthetic bundle\n" },
];
const entries: readonly ReleaseBundleEntryV1[] = [
  { path: "bin" as BundleRelativePathV1, kind: "directory", mode: 448 },
  ...files.map((file): ReleaseBundleEntryV1 => {
    const bytes = encoder.encode(file.content);
    return { path: file.path as BundleRelativePathV1, kind: "file", mode: file.mode, bytes: u64(bytes.byteLength.toString(10)), sha256: sha(bytes) };
  }),
];
const metadataContent = ['{"synthetic":"delegation"}\n', '{"synthetic":"index"}\n', '{"synthetic":"manifest"}\n'];

class Killed extends Error {}

afterEach(async () => {
  payloadEvidence.clear();
  for (const home of homes.splice(0)) await nodeFs.rm(home, { recursive: true, force: true });
});

interface Fixture {
  readonly home: CanonicalAbsolutePathV1;
  readonly root: CanonicalAbsolutePathV1;
  readonly target: ReleaseIdentityV1;
  readonly source: BundleSourceStagingPlanV1;
  readonly scratch: VerifiedScratchBundleV1;
  readonly construction: SourceConstructionV1;
  readonly journalPath: CanonicalAbsolutePathV1;
}

function guardedFs(): LifecycleGuardedFileSystemV1 {
  return createNodeLifecycleGuardedFileSystem({
    effectiveUid: uid,
    renameNoReplace: async ({ sourcePath, destinationPath }) => {
      await nodeFs.link(sourcePath, destinationPath);
      await nodeFs.unlink(sourcePath);
    },
  });
}

const dependencies = <TPoint extends string>(interrupt?: (point: TPoint) => void) => ({
  fs: guardedFs(),
  effectiveUid: uid,
  now: () => new Date("2026-09-23T10:00:05.000Z"),
  ...(interrupt === undefined ? {} : { interrupt }),
});

/** Stands in for construction evidence: the inode each metadata payload had when construction wrote it. */
const payloadEvidence = new Map<string, { readonly dev: ReturnType<typeof u64>; readonly ino: ReturnType<typeof u64> }>();

const payloadIdentity = (payload: { readonly path: string }) => {
  const found = payloadEvidence.get(payload.path);
  return found === undefined ? Promise.reject(new LifecycleRecoveryRequiredError("update_state_payload_evidence", [payload.path])) : Promise.resolve(found);
};

async function identityOf(path: string): Promise<{ readonly dev: ReturnType<typeof u64>; readonly ino: ReturnType<typeof u64> }> {
  const stats = await nodeFs.lstat(path, { bigint: true });
  return { dev: u64(stats.dev.toString(10)), ino: u64(stats.ino.toString(10)) };
}

async function exists(path: string): Promise<boolean> {
  return nodeFs.lstat(path).then(() => true, () => false);
}

/** A construction-shaped staging root with a staged, ready bundle source and its immutable plan. */
async function fixture(): Promise<Fixture> {
  const home = parseCanonicalAbsolutePathText(await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "dos-bundle-publication-"))));
  homes.push(home);
  const root = parseCanonicalAbsolutePathText(`${home}/staging/lifecycle/${coordinatorId}`);
  const paths = bundleSourcePaths(root, sourceId);
  const source: BundleSourceStagingPlanV1 = {
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
  const sourcePlanBytes = bundleSourceStagingPlanBytes(source);
  const sourceJournalBytes = bundleSourceJournalBytes(initialBundleSourceJournal(source, at));
  const construction = await stageSourceConstruction({
    root,
    coordinatorId,
    sources: [{ kind: "bundle_source_staging", id: sourceId, plan: sourcePlanBytes, journal: sourceJournalBytes }],
    rollbackSource: null,
    candidate: null,
  });
  for (const directory of [`${root}/update/journals/bundle_publication`, `${root}/update/payloads/state/release_metadata`, `${home}/releases/1.2.0`, ...["delegations", "indexes", "bundles"].map((store) => `${home}/state/release-metadata/${store}`)]) {
    await nodeFs.mkdir(directory, { recursive: true, mode: 0o700 });
  }
  await nodeFs.writeFile(bundleSourceStagingPlanRef(source, root).path, sourcePlanBytes, { mode: 0o600, flag: "wx" });
  await nodeFs.writeFile(updateParticipantJournalPath(root, "bundle_source_staging", sourceId), sourceJournalBytes, { mode: 0o600, flag: "wx" });
  const extracted = `${home}/scratch/extracted`;
  await nodeFs.mkdir(`${extracted}/bin`, { recursive: true, mode: 0o700 });
  for (const file of files) {
    await nodeFs.writeFile(`${extracted}/${file.path}`, file.content, { flag: "wx" });
    await nodeFs.chmod(`${extracted}/${file.path}`, file.mode);
  }
  const scratch: VerifiedScratchBundleV1 = { id: "rp_synthetic", planHash: sha("scratch plan"), manifestHash: sha("manifest"), root: parseCanonicalAbsolutePathText(extracted), entries: entries.length };
  await new BundleSourceExecutor(dependencies(), root).stage(source, scratch, construction.plan, construction.journal);
  const target: ReleaseIdentityV1 = {
    version: "1.2.0" as ReleaseIdentityV1["version"],
    releaseSequence: u64("12"),
    releaseIdentityHash: sha("identity"),
    delegationSequence: u64("3"),
    delegationHash: sha(metadataContent[0] as string),
    releaseIndexSequence: u64("4"),
    releaseIndexHash: sha(metadataContent[1] as string),
    bundleManifestHash: sha(metadataContent[2] as string),
    bundleRoot: parseCanonicalAbsolutePathText(`${home}/releases/1.2.0/darwin-arm64`),
    platform: "darwin",
    architecture: "arm64",
    launcherProtocol: 1 as ReleaseIdentityV1["launcherProtocol"],
    updateProtocol: 1 as ReleaseIdentityV1["updateProtocol"],
  };
  return { home, root, target, source, scratch, construction, journalPath: updateParticipantJournalPath(root, "bundle_publication", publicationId) };
}

/** Ordinal 1 (the index) is already retained; ordinals 0 and 2 arrive as construction payloads. */
async function metadataRow(value: Fixture, ordinal: number, created: boolean): Promise<BundleMetadataStatePlanV1> {
  const id = parseSafeReasonCode(`metadata_${ordinal.toString(10)}`);
  const content = metadataContent[ordinal] as string;
  const path = bundleMetadataPath(value.target, ordinal);
  const payloadPath = deriveCanonicalStatePayloadPath(value.home, coordinatorId as unknown as SafeReasonCodeV1, "release_metadata", id);
  const written = created ? payloadPath : path;
  if (!(await exists(written))) await nodeFs.writeFile(written, content, { mode: 0o600, flag: "wx" });
  const present = { state: "present" as const, hash: sha(content), ownerUid: uid as EffectiveUidV1, mode: 384 as const, nlink: 1 as const, size: encoder.encode(content).byteLength };
  const identity = await identityOf(written);
  if (created) payloadEvidence.set(payloadPath, identity);
  return {
    schemaVersion: 1,
    id,
    coordinatorId,
    role: "release_metadata",
    path,
    tombstonePath: parseCanonicalAbsolutePathText(`${value.root}/update/tombstones/${id}.json`),
    before: created ? { state: "absent" } : { ...present, payload: null, ...identity },
    // A postimage carries no device/inode (D60); a created row's identity is its payload evidence.
    after: created ? { ...present, payload: { kind: "update_expected", coordinatorId, ordinal: 40 + ordinal, path: payloadPath, hash: present.hash, bytes: present.size, mode: 384 } } : { ...present, payload: null },
    reversal: "reversible",
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  };
}

async function publishPlan(value: Fixture): Promise<BundlePublicationPlanV1> {
  const plan: BundlePublicationPlanV1 = {
    schemaVersion: 1,
    id: publicationId,
    coordinatorId,
    action: "publish_target",
    target: value.target,
    source: { kind: "staged_source", stagingPlan: bundleSourceStagingPlanRef(value.source, value.root), readyEvidencePath: bundleSourcePaths(value.root, sourceId).ready },
    targetRootBefore: { state: "absent" },
    metadata: [await metadataRow(value, 0, true), await metadataRow(value, 1, false), await metadataRow(value, 2, true)],
    entries,
    inventoryHash: bundleInventoryHash(entries),
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  };
  await writeInitialJournal(value, plan);
  return plan;
}

/** The outer step's no-replace move of the staged initial journal has already happened. */
async function writeInitialJournal(value: Fixture, plan: BundlePublicationPlanV1): Promise<void> {
  await nodeFs.rm(value.journalPath, { force: true });
  await nodeFs.writeFile(value.journalPath, bundlePublicationJournalBytes(initialBundlePublicationJournal(plan, at)), { mode: 0o600, flag: "wx" });
}

async function verifyPlan(value: Fixture): Promise<BundlePublicationPlanV1> {
  const rootIdentity = await identityOf(value.target.bundleRoot);
  const plan: BundlePublicationPlanV1 = {
    schemaVersion: 1,
    id: publicationId,
    coordinatorId,
    action: "verify_previous",
    target: value.target,
    source: { kind: "retained_bundle", root: value.target.bundleRoot, rootDev: rootIdentity.dev, rootIno: rootIdentity.ino, inventoryHash: bundleInventoryHash(entries), entryCount: entries.length, aggregateBytes: bundleAggregateBytes(entries) },
    targetRootBefore: { state: "present", inventoryHash: bundleInventoryHash(entries), dev: rootIdentity.dev, ino: rootIdentity.ino },
    metadata: [await metadataRow(value, 0, false), await metadataRow(value, 1, false), await metadataRow(value, 2, false)],
    entries,
    inventoryHash: bundleInventoryHash(entries),
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  };
  await writeInitialJournal(value, plan);
  return plan;
}

function participant(value: Fixture, interrupt?: (point: BundlePublicationDeathPointV1) => void): BundlePublicationParticipant {
  return new BundlePublicationParticipant({ ...dependencies(interrupt), payloadIdentity }, value.root);
}

function dieAt(point: BundlePublicationDeathPointV1): (reached: BundlePublicationDeathPointV1) => void {
  return (reached) => {
    if (reached === point) throw new Killed(point);
  };
}

async function journalOf(value: Fixture, plan: BundlePublicationPlanV1): Promise<BundlePublicationJournalV1> {
  return validateBundlePublicationJournal(decodeCanonicalJson(await nodeFs.readFile(value.journalPath), 1_048_576), plan);
}

/** After compensation: no target byte remains and only the already retained index survives. */
async function assertRolledBack(value: Fixture, plan: BundlePublicationPlanV1): Promise<void> {
  expect((await journalOf(value, plan)).phase).toBe("rolled_back");
  expect(await exists(value.target.bundleRoot)).toBe(false);
  expect(await exists(bundleMetadataPath(value.target, 0))).toBe(false);
  expect(await nodeFs.readFile(bundleMetadataPath(value.target, 1), "utf8")).toBe(metadataContent[1]);
  expect(await exists(bundleMetadataPath(value.target, 2))).toBe(false);
  expect(await nodeFs.readdir(bundlePublicationEvidenceDirectory(value.root, publicationId)).catch(() => [])).toEqual([]);
}

const FORWARD_DEATHS = BUNDLE_PUBLICATION_DEATH_POINTS.filter((point) => point !== "compensation_step" && point !== "compaction_step");

describe("BundlePublicationParticipant", () => {
  it("publishes the target root, every entry, and the three metadata files in order", async () => {
    const value = await fixture();
    const plan = await publishPlan(value);
    const observation = await participant(value).apply(plan);
    expect(observation.phase).toBe("verified");
    expect(observation.targetRootIdentity).toEqual({ role: "target_bundle_root", path: value.target.bundleRoot, mode: 448, ...(await identityOf(value.target.bundleRoot)) });
    for (const file of files) expect(await nodeFs.readFile(`${value.target.bundleRoot}/${file.path}`, "utf8")).toBe(file.content);
    expect((await nodeFs.readdir(value.target.bundleRoot, { recursive: true })).map(String).sort()).toEqual(entries.map((entry) => entry.path).sort());
    for (const ordinal of [0, 1, 2]) expect(await nodeFs.readFile(bundleMetadataPath(value.target, ordinal), "utf8")).toBe(metadataContent[ordinal]);
    const payload = (plan.metadata[0].after as Extract<BundleMetadataStatePlanV1["after"], { readonly state: "present" }>).payload;
    expect(await exists(payload?.path ?? "")).toBe(false);
    expect(observation.metadataIdentities[0]).toEqual({ ordinal: 0, ...(await identityOf(bundleMetadataPath(value.target, 0))) });
    expect(await nodeFs.readdir(bundlePublicationEvidenceDirectory(value.root, publicationId))).toHaveLength(entries.length);
  });

  it("creates an absent releases/<version> directory for a new release and leaves it empty after compensation", async () => {
    const value = await fixture();
    const versionRoot = `${value.home}/releases/1.2.0`;
    await nodeFs.rmdir(versionRoot);
    const plan = await publishPlan(value);
    await participant(value).apply(plan);
    expect((await nodeFs.stat(versionRoot)).mode & 0o777).toBe(0o700);
    await participant(value).compensate(plan);
    await assertRolledBack(value, plan);
    expect(await nodeFs.readdir(versionRoot)).toEqual([]);
  });

  it.each(FORWARD_DEATHS)("recovers %s in the compensating direction", async (point) => {
    const value = await fixture();
    const plan = await publishPlan(value);
    await expect(participant(value, dieAt(point)).apply(plan)).rejects.toBeInstanceOf(Killed);
    const observation = await participant(value).compensate(plan);
    expect(observation.phase).toBe("rolled_back");
    await assertRolledBack(value, plan);
  });

  it("compensates a verified publication in exact reverse and resumes after a compensation death", async () => {
    const value = await fixture();
    const plan = await publishPlan(value);
    await participant(value).apply(plan);
    await expect(participant(value, dieAt("compensation_step")).compensate(plan)).rejects.toBeInstanceOf(Killed);
    await participant(value).compensate(plan);
    await assertRolledBack(value, plan);
  });

  it("verifies the previous bundle without publishing a byte and compensates to nothing", async () => {
    const value = await fixture();
    await participant(value).apply(await publishPlan(value));
    const plan = await verifyPlan(value);
    const before = await identityOf(value.target.bundleRoot);
    const observation = await participant(value).apply(plan);
    expect(observation.phase).toBe("verified");
    expect(observation.targetRootIdentity).toEqual({ role: "target_bundle_root", path: value.target.bundleRoot, mode: 448, ...before });
    const compensated = await participant(value).compensate(plan);
    expect(compensated.phase).toBe("rolled_back");
    for (const file of files) expect(await nodeFs.readFile(`${value.target.bundleRoot}/${file.path}`, "utf8")).toBe(file.content);
    for (const ordinal of [0, 1, 2]) expect(await exists(bundleMetadataPath(value.target, ordinal))).toBe(true);
  });

  it("refuses to verify a retained bundle whose entry changed", async () => {
    const value = await fixture();
    await participant(value).apply(await publishPlan(value));
    const plan = await verifyPlan(value);
    await nodeFs.writeFile(`${value.target.bundleRoot}/readme.txt`, "edited retained!\n");
    await expect(participant(value).apply(plan)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("finalizes and compacts only publication evidence, resuming after a compaction death", async () => {
    const value = await fixture();
    const plan = await publishPlan(value);
    await participant(value).apply(plan);
    await expect(participant(value, dieAt("compaction_step")).compact(plan)).rejects.toBeInstanceOf(Killed);
    await participant(value).compact(plan);
    const journal = await journalOf(value, plan);
    expect(journal.phase).toBe("compacting");
    expect(journal.compactionNext).toBe(entries.length);
    expect(await nodeFs.readdir(bundlePublicationEvidenceDirectory(value.root, publicationId))).toEqual([]);
    for (const file of files) expect(await nodeFs.readFile(`${value.target.bundleRoot}/${file.path}`, "utf8")).toBe(file.content);
  });

  it("refuses a present target root, a source that is not ready, and a tampered source plan", async () => {
    const squatted = await fixture();
    const squattedPlan = await publishPlan(squatted);
    await nodeFs.mkdir(squatted.target.bundleRoot, { mode: 0o700 });
    await expect(participant(squatted).apply(squattedPlan)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(squatted.target.bundleRoot)).toBe(true);

    const notReady = await fixture();
    const notReadyPlan = await publishPlan(notReady);
    await new BundleSourceExecutor(dependencies(), notReady.root).compensate(notReady.source, notReady.construction.plan, notReady.construction.journal);
    await expect(participant(notReady).apply(notReadyPlan)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(notReady.target.bundleRoot)).toBe(false);

    const tampered = await fixture();
    const tamperedPlan = await publishPlan(tampered);
    const ref = bundleSourceStagingPlanRef(tampered.source, tampered.root);
    await nodeFs.chmod(ref.path, 0o600);
    await nodeFs.writeFile(ref.path, bundleSourceStagingPlanBytes({ ...tampered.source, maximumJournalBytes: 1_048_575 }));
    await expect(participant(tampered).apply(tamperedPlan)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("binds a metadata postimage only to its payload's construction evidence", async () => {
    const value = await fixture();
    const plan = await publishPlan(value);
    for (const row of plan.metadata) expect(Object.keys(row.after)).not.toContain("ino");
    const payload = (plan.metadata[0].after as Extract<BundleMetadataStatePlanV1["after"], { readonly state: "present" }>).payload?.path as string;
    payloadEvidence.delete(payload);
    await expect(participant(value).apply(plan)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(bundleMetadataPath(value.target, 0))).toBe(false);
    expect(await nodeFs.readFile(payload, "utf8")).toBe(metadataContent[0]);
  });

  it("refuses a metadata payload whose inode is not the planned one", async () => {
    const value = await fixture();
    const plan = await publishPlan(value);
    const payload = (plan.metadata[2].after as Extract<BundleMetadataStatePlanV1["after"], { readonly state: "present" }>).payload?.path as string;
    await nodeFs.rm(payload);
    await nodeFs.writeFile(payload, metadataContent[2] as string, { mode: 0o600 });
    await expect(participant(value).apply(plan)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    await participant(value).compensate(plan);
    await assertRolledBack(value, plan);
  });
});
