import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES, parseStableSemver } from "@developer-os/core";
import { runUpdate } from "@developer-os/cli/dist/commands/update/index.js";
import { exists, removeCommandFixtures } from "@developer-os/cli/dist/commands/testing.js";
import { recoverUpdate } from "@developer-os/cli/dist/update/apply.js";
import type { CliUpdateContext } from "@developer-os/cli/dist/update/context.js";
import { planRollback } from "@developer-os/cli/dist/update/planning.js";
import type { UpdateHomeV1 } from "@developer-os/cli/dist/update/planning.js";
import { applyRollback } from "@developer-os/cli/dist/update/rollback-apply.js";
import { dieAfterMutations, installUpdatableHome, updateTo } from "@developer-os/cli/dist/update/testing.js";
import type { UpdatableHomeV1 } from "@developer-os/cli/dist/update/testing.js";

/**
 * Spec 2 §12's "update order recovers" and "rollback is conservative" rows over the real ports:
 * a real installed home, the production `--apply` ports, and a process model that dies after its
 * N-th durable guarded-filesystem mutation (the mutation lands, every later one throws). N sweeps
 * from 1 until an uninjected run completes, so every outer and nested cursor is a death point. A
 * fresh process then recovers through the V2 closure alone, and must land in exactly one of the
 * two states the persisted direction allows, with a clear closure and an admitted, drift-free home.
 *
 * A home the recovery left on the old release is reused for the next point (only trust and the
 * allocator moved, as a real retry would find them); one it carried forward is rebuilt. Identities
 * are inode-bound (P1, P8), so a home is never copied. Expect this file to take tens of minutes.
 */

const SWEEP_TIMEOUT_MS = 3_600_000;
const CASE_TIMEOUT_MS = 900_000;
const MAXIMUM_DEATH_POINTS = 5_000;

afterEach(removeCommandFixtures);

function bundleRoot(home: UpdatableHomeV1, version: string): string {
  return join(home.fixture.paths.home, "releases", version, `darwin-${home.world.architecture}`);
}

/** The fresh process's view: the closure is clear and the home admits with zero drift. */
async function settled(home: UpdatableHomeV1): Promise<UpdateHomeV1> {
  const update = home.update();
  const ports = update.apply;
  if (ports === undefined) throw new Error("the on-disk context binds the apply ports");
  expect((await ports.withGlobalLock(() => ports.closure())).kind).toBe("clear");
  expect(await nodeFs.readdir(join(home.fixture.paths.home, "staging", "lifecycle")).catch(() => [])).toEqual([]);
  return update.readHome();
}

async function attempt(work: Promise<unknown>, died: () => boolean): Promise<"completed" | "died"> {
  try {
    await work;
  } catch (error) {
    if (!died()) throw error;
    return "died";
  }
  return died() ? "died" : "completed";
}

async function baseAt110(label: string): Promise<UpdatableHomeV1> {
  const home = await installUpdatableHome(label, "arm64");
  expect(await updateTo(home.update(), "1.1.0")).toMatchObject({ outcome: "applied" });
  return home;
}

async function baseAt120(label: string): Promise<UpdatableHomeV1> {
  const home = await baseAt110(label);
  expect(await updateTo(home.update(), "1.2.0")).toMatchObject({ outcome: "applied" });
  return home;
}

function rollBack(update: CliUpdateContext): Promise<unknown> {
  return planRollback(update).then((preview) => applyRollback(update, preview));
}

describe("update --apply at every death point (Spec 2 §9.3, §9.4)", () => {
  it("recovers 1.1.0 -> 1.2.0 either to 1.2.0 with 1.1.0 retained or to 1.1.0 with the prior rollback intact", async () => {
    let home = await baseAt110("recovery-apply-sweep");
    const directions = { forward: 0, backward: 0 };
    let point = 1;
    for (;; point += 1) {
      expect(point).toBeLessThan(MAXIMUM_DEATH_POINTS);
      const dying = dieAfterMutations(home.fixture.context, point);
      if ((await attempt(updateTo(home.update(dying.context), "1.2.0"), dying.died)) === "completed") break;

      const recovered = await recoverUpdate(home.update());
      expect(["not_update", "coordinator", "envelope_suffix", "construction_cleaned", "executor_cleaned"]).toContain(recovered.kind);
      const settledHome = await settled(home);
      if (settledHome.active.version === "1.2.0") {
        expect(settledHome.rollback?.previous.version, `point ${String(point)}`).toBe("1.1.0");
        expect(await exists(bundleRoot(home, "1.0.0")), `point ${String(point)}`).toBe(false);
        directions.forward += 1;
        home = await baseAt110(`recovery-apply-sweep-${String(point)}`);
      } else {
        expect(settledHome.active.version, `point ${String(point)}`).toBe("1.1.0");
        expect(settledHome.rollback?.previous.version, `point ${String(point)}`).toBe("1.0.0");
        expect(await exists(bundleRoot(home, "1.0.0")), `point ${String(point)}`).toBe(true);
        expect(await exists(bundleRoot(home, "1.2.0")), `point ${String(point)}`).toBe(false);
        directions.backward += 1;
      }
    }
    // Both directions exist: the verifier's durable success is the one point of no return.
    expect(directions.backward).toBeGreaterThan(0);
    expect(directions.forward).toBeGreaterThan(0);
    expect(point).toBeGreaterThan(directions.backward + directions.forward);
    for (const directory of home.world.scratchDirectories) expect(await exists(directory)).toBe(false);
  }, SWEEP_TIMEOUT_MS);
});

