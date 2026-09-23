import { createHash } from "node:crypto";

import {
  SCHEDULED_JOB_IDS,
  deriveManifestPayloadPath,
  foundationParticipantPlanHash,
  formatAllocatedLifecycleId,
  gitScopeFingerprint,
  lifecyclePreviewHash,
  maximumCoordinatorJournalBytes,
  parseAllocatedLifecycleId,
  parseCanonicalAbsolutePathText,
  parseEffectiveUid,
  parseLifecycleCoordinatorId,
  parseLowerHexSha256,
  parseManifestParticipantId,
  parseNormalizedRemoteUrl,
  parseUInt64Decimal,
  parseValidatedGitBranch,
} from "@developer-os/core";
import type {
  AllocatedLifecycleIdV1,
  AutomationConfigV1,
  CanonicalAbsolutePathV1,
  EffectiveUidV1,
  FoundationParticipantRefV1,
  FoundationParticipantSlotV1,
  GitEffectIdV1,
  LaunchdEffectIdV1,
  LifecycleCoordinatorIdV1,
  LifecycleCoordinatorStepV1,
  LifecycleEffectRefV1,
  LifecycleInstallNonceV1,
  LowerHexSha256,
  ManifestParticipantIdV1,
  ManifestStatePlanV1,
  ScheduledJobIdV1,
  UInt64DecimalV1,
  VaultSegmentV1,
} from "@developer-os/core";
import {
  buildLaunchdPlanPreview,
  launchdGuiDomain,
  launchdPlistBytesHash,
  parseScheduledProductHome,
  planLaunchdTransitions,
} from "@developer-os/platform-macos";
import type { LaunchdPlanPreviewV1, LaunchdPriorJobStateV1 } from "@developer-os/platform-macos";
import { PERSISTED_GIT_PUSH_PLAN_CODEC, SUPPORTED_GIT_DISTRIBUTION } from "@developer-os/security";
import type { PersistedGitPushPlanV1 } from "@developer-os/security";

import type { LifecycleExecutionPlanV1, LifecyclePlanPreviewV1 } from "./codecs.js";
import type { RedactionKeyStatePlanV1 } from "./redaction-key.js";

const DEV: UInt64DecimalV1 = parseUInt64Decimal("16777232");
const INO: UInt64DecimalV1 = parseUInt64Decimal("184467440737095516");
const FOUNDATION_BINDINGS_DOMAIN = "developer-os/manifest-foundation-bindings/v1\0";

/** The synthetic manifest's own bytes: only its hash and length are load-bearing, not its content. */
export const SYNTHETIC_MANIFEST_BYTES = "{}\n";

export function foundationBindingsHash(ids: readonly string[]): LowerHexSha256 {
  return parseLowerHexSha256(
    createHash("sha256").update(FOUNDATION_BINDINGS_DOMAIN).update(JSON.stringify(ids)).digest("hex"),
  );
}

/** One synthetic Foundation participant: a create forward or its paired remove compensation. */
export function syntheticFoundationRef(options: {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly id: AllocatedLifecycleIdV1<"tx">;
  readonly slot: FoundationParticipantSlotV1;
  readonly role: FoundationParticipantRefV1["role"];
}): FoundationParticipantRefV1 {
  const { productHome, coordinatorId, id, slot, role } = options;
  const path = (text: string): CanonicalAbsolutePathV1 => parseCanonicalAbsolutePathText(text);
  const hash = (seed: string): LowerHexSha256 => parseLowerHexSha256(seed.repeat(64).slice(0, 64));
  const core = {
    slot,
    role,
    mutations:
      role.kind === "forward"
        ? [
            {
              targetPath: path(`${productHome}/state/${slot}.json`),
              operation: "create" as const,
              expectedBeforeHash: null,
              contentHash: hash("4"),
              contentSize: 16,
              stagedPath: path(`${productHome}/staging/transactions/${id}/0.bin`),
            },
          ]
        : [
            {
              targetPath: path(`${productHome}/state/${slot}.json`),
              operation: "remove" as const,
              expectedBeforeHash: hash("4"),
              contentHash: null,
              contentSize: null,
              stagedPath: null,
            },
          ],
    maximumJournalBytes: 4_096,
    initialJournal: {
      finalPath: path(`${productHome}/state/transactions/${id}.json`),
      plannedBytesHash: hash("6"),
      stagedPath: path(`${productHome}/staging/lifecycle/${coordinatorId}/foundation/${id}/journal.json`),
      stagedIdentity: { hash: hash("7"), size: 512, mode: 384 as const, dev: DEV, ino: INO },
    },
  };
  return { id, ...core, planHash: foundationParticipantPlanHash(core) };
}

