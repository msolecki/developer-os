import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, unlink } from "node:fs/promises";

import {
  LAUNCHD_PROCESS_STAGING_CHILDREN,
  LifecycleRecoveryRequiredError,
  hashBytes,
  parseCanonicalAbsolutePathText,
  parseLaunchdEffectId,
  parseLowerHexSha256,
  parseUInt64Decimal,
  type CanonicalAbsolutePathV1,
  type EffectiveUidV1,
  type LaunchdEffectIdV1,
  type LowerHexSha256,
  type UInt64DecimalV1,
} from "@developer-os/core";
import type { SupervisedPhaseV1, SupervisedProcessRunner, SupervisedTerminationV1 } from "@developer-os/security";

import { recheckLaunchdHost, type LaunchdHostObserverV1 } from "./distribution.js";
import { encodeRetainedLaunchdPlist } from "./plist.js";
import {
  SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
  requireLaunchdMutationTable,
  type LaunchdProcessDirectoryIdentityV1,
  type SupportedLaunchdProcessTableTemplateV1,
  type SupportedLaunchdProcessTableV1,
} from "./process-table.js";
import { launchdGuiDomain, launchdJob, parseGeneratedLabel } from "./registry.js";
import { LaunchdInputError, type LaunchdGuiDomainV1, type LaunchdPlistDictionaryV1 } from "./types.js";

/**
 * Spec §5.3: the plan-bound real plist a bootstrap loads. Only a `keep` arm binds `dev`/`ino`,
 * because its retained inode persists; an arm Foundation writes (a forward postimage, or a preimage
 * its inverse restores) is published through a fresh temp inode and a rename, so it binds content
 * (`hash`, `size`) and metadata only, and its inode is the one the reader opens (NEW-138).
 */
export interface LaunchdBootstrapPlistIdentityV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly ownerUid: EffectiveUidV1;
  readonly mode: 384;
  readonly nlink: 1;
  readonly size: number;
  readonly hash: LowerHexSha256;
  readonly dev: UInt64DecimalV1 | null;
  readonly ino: UInt64DecimalV1 | null;
}

/**
 * The identity the plist reader admitted through one no-follow descriptor: the plan-bound fields
 * plus the `dev`/`ino` it actually opened. The pre-spawn recheck and the post-bootstrap
 * verification require the path to still name this inode.
 */
export interface LaunchdOpenedPlistIdentityV1 extends LaunchdBootstrapPlistIdentityV1 {
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export type LaunchdBootstrapDirectionV1 = "forward" | "reverse";
export type LaunchdBootstrapRoleV1 = "before" | "after";

/**
 * Everything one bootstrap needs, all plan-bound. The caller (the launchd effect executor) owns
 * the frontier: its journal must already durably name this exact forward `applied` or reverse
 * `compensating` transition, and its fresh live probe must equal the directional preimage. `phase`
 * is the transition's one 30,000-ms budget, shared with the follow-up probes.
 */
export interface LaunchdBootstrapRequestV1 {
  readonly table: SupportedLaunchdProcessTableV1;
  readonly domain: LaunchdGuiDomainV1;
  readonly effectId: LaunchdEffectIdV1;
  readonly planHash: LowerHexSha256;
  readonly direction: LaunchdBootstrapDirectionV1;
  readonly transitionIndex: number;
  readonly role: LaunchdBootstrapRoleV1;
  readonly source: LaunchdOpenedPlistIdentityV1;
  readonly plist: LaunchdPlistDictionaryV1;
  readonly phase: SupervisedPhaseV1;
}

/** Raw launchctl output is counted and discarded: no digest of it is kept (spec §5.3). */
export interface LaunchdMutationEvidenceV1 {
  readonly argvId: "bootstrap";
  readonly source: LaunchdOpenedPlistIdentityV1;
  readonly process: {
    readonly exitCode: number | null;
    readonly signal: string | null;
    readonly termination: SupervisedTerminationV1;
    readonly stdoutBytes: number;
    readonly stderrBytes: number;
    readonly groupReaped: true;
  };
}

/** The descriptor surface the protocol uses; Node's `FileHandle` satisfies it. */
export interface LaunchdFileHandleV1 {
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ readonly bytesRead: number }>;
  stat(options: { readonly bigint: true }): Promise<BigIntStats>;
  close(): Promise<void>;
}

