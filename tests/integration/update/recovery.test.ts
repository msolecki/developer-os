import fsModule from "node:fs";
import * as nodeFs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  encodeCanonicalJson,
  EXIT_CODES,
  MAXIMUM_LEAF_PLAN_BYTES,
  MAXIMUM_RETIREMENT_INVENTORY_LEAVES,
  MAXIMUM_ROLLBACK_DOCUMENT_BYTES,
  MAXIMUM_ROLLBACK_PAYLOAD_ENTRIES,
  MAXIMUM_UPDATE_RETIREMENT_LEAVES,
  parseCanonicalAbsolutePathText,
  parseStableSemver,
  rollbackPayloadBlobPath,
  updateCoordinatorStagingRoot,
  validateRollbackPayloadInventory,
  validateUpdateTerminalRetirementPlan,
} from "@developer-os/core";
import { runUpdate } from "@developer-os/cli/dist/commands/update/index.js";
import { exists, removeCommandFixtures } from "@developer-os/cli/dist/commands/testing.js";
import { recoverUpdate } from "@developer-os/cli/dist/update/apply.js";
import type { CliUpdateContext } from "@developer-os/cli/dist/update/context.js";
import { planRollback } from "@developer-os/cli/dist/update/planning.js";
import type { UpdateHomeV1 } from "@developer-os/cli/dist/update/planning.js";
import { applyRollback } from "@developer-os/cli/dist/update/rollback-apply.js";
import { dieAfterMutations, installUpdatableHome, SyntheticDeathError, updateTo } from "@developer-os/cli/dist/update/testing.js";
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
 * are inode-bound (P1, P8): `init` persists `dev`/`ino` pairs in its retention plan and in every
 * retention tombstone under `state/`, so a copied or cloned home (new inodes) is a different home,
 * and a home is never copied. A sweep takes hours, not minutes (2213 apply, 1480 rollback and 2267
 * rejected points, each point replaying the run up to it), so `test:update-recovery` runs every
 * other case and `test:update-recovery:sweeps` runs these, with fsync disabled (`withoutFsync`)
 * and optionally restricted to a point range (`SWEEP_POINTS`) so the sweep can be sharded.
 */

const SWEEP_TIMEOUT_MS = 172_800_000;
const CASE_TIMEOUT_MS = 900_000;
const MAXIMUM_DEATH_POINTS = 5_000;

/**
 * `SWEEP_POINTS=<first>-<last>` runs only those death points (inclusive) of each sweep, from a
 * fresh home, the state the apply sweep already rebuilds after every forward point. A shard can
 * see one direction only, so the both-directions assertions run on a full sweep alone. A shard
 * starts from a fresh home, so the apply sweep's home reused after a backward point is exercised
 * only by a full run, and a full sweep is still required once before A16. A sweep that completes
 * at its first point injected no death and fails. Unset, a sweep runs from point 1 until an
 * uninjected run completes.
 */
const SWEEP_RANGE = ((): { readonly first: number; readonly last: number; readonly full: boolean } => {
  const value = process.env.SWEEP_POINTS;
  if (value === undefined || value === "") return { first: 1, last: MAXIMUM_DEATH_POINTS, full: true };
  const match = /^([1-9][0-9]*)-([1-9][0-9]*)$/u.exec(value);
  if (match === null || Number(match[1]) > Number(match[2])) throw new Error(`SWEEP_POINTS must be <first>-<last>, got ${value}`);
  return { first: Number(match[1]), last: Number(match[2]), full: false };
})();

/**
 * Runs `work` with every fsync a no-op. fsync orders the disk against a power loss; a synthetic
 * death loses nothing the page cache holds, so no recovery here ever sees different bytes with or
 * without it. Every guarded `syncDirectory` is still called and still counted as a death point
 * (2213 and 1480 points either way); only its system call is skipped. That is about 2.6 ms per call
 * and ~2000 calls per update on APFS (macOS fsync is F_FULLFSYNC), most of each point's cost.
 */
