/**
 * Spec 1 §4.2's process boundary for `git sync`, composed for the CLI: the
 * pinned-distribution observation, the read-only commit reader planning
 * uses instead of a Git process, and the one closed local transport — a
 * quarantine rebuild of every planned object followed by a push through the
 * gateway trampolines into a private bare destination shadow.
 *
 * Founder decision D59 (Q4-A): HTTPS and SSH refuse `unsupported_git_distribution`
 * until their process traces are recorded, so this runtime carries no network transport.
 */
import { createHash } from "node:crypto";
import { constants, lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import type { Duplex } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import { parseCanonicalAbsolutePathText, parseLowerHexSha1 } from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  FullBranchRefV1,
  GitCommitterV1,
  GitRefStateV1,
  GitRemoteTransportV1,
  LowerHexSha1,
  LowerHexSha256,
} from "@developer-os/core";
import {
  GitProcessSupervisor,
  SUPPORTED_GIT_DISTRIBUTION,
  SanitizedLocalRemoteHelper,
  SecurityRefusalError,
  SupervisedProcessRunner,
  admitGitDistribution,
  admittingGitIdentityProbe,
  createOpaqueGitLocalToken,
  expandGitArgv,
  hashGitProcessTable,
  hashShadowConfigTemplate,
  materializeGitExecGateway,
  materializeSanitizedBareDestinationShadow,
  materializeSanitizedGitShadow,
  nodeSupervisedProcessDependencies,
  prepareLocalReceive,
  runGitGateway,
  sanitizedGitEnvironment,
} from "@developer-os/security";
import type {
  GitEnvironmentSlotValuesV1,
  GitExecGatewayV1,
  GitLocalReceivePreparationV1,
  GitLocalReceiveRunV1,
  GitProcessPermitV1,
  GitProcessPhaseV1,
  GitProcessSupervisorV1,
  ObservedGitDistributionV1,
  SanitizedBareDestinationShadowV1,
  SanitizedGitShadowConfigTemplateV1,
  SupportedGitDistributionV1,
} from "@developer-os/security";

/** The Git objects one sync plans, as the quarantine rebuild recomputes them. */
export interface GitCandidateObjectsV1 {
  readonly blobs: readonly { readonly oid: LowerHexSha1; readonly content: Uint8Array }[];
  /** Bottom-up: every subtree precedes the tree that names it. */
  readonly trees: readonly { readonly oid: LowerHexSha1; readonly mktreeInput: Uint8Array }[];
  readonly commit: null | {
    readonly oid: LowerHexSha1;
    readonly treeOid: LowerHexSha1;
    readonly parentOid: LowerHexSha1 | null;
    readonly committer: GitCommitterV1;
  };
}

export interface GitLocalPushRequestV1 {
  readonly sourceGitDirectory: CanonicalAbsolutePathV1;
  readonly candidate: GitCandidateObjectsV1;
  readonly commitOid: LowerHexSha1;
  readonly branchRef: FullBranchRefV1;
  readonly destination: {
    readonly gitDirectory: CanonicalAbsolutePathV1;
    readonly head: Uint8Array;
    readonly target: GitRefStateV1;
  };
  /** The allocated destination effect quarantine, `staging/lifecycle/<lc>/git/destination/<ge>`. */
  readonly quarantineRoot: CanonicalAbsolutePathV1;
  readonly effectiveUid: number;
}

export interface GitLocalPushPreparationV1 {
  readonly preparation: GitLocalReceivePreparationV1;
  /** SHA-256 over the canonical admitted process nodes, bound into the destination effect plan. */
  readonly planningTranscriptHash: LowerHexSha256;
}

export interface GitRuntimeV1 {
  readonly processTableHash: LowerHexSha256;
  /** Refuses `unsupported_git_distribution` on any drift or unsupported transport; spawns nothing. */
  admitDistribution(transport: GitRemoteTransportV1): Promise<void>;
  /** A commit's root tree, read from the real repository's loose object; spawns nothing. */
  commitTree(gitDirectory: CanonicalAbsolutePathV1, commit: LowerHexSha1): Promise<LowerHexSha1>;
  /** The commit's parents, read the same way, for the fast-forward proof. */
  commitParents(gitDirectory: CanonicalAbsolutePathV1, commit: LowerHexSha1): Promise<readonly LowerHexSha1[]>;
  prepareLocalPush(request: GitLocalPushRequestV1): Promise<GitLocalPushPreparationV1>;
}

