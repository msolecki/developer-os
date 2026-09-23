/**
 * Spec 1 §4.2's `GitExecGatewayV1`: five generated no-shell trampolines, the
 * exact sanitized environment builder, and the in-process dispatcher that
 * turns one pre-issued gateway permit into its single same-PID transition.
 * The dispatcher identifies the permit it was handed; it never classifies a
 * process by pattern-matching argv. The Unix-socket transport between a
 * trampoline and this dispatcher is composition-root wiring, not this module.
 */
import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import * as nodeFs from "node:fs/promises";

import {
  parseCanonicalAbsolutePathText,
  parseUInt64Decimal,
  type CanonicalAbsolutePathV1,
  type LowerHexSha256,
} from "@developer-os/core";

import { SecurityRefusalError } from "../paths.js";
import { expandGitArgv, parseGitAlternateObjectDirectory, type GitArgSlotValuesV1 } from "./process-table.js";
import { parseOpaqueGitLocalToken, verifySanitizedGitShadow, type SanitizedBareDestinationShadowV1 } from "./shadow.js";
import type {
  GitConcreteProcessRequestV1,
  GitEnvironmentSlotValuesV1,
  GitProcessAdmissionV1,
  GitProcessPermitV1,
  GitProcessPhaseV1,
  GitProcessSupervisorV1,
} from "./supervisor.js";
import {
  CLOSED_GATEWAY_BASENAMES,
  type ClosedGatewayBasenameV1,
  type GitEnvironmentProfileIdV1,
  type GitEnvironmentSlotV1,
  type GitProcessEdgeV1,
  type GitProcessNodeV1,
  type SupportedGitProcessTableV1,
} from "./types.js";

declare const sanitizedGitEnvironmentV1: unique symbol;

/** One fully expanded profile: exactly its keys, sorted, and nothing inherited. */
export type SanitizedGitEnvironmentV1 = Readonly<Record<string, string>> & { readonly [sanitizedGitEnvironmentV1]: true };

const TRAMPOLINE_TEMPLATE_DOMAIN = "developer-os:git-gateway-trampoline-template:v1";
const TRAMPOLINE_DOMAIN = "developer-os:git-gateway-trampoline:v1";
const GATEWAY_REFUSAL_EXIT = 126;
const TEXT_SLOT_MAX_BYTES = 1024;
const encoder = new TextEncoder();

/**
 * The one checked-in immutable trampoline template. The shebang is the exact
 * guarded absolute Node path, never `env` or a shell. On `exec` it replaces
 * the same PID through `process.execve`; on `enter` it forwards its stdio to
 * the supervisor-side internal mode; on anything else it exits 126.
 */
export const GIT_GATEWAY_TRAMPOLINE_TEMPLATE = [
  "#!@@EXEC_PATH@@",
  '"use strict";',
  'const net = require("node:net");',
  'const basename = "@@BASENAME@@";',
  "const refuse = () => process.exit(126);",
  "const socket = net.createConnection(process.env.DEVELOPER_OS_GIT_SUPERVISOR_SOCKET ?? \"\");",
  'socket.on("error", refuse);',
  'socket.on("connect", () => {',
  "  socket.write(JSON.stringify({",
  "    capability: process.env.DEVELOPER_OS_GIT_INVOCATION_CAPABILITY ?? \"\",",
  "    basename,",
  "    pid: process.pid,",
  "    ppid: process.ppid,",
  "    argv: [basename, ...process.argv.slice(2)],",
  "    cwd: process.cwd(),",
  "    env: { ...process.env },",
  '  }) + "\\n");',
  "});",
  'let buffered = "";',
  "const onData = (chunk) => {",
  "  buffered += chunk.toString(\"utf8\");",
  '  const end = buffered.indexOf("\\n");',
  "  if (end < 0) return;",
  '  socket.off("data", onData);',
  "  let reply;",
  "  try { reply = JSON.parse(buffered.slice(0, end)); } catch { refuse(); }",
  '  if (reply.kind === "exec") {',
  "    process.execve(reply.executable, reply.argv, reply.env);",
  '  } else if (reply.kind === "enter") {',
  "    process.stdin.pipe(socket);",
  "    socket.pipe(process.stdout);",
  '    socket.on("end", () => process.exit(0));',
  "  } else {",
  "    refuse();",
  "  }",
  "};",
  'socket.on("data", onData);',
  "",
].join("\n");

