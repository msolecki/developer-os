import { chmod, link, mkdir, mkdtemp, readdir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LifecycleRecoveryRequiredError,
  MAX_LAUNCHD_EFFECT_JOURNAL_BYTES,
  createNodeLifecycleGuardedFileSystem,
  decodeCanonicalJson,
  deriveLifecycleLedgerRoots,
  parseEffectStagingChildren,
  type CanonicalAbsolutePathV1,
  type EffectiveUidV1,
  type LaunchdEffectIdV1,
  type LifecycleCoordinatorIdV1,
  type LowerHexSha256,
  type ScheduledJobIdV1,
  type UtcTimestampV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  LAUNCHD_EFFECT_JOURNAL_PHASES,
  LAUNCHD_EFFECT_LEDGER_CODEC,
  LaunchdEffectJournalStore,
  encodeLaunchdEffectJournal,
  encodeLaunchdEffectPlan,
  launchdEffectPlanHash,
  maximumLaunchdEffectJournalBytes,
  validateLaunchdEffectJournal,
  validateLaunchdEffectJournalForPlan,
  validateLaunchdEffectPlan,
  type LaunchdEffectJournalV1,
  type LaunchdEffectPlanV1,
  type LaunchdEffectPositionV1,
  type LaunchdEffectTransitionV1,
} from "./effect-journal.js";
import { generatedLabel, launchdGuiDomain } from "./registry.js";

const uid = (process.getuid?.() ?? 501) as EffectiveUidV1;
const domain = launchdGuiDomain(uid);
const NONCE = "a".repeat(64);
const COORDINATOR = `lc_${NONCE}_1` as LifecycleCoordinatorIdV1;
const EFFECT = `le_${NONCE}_18446744073709551615` as LaunchdEffectIdV1;
const TIMESTAMP = "2026-09-23T10:00:00.000Z" as UtcTimestampV1;
const encoder = new TextEncoder();

function transition(job: ScheduledJobIdV1, position: LaunchdEffectPositionV1, digit: string): LaunchdEffectTransitionV1 {
  const generation = digit.repeat(64) as LowerHexSha256;
  const loaded = { state: "loaded" as const, label: generatedLabel(job, generation), generation };
  const unloaded = { state: "unloaded" as const };
  return {
    job,
    label: loaded.label,
    generation,
    domain,
    plistPath: `/Users/synthetic/Library/LaunchAgents/com.developer-os.${job}.plist` as CanonicalAbsolutePathV1,
    plistHash: "e".repeat(64) as LowerHexSha256,
    before: position === "before_files" ? loaded : unloaded,
    after: position === "before_files" ? unloaded : loaded,
  };
}

function effectPlan(position: LaunchdEffectPositionV1, jobs: readonly ScheduledJobIdV1[]): LaunchdEffectPlanV1 {
  const transitions = jobs.map((job, index) => transition(job, position, String(index + 1)));
  const draft = { schemaVersion: 1 as const, id: EFFECT, coordinatorId: COORDINATOR, position, processTableHash: "3".repeat(64) as LowerHexSha256, maximumJournalBytes: 0, transitions };
  return { ...draft, maximumJournalBytes: maximumLaunchdEffectJournalBytes(draft) };
}

function journal(plan: LaunchdEffectPlanV1, patch: Partial<LaunchdEffectJournalV1> = {}): LaunchdEffectJournalV1 {
  return {
    schemaVersion: 1,
    id: plan.id,
    coordinatorId: plan.coordinatorId,
    phase: "planned",
    planHash: launchdEffectPlanHash(plan),
    nextTransition: 0,
    compensationNext: null,
    observations: [],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...patch,
  };
}

function observed(plan: LaunchdEffectPlanV1, count: number): LaunchdEffectJournalV1["observations"] {
  return plan.transitions.slice(0, count).map((entry, transitionIndex) => ({ transitionIndex, observedAfter: entry.after }));
}

