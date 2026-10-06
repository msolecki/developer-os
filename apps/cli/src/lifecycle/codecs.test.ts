import { describe, expect, it } from "vitest";

import {
  foundationBindingsHash,
  ManifestStateParticipantError,
  EXIT_CODES,
  LIFECYCLE_STEP_GRAMMAR,
  formatAllocatedLifecycleId,
  parseAllocatedLifecycleId,
  parseCanonicalAbsolutePathText,
  parseLifecycleCoordinatorId,
  parseLowerHexSha256,
  parseManifestParticipantId,
  validateLifecyclePlanGrammar,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  GitEffectIdV1,
  LaunchdEffectIdV1,
  LifecycleCodecContextV1,
  LifecycleInstallNonceV1,
  LowerHexSha256,
  ManifestStatePlanV1,
} from "@developer-os/core";

import { LAUNCHD_PLAN_PREVIEW_CODEC } from "@developer-os/platform-macos";
import { PERSISTED_GIT_PUSH_PLAN_CODEC } from "@developer-os/security";

import {
  createLifecycleExecutionCodecs,
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
  redactionKeyTombstonePath,
} from "./redaction-key.js";
import {
  syntheticAutomationLiveOnly,
  syntheticAutomationPreview,
  syntheticGitEnable,
  syntheticGitEnablePreview,
  syntheticGitSync,
  syntheticInstalledLaunchdPreview,
  syntheticUninstall,
  withPreviewHash,
} from "./testing.js";

const HOME = parseCanonicalAbsolutePathText("/product");
const STATE = parseCanonicalAbsolutePathText("/product/state");
const NONCE: LifecycleInstallNonceV1 = parseLowerHexSha256("7a".repeat(32));
const CONTEXT: LifecycleCodecContextV1 = { productHome: HOME, nonce: NONCE };

function hash(seed: string): LowerHexSha256 {
  return parseLowerHexSha256(seed.repeat(64).slice(0, 64));
}

function path(text: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(text);
}

// Base 1 spends counters 2..5 on the foundation participants; the manifest's own counter
// jumps to 9 so it never collides with the git/launchd effect ids (6, 7, 8) staged below.
const SYNTHETIC = syntheticUninstall(HOME, NONCE, 1n, 9n);
const COORDINATOR_ID = SYNTHETIC.id;
const MARKER_FORWARD = SYNTHETIC.markerForward;
const ARTIFACTS_FORWARD = SYNTHETIC.artifactsForward;
const UNINSTALL_STEPS = SYNTHETIC.steps;
const MANIFEST_LEAF: ManifestStatePlanV1 = SYNTHETIC.manifest;
const REDACTION_KEY_LEAF = SYNTHETIC.redactionKey;
const UNINSTALL_PLAN: LifecycleExecutionPlanV1 = SYNTHETIC.plan;

const gitEffectId = (counter: bigint): GitEffectIdV1 =>
  parseAllocatedLifecycleId("ge", formatAllocatedLifecycleId("ge", NONCE, counter), NONCE);
const launchdEffectId = (counter: bigint): LaunchdEffectIdV1 =>
  parseAllocatedLifecycleId("le", formatAllocatedLifecycleId("le", NONCE, counter), NONCE);

/**
 * Core binds each effect arm to its own step inside `validate`, so an arm planted alone
 * refuses as a malformed plan: the pair is what reaches the grammar.
 */