async function withoutFsync<T>(work: () => Promise<T>): Promise<T> {
  const handle = await nodeFs.open(process.execPath, "r");
  const prototype = Object.getPrototypeOf(handle) as { sync: () => Promise<void> };
  await handle.close();
  const { sync } = prototype;
  const { fsyncSync } = fsModule;
  prototype.sync = () => Promise.resolve();
  Object.assign(fsModule, { fsyncSync: (): void => undefined });
  syncBuiltinESMExports();
  try {
    return await work();
  } finally {
    prototype.sync = sync;
    Object.assign(fsModule, { fsyncSync });
    syncBuiltinESMExports();
  }
}

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
  it("recovers 1.1.0 -> 1.2.0 either to 1.2.0 with 1.1.0 retained or to 1.1.0 with the prior rollback intact", () => withoutFsync(async () => {
    let home = await baseAt110("recovery-apply-sweep");
    const directions = { forward: 0, backward: 0 };
    let completed = false;
    for (let point = SWEEP_RANGE.first; point <= SWEEP_RANGE.last; point += 1) {
      expect(point).toBeLessThan(MAXIMUM_DEATH_POINTS);
      const dying = dieAfterMutations(home.fixture.context, point);
      if ((await attempt(updateTo(home.update(dying.context), "1.2.0"), dying.died)) === "completed") {
        expect(point, "a range past the last death point injects nothing").toBeGreaterThan(SWEEP_RANGE.first);
        completed = true;
        break;
      }

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
    if (!completed) return;
    // Both directions exist: the verifier's durable success is the one point of no return.
    if (SWEEP_RANGE.full) {
      expect(directions.backward).toBeGreaterThan(0);
      expect(directions.forward).toBeGreaterThan(0);
    }
    for (const directory of home.world.scratchDirectories) expect(await exists(directory)).toBe(false);
  }), SWEEP_TIMEOUT_MS);
});

type DyingCliContext = Parameters<typeof dieAfterMutations>[0];

/** The same context whose process dies right after the first durable mutation `fatal` selects. */
function dieWhen(context: DyingCliContext, fatal: (name: string, args: readonly unknown[]) => boolean | Promise<boolean>): { readonly context: DyingCliContext; readonly died: () => boolean } {
  const lifecycle = context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture has no lifecycle ports");
  let died = false;
  const fs: Record<string, unknown> = { ...lifecycle.fs };
  for (const name of ["writeExclusive", "mkdirExclusive", "renameOver", "renameNoReplace", "unlinkExact", "rmdirExactEmpty", "syncDirectory"] as const) {
    const real = lifecycle.fs[name].bind(lifecycle.fs) as (...args: readonly unknown[]) => Promise<unknown>;
    fs[name] = async (...args: readonly unknown[]): Promise<unknown> => {
      if (died) throw new SyntheticDeathError();
      const result = await real(...args);
      if (await fatal(name, args)) {
        died = true;
        throw new SyntheticDeathError();
      }
      return result;
    };
  }
  return { context: { ...context, lifecycle: { ...lifecycle, fs: fs as unknown as typeof lifecycle.fs } }, died: () => died };
}

function dieAfterUnlinking(context: DyingCliContext, fragment: string): ReturnType<typeof dieWhen> {
  return dieWhen(context, (name, args) => name === "unlinkExact" && (args[0] as { readonly path: string }).path.includes(fragment));
}

/** True once some staging root holds an exclusively created, still empty `kind` source plan row. */
async function emptySourcePlanExists(home: UpdatableHomeV1, kind: string): Promise<boolean> {
  const lifecycleRoot = join(home.fixture.paths.home, "staging", "lifecycle");
  for (const root of await nodeFs.readdir(lifecycleRoot).catch(() => [])) {
    const plans = join(lifecycleRoot, root, "update", "plans", kind);
    for (const leaf of await nodeFs.readdir(plans).catch(() => [])) {
      if ((await nodeFs.stat(join(plans, leaf))).size === 0) return true;
    }
  }
  return false;
}

describe("a death between a publication journal's removal and its plan leaf's (NEW-110 review C2)", () => {
  it.each(["bundle_publication", "rollback_payload_state"])("recovers when the compaction died right after its first unlink under update/journals/%s/", async (kind) => {
    const home = await installUpdatableHome(`recovery-compaction-${kind.replaceAll("_", "-")}`, "arm64");
    const dying = dieAfterUnlinking(home.fixture.context, `/update/journals/${kind}/`);

    expect(await attempt(updateTo(home.update(dying.context), "1.1.0"), dying.died)).toBe("died");
    await recoverUpdate(home.update());

    const settledHome = await settled(home);
    expect(settledHome.active.version).toBe("1.1.0");
    expect(settledHome.rollback?.previous.version).toBe("1.0.0");
  }, CASE_TIMEOUT_MS);
});