/** Every tuple §2.4's phase relation admits for `plan`. */
function reachable(plan: LaunchdEffectPlanV1): LaunchdEffectJournalV1[] {
  const n = plan.transitions.length;
  const states: LaunchdEffectJournalV1[] = [];
  for (const phase of ["planned", "backed_up", "staged", "validated"] as const) states.push(journal(plan, { phase }));
  for (let c = 0; c < n; c += 1) states.push(journal(plan, { phase: "applied", nextTransition: c, observations: observed(plan, c) }));
  for (const phase of ["verified", "finalized"] as const) states.push(journal(plan, { phase, nextTransition: n, observations: observed(plan, n) }));
  for (let c = 0; c <= n; c += 1) {
    for (let next = -1; next < c; next += 1) {
      states.push(journal(plan, { phase: "compensating", nextTransition: c, compensationNext: next, observations: observed(plan, c) }));
    }
    states.push(journal(plan, { phase: "rolled_back", nextTransition: c, compensationNext: -1, observations: observed(plan, c) }));
  }
  return states;
}

describe("LaunchdEffectPlanV1", () => {
  it("round-trips a before_files and an after_files plan through the ledger codec", () => {
    for (const position of ["before_files", "after_files"] as const) {
      const plan = effectPlan(position, ["brain-reindex", "doctor"]);
      const decoded = decodeCanonicalJson(encoder.encode(encodeLaunchdEffectPlan(plan)), 16_777_216);
      expect(LAUNCHD_EFFECT_LEDGER_CODEC.plan.encode(LAUNCHD_EFFECT_LEDGER_CODEC.plan.validate(decoded))).toBe(encodeLaunchdEffectPlan(plan));
    }
  });

  it("refuses a loaded→loaded transition and a load in before_files", () => {
    const after = effectPlan("after_files", ["doctor"]);
    const [load] = after.transitions as [LaunchdEffectTransitionV1];
    expect(() => validateLaunchdEffectPlan({ ...after, position: "before_files" })).toThrow();
    expect(() => validateLaunchdEffectPlan({ ...after, transitions: [{ ...load, before: load.after }] })).toThrow();
  });

  it("refuses transitions out of registry order, a duplicate job, and more than eight transitions", () => {
    const plan = effectPlan("after_files", ["brain-reindex", "doctor"]);
    expect(() => validateLaunchdEffectPlan({ ...plan, transitions: [...plan.transitions].reverse() })).toThrow();
    const [first] = plan.transitions as [LaunchdEffectTransitionV1];
    expect(() => validateLaunchdEffectPlan({ ...plan, transitions: [first, first] })).toThrow();
    expect(() => validateLaunchdEffectPlan({ ...plan, transitions: Array.from({ length: 9 }, () => first) })).toThrow();
  });

  it("refuses a maximumJournalBytes that is not the exact derived maximum", () => {
    const plan = effectPlan("before_files", ["doctor"]);
    expect(() => validateLaunchdEffectPlan({ ...plan, maximumJournalBytes: plan.maximumJournalBytes + 1 })).toThrow();
    expect(() => validateLaunchdEffectPlan({ ...plan, maximumJournalBytes: plan.maximumJournalBytes - 1 })).toThrow();
  });

  it("owns the bootstrap snapshot leaf only when it has a transition", () => {
    expect(LAUNCHD_EFFECT_LEDGER_CODEC.stagingChildren(effectPlan("after_files", []))).toStrictEqual([]);
    for (const position of ["before_files", "after_files"] as const) {
      const children = LAUNCHD_EFFECT_LEDGER_CODEC.stagingChildren(effectPlan(position, ["doctor"]));
      expect(children).toStrictEqual(["tmp", "tmp/bootstrap-plist"]);
      expect([...parseEffectStagingChildren(children)]).toStrictEqual(["tmp", "tmp/bootstrap-plist"]);
    }
  });
});

describe("journal feasibility at 1 MiB", () => {
  it.each([0, 1, 4, 8])("the maximum bounds every reachable journal of %i transitions and is attained", (count) => {
    const jobs = (["brain-reindex", "brain-lint", "doctor", "git-sync"] as const).slice(0, Math.min(count, 4));
    const plan = count <= 4 ? effectPlan("after_files", jobs) : { ...effectPlan("after_files", []), transitions: Array.from({ length: count }, (_, index) => transition("doctor", "after_files", String((index % 9) + 1))) };
    const maximum = maximumLaunchdEffectJournalBytes(plan);
    const sizes = reachable(plan).map((state) => encoder.encode(encodeLaunchdEffectJournal(state)).byteLength);

    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBe(maximum);
    expect(maximum).toBeLessThanOrEqual(MAX_LAUNCHD_EFFECT_JOURNAL_BYTES);
  });
});