export interface SyntheticUninstallV1 {
  readonly plan: LifecycleExecutionPlanV1;
  readonly id: LifecycleCoordinatorIdV1;
  readonly markerForward: AllocatedLifecycleIdV1<"tx">;
  readonly markerCompensation: AllocatedLifecycleIdV1<"tx">;
  readonly artifactsForward: AllocatedLifecycleIdV1<"tx">;
  readonly artifactsCompensation: AllocatedLifecycleIdV1<"tx">;
  readonly manifestParticipantId: ManifestParticipantIdV1;
  readonly steps: readonly LifecycleCoordinatorStepV1[];
  readonly manifest: ManifestStatePlanV1;
  readonly redactionKey: RedactionKeyStatePlanV1;
  readonly artifactsStep: number;
  readonly commitAbsenceStep: number;
}

/**
 * `uninstall/present_manifest_without_launchd` with every leaf the CLI codec owns: the plan
 * 1a variant D24 derives, because the `launchd` arm the `P` variant needs is refused here.
 *
 * `manifestCounter` defaults to the id right after the four foundation participants
 * (`base + 5n`). A caller that stages its own ids past `base + 4n` — codecs.test.ts plants
 * git/launchd effect ids at `base + 5n..base + 7n` — passes its own ninth id explicitly so
 * every counter in the plan stays distinct.
 */
export function syntheticUninstall(
  productHome: CanonicalAbsolutePathV1,
  nonce: LifecycleInstallNonceV1,
  base: bigint,
  manifestCounter: bigint = base + 5n,
): SyntheticUninstallV1 {
  const path = (text: string): CanonicalAbsolutePathV1 => parseCanonicalAbsolutePathText(text);
  const transactionId = (counter: bigint): AllocatedLifecycleIdV1<"tx"> =>
    parseAllocatedLifecycleId("tx", formatAllocatedLifecycleId("tx", nonce, counter), nonce);
  const uid = process.getuid?.() ?? 0;
  const ownerUid = parseEffectiveUid(uid, uid);

  const id = parseLifecycleCoordinatorId(formatAllocatedLifecycleId("lc", nonce, base), nonce);
  const manifestParticipantId = parseManifestParticipantId(
    formatAllocatedLifecycleId("mf", nonce, manifestCounter),
    nonce,
  );
  const markerForward = transactionId(base + 1n);
  const markerCompensation = transactionId(base + 2n);
  const artifactsForward = transactionId(base + 3n);
  const artifactsCompensation = transactionId(base + 4n);
  const manifestPath = path(`${productHome}/installation-manifest.json`);

  const participantRef = (options: {
    readonly id: AllocatedLifecycleIdV1<"tx">;
    readonly slot: FoundationParticipantSlotV1;
    readonly role: FoundationParticipantRefV1["role"];
  }): FoundationParticipantRefV1 => syntheticFoundationRef({ productHome, coordinatorId: id, ...options });

  const steps: readonly LifecycleCoordinatorStepV1[] = [
    { kind: "foundation", slot: "uninstall_marker", participantId: markerForward },
    { kind: "drain_runners" },
    { kind: "foundation", slot: "uninstall_artifacts", participantId: artifactsForward },
    { kind: "redaction_key", transition: "stage" },
    { kind: "manifest", transition: "preserve_before" },
    { kind: "manifest", transition: "commit_absence" },
    { kind: "redaction_key", transition: "delete" },
    { kind: "manifest", transition: "finalize_tombstones" },
  ];

  const manifest: ManifestStatePlanV1 = {
    schemaVersion: 1,
    participantId: manifestParticipantId,
    envelope: { kind: "lifecycle", id },
    bindings: {
      foundationTransactions: {
        count: 2,
        orderedIdsHash: foundationBindingsHash([markerForward, artifactsForward]),
      },
      externalEffects: [],
    },
    manifestPath,
    tombstonePath: path(
      `${productHome}/.installation-manifest.${manifestParticipantId}.json.tombstone`,
    ),
    before: {
      state: "present",
      hash: parseLowerHexSha256(createHash("sha256").update(SYNTHETIC_MANIFEST_BYTES).digest("hex")),
      bytes: null,
      ownerUid: uid,
      mode: 0o600,
      nlink: 1,
      size: parseUInt64Decimal(String(SYNTHETIC_MANIFEST_BYTES.length)),
      dev: DEV,
      ino: INO,
    },
    after: { state: "absent" },
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  };

  const redactionKey: RedactionKeyStatePlanV1 = {
    schemaVersion: 1,
    coordinatorId: id,
    sourcePath: path(`${productHome}/state/redaction.key`),
    tombstonePath: path(`${productHome}/state/.redaction.key.${id}.tombstone`),
    before: {
      state: "present",
      kind: "regular_file",
      ownerUid,
      mode: 384,
      nlink: 1,
      size: 32,
      dev: DEV,
      ino: INO,
    },
  };

  return {
    id,
    markerForward,
    markerCompensation,
    artifactsForward,
    artifactsCompensation,
    manifestParticipantId,
    steps,
    manifest,
    redactionKey,
    artifactsStep: 2,
    commitAbsenceStep: 5,
    plan: {
      schemaVersion: 1,
      id,
      previewHash: null,
      operation: "uninstall",
      maximumJournalBytes: 8_192,
      authority: {
        productHome,
        configPath: path(`${productHome}/config.toml`),
        activationPath: path(`${productHome}/state/lifecycle-activation.json`),
        manifestPath,
        repositoryRoot: null,
        plistPaths: [],
      },
      participants: {
        foundation: [
          participantRef({
            id: markerForward,
            slot: "uninstall_marker",
            role: { kind: "forward", compensationId: markerCompensation },
          }),
          participantRef({
            id: markerCompensation,
            slot: "uninstall_marker",
            role: { kind: "compensation", forwardId: markerForward },
          }),
          participantRef({
            id: artifactsForward,
            slot: "uninstall_artifacts",
            role: { kind: "forward", compensationId: artifactsCompensation },
          }),
          participantRef({
            id: artifactsCompensation,
            slot: "uninstall_artifacts",
            role: { kind: "compensation", forwardId: artifactsForward },
          }),
        ].sort((left, right) => (left.id < right.id ? -1 : 1)),
        manifest,
        sourceGitEffect: null,
        destinationGitEffect: null,
        launchdBeforeFiles: null,
        launchdAfterFiles: null,
        launchd: null,
        redactionKey,
      },
      push: null,
      steps,
    },
  };
}