export interface GitGatewayTrampolineV1 {
  readonly basename: ClosedGatewayBasenameV1;
  readonly path: CanonicalAbsolutePathV1;
  readonly dev: string;
  readonly ino: string;
  readonly sha256: LowerHexSha256;
}

export interface GitExecGatewayV1 {
  readonly directory: CanonicalAbsolutePathV1;
  readonly dev: string;
  readonly ino: string;
  readonly execPath: CanonicalAbsolutePathV1;
  readonly templateHash: LowerHexSha256;
  readonly trampolines: readonly GitGatewayTrampolineV1[];
}

function refuse(reason: string): never {
  throw new SecurityRefusalError(reason);
}

function domainHash(domain: string, bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(`${domain}\0`, "ascii").update(bytes).digest("hex") as LowerHexSha256;
}

function hasControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || codePoint === 0x2028 || codePoint === 0x2029) return true;
  }
  return false;
}

/** A shebang line splits at whitespace, so the interpreter path admits none. */
function parseShebangPath(value: unknown): CanonicalAbsolutePathV1 {
  const path = parseCanonicalAbsolutePathText(value);
  if (/\s/u.test(path) || hasControl(path)) refuse("git_gateway_exec_path_invalid");
  return path;
}

export function hashGitGatewayTemplate(): LowerHexSha256 {
  return domainHash(TRAMPOLINE_TEMPLATE_DOMAIN, encoder.encode(GIT_GATEWAY_TRAMPOLINE_TEMPLATE));
}

export function renderGitGatewayTrampoline(execPath: CanonicalAbsolutePathV1, basename: ClosedGatewayBasenameV1): string {
  if (!CLOSED_GATEWAY_BASENAMES.includes(basename)) refuse("git_gateway_basename_unknown");
  return GIT_GATEWAY_TRAMPOLINE_TEMPLATE.replace("@@EXEC_PATH@@", parseShebangPath(execPath)).replace("@@BASENAME@@", basename);
}

function errorCode(error: unknown): string {
  return error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
}

function ownerOnly(stats: BigIntStats, effectiveUid: number, mode: number): boolean {
  return Number(stats.uid) === effectiveUid && Number(stats.mode & 0o777n) === mode;
}

async function writeTrampoline(path: string, bytes: Uint8Array, effectiveUid: number): Promise<BigIntStats> {
  let handle: nodeFs.FileHandle;
  try {
    handle = await nodeFs.open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o700);
  } catch (error) {
    if (errorCode(error) === "EEXIST" || errorCode(error) === "ELOOP") refuse("git_gateway_path_exists");
    throw error;
  }
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile() || !ownerOnly(stats, effectiveUid, 0o700) || stats.nlink !== 1n) refuse("git_gateway_postimage");
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null);
      offset += bytesWritten;
    }
    await handle.sync();
    return stats;
  } finally {
    await handle.close();
  }
}

export interface GitExecGatewayRequestV1 {
  /** Must not exist yet; `PATH` and `GIT_EXEC_PATH` will contain only this directory. */
  readonly directory: CanonicalAbsolutePathV1;
  /** The guarded absolute `process.execPath`. */
  readonly execPath: CanonicalAbsolutePathV1;
  readonly effectiveUid: number;
}

