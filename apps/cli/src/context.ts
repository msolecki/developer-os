import { randomBytes, randomUUID } from "node:crypto";
import fsSync from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  rename,
  rmdir,
  stat,
  unlink,
  utimes,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  containsPath,
  EXIT_CODES,
  failure,
  ManifestStore,
  redactPayload,
  resolveRuntimePaths,
  TransactionExecutor,
  TransactionStore,
} from "@developer-os/core";
import type {
  CliResult,
  DeveloperOsConfigV1,
  ExitCode,
  DriftFileSystem,
  ManifestFileSystem,
  ManifestGuards,
  PathEnvironment,
  RuntimePaths,
  TransactionFileSystem,
  TransactionGuards,
} from "@developer-os/core";
import {
  MacOsPlatformAdapter,
  MacOsTransactionLockProvider,
} from "@developer-os/platform-macos";
import type { PlatformAdapter } from "@developer-os/platform-macos";
import {
  assertSafeCommand,
  canonicalizePlannedPath,
  NodeProcessRunner,
  ProtectedPathPolicy,
  createRedactor,
  SecurityRefusalError,
} from "@developer-os/security";
import type { ProcessRunner } from "@developer-os/security";

import type { CliIo } from "./io.js";

export const PRODUCT_VERSION = "0.0.0";

export const REDACTION_KEY_BYTES = 32;

/**
 * The union of every filesystem surface Foundation's core modules require,
 * plus the two operations the commands need directly: enumerating transaction
 * journals, and removing a directory the product created. `rmdir` rather than a
 * recursive remove is deliberate — it fails on a non-empty directory, so
 * uninstall can never take user content with it.
 */
export interface CliFileSystem
  extends TransactionFileSystem,
    ManifestFileSystem,
    DriftFileSystem {
  readonly readdir: typeof readdir;
  readonly rmdir: typeof rmdir;
}

const UNSAFE_RENDER_CHARACTERS = /(?!\u200D)[\p{Cc}\p{Cf}]/gu;
const MAX_RENDERED_PATH = 512;

/**
 * Every path Developer OS renders came from a manifest, a configuration file, or
 * `PATH` — all of them attacker-writable. `isManagedPath` accepts any absolute
 * NUL-free string, so an artifact path may carry ANSI escapes and repaint the
 * confirmation prompt the user is about to answer. Nothing reaches a terminal,
 * a report, or a JSON field without passing through here.
 *
 * `\p{Cf}` is included alongside `\p{Cc}` because U+202E and the bidi isolates
 * reorder rendered text without being control characters. JSON output is
 * deliberately *not* passed through this: `JSON.stringify` escapes these to
 * `\uXXXX`, and a machine consumer needs the real bytes.
 *
 * **U+200D is exempt**, and it must stay exempt for the same reason
 * `packages/brain/src/redact.ts` exempts it: a ZERO WIDTH JOINER is part of a
 * grapheme cluster rather than an attack on one, and replacing it here turns a
 * family emoji in a note title into `\u{1F468}\uFFFD\u{1F469}\uFFFD\u{1F467}`.
 * The two layers held opposite policies for one review round and the result was
 * output *worse* than before either was written — the Brain carefully preserved
 * the joiner and this function then destroyed it. Change one of these and you
 * must change the other; `tests/e2e/brain.test.ts` crosses the seam so that a
 * future divergence fails rather than merely looking wrong.
 */
export function renderPath(value: string): string {
  const escaped = value.replace(UNSAFE_RENDER_CHARACTERS, "�");
  return escaped.length > MAX_RENDERED_PATH
    ? `${escaped.slice(0, MAX_RENDERED_PATH)}…`
    : escaped;
}

