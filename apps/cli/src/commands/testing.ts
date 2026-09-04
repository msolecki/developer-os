import * as nodeFs from "node:fs/promises";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ManifestStore,
  resolveRuntimePaths,
  TransactionExecutor,
  TransactionStore,
} from "@developer-os/core";
import type {
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
import { MacOsRetainedRename, MacOsTransactionLockProvider } from "@developer-os/platform-macos";
import { ProtectedPathPolicy } from "@developer-os/security";
import type { ProcessResult, ProcessRunner } from "@developer-os/security";

import {
  BootstrapExecutor,
  type FreshInitDeathPointV1,
} from "../bootstrap/executor.js";
import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import type { BootstrapEvidenceReportV1 } from "../bootstrap/report.js";
import {
  createGuards,
  NODE_FILE_SYSTEM,
  pathEnvironmentFor,
  PRODUCT_VERSION,
} from "../context.js";
import type { CliContext } from "../context.js";
import type { CliIo } from "../io.js";
import {
  admitRootVerifiedPackagedRelease,
  type PackagedReleaseIdentityV1,
} from "../update/packaged-release.js";
import { BRAIN_TEMPLATE } from "./brain-template.js";
import {
  OUTPUT_SCHEMAS,
  outputSchemaFileName,
} from "./output-schemas.js";

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
    const sourceDescriptor = request.sourceParentDescriptor ?? request.parentDescriptor;
    const destinationDescriptor = request.destinationParentDescriptor ?? request.parentDescriptor;
    const destinationName = request.destinationName ?? request.tombstoneName;
    const sourceParent = this.#parents.get(sourceDescriptor);
    const destinationParent = this.#parents.get(destinationDescriptor);
    if (sourceParent === undefined || destinationParent === undefined) {
      return { exitCode: 1, signal: null };
    }
    const destinationPath = join(destinationParent, destinationName);
    try {
      await nodeFs.lstat(destinationPath);
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
  readonly vendorProcesses: string[];
  readonly disableBootstrapInterrupt: () => void;
  readonly setBootstrapInterrupt: (point: FreshInitDeathPointV1, occurrence?: number) => void;
  readonly disableBootstrapFailure: () => void;
  readonly rebuildContext: () => CliContext;
}

export interface FixtureOptions {
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
  /** Interrupts the fresh V2 coordinator at one of its durable boundaries. */
  readonly bootstrapInterruptAfter?: FreshInitDeathPointV1;
  /** Fails the fresh V2 coordinator so tests can exercise reverse compensation. */
  readonly bootstrapFailureAfter?: FreshInitDeathPointV1;
  /** Performs a synchronous adversarial mutation at a fresh-V2 failure boundary. */
  readonly bootstrapFailureHook?: (point: FreshInitDeathPointV1) => void;
  /** Opts this fixture into the synthetic admitted fresh-V2 package handoff. */
  readonly bootstrapAvailable?: boolean;
  /** Uses the real kernel-backed lifecycle lock provider for exclusion tests. */
  readonly bootstrapProductionLocks?: boolean;
  /** Inserts an adversarial namespace race immediately before lifecycle lock acquisition. */
  readonly bootstrapBeforeLockAcquire?: (path: string) => Promise<void>;
  /** Synthetic aggregate used only to exercise exact/first-over admission boundaries. */
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

async function createSyntheticPackagedRelease(root: string) {
  const packageRoot = join(root, "packaged-release");
  const retained = {
    delegation: "metadata/release-key-delegation.json",
    releaseIndex: "metadata/release-index.json",
    bundleManifest: "metadata/bundle-manifest.json",
  } as const;
  const delegationBytes = new TextEncoder().encode("synthetic delegation\n");
  const indexBytes = new TextEncoder().encode("synthetic release index\n");
  const manifestBytes = new TextEncoder().encode("synthetic bundle manifest\n");
  const files: Array<{
    readonly relativePath: string;
    readonly bytes: Uint8Array;
    readonly mode?: 0o600 | 0o700;
  }> = [
    { relativePath: retained.delegation, bytes: delegationBytes },
    { relativePath: retained.releaseIndex, bytes: indexBytes },
    { relativePath: retained.bundleManifest, bytes: manifestBytes },
    {
      relativePath: "bundle/bin/developer-os",
      bytes: new TextEncoder().encode("#!/bin/sh\nexit 0\n"),
      mode: 0o700,
    },
    ...OUTPUT_SCHEMAS.map((schema) => ({
      relativePath: `templates/schemas/${outputSchemaFileName(schema.verb)}`,
      bytes: new TextEncoder().encode(schema.content),
    })),
    ...BRAIN_TEMPLATE.map((file) => ({
      relativePath: `templates/brain/${file.path}`,
      bytes: new TextEncoder().encode(file.content),
    })),
  ];

  await nodeFs.mkdir(packageRoot, { recursive: true, mode: 0o700 });
  for (const file of files) {
    const path = join(packageRoot, file.relativePath);
    await nodeFs.mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(path, file.bytes, { mode: file.mode ?? 0o600 });
  }

  const identity: PackagedReleaseIdentityV1 = {
    version: "1.0.0",
    releaseSequence: "1",
    releaseIdentityHash: digest("synthetic release identity"),
    delegationSequence: "1",
    delegationHash: digest(delegationBytes),
    delegatedReleaseKeyId: digest("synthetic delegated release key"),
    releaseIndexSequence: "1",
    releaseIndexHash: digest(indexBytes),
    bundleManifestHash: digest(manifestBytes),
    platform: "darwin",
    architecture: "arm64",
    launcherProtocol: 1,
    updateProtocol: 1,
  };

  return admitRootVerifiedPackagedRelease({
    packageRoot: await nodeFs.realpath(packageRoot),
    retainedMetadata: retained,
    bundleRoot: "bundle",
    identity,
  });
}

export async function createCommandFixture(
  label: string,
  options: FixtureOptions = {},
): Promise<CommandFixture> {
  const created = await nodeFs.mkdtemp(
    join(tmpdir(), `developer-os-cli-${label}-`),
  );
  const root = await nodeFs.realpath(created);
  fixtureRoots.push(root);

  const userHome = join(root, "home");
  await nodeFs.mkdir(userHome, { recursive: true, mode: 0o700 });

  const env = options.env ?? {};
  const io = new RecordingIo(options.answers ?? []);
  const policy = new ProtectedPathPolicy(userHome);
  const guards = createGuards(policy, REDACTION_KEY);
  const paths = resolveRuntimePaths(pathEnvironmentFor({ userHome, env }));
  const packagedRelease = options.bootstrapAvailable === true
    ? await createSyntheticPackagedRelease(root)
    : null;
  const bootstrapTrace: string[] = [];
  const lifecycleLockEvents: string[] = [];
  const vendorProcesses: string[] = [];
  const transactionUnlinkRequests: string[] = [];
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
    const transactionExecutor = new TransactionExecutor({
      stateDir: paths.stateDir,
      stagingDir: paths.stagingDir,
      backupsDir: paths.backupsDir,
      fs: transactionFileSystem,
      clock: () => now().toISOString(),
      generateId: () => {
        sequence += 1;
        return `tx_fixture_${String(sequence).padStart(3, "0")}`;
      },
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
        throw new Error(`synthetic interruption after ${phase}`);
      },
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

    return {
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
      executor: transactionExecutor,
      guards,
      paths,
      productVersion: PRODUCT_VERSION,
      runner,
      bootstrap: bootstrapExecutor === null || packagedRelease === null
        ? { state: "unavailable_until_packaged_handoff" }
        : { state: "available", executor: bootstrapExecutor, packagedRelease, inspectEvidence },
    };
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

export async function exists(path: string): Promise<boolean> {
  try {
    await nodeFs.lstat(path);
    return true;
  } catch {
    return false;
  }
}
