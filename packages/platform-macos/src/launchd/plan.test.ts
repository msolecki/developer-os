import {
  MAX_LAUNCHD_EFFECT_JOURNAL_BYTES,
  SCHEDULED_JOB_IDS,
  decodeCanonicalJson,
  type AutomationConfigV1,
  type CanonicalAbsolutePathV1,
  type EffectiveUidV1,
  type FoundationTransactionIdV1,
  type LaunchdEffectIdV1,
  type LifecycleCoordinatorIdV1,
  type LifecycleCoordinatorPlanCoreV1,
  type LowerHexSha256,
  type ScheduledJobIdV1,
  type UInt64DecimalV1,
} from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { launchdEffectPlanHash, maximumLaunchdEffectJournalBytes } from "./effect-journal.js";
import {
  LAUNCHD_PLAN_CODEC,
  assertLaunchdPlanBindings,
  launchdEffectPlan,
  launchdEntryTransitions,
  launchdPlanVariant,
  launchdPlistBytesHash,
  parseCanonicalLaunchdPlist,
  planLaunchdTransitions,
  type LaunchdBootstrapPlistsV1,
  type LaunchdCoordinatorOperationV1,
  type LaunchdPlanV1,
  type LaunchdTransitionRequestV1,
  type LifecycleFileBindingV1,
} from "./plan.js";
import { buildLaunchdPlanPreview, encodeLaunchdPlist, launchdPlistDictionary } from "./plist.js";
import {
  generatedLabel,
  launchdGeneration,
  launchdGuiDomain,
  launchdLogPath,
  launchdPlistPath,
  launchdStatusPath,
  parseScheduledProductHome,
  scheduledBaseArgv,
} from "./registry.js";
import type { LaunchdBootstrapPlistIdentityV1 } from "./snapshot.js";
import { LaunchdInputError, type LaunchdPlanPreviewEntryV1, type LaunchdPlanPreviewV1, type LaunchdPriorJobStateV1 } from "./types.js";

const uid = 501 as EffectiveUidV1;
const domain = launchdGuiDomain(uid);
const userHome = "/Users/synthetic user" as CanonicalAbsolutePathV1;
const productHome = parseScheduledProductHome("/Users/synthetic user/.developer-os");
const executablePath = "/Users/synthetic user/.developer-os/bin/developer-os" as CanonicalAbsolutePathV1;
const NONCE = "a".repeat(64);
const COORDINATOR = `lc_${NONCE}_1` as LifecycleCoordinatorIdV1;
const TX_PLIST = `tx_${NONCE}_2` as FoundationTransactionIdV1;
const TX_ACTIVATION = `tx_${NONCE}_4` as FoundationTransactionIdV1;
const TX_CONFIG = `tx_${NONCE}_6` as FoundationTransactionIdV1;
const BEFORE_EFFECT = `le_${NONCE}_8` as LaunchdEffectIdV1;
const AFTER_EFFECT = `le_${NONCE}_9` as LaunchdEffectIdV1;
const PROCESS_TABLE_HASH = "3".repeat(64) as LowerHexSha256;
const PREVIEW_HASH = "4".repeat(64) as LowerHexSha256;
const OLD_FILE_HASH = "5".repeat(64) as LowerHexSha256;
const OLD_GENERATION = "6".repeat(64) as LowerHexSha256;
const CONFIG_PATH = "/Users/synthetic user/.developer-os/config.toml" as CanonicalAbsolutePathV1;
const ACTIVATION_PATH = "/Users/synthetic user/.developer-os/state/lifecycle-activation.json" as CanonicalAbsolutePathV1;
const MANIFEST_PATH = "/Users/synthetic user/.developer-os/manifest.json" as CanonicalAbsolutePathV1;
const encoder = new TextEncoder();

const daily = { cadence: "daily", hour: 2, minute: 0 } as const;
const hourly = { cadence: "hourly", minute: 15 } as const;

function automation(schedules: Partial<Record<ScheduledJobIdV1, typeof daily | typeof hourly>>): AutomationConfigV1 {
  return {
    schemaVersion: 1,
    schedules: SCHEDULED_JOB_IDS.flatMap((job) => {
      const schedule = schedules[job];
      return schedule === undefined ? [] : [{ job, schedule }];
    }),
  };
}

