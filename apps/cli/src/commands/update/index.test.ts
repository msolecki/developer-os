import { EXIT_CODES } from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import { renderPath } from "../../context.js";
import type { UpdateApplyPortsV1 } from "../../update/apply.js";
import { planRollback, planUpdate, UpdatePlanningRefusal } from "../../update/planning.js";
import { createUpdateFixture, FILE_A_PATH, unreachableUpdateContext } from "../../update/testing.js";
import { createCommandFixture, removeCommandFixtures } from "../testing.js";
import { parseUpdateArgv, renderUpdate, runUpdate } from "./index.js";

afterEach(removeCommandFixtures);

/** Every spelling Spec 2 §7.1 names as refused, plus the near misses a lenient parser admits. */
const illegalUpdateArgv: readonly (readonly string[])[] = [
  ["update", "1.2.3"],
  ["update", "--version"],
  ["update", "--version=1.2.3"],
  ["update", "--version", "v1.2.3"],
  ["update", "--version", "1.2"],
  ["update", "--version", "01.2.3"],
  ["update", "--version", "1.2.3-rc.1"],
  ["update", "--version", "1.2.3+build.5"],
  ["update", "--version", "1.2.3", "--version", "1.2.3"],
  ["update", "--apply", "--apply"],
  ["update", "--json", "--json"],
  ["update", "--dry-run"],
  ["update", "--yes"],
  ["update", "--channel", "beta"],
  ["update", "--url", "https://releases.example/x"],
  ["update", "--origin", "https://releases.example"],
  ["update", "--allow-downgrade"],
  ["update", "--local-release", "/x"],
  ["update", "-v"],
  ["update", "rollback", "--version", "1.2.3"],
  ["update", "rollback", "rollback"],
  ["update", "rollback", "extra"],
  ["update", "rollback", "--dry-run"],
  ["update", "status"],
];

describe("parseUpdateArgv", () => {
  it.each([
    [["update"], { kind: "update", version: null, apply: false, json: false }],
    [["update", "--json"], { kind: "update", version: null, apply: false, json: true }],
    [["update", "--version", "1.2.3", "--json"], { kind: "update", version: "1.2.3", apply: false, json: true }],
    [["update", "--apply", "--version", "10.0.0"], { kind: "update", version: "10.0.0", apply: true, json: false }],
    [["update", "rollback"], { kind: "rollback", apply: false, json: false }],
    [["update", "rollback", "--apply", "--json"], { kind: "rollback", apply: true, json: true }],
    [["update", "--json", "rollback"], { kind: "rollback", apply: false, json: true }],
  ])("accepts %j", (argv, expected) => {
    expect(parseUpdateArgv(argv)).toStrictEqual(expected);
  });

  it.each(illegalUpdateArgv.map((argv) => [argv] as const))("refuses %j", (argv) => {
    expect(parseUpdateArgv(argv)).toBeNull();
  });
});

