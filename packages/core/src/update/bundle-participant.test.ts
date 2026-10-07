import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { EffectiveUidV1 } from "../lifecycle/ids.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import {
  advanceBundlePublicationJournal,
  advanceBundleSourceJournal,
  bundleAggregateBytes,
  bundleEntryParentOrdinal,
  bundleInventoryHash,
  bundleMetadataPath,
  bundlePublicationCompactionOrdinal,
  bundlePublicationPlanHash,
  bundleSourceCompactionTarget,
  bundleSourcePaths,
  bundleSourceReadyEvidence,
  bundleSourceReadyEvidenceBytes,
  bundleSourceStagingPlanBytes,
  bundleSourceStagingPlanHash,
  bundleSourceStagingPlanRef,
  durableEntryEvidenceBytes,
  durablePublicationEntryEvidence,
  durableSourceEntryEvidence,
  initialBundlePublicationJournal,
  initialBundleSourceJournal,
  updateLeafPlanHash,
  updateSourceEvidenceSetHash,
  updateSourceStructuresHash,
  validateBundlePublicationJournal,
  validateBundlePublicationPlan,
  validateBundleSourceJournal,
  validateBundleSourceReadyEvidence,
  validateBundleSourceStagingPlan,
  validateDurablePublicationEntryEvidence,
  validateDurableSourceEntryEvidence,
  type BundleMetadataStatePlanV1,
  type BundlePublicationJournalV1,
  type BundlePublicationPlanV1,
  type BundlePublicationStepV1,
  type BundleSourceStagingJournalV1,
  type BundleSourceStagingPlanV1,
  type BundleSourceStepV1,
} from "./bundle-participant.js";
import { updateLeafPlanPath } from "./construction.js";
import { updateParticipantJournalPath } from "./participants.js";
import { deriveCanonicalStatePayloadPath, parseCanonicalAbsolutePathText } from "./paths.js";
import type { BundleRelativePathV1, ReleaseBundleEntryV1, ReleaseIdentityV1 } from "./release.js";
import { parseLowerHexSha256, parseSafeReasonCode, parseUInt64Decimal, parseUtcTimestamp, type LowerHexSha256, type SafeReasonCodeV1 } from "./scalars.js";

const encoder = new TextEncoder();
const sha = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const u64 = parseUInt64Decimal;
const at = parseUtcTimestamp("2026-09-23T10:00:00.000Z");
const later = parseUtcTimestamp("2026-09-23T10:00:01.000Z");
const nonce = "b".repeat(64);
const coordinatorId = `lc_${nonce}_3` as LifecycleCoordinatorIdV1;
const home = parseCanonicalAbsolutePathText("/synthetic/home/.developer-os");
const root = parseCanonicalAbsolutePathText(`${home}/staging/lifecycle/${coordinatorId}`);
const sourceId = parseSafeReasonCode("bundle_source");
const publicationId = parseSafeReasonCode("bundle_publication");
const rel = (path: string): BundleRelativePathV1 => path as BundleRelativePathV1;
const fileBytes = encoder.encode("#!/bin/sh\nexit 0\n");
const entries: readonly ReleaseBundleEntryV1[] = [
  { path: rel("bin"), kind: "directory", mode: 448 },
  { path: rel("bin/developer-os"), kind: "file", mode: 448, bytes: u64(fileBytes.byteLength.toString(10)), sha256: sha(fileBytes) },
  { path: rel("readme.txt"), kind: "file", mode: 384, bytes: u64("5"), sha256: sha("hello") },
];

function sourcePlan(overrides: Partial<BundleSourceStagingPlanV1> = {}): BundleSourceStagingPlanV1 {
  const paths = bundleSourcePaths(root, sourceId);
  return {
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
    ...overrides,
  };
}

