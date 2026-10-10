import * as nodeFs from "node:fs/promises";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  encodeCanonicalJson,
  ManifestStore,
  resolveRuntimePaths,
  TransactionExecutor,
  TransactionStore,
  validateBundleManifest,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  HeldLifecycleStableLockV1,
  LifecycleLockDeadlineV1,
  LifecycleStableLockProviderV1,
  PACKAGE_CHANNEL_SOURCE_TABLE,
  RuntimePaths,
  TransactionJournalV1,
  TransactionLockHandle,
  TransactionLockProvider,
  TransactionPhase,
  TransactionFileSystem,
} from "@developer-os/core";
import type {
  AgentDiscovery,
  AgentName,
  PlatformAdapter,
  PlatformFacts,
  RenameAtxRunRequestV1,
  RenameAtxRunner,
} from "@developer-os/platform-macos";
import {
  MacOsRetainedRename,
  MacOsStableLockProvider,
  MacOsTransactionLockProvider,
} from "@developer-os/platform-macos";
import { ProtectedPathPolicy } from "@developer-os/security";
import type { ProcessResult, ProcessRunner } from "@developer-os/security";

import {
  BootstrapExecutor,
  type FreshInitDeathPointV1,
} from "../bootstrap/executor.js";
import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import type { ProbeFileSystemV1, ProbePathObservationV1 } from "../pinned-executable.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import type { BootstrapEvidenceReportV1 } from "../bootstrap/report.js";
import {
  allocatedIdOnce,
  composedContext,
  createGuards,
  NODE_FILE_SYSTEM,
  pathEnvironmentFor,
  PRODUCT_VERSION,
} from "../context.js";
import type { CliContext } from "../context.js";
import { protectedCodexHomes } from "../instructions/vendor-homes.js";
import type { CliIo } from "../io.js";
import type { LifecycleEffectPortsV1 } from "../lifecycle/adapters.js";
import { createLifecycleContext } from "../lifecycle/context.js";
import type { CliLifecycleContext } from "../lifecycle/context.js";
import { createGatedTransactionExecutor } from "../lifecycle/mutation-gate.js";
import { admitPackageChannelRelease } from "../update/packaged-release.js";
import { writePackageChannelRelease } from "../update/local-release.js";
import type { ReleaseFileV1 } from "../update/local-release.js";

const REDACTION_KEY = new Uint8Array(32).fill(11);
const PRODUCT_STATE_DIRECTORY = ".developer-os";
const PROPOSED_BRAIN_DIRECTORY = "DeveloperBrain";

/**
 * Advisory locking through `/usr/bin/lockf` is the production provider; these
 * suites exercise command behaviour, not the lock, so they use the same
 * in-process provider the transaction suites use.
 */
class InProcessLockProvider implements TransactionLockProvider {
  readonly #held = new Set<string>();

  async acquire(path: string): Promise<TransactionLockHandle> {
    if (this.#held.has(path)) {
      throw new Error("lock already held");
    }
    if (path.endsWith("/.lifecycle-bootstrap.lock") || path.endsWith("/.lifecycle.lock")) {
      await nodeFs.open(path, "a", 0o600).then((handle) => handle.close());
      await nodeFs.chmod(path, 0o600);
    }
    this.#held.add(path);
    return {
      release: (): Promise<void> => {
        this.#held.delete(path);
        return Promise.resolve();
      },
    };
  }
}

/**
 * The global mutation lock stays the real kernel-backed provider — a fixture that faked it
 * could not observe the exclusion Spec 1 §2.3 relies on — so the recorder wraps it rather
 * than replacing it, and an event is written only once the lock is actually held or released.
 */
class RecordingStableLockProvider implements LifecycleStableLockProviderV1 {
  readonly #inner: LifecycleStableLockProviderV1;
  readonly #events: string[];

  constructor(inner: LifecycleStableLockProviderV1, events: string[]) {
    this.#inner = inner;
    this.#events = events;
  }

  async acquireExisting(path: CanonicalAbsolutePathV1): Promise<HeldLifecycleStableLockV1> {
    return this.#record(await this.#inner.acquireExisting(path));
  }

  async acquireExistingWithin(
    paths: readonly CanonicalAbsolutePathV1[],
    deadline: LifecycleLockDeadlineV1,
  ): Promise<readonly HeldLifecycleStableLockV1[]> {
    const held = await this.#inner.acquireExistingWithin(paths, deadline);
    return held.map((lock) => this.#record(lock));
  }

  #record(held: HeldLifecycleStableLockV1): HeldLifecycleStableLockV1 {
    this.#events.push(`acquire ${held.path}`);
    return {
      path: held.path,
      dev: held.dev,
      ino: held.ino,
      release: async (): Promise<void> => {
        await held.release();
        this.#events.push(`release ${held.path}`);
      },
    };
  }
}

/**
 * Command fixtures exercise the coordinator rather than the Darwin syscall
 * shim. Keep the shim's descriptor/identity checks, but settle its injected
 * runner in-process so a retained table with hundreds of rows does not spawn
 * hundreds of `osascript` processes. Platform tests cover the real syscall.
 */