const absent: LaunchdPriorJobStateV1 = { beforeFileHash: null, beforeGeneration: null, beforeLiveState: { state: "unloaded" } };

function prior(overrides: Partial<Record<ScheduledJobIdV1, LaunchdPriorJobStateV1>> = {}): Record<ScheduledJobIdV1, LaunchdPriorJobStateV1> {
  return Object.fromEntries(SCHEDULED_JOB_IDS.map((job) => [job, overrides[job] ?? absent])) as Record<ScheduledJobIdV1, LaunchdPriorJobStateV1>;
}

function preview(target: AutomationConfigV1 | null, retained: Partial<Record<ScheduledJobIdV1, LaunchdPriorJobStateV1>> = {}): LaunchdPlanPreviewV1 {
  return buildLaunchdPlanPreview({
    observationProcessTableHash: "1".repeat(64) as LowerHexSha256,
    mutationProcessTableTemplateHash: "2".repeat(64) as LowerHexSha256,
    domain,
    userHome,
    productHome,
    executablePath,
    automation: target,
    prior: prior(retained),
  });
}

/** What a job looks like once `schedule` is installed: its retained hash and generation. */
function installedAt(job: ScheduledJobIdV1, schedule: typeof daily | typeof hourly, live: "loaded" | "unloaded"): LaunchdPriorJobStateV1 {
  const [entry] = preview(automation({ [job]: schedule })).entries;
  if (entry?.generation == null || entry.plistBytes === null || entry.generatedLabel === null) throw new Error("fixture");
  return {
    beforeFileHash: launchdPlistBytesHash(entry.plistBytes),
    beforeGeneration: entry.generation,
    beforeLiveState: live === "loaded" ? { state: "loaded", label: entry.generatedLabel, generation: entry.generation } : { state: "unloaded" },
  };
}

function retainedOld(job: ScheduledJobIdV1, live: "loaded" | "unloaded"): LaunchdPriorJobStateV1 {
  return {
    beforeFileHash: OLD_FILE_HASH,
    beforeGeneration: OLD_GENERATION,
    beforeLiveState: live === "loaded" ? { state: "loaded", label: generatedLabel(job, OLD_GENERATION), generation: OLD_GENERATION } : { state: "unloaded" },
  };
}

function identity(entry: LaunchdPlanPreviewEntryV1, arm: "before" | "after"): LaunchdBootstrapPlistIdentityV1 {
  const bytes = arm === "after" && entry.plistBytes !== null ? encoder.encode(entry.plistBytes) : null;
  return {
    path: entry.plistPath,
    ownerUid: uid,
    mode: 384,
    nlink: 1,
    size: bytes?.byteLength ?? 1024,
    hash: bytes === null ? (entry.beforeFileHash as LowerHexSha256) : launchdPlistBytesHash(entry.plistBytes as string),
    dev: "16777220" as UInt64DecimalV1,
    ino: arm === "after" ? ("900001" as UInt64DecimalV1) : ("900002" as UInt64DecimalV1),
  };
}

function bootstrapArms(entry: LaunchdPlanPreviewEntryV1): LaunchdBootstrapPlistsV1 {
  if (entry.operation === "keep") {
    const retained = identity(entry, "after");
    return { before: retained, after: retained };
  }
  const reloads = entry.beforeLiveState.state === "loaded";
  return {
    before: reloads ? identity(entry, "before") : null,
    after: entry.operation === "remove" ? null : identity(entry, "after"),
  };
}

function binding(participantId: FoundationTransactionIdV1 | null, targetPath: CanonicalAbsolutePathV1, before: string | null, after: string | null): LifecycleFileBindingV1 {
  return {
    participantId,
    targetPath,
    expectedBeforeHash: before as LowerHexSha256 | null,
    afterHash: after as LowerHexSha256 | null,
  };
}