/** Creates the owner-only gateway directory, writes each trampoline exclusively, then re-reads and binds every one. */
export async function materializeGitExecGateway(request: GitExecGatewayRequestV1): Promise<GitExecGatewayV1> {
  const directory = parseCanonicalAbsolutePathText(request.directory);
  if (directory.includes(":")) refuse("git_gateway_path_invalid");
  const execPath = parseShebangPath(request.execPath);
  try {
    await nodeFs.mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) === "EEXIST") refuse("git_gateway_path_exists");
    throw error;
  }
  const directoryStats = await nodeFs.lstat(directory, { bigint: true });
  if (!directoryStats.isDirectory() || !ownerOnly(directoryStats, request.effectiveUid, 0o700)) refuse("git_gateway_postimage");

  const trampolines: GitGatewayTrampolineV1[] = [];
  for (const basename of CLOSED_GATEWAY_BASENAMES) {
    const path = parseCanonicalAbsolutePathText(`${directory}/${basename}`);
    const bytes = encoder.encode(renderGitGatewayTrampoline(execPath, basename));
    const stats = await writeTrampoline(path, bytes, request.effectiveUid);
    trampolines.push({
      basename,
      path,
      dev: parseUInt64Decimal(stats.dev.toString(10)),
      ino: parseUInt64Decimal(stats.ino.toString(10)),
      sha256: domainHash(TRAMPOLINE_DOMAIN, bytes),
    });
  }
  const gateway: GitExecGatewayV1 = {
    directory,
    dev: parseUInt64Decimal(directoryStats.dev.toString(10)),
    ino: parseUInt64Decimal(directoryStats.ino.toString(10)),
    execPath,
    templateHash: hashGitGatewayTemplate(),
    trampolines,
  };
  await verifyGitExecGateway(gateway, request.effectiveUid);
  return gateway;
}

/** The directory holds exactly the five trampolines, each identity- and byte-identical to its plan record. */
export async function verifyGitExecGateway(gateway: GitExecGatewayV1, effectiveUid: number): Promise<void> {
  if (gateway.templateHash !== hashGitGatewayTemplate()) refuse("git_gateway_changed");
  const directoryStats = await nodeFs.lstat(gateway.directory, { bigint: true });
  if (
    !directoryStats.isDirectory() ||
    !ownerOnly(directoryStats, effectiveUid, 0o700) ||
    directoryStats.dev.toString(10) !== gateway.dev ||
    directoryStats.ino.toString(10) !== gateway.ino
  ) {
    refuse("git_gateway_changed");
  }
  const names = (await nodeFs.readdir(gateway.directory)).sort();
  if (names.join("\0") !== [...CLOSED_GATEWAY_BASENAMES].sort().join("\0")) refuse("git_gateway_changed");
  for (const trampoline of gateway.trampolines) {
    const handle = await nodeFs.open(trampoline.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stats = await handle.stat({ bigint: true });
      const bytes = await handle.readFile();
      if (
        !stats.isFile() ||
        !ownerOnly(stats, effectiveUid, 0o700) ||
        stats.nlink !== 1n ||
        stats.dev.toString(10) !== trampoline.dev ||
        stats.ino.toString(10) !== trampoline.ino ||
        domainHash(TRAMPOLINE_DOMAIN, bytes) !== trampoline.sha256 ||
        bytes.toString("utf8") !== renderGitGatewayTrampoline(gateway.execPath, trampoline.basename)
      ) {
        refuse("git_gateway_changed");
      }
    } finally {
      await handle.close();
    }
  }
}

const PATH_SLOTS: readonly GitEnvironmentSlotV1[] = [
  "temporary_home",
  "canonical_user_home",
  "temporary_directory",
  "supervisor_socket",
  "source_git_dir",
  "source_index",
  "source_object_dir",
  "destination_git_dir",
  "ssh_auth_sock",
  "ssh_bridge_path",
  "private_destination_shadow",
];

function admitEnvironmentSlot(slot: GitEnvironmentSlotV1, value: string): string {
  try {
    if (PATH_SLOTS.includes(slot)) return parseCanonicalAbsolutePathText(value);
    if (slot === "gateway_path") {
      const path = parseCanonicalAbsolutePathText(value);
      if (path.includes(":")) throw new Error("PATH list separator");
      return path;
    }
    if (slot === "source_alternate") return parseGitAlternateObjectDirectory(value);
    if (slot === "invocation_capability" || slot === "opaque_local_token") return parseOpaqueGitLocalToken(value);
    if (value === "" || hasControl(value) || encoder.encode(value).byteLength > TEXT_SLOT_MAX_BYTES) throw new Error("text");
    return value;
  } catch {
    return refuse(`git_env_slot_invalid: ${slot}`);
  }
}

/**
 * Expands exactly one profile from the compiled table. Every slot value is
 * admitted as its closed semantic type first: in particular the one raw
 * `GIT_ALTERNATE_OBJECT_DIRECTORIES` value accepts only
 * `GitAlternateObjectDirectoryV1`, and `PATH` cannot carry a second directory.
 */
