import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ManifestStateParticipantError,
  EXIT_CODES,
  LIFECYCLE_STEP_GRAMMAR,
  formatAllocatedLifecycleId,
  foundationParticipantPlanHash,
  hashCanonicalJson,
  parseAllocatedLifecycleId,
  parseCanonicalAbsolutePathText,
  parseEffectiveUid,
  parseLifecycleCoordinatorId,
  parseLowerHexSha256,
  parseManifestParticipantId,
  parseUInt64Decimal,
  validateLifecyclePlanGrammar,
} from "@developer-os/core";
import type {
  AllocatedLifecycleIdV1,
  CanonicalAbsolutePathV1,
  FoundationParticipantRefV1,
  FoundationParticipantSlotV1,
  GitEffectIdV1,
  LaunchdEffectIdV1,
  LifecycleCodecContextV1,
  LifecycleCoordinatorIdV1,
  LifecycleCoordinatorStepV1,
  LifecycleInstallNonceV1,
  LowerHexSha256,
  ManifestStatePlanV1,
  UInt64DecimalV1,
} from "@developer-os/core";

import {
  createLifecycleExecutionPlanCodec,
  LifecycleUnsupportedLeafError,
  lifecyclePushPlanHash,
  lifecycleVariantFacts,
  uninstallLeasePaths,
} from "./codecs.js";
import type { LifecycleExecutionPlanV1 } from "./codecs.js";
import {
  createRedactionKeyStatePlanCodec,
  redactionKeySourcePath,
  redactionKeyStatePlanHash,
  redactionKeyTombstonePath,
} from "./redaction-key.js";
import type { RedactionKeyStatePlanV1 } from "./redaction-key.js";

const HOME = parseCanonicalAbsolutePathText("/product");
const STATE = parseCanonicalAbsolutePathText("/product/state");
const MANIFEST_PATH = parseCanonicalAbsolutePathText("/product/installation-manifest.json");
const NONCE: LifecycleInstallNonceV1 = parseLowerHexSha256("7a".repeat(32));
const CONTEXT: LifecycleCodecContextV1 = { productHome: HOME, nonce: NONCE };
const DEV: UInt64DecimalV1 = parseUInt64Decimal("16777232");
const INO: UInt64DecimalV1 = parseUInt64Decimal("184467440737095516");
const MANIFEST_BEFORE_HASH = parseLowerHexSha256(
  createHash("sha256").update("{}\n").digest("hex"),
);
const UID = process.getuid?.() ?? 0;
const OWNER_UID = parseEffectiveUid(UID, UID);

function hash(seed: string): LowerHexSha256 {
  return parseLowerHexSha256(seed.repeat(64).slice(0, 64));
}

function path(text: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(text);
}

function transactionId(counter: bigint): AllocatedLifecycleIdV1<"tx"> {
  return parseAllocatedLifecycleId("tx", formatAllocatedLifecycleId("tx", NONCE, counter), NONCE);
}

const COORDINATOR_ID: LifecycleCoordinatorIdV1 = parseLifecycleCoordinatorId(
  formatAllocatedLifecycleId("lc", NONCE, 1n),
  NONCE,
);
const MANIFEST_PARTICIPANT_ID = parseManifestParticipantId(
  formatAllocatedLifecycleId("mf", NONCE, 9n),
  NONCE,
);

function participantRef(options: {
  readonly id: AllocatedLifecycleIdV1<"tx">;
  readonly slot: FoundationParticipantSlotV1;
  readonly role: FoundationParticipantRefV1["role"];
}): FoundationParticipantRefV1 {
  const { id, slot, role } = options;
  const core = {
    slot,
    role,
    mutations:
      role.kind === "forward"
        ? [
            {
              targetPath: path(`/product/state/${slot}.json`),
              operation: "create" as const,
              expectedBeforeHash: null,
              contentHash: hash("4"),
              contentSize: 16,
              stagedPath: path(`/product/staging/transactions/${id}/0.bin`),
            },
          ]
        : [
            {
              targetPath: path(`/product/state/${slot}.json`),
              operation: "remove" as const,
              expectedBeforeHash: hash("4"),
              contentHash: null,
              contentSize: null,
              stagedPath: null,
            },
          ],
    maximumJournalBytes: 4_096,
    initialJournal: {
      finalPath: path(`/product/state/transactions/${id}.json`),
      plannedBytesHash: hash("6"),
      stagedPath: path(
        `/product/staging/lifecycle/${COORDINATOR_ID}/foundation/${id}/journal.json`,
      ),
      stagedIdentity: { hash: hash("7"), size: 512, mode: 384 as const, dev: DEV, ino: INO },
    },
  };
  return { id, ...core, planHash: foundationParticipantPlanHash(core) };
}