const target: ReleaseIdentityV1 = {
  version: "1.2.0" as ReleaseIdentityV1["version"],
  releaseSequence: u64("12"),
  releaseIdentityHash: sha("identity"),
  delegationSequence: u64("3"),
  delegationHash: sha("delegation"),
  releaseIndexSequence: u64("4"),
  releaseIndexHash: sha("index"),
  bundleManifestHash: sha("manifest"),
  bundleRoot: parseCanonicalAbsolutePathText(`${home}/releases/1.2.0/darwin-arm64`),
  platform: "darwin",
  architecture: "arm64",
  launcherProtocol: 1 as ReleaseIdentityV1["launcherProtocol"],
  updateProtocol: 1 as ReleaseIdentityV1["updateProtocol"],
};

function metadataRow(ordinal: number, created: boolean): BundleMetadataStatePlanV1 {
  const id = parseSafeReasonCode(`metadata_${ordinal.toString(10)}`);
  const present = { state: "present" as const, hash: sha(`metadata ${ordinal.toString(10)}`), ownerUid: 501 as EffectiveUidV1, mode: 384 as const, nlink: 1 as const, size: 20 };
  const identity = { dev: u64("9"), ino: u64((100 + ordinal).toString(10)) };
  const payload = { kind: "update_expected" as const, coordinatorId, ordinal: 40 + ordinal, path: deriveCanonicalStatePayloadPath(home, coordinatorId as unknown as SafeReasonCodeV1, "release_metadata", id), hash: present.hash, bytes: present.size, mode: 384 as const };
  return {
    schemaVersion: 1,
    id,
    coordinatorId,
    role: "release_metadata",
    path: bundleMetadataPath(target, ordinal),
    tombstonePath: parseCanonicalAbsolutePathText(`${root}/update/tombstones/${id}.json`),
    before: created ? { state: "absent" } : { ...present, payload: null, ...identity },
    after: created ? { ...present, payload } : { ...present, payload: null },
    reversal: "reversible",
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  };
}

function publishPlan(): BundlePublicationPlanV1 {
  const staged = sourcePlan();
  return {
    schemaVersion: 1,
    id: publicationId,
    coordinatorId,
    action: "publish_target",
    target,
    source: { kind: "staged_source", stagingPlan: bundleSourceStagingPlanRef(staged, root), readyEvidencePath: bundleSourcePaths(root, sourceId).ready },
    targetRootBefore: { state: "absent" },
    metadata: [metadataRow(0, true), metadataRow(1, false), metadataRow(2, true)],
    entries,
    inventoryHash: bundleInventoryHash(entries),
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  };
}

function verifyPlan(): BundlePublicationPlanV1 {
  return {
    ...publishPlan(),
    action: "verify_previous",
    source: { kind: "retained_bundle", root: target.bundleRoot, rootDev: u64("7"), rootIno: u64("8"), inventoryHash: bundleInventoryHash(entries), entryCount: entries.length, aggregateBytes: bundleAggregateBytes(entries) },
    targetRootBefore: { state: "present", inventoryHash: bundleInventoryHash(entries), dev: u64("7"), ino: u64("8") },
    metadata: [metadataRow(0, false), metadataRow(1, false), metadataRow(2, false)],
  };
}

function runSource(plan: BundleSourceStagingPlanV1, steps: readonly BundleSourceStepV1[], from = initialBundleSourceJournal(plan, at)): BundleSourceStagingJournalV1 {
  return steps.reduce((journal, step) => advanceBundleSourceJournal(plan, journal, step, later), from);
}

const entryCopy = (dev: string): readonly (BundleSourceStepV1 & BundlePublicationStepV1)[] => [
  { kind: "entry_intent" },
  { kind: "entry_created", dev: u64("5"), ino: u64(dev) },
  { kind: "evidence_intent" },
  { kind: "evidence_created", dev: u64("5"), ino: u64(`9${dev}`) },
  { kind: "entry_complete" },
];

const structures: readonly BundleSourceStepV1[] = [0, 1, 2].flatMap((ordinal) => [
  { kind: "structure_intent" as const },
  { kind: "structure_created" as const, dev: u64("5"), ino: u64((20 + ordinal).toString(10)) },
  { kind: "structure_complete" as const },
]);

const readySteps: readonly BundleSourceStepV1[] = [{ kind: "ready_intent" }, { kind: "ready_created", dev: u64("5"), ino: u64("77") }, { kind: "ready_complete" }];