function transitionRequest(operation: LaunchdCoordinatorOperationV1, planPreview: LaunchdPlanPreviewV1): LaunchdTransitionRequestV1 {
  const liveOnly = operation === "automation_reconcile" && planPreview.entries.every((entry) => entry.operation === "keep");
  const plistFiles = planPreview.entries
    .filter((entry) => entry.operation !== "keep")
    .map((entry) => binding(liveOnly ? null : TX_PLIST, entry.plistPath, entry.beforeFileHash, entry.plistBytes === null ? null : launchdPlistBytesHash(entry.plistBytes)))
    .sort((left, right) => (left.targetPath < right.targetPath ? -1 : 1));
  return {
    coordinatorId: COORDINATOR,
    coordinatorOperation: operation,
    previewHash: operation === "uninstall" ? null : PREVIEW_HASH,
    processTableHash: PROCESS_TABLE_HASH,
    preview: planPreview,
    config: liveOnly ? binding(null, CONFIG_PATH, "7".repeat(64), "7".repeat(64)) : binding(TX_CONFIG, CONFIG_PATH, "7".repeat(64), "8".repeat(64)),
    activation: liveOnly ? binding(null, ACTIVATION_PATH, "9".repeat(64), "9".repeat(64)) : binding(TX_ACTIVATION, ACTIVATION_PATH, "9".repeat(64), "a".repeat(64)),
    plistFiles,
    manifest: {
      path: MANIFEST_PATH,
      statePlanHash: liveOnly ? null : ("b".repeat(64) as LowerHexSha256),
      before: { state: "present", hash: "c".repeat(64) as LowerHexSha256 },
      after: { state: "present", hash: (liveOnly ? "c" : "d").repeat(64) as LowerHexSha256 },
    },
    beforeFilesEffectId: operation === "automation_enable" || liveOnly ? null : BEFORE_EFFECT,
    afterFilesEffectId: operation === "automation_disable" || operation === "uninstall" ? null : AFTER_EFFECT,
    bootstrapPlists: Object.fromEntries(planPreview.entries.map((entry) => [entry.job, bootstrapArms(entry)])),
  };
}

function launchdPlanFixture(operation: LaunchdCoordinatorOperationV1, planPreview: LaunchdPlanPreviewV1): LaunchdPlanV1 {
  return planLaunchdTransitions(transitionRequest(operation, planPreview));
}

function roundTrip(plan: LaunchdPlanV1): LaunchdPlanV1 {
  const bytes = encoder.encode(LAUNCHD_PLAN_CODEC.encode(plan));
  return LAUNCHD_PLAN_CODEC.validate(decodeCanonicalJson(bytes, 16_777_216));
}

function tampered(plan: LaunchdPlanV1, mutate: (value: Record<string, unknown>) => void): unknown {
  const value = JSON.parse(LAUNCHD_PLAN_CODEC.encode(plan)) as Record<string, unknown>;
  mutate(value);
  return value;
}

const rows = [
  { name: "install from unloaded", retained: absent, target: daily, operation: "install", unload: false, load: true },
  { name: "replace from loaded old generation", retained: retainedOld("doctor", "loaded"), target: daily, operation: "replace", unload: true, load: true },
  { name: "replace from unloaded", retained: retainedOld("doctor", "unloaded"), target: daily, operation: "replace", unload: false, load: true },
  { name: "keep already loaded at new generation", retained: installedAt("doctor", daily, "loaded"), target: daily, operation: "keep", unload: false, load: false },
  { name: "keep but currently unloaded", retained: installedAt("doctor", daily, "unloaded"), target: daily, operation: "keep", unload: false, load: true },
  { name: "remove from loaded old generation", retained: retainedOld("doctor", "loaded"), target: null, operation: "remove", unload: true, load: false },
  { name: "remove from unloaded", retained: retainedOld("doctor", "unloaded"), target: null, operation: "remove", unload: false, load: false },
] as const;

