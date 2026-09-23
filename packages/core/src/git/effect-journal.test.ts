import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { encodeCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import { MAX_GIT_EFFECT_JOURNAL_BYTES, parseEffectStagingChildren } from "../lifecycle/effect-ledger.js";
import { formatAllocatedLifecycleId, parseLifecycleCoordinatorId } from "../lifecycle/ids.js";
import { UID } from "../lifecycle/testing.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  parseLowerHexSha256,
  parseUInt64Decimal,
  parseUtcTimestamp,
  type LowerHexSha256,
} from "../update/scalars.js";
import {
  GIT_EFFECT_PHASES,
  assertGitEffectJournalForPlan,
  createGitEffectLedgerCodec,
  gitEffectForwardObservation,
  gitEffectStagingChildren,
  maximumGitEffectJournalBytes,
  relinquishedObjectObservation,
  validateGitEffectJournal,
  validateGitEffectPlan,
  type GitEffectJournalV1,
  type GitEffectPhaseV1,
  type GitEffectPlanV1,
} from "./effect-journal.js";
import type { GitEffectTransitionV1 } from "./planner.js";

const NONCE = parseLowerHexSha256("5e".repeat(32));
const COORDINATOR = parseLifecycleCoordinatorId(formatAllocatedLifecycleId("lc", NONCE, 1n), NONCE);
const EFFECT = formatAllocatedLifecycleId("ge", NONCE, 2n);
const WORKTREE = parseCanonicalAbsolutePathText("/synthetic/brain");
const GIT = parseCanonicalAbsolutePathText("/synthetic/brain/.git");
const QUARANTINE = parseCanonicalAbsolutePathText(
  `/synthetic/home/staging/lifecycle/${COORDINATOR}/git/source/${EFFECT}`,
);
const AT = parseUtcTimestamp("2026-09-23T12:00:00.000Z");
const HASH = parseLowerHexSha256("0".repeat(64));

function sha256(text: string): LowerHexSha256 {
  return parseLowerHexSha256(createHash("sha256").update(text).digest("hex"));
}

function path(relative: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${GIT}/${relative}`);
}

function evidence(root: "post" | "before" | "after", index: number): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${QUARANTINE}/${root}/${index.toString(10)}`);
}

let nextIno = 100n;
function guarded(bytes: string, mode: number) {
  nextIno += 1n;
  return {
    state: "regular_file" as const,
    hash: sha256(bytes),
    size: Buffer.byteLength(bytes),
    mode,
    dev: parseUInt64Decimal("16777220"),
    ino: parseUInt64Decimal(nextIno.toString(10)),
    semantic: { kind: "none" as const },
  };
}

function planned(bytes: string, mode: number) {
  return { state: "regular_file" as const, hash: sha256(bytes), size: Buffer.byteLength(bytes), mode, semantic: { kind: "none" as const } };
}

function objectCreate(index: number): GitEffectTransitionV1 {
  const bytes = `loose-object-${index.toString(10)}`;
  const name = index.toString(16).padStart(40, "0");
  return {
    role: "source_object",
    path: path(`objects/${name.slice(0, 2)}/${name.slice(2)}`),
    operation: "create",
    before: { state: "absent" },
    after: planned(bytes, 0o444),
    evidence: {
      stagedPostimagePath: evidence("post", index),
      stagedPostimage: guarded(bytes, 0o444),
      beforeTombstonePath: null,
      afterTombstonePath: null,
    },
  };
}

function configReplace(index: number): GitEffectTransitionV1 {
  return {
    role: "source_config",
    path: path("config"),
    operation: "replace",
    before: guarded("[core]\n", 0o644),
    after: planned("[core]\n[remote]\n", 0o644),
    evidence: {
      stagedPostimagePath: evidence("post", index),
      stagedPostimage: guarded("[core]\n[remote]\n", 0o644),
      beforeTombstonePath: evidence("before", index),
      afterTombstonePath: evidence("after", index),
    },
  };
}

function buildPlan(transitions: readonly GitEffectTransitionV1[]): GitEffectPlanV1 {
  const unbound: Omit<GitEffectPlanV1, "maximumJournalBytes"> = {
    schemaVersion: 1,
    id: EFFECT,
    coordinatorId: COORDINATOR,
    side: "source",
    worktreeRoot: WORKTREE,
    gitDirectory: GIT,
    quarantineRoot: QUARANTINE,
    processTableHash: HASH,
    planningTranscriptHash: HASH,
    reflogPlan: null,
    packReaderBudget: null,
    pushSourceProjection: null,
    transitions,
  };
  return { ...unbound, maximumJournalBytes: maximumGitEffectJournalBytes(unbound) };
}

function roundTrip(value: unknown): unknown {
  return JSON.parse(encodeCanonicalJson(value as CanonicalJsonValue)) as unknown;
}