export function sanitizedGitEnvironment(
  table: SupportedGitProcessTableV1,
  profileId: GitEnvironmentProfileIdV1,
  slots: GitEnvironmentSlotValuesV1,
): SanitizedGitEnvironmentV1 {
  const profile = table.environmentProfiles.find((candidate) => candidate.id === profileId);
  if (profile === undefined) refuse("git_env_mismatch");
  const environment: Record<string, string> = {};
  for (const entry of profile.entries) {
    if (entry.value.kind === "literal") {
      environment[entry.name] = entry.value.value;
      continue;
    }
    const value = Object.hasOwn(slots, entry.value.slot) ? slots[entry.value.slot] : undefined;
    if (typeof value !== "string") refuse(`git_env_slot_missing: ${entry.value.slot}`);
    environment[entry.name] = admitEnvironmentSlot(entry.value.slot, value);
  }
  return Object.freeze(environment) as SanitizedGitEnvironmentV1;
}

/** The plan-expanded values for the one same-PID transition behind a gateway. */
export interface GitGatewayTransitionV1 {
  readonly argvAlternative: number;
  readonly argvSlots: GitArgSlotValuesV1;
  readonly environmentProfileId: GitEnvironmentProfileIdV1;
  readonly environmentSlots: GitEnvironmentSlotValuesV1;
  readonly cwd: CanonicalAbsolutePathV1;
}

export interface GitGatewayInvocationV1 {
  readonly supervisor: GitProcessSupervisorV1;
  readonly table: SupportedGitProcessTableV1;
  /** The invocation's one inherited push phase; no helper begins another. */
  readonly phase: GitProcessPhaseV1;
  /** What the trampoline submitted: its fixed basename and literal process. */
  readonly basename: string;
  readonly request: GitConcreteProcessRequestV1;
  readonly transition: GitGatewayTransitionV1;
}

export type GitGatewayOutcomeV1 =
  | {
      readonly kind: "exec";
      readonly permit: GitProcessPermitV1;
      readonly executable: CanonicalAbsolutePathV1;
      readonly admission: GitProcessAdmissionV1;
    }
  | {
      readonly kind: "enter";
      readonly mode: "ssh_bridge" | "local_remote_helper";
      readonly permit: GitProcessPermitV1;
      readonly admission: GitProcessAdmissionV1;
    }
  | { readonly kind: "refused"; readonly exitCode: 126; readonly reason: string };

function tableNode(table: SupportedGitProcessTableV1, id: string): GitProcessNodeV1 {
  const node = table.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) refuse("git_unknown_child");
  return node;
}

function sameProcessEdge(table: SupportedGitProcessTableV1, from: GitProcessNodeV1): GitProcessEdgeV1 {
  const edges = table.edges.filter((candidate) => candidate.from === from.id && candidate.transition !== "spawn");
  if (edges.length !== 1) refuse("git_unknown_child");
  return edges[0] as GitProcessEdgeV1;
}

function refusal(error: unknown): GitGatewayOutcomeV1 {
  if (error instanceof SecurityRefusalError) return { kind: "refused", exitCode: GATEWAY_REFUSAL_EXIT, reason: error.message };
  throw error;
}

/**
 * Consumes the pre-issued gateway permit against the trampoline's literal
 * process, then issues and consumes the single same-PID transition the
 * table allows from that gateway. An `exec_same_pid` preserves the argv
 * exactly; the outcome names the rechecked real image to `execve`.
 */
export async function runGitGateway(invocation: GitGatewayInvocationV1, capability: GitProcessPermitV1): Promise<GitGatewayOutcomeV1> {
  await Promise.resolve();
  try {
    const { supervisor, table, phase, request, transition } = invocation;
    const gateway = tableNode(table, capability.nodeId);
    if (gateway.image.kind !== "gateway" || gateway.image.basename !== invocation.basename) refuse("git_gateway_basename_mismatch");
    if (capability.phaseId !== phase.id) refuse("git_phase_mismatch");
    const admitted = supervisor.consume(capability, request);

    const edge = sameProcessEdge(table, gateway);
    const target = tableNode(table, edge.to);
    const grammar = edge.argvAlternatives[transition.argvAlternative];
    if (grammar === undefined) refuse("git_argv_mismatch");
    const argv = expandGitArgv(grammar, transition.argvSlots);
    if (argv.join("\0") !== admitted.argv.join("\0")) refuse("git_argv_mismatch");
    const env = sanitizedGitEnvironment(table, transition.environmentProfileId, transition.environmentSlots);

    const permit = supervisor.issue(target, capability, phase, { edgeId: edge.id, ...transition, stdin: "ignore" });
    const admission = supervisor.consume(permit, { argv, env, cwd: transition.cwd, stdin: "ignore" });
    if (target.image.kind === "internal") return { kind: "enter", mode: target.image.mode, permit, admission };
    if (admission.executable === null) refuse("git_unknown_child");
    return { kind: "exec", permit, executable: admission.executable, admission };
  } catch (error) {
    return refusal(error);
  }
}

