import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import { EXIT_CODES, serializeConfig } from "@developer-os/core";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCommandFixture,
  firstRegularFile,
  RecordingIo,
  inventoryDigest,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
  retainedTombstones,
} from "./commands/testing.js";
import type { CommandFixture } from "./commands/testing.js";
import type { CliIo } from "./io.js";
import { renderReview, run } from "./main.js";
import type { CliContextFactory } from "./main.js";
import type { HookEnvironment } from "./hooks/entry.js";
import { PRODUCT_VERSION } from "./context.js";
import { admitUnsignedLocalPackagedRelease } from "./update/packaged-release.js";
import type { ReviewResultV1 } from "./commands/review.js";
import { BOOTSTRAP_MANUAL_ARCHIVE, MALFORMED_V2_MANIFEST } from "./bootstrap/report.js";

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
const RETAINED_SECRET = "synthetic retained secret";

async function exists(path: string): Promise<boolean> {
  try {
    await nodeFs.lstat(path);
    return true;
  } catch {
    return false;
  }
}

describe("run", () => {
  it("renders retained evidence after uninstall instead of claiming nothing remains", async () => {
    const fixture = await createCommandFixture("main-uninstall-bootstrap-evidence", {
      bootstrapAvailable: true,
    });
    const harness: Harness = {
      fixture,
      out: fixture.io.out,
      err: fixture.io.err,
      invoke: (argv) => run(argv, fixture.io, () => fixture.context),
    };
    expect(await harness.invoke(["init", "--yes"])).toBe(0);
    fixture.io.out.length = 0;

    expect(await harness.invoke(["uninstall", "--yes"])).toBe(0);

    expect(harness.out.join("\n")).toContain("Retained bootstrap evidence:");
    expect(harness.out.join("\n")).toContain("fresh_v2_init");
    expect(harness.out.join("\n")).not.toContain("Nothing owned by Developer OS remains.");

    /**
     * The secret is planted after the run that renders the report rather than before it.
     * Altering a retained file costs its envelope the `verified` status, which empties the
     * residue's `bootstrapParticipantIds`, and the ledger then reports the retained
     * participant staging tree as a finding — so under Task 19's gate a tampered home refuses
     * instead of reporting, and one run can no longer assert both. The refusal itself is
     * pinned in `lifecycle/mutation-gate.v2.test.ts`; what stays here is that no retained
     * byte reaches the output.
     */
    const tombstones = await retainedTombstones(fixture.root);
    const target = await firstRegularFile(tombstones);
    if (target === null) throw new Error("fixture retained no regular-file tombstone");
    await nodeFs.writeFile(target, RETAINED_SECRET, { mode: 0o600 });

    /**
     * The coordinator uninstall leaves only the A12 bookkeeping set and the retained
     * evidence, so the second run takes §6's `key_absent` arm: it succeeds, reports the
     * retained evidence again, and still discloses none of its bytes.
     */
    fixture.io.out.length = 0;
    expect(await harness.invoke(["uninstall", "--yes", "--json"])).toBe(0);
    expect(harness.out).toHaveLength(1);
    expect(harness.out[0]).toContain('"ok":true');
    expect(harness.out[0]).toContain('"removed":[]');
    expect(harness.out[0]).toContain("fresh_v2_init");
    expect(harness.out[0]).not.toContain(RETAINED_SECRET);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

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
    /** D27: the first uninstall's own Foundation residue refuses the second one. */
    expect(await harness.invoke(["uninstall", "--yes", "--json"])).toBe(6);

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

  /**
   * NEW-81 §1: the "admits every ordinary command" alteration loop below
   * exercises `uninstall` only as `--dry-run` (`ORDINARY_COMMANDS_WITHOUT_REMOVAL`),
   * so it never asserts what the gate does to a command dispatched *after* a
   * real `uninstall --yes` actually ran. This is a direct, standalone case for
   * exactly that: `uninstall --yes`'s own exit code, then a distinct ordinary
   * command's exit code, both asserted rather than exercised incidentally.
   */
  it("routes an ordinary command through the gate correctly right after uninstall --yes", async () => {
    const harness = await createHarness("main-post-uninstall-routing");

    expect(await harness.invoke(["init", "--yes"])).toBe(0);

    const uninstallCode = await harness.invoke(["uninstall", "--yes"]);
    expect(uninstallCode).toBe(0);

    const statusCode = await harness.invoke(["status"]);
    expect(statusCode).toBe(0);
  });

  /**
   * NEW-81 §3: a symlinked product home used to refuse every ordinary command
   * as exit 6 ("archive bootstrap evidence manually") through the gate's
   * catch-all, while `init`'s own `assertUsableDirectory` already refuses the
   * identical condition as exit 2, invalid input
   * (`apps/cli/src/commands/init.ts:331-345`). Both now agree.
   */
  it("refuses a symlinked product home as invalid input, matching init's own refusal for the same condition", async () => {
    const fixture = await createCommandFixture("main-symlinked-home");
    await nodeFs.symlink(fixture.userHome, fixture.paths.home);
    const invoke = (argv: readonly string[]) => run(argv, fixture.io, () => fixture.context);

    expect(await invoke(["init", "--yes", "--json"])).toBe(2);
    fixture.io.out.length = 0;

    expect(await invoke(["status", "--json"])).toBe(2);
    expect(lastJsonError(fixture.io.out)).toMatchObject({ code: 2 });
  });
});

const NON_INIT_COMMANDS = [
  ["status"],
  ["doctor"],
  ["uninstall", "--yes"],
  ["repair", "--resume", "tx_fixture_001"],
  ["capture", "--text", "synthetic observation"],
  ["review"],
  ["ingest", "--yes"],
  ["brain", "status"],
  ["search", "synthetic"],
] as const;

const ORDINARY_COMMANDS_WITHOUT_REMOVAL = NON_INIT_COMMANDS.map((argv) =>
  argv[0] === "uninstall" ? ["uninstall", "--dry-run"] : argv,
);

function lastJsonError(lines: string[]): {
  readonly code: number;
  readonly kind: string | null;
  readonly message: string | null;
} {
  const parsed = JSON.parse(lines.at(-1) ?? "null") as {
    readonly code: number;
    readonly error?: { readonly kind: string; readonly message: string };
  };
  lines.length = 0;
  return { code: parsed.code, kind: parsed.error?.kind ?? null, message: parsed.error?.message ?? null };
}

async function expectGateAdmits(
  fixture: CommandFixture,
  label: string,
  context = fixture.context,
): Promise<void> {
  for (const argv of ORDINARY_COMMANDS_WITHOUT_REMOVAL) {
    await run([...argv, "--json"], fixture.io, () => context);
    expect(lastJsonError(fixture.io.out).kind, `${label}: ${argv.join(" ")}`).not.toBe("bootstrap_recovery_required");
  }
}

/**
 * `gateMessage` and `initMessage` diverge for exactly one case (`§5` below):
 * a deep evidence-namespace shape failure that is not one of the gate's own
 * top-level roots. NEW-81 §5 scopes the redacted-class fix to the gate's own
 * catches in `apps/cli/src/bootstrap/report.ts`; `init`'s own catch-all in
 * `apps/cli/src/commands/init.ts` is untouched (out of scope for that row),
 * so it keeps publishing the bare constant for the same underlying failure.
 */
async function expectArchiveRefusalEverywhere(
  fixture: CommandFixture,
  label: string,
  gateMessage = BOOTSTRAP_MANUAL_ARCHIVE,
  initMessage = gateMessage,
): Promise<void> {
  const before = await inventoryDigest(fixture.root);
  for (const argv of NON_INIT_COMMANDS) {
    expect(await run([...argv, "--json"], fixture.io, () => fixture.context), `${label}: ${argv.join(" ")}`).toBe(6);
    expect(lastJsonError(fixture.io.out), `${label}: ${argv.join(" ")}`).toStrictEqual({
      code: 6,
      kind: "bootstrap_recovery_required",
      message: gateMessage,
    });
  }
  expect(await run(["init", "--yes", "--json"], fixture.io, () => fixture.rebuildContext()), `${label}: init`).toBe(6);
  expect(lastJsonError(fixture.io.out), `${label}: init`).toMatchObject({ code: 6, message: initMessage });
  expect(await inventoryDigest(fixture.root), label).toEqual(before);
}

describe("dispatch around a bootstrap envelope", () => {
  it("refuses every non-init command while a fresh V2 envelope is non-terminal, and none after init completes the handoff", async () => {
    const fixture = await createCommandFixture("main-bootstrap-recovery", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_manifest_publish",
    });
    const invoke = (argv: readonly string[], context = fixture.context) =>
      run(argv, fixture.io, () => context);
    expect(await invoke(["init", "--yes"])).not.toBe(0);
    fixture.io.out.length = 0;
    const before = await inventoryDigest(fixture.root);

    for (const argv of NON_INIT_COMMANDS) {
      expect(await invoke([...argv, "--json"]), argv.join(" ")).toBe(6);
      expect(lastJsonError(fixture.io.out), argv.join(" ")).toStrictEqual({
        code: 6,
        kind: "bootstrap_recovery_required",
        message: "an interrupted bootstrap must be resumed by init",
      });
    }

    expect(await inventoryDigest(fixture.root)).toEqual(before);
    expect(fixture.vendorProcesses).toStrictEqual([]);
    const bootstrap = fixture.context.bootstrap;
    if (bootstrap?.state !== "available") throw new Error("bootstrap fixture is unavailable");
    await bootstrap.executor.close();
    fixture.disableBootstrapInterrupt();
    const resumed = fixture.rebuildContext();
    expect(await invoke(["init", "--yes", "--json"], resumed)).toBe(0);
    fixture.io.out.length = 0;

    for (const argv of NON_INIT_COMMANDS) {
      await invoke([...argv, "--json"], resumed);
      expect(lastJsonError(fixture.io.out).kind, argv.join(" ")).not.toBe("bootstrap_recovery_required");
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("keeps Foundation commands working over a shipped V1 manifest while init refuses it", async () => {
    const shipped = await createHarness("main-v1-with-capability-seed");
    expect(await shipped.invoke(["init", "--yes"])).toBe(0);
    const available = await createCommandFixture("main-v1-with-capability", {
      root: shipped.fixture.root,
      bootstrapAvailable: true,
    });
    const invoke = (argv: readonly string[]) => run(argv, available.io, () => available.context);

    expect(await invoke(["init", "--yes", "--json"])).toBe(4);
    expect(lastJsonError(available.io.out)).toMatchObject({ code: 4, kind: "manifest_v1_not_migratable" });
    expect(await invoke(["status", "--json"])).toBe(0);
    expect(await invoke(["doctor", "--json"])).toBe(0);
    expect(await invoke(["uninstall", "--dry-run", "--json"])).toBe(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("admits every ordinary command when retained evidence goes missing or is altered after a complete V2 handoff", async () => {
    const fixture = await createCommandFixture("main-bootstrap-inert-after-handoff", {
      bootstrapAvailable: true,
    });
    expect(await run(["init", "--yes"], fixture.io, () => fixture.context)).toBe(0);
    fixture.io.out.length = 0;
    const state = fixture.paths.stateDir;
    const tombstones = await retainedTombstones(fixture.root);
    const stateFileTombstones: string[] = [];
    const directoryTombstones: string[] = [];
    for (const path of tombstones) {
      const stats = await nodeFs.lstat(path);
      if (stats.isDirectory()) directoryTombstones.push(path);
      else if (dirname(path) === state) stateFileTombstones.push(path);
    }
    const [missingTombstone, linkedTombstone] = stateFileTombstones;
    const [directoryTombstone] = directoryTombstones;
    if (missingTombstone === undefined || linkedTombstone === undefined || directoryTombstone === undefined) {
      throw new Error("fixture retained too few tombstones to alter");
    }
    const slots = (await nodeFs.readdir(state))
      .filter((name) => /^fresh-v2-init\.fi_.+\.journal\.[01]\.json$/u.test(name))
      .map((name) => join(state, name))
      .sort();
    const [slotZero, slotOne] = slots;
    if (slotZero === undefined || slotOne === undefined) throw new Error("fixture retained no journal slots");
    const alterations: readonly (readonly [string, () => Promise<void>])[] = [
      ["missing tombstone", () => nodeFs.rm(missingTombstone)],
      ["symlinked tombstone", async () => {
        await nodeFs.rm(linkedTombstone);
        await nodeFs.symlink("/nonexistent-retained-target", linkedTombstone);
      }],
      ["symlink inside a retained directory", () =>
        nodeFs.symlink("/nonexistent-retained-target", join(directoryTombstone, "synthetic-link"))],
      ["symlinked bootstrap lock", () =>
        nodeFs.symlink("/nonexistent-retained-target", join(state, ".lifecycle-bootstrap.lock"))],
      ["emptied journal slots", async () => {
        await nodeFs.truncate(slotZero, 0);
        await nodeFs.truncate(slotOne, 0);
      }],
      ["oversized journal slot", () => nodeFs.appendFile(slotOne, Buffer.alloc(2 * 1024 * 1024, 32))],
      ["swapped journal slot", async () => {
        await nodeFs.writeFile(`${slotZero}.replacement`, "{}\n", { mode: 0o600 });
        await nodeFs.rename(`${slotZero}.replacement`, slotZero);
      }],
    ];
    expect(alterations.length).toBeGreaterThan(0);

    for (const [label, alter] of alterations) {
      await alter();
      await expectGateAdmits(fixture, label);
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses every non-init command with init's own archive guidance when an interrupted envelope's plan or slot stops matching", async () => {
    const fixture = await createCommandFixture("main-bootstrap-malformed-active", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_first_payload",
    });
    expect(await run(["init", "--yes"], fixture.io, () => fixture.context)).not.toBe(0);
    fixture.io.out.length = 0;
    const bootstrap = fixture.context.bootstrap;
    if (bootstrap?.state !== "available") throw new Error("bootstrap fixture is unavailable");
    await bootstrap.executor.close();
    fixture.disableBootstrapInterrupt();
    const state = fixture.paths.stateDir;
    const names = await nodeFs.readdir(state);
    const plan = names.find((name) => /^fresh-v2-init\.fi_.+\.plan\.json$/u.test(name));
    const slot = names.find((name) => /^fresh-v2-init\.fi_.+\.journal\.0\.json$/u.test(name));
    if (plan === undefined || slot === undefined) throw new Error("interrupted init left no envelope");
    const planPath = join(state, plan);
    const planBytes = await nodeFs.readFile(planPath);

    await nodeFs.writeFile(planPath, "{}\n");
    await expectArchiveRefusalEverywhere(fixture, "plan no longer validates");
    await nodeFs.writeFile(planPath, planBytes);

    const slotPath = join(state, slot);
    await nodeFs.copyFile(slotPath, `${slotPath}.replacement`);
    await nodeFs.rename(`${slotPath}.replacement`, slotPath);
    await expectArchiveRefusalEverywhere(fixture, "replaced slot inode");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses only genuine bootstrap residue in a home where bootstrap never ran, with the guidance init gives", async () => {
    const shipped = await createHarness("main-v1-bootstrap-residue");
    expect(await shipped.invoke(["init", "--yes"])).toBe(0);
    const state = shipped.fixture.paths.stateDir;
    await nodeFs.symlink("/nonexistent-user-target", join(state, "unrelated-user-link"));
    shipped.fixture.io.out.length = 0;
    await expectGateAdmits(shipped.fixture, "unrelated symlink");

    const lock = join(state, ".lifecycle-bootstrap.lock");
    await nodeFs.symlink("/nonexistent-bootstrap-target", lock);
    /**
     * A symlinked lock is a deep evidence-namespace shape failure, not one of
     * the gate's own top-level roots (`productHome`/`stateDirectory`/`$HOME`),
     * so it is not `BootstrapRootInvalidError` (NEW-81 §3) — it still reaches
     * the gate's catch-all, which now publishes the failure's redacted class
     * alongside the archive-manually text (NEW-81 §5). `init`'s own separate
     * catch-all is untouched (out of scope for §5) and keeps the bare message.
     */
    await expectArchiveRefusalEverywhere(
      shipped.fixture,
      "symlinked bootstrap lock",
      `${BOOTSTRAP_MANUAL_ARCHIVE} (inspection failed: Error)`,
      BOOTSTRAP_MANUAL_ARCHIVE,
    );
    await nodeFs.rm(lock);

    const staging = join(shipped.fixture.paths.stagingDir, "fresh-v2-init", "fi_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    await nodeFs.mkdir(staging, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(join(staging, "live-source"), "synthetic live residue\n", { mode: 0o600 });
    await expectArchiveRefusalEverywhere(shipped.fixture, "live staging residue");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses every command, and init, when a planted manifest declaring schema version 2 fails strict validation", async () => {
    const planted = await createHarness("main-planted-v2-manifest");
    expect(await planted.invoke(["init", "--yes"])).toBe(0);
    await nodeFs.writeFile(planted.fixture.paths.manifestFile, `${JSON.stringify({ schemaVersion: 2 })}\n`);
    planted.fixture.io.out.length = 0;
    await expectArchiveRefusalEverywhere(planted.fixture, "planted V2 manifest", MALFORMED_V2_MANIFEST);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses every command, and init, when a shipped V2 manifest is altered into an invalid one", async () => {
    const installed = await createCommandFixture("main-corrupted-v2-manifest", { bootstrapAvailable: true });
    expect(await run(["init", "--yes"], installed.io, () => installed.context)).toBe(0);
    const manifest = JSON.parse(await nodeFs.readFile(installed.paths.manifestFile, "utf8")) as Record<string, unknown>;
    expect(manifest.schemaVersion).toBe(2);
    await nodeFs.writeFile(
      installed.paths.manifestFile,
      `${JSON.stringify({ ...manifest, productVersion: "not a stable version" })}\n`,
    );
    installed.io.out.length = 0;
    await expectArchiveRefusalEverywhere(installed, "corrupted shipped V2 manifest", MALFORMED_V2_MANIFEST);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("does not refuse a valid V2 install as a malformed manifest when its configuration is unparseable or its Brain moved", async () => {
    const seed = await createCommandFixture("main-v2-config-independent");
    const customBrain = join(seed.userHome, "ElsewhereBrain");
    const installer = await createCommandFixture("main-v2-config-independent-install", {
      root: seed.root,
      bootstrapAvailable: true,
      env: { DEVELOPER_OS_BRAIN: customBrain },
    });
    expect(await run(["init", "--yes"], installer.io, () => installer.context)).toBe(0);
    const ordinary = await createCommandFixture("main-v2-config-independent-ordinary", { root: seed.root });
    const configFile = ordinary.paths.configFile;
    const validConfig = await nodeFs.readFile(configFile, "utf8");
    expect(validConfig).toContain(customBrain);
    const states: readonly (readonly [string, string])[] = [
      ["unparseable configuration", "schemaVersion = [ not toml\n"],
      ["relocated Brain", serializeConfig({
        schemaVersion: 1,
        brainPath: join(seed.userHome, "MovedBrain"),
        adapters: { claude: false, codex: false },
        git: { enabled: false },
        automation: { enabled: false },
        telemetry: false,
      })],
    ];
    expect(states.length).toBeGreaterThan(0);

    for (const [label, config] of states) {
      await nodeFs.writeFile(configFile, config, { mode: 0o600 });
      for (const argv of [["doctor"], ["status"]]) {
        await run([...argv, "--json"], ordinary.io, () => ordinary.context);
        const published = lastJsonError(ordinary.io.out);
        expect.soft(published.kind, `${label}: ${argv.join(" ")}`).not.toBe("bootstrap_recovery_required");
        expect.soft(published.message, `${label}: ${argv.join(" ")}`).not.toBe(MALFORMED_V2_MANIFEST);
      }
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * NEW-81 §6: the pre-publication resume branch — an `after_plan` envelope
   * whose plan is durable but has not written its first journal slot — was
   * pinned only by its exit code everywhere it was exercised. This fixture's
   * `bootstrapAvailable` flag already exercises real fresh-V2 bootstrap ahead
   * of the production launcher wiring (every test in this describe block
   * does), so the branch is reachable here, not a stub; this pins `kind`,
   * `message` and `recovery` too.
   */
  it("names the pre-publication resume branch's kind, message and recovery, not only its exit code", async () => {
    const fixture = await createCommandFixture("main-bootstrap-after-plan-resume", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_plan",
    });
    const invoke = (argv: readonly string[]) => run(argv, fixture.io, () => fixture.context);
    expect(await invoke(["init", "--yes"])).not.toBe(0);
    fixture.io.out.length = 0;

    const code = await invoke(["status", "--json"]);
    expect(code).toBe(6);
    const published = JSON.parse(fixture.io.out.at(-1) ?? "null") as {
      readonly code: number;
      readonly error?: { readonly kind: string; readonly message: string; readonly recovery?: string };
    };
    expect(published).toMatchObject({
      code: 6,
      error: {
        kind: "bootstrap_recovery_required",
        message: "an interrupted bootstrap must be resumed by init",
        recovery: "developer-os init",
      },
    });

    const bootstrap = fixture.context.bootstrap;
    if (bootstrap?.state === "available") await bootstrap.executor.close();
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("config dispatch", () => {
  it("refuses an option config does not accept", async () => {
    await refuses(["config", "get", "--dry-run"]);
    await refuses(["config", "get", "--limit", "5"]);
  });

  it("refuses an operation config does not have", async () => {
    await refuses(["config", "unset", "telemetry"]);
    await refuses(["config", "toString"]);
  });

  it("refuses a set that names no value, and a get that names two keys", async () => {
    await refuses(["config", "set", "telemetry"]);
    await refuses(["config", "get", "telemetry", "adapters.claude"]);
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

  it("refuses --note without a value, and --note on a command that does not take it", async () => {
    await refuses(["capture", "--note"]);
    await refuses(["review", "--note", "DEV/a.md"]);
  });

  it("parses --note with --text and hands both to capture", async () => {
    const fixture = await createCommandFixture("main-capture-note");
    expect(await run(["init", "--yes"], fixture.io, () => fixture.context)).toBe(0);
    fixture.io.out.length = 0;

    /** `x` is not a note, so capture itself refuses it: proof `--note` got past the parser. */
    const code = await run(
      ["capture", "--note", "DEV/a.md", "--text", "x", "--json"],
      fixture.io,
      () => fixture.context,
    );

    expect(code).toBe(EXIT_CODES.invalidInput);
    expect(lastJsonError(fixture.io.out).kind).toBe("capture_note_invalid");
  });
});

describe("review dispatch", () => {
  it("refuses an option review does not accept", async () => {
    await refuses(["review", "--limit", "5"]);
    await refuses(["review", "--text", "hi"]);
  });

  /**
   * The two cases that go red if `id` or `decision` joins `OPTIONS` without
   * joining `OPTION_NAMES`: `suppliedOptions` filters `OPTION_NAMES`, so an
   * option missing from it is invisible to the per-command allow-list and
   * *every* command silently accepts it — strict dispatch holed for all of
   * them, not only the new one. The `--limit` case above stays green through
   * that hole, which is why these are here.
   */
  it("refuses --id and --decision on a command that does not take them", async () => {
    await refuses(["status", "--id", "0f1e2d3c4b5a6978"]);
    await refuses(["status", "--decision", "accept"]);
    await refuses(["capture", "--decision", "accept"]);
  });

  it("refuses a positional, because review names its capture with --id", async () => {
    await refuses(["review", "0f1e2d3c4b5a6978"]);
  });

  it("accepts every well-formed review invocation", async () => {
    /**
     * These reach the command, which then refuses because the fixture has no
     * configuration — exit 2 either way, so the assertion that distinguishes
     * parse from command is the stderr text. A loop rather than `it.each`,
     * matching the brain suite below: the three argv arrays share a first
     * element, and `%s` would name all three cases `review`.
     */
    for (const argv of [
      ["review"],
      ["review", "--json"],
      ["review", "--id", "0f1e2d3c4b5a6978", "--decision", "accept"],
      ["review", "--id", "0f1e2d3c4b5a6978", "--decision", "edit"],
      ["review", "--status", "accepted"],
    ]) {
      const fixture = await createCommandFixture(`ok-${argv.join("-")}`);
      const lines: string[] = [];
      await run(argv, collectingIo(lines), () => fixture.context);
      expect(lines.join("\n"), argv.join(" ")).toContain(
        "Developer OS is not initialized",
      );
    }
  });
});

/**
 * **The one case that pins where `--status` is validated**, and it has to run on
 * an *uninstalled* fixture to do it.
 *
 * `BACKLOG.md` §1 NEW-46's neighbouring lesson applies here: a check that runs
 * late is not the check it claims to be. `listedStatus` first sat where the
 * listing needed it — four lines below `loadOrCreateRedactionKey` — so a
 * mistyped flag on an uninstalled machine was answered "Developer OS is not
 * initialized", and on an installed one **wrote a durable secret to disk before
 * refusing a typo**. Every case in `review.test.ts` uses an installed fixture,
 * where a key already exists, so none of them could tell the two positions
 * apart; a fresh-context review found the fix unpinned on 2026-08-21.
 *
 * Here the vault is absent, so the two answers differ: validated first, the
 * refusal names the status; validated late, it names the installation.
 */
describe("review validates --status before it touches anything", () => {
  it("refuses a bad status on an uninstalled machine rather than reporting the install", async () => {
    const fixture = await createCommandFixture("status-before-config");
    const lines: string[] = [];

    await run(["review", "--status", "pending"], collectingIo(lines), () => fixture.context);

    const output = lines.join("\n");
    expect(output).toContain("not a capture status");
    expect(
      output,
      "answering with the installation means the status was validated too late",
    ).not.toContain("Developer OS is not initialized");
  });
});

/**
 * **`renderReview` had no test anywhere in the tree until 2026-08-21**, which is
 * how a heading that said `Quarantined captures:` over rejected ids shipped, and
 * then how its first correction broke the default it claimed not to touch. Both
 * were found by a fresh-context review rather than by a failing case — twice.
 *
 * Unit cases rather than a dispatch fixture: the function is pure in
 * `(result, requested)`, and the strings *are* the contract. A round trip
 * through `run` would exercise the same two lines while making the assertion
 * about everything else in the command.
 */
describe("renderReview", () => {
  const listing = (
    captures: readonly {
      captureId: string;
      status: string;
      note?: { path: string; replaces: boolean } | null;
      redactionCount?: number;
    }[],
  ): ReviewResultV1 =>
    ({
      schemaVersion: 1,
      captures: captures.map((capture) => ({ note: null, redactionCount: 0, ...capture })),
      reviewed: 0,
    }) as unknown as ReviewResultV1;

  it("names the quarantine queue when no status was asked for", () => {
    expect(renderReview(listing([{ captureId: "aa00bb11cc22dd33", status: "quarantined" }]), null))
      .toStrictEqual(["Quarantined captures:", "  aa00bb11cc22dd33"]);
  });

  it("names the status that was asked for", () => {
    expect(renderReview(listing([{ captureId: "aa00bb11cc22dd33", status: "accepted" }]), "accepted"))
      .toStrictEqual(["Captures at accepted:", "  aa00bb11cc22dd33"]);
  });

  it("names the note a note capture creates or replaces, with its redaction count", () => {
    expect(
      renderReview(
        listing([
          { captureId: "aa00bb11cc22dd33", status: "quarantined", note: { path: "DEV/a.md", replaces: false } },
          {
            captureId: "bb00bb11cc22dd33",
            status: "quarantined",
            note: { path: "DEV/a.md", replaces: true },
            redactionCount: 2,
          },
          { captureId: "cc00bb11cc22dd33", status: "quarantined" },
        ]),
        null,
      ),
    ).toStrictEqual([
      "Quarantined captures:",
      "  aa00bb11cc22dd33  creates DEV/a.md (0 redactions)",
      "  bb00bb11cc22dd33  replaces DEV/a.md (2 redactions)",
      "  cc00bb11cc22dd33",
    ]);
  });

  it("keeps the original empty line on the default path", () => {
    /**
     * The regression this pins: a renderer that derived the heading from row
     * zero had nothing to derive from when the list was empty, so a bare
     * `review` told a user who named no status that none were "at that status".
     */
    expect(renderReview(listing([]), null)).toStrictEqual([
      "No captures are waiting for review.",
    ]);
  });

  it("names the status in the empty line when one was asked for", () => {
    expect(renderReview(listing([]), "ingested")).toStrictEqual([
      "No captures are at ingested.",
    ]);
  });

  it("echoes the frozen constant, never the caller's string", () => {
    /**
     * A status that is not a `CaptureStatus` cannot reach this function through
     * the CLI — `listedStatus` refuses first — so this pins the second line of
     * defence rather than a reachable path: the rendered name comes from
     * `CAPTURE_STATUSES`, so nothing user-typed is echoed even if a future
     * caller forgets to validate.
     */
    expect(renderReview(listing([]), "quarantined\u0007evil")).toStrictEqual([
      "No captures are waiting for review.",
    ]);
  });

  it("reports decisions rather than a listing when one was taken", () => {
    const decided = {
      schemaVersion: 1,
      captures: [{ captureId: "aa00bb11cc22dd33", status: "rejected" }],
      reviewed: 1,
    } as unknown as ReviewResultV1;
    expect(renderReview(decided, "accepted")).toStrictEqual([
      "Reviewed aa00bb11cc22dd33, now rejected.",
    ]);
  });
});

describe("ingest dispatch", () => {
  it("refuses an option ingest does not accept", async () => {
    await refuses(["ingest", "--text", "hi"]);
    await refuses(["ingest", "--id", "0f1e2d3c4b5a6978"]);
    await refuses(["ingest", "--dry-run"]);
  });

  /**
   * The case that goes red if `agent` joins `OPTIONS` without joining
   * `OPTION_NAMES`: `suppliedOptions` filters `OPTION_NAMES`, so an option
   * missing from it is invisible to the per-command allow-list and *every*
   * command silently accepts it — strict dispatch holed for all of them, not
   * only the new one. The cases above stay green through that hole, which is
   * why this one is here.
   */
  it("refuses --agent on a command that does not take it", async () => {
    await refuses(["status", "--agent", "claude"]);
    await refuses(["review", "--agent", "claude"]);
    await refuses(["brain", "lint", "--agent", "claude"]);
  });

  it("refuses a positional, because ingest names no capture", async () => {
    await refuses(["ingest", "0f1e2d3c4b5a6978"]);
  });

  it("refuses a --limit that is not a positive integer", async () => {
    await refuses(["ingest", "--limit", "0"]);
    await refuses(["ingest", "--limit", "-1"]);
    await refuses(["ingest", "--limit", "many"]);
  });

  it("accepts every well-formed ingest invocation", async () => {
    /**
     * These reach the command, which then refuses because the fixture has no
     * configuration — so the assertion that distinguishes parse from command is
     * the stderr text rather than the exit code.
     */
    for (const argv of [
      ["ingest"],
      ["ingest", "--json"],
      ["ingest", "--yes"],
      ["ingest", "--limit", "2"],
      ["ingest", "--agent", "codex"],
      ["ingest", "--agent", "claude", "--limit", "1", "--json", "--yes"],
    ]) {
      const fixture = await createCommandFixture(`ok-${argv.join("-")}`);
      const lines: string[] = [];
      await run(argv, collectingIo(lines), () => fixture.context);
      expect(lines.join("\n"), argv.join(" ")).toContain(
        "Developer OS is not initialized",
      );
    }
  });
});

describe("doctor dispatch", () => {
  /**
   * The case that goes red if `probe` joins `OPTIONS` without joining
   * `OPTION_NAMES`: `suppliedOptions` filters `OPTION_NAMES`, so an option
   * missing from it is invisible to the per-command allow-list and *every*
   * command silently accepts it — strict dispatch holed for all of them rather
   * than only the one that gained the flag. It is the third task in a row to
   * need this pin, which is why it is written rather than assumed.
   */
  it("refuses --probe on a command that does not take it", async () => {
    await refuses(["status", "--probe"]);
    await refuses(["ingest", "--probe"]);
    await refuses(["init", "--probe"]);
    await refuses(["brain", "lint", "--probe"]);
  });

  it("refuses an option doctor does not accept", async () => {
    await refuses(["doctor", "--dry-run"]);
    await refuses(["doctor", "--agent", "claude"]);
  });

  /**
   * Dispatch has to *thread* the flag, not merely parse it. The mutation notice
   * is what proves it arrived: `runDoctor` emits it on stderr before any check
   * runs, and only when probing was asked for.
   */
  it("threads --probe through to the command, and only when it is passed", async () => {
    const quiet = await createHarness("main-doctor-no-probe");
    expect(await quiet.invoke(["doctor"])).toBe(1);
    expect(quiet.err.join("\n")).not.toContain(".claude.json");

    const probing = await createHarness("main-doctor-probe");
    expect(await probing.invoke(["doctor", "--probe"])).toBe(1);
    expect(probing.err.join("\n")).toContain(".claude.json");
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

  it.each([
    [["brain", "retire", "DEV/a.md"], true],
    [["brain", "retire", "DEV/a.md", "--dry-run", "--json"], true],
    [["brain", "refactor", "--rename", "DEV/a.md", "b.md"], true],
    [["brain", "refactor", "--move", "DEV/a.md", "TOOLS"], true],
    [["brain", "refactor", "--merge", "DEV/a.md", "DEV/b.md", "--dry-run"], true],
    [["brain", "refactor", "--split", "DEV/a.md", "Deep Dive"], true],
    [["brain", "refactor", "DEV/a.md", "b.md"], false], // zero mode flags
    [["brain", "refactor", "--rename", "--move", "DEV/a.md", "b.md"], false], // two
    [["brain", "refactor", "--rename", "DEV/a.md"], false], // one positional
    [["brain", "retire"], false],
    [["brain", "retire", "a", "b"], false],
    [["brain", "retire", "DEV/a.md", "--yes"], false],
    [["brain", "lint", "--rename"], false],
  ] as const)("parses %j → %s", async (argv, accepted) => {
    if (!accepted) {
      await refuses(argv);
      return;
    }
    /**
     * Accepted cases reach the command, which refuses because the fixture has
     * no configuration: exit 2 either way, so the stderr text is what tells
     * parse from command. `env` is `{}`, so no agent-session refusal intervenes.
     */
    const fixture = await createCommandFixture(`refactor-parse-${argv.join("-").replace(/[^A-Za-z0-9-]/gu, "_")}`);
    const lines: string[] = [];
    await run(argv, collectingIo(lines), () => fixture.context);
    expect(lines.join("\n"), argv.join(" ")).toContain("Developer OS is not initialized");
  });

  it("admits both verbs through assertOrdinaryCommandAdmitted like every non-init command", async () => {
    /**
     * `bootstrapEvidenceInspections` counts the context's `inspectEvidence`, which the gate
     * does not call, so the gate is observed by what it refuses: a non-terminal V2 envelope
     * refuses every non-init command as exit 6 before the command runs.
     */
    const fixture = await createCommandFixture("main-refactor-admission", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_manifest_publish",
    });
    const invoke = (argv: readonly string[]) => run(argv, fixture.io, () => fixture.context);
    expect(await invoke(["init", "--yes"])).not.toBe(0);
    fixture.io.out.length = 0;
    const before = await inventoryDigest(fixture.root);

    for (const argv of [
      ["brain", "retire", "DEV/a.md"],
      ["brain", "refactor", "--rename", "DEV/a.md", "b.md"],
    ]) {
      expect(await invoke([...argv, "--json"]), argv.join(" ")).toBe(6);
      expect(lastJsonError(fixture.io.out).kind, argv.join(" ")).toBe("bootstrap_recovery_required");
    }
    expect(await inventoryDigest(fixture.root)).toEqual(before);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

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

describe("import and project dispatch", () => {
  it.each([
    [["import", "a", "b"]],
    [["import", "notes", "--claude-memory"]], // import_path_conflict → usage, exit 2
    [["import", "--yes"]],
    [["import", "--text", "x"]],
    [["import", "--limit", "0"]],
    [["project"]],
    [["project", "worktree"]], // refused verb, no dispatch entry
    [["project", "init", "a", "b"]],
    [["project", "check", "--dry-run"]],
    [["project", "init", "--limit", "3"]],
    [["project", "toString"]],
    [["repo", "audit"]],
    [["repo", "secrets-scan"]],
  ])("refuses the argv %j before building a context", async (argv) => {
    const io = new RecordingIo();
    expect(
      await run(argv, io, () => {
        throw new Error("context must not be built");
      }),
    ).toBe(EXIT_CODES.invalidInput);
    expect(io.err.join("\n")).toContain("Usage: developer-os <command> [options]");
  });

  it.each([
    [["import"]],
    [["import", "notes"]],
    [["import", "--claude-memory"]],
    [["import", "--dry-run", "--limit", "5", "--json"]],
  ])("admits %j and reaches import, which refuses the uninitialized fixture, exit 1", async (argv) => {
    const fixture = await createCommandFixture("dispatch-a14");
    expect(await run(argv, fixture.io, () => fixture.context)).toBe(
      EXIT_CODES.operationalFailure,
    );
    const output = [...fixture.io.out, ...fixture.io.err].join("\n");
    expect(output).not.toContain("Usage: developer-os <command>");
    expect(output).toContain("Developer OS is not initialized, so there is no vault to import into");
  });

  it("publishes import's uninitialized refusal as kind not_initialized", async () => {
    const fixture = await createCommandFixture("dispatch-a14-kind");
    await run(["import", "--dry-run", "--json"], fixture.io, () => fixture.context);
    expect(lastJsonError(fixture.io.out)).toMatchObject({
      code: EXIT_CODES.operationalFailure,
      kind: "not_initialized",
    });
  });

  /** The fixture is not initialized, so `project init` refuses before it touches a target. */
  it.each([
    [["project", "init"]],
    [["project", "init", "some-dir", "--dry-run", "--json"]],
  ])("admits %j and reaches project init's not-initialized refusal, exit 1", async (argv) => {
    const fixture = await createCommandFixture("dispatch-a14");
    expect(await run(argv, fixture.io, () => fixture.context)).toBe(
      EXIT_CODES.operationalFailure,
    );
  });

  it("admits project check with a directory and reaches its missing-directory refusal", async () => {
    const fixture = await createCommandFixture("dispatch-a14");
    expect(
      await run(["project", "check", "some-dir", "--json"], fixture.io, () => fixture.context),
    ).toBe(EXIT_CODES.invalidInput);
    expect(lastJsonError(fixture.io.out).kind).toBe("project_root_not_directory");
  });

  it("admits a bare project check", async () => {
    /** It checks the process's working directory, so only admission is deterministic here. */
    const fixture = await createCommandFixture("dispatch-a14");
    await run(["project", "check"], fixture.io, () => fixture.context);
    expect(fixture.io.err.join("\n")).not.toContain("Usage: developer-os <command>");
  });

  it("lists import and project in the usage text", async () => {
    const io = new RecordingIo();
    await run(["--nope"], io, () => {
      throw new Error("unused");
    });
    const usage = io.err.join("\n");
    expect(usage).toContain("  import     ");
    expect(usage).toContain("  project    ");
    expect(usage).toContain("--claude-memory");
  });
});

describe("init --local-release dispatch", () => {
  const CONTEXT_REFUSED = Object.assign(new Error("context refused on purpose"), {
    code: EXIT_CODES.capabilityUnavailable,
  });

  it("passes the named directory to the context factory, for init only", async () => {
    const requests: unknown[] = [];
    const recording: CliContextFactory = (_io, request) => {
      requests.push(request);
      throw CONTEXT_REFUSED;
    };
    const lines: string[] = [];

    expect(await run(["init", "--yes", "--local-release", "/x"], collectingIo(lines), recording)).toBe(
      EXIT_CODES.capabilityUnavailable,
    );
    expect(await run(["init", "--yes"], collectingIo(lines), recording)).toBe(EXIT_CODES.capabilityUnavailable);
    expect(requests).toStrictEqual([{ localRelease: "/x" }, { localRelease: null }]);
  });

  it("refuses --local-release on every other command at parse time", async () => {
    const others: readonly (readonly string[])[] = [
      ["status"],
      ["doctor"],
      ["uninstall"],
      ["repair"],
      ["capture"],
      ["review"],
      ["ingest"],
      ["import"],
      ["config", "get"],
      ["brain", "status"],
      ["search", "query"],
      ["project", "check"],
    ];
    expect(others.length).toBeGreaterThan(0);
    for (const argv of others) await refuses([...argv, "--local-release", "/x"]);
  });

  it("refuses an empty --local-release value", async () => {
    await refuses(["init", "--local-release="]);
  });

  it("emits the admission's exit code when the factory rejects with it", async () => {
    const lines: string[] = [];
    const admitting: CliContextFactory = async (_io, request) => {
      await admitUnsignedLocalPackagedRelease(request.localRelease ?? "", PRODUCT_VERSION);
      throw new Error("a relative package root was admitted");
    };

    const code = await run(["init", "--yes", "--local-release", "relative/pkg"], collectingIo(lines), admitting);

    expect(code).toBe(EXIT_CODES.securityRefusal);
    expect(lines.join("\n")).toContain("packaged release root must already be canonical");
  });
});

describe("init --adapters parsing", () => {
  it("accepts the four documented values on init only", async () => {
    const CONTEXT_REFUSED = Object.assign(new Error("context refused on purpose"), {
      code: EXIT_CODES.capabilityUnavailable,
    });
    const refusing: CliContextFactory = () => {
      throw CONTEXT_REFUSED;
    };
    for (const value of ["claude,codex", "claude", "codex", "none"]) {
      const lines: string[] = [];
      expect(await run(["init", "--yes", "--adapters", value], collectingIo(lines), refusing), value).toBe(
        EXIT_CODES.capabilityUnavailable,
      );
      expect(lines.join("\n")).not.toContain("Usage: developer-os <command>");
    }
  });

  it("refuses any other value at parse time", async () => {
    const values = ["", "codex,claude", "all", "claude,claude", "Claude"];
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) await refuses(["init", `--adapters=${value}`]);
  });

  it("refuses --adapters on every other command at parse time", async () => {
    const others: readonly (readonly string[])[] = [["status"], ["doctor"], ["uninstall"], ["config", "get"]];
    expect(others.length).toBeGreaterThan(0);
    for (const argv of others) await refuses([...argv, "--adapters", "claude"]);
  });

  it("names the option in the usage text", async () => {
    const io = new RecordingIo();
    await run(["--nope"], io, () => {
      throw new Error("unused");
    });
    expect(io.err.join("\n")).toContain("--adapters <a>");
  });
});

describe("hook-mode routing", () => {
  const hookEnvironment: HookEnvironment = {
    env: {},
    userHome: "/Users/synthetic",
    processCwd: () => "/Users/synthetic/p",
    nodeExecutable: "/usr/local/bin/node",
  };

  it("routes guard prompt --vendor bogus to allow, never to usage exit 2", async () => {
    const io = new RecordingIo();
    expect(await run(["guard", "prompt", "--vendor", "bogus"], io, neverCreatesContext, hookEnvironment)).toBe(0);
    expect(io.out).toStrictEqual([]);
    expect(io.err).toHaveLength(1);
    expect(io.err.join("\n")).not.toContain("Usage: developer-os");
  });

  it("routes guard command with a parse failure to block", async () => {
    const io = new RecordingIo();
    expect(await run(["guard", "command"], io, neverCreatesContext, hookEnvironment)).toBe(2);
    expect(io.out).toStrictEqual([]);
    expect(io.err.join("\n")).toContain("hook-failed-closed");
    expect(io.err.join("\n")).not.toContain("Usage: developer-os");
  });

  it("routes --inject with --json to allow without a usage block", async () => {
    const io = new RecordingIo();
    expect(await run(["brain", "status", "--inject", "--json", "--vendor", "claude"], io, neverCreatesContext, hookEnvironment)).toBe(0);
    expect(io.out).toStrictEqual([]);
  });

  it("leaves ordinary dispatch unchanged", async () => {
    await refuses(["nonsense"]);
  });
});
