import { describe, expect, it } from "vitest";

import type { FoundationMutationRefV1 } from "../manifest/bootstrap.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  parseLowerHexSha256,
  parseUInt64Decimal,
  parseUtcTimestamp,
  type LowerHexSha256,
} from "../update/scalars.js";
import {
  decodeCanonicalJson,
  encodeCanonicalJson,
  hashCanonicalJson,
  type CanonicalJsonValue,
} from "./canonical-json.js";
import {
  formatAllocatedLifecycleId,
  parseAllocatedLifecycleId,
  parseLifecycleCoordinatorId,
  type GitEffectIdV1,
} from "./ids.js";
import {
  createLifecycleCodecs,
  foundationParticipantPlanHash,
  lifecyclePreviewHash,
  validateFoundationParticipantPair,
  validateFoundationParticipantRef,
  type LifecycleCodecContextV1,
  type LifecycleLeafCodecsV1,
} from "./codecs.js";
import {
  FOUNDATION_MUTATION_OPERATIONS,
  FOUNDATION_PARTICIPANT_SLOTS,
  LIFECYCLE_COMPACTION_ENTRY_KINDS,
  LIFECYCLE_COORDINATOR_OPERATIONS,
  LIFECYCLE_COORDINATOR_PHASES,
  LIFECYCLE_COORDINATOR_STEP_KINDS,
  LIFECYCLE_JOURNAL_CLOSURE_KINDS,
  LIFECYCLE_MANIFEST_STEP_TRANSITIONS,
  LIFECYCLE_PLAN_BOUNDS,
  LIFECYCLE_PREVIEW_COMMANDS,
  LIFECYCLE_PREVIEW_EXECUTION_OPERATIONS,
  LIFECYCLE_PREVIEW_FILE_OPERATIONS,
  LIFECYCLE_PREVIEW_FILE_ROLES,
  LIFECYCLE_PREVIEW_FILE_STATES,
  LIFECYCLE_REDACTION_KEY_STEP_TRANSITIONS,
  LIFECYCLE_SUBSYSTEMS,
  LIFECYCLE_TERMINAL_OUTCOMES,
  type FoundationParticipantRefV1,
  type FoundationParticipantSlotV1,
  type LifecycleCoordinatorJournalV1,
  type LifecycleCoordinatorPlanCoreV1,
  type LifecycleCoordinatorStepV1,
  type LifecyclePlanPreviewCoreV1,
} from "./types.js";

const HOME = parseCanonicalAbsolutePathText("/product");
const NONCE = parseLowerHexSha256("a".repeat(64));
const OTHER_NONCE = parseLowerHexSha256("b".repeat(64));
const CONTEXT: LifecycleCodecContextV1 = { productHome: HOME, nonce: NONCE };

const COORDINATOR = parseLifecycleCoordinatorId(formatAllocatedLifecycleId("lc", NONCE, 1n), NONCE);
const SOURCE_EFFECT = parseAllocatedLifecycleId("ge", formatAllocatedLifecycleId("ge", NONCE, 8n), NONCE);
const DESTINATION_EFFECT = parseAllocatedLifecycleId("ge", formatAllocatedLifecycleId("ge", NONCE, 9n), NONCE);
const LAUNCHD_EFFECT = parseAllocatedLifecycleId("le", formatAllocatedLifecycleId("le", NONCE, 7n), NONCE);

const TIMESTAMP = parseUtcTimestamp("2026-09-18T00:00:00.000Z");
const DEV = parseUInt64Decimal("16777232");
const INO = parseUInt64Decimal("184467440737095516");

function hash(seed: string): LowerHexSha256 {
  return parseLowerHexSha256(seed.repeat(64).slice(0, 64));
}

const PLAN_HASH = hash("1");
const PUSH_HASH = hash("2");
const GIT_TABLE_HASH = hash("3");
const OBSERVATION_HASH = hash("4");
const MUTATION_TEMPLATE_HASH = hash("5");

function path(text: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(text);
}

interface SyntheticLeaf {
  readonly marker: string;
}
interface SyntheticPush extends SyntheticLeaf {
  readonly planHash: LowerHexSha256;
}
interface SyntheticProjection extends SyntheticLeaf {
  readonly subsystem: "git" | "automation";
}
interface SyntheticLaunchdPreview extends SyntheticLeaf {
  readonly tableHashes: {
    readonly observation: LowerHexSha256;
    readonly mutationTemplate: LowerHexSha256;
  };
}

type LeafName =
  | "manifest"
  | "launchd"
  | "redactionKey"
  | "push"
  | "projection"
  | "gitPreview"
  | "launchdPreview";

type SyntheticLeaves = LifecycleLeafCodecsV1<
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticPush,
  SyntheticProjection,
  SyntheticLeaf,
  SyntheticLaunchdPreview
> & {
  readonly calls: Record<LeafName, number>;
  readonly encodes: Record<LeafName, number>;
};

type SyntheticPlan = LifecycleCoordinatorPlanCoreV1<
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticPush
>;
type SyntheticPreview = LifecyclePlanPreviewCoreV1<
  SyntheticProjection,
  SyntheticLeaf,
  SyntheticLaunchdPreview
>;

function syntheticLeafCodecs(): SyntheticLeaves {
  const calls: Record<LeafName, number> = {
    manifest: 0,
    launchd: 0,
    redactionKey: 0,
    push: 0,
    projection: 0,
    gitPreview: 0,
    launchdPreview: 0,
  };
  const encodes: Record<LeafName, number> = { ...calls };
  function codec<T extends SyntheticLeaf>(name: LeafName) {
    return {
      validate(value: unknown): T {
        calls[name] += 1;
        if (typeof value !== "object" || value === null || !("marker" in value)) {
          throw new Error(`invalid synthetic ${name} leaf`);
        }
        return value as T;
      },
      encode(value: T) {
        encodes[name] += 1;
        return encodeCanonicalJson(value as unknown as CanonicalJsonValue);
      },
    };
  }
  return {
    manifest: codec<SyntheticLeaf>("manifest"),
    launchd: codec<SyntheticLeaf>("launchd"),
    redactionKey: codec<SyntheticLeaf>("redactionKey"),
    push: codec<SyntheticPush>("push"),
    pushPlanHash: (push) => push.planHash,
    projection: codec<SyntheticProjection>("projection"),
    gitPreview: codec<SyntheticLeaf>("gitPreview"),
    launchdPreview: codec<SyntheticLaunchdPreview>("launchdPreview"),
    projectionSubsystem: (projection) => projection.subsystem,
    launchdPreviewTableHashes: (preview) => preview.tableHashes,
    calls,
    encodes,
  };
}

function codecs(leaves: SyntheticLeaves = syntheticLeafCodecs()) {
  return createLifecycleCodecs(leaves, CONTEXT);
}

/** A leaf whose canonical bytes are deliberately not `encodeCanonicalJson` of its raw value. */
function rewritingLeafCodecs(): SyntheticLeaves {
  const base = syntheticLeafCodecs();
  return {
    ...base,
    manifest: {
      validate: (value) => base.manifest.validate(value),
      encode: (value) => encodeCanonicalJson({ ...value, marker: `${value.marker}-encoded` }),
    },
  };
}

