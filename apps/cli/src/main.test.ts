import * as nodeFs from "node:fs/promises";

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

function collectingIo(lines: string[]): CliIo {
  return {
    stdout: (line: string) => lines.push(line),
    stderr: (line: string) => lines.push(`error:${line}`),
    confirm: () => Promise.resolve(false),
  };
}

function neverCreatesContext(): never {
  throw new Error("dispatch built a context for a command that needs none");
}

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

    const code = await run(["capture"], collectingIo(lines), neverCreatesContext);

    expect(code).toBe(2);
    expect(lines[0]).toContain("Usage: developer-os <command> [options]");
  });

  it("reports an invalid invocation as one JSON line", async () => {
    const lines: string[] = [];

    const code = await run(
      ["capture", "--json"],
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

    await run(["capture"], collectingIo(lines), neverCreatesContext);

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
