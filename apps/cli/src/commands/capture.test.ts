import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { detectSourceAgent } from "@developer-os/brain";
import type {
  AgentDiscovery,
  AgentName,
  PlatformAdapter,
} from "@developer-os/platform-macos";
import { redactText } from "@developer-os/security";
import type { ProcessResult, ProcessRunner } from "@developer-os/security";

import { afterEach, describe, expect, it } from "vitest";

import { discoverSourceAgent, runCapture } from "./capture.js";
import { runInit } from "./init.js";
import { createCommandFixture, removeCommandFixtures } from "./testing.js";
import type { CommandFixture } from "./testing.js";
import { loadOrCreateRedactionKey } from "../context.js";
import type { CliContext } from "../context.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

/** Synthetic, like every fixture here: no real client, project or repository. */
const PROJECT_DIRECTORY = "Sample Project";
const OBSERVATION = "an observation";
const SECRET = `ghp_${"a".repeat(36)}`;

interface CaptureFixture extends CommandFixture {
  /** The working directory a capture is taken from; the slug comes from it. */
  readonly project: string;
  run(
    context: CliContext,
    options: { readonly text?: string },
    /** Overrides the real detection table, for a vendor that has no row in it. */
    detect?: (env: Readonly<Record<string, string | undefined>>) => string,
  ): ReturnType<typeof runCapture>;
}

interface InstalledFixtureOptions {
  readonly fixture?: Parameters<typeof createCommandFixture>[1];
  /** The working directory's basename, and therefore the project slug. */
  readonly projectDirectory?: string;
}

/**
 * A real installation, produced by the real `init`: the capture path has to be
 * the one a user gets, and a hand-built vault would let a missing template
 * directory pass unnoticed here and fail on a real machine.
 */
async function installedFixture(
  label: string,
  options: InstalledFixtureOptions = {},
): Promise<CaptureFixture> {
  const fixture = await createCommandFixture(label, options.fixture ?? {});
  const installed = await runInit(fixture.context, ACCEPTED);
  expect(installed.ok, "the fixture must install before it captures").toBe(true);

  const project = join(
    fixture.root,
    options.projectDirectory ?? PROJECT_DIRECTORY,
  );
  await nodeFs.mkdir(project, { recursive: true, mode: 0o700 });

  return {
    ...fixture,
    project,
    run: (context, captureOptions, detect = detectSourceAgent) =>
      runCapture(context, captureOptions, { cwd: () => project, detect }),
  };
}

function quarantineDirectory(fixture: CommandFixture): string {
  return join(fixture.paths.brain, "content", "_raw", "quarantine");
}

/**
 * The capture transactions this run produced, read back from the journals the
 * executor actually wrote. Counting real journals — rather than a spy on a fake
 * executor — is what makes "through a transaction, not a bare write" an
 * observation instead of a restatement of the call the test just made.
 */
async function captureTransactions(
  fixture: CommandFixture,
): Promise<readonly { readonly id: string; readonly phase: string }[]> {
  const journalDir = join(fixture.paths.stateDir, "transactions");
  let entries: readonly string[];
  try {
    entries = await nodeFs.readdir(journalDir);
  } catch {
    return [];
  }

  const journals: { readonly id: string; readonly phase: string }[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const journal = await fixture.context.transactions.read(
      entry.slice(0, -".json".length),
    );
    if (journal.kind === "capture") {
      journals.push({ id: journal.id, phase: journal.phase });
    }
  }
  return journals;
}

/** Every byte this run left anywhere under the fixture root, concatenated. */
async function readEverythingWritten(fixture: CommandFixture): Promise<string> {
  const entries = await nodeFs.readdir(fixture.root, {
    recursive: true,
    withFileTypes: true,
  });

  const files = entries.filter((entry) => entry.isFile());
  expect(files.length, "a sweep over nothing is not a sweep").toBeGreaterThan(0);

  const contents = await Promise.all(
    files.map((entry) =>
      nodeFs.readFile(join(entry.parentPath, entry.name), "latin1"),
    ),
  );
  return contents.join("\n");
}

function stdinIo(
  fixture: CaptureFixture,
  readStdin: () => Promise<string | null>,
): CliContext {
  return { ...fixture.context, io: { ...fixture.context.io, readStdin } };
}

