import * as nodeFs from "node:fs/promises";

import {
  decodeCanonicalJson,
  LifecycleRecoveryRequiredError,
  rollbackPayloadPublicationJournalBytes,
  initialRollbackPayloadPublicationJournal,
  rollbackPayloadSourcePaths,
  rollbackPayloadSourceStagingPlanRef,
  rollbackPublicationEvidenceDirectory,
  updateParticipantJournalPath,
  validateRollbackPayloadPublicationJournal,
  validateRollbackPayloadStatePlan,
  type RollbackPayloadPublicationJournalV1,
  type RollbackPayloadStatePlanV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import { BundleGuardedIo } from "./bundle-source.js";
import {
  ROLLBACK_PUBLICATION_DEATH_POINTS,
  RollbackPayloadParticipant,
  verifyRetainedRollbackPayload,
  type RollbackPublicationDeathPointV1,
} from "./rollback-publication.js";
import {
  createRollbackSourceFixture,
  exists,
  guardedFs,
  ROLLBACK_AT,
  ROLLBACK_COORDINATOR,
  ROLLBACK_PAYLOAD_ID,
  rollbackDependencies,
  stageRollbackSource,
  type RollbackSourceFixtureV1,
} from "./rollback-testing.js";

const homes: string[] = [];
const uid = process.getuid?.() ?? -1;

class Killed extends Error {}

afterEach(async () => {
  for (const home of homes.splice(0)) await nodeFs.rm(home, { recursive: true, force: true });
});

async function writeInitialJournal(fixture: RollbackSourceFixtureV1, plan: RollbackPayloadStatePlanV1): Promise<void> {
  const path = updateParticipantJournalPath(fixture.root, "rollback_payload_state", plan.id);
  await nodeFs.rm(path, { force: true });
  await nodeFs.writeFile(path, rollbackPayloadPublicationJournalBytes(initialRollbackPayloadPublicationJournal(plan, ROLLBACK_AT)), { mode: 0o600, flag: "wx" });
}

async function publishPlan(fixture: RollbackSourceFixtureV1): Promise<RollbackPayloadStatePlanV1> {
  const identity = fixture.payload.identity;
  const plan = validateRollbackPayloadStatePlan({
    schemaVersion: 1,
    id: "rollback_payload",
    coordinatorId: ROLLBACK_COORDINATOR,
    retainedBefore: null,
    publish: identity,
    source: { stagingPlan: rollbackPayloadSourceStagingPlanRef(fixture.plan, fixture.root), readyEvidencePath: rollbackPayloadSourcePaths(fixture.root, ROLLBACK_PAYLOAD_ID).ready },
    retainAfter: identity,
    retireAtTerminal: [],
    publicationInventoryHash: identity.inventoryHash,
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  }, fixture.root);
  await writeInitialJournal(fixture, plan);
  return plan;
}

/** Manual rollback's plan over the payload an earlier update published. */
async function verifyOnlyPlan(fixture: RollbackSourceFixtureV1): Promise<RollbackPayloadStatePlanV1> {
  const identity = fixture.payload.identity;
  const plan = validateRollbackPayloadStatePlan({
    schemaVersion: 1,
    id: "rollback_verify",
    coordinatorId: ROLLBACK_COORDINATOR,
    retainedBefore: identity,
    publish: null,
    source: null,
    retainAfter: null,
    retireAtTerminal: [identity],
    publicationInventoryHash: null,
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  }, fixture.root);
  await writeInitialJournal(fixture, plan);
  return plan;
}

async function journalOf(fixture: RollbackSourceFixtureV1, plan: RollbackPayloadStatePlanV1): Promise<RollbackPayloadPublicationJournalV1> {
  const bytes = await nodeFs.readFile(updateParticipantJournalPath(fixture.root, "rollback_payload_state", plan.id));
  return validateRollbackPayloadPublicationJournal(decodeCanonicalJson(bytes, 1_048_576), plan);
}

function participant(fixture: RollbackSourceFixtureV1, interrupt?: (point: RollbackPublicationDeathPointV1) => void): RollbackPayloadParticipant {
  return new RollbackPayloadParticipant(rollbackDependencies(interrupt), fixture.root);
}

async function staged(): Promise<RollbackSourceFixtureV1> {
  const fixture = await createRollbackSourceFixture(homes);
  await stageRollbackSource(fixture);
  return fixture;
}

async function published(): Promise<RollbackSourceFixtureV1> {
  const fixture = await staged();
  const plan = await publishPlan(fixture);
  await participant(fixture).publish(plan);
  await participant(fixture).compact(plan);
  return fixture;
}

describe("RollbackPayloadParticipant.publish", () => {
  it("publishes five structures, every entry, then the inverse plan and inventory, and proves the result", async () => {
    const fixture = await staged();
    const plan = await publishPlan(fixture);
    const observation = await participant(fixture).publish(plan);

    expect(observation.phase).toBe("verified");
    expect(observation.structureIdentities.map((row) => row.role)).toStrictEqual(["rollback_payload_root", "plans_root", "owner_inverse_plans_root", "schema_migration_inverse_plans_root", "blobs_root"]);
    const root = fixture.payload.identity.root;
    expect(await nodeFs.readFile(`${root}/inverse-plan.json`)).toStrictEqual(Buffer.from(fixture.payload.inversePlanBytes));
    expect(await nodeFs.readFile(`${root}/inventory.json`)).toStrictEqual(Buffer.from(fixture.payload.inventoryBytes));
    const inventory = await verifyRetainedRollbackPayload(new BundleGuardedIo(guardedFs(), uid), fixture.payload.identity);
    // The canonical decoder yields null-prototype records by design; re-home them to compare strictly.
    expect(inventory.entries.map((entry) => ({ ...entry }))).toStrictEqual(fixture.payload.inventory.entries);
    // Publication is a copy: the ready source stays intact for its own later compaction.
    expect(await exists(fixture.plan.sourceRoot)).toBe(true);

    await participant(fixture).compact(plan);
    expect(await journalOf(fixture, plan)).toMatchObject({ phase: "compacting", compactionNext: fixture.payload.identity.entryCount });
    expect(await nodeFs.readdir(rollbackPublicationEvidenceDirectory(fixture.root, plan.id))).toStrictEqual([]);
    expect(await exists(`${root}/inventory.json`)).toBe(true);
  });

  it("refuses a source that never reached ready", async () => {
    const fixture = await createRollbackSourceFixture(homes);
    const plan = await publishPlan(fixture);
    await expect(participant(fixture).publish(plan)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(fixture.payload.identity.root)).toBe(false);
  });

  it("never replaces a present payload root", async () => {
    const fixture = await staged();
    const plan = await publishPlan(fixture);
    await nodeFs.mkdir(fixture.payload.identity.root, { mode: 0o700 });
    await nodeFs.writeFile(`${fixture.payload.identity.root}/foreign.txt`, "not ours\n", { mode: 0o600 });
    await expect(participant(fixture).publish(plan)).rejects.toThrow();
    expect(await nodeFs.readFile(`${fixture.payload.identity.root}/foreign.txt`, "utf8")).toBe("not ours\n");
  });

  it.each(ROLLBACK_PUBLICATION_DEATH_POINTS.filter((point) => point !== "compensation_step" && point !== "compaction_step"))("compensates the reached prefix after death at %s", async (point) => {
    const fixture = await staged();
    const plan = await publishPlan(fixture);
    const dying = participant(fixture, (reached) => {
      if (reached === point) throw new Killed(point);
    });
    await expect(dying.publish(plan)).rejects.toBeInstanceOf(Killed);

    const observation = await participant(fixture).compensate(plan);
    expect(observation.phase).toBe("rolled_back");
    expect(await exists(fixture.payload.identity.root)).toBe(false);
    expect(await nodeFs.readdir(`${fixture.home}/rollback`)).toStrictEqual([]);
    expect(await exists(fixture.plan.sourceRoot)).toBe(true);
  });

  /** Spec 2 §9.4: process death alone never chooses rollback, so a forward journal resumes its microstate. */
  it.each(ROLLBACK_PUBLICATION_DEATH_POINTS.filter((point) => point !== "compensation_step" && point !== "compaction_step"))("resumes forward after death at %s", async (point) => {
    const fixture = await staged();
    const plan = await publishPlan(fixture);
    const dying = participant(fixture, (reached) => {
      if (reached === point) throw new Killed(point);
    });
    await expect(dying.publish(plan)).rejects.toBeInstanceOf(Killed);

    expect((await participant(fixture).publish(plan)).phase).toBe("verified");
    const inventory = await verifyRetainedRollbackPayload(new BundleGuardedIo(guardedFs(), uid), fixture.payload.identity);
    expect(inventory.entries.map((entry) => ({ ...entry }))).toStrictEqual(fixture.payload.inventory.entries);
    expect(await nodeFs.readdir(rollbackPublicationEvidenceDirectory(fixture.root, plan.id))).toHaveLength(fixture.payload.identity.entryCount);
  });

  it("resumes a compensation that died between steps", async () => {
    const fixture = await staged();
    const plan = await publishPlan(fixture);
    await participant(fixture).publish(plan);
    let deaths = 0;
    const dying = participant(fixture, (reached) => {
      if (reached === "compensation_step" && deaths < 4) {
        deaths += 1;
        throw new Killed(reached);
      }
    });
    for (let attempt = 0; attempt < 4; attempt += 1) await expect(dying.compensate(plan)).rejects.toBeInstanceOf(Killed);
    expect((await participant(fixture).compensate(plan)).phase).toBe("rolled_back");
    expect(await exists(fixture.payload.identity.root)).toBe(false);
  });
});

describe("RollbackPayloadParticipant verify-only arm", () => {
  it("verifies the retained payload read-only and never compacts it", async () => {
    const fixture = await published();
    const plan = await verifyOnlyPlan(fixture);
    const root = fixture.payload.identity.root;

    await expect(participant(fixture).publish(plan)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect((await participant(fixture).verifyRetained(plan)).phase).toBe("verified");
    expect(await journalOf(fixture, plan)).toMatchObject({ nextStructure: 0, nextEntry: 0, nextMetadata: 0, compensationNext: null });
    expect(await exists(root)).toBe(true);
    await expect(participant(fixture).compact(plan)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(root)).toBe(true);
  });

  it("marks itself rolled back before the point of no return without touching the payload", async () => {
    const fixture = await published();
    const plan = await verifyOnlyPlan(fixture);
    await participant(fixture).verifyRetained(plan);
    expect((await participant(fixture).compensate(plan)).phase).toBe("rolled_back");
    await verifyRetainedRollbackPayload(new BundleGuardedIo(guardedFs(), uid), fixture.payload.identity);
  });

  it("preserves a payload with an unknown child as recovery-required", async () => {
    const fixture = await published();
    const plan = await verifyOnlyPlan(fixture);
    await nodeFs.writeFile(`${fixture.payload.identity.root}/blobs/9999999999.bin`, "unknown\n", { mode: 0o600 });
    await expect(participant(fixture).verifyRetained(plan)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect((await journalOf(fixture, plan)).phase).toBe("planned");
  });

  it("preserves a payload whose retained blob changed as recovery-required", async () => {
    const fixture = await published();
    const plan = await verifyOnlyPlan(fixture);
    const blob = `${fixture.payload.identity.root}/blobs/0000000000.bin`;
    await nodeFs.writeFile(blob, "tampered bytes!\n");
    await expect(participant(fixture).verifyRetained(plan)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(blob)).toBe(true);
  });
});