const FIXED_SHADOW_SECTIONS = {
  schemaVersion: 1,
  commit: { gpgSign: false },
  tag: { gpgSign: false },
  gc: { auto: 0 },
  maintenance: { auto: false },
  http: { proxy: "", followRedirects: false },
  credential: { helper: "" },
} as const;

export const SOURCE_LOCAL_SHADOW_TEMPLATE: SanitizedGitShadowConfigTemplateV1 = {
  ...FIXED_SHADOW_SECTIONS,
  kind: "source",
  receive: null,
  core: { repositoryFormatVersion: 0, fileMode: true, bare: false, hooksPath: { slot: "hooks_directory" }, fsmonitor: false },
  remote: { name: "developer-os", url: { kind: "slot", slot: "opaque_local_selector" } },
};

export const DESTINATION_SHADOW_TEMPLATE: SanitizedGitShadowConfigTemplateV1 = {
  ...FIXED_SHADOW_SECTIONS,
  kind: "bare_destination",
  receive: { unpackLimit: 0, denyNonFastForwards: true, denyDeletes: true },
  core: { repositoryFormatVersion: 0, fileMode: true, bare: true, hooksPath: { slot: "hooks_directory" }, fsmonitor: false },
  remote: null,
};

export const GIT_SHADOW_TEMPLATE_HASHES = {
  sourceLocal: hashShadowConfigTemplate(SOURCE_LOCAL_SHADOW_TEMPLATE),
  destination: hashShadowConfigTemplate(DESTINATION_SHADOW_TEMPLATE),
} as const;

const XCODE_VERSION_PLIST = "/Applications/Xcode.app/Contents/version.plist";
const MAX_LOOSE_COMMIT_BYTES = 1_048_576;
const MAX_PROTOCOL_LINE_BYTES = 4096;
const RECEIVE_PACK_TERMINATION_GRACE_MS = 100;

function unsupported(): never {
  throw new SecurityRefusalError("unsupported_git_distribution");
}

function refuse(reason: string): never {
  throw new SecurityRefusalError(reason);
}

function plistString(text: string, key: string): string {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, "u").exec(text)?.[1] ?? "";
}

/**
 * The executable hash is cached per exact file identity: every consumed distribution permit
 * rechecks the row, and rehashing a 3.8-MB binary for each of up to 200,001 object rebuilds
 * would dominate the phase budget.
 */
const hashCache = new Map<string, string>();

function hashTarget(path: string): { readonly ownerUid: number; readonly mode: number; readonly size: number; readonly sha256: string } {
  const stats = lstatSync(path, { bigint: true });
  const key = `${path}\0${stats.dev.toString(10)}\0${stats.ino.toString(10)}\0${stats.size.toString(10)}\0${stats.mtimeNs.toString(10)}\0${stats.ctimeNs.toString(10)}`;
  let sha256 = hashCache.get(key);
  if (sha256 === undefined) {
    sha256 = stats.isFile() ? createHash("sha256").update(readFileSync(path)).digest("hex") : "";
    hashCache.set(key, sha256);
  }
  return { ownerUid: Number(stats.uid), mode: Number(stats.mode & 0o7777n), size: Number(stats.size), sha256 };
}

function linkChainOf(path: string): readonly { readonly path: string; readonly target: string }[] {
  const chain: { path: string; target: string }[] = [];
  let current = path;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!lstatSync(current, { bigint: true }).isSymbolicLink()) return chain;
    const target = readlinkSync(current);
    chain.push({ path: current, target });
    current = target.startsWith("/") ? target : join(current, "..", target);
  }
  return unsupported();
}

/**
 * The measured half of the pinned row, taken from the file system alone. Version and build
 * text come from the one supervised probe once it ran; before that the row's own text stands
 * in, and the probe's output is then compared line for line, so text is never identity alone.
 */
