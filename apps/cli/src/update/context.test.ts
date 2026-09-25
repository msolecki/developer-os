import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import {
  bindRetainedInversePlan,
  encodeCanonicalJson,
  EXIT_CODES,
  parseCanonicalAbsolutePathText,
  parseStableSemver,
  plannerInputBlobRefs,
  retainedInversePlanHash,
  validateRetainedOwnerInverseProjection,
} from "@developer-os/core";
import type { CanonicalJsonValue, RollbackPayloadIdV1, UpdateRollbackPreviewV1 } from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import { runInit } from "../commands/init.js";
import {
  createCommandFixture,
  inventoryDigest,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
} from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import { createCliUpdateContext } from "./context.js";
import { releaseIdentityOf, UpdatePlanningRefusal } from "./planning.js";
import type { RollbackRecordV1 } from "./planning.js";
import { applyRollback } from "./rollback-apply.js";
import { NEW_A, OLD_A, PLANNED_AT, sha256 } from "./testing.js";

afterEach(removeCommandFixtures);

async function installed(label: string): Promise<CommandFixture> {
  const fixture = await createCommandFixture(label, { bootstrapAvailable: true });
  const initialized = await runInit(fixture.context, { dryRun: false, assumeYes: true });
  if (!initialized.ok) throw new Error("fixture init failed");
  return fixture;
}

async function refusal(work: Promise<unknown>): Promise<{ readonly reason: string; readonly code: number; readonly paths: readonly string[] }> {
  try {
    await work;
  } catch (error) {
    if (error instanceof UpdatePlanningRefusal) return { reason: error.reason, code: error.code, paths: error.paths };
    throw error;
  }
  throw new Error("expected a refusal");
}

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(encodeCanonicalJson(value as CanonicalJsonValue));
}

