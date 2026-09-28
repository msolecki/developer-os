import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, unlink } from "node:fs/promises";

import {
  LAUNCHD_BOOTSTRAP_SNAPSHOT_CHILD,
  LAUNCHD_PROCESS_STAGING_CHILDREN,
  LifecycleRecoveryRequiredError,
  MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES,
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
import { encodeLaunchdPlist } from "./plist.js";
import {
  SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
  requireLaunchdMutationTable,
  type LaunchdProcessDirectoryIdentityV1,
  type SupportedLaunchdProcessTableTemplateV1,
  type SupportedLaunchdProcessTableV1,
} from "./process-table.js";
import { launchdGuiDomain } from "./registry.js";
import { LaunchdInputError, type LaunchdGuiDomainV1, type LaunchdPlistDictionaryV1 } from "./types.js";

/** Spec §5.3: the plan-bound real plist a bootstrap reads from, never inherits. */
export interface LaunchdBootstrapPlistIdentityV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly ownerUid: EffectiveUidV1;
  readonly mode: 384;
  readonly nlink: 1;
  readonly size: number;
  readonly hash: LowerHexSha256;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export type LaunchdSnapshotDirectionV1 = "forward" | "reverse";
export type LaunchdSnapshotRoleV1 = "before" | "after";

/** Spec §5.3: the one linked leaf `tmp` may hold, at the current bootstrap frontier only. */
export interface LaunchdBootstrapSnapshotCreationV1 {
  readonly effectId: LaunchdEffectIdV1;
  readonly planHash: LowerHexSha256;
  readonly direction: LaunchdSnapshotDirectionV1;
  readonly transitionIndex: number;
  readonly role: LaunchdSnapshotRoleV1;
  readonly source: LaunchdBootstrapPlistIdentityV1;
  readonly path: CanonicalAbsolutePathV1;
  readonly snapshot: {
    readonly ownerUid: EffectiveUidV1;
    readonly mode: 384;
    readonly nlink: 1;
    readonly size: number;
    readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1;
    /** `BytePrefixOf` the plan-bound canonical plist bytes selected by `role`. */
    readonly bytes: Uint8Array;
  };
}

/** Spec §5.3: the already-unlinked snapshot whose open description alone becomes child FD 3. */
export interface LaunchdBootstrapSnapshotAttemptV1 {
  readonly role: LaunchdSnapshotRoleV1;
  readonly source: LaunchdBootstrapPlistIdentityV1;
  readonly formerPath: CanonicalAbsolutePathV1;
  readonly snapshot: {
    readonly ownerUid: EffectiveUidV1;
    readonly mode: 384;
    readonly nlink: 0;
    readonly size: number;
    readonly hash: LowerHexSha256;
    readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1;
  };
  readonly inheritedFd: 3;
}

/**
 * Everything one bootstrap needs, all plan-bound. The caller (the launchd effect executor) owns
 * the frontier: its journal must already durably name this exact forward `applied` or reverse
 * `compensating` transition, and its fresh live probe must equal the directional preimage. `phase`
 * is the transition's one 30,000-ms budget, shared with the follow-up probes.
 */
export interface LaunchdSnapshotRequestV1 {
  readonly table: SupportedLaunchdProcessTableV1;
  readonly domain: LaunchdGuiDomainV1;
  readonly effectId: LaunchdEffectIdV1;
  readonly planHash: LowerHexSha256;
  readonly direction: LaunchdSnapshotDirectionV1;
  readonly transitionIndex: number;
  readonly role: LaunchdSnapshotRoleV1;
  readonly source: LaunchdBootstrapPlistIdentityV1;
  readonly plist: LaunchdPlistDictionaryV1;
  readonly phase: SupervisedPhaseV1;
}

/** Raw launchctl output is counted and discarded: no digest of it is kept (spec §5.3). */
export interface LaunchdMutationEvidenceV1 {
  readonly argvId: "bootstrap";
  readonly attempt: LaunchdBootstrapSnapshotAttemptV1;
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
export interface LaunchdSnapshotFileHandleV1 {
  readonly fd: number;
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ readonly bytesRead: number }>;
  write(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ readonly bytesWritten: number }>;
  stat(options: { readonly bigint: true }): Promise<BigIntStats>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface LaunchdSnapshotFileSystemV1 {
  lstat(path: string, options: { readonly bigint: true }): Promise<BigIntStats>;
  open(path: string, flags: number, mode?: number): Promise<LaunchdSnapshotFileHandleV1>;
  readdir(path: string): Promise<readonly string[]>;
  unlink(path: string): Promise<void>;
}

export interface LaunchdSnapshotDependenciesV1 {
  readonly runner: Pick<SupervisedProcessRunner, "run">;
  readonly fs?: LaunchdSnapshotFileSystemV1;
  /** The compiled mutation template; injected only by fixtures. */
  readonly template?: SupportedLaunchdProcessTableTemplateV1;
  effectiveUid(): number;
  readonly host: LaunchdHostObserverV1;
}

const NODE_FILE_SYSTEM: LaunchdSnapshotFileSystemV1 = {
  lstat: (path, options) => lstat(path, options),
  open: (path, flags, mode) => open(path, flags, mode),
  readdir: (path) => readdir(path),
  unlink: (path) => unlink(path),
};

const SNAPSHOT_NAME = "bootstrap-plist";
const WRITE_CHUNK_BYTES = 65_536;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
// Node opens every descriptor with O_CLOEXEC; the spawn's stdio mapping alone dup2s the snapshot
// description onto child FD 3 and clears close-on-exec for that one descriptor.
const CREATE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

interface HeldAttempt {
  readonly handle: LaunchdSnapshotFileHandleV1;
  readonly request: LaunchdSnapshotRequestV1;
}

interface FileIdentity {
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

function refuse(message: string): never {
  throw new LaunchdInputError(message);
}

function recovery(reason: string, ...paths: readonly string[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

function identityOf(stats: BigIntStats): FileIdentity {
  return { dev: parseUInt64Decimal(stats.dev.toString(10)), ino: parseUInt64Decimal(stats.ino.toString(10)) };
}

function sameIdentity(stats: BigIntStats, identity: FileIdentity): boolean {
  const observed = identityOf(stats);
  return observed.dev === identity.dev && observed.ino === identity.ino;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function isPrefix(prefix: Uint8Array, bytes: Uint8Array): boolean {
  return prefix.byteLength <= bytes.byteLength && prefix.every((byte, index) => byte === bytes[index]);
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

/** Positional reads from byte zero; reads one byte past `limit` so growth is observed, not truncated. */
async function readBounded(handle: LaunchdSnapshotFileHandleV1, limit: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(limit + 1);
  let length = 0;
  while (length < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, length, buffer.byteLength - length, length);
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  return buffer.subarray(0, length);
}

function admitSourceIdentity(source: LaunchdBootstrapPlistIdentityV1, uid: number): LaunchdBootstrapPlistIdentityV1 {
  const path = parseCanonicalAbsolutePathText(source.path);
  if (source.ownerUid !== uid) refuse("bootstrap plist: owner");
  if ((source.mode as number) !== 384 || (source.nlink as number) !== 1) refuse("bootstrap plist: mode or link count");
  if (!Number.isSafeInteger(source.size) || source.size < 1 || source.size > MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES) refuse("bootstrap plist: size");
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

function matchesSource(stats: BigIntStats, source: LaunchdBootstrapPlistIdentityV1): boolean {
  return (
    stats.isFile() &&
    stats.uid === BigInt(source.ownerUid) &&
    (stats.mode & 0o7777n) === BigInt(PRIVATE_FILE_MODE) &&
    stats.nlink === 1n &&
    stats.size === BigInt(source.size) &&
    sameIdentity(stats, source)
  );
}

function matchesLeaf(stats: BigIntStats, uid: number, nlink: bigint): boolean {
  return (
    stats.isFile() &&
    stats.uid === BigInt(uid) &&
    (stats.mode & 0o7777n) === BigInt(PRIVATE_FILE_MODE) &&
    stats.nlink === nlink &&
    stats.size <= BigInt(MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES)
  );
}

function sameCreation(left: LaunchdBootstrapSnapshotCreationV1, right: LaunchdBootstrapSnapshotCreationV1): boolean {
  const a = left.snapshot;
  const b = right.snapshot;
  return (
    left.path === right.path &&
    a.ownerUid === b.ownerUid &&
    a.size === b.size &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    equalBytes(a.bytes, b.bytes)
  );
}

function sameSource(left: LaunchdBootstrapPlistIdentityV1, right: LaunchdBootstrapPlistIdentityV1): boolean {
  return (
    left.path === right.path &&
    left.ownerUid === right.ownerUid &&
    left.size === right.size &&
    left.hash === right.hash &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

/**
 * Spec §5.3's FD-3 bootstrap. A bootstrap never names the mutable plist pathname: `prepare`
 * copies the verified plan-bound bytes into exactly `tmp/bootstrap-plist` (`O_CREAT | O_EXCL |
 * O_NOFOLLOW`, 0600), syncs, reopens and re-verifies it, unlinks it and syncs `tmp`, and keeps
 * only that unlinked open description. `bootstrap` hands it to `launchctl bootstrap gui/<uid>
 * /dev/fd/3` as the sole inherited descriptor and closes it on every return. A crash leaves at
 * most one linked prefix of the plan bytes, which `recover` completes, restarts or preserves.
 */
export class LaunchdSnapshotBootstrapper {
  readonly #dependencies: LaunchdSnapshotDependenciesV1;
  readonly #fs: LaunchdSnapshotFileSystemV1;
  readonly #template: SupportedLaunchdProcessTableTemplateV1;
  readonly #attempts = new WeakMap<LaunchdBootstrapSnapshotAttemptV1, HeldAttempt>();

  constructor(dependencies: LaunchdSnapshotDependenciesV1) {
    this.#dependencies = dependencies;
    this.#fs = dependencies.fs ?? NODE_FILE_SYSTEM;
    this.#template = dependencies.template ?? SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE;
  }

  async prepare(request: LaunchdSnapshotRequestV1): Promise<LaunchdBootstrapSnapshotAttemptV1> {
    const bytes = this.#admitRequest(request);
    return this.#create(request, bytes);
  }

  /** Derives the linked creation leaf from the frontier and the disk, or `null` when `tmp` is empty. */
  async inspect(request: LaunchdSnapshotRequestV1): Promise<LaunchdBootstrapSnapshotCreationV1 | null> {
    const bytes = this.#admitRequest(request);
    return this.#inspect(request, bytes);
  }

  /**
   * `creation` is what `inspect` derived after the crash, or `null` when it found no leaf. An
   * absent leaf (death after unlink, or before create) restarts from the unchanged frontier; an
   * empty or proper prefix is unlinked and restarted; a complete prefix resumes at sync/open
   * verification. Anything else is preserved as recovery-required.
   */
  async recover(creation: LaunchdBootstrapSnapshotCreationV1 | null, request: LaunchdSnapshotRequestV1): Promise<LaunchdBootstrapSnapshotAttemptV1> {
    const bytes = this.#admitRequest(request);
    const path = this.#leafPath(request.table);
    if (creation !== null) this.#requireFrontier(creation, request, path);
    const observed = await this.#inspect(request, bytes);
    if (observed === null) return this.#create(request, bytes);
    if (creation === null || !sameCreation(observed, creation)) recovery("launchd_snapshot_changed", path);
    const identity = { dev: observed.snapshot.dev, ino: observed.snapshot.ino };
    if (observed.snapshot.size < bytes.byteLength) {
      await this.#unlinkLeaf(request.table, identity);
      return this.#create(request, bytes);
    }
    const source = await this.#openSource(request.source, bytes);
    try {
      return await this.#complete(request, bytes, source, identity);
    } finally {
      await source.close();
    }
  }

  async bootstrap(attempt: LaunchdBootstrapSnapshotAttemptV1): Promise<LaunchdMutationEvidenceV1> {
    const held = this.#attempts.get(attempt);
    if (held === undefined) refuse("launchd bootstrap attempt is unknown or already consumed");
    this.#attempts.delete(attempt);
    const { handle, request } = held;
    const { table } = request;
    const [mutationProfile] = table.profiles;
    let outcome: LaunchdMutationEvidenceV1["process"];
    try {
      this.#requireTable(table);
      await recheckLaunchdHost(this.#dependencies.host, table.launchctlIdentity);
      await this.#admitStaging(table, false);
      const stats = await handle.stat({ bigint: true });
      if (!matchesLeaf(stats, attempt.snapshot.ownerUid, 0n) || !sameIdentity(stats, attempt.snapshot) || stats.size !== BigInt(attempt.snapshot.size)) {
        recovery("launchd_snapshot_changed", attempt.formerPath);
      }
      const evidence = await this.#dependencies.runner.run({
        executable: table.executable.path,
        argv: ["bootstrap", request.domain, "/dev/fd/3"],
        env: { ...table.environment },
        cwd: table.staging.home.path,
        stdin: "ignore",
        inheritedFds: [{ childFd: table.bootstrapPlistFd, parentFd: handle.fd }],
        stdoutCap: mutationProfile.stdoutMaxBytes,
        stderrCap: mutationProfile.stderrMaxBytes,
        idleMs: mutationProfile.idleDeadlineMs,
        wallMs: mutationProfile.wallDeadlineMs,
        terminationGraceMs: table.terminationGraceMs,
        phase: request.phase,
      });
      outcome = Object.freeze({
        exitCode: evidence.exitCode,
        signal: evidence.signal,
        termination: evidence.termination,
        stdoutBytes: evidence.stdoutBytes,
        stderrBytes: evidence.stderrBytes,
        groupReaped: evidence.groupReaped,
      });
    } finally {
      await handle.close();
    }
    await this.#admitStaging(table, false);
    return Object.freeze({ argvId: "bootstrap", attempt, process: outcome });
  }

  /** The post-observation recheck: drift of the real plist is recovery-required after intent. */
  async recheckSource(request: LaunchdSnapshotRequestV1): Promise<void> {
    const bytes = this.#admitRequest(request);
    const source = await this.#openSource(request.source, bytes);
    await source.close();
  }

  #requireTable(table: SupportedLaunchdProcessTableV1): void {
    requireLaunchdMutationTable(table, this.#template);
  }

  #admitRequest(request: LaunchdSnapshotRequestV1): Uint8Array {
    this.#requireTable(request.table);
    const uid = this.#dependencies.effectiveUid();
    if (request.domain !== launchdGuiDomain(uid as EffectiveUidV1)) refuse("launchd bootstrap domain is not the effective user's gui domain");
    parseLaunchdEffectId(request.effectId);
    parseLowerHexSha256(request.planHash);
    if (!["forward", "reverse"].includes(request.direction)) refuse("launchd bootstrap direction");
    if (!["before", "after"].includes(request.role)) refuse("launchd bootstrap role");
    if (!Number.isSafeInteger(request.transitionIndex) || request.transitionIndex < 0 || request.transitionIndex > 7) refuse("launchd bootstrap transition index");
    const source = admitSourceIdentity(request.source, uid);
    if (request.table.staging.root.ownerUid !== uid) refuse("launchd process staging owner");
    const bytes = new TextEncoder().encode(encodeLaunchdPlist(request.plist));
    if (bytes.byteLength !== source.size || hashBytes(bytes) !== source.hash) refuse("bootstrap plist bytes are not the plan-bound identity");
    return bytes;
  }

  #leafPath(table: SupportedLaunchdProcessTableV1): CanonicalAbsolutePathV1 {
    const path = parseCanonicalAbsolutePathText(`${table.staging.root.path}/${LAUNCHD_BOOTSTRAP_SNAPSHOT_CHILD}`);
    if (path !== `${table.staging.tmp.path}/${SNAPSHOT_NAME}`) refuse("launchd snapshot path");
    return path;
  }

  #requireFrontier(creation: LaunchdBootstrapSnapshotCreationV1, request: LaunchdSnapshotRequestV1, path: string): void {
    if (
      creation.effectId !== request.effectId ||
      creation.planHash !== request.planHash ||
      creation.direction !== request.direction ||
      creation.transitionIndex !== request.transitionIndex ||
      creation.role !== request.role ||
      creation.path !== path ||
      !sameSource(creation.source, request.source)
    ) {
      recovery("launchd_snapshot_outside_frontier", path);
    }
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

  /** Returns whether `tmp` holds the one creation leaf; only a recovery read may admit it. */
  async #admitStaging(table: SupportedLaunchdProcessTableV1, admitLeaf: boolean): Promise<boolean> {
    const { root, home, tmp } = table.staging;
    const children = await this.#admitDirectory(root);
    if (children.length !== LAUNCHD_PROCESS_STAGING_CHILDREN.length || LAUNCHD_PROCESS_STAGING_CHILDREN.some((child, index) => children[index] !== child)) {
      recovery("launchd_process_staging_changed", root.path);
    }
    if ((await this.#admitDirectory(home)).length !== 0) recovery("launchd_process_staging_not_empty", home.path);
    const entries = await this.#admitDirectory(tmp);
    if (entries.length === 0) return false;
    if (admitLeaf && entries.length === 1 && entries[0] === SNAPSHOT_NAME) return true;
    return recovery("launchd_process_staging_not_empty", tmp.path);
  }

  async #syncDirectory(path: string): Promise<void> {
    const directory = await this.#fs.open(path, DIRECTORY_FLAGS);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  /** Opens the real plist no-follow and proves identity and bytes; the caller closes it. */
  async #openSource(source: LaunchdBootstrapPlistIdentityV1, bytes: Uint8Array): Promise<LaunchdSnapshotFileHandleV1> {
    let handle: LaunchdSnapshotFileHandleV1;
    try {
      handle = await this.#fs.open(source.path, READ_FLAGS);
    } catch {
      return recovery("launchd_bootstrap_plist_changed", source.path);
    }
    try {
      if (!matchesSource(await handle.stat({ bigint: true }), source)) recovery("launchd_bootstrap_plist_changed", source.path);
      const content = await readBounded(handle, MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES);
      if (!equalBytes(content, bytes)) recovery("launchd_bootstrap_plist_changed", source.path);
      if (!matchesSource(await this.#fs.lstat(source.path, { bigint: true }), source)) recovery("launchd_bootstrap_plist_changed", source.path);
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async #inspect(request: LaunchdSnapshotRequestV1, bytes: Uint8Array): Promise<LaunchdBootstrapSnapshotCreationV1 | null> {
    const path = this.#leafPath(request.table);
    if (!(await this.#admitStaging(request.table, true))) return null;
    const uid = this.#dependencies.effectiveUid();
    const linked = await this.#fs.lstat(path, { bigint: true });
    if (!matchesLeaf(linked, uid, 1n)) recovery("launchd_snapshot_changed", path);
    const identity = identityOf(linked);
    const leaf = await this.#fs.open(path, READ_FLAGS);
    let content: Uint8Array;
    try {
      const opened = await leaf.stat({ bigint: true });
      if (!matchesLeaf(opened, uid, 1n) || !sameIdentity(opened, identity)) recovery("launchd_snapshot_changed", path);
      content = await readBounded(leaf, MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES);
      if (BigInt(content.byteLength) !== opened.size) recovery("launchd_snapshot_changed", path);
    } finally {
      await leaf.close();
    }
    if (!isPrefix(content, bytes)) recovery("launchd_snapshot_not_prefix", path);
    return this.#creation(request, path, uid, identity, content);
  }

  #creation(
    request: LaunchdSnapshotRequestV1,
    path: CanonicalAbsolutePathV1,
    uid: number,
    identity: FileIdentity,
    content: Uint8Array,
  ): LaunchdBootstrapSnapshotCreationV1 {
    return Object.freeze({
      effectId: request.effectId,
      planHash: request.planHash,
      direction: request.direction,
      transitionIndex: request.transitionIndex,
      role: request.role,
      source: request.source,
      path,
      snapshot: Object.freeze({
        ownerUid: uid as EffectiveUidV1,
        mode: 384,
        nlink: 1,
        size: content.byteLength,
        dev: identity.dev,
        ino: identity.ino,
        bytes: content.slice(),
      }),
    });
  }

  /** Guarded-unlinks a proper-prefix leaf by its recorded inode and syncs `tmp`. */
  async #unlinkLeaf(table: SupportedLaunchdProcessTableV1, identity: FileIdentity): Promise<void> {
    const path = this.#leafPath(table);
    const linked = await this.#fs.lstat(path, { bigint: true });
    if (!matchesLeaf(linked, this.#dependencies.effectiveUid(), 1n) || !sameIdentity(linked, identity)) recovery("launchd_snapshot_changed", path);
    await this.#fs.unlink(path);
    await this.#syncDirectory(table.staging.tmp.path);
  }

  async #create(request: LaunchdSnapshotRequestV1, bytes: Uint8Array): Promise<LaunchdBootstrapSnapshotAttemptV1> {
    const { table } = request;
    const path = this.#leafPath(table);
    await this.#admitStaging(table, false);
    const source = await this.#openSource(request.source, bytes);
    try {
      let leaf: LaunchdSnapshotFileHandleV1;
      try {
        leaf = await this.#fs.open(path, CREATE_FLAGS, PRIVATE_FILE_MODE);
      } catch (error) {
        if (isErrno(error, "EEXIST")) recovery("launchd_process_staging_not_empty", path);
        throw error;
      }
      let identity: FileIdentity;
      try {
        const created = await leaf.stat({ bigint: true });
        if (!matchesLeaf(created, this.#dependencies.effectiveUid(), 1n) || created.size !== 0n) recovery("launchd_snapshot_changed", path);
        identity = identityOf(created);
        for (let offset = 0; offset < bytes.byteLength; ) {
          const { bytesWritten } = await leaf.write(bytes, offset, Math.min(WRITE_CHUNK_BYTES, bytes.byteLength - offset), offset);
          if (bytesWritten <= 0) recovery("launchd_snapshot_write_failed", path);
          offset += bytesWritten;
        }
        await leaf.sync();
      } finally {
        await leaf.close();
      }
      return await this.#complete(request, bytes, source, identity);
    } finally {
      await source.close();
    }
  }

  /** Sync/open verification, the source recheck, unlink, and the unlinked re-hash. */
  async #complete(
    request: LaunchdSnapshotRequestV1,
    bytes: Uint8Array,
    source: LaunchdSnapshotFileHandleV1,
    identity: FileIdentity,
  ): Promise<LaunchdBootstrapSnapshotAttemptV1> {
    const { table } = request;
    const path = this.#leafPath(table);
    const uid = this.#dependencies.effectiveUid();
    const snapshot = await this.#fs.open(path, READ_FLAGS);
    try {
      const opened = await snapshot.stat({ bigint: true });
      if (!matchesLeaf(opened, uid, 1n) || !sameIdentity(opened, identity) || opened.size !== BigInt(bytes.byteLength)) {
        recovery("launchd_snapshot_changed", path);
      }
      await snapshot.sync();
      if (!equalBytes(await readBounded(snapshot, MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES), bytes)) recovery("launchd_snapshot_not_prefix", path);

      if (!matchesSource(await source.stat({ bigint: true }), request.source)) recovery("launchd_bootstrap_plist_changed", request.source.path);
      if (!matchesSource(await this.#fs.lstat(request.source.path, { bigint: true }), request.source)) {
        recovery("launchd_bootstrap_plist_changed", request.source.path);
      }

      if (!sameIdentity(await this.#fs.lstat(path, { bigint: true }), identity)) recovery("launchd_snapshot_changed", path);
      await this.#fs.unlink(path);
      await this.#syncDirectory(table.staging.tmp.path);

      const unlinked = await snapshot.stat({ bigint: true });
      if (!matchesLeaf(unlinked, uid, 0n) || !sameIdentity(unlinked, identity) || unlinked.size !== BigInt(bytes.byteLength)) {
        recovery("launchd_snapshot_changed", path);
      }
      const hash = parseLowerHexSha256(hashBytes(await readBounded(snapshot, MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES)));
      if (hash !== request.source.hash) recovery("launchd_snapshot_changed", path);
      await this.#admitStaging(table, false);

      const attempt: LaunchdBootstrapSnapshotAttemptV1 = Object.freeze({
        role: request.role,
        source: request.source,
        formerPath: path,
        snapshot: Object.freeze({
          ownerUid: uid as EffectiveUidV1,
          mode: 384,
          nlink: 0,
          size: bytes.byteLength,
          hash,
          dev: identity.dev,
          ino: identity.ino,
        }),
        inheritedFd: 3,
      });
      this.#attempts.set(attempt, { handle: snapshot, request });
      return attempt;
    } catch (error) {
      await snapshot.close();
      throw error;
    }
  }
}