export function observeGitDistribution(
  row: SupportedGitDistributionV1,
  probed: { readonly versionLines: readonly string[]; readonly buildOptionLines: readonly string[] } | null,
): ObservedGitDistributionV1 {
  try {
    const plist = readFileSync(XCODE_VERSION_PLIST, "utf8");
    return {
      xcode: { version: plistString(plist, "CFBundleShortVersionString"), build: plistString(plist, "ProductBuildVersion") },
      architecture: process.arch,
      buildOptionLines: probed?.buildOptionLines ?? row.buildOptionLines,
      executables: row.executables.map((executable) => ({
        id: executable.id,
        invokedPath: executable.invokedPath,
        linkChain: linkChainOf(executable.invokedPath),
        target: { canonicalPath: realpathSync(executable.invokedPath), ...hashTarget(realpathSync(executable.invokedPath)) },
        versionLines: executable.id === "git_main" && probed !== null ? probed.versionLines : executable.versionLines,
      })),
      execPathLinks: row.execPathLinks.map((link) => {
        const stats = lstatSync(link.path, { bigint: true });
        return {
          name: link.name,
          path: link.path,
          ownerUid: Number(stats.uid),
          mode: Number(stats.mode & 0o7777n),
          size: Number(stats.size),
          target: stats.isSymbolicLink() ? readlinkSync(link.path) : "",
        };
      }),
    };
  } catch (error) {
    if (error instanceof SecurityRefusalError) throw error;
    return unsupported();
  }
}

/** `<type> <size>\0<content>` from one guarded loose object; a packed-only object refuses. */
async function readLooseObject(gitDirectory: CanonicalAbsolutePathV1, oid: LowerHexSha1): Promise<{ readonly type: string; readonly content: Buffer }> {
  let handle;
  try {
    handle = await open(join(gitDirectory, "objects", oid.slice(0, 2), oid.slice(2)), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return refuse("git_commit_not_loose");
  }
  let raw: Buffer;
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile() || stats.size > BigInt(MAX_LOOSE_COMMIT_BYTES)) refuse("git_commit_not_loose");
    raw = inflateSync(await handle.readFile(), { maxOutputLength: MAX_LOOSE_COMMIT_BYTES });
  } finally {
    await handle.close();
  }
  if (createHash("sha1").update(raw).digest("hex") !== oid) refuse("git_object_corrupt");
  const nul = raw.indexOf(0);
  const header = raw.subarray(0, nul).toString("latin1");
  const [type, size] = header.split(" ");
  const content = raw.subarray(nul + 1);
  if (nul < 0 || type === undefined || String(content.byteLength) !== size) refuse("git_object_corrupt");
  return { type, content };
}

async function readCommit(
  gitDirectory: CanonicalAbsolutePathV1,
  oid: LowerHexSha1,
): Promise<{ readonly tree: LowerHexSha1; readonly parents: readonly LowerHexSha1[] }> {
  const object = await readLooseObject(gitDirectory, oid);
  if (object.type !== "commit") refuse("git_object_corrupt");
  const lines = object.content.toString("latin1").split("\n");
  const tree = /^tree ([0-9a-f]{40})$/u.exec(lines[0] ?? "")?.[1];
  if (tree === undefined) refuse("git_object_corrupt");
  const parents: LowerHexSha1[] = [];
  for (const line of lines.slice(1)) {
    const parent = /^parent ([0-9a-f]{40})$/u.exec(line)?.[1];
    if (parent === undefined) break;
    parents.push(parseLowerHexSha1(parent));
  }
  return { tree: parseLowerHexSha1(tree), parents };
}

function canonical(path: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(path);
}

type GatewayProfileV1 = "push_local" | "destination_receive";

interface PendingGatewayV1 {
  readonly basename: string;
  readonly edgeId: string;
  readonly parent: () => GitProcessPermitV1 | null;
  readonly profile: GatewayProfileV1;
  readonly slots: (argv: readonly string[]) => Readonly<Record<string, string>> | null;
  /** The same-PID step behind the gateway; absent, it keeps the gateway's own profile and cwd. */
  readonly enter?: { readonly profile: "local_helper"; readonly slots: GitEnvironmentSlotValuesV1; readonly cwd: CanonicalAbsolutePathV1 };
}

interface GitGatewayServerInputV1 {
  readonly supervisor: GitProcessSupervisorV1;
  readonly phase: GitProcessPhaseV1;
  readonly capability: string;
  readonly root: () => GitProcessPermitV1 | null;
  readonly sourceSlots: GitEnvironmentSlotValuesV1;
  readonly receiveSlots: GitEnvironmentSlotValuesV1;
  readonly helperSlots: GitEnvironmentSlotValuesV1;
  readonly helperCwd: CanonicalAbsolutePathV1;
  readonly token: string;
  readonly gateway: GitExecGatewayV1;
  readonly destinationShadow: SanitizedBareDestinationShadowV1;
  readonly effectiveUid: number;
}