describe("runUpdate", () => {
  it("refuses --apply as unavailable before any update port is reached", async () => {
    const fixture = await createCommandFixture("update-apply");
    const context = { ...fixture.context, update: unreachableUpdateContext() };

    for (const invocation of [
      { kind: "update", version: null, apply: true, json: false },
      { kind: "rollback", apply: true, json: false },
    ] as const) {
      const result = await runUpdate(context, invocation);
      expect(result.ok).toBe(false);
      expect(result.code).toBe(EXIT_CODES.capabilityUnavailable);
      if (!result.ok) expect(result.error.kind).toBe("update_apply_unavailable");
    }
  });

  it("keeps rollback --apply unavailable when the apply ports bind no rollback derivation", async () => {
    const fixture = await createCommandFixture("update-rollback-apply");
    const context = { ...fixture.context, update: { ...unreachableUpdateContext(), apply: unreachableApplyPorts() } };
    const result = await runUpdate(context, { kind: "rollback", apply: true, json: false });

    expect(result.ok).toBe(false);
    expect(result.code).toBe(EXIT_CODES.capabilityUnavailable);
    if (!result.ok) expect(result.error.kind).toBe("update_apply_unavailable");
  });

  it("recovers update residue under the lock before planning an apply, and applies nothing when up to date", async () => {
    const commandFixture = await createCommandFixture("update-apply-current");
    const update = createUpdateFixture({ latestVersion: "1.0.0" });
    const calls: string[] = [];
    const apply: UpdateApplyPortsV1 = {
      ...unreachableApplyPorts(),
      withGlobalLock: async (work) => {
        calls.push("lock");
        return work();
      },
      closure: () => {
        calls.push("closure");
        return Promise.resolve({ kind: "clear" });
      },
    };
    const result = await runUpdate({ ...commandFixture.context, update: { ...update.update, apply } }, { kind: "update", version: null, apply: true, json: false });

    expect(result.ok && result.data.outcome).toBe("up_to_date");
    expect(calls).toStrictEqual(["lock", "closure"]);
    expect(update.events.indexOf("home")).toBeGreaterThan(-1);
  });

  it("recovers residue, previews locally, and revalidates under the lock before reserving, with no network or planner", async () => {
    const commandFixture = await createCommandFixture("update-rollback-apply-compensated");
    const update = createUpdateFixture({ active: "1.1.0", rollbackPrevious: "1.0.0" });
    const calls: string[] = [];
    const apply: UpdateApplyPortsV1 = {
      ...unreachableApplyPorts(),
      withGlobalLock: async (work) => {
        calls.push("lock");
        return work();
      },
      closure: () => {
        calls.push("closure");
        return Promise.resolve({ kind: "clear" });
      },
      allocate: () => {
        calls.push("allocate");
        return Promise.reject(new UpdatePlanningRefusal("update_allocator_unavailable", EXIT_CODES.operationalFailure));
      },
      composeRollback: () => Promise.reject(new Error("unreachable")),
    };
    const result = await runUpdate({ ...commandFixture.context, update: { ...update.update, apply } }, { kind: "rollback", apply: true, json: false });

    expect(result.ok).toBe(false);
    expect(result.code).toBe(EXIT_CODES.operationalFailure);
    if (!result.ok) expect(result.error.message).toBe("update_allocator_unavailable");
    expect(calls).toStrictEqual(["lock", "closure", "lock", "closure", "allocate"]);
    expect(update.requests).toStrictEqual([]);
    expect(update.events).not.toContain("planner");
    expect(update.events).not.toContain("trust");
  });

  it("refuses a post-update edit at rollback --apply as a decision before any reservation", async () => {
    const commandFixture = await createCommandFixture("update-rollback-apply-edit");
    const update = createUpdateFixture({
      active: "1.1.0",
      rollbackPrevious: "1.0.0",
      rollbackEvidenceFailure: new UpdatePlanningRefusal("update_rollback_post_update_edit", EXIT_CODES.decisionRequired, [FILE_A_PATH]),
    });
    const apply: UpdateApplyPortsV1 = {
      ...unreachableApplyPorts(),
      withGlobalLock: (work) => work(),
      closure: () => Promise.resolve({ kind: "clear" }),
      composeRollback: () => Promise.reject(new Error("unreachable")),
    };
    const result = await runUpdate({ ...commandFixture.context, update: { ...update.update, apply } }, { kind: "rollback", apply: true, json: false });

    expect(result.ok).toBe(false);
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
    if (!result.ok) expect(result.error.paths).toStrictEqual([FILE_A_PATH]);
  });

  it("returns the plan-only arms through the injected ports", async () => {
    const commandFixture = await createCommandFixture("update-run");
    const update = createUpdateFixture({ active: "1.1.0", rollbackPrevious: "1.0.0", releases: [{ version: "1.0.0", sequence: "1" }, { version: "1.1.0", sequence: "2" }, { version: "1.2.0", sequence: "3" }] });
    const context = { ...commandFixture.context, update: update.update };

    const previewed = await runUpdate(context, { kind: "update", version: null, apply: false, json: false });
    const rolledBack = await runUpdate(context, { kind: "rollback", apply: false, json: false });
    expect(previewed.ok && previewed.data.outcome).toBe("preview");
    expect(rolledBack.ok && rolledBack.data.outcome).toBe("rollback_preview");
  });

  it("publishes a planning refusal with its own exit code, reason, and paths", async () => {
    const commandFixture = await createCommandFixture("update-refusal");
    const update = createUpdateFixture();
    const refusing = {
      ...update.update,
      readHome: () => Promise.reject(new UpdatePlanningRefusal("update_managed_drift", EXIT_CODES.decisionRequired, [FILE_A_PATH], "developer-os doctor")),
    };
    const result = await runUpdate({ ...commandFixture.context, update: refusing }, { kind: "update", version: null, apply: false, json: false });

    expect(result.ok).toBe(false);
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
    if (result.ok) return;
    expect(result.error.message).toBe("update_managed_drift");
    expect(result.error.paths).toStrictEqual([FILE_A_PATH]);
    expect(update.requests).toStrictEqual([]);
  });
});

/** Apply ports that fail loudly: a test that reaches one proves the routing is wrong. */
function unreachableApplyPorts(): UpdateApplyPortsV1 {
  const never = (): never => {
    throw new Error("an apply port was reached");
  };
  return {
    withGlobalLock: never,
    closure: never,
    allocate: never,
    compose: never,
    construction: never,
    coordinator: never,
    envelope: { isEnvelopeSuffix: never, completeEnvelopeSuffix: never },
    executorCleanup: never,
  };
}

describe("renderUpdate", () => {
  it("renders every changed path of the typed preview through renderPath and prints no private hash", async () => {
    const fixture = createUpdateFixture();
    const planned = await planUpdate(fixture.update, { version: null });
    if (planned.result.outcome !== "preview" || planned.candidate === null) throw new Error("expected a preview");
    const lines = renderUpdate(planned.result);
    const text = lines.join("\n");

    expect(lines[0]).toBe("Update 1.0.0 -> 1.1.0 (preview: nothing was changed)");
    for (const owner of planned.result.plan.owners) {
      for (const path of [...owner.paths.create, ...owner.paths.replace, ...owner.paths.remove]) {
        expect(text).toContain(renderPath(path));
      }
    }
    expect(text).toContain(planned.result.plan.previewHash);
    expect(text).not.toContain(planned.candidate.transcriptIdentity.requestHash);
    expect(text).not.toContain(planned.candidate.materialization.inventoryEntriesHash);
  });

  it("renders up_to_date and rollback previews from the same result JSON carries", async () => {
    const upToDate = createUpdateFixture({ latestVersion: "1.0.0" });
    const current = await planUpdate(upToDate.update, { version: null });
    expect(renderUpdate(current.result)).toStrictEqual(["Developer OS 1.0.0 is up to date."]);

    const rollback = createUpdateFixture({ active: "1.1.0", rollbackPrevious: "1.0.0" });
    const plan = await planRollback(rollback.update);
    const lines = renderUpdate({ schemaVersion: 1, outcome: "rollback_preview", plan });
    expect(lines[0]).toBe("Rollback 1.1.0 -> 1.0.0 (preview: nothing was changed)");
    expect(lines.join("\n")).toContain(renderPath(FILE_A_PATH));
  });
});