describe("a construction that died between a source plan row's exclusive create and its bytes", () => {
  it.each(["bundle_source_staging", "rollback_payload_source"])("compensates the empty %s row without reading it as a plan", async (kind) => {
    const home = await installUpdatableHome(`recovery-empty-${kind.replaceAll("_", "-")}`, "arm64");
    const dying = dieWhen(home.fixture.context, () => emptySourcePlanExists(home, kind));

    expect(await attempt(updateTo(home.update(dying.context), "1.1.0"), dying.died)).toBe("died");
    expect(await emptySourcePlanExists(home, kind)).toBe(true);
    await recoverUpdate(home.update());

    expect((await settled(home)).active.version).toBe("1.0.0");
  }, CASE_TIMEOUT_MS);
});

/** Dies right after the first `writeExclusive` of `leaf` that follows an unlink under `after`. */
function dieWritingAfterUnlink(context: DyingCliContext, after: string, leaf: string): ReturnType<typeof dieWhen> {
  let unlinked = false;
  return dieWhen(context, (name, args) => {
    if (name === "unlinkExact" && (args[0] as { readonly path: string }).path.includes(after)) unlinked = true;
    return unlinked && name === "writeExclusive" && String(args[0]).endsWith(leaf);
  });
}

describe("a death inside a terminal compaction entry, between two of its removals", () => {
  it.each([
    ["an owner update's final journal", (context: DyingCliContext) => dieAfterUnlinking(context, "/update/journals/owner_update/")],
    ["the rollback payload source's journal", (context: DyingCliContext) => dieAfterUnlinking(context, "/update/journals/rollback_payload_source/")],
    ["the construction journal", (context: DyingCliContext) => dieAfterUnlinking(context, "/update-construction.journal.json")],
    ["the execution leaf, at the next construction journal rewrite temp", (context: DyingCliContext) => dieWritingAfterUnlink(context, "/update/plans/update_execution/", "/update-construction.journal.rewrite.pending")],
  ])("resumes after %s", async (_label, die) => {
    const home = await installUpdatableHome("recovery-compaction-resume", "arm64");
    const dying = die(home.fixture.context);

    expect(await attempt(updateTo(home.update(dying.context), "1.1.0"), dying.died)).toBe("died");
    await recoverUpdate(home.update());

    const settledHome = await settled(home);
    expect(settledHome.active.version).toBe("1.1.0");
    expect(settledHome.rollback?.previous.version).toBe("1.0.0");
  }, CASE_TIMEOUT_MS);
});

describe("a death inside a publication microstate, before the point of no return (NEW-195)", () => {
  it.each([
    ["the bundle's first entry directory was made", (name: string, args: readonly unknown[]) => name === "mkdirExclusive" && String(args[0]).endsWith("/releases/1.2.0/darwin-arm64/bin")],
    ["a rollback payload entry was written and its parent not yet advanced", (name: string, args: readonly unknown[]) => name === "syncDirectory" && /\/\.developer-os\/rollback\/rb_[^/]+\/plans\/owner_inverse$/u.test((args[0] as { readonly path: string }).path)],
  ])("resumes forward after %s, since death alone never chooses rollback", async (_label, fatal) => {
    const home = await baseAt110("recovery-publication-in-flight");
    const dying = dieWhen(home.fixture.context, fatal);
    expect(await attempt(updateTo(home.update(dying.context), "1.2.0"), dying.died)).toBe("died");

    await recoverUpdate(home.update());

    const settledHome = await settled(home);
    expect(settledHome.active.version).toBe("1.2.0");
    expect(settledHome.rollback?.previous.version).toBe("1.1.0");
  }, CASE_TIMEOUT_MS);
});

describe("a coordinator that died between its journal rewrite temp and the rename", () => {
  it("removes the dead temp before resuming, so the closure clears", async () => {
    const home = await installUpdatableHome("recovery-coordinator-rewrite-temp", "arm64");
    const dying = dieWhen(home.fixture.context, (name, args) => name === "writeExclusive" && /\/lifecycle-journals\/\.lc_[^/]+\.json\.tmp$/u.test(String(args[0])));

    expect(await attempt(updateTo(home.update(dying.context), "1.1.0"), dying.died)).toBe("died");
    await recoverUpdate(home.update());

    expect((await settled(home)).active.version).toBe("1.1.0");
  }, CASE_TIMEOUT_MS);
});

