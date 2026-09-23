import { createHash } from "node:crypto";

import { parseCanonicalAbsolutePathText, type LowerHexSha256 } from "@developer-os/core";
import { beforeEach, describe, expect, it } from "vitest";

import { SecurityRefusalError } from "../paths.js";
import {
  SupervisedProcessRunner,
  type SupervisedProcessEvidenceV1,
  type SupervisedSpawnRequestV1,
} from "../supervised-process.js";
import { SUPPORTED_GIT_DISTRIBUTION } from "./distribution.js";
import { observedFromRow, sameVersionOtherHash } from "./distribution.test-fixtures.js";
import { SUPPORTED_GIT_DISTRIBUTION_ID } from "./process-table.js";
import {
  admittingGitIdentityProbe,
  GitProcessSupervisor,
  type GitConcreteProcessRequestV1,
  type GitEnvironmentSlotValuesV1,
  type GitProcessIntentV1,
  type GitProcessPermitV1,
  type GitProcessPhaseV1,
} from "./supervisor.js";
import type { ClosedGitProcessNodeIdV1, GitProcessNodeV1, ObservedGitDistributionV1 } from "./types.js";

const table = SUPPORTED_GIT_DISTRIBUTION.processTable;
const GIT = "/Applications/Xcode.app/Contents/Developer/usr/bin/git";
const QUARANTINE = parseCanonicalAbsolutePathText("/tmp/developer-os-test/quarantine");
const SOURCE_SHADOW = parseCanonicalAbsolutePathText("/tmp/developer-os-test/source-shadow");
const COMMIT = "a".repeat(40);
const REFSPEC = `${COMMIT}:refs/heads/main`;
const sha = (bytes: Uint8Array): LowerHexSha256 => createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;

const ENV_SLOTS: GitEnvironmentSlotValuesV1 = {
  temporary_home: "/tmp/developer-os-test/home",
  canonical_user_home: "/Users/synthetic",
  temporary_directory: "/tmp/developer-os-test/tmp",
  gateway_path: "/tmp/developer-os-test/gateways",
  supervisor_socket: "/tmp/developer-os-test/supervisor.sock",
  invocation_capability: "b".repeat(64),
  source_git_dir: "/tmp/developer-os-test/source-shadow/git",
  source_index: "/tmp/developer-os-test/source-shadow/index",
  source_object_dir: "/tmp/developer-os-test/quarantine/objects",
  source_alternate: "/tmp/developer-os-test/brain/.git/objects",
  git_author_name: "Developer OS",
  git_author_email: "developer-os@example.invalid",
  git_author_date: "1700000000 +0000",
  git_committer_name: "Developer OS",
  git_committer_email: "developer-os@example.invalid",
  git_committer_date: "1700000000 +0000",
};

const PROBE_ENV = {
  DEVELOPER_OS_GIT_DISTRIBUTION: SUPPORTED_GIT_DISTRIBUTION_ID,
  DEVELOPER_OS_GIT_INVOCATION_CAPABILITY: "b".repeat(64),
  DEVELOPER_OS_GIT_PHASE: "distribution_probe",
  DEVELOPER_OS_GIT_SUPERVISOR_SOCKET: "/tmp/developer-os-test/supervisor.sock",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_EXEC_PATH: "/tmp/developer-os-test/gateways",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  HOME: "/tmp/developer-os-test/home",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/tmp/developer-os-test/gateways",
  TMPDIR: "/tmp/developer-os-test/tmp",
};

function node(id: ClosedGitProcessNodeIdV1): GitProcessNodeV1 {
  const found = table.nodes.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`fixture: no node ${id}`);
  return found;
}

function environment(profileId: GitProcessIntentV1["environmentProfileId"]): Record<string, string> {
  const profile = table.environmentProfiles.find((candidate) => candidate.id === profileId);
  if (profile === undefined) throw new Error(`fixture: no profile ${profileId}`);
  return Object.fromEntries(
    profile.entries.map((entry) => [entry.name, entry.value.kind === "literal" ? entry.value.value : (ENV_SLOTS[entry.value.slot] ?? "")]),
  );
}

