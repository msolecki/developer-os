import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";

import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1, type LowerHexSha256 } from "@developer-os/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SupervisedProcessRunner, type SupervisedProcessEvidenceV1, type SupervisedSpawnRequestV1 } from "../supervised-process.js";
import { SUPPORTED_GIT_DISTRIBUTION } from "./distribution.js";
import { observedFromRow } from "./distribution.test-fixtures.js";
import {
  GIT_GATEWAY_TRAMPOLINE_TEMPLATE,
  materializeGitExecGateway,
  renderGitGatewayTrampoline,
  runGitGateway,
  runSshBridge,
  SanitizedLocalRemoteHelper,
  sanitizedGitEnvironment,
  verifyGitExecGateway,
  type GitGatewayOutcomeV1,
  type GitGatewayTransitionV1,
} from "./gateways.js";
import {
  materializeSanitizedBareDestinationShadow,
  materializeSanitizedGitShadow,
  validateShadowConfigTemplate,
  type SanitizedBareDestinationShadowV1,
} from "./shadow.js";
import {
  admittingGitIdentityProbe,
  GitProcessSupervisor,
  type GitConcreteProcessRequestV1,
  type GitEnvironmentSlotValuesV1,
  type GitProcessPermitV1,
  type GitProcessPhaseV1,
} from "./supervisor.js";
import type { ClosedGitProcessEdgeIdV1, ClosedGitProcessNodeIdV1, GitEnvironmentProfileIdV1, GitProcessNodeV1 } from "./types.js";

const table = SUPPORTED_GIT_DISTRIBUTION.processTable;
const UID = process.getuid?.() ?? 0;
const TOKEN = "e".repeat(64);
const COMMIT = "a".repeat(40);
const REFSPEC = `${COMMIT}:refs/heads/main`;
const HTTPS_URL = "https://example.invalid/synthetic/brain.git";
const QUARANTINE = parseCanonicalAbsolutePathText("/tmp/developer-os-test/quarantine");
const SOURCE_SHADOW = parseCanonicalAbsolutePathText("/tmp/developer-os-test/source-shadow");
const PINNED_EXECUTABLES: readonly string[] = SUPPORTED_GIT_DISTRIBUTION.executables.map((executable) => executable.invokedPath);
const sha = (bytes: Uint8Array): LowerHexSha256 => createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;

const ENV_SLOTS: GitEnvironmentSlotValuesV1 = {
  temporary_home: "/tmp/developer-os-test/home",
  canonical_user_home: "/Users/synthetic",
  temporary_directory: "/tmp/developer-os-test/tmp",
  gateway_path: "/tmp/developer-os-test/gateways",
  supervisor_socket: "/tmp/developer-os-test/supervisor.sock",
  invocation_capability: "b".repeat(64),
  source_git_dir: "/tmp/developer-os-test/source-shadow",
  source_index: "/tmp/developer-os-test/source-shadow/index",
  source_object_dir: "/tmp/developer-os-test/source-shadow/objects",
  source_alternate: "/tmp/developer-os-test/brain/.git/objects",
  ssh_bridge_path: "/tmp/developer-os-test/gateways/developer-os-ssh-bridge",
  opaque_local_token: TOKEN,
};

const EXITED: SupervisedProcessEvidenceV1 = {
  exitCode: 0,
  signal: null,
  stdoutBytes: 0,
  stderrBytes: 0,
  stdoutSha256: sha(new Uint8Array()),
  stderrSha256: sha(new Uint8Array()),
  termination: "exited",
  groupReaped: true,
};

/** Real phases, scripted children: every spawn request is recorded, none reaches the OS. */
class ScriptedRunner extends SupervisedProcessRunner {
  readonly requests: SupervisedSpawnRequestV1[] = [];

  constructor() {
    super({
      spawn: () => {
        throw new Error("the scripted runner never spawns");
      },
      killGroup: () => undefined,
      now: () => 0,
      setTimer: () => () => undefined,
    });
  }

  override async run(request: SupervisedSpawnRequestV1): Promise<SupervisedProcessEvidenceV1> {
    this.requests.push(request);
    await Promise.resolve();
    return EXITED;
  }
}

