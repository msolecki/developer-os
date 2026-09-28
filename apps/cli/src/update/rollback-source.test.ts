import * as nodeFs from "node:fs/promises";

import {
  decodeCanonicalJson,
  LifecycleRecoveryRequiredError,
  rollbackPayloadSourcePaths,
  rollbackSourceEntryPath,
  rollbackSourceEvidencePath,
  updateParticipantJournalPath,
  validateRollbackPayloadSourceJournal,
  type RollbackPayloadEntryV1,
  type RollbackPayloadSourceStagingJournalV1,
  type UpdateConstructionPlanV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import { resolveSourceParent } from "./construction.js";
import { ROLLBACK_SOURCE_DEATH_POINTS, RollbackPayloadSourceExecutor, type RollbackSourceDeathPointV1 } from "./rollback-source.js";
import {
  BRAIN_BEFORE,
  createRollbackSourceFixture,
  exists,
  identityOf,
  OLD_OWNER,
  readConstructionJournal,
  ROLLBACK_PAYLOAD_ID,
  ROLLBACK_SOURCE_ID,
  rollbackDependencies,
  stageRollbackSource,
  type RollbackSourceFixtureV1,
} from "./rollback-testing.js";

const homes: string[] = [];

class Killed extends Error {}

afterEach(async () => {
  for (const home of homes.splice(0)) await nodeFs.rm(home, { recursive: true, force: true });
});

async function journalOf(fixture: RollbackSourceFixtureV1): Promise<RollbackPayloadSourceStagingJournalV1> {
  const bytes = await nodeFs.readFile(updateParticipantJournalPath(fixture.root, "rollback_payload_source", ROLLBACK_SOURCE_ID));
  return validateRollbackPayloadSourceJournal(decodeCanonicalJson(bytes, 1_048_576), fixture.plan);
}

function executor(fixture: RollbackSourceFixtureV1, interrupt?: (point: RollbackSourceDeathPointV1) => void): RollbackPayloadSourceExecutor {
  return new RollbackPayloadSourceExecutor(rollbackDependencies(interrupt), fixture.root);
}

function withEntry(fixture: RollbackSourceFixtureV1, ordinal: number, change: (entry: RollbackPayloadEntryV1) => RollbackPayloadEntryV1): UpdateConstructionPlanV1 {
  const source = fixture.construction.rollbackSource as NonNullable<UpdateConstructionPlanV1["rollbackSource"]>;
  const entries = source.entries.map((row) => (row.ordinal === ordinal ? { ...row, entry: change(row.entry) } : row));
  return { ...fixture.construction, rollbackSource: { ...source, entries } };
}

describe("RollbackPayloadSourceExecutor", () => {
  it("stages seven structures, both documents, every entry from its one authority, then ready evidence", async () => {
    const fixture = await createRollbackSourceFixture(homes);
    await stageRollbackSource(fixture);

    const journal = await journalOf(fixture);
    expect(journal.phase).toBe("source_ready");
    expect(journal.structureIdentities).toHaveLength(7);
    expect(journal.metadataIdentities.map((row) => row.role)).toStrictEqual(["inverse_plan", "inventory"]);
    expect(await nodeFs.readFile(`${fixture.plan.sourceRoot}/inverse-plan.json`)).toStrictEqual(Buffer.from(fixture.payload.inversePlanBytes));
    expect(await nodeFs.readFile(`${fixture.plan.sourceRoot}/inventory.json`)).toStrictEqual(Buffer.from(fixture.payload.inventoryBytes));
    const [owner, migration, ownerLeaf, migrationLeaf] = fixture.payload.inventory.entries;
    expect(await nodeFs.readFile(rollbackSourceEntryPath(fixture.plan, owner as RollbackPayloadEntryV1), "utf8")).toBe(OLD_OWNER);
    expect(await nodeFs.readFile(rollbackSourceEntryPath(fixture.plan, migration as RollbackPayloadEntryV1), "utf8")).toBe(BRAIN_BEFORE);
    for (const [index, leaf] of [ownerLeaf, migrationLeaf].entries()) {
      expect(await nodeFs.readFile(rollbackSourceEntryPath(fixture.plan, leaf as RollbackPayloadEntryV1))).toStrictEqual(Buffer.from(fixture.payload.leaves[index]?.bytes ?? []));
    }
    for (let ordinal = 0; ordinal < fixture.plan.entryCount; ordinal += 1) expect(await exists(rollbackSourceEvidencePath(fixture.plan, ordinal))).toBe(true);
    expect(await exists(rollbackPayloadSourcePaths(fixture.root, ROLLBACK_PAYLOAD_ID).ready)).toBe(true);
    // The guarded preimage is only read.
    expect(await nodeFs.readFile(fixture.preimagePath, "utf8")).toBe(OLD_OWNER);
  });

  it("stages under the construction-created update/source/rollback with no hand mkdir (P1)", async () => {
    const fixture = await createRollbackSourceFixture(homes);
    const parent = resolveSourceParent(fixture.constructionJournal, fixture.construction, "rollback");
    expect(fixture.construction.directories[parent.ordinal]?.path).toBe(rollbackPayloadSourcePaths(fixture.root, ROLLBACK_PAYLOAD_ID).parent);
    expect(await identityOf(rollbackPayloadSourcePaths(fixture.root, ROLLBACK_PAYLOAD_ID).parent)).toStrictEqual({ dev: parent.dev, ino: parent.ino });
    await stageRollbackSource(fixture);
    expect((await journalOf(fixture)).phase).toBe("source_ready");
  });

  it("recovers in a fresh process from the persisted construction journal's directoryIdentities (P1)", async () => {
    const fixture = await createRollbackSourceFixture(homes);
    const dying = executor(fixture, (reached) => {
      if (reached === "structure_made") throw new Killed(reached);
    });
    await expect(stageRollbackSource(fixture, dying)).rejects.toBeInstanceOf(Killed);
    await executor(fixture).compensate(fixture.plan, fixture.construction, await readConstructionJournal(fixture.root, fixture.construction));
    expect((await journalOf(fixture)).phase).toBe("rolled_back");
    expect(await nodeFs.readdir(rollbackPayloadSourcePaths(fixture.root, ROLLBACK_PAYLOAD_ID).parent)).toStrictEqual([]);
  });

  it("refuses a swapped source parent inode before staging and on recovery, exit 6 (P1)", async () => {
    const fixture = await createRollbackSourceFixture(homes);
    const parent = rollbackPayloadSourcePaths(fixture.root, ROLLBACK_PAYLOAD_ID).parent;
    const dying = executor(fixture, (reached) => {
      if (reached === "journal_rewritten") throw new Killed(reached);
    });
    await expect(stageRollbackSource(fixture, dying)).rejects.toBeInstanceOf(Killed);
    await nodeFs.rmdir(parent);
    await nodeFs.mkdir(parent, { mode: 0o700 });
    const journal = await readConstructionJournal(fixture.root, fixture.construction);
    await expect(executor(fixture).compensate(fixture.plan, fixture.construction, journal)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect((await journalOf(fixture)).phase).toBe("structure_staging");

    const fresh = await createRollbackSourceFixture(homes);
    const freshParent = rollbackPayloadSourcePaths(fresh.root, ROLLBACK_PAYLOAD_ID).parent;
    await nodeFs.rmdir(freshParent);
    await nodeFs.mkdir(freshParent, { mode: 0o700 });
    await expect(stageRollbackSource(fresh)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await nodeFs.readdir(freshParent)).toStrictEqual([]);
    expect((await journalOf(fresh)).phase).toBe("planned");
  });

  it("refuses a construction authority whose entries no longer project to the source plan", async () => {
    const fixture = await createRollbackSourceFixture(homes);
    const changed = withEntry(fixture, 3, (entry) => ({ ...entry, bytes: entry.bytes + 1 }));
    await expect(executor(fixture).prepare(fixture.plan, changed, fixture.constructionJournal, { inversePlan: fixture.payload.inversePlanBytes, inventory: fixture.payload.inventoryBytes })).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(rollbackPayloadSourcePaths(fixture.root, ROLLBACK_PAYLOAD_ID).envelope)).toBe(false);
  });

  it("refuses documents that are not the plan's bound inverse plan and inventory", async () => {
    const fixture = await createRollbackSourceFixture(homes);
    const tampered = new TextEncoder().encode(`${new TextDecoder().decode(fixture.payload.inventoryBytes)} `);
    await expect(executor(fixture).prepare(fixture.plan, fixture.construction, fixture.constructionJournal, { inversePlan: fixture.payload.inversePlanBytes, inventory: tampered })).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("refuses a guarded preimage that changed after planning, before writing its entry", async () => {
    const fixture = await createRollbackSourceFixture(homes);
    const staging = executor(fixture);
    await staging.prepare(fixture.plan, fixture.construction, fixture.constructionJournal, { inversePlan: fixture.payload.inversePlanBytes, inventory: fixture.payload.inventoryBytes });
    await nodeFs.writeFile(fixture.preimagePath, "edited after planning\n");
    await expect(staging.consume(fixture.plan, fixture.construction, 1, fixture.frame)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    const journal = await journalOf(fixture);
    expect(journal.nextEntry).toBe(0);
    expect(journal.entryWriteState).toBeNull();
  });

  it("refuses a frame consumer that is not the next planner-output ordinal", async () => {
    const fixture = await createRollbackSourceFixture(homes);
    const staging = executor(fixture);
    await staging.prepare(fixture.plan, fixture.construction, fixture.constructionJournal, { inversePlan: fixture.payload.inversePlanBytes, inventory: fixture.payload.inventoryBytes });
    await expect(staging.consume(fixture.plan, fixture.construction, 0, fixture.frame)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    await expect(staging.finish(fixture.plan, fixture.construction, fixture.constructionJournal)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("refuses a second staging walk once the journal left its initial state", async () => {
    const fixture = await createRollbackSourceFixture(homes);
    await stageRollbackSource(fixture);
    await expect(stageRollbackSource(fixture)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it.each(ROLLBACK_SOURCE_DEATH_POINTS.filter((point) => point !== "compensation_step" && point !== "compaction_step" && point !== "ready_removed"))("compensates every reached byte after death at %s", async (point) => {
    const fixture = await createRollbackSourceFixture(homes);
    const dying = executor(fixture, (reached) => {
      if (reached === point) throw new Killed(point);
    });
    await expect(stageRollbackSource(fixture, dying)).rejects.toBeInstanceOf(Killed);

    await executor(fixture).compensate(fixture.plan, fixture.construction, fixture.constructionJournal);
    const journal = await journalOf(fixture);
    expect(journal.phase).toBe("rolled_back");
    const paths = rollbackPayloadSourcePaths(fixture.root, ROLLBACK_PAYLOAD_ID);
    expect(await exists(paths.envelope)).toBe(false);
    expect(await exists(paths.ready)).toBe(false);
    expect(await nodeFs.readdir(paths.parent)).toStrictEqual([]);
  });

  it("resumes compensation that itself died, from its durable cursor", async () => {
    const fixture = await createRollbackSourceFixture(homes);
    await stageRollbackSource(fixture);
    let deaths = 0;
    const dying = executor(fixture, (reached) => {
      if (reached === "compensation_step" && deaths < 3) {
        deaths += 1;
        throw new Killed(reached);
      }
    });
    for (let attempt = 0; attempt < 3; attempt += 1) await expect(dying.compensate(fixture.plan, fixture.construction, fixture.constructionJournal)).rejects.toBeInstanceOf(Killed);
    await executor(fixture).compensate(fixture.plan, fixture.construction, await readConstructionJournal(fixture.root, fixture.construction));
    expect((await journalOf(fixture)).phase).toBe("rolled_back");
    expect(await exists(rollbackPayloadSourcePaths(fixture.root, ROLLBACK_PAYLOAD_ID).envelope)).toBe(false);
  });

  it("compacts a ready source in its exact flattened order and survives death between steps", async () => {
    const fixture = await createRollbackSourceFixture(homes);
    await stageRollbackSource(fixture);
    let deaths = 0;
    const dying = executor(fixture, (reached) => {
      if (reached === "compaction_step" && deaths < 5) {
        deaths += 1;
        throw new Killed(reached);
      }
    });
    for (let attempt = 0; attempt < 5; attempt += 1) await expect(dying.compact(fixture.plan)).rejects.toBeInstanceOf(Killed);
    await executor(fixture).compact(fixture.plan);
    const journal = await journalOf(fixture);
    expect(journal).toMatchObject({ phase: "compacting", compactionNext: 2 * fixture.plan.entryCount + 10 });
    const paths = rollbackPayloadSourcePaths(fixture.root, ROLLBACK_PAYLOAD_ID);
    expect(await exists(paths.envelope)).toBe(false);
    expect(await exists(paths.ready)).toBe(false);
  });

  it("preserves an unrecorded entry at the crash frontier as recovery-required", async () => {
    const fixture = await createRollbackSourceFixture(homes);
    const dying = executor(fixture, (reached) => {
      if (reached === "entry_created") throw new Killed(reached);
    });
    await expect(stageRollbackSource(fixture, dying)).rejects.toBeInstanceOf(Killed);
    const journal = await journalOf(fixture);
    const created = journal.entryWriteState;
    if (created?.state !== "entry_created") throw new Error("expected a recorded entry");
    const target = rollbackSourceEntryPath(fixture.plan, fixture.payload.inventory.entries[created.ordinal] as RollbackPayloadEntryV1);
    // An identity swap: the recorded inode is gone and another file sits at the path.
    await nodeFs.rm(target);
    await nodeFs.writeFile(target, "swapped\n", { mode: 0o600 });
    await expect(executor(fixture).compensate(fixture.plan, fixture.construction, fixture.constructionJournal)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(target)).toBe(true);
  });
});