const EXITED: SupervisedProcessEvidenceV1 = {
  exitCode: 0,
  signal: null,
  stdoutBytes: 1,
  stderrBytes: 0,
  stdoutSha256: sha(new Uint8Array([10])),
  stderrSha256: sha(new Uint8Array()),
  termination: "exited",
  groupReaped: true,
};

class ManualClock {
  now = 0;
}

/** Real phases, scripted children: every spawn request is recorded, none reaches the OS. */
class ScriptedRunner extends SupervisedProcessRunner {
  readonly requests: SupervisedSpawnRequestV1[] = [];
  outcome: Partial<SupervisedProcessEvidenceV1> = {};

  constructor(clock: ManualClock) {
    super({
      spawn: () => {
        throw new Error("the scripted runner never spawns");
      },
      killGroup: () => undefined,
      now: () => clock.now,
      setTimer: () => () => undefined,
    });
  }

  get spawnCount(): number {
    return this.requests.length;
  }

  override async run(request: SupervisedSpawnRequestV1, sink?: (chunk: Uint8Array, stream: "stdout" | "stderr") => void): Promise<SupervisedProcessEvidenceV1> {
    this.requests.push(request);
    await Promise.resolve();
    sink?.(new Uint8Array([10]), "stdout");
    return { ...EXITED, ...this.outcome };
  }
}

class SwappableIdentity {
  observation: ObservedGitDistributionV1 = observedFromRow(SUPPORTED_GIT_DISTRIBUTION);
  readonly probe = admittingGitIdentityProbe(SUPPORTED_GIT_DISTRIBUTION, () => this.observation);

  swapAfterIssue(): void {
    this.observation = sameVersionOtherHash();
  }
}

const probeIntent: GitProcessIntentV1 = {
  edgeId: "direct_distribution_probe",
  argvAlternative: 0,
  argvSlots: {},
  environmentProfileId: "distribution_probe",
  environmentSlots: ENV_SLOTS,
  cwd: QUARANTINE,
  stdin: "ignore",
};
const probeRequest: GitConcreteProcessRequestV1 = {
  argv: ["git", "--version", "--build-options"],
  env: PROBE_ENV,
  cwd: QUARANTINE,
  stdin: "ignore",
};

const BLOB = new TextEncoder().encode("synthetic\n");
const hashObjectIntent: GitProcessIntentV1 = {
  edgeId: "direct_source_build",
  argvAlternative: 0,
  argvSlots: {},
  environmentProfileId: "source_build",
  environmentSlots: ENV_SLOTS,
  cwd: QUARANTINE,
  stdin: { byteLength: BLOB.byteLength, sha256: sha(BLOB) },
};
const hashObjectRequest: GitConcreteProcessRequestV1 = {
  argv: ["git", "hash-object", "-w", "--stdin"],
  env: environment("source_build"),
  cwd: QUARANTINE,
  stdin: { bytes: BLOB },
};

const pushIntent: GitProcessIntentV1 = {
  edgeId: "direct_source_push",
  argvAlternative: 0,
  argvSlots: { commit_to_branch_refspec: REFSPEC },
  environmentProfileId: "push_local",
  environmentSlots: ENV_SLOTS,
  cwd: SOURCE_SHADOW,
  stdin: "ignore",
};
const pushRequest: GitConcreteProcessRequestV1 = {
  argv: ["git", "push", "--porcelain", "--no-verify", "developer-os", REFSPEC],
  env: environment("push_local"),
  cwd: SOURCE_SHADOW,
  stdin: "ignore",
};

