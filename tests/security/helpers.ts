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
  TransactionAfterPhase,
  TransactionLockHandle,
  TransactionLockProvider,
} from "@developer-os/core";
import {
  MacOsPlatformAdapter,
  MacOsTransactionLockProvider,
} from "@developer-os/platform-macos";
import type { AgentDiscovery, AgentName } from "@developer-os/platform-macos";
import { ProtectedPathPolicy } from "@developer-os/security";
import type {
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "@developer-os/security";

import { FakePlatformAdapter, RecordingIo } from "@developer-os/cli/dist/commands/testing.js";
import {
  createGuards,
  NODE_FILE_SYSTEM,
  pathEnvironmentFor,
  PRODUCT_VERSION,
} from "@developer-os/cli/dist/context.js";
import type { CliContext } from "@developer-os/cli/dist/context.js";
import { runCapture } from "@developer-os/cli/dist/commands/capture.js";
import { runInit } from "@developer-os/cli/dist/commands/init.js";
import { runIngest } from "@developer-os/cli/dist/commands/ingest.js";
import type { IngestOptions, IngestResultV1 } from "@developer-os/cli/dist/commands/ingest.js";
import { runReview } from "@developer-os/cli/dist/commands/review.js";
import type { CliResult } from "@developer-os/core";

/**
 * **Everything here resolves to `dist`, deliberately.** `tests/vitest.config.ts`
 * declares no source aliases, so a contract imported here comes from the same
 * compiled output the shipped binary is built from. `npm run check` runs `lint`
 * before `test`, and `lint` begins with `tsc -b`, so `dist` is fresh by the time
 * any suite starts.
 *
 * **`npx vitest run tests/security` on its own does not rebuild.** That
 * invocation tests whatever `dist` last held, which is the one thing a developer
 * running this directory in isolation will get wrong. Run `npx tsc -b` first, or
 * run `npm run check`.
 */

/**
 * Synthetic, 40 characters after the prefix, and shaped so the product's own
 * `provider-token` rule (`packages/security/src/redaction.ts`) matches it. It is
 * not a credential, has never been one, and names nothing real.
 */
export const SENTINEL = `ghp_${"S3nt1nel".repeat(5)}`;

/**
 * Synthetic paths, like every fixture here: no real vendor is ever spawned.
 * These are also **the only executables discovery ever hands back**, which is
 * what `isVersionProbe` binds to — see there.
 */
export const CLAUDE = "/synthetic/bin/claude";
const CODEX = "/synthetic/bin/codex";
const DISCOVERABLE: readonly string[] = [CLAUDE, CODEX];

const REDACTION_KEY = new Uint8Array(32).fill(11);
const PROJECT_DIRECTORY = "Sample Project";
const CAPTURE_FILE_SUFFIX = ".md";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

/**
 * Advisory locking through `/usr/bin/lockf` is the production provider. Most
 * suites here exercise command behaviour rather than the lock, so they use this
 * one; `concurrent-edit.test.ts` asks for the real one by name, because the lock
 * is the subject there.
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

/** One spawn, recorded whole: the runner is the only door to a process. */
export interface VendorCall {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * What the fake vendor writes to stdout. An object is serialized into the
 * dialect that vendor's adapter parses; a string is written verbatim.
 */
export type VendorReply = unknown;

export interface Seeded {
  readonly id: string;
  readonly path: string;
}

export interface RecordingRunner extends ProcessRunner {
  readonly calls: readonly VendorCall[];
  reply(respond: (call: VendorCall) => VendorReply): void;
  duringCall(observe: (() => Promise<void>) | null): void;
}

/**
 * Records every request and answers each vendor in its own dialect: Codex
 * streams JSONL and takes the response from the last `item.completed` whose
 * `item.type` is `agent_message`, while Claude parses stdout as one JSON
 * document. A fake that spoke one dialect to both would let a bridge that
 * confused them pass.
 *
 * **That justification describes coverage this file does not have, and saying
 * so is the point of this paragraph.** `VENDOR_ORDER` is `["claude", "codex"]`
 * and every fixture here installs both, so `selectVendor` always picks Claude
 * and **no security test has ever executed the Codex arm**. The dialect below
 * was wrong from 2026-08-17, when it was written, and stayed green for every one
 * of the four days it stood — which is how a fresh-context review found it on
 * 2026-08-20 rather than a failing test.
 * Registered as `BACKLOG.md` §1 NEW-43.
 *
 * A `--version` probe is answered with a version string rather than a proposal,
 * because that is what the command asking for one parses.
 */
export function createRecordingRunner(): RecordingRunner {
  const calls: VendorCall[] = [];
  let respond: (call: VendorCall) => VendorReply = () => ({
    schemaVersion: 1,
    notes: [],
  });
  let observe: (() => Promise<void>) | null = null;

  return {
    calls,
    reply: (next): void => {
      respond = next;
    },
    duringCall: (next): void => {
      observe = next;
    },
    run: async (request: ProcessRequest): Promise<ProcessResult> => {
      const call: VendorCall = {
        executable: request.executable,
        args: [...request.args],
        cwd: request.cwd,
        env: { ...request.env },
      };
      calls.push(call);

      if (isVersionProbe(call)) {
        return {
          stdout: "1.2.3 (synthetic)\n",
          stderr: "",
          exitCode: 0,
          signal: null,
          timedOut: false,
        };
      }
      if (isDiscoveryProbe(call)) {
        const name = call.args[0] ?? "";
        return {
          stdout: name === "codex" ? `${CODEX}\n` : `${CLAUDE}\n`,
          stderr: "",
          exitCode: 0,
          signal: null,
          timedOut: false,
        };
      }

      const hook = observe;
      if (hook !== null) await hook();

      const reply = respond(call);
      if (typeof reply === "string") {
        return { stdout: reply, stderr: "", exitCode: 0, signal: null, timedOut: false };
      }
      const document = JSON.stringify(reply);
      const stdout =
        call.executable === CODEX
          ? [
              JSON.stringify({ type: "thread.started" }),
              JSON.stringify({ type: "item.started" }),
              JSON.stringify({
                type: "item.completed",
                item: { id: "item_0", type: "agent_message", text: document },
              }),
              JSON.stringify({
                type: "turn.completed",
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
              "",
            ].join("\n")
          : document;
      return { stdout, stderr: "", exitCode: 0, signal: null, timedOut: false };
    },
  };
}

/** `/usr/bin/which <name>`: the platform adapter locating a vendor binary. */
function isDiscoveryProbe(call: VendorCall): boolean {
  return call.executable === "/usr/bin/which";
}

/**
 * `<exe> --version`: `discoverCli` reading a version and nothing else.
 *
 * **Bound to an executable discovery actually hands back**, not to the argument
 * alone. A classifier that accepted any binary invoked with a lone `--version`
 * would grade a spawn of something the product had no business discovering as
 * local — which, in a suite whose whole job is deciding which spawns are
 * legitimate, is the filter passing by filtering everything.
 */
export function isVersionProbe(call: VendorCall): boolean {
  return (
    call.args.length === 1 &&
    call.args[0] === "--version" &&
    DISCOVERABLE.includes(call.executable)
  );
}

export function isDiscoveryOrVersionProbe(call: VendorCall): boolean {
  return isDiscoveryProbe(call) || isVersionProbe(call);
}

function discovery(
  name: AgentName,
  executable: string | null,
): AgentDiscovery {
  return {
    name,
    installed: executable !== null,
    executablePath: executable,
    version: null,
  };
}

export interface SecurityFixtureOptions {
  /**
   * `"real"` builds a `MacOsPlatformAdapter` over the recording runner, so
   * `/usr/bin/which` becomes a request this suite can see. `"fake"` answers
   * discovery from a table and spawns nothing, which is what every suite that is
   * not about spawning wants.
   */
  readonly platform?: "fake" | "real";
  readonly claude?: boolean;
  readonly codex?: boolean;
  readonly afterPhase?: TransactionAfterPhase;
  /** `"macos"` is `/usr/bin/lockf`, the production provider. */
  readonly lock?: "in-process" | "macos";
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly runner?: RecordingRunner;
}

export interface SecurityFixture {
  readonly root: string;
  readonly userHome: string;
  readonly paths: RuntimePaths;
  readonly io: RecordingIo;
  readonly context: CliContext;
  readonly runner: RecordingRunner;
  readonly project: string;
}

const fixtureRoots: string[] = [];

/**
 * A `CliContext` this suite can interrupt.
 *
 * Duplicated from `apps/cli/src/commands/testing.ts` rather than imported
 * because that fixture's `afterPhase` is fixed — it throws after a named phase —
 * and three suites here need one that *waits*, *writes*, or *observes* instead.
 * The rest of the wiring is the same on purpose, so a suite here and a unit
 * suite there disagree about nothing but the hook.
 */
export async function createSecurityFixture(
  label: string,
  options: SecurityFixtureOptions = {},
): Promise<SecurityFixture> {
  const created = await nodeFs.mkdtemp(join(tmpdir(), `dos-security-${label}-`));
  const root = await nodeFs.realpath(created);
  fixtureRoots.push(root);

  const userHome = join(root, "home");
  await nodeFs.mkdir(userHome, { recursive: true, mode: 0o700 });
  const project = join(root, PROJECT_DIRECTORY);
  await nodeFs.mkdir(project, { recursive: true, mode: 0o700 });

  const env = options.env ?? {};
  const io = new RecordingIo([]);
  const policy = new ProtectedPathPolicy(userHome);
  const guards = createGuards(policy, REDACTION_KEY);
  const paths = resolveRuntimePaths(pathEnvironmentFor({ userHome, env }));
  const lockProvider =
    options.lock === "macos"
      ? new MacOsTransactionLockProvider()
      : new InProcessLockProvider();
  const runner = options.runner ?? createRecordingRunner();

  /**
   * Read by the fake adapter only. Under `platform: "real"` discovery goes
   * through `/usr/bin/which` and the recording runner answers it, so `claude`
   * and `codex` are decided there rather than here.
   */
  const agents = {
    claude: discovery("claude", options.claude === false ? null : CLAUDE),
    codex: discovery("codex", options.codex === false ? null : CODEX),
  } as const;

  const platform =
    options.platform === "real"
      ? new MacOsPlatformAdapter({
          runner,
          environment: {
            platform: "darwin",
            architecture: "arm64",
            release: "25.5.0",
            userHome,
          },
          searchPath: join(root, "bin"),
          canonicalize: (path: string) => Promise.resolve(path),
          /**
           * **The synthetic executables do not exist on disk**, so the real `stat` would
           * make `assertTrustedExecutable` refuse them — correctly, since it fails closed
           * on an ancestor it cannot inspect (BACKLOG NEW-15). These suites are about what
           * reaches a network and what a command writes, not about trust, so ownership is
           * faked on exactly the terms `canonicalize` already is: a user-owned, non-writable
           * chain.
           *
           * `apps/cli/src/commands/*.test.ts` is where the refusal path is driven, through
           * `FakePlatformAdapter`'s `untrustedExecutable`.
           */
          stat: () =>
            /** `S_IFREG` included: the guard checks the file type, not only the bits. */
            Promise.resolve({ uid: process.getuid?.() ?? 0, mode: 0o100755 }),
        })
      : new FakePlatformAdapter({ userHome, agents });

  let sequence = 0;
  const now = (): Date => new Date(Date.UTC(2026, 6, 30, 12, 0, 0) + sequence);
  const nextId = (): string => {
    sequence += 1;
    return `tx_security_${String(sequence).padStart(3, "0")}`;
  };

  const context: CliContext = {
    io,
    env,
    userHome,
    now,
    ids: { next: nextId },
    platform,
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
      generateId: nextId,
      guards: guards.transaction,
      lockProvider,
      ...(options.afterPhase === undefined ? {} : { afterPhase: options.afterPhase }),
    }),
    guards,
    paths,
    productVersion: PRODUCT_VERSION,
    runner,
  };

  return { root, userHome, paths, io, context, runner, project };
}

/**
 * A second `CliContext` over the same installation, with its own transaction
 * store, executor and lock handle. This is the second `developer-os` process in
 * the concurrency cases: it shares the disk and shares nothing else.
 */
export function deriveSecondContext(
  fixture: SecurityFixture,
  options: { readonly lock?: "in-process" | "macos" } = {},
): CliContext {
  const policy = new ProtectedPathPolicy(fixture.userHome);
  const guards = createGuards(policy, REDACTION_KEY);
  const lockProvider =
    options.lock === "macos"
      ? new MacOsTransactionLockProvider()
      : new InProcessLockProvider();
  const { paths } = fixture;

  let sequence = 0;
  const now = (): Date => new Date(Date.UTC(2026, 6, 30, 13, 0, 0) + sequence);
  const nextId = (): string => {
    sequence += 1;
    return `tx_second_${String(sequence).padStart(3, "0")}`;
  };

  return {
    ...fixture.context,
    io: new RecordingIo([]),
    now,
    ids: { next: nextId },
    transactions: new TransactionStore({
      stateDir: paths.stateDir,
      fs: NODE_FILE_SYSTEM,
      lockProvider,
    }),
    executor: new TransactionExecutor({
      stateDir: paths.stateDir,
      stagingDir: paths.stagingDir,
      backupsDir: paths.backupsDir,
      fs: NODE_FILE_SYSTEM,
      clock: () => now().toISOString(),
      generateId: nextId,
      guards: guards.transaction,
      lockProvider,
    }),
    guards,
  };
}

export async function removeSecurityFixtures(): Promise<void> {
  while (fixtureRoots.length > 0) {
    const root = fixtureRoots.pop();
    if (root !== undefined) {
      await nodeFs.rm(root, { recursive: true, force: true });
    }
  }
}

export interface InstalledFixture extends SecurityFixture {
  readonly quarantine: string;
  readonly content: string;
  capture(text: string): Promise<Seeded>;
  accept(id: string): Promise<void>;
  seedAccepted(text: string): Promise<Seeded>;
  statusOf(id: string): Promise<string>;
  captureText(id: string): Promise<string>;
  ingest(options?: IngestOptions): Promise<CliResult<IngestResultV1>>;
}

/**
 * A real installation, produced by the real `init`, holding real captures
 * written by the real `capture`. The only fake is the vendor process, which is
 * **scripted rather than spawned**.
 */
export async function installSecurityFixture(
  label: string,
  options: SecurityFixtureOptions = {},
): Promise<InstalledFixture> {
  const fixture = await createSecurityFixture(label, options);

  const installed = await runInit(fixture.context, ACCEPTED);
  if (!installed.ok) {
    throw new Error(`the fixture must install before it captures: ${installed.error.message}`);
  }
  /** `init` verifies the installation; only what the suite drives is at issue. */
  clearCalls(fixture.runner);

  /**
   * The default `contentRoot`. No suite here overrides it: the per-install
   * resolution is `ingest.test.ts`'s subject, and a second copy of that fixture
   * would be a second place for it to drift.
   */
  const content = join(fixture.paths.brain, "content");
  const quarantine = join(content, "_raw", "quarantine");

  const captureText = (id: string): Promise<string> =>
    nodeFs.readFile(join(quarantine, `${id}${CAPTURE_FILE_SUFFIX}`), "utf8");

  const capture = async (text: string): Promise<Seeded> => {
    const captured = await runCapture(
      fixture.context,
      { text },
      { cwd: () => fixture.project, detect: () => "unknown" },
    );
    if (!captured.ok) {
      throw new Error(`the fixture could not capture: ${captured.error.message}`);
    }
    return { id: captured.data.captureId, path: captured.data.path };
  };

  const accept = async (id: string): Promise<void> => {
    const accepted = await runReview(fixture.context, { id, decision: "accept" });
    if (!accepted.ok) {
      throw new Error(`the fixture could not accept ${id}: ${accepted.error.message}`);
    }
  };

  return {
    ...fixture,
    quarantine,
    content,
    capture,
    accept,
    captureText,
    seedAccepted: async (text: string): Promise<Seeded> => {
      const seeded = await capture(text);
      await accept(seeded.id);
      return seeded;
    },
    statusOf: async (id: string): Promise<string> => statusOfText(await captureText(id)),
    ingest: (ingestOptions: IngestOptions = {}) =>
      runIngest(fixture.context, ingestOptions),
  };
}

/**
 * The status line as it stands in the file, read with a regular expression
 * rather than through `parseCaptureFile`.
 *
 * Deliberate: this suite asserts what is on disk, and a parser that re-derives
 * fields on the way in is the thing under test on several of these paths, not a
 * neutral instrument for reading it.
 */
export function statusOfText(text: string): string {
  return /^status:\s*(\S+)\s*$/mu.exec(text)?.[1] ?? "unreadable";
}

export function clearCalls(runner: RecordingRunner): void {
  (runner.calls as VendorCall[]).length = 0;
}

function isMissingEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

/** Absolute paths of every regular file beneath `root`, sorted by code point. */
export async function filesUnder(root: string): Promise<readonly string[]> {
  let entries;
  try {
    entries = await nodeFs.readdir(root, { recursive: true, withFileTypes: true });
  } catch (error) {
    /**
     * An absent directory is an empty one; **anything else is raised**. A helper
     * that answered `[]` for "could not look" would make every
     * `toStrictEqual([])` below vacuous on a permission error — the failure mode
     * this whole directory exists to refuse, in its own instrument.
     */
    if (!isMissingEntry(error)) throw error;
    return [];
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

/**
 * Every byte of every regular file beneath `root`, one entry per file.
 *
 * `latin1` rather than `utf8`: it maps every byte to a character without loss,
 * so an ASCII marker is still found inside a file that is not valid UTF-8. A
 * sentinel scan that silently skipped binary output would be worse than none.
 */
export async function readFilesUnder(root: string): Promise<readonly string[]> {
  const files = await filesUnder(root);
  return Promise.all(files.map((path) => nodeFs.readFile(path, "latin1")));
}

/** A `create`-shaped proposed note, with valid frontmatter for its stage. */
function proposedNote(
  captureId: string,
  path: string,
  title = "Proposed note",
  body = "A note the security fixture proposes.",
): unknown {
  return {
    path,
    contents: [
      "---",
      "schemaVersion: 1",
      `title: ${title}`,
      "type: knowledge-note",
      "created: 2026-07-30",
      "tags: [dev]",
      `summary: ${title} is what this note records.`,
      "stage: emerging",
      "author: agent",
      "reviewed: null",
      "---",
      "",
      body,
      "",
    ].join("\n"),
    sourceCaptureId: captureId,
  };
}

export function oneNote(
  captureId: string,
  path = "DEV/proposed-note.md",
  title = "Proposed note",
  body = "A note the security fixture proposes.",
): VendorReply {
  return {
    schemaVersion: 1,
    notes: [proposedNote(captureId, path, title, body)],
  };
}

export function nothingProposed(): VendorReply {
  return { schemaVersion: 1, notes: [] };
}