function node(id: ClosedGitProcessNodeIdV1): GitProcessNodeV1 {
  const found = table.nodes.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`fixture: no node ${id}`);
  return found;
}

const env = (profile: GitEnvironmentProfileIdV1, slots: GitEnvironmentSlotValuesV1 = ENV_SLOTS): Readonly<Record<string, string>> =>
  sanitizedGitEnvironment(table, profile, slots);

let runner: ScriptedRunner;
let supervisor: GitProcessSupervisor;
let executed: string[];

beforeEach(() => {
  runner = new ScriptedRunner();
  supervisor = new GitProcessSupervisor(
    table,
    runner,
    admittingGitIdentityProbe(SUPPORTED_GIT_DISTRIBUTION, () => observedFromRow(SUPPORTED_GIT_DISTRIBUTION)),
  );
  executed = [];
});

async function beginPush(profile: "push_https" | "push_local" | "push_ssh"): Promise<{ readonly phase: GitProcessPhaseV1; readonly push: GitProcessPermitV1 }> {
  const probePhase = supervisor.beginPhase("distribution_probe");
  await supervisor.run(
    supervisor.issue(node("distribution_probe_git"), null, probePhase, {
      edgeId: "direct_distribution_probe",
      argvAlternative: 0,
      argvSlots: {},
      environmentProfileId: "distribution_probe",
      environmentSlots: ENV_SLOTS,
      cwd: QUARANTINE,
      stdin: "ignore",
    }),
    { argv: ["git", "--version", "--build-options"], env: env("distribution_probe"), cwd: QUARANTINE, stdin: "ignore" },
  );
  const phase = supervisor.beginPushPhase();
  const push = supervisor.issue(node("source_push_git"), null, phase, {
    edgeId: "direct_source_push",
    argvAlternative: 0,
    argvSlots: { commit_to_branch_refspec: REFSPEC },
    environmentProfileId: profile,
    environmentSlots: ENV_SLOTS,
    cwd: SOURCE_SHADOW,
    stdin: "ignore",
  });
  await supervisor.run(push, {
    argv: ["git", "push", "--porcelain", "--no-verify", "--no-thin", "developer-os", REFSPEC],
    env: env(profile),
    cwd: SOURCE_SHADOW,
    stdin: "ignore",
  });
  return { phase, push };
}

interface GatewayStep {
  readonly parent: GitProcessPermitV1;
  readonly phase: GitProcessPhaseV1;
  readonly spawnEdge: ClosedGitProcessEdgeIdV1;
  readonly gatewayNode: ClosedGitProcessNodeIdV1;
  readonly basename: string;
  readonly argv: readonly string[];
  readonly argvSlots: GitGatewayTransitionV1["argvSlots"];
  readonly gatewayProfile: GitEnvironmentProfileIdV1;
  readonly gatewayCwd: CanonicalAbsolutePathV1;
  readonly transition: GitGatewayTransitionV1;
  readonly envSlots?: GitEnvironmentSlotValuesV1;
}

async function gatewayStep(step: GatewayStep): Promise<GitGatewayOutcomeV1> {
  const slots = step.envSlots ?? ENV_SLOTS;
  const capability = supervisor.issue(node(step.gatewayNode), step.parent, step.phase, {
    edgeId: step.spawnEdge,
    argvAlternative: 0,
    argvSlots: step.argvSlots,
    environmentProfileId: step.gatewayProfile,
    environmentSlots: slots,
    cwd: step.gatewayCwd,
    stdin: "ignore",
  });
  const request: GitConcreteProcessRequestV1 = { argv: step.argv, env: env(step.gatewayProfile, slots), cwd: step.gatewayCwd, stdin: "ignore" };
  const outcome = await runGitGateway({ supervisor, table, phase: step.phase, basename: step.basename, request, transition: step.transition }, capability);
  if (outcome.kind === "exec") executed.push(outcome.executable);
  return outcome;
}