const hex = (seed: string): LowerHexSha256 => parseLowerHexSha256(seed.repeat(64).slice(0, 64));
const sha256 = (text: string): LowerHexSha256 =>
  parseLowerHexSha256(createHash("sha256").update(text).digest("hex"));

function allocated(nonce: LifecycleInstallNonceV1): {
  readonly lc: (counter: bigint) => LifecycleCoordinatorIdV1;
  readonly tx: (counter: bigint) => AllocatedLifecycleIdV1<"tx">;
  readonly ge: (counter: bigint) => GitEffectIdV1;
  readonly le: (counter: bigint) => LaunchdEffectIdV1;
  readonly mf: (counter: bigint) => ManifestParticipantIdV1;
} {
  return {
    lc: (counter) => parseLifecycleCoordinatorId(formatAllocatedLifecycleId("lc", nonce, counter), nonce),
    tx: (counter) => parseAllocatedLifecycleId("tx", formatAllocatedLifecycleId("tx", nonce, counter), nonce),
    ge: (counter) => parseAllocatedLifecycleId("ge", formatAllocatedLifecycleId("ge", nonce, counter), nonce),
    le: (counter) => parseAllocatedLifecycleId("le", formatAllocatedLifecycleId("le", nonce, counter), nonce),
    mf: (counter) => parseManifestParticipantId(formatAllocatedLifecycleId("mf", nonce, counter), nonce),
  };
}

function withJournalMaximum(plan: Omit<LifecycleExecutionPlanV1, "maximumJournalBytes">): LifecycleExecutionPlanV1 {
  const base = { ...plan, maximumJournalBytes: 1 };
  return { ...base, maximumJournalBytes: maximumCoordinatorJournalBytes(base) };
}