interface MutationSpec {
  readonly targetPath: string;
  readonly operation: FoundationMutationRefV1["operation"];
  readonly expectedBeforeHash?: LowerHexSha256;
  readonly contentHash?: LowerHexSha256;
  readonly contentSize?: number;
}

function participantId(counter: bigint, nonce = NONCE): string {
  return formatAllocatedLifecycleId("tx", nonce, counter);
}

function mutations(id: string, specs: readonly MutationSpec[]): readonly FoundationMutationRefV1[] {
  return specs.map((spec, index) => ({
    targetPath: path(spec.targetPath),
    operation: spec.operation,
    expectedBeforeHash: spec.expectedBeforeHash ?? null,
    contentHash: spec.contentHash ?? null,
    contentSize: spec.contentSize ?? null,
    stagedPath:
      spec.contentHash === undefined
        ? null
        : path(`${HOME}/staging/transactions/${id}/${index.toString(10)}.bin`),
  }));
}

function participantRef(options: {
  readonly counter: bigint;
  readonly slot: FoundationParticipantSlotV1;
  readonly role: FoundationParticipantRefV1["role"];
  readonly mutations: readonly MutationSpec[];
}): FoundationParticipantRefV1 {
  const id = participantId(options.counter);
  const core = {
    slot: options.slot,
    role: options.role,
    mutations: mutations(id, options.mutations),
    maximumJournalBytes: 4096,
    initialJournal: {
      finalPath: path(`${HOME}/state/transactions/${id}.json`),
      plannedBytesHash: hash("6"),
      stagedPath: path(`${HOME}/staging/lifecycle/${COORDINATOR}/foundation/${id}/journal.json`),
      stagedIdentity: { hash: hash("7"), size: 512, mode: 384 as const, dev: DEV, ino: INO },
    },
  };
  return {
    id: parseAllocatedLifecycleId("tx", id, NONCE),
    ...core,
    planHash: foundationParticipantPlanHash(core),
  };
}

const MARKER_FORWARD_COUNTER = 2n;
const MARKER_COMPENSATION_COUNTER = 3n;
const ARTIFACTS_FORWARD_COUNTER = 4n;
const ARTIFACTS_COMPENSATION_COUNTER = 5n;

function markerPair(): readonly [FoundationParticipantRefV1, FoundationParticipantRefV1] {
  const forward = participantRef({
    counter: MARKER_FORWARD_COUNTER,
    slot: "uninstall_marker",
    role: {
      kind: "forward",
      compensationId: parseAllocatedLifecycleId("tx", participantId(MARKER_COMPENSATION_COUNTER), NONCE),
    },
    mutations: [
      {
        targetPath: `${HOME}/state/uninstalling.json`,
        operation: "create",
        contentHash: hash("8"),
        contentSize: 96,
      },
    ],
  });
  const compensation = participantRef({
    counter: MARKER_COMPENSATION_COUNTER,
    slot: "uninstall_marker",
    role: {
      kind: "compensation",
      forwardId: parseAllocatedLifecycleId("tx", participantId(MARKER_FORWARD_COUNTER), NONCE),
    },
    mutations: [
      {
        targetPath: `${HOME}/state/uninstalling.json`,
        operation: "remove",
        expectedBeforeHash: hash("8"),
      },
    ],
  });
  return [forward, compensation];
}

function syntheticArtifactPair(): readonly [FoundationParticipantRefV1, FoundationParticipantRefV1] {
  const forward = participantRef({
    counter: ARTIFACTS_FORWARD_COUNTER,
    slot: "uninstall_artifacts",
    role: {
      kind: "forward",
      compensationId: parseAllocatedLifecycleId("tx", participantId(ARTIFACTS_COMPENSATION_COUNTER), NONCE),
    },
    mutations: [
      { targetPath: "/brain/a.md", operation: "create", contentHash: hash("9"), contentSize: 10 },
      {
        targetPath: "/brain/b.md",
        operation: "replace",
        expectedBeforeHash: hash("a"),
        contentHash: hash("b"),
        contentSize: 20,
      },
    ],
  });
  const compensation = participantRef({
    counter: ARTIFACTS_COMPENSATION_COUNTER,
    slot: "uninstall_artifacts",
    role: {
      kind: "compensation",
      forwardId: parseAllocatedLifecycleId("tx", participantId(ARTIFACTS_FORWARD_COUNTER), NONCE),
    },
    mutations: [
      {
        targetPath: "/brain/b.md",
        operation: "replace",
        expectedBeforeHash: hash("b"),
        contentHash: hash("a"),
        contentSize: 20,
      },
      { targetPath: "/brain/a.md", operation: "remove", expectedBeforeHash: hash("9") },
    ],
  });
  return [forward, compensation];
}

/** D24's `uninstall/present_manifest_without_launchd` step order, with null launchd arms. */
function syntheticUninstallPlan(): SyntheticPlan {
  const [markerForward, markerCompensation] = markerPair();
  const [artifactsForward, artifactsCompensation] = syntheticArtifactPair();
  const steps: readonly LifecycleCoordinatorStepV1[] = [
    { kind: "foundation", slot: "uninstall_marker", participantId: markerForward.id },
    { kind: "drain_runners" },
    { kind: "foundation", slot: "uninstall_artifacts", participantId: artifactsForward.id },
    { kind: "redaction_key", transition: "stage" },
    { kind: "manifest", transition: "preserve_before" },
    { kind: "manifest", transition: "commit_absence" },
    { kind: "redaction_key", transition: "delete" },
    { kind: "manifest", transition: "finalize_tombstones" },
  ];
  return {
    schemaVersion: 1,
    id: COORDINATOR,
    previewHash: null,
    operation: "uninstall",
    maximumJournalBytes: 8192,
    authority: {
      productHome: HOME,
      configPath: path(`${HOME}/config.toml`),
      activationPath: path(`${HOME}/state/lifecycle-activation.json`),
      manifestPath: path(`${HOME}/state/installation.json`),
      repositoryRoot: null,
      plistPaths: [],
    },
    participants: {
      foundation: [markerForward, markerCompensation, artifactsForward, artifactsCompensation],
      manifest: { marker: "manifest" },
      sourceGitEffect: null,
      destinationGitEffect: null,
      launchdBeforeFiles: null,
      launchdAfterFiles: null,
      launchd: null,
      redactionKey: { marker: "redaction-key" },
    },
    push: null,
    steps,
  };
}