/** The one plan-bound SSH destination, as the separate parsed slot fields. */
export interface SanitizedSshBridgeV1 {
  readonly target: string;
  readonly port: string | null;
  readonly receivePackCommand: string;
}

export interface GitSshBridgeInvocationV1 {
  readonly supervisor: GitProcessSupervisorV1;
  readonly table: SupportedGitProcessTableV1;
  readonly phase: GitProcessPhaseV1;
  /** The consumed `enter_ssh_bridge` permit. */
  readonly bridgePermit: GitProcessPermitV1;
  /** The bridge's own admitted argv, exactly as `enter_ssh_bridge` bound it. */
  readonly bridgeArgv: readonly string[];
  readonly destination: SanitizedSshBridgeV1;
  readonly environmentSlots: GitEnvironmentSlotValuesV1;
  readonly cwd: CanonicalAbsolutePathV1;
}

function bridgeArgvOf(destination: SanitizedSshBridgeV1): readonly string[] {
  const port = destination.port === null ? [] : ["-p", destination.port];
  return ["developer-os-ssh-bridge", ...port, destination.target, destination.receivePackCommand];
}

/**
 * The internal bridge accepts only its one plan-bound user/host/port and
 * `git-receive-pack` path, then consumes the separate same-PID system-SSH
 * permit. The fixed options carry no config, proxy, local command or TTY,
 * and `GIT_SSH_VARIANT=ssh` means Git never runs an `-G` detection probe.
 */
export function runSshBridge(invocation: GitSshBridgeInvocationV1): GitGatewayOutcomeV1 {
  try {
    const { supervisor, table, phase, bridgePermit, destination } = invocation;
    if (bridgePermit.nodeId !== "internal_ssh_bridge") refuse("git_parent_mismatch");
    if (invocation.bridgeArgv.join("\0") !== bridgeArgvOf(destination).join("\0")) refuse("git_ssh_destination_mismatch");
    const argvSlots: GitArgSlotValuesV1 = {
      ssh_target: destination.target,
      ssh_receive_pack_command: destination.receivePackCommand,
      ...(destination.port === null ? {} : { ssh_port: destination.port }),
    };
    const environmentProfileId = Object.hasOwn(invocation.environmentSlots, "ssh_auth_sock") ? "system_ssh_agent" : "system_ssh_no_agent";
    const edge = table.edges.find((candidate) => candidate.id === "exec_system_ssh");
    if (edge === undefined) refuse("git_unknown_child");
    const argvAlternative = destination.port === null ? 0 : 1;
    const argv = expandGitArgv(edge.argvAlternatives[argvAlternative] as GitProcessEdgeV1["argvAlternatives"][number], argvSlots);
    const env = sanitizedGitEnvironment(table, environmentProfileId, invocation.environmentSlots);
    const permit = supervisor.issue(tableNode(table, edge.to), bridgePermit, phase, {
      edgeId: edge.id,
      argvAlternative,
      argvSlots,
      environmentProfileId,
      environmentSlots: invocation.environmentSlots,
      cwd: invocation.cwd,
      stdin: "ignore",
    });
    const admission = supervisor.consume(permit, { argv, env, cwd: invocation.cwd, stdin: "ignore" });
    if (admission.executable === null) refuse("git_unknown_child");
    return { kind: "exec", permit, executable: admission.executable, admission };
  } catch (error) {
    return refusal(error);
  }
}