export interface CliGuards {
  readonly manifest: ManifestGuards;
  readonly transaction: TransactionGuards;
  /**
   * Reads a user-supplied text file through the protected-path policy, with
   * `O_NOFOLLOW` and a `dev`/`ino` re-check after open. Configuration is the one
   * file the CLI reads outside core's drift machinery, and it must not be the
   * one read that skips the policy.
   *
   * **The `reader` is exposed because a caller sometimes has to hash what it read.**
   * `ProtectedPathPolicy.readText` has always taken one; this guard discarded it, so the only
   * way to obtain a capture's bytes was to decode and re-encode — and that is lossy. Node's
   * `utf8` decode turns every invalid byte into U+FFFD, so a file holding one cp1252 smart
   * quote re-encodes to different bytes than it holds. A caller comparing that digest against
   * the executor's would refuse for ever. `indexes/build.ts` records the same limitation of
   * the same call.
   */
  readonly readText: (
    path: string,
    reader?: (handle: FileHandle) => Promise<string>,
  ) => Promise<string>;
  /**
   * Full canonicalization, final component included — the shape
   * `ChangePlanContext.canonicalize` requires. Deliberately *not* the same
   * function as `manifest.assertReadable`, which must leave the final
   * component unresolved.
   */
  readonly canonicalize: (path: string) => Promise<string>;
  readonly redactDiagnostic: (text: string) => string;
}

/**
 * The composition contract. The first eight members are fixed by the Foundation
 * plan; the rest are the production dependencies those eight cannot be used
 * without — a filesystem, an executor, the injected guards, and the resolved
 * paths the stores were built from. Only `bin.ts` constructs the production
 * values; every command receives them.
 */
export interface CliContext {
  readonly io: CliIo;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly userHome: string;
  readonly now: () => Date;
  readonly ids: { next: () => string };
  readonly platform: PlatformAdapter;
  readonly transactions: TransactionStore;
  readonly manifests: ManifestStore;
  readonly fs: CliFileSystem;
  readonly executor: TransactionExecutor;
  readonly guards: CliGuards;
  readonly paths: RuntimePaths;
  readonly productVersion: string;
  /**
   * Added by DOS-P4, which is the first subsystem that needs to execute a
   * process from a command rather than from the platform adapter.
   *
   * `doctor` reports a capability matrix, and both adapter architecture notes' former §5 requires a *probe* — the
   * version table alone never earns a `yes`. A probe is a process execution, so
   * without a runner here the matrix could only ever report `unknown`, which is
   * honest and useless. The real context already constructed one for
   * `MacOsPlatformAdapter`; this exposes it rather than building a second.
   *
   * Injected rather than constructed at the call site so a command's tests can
   * drive a fake, which is the discipline every other dependency here follows.
   */
  readonly runner: ProcessRunner;
}

export const NODE_FILE_SYSTEM: CliFileSystem = {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  rename,
  rmdir,
  stat,
  unlink,
  utimes,
};

/**
 * Builds the `PathEnvironment` for a run. The overrides are omitted rather than
 * set to `undefined` because `exactOptionalPropertyTypes` distinguishes the two,
 * and `resolveRuntimePaths` reads "absent" as "use the default".
 */
export function pathEnvironmentFor(context: {
  readonly userHome: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}): PathEnvironment {
  const productHome = context.env.DEVELOPER_OS_HOME;
  const brain = context.env.DEVELOPER_OS_BRAIN;

  return {
    HOME: context.userHome,
    ...(productHome === undefined ? {} : { DEVELOPER_OS_HOME: productHome }),
    ...(brain === undefined ? {} : { DEVELOPER_OS_BRAIN: brain }),
  };
}

/**
 * Re-resolves the runtime paths once the configuration is known. Only the Brain
 * can move: the product home depends on the environment alone, which is why the
 * stores can be wired before any configuration file has been read.
 */
export function runtimePathsFor(
  context: CliContext,
  config?: DeveloperOsConfigV1,
): RuntimePaths {
  return config === undefined
    ? resolveRuntimePaths(pathEnvironmentFor(context))
    : resolveRuntimePaths(pathEnvironmentFor(context), config);
}