function readySource(plan = sourcePlan()): BundleSourceStagingJournalV1 {
  return runSource(plan, [...structures, ...entries.flatMap((_, ordinal) => entryCopy((30 + ordinal).toString(10))), ...readySteps]);
}

describe("bundle leaf plans and paths", () => {
  it("hashes a leaf under its kind domain over JSON plus LF", () => {
    const bytes = encoder.encode(`{"a":1}\n`);
    const expected = createHash("sha256").update("developer-os/update-leaf/bundle_publication/v1\0").update(bytes).digest("hex");
    expect(updateLeafPlanHash("bundle_publication", bytes)).toBe(expected);
    expect(updateLeafPlanHash("bundle_source_staging", bytes)).not.toBe(expected);
  });

  it("derives the source envelope, its sibling ready evidence, and the generic journal path", () => {
    const paths = bundleSourcePaths(root, sourceId);
    expect(paths.sourceRoot).toBe(`${root}/update/source/bundle/bundle_source/payload`);
    expect(paths.evidenceRoot).toBe(`${root}/update/source/bundle/bundle_source/evidence`);
    expect(paths.ready).toBe(`${root}/update/source/bundle/bundle_source.ready.json`);
    expect(updateParticipantJournalPath(root, "bundle_source_staging", sourceId)).toBe(`${root}/update/journals/bundle_source_staging/bundle_source.json`);
  });

  it("round-trips the staging plan ref by kind, path, hash, and bytes", () => {
    const plan = sourcePlan();
    const ref = bundleSourceStagingPlanRef(plan, root);
    expect(ref.path).toBe(updateLeafPlanPath(root, "bundle_source_staging", sourceId));
    expect(ref.hash).toBe(updateLeafPlanHash("bundle_source_staging", bundleSourceStagingPlanBytes(plan)));
    expect(ref.bytes).toBe(bundleSourceStagingPlanBytes(plan).byteLength);
  });

  it("finds each entry's parent ordinal", () => {
    expect(bundleEntryParentOrdinal(entries, 0)).toBeNull();
    expect(bundleEntryParentOrdinal(entries, 1)).toBe(0);
    expect(bundleEntryParentOrdinal(entries, 2)).toBeNull();
  });
});

describe("BundleSourceStagingPlanV1", () => {
  it("admits the exact plan", () => {
    expect(validateBundleSourceStagingPlan(sourcePlan(), root)).toEqual(sourcePlan());
  });

  it.each<[string, Partial<BundleSourceStagingPlanV1>]>([
    ["a moved source root", { sourceRoot: parseCanonicalAbsolutePathText(`${root}/update/source/bundle/other/payload`) }],
    ["a wrong inventory hash", { inventoryHash: sha("other") }],
    ["a wrong aggregate", { aggregateBytes: 1 }],
    ["an empty inventory", { entries: [] }],
    ["a child before its parent", { entries: [entries[1] as ReleaseBundleEntryV1, entries[0] as ReleaseBundleEntryV1] }],
    ["a plan over its byte cap", { maximumPlanBytes: 64 }],
  ])("refuses %s", (_name, overrides) => {
    expect(() => validateBundleSourceStagingPlan(sourcePlan(overrides), root)).toThrow();
  });

  it("refuses an unknown key and another coordinator", () => {
    expect(() => validateBundleSourceStagingPlan({ ...sourcePlan(), extra: 1 }, root)).toThrow();
    expect(() => validateBundleSourceStagingPlan(sourcePlan({ coordinatorId: `lc_${nonce}_4` as LifecycleCoordinatorIdV1 }), root)).toThrow();
  });

  it("refuses the withdrawn parent identity fields as unknown keys (P1)", () => {
    expect(() => validateBundleSourceStagingPlan({ ...sourcePlan(), sourceParentDev: u64("1") }, root)).toThrow(/keys/u);
    expect(() => validateBundleSourceStagingPlan({ ...sourcePlan(), sourceParentDev: u64("1"), sourceParentIno: u64("2") }, root)).toThrow(/keys/u);
  });
});

