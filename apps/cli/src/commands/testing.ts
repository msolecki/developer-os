import * as nodeFs from "node:fs/promises";
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
  TransactionLockHandle,
  TransactionLockProvider,
  TransactionPhase,
} from "@developer-os/core";
import type {
  AgentDiscovery,
  AgentName,
  PlatformAdapter,
  PlatformFacts,
} from "@developer-os/platform-macos";
import { ProtectedPathPolicy } from "@developer-os/security";
import type { ProcessResult, ProcessRunner } from "@developer-os/security";

import {
  createGuards,
  NODE_FILE_SYSTEM,
  pathEnvironmentFor,
  PRODUCT_VERSION,
} from "../context.js";
import type { CliContext } from "../context.js";
import type { CliIo } from "../io.js";

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

  acquire(path: string): Promise<TransactionLockHandle> {
    if (this.#held.has(path)) {
      return Promise.reject(new Error("lock already held"));
    }
    this.#held.add(path);
    return Promise.resolve({
      release: (): Promise<void> => {
        this.#held.delete(path);
        return Promise.resolve();
      },
    });
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
  readonly inspectFailure?: Error;
  readonly discoveryFailure?: Error;
  readonly now?: () => Date;
  /**
   * Interrupts the executor after the named phase, leaving a real journal with
   * real staged and backed-up bytes on disk. That is the only honest way to
   * produce the state `repair` exists for.
   */
  readonly interruptAfter?: TransactionPhase;
}

const fixtureRoots: string[] = [];

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
  const lockProvider = new InProcessLockProvider();

  const runner: ProcessRunner = options.runner ?? {
    run(): Promise<ProcessResult> {
      return Promise.reject(
        new Error("this fixture has no process runner; pass one to spawn"),
      );
    },
  };

  let sequence = 0;
  const now =
    options.now ??
    ((): Date => new Date(Date.UTC(2026, 6, 30, 12, 0, 0) + sequence));

  const context: CliContext = {
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
    }),
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
      generateId: () => {
        sequence += 1;
        return `tx_fixture_${String(sequence).padStart(3, "0")}`;
      },
      guards: guards.transaction,
      lockProvider,
      afterPhase: (phase: TransactionPhase): void => {
        if (phase === options.interruptAfter) {
          throw new Error(`synthetic interruption after ${phase}`);
        }
      },
    }),
    guards,
    paths,
    productVersion: PRODUCT_VERSION,
    runner,
  };

  return { root, userHome, paths, io, context };
}

export async function removeCommandFixtures(): Promise<void> {
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

export async function exists(path: string): Promise<boolean> {
  try {
    await nodeFs.lstat(path);
    return true;
  } catch {
    return false;
  }
}