const EFFECT_PAIRS: readonly {
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

  it("refuses a malformed launchd leaf and push leaf as invalid bytes, not as unsupported arms", () => {
    const codec = createLifecycleExecutionPlanCodec(CONTEXT);
    const malformed = { marker: "not-a-leaf" };

    for (const plan of [
      { ...UNINSTALL_PLAN, participants: { ...UNINSTALL_PLAN.participants, launchd: malformed } },
      { ...UNINSTALL_PLAN, push: malformed },
    ]) {
      expect(() => codec.validate(plan)).toThrow();
      expect(() => codec.validate(plan)).not.toThrow(LifecycleUnsupportedLeafError);
    }
  });

  it("admits every effect arm with its step and leaves the uninstall grammar to refuse the pair", () => {
    const codec = createLifecycleExecutionPlanCodec(CONTEXT);
    expect(EFFECT_PAIRS.length).toBeGreaterThan(0);

    for (const { label, plan } of EFFECT_PAIRS) {
      const admitted = codec.validate(plan);
      expect(() => validateLifecyclePlanGrammar(admitted, lifecycleVariantFacts(admitted)), label).toThrow();
    }
  });

  it("publishes exit 4 and the plan-1b reason on the unsupported-leaf refusal", () => {
    const error = new LifecycleUnsupportedLeafError("launchd");

    expect(error.code).toBe(EXIT_CODES.capabilityUnavailable);
    expect(error.reason).toBe("unsupported_until_plan_1b");
  });

  it("admits every operation's bytes and leaves an uninstall step list under another operation to the grammar", () => {
    const codec = createLifecycleExecutionPlanCodec(CONTEXT);
    const operations = Object.keys(LIFECYCLE_STEP_GRAMMAR)
      .map((variant) => variant.split("/")[0] ?? variant)
      .filter((operation) => operation !== "uninstall" && operation !== "git_sync");
    expect(operations.length).toBeGreaterThan(0);

    for (const operation of new Set(operations)) {
      const plan = codec.validate({ ...UNINSTALL_PLAN, operation });
      expect(() => validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan)), operation).toThrow();
    }
  });
});