describe("update rollback --apply at every death point (Spec 2 §10.2)", () => {
  it("recovers 1.2.0 -> 1.1.0 either to 1.1.0 with the set consumed or to 1.2.0 with it intact, with no network", async () => {
    const home = await baseAt120("recovery-rollback-sweep");
    const directions = { forward: 0, backward: 0 };
    for (let point = 1; ; point += 1) {
      expect(point).toBeLessThan(MAXIMUM_DEATH_POINTS);
      const trust = await nodeFs.readFile(join(home.fixture.paths.stateDir, "release-trust.json"));
      const requests = home.world.requests.length;
      const plannerRuns = home.world.plannerRuns.length;
      const dying = dieAfterMutations(home.fixture.context, point);
      const outcome = await attempt(rollBack(home.update(dying.context)), dying.died);
      if (outcome === "died") await recoverUpdate(home.update());
      expect(home.world.requests).toHaveLength(requests);
      expect(home.world.plannerRuns).toHaveLength(plannerRuns);
      expect(await nodeFs.readFile(join(home.fixture.paths.stateDir, "release-trust.json"))).toEqual(trust);
      if (outcome === "completed") break;

      const settledHome = await settled(home);
      if (settledHome.active.version === "1.1.0") {
        expect(settledHome.rollback, `point ${String(point)}`).toBeNull();
        expect(await exists(bundleRoot(home, "1.2.0")), `point ${String(point)}`).toBe(false);
        directions.forward += 1;
        expect(await updateTo(home.update(), "1.2.0")).toMatchObject({ outcome: "applied" });
      } else {
        expect(settledHome.active.version, `point ${String(point)}`).toBe("1.2.0");
        expect(settledHome.rollback?.previous.version, `point ${String(point)}`).toBe("1.1.0");
        expect(await exists(bundleRoot(home, "1.1.0")), `point ${String(point)}`).toBe(true);
        directions.backward += 1;
      }
    }
    expect(directions.backward).toBeGreaterThan(0);
    expect(directions.forward).toBeGreaterThan(0);
    expect((await settled(home)).active.version).toBe("1.1.0");
  }, SWEEP_TIMEOUT_MS);
});

describe("a verifier that rejects the target (Spec 2 §9.4, D72 P7(b), Review Focus 4)", () => {
  it("rolls back automatically, exits 5, keeps the old release active and the trust advanced", async () => {
    const home = await installUpdatableHome("recovery-rejected", "arm64", { rejectingVersions: ["1.1.0"] });
    const trustFile = join(home.fixture.paths.stateDir, "release-trust.json");
    const trust = await nodeFs.readFile(trustFile);

    const result = await runUpdate({ ...home.fixture.context, update: home.update() }, { kind: "update", version: parseStableSemver("1.1.0"), apply: true, json: true });

    expect(result).toMatchObject({ ok: false, code: EXIT_CODES.securityRefusal });
    const settledHome = await settled(home);
    expect(settledHome.active.version).toBe("1.0.0");
    expect(settledHome.rollback).toBeNull();
    expect(await nodeFs.readFile(trustFile)).not.toEqual(trust);
    expect(await exists(bundleRoot(home, "1.1.0"))).toBe(false);
  }, CASE_TIMEOUT_MS);

  it("resumes a run that died anywhere in that update, including its automatic rollback, as exit 5", async () => {
    const home = await installUpdatableHome("recovery-rejected-sweep", "arm64", { rejectingVersions: ["1.1.0"] });
    let point = 1;
    for (;; point += 1) {
      expect(point).toBeLessThan(MAXIMUM_DEATH_POINTS);
      const dying = dieAfterMutations(home.fixture.context, point);
      if ((await attempt(updateTo(home.update(dying.context), "1.1.0"), dying.died)) === "completed") break;

      const resumed = await runUpdate({ ...home.fixture.context, update: home.update() }, { kind: "update", version: parseStableSemver("1.1.0"), apply: true, json: true });
      expect(resumed, `point ${String(point)}`).toMatchObject({ ok: false, code: EXIT_CODES.securityRefusal });
      expect((await settled(home)).active.version, `point ${String(point)}`).toBe("1.0.0");
    }
    expect(point).toBeGreaterThan(1);
  }, SWEEP_TIMEOUT_MS);
});

describe("the ephemeral reservations (D72 P5, Review Focus 2)", () => {
  it("updates a home that has neither state/update-rollback.json nor state/git-sync.json", async () => {
    const home = await installUpdatableHome("recovery-no-reservations", "arm64");
    for (const leaf of ["update-rollback.json", "git-sync.json"]) {
      await nodeFs.rm(join(home.fixture.paths.stateDir, leaf), { force: true });
    }

    expect(await updateTo(home.update(), "1.1.0")).toMatchObject({ outcome: "applied", active: { version: "1.1.0" } });
    expect((await settled(home)).rollback?.previous.version).toBe("1.0.0");
  }, CASE_TIMEOUT_MS);
});