function authority(productHome: CanonicalAbsolutePathV1, repositoryRoot: CanonicalAbsolutePathV1 | null): LifecycleExecutionPlanV1["authority"] {
  return {
    productHome,
    configPath: parseCanonicalAbsolutePathText(`${productHome}/config.toml`),
    activationPath: parseCanonicalAbsolutePathText(`${productHome}/state/lifecycle-activation.json`),
    manifestPath: parseCanonicalAbsolutePathText(`${productHome}/installation-manifest.json`),
    repositoryRoot,
    plistPaths: [],
  };
}

const NO_EFFECTS = {
  sourceGitEffect: null,
  destinationGitEffect: null,
  launchdBeforeFiles: null,
  launchdAfterFiles: null,
} as const;

export const SYNTHETIC_BRAIN = parseCanonicalAbsolutePathText("/synthetic-brain");
export const SYNTHETIC_REMOTE = parseCanonicalAbsolutePathText("/synthetic-remote.git");

/** A strictly valid persisted push plan: HTTPS, or the local arm bound to its destination effect. */
export function syntheticPushPlan(
  destination: "https" | { readonly destinationGitEffect: LifecycleEffectRefV1<GitEffectIdV1> },
): PersistedGitPushPlanV1 {
  const parent = "d".repeat(40);
  const commit = "c".repeat(40);
  const sourceBefore = {
    configHash: hex("1"),
    index: { state: "present", bytesHash: hex("2") },
    head: { state: "present", bytesHash: hex("3"), semantic: { kind: "symbolic_ref", value: "refs/heads/main" } },
    headReflog: { state: "present", bytesHash: hex("4"), size: 120 },
    branchReflog: { state: "present", bytesHash: hex("5"), size: 120 },
    branchRef: { state: "present", oid: parent, bytesHash: hex("6") },
  };
  const sourceAfter = {
    ...sourceBefore,
    index: { state: "present", bytesHash: hex("7") },
    headReflog: { state: "present", bytesHash: hex("8"), size: 240 },
    branchReflog: { state: "present", bytesHash: hex("9"), size: 240 },
    branchRef: { state: "present", oid: commit, bytesHash: hex("a") },
  };
  return PERSISTED_GIT_PUSH_PLAN_CODEC.validate({
    schemaVersion: 1,
    repositoryRoot: SYNTHETIC_BRAIN,
    branchRef: "refs/heads/main",
    commitOid: commit,
    remoteName: "developer-os",
    sourceShadowConfigTemplateHash: hex("b"),
    destination:
      destination === "https"
        ? { transport: "https", effectivePushUrl: "https://example.invalid/synthetic/brain.git" }
        : {
            transport: "local",
            effectivePushUrl: `file://${SYNTHETIC_REMOTE}`,
            repositoryRoot: SYNTHETIC_REMOTE,
            configHash: hex("c"),
            head: { state: "present", bytesHash: hex("d"), semantic: { kind: "symbolic_ref", value: "refs/heads/main" } },
            targetRef: { state: "absent" },
            targetReflog: { state: "absent" },
            destinationShadowConfigTemplateHash: hex("e"),
            destinationGitEffect: destination.destinationGitEffect,
          },
    sourceBefore,
    sourceAfter,
    distributionId: SUPPORTED_GIT_DISTRIBUTION.id,
    processTableHash: hex("0"),
  });
}

export type SyntheticGitSyncVariantV1 = "new_network" | "existing_network" | "new_local" | "existing_local";

/**
 * One `git_sync/*` plan with a push leaf. The sync record is the only Foundation participant and
 * sits past every variant's point of no return, so it carries no compensation.
 */