interface TrampolineReportV1 {
  readonly capability: string;
  readonly basename: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

function parseReport(line: string): TrampolineReportV1 | null {
  try {
    const value = JSON.parse(line) as Partial<TrampolineReportV1>;
    const strings = (list: unknown): list is readonly string[] => Array.isArray(list) && list.every((entry) => typeof entry === "string");
    if (
      typeof value.capability !== "string" ||
      typeof value.basename !== "string" ||
      typeof value.cwd !== "string" ||
      !strings(value.argv) ||
      typeof value.env !== "object" ||
      !Object.values(value.env).every((entry) => typeof entry === "string")
    ) {
      return null;
    }
    return value as TrampolineReportV1;
  } catch {
    return null;
  }
}

/** Reads one LF-terminated line and hands back whatever arrived after it. */
function readLine(socket: Socket): Promise<{ readonly line: string; readonly rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf(0x0a);
      if (end < 0) {
        if (buffered.byteLength > 16_777_216) reject(new SecurityRefusalError("git_gateway_report_too_large"));
        return;
      }
      socket.off("data", onData);
      socket.pause();
      resolve({ line: buffered.subarray(0, end).toString("utf8"), rest: buffered.subarray(end + 1) });
    };
    socket.on("data", onData);
    socket.once("error", reject);
    socket.once("end", () => {
      reject(new SecurityRefusalError("git_gateway_report_truncated"));
    });
  });
}

/**
 * The supervisor side of the trampolines: one owner-only Unix socket per invocation.
 * Each connection names its exact process; the one pending gateway edge whose expanded
 * argv equals it byte for byte receives a permit, and `runGitGateway` decides `exec`,
 * `enter` or refusal. Classification is exact equality, never a pattern over argv.
 */
class GitGatewayServer {
  readonly #server: Server;
  readonly #pending: PendingGatewayV1[] = [];
  readonly #receiveNodes: GitLocalReceiveRunV1["nodes"][number][] = [];
  readonly #failures: string[] = [];
  #packHeaderObjectCount: number | null = null;
  #localDispatch: GitProcessPermitV1 | null = null;
  #receivePack: GitProcessPermitV1 | null = null;

  readonly #input: GitGatewayServerInputV1;