async function httpsChain(
  phase: GitProcessPhaseV1,
  push: GitProcessPermitV1,
): Promise<{ readonly dispatch: GitProcessPermitV1; readonly helper: GitGatewayOutcomeV1 }> {
  const argvSlots = { validated_https_url: HTTPS_URL };
  const dispatch = await gatewayStep({
    parent: push,
    phase,
    spawnEdge: "spawn_https_dispatch_gateway",
    gatewayNode: "gateway_https_dispatch_git",
    basename: "git",
    argv: ["git", "remote-https", "developer-os", HTTPS_URL],
    argvSlots,
    gatewayProfile: "push_https",
    gatewayCwd: SOURCE_SHADOW,
    transition: { argvAlternative: 0, argvSlots, environmentProfileId: "push_https", environmentSlots: ENV_SLOTS, cwd: SOURCE_SHADOW },
  });
  if (dispatch.kind !== "exec") throw new Error(`fixture: dispatch ${dispatch.kind}`);
  return { dispatch: dispatch.permit, helper: await helperStep(phase, dispatch.permit) };
}

function helperStep(phase: GitProcessPhaseV1, dispatch: GitProcessPermitV1): Promise<GitGatewayOutcomeV1> {
  const argvSlots = { validated_https_url: HTTPS_URL };
  return gatewayStep({
    parent: dispatch,
    phase,
    spawnEdge: "spawn_https_helper_gateway",
    gatewayNode: "gateway_https_helper",
    basename: "git-remote-https",
    argv: ["git-remote-https", "developer-os", HTTPS_URL],
    argvSlots,
    gatewayProfile: "push_https",
    gatewayCwd: SOURCE_SHADOW,
    transition: { argvAlternative: 0, argvSlots, environmentProfileId: "https_helper", environmentSlots: ENV_SLOTS, cwd: SOURCE_SHADOW },
  });
}

describe("SanitizedGitEnvironmentV1", () => {
  it("expands exactly one profile, including GIT_SSH_VARIANT=ssh and GIT_CONFIG_NOSYSTEM, and inherits nothing", () => {
    const ambient = ["GIT_ASKPASS", "SSH_ASKPASS", "GIT_EDITOR", "GIT_PAGER", "HTTPS_PROXY", "GIT_SSH_COMMAND", "GIT_CONFIG_PARAMETERS"];
    for (const name of ambient) process.env[name] = "/bin/sh";
    try {
      const ssh = env("push_ssh");
      expect(ssh.GIT_SSH_VARIANT).toBe("ssh");
      expect(ssh.GIT_SSH).toBe(ENV_SLOTS.ssh_bridge_path);
      expect(ssh.GIT_CONFIG_NOSYSTEM).toBe("1");
      expect(ssh.GIT_CONFIG_GLOBAL).toBe("/dev/null");
      expect(ssh.GIT_TERMINAL_PROMPT).toBe("0");
      expect(ssh.PATH).toBe(ENV_SLOTS.gateway_path);
      expect(ssh.GIT_EXEC_PATH).toBe(ENV_SLOTS.gateway_path);
      const profile = table.environmentProfiles.find((candidate) => candidate.id === "push_ssh");
      expect(Object.keys(ssh).sort()).toEqual(profile?.entries.map((entry) => entry.name).sort());
      for (const name of ambient) expect(Object.keys(ssh)).not.toContain(name);
      expect(Object.keys(env("system_ssh_no_agent")).sort()).toEqual(["HOME", "LANG", "LC_ALL", "TMPDIR"]);
    } finally {
      for (const name of ambient) Reflect.deleteProperty(process.env, name);
    }
  });

  const alternates = [
    "/tmp/a:/tmp/b",
    '/tmp/"quoted',
    "/tmp/back\\slash",
    `/tmp/a${String.fromCodePoint(0x0a)}b`,
    `/tmp/a${String.fromCodePoint(0x1f)}b`,
    `/tmp/a${String.fromCodePoint(0x85)}b`,
    "relative/objects",
  ];

  it.each(alternates)("refuses the alternate object directory %j before any permit", (alternate) => {
    expect(alternates.length).toBeGreaterThan(0);
    expect(() => env("push_local", { ...ENV_SLOTS, source_alternate: alternate })).toThrow("git_env_slot_invalid: source_alternate");
  });

  it("refuses a PATH list, a missing slot and a non-token capability", () => {
    expect(() => env("push_local", { ...ENV_SLOTS, gateway_path: "/tmp/gw:/usr/bin" })).toThrow("gateway_path");
    const missing = Object.fromEntries(Object.entries(ENV_SLOTS).filter(([name]) => name !== "temporary_home"));
    expect(() => env("push_local", missing)).toThrow("git_env_slot_missing: temporary_home");
    expect(() => env("push_local", { ...ENV_SLOTS, invocation_capability: "short" })).toThrow("invocation_capability");
  });
});

