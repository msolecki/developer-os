import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";

import { run } from "../main.js";
import { runConfig } from "./config.js";
import { runInit } from "./init.js";
import {
  createCommandFixture,
  exists,
  RecordingIo,
  removeCommandFixtures,
} from "./testing.js";
import type { CommandFixture } from "./testing.js";
import type { ConfigCommandRequestV1 } from "./config.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

/** One of each operation, so a refusal that is the home's is proven to be both operations'. */
const BOTH_OPERATIONS: readonly ConfigCommandRequestV1[] = [
  { operation: "get", key: null },
  { operation: "set", key: "adapters.claude", value: "true" },
];

function globalLockPath(fixture: CommandFixture): string {
  return join(fixture.paths.stateDir, ".lifecycle.lock");
}

/** The exact shape §2.3 admits: an owner-only zero-byte single-link regular file. */
async function plantGlobalLock(fixture: CommandFixture): Promise<void> {
  await nodeFs.mkdir(fixture.paths.stateDir, { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(globalLockPath(fixture), new Uint8Array(), { mode: 0o600 });
  await nodeFs.chmod(globalLockPath(fixture), 0o600);
}

function neverBuildsContext(): never {
  throw new Error("context must not be built");
}

describe("config on a home that is not an admitted V2 installation", () => {
  it("refuses both operations on a V1 home with exit 4, before any lock", async () => {
    const fixture = await createCommandFixture("config-v1");
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);

    expect(BOTH_OPERATIONS.length).toBeGreaterThan(0);
    for (const request of BOTH_OPERATIONS) {
      expect(await runConfig(fixture.context, request), request.operation).toMatchObject({
        ok: false,
        code: EXIT_CODES.capabilityUnavailable,
        error: { kind: "manifest_v1_not_migratable" },
      });
    }

    expect(await exists(globalLockPath(fixture))).toBe(false);
    expect(fixture.stableLockEvents).toStrictEqual([]);
  });

  it("refuses both operations with exit 2 on a home with no manifest, and creates no lock", async () => {
    const fixture = await createCommandFixture("config-absent");

    expect(BOTH_OPERATIONS.length).toBeGreaterThan(0);
    for (const request of BOTH_OPERATIONS) {
      expect(await runConfig(fixture.context, request), request.operation).toMatchObject({
        ok: false,
        code: EXIT_CODES.invalidInput,
        error: { kind: "manifest_absent" },
      });
    }

    expect(await exists(globalLockPath(fixture))).toBe(false);
    expect(fixture.stableLockEvents).toStrictEqual([]);
  });

  it("takes and releases a planted global lock before refusing a manifest-absent home", async () => {
    const fixture = await createCommandFixture("config-absent-with-lock");
    await plantGlobalLock(fixture);
    const lock = globalLockPath(fixture);
    const before = await nodeFs.lstat(lock, { bigint: true });

    expect(BOTH_OPERATIONS.length).toBeGreaterThan(0);
    for (const request of BOTH_OPERATIONS) {
      expect(await runConfig(fixture.context, request), request.operation).toMatchObject({
        ok: false,
        code: EXIT_CODES.invalidInput,
        error: { kind: "manifest_absent" },
      });
    }

    expect(fixture.stableLockEvents).toStrictEqual([
      `acquire ${lock}`,
      `release ${lock}`,
      `acquire ${lock}`,
      `release ${lock}`,
    ]);
    const after = await nodeFs.lstat(lock, { bigint: true });
    expect([after.dev, after.ino]).toStrictEqual([before.dev, before.ino]);
  });
});

describe("config argument dispatch", () => {
  it.each([
    [["config"]], [["config", "get", "a", "b"]], [["config", "set", "brain.staleness.reviewAfterDays"]],
    [["config", "set", "brain.staleness.reviewAfterDays", "30", "31"]], [["config", "set", "k", "v", "--apply"]],
    [["config", "unset", "k"]],
  ])("refuses the argv %j before building a context", async (argv) => {
    const io = new RecordingIo();
    expect(await run(argv, io, neverBuildsContext)).toBe(EXIT_CODES.invalidInput);
    /**
     * The exit code alone proves nothing: `neverBuildsContext` throwing is published as
     * invalid input too, so a parse rule that stopped working would look identical. The
     * usage block is emitted only by the parse-level refusal.
     */
    expect(io.err.join("\n"), argv.join(" ")).toContain("Usage: developer-os <command>");
  });

  it("refuses an option config does not accept", async () => {
    const io = new RecordingIo();

    expect(await run(["config", "get", "--apply"], io, neverBuildsContext)).toBe(
      EXIT_CODES.invalidInput,
    );
    expect(io.err.join("\n")).toContain("Usage: developer-os <command>");
  });

  it("lists config in the usage block", async () => {
    const io = new RecordingIo();

    expect(await run(["reticulate"], io, neverBuildsContext)).toBe(EXIT_CODES.invalidInput);

    const commands = io.err.filter((line) => line.startsWith("  config "));
    expect(commands.length).toBe(1);
  });
});