function syntheticGitSyncPlan(): SyntheticPlan {
  return {
    schemaVersion: 1,
    id: COORDINATOR,
    previewHash: null,
    operation: "git_sync",
    maximumJournalBytes: 8192,
    authority: {
      productHome: HOME,
      configPath: path(`${HOME}/config.toml`),
      activationPath: path(`${HOME}/state/lifecycle-activation.json`),
      manifestPath: path(`${HOME}/state/installation.json`),
      repositoryRoot: path("/brain"),
      plistPaths: [],
    },
    participants: {
      foundation: [],
      manifest: null,
      sourceGitEffect: { id: SOURCE_EFFECT, planHash: hash("c") },
      destinationGitEffect: { id: DESTINATION_EFFECT, planHash: hash("d") },
      launchdBeforeFiles: null,
      launchdAfterFiles: null,
      launchd: null,
      redactionKey: null,
    },
    push: { marker: "push", planHash: PUSH_HASH },
    steps: [
      { kind: "source_git_effect", participantId: SOURCE_EFFECT },
      { kind: "destination_git_effect", participantId: DESTINATION_EFFECT, pushPlanHash: PUSH_HASH },
      { kind: "network_push", pushPlanHash: PUSH_HASH },
    ],
  };
}

function syntheticJournal(): LifecycleCoordinatorJournalV1 {
  return {
    schemaVersion: 1,
    id: COORDINATOR,
    operation: "uninstall",
    phase: "planned",
    planHash: PLAN_HASH,
    pushPlanHash: null,
    nextStep: 0,
    compensationNext: null,
    compactionNext: null,
    terminalOutcome: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function previewWithHash(base: Omit<SyntheticPreview, "previewHash">): SyntheticPreview {
  const candidate: SyntheticPreview = { ...base, previewHash: hash("0") };
  return { ...base, previewHash: lifecyclePreviewHash(candidate) };
}

function syntheticGitPreview(): SyntheticPreview {
  return previewWithHash({
    schemaVersion: 1,
    command: "git_enable",
    executionOperation: "git_enable",
    normalizedProjection: { marker: "projection", subsystem: "git" },
    authority: {
      productHome: HOME,
      configPath: path(`${HOME}/config.toml`),
      activationPath: path(`${HOME}/state/lifecycle-activation.json`),
      manifestPath: path(`${HOME}/state/installation.json`),
    },
    processTableTemplateHashes: { git: GIT_TABLE_HASH, launchd: null },
    files: [
      {
        role: "config",
        targetPath: path(`${HOME}/config.toml`),
        operation: "replace",
        before: { state: "present", hash: hash("e"), size: 120 },
        after: { state: "present", hash: hash("f"), size: 140 },
      },
    ],
    git: { marker: "git-preview" },
    launchd: null,
  });
}

function syntheticAutomationPreview(): SyntheticPreview {
  return previewWithHash({
    schemaVersion: 1,
    command: "automation_enable",
    executionOperation: "automation_enable",
    normalizedProjection: { marker: "projection", subsystem: "automation" },
    authority: {
      productHome: HOME,
      configPath: path(`${HOME}/config.toml`),
      activationPath: path(`${HOME}/state/lifecycle-activation.json`),
      manifestPath: path(`${HOME}/state/installation.json`),
    },
    processTableTemplateHashes: {
      git: null,
      launchd: { observation: OBSERVATION_HASH, mutationTemplate: MUTATION_TEMPLATE_HASH },
    },
    files: [],
    git: null,
    launchd: {
      marker: "launchd-preview",
      tableHashes: { observation: OBSERVATION_HASH, mutationTemplate: MUTATION_TEMPLATE_HASH },
    },
  });
}

type JsonRecord = Record<string, unknown>;

function nodeAt(root: JsonRecord, keys: readonly string[]): JsonRecord {
  let node: JsonRecord = root;
  for (const key of keys) node = node[key] as JsonRecord;
  return node;
}

function withValue(root: unknown, dottedPath: string, value: unknown): unknown {
  const copy = structuredClone(root) as JsonRecord;
  const keys = dottedPath.split(".");
  nodeAt(copy, keys.slice(0, -1))[keys[keys.length - 1] as string] = value;
  return copy;
}

function withoutMember(root: unknown, dottedPath: string): unknown {
  const copy = structuredClone(root) as JsonRecord;
  const keys = dottedPath.split(".");
  const container = nodeAt(copy, keys.slice(0, -1));
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete container[keys[keys.length - 1] as string];
  return copy;
}

function withExtraKey(root: unknown, dottedPath: string): unknown {
  const copy = structuredClone(root) as JsonRecord;
  const node = dottedPath === "" ? copy : nodeAt(copy, dottedPath.split("."));
  node.unexpectedKey = true;
  return copy;
}

const PLAN_KEY_PATHS: readonly string[] = [
  "",
  "authority",
  "participants",
  "participants.foundation.0",
  "participants.foundation.0.role",
  "participants.foundation.0.mutations.0",
  "participants.foundation.0.initialJournal",
  "participants.foundation.0.initialJournal.stagedIdentity",
  "steps.0",
  "steps.1",
];

const GIT_SYNC_KEY_PATHS: readonly string[] = [
  "participants.sourceGitEffect",
  "participants.destinationGitEffect",
  "steps.0",
  "steps.1",
  "steps.2",
];

const PREVIEW_KEY_PATHS: readonly string[] = [
  "",
  "authority",
  "processTableTemplateHashes",
  "files.0",
  "files.0.before",
  "files.0.after",
];

const JOURNAL_KEY_PATHS: readonly string[] = [""];

describe("the closed lifecycle tables", () => {
  it("names every arm Spec 1 §2.4 lists, and no other", () => {
    expect(LIFECYCLE_COORDINATOR_OPERATIONS).toEqual([
      "git_enable",
      "git_disable",
      "git_reconcile",
      "git_sync",
      "automation_enable",
      "automation_disable",
      "automation_reconcile",
      "uninstall",
    ]);
    expect(LIFECYCLE_COORDINATOR_PHASES).toEqual([
      "planned",
      "participants_applying",
      "manifest_publishing",
      "external_applying",
      "config_publishing",
      "push_pending",
      "compensating",
      "finalized",
      "rolled_back",
      "compacting",
    ]);
    expect(FOUNDATION_PARTICIPANT_SLOTS).toEqual([
      "activation",
      "config",
      "plist_files",
      "sync_record",
      "uninstall_marker",
      "uninstall_artifacts",
    ]);
    expect(LIFECYCLE_COORDINATOR_STEP_KINDS).toEqual([
      "foundation",
      "manifest",
      "source_git_effect",
      "destination_git_effect",
      "launchd_before_files",
      "launchd_after_files",
      "redaction_key",
      "network_push",
      "drain_runners",
    ]);
    expect(LIFECYCLE_MANIFEST_STEP_TRANSITIONS).toEqual([
      "preserve_before",
      "publish_after",
      "commit_absence",
      "finalize_tombstones",
    ]);
    expect(LIFECYCLE_REDACTION_KEY_STEP_TRANSITIONS).toEqual(["stage", "delete"]);
    expect(FOUNDATION_MUTATION_OPERATIONS).toEqual(["create", "replace", "remove"]);
    expect(LIFECYCLE_PREVIEW_COMMANDS).toEqual([
      "git_enable",
      "git_disable",
      "automation_enable",
      "automation_disable",
    ]);
    expect(LIFECYCLE_PREVIEW_EXECUTION_OPERATIONS).toEqual([
      "git_enable",
      "git_disable",
      "git_reconcile",
      "automation_enable",
      "automation_disable",
      "automation_reconcile",
    ]);
    expect(LIFECYCLE_PREVIEW_FILE_ROLES).toEqual([
      "activation",
      "config",
      "plist",
      "manifest",
      "source_git",
      "destination_git",
      "redaction_key",
    ]);
    expect(LIFECYCLE_PREVIEW_FILE_OPERATIONS).toEqual(["create", "replace", "remove", "keep"]);
    expect(LIFECYCLE_PREVIEW_FILE_STATES).toEqual(["absent", "present"]);
    expect(LIFECYCLE_COMPACTION_ENTRY_KINDS).toEqual([
      "foundation_transaction",
      "git_effect",
      "launchd_effect",
      "coordinator_staging",
      "coordinator_envelope",
    ]);
    expect(LIFECYCLE_JOURNAL_CLOSURE_KINDS).toEqual([
      "clear",
      "retry_only",
      "uninstall_draining",
      "lifecycle_recovery_required",
    ]);
    expect(LIFECYCLE_TERMINAL_OUTCOMES).toEqual(["finalized", "rolled_back"]);
    expect(LIFECYCLE_SUBSYSTEMS).toEqual(["git", "automation"]);
  });

  it("carries every §2.4 cardinality and bound", () => {
    expect(LIFECYCLE_PLAN_BOUNDS).toStrictEqual({
      planBytes: { minimum: 1, maximum: 16_777_216 },
      journalBytes: { minimum: 1, maximum: 1_048_576 },
      steps: { minimum: 1, maximum: 256 },
      foundationRefs: { minimum: 0, maximum: 64 },
      mutationsPerRef: { minimum: 1, maximum: 256 },
      plistPaths: { minimum: 0, maximum: 4 },
      previewFiles: { minimum: 0, maximum: 16 },
      compactionEntries: { minimum: 2, maximum: 70 },
      nextStep: { minimum: 0, maximum: 256 },
      compensationNext: { minimum: -1, maximum: 255 },
      compactionNext: { minimum: 0, maximum: 70 },
      mutationContentSize: { minimum: 0, maximum: 16_777_216 },
      stagedJournalBytes: { minimum: 1, maximum: 1_048_576 },
      foundationMutationCount: { minimum: 1, maximum: 1_000_000 },
      previewFileSize: { minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    });
  });
});

describe("the coordinator execution-plan codec", () => {
  it("validates the shared core and delegates every non-null leaf exactly once", () => {
    const leaves = syntheticLeafCodecs();
    expect(createLifecycleCodecs(leaves, CONTEXT).executionPlan.validate(syntheticUninstallPlan())).toStrictEqual(
      syntheticUninstallPlan(),
    );
    expect(leaves.calls.manifest).toBe(1);
    expect(leaves.calls.redactionKey).toBe(1);
    expect(leaves.calls.launchd).toBe(0);
    expect(leaves.calls.push).toBe(0);
  });

  it("validates a plan with every Git and push arm, delegating the push leaf once", () => {
    const leaves = syntheticLeafCodecs();
    expect(createLifecycleCodecs(leaves, CONTEXT).executionPlan.validate(syntheticGitSyncPlan())).toStrictEqual(
      syntheticGitSyncPlan(),
    );
    expect(leaves.calls.push).toBe(1);
    expect(leaves.calls.manifest).toBe(0);
  });

  it("encodes the plan as canonical JSON ending in exactly one LF", () => {
    const encoded = codecs().executionPlan.encode(syntheticUninstallPlan());
    expect(encoded.endsWith("}\n")).toBe(true);
    expect(encoded.endsWith("\n\n")).toBe(false);
  });

  it("enumerates a non-empty set of object key paths", () => {
    expect(PLAN_KEY_PATHS.length).toBeGreaterThan(0);
    expect(GIT_SYNC_KEY_PATHS.length).toBeGreaterThan(0);
  });

  it.each(PLAN_KEY_PATHS)("refuses an unknown key at %s", (keyPath) => {
    expect(() => codecs().executionPlan.validate(withExtraKey(syntheticUninstallPlan(), keyPath))).toThrow();
  });

  it.each(GIT_SYNC_KEY_PATHS)("refuses an unknown key at %s of a sync plan", (keyPath) => {
    expect(() => codecs().executionPlan.validate(withExtraKey(syntheticGitSyncPlan(), keyPath))).toThrow();
  });

  it.each([
    ["no step", []],
    ["257 steps", Array.from({ length: 257 }, () => ({ kind: "drain_runners" }))],
  ])("refuses %s", (_name, steps) => {
    expect(() => codecs().executionPlan.validate(withValue(syntheticUninstallPlan(), "steps", steps))).toThrow();
  });

  it("refuses 65 Foundation references", () => {
    const plan = syntheticUninstallPlan();
    const filler = Array.from({ length: 65 }, (_value, index) =>
      participantRef({
        counter: BigInt(100 + index),
        slot: "config",
        role: { kind: "forward", compensationId: null },
        mutations: [{ targetPath: "/brain/a.md", operation: "create", contentHash: hash("9"), contentSize: 1 }],
      }),
    );
    expect(() =>
      codecs().executionPlan.validate(withValue(plan, "participants.foundation", filler)),
    ).toThrow();
  });

  it.each([
    ["five plist paths", [`${HOME}/a`, `${HOME}/b`, `${HOME}/c`, `${HOME}/d`, `${HOME}/e`], /plistPaths: length/u],
    ["unsorted plist paths", [`${HOME}/b`, `${HOME}/a`], /plistPaths: order/u],
    ["duplicated plist paths", [`${HOME}/a`, `${HOME}/a`], /plistPaths: order/u],
  ])("refuses %s", (_name, plistPaths, reason) => {
    expect(() =>
      codecs().executionPlan.validate(withValue(syntheticUninstallPlan(), "authority.plistPaths", plistPaths)),
    ).toThrow(reason);
  });

  it("accepts four sorted unique plist paths", () => {
    const plistPaths = [`${HOME}/a`, `${HOME}/b`, `${HOME}/c`, `${HOME}/d`];
    expect(() =>
      codecs().executionPlan.validate(withValue(syntheticUninstallPlan(), "authority.plistPaths", plistPaths)),
    ).not.toThrow();
  });

  it.each([
    ["no mutation", []],
    [
      "257 mutations",
      Array.from({ length: 257 }, () => ({
        targetPath: "/brain/a.md",
        operation: "create",
        expectedBeforeHash: null,
        contentHash: hash("9"),
        contentSize: 1,
        stagedPath: `${HOME}/staging/transactions/${participantId(MARKER_FORWARD_COUNTER)}/0.bin`,
      })),
    ],
  ])("refuses a reference with %s", (_name, list) => {
    expect(() =>
      codecs().executionPlan.validate(
        withValue(syntheticUninstallPlan(), "participants.foundation.0.mutations", list),
      ),
    ).toThrow();
  });

  it.each([
    ["zero", 0],
    ["1048577", 1_048_577],
  ])("refuses maximumJournalBytes of %s on the plan", (_name, value) => {
    expect(() =>
      codecs().executionPlan.validate(withValue(syntheticUninstallPlan(), "maximumJournalBytes", value)),
    ).toThrow();
  });

  it.each([
    ["zero", 0],
    ["1048577", 1_048_577],
  ])("refuses maximumJournalBytes of %s on a reference", (_name, value) => {
    expect(() =>
      codecs().executionPlan.validate(
        withValue(syntheticUninstallPlan(), "participants.foundation.0.maximumJournalBytes", value),
      ),
    ).toThrow();
  });

  it("refuses Foundation references that are not sorted by ID", () => {
    const plan = syntheticUninstallPlan();
    const reordered = [...plan.participants.foundation].reverse();
    expect(() => codecs().executionPlan.validate(withValue(plan, "participants.foundation", reordered))).toThrow(
      /foundation: order/u,
    );
  });

  it("refuses a duplicated Foundation reference", () => {
    const plan = syntheticUninstallPlan();
    const duplicated = [
      plan.participants.foundation[0] as FoundationParticipantRefV1,
      plan.participants.foundation[0] as FoundationParticipantRefV1,
      ...plan.participants.foundation.slice(2),
    ];
    expect(() => codecs().executionPlan.validate(withValue(plan, "participants.foundation", duplicated))).toThrow(
      /foundation: order/u,
    );
  });

  it("refuses a mutation staged outside its derived participant path", () => {
    expect(() =>
      codecs().executionPlan.validate(
        withValue(
          syntheticUninstallPlan(),
          "participants.foundation.0.mutations.0.stagedPath",
          `${HOME}/staging/transactions/${participantId(MARKER_FORWARD_COUNTER)}/1.bin`,
        ),
      ),
    ).toThrow();
  });

  it.each([
    ["initialJournal.finalPath", "participants.foundation.0.initialJournal.finalPath", `${HOME}/state/transactions/other.json`],
    [
      "initialJournal.stagedPath",
      "participants.foundation.0.initialJournal.stagedPath",
      `${HOME}/staging/lifecycle/${COORDINATOR}/foundation/other/journal.json`,
    ],
  ])("refuses a %s outside its derived grammar", (_name, keyPath, value) => {
    expect(() => codecs().executionPlan.validate(withValue(syntheticUninstallPlan(), keyPath, value))).toThrow();
  });

  it.each([
    ["mode 420", "participants.foundation.0.initialJournal.stagedIdentity.mode", 420],
    ["size 0", "participants.foundation.0.initialJournal.stagedIdentity.size", 0],
    ["size 1048577", "participants.foundation.0.initialJournal.stagedIdentity.size", 1_048_577],
  ])("refuses a staged identity with %s", (_name, keyPath, value) => {
    expect(() => codecs().executionPlan.validate(withValue(syntheticUninstallPlan(), keyPath, value))).toThrow();
  });

  it.each([
    ["dev as a number", "participants.foundation.0.initialJournal.stagedIdentity.dev", 16_777_232],
    ["ino as a number", "participants.foundation.0.initialJournal.stagedIdentity.ino", 42],
    ["dev with a leading zero", "participants.foundation.0.initialJournal.stagedIdentity.dev", "0755"],
    ["ino above 2^64-1", "participants.foundation.0.initialJournal.stagedIdentity.ino", "18446744073709551616"],
  ])("refuses %s", (_name, keyPath, value) => {
    expect(() => codecs().executionPlan.validate(withValue(syntheticUninstallPlan(), keyPath, value))).toThrow();
  });

  it("refuses a reference whose planHash is not the participant digest", () => {
    expect(() =>
      codecs().executionPlan.validate(
        withValue(syntheticUninstallPlan(), "participants.foundation.0.planHash", hash("c")),
      ),
    ).toThrow(/planHash/u);
  });

  it("refuses a reference whose hashed members were edited after hashing", () => {
    expect(() =>
      codecs().executionPlan.validate(
        withValue(syntheticUninstallPlan(), "participants.foundation.0.slot", "config"),
      ),
    ).toThrow(/planHash/u);
  });

  it.each([
    ["a create with a preimage guard", "participants.foundation.0.mutations.0.expectedBeforeHash", hash("9")],
    ["a create without content", "participants.foundation.0.mutations.0.contentHash", null],
    ["a create without a content size", "participants.foundation.0.mutations.0.contentSize", null],
    ["a create without staged bytes", "participants.foundation.0.mutations.0.stagedPath", null],
    ["a content size above 16777216", "participants.foundation.0.mutations.0.contentSize", 16_777_217],
  ])("refuses %s", (_name, keyPath, value) => {
    expect(() => codecs().executionPlan.validate(withValue(syntheticUninstallPlan(), keyPath, value))).toThrow();
  });

  it.each([
    ["a remove without a preimage guard", "expectedBeforeHash", null],
    ["a remove with content", "contentHash", hash("9")],
    ["a remove with a content size", "contentSize", 4],
    ["a remove with staged bytes", "stagedPath", `${HOME}/staging/transactions/${participantId(MARKER_COMPENSATION_COUNTER)}/0.bin`],
  ])("refuses %s", (_name, member, value) => {
    const plan = syntheticUninstallPlan();
    const edited = withValue(plan, `participants.foundation.1.mutations.0.${member}`, value) as SyntheticPlan;
    const ref = edited.participants.foundation[1] as FoundationParticipantRefV1;
    const rehashed = withValue(
      edited,
      "participants.foundation.1.planHash",
      foundationParticipantPlanHash(ref),
    );
    expect(() => codecs().executionPlan.validate(rehashed)).toThrow();
  });

  it("refuses a replace with a null preimage guard", () => {
    const plan = syntheticUninstallPlan();
    const edited = withValue(plan, "participants.foundation.2.mutations.1.expectedBeforeHash", null) as SyntheticPlan;
    const ref = edited.participants.foundation[2] as FoundationParticipantRefV1;
    const rehashed = withValue(edited, "participants.foundation.2.planHash", foundationParticipantPlanHash(ref));
    expect(() => codecs().executionPlan.validate(rehashed)).toThrow();
  });

  it.each([
    ["the coordinator", "id", formatAllocatedLifecycleId("lc", OTHER_NONCE, 1n)],
    ["a participant", "participants.foundation.0.id", participantId(MARKER_FORWARD_COUNTER, OTHER_NONCE)],
    ["a step participant", "steps.0.participantId", participantId(MARKER_FORWARD_COUNTER, OTHER_NONCE)],
  ])("refuses %s ID allocated under a foreign nonce", (_name, keyPath, value) => {
    expect(() => codecs().executionPlan.validate(withValue(syntheticUninstallPlan(), keyPath, value))).toThrow(
      /nonce|AllocatedLifecycleIdV1/u,
    );
  });

  it("refuses a legacy UUID Foundation ID as a coordinator participant", () => {
    expect(() =>
      codecs().executionPlan.validate(
        withValue(syntheticUninstallPlan(), "participants.foundation.0.id", "tx_0f9b6d2c-6a1e-4f27-9bd5-2c5a1f0e7a31"),
      ),
    ).toThrow();
  });

  it("refuses an encoded plan over 16,777,216 bytes", () => {
    const plan = syntheticUninstallPlan();
    const oversized = {
      ...plan,
      authority: { ...plan.authority, plistPaths: [`/${"a".repeat(16_777_300)}` as CanonicalAbsolutePathV1] },
    };
    expect(() => codecs().executionPlan.encode(oversized)).toThrow(/16777216|byte/u);
  });

  it.each([
    ["a manifest arm with no manifest step", "participants.manifest", null, /manifest arm/u],
    ["a redaction-key arm with no redaction-key step", "participants.redactionKey", null, /redaction key arm/u],
  ])("refuses %s", (_name, keyPath, value, reason) => {
    expect(() => codecs().executionPlan.validate(withValue(syntheticUninstallPlan(), keyPath, value))).toThrow(reason);
  });

  it("refuses a launchd effect arm with no matching step", () => {
    expect(() =>
      codecs().executionPlan.validate(
        withValue(syntheticUninstallPlan(), "participants.launchdBeforeFiles", {
          id: LAUNCHD_EFFECT,
          planHash: hash("c"),
        }),
      ),
    ).toThrow(/launchd_before_files arm/u);
  });

  it("refuses a Git effect step whose participant ID is not the plan's arm", () => {
    expect(() =>
      codecs().executionPlan.validate(withValue(syntheticGitSyncPlan(), "steps.0.participantId", DESTINATION_EFFECT)),
    ).toThrow(/source_git_effect identity/u);
  });

  it("refuses a Git effect step with no arm", () => {
    expect(() =>
      codecs().executionPlan.validate(withValue(syntheticGitSyncPlan(), "participants.sourceGitEffect", null)),
    ).toThrow(/source_git_effect arm/u);
  });

  it("refuses a duplicated step", () => {
    const plan = syntheticUninstallPlan();
    const steps = [...plan.steps, plan.steps[1] as LifecycleCoordinatorStepV1];
    expect(() => codecs().executionPlan.validate(withValue(plan, "steps", steps))).toThrow(/duplicate step/u);
  });

  it("refuses a foundation step naming a compensation reference", () => {
    const plan = syntheticUninstallPlan();
    const compensation = plan.participants.foundation[1] as FoundationParticipantRefV1;
    expect(() =>
      codecs().executionPlan.validate(withValue(plan, "steps.0.participantId", compensation.id)),
    ).toThrow(/compensation reference/u);
  });

  it("refuses a foundation step whose slot is not its reference's slot", () => {
    expect(() =>
      codecs().executionPlan.validate(withValue(syntheticUninstallPlan(), "steps.0.slot", "config")),
    ).toThrow(/step slot/u);
  });

  it("refuses a foundation step naming a reference the plan does not carry", () => {
    expect(() =>
      codecs().executionPlan.validate(
        withValue(syntheticUninstallPlan(), "steps.0.participantId", participantId(61n)),
      ),
    ).toThrow(/absent Foundation reference/u);
  });

  it("refuses a forward reference that no step consumes", () => {
    const plan = syntheticUninstallPlan();
    const replaced = withValue(plan, "steps.0", { kind: "manifest", transition: "publish_after" });
    expect(() => codecs().executionPlan.validate(replaced)).toThrow(/unused Foundation reference/u);
  });

  it.each([
    ["a push arm whose digest is not the step's", "steps.2.pushPlanHash", hash("c"), /pushPlanHash/u],
    ["a destination step whose digest is not the push arm's", "steps.1.pushPlanHash", hash("c"), /pushPlanHash/u],
    ["a push step with no push arm", "push", null, /push arm/u],
  ])("refuses %s", (_name, keyPath, value, reason) => {
    expect(() => codecs().executionPlan.validate(withValue(syntheticGitSyncPlan(), keyPath, value))).toThrow(reason);
  });

  it("refuses a push arm that no step consumes", () => {
    const plan = syntheticUninstallPlan();
    expect(() =>
      codecs().executionPlan.validate(withValue(plan, "push", { marker: "push", planHash: PUSH_HASH })),
    ).toThrow(/push arm/u);
  });

  it.each([["git_sync"], ["uninstall"]])("refuses a non-null previewHash for %s", (operation) => {
    const plan = operation === "git_sync" ? syntheticGitSyncPlan() : syntheticUninstallPlan();
    expect(() => codecs().executionPlan.validate(withValue(plan, "previewHash", hash("c")))).toThrow();
  });

  it.each([
    ["a foreign product home", "authority.productHome", "/elsewhere"],
    ["a wrong schemaVersion", "schemaVersion", 2],
    ["an unknown operation", "operation", "git_rebase"],
  ])("refuses %s", (_name, keyPath, value) => {
    expect(() => codecs().executionPlan.validate(withValue(syntheticUninstallPlan(), keyPath, value))).toThrow();
  });

  it("refuses a missing member", () => {
    expect(() => codecs().executionPlan.validate(withoutMember(syntheticUninstallPlan(), "push"))).toThrow();
  });

  it("hashes exactly the bytes it encodes when a leaf encoding is not its raw value", () => {
    const built = createLifecycleCodecs(rewritingLeafCodecs(), CONTEXT);
    const plan = syntheticUninstallPlan();
    const encoded = built.executionPlan.encode(plan);
    const persisted = decodeCanonicalJson(new TextEncoder().encode(encoded), 16_777_216);
    expect(built.executionPlan.hash(plan)).toBe(
      hashCanonicalJson("developer-os:lifecycle-coordinator-plan:v1", persisted),
    );
    expect(built.executionPlan.hash(plan)).not.toBe(
      hashCanonicalJson("developer-os:lifecycle-coordinator-plan:v1", plan as unknown as CanonicalJsonValue),
    );
  });

  it("hashes a plan whose leaves encode as themselves over its own canonical bytes", () => {
    const built = codecs();
    const plan = syntheticUninstallPlan();
    expect(built.executionPlan.hash(plan)).toBe(
      hashCanonicalJson("developer-os:lifecycle-coordinator-plan:v1", plan as unknown as CanonicalJsonValue),
    );
  });
});

describe("the Foundation participant reference", () => {
  it("admits a reference bound to its coordinator", () => {
    const [forward] = markerPair();
    expect(validateFoundationParticipantRef(forward, CONTEXT, COORDINATOR)).toStrictEqual(forward);
  });

  it("refuses a reference staged under another coordinator", () => {
    const [forward] = markerPair();
    const other = parseLifecycleCoordinatorId(formatAllocatedLifecycleId("lc", NONCE, 77n), NONCE);
    expect(() => validateFoundationParticipantRef(forward, CONTEXT, other)).toThrow();
  });

  it("binds a paired compensation ref as the exact reverse inverse of its forward ref", () => {
    const [forward, compensation] = syntheticArtifactPair();
    expect(() => {
      validateFoundationParticipantPair(forward, compensation);
    }).not.toThrow();
    expect(() => {
      validateFoundationParticipantPair(forward, {
        ...compensation,
        mutations: [...compensation.mutations].reverse(),
      });
    }).toThrow();
  });

  it.each([
    [
      "a compensation whose forwardId is not the forward",
      (compensation: FoundationParticipantRefV1): FoundationParticipantRefV1 => ({
        ...compensation,
        role: {
          kind: "compensation",
          forwardId: parseAllocatedLifecycleId("tx", participantId(60n), NONCE),
        },
      }),
    ],
    [
      "a compensation in another slot",
      (compensation: FoundationParticipantRefV1): FoundationParticipantRefV1 => ({
        ...compensation,
        slot: "config",
      }),
    ],
    [
      "a compensation with a different mutation count",
      (compensation: FoundationParticipantRefV1): FoundationParticipantRefV1 => ({
        ...compensation,
        mutations: compensation.mutations.slice(0, 1),
      }),
    ],
    [
      "an inverse that does not guard on the forward postimage",
      (compensation: FoundationParticipantRefV1): FoundationParticipantRefV1 => ({
        ...compensation,
        mutations: [
          { ...(compensation.mutations[0] as FoundationMutationRefV1), expectedBeforeHash: hash("c") },
          compensation.mutations[1] as FoundationMutationRefV1,
        ],
      }),
    ],
    [
      "an inverse that does not restore the forward preimage",
      (compensation: FoundationParticipantRefV1): FoundationParticipantRefV1 => ({
        ...compensation,
        mutations: [
          { ...(compensation.mutations[0] as FoundationMutationRefV1), contentHash: hash("c") },
          compensation.mutations[1] as FoundationMutationRefV1,
        ],
      }),
    ],
    [
      "an inverse with the wrong operation",
      (compensation: FoundationParticipantRefV1): FoundationParticipantRefV1 => ({
        ...compensation,
        mutations: [
          compensation.mutations[0] as FoundationMutationRefV1,
          { ...(compensation.mutations[1] as FoundationMutationRefV1), operation: "replace" },
        ],
      }),
    ],
    [
      "an inverse for another target path",
      (compensation: FoundationParticipantRefV1): FoundationParticipantRefV1 => ({
        ...compensation,
        mutations: [
          { ...(compensation.mutations[0] as FoundationMutationRefV1), targetPath: path("/brain/z.md") },
          compensation.mutations[1] as FoundationMutationRefV1,
        ],
      }),
    ],
  ])("refuses %s", (_name, edit) => {
    const [forward, compensation] = syntheticArtifactPair();
    expect(() => {
      validateFoundationParticipantPair(forward, edit(compensation));
    }).toThrow();
  });

  it("refuses a forward whose compensationId is not the compensation", () => {
    const [forward, compensation] = syntheticArtifactPair();
    expect(() => {
      validateFoundationParticipantPair({ ...forward, role: { kind: "forward", compensationId: null } }, compensation);
    }).toThrow();
  });

  it("refuses two forwards as a pair", () => {
    const [forward] = syntheticArtifactPair();
    expect(() => {
      validateFoundationParticipantPair(forward, forward);
    }).toThrow();
  });

  it("refuses a plan whose compensation reference is not reciprocal", () => {
    const plan = syntheticUninstallPlan();
    const edited = withValue(plan, "participants.foundation.1.role", {
      kind: "compensation",
      forwardId: participantId(ARTIFACTS_FORWARD_COUNTER),
    }) as SyntheticPlan;
    const ref = edited.participants.foundation[1] as FoundationParticipantRefV1;
    const rehashed = withValue(edited, "participants.foundation.1.planHash", foundationParticipantPlanHash(ref));
    expect(() => codecs().executionPlan.validate(rehashed)).toThrow();
  });

  it("hashes a reference over exactly its five immutable members", () => {
    const [forward] = markerPair();
    expect(forward.planHash).toBe(
      hashCanonicalJson("developer-os:foundation-participant-plan:v1", {
        slot: forward.slot,
        role: forward.role,
        mutations: forward.mutations,
        maximumJournalBytes: forward.maximumJournalBytes,
        initialJournal: forward.initialJournal,
      } as unknown as CanonicalJsonValue),
    );
  });
});

describe("the coordinator journal codec", () => {
  it("validates a planned journal", () => {
    expect(codecs().coordinatorJournal.validate(syntheticJournal())).toStrictEqual(syntheticJournal());
  });

  it.each(JOURNAL_KEY_PATHS)("refuses an unknown key at %s", (keyPath) => {
    expect(() => codecs().coordinatorJournal.validate(withExtraKey(syntheticJournal(), keyPath))).toThrow();
  });

  it("enumerates every phase", () => {
    expect(LIFECYCLE_COORDINATOR_PHASES.length).toBe(10);
  });

  it.each(LIFECYCLE_COORDINATOR_PHASES)("refuses null compaction members in %s when they must be set", (phase) => {
    const journal = withValue(syntheticJournal(), "phase", phase);
    const withCompensation =
      phase === "compensating" || phase === "rolled_back"
        ? withValue(journal, "compensationNext", 0)
        : journal;
    if (phase === "compacting") {
      expect(() => codecs().coordinatorJournal.validate(withCompensation)).toThrow();
      const complete = withValue(
        withValue(withCompensation, "compactionNext", 0),
        "terminalOutcome",
        "finalized",
      );
      expect(() => codecs().coordinatorJournal.validate(complete)).not.toThrow();
      return;
    }
    expect(() => codecs().coordinatorJournal.validate(withCompensation)).not.toThrow();
    expect(() => codecs().coordinatorJournal.validate(withValue(withCompensation, "compactionNext", 0))).toThrow();
    expect(() =>
      codecs().coordinatorJournal.validate(withValue(withCompensation, "terminalOutcome", "finalized")),
    ).toThrow();
  });

  it.each(LIFECYCLE_COORDINATOR_PHASES)("closes the compensation cursor rule in %s", (phase) => {
    const journal = withValue(syntheticJournal(), "phase", phase);
    const compensating = phase === "compensating" || phase === "rolled_back";
    const complete =
      phase === "compacting"
        ? withValue(withValue(journal, "compactionNext", 0), "terminalOutcome", "finalized")
        : journal;
    const withCursor = withValue(complete, "compensationNext", 0);
    if (compensating) {
      expect(() => codecs().coordinatorJournal.validate(withCursor)).not.toThrow();
      expect(() => codecs().coordinatorJournal.validate(complete)).toThrow(/compensationNext/u);
      return;
    }
    expect(() => codecs().coordinatorJournal.validate(withCursor)).toThrow(/compensationNext/u);
    expect(() => codecs().coordinatorJournal.validate(complete)).not.toThrow();
  });

  it.each([
    ["nextStep below zero", "nextStep", -1],
    ["nextStep above 256", "nextStep", 257],
    ["a fractional cursor", "nextStep", 1.5],
    ["compactionNext above 70", "compactionNext", 71],
    ["an unknown phase", "phase", "draining"],
    ["an unknown terminal outcome", "terminalOutcome", "compacted"],
    ["a non-timestamp createdAt", "createdAt", "2026-09-18"],
  ])("refuses %s", (_name, keyPath, value) => {
    expect(() => codecs().coordinatorJournal.validate(withValue(syntheticJournal(), keyPath, value))).toThrow();
  });

  it.each([
    ["-2", -2],
    ["256", 256],
  ])("refuses a compensation cursor of %s", (_name, value) => {
    const journal = withValue(syntheticJournal(), "phase", "compensating");
    expect(() => codecs().coordinatorJournal.validate(withValue(journal, "compensationNext", value))).toThrow();
  });

  it("accepts the -1 rolled-back compensation cursor", () => {
    const journal = withValue(withValue(syntheticJournal(), "phase", "rolled_back"), "compensationNext", -1);
    expect(() => codecs().coordinatorJournal.validate(journal)).not.toThrow();
  });

  it("refuses an encoded journal over 1,048,576 bytes", () => {
    const journal = { ...syntheticJournal(), planHash: "a".repeat(1_100_000) as LowerHexSha256 };
    expect(() => codecs().coordinatorJournal.encode(journal)).toThrow(/1048576|byte/u);
  });
});

describe("the plan preview codec", () => {
  it("hashes the preview without its previewHash member", () => {
    const preview = syntheticGitPreview();
    const rest = Object.fromEntries(
      Object.entries(preview).filter(([key]) => key !== "previewHash"),
    ) as Record<string, CanonicalJsonValue>;
    expect(lifecyclePreviewHash(preview)).toBe(
      hashCanonicalJson("developer-os:lifecycle-preview:v1", rest),
    );
  });

  it.each([
    ["a Git preview", syntheticGitPreview],
    ["an automation preview", syntheticAutomationPreview],
  ])("validates %s", (_name, build) => {
    const leaves = syntheticLeafCodecs();
    expect(createLifecycleCodecs(leaves, CONTEXT).preview.validate(build())).toStrictEqual(build());
    expect(leaves.calls.projection).toBe(1);
  });

  it("enumerates a non-empty set of preview key paths", () => {
    expect(PREVIEW_KEY_PATHS.length).toBeGreaterThan(0);
  });

  it.each(PREVIEW_KEY_PATHS)("refuses an unknown key at %s", (keyPath) => {
    expect(() => codecs().preview.validate(withExtraKey(syntheticGitPreview(), keyPath))).toThrow();
  });

  it("refuses a previewHash that is not the preview's digest", () => {
    expect(() => codecs().preview.validate(withValue(syntheticGitPreview(), "previewHash", hash("c")))).toThrow(
      /previewHash/u,
    );
  });

  it("refuses two file changes for one role and target path", () => {
    const preview = syntheticGitPreview();
    const files = [preview.files[0], preview.files[0]];
    const duplicated = withValue(preview, "files", files) as SyntheticPreview;
    const rehashed = withValue(duplicated, "previewHash", lifecyclePreviewHash(duplicated));
    expect(() => codecs().preview.validate(rehashed)).toThrow(/duplicate role and target path/u);
  });

  it("refuses 17 file changes", () => {
    const preview = syntheticGitPreview();
    const files = Array.from({ length: 17 }, () => preview.files[0]);
    expect(() => codecs().preview.validate(withValue(preview, "files", files))).toThrow();
  });

  it.each([
    ["a Git preview carrying launchd table hashes", syntheticGitPreview, "processTableTemplateHashes.launchd", {
      observation: OBSERVATION_HASH,
      mutationTemplate: MUTATION_TEMPLATE_HASH,
    }],
    ["a Git preview with a null Git table hash", syntheticGitPreview, "processTableTemplateHashes.git", null],
    ["a Git preview with a launchd arm", syntheticGitPreview, "launchd", { marker: "launchd-preview", tableHashes: { observation: OBSERVATION_HASH, mutationTemplate: MUTATION_TEMPLATE_HASH } }],
    ["a Git preview with no Git arm", syntheticGitPreview, "git", null],
    ["an automation preview carrying a Git table hash", syntheticAutomationPreview, "processTableTemplateHashes.git", GIT_TABLE_HASH],
    ["an automation preview with a Git arm", syntheticAutomationPreview, "git", { marker: "git-preview" }],
    ["an automation preview with no launchd arm", syntheticAutomationPreview, "launchd", null],
    ["an automation preview with null launchd table hashes", syntheticAutomationPreview, "processTableTemplateHashes.launchd", null],
  ])("refuses %s", (_name, build, keyPath, value) => {
    const preview = withValue(build(), keyPath, value) as SyntheticPreview;
    const rehashed = withValue(preview, "previewHash", lifecyclePreviewHash(preview));
    expect(() => codecs().preview.validate(rehashed)).toThrow();
  });

  it("refuses launchd table hashes that are not the nested preview's", () => {
    const preview = withValue(
      syntheticAutomationPreview(),
      "processTableTemplateHashes.launchd",
      { observation: OBSERVATION_HASH, mutationTemplate: hash("c") },
    ) as SyntheticPreview;
    const rehashed = withValue(preview, "previewHash", lifecyclePreviewHash(preview));
    expect(() => codecs().preview.validate(rehashed)).toThrow();
  });

  it.each([
    ["a command outside the four public commands", "command", "git_sync"],
    ["an execution operation outside the six", "executionOperation", "uninstall"],
    ["an execution operation in the other subsystem", "executionOperation", "automation_enable"],
    ["a foreign product home", "authority.productHome", "/elsewhere"],
    ["an unknown file role", "files.0.role", "runner_log"],
    ["an unknown file operation", "files.0.operation", "truncate"],
    ["an unknown file state", "files.0.before.state", "unknown"],
    ["a negative file size", "files.0.after.size", -1],
  ])("refuses %s", (_name, keyPath, value) => {
    const preview = withValue(syntheticGitPreview(), keyPath, value) as SyntheticPreview;
    const rehashed = withValue(preview, "previewHash", lifecyclePreviewHash(preview));
    expect(() => codecs().preview.validate(rehashed)).toThrow();
  });

  it("admits an absent preview file state", () => {
    const preview = withValue(syntheticGitPreview(), "files.0.before", { state: "absent" }) as SyntheticPreview;
    const rehashed = withValue(preview, "previewHash", lifecyclePreviewHash(preview));
    expect(() => codecs().preview.validate(rehashed)).not.toThrow();
  });

  it("encodes the preview as canonical JSON", () => {
    expect(codecs().preview.encode(syntheticGitPreview()).endsWith("\n")).toBe(true);
  });
});

describe("the exported effect identifiers", () => {
  it("keeps Git effect identifiers distinct from launchd ones", () => {
    const gitEffect: GitEffectIdV1 = SOURCE_EFFECT;
    expect(gitEffect.startsWith("ge_")).toBe(true);
    expect(LAUNCHD_EFFECT.startsWith("le_")).toBe(true);
  });
});