describe("BundleSourceStagingJournalV1", () => {
  it("walks structures, manifest-order entries, and ready evidence to source_ready", () => {
    const plan = sourcePlan();
    const journal = readySource(plan);
    expect(journal.phase).toBe("source_ready");
    expect(journal.structureIdentities.map((identity) => identity.role)).toEqual(["source_envelope", "source_payload_root", "source_evidence_root"]);
    expect(journal.nextEntry).toBe(entries.length);
    expect(journal.readyIdentity).toEqual({ dev: "5", ino: "77" });
  });

  it("refuses entries before all three structures and ready before every entry", () => {
    const plan = sourcePlan();
    const partial = runSource(plan, structures.slice(0, 3));
    expect(() => advanceBundleSourceJournal(plan, partial, { kind: "entry_intent" }, later)).toThrow();
    const noEntries = runSource(plan, structures);
    expect(() => advanceBundleSourceJournal(plan, noEntries, { kind: "ready_intent" }, later)).toThrow();
  });

  it("refuses a skipped microstate and time moving backwards", () => {
    const plan = sourcePlan();
    const journal = runSource(plan, structures);
    expect(() => advanceBundleSourceJournal(plan, journal, { kind: "evidence_intent" }, later)).toThrow();
    expect(() => advanceBundleSourceJournal(plan, runSource(plan, [{ kind: "structure_intent" }]), { kind: "structure_created", dev: u64("1"), ino: u64("1") }, at)).toThrow();
  });

  it("refuses a journal with a used cursor its phase does not own", () => {
    const plan = sourcePlan();
    const journal = initialBundleSourceJournal(plan, at);
    expect(() => validateBundleSourceJournal({ ...journal, nextEntry: 1 }, plan)).toThrow();
    expect(() => validateBundleSourceJournal({ ...journal, compactionNext: 0 }, plan)).toThrow();
    expect(() => validateBundleSourceJournal({ ...journal, planHash: sha("other") }, plan)).toThrow();
  });

  it("compensates ready evidence, then entries entry-before-evidence, then structures in reverse", () => {
    const plan = sourcePlan();
    let journal = advanceBundleSourceJournal(plan, readySource(plan), { kind: "compensate" }, later);
    expect(journal.compensationNext).toBe(entries.length - 1);
    expect(() => advanceBundleSourceJournal(plan, journal, { kind: "compensation_step" }, later)).toThrow();
    journal = advanceBundleSourceJournal(plan, journal, { kind: "ready_removed" }, later);
    const walk: string[] = [];
    while (journal.phase === "compensating") {
      walk.push((journal.compensationNext ?? -1) >= 0 ? `${String(journal.compensationPart)}${String(journal.compensationNext)}` : `structure${String(journal.compensationStructureNext)}`);
      journal = advanceBundleSourceJournal(plan, journal, { kind: "compensation_step" }, later);
    }
    expect(walk).toEqual(["entry2", "evidence2", "entry1", "evidence1", "entry0", "evidence0", "structure2", "structure1", "structure0", "structure-1"]);
    expect(journal.phase).toBe("rolled_back");
  });

  it("starts compensation at the created in-flight entry and skips an unbound intent", () => {
    const plan = sourcePlan();
    const created = runSource(plan, [...structures, ...entryCopy("30").slice(0, 2)]);
    expect(advanceBundleSourceJournal(plan, created, { kind: "compensate" }, later).compensationNext).toBe(0);
    const intent = runSource(plan, [...structures, { kind: "entry_intent" }]);
    const compensating = advanceBundleSourceJournal(plan, intent, { kind: "compensate" }, later);
    expect(compensating.compensationNext).toBe(-1);
    expect(compensating.compensationStructureNext).toBe(2);
  });

  it("flattens compaction as ready, reverse entries target then evidence, then reverse structures", () => {
    const plan = sourcePlan();
    const targets = Array.from({ length: 2 * entries.length + 4 }, (_, cursor) => bundleSourceCompactionTarget(plan, cursor));
    expect(targets[0]).toEqual({ kind: "ready" });
    expect(targets[1]).toEqual({ kind: "entry", ordinal: 2 });
    expect(targets[2]).toEqual({ kind: "evidence", ordinal: 2 });
    expect(targets[6]).toEqual({ kind: "evidence", ordinal: 0 });
    expect(targets.slice(7)).toEqual([{ kind: "structure", ordinal: 2 }, { kind: "structure", ordinal: 1 }, { kind: "structure", ordinal: 0 }]);
    let journal = advanceBundleSourceJournal(plan, readySource(plan), { kind: "compaction_step" }, later);
    for (let step = 0; step < 2 * entries.length + 4; step += 1) journal = advanceBundleSourceJournal(plan, journal, { kind: "compaction_step" }, later);
    expect(journal.compactionNext).toBe(2 * entries.length + 4);
    expect(() => advanceBundleSourceJournal(plan, journal, { kind: "compaction_step" }, later)).toThrow();
  });
});

