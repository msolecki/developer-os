/**
 * Spec 1 §4.2's closed Git distribution and process-graph records. Every union
 * below is exact: a value outside it refuses in `process-table.ts` or
 * `distribution.ts`, and no record carries a free-string authority.
 */
import type { CanonicalAbsolutePathV1 } from "@developer-os/core";

import type { SystemExecutableIdV1 } from "../system-executables.js";

declare const gitConfigQuotedPathV1: unique symbol;
declare const gitAlternateObjectDirectoryV1: unique symbol;

export type GitConfigQuotedPathV1 = CanonicalAbsolutePathV1 & { readonly [gitConfigQuotedPathV1]: true };
export type GitAlternateObjectDirectoryV1 = CanonicalAbsolutePathV1 & {
  readonly [gitAlternateObjectDirectoryV1]: true;
};

export const GIT_EXECUTABLE_IDS = ["git_main", "git_receive_pack", "git_remote_https", "system_ssh"] as const;
export type GitExecutableIdV1 = (typeof GIT_EXECUTABLE_IDS)[number];

export const GIT_ARG_SLOTS = [
  "validated_https_url",
  "opaque_local_token",
  "private_destination_shadow",
  "commit_to_branch_refspec",
  "pack_object_count",
  "receive_keep_marker",
  "ssh_target",
  "ssh_port",
  "ssh_receive_pack_command",
  "candidate_config_path",
  "normalized_remote_url",
  "source_shadow_path",
  "candidate_tree_oid",
  "parent_commit_oid",
] as const;
export type GitArgSlotV1 = (typeof GIT_ARG_SLOTS)[number];

export const GIT_ENVIRONMENT_SLOTS = [
  "temporary_home",
  "canonical_user_home",
  "temporary_directory",
  "gateway_path",
  "supervisor_socket",
  "invocation_capability",
  "source_git_dir",
  "source_index",
  "source_object_dir",
  "source_alternate",
  "destination_git_dir",
  "ssh_auth_sock",
  "ssh_bridge_path",
  "opaque_local_token",
  "private_destination_shadow",
  "git_author_name",
  "git_author_email",
  "git_author_date",
  "git_committer_name",
  "git_committer_email",
  "git_committer_date",
] as const;
export type GitEnvironmentSlotV1 = (typeof GIT_ENVIRONMENT_SLOTS)[number];

/** The exact union of the names the twelve initial profiles use, sorted by unsigned byte order. */
export const CLOSED_GIT_ENVIRONMENT_NAMES = [
  "DEVELOPER_OS_GIT_DESTINATION_SHADOW",
  "DEVELOPER_OS_GIT_DISTRIBUTION",
  "DEVELOPER_OS_GIT_INVOCATION_CAPABILITY",
  "DEVELOPER_OS_GIT_LOCAL_TOKEN",
  "DEVELOPER_OS_GIT_PHASE",
  "DEVELOPER_OS_GIT_SUPERVISOR_SOCKET",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_AUTHOR_DATE",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_NAME",
  "GIT_COMMITTER_DATE",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_DIR",
  "GIT_EXEC_PATH",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_OPTIONAL_LOCKS",
  "GIT_SSH",
  "GIT_SSH_VARIANT",
  "GIT_TERMINAL_PROMPT",
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "SSH_AUTH_SOCK",
  "TMPDIR",
] as const;
export type ClosedGitEnvironmentNameV1 = (typeof CLOSED_GIT_ENVIRONMENT_NAMES)[number];

export const GIT_ENVIRONMENT_PROFILE_IDS = [
  "config_candidate",
  "destination_receive",
  "distribution_probe",
  "https_helper",
  "local_helper",
  "push_https",
  "push_local",
  "push_ssh",
  "source_build",
  "ssh_bridge",
  "system_ssh_agent",
  "system_ssh_no_agent",
] as const;
export type GitEnvironmentProfileIdV1 = (typeof GIT_ENVIRONMENT_PROFILE_IDS)[number];