export function syntheticGitSync(
  productHome: CanonicalAbsolutePathV1,
  nonce: LifecycleInstallNonceV1,
  base: bigint,
  variant: SyntheticGitSyncVariantV1,
): LifecycleExecutionPlanV1 {
  const ids = allocated(nonce);
  const id = ids.lc(base);
  const syncRecord = ids.tx(base + 1n);
  const newCommit = variant.startsWith("new_");
  const local = variant.endsWith("_local");
  const source = newCommit ? { id: ids.ge(base + 2n), planHash: hex("a") } : null;
  const destination = local ? { id: ids.ge(base + 3n), planHash: hex("e") } : null;
  const push = syntheticPushPlan(destination === null ? "https" : { destinationGitEffect: destination });
  const pushPlanHash = PERSISTED_GIT_PUSH_PLAN_CODEC.hash(push);
  const steps: LifecycleCoordinatorStepV1[] = [];
  if (source !== null) steps.push({ kind: "source_git_effect", participantId: source.id });
  steps.push(
    destination === null
      ? { kind: "network_push", pushPlanHash }
      : { kind: "destination_git_effect", participantId: destination.id, pushPlanHash },
  );
  steps.push({ kind: "foundation", slot: "sync_record", participantId: syncRecord });
  return withJournalMaximum({
    schemaVersion: 1,
    id,
    previewHash: null,
    operation: "git_sync",
    authority: authority(productHome, SYNTHETIC_BRAIN),
    participants: {
      foundation: [
        syntheticFoundationRef({
          productHome,
          coordinatorId: id,
          id: syncRecord,
          slot: "sync_record",
          role: { kind: "forward", compensationId: null },
        }),
      ],
      manifest: null,
      ...NO_EFFECTS,
      sourceGitEffect: source,
      destinationGitEffect: destination,
      launchd: null,
      redactionKey: null,
    },
    push,
    steps,
  });
}

export const SYNTHETIC_MANIFEST_AFTER_BYTES = "{\"after\":true}\n";

/** `git_enable` with its manifest arm naming the `S` effect and a staged `update_expected` postimage. */
export function syntheticGitEnable(
  productHome: CanonicalAbsolutePathV1,
  nonce: LifecycleInstallNonceV1,
  base: bigint,
): LifecycleExecutionPlanV1 {
  const ids = allocated(nonce);
  const id = ids.lc(base);
  const activation = ids.tx(base + 1n);
  const activationCompensation = ids.tx(base + 2n);
  const config = ids.tx(base + 3n);
  const source = { id: ids.ge(base + 4n), planHash: hex("a") };
  const participantId = ids.mf(base + 5n);
  const planAuthority = authority(productHome, SYNTHETIC_BRAIN);
  const uid = process.getuid?.() ?? 0;
  const afterSize = parseUInt64Decimal(String(SYNTHETIC_MANIFEST_AFTER_BYTES.length));
  const manifest: ManifestStatePlanV1 = {
    schemaVersion: 1,
    participantId,
    envelope: { kind: "lifecycle", id },
    bindings: {
      foundationTransactions: { count: 2, orderedIdsHash: foundationBindingsHash([activation, config]) },
      externalEffects: [{ kind: "git", id: source.id, planHash: source.planHash }],
    },
    manifestPath: planAuthority.manifestPath,
    tombstonePath: parseCanonicalAbsolutePathText(
      `${productHome}/.installation-manifest.${participantId}.json.tombstone`,
    ),
    before: {
      state: "present",
      hash: sha256(SYNTHETIC_MANIFEST_BYTES),
      bytes: null,
      ownerUid: uid,
      mode: 0o600,
      nlink: 1,
      size: parseUInt64Decimal(String(SYNTHETIC_MANIFEST_BYTES.length)),
      dev: DEV,
      ino: INO,
    },
    after: {
      state: "present",
      hash: sha256(SYNTHETIC_MANIFEST_AFTER_BYTES),
      bytes: {
        kind: "update_expected",
        coordinatorId: id,
        ordinal: 0,
        path: deriveManifestPayloadPath(productHome, id as never, participantId as never),
        hash: sha256(SYNTHETIC_MANIFEST_AFTER_BYTES),
        bytes: SYNTHETIC_MANIFEST_AFTER_BYTES.length,
        mode: 0o600,
      },
      ownerUid: uid,
      mode: 0o600,
      nlink: 1,
      size: afterSize,
      dev: DEV,
      ino: parseUInt64Decimal("184467440737095517"),
    },
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  };
  const foundationRef = (
    refId: AllocatedLifecycleIdV1<"tx">,
    slot: FoundationParticipantSlotV1,
    role: FoundationParticipantRefV1["role"],
  ): FoundationParticipantRefV1 => syntheticFoundationRef({ productHome, coordinatorId: id, id: refId, slot, role });
  return withJournalMaximum({
    schemaVersion: 1,
    id,
    previewHash: hex("f"),
    operation: "git_enable",
    authority: planAuthority,
    participants: {
      foundation: [
        foundationRef(activation, "activation", { kind: "forward", compensationId: activationCompensation }),
        foundationRef(activationCompensation, "activation", { kind: "compensation", forwardId: activation }),
        foundationRef(config, "config", { kind: "forward", compensationId: null }),
      ].sort((left, right) => (left.id < right.id ? -1 : 1)),
      manifest,
      ...NO_EFFECTS,
      sourceGitEffect: source,
      launchd: null,
      redactionKey: null,
    },
    push: null,
    steps: [
      { kind: "manifest", transition: "preserve_before" },
      { kind: "foundation", slot: "activation", participantId: activation },
      { kind: "manifest", transition: "publish_after" },
      { kind: "source_git_effect", participantId: source.id },
      { kind: "foundation", slot: "config", participantId: config },
      { kind: "manifest", transition: "finalize_tombstones" },
    ],
  });
}

