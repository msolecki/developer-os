import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

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
  ): ReturnType<typeof runCapture>;
}

/**
 * A real installation, produced by the real `init`: the capture path has to be
 * the one a user gets, and a hand-built vault would let a missing template
 * directory pass unnoticed here and fail on a real machine.
 */
async function installedFixture(
  label: string,
  options: Parameters<typeof createCommandFixture>[1] = {},
): Promise<CaptureFixture> {
  const fixture = await createCommandFixture(label, options);
  const installed = await runInit(fixture.context, ACCEPTED);
  expect(installed.ok, "the fixture must install before it captures").toBe(true);

  const project = join(fixture.root, PROJECT_DIRECTORY);
  await nodeFs.mkdir(project, { recursive: true, mode: 0o700 });

  return {
    ...fixture,
    project,
    run: (context, captureOptions) =>
      runCapture(context, captureOptions, { cwd: () => project }),
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
      { cwd: () => fixture.root },
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
   * Decision 3 of the plan: `AGENT_DETECTION_ROWS` is deliberately empty until
   * Task 17 observes a real vendor row, so every capture written today records
   * `unknown`. The fixture's runner rejects, which is what proves no version
   * probe was spawned to reach that answer.
   */
  it("records an unknown agent, spawning nothing, while the detection table is empty", async () => {
    const spawned: string[] = [];
    const fixture = await installedFixture("capture-unknown-agent", {
      env: { CLAUDECODE: "1", CODEX_SANDBOX: "seatbelt" },
      runner: {
        run: (request): Promise<ProcessResult> => {
          spawned.push(request.executable);
          return Promise.reject(new Error("nothing should spawn here"));
        },
      },
    });
    const before = spawned.length;

    const result = await fixture.run(fixture.context, { text: OBSERVATION });

    expect(spawned.slice(before)).toStrictEqual([]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const written = await nodeFs.readFile(result.data.path, "utf8");
    expect(written).toContain("sourceAgent: unknown");
    expect(written).toContain("sourceAgentVersion: unknown");
    expect(written).toContain("captureMethod: manual");
  });
});

/**
 * The version probe, tested directly against an agent name rather than through
 * detection: the detection table is empty by decision, so a rule reached only
 * through it is a rule nobody has ever seen run — the same reason
 * `matchObservedAgent` is tested against synthetic rows one layer down.
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

  it("asks nothing at all about an agent no row named", async () => {
    const fixture = await createCommandFixture("probe-unknown");

    expect(await discoverSourceAgent(fixture.context, "unknown")).toStrictEqual({
      sourceAgent: "unknown",
      sourceAgentVersion: "unknown",
    });
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