describe("the exhaustive §5.3 file/live table", () => {
  it.each(rows)("$name", ({ retained, target, operation, unload, load }) => {
    const [entry] = preview(target === null ? null : automation({ doctor: target }), { doctor: retained }).entries;
    expect(entry?.operation).toBe(operation);
    const transitions = launchdEntryTransitions(entry as LaunchdPlanPreviewEntryV1);

    expect(transitions.unload !== null).toBe(unload);
    expect(transitions.load !== null).toBe(load);
    if (transitions.unload !== null) {
      expect(transitions.unload).toStrictEqual({
        job: "doctor",
        label: generatedLabel("doctor", OLD_GENERATION),
        generation: OLD_GENERATION,
        domain,
        plistPath: entry?.plistPath,
        plistHash: OLD_FILE_HASH,
        before: { state: "loaded", label: generatedLabel("doctor", OLD_GENERATION), generation: OLD_GENERATION },
        after: { state: "unloaded" },
      });
    }
    if (transitions.load !== null) {
      expect(transitions.load.before).toStrictEqual({ state: "unloaded" });
      expect(transitions.load.after).toStrictEqual({ state: "loaded", label: entry?.generatedLabel, generation: entry?.generation });
      expect(transitions.load.plistHash).toBe(launchdPlistBytesHash(entry?.plistBytes as string));
    }
  });

  it("has no loaded→loaded transition: replace splits into P unload old and Q load new", () => {
    const [entry] = preview(automation({ doctor: daily }), { doctor: retainedOld("doctor", "loaded") }).entries;
    const { unload, load } = launchdEntryTransitions(entry as LaunchdPlanPreviewEntryV1);
    expect([unload?.before.state, unload?.after.state, load?.before.state, load?.after.state]).toStrictEqual(["loaded", "unloaded", "unloaded", "loaded"]);
  });

  it("refuses a keep loaded at a generation other than its postimage", () => {
    const [entry] = preview(automation({ doctor: daily }), { doctor: installedAt("doctor", daily, "unloaded") }).entries;
    const wrong = { ...(entry as LaunchdPlanPreviewEntryV1), beforeLiveState: { state: "loaded" as const, label: generatedLabel("doctor", OLD_GENERATION), generation: OLD_GENERATION } };
    expect(() => launchdEntryTransitions(wrong)).toThrow(LaunchdInputError);
  });

  it("refuses an install over a loaded job and a remove with no retained plist", () => {
    const [install] = preview(automation({ doctor: daily })).entries;
    const loaded = { ...(install as LaunchdPlanPreviewEntryV1), beforeLiveState: { state: "loaded" as const, label: generatedLabel("doctor", OLD_GENERATION), generation: OLD_GENERATION } };
    expect(() => launchdEntryTransitions(loaded)).toThrow(LaunchdInputError);
    const [remove] = preview(null, { doctor: retainedOld("doctor", "unloaded") }).entries;
    expect(() => launchdEntryTransitions({ ...(remove as LaunchdPlanPreviewEntryV1), beforeFileHash: null })).toThrow(LaunchdInputError);
  });
});