const SYNTHETIC_UID = 501 as EffectiveUidV1;
const SYNTHETIC_USER_HOME = parseCanonicalAbsolutePathText("/Users/synthetic");
const DAILY = { cadence: "daily", hour: 2, minute: 0 } as const;
const MANDATORY_JOBS = SCHEDULED_JOB_IDS.slice(0, 3);

function syntheticAutomation(): AutomationConfigV1 {
  return { schemaVersion: 1, schedules: MANDATORY_JOBS.map((job) => ({ job, schedule: DAILY })) };
}

function syntheticLaunchdPreview(
  productHome: CanonicalAbsolutePathV1,
  prior: Readonly<Partial<Record<ScheduledJobIdV1, LaunchdPriorJobStateV1>>>,
): LaunchdPlanPreviewV1 {
  const unloaded: LaunchdPriorJobStateV1 = { beforeFileHash: null, beforeGeneration: null, beforeLiveState: { state: "unloaded" } };
  return buildLaunchdPlanPreview({
    observationProcessTableHash: hex("1"),
    mutationProcessTableTemplateHash: hex("2"),
    domain: launchdGuiDomain(SYNTHETIC_UID),
    userHome: SYNTHETIC_USER_HOME,
    productHome: parseScheduledProductHome(productHome),
    executablePath: parseCanonicalAbsolutePathText(`${productHome}/bin/developer-os`),
    automation: syntheticAutomation(),
    prior: Object.fromEntries(SCHEDULED_JOB_IDS.map((job) => [job, prior[job] ?? unloaded])) as Record<
      ScheduledJobIdV1,
      LaunchdPriorJobStateV1
    >,
  });
}

/** Every mandatory job installed at its current generation, loaded except `doctor`. */
export function syntheticInstalledLaunchdPreview(productHome: CanonicalAbsolutePathV1): LaunchdPlanPreviewV1 {
  const fresh = syntheticLaunchdPreview(productHome, {});
  const prior: Partial<Record<ScheduledJobIdV1, LaunchdPriorJobStateV1>> = {};
  for (const entry of fresh.entries) {
    if (entry.plistBytes === null || entry.generation === null || entry.generatedLabel === null) {
      throw new Error("a fresh install entry carries its plist, generation and label");
    }
    prior[entry.job] = {
      beforeFileHash: launchdPlistBytesHash(entry.plistBytes),
      beforeGeneration: entry.generation,
      beforeLiveState:
        entry.job === "doctor"
          ? { state: "unloaded" }
          : { state: "loaded", label: entry.generatedLabel, generation: entry.generation },
    };
  }
  return syntheticLaunchdPreview(productHome, prior);
}