describe("source evidence and ready proof", () => {
  it("binds the exact canonical evidence per row and refuses another ordinal", () => {
    const plan = sourcePlan();
    const bytes = durableEntryEvidenceBytes(durableSourceEntryEvidence(plan, 1, u64("5"), u64("31")));
    expect(validateDurableSourceEntryEvidence(bytes, plan, 1).ino).toBe("31");
    expect(() => validateDurableSourceEntryEvidence(bytes, plan, 2)).toThrow();
    const directory = durableSourceEntryEvidence(plan, 0, u64("5"), u64("30"));
    expect(directory.kind).toBe("directory");
    expect(directory.sha256).toBeNull();
    expect(directory.pathHash).toBe(sha("bin"));
  });

  it("derives ready evidence from the complete journal and refuses a different evidence set", () => {
    const plan = sourcePlan();
    const journal = runSource(plan, [...structures, ...entries.flatMap((_, ordinal) => entryCopy((30 + ordinal).toString(10)))]);
    const setHash = updateSourceEvidenceSetHash([sha("e0"), sha("e1"), sha("e2")]);
    const ready = bundleSourceReadyEvidence(plan, journal, setHash);
    expect(ready.stagingPlanHash).toBe(bundleSourceStagingPlanHash(plan));
    expect(ready.sourceRootIno).toBe("21");
    expect(ready.structureIdentitiesHash).toBe(updateSourceStructuresHash(journal.structureIdentities));
    const bytes = bundleSourceReadyEvidenceBytes(ready);
    expect(validateBundleSourceReadyEvidence(bytes, plan, journal, setHash)).toEqual(ready);
    expect(() => validateBundleSourceReadyEvidence(bytes, plan, journal, updateSourceEvidenceSetHash([sha("e0")]))).toThrow();
    expect(() => bundleSourceReadyEvidence(plan, runSource(plan, structures), setHash)).toThrow();
    expect(() => updateSourceEvidenceSetHash([])).toThrow();
  });
});