export const GIT_PROCESS_IO_PROFILE_IDS = [
  "index_stream",
  "metadata",
  "pack_stream",
  "receive_stream",
  "root_push",
  "source_build",
  "transport_stream",
] as const;
export type GitProcessIoProfileIdV1 = (typeof GIT_PROCESS_IO_PROFILE_IDS)[number];

export const GIT_PROCESS_PHASE_BUDGET_IDS = ["config_candidate", "distribution_probe", "push", "source_build"] as const;
export type GitProcessPhaseBudgetIdV1 = (typeof GIT_PROCESS_PHASE_BUDGET_IDS)[number];

export const CLOSED_GATEWAY_BASENAMES = [
  "developer-os-ssh-bridge",
  "git",
  "git-receive-pack",
  "git-remote-developer-os-local",
  "git-remote-https",
] as const;
export type ClosedGatewayBasenameV1 = (typeof CLOSED_GATEWAY_BASENAMES)[number];

export const CLOSED_GIT_PROCESS_NODE_IDS = [
  "coordinator",
  "distribution_probe_git",
  "gateway_https_dispatch_git",
  "gateway_https_helper",
  "gateway_index_git",
  "gateway_local_dispatch_git",
  "gateway_local_helper",
  "gateway_pack_git",
  "gateway_receive_pack",
  "gateway_ssh_bridge",
  "internal_local_helper",
  "internal_ssh_bridge",
  "real_https_dispatch_git",
  "real_https_helper",
  "real_index_git",
  "real_local_dispatch_git",
  "real_pack_git",
  "real_receive_pack",
  "real_system_ssh",
  "source_build_git",
  "source_push_git",
] as const;
export type ClosedGitProcessNodeIdV1 = (typeof CLOSED_GIT_PROCESS_NODE_IDS)[number];

export const CLOSED_GIT_PROCESS_EDGE_IDS = [
  "direct_config_candidate",
  "direct_distribution_probe",
  "direct_source_build",
  "direct_source_push",
  "enter_local_helper",
  "enter_ssh_bridge",
  "exec_https_dispatch_git",
  "exec_https_helper",
  "exec_index_git",
  "exec_local_dispatch_git",
  "exec_pack_git",
  "exec_receive_pack",
  "exec_system_ssh",
  "spawn_https_dispatch_gateway",
  "spawn_https_helper_gateway",
  "spawn_index_gateway",
  "spawn_local_dispatch_gateway",
  "spawn_local_helper_gateway",
  "spawn_pack_gateway",
  "spawn_receive_pack_gateway",
  "spawn_ssh_bridge_gateway",
] as const;
export type ClosedGitProcessEdgeIdV1 = (typeof CLOSED_GIT_PROCESS_EDGE_IDS)[number];

export const GIT_PROCESS_TRANSITIONS = ["spawn", "exec_same_pid", "enter_internal_same_pid"] as const;
export type GitProcessTransitionV1 = (typeof GIT_PROCESS_TRANSITIONS)[number];

export const GIT_PROCESS_EDGE_PHASES = [
  "distribution_probe",
  "config_candidate",
  "source_build",
  "push_pack",
  "push_transport",
  "destination_receive",
] as const;
export type GitProcessEdgePhaseV1 = (typeof GIT_PROCESS_EDGE_PHASES)[number];

export const GIT_PROCESS_EDGE_PREDICATES = [
  "distribution_probe",
  "config_candidate",
  "new_commit",
  "any_push",
  "pack_required",
  "https_push",
  "ssh_push",
  "local_push",
  "local_pack_received",
] as const;
export type GitProcessEdgePredicateV1 = (typeof GIT_PROCESS_EDGE_PREDICATES)[number];

export const GIT_PROCESS_CWDS = ["source_shadow", "destination_shadow", "quarantine"] as const;
export type GitProcessCwdV1 = (typeof GIT_PROCESS_CWDS)[number];

export type GitArgTokenV1 =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "slot"; readonly slot: GitArgSlotV1 }
  | { readonly kind: "joined"; readonly prefix: string; readonly slot: GitArgSlotV1; readonly suffix: string };

export interface GitArgvGrammarV1 {
  readonly argv: readonly GitArgTokenV1[];
}

