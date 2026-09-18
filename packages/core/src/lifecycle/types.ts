import type { FoundationMutationRefV1 } from "../manifest/bootstrap.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import type { CanonicalAbsolutePathV1 } from "../update/paths.js";
import type { LowerHexSha256, UInt64DecimalV1, UtcTimestampV1 } from "../update/scalars.js";
import type {
  AllocatedLifecycleIdV1,
  FoundationTransactionIdV1,
  GitEffectIdV1,
  LaunchdEffectIdV1,
} from "./ids.js";

export const LIFECYCLE_COORDINATOR_OPERATIONS = [
  "git_enable",
  "git_disable",
  "git_reconcile",
  "git_sync",
  "automation_enable",
  "automation_disable",
  "automation_reconcile",
  "uninstall",
] as const;
export type LifecycleCoordinatorOperationV1 = (typeof LIFECYCLE_COORDINATOR_OPERATIONS)[number];

export const LIFECYCLE_COORDINATOR_PHASES = [
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
] as const;
export type LifecycleCoordinatorPhaseV1 = (typeof LIFECYCLE_COORDINATOR_PHASES)[number];

export const LIFECYCLE_TERMINAL_OUTCOMES = ["finalized", "rolled_back"] as const;
export type LifecycleTerminalOutcomeV1 = (typeof LIFECYCLE_TERMINAL_OUTCOMES)[number];

export const FOUNDATION_PARTICIPANT_SLOTS = [
  "activation",
  "config",
  "plist_files",
  "sync_record",
  "uninstall_marker",
  "uninstall_artifacts",
] as const;
export type FoundationParticipantSlotV1 = (typeof FOUNDATION_PARTICIPANT_SLOTS)[number];

export const FOUNDATION_MUTATION_OPERATIONS = ["create", "replace", "remove"] as const;

export const LIFECYCLE_MANIFEST_STEP_TRANSITIONS = [
  "preserve_before",
  "publish_after",
  "commit_absence",
  "finalize_tombstones",
] as const;
export const LIFECYCLE_REDACTION_KEY_STEP_TRANSITIONS = ["stage", "delete"] as const;
export const LIFECYCLE_COORDINATOR_STEP_KINDS = [
  "foundation",
  "manifest",
  "source_git_effect",
  "destination_git_effect",
  "launchd_before_files",
  "launchd_after_files",
  "redaction_key",
  "network_push",
  "drain_runners",
] as const;

export const LIFECYCLE_PREVIEW_COMMANDS = [
  "git_enable",
  "git_disable",
  "automation_enable",
  "automation_disable",
] as const;
export const LIFECYCLE_PREVIEW_EXECUTION_OPERATIONS = [
  "git_enable",
  "git_disable",
  "git_reconcile",
  "automation_enable",
  "automation_disable",
  "automation_reconcile",
] as const;
export const LIFECYCLE_PREVIEW_FILE_ROLES = [
  "activation",
  "config",
  "plist",
  "manifest",
  "source_git",
  "destination_git",
  "redaction_key",
] as const;
export const LIFECYCLE_PREVIEW_FILE_OPERATIONS = ["create", "replace", "remove", "keep"] as const;
export const LIFECYCLE_PREVIEW_FILE_STATES = ["absent", "present"] as const;

export const LIFECYCLE_COMPACTION_ENTRY_KINDS = [
  "foundation_transaction",
  "git_effect",
  "launchd_effect",
  "coordinator_staging",
  "coordinator_envelope",
] as const;
export const LIFECYCLE_JOURNAL_CLOSURE_KINDS = [
  "clear",
  "retry_only",
  "uninstall_draining",
  "lifecycle_recovery_required",
] as const;

export const LIFECYCLE_SUBSYSTEMS = ["git", "automation"] as const;
export type LifecycleSubsystemV1 = (typeof LIFECYCLE_SUBSYSTEMS)[number];

export const LIFECYCLE_PLAN_BOUNDS = {
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
} as const;

