import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES, TransactionExecutor } from "@developer-os/core";

import { runCapture } from "../commands/capture.js";
import { runInit } from "../commands/init.js";
import {
  createCommandFixture,
  exists,
  inventoryDigest,
  removeCommandFixtures,
} from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import type { CliContext } from "../context.js";
import {
  classifyMutationHome,
  createGatedTransactionExecutor,
  isGatedTransactionExecutor,
} from "./mutation-gate.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const OBSERVATION = "synthetic observation";

/** Every command that mutates Foundation state through `context.executor`. */
const MUTATORS = ["capture", "ingest", "review", "reindex", "uninstall", "init"] as const;

function globalLockPath(fixture: CommandFixture): string {
  return join(fixture.paths.stateDir, ".lifecycle.lock");
}

/** The exact shape §2.3 admits: an owner-only zero-byte single-link regular file. */
async function plantGlobalLock(fixture: CommandFixture): Promise<void> {
  await nodeFs.mkdir(fixture.paths.stateDir, { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(globalLockPath(fixture), new Uint8Array(), { mode: 0o600 });
  await nodeFs.chmod(globalLockPath(fixture), 0o600);
}

function captureIn(fixture: CommandFixture, project: string): ReturnType<typeof runCapture> {
  return runCapture(fixture.context, { text: OBSERVATION }, { cwd: () => project, detect: () => "unknown" });
}

async function installedV1(label: string): Promise<{
  readonly fixture: CommandFixture;
  readonly project: string;
}> {
  const fixture = await createCommandFixture(label);
  expect((await runInit(fixture.context, ACCEPTED)).ok, "the fixture must install").toBe(true);
  const project = join(fixture.root, "Sample Project");
  await nodeFs.mkdir(project, { recursive: true, mode: 0o700 });
  return { fixture, project };
}

async function journalIds(fixture: CommandFixture): Promise<readonly string[]> {
  const root = join(fixture.paths.stateDir, "transactions");
  const names = await nodeFs.readdir(root).catch(() => [] as string[]);
  return names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -".json".length)).sort();
}

/** A real executor over the fixture's own paths whose every issued ID is recorded. */
function probeLegacyExecutor(
  context: CliContext,
  issued: string[],
): TransactionExecutor {
  return new TransactionExecutor({
    stateDir: context.paths.stateDir,
    stagingDir: context.paths.stagingDir,
    backupsDir: context.paths.backupsDir,
    fs: context.fs,
    clock: () => context.now().toISOString(),
    generateId: () => {
      issued.push(`tx_probe_${String(issued.length)}`);
      return `tx_probe_${String(issued.length - 1)}`;
    },
    guards: context.guards.transaction,
    lockProvider: { acquire: () => Promise.resolve({ release: () => Promise.resolve() }) },
  });
}

