import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  EXIT_CODES,
  encodeCanonicalJson,
  hashBytes,
  loadConfig,
  parseLifecycleInstallNonce,
  publishableConfig,
  serializeConfig,
  setConfigValue,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  LifecycleInstallNonceV1,
  LifecycleLedgerSnapshotV1,
  TransactionJournalV1,
} from "@developer-os/core";
import { DEFAULT_BRAIN_CONFIG } from "@developer-os/brain";
import { MacOsStableLockProvider } from "@developer-os/platform-macos";

import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import { admitInstalledV2Home } from "../lifecycle/admission.js";
import { lifecycleHomeKeyFromAdmission, residueFrom } from "../lifecycle/context.js";
import type { LifecycleExecutionPlanV1 } from "../lifecycle/codecs.js";
import type { CliContext } from "../context.js";
import { run } from "../main.js";
import { runConfig } from "./config.js";
import { runInit } from "./init.js";
import { manifestAdmissionFor } from "./uninstall.js";
import {
  createCommandFixture,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
} from "./testing.js";
import type { CommandFixture } from "./testing.js";

afterAll(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

/** Every key Spec 1 §2.2 publishes as readable and refuses as mutable. */
const READ_ONLY_KEYS = [
  "schemaVersion",
  "telemetry",
  "git.enabled",
  "git.lifecycle",
  "automation.lifecycle",
] as const;

function canonicalArgv(value: unknown): string {
  return encodeCanonicalJson(value as CanonicalJsonValue).slice(0, -1);
}

interface SharedV2HomeV1 extends CommandFixture {
  readonly retainedAtInit: Awaited<ReturnType<CommandFixture["bootstrapEvidenceIdentities"]>>;
  readonly lifecycleSnapshot: () => Promise<LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>>;
}

let sharedHome: Promise<SharedV2HomeV1> | null = null;

/** One real fresh V2 `init` per file; every case below runs against that one home. */
function sharedV2Home(): Promise<SharedV2HomeV1> {
  sharedHome ??= initialisedV2Home("config-shared");
  return sharedHome;
}

async function initialisedV2Home(label: string): Promise<SharedV2HomeV1> {
  const fixture = await createCommandFixture(label, { bootstrapAvailable: true });
  await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  const result = await runInit(fixture.context, ACCEPTED);
  if (!result.ok) {
    throw new Error(
      `fixture init failed: ${JSON.stringify({ result, trace: fixture.bootstrapTrace.slice(-30) })}`,
    );
  }
  return {
    ...fixture,
    retainedAtInit: await fixture.bootstrapEvidenceIdentities(),
    lifecycleSnapshot: () => snapshotOf(fixture),
  };
}

function lifecycleOf(fixture: CommandFixture): NonNullable<CliContext["lifecycle"]> {
  const lifecycle = fixture.context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
  return lifecycle;
}

async function snapshotOf(
  fixture: CommandFixture,
): Promise<LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>> {
  const lifecycle = lifecycleOf(fixture);
  const key = lifecycleHomeKeyFromAdmission(
    await admitInstalledV2Home({
      fs: lifecycle.fs,
      paths: fixture.paths,
      manifestAdmission: manifestAdmissionFor(fixture.paths, []),
      effectiveUid: lifecycle.effectiveUid,
    }),
    fixture.paths,
  );
  const residue = residueFrom(
    await inspectBootstrapEvidenceAdmission(
      createBootstrapEvidenceInspectionRequest({
        productHome: fixture.paths.home,
        stateDirectory: fixture.paths.stateDir,
        initialRoots: [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
      }),
    ),
  );
  return lifecycle.inspectLedger(key, residue);
}

function globalLockPath(fixture: CommandFixture): string {
  return join(fixture.paths.stateDir, ".lifecycle.lock");
}

async function nonceOf(fixture: CommandFixture): Promise<LifecycleInstallNonceV1> {
  return parseLifecycleInstallNonce(
    await nodeFs.readFile(join(fixture.paths.stateDir, "lifecycle-install-nonce")),
  );
}

async function allocatorCounter(fixture: CommandFixture): Promise<bigint> {
  const value = JSON.parse(
    await nodeFs.readFile(join(fixture.paths.stateDir, "lifecycle-id-allocator.json"), "utf8"),
  ) as { readonly nextCounter: string };
  return BigInt(value.nextCounter);
}

async function journalIds(fixture: CommandFixture): Promise<readonly string[]> {
  const names = await nodeFs
    .readdir(join(fixture.paths.stateDir, "transactions"))
    .catch(() => [] as string[]);
  return names
    .filter((name) => !name.startsWith(".") && name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
}

async function journalOf(fixture: CommandFixture, id: string): Promise<TransactionJournalV1> {
  return JSON.parse(
    await nodeFs.readFile(join(fixture.paths.stateDir, "transactions", `${id}.json`), "utf8"),
  ) as TransactionJournalV1;
}

function configText(fixture: CommandFixture): Promise<string> {
  return nodeFs.readFile(fixture.paths.configFile, "utf8");
}

describe("config on a real V2 home", () => {
  it("sets a value on a fresh V2 home beside retained evidence with closure clear", async () => {
    const fixture = await sharedV2Home();
    /**
     * A fresh install writes no `[brain]` table — `defaultConfig` in `commands/init.ts`
     * emits the five required keys and nothing else — and Task 5 refuses a leaf whose
     * optional parent section is absent. The section is created first, and the refusal
     * that precedes it is pinned here rather than the leaf appearing to work outright.
     */
    expect(
      await runConfig(fixture.context, {
        operation: "set",
        key: "brain.staleness.reviewAfterDays",
        value: "30",
      }),
    ).toMatchObject({
      ok: false,
      code: EXIT_CODES.invalidInput,
      error: { kind: "config_refusal" },
    });
    expect(
      await runConfig(fixture.context, {
        operation: "set",
        key: "brain",
        value: canonicalArgv(DEFAULT_BRAIN_CONFIG),
      }),
    ).toMatchObject({ ok: true, data: { key: "brain", outcome: "updated" } });

    const set = await runConfig(fixture.context, { operation: "set", key: "brain.staleness.reviewAfterDays", value: "30" });
    expect(set).toMatchObject({ ok: true, data: { schemaVersion: 1, key: "brain.staleness.reviewAfterDays", outcome: "updated" } });
    const get = await runConfig(fixture.context, { operation: "get", key: "brain.staleness.reviewAfterDays" });
    expect(get).toMatchObject({ ok: true, data: { schemaVersion: 1, key: "brain.staleness.reviewAfterDays", value: 30 } });
    expect((await fixture.lifecycleSnapshot()).closure).toStrictEqual({ kind: "clear" });
    expect(await fixture.bootstrapEvidenceIdentities()).toStrictEqual(fixture.retainedAtInit);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("prints the exact canonical JSON of the result, with or without --json", async () => {
    const fixture = await sharedV2Home();
    for (const argv of [["config", "get", "adapters.claude"], ["config", "get", "adapters.claude", "--json"]]) {
      fixture.io.out.length = 0;
      expect(await run(argv, fixture.io, () => fixture.rebuildContext())).toBe(0);
      expect(fixture.io.out).toStrictEqual(['{"key":"adapters.claude","schemaVersion":1,"value":false}']);
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("publishes the whole projection with redaction as a count, never its patterns", async () => {
    const fixture = await sharedV2Home();
    const pattern = "synthetic-redaction-pattern";
    expect(
      await runConfig(fixture.context, {
        operation: "set",
        key: "redaction",
        value: canonicalArgv({ patterns: [pattern] }),
      }),
    ).toMatchObject({ ok: true, data: { key: "redaction", outcome: "updated" } });

    const whole = await runConfig(fixture.context, { operation: "get", key: null });
    const patterns = await runConfig(fixture.context, { operation: "get", key: "redaction.patterns" });

    expect(whole).toMatchObject({
      ok: true,
      data: { schemaVersion: 1, key: null, value: publishableConfig(loadConfig(await configText(fixture))) },
    });
    expect(whole.ok ? whole.data : null).toMatchObject({ value: { redaction: { patternsCount: 1 } } });
    expect(JSON.stringify(whole)).not.toContain(pattern);
    expect(patterns).toMatchObject({ ok: true, data: { key: "redaction.patterns", value: 1 } });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reads a key on a V2 home without taking the global lock", async () => {
    const fixture = await sharedV2Home();
    const events = fixture.stableLockEvents.length;

    expect(await runConfig(fixture.context, { operation: "get", key: "telemetry" })).toMatchObject({
      ok: true,
      data: { key: "telemetry", value: false },
    });

    expect(fixture.stableLockEvents.slice(events)).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("leaves the configuration, the allocator and the journals untouched when a set is refused", async () => {
    const fixture = await sharedV2Home();
    const refused = { operation: "set", key: "git.enabled", value: "true" } as const;
    /** The gate compacts the preceding case's terminal journal in its preflight; the baseline follows that. */
    await runConfig(fixture.context, refused);
    const bytes = await nodeFs.readFile(fixture.paths.configFile);
    const counter = await allocatorCounter(fixture);
    const journals = await journalIds(fixture);

    expect(await runConfig(fixture.context, refused)).toMatchObject({
      ok: false,
      code: EXIT_CODES.invalidInput,
      error: { kind: "config_refusal" },
    });

    expect(await nodeFs.readFile(fixture.paths.configFile)).toStrictEqual(bytes);
    expect(await allocatorCounter(fixture)).toBe(counter);
    expect(await journalIds(fixture)).toStrictEqual(journals);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("performs no transaction and allocates nothing when the value is unchanged", async () => {
    const fixture = await sharedV2Home();
    const current = loadConfig(await configText(fixture)).brainPath;
    const counter = await allocatorCounter(fixture);
    const journals = await journalIds(fixture);

    expect(
      await runConfig(fixture.context, { operation: "set", key: "brainPath", value: canonicalArgv(current) }),
    ).toMatchObject({ ok: true, data: { schemaVersion: 1, key: "brainPath", outcome: "unchanged" } });

    expect(await allocatorCounter(fixture)).toBe(counter);
    expect((await journalIds(fixture)).filter((id) => !journals.includes(id))).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("replaces the configuration in one allocated transaction guarded by the pre-read hash", async () => {
    const fixture = await sharedV2Home();
    const nonce = await nonceOf(fixture);
    const before = await nodeFs.readFile(fixture.paths.configFile);
    const counter = await allocatorCounter(fixture);
    const journals = await journalIds(fixture);
    const planned = serializeConfig(
      setConfigValue(loadConfig(before.toString("utf8")), "adapters.codex", "true").config,
    );

    expect(
      await runConfig(fixture.context, { operation: "set", key: "adapters.codex", value: "true" }),
    ).toMatchObject({ ok: true, data: { schemaVersion: 1, key: "adapters.codex", outcome: "updated" } });

    const created = (await journalIds(fixture)).filter((id) => !journals.includes(id));
    expect(created).toStrictEqual([`tx_${nonce}_${String(counter)}`]);
    expect(await allocatorCounter(fixture)).toBe(counter + 1n);
    const journal = await journalOf(fixture, created[0] ?? "");
    expect(journal.phase).toBe("finalized");
    expect(journal.mutations).toHaveLength(1);
    expect(journal.mutations[0]).toMatchObject({
      targetPath: fixture.paths.configFile,
      operation: "replace",
      expectedBeforeHash: hashBytes(before),
    });

    const written = await configText(fixture);
    expect(written).toBe(planned);
    expect(serializeConfig(loadConfig(written))).toBe(planned);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a hand edit that lands between the read and the transaction, and keeps it", async () => {
    const fixture = await sharedV2Home();
    const edited = `${await configText(fixture)}# hand edit\n`;
    const original = await nodeFs.readFile(fixture.paths.configFile);
    let handEdits = 0;
    const guards = {
      ...fixture.context.guards,
      readText: async (path: string, reader?: Parameters<CliContext["guards"]["readText"]>[1]) => {
        const text = await fixture.context.guards.readText(path, reader);
        if (path === fixture.paths.configFile && handEdits === 0) {
          handEdits += 1;
          await nodeFs.writeFile(path, edited, { mode: 0o600 });
        }
        return text;
      },
    };
    const context: CliContext = { ...fixture.context, guards };

    try {
      expect(
        await runConfig(context, {
          operation: "set",
          key: "brainPath",
          value: canonicalArgv(`${fixture.paths.brain}-moved`),
        }),
      ).toMatchObject({
        ok: false,
        code: EXIT_CODES.decisionRequired,
        error: { kind: "transaction_precondition" },
      });

      expect(handEdits).toBe(1);
      expect(await configText(fixture)).toBe(edited);
    } finally {
      await nodeFs.writeFile(fixture.paths.configFile, original, { mode: 0o600 });
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a set with exit 6 while the global lock is held elsewhere", async () => {
    const fixture = await sharedV2Home();
    const held = await new MacOsStableLockProvider().acquireExisting(
      globalLockPath(fixture) as CanonicalAbsolutePathV1,
    );
    try {
      const before = await nodeFs.readFile(fixture.paths.configFile);

      expect(
        await runConfig(fixture.context, { operation: "set", key: "adapters.codex", value: "false" }),
      ).toMatchObject({ ok: false, code: EXIT_CODES.recoveryRequired });

      expect(await nodeFs.readFile(fixture.paths.configFile)).toStrictEqual(before);
    } finally {
      await held.release();
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("never echoes the supplied value into a refusal, on either stream", async () => {
    const fixture = await sharedV2Home();
    const sentinel = "SENTINEL-VALUE-MUST-NOT-APPEAR";

    for (const argv of [
      ["config", "set", "adapters.codex", sentinel],
      ["config", "set", "adapters.codex", sentinel, "--json"],
    ]) {
      fixture.io.out.length = 0;
      fixture.io.err.length = 0;

      expect(await run(argv, fixture.io, () => fixture.rebuildContext())).toBe(
        EXIT_CODES.invalidInput,
      );

      const written = [...fixture.io.out, ...fixture.io.err];
      expect(written.length).toBeGreaterThan(0);
      for (const line of written) expect(line).not.toContain(sentinel);
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses every readable key that is not mutable", async () => {
    const fixture = await sharedV2Home();

    expect(READ_ONLY_KEYS.length).toBeGreaterThan(0);
    for (const key of READ_ONLY_KEYS) {
      expect(await runConfig(fixture.context, { operation: "set", key, value: "true" }), key).toMatchObject({
        ok: false,
        code: EXIT_CODES.invalidInput,
        error: { kind: "config_refusal" },
      });
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