const PACK_ARGV = ["git", "pack-objects", "--all-progress-implied", "--revs", "--stdout", "--thin", "--delta-base-offset", "-q"];
const packIntent = (edgeId: "spawn_pack_gateway" | "exec_pack_git"): GitProcessIntentV1 => ({
  edgeId,
  argvAlternative: 0,
  argvSlots: {},
  environmentProfileId: "push_local",
  environmentSlots: ENV_SLOTS,
  cwd: SOURCE_SHADOW,
  stdin: "ignore",
});
const packRequest: GitConcreteProcessRequestV1 = { argv: PACK_ARGV, env: environment("push_local"), cwd: SOURCE_SHADOW, stdin: "ignore" };

let clock: ManualClock;
let runner: ScriptedRunner;
let identity: SwappableIdentity;
let supervisor: GitProcessSupervisor;

beforeEach(() => {
  clock = new ManualClock();
  runner = new ScriptedRunner(clock);
  identity = new SwappableIdentity();
  supervisor = new GitProcessSupervisor(table, runner, identity.probe);
});

async function runProbe(): Promise<void> {
  const phase = supervisor.beginPhase("distribution_probe");
  await supervisor.run(supervisor.issue(node("distribution_probe_git"), null, phase, probeIntent), probeRequest);
}

async function runPush(): Promise<{ readonly phase: GitProcessPhaseV1; readonly permit: GitProcessPermitV1 }> {
  await runProbe();
  const phase = supervisor.beginPushPhase();
  const permit = supervisor.issue(node("source_push_git"), null, phase, pushIntent);
  await supervisor.run(permit, pushRequest);
  return { phase, permit };
}