/**
 * A machine with Claude Code on it. The tests that assert *no* spawn need this:
 * with nothing installed, "no spawn" holds for a second reason that has nothing
 * to do with the detection table, and the assertion would stay green against an
 * implementation that probes whenever detection matches.
 */
const CLAUDE_INSTALLED: Readonly<Record<AgentName, AgentDiscovery>> = {
  claude: {
    name: "claude",
    installed: true,
    executablePath: "/synthetic/bin/claude",
    version: null,
  },
  codex: { name: "codex", installed: false, executablePath: null, version: null },
};

/**
 * Records which agents were asked about, so "asks nothing at all" is an
 * observation rather than a restatement of the fake's default answer. A wrapper
 * rather than a spread: `FakePlatformAdapter`'s methods live on its prototype,
 * which a spread would drop.
 */
function countingPlatform(
  inner: PlatformAdapter,
  asked: string[],
): PlatformAdapter {
  return {
    inspect: () => inner.inspect(),
    discoverExecutable: (name: AgentName): Promise<AgentDiscovery> => {
      asked.push(name);
      return inner.discoverExecutable(name);
    },
    productStateRoot: (userHome: string) => inner.productStateRoot(userHome),
    proposedBrainRoot: (userHome: string) => inner.proposedBrainRoot(userHome),
  };
}

function runnerReturning(stdout: string): ProcessRunner {
  return {
    run: (): Promise<ProcessResult> =>
      Promise.resolve({
        stdout,
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
      }),
  };
}

/** Rewrites a capture's status the way `review` will, without a review command. */
async function setStatus(path: string, status: string): Promise<void> {
  const before = await nodeFs.readFile(path, "utf8");
  const after = before.replace("status: quarantined\n", `status: ${status}\n`);
  expect(after, "the seeded status must actually change").not.toBe(before);
  await nodeFs.writeFile(path, after, { mode: 0o600 });
}