describe("BundlePublicationPlanV1", () => {
  it("admits publish_target and verify_previous", () => {
    expect(validateBundlePublicationPlan(publishPlan(), root).action).toBe("publish_target");
    expect(validateBundlePublicationPlan(verifyPlan(), root).action).toBe("verify_previous");
  });

  it.each<[string, () => unknown]>([
    ["publish over a present root", () => ({ ...publishPlan(), targetRootBefore: verifyPlan().targetRootBefore })],
    ["publish from a retained bundle", () => ({ ...publishPlan(), source: verifyPlan().source })],
    ["verify from a staged source", () => ({ ...verifyPlan(), source: publishPlan().source })],
    ["verify with a created metadata row", () => ({ ...verifyPlan(), metadata: publishPlan().metadata })],
    ["a retained root of another identity", () => ({ ...verifyPlan(), targetRootBefore: { state: "present", inventoryHash: bundleInventoryHash(entries), dev: u64("7"), ino: u64("9") } })],
    ["metadata at a non-hash-derived path", () => ({ ...publishPlan(), metadata: [{ ...metadataRow(0, true), path: bundleMetadataPath(target, 1) }, metadataRow(1, false), metadataRow(2, true)] })],
    ["a metadata replacement", () => ({ ...publishPlan(), metadata: [{ ...metadataRow(1, false), after: metadataRow(0, true).after, path: bundleMetadataPath(target, 0) }, metadataRow(1, false), metadataRow(2, true)] })],
    ["a postimage with a planned device/inode", () => ({ ...publishPlan(), metadata: [{ ...metadataRow(0, true), after: { ...metadataRow(0, true).after, dev: u64("9"), ino: u64("100") } }, metadataRow(1, false), metadataRow(2, true)] })],
    ["a preimage without a device/inode", () => ({ ...verifyPlan(), metadata: [{ ...metadataRow(0, false), before: metadataRow(0, false).after }, metadataRow(1, false), metadataRow(2, false)] })],
    ["a verify row whose postimage differs from its preimage", () => ({ ...verifyPlan(), metadata: [{ ...metadataRow(0, false), after: { ...metadataRow(0, false).after, size: 21 } }, metadataRow(1, false), metadataRow(2, false)] })],
    ["a wrong ready path", () => ({ ...publishPlan(), source: { ...publishPlan().source, readyEvidencePath: parseCanonicalAbsolutePathText(`${root}/ready.json`) } })],
    ["a wrong inventory hash", () => ({ ...publishPlan(), inventoryHash: sha("other") })],
    ["a bundle root outside releases", () => ({ ...publishPlan(), target: { ...target, bundleRoot: parseCanonicalAbsolutePathText(`${home}/elsewhere`) } })],
  ])("refuses %s", (_name, build) => {
    expect(() => validateBundlePublicationPlan(build(), root)).toThrow();
  });

  it("derives the three retained metadata paths from the target hashes", () => {
    expect(bundleMetadataPath(target, 0)).toBe(`${home}/state/release-metadata/delegations/${target.delegationHash}.json`);
    expect(bundleMetadataPath(target, 1)).toBe(`${home}/state/release-metadata/indexes/${target.releaseIndexHash}.json`);
    expect(bundleMetadataPath(target, 2)).toBe(`${home}/state/release-metadata/bundles/${target.bundleManifestHash}.json`);
  });
});

function runPublication(plan: BundlePublicationPlanV1, steps: readonly BundlePublicationStepV1[], from = initialBundlePublicationJournal(plan, at)): BundlePublicationJournalV1 {
  return steps.reduce((journal, step) => advanceBundlePublicationJournal(plan, journal, step, later), from);
}

const rootSteps: readonly BundlePublicationStepV1[] = [{ kind: "root_intent" }, { kind: "root_created", dev: u64("5"), ino: u64("60") }, { kind: "root_complete" }];
const createdMetadata = (ino: string): readonly BundlePublicationStepV1[] => [{ kind: "metadata_intent" }, { kind: "metadata_published", dev: u64("9"), ino: u64(ino) }, { kind: "metadata_complete" }];

function verifiedPublication(plan = publishPlan()): BundlePublicationJournalV1 {
  return runPublication(plan, [
    ...rootSteps,
    ...entries.flatMap((_, ordinal) => entryCopy((60 + ordinal).toString(10))),
    ...createdMetadata("100"),
    { kind: "metadata_verified" },
    ...createdMetadata("102"),
  ]);
}