export type GitEnvironmentValueV1 =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "slot"; readonly slot: GitEnvironmentSlotV1 };

export interface GitEnvironmentEntryV1 {
  readonly name: ClosedGitEnvironmentNameV1;
  readonly value: GitEnvironmentValueV1;
}

export interface GitEnvironmentProfileV1 {
  readonly id: GitEnvironmentProfileIdV1;
  readonly entries: readonly GitEnvironmentEntryV1[];
}

export type GitProcessImageV1 =
  | { readonly kind: "coordinator" }
  | { readonly kind: "gateway"; readonly basename: ClosedGatewayBasenameV1 }
  | { readonly kind: "distribution"; readonly executableId: GitExecutableIdV1; readonly argv0: string }
  | { readonly kind: "internal"; readonly mode: "ssh_bridge" | "local_remote_helper" };

export interface GitProcessNodeV1 {
  readonly id: ClosedGitProcessNodeIdV1;
  readonly image: GitProcessImageV1;
  readonly environmentProfiles: readonly GitEnvironmentProfileIdV1[];
  readonly cwd: GitProcessCwdV1;
}

export interface GitProcessEdgeV1 {
  readonly id: ClosedGitProcessEdgeIdV1;
  readonly from: ClosedGitProcessNodeIdV1;
  readonly to: ClosedGitProcessNodeIdV1;
  readonly transition: GitProcessTransitionV1;
  readonly phase: GitProcessEdgePhaseV1;
  readonly when: GitProcessEdgePredicateV1;
  readonly argvAlternatives: readonly GitArgvGrammarV1[];
  readonly ioProfileId: GitProcessIoProfileIdV1;
  readonly minUses: number;
  readonly maxUses: number;
  readonly orderAfter: readonly ClosedGitProcessEdgeIdV1[];
}

export interface GitProcessIoProfileV1 {
  readonly id: GitProcessIoProfileIdV1;
  readonly stdinMaxBytes: number;
  readonly stdoutMaxBytes: number;
  readonly stderrMaxBytes: number;
  readonly wallDeadlineMs: number;
  readonly idleDeadlineMs: number;
}

export interface GitProcessPhaseBudgetV1 {
  readonly id: GitProcessPhaseBudgetIdV1;
  readonly wallDeadlineMs: 30000 | 600000 | 1800000;
}

export interface SupportedGitProcessTableV1 {
  readonly schemaVersion: 1;
  readonly id: "apple-git-process-v2";
  readonly distributionId: "apple-git-arm64-v2";
  readonly environmentProfiles: readonly GitEnvironmentProfileV1[];
  readonly ioProfiles: readonly GitProcessIoProfileV1[];
  readonly phaseBudgets: readonly GitProcessPhaseBudgetV1[];
  readonly nodes: readonly GitProcessNodeV1[];
  readonly edges: readonly GitProcessEdgeV1[];
}

export interface GitVersionFloorV1 {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** The row's `(<prefix><n>)` build suffix and its minimum `n`; `null` compares only `<major>.<minor>.<patch>`. */
  readonly vendorBuild: { readonly prefix: string; readonly minimum: number } | null;
}

/** Which system table row runs each distribution image; `null` has no standard fixed path and refuses. */
export interface GitDistributionExecutableV2 {
  readonly id: GitExecutableIdV1;
  readonly system: Exclude<SystemExecutableIdV1, "scheduler"> | null;
}

/**
 * Spec 1 §4.2 as amended 2026-09-28 (D71): a policy, not a pinned build. The
 * binaries' bytes are per-invocation evidence and never part of this record.
 */
export interface GitDistributionPolicyV2 {
  readonly schemaVersion: 2;
  readonly id: "apple-git-arm64-v2";
  readonly platform: "darwin";
  readonly architecture: "arm64";
  readonly gitVersionFloor: GitVersionFloorV1;
  readonly sshVersionFloor: { readonly major: number; readonly minor: number; readonly portable: number };
  readonly requiredBuildOptionLines: readonly string[];
  readonly executables: readonly GitDistributionExecutableV2[];
  readonly processTable: SupportedGitProcessTableV1;
}