const FOUNDATION_BINDINGS_DOMAIN = "developer-os/manifest-foundation-bindings/v1\0";

function foundationBindingsHash(ids: readonly string[]): LowerHexSha256 {
  return parseLowerHexSha256(
    createHash("sha256").update(FOUNDATION_BINDINGS_DOMAIN).update(JSON.stringify(ids)).digest("hex"),
  );
}

const MARKER_FORWARD = transactionId(2n);
const MARKER_COMPENSATION = transactionId(3n);
const ARTIFACTS_FORWARD = transactionId(4n);
const ARTIFACTS_COMPENSATION = transactionId(5n);

const UNINSTALL_STEPS: readonly LifecycleCoordinatorStepV1[] = [
  { kind: "foundation", slot: "uninstall_marker", participantId: MARKER_FORWARD },
  { kind: "drain_runners" },
  { kind: "foundation", slot: "uninstall_artifacts", participantId: ARTIFACTS_FORWARD },
  { kind: "redaction_key", transition: "stage" },
  { kind: "manifest", transition: "preserve_before" },
  { kind: "manifest", transition: "commit_absence" },
  { kind: "redaction_key", transition: "delete" },
  { kind: "manifest", transition: "finalize_tombstones" },
];

const MANIFEST_LEAF: ManifestStatePlanV1 = {
  schemaVersion: 1,
  participantId: MANIFEST_PARTICIPANT_ID,
  envelope: { kind: "lifecycle", id: COORDINATOR_ID },
  bindings: {
    foundationTransactions: {
      count: 2,
      orderedIdsHash: foundationBindingsHash([MARKER_FORWARD, ARTIFACTS_FORWARD]),
    },
    externalEffects: [],
  },
  manifestPath: MANIFEST_PATH,
  tombstonePath: path(`/product/.installation-manifest.${MANIFEST_PARTICIPANT_ID}.json.tombstone`),
  before: {
    state: "present",
    hash: MANIFEST_BEFORE_HASH,
    bytes: null,
    ownerUid: UID,
    mode: 0o600,
    nlink: 1,
    size: parseUInt64Decimal("3"),
    dev: DEV,
    ino: INO,
  },
  after: { state: "absent" },
  maximumPlanBytes: 16_777_216,
  maximumJournalBytes: 1_048_576,
};

const REDACTION_KEY_LEAF: RedactionKeyStatePlanV1 = {
  schemaVersion: 1,
  coordinatorId: COORDINATOR_ID,
  sourcePath: path("/product/state/redaction.key"),
  tombstonePath: path(`/product/state/.redaction.key.${COORDINATOR_ID}.tombstone`),
  before: {
    state: "present",
    kind: "regular_file",
    ownerUid: OWNER_UID,
    mode: 384,
    nlink: 1,
    size: 32,
    dev: DEV,
    ino: INO,
  },
};

const UNINSTALL_PLAN: LifecycleExecutionPlanV1 = {
  schemaVersion: 1,
  id: COORDINATOR_ID,
  previewHash: null,
  operation: "uninstall",
  maximumJournalBytes: 8_192,
  authority: {
    productHome: HOME,
    configPath: path("/product/config.toml"),
    activationPath: path("/product/state/lifecycle-activation.json"),
    manifestPath: MANIFEST_PATH,
    repositoryRoot: null,
    plistPaths: [],
  },
  participants: {
    foundation: [
      participantRef({
        id: MARKER_FORWARD,
        slot: "uninstall_marker",
        role: { kind: "forward", compensationId: MARKER_COMPENSATION },
      }),
      participantRef({
        id: MARKER_COMPENSATION,
        slot: "uninstall_marker",
        role: { kind: "compensation", forwardId: MARKER_FORWARD },
      }),
      participantRef({
        id: ARTIFACTS_FORWARD,
        slot: "uninstall_artifacts",
        role: { kind: "forward", compensationId: ARTIFACTS_COMPENSATION },
      }),
      participantRef({
        id: ARTIFACTS_COMPENSATION,
        slot: "uninstall_artifacts",
        role: { kind: "compensation", forwardId: ARTIFACTS_FORWARD },
      }),
    ],
    manifest: MANIFEST_LEAF,
    sourceGitEffect: null,
    destinationGitEffect: null,
    launchdBeforeFiles: null,
    launchdAfterFiles: null,
    launchd: null,
    redactionKey: REDACTION_KEY_LEAF,
  },
  push: null,
  steps: UNINSTALL_STEPS,
};