describe("planLaunchdTransitions", () => {
  const mixed = preview(automation({ "brain-reindex": daily, "brain-lint": hourly, doctor: daily }), {
    "brain-reindex": retainedOld("brain-reindex", "loaded"),
    "brain-lint": installedAt("brain-lint", hourly, "unloaded"),
    doctor: installedAt("doctor", daily, "loaded"),
    "git-sync": retainedOld("git-sync", "loaded"),
  });

  it("keeps Task 4's remove of a retained job the target no longer schedules, including git-sync", () => {
    expect(mixed.entries.map((entry) => [entry.job, entry.operation])).toStrictEqual([
      ["brain-reindex", "replace"],
      ["brain-lint", "keep"],
      ["doctor", "keep"],
      ["git-sync", "remove"],
    ]);
  });

  it("puts every unload in before_files and every load in after_files, in registry order", () => {
    const plan = launchdPlanFixture("automation_reconcile", mixed);
    const before = launchdEffectPlan(plan, "before_files");
    const after = launchdEffectPlan(plan, "after_files");

    expect(launchdPlanVariant(plan)).toBe("automation_reconcile/files");
    expect(before?.transitions.map((transition) => transition.job)).toStrictEqual(["brain-reindex", "git-sync"]);
    expect(before?.transitions.every((transition) => transition.after.state === "unloaded")).toBe(true);
    expect(after?.transitions.map((transition) => transition.job)).toStrictEqual(["brain-reindex", "brain-lint"]);
    expect(after?.transitions.every((transition) => transition.before.state === "unloaded")).toBe(true);
    expect(plan.beforeFilesEffect).toStrictEqual({ id: BEFORE_EFFECT, planHash: launchdEffectPlanHash(before as NonNullable<typeof before>) });
    expect(plan.afterFilesEffect).toStrictEqual({ id: AFTER_EFFECT, planHash: launchdEffectPlanHash(after as NonNullable<typeof after>) });
  });

  it("binds the exact journal maximum, which is feasible at 1 MiB", () => {
    const plan = launchdPlanFixture("automation_reconcile", mixed);
    for (const position of ["before_files", "after_files"] as const) {
      const effect = launchdEffectPlan(plan, position);
      expect(effect).not.toBeNull();
      expect(effect?.maximumJournalBytes).toBe(maximumLaunchdEffectJournalBytes(effect as NonNullable<typeof effect>));
      expect(effect?.maximumJournalBytes).toBeLessThanOrEqual(MAX_LAUNCHD_EFFECT_JOURNAL_BYTES);
    }
  });

  it("keeps a zero-transition effect as a real hash-bound participant", () => {
    const plan = launchdPlanFixture("automation_disable", preview(null, { doctor: retainedOld("doctor", "unloaded") }));
    const before = launchdEffectPlan(plan, "before_files");
    expect(before?.transitions).toStrictEqual([]);
    expect(plan.beforeFilesEffect?.planHash).toBe(launchdEffectPlanHash(before as NonNullable<typeof before>));
    expect(plan.afterFilesEffect).toBeNull();
  });

  it("derives live_only when every entry keeps its bytes and no file participant exists", () => {
    const keep = preview(automation({ doctor: daily }), { doctor: installedAt("doctor", daily, "unloaded") });
    const plan = launchdPlanFixture("automation_reconcile", keep);
    expect(launchdPlanVariant(plan)).toBe("automation_reconcile/live_only");
    expect(plan.beforeFilesEffect).toBeNull();
    expect(plan.plistFiles).toStrictEqual([]);
    expect(launchdEffectPlan(plan, "after_files")?.transitions.map((transition) => transition.job)).toStrictEqual(["doctor"]);
  });

  it.each([
    ["enable with an unload", "automation_enable" as const, () => preview(automation({ doctor: daily }), { doctor: retainedOld("doctor", "loaded") })],
    ["disable with a load", "automation_disable" as const, () => preview(automation({ doctor: daily }))],
    ["uninstall with a keep", "uninstall" as const, () => preview(automation({ doctor: daily }), { doctor: installedAt("doctor", daily, "loaded") })],
  ])("refuses %s", (_name, operation, build) => {
    expect(() => launchdPlanFixture(operation, build())).toThrow(LaunchdInputError);
  });

  it("refuses a files reconcile without a plist mutation and a live_only with a changed config", () => {
    const keep = preview(automation({ doctor: daily }), { doctor: installedAt("doctor", daily, "loaded") });
    const request = transitionRequest("automation_reconcile", keep);
    expect(() => planLaunchdTransitions({ ...request, config: binding(TX_CONFIG, CONFIG_PATH, "7".repeat(64), "8".repeat(64)) })).toThrow(LaunchdInputError);
    expect(() => planLaunchdTransitions({ ...request, config: binding(null, CONFIG_PATH, "7".repeat(64), "8".repeat(64)) })).toThrow(LaunchdInputError);
  });

  it("refuses an effect arm the variant omits or a missing one it requires", () => {
    const request = transitionRequest("automation_enable", preview(automation({ doctor: daily })));
    expect(() => planLaunchdTransitions({ ...request, beforeFilesEffectId: BEFORE_EFFECT })).toThrow(LaunchdInputError);
    expect(() => planLaunchdTransitions({ ...request, afterFilesEffectId: null })).toThrow(LaunchdInputError);
  });

  it("refuses bootstrap identities outside the before/after arm rule", () => {
    const install = preview(automation({ doctor: daily }));
    const request = transitionRequest("automation_enable", install);
    const [entry] = install.entries;
    const arms = request.bootstrapPlists.doctor as LaunchdBootstrapPlistsV1;
    expect(() => planLaunchdTransitions({ ...request, bootstrapPlists: { doctor: { ...arms, after: null } } })).toThrow(LaunchdInputError);
    expect(() =>
      planLaunchdTransitions({ ...request, bootstrapPlists: { doctor: { ...arms, before: identity(entry as LaunchdPlanPreviewEntryV1, "after") } } }),
    ).toThrow(LaunchdInputError);
    expect(() =>
      planLaunchdTransitions({ ...request, bootstrapPlists: { doctor: { ...arms, after: { ...(arms.after as LaunchdBootstrapPlistIdentityV1), hash: OLD_FILE_HASH } } } }),
    ).toThrow(LaunchdInputError);
  });

  it("refuses plist file bindings that are unsorted, missing, or not their entry's mutation", () => {
    const request = transitionRequest("automation_enable", preview(automation({ "brain-lint": hourly, doctor: daily })));
    expect(request.plistFiles.length).toBe(2);
    expect(() => planLaunchdTransitions({ ...request, plistFiles: [...request.plistFiles].reverse() })).toThrow(LaunchdInputError);
    expect(() => planLaunchdTransitions({ ...request, plistFiles: request.plistFiles.slice(1) })).toThrow(LaunchdInputError);
    const [first, second] = request.plistFiles as [LifecycleFileBindingV1, LifecycleFileBindingV1];
    expect(() => planLaunchdTransitions({ ...request, plistFiles: [{ ...first, afterHash: OLD_FILE_HASH }, second] })).toThrow(LaunchdInputError);
  });
});