/**
 * The anchors an owned root may resolve into: the user's home, plus any root the
 * user named explicitly this run. Task 6 left ownership open to *relocation* —
 * a root that is a symlink to an unrelated tree still passes every declared-root
 * check — and recorded that closing it needs an anchor the composition root
 * supplies. This is that anchor.
 *
 * Its reach is deliberately partial and worth stating plainly: a root supplied
 * through `DEVELOPER_OS_HOME` or `DEVELOPER_OS_BRAIN` anchors to itself, so the
 * check is inert for it. That is the point — the user named that path this run —
 * but it means the guard constrains symlink relocation of the *default* paths
 * and of `config.brainPath`, not the environment.
 */
export function ownershipAnchorsFor(context: CliContext): readonly string[] {
  const declared = [
    context.env.DEVELOPER_OS_HOME,
    context.env.DEVELOPER_OS_BRAIN,
  ].filter((value): value is string => value !== undefined);

  return [context.userHome, ...declared];
}

/**
 * Refuses an owned root that canonicalizes outside every anchor. A user-writable
 * `~/.developer-os` symlinked to `/etc` passes `validateChangePlan`'s own checks
 * — it neither widens nor nests — and would hand that tree to the change plan.
 */
export async function assertRootsAnchored(
  anchors: readonly string[],
  roots: readonly string[],
): Promise<void> {
  const canonicalAnchors = await Promise.all(
    anchors.map((anchor) => canonicalizePlannedPath(anchor)),
  );

  for (const root of roots) {
    const canonicalRoot = await canonicalizePlannedPath(root);
    const anchored = canonicalAnchors.some((anchor) =>
      containsPath(anchor, canonicalRoot),
    );
    if (!anchored) {
      throw new SecurityRefusalError(
        "Owned root resolves outside the anchored user home",
      );
    }
  }
}

/**
 * A candidate directory, canonicalized and **proven inside its container**
 * before anything is measured against it.
 *
 * **One implementation for the commands that own a directory inside the
 * vault**, because this is a containment check and this repository's own rule
 * for those is that they must not exist twice
 * (`packages/security/src/cli.ts:10-13`). It arrived as two copies of the
 * quarantine check in `ingest` and `review`, and `capture` — the command that
 * *writes* the capture — had no check at all; a third copy is how the next
 * command to be added inherits two of the three. It was `resolveQuarantineRoot`
 * until `reindex` needed the identical shape for `content/_indexes` (NEW-19):
 * same textual construction, same missing proof, a fourth caller rather than a
 * fourth copy.
 *
 * **What it catches.** Every caller builds its candidate path textually from
 * its container plus a fixed suffix — `_raw/quarantine`, `_indexes` — so a
 * directory replaced by a symbolic link carries any check measured *relative to
 * itself* along with it: `containsPath(canonicalContainer, canonicalCandidate)`
 * holds at the new location exactly as it did at the old one, and
 * `validateChangePlan`'s `ownedRoots` is satisfied by a **sideways** relocation
 * because such a root neither grows authority nor lands in `excludedRoots`.
 * Anchoring on the container is what makes the question absolute.
 * `ProtectedPathPolicy` answers a different one — it is a protected-*name*
 * policy and returns early for any path outside `$HOME`
 * (`packages/security/src/protected-paths.ts:125`).
 *
 * **`refuse` is injected** for the reason `writeIndexArtifacts` states at
 * `apps/cli/src/commands/reindex.ts:108-114`: each command raises its own refusal
 * class carrying its own exit code and recovery text, and a shared module
 * inventing a third would throw every caller an error its catch clause does not
 * recognise. **`refusalMessage` is injected too**, rather than built from a
 * `what` fragment templated by this function: `capture`, `ingest` and `review`
 * all still say "the quarantine directory resolves outside the content root",
 * and a template that had to be right for that sentence *and* `reindex`'s would
 * have to be wrong for one of them. Each caller owns its own sentence instead.
 */
export async function resolveContainedRoot(
  context: CliContext,
  containerRoot: string,
  candidate: string,
  refusalMessage: string,
  refuse: (message: string, paths: readonly string[]) => Error,
): Promise<string> {
  const canonicalContainerRoot = await context.guards.canonicalize(containerRoot);
  const canonicalCandidate = await context.guards.canonicalize(candidate);
  if (!containsPath(canonicalContainerRoot, canonicalCandidate)) {
    throw refuse(refusalMessage, [candidate]);
  }
  return canonicalCandidate;
}