const gitEffectId = (counter: bigint): GitEffectIdV1 =>
  parseAllocatedLifecycleId("ge", formatAllocatedLifecycleId("ge", NONCE, counter), NONCE);
const launchdEffectId = (counter: bigint): LaunchdEffectIdV1 =>
  parseAllocatedLifecycleId("le", formatAllocatedLifecycleId("le", NONCE, counter), NONCE);

/**
 * Core binds each effect arm to its own step inside `validate`, so an arm planted alone
 * refuses as a malformed plan rather than as an unsupported leaf: the pair is what reaches
 * the CLI's post-check.
 */
const UNSUPPORTED_EFFECT_PAIRS: readonly {
  readonly label: string;
  readonly plan: LifecycleExecutionPlanV1;
}[] = [
  {
    label: "sourceGitEffect",
    plan: {
      ...UNINSTALL_PLAN,
      participants: {
        ...UNINSTALL_PLAN.participants,
        sourceGitEffect: { id: gitEffectId(6n), planHash: hash("a") },
      },
      steps: [
        ...UNINSTALL_STEPS,
        { kind: "source_git_effect", participantId: gitEffectId(6n) },
      ],
    },
  },
  {
    label: "launchdBeforeFiles",
    plan: {
      ...UNINSTALL_PLAN,
      participants: {
        ...UNINSTALL_PLAN.participants,
        launchdBeforeFiles: { id: launchdEffectId(7n), planHash: hash("b") },
      },
      steps: [
        ...UNINSTALL_STEPS,
        { kind: "launchd_before_files", participantId: launchdEffectId(7n) },
      ],
    },
  },
  {
    label: "launchdAfterFiles",
    plan: {
      ...UNINSTALL_PLAN,
      participants: {
        ...UNINSTALL_PLAN.participants,
        launchdAfterFiles: { id: launchdEffectId(8n), planHash: hash("c") },
      },
      steps: [
        ...UNINSTALL_STEPS,
        { kind: "launchd_after_files", participantId: launchdEffectId(8n) },
      ],
    },
  },
];

function encodedPlan(plan: LifecycleExecutionPlanV1): unknown {
  return JSON.parse(createLifecycleExecutionPlanCodec(CONTEXT).encode(plan)) as unknown;
}

