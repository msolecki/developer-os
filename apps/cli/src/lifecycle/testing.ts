import { createHash } from "node:crypto";

import {
  foundationParticipantPlanHash,
  formatAllocatedLifecycleId,
  parseAllocatedLifecycleId,
  parseCanonicalAbsolutePathText,
  parseEffectiveUid,
  parseLifecycleCoordinatorId,
  parseLowerHexSha256,
  parseManifestParticipantId,
  parseUInt64Decimal,
} from "@developer-os/core";
import type {
  AllocatedLifecycleIdV1,
  CanonicalAbsolutePathV1,
  FoundationParticipantRefV1,
  FoundationParticipantSlotV1,
  LifecycleCoordinatorIdV1,
  LifecycleCoordinatorStepV1,
  LifecycleInstallNonceV1,
  LowerHexSha256,
  ManifestParticipantIdV1,
  ManifestStatePlanV1,
  UInt64DecimalV1,
} from "@developer-os/core";

import type { LifecycleExecutionPlanV1 } from "./codecs.js";
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
  const hash = (seed: string): LowerHexSha256 => parseLowerHexSha256(seed.repeat(64).slice(0, 64));

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
  }): FoundationParticipantRefV1 => {
    const core = {
      slot: options.slot,
      role: options.role,
      mutations:
        options.role.kind === "forward"
          ? [
              {
                targetPath: path(`${productHome}/state/${options.slot}.json`),
                operation: "create" as const,
                expectedBeforeHash: null,
                contentHash: hash("4"),
                contentSize: 16,
                stagedPath: path(`${productHome}/staging/transactions/${options.id}/0.bin`),
              },
            ]
          : [
              {
                targetPath: path(`${productHome}/state/${options.slot}.json`),
                operation: "remove" as const,
                expectedBeforeHash: hash("4"),
                contentHash: null,
                contentSize: null,
                stagedPath: null,
              },
            ],
      maximumJournalBytes: 4_096,
      initialJournal: {
        finalPath: path(`${productHome}/state/transactions/${options.id}.json`),
        plannedBytesHash: hash("6"),
        stagedPath: path(
          `${productHome}/staging/lifecycle/${id}/foundation/${options.id}/journal.json`,
        ),
        stagedIdentity: { hash: hash("7"), size: 512, mode: 384 as const, dev: DEV, ino: INO },
      },
    };
    return { id: options.id, ...core, planHash: foundationParticipantPlanHash(core) };
  };

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
