import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { serializeConfig } from "@developer-os/core";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCommandFixture,
  removeCommandFixtures,
} from "./commands/testing.js";
import type { CommandFixture } from "./commands/testing.js";
import type { CliIo } from "./io.js";
import { run } from "./main.js";

afterEach(removeCommandFixtures);

interface Harness {
  readonly fixture: CommandFixture;
  readonly out: readonly string[];
  readonly err: readonly string[];
  invoke(argv: readonly string[]): Promise<number>;
}

async function createHarness(label: string): Promise<Harness> {
  const fixture = await createCommandFixture(label);

  return {
    fixture,
    out: fixture.io.out,
    err: fixture.io.err,
    invoke: (argv) => run(argv, fixture.io, () => fixture.context),
  };
}

/**
 * An installed product with one findable note and a built index, so an alias
 * test can observe the subcommand and the query rather than a config failure.
 */
async function createAliasFixture(): Promise<Harness> {
  const fixture = await createCommandFixture("search-alias");
  await nodeFs.mkdir(fixture.paths.home, { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(
    fixture.paths.configFile,
    serializeConfig({
      schemaVersion: 1,
      brainPath: fixture.paths.brain,
      adapters: { claude: false, codex: false },
      git: { enabled: false },
      automation: { enabled: false },
      telemetry: false,
    }),
    { mode: 0o600 },
  );
  const dev = join(fixture.paths.brain, "content", "DEV");
  await nodeFs.mkdir(dev, { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(
    join(dev, "caching.md"),
    [
      "---",
      "schemaVersion: 1",
      "title: Caching",
      "type: knowledge-note",
      "created: 2026-01-01",
      "tags: [caching]",
      "summary: A summary.",
      "stage: established",
      "author: human",
      "reviewed: 2026-07-01",
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  const harness: Harness = {
    fixture,
    out: fixture.io.out,
    err: fixture.io.err,
    invoke: (argv) => run(argv, fixture.io, () => fixture.context),
  };
  await harness.invoke(["brain", "reindex"]);
  fixture.io.out.length = 0;
  return harness;
}

function collectingIo(lines: string[]): CliIo {
  return {
    stdout: (line: string) => lines.push(line),
    stderr: (line: string) => lines.push(`error:${line}`),
    confirm: () => Promise.resolve(false),
    readStdin: () => Promise.resolve(null),
  };
}

function neverCreatesContext(): never {
  throw new Error("dispatch built a context for a command that needs none");
}

/**
 * Dispatch only — every case using this is refused before a context is built,
 * so none of them needs an installed product. `neverCreatesContext` is what
 * proves the refusal happened at parse time rather than inside the command.
 */
async function refuses(argv: readonly string[]): Promise<void> {
  const lines: string[] = [];
  const code = await run(argv, collectingIo(lines), neverCreatesContext);
  expect(code, argv.join(" ")).toBe(2);
  /**
   * The exit code alone proves nothing here: `neverCreatesContext` throwing
   * also yields 2, so a parse rule that stopped working would look identical.
   * The usage block is emitted only by the parse-level refusal.
   */
  expect(lines.join("\n"), argv.join(" ")).toContain(
    "Usage: developer-os <command>",
  );
}

/**
 * A command name nothing will ever dispatch. These cases used to spell it
 * `capture`, which stopped being unknown the moment DOS-P6 Task 9 shipped the
 * command — an "unknown command" case that quietly started exercising a real
 * one.
 */
const UNKNOWN_COMMAND = "reticulate";

async function exists(path: string): Promise<boolean> {
  try {
    await nodeFs.lstat(path);
    return true;
  } catch {
    return false;
  }
}

describe("run", () => {
  it("prints the product version", async () => {
    const lines: string[] = [];

    const code = await run(["--version"], collectingIo(lines), neverCreatesContext);

    expect(code).toBe(0);
    expect(lines).toEqual(["developer-os 0.0.0"]);
  });

  it("prints version results as one JSON line on stdout", async () => {
    const lines: string[] = [];

    const code = await run(
      ["--version", "--json"],
      collectingIo(lines),
      neverCreatesContext,
    );

    expect(code).toBe(0);
    expect(lines).toEqual([
      '{"ok":true,"code":0,"data":{"version":"0.0.0"},"warnings":[]}',
    ]);
  });

  it("rejects an unknown command without building a context", async () => {
    const lines: string[] = [];

    const code = await run(
      [UNKNOWN_COMMAND],
      collectingIo(lines),
      neverCreatesContext,
    );

    expect(code).toBe(2);
    expect(lines[0]).toContain("Usage: developer-os <command> [options]");
  });

  it("reports an invalid invocation as one JSON line", async () => {
    const lines: string[] = [];

    const code = await run(
      [UNKNOWN_COMMAND, "--json"],
      collectingIo(lines),
      neverCreatesContext,
    );

    expect(code).toBe(2);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      ok: false,
      code: 2,
      error: { kind: "invalid_input", paths: [] },
    });
  });

  it("prints the usage block as separate lines", async () => {
    const lines: string[] = [];

    await run([UNKNOWN_COMMAND], collectingIo(lines), neverCreatesContext);

    expect(lines.length).toBeGreaterThan(10);
    expect(lines.join("\n")).not.toContain("�");
    expect(lines).toContain("error:Commands:");
    expect(lines).toContain("error:  --version        print the product version");
  });

  it("reports an unbuildable context as invalid input rather than rejecting", async () => {
    const lines: string[] = [];

    const code = await run(["status"], collectingIo(lines), () => {
      throw new Error("Developer OS home must be an absolute path");
    });

    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("must be an absolute path");
  });

  it("rejects a command name inherited from Object.prototype", async () => {
    const lines: string[] = [];
    const io = collectingIo(lines);

    for (const name of ["toString", "valueOf", "constructor", "hasOwnProperty"]) {
      expect(await run([name], io, neverCreatesContext)).toBe(2);
      expect(await run([name, "--json"], io, neverCreatesContext)).toBe(2);
    }
  });

  it("rejects an unknown option", async () => {
    const harness = await createHarness("main-unknown-option");

    expect(await harness.invoke(["status", "--verbose"])).toBe(2);
  });

  it("rejects an option the command does not accept", async () => {
    const harness = await createHarness("main-wrong-option");

    expect(await harness.invoke(["status", "--dry-run"])).toBe(2);
    expect(await harness.invoke(["doctor", "--yes"])).toBe(2);
    expect(await harness.invoke(["init", "--resume", "tx_fixture_001"])).toBe(2);
    expect(await harness.invoke(["status", "--version"])).toBe(2);
  });

  it("rejects more than one command", async () => {
    const harness = await createHarness("main-two-commands");

    expect(await harness.invoke(["status", "doctor"])).toBe(2);
  });

  it("runs the whole lifecycle through argument dispatch", async () => {
    const harness = await createHarness("main-lifecycle");

    expect(await harness.invoke(["init", "--dry-run", "--json"])).toBe(0);
    expect(await exists(harness.fixture.paths.configFile)).toBe(false);

    expect(await harness.invoke(["init", "--yes", "--json"])).toBe(0);
    expect(await harness.invoke(["status", "--json"])).toBe(0);
    expect(await harness.invoke(["doctor", "--json"])).toBe(0);
    expect(await harness.invoke(["init", "--yes", "--json"])).toBe(0);
    expect(await harness.invoke(["uninstall", "--yes", "--json"])).toBe(0);
    expect(await harness.invoke(["uninstall", "--yes", "--json"])).toBe(0);

    expect(await exists(harness.fixture.paths.brain)).toBe(true);
    expect(await exists(harness.fixture.paths.configFile)).toBe(false);
    expect(harness.err).toEqual([]);
    expect(harness.out).toHaveLength(7);
    for (const line of harness.out) {
      expect(() => JSON.parse(line) as unknown).not.toThrow();
    }
  });

  it("refuses options that --version does not accept", async () => {
    const lines: string[] = [];

    expect(
      await run(["--version", "--yes"], collectingIo(lines), neverCreatesContext),
    ).toBe(2);
    expect(
      await run(
        ["--version", "--resume", "tx_fixture_001"],
        collectingIo(lines),
        neverCreatesContext,
      ),
    ).toBe(2);
  });

  it("never renders a control character from a manifest product version", async () => {
    const harness = await createHarness("main-status-render");
    expect(await harness.invoke(["init", "--yes", "--json"])).toBe(0);

    const manifest = await harness.fixture.context.manifests.read();
    await harness.fixture.context.manifests.write({
      ...manifest,
      productVersion: `0.0.0\u001b[2Jinstalled: yes`,
    });

    expect(await harness.invoke(["status"])).toBe(0);
    expect(harness.out.join("\n")).not.toContain("\u001b");
    expect(harness.out.join("\n")).toContain("\uFFFD");
  });

  it("sends human failures and their recovery command to stderr", async () => {
    const harness = await createHarness("main-human");

    const code = await harness.invoke(["doctor"]);

    expect(code).toBe(1);
    expect(harness.err.join("\n")).toContain("Recovery: developer-os init");
  });

  it("refuses a repair that names both actions", async () => {
    const harness = await createHarness("main-repair");

    const code = await harness.invoke([
      "repair",
      "--resume",
      "tx_fixture_001",
      "--rollback",
      "tx_fixture_001",
    ]);

    expect(code).toBe(2);
  });
});

describe("capture dispatch", () => {
  it("refuses an option capture does not accept", async () => {
    await refuses(["capture", "--limit", "5"]);
  });

  /**
   * The case that goes red if `text` joins `OPTIONS` without joining
   * `OPTION_NAMES`: `suppliedOptions` filters `OPTION_NAMES`, so an option
   * missing from it is invisible to the per-command allow-list and every
   * command silently accepts it. The `--limit` case above stays green through
   * that hole, which is why both are here.
   */
  it("refuses --text on a command that does not take it", async () => {
    await refuses(["status", "--text", "hi"]);
  });

  it("refuses a positional, because capture takes none", async () => {
    await refuses(["capture", "an observation"]);
  });
});

describe("brain dispatch", () => {
  it("refuses an unknown brain subcommand", async () => {
    await refuses(["brain", "reticulate"]);
  });

  it("refuses a brain invocation with no subcommand", async () => {
    await refuses(["brain"]);
  });

  it("refuses a third positional", async () => {
    await refuses(["brain", "search", "one", "two"]);
  });

  it("refuses a subcommand named after a prototype member", async () => {
    /** `BRAIN_SUBCOMMANDS["toString"]` is a function without `Object.hasOwn`. */
    await refuses(["brain", "toString"]);
    await refuses(["brain", "constructor"]);
  });

  it("refuses --limit on a subcommand that does not take it", async () => {
    await refuses(["brain", "lint", "--limit", "5"]);
    await refuses(["brain", "reindex", "--limit", "5"]);
  });

  it("refuses --dry-run on a read-only subcommand", async () => {
    await refuses(["brain", "search", "x", "--dry-run"]);
    await refuses(["brain", "lint", "--dry-run"]);
  });

  it("refuses a search with no query, and a non-search with one", async () => {
    await refuses(["brain", "search"]);
    await refuses(["search"]);
    await refuses(["brain", "lint", "extra"]);
  });

  it("refuses a --limit that is not a positive integer", async () => {
    /**
     * Refused before a context exists. Letting a `0` through to the command
     * also exits 2 — `search` throws `RangeError` and the command maps it — so
     * asserting the code alone would pass against no validation at all.
     */
    for (const limit of ["0", "-1", "2.5", "abc", "1e3", ""]) {
      await refuses(["brain", "search", "x", "--limit", limit]);
    }
  });

  it("accepts every well-formed brain invocation", async () => {
    /**
     * These reach the command, which then refuses because the fixture has no
     * configuration — exit 2 either way, so the assertion that distinguishes
     * parse from command is the stderr text.
     */
    for (const argv of [
      ["brain", "status"],
      ["brain", "lint"],
      ["brain", "reindex"],
      ["brain", "reindex", "--dry-run"],
      ["brain", "search", "caching"],
      ["brain", "search", "caching", "--limit", "3"],
      ["search", "caching"],
    ]) {
      const fixture = await createCommandFixture(`ok-${argv.join("-")}`);
      const lines: string[] = [];
      await run(argv, collectingIo(lines), () => fixture.context);
      expect(lines.join("\n"), argv.join(" ")).toContain(
        "Developer OS is not initialized",
      );
    }
  });

  it("treats developer-os search as an alias for brain search", async () => {
    /**
     * On an *installed* fixture with a real index. On an uninitialized one both
     * invocations fail inside `readConfig` before the subcommand or the query
     * is ever read, so `search x` running `brain status`, or searching for the
     * empty string, both passed.
     */
    const fixture = await createAliasFixture();

    const viaAlias = await fixture.invoke(["search", "caching", "--json"]);
    const direct = await fixture.invoke(["brain", "search", "caching", "--json"]);
    expect(viaAlias).toBe(0);
    expect(direct).toBe(0);

    const [aliasLine, directLine] = fixture.out;
    expect(aliasLine).toBe(directLine);
    expect(aliasLine).toContain('"subcommand":"search"');
    expect(aliasLine).toContain("caching.md");

    /** A different query must produce a different answer, or nothing is pinned. */
    await fixture.invoke(["search", "zzzznotpresent", "--json"]);
    expect(fixture.out[2]).not.toBe(aliasLine);
    expect(fixture.out[2]).toContain('"matches":[]');
  });
});