describe("the composed Git, launchd and push leaves", () => {
  const codecs = createLifecycleExecutionCodecs(CONTEXT);
  const gitEnablePlanFixture = syntheticGitEnable(HOME, NONCE, 20n);
  const automationLiveOnlyFixture = syntheticAutomationLiveOnly(HOME, NONCE, 40n);
  const gitSyncNewNetworkFixture = syntheticGitSync(HOME, NONCE, 30n, "new_network");
  const gitSyncExistingLocalFixture = syntheticGitSync(HOME, NONCE, 50n, "existing_local");
  const gitPreviewFixture = syntheticGitEnablePreview(HOME);
  const mixedPreviewFixture = withPreviewHash({
    ...gitPreviewFixture,
    launchd: syntheticInstalledLaunchdPreview(HOME),
  });

  it("round-trips a git_enable execution plan and a live-only automation plan", () => {
    for (const plan of [gitEnablePlanFixture, automationLiveOnlyFixture]) {
      expect(codecs.executionPlan.validate(JSON.parse(codecs.executionPlan.encode(plan)))).toEqual(plan);
    }
  });

  it("no longer refuses Git or launchd step kinds with unsupported_until_plan_1b", () => {
    expect(() => codecs.executionPlan.validate(gitSyncNewNetworkFixture)).not.toThrow();
    const plan = codecs.executionPlan.validate(gitSyncNewNetworkFixture);
    expect(validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan))).toBe("git_sync/new_network");
  });

  it("derives every git_sync variant and the live-only reconcile from the plan's own leaves", () => {
    const rows = [
      { plan: gitSyncNewNetworkFixture, variant: "git_sync/new_network" },
      { plan: syntheticGitSync(HOME, NONCE, 60n, "existing_network"), variant: "git_sync/existing_network" },
      { plan: syntheticGitSync(HOME, NONCE, 70n, "new_local"), variant: "git_sync/new_local" },
      { plan: gitSyncExistingLocalFixture, variant: "git_sync/existing_local" },
      { plan: automationLiveOnlyFixture, variant: "automation_reconcile/live_only" },
      { plan: gitEnablePlanFixture, variant: "git_enable" },
    ] as const;
    expect(rows.length).toBeGreaterThan(0);

    for (const { plan, variant } of rows) {
      expect(validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan)), variant).toBe(variant);
    }
    expect(lifecycleVariantFacts(automationLiveOnlyFixture).automationReconcile).toBe("live_only");
  });

  it("derives git_sync variant facts from the plan rather than hardcoding null", () => {
    expect(lifecycleVariantFacts(gitSyncExistingLocalFixture).gitSync).toEqual({
      newCommit: false,
      transport: "local",
      noChanges: false,
    });
    expect(lifecycleVariantFacts(gitSyncNewNetworkFixture).gitSync).toEqual({
      newCommit: true,
      transport: "network",
      noChanges: false,
    });
  });

  it("hashes the push leaf with the persisted push-plan codec and leaves a push-free plan null", () => {
    const push = gitSyncNewNetworkFixture.push;
    expect(push).not.toBeNull();
    expect(lifecyclePushPlanHash(gitSyncNewNetworkFixture)).toBe(
      PERSISTED_GIT_PUSH_PLAN_CODEC.hash(push as NonNullable<typeof push>),
    );
    expect(lifecyclePushPlanHash(gitEnablePlanFixture)).toBeNull();
  });

  it("refuses a launchd leaf the coordinator does not bind", () => {
    const plan = {
      ...automationLiveOnlyFixture,
      authority: { ...automationLiveOnlyFixture.authority, configPath: path("/product/other-config.toml") },
    };

    expect(() => codecs.executionPlan.validate(plan)).toThrow();
  });

  it("lets the manifest arm name only the plan's own journaled effect", () => {
    const manifest = gitEnablePlanFixture.participants.manifest as ManifestStatePlanV1;
    const foreign = {
      ...gitEnablePlanFixture,
      participants: {
        ...gitEnablePlanFixture.participants,
        manifest: {
          ...manifest,
          bindings: {
            ...manifest.bindings,
            externalEffects: [{ kind: "git" as const, id: gitEffectId(99n), planHash: hash("a") }],
          },
        },
      },
    };

    expect(() => codecs.executionPlan.validate(foreign)).toThrow(ManifestStateParticipantError);
  });

  it("round-trips a git_enable preview through the Git preview and projection leaves", () => {
    expect(codecs.preview.validate(JSON.parse(codecs.preview.encode(gitPreviewFixture)))).toEqual(gitPreviewFixture);
  });

  it("round-trips an automation preview through the launchd preview leaf and binds its table hashes", () => {
    const preview = syntheticAutomationPreview(HOME);
    expect(preview.launchd?.entries.length).toBeGreaterThan(0);

    expect(codecs.preview.validate(JSON.parse(codecs.preview.encode(preview)))).toEqual(preview);
    const drifted = withPreviewHash({
      ...preview,
      processTableTemplateHashes: {
        git: null,
        launchd: { observation: hash("e"), mutationTemplate: preview.launchd?.mutationProcessTableTemplateHash ?? hash("e") },
      },
    });
    expect(() => codecs.preview.validate(drifted)).toThrow(/launchd table hashes/u);
  });

  it("refuses a launchd preview entry that carries a bootstrap identity or leaves registry order", () => {
    const launchd = syntheticInstalledLaunchdPreview(HOME);
    const [first, second] = launchd.entries;
    if (first === undefined || second === undefined) throw new Error("the fixture installs three jobs");

    expect(LAUNCHD_PLAN_PREVIEW_CODEC.validate(JSON.parse(LAUNCHD_PLAN_PREVIEW_CODEC.encode(launchd)))).toEqual(launchd);
    expect(() =>
      LAUNCHD_PLAN_PREVIEW_CODEC.validate({
        ...launchd,
        entries: [{ ...first, bootstrapPlists: { before: null, after: null } }],
      }),
    ).toThrow();
    expect(() => LAUNCHD_PLAN_PREVIEW_CODEC.validate({ ...launchd, entries: [second, first] })).toThrow();
  });

  it("still refuses a preview with both git and launchd members", () => {
    expect(() => codecs.preview.validate(mixedPreviewFixture)).toThrow(/Git preview arms/u);
  });

  it("refuses a projection with an unknown subsystem, an extra key or a lifecycle the config schema refuses", () => {
    const projection = gitPreviewFixture.normalizedProjection;
    const refused = [
      { ...projection, subsystem: "vendor" },
      { ...projection, extra: true },
      { ...projection, lifecycle: { ...(projection.lifecycle as object), branch: "../main" } },
    ];
    expect(refused.length).toBeGreaterThan(0);

    for (const normalizedProjection of refused) {
      expect(() =>
        codecs.preview.validate(withPreviewHash({ ...gitPreviewFixture, normalizedProjection } as never)),
      ).toThrow();
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
});

describe("the uninstall lease paths", () => {
  it("names the six automation locks in registry order", () => {
    expect(uninstallLeasePaths(HOME)).toStrictEqual([
      "/product/state/.automation-brain-reindex.lock",
      "/product/state/.automation-brain-lint.lock",
      "/product/state/.automation-doctor.lock",
      "/product/state/.automation-git-sync.lock",
      "/product/state/.automation-brain-garden.lock",
      "/product/state/.automation-brain-pulse.lock",
    ]);
  });
});