export const LIFECYCLE_HASH_DOMAINS = {
  coordinatorPlan: "developer-os:lifecycle-coordinator-plan:v1",
  foundationParticipantPlan: "developer-os:foundation-participant-plan:v1",
  preview: "developer-os:lifecycle-preview:v1",
} as const;

/** Spec 1 §2.4: a guarded 0600 regular file, which is the only staged-identity mode. */
export const FOUNDATION_STAGED_JOURNAL_MODE = 0o600;

export interface LifecycleCoordinatorJournalV1 {
  readonly schemaVersion: 1;
  readonly id: LifecycleCoordinatorIdV1;
  readonly operation: LifecycleCoordinatorOperationV1;
  readonly phase: LifecycleCoordinatorPhaseV1;
  readonly planHash: LowerHexSha256;
  readonly pushPlanHash: LowerHexSha256 | null;
  readonly nextStep: number;
  readonly compensationNext: number | null;
  readonly compactionNext: number | null;
  readonly terminalOutcome: LifecycleTerminalOutcomeV1 | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

export type LifecycleCoordinatorStepV1 =
  | {
      readonly kind: "foundation";
      readonly slot: FoundationParticipantSlotV1;
      readonly participantId: AllocatedLifecycleIdV1<"tx">;
    }
  | {
      readonly kind: "manifest";
      readonly transition: (typeof LIFECYCLE_MANIFEST_STEP_TRANSITIONS)[number];
    }
  | { readonly kind: "source_git_effect"; readonly participantId: GitEffectIdV1 }
  | {
      readonly kind: "destination_git_effect";
      readonly participantId: GitEffectIdV1;
      readonly pushPlanHash: LowerHexSha256;
    }
  | { readonly kind: "launchd_before_files"; readonly participantId: LaunchdEffectIdV1 }
  | { readonly kind: "launchd_after_files"; readonly participantId: LaunchdEffectIdV1 }
  | {
      readonly kind: "redaction_key";
      readonly transition: (typeof LIFECYCLE_REDACTION_KEY_STEP_TRANSITIONS)[number];
    }
  | { readonly kind: "network_push"; readonly pushPlanHash: LowerHexSha256 }
  | { readonly kind: "drain_runners" };

export interface FoundationParticipantRefV1 {
  readonly id: AllocatedLifecycleIdV1<"tx">;
  readonly slot: FoundationParticipantSlotV1;
  readonly role:
    | { readonly kind: "forward"; readonly compensationId: AllocatedLifecycleIdV1<"tx"> | null }
    | { readonly kind: "compensation"; readonly forwardId: AllocatedLifecycleIdV1<"tx"> };
  readonly mutations: readonly FoundationMutationRefV1[];
  readonly maximumJournalBytes: number;
  readonly planHash: LowerHexSha256;
  readonly initialJournal: {
    readonly finalPath: CanonicalAbsolutePathV1;
    readonly plannedBytesHash: LowerHexSha256;
    readonly stagedPath: CanonicalAbsolutePathV1;
    readonly stagedIdentity: {
      readonly hash: LowerHexSha256;
      readonly size: number;
      readonly mode: 384;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    };
  };
}

export interface LifecycleEffectRefV1<Id> {
  readonly id: Id;
  readonly planHash: LowerHexSha256;
}

export interface LifecycleCoordinatorPlanCoreV1<TManifest, TLaunchd, TRedactionKey, TPush> {
  readonly schemaVersion: 1;
  readonly id: LifecycleCoordinatorIdV1;
  readonly previewHash: LowerHexSha256 | null;
  readonly operation: LifecycleCoordinatorOperationV1;
  readonly maximumJournalBytes: number;
  readonly authority: {
    readonly productHome: CanonicalAbsolutePathV1;
    readonly configPath: CanonicalAbsolutePathV1;
    readonly activationPath: CanonicalAbsolutePathV1;
    readonly manifestPath: CanonicalAbsolutePathV1;
    readonly repositoryRoot: CanonicalAbsolutePathV1 | null;
    readonly plistPaths: readonly CanonicalAbsolutePathV1[];
  };
  readonly participants: {
    readonly foundation: readonly FoundationParticipantRefV1[];
    readonly manifest: TManifest | null;
    readonly sourceGitEffect: LifecycleEffectRefV1<GitEffectIdV1> | null;
    readonly destinationGitEffect: LifecycleEffectRefV1<GitEffectIdV1> | null;
    readonly launchdBeforeFiles: LifecycleEffectRefV1<LaunchdEffectIdV1> | null;
    readonly launchdAfterFiles: LifecycleEffectRefV1<LaunchdEffectIdV1> | null;
    readonly launchd: TLaunchd | null;
    readonly redactionKey: TRedactionKey | null;
  };
  readonly push: TPush | null;
  readonly steps: readonly LifecycleCoordinatorStepV1[];
}

export type LifecyclePreviewFileStateV1 =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly hash: LowerHexSha256; readonly size: number };