describe("an allocation that died before its construction envelope (NEW-110 review I4)", () => {
  it("removes the empty allocator-reserved staging root under the global lock", async () => {
    const home = await installUpdatableHome("recovery-empty-staging-root", "arm64");
    const root = join(home.fixture.paths.home, "staging", "lifecycle", `lc_${"d".repeat(64)}_7`);
    await nodeFs.mkdir(root, { recursive: true, mode: 0o700 });

    expect(await recoverUpdate(home.update())).toStrictEqual({ kind: "not_update" });

    expect(await exists(root)).toBe(false);
    await settled(home);
  }, CASE_TIMEOUT_MS);
});

describe("an allocation that died after its allocator temp landed", () => {
  it("cleans the pre-rename allocator temp under the global lock, so the closure clears", async () => {
    const home = await installUpdatableHome("recovery-allocator-temp", "arm64");
    const dying = dieAfterMutations(home.fixture.context, 1);
    expect(await attempt(updateTo(home.update(dying.context), "1.1.0"), dying.died)).toBe("died");
    expect((await nodeFs.readdir(home.fixture.paths.stateDir)).filter((name) => name.startsWith(".lifecycle-id-allocator."))).toHaveLength(1);

    expect(await recoverUpdate(home.update())).toStrictEqual({ kind: "not_update" });

    expect((await nodeFs.readdir(home.fixture.paths.stateDir)).filter((name) => name.startsWith(".lifecycle-id-allocator."))).toEqual([]);
    expect((await settled(home)).active.version).toBe("1.0.0");
  }, CASE_TIMEOUT_MS);
});

/** Dies right after the coordinator's own journal is unlinked: the plan-only envelope suffix. */
function afterJournalRemoved(context: DyingCliContext): ReturnType<typeof dieWhen> {
  return dieWhen(context, (name, args) => name === "unlinkExact" && /\/lc_[0-9a-f]{64}_[0-9]+\.json$/u.test((args[0] as { readonly path: string }).path));
}

describe("a run killed after it finalized and before its envelope plan was removed (NEW-162 follow-up)", () => {
  it("reports the finished rollback from `update rollback --apply` with exit 0", async () => {
    const home = await baseAt120("recovery-suffix-rollback");
    const dying = afterJournalRemoved(home.fixture.context);
    expect(await attempt(rollBack(home.update(dying.context)), dying.died)).toBe("died");

    const result = await runUpdate({ ...home.fixture.context, update: home.update() }, { kind: "rollback", apply: true, json: true });

    expect(result).toMatchObject({ ok: true, code: EXIT_CODES.success, data: { outcome: "rolled_back", active: { version: "1.1.0" } } });
    expect((await settled(home)).rollback).toBeNull();
  }, CASE_TIMEOUT_MS);

  it("reports the finished update from `update --apply` with exit 0 instead of planning again", async () => {
    const home = await installUpdatableHome("recovery-suffix-apply", "arm64");
    const dying = afterJournalRemoved(home.fixture.context);
    expect(await attempt(updateTo(home.update(dying.context), "1.1.0"), dying.died)).toBe("died");
    const runs = home.world.plannerRuns.length;

    const result = await runUpdate({ ...home.fixture.context, update: home.update() }, { kind: "update", version: parseStableSemver("1.1.0"), apply: true, json: true });

    expect(result).toMatchObject({ ok: true, code: EXIT_CODES.success, data: { outcome: "applied", active: { version: "1.1.0" } } });
    expect(home.world.plannerRuns).toHaveLength(runs);
    expect((await settled(home)).rollback?.previous.version).toBe("1.0.0");
  }, CASE_TIMEOUT_MS);
});