/**
 * The `ManifestGuards.assertReadable` shape Task 6 specified: refuse protected
 * paths, then return the path with every ancestor canonicalized and the final
 * component preserved verbatim.
 *
 * `canonicalizePlannedPath` is applied to the *parent*, never the whole path, so
 * the leaf is never resolved — core's `lstat` check stays meaningful, and a
 * managed symlink artifact is still seen as a symlink. The policy is asked twice:
 * once about the caller's path, and once about the ancestor-canonicalized result,
 * because an intermediate component that resolves into `~/.ssh` is protected even
 * when neither the raw path nor its full realpath mentions it.
 */
export async function assertReadableArtifactPath(
  policy: ProtectedPathPolicy,
  path: string,
): Promise<string> {
  await policy.assertReadable(path);

  const parent = dirname(path);
  if (parent === path) return path;

  const resolved = join(await canonicalizePlannedPath(parent), basename(path));
  await policy.assertReadable(resolved);
  return resolved;
}

export function createManifestGuards(
  policy: ProtectedPathPolicy,
): ManifestGuards {
  return {
    assertReadable: (path: string) => assertReadableArtifactPath(policy, path),
  };
}

export function createTransactionGuards(
  policy: ProtectedPathPolicy,
  redactionKey: Uint8Array,
): TransactionGuards {
  return {
    assertTarget: async (path: string): Promise<void> => {
      await policy.assertWritable(path);
    },
    redactDiagnostic: (text: string): string =>
      /**
       * Built-in classes only: this diagnostic redactor is built before any configuration
       * is read. Each command rebinds its own guards with a config-bound redactor as soon
       * as it has both — see `guardsWith` in `capture.ts`, `review.ts` and `ingest.ts`.
       */
      createRedactor(redactionKey)(text).text,
  };
}

export function createGuards(
  policy: ProtectedPathPolicy,
  redactionKey: Uint8Array,
): CliGuards {
  const transaction = createTransactionGuards(policy, redactionKey);

  return {
    manifest: createManifestGuards(policy),
    transaction,
    readText: (
      path: string,
      reader?: (handle: FileHandle) => Promise<string>,
    ): Promise<string> => policy.readText(path, reader),
    canonicalize: canonicalizePlannedPath,
    redactDiagnostic: (text: string): string =>
      transaction.redactDiagnostic(text),
  };
}

type FailureExitCode = Exclude<ExitCode, typeof EXIT_CODES.success>;

const FAILURE_CODES = new Set<number>([
  EXIT_CODES.operationalFailure,
  EXIT_CODES.invalidInput,
  EXIT_CODES.decisionRequired,
  EXIT_CODES.capabilityUnavailable,
  EXIT_CODES.securityRefusal,
  EXIT_CODES.recoveryRequired,
]);

function isFailureExitCode(value: unknown): value is FailureExitCode {
  return typeof value === "number" && FAILURE_CODES.has(value);
}

/**
 * Every layer below the CLI raises errors carrying the exit code they claim.
 * An error without one is an operational failure — never a success and never a
 * security refusal, because guessing either direction would be wrong.
 */
export function exitCodeOf(error: unknown): FailureExitCode {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    if (isFailureExitCode(code)) return code;
  }
  return EXIT_CODES.operationalFailure;
}