  constructor(input: GitGatewayServerInputV1) {
    this.#input = input;
    const table = SUPPORTED_GIT_DISTRIBUTION.processTable;
    const packArgv = expandGitArgv(table.edges.find((edge) => edge.id === "spawn_pack_gateway")?.argvAlternatives[0] ?? unsupported(), {});
    const tokenSlots = { opaque_local_token: input.token };
    this.#pending.push(
      { basename: "git", edgeId: "spawn_pack_gateway", parent: input.root, profile: "push_local", slots: (argv) => (argv.join("\0") === packArgv.join("\0") ? {} : null) },
      { basename: "git", edgeId: "spawn_local_dispatch_gateway", parent: input.root, profile: "push_local", slots: () => tokenSlots },
      {
        basename: "git-remote-developer-os-local",
        edgeId: "spawn_local_helper_gateway",
        parent: () => this.#localDispatch,
        profile: "push_local",
        slots: () => tokenSlots,
        enter: { profile: "local_helper", slots: input.helperSlots, cwd: input.helperCwd },
      },
      {
        basename: "git",
        edgeId: "spawn_index_gateway",
        parent: () => this.#receivePack,
        profile: "destination_receive",
        slots: (argv) => {
          const count = /^--pack_header=2,([1-9][0-9]*)$/u.exec(argv[3] ?? "")?.[1];
          const keep = /^--keep=(.+)$/u.exec(argv[4] ?? "")?.[1];
          return count === undefined || keep === undefined ? null : { pack_object_count: count, receive_keep_marker: keep };
        },
      },
    );
    this.#server = createServer((socket) => {
      this.#serve(socket).catch((error: unknown) => {
        this.#failures.push(error instanceof Error ? error.message : "git_gateway_failed");
        socket.destroy();
      });
    });
  }

  listen(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(path, () => {
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.#server.close(() => {
        resolve();
      });
    });
  }

  get failures(): readonly string[] {
    return this.#failures;
  }

  run(): GitLocalReceiveRunV1 {
    return { nodes: this.#receiveNodes, packHeaderObjectCount: this.#packHeaderObjectCount };
  }

  async #serve(socket: Socket): Promise<void> {
    const { line, rest } = await readLine(socket);
    const report = parseReport(line);
    if (report === null || report.capability !== this.#input.capability || rest.byteLength !== 0) refuse("git_gateway_report_invalid");
    const { supervisor, phase } = this.#input;
    const table = SUPPORTED_GIT_DISTRIBUTION.processTable;
    const request = { argv: report.argv, env: report.env, cwd: report.cwd, stdin: "ignore" as const };

    let permit: GitProcessPermitV1 | null = null;
    let slots: Readonly<Record<string, string>> = {};
    let profile: GatewayProfileV1 = "destination_receive";
    let enter: PendingGatewayV1["enter"];
    if (report.basename === "git-receive-pack") {
      permit = this.#receivePack;
      this.#receivePack = null;
      slots = { private_destination_shadow: this.#input.destinationShadow.gitDir };
    } else {
      for (const [index, pending] of this.#pending.entries()) {
        const parent = pending.parent();
        const edge = table.edges.find((candidate) => candidate.id === pending.edgeId);
        const candidateSlots = pending.basename === report.basename && parent !== null ? pending.slots(report.argv) : null;
        if (edge === undefined || candidateSlots === null || parent === null) continue;
        let argv: readonly string[];
        try {
          argv = expandGitArgv(edge.argvAlternatives[0] ?? unsupported(), candidateSlots);
        } catch {
          continue;
        }
        if (argv.join("\0") !== report.argv.join("\0")) continue;
        const environmentSlots = pending.profile === "push_local" ? this.#input.sourceSlots : this.#input.receiveSlots;
        const node = table.nodes.find((candidate) => candidate.id === edge.to) ?? unsupported();
        permit = supervisor.issue(node, parent, phase, {
          edgeId: edge.id,
          argvAlternative: 0,
          argvSlots: candidateSlots,
          environmentProfileId: pending.profile,
          environmentSlots,
          cwd: canonical(report.cwd),
          stdin: "ignore",
        });
        slots = candidateSlots;
        profile = pending.profile;
        enter = pending.enter;
        this.#pending.splice(index, 1);
        break;
      }
    }
    if (permit === null) refuse("git_gateway_unplanned_process");
    if (profile === "destination_receive" && permit.edgeId === "spawn_index_gateway") {
      this.#packHeaderObjectCount = Number(slots.pack_object_count);
    }
    const environmentSlots = profile === "push_local" ? this.#input.sourceSlots : this.#input.receiveSlots;
    const outcome = await runGitGateway(
      {
        supervisor,
        table,
        phase,
        basename: report.basename,
        request,
        transition:
          enter === undefined
            ? { argvAlternative: 0, argvSlots: slots, environmentProfileId: profile, environmentSlots, cwd: canonical(report.cwd) }
            : { argvAlternative: 0, argvSlots: slots, environmentProfileId: enter.profile, environmentSlots: enter.slots, cwd: enter.cwd },
      },
      permit,
    );
    if (outcome.kind === "refused") {
      socket.end(`${JSON.stringify({ kind: "refused" })}\n`);
      refuse(outcome.reason);
    }
    if (permit.nodeId === "gateway_receive_pack" || permit.nodeId === "gateway_index_git") {
      this.#receiveNodes.push(permit.nodeId, outcome.permit.nodeId);
    }
    if (outcome.permit.nodeId === "real_local_dispatch_git") this.#localDispatch = outcome.permit;
    if (outcome.permit.nodeId === "real_receive_pack") this.#receivePack = outcome.permit;
    if (outcome.kind === "exec") {
      socket.end(`${JSON.stringify({ kind: "exec", executable: outcome.executable, argv: outcome.admission.argv, env: outcome.admission.env })}\n`);
      return;
    }
    socket.write(`${JSON.stringify({ kind: "enter" })}\n`);
    await this.#localHelper(socket, outcome.permit, outcome.admission.argv, outcome.admission.env);
  }

  /** The internal remote helper: `capabilities`, then one `connect git-receive-pack` bridged to the private shadow. */
  async #localHelper(
    socket: Socket,
    helperPermit: GitProcessPermitV1,
    argv: readonly string[],
    env: Readonly<Record<string, string>>,
  ): Promise<void> {
    const helper = new SanitizedLocalRemoteHelper({
      supervisor: this.#input.supervisor,
      table: SUPPORTED_GIT_DISTRIBUTION.processTable,
      phase: this.#input.phase,
      helperPermit,
      token: this.#input.token,
      destinationShadow: this.#input.destinationShadow,
      receiveEnvironmentSlots: this.#input.receiveSlots,
      effectiveUid: this.#input.effectiveUid,
    });
    helper.accept(argv, env);
    socket.resume();
    for (;;) {
      const { line, rest } = await readLine(socket);
      if (Buffer.byteLength(line) > MAX_PROTOCOL_LINE_BYTES) refuse("git_local_helper_protocol");
      const step = await helper.step(line);
      socket.write(step.bytes);
      if (step.kind === "reply") {
        if (rest.byteLength !== 0) refuse("git_local_helper_protocol");
        socket.resume();
        continue;
      }
      this.#receivePack = step.permit;
      const trampoline = this.#input.gateway.trampolines.find((entry) => entry.basename === "git-receive-pack") ?? unsupported();
      await bridgeReceivePack({
        executable: trampoline.path,
        argv: step.request.argv.slice(1),
        env: step.request.env,
        cwd: step.request.cwd,
        rest,
        socket,
        phase: this.#input.phase,
      });
      return;
    }
  }
}