describe("runCapture", () => {
  it("writes one quarantine file through a transaction, not a bare write", async () => {
    const fixture = await installedFixture("capture-write");

    const result = await fixture.run(fixture.context, { text: OBSERVATION });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.path).toMatch(
      /content\/_raw\/quarantine\/[0-9a-f]{16}\.md$/u,
    );
    expect(result.data.duplicate).toBe(false);
    expect(result.data.status).toBe("quarantined");
    const transactions = await captureTransactions(fixture);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.phase).toBe("finalized");
    expect(await nodeFs.readFile(result.data.path, "utf8")).toContain(
      `captureId: ${result.data.captureId}`,
    );
  });

  /**
   * **The path this command reports is the path the user configured**, not the
   * one the filesystem resolves it to.
   *
   * A vault reached through a symlink is ordinary — a synced folder, a second
   * volume — and on such an install a canonicalized `path` would print and
   * publish a location the user never wrote in `config.toml`, in `--json` as
   * well as on the terminal. The quarantine root **is** canonicalized, for the
   * containment question that has to be asked of the destination; what must not
   * follow from that is the canonical form leaking into the contract, or into
   * `validateChangePlan`'s `ownedRoots`, where a pre-resolved root makes its
   * grew-authority test compare a string against itself.
   */
  it("reports the configured path, not the one a symlinked content root resolves to", async () => {
    const fixture = await installedFixture("capture-path-shape");
    const content = join(fixture.paths.brain, "content");
    const real = join(fixture.paths.brain, "real-content");
    await nodeFs.rename(content, real);
    await nodeFs.symlink(real, content);

    const result = await fixture.run(fixture.context, { text: OBSERVATION });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.path.startsWith(`${content}/`)).toBe(true);
    expect(result.data.path).not.toContain("real-content");
    /** And the bytes are there, through the link, so this is not a path alone. */
    expect(await nodeFs.readFile(result.data.path, "utf8")).toContain(
      `captureId: ${result.data.captureId}`,
    );
  });

  it("names the file after the capture id, which is the deduplication key", async () => {
    const fixture = await installedFixture("capture-file-name");

    const result = await fixture.run(fixture.context, { text: OBSERVATION });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.path).toBe(
      join(quarantineDirectory(fixture), `${result.data.captureId}.md`),
    );
  });

  it("reports a duplicate at exit 0, naming the existing capture and writing nothing", async () => {
    const fixture = await installedFixture("capture-duplicate");

    const first = await fixture.run(fixture.context, { text: OBSERVATION });
    const second = await fixture.run(fixture.context, { text: OBSERVATION });

    expect(second.code).toBe(0);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.duplicate).toBe(true);
    expect(second.data.path).toBe(first.data.path);
    expect(second.data.status).toBe("quarantined");
    expect(await captureTransactions(fixture)).toHaveLength(1);
  });

  it.each(["rejected", "ingested"])(
    "does not resurrect a capture already at status %s",
    async (status) => {
      const fixture = await installedFixture(`capture-${status}`);
      const seeded = await fixture.run(fixture.context, { text: OBSERVATION });
      expect(seeded.ok).toBe(true);
      if (!seeded.ok) return;
      await setStatus(seeded.data.path, status);
      const before = await captureTransactions(fixture);

      const result = await fixture.run(fixture.context, { text: OBSERVATION });

      expect(result.code).toBe(0);
      expect(result.ok && result.data.status).toBe(status);
      expect(result.ok && result.data.duplicate).toBe(true);
      expect(await captureTransactions(fixture)).toStrictEqual(before);
    },
  );

  it("reports a duplicate it cannot parse as failed, and still writes nothing", async () => {
    const fixture = await installedFixture("capture-broken-duplicate");
    const seeded = await fixture.run(fixture.context, { text: OBSERVATION });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    await nodeFs.writeFile(seeded.data.path, "not a capture at all\n", {
      mode: 0o600,
    });
    const before = await captureTransactions(fixture);

    const result = await fixture.run(fixture.context, { text: OBSERVATION });

    expect(result.code).toBe(0);
    expect(result.ok && result.data.status).toBe("failed");
    expect(result.ok && result.warnings.join(" ")).toContain("unparseable");
    expect(await captureTransactions(fixture)).toStrictEqual(before);
  });

  /**
   * The race `writeCapture`'s docblock describes, driven rather than argued.
   *
   * `TransactionExecutor` gives a transaction-mediated `create` a snapshot, not
   * an `O_EXCL` create, so a second process can put the file there between this
   * command's duplicate read and its write. The hook re-creates the file at
   * exactly that moment — inside the guard `writeCapture` calls before it plans
   * anything — so the executor's own `create` precondition refuses the
   * mutation, which is the real error this recovery path sees.
   *
   * The loser must report the duplicate at exit 0, because the observation *is*
   * recorded: the id is a hash of the content, so the winner wrote the same
   * bytes this run would have.
   */
  it("reports the duplicate at exit 0 when it loses a race to write it", async () => {
    const fixture = await installedFixture("capture-race");
    const first = await fixture.run(fixture.context, { text: OBSERVATION });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const contents = await nodeFs.readFile(first.data.path, "utf8");
    await nodeFs.rm(first.data.path);
    const before = await captureTransactions(fixture);

    let restored = false;
    const racing: CliContext = {
      ...fixture.context,
      guards: {
        ...fixture.context.guards,
        transaction: {
          ...fixture.context.guards.transaction,
          assertTarget: async (path: string): Promise<void> => {
            await fixture.context.guards.transaction.assertTarget(path);
            if (restored) return;
            restored = true;
            await nodeFs.writeFile(first.data.path, contents, { mode: 0o600 });
          },
        },
      },
    };

    const second = await fixture.run(racing, { text: OBSERVATION });

    expect(restored, "the race must actually have been staged").toBe(true);
    expect(second.code).toBe(0);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.duplicate).toBe(true);
    expect(second.data.status).toBe("quarantined");
    expect(second.data.path).toBe(first.data.path);
    expect(await captureTransactions(fixture)).toStrictEqual(before);
  });

  /**
   * The other side of the recovery, and the one that matters most: a
   * transaction that fails **after** apply has already put this run's own
   * bytes at the target. The file is there and parses, so without comparing it
   * against what this run rendered the recovery would report `duplicate: true`
   * at exit 0 — success declared over a transaction that never finalized,
   * hiding the unfinalized journal `repair` exists for.
   *
   * The interrupt is scoped to `kind: "capture"` so the installation that
   * precedes it still completes; interrupting every transaction would take
   * `init` with it and leave nothing to capture into.
   */
  it("still fails when the transaction fails after its own bytes are on disk", async () => {
    const fixture = await installedFixture("capture-post-apply", {
      fixture: { interruptAfter: "applied", interruptKind: "capture" },
    });

    const result = await fixture.run(fixture.context, { text: OBSERVATION });

    expect(result.ok).toBe(false);
    expect(result.code).not.toBe(0);
    /** This run's own capture: written by apply, never finalized. */
    const written = await nodeFs.readdir(quarantineDirectory(fixture));
    expect(written.filter((name) => name.endsWith(".md"))).toHaveLength(1);
    /** And the journal `repair` is for, which exit 0 would have hidden. */
    const journals = await captureTransactions(fixture);
    expect(journals).toHaveLength(1);
    expect(journals[0]?.phase).toBe("applied");
  });

  /**
   * The same race, lost to something that is *not* a capture of this id. The
   * recovery path asks the filesystem one question and rethrows unless the
   * answer is yes, so a failure that merely happens to leave a file behind is
   * still the failure it was.
   */
  it("still fails when the write fails and no capture of this id is there", async () => {
    const fixture = await installedFixture("capture-race-unparseable");
    const first = await fixture.run(fixture.context, { text: OBSERVATION });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await nodeFs.rm(first.data.path);

    let restored = false;
    const racing: CliContext = {
      ...fixture.context,
      guards: {
        ...fixture.context.guards,
        transaction: {
          ...fixture.context.guards.transaction,
          assertTarget: async (path: string): Promise<void> => {
            await fixture.context.guards.transaction.assertTarget(path);
            if (restored) return;
            restored = true;
            await nodeFs.writeFile(first.data.path, "not a capture\n", {
              mode: 0o600,
            });
          },
        },
      },
    };

    const second = await fixture.run(racing, { text: OBSERVATION });

    expect(restored).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.code).not.toBe(0);
  });

  it("reads stdin when --text is absent", async () => {
    const fixture = await installedFixture("capture-stdin");
    const piped = stdinIo(fixture, () => Promise.resolve("from a pipe"));

    const result = await fixture.run(piped, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await nodeFs.readFile(result.data.path, "utf8")).toContain(
      "from a pipe",
    );
  });

  it("does not read stdin when --text is present", async () => {
    const fixture = await installedFixture("capture-text-wins");
    let read = false;
    const piped = stdinIo(fixture, () => {
      read = true;
      return Promise.resolve("from a pipe");
    });

    const result = await fixture.run(piped, { text: OBSERVATION });

    expect(read).toBe(false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await nodeFs.readFile(result.data.path, "utf8")).not.toContain(
      "from a pipe",
    );
  });

  it("refuses at exit 2 when nothing is piped and --text is absent", async () => {
    const fixture = await installedFixture("capture-no-input");
    const bare = stdinIo(fixture, () => Promise.resolve(null));

    const result = await fixture.run(bare, {});

    expect(result.code).toBe(2);
    expect(await captureTransactions(fixture)).toStrictEqual([]);
  });

  it("refuses empty input as invalid, at exit 2", async () => {
    const fixture = await installedFixture("capture-blank");

    expect((await fixture.run(fixture.context, { text: "   " })).code).toBe(2);
    expect(await captureTransactions(fixture)).toStrictEqual([]);
  });

  /**
   * Not whitespace — `\s` does not match a zero-width space — so this reaches
   * the envelope, where the screen deletes every format character and leaves a
   * body with nothing in it. Without the post-build check that is a real
   * capture, with a real id and a real transaction, holding no observation.
   */
  it("refuses input that screens away to nothing, at exit 2", async () => {
    const fixture = await installedFixture("capture-invisible");

    /** Escapes, never the bytes: a literal one is invisible in a diff. */
    const result = await fixture.run(fixture.context, {
      text: "\u200b\u00ad\u200b",
    });

    expect(result.code).toBe(2);
    expect(await captureTransactions(fixture)).toStrictEqual([]);
  });

  it("refuses an observation past the bound rather than truncating it", async () => {
    const fixture = await installedFixture("capture-oversized");
    const oversized = "x".repeat(64 * 1024 + 1);
    const piped = stdinIo(fixture, () => Promise.resolve(oversized));

    const result = await fixture.run(piped, {});

    expect(result.code).toBe(2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).not.toContain("xxxx");
    expect(await captureTransactions(fixture)).toStrictEqual([]);
  });

  it("refuses when no vault exists, at exit 1", async () => {
    const fixture = await createCommandFixture("capture-no-vault");

    const result = await runCapture(
      fixture.context,
      { text: OBSERVATION },
      { cwd: () => fixture.root, detect: detectSourceAgent },
    );

    expect(result.code).toBe(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.recovery).toContain("developer-os init");
  });

  it("never writes the raw text anywhere, not even into a diagnostic", async () => {
    const fixture = await installedFixture("capture-redacts");

    const result = await fixture.run(fixture.context, {
      text: `token ${SECRET}`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.redactionCount).toBeGreaterThan(0);
    expect(await readEverythingWritten(fixture)).not.toContain(SECRET);
    expect(fixture.io.out.join("\n") + fixture.io.err.join("\n")).not.toContain(
      SECRET,
    );
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("publishes a redaction count and never the findings", async () => {
    const fixture = await installedFixture("capture-count-only");

    const result = await fixture.run(fixture.context, {
      text: `token ${SECRET}`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.data).sort()).toStrictEqual([
      "captureId",
      "duplicate",
      "path",
      "redactionCount",
      "schemaVersion",
      "status",
    ]);
    const fingerprints = redactText(
      `token ${SECRET}`,
      loadOrCreateRedactionKey(fixture.paths.stateDir),
    ).findings.map((finding) => finding.fingerprint);
    expect(fingerprints.length).toBeGreaterThan(0);
    for (const fingerprint of fingerprints) {
      expect(JSON.stringify(result)).not.toContain(fingerprint);
    }
  });

  /**
   * The key discipline `init` recorded for this task: redact with the key you
   * loaded, at the point you loaded it. The fixture's context closes over a
   * constant test key, so a capture that fingerprinted through
   * `context.guards` would produce a different fingerprint here and this
   * assertion is the only one in the suite that can tell them apart.
   */
  it("fingerprints with the installation's durable key, not the context's", async () => {
    const fixture = await installedFixture("capture-durable-key");

    const result = await fixture.run(fixture.context, {
      text: `token ${SECRET}`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const durable = loadOrCreateRedactionKey(fixture.paths.stateDir);
    const [expected] = redactText(`token ${SECRET}`, durable).findings;
    expect(expected).toBeDefined();
    const written = await nodeFs.readFile(result.data.path, "utf8");
    expect(written).toContain(expected?.fingerprint ?? "");
    const [contextKeyed] = fixture.context.guards
      .redactDiagnostic(`token ${SECRET}`)
      .matchAll(/[0-9a-f]{16}/gu);
    expect(contextKeyed?.[0]).not.toBe(expected?.fingerprint);
  });

  it("records the working directory as a fingerprint and its basename as a slug", async () => {
    const fixture = await installedFixture("capture-project");

    const result = await fixture.run(fixture.context, { text: OBSERVATION });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const written = await nodeFs.readFile(result.data.path, "utf8");
    expect(written).toContain("projectSlug: sample-project");
    expect(written).toMatch(/workingDirectoryFingerprint: [0-9a-f]{16}\n/u);
    expect(written).not.toContain(fixture.project);
  });

  /**
   * A basename longer than the bound: the cut lands inside the separator run
   * between the two words, so trimming before slicing left `…aaa-`, a trailing
   * separator that reads as a removed word rather than a shortened name.
   */
  it("does not leave a trailing separator when the basename is cut at the bound", async () => {
    const stem = "a".repeat(63);
    const fixture = await installedFixture("capture-long-slug", {
      projectDirectory: `${stem} project`,
    });

    const result = await fixture.run(fixture.context, { text: OBSERVATION });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await nodeFs.readFile(result.data.path, "utf8")).toContain(
      `projectSlug: ${stem}\n`,
    );
  });

  /** A basename with no letter or digit is nameless, not a failed detection. */
  it("names a slugless working directory unnamed, never unknown", async () => {
    const fixture = await installedFixture("capture-slugless", {
      projectDirectory: "+++",
    });

    const result = await fixture.run(fixture.context, { text: OBSERVATION });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const written = await nodeFs.readFile(result.data.path, "utf8");
    expect(written).toContain("projectSlug: unnamed");
    expect(written).not.toContain("projectSlug: unknown");
  });

  /**
   * **The environment here is now Codex's, and that is the point.** This case
   * used `CLAUDECODE: "1"` while the detection table was empty, which stopped
   * being an example of "nothing matches" the moment Task 17 observed that
   * exact variable on 2026-08-15. The contract did not move — an environment
   * carrying no observed marker probes nothing and records `unknown` — so only
   * the environment did, to the one vendor whose row Task 17 could **not**
   * observe: the account's usage limit was exhausted, so `CODEX_SANDBOX` is a
   * plausible marker that this product has never seen a real binary set and
   * therefore refuses to detect on.
   *
   * The machine here has Claude Code installed and the platform is asked
   * nothing and the runner is never called, so the only thing standing between
   * this code and a probe is the absence of a matching row. Against an
   * implementation that probed whenever the environment looked like an agent's
   * — or that hardcoded a vendor — this goes red.
   */
  it("records an unknown agent, spawning nothing, for a vendor with no observed row", async () => {
    const spawned: string[] = [];
    const asked: string[] = [];
    const fixture = await installedFixture("capture-unknown-agent", {
      fixture: {
        env: { CODEX_SANDBOX: "seatbelt" },
        agents: CLAUDE_INSTALLED,
        runner: {
          run: (request): Promise<ProcessResult> => {
            spawned.push(request.executable);
            return Promise.reject(new Error("nothing should spawn here"));
          },
        },
      },
    });
    const counted: CliContext = {
      ...fixture.context,
      platform: countingPlatform(fixture.context.platform, asked),
    };
    /**
     * `init`'s own post-install verification reads the agent's version, so on
     * a machine with one installed the log is not empty before the capture
     * runs. Only what the capture spawns is this test's business.
     */
    spawned.length = 0;

    const result = await fixture.run(counted, { text: OBSERVATION });

    expect(asked).toStrictEqual([]);
    expect(spawned).toStrictEqual([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const written = await nodeFs.readFile(result.data.path, "utf8");
    expect(written).toContain("sourceAgent: unknown");
    expect(written).toContain("sourceAgentVersion: unknown");
    expect(written).toContain("captureMethod: manual");
  });

  /**
   * The other half of the same fact, with detection injected so the case is
   * about what the command does *given* a named vendor: it probes that vendor
   * **once** and records what it found — including `captureMethod`, which moves
   * with detection rather than independently of it. The case below it is the
   * same path driven by the real table Task 17 populated, which is what proves
   * the two halves meet.
   */
  it("probes the detected agent exactly once and records it as agent-authored", async () => {
    const spawned: string[] = [];
    const asked: string[] = [];
    const fixture = await installedFixture("capture-detected-agent", {
      fixture: {
        agents: CLAUDE_INSTALLED,
        runner: {
          run: (request): Promise<ProcessResult> => {
            spawned.push(request.executable);
            return Promise.resolve({
              stdout: "2.1.216 (Claude Code)\n",
              stderr: "",
              exitCode: 0,
              signal: null,
              timedOut: false,
            });
          },
        },
      },
    });
    const counted: CliContext = {
      ...fixture.context,
      platform: countingPlatform(fixture.context.platform, asked),
    };
    /** As above: `init` verified this installation and read the version once. */
    spawned.length = 0;

    const result = await fixture.run(counted, { text: OBSERVATION }, () => "claude");

    expect(asked).toStrictEqual(["claude"]);
    expect(spawned).toStrictEqual(["/synthetic/bin/claude"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const written = await nodeFs.readFile(result.data.path, "utf8");
    expect(written).toContain("sourceAgent: claude");
    expect(written).toContain("sourceAgentVersion: 2.1.216");
    expect(written).toContain("captureMethod: agent-authored");
  });

  /**
   * **The row Task 17 observed, driven end to end with nothing injected.** The
   * case above supplies the detector; this one lets `detectSourceAgent` read
   * `AGENT_DETECTION_ROWS` itself, so it is the only case in this file that
   * would go red if that row were removed or its variable changed. Without it
   * the observation lives in a unit test and nothing proves the command
   * consumes it.
   */
  it("detects claude from the marker Task 17 observed, with no detector injected", async () => {
    const spawned: string[] = [];
    const fixture = await installedFixture("capture-observed-claude", {
      fixture: {
        env: { CLAUDECODE: "1" },
        agents: CLAUDE_INSTALLED,
        runner: {
          run: (request): Promise<ProcessResult> => {
            spawned.push(request.executable);
            return Promise.resolve({
              stdout: "2.1.233 (Claude Code)\n",
              stderr: "",
              exitCode: 0,
              signal: null,
              timedOut: false,
            });
          },
        },
      },
    });
    spawned.length = 0;

    const result = await fixture.run(fixture.context, { text: OBSERVATION });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const written = await nodeFs.readFile(result.data.path, "utf8");
    expect(written).toContain("sourceAgent: claude");
    expect(written).toContain("sourceAgentVersion: 2.1.233");
    expect(written).toContain("captureMethod: agent-authored");
  });
});

/**
 * The version probe, tested directly against an agent name rather than through
 * detection, so the rule is exercised for a vendor that has no row — since Task
 * 17 that means Codex — rather than only for the one that does. It is the same
 * reason `matchObservedAgent` is tested against synthetic rows one layer down.
 */
describe("discoverSourceAgent", () => {
  it("reads the version from the adapter's own discovery", async () => {
    const fixture = await createCommandFixture("probe-claude", {
      runner: runnerReturning("2.1.216 (Claude Code)\n"),
      agents: {
        claude: {
          name: "claude",
          installed: true,
          executablePath: "/synthetic/bin/claude",
          version: null,
        },
        codex: {
          name: "codex",
          installed: false,
          executablePath: null,
          version: null,
        },
      },
    });

    expect(await discoverSourceAgent(fixture.context, "claude")).toStrictEqual({
      sourceAgent: "claude",
      sourceAgentVersion: "2.1.216",
    });
  });

  /**
   * The machine has Claude Code on it and the runner would answer, so the
   * return value alone cannot carry this test: `asked` is what distinguishes
   * "no row named an agent, so nothing was asked" from "something was asked
   * and said no".
   */
  it("asks nothing at all about an agent no row named", async () => {
    const asked: string[] = [];
    const fixture = await createCommandFixture("probe-unknown", {
      agents: CLAUDE_INSTALLED,
      runner: runnerReturning("2.1.216 (Claude Code)\n"),
    });
    const counted: CliContext = {
      ...fixture.context,
      platform: countingPlatform(fixture.context.platform, asked),
    };

    expect(await discoverSourceAgent(counted, "unknown")).toStrictEqual({
      sourceAgent: "unknown",
      sourceAgentVersion: "unknown",
    });
    expect(asked).toStrictEqual([]);
  });

  it.each([
    [
      "the binary is absent",
      { runner: runnerReturning("2.1.216\n") },
    ],
    [
      "discovery refuses",
      { discoveryFailure: new Error("which returned a path it cannot vouch for") },
    ],
    [
      "the probe itself fails",
      {
        agents: {
          claude: {
            name: "claude" as const,
            installed: true,
            executablePath: "/synthetic/bin/claude",
            version: null,
          },
          codex: {
            name: "codex" as const,
            installed: false,
            executablePath: null,
            version: null,
          },
        },
      },
    ],
  ])("records unknown for both fields when %s", async (label, options) => {
    const fixture = await createCommandFixture(
      `probe-${label.replaceAll(" ", "-")}`,
      options,
    );

    expect(await discoverSourceAgent(fixture.context, "claude")).toStrictEqual({
      sourceAgent: "unknown",
      sourceAgentVersion: "unknown",
    });
  });
});
