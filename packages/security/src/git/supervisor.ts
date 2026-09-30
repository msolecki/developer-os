/**
 * Spec 1 §4.2's one-shot Git process permits over the closed process graph.
 * Every permit binds one edge, its literal expanded argv and environment, its
 * cwd and stdin class; consuming it rechecks the admitted executable evidence
 * immediately before exec. Each phase budget begins once per supervisor, which
 * is one top-level invocation: nothing here persists a clock or elapsed time.
 */
import { createHash } from "node:crypto";

import {
  encodeCanonicalJson,
  hashCanonicalJson,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonValue,
  type LowerHexSha256,
} from "@developer-os/core";

import { SecurityRefusalError } from "../paths.js";
import type {
  SupervisedPhaseV1,
  SupervisedProcessEvidenceV1,
  SupervisedProcessRunner,
  SupervisedSpawnRequestV1,
} from "../supervised-process.js";
import {
  recheckSystemExecutableSync,
  type AdmittedSystemExecutableV1,
  type SystemExecutableRowV1,
  type SystemPathInspectorSyncV1,
} from "../system-executables.js";
import { GIT_DISTRIBUTION_POLICY, type AdmittedGitExecutablesV1 } from "./distribution.js";
import { expandGitArgv, validateSupportedGitProcessTable, type GitArgSlotValuesV1 } from "./process-table.js";
import type {
  ClosedGitProcessEdgeIdV1,
  ClosedGitProcessNodeIdV1,
  GitEnvironmentProfileIdV1,
  GitEnvironmentSlotV1,
  GitExecutableIdV1,
  GitProcessEdgePhaseV1,
  GitProcessEdgeV1,
  GitProcessIoProfileIdV1,
  GitProcessIoProfileV1,
  GitProcessNodeV1,
  GitProcessPhaseBudgetIdV1,
  SupportedGitProcessTableV1,
} from "./types.js";

const ARGV_DOMAIN = "developer-os:git-process-argv:v1";
const ENVIRONMENT_DOMAIN = "developer-os:git-process-environment:v1";
const TERMINATION_GRACE_MS = 100;

/** Spec §4.2: `push` begins at `direct_source_push` and covers its pack, transport and receive descendants. */
const EDGE_PHASE_BUDGET: Readonly<Record<GitProcessEdgePhaseV1, GitProcessPhaseBudgetIdV1>> = {
  distribution_probe: "distribution_probe",
  config_candidate: "config_candidate",
  source_build: "source_build",
  push_pack: "push",
  push_transport: "push",
  destination_receive: "push",
};

export type GitProcessPhaseV1 = SupervisedPhaseV1 & { readonly id: GitProcessPhaseBudgetIdV1 };
export type GitPushPhaseV1 = GitProcessPhaseV1 & { readonly id: "push" };

/** Throws `unsupported_git_distribution` on any drift; returns the admitted absolute path to exec. */
export interface GitExecutableIdentityProbeV1 {
  recheck(executableId: GitExecutableIdV1): CanonicalAbsolutePathV1;
}

export type GitEnvironmentSlotValuesV1 = Readonly<Partial<Record<GitEnvironmentSlotV1, string>>>;

export type GitProcessStdinClassV1 = "ignore" | { readonly byteLength: number; readonly sha256: LowerHexSha256 };

/** What the plan expands before a permit exists: one edge alternative, one profile, one cwd, one stdin class. */
export interface GitProcessIntentV1 {
  readonly edgeId: ClosedGitProcessEdgeIdV1;
  readonly argvAlternative: number;
  readonly argvSlots: GitArgSlotValuesV1;
  readonly environmentProfileId: GitEnvironmentProfileIdV1;
  readonly environmentSlots: GitEnvironmentSlotValuesV1;
  readonly cwd: CanonicalAbsolutePathV1;
  readonly stdin: GitProcessStdinClassV1;
}

export interface GitProcessPermitV1 {
  readonly permitId: number;
  readonly edgeId: ClosedGitProcessEdgeIdV1;
  readonly nodeId: ClosedGitProcessNodeIdV1;
  readonly parentPermitId: number | null;
  readonly phaseId: GitProcessPhaseBudgetIdV1;
  readonly ioProfileId: GitProcessIoProfileIdV1;
  readonly environmentProfileId: GitEnvironmentProfileIdV1;
  readonly argvSha256: LowerHexSha256;
  readonly environmentSha256: LowerHexSha256;
}