export interface ReceivePackBridgeV1 {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  /** Bytes the helper read past its `connect` line. */
  readonly rest: Uint8Array;
  readonly socket: Duplex;
  readonly phase: GitProcessPhaseV1;
}

/**
 * Spec §4.2: the trampoline and the `real_receive_pack`/`index-pack` it becomes run in their own
 * process group under the push phase deadline and the `receive_stream` caps, so a stalled helper
 * ends in group termination and reaping instead of holding the global lock.
 */
export async function bridgeReceivePack(input: ReceivePackBridgeV1): Promise<void> {
  const { socket } = input;
  const io = SUPPORTED_GIT_DISTRIBUTION.processTable.ioProfiles.find((profile) => profile.id === "receive_stream") ?? unsupported();
  try {
    const evidence = await new SupervisedProcessRunner(nodeSupervisedProcessDependencies).run(
      {
        executable: input.executable,
        argv: input.argv,
        env: input.env,
        cwd: input.cwd,
        stdin: { stream: connectionBytes(input.rest, socket, io.stdinMaxBytes) },
        inheritedFds: [],
        stdoutCap: io.stdoutMaxBytes,
        stderrCap: io.stderrMaxBytes,
        idleMs: io.idleDeadlineMs,
        wallMs: io.wallDeadlineMs,
        terminationGraceMs: RECEIVE_PACK_TERMINATION_GRACE_MS,
        phase: input.phase,
      },
      (chunk, stream) => {
        if (stream === "stdout") socket.write(chunk);
      },
    );
    if (evidence.termination !== "exited") refuse("git_process_failed");
  } finally {
    socket.end();
  }
}

async function* connectionBytes(rest: Uint8Array, socket: Duplex, cap: number): AsyncGenerator<Uint8Array> {
  let total = rest.byteLength;
  if (total > cap) refuse("git_stdin_over_limit");
  if (total > 0) yield rest;
  for await (const chunk of socket as AsyncIterable<Buffer>) {
    total += chunk.byteLength;
    if (total > cap) refuse("git_stdin_over_limit");
    yield chunk;
  }
}

async function runCoordinatorGit(
  supervisor: GitProcessSupervisorV1,
  phase: GitProcessPhaseV1,
  edgeId: "direct_distribution_probe" | "direct_source_build",
  argvAlternative: number,
  argvSlots: Readonly<Record<string, string>>,
  profile: "distribution_probe" | "source_build",
  environmentSlots: GitEnvironmentSlotValuesV1,
  cwd: CanonicalAbsolutePathV1,
  stdin: Uint8Array | null,
): Promise<string> {
  const table = SUPPORTED_GIT_DISTRIBUTION.processTable;
  const edge = table.edges.find((candidate) => candidate.id === edgeId) ?? unsupported();
  const node = table.nodes.find((candidate) => candidate.id === edge.to) ?? unsupported();
  const argv = expandGitArgv(edge.argvAlternatives[argvAlternative] ?? unsupported(), argvSlots);
  const env = sanitizedGitEnvironment(table, profile, environmentSlots);
  const permit = supervisor.issue(node, null, phase, {
    edgeId,
    argvAlternative,
    argvSlots,
    environmentProfileId: profile,
    environmentSlots,
    cwd,
    stdin: stdin === null ? "ignore" : { byteLength: stdin.byteLength, sha256: createHash("sha256").update(stdin).digest("hex") as LowerHexSha256 },
  });
  const chunks: Buffer[] = [];
  const evidence = await supervisor.run(permit, { argv, env, cwd, stdin: stdin === null ? "ignore" : { bytes: stdin } }, (chunk, stream) => {
    if (stream === "stdout") chunks.push(Buffer.from(chunk));
  });
  if (evidence.termination !== "exited" || evidence.exitCode !== 0) refuse("git_process_failed");
  return Buffer.concat(chunks).toString("utf8");
}