class InProcessRenameAtxRunner implements RenameAtxRunner {
  readonly #parents = new Map<number, string>();
  readonly requests: RenameAtxRunRequestV1[] = [];

  bind(descriptor: number, path: string): void {
    this.#parents.set(descriptor, path);
  }

  async run(request: RenameAtxRunRequestV1): Promise<{ readonly exitCode: number; readonly signal: null }> {
    this.requests.push(structuredClone(request));
    const { sourceParentDescriptor: sourceDescriptor, destinationParentDescriptor: destinationDescriptor, destinationName } = request;
    const sourceParent = this.#parents.get(sourceDescriptor);
    const destinationParent = this.#parents.get(destinationDescriptor);
    if (sourceParent === undefined || destinationParent === undefined) {
      return { exitCode: 1, signal: null };
    }
    const destinationPath = join(destinationParent, destinationName);
    try {
      await nodeFs.lstat(destinationPath, { bigint: true });
      return { exitCode: 1, signal: null };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await nodeFs.rename(join(sourceParent, request.sourceName), destinationPath);
      return { exitCode: 0, signal: null };
    } catch {
      return { exitCode: 1, signal: null };
    }
  }
}

class RecordingLockProvider implements TransactionLockProvider {
  constructor(
    private readonly delegate: TransactionLockProvider,
    private readonly events: string[],
    private readonly beforeAcquire?: (path: string) => Promise<void>,
  ) {}

  async acquire(path: string): Promise<TransactionLockHandle> {
    await this.beforeAcquire?.(path);
    const handle = await this.delegate.acquire(path);
    if (path.endsWith("/.lifecycle-bootstrap.lock") || path.endsWith("/.lifecycle.lock")) {
      this.events.push(`acquire:${path}`);
    }
    return {
      release: async (): Promise<void> => {
        await handle.release();
        if (path.endsWith("/.lifecycle-bootstrap.lock") || path.endsWith("/.lifecycle.lock")) {
          this.events.push(`release:${path}`);
        }
      },
    };
  }
}

/**
 * The per-test budget for a case that drives a real transaction against a real
 * filesystem. One constant, because the literal `300_000` was repeated at 24
 * sites across six files and `executor.test.ts` kept a private copy of it under
 * this same name; a budget that has to be corrected in 24 places is a budget
 * that gets corrected in 23.
 *
 * **Raised from 300 s to 900 s on 2026-09-07, on CI evidence that 300 s was not
 * reachable there.** `docs/architecture/foundation.md` section 9 decided in
 * 2026-09-06 not to move any timeout, reasoning that retained-evidence cases
 * finishing in 112-120 s against 300 s was "headroom, not danger". That was true
 * of this laptop and false of a hosted runner: run 34133320221 failed
 * `init.test.ts`'s "starts a distinct durable bootstrap beside an untouched
 * noncanonical pre-plan envelope" with `Test timed out in 300000ms`, and the
 * same case measures 121.21 s here in isolation. GitHub's `macos-15` runner was
 * measured at ~1.9x this machine, and section 9 separately records full-suite
 * contention pushing 112-120 s cases to 300 s, so the two multiply.
 *
 * **This budget guards against a hang; it is not a performance bound.** The
 * performance bound is NEW-53's, and nothing here should be read as accepting
 * the cost — a timeout that fires on a healthy but slow machine reports a
 * failure that is not one, which is strictly worse than useless. Lower it only
 * against a measurement taken on the slowest machine that runs it.
 */
export const REAL_FILESYSTEM_TIMEOUT_MS = 900_000;

const PROBE_UID = 501;

type PresentProbeObservation = Exclude<ProbePathObservationV1, { kind: "absent" }>;

/** A user-owned `0755` observation of `kind`, with `overrides` applied. */
export function probeObservation(
  kind: "file" | "directory",
  overrides: Partial<Omit<PresentProbeObservation, "kind">> = {},
): PresentProbeObservation {
  return {
    kind,
    ownerUid: PROBE_UID,
    mode: 0o755,
    dev: "1",
    ino: kind === "file" ? "42" : "10",
    size: 64,
    sha256: null,
    ctimeNs: "1000",
    ...overrides,
  };
}

/**
 * A synthetic host for `capture`'s version-probe admission (NEW-46): each path in `files` is a
 * user-owned `0755` regular file, every other path a user-owned `0755` directory, `table`
 * entries override either, and `links` resolve through `realpath`. The synthetic vendor paths
 * do not exist on disk, so the real host would refuse them.
 */
export function syntheticProbeHost(
  files: readonly string[] = ["/synthetic/bin/claude", "/synthetic/bin/codex"],
  links: Readonly<Record<string, string>> = {},
): ProbeFileSystemV1 & { readonly table: Map<string, ProbePathObservationV1> } {
  const table = new Map<string, ProbePathObservationV1>();
  return {
    table,
    effectiveUid: PROBE_UID,
    realpath: (path) => Promise.resolve(links[path] ?? path),
    inspect: (path) => Promise.resolve(table.get(path) ?? probeObservation(files.includes(path) ? "file" : "directory")),
  };
}