describe("the mutation gate on a home that is not an admitted V2 installation", () => {
  it("captures on a V1 home with the legacy executor's own ID and never creates a global lock", async () => {
    const { fixture, project } = await installedV1("gate-v1-capture");

    const captured = await captureIn(fixture, project);

    expect(captured.ok).toBe(true);
    const ids = await journalIds(fixture);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^tx_fixture_[0-9]{3}$/u);
    expect(await exists(globalLockPath(fixture))).toBe(false);
    expect(fixture.stableLockEvents).toStrictEqual([]);
  });

  it("runs V1 init's own transaction through the gated executor and takes the legacy path", async () => {
    const fixture = await createCommandFixture("gate-v1-init");

    expect(isGatedTransactionExecutor(fixture.context.executor)).toBe(true);
    expect(await classifyMutationHome(fixture.context, fixture.context.lifecycle)).toStrictEqual({
      kind: "manifest_absent",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);

    const ids = await journalIds(fixture);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^tx_fixture_[0-9]{3}$/u);
    expect(await exists(globalLockPath(fixture))).toBe(false);
    expect(fixture.stableLockEvents).toStrictEqual([]);
    expect(await classifyMutationHome(fixture.context, fixture.context.lifecycle)).toStrictEqual({
      kind: "v1",
    });
  });

  it("refuses the capability-less init transaction with exit 2 beside a global lock, and creates nothing", async () => {
    const fixture = await createCommandFixture("gate-absent-with-lock-init");
    await plantGlobalLock(fixture);

    expect(await classifyMutationHome(fixture.context, fixture.context.lifecycle)).toStrictEqual({
      kind: "manifest_absent_with_global_lock",
    });
    expect(await runInit(fixture.context, ACCEPTED)).toMatchObject({
      ok: false,
      code: EXIT_CODES.invalidInput,
    });
    /**
     * `init` creates its own directory scaffold and the redaction key before it plans a
     * transaction, so the claim the gate owns is that nothing the transaction would have
     * written exists: no journal, no manifest, no managed artifact.
     */
    expect(await journalIds(fixture)).toStrictEqual([]);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
    expect(await exists(fixture.paths.configFile)).toBe(false);
  });

  it("refuses a capture with exit 2 once the manifest is gone and the global lock is not", async () => {
    const { fixture, project } = await installedV1("gate-absent-with-lock-capture");
    await nodeFs.rm(fixture.paths.manifestFile);
    await plantGlobalLock(fixture);
    const before = await inventoryDigest(fixture.root);

    expect(await captureIn(fixture, project)).toMatchObject({
      ok: false,
      code: EXIT_CODES.invalidInput,
    });
    expect(await inventoryDigest(fixture.root)).toStrictEqual(before);
  });

  /**
   * `createProductionContext` leaves `lifecycle` absent whenever the product home is not a
   * `CanonicalAbsolutePathV1`, which a decomposed macOS user name makes ordinary. Falling
   * through to the legacy executor there would write an unallocated `tx_<uuid>` journal into
   * a V2 ledger, so the gate refuses instead.
   */
  it("refuses a V2 manifest with no lifecycle context rather than falling through to the legacy executor", async () => {
    const { fixture } = await installedV1("gate-v2-without-lifecycle");
    await nodeFs.writeFile(fixture.paths.manifestFile, '{"schemaVersion":2}\n', { mode: 0o600 });
    const context: CliContext = { ...fixture.context, lifecycle: undefined };
    const issued: string[] = [];
    const gated = createGatedTransactionExecutor({
      context: () => context,
      lifecycle: undefined,
      legacy: probeLegacyExecutor(context, issued),
      allocated: () => probeLegacyExecutor(context, issued),
    });

    await expect(classifyMutationHome(context, undefined)).rejects.toMatchObject({
      reason: "lifecycle_context_unavailable",
      code: EXIT_CODES.capabilityUnavailable,
    });
    await expect(
      gated.execute({
        kind: "capture",
        mutations: [
          { targetPath: join(fixture.paths.home, "probe.txt"), operation: "create", content: new Uint8Array([1]) },
        ],
      }),
    ).rejects.toMatchObject({
      reason: "lifecycle_context_unavailable",
      code: EXIT_CODES.capabilityUnavailable,
    });
    expect(issued).toStrictEqual([]);
    expect(await exists(join(fixture.paths.home, "probe.txt"))).toBe(false);
  });

  it("routes every Foundation mutator at the gated executor the composition root wires", async () => {
    const fixture = await createCommandFixture("gate-wiring");

    expect(MUTATORS.length).toBeGreaterThan(0);
    expect(isGatedTransactionExecutor(fixture.context.executor)).toBe(true);
    expect(isGatedTransactionExecutor(fixture.rebuildContext().executor)).toBe(true);
    for (const command of MUTATORS) {
      const source = await nodeFs.readFile(
        new URL(`../commands/${command}.ts`, import.meta.url),
        "utf8",
      );
      expect(source, command).toContain("context.executor.execute(");
    }
  });
});
