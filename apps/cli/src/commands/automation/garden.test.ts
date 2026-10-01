/**
 * The scheduled gardener on one shared real V2 home (a fresh `init` costs minutes). Each case
 * resets the vault notes, quarantine, config and index it reads, then runs the handler under
 * the runner's real held global lock. The only fake is the vendor process.
 */
import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { loadConfig, parseCanonicalAbsolutePathText, serializeConfig } from "@developer-os/core";
import type { HeldLifecycleStableLockV1 } from "@developer-os/core";
import type { ProcessResult, ProcessRunner } from "@developer-os/security";

import type { CliContext } from "../../context.js";
import { runBrain } from "../brain.js";
import { runCapture } from "../capture.js";
import { runInit } from "../init.js";
import { outputSchemaPath } from "../output-schemas.js";
import { listCaptureSummaries } from "../review.js";
import { createCommandFixture, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../testing.js";
import type { CommandFixture } from "../testing.js";
import { runScheduledGarden } from "./garden.js";
import type { GardenRunDataV1 } from "./garden.js";

afterAll(removeCommandFixtures);

/** A proxied adapter's own methods run on the adapter itself, whose private fields a proxy lacks. */
function bound(target: object, property: string | symbol): unknown {
  const value: unknown = Reflect.get(target, property);
  return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
}

type Reply = { readonly proposals: unknown } | { readonly raw: string } | "timeout" | "vendor-error";

interface GardenOptions {
  /** Content-relative paths of isolated notes, created 2000-01-01 so they are selected first. */
  readonly isolated?: readonly string[];
  /** Tag four notes `git`, so a gap target exists. */
  readonly gitGap?: boolean;
  readonly quarantined?: number;
  /** A quarantined capture proposing a new compiled note for `git`. */
  readonly pendingGitHub?: boolean;
  readonly reply?: Reply;
  readonly agent?: "claude" | "codex";
  /** `false` pins nothing; `"missing"` pins a path with no file behind it. */
  readonly pinned?: false | "missing";
  readonly reindex?: boolean;
  readonly redactionPatterns?: readonly string[];
  /** One note links every other, so no note is isolated. */
  readonly linked?: boolean;
  /** Extra notes written verbatim, content-relative path to text. */
  readonly extra?: Readonly<Record<string, string>>;
}

interface SharedHomeV1 {
  readonly fixture: CommandFixture;
  readonly config: string;
  /** Every spawn of the pinned executable, as the runner received it. */
  readonly calls: string[];
  reply: Reply;
  executable: string;
  /** Runs inside the vendor call, before it replies: the vault changing while the agent thinks. */
  during: (() => Promise<void>) | null;
}

const GIT_NOTES = ["DEV/git-one.md", "DEV/git-two.md", "DEV/git-three.md", "DEV/git-four.md"];
const baseName = (path: string): string => path.split("/").pop()?.replace(/\.md$/u, "") ?? path;

function note(title: string, options: { readonly tags?: readonly string[]; readonly created?: string } = {}): string {
  return [
    "---",
    "schemaVersion: 1",
    `title: ${title}`,
    "type: knowledge-note",
    `created: ${options.created ?? "2000-01-02"}`,
    `tags: [${(options.tags ?? [title.toLowerCase()]).join(", ")}]`,
    `summary: ${title} is what this note records.`,
    "stage: emerging",
    "author: agent",
    "reviewed: null",
    "---",
    "",
    `${title} holds one observation worth keeping.`,
    "",
  ].join("\n");
}

function hubNote(tag: string, links: readonly string[], sources: readonly string[]): string {
  return [
    "---",
    "schemaVersion: 1",
    `title: Everything about ${tag}`,
    "type: compiled-note",
    "created: 2026-10-01",
    `tags: [${tag}]`,
    `summary: What the ${tag} notes agree on.`,
    "stage: emerging",
    "author: agent",
    "reviewed: null",
    `sources: [${sources.join(", ")}]`,
    "---",
    "",
    "The notes on this tag agree on a few things.",
    "",
    ...links.map((link) => `- [[${link}]]`),
    "",
  ].join("\n");
}

function related(current: string, links: readonly string[]): string {
  return `${current}\n## Related\n\n${links.map((link) => `- [[${link}]]`).join("\n")}\n`;
}

let shared: Promise<SharedHomeV1> | null = null;

function sharedHome(): Promise<SharedHomeV1> {
  shared ??= (async () => {
    const calls: string[] = [];
    let home: SharedHomeV1 | null = null;
    const runner: ProcessRunner = {
      run: async (request): Promise<ProcessResult> => {
        if (home === null || request.executable !== home.executable) {
          return { stdout: "", stderr: "", exitCode: 1, signal: null, timedOut: false };
        }
        calls.push(JSON.stringify(request));
        await home.during?.();
        const { reply } = home;
        if (reply === "timeout") return { stdout: "", stderr: "", exitCode: null, signal: "SIGTERM", timedOut: true };
        const envelope =
          reply === "vendor-error"
            ? { type: "result", subtype: "success", is_error: true, result: "Not logged in: detail that must not be stored" }
            : { type: "result", subtype: "success", is_error: false, result: "raw" in reply ? reply.raw : JSON.stringify(reply) };
        return { stdout: JSON.stringify(envelope), stderr: "", exitCode: 0, signal: null, timedOut: false };
      },
    };
    const fixture = await createCommandFixture("garden-shared", { bootstrapAvailable: true, runner });
    const installed = await runInit(fixture.context, { dryRun: false, assumeYes: true });
    if (!installed.ok) throw new Error(`fixture init failed: ${JSON.stringify(installed)}`);
    home = { fixture, config: await nodeFs.readFile(fixture.paths.configFile, "utf8"), calls, reply: { proposals: [] }, executable: "", during: null };
    return home;
  })();
  return shared;
}

async function removeEntries(directory: string, keep: (name: string) => boolean): Promise<void> {
  for (const name of await nodeFs.readdir(directory)) {
    if (!keep(name)) await nodeFs.rm(join(directory, name), { recursive: true, force: true });
  }
}

/** Resets the shared home to exactly what `options` names. */
async function garden(options: GardenOptions = {}): Promise<SharedHomeV1> {
  const home = await sharedHome();
  const { fixture } = home;
  const content = join(fixture.paths.brain, "content");
  home.calls.length = 0;
  home.during = null;
  home.reply = options.reply ?? { proposals: [] };
  await removeEntries(join(content, "DEV"), (name) => name === "example-knowledge-note.md");
  await removeEntries(join(content, "_raw", "quarantine"), (name) => name === ".gitkeep");
  await nodeFs.writeFile(fixture.paths.configFile, home.config);

  const write = async (path: string, text: string): Promise<void> => {
    await nodeFs.mkdir(dirname(join(content, path)), { recursive: true });
    await nodeFs.writeFile(join(content, path), text);
  };
  await write("DEV/beta.md", note("Beta"));
  await write("DEV/gamma.md", note("Gamma"));
  if (options.linked === true) {
    const everything = ["beta", "gamma", "INFRA/example-compiled-note", "TOOLS/example-reference-note", "PROJECTS/example-project-note", "DEV/example-knowledge-note"];
    await write("DEV/map.md", `${note("Map")}\n${everything.map((link) => `- [[${link}]]`).join("\n")}\n`);
  }
  for (const path of options.isolated ?? []) await write(path, note(baseName(path), { created: "2000-01-01" }));
  if (options.gitGap === true) {
    for (const path of GIT_NOTES) await write(path, note(baseName(path), { tags: ["git"], created: "2000-01-03" }));
  }
  for (const [path, text] of Object.entries(options.extra ?? {})) await write(path, text);
  const reindexed = await runBrain(fixture.context, { subcommand: "reindex", query: null, limit: null, dryRun: false });
  if (!reindexed.ok) throw new Error(`fixture reindex failed: ${JSON.stringify(reindexed)}`);
  if (options.reindex === false) await nodeFs.rm(join(content, "_indexes", "index.json"));

  for (let index = 0; index < (options.quarantined ?? 0); index += 1) {
    const captured = await runCapture(fixture.context, { text: `Observation number ${String(index)} waits for review.` });
    if (!captured.ok) throw new Error(`fixture capture failed: ${JSON.stringify(captured)}`);
  }
  if (options.pendingGitHub === true) {
    const captured = await runCapture(fixture.context, { text: hubNote("git", GIT_NOTES.map(baseName), GIT_NOTES), note: "DEV/git-hub.md" });
    if (!captured.ok) throw new Error(`fixture hub capture failed: ${JSON.stringify(captured)}`);
  }

  home.executable = join(fixture.root, "bin", options.agent ?? "claude");
  await nodeFs.rm(home.executable, { force: true });
  if (options.pinned !== "missing") {
    await nodeFs.mkdir(dirname(home.executable), { recursive: true });
    await nodeFs.writeFile(home.executable, "#!/bin/sh\n", { mode: 0o755 });
  }
  const config = loadConfig(home.config);
  const automation =
    options.pinned === false ? config.automation : { ...config.automation, brainGarden: { agent: options.agent ?? "claude", executable: home.executable } };
  const redaction = options.redactionPatterns === undefined ? {} : { redaction: { patterns: [...options.redactionPatterns] } };
  await nodeFs.writeFile(fixture.paths.configFile, serializeConfig({ ...config, ...redaction, automation }));
  return home;
}

/** Under the runner's own held descriptor, which the handler must borrow and never release. */
async function run(home: SharedHomeV1, context: CliContext = home.fixture.context) {
  const { fixture } = home;
  const lifecycle = fixture.context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
  const held = await lifecycle.locks.acquireExisting(parseCanonicalAbsolutePathText(join(fixture.paths.stateDir, ".lifecycle.lock")));
  const releases: string[] = [];
  const borrowed: HeldLifecycleStableLockV1 = {
    path: held.path,
    dev: held.dev,
    ino: held.ino,
    release: () => {
      releases.push(held.path);
      return Promise.resolve();
    },
  };
  try {
    const result = await runScheduledGarden(context, borrowed);
    expect(releases).toEqual([]);
    return result;
  } finally {
    await held.release();
  }
}

const dataOf = (result: { readonly data: unknown }): GardenRunDataV1 => result.data as GardenRunDataV1;
const quarantined = (home: SharedHomeV1) => listCaptureSummaries(home.fixture.context, "quarantined");
const readVaultNote = (home: SharedHomeV1, path: string): Promise<string> =>
  nodeFs.readFile(join(home.fixture.paths.brain, "content", path), "utf8");

describe("runScheduledGarden", () => {
  it("skips without calling the agent when 20 captures wait for review", async () => {
    const home = await garden({ isolated: ["DEV/alpha.md"], quarantined: 20 });
    const result = await run(home);
    expect(result).toMatchObject({ outcome: "success", reasonCode: "skipped_review_queue_full" });
    expect(dataOf(result).skipped).toBe("review_queue_full");
    expect(home.calls).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("writes only valid proposals into quarantine and reports the rejected ones", async () => {
    const home = await garden({ isolated: ["DEV/alpha.md", "DEV/delta.md"], gitGap: true });
    const alpha = await readVaultNote(home, "DEV/alpha.md");
    const delta = await readVaultNote(home, "DEV/delta.md");
    home.reply = {
      proposals: [
        { kind: "related", target: "DEV/alpha.md", note: related(alpha.replace("holds one", "holds a rewritten"), ["beta", "gamma"]) },
        { kind: "related", target: "DEV/delta.md", note: related(delta, ["beta", "gamma"]) },
        { kind: "hub", target: "DEV/git-hub.md", note: hubNote("git", [...GIT_NOTES.map(baseName), "_raw/quarantine/x"], GIT_NOTES) },
      ],
    };

    const result = await run(home);

    expect(result).toMatchObject({ outcome: "success", reasonCode: "ok" });
    expect(dataOf(result).accepted.map((entry) => entry.target)).toEqual(["DEV/delta.md"]);
    expect(dataOf(result).rejected).toEqual([
      { target: "DEV/alpha.md", code: "related_changes_body" },
      { target: "DEV/git-hub.md", code: "link_unresolved" },
    ]);
    expect(dataOf(result).targets.gaps).toBe(1);
    expect(home.calls).toHaveLength(1);
    expect(home.calls[0]).toContain("Gap: notes tagged git");
    const captures = await quarantined(home);
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ notePath: "DEV/delta.md", captureId: dataOf(result).accepted[0]?.captureId });
    const capture = await nodeFs.readFile(
      join(home.fixture.paths.brain, "content", "_raw", "quarantine", `${String(captures[0]?.captureId)}.md`),
      "utf8",
    );
    expect(capture).toMatch(/^sourceAgent: "?claude"?$/mu);
    expect(capture).toMatch(/^captureMethod: "?agent-authored"?$/mu);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("does not re-offer a gap whose hub already waits in review", async () => {
    const home = await garden({ isolated: ["DEV/alpha.md"], gitGap: true, pendingGitHub: true });
    const captures = await quarantined(home);
    expect(captures.find((capture) => capture.notePath === "DEV/git-hub.md")?.hubTags).toEqual(["git"]);

    const result = await run(home);

    expect(result).toMatchObject({ outcome: "success", reasonCode: "ok" });
    expect(dataOf(result).targets.gaps).toBe(0);
    expect(home.calls).toHaveLength(1);
    expect(home.calls[0]).not.toContain("Gap: notes tagged git");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("rejects a proposal the capture redactor would alter, using the configured user patterns", async () => {
    const withClient = note("delta", { created: "2000-01-01" }).replace("delta holds", "Acme Industries holds");
    const home = await garden({ extra: { "DEV/delta.md": withClient }, redactionPatterns: ["Acme Industries"] });
    home.reply = { proposals: [{ kind: "related", target: "DEV/delta.md", note: related(withClient, ["beta", "gamma"]) }] };

    const result = await run(home);

    expect(result, JSON.stringify(result)).toMatchObject({ outcome: "success", reasonCode: "ok" });
    expect(dataOf(result).rejected).toEqual([{ target: "DEV/delta.md", code: "redaction_would_alter" }]);
    expect(await quarantined(home)).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses before spawning when the pinned executable was replaced", async () => {
    const home = await garden({ isolated: ["DEV/alpha.md"] });
    const untrusted = new Proxy(home.fixture.context.platform, {
      get: (target, property): unknown =>
        property === "assertTrustedExecutable" ? () => Promise.reject(new Error("group-writable")) : bound(target, property),
    });
    const result = await run(home, { ...home.fixture.context, platform: untrusted });
    expect(result).toMatchObject({ outcome: "handler_refused", reasonCode: "garden_executable_untrusted" });
    expect(home.calls).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each([
    ["nothing is pinned", false],
    ["the pinned file is gone", "missing"],
  ] as const)("refuses garden_executable_missing when %s", async (_label, pinned) => {
    const home = await garden({ isolated: ["DEV/alpha.md"], pinned });
    const result = await run(home);
    expect(result).toMatchObject({ outcome: "handler_refused", reasonCode: "garden_executable_missing" });
    expect(home.calls).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a Codex pin garden_agent_unsupported before spawning anything (Ruling 38)", async () => {
    const home = await garden({ isolated: ["DEV/alpha.md"], agent: "codex" });
    const result = await run(home);
    expect(result).toMatchObject({ outcome: "handler_refused", reasonCode: "garden_agent_unsupported" });
    expect(JSON.stringify(result.data)).toContain("Codex has no tool-free mode");
    expect(home.calls).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a Claude pin whose executable is not named claude (Ruling 37)", async () => {
    const home = await garden({ isolated: ["DEV/alpha.md"] });
    const config = loadConfig(await nodeFs.readFile(home.fixture.paths.configFile, "utf8"));
    home.executable = join(dirname(home.executable), "sh");
    await nodeFs.writeFile(home.executable, "#!/bin/sh\n", { mode: 0o755 });
    await nodeFs.writeFile(
      home.fixture.paths.configFile,
      serializeConfig({ ...config, automation: { ...config.automation, brainGarden: { agent: "claude", executable: home.executable } } }),
    );
    const result = await run(home);
    expect(result).toMatchObject({ outcome: "handler_refused", reasonCode: "garden_executable_untrusted" });
    expect(home.calls).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("skips index_missing when the vault has no index", async () => {
    const home = await garden({ isolated: ["DEV/alpha.md"], reindex: false });
    const result = await run(home);
    expect(result).toMatchObject({ outcome: "success", reasonCode: "skipped_index_missing" });
    expect(home.calls).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("skips lint_errors when lint reports an error", async () => {
    const home = await garden({ isolated: ["DEV/alpha.md"], extra: { "DEV/broken.md": "---\ntitle: [unclosed\n---\n\nBody.\n" } });
    const result = await run(home);
    expect(result).toMatchObject({ outcome: "success", reasonCode: "skipped_lint_errors" });
    expect(home.calls).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each([
    ["a non-JSON reply", { raw: "I could not decide." }],
    ["a reply outside the schema", { proposals: "none" }],
  ] as const)("fails agent_output_invalid on %s and writes nothing", async (_label, reply) => {
    const home = await garden({ isolated: ["DEV/alpha.md"], reply });
    const result = await run(home);
    expect(result).toMatchObject({ outcome: "handler_failed", reasonCode: "agent_output_invalid" });
    expect(home.calls).toHaveLength(1);
    expect(await quarantined(home)).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("fails agent_timeout when the agent times out, still listing structural dry-run commands", async () => {
    const twin = (created: string): string => note("Twin", { created }).replace("tags: [twin]", "tags: [twin-a]");
    const home = await garden({
      isolated: ["DEV/alpha.md"],
      reply: "timeout",
      extra: { "DEV/twin-a.md": twin("2000-01-04"), "DEV/twin-b.md": twin("2000-01-05").replace("holds one", "holds another") },
    });
    const result = await run(home);
    expect(result).toMatchObject({ outcome: "handler_failed", reasonCode: "agent_timeout" });
    expect(dataOf(result).structural).toEqual(["developer-os brain refactor --merge 'DEV/twin-b.md' 'DEV/twin-a.md' --dry-run"]);
    expect(await quarantined(home)).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("fails agent_error storing the adapter's reason and never its detail", async () => {
    const home = await garden({ isolated: ["DEV/alpha.md"], reply: "vendor-error" });
    const result = await run(home);
    expect(result).toMatchObject({ outcome: "handler_failed", reasonCode: "agent_error" });
    expect(dataOf(result).agentReason).toBe("vendor-error");
    expect(JSON.stringify(result.data)).not.toContain("Not logged in");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("rejects target_changed when the related note is edited during the agent call, capturing nothing", async () => {
    const home = await garden({ isolated: ["DEV/delta.md"] });
    const path = join(home.fixture.paths.brain, "content", "DEV", "delta.md");
    const delta = await nodeFs.readFile(path, "utf8");
    home.reply = { proposals: [{ kind: "related", target: "DEV/delta.md", note: related(delta, ["beta", "gamma"]) }] };
    home.during = () => nodeFs.writeFile(path, delta.replace("holds one", "holds an edited"));

    const result = await run(home);

    expect(result).toMatchObject({ outcome: "success", reasonCode: "ok" });
    expect(dataOf(result).rejected).toEqual([{ target: "DEV/delta.md", code: "target_changed" }]);
    expect(dataOf(result).accepted).toEqual([]);
    expect(await quarantined(home)).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("never captures a hub whose target appeared during the agent call", async () => {
    const home = await garden({ isolated: ["DEV/alpha.md"], gitGap: true });
    home.reply = { proposals: [{ kind: "hub", target: "DEV/git-hub.md", note: hubNote("git", GIT_NOTES.map(baseName), GIT_NOTES) }] };
    home.during = () => nodeFs.writeFile(join(home.fixture.paths.brain, "content", "DEV", "git-hub.md"), note("Someone else"));

    const result = await run(home);

    expect(dataOf(result).accepted).toEqual([]);
    expect(dataOf(result).rejected.map((entry) => entry.target)).toEqual(["DEV/git-hub.md"]);
    expect(await quarantined(home)).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("binds a capture to the expected bytes: a note that now exists refuses capture_target_changed", async () => {
    const home = await garden({ isolated: ["DEV/alpha.md"] });
    const text = hubNote("misc", ["beta", "gamma", "alpha"], ["DEV/beta.md"]);
    const refused = await runCapture(home.fixture.context, { text, note: "DEV/beta.md", expectedBeforeSha256: null });
    expect(refused).toMatchObject({ ok: false, error: { kind: "capture_target_changed" } });
    expect(await quarantined(home)).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("records a proposal whose capture already exists as duplicate_capture", async () => {
    const home = await garden({ isolated: ["DEV/delta.md"] });
    const delta = await readVaultNote(home, "DEV/delta.md");
    const proposal = related(delta, ["beta", "gamma"]);
    const earlier = await runCapture(home.fixture.context, { text: proposal });
    expect(earlier.ok).toBe(true);
    home.reply = { proposals: [{ kind: "related", target: "DEV/delta.md", note: proposal }] };

    const result = await run(home);

    expect(dataOf(result).rejected).toEqual([{ target: "DEV/delta.md", code: "duplicate_capture" }]);
    expect(dataOf(result).accepted).toEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("re-runs the trust check immediately before the agent call", async () => {
    const home = await garden({ isolated: ["DEV/alpha.md"] });
    let checks = 0;
    const swapped = new Proxy(home.fixture.context.platform, {
      get: (target, property): unknown =>
        property === "assertTrustedExecutable"
          ? () => {
              checks += 1;
              return checks === 1 ? Promise.resolve() : Promise.reject(new Error("swapped"));
            }
          : bound(target, property),
    });
    const result = await run(home, { ...home.fixture.context, platform: swapped });
    expect(result).toMatchObject({ outcome: "handler_refused", reasonCode: "garden_executable_untrusted" });
    expect(checks).toBe(2);
    expect(home.calls).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("skips doctor_failed when a doctor check fails", async () => {
    const home = await garden({ isolated: ["DEV/alpha.md"] });
    const schema = outputSchemaPath(home.fixture.paths.home, "garden.proposals");
    const bytes = await nodeFs.readFile(schema);
    await nodeFs.writeFile(schema, "{}\n");
    try {
      const result = await run(home);
      expect(result).toMatchObject({ outcome: "success", reasonCode: "skipped_doctor_failed" });
      expect(home.calls).toHaveLength(0);
    } finally {
      await nodeFs.writeFile(schema, bytes, { mode: 0o600 });
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("skips nothing_to_do without calling the agent when no note needs tending", async () => {
    const home = await garden({ linked: true });
    const result = await run(home);
    expect(result).toMatchObject({ outcome: "success", reasonCode: "skipped_nothing_to_do" });
    expect(home.calls).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