describe("GitExecGatewayV1", () => {
  let root: string;

  beforeEach(async () => {
    root = await nodeFs.realpath(await nodeFs.mkdtemp(`${tmpdir()}/developer-os-gateway-`));
  });

  afterEach(async () => {
    await nodeFs.rm(root, { recursive: true, force: true });
  });

  it("writes exactly five owner-only no-shell trampolines from the one template", async () => {
    const execPath = parseCanonicalAbsolutePathText(await nodeFs.realpath(process.execPath));
    const gateway = await materializeGitExecGateway({ directory: parseCanonicalAbsolutePathText(`${root}/gateway`), execPath, effectiveUid: UID });
    expect(gateway.trampolines.map((trampoline) => trampoline.basename)).toEqual([
      "developer-os-ssh-bridge",
      "git",
      "git-receive-pack",
      "git-remote-developer-os-local",
      "git-remote-https",
    ]);
    for (const trampoline of gateway.trampolines) {
      const text = await nodeFs.readFile(trampoline.path, "utf8");
      expect(text.split("\n")[0]).toBe(`#!${execPath}`);
      expect(text).toBe(renderGitGatewayTrampoline(execPath, trampoline.basename));
      expect(text).not.toContain("/bin/sh");
      expect(text).not.toContain("child_process");
      expect((await nodeFs.stat(trampoline.path)).mode & 0o777).toBe(0o700);
    }
    expect(GIT_GATEWAY_TRAMPOLINE_TEMPLATE).not.toContain("/usr/bin/env");
    await expect(verifyGitExecGateway(gateway, UID)).resolves.toBeUndefined();
    await nodeFs.writeFile(`${gateway.directory}/git-upload-pack`, "#!/bin/sh\n", { mode: 0o700 });
    await expect(verifyGitExecGateway(gateway, UID)).rejects.toThrow("git_gateway_changed");
  });

  it("refuses a shebang path with whitespace and a gateway directory that could split PATH", async () => {
    await expect(
      materializeGitExecGateway({ directory: parseCanonicalAbsolutePathText(`${root}/g`), execPath: parseCanonicalAbsolutePathText("/opt/my node/bin/node"), effectiveUid: UID }),
    ).rejects.toThrow("git_gateway_exec_path_invalid");
    await expect(
      materializeGitExecGateway({ directory: parseCanonicalAbsolutePathText(`${root}/a:b`), execPath: parseCanonicalAbsolutePathText("/usr/local/bin/node"), effectiveUid: UID }),
    ).rejects.toThrow("git_gateway_path_invalid");
  });
});