export interface SanitizedLocalRemoteHelperOptionsV1 {
  readonly supervisor: GitProcessSupervisorV1;
  readonly table: SupportedGitProcessTableV1;
  readonly phase: GitProcessPhaseV1;
  /** The consumed `enter_local_helper` permit. */
  readonly helperPermit: GitProcessPermitV1;
  readonly token: string;
  readonly destinationShadow: SanitizedBareDestinationShadowV1;
  /** The `destination_receive` slots; `destination_git_dir` must name the private shadow. */
  readonly receiveEnvironmentSlots: GitEnvironmentSlotValuesV1;
  readonly effectiveUid: number;
}

export type GitLocalHelperStepV1 =
  | { readonly kind: "reply"; readonly bytes: string }
  | {
      readonly kind: "connect";
      readonly bytes: string;
      readonly permit: GitProcessPermitV1;
      readonly request: GitConcreteProcessRequestV1;
    };

/**
 * `SanitizedLocalRemoteHelperV1`: the fixed internal helper. It holds only the
 * stripped token and the private bare-destination shadow — no real
 * destination path exists in it — and speaks only `capabilities` and
 * `connect git-receive-pack`. Connecting issues the one permit for the
 * receive-pack gateway against the private shadow; the caller spawns it.
 */
export class SanitizedLocalRemoteHelper {
  readonly #options: SanitizedLocalRemoteHelperOptionsV1;
  #state: "argv" | "capabilities" | "connect" | "connected" = "argv";

  constructor(options: SanitizedLocalRemoteHelperOptionsV1) {
    parseOpaqueGitLocalToken(options.token);
    if (options.helperPermit.nodeId !== "internal_local_helper") refuse("git_parent_mismatch");
    if (options.receiveEnvironmentSlots.destination_git_dir !== options.destinationShadow.gitDir) refuse("git_local_shadow_mismatch");
    this.#options = options;
  }

  accept(argv: readonly string[], env: Readonly<Record<string, string>>): void {
    const { token, destinationShadow } = this.#options;
    if (this.#state !== "argv") refuse("git_local_helper_protocol");
    if (argv.length !== 3 || argv[0] !== "git-remote-developer-os-local" || argv[1] !== "developer-os" || argv[2] !== token) {
      this.#state = "connected";
      refuse("git_argv_mismatch");
    }
    if (env.DEVELOPER_OS_GIT_LOCAL_TOKEN !== token || env.DEVELOPER_OS_GIT_DESTINATION_SHADOW !== destinationShadow.gitDir) {
      this.#state = "connected";
      refuse("git_env_mismatch");
    }
    this.#state = "capabilities";
  }

  async step(line: string): Promise<GitLocalHelperStepV1> {
    if (this.#state === "capabilities" && line === "capabilities") {
      this.#state = "connect";
      return { kind: "reply", bytes: "connect\n\n" };
    }
    if ((this.#state === "capabilities" || this.#state === "connect") && line === "connect git-receive-pack") {
      this.#state = "connected";
      return this.#connect();
    }
    this.#state = "connected";
    return refuse("git_local_helper_protocol");
  }

  async #connect(): Promise<GitLocalHelperStepV1> {
    const { supervisor, table, phase, helperPermit, destinationShadow, receiveEnvironmentSlots, effectiveUid } = this.#options;
    await verifySanitizedGitShadow(destinationShadow, effectiveUid);
    const argvSlots: GitArgSlotValuesV1 = { private_destination_shadow: destinationShadow.gitDir };
    const edge = table.edges.find((candidate) => candidate.id === "spawn_receive_pack_gateway");
    if (edge === undefined) refuse("git_unknown_child");
    const argv = expandGitArgv(edge.argvAlternatives[0] as GitProcessEdgeV1["argvAlternatives"][number], argvSlots);
    const env = sanitizedGitEnvironment(table, "destination_receive", receiveEnvironmentSlots);
    const permit = supervisor.issue(tableNode(table, edge.to), helperPermit, phase, {
      edgeId: edge.id,
      argvAlternative: 0,
      argvSlots,
      environmentProfileId: "destination_receive",
      environmentSlots: receiveEnvironmentSlots,
      cwd: destinationShadow.gitDir,
      stdin: "ignore",
    });
    return { kind: "connect", bytes: "\n", permit, request: { argv, env, cwd: destinationShadow.gitDir, stdin: "ignore" } };
  }
}

export type SanitizedLocalRemoteHelperV1 = SanitizedLocalRemoteHelper;