describe("the §2.4 phase relation", () => {
  const plan = effectPlan("after_files", ["brain-reindex", "doctor"]);

  it("accepts every reachable tuple", () => {
    const states = reachable(plan);
    expect(states.length).toBeGreaterThan(0);
    for (const state of states) expect(() => { validateLaunchdEffectJournalForPlan(plan, validateLaunchdEffectJournal(JSON.parse(encodeLaunchdEffectJournal(state)) as unknown)); }).not.toThrow();
  });

  it.each([
    ["planned with a cursor", { phase: "planned", nextTransition: 1 }],
    ["applied at n", { phase: "applied", nextTransition: 2 }],
    ["applied with a compensation cursor", { phase: "applied", compensationNext: 0 }],
    ["verified short of n", { phase: "verified", nextTransition: 1 }],
    ["compensating without a reverse cursor", { phase: "compensating", nextTransition: 1 }],
    ["compensating ahead of its cursor", { phase: "compensating", nextTransition: 1, compensationNext: 1 }],
    ["rolled_back mid-frontier", { phase: "rolled_back", compensationNext: 0 }],
    ["finalized with a compensation cursor", { phase: "finalized", nextTransition: 2, compensationNext: -1 }],
  ] as const)("refuses %s", (_name, patch) => {
    const c = "nextTransition" in patch ? patch.nextTransition : 0;
    const state = journal(plan, { ...patch, observations: observed(plan, c) });
    expect(() => { validateLaunchdEffectJournalForPlan(plan, state); }).toThrow(LifecycleRecoveryRequiredError);
  });

  it("refuses an observation that is not its transition's postimage, and another plan's hash", () => {
    const [first] = plan.transitions as [LaunchdEffectTransitionV1];
    const wrong = journal(plan, { phase: "applied", nextTransition: 1, observations: [{ transitionIndex: 0, observedAfter: first.before }] });
    expect(() => { validateLaunchdEffectJournalForPlan(plan, wrong); }).toThrow(LifecycleRecoveryRequiredError);
    expect(() => { validateLaunchdEffectJournalForPlan(plan, journal(plan, { planHash: "f".repeat(64) as LowerHexSha256 })); }).toThrow(LifecycleRecoveryRequiredError);
  });

  it("reports only finalized and rolled_back as terminal", () => {
    const terminal = LAUNCHD_EFFECT_JOURNAL_PHASES.filter((phase) => LAUNCHD_EFFECT_LEDGER_CODEC.terminal(journal(plan, { phase })) !== null);
    expect(terminal).toStrictEqual(["finalized", "rolled_back"]);
  });
});