describe("runGitGateway", () => {
  it("identifies the pre-issued pack permit, execs the pinned Git, and refuses reuse or the wrong basename", async () => {
    const { phase, push } = await beginPush("push_https");
    const packArgv = ["git", "pack-objects", "--all-progress-implied", "--revs", "--stdout", "--delta-base-offset", "-q"];
    const step: GatewayStep = {
      parent: push,
      phase,
      spawnEdge: "spawn_pack_gateway",
      gatewayNode: "gateway_pack_git",
      basename: "git",
      argv: packArgv,
      argvSlots: {},
      gatewayProfile: "push_https",
      gatewayCwd: SOURCE_SHADOW,
      transition: { argvAlternative: 0, argvSlots: {}, environmentProfileId: "push_https", environmentSlots: ENV_SLOTS, cwd: SOURCE_SHADOW },
    };
    expect(await gatewayStep({ ...step, basename: "git-receive-pack" })).toMatchObject({ kind: "refused", exitCode: 126 });
    const outcome = await gatewayStep(step);
    expect(outcome).toMatchObject({ kind: "exec", executable: SUPPORTED_GIT_DISTRIBUTION.executables[0]?.invokedPath });
    expect(outcome.kind === "exec" ? outcome.admission.argv : []).toEqual(packArgv);
    expect(await gatewayStep(step)).toMatchObject({ kind: "refused", reason: "git_edge_uses_exceeded" });
  });

  it("refuses a gateway argv that differs from the permit without admitting the real image", async () => {
    const { phase, push } = await beginPush("push_https");
    const argvSlots = { validated_https_url: HTTPS_URL };
    const outcome = await gatewayStep({
      parent: push,
      phase,
      spawnEdge: "spawn_https_dispatch_gateway",
      gatewayNode: "gateway_https_dispatch_git",
      basename: "git",
      argv: ["git", "remote-https", "developer-os", "https://attacker.invalid/x.git"],
      argvSlots,
      gatewayProfile: "push_https",
      gatewayCwd: SOURCE_SHADOW,
      transition: { argvAlternative: 0, argvSlots, environmentProfileId: "push_https", environmentSlots: ENV_SLOTS, cwd: SOURCE_SHADOW },
    });
    expect(outcome).toMatchObject({ kind: "refused", reason: "git_argv_mismatch" });
    expect(executed).toEqual([]);
  });

  it("admits one HTTPS helper and no second request after a redirect", async () => {
    const { phase, push } = await beginPush("push_https");
    const { dispatch, helper } = await httpsChain(phase, push);
    expect(helper).toMatchObject({ kind: "exec", executable: SUPPORTED_GIT_DISTRIBUTION.executables[1]?.invokedPath });
    expect(helper.kind === "exec" ? helper.admission.env : {}).toEqual(env("https_helper"));
    expect(await helperStep(phase, dispatch)).toMatchObject({ kind: "refused", reason: "git_edge_uses_exceeded" });
  });
});

describe("SanitizedSshBridgeV1", () => {
  const destination = { target: "git@example.invalid", port: null, receivePackCommand: "git-receive-pack 'synthetic/brain.git'" };

  async function enterBridge(): Promise<{ readonly phase: GitProcessPhaseV1; readonly outcome: GitGatewayOutcomeV1 }> {
    const { phase, push } = await beginPush("push_ssh");
    const argvSlots = { ssh_target: destination.target, ssh_receive_pack_command: destination.receivePackCommand };
    const outcome = await gatewayStep({
      parent: push,
      phase,
      spawnEdge: "spawn_ssh_bridge_gateway",
      gatewayNode: "gateway_ssh_bridge",
      basename: "developer-os-ssh-bridge",
      argv: ["developer-os-ssh-bridge", destination.target, destination.receivePackCommand],
      argvSlots,
      gatewayProfile: "push_ssh",
      gatewayCwd: SOURCE_SHADOW,
      transition: { argvAlternative: 0, argvSlots, environmentProfileId: "ssh_bridge", environmentSlots: ENV_SLOTS, cwd: QUARANTINE },
    });
    return { phase, outcome };
  }

  it("enters the bridge and execs only the fixed system SSH argv, with no -G probe", async () => {
    const { phase, outcome } = await enterBridge();
    expect(outcome).toMatchObject({ kind: "enter", mode: "ssh_bridge" });
    if (outcome.kind !== "enter") return;
    const ssh = runSshBridge({
      supervisor,
      table,
      phase,
      bridgePermit: outcome.permit,
      bridgeArgv: outcome.admission.argv,
      destination,
      environmentSlots: ENV_SLOTS,
      cwd: QUARANTINE,
    });
    expect(ssh).toMatchObject({ kind: "exec", executable: "/usr/bin/ssh" });
    const argv = ssh.kind === "exec" ? ssh.admission.argv : [];
    expect(argv).toEqual([
      "/usr/bin/ssh",
      "-F",
      "/dev/null",
      "-o",
      "BatchMode=yes",
      "-o",
      "NumberOfPasswordPrompts=0",
      "-o",
      "ClearAllForwardings=yes",
      "-o",
      "PermitLocalCommand=no",
      "-o",
      "ProxyCommand=none",
      "-o",
      "ProxyJump=none",
      "-o",
      "RequestTTY=no",
      "-o",
      "StrictHostKeyChecking=yes",
      destination.target,
      destination.receivePackCommand,
    ]);
    expect(argv).not.toContain("-G");
    expect(ssh.kind === "exec" ? Object.keys(ssh.admission.env) : []).not.toContain("SSH_AUTH_SOCK");
  });

  it("refuses a bridge whose argv names another destination", async () => {
    const { phase, outcome } = await enterBridge();
    if (outcome.kind !== "enter") throw new Error("fixture: bridge not entered");
    const ssh = runSshBridge({
      supervisor,
      table,
      phase,
      bridgePermit: outcome.permit,
      bridgeArgv: outcome.admission.argv,
      destination: { ...destination, target: "git@attacker.invalid" },
      environmentSlots: ENV_SLOTS,
      cwd: QUARANTINE,
    });
    expect(ssh).toMatchObject({ kind: "refused", exitCode: 126, reason: "git_ssh_destination_mismatch" });
  });
});