describe("the concrete lifecycle execution-plan codec", () => {
  it("round-trips an uninstall execution plan through its own bytes", () => {
    const codec = createLifecycleExecutionPlanCodec(CONTEXT);

    expect(codec.validate(UNINSTALL_PLAN)).toStrictEqual(UNINSTALL_PLAN);
    expect(codec.validate(encodedPlan(UNINSTALL_PLAN))).toStrictEqual(UNINSTALL_PLAN);
    expect(codec.encode(codec.validate(encodedPlan(UNINSTALL_PLAN)))).toBe(
      codec.encode(UNINSTALL_PLAN),
    );
  });

  it("admits the round-tripped plan under the grammar as the derived uninstall variant", () => {
    const codec = createLifecycleExecutionPlanCodec(CONTEXT);
    const plan = codec.validate(UNINSTALL_PLAN);

    expect(lifecycleVariantFacts(plan)).toStrictEqual({
      gitSync: null,
      automationReconcile: null,
      uninstallLaunchdEvidence: false,
    });
    expect(validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan))).toBe(
      "uninstall/present_manifest_without_launchd",
    );
    expect(lifecyclePushPlanHash(plan)).toBeNull();
  });

  it("refuses a non-null launchd leaf and a non-null push leaf as unsupported until plan 1b", () => {
    const codec = createLifecycleExecutionPlanCodec(CONTEXT);
    const unsupported = { marker: "plan-1b" };

    expect(() =>
      codec.validate({
        ...UNINSTALL_PLAN,
        participants: { ...UNINSTALL_PLAN.participants, launchd: unsupported },
      }),
    ).toThrow(LifecycleUnsupportedLeafError);
    expect(() => codec.validate({ ...UNINSTALL_PLAN, push: unsupported })).toThrow(
      LifecycleUnsupportedLeafError,
    );
  });

  it("refuses every 1b effect arm and its step as unsupported until plan 1b", () => {
    const codec = createLifecycleExecutionPlanCodec(CONTEXT);
    expect(UNSUPPORTED_EFFECT_PAIRS.length).toBeGreaterThan(0);

    for (const { label, plan } of UNSUPPORTED_EFFECT_PAIRS) {
      expect(() => codec.validate(plan), label).toThrow(LifecycleUnsupportedLeafError);
    }
  });

  it("publishes exit 4 and the plan-1b reason on the unsupported-leaf refusal", () => {
    const error = new LifecycleUnsupportedLeafError("launchd");

    expect(error.code).toBe(EXIT_CODES.capabilityUnavailable);
    expect(error.reason).toBe("unsupported_until_plan_1b");
  });

  it("refuses every non-uninstall operation in plan 1a", () => {
    const codec = createLifecycleExecutionPlanCodec(CONTEXT);
    const operations = Object.keys(LIFECYCLE_STEP_GRAMMAR)
      .map((variant) => variant.split("/")[0] ?? variant)
      .filter((operation) => operation !== "uninstall");
    expect(operations.length).toBeGreaterThan(0);

    for (const operation of new Set(operations)) {
      expect(() => codec.validate({ ...UNINSTALL_PLAN, operation }), operation).toThrow(
        LifecycleUnsupportedLeafError,
      );
    }
  });
});

describe("the concrete codec's manifest leaf", () => {
  const codec = createLifecycleExecutionPlanCodec(CONTEXT);

  function withManifest(overrides: Partial<ManifestStatePlanV1>): LifecycleExecutionPlanV1 {
    return {
      ...UNINSTALL_PLAN,
      participants: {
        ...UNINSTALL_PLAN.participants,
        manifest: { ...MANIFEST_LEAF, ...overrides },
      },
    };
  }

  it("binds the envelope to the plan's own coordinator ID", () => {
    expect(() =>
      codec.validate(
        withManifest({
          envelope: {
            kind: "lifecycle",
            id: parseLifecycleCoordinatorId(formatAllocatedLifecycleId("lc", NONCE, 2n), NONCE),
          },
        }),
      ),
    ).toThrow(ManifestStateParticipantError);
  });

  it("requires an allocated mf participant ID under the installation nonce", () => {
    const foreign = parseLowerHexSha256("5c".repeat(32));

    expect(() =>
      codec.validate(
        withManifest({
          participantId: parseManifestParticipantId(
            formatAllocatedLifecycleId("mf", foreign, 9n),
            foreign,
          ),
          tombstonePath: path(
            `/product/.installation-manifest.mf_${foreign}_9.json.tombstone`,
          ),
        }),
      ),
    ).toThrow(ManifestStateParticipantError);
  });

  it("binds foundationTransactions to the forward participants in step order", () => {
    expect(() =>
      codec.validate(
        withManifest({
          bindings: {
            foundationTransactions: {
              count: 2,
              orderedIdsHash: foundationBindingsHash([ARTIFACTS_FORWARD, MARKER_FORWARD]),
            },
            externalEffects: [],
          },
        }),
      ),
    ).toThrow(ManifestStateParticipantError);
  });

  it("refuses any external effect, a foreign tombstone and a raised plan ceiling", () => {
    expect(() =>
      codec.validate(
        withManifest({
          bindings: {
            foundationTransactions: MANIFEST_LEAF.bindings.foundationTransactions,
            externalEffects: [{ kind: "launchd", id: "launchd-0", planHash: hash("d") }],
          },
        }),
      ),
    ).toThrow(ManifestStateParticipantError);
    expect(() =>
      codec.validate(withManifest({ tombstonePath: path("/product/state/other.tombstone") })),
    ).toThrow(ManifestStateParticipantError);
    expect(() => codec.validate(withManifest({ maximumPlanBytes: 16_777_217 }))).toThrow(
      ManifestStateParticipantError,
    );
    expect(() => codec.validate(withManifest({ maximumJournalBytes: 1_048_577 }))).toThrow(
      ManifestStateParticipantError,
    );
  });
});