function kindOf(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error";
  return name
    .replace(/Error$/u, "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .replace(/^$/u, "operational_failure");
}

/**
 * Turns a thrown error into a stable `CliResult`. **Every published field passes through the
 * redactor**: `message`, because it may quote a path, a command or file content; `data`,
 * every leaf of it; and `paths` and `recovery` beside them.
 *
 * **`paths` is the exception, and it is an open defect rather than a decision.** A secret in
 * a model-chosen note path publishes raw there while the same string redacts in `message` and
 * in `data` — one value, three renderings of one document, one of them clear. Redacting the
 * field is the obvious fix and it cannot ship: the redactor's `high-entropy` class fires on a
 * sixteen-hex capture id, so `_raw/quarantine/a1b2c3d4e5f60718.md` comes back
 * `[REDACTED:high-entropy].md` — the most important path this product publishes, destroyed,
 * and with it every absolute path under a temporary directory. Measured both ways.
 *
 * Closing it needs a redactor that applies the *pattern* classes and not the heuristic one,
 * which is the capability NEW-36 already registers as absent and out of this task's scope.
 * The row is **NEW-39**; this comment exists so the exemption is not read as considered.
 *
 * **`data` is typed `object` rather than `unknown`**, which is narrower than the field it
 * populates. `recovery` is object-proof already, so the two cannot be swapped in that
 * direction; typing `data` as `unknown` left the other direction open, and
 * `failureFrom(ctx, e, [], undefined, "run doctor")` would publish recovery text as machine
 * data. A report is an object; a string in this position is a mistake.
 */
export function failureFrom(
  context: Pick<CliContext, "guards">,
  error: unknown,
  paths: readonly string[] = [],
  recovery?: string,
  data?: object,
): CliResult<never> {
  const message = context.guards.redactDiagnostic(
    error instanceof Error ? error.message : "an unexpected failure occurred",
  );

  const redact = context.guards.redactDiagnostic;

  return failure(exitCodeOf(error), {
    kind: kindOf(error),
    message,
    paths,
    ...(recovery === undefined ? {} : { recovery: redact(recovery) }),
    ...(data === undefined
      ? {}
      : { data: redactPayload(context.guards.redactDiagnostic, data) }),
  });
}

const REDACTION_KEY_FILE = "redaction.key";

/**
 * The one path `uninstall` removes outside the manifest (spec's decision 5,
 * `BACKLOG.md` §8). Centralized so that exception stays exactly one path
 * wide: `init`, `uninstall`, and `doctor` all name the key through this
 * function rather than each spelling `"redaction.key"` again, which would
 * leave the literal free to drift out of sync with what `loadOrCreateRedactionKey`
 * actually reads and writes.
 */
export function redactionKeyPath(stateDir: string): string {
  return join(stateDir, REDACTION_KEY_FILE);
}

/**
 * `O_NOFOLLOW` because a symlink at this path is not our file. `O_NONBLOCK`
 * because `open(O_RDONLY)` on a **FIFO** blocks until a writer appears, and the
 * regular-file guard below is downstream of the open — without it, anyone who
 * can write to `stateDir` can hang every invocation of the CLI forever, with no
 * output and no diagnostic. On a regular file the flag is a no-op; on a FIFO it
 * turns an unbounded wait into an open that `isFile()` immediately refuses.
 */
const REDACTION_KEY_READ_FLAGS =
  fsSync.constants.O_RDONLY |
  fsSync.constants.O_NOFOLLOW |
  fsSync.constants.O_NONBLOCK;

/**
 * The point-of-use read: returns the durable bytes, or `null` when — and only
 * when — no file is there at all. Every other unusable state is a refusal,
 * because a file this product owns being a symlink, a FIFO, or eight bytes long
 * is a finding, not an absence.
 *
 * Tightening an over-permissive mode rather than refusing is deliberate, and
 * the asymmetry with the symlink case is the point: a secret this product owns,
 * at a mode this product got wrong, is repaired; a file that is *not ours* is
 * never touched.
 */
function readOwnRedactionKey(file: string): Uint8Array | null {
  let handle: number;
  try {
    handle = fsSync.openSync(file, REDACTION_KEY_READ_FLAGS);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ELOOP") {
      throw new SecurityRefusalError("the redaction key is a symlink");
    }
    if (code !== "ENOENT") throw error;
    return null;
  }
  try {
    const stats = fsSync.fstatSync(handle);
    if (!stats.isFile()) {
      throw new SecurityRefusalError("the redaction key is not a regular file");
    }
    const key = fsSync.readFileSync(handle);
    if (key.byteLength < REDACTION_KEY_BYTES) {
      throw new SecurityRefusalError("the redaction key is too short");
    }
    if ((stats.mode & 0o777) !== 0o600) fsSync.fchmodSync(handle, 0o600);
    return key;
  } finally {
    fsSync.closeSync(handle);
  }
}

