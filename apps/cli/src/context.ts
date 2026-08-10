import { randomBytes, randomUUID } from "node:crypto";
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
import { basename, dirname, join } from "node:path";

import {
  containsPath,
  EXIT_CODES,
  failure,
  ManifestStore,
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
  redactText,
  SecurityRefusalError,
} from "@developer-os/security";

import type { CliIo } from "./io.js";

export const PRODUCT_VERSION = "0.0.0";

const REDACTION_KEY_BYTES = 32;

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
   */
  readonly readText: (path: string) => Promise<string>;
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
      redactText(text, redactionKey).text,
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
    readText: (path: string): Promise<string> => policy.readText(path),
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
 * Turns a thrown error into a stable `CliResult`. The message passes through the
 * redactor first: it may quote a path, a command, or file content.
 */
export function failureFrom(
  context: Pick<CliContext, "guards">,
  error: unknown,
  paths: readonly string[] = [],
  recovery?: string,
): CliResult<never> {
  const message = context.guards.redactDiagnostic(
    error instanceof Error ? error.message : "an unexpected failure occurred",
  );

  return failure(exitCodeOf(error), {
    kind: kindOf(error),
    message,
    paths,
    ...(recovery === undefined ? {} : { recovery }),
  });
}

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
 */
export function createProductionContext(
  options: ProductionContextOptions,
): CliContext {
  const policy = new ProtectedPathPolicy(options.userHome);
  const redactionKey = randomBytes(REDACTION_KEY_BYTES);
  const guards = createGuards(policy, redactionKey);
  const paths = resolveRuntimePaths(pathEnvironmentFor(options));
  const lockProvider = new MacOsTransactionLockProvider();
  const runner = new NodeProcessRunner({
    assertCommand: assertSafeCommand,
    redact: (text: string) => redactText(text, redactionKey),
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
  };
}