export interface LifecyclePreviewFileChangeV1 {
  readonly role: (typeof LIFECYCLE_PREVIEW_FILE_ROLES)[number];
  readonly targetPath: CanonicalAbsolutePathV1;
  readonly operation: (typeof LIFECYCLE_PREVIEW_FILE_OPERATIONS)[number];
  readonly before: LifecyclePreviewFileStateV1;
  readonly after: LifecyclePreviewFileStateV1;
}

export interface LifecyclePlanPreviewCoreV1<TProjection, TGitPreview, TLaunchdPreview> {
  readonly schemaVersion: 1;
  readonly previewHash: LowerHexSha256;
  readonly command: (typeof LIFECYCLE_PREVIEW_COMMANDS)[number];
  readonly executionOperation: (typeof LIFECYCLE_PREVIEW_EXECUTION_OPERATIONS)[number];
  readonly normalizedProjection: TProjection;
  readonly authority: {
    readonly productHome: CanonicalAbsolutePathV1;
    readonly configPath: CanonicalAbsolutePathV1;
    readonly activationPath: CanonicalAbsolutePathV1;
    readonly manifestPath: CanonicalAbsolutePathV1;
  };
  readonly processTableTemplateHashes: {
    readonly git: LowerHexSha256 | null;
    readonly launchd: null | {
      readonly observation: LowerHexSha256;
      readonly mutationTemplate: LowerHexSha256;
    };
  };
  readonly files: readonly LifecyclePreviewFileChangeV1[];
  readonly git: TGitPreview | null;
  readonly launchd: TLaunchdPreview | null;
}

export type LifecycleCompactionEntryV1 =
  | { readonly kind: "foundation_transaction"; readonly participantId: FoundationTransactionIdV1 }
  | {
      readonly kind: "git_effect";
      readonly side: "source" | "destination";
      readonly participantId: GitEffectIdV1;
    }
  | {
      readonly kind: "launchd_effect";
      readonly position: "before_files" | "after_files";
      readonly participantId: LaunchdEffectIdV1;
    }
  | { readonly kind: "coordinator_staging" }
  | { readonly kind: "coordinator_envelope" };

export interface LifecycleTerminalCompactionV1 {
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly terminalOutcome: LifecycleTerminalOutcomeV1;
  readonly entries: readonly LifecycleCompactionEntryV1[];
}

export interface FoundationTerminalCompactionV1 {
  readonly transactionId: FoundationTransactionIdV1;
  readonly terminalPhase: LifecycleTerminalOutcomeV1;
  readonly mutationCount: number;
}

export type LifecycleJournalClosureV1 =
  | { readonly kind: "clear" }
  | {
      readonly kind: "retry_only";
      readonly transactionId: LifecycleCoordinatorIdV1;
      readonly pushPlanHash: LowerHexSha256;
    }
  | { readonly kind: "uninstall_draining"; readonly transactionId: LifecycleCoordinatorIdV1 }
  | { readonly kind: "lifecycle_recovery_required" };