describe("GitProcessSupervisor permits", () => {
  it("consumes a permit once and rejects wrong parent/order/argv", async () => {
    const phase = supervisor.beginPhase("distribution_probe");
    const permit = supervisor.issue(node("distribution_probe_git"), null, phase, probeIntent);
    await supervisor.run(permit, probeRequest);
    await expect(supervisor.run(permit, probeRequest)).rejects.toThrow("permit_consumed");
    const wrongArgv = { ...probeRequest, argv: ["git", "--version"] };
    await expect(supervisor.run(supervisor.issue(node("distribution_probe_git"), null, phase, probeIntent), wrongArgv)).rejects.toThrow(
      "argv_mismatch",
    );
    expect(runner.spawnCount).toBe(1);
  });

  it("rechecks the executable identity immediately before exec", async () => {
    const phase = supervisor.beginPhase("distribution_probe");
    const permit = supervisor.issue(node("distribution_probe_git"), null, phase, probeIntent);
    identity.swapAfterIssue();
    await expect(supervisor.run(permit, probeRequest)).rejects.toThrow("unsupported_git_distribution");
    expect(runner.spawnCount).toBe(0);
    await expect(supervisor.run(permit, probeRequest)).rejects.toThrow("permit_consumed");
  });

  it("refuses an unsupported distribution before any phase or spawn", () => {
    identity.swapAfterIssue();
    expect(() => supervisor.beginPushPhase()).toThrow("unsupported_git_distribution");
    expect(() => supervisor.beginPhase("distribution_probe")).toThrow(SecurityRefusalError);
    expect(runner.spawnCount).toBe(0);
  });

  it("spawns the rechecked absolute Git with the permit's literal argv, env, cwd and I/O profile", async () => {
    await runProbe();
    expect(runner.requests).toHaveLength(1);
    const [request] = runner.requests;
    expect(request).toMatchObject({
      executable: GIT,
      argv: ["--version", "--build-options"],
      env: PROBE_ENV,
      cwd: QUARANTINE,
      stdin: "ignore",
      inheritedFds: [],
      stdoutCap: 4194304,
      stderrCap: 4194304,
      idleMs: 30000,
      wallMs: 30000,
      terminationGraceMs: 100,
    });
  });

  it("refuses an unknown child, a forged node and a forged permit", async () => {
    const phase = supervisor.beginPhase("distribution_probe");
    expect(() => supervisor.issue(node("real_pack_git"), null, phase, probeIntent)).toThrow("unknown_child");
    const forged = { ...node("distribution_probe_git"), cwd: "source_shadow" as const };
    expect(() => supervisor.issue(forged, null, phase, probeIntent)).toThrow("unknown_child");
    const permit = supervisor.issue(node("distribution_probe_git"), null, phase, probeIntent);
    await expect(supervisor.run({ ...permit }, probeRequest)).rejects.toThrow("permit_unknown");
  });

  it("refuses a wrong parent", async () => {
    const { phase, permit } = await runPush();
    expect(() => supervisor.issue(node("gateway_pack_git"), null, phase, packIntent("spawn_pack_gateway"))).toThrow("parent_mismatch");
    const probePhase = supervisor.beginPhase("config_candidate");
    expect(() => supervisor.issue(node("gateway_pack_git"), permit, probePhase, packIntent("spawn_pack_gateway"))).toThrow(
      "parent_mismatch",
    );
    const unconsumed = supervisor.issue(node("source_push_git"), null, phase, pushIntent);
    expect(() => supervisor.issue(node("gateway_pack_git"), unconsumed, phase, packIntent("spawn_pack_gateway"))).toThrow(
      "parent_mismatch",
    );
  });

  it("admits a child transition through consume without spawning, then rechecks before the same-PID exec", async () => {
    const { phase, permit } = await runPush();
    const gateway = supervisor.issue(node("gateway_pack_git"), permit, phase, packIntent("spawn_pack_gateway"));
    await expect(supervisor.run(gateway, packRequest)).rejects.toThrow("not_direct_edge");
    const second = supervisor.issue(node("gateway_pack_git"), permit, phase, packIntent("spawn_pack_gateway"));
    expect(supervisor.consume(second, packRequest)).toMatchObject({ edgeId: "spawn_pack_gateway", executable: null, argv: PACK_ARGV });
    const real = supervisor.issue(node("real_pack_git"), second, phase, packIntent("exec_pack_git"));
    identity.swapAfterIssue();
    expect(() => supervisor.consume(real, packRequest)).toThrow("unsupported_git_distribution");
    expect(runner.spawnCount).toBe(2);
  });

  it("refuses a wrong order", async () => {
    const configPhase = supervisor.beginPhase("config_candidate");
    const configIntent: GitProcessIntentV1 = {
      edgeId: "direct_config_candidate",
      argvAlternative: 0,
      argvSlots: { candidate_config_path: "/tmp/developer-os-test/quarantine/config", normalized_remote_url: "https://example.invalid/brain.git" },
      environmentProfileId: "config_candidate",
      environmentSlots: ENV_SLOTS,
      cwd: QUARANTINE,
      stdin: "ignore",
    };
    const configRequest: GitConcreteProcessRequestV1 = {
      argv: [
        "git",
        "config",
        "--file",
        "/tmp/developer-os-test/quarantine/config",
        "--no-includes",
        "--add",
        "remote.developer-os.url",
        "https://example.invalid/brain.git",
      ],
      env: environment("config_candidate"),
      cwd: QUARANTINE,
      stdin: "ignore",
    };
    await expect(supervisor.run(supervisor.issue(node("source_build_git"), null, configPhase, configIntent), configRequest)).rejects.toThrow(
      "wrong_order",
    );

    await runPush();
    const buildPhase = supervisor.beginPhase("source_build");
    await expect(
      supervisor.run(supervisor.issue(node("source_build_git"), null, buildPhase, hashObjectIntent), hashObjectRequest),
    ).rejects.toThrow("wrong_order");
    expect(runner.spawnCount).toBe(2);
  });

  it("refuses a second use beyond the edge's maximum", async () => {
    await runProbe();
    const phase = supervisor.beginPhase("config_candidate");
    expect(() => supervisor.issue(node("distribution_probe_git"), null, phase, probeIntent)).toThrow("phase_mismatch");
    const probeAgain = new GitProcessSupervisor(table, runner, identity.probe);
    const probePhase = probeAgain.beginPhase("distribution_probe");
    await probeAgain.run(probeAgain.issue(node("distribution_probe_git"), null, probePhase, probeIntent), probeRequest);
    await expect(probeAgain.run(probeAgain.issue(node("distribution_probe_git"), null, probePhase, probeIntent), probeRequest)).rejects.toThrow(
      "edge_uses_exceeded",
    );
  });

  it("refuses a wrong environment", async () => {
    const phase = supervisor.beginPhase("distribution_probe");
    expect(() => supervisor.issue(node("distribution_probe_git"), null, phase, { ...probeIntent, environmentProfileId: "source_build" })).toThrow(
      "env_mismatch",
    );
    const missingSlot: GitEnvironmentSlotValuesV1 = Object.fromEntries(Object.entries(ENV_SLOTS).filter(([slot]) => slot !== "temporary_home"));
    expect(() => supervisor.issue(node("distribution_probe_git"), null, phase, { ...probeIntent, environmentSlots: missingSlot })).toThrow(
      "env_mismatch",
    );
    const extraKey = { ...probeRequest, env: { ...PROBE_ENV, GIT_TRACE: "1" } };
    await expect(supervisor.run(supervisor.issue(node("distribution_probe_git"), null, phase, probeIntent), extraKey)).rejects.toThrow("env_mismatch");
    const changedValue = { ...probeRequest, env: { ...PROBE_ENV, HOME: "/Users/synthetic" } };
    await expect(supervisor.run(supervisor.issue(node("distribution_probe_git"), null, phase, probeIntent), changedValue)).rejects.toThrow(
      "env_mismatch",
    );
    expect(runner.spawnCount).toBe(0);
  });

  it("refuses a wrong cwd", async () => {
    const phase = supervisor.beginPhase("distribution_probe");
    const permit = supervisor.issue(node("distribution_probe_git"), null, phase, probeIntent);
    await expect(supervisor.run(permit, { ...probeRequest, cwd: "/tmp/developer-os-test/elsewhere" })).rejects.toThrow("cwd_mismatch");
    const otherQuarantine = parseCanonicalAbsolutePathText("/tmp/developer-os-test/other-quarantine");
    expect(() => supervisor.issue(node("distribution_probe_git"), null, phase, { ...probeIntent, cwd: otherQuarantine })).toThrow("cwd_mismatch");
  });

  it("refuses counted stdin byte, hash and EOF mismatches", async () => {
    await runProbe();
    const phase = supervisor.beginPhase("source_build");
    const issue = (): GitProcessPermitV1 => supervisor.issue(node("source_build_git"), null, phase, hashObjectIntent);
    await expect(supervisor.run(issue(), { ...hashObjectRequest, stdin: { bytes: BLOB.slice(0, -1) } })).rejects.toThrow("stdin_count_mismatch");
    const flipped = BLOB.slice();
    flipped[0] = 0x53;
    await expect(supervisor.run(issue(), { ...hashObjectRequest, stdin: { bytes: flipped } })).rejects.toThrow("stdin_hash_mismatch");
    await expect(supervisor.run(issue(), { ...hashObjectRequest, stdin: "ignore" })).rejects.toThrow("stdin_mismatch");
    expect(() =>
      supervisor.issue(node("source_build_git"), null, phase, { ...hashObjectIntent, stdin: { byteLength: 16777217, sha256: sha(BLOB) } }),
    ).toThrow("stdin_over_limit");
    expect(runner.spawnCount).toBe(1);
  });

  it("passes counted stream totals and hashes through as evidence", async () => {
    await runProbe();
    const phase = supervisor.beginPhase("source_build");
    const evidence = await supervisor.run(supervisor.issue(node("source_build_git"), null, phase, hashObjectIntent), hashObjectRequest);
    expect(evidence).toMatchObject({ edgeId: "direct_source_build", nodeId: "source_build_git", ioProfileId: "source_build", stdoutBytes: 1 });
    expect(evidence.stdoutSha256).toBe(sha(new Uint8Array([10])));
    expect(runner.requests[1]).toMatchObject({ stdin: { bytes: BLOB }, stdoutCap: 4194304, idleMs: 30000, wallMs: 30000 });
  });
});