describe("readHome", () => {
  it("admits an initialized V2 home read-only", async () => {
    const fixture = await installed("update-home");
    const before = await inventoryDigest(fixture.root);
    const home = await createCliUpdateContext(fixture.context).readHome();

    expect(home.manifest.schemaVersion).toBe(2);
    expect(home.active.bundleRoot.startsWith(`${fixture.paths.home}/releases/`)).toBe(true);
    expect(home.rollback).toBeNull();
    expect(await inventoryDigest(fixture.root)).toEqual(before);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses managed drift as a decision and names the drifted path", async () => {
    const fixture = await installed("update-home-drift");
    const home = await createCliUpdateContext(fixture.context).readHome();
    const row = home.manifest.artifacts.find((artifact) =>
      artifact.owner === "core" && artifact.kind === "file" && artifact.verification.mode === "content");
    if (row === undefined) throw new Error("fixture installed no core content file");
    await nodeFs.writeFile(row.path, "edited after install\n");

    expect(await refusal(createCliUpdateContext(fixture.context).readHome())).toMatchObject({
      reason: "update_managed_drift",
      code: EXIT_CODES.decisionRequired,
      paths: expect.arrayContaining([row.path]) as unknown,
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an unparseable executor record the V1 ledger cannot see as recovery-required, read-only", async () => {
    const fixture = await installed("update-home-executor-third-state");
    await nodeFs.writeFile(join(fixture.paths.stateDir, "update-executor.json"), "\u0000not json");
    const before = await inventoryDigest(fixture.root);

    expect(await refusal(createCliUpdateContext(fixture.context).readHome())).toMatchObject({
      reason: "update_lifecycle_not_clear",
      code: EXIT_CODES.recoveryRequired,
    });
    expect(await inventoryDigest(fixture.root)).toEqual(before);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses when the composition root supplied no lifecycle ports", async () => {
    const fixture = await createCommandFixture("update-home-no-lifecycle");
    const context = createCliUpdateContext({ ...fixture.context, lifecycle: undefined });

    expect(await refusal(context.readHome())).toMatchObject({ reason: "update_lifecycle_unavailable", code: EXIT_CODES.capabilityUnavailable });
  });
});

describe("apply ports", () => {
  it("leaves --apply unbound in production so the command refuses before any port", async () => {
    const fixture = await createCommandFixture("update-apply-unbound");
    expect(createCliUpdateContext(fixture.context).apply).toBeUndefined();
  });

  it("leaves rollback --apply unbound in production so it refuses without reading the home", async () => {
    const fixture = await createCommandFixture("update-rollback-apply-unbound");
    const update = createCliUpdateContext(fixture.context);
    expect(update.apply?.composeRollback).toBeUndefined();
    expect(await refusal(applyRollback(update, {} as UpdateRollbackPreviewV1))).toMatchObject({ reason: "update_apply_unavailable", code: EXIT_CODES.capabilityUnavailable });
  });
});

describe("snapshot", () => {
  it("tokenizes the complete manifest in owner/path order and keeps every root off the wire", async () => {
    const fixture = await installed("update-snapshot");
    const update = createCliUpdateContext(fixture.context);
    const home = await update.readHome();
    const current = releaseIdentityOf(home.active);
    const target = { ...current, version: parseStableSemver("99.0.0"), releaseIdentityHash: sha256("synthetic other release") };
    const before = await inventoryDigest(fixture.root);

    const snapshot = await update.snapshot(home, { current, target, plannedAt: PLANNED_AT });

    const order = ["core", "claude", "codex", "macos"];
    const expected = [...home.manifest.artifacts]
      .sort((left, right) => order.indexOf(left.owner) - order.indexOf(right.owner) || Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
      .map((row) => row.path);
    expect([...snapshot.tokenPaths.values()]).toStrictEqual(expected);
    expect(snapshot.request.artifactInputs.map((input) => input.token)).toStrictEqual([...snapshot.tokenPaths.keys()]);
    expect(snapshot.inputBlobs).toHaveLength(plannerInputBlobRefs(snapshot.request).length);
    expect(snapshot.request.config.brainRoot).toBe("brain_root");
    const wire = JSON.stringify(snapshot.request);
    expect(wire).not.toContain(fixture.paths.brain);
    // The release identities name their own bundle roots by design; no other manifest path may cross.
    for (const path of expected.filter((candidate) => candidate !== current.bundleRoot)) expect(wire).not.toContain(`"${path}"`);
    expect(await inventoryDigest(fixture.root)).toEqual(before);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("readRollbackEvidence", () => {
  const payloadId = `rb_${sha256("synthetic nonce")}_3` as RollbackPayloadIdV1;
  const binding = sha256("synthetic rollback binding");
  const installedHash = sha256("synthetic installed release");
  const previousHash = sha256("synthetic previous release");

  /** A retained payload restoring one file whose current bytes are the update's postimage. */
  async function retained(fixture: CommandFixture): Promise<{ readonly record: RollbackRecordV1; readonly current: string; readonly root: string }> {
    const work = join(fixture.root, "work");
    await nodeFs.mkdir(work, { recursive: true, mode: 0o700 });
    const current = parseCanonicalAbsolutePathText(join(work, "a.json"));
    await nodeFs.writeFile(current, NEW_A, { mode: 0o600 });

    const root = join(fixture.paths.home, "rollback", payloadId);
    await nodeFs.mkdir(join(root, "blobs"), { recursive: true, mode: 0o700 });
    await nodeFs.mkdir(join(root, "plans", "owner_inverse"), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(join(root, "blobs", "0000000000.bin"), OLD_A, { mode: 0o600 });
    const blob = { path: "blobs/0000000000.bin", bytes: OLD_A.byteLength, sha256: sha256(OLD_A) };
    const projection = validateRetainedOwnerInverseProjection({
      schemaVersion: 1,
      kind: "owner_inverse",
      id: "owner_core",
      owner: "core",
      operations: [{
        path: current,
        expectedCurrent: { state: "file", mode: 384, bytes: NEW_A.byteLength, sha256: sha256(NEW_A), payload: null },
        restore: { state: "file", mode: 384, bytes: OLD_A.byteLength, sha256: sha256(OLD_A), payload: { chunks: [blob], aggregateBytes: OLD_A.byteLength, sha256: sha256(OLD_A) } },
      }],
      externalEffects: [],
      maximumPlanBytes: 16_777_216,
    });
    const leaf = bytes(projection);
    await nodeFs.writeFile(join(root, "plans", "owner_inverse", "owner_core.plan.json"), leaf, { mode: 0o600 });
    const sourcePlanHash = sha256("synthetic owner plan");
    const inversePlan = bytes({
      schemaVersion: 1,
      rollbackBindingHash: binding,
      payloadId,
      installedReleaseIdentityHash: installedHash,
      previousReleaseIdentityHash: previousHash,
      ownerPlans: [{
        kind: "owner_inverse",
        id: "owner_core",
        path: "plans/owner_inverse/owner_core.plan.json",
        sourcePlanHash,
        retainedHash: retainedInversePlanHash(bindRetainedInversePlan(projection, binding, sourcePlanHash)),
        bytes: leaf.byteLength,
      }],
      migrationPlans: [],
      exactStepListHash: sha256("synthetic rollback step list"),
      maximumBytes: 16_777_216,
    });
    await nodeFs.writeFile(join(root, "inverse-plan.json"), inversePlan, { mode: 0o600 });
    const inventory = bytes({
      schemaVersion: 1,
      payloadId,
      rollbackBindingHash: binding,
      inversePlanHash: sha256(inversePlan),
      entries: [
        { ordinal: 0, path: "blobs/0000000000.bin", role: "owner_preimage", bytes: OLD_A.byteLength, sha256: sha256(OLD_A) },
        { ordinal: 1, path: "plans/owner_inverse/owner_core.plan.json", role: "inverse_plan_leaf", bytes: leaf.byteLength, sha256: sha256(leaf) },
      ],
      aggregateBytes: OLD_A.byteLength + leaf.byteLength,
    });
    await nodeFs.writeFile(join(root, "inventory.json"), inventory, { mode: 0o600 });

    const record = {
      schemaVersion: 1,
      payloadId,
      rollbackBindingHash: binding,
      payloadInventoryHash: sha256(inventory),
      inversePlanHash: sha256(inversePlan),
      installed: { releaseIdentityHash: installedHash },
      previous: { bundleRoot: parseCanonicalAbsolutePathText(fixture.root), releaseIdentityHash: previousHash },
    } as unknown as RollbackRecordV1;
    return { record, current, root };
  }

  it("reads a hash-checked payload whose postimage is still current", async () => {
    const fixture = await createCommandFixture("update-rollback-evidence");
    const { record, current } = await retained(fixture);
    const before = await inventoryDigest(fixture.root);

    const evidence = await createCliUpdateContext(fixture.context).readRollbackEvidence(null as never, record);

    expect(evidence.payload).toStrictEqual({ payloadId, entryCount: 2, aggregateBytes: expect.any(Number) as unknown });
    expect(evidence.owners.map((owner) => owner.operations.map((operation) => operation.path))).toStrictEqual([[current]]);
    expect(await inventoryDigest(fixture.root)).toEqual(before);
  });

  it("refuses a post-update edit as a decision rather than merging", async () => {
    const fixture = await createCommandFixture("update-rollback-edited");
    const { record, current } = await retained(fixture);
    await nodeFs.writeFile(current, "edited after the update\n");

    expect(await refusal(createCliUpdateContext(fixture.context).readRollbackEvidence(null as never, record))).toStrictEqual({
      reason: "update_rollback_post_update_edit",
      code: EXIT_CODES.decisionRequired,
      paths: [current],
    });
  });

  it("treats a tampered retained blob as recovery-required", async () => {
    const fixture = await createCommandFixture("update-rollback-tampered");
    const { record, root } = await retained(fixture);
    await nodeFs.writeFile(join(root, "blobs", "0000000000.bin"), "tampered\n");

    expect(await refusal(createCliUpdateContext(fixture.context).readRollbackEvidence(null as never, record))).toMatchObject({
      reason: "update_rollback_evidence_invalid",
      code: EXIT_CODES.recoveryRequired,
    });
  });
});

describe("capacity", () => {
  it("reports both filesystem dimensions as decimal strings", async () => {
    const fixture = await createCommandFixture("update-capacity");
    await nodeFs.mkdir(fixture.paths.home, { recursive: true, mode: 0o700 });
    const observed = await createCliUpdateContext(fixture.context).capacity();

    for (const value of [observed.availableBytes, observed.availableEntries, observed.reservationGranularityBytes]) {
      expect(value).toMatch(/^(0|[1-9][0-9]*)$/u);
    }
  });
});