describe("the redaction-key state-plan codec", () => {
  const codec = createRedactionKeyStatePlanCodec(CONTEXT);

  it("derives the source and tombstone paths from the state directory and the coordinator", () => {
    expect(redactionKeySourcePath(STATE)).toBe("/product/state/redaction.key");
    expect(redactionKeyTombstonePath(STATE, COORDINATOR_ID)).toBe(
      `/product/state/.redaction.key.${COORDINATOR_ID}.tombstone`,
    );
  });

  it("round-trips a present opaque key and refuses a foreign coordinator's tombstone", () => {
    expect(codec.validate(REDACTION_KEY_LEAF)).toStrictEqual(REDACTION_KEY_LEAF);
    expect(codec.validate(JSON.parse(codec.encode(REDACTION_KEY_LEAF)) as unknown)).toStrictEqual(
      REDACTION_KEY_LEAF,
    );
    expect(() =>
      codec.validate({
        ...REDACTION_KEY_LEAF,
        tombstonePath: path(
          `/product/state/.redaction.key.${formatAllocatedLifecycleId("lc", NONCE, 2n)}.tombstone`,
        ),
      }),
    ).toThrow(/tombstonePath/u);
  });

  it("admits an absent key and refuses any key field beyond the opaque identity", () => {
    expect(codec.validate({ ...REDACTION_KEY_LEAF, before: { state: "absent" } })).toStrictEqual({
      ...REDACTION_KEY_LEAF,
      before: { state: "absent" },
    });
    expect(() =>
      codec.validate({
        ...REDACTION_KEY_LEAF,
        before: { ...REDACTION_KEY_LEAF.before, hash: hash("e") },
      }),
    ).toThrow(/SecretOpaqueFileStateV1/u);
    expect(() =>
      codec.validate({ ...REDACTION_KEY_LEAF, sourcePath: path("/product/state/other.key") }),
    ).toThrow(/sourcePath/u);
  });

  it("bounds the opaque size to 32..1048576 bytes and the mode to 0600", () => {
    for (const size of [31, 1_048_577]) {
      expect(() =>
        codec.validate({ ...REDACTION_KEY_LEAF, before: { ...REDACTION_KEY_LEAF.before, size } }),
      ).toThrow(/size/u);
    }
    expect(codec.validate({
      ...REDACTION_KEY_LEAF,
      before: { ...REDACTION_KEY_LEAF.before, size: 1_048_576 },
    }).before).toMatchObject({ size: 1_048_576 });
    expect(() =>
      codec.validate({ ...REDACTION_KEY_LEAF, before: { ...REDACTION_KEY_LEAF.before, mode: 420 } }),
    ).toThrow(/identity/u);
  });

  it("hashes under the redaction-key state-plan domain over the codec's own bytes", () => {
    expect(redactionKeyStatePlanHash(REDACTION_KEY_LEAF)).toBe(
      hashCanonicalJson(
        "developer-os:redaction-key-state-plan:v1",
        JSON.parse(codec.encode(REDACTION_KEY_LEAF)) as never,
      ),
    );
    expect(redactionKeyStatePlanHash(REDACTION_KEY_LEAF)).not.toBe(
      hashCanonicalJson(
        "developer-os:lifecycle-coordinator-plan:v1",
        JSON.parse(codec.encode(REDACTION_KEY_LEAF)) as never,
      ),
    );
  });
});

describe("the uninstall lease paths", () => {
  it("names the four automation locks in registry order", () => {
    expect(uninstallLeasePaths(HOME)).toStrictEqual([
      "/product/state/.automation-brain-reindex.lock",
      "/product/state/.automation-brain-lint.lock",
      "/product/state/.automation-doctor.lock",
      "/product/state/.automation-git-sync.lock",
    ]);
  });
});
