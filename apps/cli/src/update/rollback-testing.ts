import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildRollbackPayload,
  buildRollbackPayloadSourceStagingPlan,
  createNodeLifecycleGuardedFileSystem,
  encodeCanonicalJson,
  initialRollbackPayloadSourceJournal,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseSafeReasonCode,
  parseUInt64Decimal,
  parseUtcTimestamp,
  rollbackEntrySourceProjectionHash,
  rollbackPayloadSourceJournalBytes,
  rollbackPayloadSourcePaths,
  rollbackPayloadSourceStagingPlanBytes,
  rollbackPayloadSourceStagingPlanRef,
  rollbackSourceEntriesProjectionHash,
  rollbackStepListHash,
  updateLeafPlanPath,
  updateParticipantJournalPath,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonValue,
  type LifecycleCoordinatorIdV1,
  type LifecycleGuardedFileSystemV1,
  type LowerHexSha256,
  type PreparedRollbackPayloadV1,
  type PreparedUpdateCandidateV1,
  type ReleaseIdentityV1,
  type RollbackPayloadEntryV1,
  type RollbackPayloadIdV1,
  type RollbackPayloadSourceStagingPlanV1,
  type SchemaMigrationIdV1,
  type SecretScreenedBlobV1,
  type UInt64DecimalV1,
  type UpdateConstructionPlanV1,
  type UpdateConstructionRollbackEntrySourceV1,
} from "@developer-os/core";
import type {
  CanonicalJsonV1,
  EffectiveUidV1,
} from "@developer-os/core";

import type { BundleParticipantDependenciesV1 } from "./bundle-source.js";
import { RollbackPayloadSourceExecutor } from "./rollback-source.js";

/** Synthetic only: no path, byte, or identity here belongs to a real release or person. */
export const ROLLBACK_COORDINATOR = `lc_${"e".repeat(64)}_41` as LifecycleCoordinatorIdV1;
export const ROLLBACK_PAYLOAD_ID = `rb_${"d".repeat(64)}_5` as RollbackPayloadIdV1;
export const ROLLBACK_SOURCE_ID = parseSafeReasonCode("rollback_source");
export const ROLLBACK_AT = parseUtcTimestamp("2026-09-23T10:00:00.000Z");
export const OLD_OWNER = "old owner bytes\n";
export const NEW_OWNER = "new owner bytes\n";
export const BRAIN_BEFORE = "brain note before migration\n";
const MIGRATION_ID = "migration_note-links" as SchemaMigrationIdV1;
const uid = process.getuid?.() ?? -1;

export const sha = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const canonical = (value: unknown): string => encodeCanonicalJson(value as CanonicalJsonValue);

export interface RollbackSourceFixtureV1 {
  readonly home: CanonicalAbsolutePathV1;
  readonly root: CanonicalAbsolutePathV1;
  readonly payload: PreparedRollbackPayloadV1;
  readonly plan: RollbackPayloadSourceStagingPlanV1;
  readonly construction: UpdateConstructionPlanV1;
  /** The one planner output frame: the migration inverse, consumed by inventory ordinal 1. */
  readonly frame: SecretScreenedBlobV1;
  readonly preimagePath: CanonicalAbsolutePathV1;
}

export function guardedFs(): LifecycleGuardedFileSystemV1 {
  return createNodeLifecycleGuardedFileSystem({
    effectiveUid: uid,
    renameNoReplace: async ({ sourcePath, destinationPath }) => {
      await nodeFs.link(sourcePath, destinationPath);
      await nodeFs.unlink(sourcePath);
    },
  });
}

export function rollbackDependencies<TPoint extends string>(interrupt?: (point: TPoint) => void): BundleParticipantDependenciesV1<TPoint> {
  return { fs: guardedFs(), effectiveUid: uid, now: () => new Date("2026-09-23T10:00:05.000Z"), ...(interrupt === undefined ? {} : { interrupt }) };
}

export async function identityOf(path: string): Promise<{ readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }> {
  const stats = await nodeFs.lstat(path, { bigint: true });
  return { dev: parseUInt64Decimal(stats.dev.toString(10)), ino: parseUInt64Decimal(stats.ino.toString(10)) };
}

export async function exists(path: string): Promise<boolean> {
  return nodeFs.lstat(path, { bigint: true }).then(() => true, () => false);
}