/** The literal process the caller is about to start or exec; compared byte for byte with the permit. */
export interface GitConcreteProcessRequestV1 {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly stdin: "ignore" | { readonly bytes: Uint8Array };
}

export interface GitProcessAdmissionV1 {
  readonly permitId: number;
  readonly edgeId: ClosedGitProcessEdgeIdV1;
  readonly nodeId: ClosedGitProcessNodeIdV1;
  /** The rechecked distribution path; `null` for a gateway or internal image. */
  readonly executable: CanonicalAbsolutePathV1 | null;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: CanonicalAbsolutePathV1;
}

/** Counts, stream hashes and the termination class only: raw output is never retained. */
export type GitProcessEvidenceV1 = SupervisedProcessEvidenceV1 & {
  readonly permitId: number;
  readonly edgeId: ClosedGitProcessEdgeIdV1;
  readonly nodeId: ClosedGitProcessNodeIdV1;
  readonly ioProfileId: GitProcessIoProfileIdV1;
};

export interface GitProcessSupervisorV1 {
  beginPhase(budgetId: GitProcessPhaseBudgetIdV1): GitProcessPhaseV1;
  beginPushPhase(): GitPushPhaseV1;
  issue(node: GitProcessNodeV1, parent: GitProcessPermitV1 | null, phase: GitProcessPhaseV1, intent: GitProcessIntentV1): GitProcessPermitV1;
  consume(permit: GitProcessPermitV1, request: GitConcreteProcessRequestV1): GitProcessAdmissionV1;
  run(
    permit: GitProcessPermitV1,
    request: GitConcreteProcessRequestV1,
    sink?: (chunk: Uint8Array, stream: "stdout" | "stderr") => void,
  ): Promise<GitProcessEvidenceV1>;
}

interface BoundPermit {
  readonly edge: GitProcessEdgeV1;
  readonly node: GitProcessNodeV1;
  readonly phase: GitProcessPhaseV1;
  readonly io: GitProcessIoProfileV1;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: CanonicalAbsolutePathV1;
  readonly stdin: GitProcessStdinClassV1;
  consumed: boolean;
}

function refuse(reason: string): never {
  throw new SecurityRefusalError(reason);
}

/** Literal array/map equality; a value that is not canonical JSON is simply unequal. */
function sameCanonical(left: unknown, right: unknown): boolean {
  try {
    return encodeCanonicalJson(left as CanonicalJsonValue) === encodeCanonicalJson(right as CanonicalJsonValue);
  } catch {
    return false;
  }
}