function committerDate(committer: GitCommitterV1): string {
  return `${String(committer.unixSeconds)} ${committer.utcOffset}`;
}

async function prepareLocalPush(request: GitLocalPushRequestV1): Promise<GitLocalPushPreparationV1> {
  const row = SUPPORTED_GIT_DISTRIBUTION;
  const table = row.processTable;
  const root = canonical(await realpath(await mkdtemp(join(tmpdir(), "dos-git-"))));
  let server: GitGatewayServer | null = null;
  try {
    let probed: { readonly versionLines: readonly string[]; readonly buildOptionLines: readonly string[] } | null = null;
    const supervisor = new GitProcessSupervisor(
      table,
      new SupervisedProcessRunner(nodeSupervisedProcessDependencies),
      admittingGitIdentityProbe(row, () => observeGitDistribution(row, probed)),
    );
    const gateway = await materializeGitExecGateway({
      directory: canonical(join(root, "gateway")),
      execPath: canonical(process.execPath),
      effectiveUid: request.effectiveUid,
    });
    const token = createOpaqueGitLocalToken();
    const capability = createOpaqueGitLocalToken();
    const home = canonical(join(root, "home"));
    const temporary = canonical(join(root, "tmp"));
    for (const directory of [home, temporary]) await mkdir(directory, { mode: 0o700 });
    const socketPath = canonical(join(root, "s"));
    const base: GitEnvironmentSlotValuesV1 = {
      temporary_home: home,
      temporary_directory: temporary,
      gateway_path: gateway.directory,
      supervisor_socket: socketPath,
      invocation_capability: capability,
    };
    const sourceShadow = await materializeSanitizedGitShadow({
      gitDir: canonical(join(root, "source.git")),
      template: SOURCE_LOCAL_SHADOW_TEMPLATE,
      opaqueLocalToken: token,
      head: new TextEncoder().encode(`ref: ${request.branchRef}\n`),
      refs: [],
      effectiveUid: request.effectiveUid,
    });
    const destinationShadow = await materializeSanitizedBareDestinationShadow({
      gitDir: canonical(join(request.quarantineRoot, "shadow.git")),
      template: DESTINATION_SHADOW_TEMPLATE,
      opaqueLocalToken: null,
      head: request.destination.head,
      refs: [],
      effectiveUid: request.effectiveUid,
    });
    const sourceSlots: GitEnvironmentSlotValuesV1 = {
      ...base,
      source_git_dir: sourceShadow.gitDir,
      source_index: canonical(join(sourceShadow.gitDir, "index")),
      source_object_dir: sourceShadow.objectDirectory,
      source_alternate: join(request.sourceGitDirectory, "objects"),
    };

    const probePhase = supervisor.beginPhase("distribution_probe");
    const probe = (await runCoordinatorGit(supervisor, probePhase, "direct_distribution_probe", 0, {}, "distribution_probe", base, root, null))
      .split("\n")
      .filter((line) => line.length > 0);
    probed = { versionLines: probe.slice(0, 1), buildOptionLines: probe.slice(1) };
    admitGitDistribution(observeGitDistribution(row, probed), row);

    const buildPhase = supervisor.beginPhase("source_build");
    const { candidate } = request;
    const committer = candidate.commit?.committer;
    const buildSlots: GitEnvironmentSlotValuesV1 = {
      ...sourceSlots,
      ...(committer === undefined
        ? {}
        : {
            git_author_name: committer.name,
            git_author_email: committer.email,
            git_author_date: committerDate(committer),
            git_committer_name: committer.name,
            git_committer_email: committer.email,
            git_committer_date: committerDate(committer),
          }),
    };
    const oidOf = (output: string): string => output.trim();
    for (const blob of candidate.blobs) {
      const oid = oidOf(await runCoordinatorGit(supervisor, buildPhase, "direct_source_build", 0, {}, "source_build", buildSlots, root, blob.content));
      if (oid !== blob.oid) refuse("git_candidate_mismatch");
    }
    for (const tree of candidate.trees) {
      const oid = oidOf(await runCoordinatorGit(supervisor, buildPhase, "direct_source_build", 1, {}, "source_build", buildSlots, root, tree.mktreeInput));
      if (oid !== tree.oid) refuse("git_candidate_mismatch");
    }
    if (candidate.commit !== null) {
      const { parentOid, treeOid } = candidate.commit;
      const oid = oidOf(
        await runCoordinatorGit(
          supervisor,
          buildPhase,
          "direct_source_build",
          parentOid === null ? 2 : 3,
          parentOid === null ? { candidate_tree_oid: treeOid } : { candidate_tree_oid: treeOid, parent_commit_oid: parentOid },
          "source_build",
          buildSlots,
          root,
          new TextEncoder().encode("chore(brain): sync\n"),
        ),
      );
      if (oid !== candidate.commit.oid) refuse("git_candidate_mismatch");
    }

    const pushPhase = supervisor.beginPushPhase();
    let rootPermit: GitProcessPermitV1 | null = null;
    server = new GitGatewayServer({
      supervisor,
      phase: pushPhase,
      capability,
      root: () => rootPermit,
      sourceSlots,
      receiveSlots: { ...base, destination_git_dir: destinationShadow.gitDir },
      helperSlots: { ...base, opaque_local_token: token, private_destination_shadow: destinationShadow.gitDir },
      token,
      gateway,
      destinationShadow,
      helperCwd: root,
      effectiveUid: request.effectiveUid,
    });
    await server.listen(socketPath);
    const activeServer = server;
    const preparation = await prepareLocalReceive({
      quarantineRoot: request.quarantineRoot,
      destinationShadow,
      destination: { gitDirectory: request.destination.gitDirectory, branchRef: request.branchRef, target: request.destination.target },
      commitOid: request.commitOid,
      boundary: new Set(),
      phase: pushPhase,
      effectiveUid: request.effectiveUid,
      receive: async () => {
        const edge = table.edges.find((candidateEdge) => candidateEdge.id === "direct_source_push") ?? unsupported();
        const node = table.nodes.find((candidateNode) => candidateNode.id === edge.to) ?? unsupported();
        const argvSlots = { commit_to_branch_refspec: `${request.commitOid}:${request.branchRef}` };
        const cwd = canonical(sourceShadow.gitDir);
        rootPermit = supervisor.issue(node, null, pushPhase, {
          edgeId: edge.id,
          argvAlternative: 0,
          argvSlots,
          environmentProfileId: "push_local",
          environmentSlots: sourceSlots,
          cwd,
          stdin: "ignore",
        });
        const evidence = await supervisor.run(rootPermit, {
          argv: expandGitArgv(edge.argvAlternatives[0] ?? unsupported(), argvSlots),
          env: sanitizedGitEnvironment(table, "push_local", sourceSlots),
          cwd,
          stdin: "ignore",
        });
        if (activeServer.failures.length > 0) refuse(activeServer.failures[0] ?? "git_gateway_failed");
        if (evidence.termination !== "exited" || evidence.exitCode !== 0) refuse("git_process_failed");
        return activeServer.run();
      },
    });
    await rm(destinationShadow.gitDir, { recursive: true, force: true });
    const transcript = JSON.stringify({ nodes: activeServer.run().nodes, kind: preparation.kind });
    return {
      preparation,
      planningTranscriptHash: createHash("sha256").update(transcript).digest("hex") as LowerHexSha256,
    };
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
}

export function createProductionGitRuntime(): GitRuntimeV1 {
  const row = SUPPORTED_GIT_DISTRIBUTION;
  return {
    processTableHash: hashGitProcessTable(row.processTable),
    admitDistribution: async (transport) => {
      await Promise.resolve();
      if (transport !== "local") unsupported();
      admitGitDistribution(observeGitDistribution(row, null), row);
    },
    commitTree: async (gitDirectory, commit) => (await readCommit(gitDirectory, commit)).tree,
    commitParents: async (gitDirectory, commit) => (await readCommit(gitDirectory, commit)).parents,
    prepareLocalPush,
  };
}