describe("update rollback --apply at every death point (Spec 2 §10.2)", () => {
  it("recovers 1.2.0 -> 1.1.0 either to 1.1.0 with the set consumed or to 1.2.0 with it intact, with no network", () => withoutFsync(async () => {
    const home = await baseAt120("recovery-rollback-sweep");
    const directions = { forward: 0, backward: 0 };
    let completed = false;
    for (let point = SWEEP_RANGE.first; point <= SWEEP_RANGE.last; point += 1) {
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
      if (outcome === "completed") {
        expect(point, "a range past the last death point injects nothing").toBeGreaterThan(SWEEP_RANGE.first);
        completed = true;
        break;
      }

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
    if (!completed) return;
    if (SWEEP_RANGE.full) {
      expect(directions.backward).toBeGreaterThan(0);
      expect(directions.forward).toBeGreaterThan(0);
    }
    expect((await settled(home)).active.version).toBe("1.1.0");
  }), SWEEP_TIMEOUT_MS);
});

/**
 * True when a death left the coordinator in its plan-only envelope suffix: the lifecycle journal
 * is unlinked and its plan is not. Spec 2 §13.3 residual 11 accepts exit 1 exactly there. The
 * suffix is named by its state, not by point number: a reused home whose trust already advanced
 * runs fewer steps, so the same death has a lower number (2262–2263 from a fresh home, 2256–2257
 * after an earlier rejected run).
 */
async function inPlanOnlySuffix(home: UpdatableHomeV1): Promise<boolean> {
  const names = await nodeFs.readdir(join(home.fixture.paths.stateDir, "lifecycle-journals"));
  return names.some((name) => name.endsWith(".plan.json") && !names.includes(name.replace(/\.plan\.json$/u, ".json")));
}

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

  it("reports a rejected run that died inside its plan-only envelope suffix as exit 1, then a rerun rejects it as exit 5 (Spec 2 §13.3 residual 11)", async () => {
    const home = await installUpdatableHome("recovery-rejected-suffix", "arm64", { rejectingVersions: ["1.1.0"] });
    const dying = afterJournalRemoved(home.fixture.context);
    expect(await attempt(updateTo(home.update(dying.context), "1.1.0"), dying.died)).toBe("died");
    expect(await inPlanOnlySuffix(home)).toBe(true);
    const request = { kind: "update", version: parseStableSemver("1.1.0"), apply: true, json: true } as const;

    const resumed = await runUpdate({ ...home.fixture.context, update: home.update() }, request);

    expect(resumed).toMatchObject({ ok: false, code: EXIT_CODES.operationalFailure, error: { message: "update_coordinator_compensated" } });
    expect((await settled(home)).active.version).toBe("1.0.0");
    expect(await runUpdate({ ...home.fixture.context, update: home.update() }, request)).toMatchObject({ ok: false, code: EXIT_CODES.securityRefusal });
    expect((await settled(home)).active.version).toBe("1.0.0");
  }, CASE_TIMEOUT_MS);

  it("resumes a run that died anywhere in that update, including its automatic rollback, as exit 5", () => withoutFsync(async () => {
    const home = await installUpdatableHome("recovery-rejected-sweep", "arm64", { rejectingVersions: ["1.1.0"] });
    for (let point = SWEEP_RANGE.first; point <= SWEEP_RANGE.last; point += 1) {
      expect(point).toBeLessThan(MAXIMUM_DEATH_POINTS);
      const dying = dieAfterMutations(home.fixture.context, point);
      if ((await attempt(updateTo(home.update(dying.context), "1.1.0"), dying.died)) === "completed") {
        expect(point, "a range past the last death point injects nothing").toBeGreaterThan(SWEEP_RANGE.first);
        break;
      }

      // Spec 2 §13.3 residual 11 (NEW-196): inside the plan-only envelope suffix the journal and its cause are gone.
      const suffix = await inPlanOnlySuffix(home);
      const resumed = await runUpdate({ ...home.fixture.context, update: home.update() }, { kind: "update", version: parseStableSemver("1.1.0"), apply: true, json: true });
      if (suffix) expect(resumed, `point ${String(point)}`).toMatchObject({ ok: false, code: EXIT_CODES.operationalFailure, error: { message: "update_coordinator_compensated" } });
      else expect(resumed, `point ${String(point)}`).toMatchObject({ ok: false, code: EXIT_CODES.securityRefusal });
      expect((await settled(home)).active.version, `point ${String(point)}`).toBe("1.0.0");
    }
  }), SWEEP_TIMEOUT_MS);
});

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const PAYLOAD_ID = `rb_${"e".repeat(64)}_3`;