describe("BundlePublicationJournalV1", () => {
  it("publishes root, entries, then delegation/index/manifest metadata to verified", () => {
    const journal = verifiedPublication();
    expect(journal.phase).toBe("verified");
    expect(journal.targetRootIdentity?.role).toBe("target_bundle_root");
    expect(journal.metadataIdentities.map((identity) => identity.ordinal)).toEqual([0, 1, 2]);
  });

  it("refuses a publish transition for a verify-only metadata row and a verify for a created row", () => {
    const plan = publishPlan();
    const atMetadata = runPublication(plan, [...rootSteps, ...entries.flatMap((_, ordinal) => entryCopy((60 + ordinal).toString(10))), ...createdMetadata("100")]);
    expect(() => advanceBundlePublicationJournal(plan, atMetadata, { kind: "metadata_intent" }, later)).toThrow();
    const first = runPublication(plan, [...rootSteps, ...entries.flatMap((_, ordinal) => entryCopy((60 + ordinal).toString(10)))]);
    expect(() => advanceBundlePublicationJournal(plan, first, { kind: "metadata_verified" }, later)).toThrow();
  });

  it("withdraws a forward create intent with create_refused and refuses it once compensation started", () => {
    const plan = publishPlan();
    const atRoot = runPublication(plan, [{ kind: "root_intent" }]);
    expect(advanceBundlePublicationJournal(plan, atRoot, { kind: "create_refused" }, later).rootWriteState).toBeNull();
    const atEntry = runPublication(plan, [...rootSteps, { kind: "entry_intent" }]);
    expect(advanceBundlePublicationJournal(plan, atEntry, { kind: "create_refused" }, later).entryWriteState).toBeNull();
    const compensating = advanceBundlePublicationJournal(plan, atEntry, { kind: "compensate" }, later);
    expect(compensating.entryWriteState?.state).toBe("entry_intent");
    expect(() => advanceBundlePublicationJournal(plan, compensating, { kind: "create_refused" }, later)).toThrow();
  });

  it("walks created metadata, then entries, then the root in reverse", () => {
    const plan = publishPlan();
    let journal = advanceBundlePublicationJournal(plan, verifiedPublication(plan), { kind: "compensate" }, later);
    const walk: string[] = [];
    while (journal.phase !== "rolled_back") {
      walk.push(journal.phase === "compensating_metadata" ? `m${String(journal.compensationMetadataNext)}`
        : journal.phase === "compensating_entries" ? `${journal.compensationPart ?? "e"}${String(journal.compensationNext)}`
          : `r${String(journal.compensationRootNext)}`);
      journal = advanceBundlePublicationJournal(plan, journal, { kind: "compensation_step" }, later);
    }
    expect(walk).toEqual(["m2", "m1", "m0", "m-1", "entry2", "evidence2", "entry1", "evidence1", "entry0", "evidence0", "e-1", "r0", "r-1"]);
    expect(validateBundlePublicationJournal(journal, plan).compensationRootNext).toBe(-1);
  });

  it("verifies a previous bundle without any mutation cursor and compensates to rolled_back directly", () => {
    const plan = verifyPlan();
    const journal = runPublication(plan, [{ kind: "root_verified" }, ...entries.map(() => ({ kind: "entry_verified" as const })), ...[0, 1, 2].map(() => ({ kind: "metadata_verified" as const }))]);
    expect(journal.phase).toBe("verified");
    expect(journal.targetRootIdentity?.ino).toBe("8");
    const rolledBack = advanceBundlePublicationJournal(plan, journal, { kind: "compensate" }, later);
    expect(rolledBack.phase).toBe("rolled_back");
    expect(rolledBack.compensationNext).toBeNull();
    expect(() => advanceBundlePublicationJournal(plan, initialBundlePublicationJournal(plan, at), { kind: "root_intent" }, later)).toThrow();
    expect(() => advanceBundlePublicationJournal(plan, runPublication(plan, [{ kind: "root_verified" }]), { kind: "entry_intent" }, later)).toThrow();
  });

  it("finalizes, then compacts publication evidence in reverse ordinal order only", () => {
    const plan = publishPlan();
    let journal = advanceBundlePublicationJournal(plan, verifiedPublication(plan), { kind: "finalize" }, later);
    expect(() => advanceBundlePublicationJournal(plan, journal, { kind: "compensate" }, later)).toThrow();
    journal = advanceBundlePublicationJournal(plan, journal, { kind: "compaction_step" }, later);
    expect(Array.from({ length: entries.length }, (_, cursor) => bundlePublicationCompactionOrdinal(plan, cursor))).toEqual([2, 1, 0]);
    for (let step = 0; step < entries.length; step += 1) journal = advanceBundlePublicationJournal(plan, journal, { kind: "compaction_step" }, later);
    expect(journal.compactionNext).toBe(entries.length);
    expect(() => advanceBundlePublicationJournal(plan, journal, { kind: "compaction_step" }, later)).toThrow();
  });

  it("binds publication evidence to the plan hash and row", () => {
    const plan = publishPlan();
    const evidence = durablePublicationEntryEvidence(plan, 2, u64("5"), u64("62"));
    expect(evidence.participantPlanHash).toBe(bundlePublicationPlanHash(plan));
    const bytes = durableEntryEvidenceBytes(evidence);
    expect(validateDurablePublicationEntryEvidence(bytes, plan, 2)).toEqual(evidence);
    expect(() => validateDurablePublicationEntryEvidence(bytes, plan, 1)).toThrow();
  });
});

