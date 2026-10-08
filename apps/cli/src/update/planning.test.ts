import { createHash } from "node:crypto";

import { codexRegistrationProjectionHash, decodeCanonicalJson, decodeRetainedInverseLeaf, EXIT_CODES, validateRetainedOwnerInverseProjection, validateRetainedSchemaMigrationInverseProjection } from "@developer-os/core";
import { SecurityRefusalError } from "@developer-os/security";
import { describe, expect, it } from "vitest";

import { codexVersionToken } from "./codex-effect-ports.js";
import {
  planRollback,
  planUpdate,
  prepareUpdate,
  UpdatePlanningRefusal,
  validateRollbackRecord,
} from "./planning.js";
import type { PlannedUpdateV1 } from "./planning.js";
import {
  createUpdateFixture,
  DIRECTORY_PATH,
  FILE_A_PATH,
  FILE_B_PATH,
  SYNTHETIC_EVIDENCE,
  syntheticInstructionRow,
} from "./testing.js";
import type { UpdateFixtureOptions } from "./testing.js";

async function preview(options: UpdateFixtureOptions = {}, version: string | null = null): Promise<PlannedUpdateV1> {
  const fixture = createUpdateFixture(options);
  return planUpdate(fixture.update, { version: version as never });
}

async function refusal(work: Promise<unknown>): Promise<{ readonly reason: string; readonly code: number }> {
  try {
    await work;
  } catch (error) {
    if (error instanceof UpdatePlanningRefusal) return { reason: error.reason, code: error.code };
    if (error instanceof SecurityRefusalError) return { reason: "security_refusal", code: error.code };
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("planUpdate", () => {
  it("refuses an unsigned-local home right after the home gate, before the keg is read (NEW-147)", async () => {
    const fixture = createUpdateFixture();
    const update = {
      ...fixture.update,
      readHome: async () => {
        const home = await fixture.update.readHome();
        return { ...home, trust: { ...home.trust, trust: "unsigned-local" as const } };
      },
    };

    await expect(planUpdate(update, { version: null })).rejects.toMatchObject({
      reason: "release_unsigned_local",
      code: EXIT_CODES.capabilityUnavailable,
    });
    expect(fixture.events).toStrictEqual(["home"]);
  });

  it("refuses a home whose trust state is not the package channel, before the keg is read", async () => {
    const fixture = createUpdateFixture();
    const update = {
      ...fixture.update,
      readHome: async () => {
        const home = await fixture.update.readHome();
        // The signed state of the withdrawn root-key design: no `trust` member at all.
        const signed = Object.fromEntries(Object.entries(home.trust).filter(([key]) => key !== "trust")) as unknown as typeof home.trust;
        return { ...home, trust: signed };
      },
    };
    expect(await refusal(planUpdate(update, { version: null }))).toStrictEqual({ reason: "update_trust_channel", code: EXIT_CODES.recoveryRequired });
    expect(fixture.events).toStrictEqual(["home"]);
  });

  it("previews the selected packaged release without returning private evidence", async () => {
    const fixture = createUpdateFixture();
    const planned = await planUpdate(fixture.update, { version: null });

    expect(planned.result.outcome).toBe("preview");
    if (planned.result.outcome !== "preview" || planned.candidate === null) throw new Error("expected a preview");
    const { plan } = planned.result;
    expect(plan.current.version).toBe("1.0.0");
    expect(plan.target.version).toBe("1.1.0");
    expect(plan.metadata.releaseIndexSequence).toBe("2");
    expect(plan.metadata.delegationSequence).toBe("0");
    expect(plan.owners).toStrictEqual([{
      owner: "core",
      counts: { create: 0, replace: 2, remove: 0, unchanged: 1, externalEffects: 0 },
      paths: { create: [], replace: [FILE_A_PATH, FILE_B_PATH], remove: [], unchanged: [DIRECTORY_PATH] },
    }]);
    expect(plan.migrations).toStrictEqual([]);
    expect(plan.retainedRollback).toBeNull();
    expect(plan.capacity.fits).toBe(true);

    const published = JSON.stringify(planned.result);
    for (const privateHash of [
      planned.candidate.transcriptIdentity.requestHash,
      planned.candidate.transcriptIdentity.resultHash,
      planned.candidate.materialization.inventoryEntriesHash,
      planned.candidate.materialization.inversePlanProjectionHash,
    ]) {
      expect(published).not.toContain(privateHash);
    }
  });

  it("gates the home first, then reads the keg once", async () => {
    const fixture = createUpdateFixture();
    await planUpdate(fixture.update, { version: null });

    expect(fixture.events).toStrictEqual(["home", "package_source", "snapshot", "planner", "capacity"]);
  });

  it("selects an explicitly requested stable version when it is the installed keg", async () => {
    const planned = await preview(
      { releases: [{ version: "1.0.0", sequence: "1" }, { version: "1.1.0", sequence: "2" }, { version: "1.2.0", sequence: "3" }], kegVersion: "1.1.0" },
      "1.1.0",
    );
    expect(planned.result.outcome === "preview" ? planned.result.plan.target.version : null).toBe("1.1.0");
  });

  it("carries an attached instruction row unchanged, its stamp included; the refresh restamps it (NEW-171, C1 reverses K7 (f))", async () => {
    const fixture = createUpdateFixture({ manifestRows: [syntheticInstructionRow()] });
    const prepared = await prepareUpdate(fixture.update, { version: "1.1.0" as never });
    const row = prepared.apply?.materialized.manifest.artifacts.find((artifact) => artifact.kind === "instruction");
    expect(row).toStrictEqual(syntheticInstructionRow());
    expect(fixture.plannerRequests[0]?.manifest.artifacts.some((artifact) => (artifact as { kind: string }).kind === "instruction")).toBe(false);
  });

  it("returns an identical preview for a repeated run over the same keg", async () => {
    const fixture = createUpdateFixture();
    const first = await planUpdate(fixture.update, { version: null });
    const second = await planUpdate(fixture.update, { version: null });
    if (first.result.outcome !== "preview" || second.result.outcome !== "preview") throw new Error("expected previews");
    expect(second.result.plan).toStrictEqual(first.result.plan);
  });

  it("orders owner paths canonically whatever order the planner proposed them in", async () => {
    const forward = await preview();
    const reversed = await preview({ reversedOperations: true });
    if (forward.result.outcome !== "preview" || reversed.result.outcome !== "preview") throw new Error("expected previews");
    expect(reversed.result.plan.owners).toStrictEqual(forward.result.plan.owners);
    expect(reversed.result.plan.capacity).toStrictEqual(forward.result.plan.capacity);
  });

  it("returns up_to_date with no planner run when the keg is the active release", async () => {
    const fixture = createUpdateFixture({ releases: [{ version: "1.0.0", sequence: "1" }] });
    const planned = await planUpdate(fixture.update, { version: null });

    expect(planned.result).toStrictEqual({ schemaVersion: 1, outcome: "up_to_date", active: fixture.current });
    expect(planned.candidate).toBeNull();
    expect(fixture.events).toStrictEqual(["home", "package_source"]);
  });

  it("returns up_to_date after a rollback, when the trust watermark is above the active release (W2-PLANNING-2)", async () => {
    const fixture = createUpdateFixture({ releases: [{ version: "1.0.0", sequence: "1" }, { version: "1.1.0", sequence: "2" }], kegVersion: "1.0.0" });
    const update = {
      ...fixture.update,
      readHome: async () => {
        const home = await fixture.update.readHome();
        return { ...home, trust: { ...home.trust, highestAcceptedReleaseSequence: "2", releaseIdentityHash: createHash("sha256").update("rolled-back-from").digest("hex") } as typeof home.trust };
      },
    };
    const planned = await planUpdate(update, { version: "1.0.0" as never });

    expect(planned.result).toStrictEqual({ schemaVersion: 1, outcome: "up_to_date", active: fixture.current });
  });

  it("refuses up_to_date over metadata older than the trust watermark", async () => {
    const fixture = createUpdateFixture({ releases: [{ version: "1.0.0", sequence: "1" }], trustSequence: "3" });
    expect(await refusal(planUpdate(fixture.update, { version: null }))).toStrictEqual({ reason: "update_trust_replay", code: EXIT_CODES.securityRefusal });
  });

  it.each([
    ["a version the keg does not carry", { }, "9.9.9", "update_release_not_found", EXIT_CODES.invalidInput],
    ["a downgrade", { active: "1.1.0", kegVersion: "1.0.0" }, "1.0.0", "update_downgrade_refused", EXIT_CODES.invalidInput],
  ] as const)("refuses %s before any planner run", async (_name, options, version, reason, code) => {
    const fixture = createUpdateFixture(options);
    expect(await refusal(planUpdate(fixture.update, { version: version as never }))).toStrictEqual({ reason, code });
    expect(fixture.events).not.toContain("planner");
  });

  it("refuses a keg whose retained delegation is not the package-channel stand-in, exit 6", async () => {
    const fixture = createUpdateFixture({ substitutedDelegation: new TextEncoder().encode("{\"schemaVersion\":1,\"trust\":\"unsigned-local\"}\n") });
    expect(await refusal(planUpdate(fixture.update, { version: null }))).toStrictEqual({ reason: "update_package_source_invalid", code: EXIT_CODES.recoveryRequired });
    expect(fixture.events).not.toContain("planner");
  });

  it("refuses a keg whose retained bundle manifest is not a bundle manifest, exit 6", async () => {
    const fixture = createUpdateFixture({ substitutedManifest: new TextEncoder().encode("{}\n") });
    expect(await refusal(planUpdate(fixture.update, { version: null }))).toStrictEqual({ reason: "update_package_source_invalid", code: EXIT_CODES.recoveryRequired });
    expect(fixture.events).not.toContain("planner");
  });

  it("refuses metadata older than the stored trust watermark", async () => {
    const fixture = createUpdateFixture({ trustSequence: "3" });
    expect(await refusal(planUpdate(fixture.update, { version: null }))).toStrictEqual({ reason: "update_trust_replay", code: EXIT_CODES.securityRefusal });
  });

  it.each([
    ["a newer launcher protocol", { minimumLauncherProtocol: 2 }, "update_launcher_too_old"],
    ["a newer update protocol", { updateProtocol: 2 }, "update_protocol_too_new"],
  ] as const)("refuses a target requiring %s as capability unavailable", async (_name, target, reason) => {
    const fixture = createUpdateFixture({ releases: [{ version: "1.0.0", sequence: "1" }, { version: "1.1.0", sequence: "2", ...target }] });
    expect(await refusal(planUpdate(fixture.update, { version: null }))).toStrictEqual({ reason, code: EXIT_CODES.capabilityUnavailable });
  });

  it("surfaces the planner's refusal and its exit code unchanged, with no scratch to clean (W2-PLANNING-4)", async () => {
    const failure = new SecurityRefusalError("Planner frame failed the secret screen");
    const fixture = createUpdateFixture({ plannerFailure: failure });
    const error: unknown = await planUpdate(fixture.update, { version: null }).then(() => null, (caught: unknown) => caught);

    expect(error).toBe(failure);
    expect((error as SecurityRefusalError).code).toBe(EXIT_CODES.securityRefusal);
    expect(fixture.events.at(-1)).toBe("planner");
  });

  it("refuses insufficient capacity without a preview", async () => {
    const fixture = createUpdateFixture({
      capacity: { availableBytes: "1" as never, availableEntries: "10000000" as never, reservationGranularityBytes: "4096" as never },
    });
    expect(await refusal(planUpdate(fixture.update, { version: null }))).toStrictEqual({
      reason: "update_capacity_insufficient_bytes",
      code: EXIT_CODES.operationalFailure,
    });
    expect(fixture.events.at(-1)).toBe("capacity");
  });

  it("names the retained rollback release when one exists", async () => {
    const fixture = createUpdateFixture({
      releases: [{ version: "1.0.0", sequence: "1" }, { version: "1.1.0", sequence: "2" }, { version: "1.2.0", sequence: "3" }],
      active: "1.1.0",
      rollbackPrevious: "1.0.0",
    });
    const planned = await planUpdate(fixture.update, { version: null });
    expect(fixture.releases.get("1.2.0")?.manifestHash).toBe(planned.result.outcome === "preview" ? planned.result.plan.target.bundleManifestHash : null);
    if (planned.result.outcome !== "preview") throw new Error("expected a preview");
    expect(planned.result.plan.retainedRollback?.release.version).toBe("1.0.0");
    expect(planned.result.plan.retainedRollback?.payload.entryCount).toBe(3);
  });

  it("retains the target plugin version as the post-update projection (F8, NEW-118 (3))", async () => {
    const fixture = createUpdateFixture({ codex: { registration: "registered" } });
    const prepared = await prepareUpdate(fixture.update, { version: "1.1.0" as never });
    const leaves = (prepared.candidate?.materialization.inversePlanProjections ?? []).map((leaf) => decodeRetainedInverseLeaf(leaf.kind, new TextEncoder().encode(leaf.projection.endsWith("\n") ? leaf.projection : `${leaf.projection}\n`)));
    const codex = leaves.flatMap((leaf) => (leaf.kind === "owner_inverse" && leaf.owner === "codex" ? [leaf] : []))[0];
    const effect = codex?.externalEffects[0];
    if (effect === undefined) throw new Error("expected a Codex effect leaf");
    expect(effect.expectedCurrentStateHash).toBe(codexRegistrationProjectionHash({ ...fixture.codexProjection, version: codexVersionToken("1.1.0") }));
    expect(effect.restoreStateHash).toBe(codexRegistrationProjectionHash(fixture.codexProjection));
  });

  it("prepares one owner leaf and a preimage blob per changed file", async () => {
    const planned = await preview();
    const materialization = planned.candidate?.materialization;
    if (materialization === undefined) throw new Error("expected a candidate");

    expect(materialization.rollbackInventoryEntries.map((entry) => [entry.role, entry.path])).toStrictEqual([
      ["owner_preimage", "blobs/0000000000.bin"],
      ["owner_preimage", "blobs/0000000001.bin"],
      ["inverse_plan_leaf", "plans/owner_inverse/owner_core.plan.json"],
    ]);
    const [leaf] = materialization.inversePlanProjections;
    if (leaf === undefined) throw new Error("expected a leaf");
    const parsed = validateRetainedOwnerInverseProjection(decodeCanonicalJson(new TextEncoder().encode(leaf.projection), 16_777_216));
    expect(parsed.operations.map((operation) => [operation.path, operation.expectedCurrent.state, operation.restore.state])).toStrictEqual([
      [FILE_A_PATH, "file", "file"],
      [FILE_B_PATH, "file", "file"],
    ]);
    expect(parsed.operations.map((operation) => operation.path)).not.toContain(DIRECTORY_PATH);
    expect(parsed.externalEffects).toStrictEqual([]);
  });

  it("keeps the delegation, release index and bundle manifest byte-equal to what the keg retains", async () => {
    const fixture = createUpdateFixture();
    const planned = await prepareUpdate(fixture.update, { version: null });
    if (planned.apply === null) throw new Error("expected a prepared apply");
    const { target } = planned.apply.inputs;
    const [delegation, index, manifest] = planned.apply.materialized.signedMetadata;
    const hash = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

    expect([hash(delegation), hash(index), hash(manifest)]).toStrictEqual([target.delegationHash, target.releaseIndexHash, target.bundleManifestHash]);
    expect(manifest).toBe(new TextDecoder().decode(fixture.releases.get("1.1.0")?.manifestBytes));
  });
});

describe("planning from the package channel (D84 K2, K4 F7)", () => {
  it("(a) previews the keg as packageSource", async () => {
    const fixture = createUpdateFixture();
    const result = await planUpdate(fixture.update, { version: null });
    expect(result.result).toMatchObject({ outcome: "preview", plan: { packageSource: { kegPath: fixture.kegPath, bundleManifestHash: fixture.releases.get("1.1.0")?.manifestHash } } });
    expect(result.result.outcome === "preview" && "download" in result.result.plan).toBe(false);
  });

  it("(b) refuses a keg below the trust watermark as a downgrade", async () => {
    const fixture = createUpdateFixture({ kegVersion: "0.9.0", kegSequence: "1" });
    await expect(planUpdate(fixture.update, { version: null })).rejects.toMatchObject({ reason: "update_downgrade_refused", code: EXIT_CODES.invalidInput });
  });

  it("(e) refuses the active version rebuilt with other bytes as a rebound, never up_to_date", async () => {
    const fixture = createUpdateFixture({ kegVersion: "1.0.0", kegSequence: "1", rebuilt: true });
    await expect(planUpdate(fixture.update, { version: null })).rejects.toMatchObject({ reason: "update_release_identity_rebound", code: EXIT_CODES.securityRefusal });
  });

  it("(f) refuses an absent keg as exit 4 before any write", async () => {
    const fixture = createUpdateFixture({ kegAbsent: true });
    await expect(planUpdate(fixture.update, { version: null })).rejects.toMatchObject({ code: EXIT_CODES.capabilityUnavailable, message: "update_package_source_absent" });
  });
});

describe("planRollback", () => {
  const rollbackOptions: UpdateFixtureOptions = { active: "1.1.0", rollbackPrevious: "1.0.0" };

  it("previews the retained release from local evidence only", async () => {
    const fixture = createUpdateFixture(rollbackOptions);
    const plan = await planRollback(fixture.update);

    expect(plan.operation).toBe("rollback");
    expect(plan.current.version).toBe("1.1.0");
    expect(plan.target.version).toBe("1.0.0");
    expect(plan.consumesRollbackRecord).toBe(true);
    expect(plan.owners[0]?.paths.replace).toStrictEqual([FILE_A_PATH, FILE_B_PATH]);
    expect(fixture.events).toStrictEqual(["home", "rollback.evidence", "capacity"]);
    expect(fixture.events).not.toContain("package_source");
  });

  it("is deterministic for the same retained evidence", async () => {
    const fixture = createUpdateFixture(rollbackOptions);
    expect((await planRollback(fixture.update)).previewHash).toBe((await planRollback(fixture.update)).previewHash);
  });

  it("refuses when no rollback is retained", async () => {
    const fixture = createUpdateFixture();
    expect(await refusal(planRollback(fixture.update))).toStrictEqual({ reason: "update_rollback_unavailable", code: EXIT_CODES.capabilityUnavailable });
  });

  it("refuses a record that does not describe the active release", async () => {
    const fixture = createUpdateFixture(rollbackOptions);
    const record = fixture.home.rollback;
    if (record === null) throw new Error("expected a record");
    const mismatched = { ...fixture.update, readHome: () => Promise.resolve({ ...fixture.home, rollback: { ...record, installed: record.previous } }) };
    expect(await refusal(planRollback(mismatched))).toStrictEqual({ reason: "update_rollback_record_mismatch", code: EXIT_CODES.recoveryRequired });
  });

  it("surfaces a post-update edit as a decision", async () => {
    const fixture = createUpdateFixture({
      ...rollbackOptions,
      rollbackEvidenceFailure: new UpdatePlanningRefusal("update_rollback_post_update_edit", EXIT_CODES.decisionRequired, [FILE_A_PATH]),
    });
    expect(await refusal(planRollback(fixture.update))).toStrictEqual({ reason: "update_rollback_post_update_edit", code: EXIT_CODES.decisionRequired });
  });
});

describe("retained rollback codecs", () => {
  it("refuses a rollback record with an unknown key", () => {
    const fixture = createUpdateFixture({ active: "1.1.0", rollbackPrevious: "1.0.0" });
    expect(() => validateRollbackRecord({ ...fixture.home.rollback, extra: true }, SYNTHETIC_EVIDENCE)).toThrow();
    expect(validateRollbackRecord(JSON.parse(JSON.stringify(fixture.home.rollback)), SYNTHETIC_EVIDENCE)).toStrictEqual(fixture.home.rollback);
  });

  it("refuses a rollback record whose binding is not the one its fields derive (W2-ROLLBACK-2)", () => {
    const fixture = createUpdateFixture({ active: "1.1.0", rollbackPrevious: "1.0.0" });
    const forged = { ...fixture.home.rollback, rollbackBindingHash: createHash("sha256").update("forged binding").digest("hex") };
    expect(() => validateRollbackRecord(forged, SYNTHETIC_EVIDENCE)).toThrow("rollbackBindingHash");
  });

  it("refuses an owner leaf whose restore blob does not carry its restore hash", () => {
    const restoredBytes = { state: "file", mode: 384, bytes: 1, sha256: "a".repeat(64) };
    const evidence = {
      schemaVersion: 1,
      kind: "owner_inverse",
      id: "owner_core",
      owner: "core",
      operations: [{
        path: FILE_A_PATH,
        expectedCurrent: { state: "absent" },
        restore: { ...restoredBytes, payload: { chunks: [{ path: "blobs/0000000000.bin", bytes: 1, sha256: "b".repeat(64) }], aggregateBytes: 1, sha256: "a".repeat(64) } },
      }],
      externalEffects: [],
      maximumPlanBytes: 16_777_216,
    };
    expect(() => validateRetainedOwnerInverseProjection(evidence)).toThrow();
    expect(() => validateRetainedSchemaMigrationInverseProjection({ ...evidence, kind: "schema_migration_inverse" })).toThrow();
  });
});