function journal(plan: GitEffectPlanV1, patch: Partial<GitEffectJournalV1>): GitEffectJournalV1 {
  return {
    schemaVersion: 1,
    id: plan.id,
    coordinatorId: plan.coordinatorId,
    phase: "planned",
    planHash: HASH,
    nextTransition: 0,
    compensationNext: null,
    observations: [],
    createdAt: AT,
    updatedAt: AT,
    ...patch,
  };
}

function forward(plan: GitEffectPlanV1, count: number) {
  return Array.from({ length: count }, (_, index) => gitEffectForwardObservation(plan, index));
}

describe("GitEffectPlanV1", () => {
  const plan = buildPlan([objectCreate(0), objectCreate(1), configReplace(2)]);

  it("validates its own canonical encoding", () => {
    expect(validateGitEffectPlan(roundTrip(plan), UID)).toEqual(plan);
    const codec = createGitEffectLedgerCodec(UID);
    expect(codec.plan.encode(codec.plan.validate(roundTrip(plan)))).toBe(encodeCanonicalJson(plan as unknown as CanonicalJsonValue));
  });

  it.each([
    ["a maximum the plan does not derive", { ...plan, maximumJournalBytes: plan.maximumJournalBytes + 1 }],
    ["a quarantine outside the coordinator staging", { ...plan, quarantineRoot: "/synthetic/elsewhere" }],
    ["a destination role on a source effect", {
      ...plan,
      transitions: [{ ...objectCreate(0), role: "destination_pack" }],
    }],
    ["an after tombstone on a relinquishable create", {
      ...plan,
      transitions: [{ ...objectCreate(0), evidence: { ...objectCreate(0).evidence, afterTombstonePath: evidence("after", 0) } }],
    }],
    ["a replace without its before tombstone", {
      ...plan,
      transitions: [{ ...configReplace(0), evidence: { ...configReplace(0).evidence, beforeTombstonePath: null } }],
    }],
    ["a staged path at another index", {
      ...plan,
      transitions: [{ ...objectCreate(0), evidence: { ...objectCreate(0).evidence, stagedPostimagePath: evidence("post", 7) } }],
    }],
    ["a relinquishable create after a control transition", { ...plan, transitions: [configReplace(0), objectCreate(1)] }],
    ["a path outside the Git directory", { ...plan, transitions: [{ ...objectCreate(0), path: "/synthetic/brain/note.md" }] }],
  ])("refuses %s", (_name, candidate) => {
    expect(() => validateGitEffectPlan(roundTrip(candidate), UID)).toThrow();
  });

  it("lists every evidence root and leaf with its parent", () => {
    const children = gitEffectStagingChildren(plan);
    expect(children.length).toBeGreaterThan(0);
    expect([...parseEffectStagingChildren(children)].sort()).toEqual(
      ["after", "after/2", "before", "before/2", "post", "post/0", "post/1", "post/2"].sort(),
    );
  });
});

describe("the enable tree's staging children", () => {
  it("lists every unpublished .git entry under its post leaf, including a slash branch's parents", () => {
    const tree = {
      treeHash: HASH,
      entryCount: 266,
      ownerUid: UID,
      mode: 0o755,
      symbolicHead: "refs/heads/team/brain" as const,
    };
    const transition = {
      role: "source_git_directory_tree",
      path: GIT,
      operation: "create",
      before: { state: "absent" },
      after: { state: "directory_tree", ...tree },
      evidence: {
        stagedPostimagePath: evidence("post", 0),
        stagedPostimage: { state: "directory_tree", ...tree, dev: parseUInt64Decimal("16777220"), ino: parseUInt64Decimal("9") },
        beforeTombstonePath: null,
        afterTombstonePath: null,
      },
    } as unknown as GitEffectTransitionV1;
    const children = [...parseEffectStagingChildren(gitEffectStagingChildren(buildPlan([transition])))];
    expect(children.length).toBeGreaterThan(0);
    expect(children).toEqual(
      expect.arrayContaining([
        "post",
        "post/0",
        "post/0/HEAD",
        "post/0/config",
        "post/0/objects/00",
        "post/0/objects/ff",
        "post/0/refs/heads/team",
        "post/0/logs/refs/heads/team",
      ]),
    );
    expect(children).toHaveLength(2 + 266);
  });
});