describe("LAUNCHD_PLAN_CODEC", () => {
  const plan = launchdPlanFixture(
    "automation_reconcile",
    preview(automation({ doctor: hourly }), { doctor: retainedOld("doctor", "loaded"), "git-sync": retainedOld("git-sync", "unloaded") }),
  );

  it("round-trips byte-identically", () => {
    expect(LAUNCHD_PLAN_CODEC.encode(roundTrip(plan))).toBe(LAUNCHD_PLAN_CODEC.encode(plan));
  });

  const firstEntry = (value: Record<string, unknown>): Record<string, unknown> => (value.entries as Record<string, unknown>[])[0] ?? {};
  it.each([
    ["an unknown key", (value: Record<string, unknown>) => { value.extra = true; }],
    ["a different planHash", (value: Record<string, unknown>) => { value.planHash = "e".repeat(64); }],
    ["a recalculated generation", (value: Record<string, unknown>) => { firstEntry(value).generation = "e".repeat(64); }],
    ["drifted plist bytes", (value: Record<string, unknown>) => { firstEntry(value).plistBytes = "x\n"; }],
    ["an alternate effect plan hash", (value: Record<string, unknown>) => { (value.afterFilesEffect as Record<string, unknown>).planHash = "e".repeat(64); }],
    ["a non-gui domain", (value: Record<string, unknown>) => { firstEntry(value).domain = "user/501"; }],
  ])("refuses %s", (_name, mutate) => {
    expect(() => LAUNCHD_PLAN_CODEC.validate(tampered(plan, mutate))).toThrow();
  });
});