export interface FakePlatformOptions {
  readonly userHome: string;
  readonly agents?: Readonly<Record<AgentName, AgentDiscovery>>;
  readonly inspectFailure?: Error;
  /**
   * Agent discovery that refuses rather than reporting absence. The real adapter
   * does this whenever `which` returns a path it cannot vouch for — most often
   * because the redactor rewrote a long, high-entropy one.
   */
  readonly discoveryFailure?: Error;
  /**
   * Makes `assertTrustedExecutable` refuse, so a command test can drive the
   * untrusted-binary path without a real filesystem whose ownership it cannot control
   * (BACKLOG NEW-15). Absent means every discovered binary is trusted, which is what
   * every pre-existing fixture assumed before the check existed.
   */
  readonly untrustedExecutable?: Error;
}

export class FakePlatformAdapter implements PlatformAdapter {
  readonly #options: FakePlatformOptions;

  constructor(options: FakePlatformOptions) {
    this.#options = options;
  }

  inspect(): Promise<PlatformFacts> {
    if (this.#options.inspectFailure !== undefined) {
      return Promise.reject(this.#options.inspectFailure);
    }
    return Promise.resolve({
      platform: "darwin",
      architecture: "arm64",
      release: "25.5.0",
      userHome: this.#options.userHome,
    });
  }

  assertTrustedExecutable(): Promise<void> {
    return this.#options.untrustedExecutable === undefined
      ? Promise.resolve()
      : Promise.reject(this.#options.untrustedExecutable);
  }

  discoverExecutable(name: AgentName): Promise<AgentDiscovery> {
    if (this.#options.discoveryFailure !== undefined) {
      return Promise.reject(this.#options.discoveryFailure);
    }
    const configured = this.#options.agents?.[name];
    return Promise.resolve(
      configured ?? { name, installed: false, executablePath: null, version: null },
    );
  }

  productStateRoot(userHome: string): string {
    return join(userHome, PRODUCT_STATE_DIRECTORY);
  }

  proposedBrainRoot(userHome: string): string {
    return join(userHome, PROPOSED_BRAIN_DIRECTORY);
  }
}

export class RecordingIo implements CliIo {
  readonly out: string[] = [];
  readonly err: string[] = [];
  readonly questions: string[] = [];
  #answers: boolean[];

  constructor(answers: readonly boolean[] = []) {
    this.#answers = [...answers];
  }

  readonly stdout = (line: string): void => {
    this.out.push(line);
  };

  readonly stderr = (line: string): void => {
    this.err.push(line);
  };

  readonly confirm = (question: string): Promise<boolean> => {
    this.questions.push(question);
    return Promise.resolve(this.#answers.shift() ?? false);
  };

  /**
   * Nothing piped, for the same reason `confirm` declines by default: a fake
   * must not appear to have been handed input nobody supplied. A suite that
   * needs a pipe overrides this member on the context it passes, which keeps
   * the fixture from carrying a channel almost nothing uses.
   */
  readonly readStdin = (): Promise<string | null> => Promise.resolve(null);
}

export interface CommandFixture {
  readonly root: string;
  readonly userHome: string;
  readonly paths: RuntimePaths;
  readonly io: RecordingIo;
  readonly context: CliContext;
  readonly bootstrapTrace: string[];
  readonly bootstrapEvidenceInspections: number;
  readonly bootstrapEvidenceIdentities: () => Promise<readonly {
    readonly id: string;
    readonly path: string;
    readonly kind: "regular_file" | "directory";
    readonly dev: string;
    readonly ino: string;
    readonly bytes: string;
  }[]>;
  readonly bootstrapRenameRequests: readonly RenameAtxRunRequestV1[];
  readonly transactionUnlinkRequests: readonly string[];
  readonly lifecycleLockEvents: string[];
  /** `acquire <path>` / `release <path>` for the global mutation lock, in order. */
  readonly stableLockEvents: string[];
  readonly vendorProcesses: string[];
  readonly disableBootstrapInterrupt: () => void;
  readonly setBootstrapInterrupt: (point: FreshInitDeathPointV1, occurrence?: number) => void;
  readonly disableBootstrapFailure: () => void;
  readonly rebuildContext: () => CliContext;
}

export interface FixtureOptions {
  /**
   * Reuses an existing fixture's root instead of creating a fresh temporary
   * home. Test scaffolding for building a second, independent context over
   * the tree an earlier fixture already populated (e.g. a capability-absent
   * `init` observing a V2 plan a prior fixture persisted).
   */
  readonly root?: string;
  /**
   * A fake process runner. Omitted, the fixture supplies one that **rejects**,
   * so a command that spawns unexpectedly fails loudly rather than reaching a
   * real binary from a test.
   */
  readonly runner?: ProcessRunner;
  readonly answers?: readonly boolean[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly agents?: Readonly<Record<AgentName, AgentDiscovery>>;
  /** Drives the untrusted-binary path without a filesystem whose ownership a test owns. */
  readonly untrustedExecutable?: Error;
  readonly inspectFailure?: Error;
  readonly discoveryFailure?: Error;
  readonly now?: () => Date;
  /**
   * Interrupts the executor after the named phase, leaving a real journal with
   * real staged and backed-up bytes on disk. That is the only honest way to
   * produce the state `repair` exists for.
   */
  readonly interruptAfter?: TransactionPhase;
  /**
   * Narrows `interruptAfter` to one transaction kind. Without it the first
   * transaction of a run is interrupted, which is `init`'s — so a suite that
   * needs an installed product *and* an interrupted command has nothing to
   * exercise. Absent means every kind, which is what `repair`'s suite wants.
   */
  readonly interruptKind?: string;
  /**
   * Fires `interruptAfter` only once per fixture. A bootstrap Foundation
   * participant replays its phases from the planned journal on every attempt,
   * so without this the injected failure would recur on each retry.
   */
  readonly interruptOnce?: boolean;
  /** Interrupts the fresh V2 coordinator at one of its durable boundaries. */
  readonly bootstrapInterruptAfter?: FreshInitDeathPointV1;
  /** Fails the fresh V2 coordinator so tests can exercise reverse compensation. */
  readonly bootstrapFailureAfter?: FreshInitDeathPointV1;
  /** Performs a synchronous adversarial mutation at a fresh-V2 failure boundary. */
  readonly bootstrapFailureHook?: (point: FreshInitDeathPointV1) => void;
  /** Opts this fixture into the synthetic admitted fresh-V2 package handoff. */
  readonly bootstrapAvailable?: boolean;
  /**
   * With `bootstrapAvailable`, the synthetic release also carries these files under
   * `bundle/instructions/` (paths relative to it) and the repository's `workflows/**` under
   * `bundle/workflows/`. Absent, it carries neither.
   */
  readonly instructions?: readonly ReleaseFileV1[];
  /** With `bootstrapAvailable`, the synthetic release's architecture; absent, `arm64`. */
  readonly architecture?: "arm64" | "x64";
  /** Uses the real kernel-backed lifecycle lock provider for exclusion tests. */
  readonly bootstrapProductionLocks?: boolean;
  /** Inserts an adversarial namespace race immediately before lifecycle lock acquisition. */
  readonly bootstrapBeforeLockAcquire?: (path: string) => Promise<void>;
  /** Synthetic aggregate used only to exercise exact/first-over admission boundaries. */
  /** Replaces the composed Git/launchd/push ports, e.g. with a scripted Git runtime. */
  readonly effectPorts?: (context: CliLifecycleContext) => LifecycleEffectPortsV1;
  readonly bootstrapEvidenceAggregate?: {
    readonly idCount: number;
    readonly entryCount: number;
    readonly regularFileBytes: string;
  };
}

const fixtureRoots: string[] = [];
const fixtureBootstrapExecutors: BootstrapExecutor[] = [];

function digest(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const REPOSITORY_WORKFLOWS = new URL("../../../../workflows/", import.meta.url);

export async function repositoryWorkflowFiles(): Promise<readonly ReleaseFileV1[]> {
  const base = fileURLToPath(REPOSITORY_WORKFLOWS);
  const files: ReleaseFileV1[] = [];
  for (const entry of await nodeFs.readdir(base, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.push({
      relativePath: `bundle/workflows/${relative(base, path).split(sep).join("/")}`,
      bytes: await nodeFs.readFile(path),
      mode: 0o600,
    });
  }
  return files;
}

const SYNTHETIC_RELEASE_VERSION = "1.0.0";

/**
 * `bin/runtime` execs this Node binary: the verifier supervisor spawns it with an empty environment.
 * The trailing comment, never read past `exec`, makes it larger than 8 MiB like a real keg's
 * bundled Node, so every reader of a release file is exercised past the 8 MiB diff bound.
 * It deliberately stays under the 16 MiB lifecycle walls a real 122 MB Node still hits:
 * uninstall's `MAX_MUTATION_BYTES` and `LIFECYCLE_PLAN_BOUNDS.mutationContentSize`,
 * `MAXIMUM_ROLLBACK_BLOB_BYTES`, and the 64 MiB retirement cap (`MAXIMUM_ROLLBACK_DOCUMENT_BYTES`).
 * Crossing them is the open defect NEW-210; raise the padding when it is fixed.
 */
const RUNTIME_PADDING = `#${"0".repeat(8 * 1024 * 1024)}\n`;
function runtimeScript(): Uint8Array {
  return new TextEncoder().encode(`#!/bin/sh\nexec '${process.execPath}' "$@"\n${RUNTIME_PADDING}`);
}

/**
 * The real release verifier: the compiled stdio shim Task 8 bundles as `bin/verifier.mjs`, so a
 * synthetic release recomputes its digests from the snapshot like a shipped release does.
 */
function verifierScript(): Uint8Array {
  const shim = pathToFileURL(fileURLToPath(import.meta.url).replace(/\/(?:src|dist)\/commands\/[^/]+$/, "/dist/update/release-verifier-main.js")).href;
  return new TextEncoder().encode(`import(${JSON.stringify(shim)}).catch(() => {\n  process.exitCode = 3;\n});\n`);
}

/** A verifier that disagrees: a clean non-zero exit, which the coordinator compensates (exit 5). */
function rejectingVerifierScript(): Uint8Array {
  return new TextEncoder().encode("\"use strict\";\nprocess.stdin.resume();\nprocess.stdin.on(\"end\", () => {\n  process.exitCode = 1;\n});\n");
}

/**
 * A runnable `bin/runtime` and `bin/verifier` for a synthetic release, so an update or a rollback
 * onto it passes the target verifier: the update world's kegs and `init`'s first keg alike.
 */
export function runnableBundleFiles(rejecting: boolean): ReadonlyMap<string, Uint8Array> {
  return new Map([["bin/runtime", runtimeScript()], ["bin/verifier", rejecting ? rejectingVerifierScript() : verifierScript()]]);
}

async function createSyntheticPackagedRelease(
  root: string,
  instructions: readonly ReleaseFileV1[] | undefined,
  architecture: "arm64" | "x64",
) {
  // D84 K2: a Homebrew-shaped keg under `<root>/prefix`, admitted as the package channel.
  const prefix = join(root, "prefix");
  const keg = join(prefix, "Cellar", "developer-os", SYNTHETIC_RELEASE_VERSION);
  const fallback = join(keg, "libexec", "fallback");
  // A second fixture on a shared `root` admits the keg the first one installed: one prefix holds one keg.
  const installed = await nodeFs.realpath(fallback).catch(() => null);
  if (installed !== null) {
    if (instructions !== undefined) throw new Error("a shared-root fixture reuses the first keg, so it cannot carry its own instructions");
    return admitPackageChannelRelease(installed, { prefix: await nodeFs.realpath(prefix), requireVersion: null, architecture });
  }
  await nodeFs.mkdir(prefix, { mode: 0o755 });
  await nodeFs.chmod(prefix, 0o755);
  await nodeFs.mkdir(join(keg, "libexec"), { recursive: true, mode: 0o755 });
  const encode = (text: string) => new TextEncoder().encode(text);
  const bundleFiles: ReleaseFileV1[] = [
    { relativePath: "bin/cli", bytes: encode("#!/bin/sh\nexit 0\n"), mode: 0o700 },
    { relativePath: "bin/planner", bytes: encode("#!/bin/sh\nexit 0\n"), mode: 0o700 },
    // Runnable, so a rollback onto the `init`-installed release passes its verifier (F4's first rollback).
    ...[...runnableBundleFiles(false)].map(([relativePath, bytes]) => ({ relativePath, bytes, mode: 0o700 as const })),
    ...(instructions === undefined
      ? []
      : [
          ...(await repositoryWorkflowFiles()).map((file) => ({ ...file, relativePath: file.relativePath.slice("bundle/".length) })),
          ...instructions.map((file) => ({ ...file, relativePath: `instructions/${file.relativePath}` })),
        ]),
  ];
  const directories = new Set<string>();
  for (const file of bundleFiles) {
    const parts = file.relativePath.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) directories.add(parts.slice(0, depth).join("/"));
  }
  const manifest = validateBundleManifest({
    schemaVersion: 1,
    version: SYNTHETIC_RELEASE_VERSION,
    releaseSequence: "1",
    platform: "darwin",
    architecture,
    launcherProtocol: 1,
    updateProtocol: 1,
    entrypoint: "bin/cli",
    runtimeEntrypoint: "bin/runtime",
    plannerEntrypoint: "bin/planner",
    verifierEntrypoint: "bin/verifier",
    entries: [
      ...[...directories].map((path) => ({ path, kind: "directory", mode: 448 })),
      ...bundleFiles.map((file) => ({
        path: file.relativePath,
        kind: "file",
        mode: file.mode === 0o700 ? 448 : 384,
        bytes: String(file.bytes.byteLength),
        sha256: digest(file.bytes),
      })),
    ].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))),
  });
  const manifestBytes = new TextEncoder().encode(encodeCanonicalJson(manifest as unknown as CanonicalJsonValue));
  const reference = (candidate: "arm64" | "x64") => ({
    platform: "darwin",
    architecture: candidate,
    archiveFormat: "zstd-ustar-v1",
    archivePath: `${SYNTHETIC_RELEASE_VERSION}/darwin-${candidate}.tar.zst`,
    archiveBytes: "10",
    archiveSha256: digest(`archive ${candidate}`),
    manifestPath: `${SYNTHETIC_RELEASE_VERSION}/darwin-${candidate}.manifest.json`,
    manifestBytes: candidate === architecture ? String(manifestBytes.byteLength) : "11",
    manifestSha256: candidate === architecture ? digest(manifestBytes) : digest(`other ${candidate}`),
  });
  const index = {
    sequence: "1",
    latestVersion: SYNTHETIC_RELEASE_VERSION,
    releases: [{ version: SYNTHETIC_RELEASE_VERSION, releaseSequence: "1", minimumLauncherProtocol: 1, updateProtocol: 1, bundles: [reference("arm64"), reference("x64")] }],
  } as unknown as CanonicalJsonValue;
  const packageRoot = await writePackageChannelRelease({ outDir: fallback, index, manifest, bundleFiles });
  // `brew install` links the keg at `opt/developer-os`; hooks and launchd plists name Node through it (C3, NEW-204).
  await nodeFs.mkdir(join(prefix, "opt"), { mode: 0o755 });
  await nodeFs.chmod(join(prefix, "opt"), 0o755);
  await nodeFs.symlink(`../Cellar/developer-os/${SYNTHETIC_RELEASE_VERSION}`, join(prefix, "opt", "developer-os"));
  return admitPackageChannelRelease(packageRoot, { prefix: await nodeFs.realpath(prefix), requireVersion: null, architecture });
}

export async function createCommandFixture(
  label: string,
  options: FixtureOptions = {},
): Promise<CommandFixture> {
  let root: string;
  if (options.root === undefined) {
    const created = await nodeFs.mkdtemp(
      join(tmpdir(), `developer-os-cli-${label}-`),
    );
    root = await nodeFs.realpath(created);
    fixtureRoots.push(root);
  } else {
    root = options.root;
  }

  const userHome = join(root, "home");
  await nodeFs.mkdir(userHome, { recursive: true, mode: 0o700 });

  const env = options.env ?? {};
  const io = new RecordingIo(options.answers ?? []);
  const policy = new ProtectedPathPolicy(userHome, { codexHomes: protectedCodexHomes(env, userHome) });
  const guards = createGuards(policy, REDACTION_KEY);
  const paths = resolveRuntimePaths(pathEnvironmentFor({ userHome, env }));
  const packagedRelease = options.bootstrapAvailable === true
    ? await createSyntheticPackagedRelease(root, options.instructions, options.architecture ?? "arm64")
    : null;
  // C3: the K2 table over the fixture keg's prefix, whose `opt/developer-os` link the synthetic release (or `createOnDiskReleaseWorld`) creates.
  const fixtureTable = (() => {
    const entry = { prefix: join(root, "prefix"), opt: join(root, "prefix", "opt", "developer-os"), fallback: "libexec/fallback" } as const;
    return { arm64: entry, x64: entry } as unknown as typeof PACKAGE_CHANNEL_SOURCE_TABLE;
  })();
  const bootstrapTrace: string[] = [];
  const lifecycleLockEvents: string[] = [];
  const stableLockEvents: string[] = [];
  const vendorProcesses: string[] = [];
  const transactionUnlinkRequests: string[] = [];
  let transactionInterrupted = false;
  let bootstrapInterruptEnabled = true;
  let bootstrapInterruptPoint = options.bootstrapInterruptAfter;
  let bootstrapInterruptOccurrence = 1;
  let bootstrapInterruptCount = 0;
  let bootstrapFailureEnabled = true;
  let bootstrapEvidenceInspections = 0;

  const renameRunner = new InProcessRenameAtxRunner();
  const retainedRename = new MacOsRetainedRename({
    runner: renameRunner,
    openParent: async (path) => {
      const handle = await nodeFs.open(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      renameRunner.bind(handle.fd, path);
      return handle;
    },
  });

  const spawnable: ProcessRunner = options.runner ?? {
    run(): Promise<ProcessResult> {
      return Promise.reject(
        new Error("this fixture has no process runner; pass one to spawn"),
      );
    },
  };
  /**
   * Records before delegating, so "this command spawned nothing" is a claim a
   * test can fail. The default runner rejects, but `doctor` gives every check
   * its own error boundary, so a spawn there would be swallowed and an
   * unrecorded empty list would still look like proof.
   */
  const runner: ProcessRunner = {
    run(request): Promise<ProcessResult> {
      vendorProcesses.push([request.executable, ...request.args].join(" "));
      return spawnable.run(request);
    },
  };

  let sequence = 0;
  let bootstrapUuidSequence = 0;
  const now =
    options.now ??
    ((): Date => new Date(Date.UTC(2026, 6, 30, 12, 0, 0) + sequence));

  const buildContext = (): CliContext => {
    const inspectEvidence = async () => {
      bootstrapEvidenceInspections += 1;
      const admitted = await inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({
        productHome: paths.home,
        stateDirectory: paths.stateDir,
        initialRoots: [paths.home, paths.stateDir, userHome],
      }));
      return options.bootstrapEvidenceAggregate === undefined
        ? admitted
        : {
            ...admitted,
            report: {
              ...admitted.report,
              aggregate: options.bootstrapEvidenceAggregate as BootstrapEvidenceReportV1["aggregate"],
            },
          };
    };
    const lockProvider: TransactionLockProvider = new RecordingLockProvider(
      options.bootstrapProductionLocks === true
        ? new MacOsTransactionLockProvider()
        : new InProcessLockProvider(),
      lifecycleLockEvents,
      options.bootstrapBeforeLockAcquire,
    );
    const transactionFileSystem: TransactionFileSystem = {
      ...NODE_FILE_SYSTEM,
      unlink: async (path) => {
        transactionUnlinkRequests.push(String(path));
        return NODE_FILE_SYSTEM.unlink(path);
      },
    };
    const executorWith = (generateId: () => string): TransactionExecutor =>
      new TransactionExecutor({
        stateDir: paths.stateDir,
        stagingDir: paths.stagingDir,
        backupsDir: paths.backupsDir,
        fs: transactionFileSystem,
        clock: () => now().toISOString(),
        generateId,
        guards: guards.transaction,
        lockProvider,
        publishBootstrapInitialJournalNoReplace:
          retainedRename.renameNoReplace.bind(retainedRename),
        afterPhase: (
          phase: TransactionPhase,
          journal: TransactionJournalV1,
        ): void => {
          if (phase !== options.interruptAfter) return;
          if (
            options.interruptKind !== undefined &&
            journal.kind !== options.interruptKind
          ) {
            return;
          }
          if (options.interruptOnce === true && transactionInterrupted) return;
          transactionInterrupted = true;
          throw new Error(`synthetic interruption after ${phase}`);
        },
      });
    const transactionExecutor = executorWith(() => {
      sequence += 1;
      return `tx_fixture_${String(sequence).padStart(3, "0")}`;
    });
    const bootstrapExecutor = packagedRelease === null
      ? null
      : new BootstrapExecutor({
          paths,
          userHome,
          packagedRelease,
          transactionExecutor,
          lockProvider,
          renameNoReplace: retainedRename.renameNoReplace.bind(retainedRename),
          renameSameParentNoReplace: retainedRename.rename.bind(retainedRename),
          now,
          uuid: () => {
            bootstrapUuidSequence += 1;
            return `00000000-0000-4000-8000-${bootstrapUuidSequence.toString(16).padStart(12, "0")}`;
          },
          nonce: () => new Uint8Array(32).fill(17),
          trace: (event) => bootstrapTrace.push(event),
          interrupt: (point) => {
            if (
              bootstrapInterruptEnabled &&
              point === bootstrapInterruptPoint
            ) {
              bootstrapInterruptCount += 1;
              if (bootstrapInterruptCount === bootstrapInterruptOccurrence) {
                throw new Error(`synthetic bootstrap interruption at ${point}`);
              }
            }
          },
          fail: (point) => {
            if (bootstrapFailureEnabled) options.bootstrapFailureHook?.(point);
            if (bootstrapFailureEnabled && point === options.bootstrapFailureAfter) {
              throw new Error(`synthetic bootstrap failure at ${point}`);
            }
          },
          inspectEvidence,
        });
    if (bootstrapExecutor !== null) fixtureBootstrapExecutors.push(bootstrapExecutor);

    const lifecycle = createLifecycleContext({
      paths,
      renameNoReplace: retainedRename.renameNoReplace.bind(retainedRename),
      locks: new RecordingStableLockProvider(new MacOsStableLockProvider(), stableLockEvents),
      transactionLocks: lockProvider,
      effectiveUid: process.getuid?.() ?? -1,
      now,
      ...(options.effectPorts === undefined ? {} : { effectPorts: options.effectPorts }),
    });
    const composed: { current: CliContext | null } = { current: null };
    const built: CliContext = {
      io,
      env,
      userHome,
      now,
      ids: {
        next: (): string => {
          sequence += 1;
          return `tx_fixture_${String(sequence).padStart(3, "0")}`;
        },
      },
      platform: new FakePlatformAdapter({
        userHome,
        ...(options.agents === undefined ? {} : { agents: options.agents }),
        ...(options.inspectFailure === undefined
          ? {}
          : { inspectFailure: options.inspectFailure }),
        ...(options.discoveryFailure === undefined
          ? {}
          : { discoveryFailure: options.discoveryFailure }),
        ...(options.untrustedExecutable === undefined
          ? {}
          : { untrustedExecutable: options.untrustedExecutable }),
      }),
      transactions: new TransactionStore({
        stateDir: paths.stateDir,
        fs: NODE_FILE_SYSTEM,
        lockProvider,
      }),
      manifests: new ManifestStore({
        manifestFile: paths.manifestFile,
        fs: NODE_FILE_SYSTEM,
        guards: guards.manifest,
      }),
      fs: NODE_FILE_SYSTEM,
      executor: createGatedTransactionExecutor({
        context: () => composedContext(composed),
        lifecycle,
        legacy: transactionExecutor,
        allocated: (id) => executorWith(allocatedIdOnce(id)),
      }),
      guards,
      paths,
      productVersion: PRODUCT_VERSION,
      runner,
      bootstrap: bootstrapExecutor === null || packagedRelease === null
        ? { state: "unavailable_until_packaged_handoff" }
        : { state: "available", executor: bootstrapExecutor, packagedRelease, inspectEvidence },
      lifecycle,
      packageChannelTable: fixtureTable,
    };
    composed.current = built;
    return built;
  };
  const context = buildContext();

  const bootstrapEvidenceIdentities = async () => {
    const entries = await nodeFs.readdir(root, { recursive: true, withFileTypes: true });
    const result = [];
    for (const candidate of entries) {
      const path = join(candidate.parentPath, candidate.name);
      const name = candidate.name;
      const id = /(?:fresh-v2-init\.|\.fresh-v2-init\.|\.developer-os-retained\.)((?:fi|mm)_[0-9a-f-]+)/u.exec(name)?.[1];
      if (id === undefined) continue;
      const stats = await nodeFs.lstat(path, { bigint: true });
      if (!stats.isFile() && !stats.isDirectory()) continue;
      result.push({
        id,
        path,
        kind: stats.isFile() ? "regular_file" as const : "directory" as const,
        dev: stats.dev.toString(),
        ino: stats.ino.toString(),
        bytes: stats.size.toString(),
      });
    }
    return result.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  };

  return {
    root,
    userHome,
    paths,
    io,
    context,
    bootstrapTrace,
    get bootstrapEvidenceInspections() {
      return bootstrapEvidenceInspections;
    },
    bootstrapEvidenceIdentities,
    bootstrapRenameRequests: renameRunner.requests,
    transactionUnlinkRequests,
    lifecycleLockEvents,
    stableLockEvents,
    vendorProcesses,
    disableBootstrapInterrupt: () => {
      bootstrapInterruptEnabled = false;
    },
    setBootstrapInterrupt: (point, occurrence = 1) => {
      bootstrapInterruptEnabled = true;
      bootstrapInterruptPoint = point;
      bootstrapInterruptOccurrence = occurrence;
      bootstrapInterruptCount = 0;
    },
    disableBootstrapFailure: () => {
      bootstrapFailureEnabled = false;
    },
    rebuildContext: buildContext,
  };
}

/**
 * A fixture root a local Git remote's URL can live under without tripping `git_config_secret`.
 * The redactor scans runs of 40+ `[A-Za-z0-9+/=_-]` characters for entropy, and macOS's per-user
 * TMPDIR (`/var/folders/<xx>/<random>/T`) is one such run; so is `/tmp/<label>-<random>` often
 * enough to flake. The dots keep every run short. Removed by `removeCommandFixtures`.
 */
export async function createLowEntropyFixtureRoot(label: string): Promise<string> {
  if (label.length > 24) throw new Error(`fixture label too long for a low-entropy root: ${label}`);
  const root = await nodeFs.realpath(await nodeFs.mkdtemp(`/tmp/dos.${label}.`));
  fixtureRoots.push(root);
  return root;
}

export async function removeCommandFixtures(): Promise<void> {
  while (fixtureBootstrapExecutors.length > 0) {
    await fixtureBootstrapExecutors.pop()?.close();
  }
  while (fixtureRoots.length > 0) {
    const root = fixtureRoots.pop();
    if (root !== undefined) {
      await nodeFs.rm(root, { recursive: true, force: true });
    }
  }
}

export async function inventory(root: string): Promise<readonly string[]> {
  const entries = await nodeFs.readdir(root, {
    recursive: true,
    withFileTypes: true,
  });

  return entries
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .sort();
}

/**
 * `inventory` compares path names, so it answers "was anything created or
 * removed" and nothing else. A claim that bytes did not change needs this:
 * every regular file carries its digest, so an in-place rewrite that preserves
 * the name — and even the length — fails.
 */
export async function inventoryDigest(root: string): Promise<readonly string[]> {
  const entries = await nodeFs.readdir(root, { recursive: true, withFileTypes: true });
  const rows = await Promise.all(entries.map(async (entry) => {
    const absolute = join(entry.parentPath, entry.name);
    const relative = absolute.slice(root.length + 1);
    if (!entry.isFile()) return `${relative}\0${entry.isDirectory() ? "dir" : "other"}`;
    const digest = createHash("sha256").update(await nodeFs.readFile(absolute)).digest("hex");
    return `${relative}\0${digest}`;
  }));
  return rows.sort();
}

export async function retainedTombstones(root: string): Promise<readonly string[]> {
  const result: string[] = [];
  for (const relative of await inventory(root)) {
    if (relative.split("/").at(-1)?.startsWith(".developer-os-retained.")) {
      result.push(join(root, relative));
    }
  }
  return result.sort();
}

export async function firstRegularFile(paths: readonly string[]): Promise<string | null> {
  for (const path of paths) {
    if ((await nodeFs.lstat(path, { bigint: true })).isFile()) return path;
  }
  return null;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await nodeFs.lstat(path, { bigint: true });
    return true;
  } catch {
    return false;
  }
}