describe("GitProcessSupervisor deadlines and termination", () => {
  it.each(["idle_deadline", "wall_deadline", "phase_deadline", "output_cap"] as const)(
    "reports a %s overrun as a terminated, reaped group rather than success",
    async (termination) => {
      await runProbe();
      const phase = supervisor.beginPushPhase();
      runner.outcome = { exitCode: null, signal: "SIGKILL", termination };
      const evidence = await supervisor.run(supervisor.issue(node("source_push_git"), null, phase, pushIntent), pushRequest);
      expect(evidence).toMatchObject({ edgeId: "direct_source_push", termination, exitCode: null, signal: "SIGKILL", groupReaped: true });
      expect(runner.requests[1]).toMatchObject({ terminationGraceMs: 100, idleMs: 120000, wallMs: 600000, phase });
    },
  );

  it("hands every push descendant the one inherited push phase", async () => {
    const { phase } = await runPush();
    expect(runner.requests[1]?.phase).toBe(phase);
    expect(phase.deadlineAtMs).toBe(600000);
    clock.now = 599999;
    expect(phase.remainingMilliseconds()).toBe(1);
  });

  it("refuses to spawn once the inherited phase has run out", async () => {
    await runProbe();
    const phase = supervisor.beginPushPhase();
    const permit = supervisor.issue(node("source_push_git"), null, phase, pushIntent);
    clock.now = 600000;
    await expect(supervisor.run(permit, pushRequest)).rejects.toThrow("phase_deadline");
    expect(runner.spawnCount).toBe(1);
  });

  it("surfaces a capture failure and burns the permit", async () => {
    const phase = supervisor.beginPhase("distribution_probe");
    const permit = supervisor.issue(node("distribution_probe_git"), null, phase, probeIntent);
    await expect(
      supervisor.run(permit, probeRequest, () => {
        throw new Error("capture refused");
      }),
    ).rejects.toThrow("capture refused");
    await expect(supervisor.run(permit, probeRequest)).rejects.toThrow("permit_consumed");
  });

  it("never resets a push phase within one invocation", async () => {
    await runPush();
    expect(() => supervisor.beginPushPhase()).toThrow("phase_already_begun");
  });

  it("gives a later push_pending invocation a fresh phase only after its distribution recheck", () => {
    clock.now = 599000;
    const drifted = new SwappableIdentity();
    drifted.swapAfterIssue();
    const refused = new GitProcessSupervisor(table, runner, drifted.probe);
    expect(() => refused.beginPushPhase()).toThrow("unsupported_git_distribution");

    const later = new GitProcessSupervisor(table, runner, identity.probe);
    const phase = later.beginPushPhase();
    expect(phase.deadlineAtMs).toBe(599000 + 600000);
    expect(phase.remainingMilliseconds()).toBe(600000);
  });

  it("persists no lifetime clock in a permit or its evidence", async () => {
    await runProbe();
    const phase = supervisor.beginPhase("source_build");
    const permit = supervisor.issue(node("source_build_git"), null, phase, hashObjectIntent);
    const evidence = await supervisor.run(permit, hashObjectRequest);
    const permitKeys = Object.keys(permit).sort();
    const evidenceKeys = Object.keys(evidence).sort();
    expect(permitKeys.length).toBeGreaterThan(0);
    expect(permitKeys).toEqual([
      "argvSha256",
      "edgeId",
      "environmentProfileId",
      "environmentSha256",
      "ioProfileId",
      "nodeId",
      "parentPermitId",
      "permitId",
      "phaseId",
    ]);
    expect(evidenceKeys).toEqual([
      "edgeId",
      "exitCode",
      "groupReaped",
      "ioProfileId",
      "nodeId",
      "permitId",
      "signal",
      "stderrBytes",
      "stderrSha256",
      "stdoutBytes",
      "stdoutSha256",
      "termination",
    ]);
    expect(JSON.stringify({ permit, evidence })).not.toMatch(/deadline|elapsed|remaining|startedAt/iu);
  });
});