/**
 * Writes a fresh key with `O_CREAT | O_EXCL`, so this call either creates the
 * file or discovers that another process already has. On `EEXIST` it re-reads
 * through the same guarded door — **once**. That bound matters: the first
 * implementation re-entered `loadOrCreateRedactionKey`, so a process deleting
 * the file between the two calls put this one in an unbounded create/read loop
 * rather than in an error anyone could act on.
 *
 * The write is checked and flushed before the handle closes, and a creation
 * that fails for any reason takes its own half-written file with it. A
 * truncated key is worse than no key: every later run refuses it, so a full
 * disk during the first `init` would otherwise leave a machine that no command
 * can run on.
 */
function createRedactionKey(file: string): Uint8Array {
  let handle: number;
  try {
    handle = fsSync.openSync(
      file,
      fsSync.constants.O_CREAT | fsSync.constants.O_EXCL | fsSync.constants.O_WRONLY,
      0o600,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const raced = readOwnRedactionKey(file);
    if (raced === null) {
      throw new Error(
        "the redaction key was created and removed while this run was reading it; run the command again",
      );
    }
    return raced;
  }

  const key = randomBytes(REDACTION_KEY_BYTES);
  try {
    const written = fsSync.writeSync(handle, key);
    if (written !== key.byteLength) {
      throw new Error(
        `the redaction key was only partially written (${String(written)} of ${String(key.byteLength)} bytes)`,
      );
    }
    fsSync.fsyncSync(handle);
    fsSync.closeSync(handle);
  } catch (error) {
    try {
      fsSync.closeSync(handle);
    } catch {
      /* the handle is unusable either way; the unlink below is what matters */
    }
    try {
      fsSync.unlinkSync(file);
    } catch {
      /* nothing here can improve on the failure already being thrown */
    }
    throw error;
  }
  return key;
}

/**
 * The point-of-use door, for the commands that genuinely need a durable key:
 * `init` today, and `capture`, `review` and `ingest` after Task 8. Creates when
 * absent, refuses a symlink or a non-regular file, tightens an over-permissive
 * mode.
 *
 * The product's first secret at rest, and deliberately **not** a managed
 * artifact: absent from `installation-manifest.json`, so it is never hashed into
 * a drift report and never printed by a diagnostic that enumerates manifest
 * contents (knowledge-pipeline spec §3.5, §8.4).
 *
 * Losing it makes old fingerprints incomparable, never captures unreadable —
 * content is not encrypted with it, only fingerprints are derived from it.
 */
export function loadOrCreateRedactionKey(stateDir: string): Uint8Array {
  const file = redactionKeyPath(stateDir);
  return readOwnRedactionKey(file) ?? createRedactionKey(file);
}

/**
 * The composition root's door. **Never creates, never throws, never repairs.**
 *
 * `null` for absent, unreadable, symlinked, wrong-typed or too short alike —
 * every one of which `doctor` must be able to *report*, which it cannot do if
 * building the context already threw. The first implementation of this task
 * called `loadOrCreateRedactionKey` here, and the consequences were not
 * stylistic: `doctor`, `status` and both `--dry-run` commands wrote a new
 * secret to disk merely by having a context built for them, and a symlink or a
 * truncated file at the key path failed *every* command, including the
 * diagnostic that would have reported it, with no in-product way back.
 *
 * Mode is deliberately not inspected: a repair here would be the same
 * contract violation in smaller form. `doctor` reports an over-permissive key;
 * the next command that needs a durable one tightens it.
 */
export function readRedactionKey(stateDir: string): Uint8Array | null {
  let handle: number;
  try {
    handle = fsSync.openSync(
      redactionKeyPath(stateDir),
      REDACTION_KEY_READ_FLAGS,
    );
  } catch {
    return null;
  }
  try {
    const stats = fsSync.fstatSync(handle);
    if (!stats.isFile()) return null;
    const key = fsSync.readFileSync(handle);
    return key.byteLength < REDACTION_KEY_BYTES ? null : key;
  } catch {
    return null;
  } finally {
    fsSync.closeSync(handle);
  }
}

/**
 * Emitted on `stderr` — never `stdout`, which carries `--json` — every time a
 * run falls back to an ephemeral key. Spec's binding constraint: "a missing key
 * regenerates on next use **with a warning that prior fingerprints are no
 * longer comparable**". Silence here is what makes two captures look
 * comparable when they are not.
 */
const EPHEMERAL_KEY_WARNING =
  "warning: no comparable redaction key; fingerprints from this run cannot be compared with earlier ones";

export interface ProductionContextOptions {
  readonly io: CliIo;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly userHome: string;
}

/**
 * Wires the real filesystem, lock provider, process runner, and platform
 * adapter. Nothing here inspects the host: `platform.inspect()` throws on an
 * unsupported one, and `doctor` must be able to report that as a check rather
 * than fail before dispatch.
 *
 * `paths` is resolved before the redaction key rather than after: the key is
 * persisted under `paths.stateDir` now (DOS-P6 Task 1), where it used to be a
 * per-process `randomBytes()` call that owed nothing to the filesystem.
 *
 * **`readRedactionKey`, never `loadOrCreateRedactionKey`.** A context is built
 * for every command before dispatch, so creating here would make `doctor`,
 * `status` and both `--dry-run` commands write a secret to disk. The ephemeral
 * fallback is a real key, not a stub, so diagnostics on a machine that has
 * never been initialized are still redacted — it is exactly the old
 * per-process behaviour, now scoped to the one case where nothing durable
 * exists, and announced rather than silent.
 */
export function createProductionContext(
  options: ProductionContextOptions,
): CliContext {
  const policy = new ProtectedPathPolicy(options.userHome);
  const paths = resolveRuntimePaths(pathEnvironmentFor(options));
  const durable = readRedactionKey(paths.stateDir);
  if (durable === null) options.io.stderr(EPHEMERAL_KEY_WARNING);
  const redactionKey = durable ?? randomBytes(REDACTION_KEY_BYTES);
  const guards = createGuards(policy, redactionKey);
  const lockProvider = new MacOsTransactionLockProvider();
  const runner = new NodeProcessRunner({
    assertCommand: assertSafeCommand,
    /**
     * **Built-in classes only, and deliberately so rather than by oversight.** This
     * runner redacts a child process's stdout and stderr — including a vendor model's
     * proposal on the way back into `ingest` — and it is constructed here, at the
     * composition root, *before any configuration file has been read*. The user's
     * `[redaction]` patterns are not available yet and cannot be without making the
     * runner per-command, which would bypass the fake runner every command test injects.
     *
     * **What limits the exposure**: the return leg is model output, not user content, and
     * `validateProposal`'s `secret-scan` runs the *config-bound* redactor over every
     * proposed note — so a proposal carrying a configured pattern is refused rather than
     * written. Registered as `BACKLOG.md` §1 **NEW-26**.
     */
    redact: createRedactor(redactionKey),
  });
  const now = (): Date => new Date();

  return {
    io: options.io,
    env: options.env,
    userHome: options.userHome,
    now,
    ids: { next: (): string => `tx_${randomUUID()}` },
    platform: new MacOsPlatformAdapter({ runner }),
    transactions: new TransactionStore({
      stateDir: paths.stateDir,
      fs: NODE_FILE_SYSTEM,
      lockProvider,
    }),
    manifests: new ManifestStore({
      manifestFile: paths.manifestFile,
      fs: NODE_FILE_SYSTEM,
    }),
    fs: NODE_FILE_SYSTEM,
    executor: new TransactionExecutor({
      stateDir: paths.stateDir,
      stagingDir: paths.stagingDir,
      backupsDir: paths.backupsDir,
      fs: NODE_FILE_SYSTEM,
      clock: () => now().toISOString(),
      generateId: () => `tx_${randomUUID()}`,
      guards: guards.transaction,
      lockProvider,
    }),
    guards,
    paths,
    productVersion: PRODUCT_VERSION,
    runner,
  };
}