function payloadInventory(entries: number): unknown {
  return {
    schemaVersion: 1,
    payloadId: PAYLOAD_ID,
    rollbackBindingHash: "a".repeat(64),
    inversePlanHash: "b".repeat(64),
    entries: Array.from({ length: entries }, (_, ordinal) => ({ ordinal, path: rollbackPayloadBlobPath(ordinal), role: "owner_preimage", bytes: 0, sha256: EMPTY_SHA256 })),
    aggregateBytes: 0,
  };
}

/** The canonical inventory length for `entries` smallest rows, computed rather than encoded per candidate. */
function inventoryBytes(entries: number): number {
  const encoded = (value: unknown): number => Buffer.byteLength(encodeCanonicalJson(value as never));
  // A row differs from row 0 only in its ordinal's decimal digits; the blob path is fixed-width.
  const rowZero = encoded({ ordinal: 0, path: rollbackPayloadBlobPath(0), role: "owner_preimage", bytes: 0, sha256: EMPTY_SHA256 }) - 1;
  let total = encoded(payloadInventory(0));
  for (let ordinal = 0; ordinal < entries; ordinal += 1) total += rowZero + String(ordinal).length - 1 + (ordinal === 0 ? 0 : 1);
  return total;
}

/**
 * Spec 2 §12 and amendment A6: "exact maximum" means the maximum admissible under both the
 * cardinality and the byte bound, and the first row over either. The declared retirement
 * cardinality counts 1,000,000 payload entries, which no 64-MiB inventory can hold, so the
 * feasible payload maximum is derived here from the byte bound instead of trusted.
 */
describe("the rollback payload's feasible maximum, under both bounds (A6)", () => {
  it("derives the largest inventory the 64 MiB byte bound admits, admits it, and refuses one entry more", () => {
    let feasible = 0;
    let step = 1 << 20;
    while (step > 0) {
      if (feasible + step <= MAXIMUM_ROLLBACK_PAYLOAD_ENTRIES && inventoryBytes(feasible + step) <= MAXIMUM_ROLLBACK_DOCUMENT_BYTES) feasible += step;
      step >>= 1;
    }

    // The byte bound binds first: the declared cardinality maximum cannot be written.
    expect(feasible).toBeGreaterThan(0);
    expect(feasible).toBeLessThan(MAXIMUM_ROLLBACK_PAYLOAD_ENTRIES);
    expect(validateRollbackPayloadInventory(payloadInventory(feasible)).entries).toHaveLength(feasible);
    expect(() => validateRollbackPayloadInventory(payloadInventory(feasible + 1))).toThrow(/64 MiB/u);

    // So the largest retirement tree any update can meet is well inside the declared leaf cap.
    const payloadLeaves = feasible + 7;
    expect(payloadLeaves).toBeLessThan(MAXIMUM_RETIREMENT_INVENTORY_LEAVES);
    const coordinatorId = `lc_${"f".repeat(64)}_9`;
    const home = parseCanonicalAbsolutePathText("/synthetic/user/.developer-os");
    const entries = [
      { kind: "bundle", root: `${home}/releases/1.0.0/darwin-arm64`, inventoryHash: "c".repeat(64), leafCount: 200_001 },
      { kind: "metadata", root: `${home}/state/release-metadata`, inventoryHash: "d".repeat(64), leafCount: 3 },
      { kind: "rollback_payload", root: `${home}/rollback/${PAYLOAD_ID}`, inventoryHash: "e".repeat(64), leafCount: payloadLeaves },
      { kind: "rollback_record", root: `${home}/state/update-rollback.json`, inventoryHash: "f".repeat(64), leafCount: 1 },
    ];
    const maximumLeaves = entries.reduce((sum, entry) => sum + entry.leafCount, 0);
    expect(maximumLeaves).toBeLessThan(MAXIMUM_UPDATE_RETIREMENT_LEAVES);
    const plan = validateUpdateTerminalRetirementPlan({
      schemaVersion: 1,
      id: "retirement",
      coordinatorId,
      set: "prior_rollback",
      transitionalManifestHash: "9".repeat(64),
      entries,
      maximumLeaves,
      maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES,
    }, updateCoordinatorStagingRoot(home, coordinatorId as never));
    expect(plan.maximumLeaves).toBe(maximumLeaves);
  });
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