describe("SanitizedLocalRemoteHelperV1", () => {
  let root: string;
  let shadow: SanitizedBareDestinationShadowV1;

  beforeEach(async () => {
    root = await nodeFs.realpath(await nodeFs.mkdtemp(`${tmpdir()}/developer-os-local-helper-`));
    shadow = await materializeSanitizedBareDestinationShadow({
      gitDir: parseCanonicalAbsolutePathText(`${root}/destination`),
      template: validateShadowConfigTemplate({
        schemaVersion: 1,
        kind: "bare_destination",
        core: { repositoryFormatVersion: 0, fileMode: true, bare: true, hooksPath: { slot: "hooks_directory" }, fsmonitor: false },
        commit: { gpgSign: false },
        tag: { gpgSign: false },
        gc: { auto: 0 },
        maintenance: { auto: false },
        http: { proxy: "", followRedirects: false },
        credential: { helper: "" },
        remote: null,
        receive: { unpackLimit: 0, denyNonFastForwards: true, denyDeletes: true },
      }),
      opaqueLocalToken: null,
      head: new TextEncoder().encode("ref: refs/heads/main\n"),
      refs: [],
      effectiveUid: UID,
    });
  });

  afterEach(async () => {
    await nodeFs.rm(root, { recursive: true, force: true });
  });

  async function enterHelper(): Promise<{ readonly phase: GitProcessPhaseV1; readonly outcome: GitGatewayOutcomeV1; readonly slots: GitEnvironmentSlotValuesV1 }> {
    const slots = { ...ENV_SLOTS, private_destination_shadow: shadow.gitDir, destination_git_dir: shadow.gitDir };
    const { phase, push } = await beginPush("push_local");
    const argvSlots = { opaque_local_token: TOKEN };
    const dispatch = await gatewayStep({
      parent: push,
      phase,
      spawnEdge: "spawn_local_dispatch_gateway",
      gatewayNode: "gateway_local_dispatch_git",
      basename: "git",
      argv: ["git", "remote-developer-os-local", "developer-os", TOKEN],
      argvSlots,
      gatewayProfile: "push_local",
      gatewayCwd: SOURCE_SHADOW,
      transition: { argvAlternative: 0, argvSlots, environmentProfileId: "push_local", environmentSlots: slots, cwd: SOURCE_SHADOW },
      envSlots: slots,
    });
    if (dispatch.kind !== "exec") throw new Error(`fixture: dispatch ${dispatch.kind}`);
    const outcome = await gatewayStep({
      parent: dispatch.permit,
      phase,
      spawnEdge: "spawn_local_helper_gateway",
      gatewayNode: "gateway_local_helper",
      basename: "git-remote-developer-os-local",
      argv: ["git-remote-developer-os-local", "developer-os", TOKEN],
      argvSlots,
      gatewayProfile: "push_local",
      gatewayCwd: SOURCE_SHADOW,
      transition: { argvAlternative: 0, argvSlots, environmentProfileId: "local_helper", environmentSlots: slots, cwd: QUARANTINE },
      envSlots: slots,
    });
    return { phase, outcome, slots };
  }

  it("speaks only capabilities and connect, then permits receive-pack against the fixed private shadow", async () => {
    const { phase, outcome, slots } = await enterHelper();
    expect(outcome).toMatchObject({ kind: "enter", mode: "local_remote_helper" });
    if (outcome.kind !== "enter") return;
    const helper = new SanitizedLocalRemoteHelper({
      supervisor,
      table,
      phase,
      helperPermit: outcome.permit,
      token: TOKEN,
      destinationShadow: shadow,
      receiveEnvironmentSlots: slots,
      effectiveUid: UID,
    });
    helper.accept(outcome.admission.argv, outcome.admission.env);
    expect(await helper.step("capabilities")).toEqual({ kind: "reply", bytes: "connect\n\n" });
    const connected = await helper.step("connect git-receive-pack");
    expect(connected.kind).toBe("connect");
    if (connected.kind !== "connect") return;
    expect(connected.request.argv).toEqual(["git-receive-pack", "--skip-connectivity-check", shadow.gitDir]);
    expect(connected.request.cwd).toBe(shadow.gitDir);
    expect(connected.request.env.GIT_DIR).toBe(shadow.gitDir);
    expect(JSON.stringify(connected.request)).not.toContain("/bin/sh");
    expect(JSON.stringify(connected.request)).not.toContain(`${root}/real`);
    expect(supervisor.consume(connected.permit, connected.request)).toMatchObject({ edgeId: "spawn_receive_pack_gateway", executable: null });
    await expect(helper.step("capabilities")).rejects.toThrow("git_local_helper_protocol");
  });

  const hostileLines = ["connect git-upload-pack", "option verbosity 1", "push refs/heads/main:refs/heads/main", "fetch", "", "export"];

  it.each(hostileLines)("refuses the protocol line %j", async (line) => {
    expect(hostileLines.length).toBeGreaterThan(0);
    const { phase, outcome, slots } = await enterHelper();
    if (outcome.kind !== "enter") throw new Error("fixture: helper not entered");
    const helper = new SanitizedLocalRemoteHelper({
      supervisor,
      table,
      phase,
      helperPermit: outcome.permit,
      token: TOKEN,
      destinationShadow: shadow,
      receiveEnvironmentSlots: slots,
      effectiveUid: UID,
    });
    helper.accept(outcome.admission.argv, outcome.admission.env);
    await expect(helper.step(line)).rejects.toThrow("git_local_helper_protocol");
  });

  it("refuses another token, a real-destination shadow path and a planted shadow hook", async () => {
    const { phase, outcome, slots } = await enterHelper();
    if (outcome.kind !== "enter") throw new Error("fixture: helper not entered");
    const options = { supervisor, table, phase, helperPermit: outcome.permit, token: TOKEN, destinationShadow: shadow, receiveEnvironmentSlots: slots, effectiveUid: UID };
    expect(() => new SanitizedLocalRemoteHelper({ ...options, receiveEnvironmentSlots: { ...slots, destination_git_dir: `${root}/real.git` } })).toThrow(
      "git_local_shadow_mismatch",
    );
    const other = new SanitizedLocalRemoteHelper(options);
    expect(() => {
      other.accept(["git-remote-developer-os-local", "developer-os", "f".repeat(64)], outcome.admission.env);
    }).toThrow("git_argv_mismatch");
    const hooked = new SanitizedLocalRemoteHelper(options);
    hooked.accept(outcome.admission.argv, outcome.admission.env);
    await nodeFs.writeFile(`${shadow.hooksPath}/pre-receive`, "#!/bin/sh\ntouch pwned\n", { mode: 0o700 });
    await expect(hooked.step("connect git-receive-pack")).rejects.toThrow("git_shadow_hooks_changed");
  });
});