describe("journal feasibility", () => {
  it("bounds the widest reachable journal of a feasible plan", () => {
    const transitions = Array.from({ length: 1000 }, (_, index) => objectCreate(index));
    const plan = buildPlan(transitions);
    const widest = journal(plan, {
      phase: "compensating",
      nextTransition: transitions.length,
      compensationNext: transitions.length - 1,
      observations: forward(plan, transitions.length).map((observation, index) =>
        index === transitions.length - 1 ? relinquishedObjectObservation(plan, index) : observation,
      ),
      planHash: parseLowerHexSha256("f".repeat(64)),
    });
    const bytes = Buffer.byteLength(encodeCanonicalJson(widest as unknown as CanonicalJsonValue));
    expect(bytes).toBeLessThanOrEqual(plan.maximumJournalBytes);
    expect(plan.maximumJournalBytes).toBeLessThanOrEqual(MAX_GIT_EFFECT_JOURNAL_BYTES);
  });

  it("refuses a plan whose journal could exceed 16 MiB", () => {
    const transitions = Array.from({ length: 200_001 }, (_, index) => objectCreate(index));
    const unbound = { ...buildPlan([]), transitions };
    const maximum = maximumGitEffectJournalBytes(unbound);
    expect(maximum).toBeGreaterThan(MAX_GIT_EFFECT_JOURNAL_BYTES);
    const small = buildPlan([objectCreate(0)]);
    expect(() =>
      validateGitEffectPlan(roundTrip({ ...small, maximumJournalBytes: MAX_GIT_EFFECT_JOURNAL_BYTES + 1 }), UID),
    ).toThrow();
  });
});

describe("GitEffectJournalV1", () => {
  const plan = buildPlan([objectCreate(0), objectCreate(1), configReplace(2)]);

  it.each<[GitEffectPhaseV1, Partial<GitEffectJournalV1>]>([
    ["planned", {}],
    ["validated", {}],
    ["applied", { nextTransition: 2, observations: forward(plan, 2) }],
    ["verified", { nextTransition: 3, observations: forward(plan, 3) }],
    ["compensating", { nextTransition: 3, compensationNext: 1, observations: forward(plan, 3) }],
    ["rolled_back", {
      nextTransition: 3,
      compensationNext: -1,
      observations: [relinquishedObjectObservation(plan, 0), relinquishedObjectObservation(plan, 1), gitEffectForwardObservation(plan, 2)],
    }],
    ["finalized", { nextTransition: 3, observations: forward(plan, 3) }],
  ])("admits the %s row", (phase, patch) => {
    const value = journal(plan, { ...patch, phase });
    const validated = validateGitEffectJournal(roundTrip(value), UID);
    expect(() => { assertGitEffectJournalForPlan(plan, validated); }).not.toThrow();
  });

  it.each<[string, Partial<GitEffectJournalV1>]>([
    ["a pre-apply cursor", { phase: "staged", nextTransition: 1, observations: forward(plan, 1) }],
    ["a cursor without observations", { phase: "applied", nextTransition: 2, observations: forward(plan, 1) }],
    ["a compensation cursor outside compensation", { phase: "verified", nextTransition: 3, compensationNext: 1, observations: forward(plan, 3) }],
    ["a compensation cursor at the forward cursor", { phase: "compensating", nextTransition: 2, compensationNext: 2, observations: forward(plan, 2) }],
    ["a relinquished object in a forward prefix", {
      phase: "applied",
      nextTransition: 1,
      observations: [relinquishedObjectObservation(plan, 0)],
    }],
    ["a relinquished object ahead of the reverse cursor", {
      phase: "compensating",
      nextTransition: 3,
      compensationNext: 1,
      observations: [relinquishedObjectObservation(plan, 0), ...forward(plan, 3).slice(1)],
    }],
  ])("refuses %s", (_name, patch) => {
    expect(() => validateGitEffectJournal(roundTrip(journal(plan, patch)), UID)).toThrow();
  });

  it("refuses a verified journal short of the plan and a forged observation", () => {
    expect(() =>
      { assertGitEffectJournalForPlan(plan, journal(plan, { phase: "verified", nextTransition: 2, observations: forward(plan, 2) })); },
    ).toThrow();
    const forged = { ...gitEffectForwardObservation(plan, 0), outcome: "reused" as const };
    expect(() =>
      { assertGitEffectJournalForPlan(plan, journal(plan, { phase: "applied", nextTransition: 1, observations: [forged] })); },
    ).toThrow();
    expect(() =>
      { assertGitEffectJournalForPlan(plan, journal(plan, {
        phase: "rolled_back",
        nextTransition: 3,
        compensationNext: -1,
        observations: [...forward(plan, 2), relinquishedObjectObservation(plan, 2)],
      })); },
    ).toThrow();
  });

  it.each(GIT_EFFECT_PHASES)("classifies %s through the ledger codec", (phase) => {
    expect(GIT_EFFECT_PHASES.length).toBeGreaterThan(0);
    const codec = createGitEffectLedgerCodec(UID);
    const expected = phase === "finalized" || phase === "rolled_back" ? phase : null;
    expect(codec.terminal(journal(plan, { phase }))).toBe(expected);
  });
});