describe("assertLaunchdPlanBindings", () => {
  const plan = launchdPlanFixture("automation_enable", preview(automation({ doctor: daily })));
  const [plist] = plan.plistFiles as [LifecycleFileBindingV1];
  const mutation = (bound: LifecycleFileBindingV1) => ({
    targetPath: bound.targetPath,
    operation: bound.expectedBeforeHash === null ? "create" : "replace",
    expectedBeforeHash: bound.expectedBeforeHash,
    contentHash: bound.afterHash,
    contentSize: 1,
    stagedPath: null,
  });
  const ref = (id: FoundationTransactionIdV1, bound: LifecycleFileBindingV1) => ({ id, slot: "config", role: { kind: "forward", compensationId: null }, mutations: [mutation(bound)] });
  const coordinator = (overrides: Record<string, unknown> = {}) =>
    ({
      id: COORDINATOR,
      previewHash: PREVIEW_HASH,
      operation: "automation_enable",
      authority: { productHome, configPath: CONFIG_PATH, activationPath: ACTIVATION_PATH, manifestPath: MANIFEST_PATH, repositoryRoot: null, plistPaths: [plist.targetPath] },
      participants: {
        foundation: [ref(TX_PLIST, plist), ref(TX_ACTIVATION, plan.activation as LifecycleFileBindingV1), ref(TX_CONFIG, plan.config)],
        launchd: JSON.parse(LAUNCHD_PLAN_CODEC.encode(plan)) as unknown,
        launchdBeforeFiles: null,
        launchdAfterFiles: plan.afterFilesEffect,
      },
      ...overrides,
    }) as unknown as LifecycleCoordinatorPlanCoreV1<unknown, LaunchdPlanV1, unknown, unknown>;

  it("accepts the embedding coordinator whose Foundation mutations match every binding", () => {
    expect(() => { assertLaunchdPlanBindings(plan, coordinator()); }).not.toThrow();
  });

  it("refuses another coordinator, operation, preview hash or plist authority", () => {
    expect(() => { assertLaunchdPlanBindings(plan, coordinator({ id: `lc_${NONCE}_77` })); }).toThrow(LaunchdInputError);
    expect(() => { assertLaunchdPlanBindings(plan, coordinator({ operation: "automation_disable" })); }).toThrow(LaunchdInputError);
    expect(() => { assertLaunchdPlanBindings(plan, coordinator({ previewHash: null })); }).toThrow(LaunchdInputError);
    const authority = { productHome, configPath: CONFIG_PATH, activationPath: ACTIVATION_PATH, manifestPath: MANIFEST_PATH, repositoryRoot: null, plistPaths: [] };
    expect(() => { assertLaunchdPlanBindings(plan, coordinator({ authority })); }).toThrow(LaunchdInputError);
  });

  it("refuses a binding whose Foundation mutation has another after hash", () => {
    const broken = coordinator();
    const foundation = (broken.participants.foundation as unknown as { mutations: { contentHash: string }[] }[])[0];
    if (foundation?.mutations[0] !== undefined) foundation.mutations[0].contentHash = OLD_FILE_HASH;
    expect(() => { assertLaunchdPlanBindings(plan, broken); }).toThrow(LaunchdInputError);
  });
});

describe("parseCanonicalLaunchdPlist", () => {
  it("reconstructs the exact dictionary of a canonical plist, escaping included", () => {
    const hostile = parseScheduledProductHome("/Users/a b/&<\"é>/.developer-os");
    const projection = {
      job: "doctor" as const,
      baseLabel: "com.developer-os.doctor" as const,
      domain,
      schedule: daily,
      productHome: hostile,
      plistPath: launchdPlistPath(userHome, "doctor"),
      executablePath,
      baseArgv: scheduledBaseArgv("doctor", hostile, executablePath),
      logPath: launchdLogPath(hostile, "doctor"),
      statusPath: launchdStatusPath(hostile, "doctor"),
    };
    const dictionary = launchdPlistDictionary(projection, launchdGeneration(projection));
    const text = encodeLaunchdPlist(dictionary);
    expect(text).toContain("&amp;&lt;\"é&gt;");
    expect(parseCanonicalLaunchdPlist(encoder.encode(text))).toStrictEqual(dictionary);
  });

  it("refuses semantically equal but differently serialized bytes", () => {
    const [entry] = preview(automation({ doctor: daily })).entries;
    const text = entry?.plistBytes as string;
    expect(parseCanonicalLaunchdPlist(encoder.encode(text))).toBeDefined();
    expect(() => parseCanonicalLaunchdPlist(encoder.encode(text.replace("  <dict>", "\t<dict>")))).toThrow(LaunchdInputError);
    expect(() => parseCanonicalLaunchdPlist(encoder.encode(text.replace("</plist>", "</plist>\n<!-- x -->")))).toThrow(LaunchdInputError);
    expect(() => parseCanonicalLaunchdPlist(new Uint8Array([0xff, 0xfe]))).toThrow(LaunchdInputError);
  });
});