describe("hostile Git configuration is inert", () => {
  let root: string;

  beforeEach(async () => {
    root = await nodeFs.realpath(await nodeFs.mkdtemp(`${tmpdir()}/developer-os-hostile-`));
  });

  afterEach(async () => {
    await nodeFs.rm(root, { recursive: true, force: true });
  });

  const hostileGitConfigurations = [
    { name: "core.hooksPath and a pre-push hook", config: "[core]\n\thooksPath = /tmp/hostile-hooks\n", marker: "hostile-hooks" },
    { name: "core.sshCommand", config: "[core]\n\tsshCommand = /tmp/hostile-ssh\n", marker: "hostile-ssh" },
    { name: "credential helper", config: "[credential]\n\thelper = !/tmp/hostile-credential\n", marker: "hostile-credential" },
    { name: "fsmonitor", config: "[core]\n\tfsmonitor = /tmp/hostile-fsmonitor\n", marker: "hostile-fsmonitor" },
    { name: "an include", config: "[include]\n\tpath = /tmp/hostile-include\n", marker: "hostile-include" },
    { name: "a pushurl", config: '[remote "developer-os"]\n\tpushurl = https://hostile.invalid/x.git\n', marker: "hostile.invalid" },
    { name: "a URL rewrite", config: '[url "https://hostile-rewrite.invalid/"]\n\tpushInsteadOf = https://example.invalid/\n', marker: "hostile-rewrite" },
    { name: "an HTTP proxy", config: "[http]\n\tproxy = http://hostile-proxy.invalid\n", marker: "hostile-proxy" },
    { name: "a clean filter", config: '[filter "x"]\n\tclean = /tmp/hostile-filter\n', marker: "hostile-filter" },
    { name: "maintenance", config: "[maintenance]\n\tauto = true\n\tstrategy = /tmp/hostile-maintenance\n", marker: "hostile-maintenance" },
  ];

  async function runPlannedGateway(fixture: { readonly config: string; readonly marker: string }): Promise<{
    readonly hostileExecutions: readonly string[];
    readonly shadowBytes: string;
  }> {
    await nodeFs.mkdir(`${root}/brain/.git/hooks`, { recursive: true });
    await nodeFs.writeFile(`${root}/brain/.git/config`, fixture.config);
    await nodeFs.writeFile(`${root}/brain/.git/hooks/pre-push`, `#!/bin/sh\n${fixture.marker}\n`, { mode: 0o700 });
    const shadow = await materializeSanitizedGitShadow({
      gitDir: parseCanonicalAbsolutePathText(`${root}/shadow`),
      template: validateShadowConfigTemplate({
        schemaVersion: 1,
        kind: "source",
        core: { repositoryFormatVersion: 0, fileMode: true, bare: false, hooksPath: { slot: "hooks_directory" }, fsmonitor: false },
        commit: { gpgSign: false },
        tag: { gpgSign: false },
        gc: { auto: 0 },
        maintenance: { auto: false },
        http: { proxy: "", followRedirects: false },
        credential: { helper: "" },
        remote: { name: "developer-os", url: { kind: "literal", value: HTTPS_URL } },
        receive: null,
      }),
      opaqueLocalToken: null,
      head: new TextEncoder().encode("ref: refs/heads/main\n"),
      refs: [],
      effectiveUid: UID,
    });
    const { phase, push } = await beginPush("push_https");
    await httpsChain(phase, push);
    const spawned = runner.requests.map((request) => request.executable);
    const everything = [...spawned, ...executed];
    const argvs = runner.requests.flatMap((request) => [...request.argv, ...Object.values(request.env)]);
    return {
      hostileExecutions: [
        ...everything.filter((path) => !PINNED_EXECUTABLES.includes(path)),
        ...argvs.filter((value) => value.includes(fixture.marker) || value.includes(`${root}/brain/.git`)),
      ],
      shadowBytes: shadow.bytes,
    };
  }

  it.each(hostileGitConfigurations)("executes no hostile extension: $name", async (fixture) => {
    expect(hostileGitConfigurations.length).toBeGreaterThan(0);
    const result = await runPlannedGateway(fixture);
    expect(result.hostileExecutions).toEqual([]);
    expect(result.shadowBytes).not.toContain(fixture.marker);
    expect(executed.length).toBeGreaterThan(0);
  });
});