describe("forward created/published steps after compensation began, and rolled_back write states (W2-ROLLBACK-4/-5 follow-up)", () => {
  const compensateSource = (plan: BundleSourceStagingPlanV1, steps: readonly BundleSourceStepV1[]): BundleSourceStagingJournalV1 => runSource(plan, [...steps, { kind: "compensate" }]);
  const compensatePublication = (plan: BundlePublicationPlanV1, steps: readonly BundlePublicationStepV1[]): BundlePublicationJournalV1 => runPublication(plan, [...steps, { kind: "compensate" }]);

  it("refuses structure_created and ready_created on a compensating source journal with a leftover create_intent", () => {
    const plan = sourcePlan();
    const structure = compensateSource(plan, [{ kind: "structure_intent" }]);
    expect(structure.structureWriteState?.state).toBe("create_intent");
    expect(() => advanceBundleSourceJournal(plan, structure, { kind: "structure_created", dev: u64("5"), ino: u64("99") }, later)).toThrow();
    const ready = compensateSource(plan, [...structures, ...entries.flatMap((_, ordinal) => entryCopy((30 + ordinal).toString(10))), { kind: "ready_intent" }]);
    expect(ready.readyWriteState?.state).toBe("create_intent");
    expect(() => advanceBundleSourceJournal(plan, ready, { kind: "ready_created", dev: u64("5"), ino: u64("98") }, later)).toThrow();
  });

  it("refuses root_created and metadata_published on a compensating publication journal with a leftover intent", () => {
    const plan = publishPlan();
    const root = compensatePublication(plan, [{ kind: "root_intent" }]);
    expect(root.rootWriteState?.state).toBe("create_intent");
    expect(() => advanceBundlePublicationJournal(plan, root, { kind: "root_created", dev: u64("5"), ino: u64("97") }, later)).toThrow();
    const metadata = compensatePublication(plan, [...rootSteps, ...entries.flatMap((_, ordinal) => entryCopy((60 + ordinal).toString(10))), { kind: "metadata_intent" }]);
    expect(metadata.metadataWriteState?.state).toBe("publish_intent");
    expect(() => advanceBundlePublicationJournal(plan, metadata, { kind: "metadata_published", dev: u64("9"), ino: u64("96") }, later)).toThrow();
  });

  it("reaches rolled_back with every publication write state cleared, and refuses a rolled_back journal that kept one", () => {
    const plan = publishPlan();
    let journal = compensatePublication(plan, [...rootSteps, ...entries.flatMap((_, ordinal) => entryCopy((60 + ordinal).toString(10))), { kind: "metadata_intent" }]);
    while (journal.phase !== "rolled_back") journal = advanceBundlePublicationJournal(plan, journal, { kind: "compensation_step" }, later);
    expect([journal.rootWriteState, journal.entryWriteState, journal.metadataWriteState]).toStrictEqual([null, null, null]);
    expect(journal.nextMetadata).toBeLessThan(3);
    expect(() => validateBundlePublicationJournal({ ...journal, metadataWriteState: { ordinal: journal.nextMetadata, state: "publish_intent" } }, plan)).toThrow();
  });

  it("refuses a rolled_back source journal that kept an entry write state", () => {
    const plan = sourcePlan();
    let journal = compensateSource(plan, [...structures, ...entryCopy("30"), { kind: "entry_intent" }]);
    while (journal.phase !== "rolled_back") journal = advanceBundleSourceJournal(plan, journal, { kind: "compensation_step" }, later);
    expect(journal.nextEntry).toBeLessThan(entries.length);
    expect(() => validateBundleSourceJournal({ ...journal, entryWriteState: { ordinal: journal.nextEntry, state: "entry_intent" } }, plan)).toThrow();
  });
});