export interface LaunchdFileSystemV1 {
  lstat(path: string, options: { readonly bigint: true }): Promise<BigIntStats>;
  open(path: string, flags: number, mode?: number): Promise<LaunchdFileHandleV1>;
  readdir(path: string): Promise<readonly string[]>;
  unlink(path: string): Promise<void>;
}

export interface LaunchdBootstrapDependenciesV1 {
  readonly runner: Pick<SupervisedProcessRunner, "run">;
  readonly fs?: LaunchdFileSystemV1;
  /** The compiled mutation template; injected only by fixtures. */
  readonly template?: SupportedLaunchdProcessTableTemplateV1;
  effectiveUid(): number;
  readonly host: LaunchdHostObserverV1;
}

export const NODE_LAUNCHD_FILE_SYSTEM: LaunchdFileSystemV1 = {
  lstat: (path, options) => lstat(path, options),
  open: (path, flags, mode) => open(path, flags, mode),
  readdir: (path) => readdir(path),
  unlink: (path) => unlink(path),
};

const MAX_PLIST_BYTES = 1_048_576;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;

function refuse(message: string): never {
  throw new LaunchdInputError(message);
}

function recovery(reason: string, ...paths: readonly string[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

function sameIdentity(stats: BigIntStats, identity: { readonly dev: string; readonly ino: string }): boolean {
  return stats.dev.toString(10) === identity.dev && stats.ino.toString(10) === identity.ino;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

/** Positional reads from byte zero; reads one byte past `limit` so growth is observed, not truncated. */
export async function readBoundedPlist(handle: LaunchdFileHandleV1, limit = MAX_PLIST_BYTES): Promise<Uint8Array> {
  const buffer = new Uint8Array(limit + 1);
  let length = 0;
  while (length < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, length, buffer.byteLength - length, length);
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  return buffer.subarray(0, length);
}

function admitSourceIdentity(source: LaunchdOpenedPlistIdentityV1, uid: number): LaunchdOpenedPlistIdentityV1 {
  const path = parseCanonicalAbsolutePathText(source.path);
  if (source.ownerUid !== uid) refuse("bootstrap plist: owner");
  if ((source.mode as number) !== 384 || (source.nlink as number) !== 1) refuse("bootstrap plist: mode or link count");
  if (!Number.isSafeInteger(source.size) || source.size < 1 || source.size > MAX_PLIST_BYTES) refuse("bootstrap plist: size");
  return Object.freeze({
    path,
    ownerUid: source.ownerUid,
    mode: 384,
    nlink: 1,
    size: source.size,
    hash: parseLowerHexSha256(source.hash),
    dev: parseUInt64Decimal(source.dev),
    ino: parseUInt64Decimal(source.ino),
  });
}

function matchesSource(stats: BigIntStats, source: LaunchdOpenedPlistIdentityV1): boolean {
  return (
    stats.isFile() &&
    stats.uid === BigInt(source.ownerUid) &&
    (stats.mode & 0o7777n) === BigInt(PRIVATE_FILE_MODE) &&
    stats.nlink === 1n &&
    stats.size === BigInt(source.size) &&
    sameIdentity(stats, source)
  );
}

/** What `launchctl print gui/<uid>/<label>` reported about the one loaded service. */
export interface LaunchdPrintedServiceV1 {
  readonly path: string;
  readonly program: string;
  readonly arguments: readonly string[];
  /** The top-level `environment` block: the plist's `EnvironmentVariables` plus launchd's own keys. */
  readonly environment: ReadonlyMap<string, string>;
}

/**
 * The keys launchd itself adds to a gui-domain agent's top-level `environment` block on macOS
 * 26.6.2. Every other key there comes from the plist's `EnvironmentVariables`: a third-party agent
 * on the same host whose plist sets only `PATH` printed `OSLogRateLimit`, `PATH` and
 * `XPC_SERVICE_NAME` there, while the user domain's variables print separately as
 * `inherited environment` and launchd's defaults as `default environment`.
 */
const LAUNCHD_ADDED_ENVIRONMENT_KEYS: ReadonlySet<string> = new Set(["OSLogRateLimit", "XPC_SERVICE_NAME"]);

function parseBlock(lines: readonly string[], start: number): { readonly entries: string[]; readonly end: number } | null {
  const entries: string[] = [];
  let index = start;
  for (; index < lines.length && lines[index] !== "\t}"; index += 1) {
    const line = lines[index] as string;
    if (!line.startsWith("\t\t")) return null;
    entries.push(line.slice(2));
  }
  return index >= lines.length ? null : { entries, end: index };
}

interface ScannedPrintedServiceV1 {
  readonly scalars: ReadonlyMap<string, readonly string[]>;
  readonly blocks: ReadonlyMap<string, readonly (readonly string[])[]>;
}

/** The structural pass `parseLaunchctlPrintedService` documents; null refuses the whole dump. */
function scanPrintedService(text: string, target: string): ScannedPrintedServiceV1 | null {
  const lines = text.split("\n");
  if (lines[0] !== `${target} = {`) return null;
  const scalars = new Map<string, string[]>();
  const blocks = new Map<string, string[][]>();
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] as string;
    // Every one-tab block is skipped to its own closing `\t}`; a two-tab line or a `\t}` outside a
    // block can only be a stray or injected line, so the whole dump is refused.
    const opened = /^\t([^\t].*) = \{$/u.exec(line)?.[1];
    if (opened !== undefined) {
      const block = parseBlock(lines, index + 1);
      if (block === null) return null;
      blocks.set(opened, [...(blocks.get(opened) ?? []), block.entries]);
      index = block.end;
      continue;
    }
    if (line.startsWith("\t\t") || line === "\t}") return null;
    const scalar = /^\t(path|program|last exit code) = (.*)$/u.exec(line);
    if (scalar?.[1] !== undefined) scalars.set(scalar[1], [...(scalars.get(scalar[1]) ?? []), scalar[2] ?? ""]);
  }
  return { scalars, blocks };
}

/**
 * NEW-169: the service's top-level `last exit code`, read through the same structural pass, exactly
 * once and a decimal, optionally followed by `: <NAME>`; `(never exited)` and anything else are null. Both plist output paths are
 * the null sink, so for a job that died before the runner wrote its status record this is the only
 * trace. Nothing else in the dump is read or retained.
 */
export function parseLaunchctlLastExitCode(text: string, target: string): number | null {
  const values = scanPrintedService(text, target)?.scalars.get("last exit code");
  const value = values?.length === 1 ? values[0] : undefined;
  // macOS 26.6.2 names a known code: `last exit code = 78: EX_CONFIG` (NEW-144). Only the integer is kept.
  const code = value === undefined ? undefined : /^(0|[1-9][0-9]{0,9})(?:: [A-Za-z_][A-Za-z0-9_ ]*)?$/u.exec(value)?.[1];
  return code === undefined ? null : Number(code);
}

/**
 * Conservative parser for the `launchctl print gui/<uid>/<label>` service dump, pinned to the
 * format of macOS 26.6.2 (25G83) by `bootstrap.test.ts`. The first line must be exactly
 * `<target> = {`. Every one-tab block is skipped to its matching `\t}`, and a two-tab line or a
 * `\t}` outside a block refuses the dump. `path`, `program`, the `arguments` block and the
 * `environment` block are read only at top-level indentation (one tab); each must occur exactly once, every block line is two
 * tabs plus its value, and every environment line is `KEY => value` with a unique key, so a nested
 * or injected duplicate (an inherited environment value with a newline, say) yields `null`. The
 * `inherited environment` and `default environment` blocks, and everything else, are ignored and
 * never retained.
 */
export function parseLaunchctlPrintedService(text: string, target: string): LaunchdPrintedServiceV1 | null {
  const scanned = scanPrintedService(text, target);
  if (scanned === null) return null;
  const { scalars, blocks } = scanned;
  const once = <T>(values: readonly T[] | undefined): T | undefined => (values?.length === 1 ? values[0] : undefined);
  const path = once(scalars.get("path"));
  const program = once(scalars.get("program"));
  const args = once(blocks.get("arguments"));
  const environmentLines = once(blocks.get("environment"));
  if (path === undefined || program === undefined || args === undefined || environmentLines === undefined) return null;
  const environment = new Map<string, string>();
  for (const line of environmentLines) {
    const entry = /^([^\s=]+) => (.*)$/u.exec(line);
    if (entry?.[1] === undefined || environment.has(entry[1])) return null;
    environment.set(entry[1], entry[2] ?? "");
  }
  return { path, program, arguments: args, environment };
}

/**
 * The plan's plists carry no `EnvironmentVariables`, so the loaded job's top-level environment may
 * hold only launchd's own keys, with `XPC_SERVICE_NAME` naming the planned label. A swapped plist
 * that adds a variable (`NODE_OPTIONS`, say) fails this.
 */
function environmentIsPlanned(environment: ReadonlyMap<string, string>, label: string): boolean {
  return [...environment.keys()].every((key) => LAUNCHD_ADDED_ENVIRONMENT_KEYS.has(key)) && environment.get("XPC_SERVICE_NAME") === label;
}

/**
 * Spec §5.3 as amended by D82 (2026-10-03): `launchctl bootstrap gui/<uid> /dev/fd/3` fails with
 * error 5 on macOS 26.6.2, so a bootstrap names the plan-bound plist's absolute path. `bootstrap`
 * rechecks that the path still opens (no-follow) to the inode the reader captured, holding exactly
 * the plan bytes, and runs `launchctl bootstrap gui/<uid> <path>`. `verifyLoaded`, run immediately
 * after a successful bootstrap, re-proves the inode and bytes and requires `launchctl print` to
 * report the plan's path, program, arguments and environment for the planned label; the caller boots the label
 * out and refuses on any mismatch. Residual: a same-uid process can swap the file between the
 * recheck and launchd's own open; the post-check detects it and the bootout bounds the swapped
 * job's life to that window.
 */
export class LaunchdPathBootstrapper {
  readonly #dependencies: LaunchdBootstrapDependenciesV1;
  readonly #fs: LaunchdFileSystemV1;
  readonly #template: SupportedLaunchdProcessTableTemplateV1;

  constructor(dependencies: LaunchdBootstrapDependenciesV1) {
    this.#dependencies = dependencies;
    this.#fs = dependencies.fs ?? NODE_LAUNCHD_FILE_SYSTEM;
    this.#template = dependencies.template ?? SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE;
  }

  async bootstrap(request: LaunchdBootstrapRequestV1): Promise<LaunchdMutationEvidenceV1> {
    const bytes = this.#admitRequest(request);
    const { table } = request;
    await recheckLaunchdHost(this.#dependencies.host, table.launchctlIdentity);
    await this.#admitStaging(table);
    if (!(await this.#sourceMatches(request.source, bytes))) recovery("launchd_bootstrap_plist_changed", request.source.path);
    const [mutationProfile] = table.profiles;
    const evidence = await this.#run(table, ["bootstrap", request.domain, request.source.path], mutationProfile, request.phase);
    await this.#admitStaging(table);
    return Object.freeze({
      argvId: "bootstrap",
      source: request.source,
      process: Object.freeze({
        exitCode: evidence.exitCode,
        signal: evidence.signal,
        termination: evidence.termination,
        stdoutBytes: evidence.stdoutBytes,
        stderrBytes: evidence.stderrBytes,
        groupReaped: evidence.groupReaped,
      }),
    });
  }

  /** The post-check: the path still names the captured inode and plan bytes, and launchd loaded the plan's program. */
  async verifyLoaded(request: LaunchdBootstrapRequestV1): Promise<boolean> {
    const bytes = this.#admitRequest(request);
    if (!(await this.#sourceMatches(request.source, bytes))) return false;
    const { table } = request;
    await recheckLaunchdHost(this.#dependencies.host, table.launchctlIdentity);
    await this.#admitStaging(table);
    const target = `${request.domain}/${request.plist.Label}`;
    const chunks: Uint8Array[] = [];
    const [, queryProfile] = table.profiles;
    const evidence = await this.#run(table, ["print", target], queryProfile, request.phase, (chunk, stream) => {
      if (stream === "stdout") chunks.push(Uint8Array.from(chunk));
    });
    await this.#admitStaging(table);
    if (evidence.termination !== "exited" || evidence.exitCode !== 0 || evidence.signal !== null) return false;
    const printed = parseLaunchctlPrintedService(new TextDecoder().decode(Buffer.concat(chunks)), target);
    const planned = request.plist.ProgramArguments;
    return (
      printed !== null &&
      printed.path === request.source.path &&
      printed.program === planned[0] &&
      printed.arguments.length === planned.length &&
      printed.arguments.every((argument, index) => argument === planned[index]) &&
      environmentIsPlanned(printed.environment, request.plist.Label)
    );
  }

  async #run(
    table: SupportedLaunchdProcessTableV1,
    argv: readonly string[],
    profile: SupportedLaunchdProcessTableV1["profiles"][number],
    phase: SupervisedPhaseV1,
    sink?: (chunk: Uint8Array, stream: "stdout" | "stderr") => void,
  ): ReturnType<SupervisedProcessRunner["run"]> {
    return this.#dependencies.runner.run(
      {
        executable: table.executable.path,
        argv: [...argv],
        env: { ...table.environment },
        cwd: table.staging.home.path,
        stdin: "ignore",
        inheritedFds: [],
        stdoutCap: profile.stdoutMaxBytes,
        stderrCap: profile.stderrMaxBytes,
        idleMs: profile.idleDeadlineMs,
        wallMs: profile.wallDeadlineMs,
        terminationGraceMs: table.terminationGraceMs,
        phase,
      },
      sink,
    );
  }

  #admitRequest(request: LaunchdBootstrapRequestV1): Uint8Array {
    requireLaunchdMutationTable(request.table, this.#template);
    const uid = this.#dependencies.effectiveUid();
    if (request.domain !== launchdGuiDomain(uid as EffectiveUidV1)) refuse("launchd bootstrap domain is not the effective user's gui domain");
    parseLaunchdEffectId(request.effectId);
    parseLowerHexSha256(request.planHash);
    if (!["forward", "reverse"].includes(request.direction)) refuse("launchd bootstrap direction");
    if (!["before", "after"].includes(request.role)) refuse("launchd bootstrap role");
    if (!Number.isSafeInteger(request.transitionIndex) || request.transitionIndex < 0 || request.transitionIndex > 7) refuse("launchd bootstrap transition index");
    const source = admitSourceIdentity(request.source, uid);
    // The path is the plan's, never caller text: the one LaunchAgents leaf the planned label's job owns.
    if (!source.path.endsWith(`/Library/LaunchAgents/${launchdJob(parseGeneratedLabel(request.plist.Label).job).plistFileName}`)) {
      refuse("bootstrap plist path is not the planned label's LaunchAgents leaf");
    }
    if (request.table.staging.root.ownerUid !== uid) refuse("launchd process staging owner");
    // Retained: a compensation may restore a pre-NEW-144 plist it is undoing the replace of.
    const bytes = new TextEncoder().encode(encodeRetainedLaunchdPlist(request.plist));
    if (bytes.byteLength !== source.size || hashBytes(bytes) !== source.hash) refuse("bootstrap plist bytes are not the plan-bound identity");
    return bytes;
  }

  async #admitDirectory(identity: LaunchdProcessDirectoryIdentityV1): Promise<readonly string[]> {
    const matches = (stats: BigIntStats): boolean =>
      stats.isDirectory() &&
      stats.uid === BigInt(identity.ownerUid) &&
      (stats.mode & 0o7777n) === BigInt(PRIVATE_DIRECTORY_MODE) &&
      sameIdentity(stats, identity);
    if (!matches(await this.#fs.lstat(identity.path, { bigint: true }))) recovery("launchd_process_staging_changed", identity.path);
    const entries = [...(await this.#fs.readdir(identity.path))].sort();
    if (!matches(await this.#fs.lstat(identity.path, { bigint: true }))) recovery("launchd_process_staging_changed", identity.path);
    return entries;
  }

  /** Before and after every process: the exact two-child root and both children entry-empty. */
  async #admitStaging(table: SupportedLaunchdProcessTableV1): Promise<void> {
    const { root, home, tmp } = table.staging;
    const children = await this.#admitDirectory(root);
    if (children.length !== LAUNCHD_PROCESS_STAGING_CHILDREN.length || LAUNCHD_PROCESS_STAGING_CHILDREN.some((child, index) => children[index] !== child)) {
      recovery("launchd_process_staging_changed", root.path);
    }
    if ((await this.#admitDirectory(home)).length !== 0) recovery("launchd_process_staging_not_empty", home.path);
    if ((await this.#admitDirectory(tmp)).length !== 0) recovery("launchd_process_staging_not_empty", tmp.path);
  }

  /**
   * Re-opens the plist no-follow: the descriptor's `fstat` and the path's `lstat` must both be the
   * captured inode with the bound metadata, and the bytes read through the descriptor the plan bytes.
   */
  async #sourceMatches(source: LaunchdOpenedPlistIdentityV1, bytes: Uint8Array): Promise<boolean> {
    let handle: LaunchdFileHandleV1;
    try {
      handle = await this.#fs.open(source.path, READ_FLAGS);
    } catch {
      return false;
    }
    try {
      if (!matchesSource(await handle.stat({ bigint: true }), source)) return false;
      if (!equalBytes(await readBoundedPlist(handle), bytes)) return false;
      return matchesSource(await this.#fs.lstat(source.path, { bigint: true }), source);
    } catch {
      return false;
    } finally {
      await handle.close();
    }
  }
}