/** `automation_reconcile/live_only`: every plist kept, one `Q` that loads the unloaded `doctor`. */
export function syntheticAutomationLiveOnly(
  productHome: CanonicalAbsolutePathV1,
  nonce: LifecycleInstallNonceV1,
  base: bigint,
): LifecycleExecutionPlanV1 {
  const ids = allocated(nonce);
  const id = ids.lc(base);
  const previewHash = hex("4");
  const planAuthority = authority(productHome, null);
  const preview = syntheticInstalledLaunchdPreview(productHome);
  const launchd = planLaunchdTransitions({
    coordinatorId: id,
    coordinatorOperation: "automation_reconcile",
    previewHash,
    processTableHash: hex("3"),
    preview,
    config: { participantId: null, targetPath: planAuthority.configPath, expectedBeforeHash: hex("7"), afterHash: hex("7") },
    activation: {
      participantId: null,
      targetPath: planAuthority.activationPath,
      expectedBeforeHash: hex("9"),
      afterHash: hex("9"),
    },
    plistFiles: [],
    manifest: {
      path: planAuthority.manifestPath,
      statePlanHash: null,
      before: { state: "present", hash: hex("c") },
      after: { state: "present", hash: hex("c") },
    },
    beforeFilesEffectId: null,
    afterFilesEffectId: ids.le(base + 1n),
    bootstrapPlists: Object.fromEntries(
      preview.entries.map((entry) => {
        const retained = {
          path: entry.plistPath,
          ownerUid: SYNTHETIC_UID,
          mode: 384 as const,
          nlink: 1 as const,
          size: new TextEncoder().encode(entry.plistBytes ?? "").byteLength,
          hash: launchdPlistBytesHash(entry.plistBytes ?? ""),
          dev: DEV,
          ino: parseUInt64Decimal(String(900_000 + SCHEDULED_JOB_IDS.indexOf(entry.job))),
        };
        return [entry.job, { before: retained, after: retained }];
      }),
    ),
  });
  return withJournalMaximum({
    schemaVersion: 1,
    id,
    previewHash,
    operation: "automation_reconcile",
    authority: planAuthority,
    participants: {
      foundation: [],
      manifest: null,
      ...NO_EFFECTS,
      launchdAfterFiles: launchd.afterFilesEffect,
      launchd,
      redactionKey: null,
    },
    push: null,
    steps: launchd.afterFilesEffect === null ? [] : [{ kind: "launchd_after_files", participantId: launchd.afterFilesEffect.id }],
  });
}

/** A strictly valid `git_enable` preview over a local remote; its hash is computed, never typed. */
export function syntheticGitEnablePreview(productHome: CanonicalAbsolutePathV1): LifecyclePlanPreviewV1 {
  const branch = parseValidatedGitBranch("main");
  const url = parseNormalizedRemoteUrl(`file://${SYNTHETIC_REMOTE}`, "local");
  const remote = { name: "developer-os", transport: "local", declaredUrl: url, effectivePushUrl: url } as const;
  const scopeCore = {
    brainPath: SYNTHETIC_BRAIN,
    contentRoot: "content" as VaultSegmentV1,
    topicFolders: ["DEV" as VaultSegmentV1],
    topicAliases: {},
    indexesDir: "_indexes" as VaultSegmentV1,
  };
  const scope = { ...scopeCore, fingerprint: gitScopeFingerprint(scopeCore) };
  const planAuthority = authority(productHome, null);
  return withPreviewHash({
    schemaVersion: 1,
    previewHash: hex("0"),
    command: "git_enable",
    executionOperation: "git_enable",
    normalizedProjection: {
      subsystem: "git",
      enabledAfter: true,
      lifecycle: { schemaVersion: 1, repositoryRoot: SYNTHETIC_BRAIN, branch, remote, scope },
    },
    authority: {
      productHome,
      configPath: planAuthority.configPath,
      activationPath: planAuthority.activationPath,
      manifestPath: planAuthority.manifestPath,
    },
    processTableTemplateHashes: { git: hex("5"), launchd: null },
    files: [],
    git: { repositoryMode: "initialize", repositoryRoot: SYNTHETIC_BRAIN, branch, remote, scope, changes: [] },
    launchd: null,
  });
}

export function withPreviewHash(preview: LifecyclePlanPreviewV1): LifecyclePlanPreviewV1 {
  return { ...preview, previewHash: lifecyclePreviewHash(preview) };
}

/** An `automation_reconcile` preview over the installed jobs; its hash is computed, never typed. */
export function syntheticAutomationPreview(productHome: CanonicalAbsolutePathV1): LifecyclePlanPreviewV1 {
  const launchd = syntheticInstalledLaunchdPreview(productHome);
  const planAuthority = authority(productHome, null);
  return withPreviewHash({
    schemaVersion: 1,
    previewHash: hex("0"),
    command: "automation_enable",
    executionOperation: "automation_reconcile",
    normalizedProjection: { subsystem: "automation", enabledAfter: true, lifecycle: syntheticAutomation() },
    authority: {
      productHome,
      configPath: planAuthority.configPath,
      activationPath: planAuthority.activationPath,
      manifestPath: planAuthority.manifestPath,
    },
    processTableTemplateHashes: {
      git: null,
      launchd: {
        observation: launchd.observationProcessTableHash,
        mutationTemplate: launchd.mutationProcessTableTemplateHash,
      },
    },
    files: [],
    git: null,
    launchd,
  });
}