function blob(ordinal: number, content: string): { readonly path: string; readonly bytes: number; readonly sha256: LowerHexSha256 } {
  return { path: `blobs/${String(ordinal).padStart(10, "0")}.bin`, bytes: Buffer.byteLength(content), sha256: sha(content) };
}

function file(content: string, payload: unknown = null): Record<string, unknown> {
  return { state: "file", mode: 384, bytes: Buffer.byteLength(content), sha256: sha(content), payload };
}

/**
 * A construction-shaped coordinator staging root with the source plan and its initial journal
 * published, one guarded owner preimage on disk, and a prepared payload of two blobs and two leaves.
 */
export async function createRollbackSourceFixture(homes: string[]): Promise<RollbackSourceFixtureV1> {
  const home = parseCanonicalAbsolutePathText(await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "dos-rollback-"))));
  homes.push(home);
  const root = parseCanonicalAbsolutePathText(`${home}/staging/lifecycle/${ROLLBACK_COORDINATOR}`);
  const paths = rollbackPayloadSourcePaths(root, ROLLBACK_PAYLOAD_ID);
  for (const directory of [paths.parent, `${root}/update/journals/rollback_payload_source`, `${root}/update/journals/rollback_payload_state`, `${root}/update/plans/rollback_payload_source`, `${home}/rollback`, `${home}/work`]) {
    await nodeFs.mkdir(directory, { recursive: true, mode: 0o700 });
  }
  const preimagePath = parseCanonicalAbsolutePathText(`${home}/work/replaced.md`);
  await nodeFs.writeFile(preimagePath, OLD_OWNER, { mode: 0o600, flag: "wx" });

  const owner = {
    schemaVersion: 1,
    kind: "owner_inverse",
    id: "owner_core",
    owner: "core",
    operations: [
      { path: `${home}/work/created.md`, expectedCurrent: file("created by the update\n"), restore: { state: "absent" } },
      { path: preimagePath, expectedCurrent: file(NEW_OWNER), restore: file(OLD_OWNER, { chunks: [blob(0, OLD_OWNER)], aggregateBytes: Buffer.byteLength(OLD_OWNER), sha256: sha(OLD_OWNER) }) },
    ],
    externalEffects: [],
    maximumPlanBytes: 16_777_216,
  };
  const migration = {
    schemaVersion: 1,
    kind: "schema_migration_inverse",
    id: MIGRATION_ID,
    domain: "brain",
    fromVersion: 1,
    toVersion: 2,
    mutations: [{ path: "notes/n1.md", expectedCurrentHash: sha("brain note after migration\n"), restoreHash: sha(BRAIN_BEFORE), restoreBlob: blob(1, BRAIN_BEFORE) }],
    maximumPlanBytes: 16_777_216,
  };
  const leaves = [{ kind: "owner_inverse", id: "owner_core", projection: canonical(owner) }, { kind: "schema_migration_inverse", id: MIGRATION_ID, projection: canonical(migration) }] as const;
  const entries = [
    { ordinal: 0, path: blob(0, OLD_OWNER).path, role: "owner_preimage", bytes: Buffer.byteLength(OLD_OWNER), sha256: sha(OLD_OWNER) },
    { ordinal: 1, path: blob(1, BRAIN_BEFORE).path, role: "migration_preimage", bytes: Buffer.byteLength(BRAIN_BEFORE), sha256: sha(BRAIN_BEFORE) },
    ...leaves.map((leaf, index) => ({ ordinal: 2 + index, path: `plans/${leaf.kind}/${leaf.id}.plan.json`, role: "inverse_plan_leaf", bytes: Buffer.byteLength(leaf.projection), sha256: sha(leaf.projection) })),
  ] as unknown as readonly RollbackPayloadEntryV1[];
  const installed = { releaseIdentityHash: sha("installed release") } as ReleaseIdentityV1;
  const previous = { releaseIdentityHash: sha("previous release") } as ReleaseIdentityV1;
  const candidate = {
    schemaVersion: 1,
    preview: { current: previous, target: installed },
    materialization: {
      inversePlanProjections: leaves.map((leaf) => ({ kind: leaf.kind, id: leaf.id, projection: leaf.projection, projectionHash: sha(leaf.id), bytes: Buffer.byteLength(leaf.projection) })),
      rollbackInventoryEntries: entries,
      aggregateBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    },
  } as unknown as PreparedUpdateCandidateV1;
  const ownerPlan = { kind: "owner_update", id: parseSafeReasonCode("owner_core"), path: updateLeafPlanPath(root, "owner_update", parseSafeReasonCode("owner_core")), hash: sha("owner plan"), bytes: 1 } as const;
  const migrationPlan = { kind: "schema_migration", id: MIGRATION_ID, path: updateLeafPlanPath(root, "schema_migration", MIGRATION_ID), hash: sha("migration plan"), bytes: 1 } as const;
  const payload = buildRollbackPayload(candidate, {
    payloadId: ROLLBACK_PAYLOAD_ID,
    executionBindingHash: sha("execution binding"),
    installed,
    previous,
    productHome: home,
    sourcePlanHashes: [ownerPlan.hash, migrationPlan.hash],
    exactStepListHash: rollbackStepListHash([{ participant: "bundle", transition: "verify_previous" }]),
    createdAt: ROLLBACK_AT,
  });

  const preimage = await identityOf(preimagePath);
  const sources: readonly UpdateConstructionRollbackEntrySourceV1[] = [
    { kind: "guarded_preimage", authority: { kind: "owner_operation_before", ownerPlan, operationOrdinal: 1 }, path: preimagePath, ownerUid: uid as EffectiveUidV1, mode: 384, nlink: 1, bytes: Buffer.byteLength(OLD_OWNER), sha256: sha(OLD_OWNER), ...preimage },
    { kind: "planner_output", ordinal: 0 },
    { kind: "plan_derived", role: "owner_inverse_plan", plan: ownerPlan, value: leaves[0].projection as CanonicalJsonV1, valueBytes: Buffer.byteLength(leaves[0].projection) },
    { kind: "plan_derived", role: "schema_migration_inverse_plan", plan: migrationPlan, value: leaves[1].projection as CanonicalJsonV1, valueBytes: Buffer.byteLength(leaves[1].projection) },
  ];
  const partial = {
    payloadId: ROLLBACK_PAYLOAD_ID,
    rollbackBindingHash: payload.identity.rollbackBindingHash,
    inventoryHash: payload.identity.inventoryHash,
    entries: sources.map((source, ordinal) => ({ ordinal, entry: payload.inventory.entries[ordinal] as RollbackPayloadEntryV1, source, sourceProjectionHash: rollbackEntrySourceProjectionHash(source) })),
  };
  const entriesProjectionHash = rollbackSourceEntriesProjectionHash(partial);
  const construction = { coordinatorId: ROLLBACK_COORDINATOR, rollbackSource: { sourcePlanId: ROLLBACK_SOURCE_ID, ...partial, entriesProjectionHash } } as unknown as UpdateConstructionPlanV1;

  const parent = await identityOf(paths.parent);
  const plan = buildRollbackPayloadSourceStagingPlan({ id: ROLLBACK_SOURCE_ID, coordinatorId: ROLLBACK_COORDINATOR, stagingRoot: root, sourceParentDev: parent.dev, sourceParentIno: parent.ino, payload, entriesProjectionHash });
  await nodeFs.writeFile(rollbackPayloadSourceStagingPlanRef(plan, root).path, rollbackPayloadSourceStagingPlanBytes(plan), { mode: 0o600, flag: "wx" });
  await nodeFs.writeFile(updateParticipantJournalPath(root, "rollback_payload_source", ROLLBACK_SOURCE_ID), rollbackPayloadSourceJournalBytes(initialRollbackPayloadSourceJournal(plan, ROLLBACK_AT)), { mode: 0o600, flag: "wx" });
  const content = new TextEncoder().encode(BRAIN_BEFORE);
  const frame = { ordinal: 0, bytes: content.byteLength, sha256: sha(content), content } as SecretScreenedBlobV1;
  return { home, root, payload, plan, construction, frame, preimagePath };
}

/** The originating process's whole source walk: structures and documents, the frame, then the tail and ready. */
export async function stageRollbackSource(fixture: RollbackSourceFixtureV1, executor = new RollbackPayloadSourceExecutor(rollbackDependencies(), fixture.root)): Promise<void> {
  await executor.prepare(fixture.plan, fixture.construction, { inversePlan: fixture.payload.inversePlanBytes, inventory: fixture.payload.inventoryBytes });
  await executor.consume(fixture.plan, fixture.construction, 1, fixture.frame);
  await executor.finish(fixture.plan, fixture.construction);
}