function sha256Hex(bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function recheckAll(files: readonly AdmittedSystemExecutableV1[], rows: readonly SystemExecutableRowV1[], inspect: SystemPathInspectorSyncV1): void {
  try {
    for (const file of files) {
      const row = rows.find((candidate) => candidate.platform === file.platform && candidate.id === file.id);
      if (row === undefined) refuse("unsupported_git_distribution");
      recheckSystemExecutableSync(row, inspect, file);
    }
  } catch {
    refuse("unsupported_git_distribution");
  }
}

/**
 * Rechecks every file the invocation admitted against a fresh synchronous observation on
 * each call, then names the fixed path for the requested image. An image without a
 * system row (`git_remote_https`) or not admitted this invocation refuses.
 */
export function admittingGitIdentityProbe(
  admitted: () => AdmittedGitExecutablesV1,
  rows: readonly SystemExecutableRowV1[],
  inspect: SystemPathInspectorSyncV1,
): GitExecutableIdentityProbeV1 {
  return {
    recheck(executableId) {
      const current = admitted();
      const files = current.ssh === null ? [current.git, current.receivePack] : [current.git, current.receivePack, current.ssh];
      recheckAll(files, rows, inspect);
      const system = GIT_DISTRIBUTION_POLICY.executables.find((candidate) => candidate.id === executableId)?.system ?? null;
      const file = files.find((candidate) => candidate.id === system);
      if (file === undefined) refuse("unsupported_git_distribution");
      return file.canonicalPath;
    },
  };
}

export class GitProcessSupervisor implements GitProcessSupervisorV1 {
  readonly #table: SupportedGitProcessTableV1;
  readonly #runner: SupervisedProcessRunner;
  readonly #identity: GitExecutableIdentityProbeV1;
  readonly #phases = new Map<GitProcessPhaseBudgetIdV1, GitProcessPhaseV1>();
  readonly #permits = new WeakMap<GitProcessPermitV1, BoundPermit>();
  readonly #consumedUses = new Map<ClosedGitProcessEdgeIdV1, number>();
  readonly #cwdByClass = new Map<string, CanonicalAbsolutePathV1>();
  #nextPermitId = 1;

  constructor(table: SupportedGitProcessTableV1, runner: SupervisedProcessRunner, identity: GitExecutableIdentityProbeV1) {
    this.#table = validateSupportedGitProcessTable(table);
    this.#runner = runner;
    this.#identity = identity;
  }

  beginPhase(budgetId: GitProcessPhaseBudgetIdV1): GitProcessPhaseV1 {
    const budget = this.#table.phaseBudgets.find((candidate) => candidate.id === budgetId);
    if (budget === undefined) refuse("git_phase_unknown");
    if (this.#phases.has(budgetId)) refuse("git_phase_already_begun");
    this.#identity.recheck("git_main");
    const supervised = this.#runner.beginPhase(budgetId, budget.wallDeadlineMs);
    const phase: GitProcessPhaseV1 = Object.freeze({
      id: budgetId,
      deadlineAtMs: supervised.deadlineAtMs,
      remainingMilliseconds: () => supervised.remainingMilliseconds(),
    });
    this.#phases.set(budgetId, phase);
    return phase;
  }

  beginPushPhase(): GitPushPhaseV1 {
    return this.beginPhase("push") as GitPushPhaseV1;
  }

  issue(node: GitProcessNodeV1, parent: GitProcessPermitV1 | null, phase: GitProcessPhaseV1, intent: GitProcessIntentV1): GitProcessPermitV1 {
    const edge = this.#table.edges.find((candidate) => candidate.id === intent.edgeId);
    const tableNode = this.#table.nodes.find((candidate) => candidate.id === node.id);
    if (edge === undefined || tableNode === undefined || edge.to !== tableNode.id || !sameCanonical(node, tableNode)) {
      refuse("git_unknown_child");
    }
    if (parent === null) {
      if (edge.from !== "coordinator") refuse("git_parent_mismatch");
    } else {
      const bound = this.#permits.get(parent);
      if (bound === undefined || !bound.consumed || bound.node.id !== edge.from || bound.phase !== phase) {
        refuse("git_parent_mismatch");
      }
    }
    if (this.#phases.get(phase.id) !== phase || EDGE_PHASE_BUDGET[edge.phase] !== phase.id) refuse("git_phase_mismatch");

    const grammar = edge.argvAlternatives[intent.argvAlternative];
    if (grammar === undefined) refuse("git_argv_mismatch");
    const argv = expandGitArgv(grammar, intent.argvSlots);
    if (tableNode.image.kind === "distribution" && argv[0] !== tableNode.image.argv0) refuse("git_argv_mismatch");

    const profile = this.#table.environmentProfiles.find((candidate) => candidate.id === intent.environmentProfileId);
    if (profile === undefined || !tableNode.environmentProfiles.includes(profile.id)) refuse("git_env_mismatch");
    const env: Record<string, string> = {};
    for (const entry of profile.entries) {
      const value =
        entry.value.kind === "literal"
          ? entry.value.value
          : Object.hasOwn(intent.environmentSlots, entry.value.slot)
            ? intent.environmentSlots[entry.value.slot]
            : undefined;
      if (typeof value !== "string" || value === "" || value.includes("\0")) refuse("git_env_mismatch");
      env[entry.name] = value;
    }

    const boundCwd = this.#cwdByClass.get(tableNode.cwd);
    if (boundCwd !== undefined && boundCwd !== intent.cwd) refuse("git_cwd_mismatch");
    const io = this.#table.ioProfiles.find((candidate) => candidate.id === edge.ioProfileId);
    if (io === undefined) refuse("git_unknown_child");
    if (intent.stdin !== "ignore") {
      const { byteLength } = intent.stdin;
      if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > io.stdinMaxBytes) refuse("git_stdin_over_limit");
    }
    this.#cwdByClass.set(tableNode.cwd, intent.cwd);

    const permit: GitProcessPermitV1 = Object.freeze({
      permitId: this.#nextPermitId,
      edgeId: edge.id,
      nodeId: tableNode.id,
      parentPermitId: parent === null ? null : parent.permitId,
      phaseId: phase.id,
      ioProfileId: io.id,
      environmentProfileId: profile.id,
      argvSha256: hashCanonicalJson(ARGV_DOMAIN, argv as unknown as CanonicalJsonValue),
      environmentSha256: hashCanonicalJson(ENVIRONMENT_DOMAIN, env as unknown as CanonicalJsonValue),
    });
    this.#nextPermitId += 1;
    this.#permits.set(permit, {
      edge,
      node: tableNode,
      phase,
      io,
      argv: Object.freeze([...argv]),
      env: Object.freeze(env),
      cwd: intent.cwd,
      stdin: intent.stdin,
      consumed: false,
    });
    return permit;
  }

  consume(permit: GitProcessPermitV1, request: GitConcreteProcessRequestV1): GitProcessAdmissionV1 {
    return this.#admit(this.#bound(permit), permit, request);
  }

  async run(
    permit: GitProcessPermitV1,
    request: GitConcreteProcessRequestV1,
    sink?: (chunk: Uint8Array, stream: "stdout" | "stderr") => void,
  ): Promise<GitProcessEvidenceV1> {
    const bound = this.#bound(permit);
    if (bound.edge.from !== "coordinator") refuse("git_not_direct_edge");
    const admission = this.#admit(bound, permit, request);
    if (admission.executable === null) refuse("git_not_direct_edge");
    const spawn: SupervisedSpawnRequestV1 = {
      executable: admission.executable,
      argv: admission.argv.slice(1),
      env: admission.env,
      cwd: admission.cwd,
      stdin: request.stdin,
      inheritedFds: [],
      stdoutCap: bound.io.stdoutMaxBytes,
      stderrCap: bound.io.stderrMaxBytes,
      idleMs: bound.io.idleDeadlineMs,
      wallMs: bound.io.wallDeadlineMs,
      terminationGraceMs: TERMINATION_GRACE_MS,
      phase: bound.phase,
    };
    const evidence = await this.#runner.run(spawn, sink);
    return { ...evidence, permitId: permit.permitId, edgeId: bound.edge.id, nodeId: bound.node.id, ioProfileId: bound.io.id };
  }

  #bound(permit: GitProcessPermitV1): BoundPermit {
    const bound = this.#permits.get(permit);
    if (bound === undefined) refuse("git_permit_unknown");
    if (bound.consumed) refuse("git_permit_consumed");
    return bound;
  }

  #admit(bound: BoundPermit, permit: GitProcessPermitV1, request: GitConcreteProcessRequestV1): GitProcessAdmissionV1 {
    bound.consumed = true;
    if (!Array.isArray(request.argv) || !sameCanonical(request.argv, bound.argv)) refuse("git_argv_mismatch");
    if (!sameCanonical(request.env, bound.env)) refuse("git_env_mismatch");
    if (request.cwd !== bound.cwd) refuse("git_cwd_mismatch");
    if (bound.stdin === "ignore" || request.stdin === "ignore") {
      if (bound.stdin !== request.stdin) refuse("git_stdin_mismatch");
    } else {
      if (request.stdin.bytes.byteLength !== bound.stdin.byteLength) refuse("git_stdin_count_mismatch");
      if (sha256Hex(request.stdin.bytes) !== bound.stdin.sha256) refuse("git_stdin_hash_mismatch");
    }

    const { edge } = bound;
    const uses = this.#consumedUses.get(edge.id) ?? 0;
    if (uses >= edge.maxUses) refuse("git_edge_uses_exceeded");
    for (const [consumedId] of this.#consumedUses) {
      const consumed = this.#table.edges.find((candidate) => candidate.id === consumedId);
      if (consumed?.orderAfter.includes(edge.id) === true) refuse("git_wrong_order");
    }
    if (edge.orderAfter.length > 0 && !edge.orderAfter.some((id) => this.#consumedUses.has(id))) refuse("git_wrong_order");
    if (bound.phase.remainingMilliseconds() <= 0) refuse("git_phase_deadline");

    const image = bound.node.image;
    const executable = image.kind === "distribution" ? this.#identity.recheck(image.executableId) : null;
    this.#consumedUses.set(edge.id, uses + 1);
    return {
      permitId: permit.permitId,
      edgeId: edge.id,
      nodeId: bound.node.id,
      executable,
      argv: bound.argv,
      env: bound.env,
      cwd: bound.cwd,
    };
  }
}