describe("LaunchdEffectJournalStore", () => {
  const bases: string[] = [];

  afterEach(async () => {
    for (const base of bases.splice(0)) await rm(base, { recursive: true, force: true });
  });

  async function fixture() {
    const base = await realpath(await mkdtemp(join(tmpdir(), "dos-launchd-journal-")));
    bases.push(base);
    const roots = deriveLifecycleLedgerRoots(base as CanonicalAbsolutePathV1);
    for (const directory of [roots.stateDirectory, roots.launchdEffectJournals, `${base}/staging`, roots.lifecycleStaging]) {
      await mkdir(directory, { recursive: true });
      await chmod(directory, 0o700);
    }
    const processRoot = `${roots.lifecycleStaging}/${COORDINATOR}/launchd-process`;
    for (const directory of [`${roots.lifecycleStaging}/${COORDINATOR}`, processRoot, `${processRoot}/home`, `${processRoot}/tmp`]) {
      await mkdir(directory, { recursive: true });
      await chmod(directory, 0o700);
    }
    let counter = 0;
    const released: string[] = [];
    const store = new LaunchdEffectJournalStore({
      fs: createNodeLifecycleGuardedFileSystem({
        effectiveUid: uid,
        renameNoReplace: async (request) => {
          await link(request.sourcePath, request.destinationPath);
          await unlink(request.sourcePath);
        },
      }),
      roots,
      locks: {
        acquire: async (path) => {
          await writeFile(path, "", { flag: "a", mode: 0o600 });
          return { release: () => Promise.resolve(void released.push(path)) };
        },
      },
      uuid: () => `00000000-0000-4000-8000-${String((counter += 1)).padStart(12, "0")}`,
    });
    return { base, roots, store, processRoot, released };
  }

  it("publishes the plan once and reads it back only under its bound hash", async () => {
    const { store } = await fixture();
    const plan = effectPlan("after_files", ["doctor"]);
    const planHash = await store.publishPlan(plan);

    expect(planHash).toBe(launchdEffectPlanHash(plan));
    expect(await store.readPlan({ id: plan.id, planHash })).toStrictEqual(validateLaunchdEffectPlan(plan));
    await expect(store.readPlan({ id: plan.id, planHash: "f".repeat(64) as LowerHexSha256 })).rejects.toThrow(LifecycleRecoveryRequiredError);
    await expect(store.publishPlan(plan)).rejects.toThrow(LifecycleRecoveryRequiredError);
  });

  it("creates the journal no-replace and rewrites it only from the exact on-disk state", async () => {
    const { store } = await fixture();
    const plan = effectPlan("after_files", ["doctor"]);
    await store.publishPlan(plan);
    const planned = journal(plan);
    const backedUp = journal(plan, { phase: "backed_up" });

    expect(await store.readJournal(plan)).toBeNull();
    await store.writeJournal(plan, null, planned);
    await expect(store.writeJournal(plan, null, planned)).rejects.toThrow(LifecycleRecoveryRequiredError);
    await store.writeJournal(plan, planned, backedUp);
    expect(await store.readJournal(plan)).toStrictEqual(backedUp);
    await expect(store.writeJournal(plan, planned, journal(plan, { phase: "staged" }))).rejects.toThrow(LifecycleRecoveryRequiredError);
  });

  it("refuses to persist a journal outside the phase relation", async () => {
    const { store } = await fixture();
    const plan = effectPlan("after_files", ["doctor"]);
    await store.publishPlan(plan);
    await expect(store.writeJournal(plan, null, journal(plan, { phase: "verified" }))).rejects.toThrow(LifecycleRecoveryRequiredError);
  });

  it("compacts a terminal effect: journal, lock, plan, then the exact empty launchd-process tree", async () => {
    const { store, roots, processRoot } = await fixture();
    const plan = effectPlan("after_files", ["doctor"]);
    await store.publishPlan(plan);
    await store.writeJournal(plan, null, journal(plan));
    await store.writeJournal(plan, journal(plan), journal(plan, { phase: "rolled_back", compensationNext: -1 }));
    const held = await store.lock(plan);
    await held.release();

    await store.compact(plan);

    expect(await readdir(roots.launchdEffectJournals)).toStrictEqual([]);
    expect(await readdir(`${roots.lifecycleStaging}/${COORDINATOR}`)).toStrictEqual([]);
    expect(processRoot.endsWith("/launchd-process")).toBe(true);
    await store.compact(plan);
  });

  it("refuses to compact a non-terminal effect and preserves a non-empty tmp", async () => {
    const { store, roots, processRoot } = await fixture();
    const plan = effectPlan("after_files", ["doctor"]);
    await store.publishPlan(plan);
    await store.writeJournal(plan, null, journal(plan));
    await expect(store.compact(plan)).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect((await readdir(roots.launchdEffectJournals)).sort()).toStrictEqual([`${EFFECT}.json`, `${EFFECT}.plan.json`]);

    await store.writeJournal(plan, journal(plan), journal(plan, { phase: "rolled_back", compensationNext: -1 }));
    await writeFile(`${processRoot}/tmp/bootstrap-plist`, "<?xml", { mode: 0o600 });
    await expect(store.compact(plan)).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(await readdir(`${processRoot}/tmp`)).toStrictEqual(["bootstrap-plist"]);
    expect(await readdir(processRoot)).toHaveLength(2);
    expect((await readdir(roots.launchdEffectJournals)).sort()).toStrictEqual([`${EFFECT}.json`, `${EFFECT}.plan.json`]);
  });
});
