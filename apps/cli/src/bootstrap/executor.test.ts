import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  deriveBootstrapCreationEvidencePaths,
  deriveBootstrapPayloadEvidencePaths,
  encodeCanonicalJson,
  EXIT_CODES,
} from "@developer-os/core";
import type {
  BootstrapPayloadPathV1,
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
} from "@developer-os/core";
import { MacOsTransactionLockProvider } from "@developer-os/platform-macos";

import { runInit } from "../commands/init.js";
import {
  createCommandFixture,
  exists,
  inventory,
  removeCommandFixtures,
} from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import { BootstrapExecutor, freshInitDeathPoints } from "./executor.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
/** Real fsync/rename death tests measure ~7s isolated and >20s under the full parallel gate. */
const REAL_FILESYSTEM_TIMEOUT_MS = 60_000;
const envelopePublicationDeathPoints = [
  "during_plan_temp",
  "after_plan_temp_sync",
  "after_plan_link",
  "after_plan_publication_parent_sync",
  "after_plan_temp_unlink",
  "after_plan_temp_parent_sync",
  "during_journal_temp",
  "after_journal_temp_sync",
  "after_journal_link",
  "after_journal_publication_parent_sync",
  "after_journal_temp_unlink",
  "after_journal_temp_parent_sync",
] as const;
const payloadWriteDeathPoints = [
  "after_payload_create_intent",
  "after_payload_empty_create",
  "after_payload_writing_intent",
  "during_payload_write",
  "after_payload_file_sync",
  "after_payload_evidence",
] as const;
const terminalCompactionDeathPoints = [
  "after_bootstrap_lock_unlink",
  "after_bootstrap_lock_parent_sync",
  "after_journal_unlink",
  "after_journal_parent_sync",
  "after_plan_unlink",
  "after_plan_parent_sync",
] as const;
const forwardNamespaceDeathPoints = [
  "after_global_lock_create",
  "before_global_lock_parent_sync",
  "after_global_lock_parent_sync",
  "after_directory_create",
  "before_directory_parent_sync",
  "after_directory_parent_sync",
  "after_file_link",
  "before_file_parent_sync",
  "after_file_parent_sync",
  "after_file_source_unlink",
  "after_file_source_parent_sync",
] as const;
const compensationNamespaceDeathPoints = [
  "after_compensation_unlink",
  "before_compensation_unlink_parent_sync",
  "after_compensation_unlink_parent_sync",
  "after_compensation_rmdir",
  "before_compensation_rmdir_parent_sync",
  "after_compensation_rmdir_parent_sync",
] as const;

type JsonRecord = Record<string, unknown>;

async function persistedPlan(fixture: CommandFixture): Promise<{
  readonly path: string;
  readonly value: JsonRecord;
}> {
  const name = (await nodeFs.readdir(fixture.paths.stateDir)).find((candidate) =>
    candidate.endsWith(".plan.json"),
  );
  if (name === undefined) throw new Error("fixture has no persisted bootstrap plan");
  const path = join(fixture.paths.stateDir, name);
  return { path, value: JSON.parse(await nodeFs.readFile(path, "utf8")) as JsonRecord };
}

async function writeCanonical(path: string, value: JsonRecord): Promise<void> {
  await nodeFs.writeFile(
    path,
    encodeCanonicalJson(value as CanonicalJsonValue),
    { mode: 0o600 },
  );
}

function planRows(value: JsonRecord, key: "payloads" | "createdPaths"): JsonRecord[] {
  const rows = value[key];
  if (!Array.isArray(rows)) throw new Error(`plan ${key} is not an array`);
  return rows as JsonRecord[];
}

function evidencePathFor(
  fixture: CommandFixture,
  plan: JsonRecord,
  kind: "payload" | "creation",
): string {
  if (typeof plan.id !== "string") throw new Error("fixture plan id is absent");
  if (kind === "payload") {
    const ref = planRows(plan, "payloads")[0]?.ref as JsonRecord | undefined;
    if (typeof ref?.path !== "string") throw new Error("fixture payload ref is absent");
    return deriveBootstrapPayloadEvidencePaths(ref.path as BootstrapPayloadPathV1, randomUUID()).evidence;
  }
  return deriveBootstrapCreationEvidencePaths(
    fixture.paths.home as CanonicalAbsolutePathV1,
    "fresh_v2_init",
    plan.id as never,
    "ordinary",
    0,
    randomUUID(),
  ).evidence;
}

describe("BootstrapExecutor fresh V2 initialization", () => {
  it("creates a complete V2 handoff without network, Git, launchd, vendor, or model calls", async () => {
    const fixture = await createCommandFixture("bootstrap-complete", {
      bootstrapAvailable: true,
    });
    const bootstrap = fixture.context.bootstrap;
    expect(bootstrap?.state).toBe("available");
    if (bootstrap?.state !== "available") return;
    expect(bootstrap.executor).toBeInstanceOf(BootstrapExecutor);

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.schemaVersion).toBe(2);
    const manifest = JSON.parse(await nodeFs.readFile(fixture.paths.manifestFile, "utf8")) as {
      schemaVersion: number;
      artifacts: Array<{ path: string }>;
    };
    expect(manifest.schemaVersion).toBe(2);
    const paths = manifest.artifacts.map((artifact) => artifact.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toEqual(expect.arrayContaining([
      fixture.paths.configFile,
      join(fixture.paths.stateDir, "active-release.json"),
      join(fixture.paths.stateDir, "release-trust.json"),
      join(fixture.paths.stateDir, "lifecycle-install-nonce"),
      join(fixture.paths.stateDir, "lifecycle-id-allocator.json"),
      join(fixture.paths.stateDir, "update-rollback.json"),
      join(fixture.paths.stateDir, "update-executor.json"),
    ]));
    expect(paths).not.toContain(join(fixture.paths.stateDir, "redaction.key"));
    expect(await exists(fixture.paths.stagingDir)).toBe(false);
    expect(fixture.releaseRequests).toStrictEqual([]);
    expect(fixture.vendorProcesses).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("keeps a fresh dry-run byte inert while returning the complete V2 preview", async () => {
    const fixture = await createCommandFixture("bootstrap-dry-run", {
      bootstrapAvailable: true,
    });
    const before = await inventory(fixture.root);

    const result = await runInit(fixture.context, { dryRun: true, assumeYes: true });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.schemaVersion).toBe(2);
    expect(result.ok && result.data.created).toContain(
      join(fixture.paths.stateDir, "active-release.json"),
    );
    expect(await inventory(fixture.root)).toStrictEqual(before);
    expect(fixture.bootstrapTrace).toStrictEqual([]);
  });

  it("records bootstrap/global lock order, evidence-before-create, Foundation pairs, active-last, manifest PONR, and plan-last compaction", async () => {
    const fixture = await createCommandFixture("bootstrap-order", {
      bootstrapAvailable: true,
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    const trace = fixture.bootstrapTrace;
    const index = (prefix: string): number => trace.findIndex((row) => row.startsWith(prefix));
    expect(index("lock:bootstrap")).toBeLessThan(index("inventory:second"));
    expect(index("inventory:second")).toBeLessThan(index("intent:plan"));
    expect(index("intent:journal")).toBeLessThan(index("payload:evidence:"));
    expect(index("payload:evidence:")).toBeLessThan(index("create:global_lock"));
    expect(index("foundation:compensation:")).toBeLessThan(index("foundation:forward:"));
    expect(index("launchability:trust")).toBeLessThan(index("launchability:active"));
    expect(index("launchability:active")).toBeLessThan(index("manifest:publish"));
    expect(index("manifest:publish")).toBeLessThan(index("verify:v2"));
    expect(index("compact:bootstrap-lock")).toBeLessThan(index("compact:journal"));
    expect(trace.at(-2)).toBe("compact:journal");
    expect(trace.at(-1)).toBe("compact:plan");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("holds the kernel-backed bootstrap then global locks through terminal compaction", async () => {
    const fixture = await createCommandFixture("bootstrap-real-lock-lifecycle", {
      bootstrapAvailable: true,
      bootstrapProductionLocks: true,
    });

    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);

    expect(fixture.lifecycleLockEvents.map((event) =>
      event.replace(fixture.paths.stateDir, "<state>"),
    )).toStrictEqual([
      "acquire:<state>/.lifecycle-bootstrap.lock",
      "acquire:<state>/.lifecycle.lock",
      "release:<state>/.lifecycle.lock",
      "release:<state>/.lifecycle-bootstrap.lock",
    ]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a child introduced between the absence inventory and bootstrap lock before intent", async () => {
    let inserted = false;
    const fixture = await createCommandFixture("bootstrap-second-inventory-race", {
      bootstrapAvailable: true,
      bootstrapProductionLocks: true,
      bootstrapBeforeLockAcquire: async (path) => {
        if (inserted || !path.endsWith("/.lifecycle-bootstrap.lock")) return;
        inserted = true;
        await nodeFs.writeFile(join(dirname(path), "concurrent-child"), "third state\n", {
          mode: 0o600,
        });
      },
    });

    const refused = await runInit(fixture.context, ACCEPTED);

    expect(inserted).toBe(true);
    expect(refused.ok).toBe(false);
    expect(await nodeFs.readFile(
      join(fixture.paths.stateDir, "concurrent-child"),
      "utf8",
    )).toBe("third state\n");
    expect((await nodeFs.readdir(fixture.paths.stateDir)).some((name) =>
      name.endsWith(".plan.json") || name.endsWith(".journal.json"),
    )).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a concurrent kernel-held fresh init before publishing intent, then recovers", async () => {
    const fixture = await createCommandFixture("bootstrap-real-lock-contention", {
      bootstrapAvailable: true,
      bootstrapProductionLocks: true,
    });
    await nodeFs.mkdir(fixture.paths.stateDir, { recursive: true, mode: 0o700 });
    const bootstrapLock = join(fixture.paths.stateDir, ".lifecycle-bootstrap.lock");
    const concurrent = await new MacOsTransactionLockProvider().acquire(bootstrapLock);
    try {
      const refused = await runInit(fixture.context, ACCEPTED);
      expect(refused.ok).toBe(false);
      expect((await nodeFs.readdir(fixture.paths.stateDir)).some((name) =>
        name.endsWith(".plan.json") || name.endsWith(".journal.json"),
      )).toBe(false);
    } finally {
      await concurrent.release();
    }

    expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses concurrent kernel-held recovery without advancing its admitted journal", async () => {
    const fixture = await createCommandFixture("bootstrap-real-lock-recovery-contention", {
      bootstrapAvailable: true,
      bootstrapProductionLocks: true,
      bootstrapInterruptAfter: "after_journal",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    expect(fixture.lifecycleLockEvents.slice(0, 2).map((event) =>
      event.replace(fixture.paths.stateDir, "<state>"),
    )).toStrictEqual([
      "acquire:<state>/.lifecycle-bootstrap.lock",
      "release:<state>/.lifecycle-bootstrap.lock",
    ]);
    const journalName = (await nodeFs.readdir(fixture.paths.stateDir)).find((name) =>
      name.endsWith(".journal.json"),
    );
    expect(journalName).toBeDefined();
    if (journalName === undefined) return;
    const journalPath = join(fixture.paths.stateDir, journalName);
    const before = await nodeFs.readFile(journalPath);
    const concurrent = await new MacOsTransactionLockProvider().acquire(
      join(fixture.paths.stateDir, ".lifecycle-bootstrap.lock"),
    );
    fixture.disableBootstrapInterrupt();
    try {
      expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok).toBe(false);
      expect(await nodeFs.readFile(journalPath)).toStrictEqual(before);
    } finally {
      await concurrent.release();
    }

    expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("cold-recovers Foundation lock residue with the production-equivalent provider", async () => {
    const fixture = await createCommandFixture("bootstrap-real-lock-foundation-recovery", {
      bootstrapAvailable: true,
      bootstrapProductionLocks: true,
      bootstrapInterruptAfter: "after_foundation",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);

    fixture.disableBootstrapInterrupt();
    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (!resumed.ok) throw new Error(JSON.stringify({ resumed, trace: fixture.bootstrapTrace.slice(-30) }));
    expect(resumed.data.schemaVersion).toBe(2);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("releases lifecycle locks when recovery package admission fails", async () => {
    const fixture = await createCommandFixture("bootstrap-lock-release-package-refusal", {
      bootstrapAvailable: true,
      bootstrapProductionLocks: true,
      bootstrapInterruptAfter: "after_journal",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    fixture.disableBootstrapInterrupt();
    await nodeFs.appendFile(
      join(fixture.root, "packaged-release", "bundle", "bin", "developer-os"),
      "tampered\n",
    );

    expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok).toBe(false);
    const lock = await new MacOsTransactionLockProvider().acquire(
      join(fixture.paths.stateDir, ".lifecycle-bootstrap.lock"),
    );
    await lock.release();
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each(freshInitDeathPoints)("recovers a crash at $name", async ({ name }) => {
    const fixture = await createCommandFixture(`bootstrap-death-${name}`, {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: name,
    });
    const interrupted = await runInit(fixture.context, ACCEPTED);
    expect(interrupted.ok).toBe(false);
    expect(!interrupted.ok && interrupted.code).toBe(EXIT_CODES.recoveryRequired);

    fixture.disableBootstrapInterrupt();
    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);
    if (!resumed.ok) throw new Error(JSON.stringify({ name, resumed, trace: fixture.bootstrapTrace.slice(-30) }));
    expect(resumed.data.schemaVersion).toBe(2);
    expect(JSON.parse(await nodeFs.readFile(fixture.paths.manifestFile, "utf8"))).toMatchObject({
      schemaVersion: 2,
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an unprojected cold-recovery residue through guarded closure admission", async () => {
    const fixture = await createCommandFixture("bootstrap-cold-closure-third-state", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_journal",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const unknown = join(fixture.paths.stateDir, "fresh-v2-init.unprojected-residue");
    await nodeFs.writeFile(unknown, "third-state\n", { mode: 0o600 });

    fixture.disableBootstrapInterrupt();
    const refused = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(refused.ok).toBe(false);
    expect(await nodeFs.readFile(unknown, "utf8")).toBe("third-state\n");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("preserves a future planned directory beside an early journal as a third state", async () => {
    const fixture = await createCommandFixture("bootstrap-future-directory-third-state", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_journal",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const plan = (await persistedPlan(fixture)).value;
    const future = planRows(plan, "createdPaths").find((row) =>
      row.kind === "directory" &&
      typeof row.path === "string" &&
      !row.path.startsWith(`${fixture.paths.stagingDir}/`) &&
      (dirname(row.path) === fixture.paths.home || dirname(row.path) === fixture.paths.stateDir),
    );
    if (future === undefined || typeof future.path !== "string") {
      throw new Error("fixture has no suitable future planned directory");
    }
    await nodeFs.mkdir(future.path, { mode: 0o700 });
    const inserted = await nodeFs.lstat(future.path);

    fixture.disableBootstrapInterrupt();
    const refused = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(refused.ok).toBe(false);
    const retained = await nodeFs.lstat(future.path);
    expect([String(retained.dev), String(retained.ino)]).toStrictEqual([
      String(inserted.dev),
      String(inserted.ino),
    ]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each([
    {
      name: "an out-of-root journal path",
      mutate: (plan: JsonRecord, fixture: CommandFixture): void => {
        plan.journalPath = join(fixture.root, "outside-journal");
      },
      prepare: async (fixture: CommandFixture): Promise<void> => {
        await nodeFs.mkdir(join(fixture.root, "outside-journal"), { mode: 0o700 });
      },
    },
    {
      name: "a non-number walk bound",
      mutate: (plan: JsonRecord): void => {
        plan.maximumStagingEntries = "unbounded";
      },
    },
    {
      name: "an oversized walk bound",
      mutate: (plan: JsonRecord): void => {
        plan.maximumStagingEntries = Number.MAX_SAFE_INTEGER;
      },
    },
    {
      name: "a malformed payload inventory",
      mutate: (plan: JsonRecord): void => {
        plan.payloads = { forged: true };
      },
    },
    {
      name: "malformed participants",
      mutate: (plan: JsonRecord): void => {
        plan.foundationParticipants = [null];
      },
    },
    {
      name: "a malformed manifest",
      mutate: (plan: JsonRecord): void => {
        plan.manifest = null;
      },
    },
  ])("structurally refuses $name before any plan-selected recovery read", async ({ name, mutate, prepare }) => {
    const fixture = await createCommandFixture(
      `bootstrap-raw-plan-${name.replaceAll(/[^a-z]+/gu, "-")}`,
      { bootstrapAvailable: true, bootstrapInterruptAfter: "after_journal" },
    );
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const plan = await persistedPlan(fixture);
    await prepare?.(fixture);
    mutate(plan.value, fixture);
    await writeCanonical(plan.path, plan.value);

    fixture.disableBootstrapInterrupt();
    const refused = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.code).toBe(EXIT_CODES.securityRefusal);
    expect(await exists(plan.path)).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each([
    { name: "plan-temp-only", point: "during_plan_temp" },
    { name: "journal-without-final", point: "during_journal_temp" },
  ] as const)("preserves a tampered non-prefix $name envelope", async ({ name, point }) => {
    const fixture = await createCommandFixture(`bootstrap-prefix-${name}`, {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: point as never,
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const temporaryName = (await nodeFs.readdir(fixture.paths.stateDir)).find((candidate) =>
      candidate.endsWith(`${point.includes("plan") ? ".plan" : ".journal"}.json.tmp`),
    );
    if (temporaryName === undefined) throw new Error("fixture has no envelope prefix");
    const temporary = join(fixture.paths.stateDir, temporaryName);
    await nodeFs.writeFile(temporary, "tampered non-prefix\n", { mode: 0o600 });

    fixture.disableBootstrapInterrupt();
    const refused = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(refused.ok).toBe(false);
    expect(await nodeFs.readFile(temporary, "utf8")).toBe("tampered non-prefix\n");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("preserves a tampered non-prefix journal-rewrite temp beside the final journal", async () => {
    const fixture = await createCommandFixture("bootstrap-prefix-journal-rewrite", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_journal",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const plan = (await persistedPlan(fixture)).value;
    if (typeof plan.id !== "string") throw new Error("fixture plan id is absent");
    const temporary = join(
      fixture.paths.stateDir,
      `.fresh-v2-init.${plan.id}.11111111-1111-4111-8111-111111111111.journal.json.tmp`,
    );
    await nodeFs.writeFile(temporary, "tampered rewrite\n", { mode: 0o600 });

    fixture.disableBootstrapInterrupt();
    const refused = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(refused.ok).toBe(false);
    expect(await nodeFs.readFile(temporary, "utf8")).toBe("tampered rewrite\n");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("preserves the immutable plan when a planned target appears before initial journal intent", async () => {
    const fixture = await createCommandFixture("bootstrap-plan-orphan-third-state", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_plan",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const planName = (await nodeFs.readdir(fixture.paths.stateDir)).find((name) =>
      name.endsWith(".plan.json"),
    );
    expect(planName).toBeDefined();
    if (planName === undefined) return;
    const planPath = join(fixture.paths.stateDir, planName);
    await nodeFs.mkdir(fixture.paths.logsDir, { mode: 0o700 });

    fixture.disableBootstrapInterrupt();
    expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok).toBe(false);
    expect(await exists(planPath)).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each(envelopePublicationDeathPoints)("recovers a fresh process after %s", async (point) => {
    const fixture = await createCommandFixture(`bootstrap-envelope-${point}`, {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: point as never,
    });

    const interrupted = await runInit(fixture.context, ACCEPTED);
    expect(interrupted.ok).toBe(false);
    const stateEntries = await nodeFs.readdir(fixture.paths.stateDir);
    for (const name of stateEntries.filter((candidate) =>
      candidate.endsWith(".plan.json") || candidate.endsWith(".journal.json"),
    )) {
      expect(JSON.parse(
        await nodeFs.readFile(join(fixture.paths.stateDir, name), "utf8"),
      )).toBeDefined();
    }

    fixture.disableBootstrapInterrupt();
    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);
    if (!resumed.ok) throw new Error(JSON.stringify({ point, resumed, trace: fixture.bootstrapTrace.slice(-20) }));
    expect(resumed.data.schemaVersion).toBe(2);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each(payloadWriteDeathPoints)("recovers a fresh payload write after %s", async (point) => {
    const fixture = await createCommandFixture(`bootstrap-payload-${point}`, {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: point as never,
    });

    const interrupted = await runInit(fixture.context, ACCEPTED);
    expect(interrupted.ok).toBe(false);

    fixture.disableBootstrapInterrupt();
    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);
    if (!resumed.ok) throw new Error(JSON.stringify({ point, resumed, trace: fixture.bootstrapTrace.slice(-20) }));
    expect(resumed.data.schemaVersion).toBe(2);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each([
    { kind: "payload" as const, interrupt: "after_first_payload" as const },
    { kind: "creation" as const, interrupt: "after_global_lock" as const },
  ].flatMap((source) => [
    { ...source, mutation: "mode" as const },
    { ...source, mutation: "hard-link" as const },
  ]))("refuses and preserves a $mutation $kind evidence envelope", async ({ kind, interrupt, mutation }) => {
    const fixture = await createCommandFixture(`bootstrap-${kind}-evidence-${mutation}`, {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: interrupt,
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const plan = (await persistedPlan(fixture)).value;
    const evidence = evidencePathFor(fixture, plan, kind);
    const alias = join(fixture.root, `${kind}-evidence-alias`);
    if (mutation === "mode") await nodeFs.chmod(evidence, 0o640);
    else await nodeFs.link(evidence, alias);

    fixture.disableBootstrapInterrupt();
    const refused = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(refused.ok).toBe(false);
    expect(await exists(evidence)).toBe(true);
    if (mutation === "mode") expect((await nodeFs.lstat(evidence)).mode & 0o777).toBe(0o640);
    else expect(await exists(alias)).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each([
    { kind: "payload" as const, interrupt: "after_first_payload" as const, point: "before_payload_evidence_open" },
    { kind: "creation" as const, interrupt: "after_global_lock" as const, point: "before_creation_evidence_open" },
  ])("refuses and preserves a same-path $kind evidence replacement during guarded open", async ({ kind, interrupt, point }) => {
    let replaced = false;
    let replacementIno: bigint | undefined;
    let evidencePath: string | undefined;
    const fixture = await createCommandFixture(`bootstrap-${kind}-evidence-replacement`, {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: interrupt,
      bootstrapFailureHook: (observed) => {
        if (replaced || observed !== point) return;
        const planName = fsSync.readdirSync(fixture.paths.stateDir).find((candidate) =>
          candidate.endsWith(".plan.json"),
        );
        if (planName === undefined) throw new Error("fixture plan is absent during evidence read");
        const plan = JSON.parse(
          fsSync.readFileSync(join(fixture.paths.stateDir, planName), "utf8"),
        ) as JsonRecord;
        evidencePath = evidencePathFor(fixture, plan, kind);
        const replacement = `${evidencePath}.concurrent`;
        fsSync.writeFileSync(replacement, fsSync.readFileSync(evidencePath), { mode: 0o600 });
        fsSync.renameSync(replacement, evidencePath);
        replacementIno = fsSync.lstatSync(evidencePath, { bigint: true }).ino;
        replaced = true;
      },
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);

    fixture.disableBootstrapInterrupt();
    const refused = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(refused.ok).toBe(false);
    expect(replaced).toBe(true);
    if (evidencePath === undefined || replacementIno === undefined) {
      throw new Error("evidence replacement hook did not run");
    }
    expect((await nodeFs.lstat(evidencePath, { bigint: true })).ino).toBe(replacementIno);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("force-forwards from durable payload evidence after the package disappears", async () => {
    const fixture = await createCommandFixture("bootstrap-source-independent", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_payloads",
    });
    const interrupted = await runInit(fixture.context, ACCEPTED);
    expect(interrupted.ok).toBe(false);
    await nodeFs.rm(join(fixture.root, "packaged-release"), { recursive: true });

    fixture.disableBootstrapInterrupt();
    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (!resumed.ok) throw new Error(JSON.stringify({ resumed, trace: fixture.bootstrapTrace.slice(-20) }));
    expect(resumed.data.schemaVersion).toBe(2);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each(terminalCompactionDeathPoints)("admits terminal plan-only recovery after %s", async (point) => {
    const fixture = await createCommandFixture(`bootstrap-terminal-${point}`, {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: point as never,
    });
    const interrupted = await runInit(fixture.context, ACCEPTED);
    expect(interrupted.ok).toBe(false);

    if (point === "after_journal_unlink") {
      const stateEntries = await nodeFs.readdir(fixture.paths.stateDir);
      if (stateEntries.some((name) => name.endsWith(".journal.json"))) {
        throw new Error(JSON.stringify({ interrupted, stateEntries, trace: fixture.bootstrapTrace.slice(-30) }));
      }
      expect(stateEntries.filter((name) => name.endsWith(".plan.json"))).toHaveLength(1);
    }

    fixture.disableBootstrapInterrupt();
    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (!resumed.ok) throw new Error(JSON.stringify({ resumed, trace: fixture.bootstrapTrace.slice(-20) }));
    expect(resumed.data.schemaVersion).toBe(2);
    expect((await nodeFs.readdir(fixture.paths.stateDir)).some((name) =>
      name.endsWith(".plan.json") || name.endsWith(".journal.json"),
    )).toBe(false);
    expect(await exists(join(fixture.paths.stateDir, ".lifecycle-bootstrap.lock"))).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reacquires the global lock for finalized plan-last recovery", async () => {
    const fixture = await createCommandFixture("bootstrap-plan-last-global-lock", {
      bootstrapAvailable: true,
      bootstrapProductionLocks: true,
      bootstrapInterruptAfter: "after_journal_unlink",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const beforeRecovery = fixture.lifecycleLockEvents.length;

    fixture.disableBootstrapInterrupt();
    expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok).toBe(true);

    expect(fixture.lifecycleLockEvents.slice(beforeRecovery).some((event) =>
      event === `acquire:${join(fixture.paths.stateDir, ".lifecycle.lock")}`,
    )).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each(forwardNamespaceDeathPoints)("recovers a fresh namespace mutation after %s", async (point) => {
    const fixture = await createCommandFixture(`bootstrap-namespace-${point}`, {
      bootstrapAvailable: true,
      bootstrapProductionLocks: point.includes("global_lock"),
      bootstrapInterruptAfter: point as never,
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);

    fixture.disableBootstrapInterrupt();
    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);
    expect(resumed.ok && resumed.data.schemaVersion).toBe(2);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each(compensationNamespaceDeathPoints)("recovers compensation namespace durability after %s", async (point) => {
    const fixture = await createCommandFixture(`bootstrap-compensation-${point}`, {
      bootstrapAvailable: true,
      bootstrapFailureAfter: "after_foundation",
      bootstrapInterruptAfter: point as never,
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);

    fixture.disableBootstrapInterrupt();
    fixture.disableBootstrapFailure();
    await runInit(fixture.rebuildContext(), ACCEPTED);
    const retried = await runInit(fixture.rebuildContext(), ACCEPTED);
    if (!retried.ok) throw new Error(JSON.stringify({ point, retried, trace: fixture.bootstrapTrace.slice(-30) }));
    expect(retried.data.schemaVersion).toBe(2);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("compensates in reverse order when a pre-manifest failure follows Foundation", async () => {
    const fixture = await createCommandFixture("bootstrap-compensation", {
      bootstrapAvailable: true,
      bootstrapProductionLocks: true,
      bootstrapFailureAfter: "after_foundation",
    });

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(false);
    expect(fixture.lifecycleLockEvents.slice(-2).map((event) =>
      event.replace(fixture.paths.stateDir, "<state>"),
    )).toStrictEqual([
      "release:<state>/.lifecycle.lock",
      "release:<state>/.lifecycle-bootstrap.lock",
    ]);
    const compensated = fixture.bootstrapTrace.filter((row) =>
      row.startsWith("compensate:path:"),
    );
    expect(compensated.length).toBeGreaterThan(1);
    const ordinals = (scope: string): number[] => compensated
      .filter((row) => row.startsWith(`compensate:path:${scope}:`))
      .map((row) => Number(row.split(":").at(-1)));
    for (const scope of ["launchability", "ordinary"]) {
      const observed = ordinals(scope);
      expect(observed).toStrictEqual([...observed].sort((left, right) => right - left));
    }
    expect(await exists(fixture.paths.configFile)).toBe(false);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("preserves a concurrent same-byte replacement instead of compensating it by pathname", async () => {
    let replacedInode: bigint | number | undefined;
    const fixture = await createCommandFixture("bootstrap-compensation-third-state", {
      bootstrapAvailable: true,
      bootstrapFailureAfter: "after_foundation",
      bootstrapFailureHook: (point) => {
        if (point !== "after_foundation") return;
        const target = join(fixture.paths.stateDir, "lifecycle-install-nonce");
        const replacement = join(fixture.paths.stateDir, "nonce.concurrent");
        fsSync.writeFileSync(replacement, fsSync.readFileSync(target), { mode: 0o600 });
        fsSync.renameSync(replacement, target);
        replacedInode = fsSync.lstatSync(target, { bigint: true }).ino;
      },
    });

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(false);
    const retained = await nodeFs.lstat(join(fixture.paths.stateDir, "lifecycle-install-nonce"), {
      bigint: true,
    });
    expect(retained.ino).toBe(replacedInode);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each([
    { name: "same-byte", replacement: (bytes: Buffer): Buffer => bytes },
    { name: "partial-byte", replacement: (bytes: Buffer): Buffer => bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 2))) },
  ])("preserves a $name staged-payload replacement during compensation", async ({ name, replacement }) => {
    let replacementPath: string | undefined;
    let replacementIno: bigint | undefined;
    let replacementBytes: Buffer | undefined;
    let mutated = false;
    const fixture = await createCommandFixture(`bootstrap-payload-compensation-${name}`, {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_first_payload",
      bootstrapFailureAfter: "after_payloads",
      bootstrapFailureHook: (point) => {
        if (mutated || point !== "before_payload_compensation_unlink") return;
        const planName = fsSync.readdirSync(fixture.paths.stateDir).find((candidate) =>
          candidate.endsWith(".plan.json"),
        );
        if (planName === undefined) throw new Error("fixture plan is absent during compensation");
        const plan = JSON.parse(
          fsSync.readFileSync(join(fixture.paths.stateDir, planName), "utf8"),
        ) as JsonRecord;
        const row = planRows(plan, "payloads").at(-1);
        const ref = row?.ref as JsonRecord | undefined;
        if (typeof ref?.path !== "string") throw new Error("fixture payload path is absent");
        const original = fsSync.readFileSync(ref.path);
        replacementBytes = replacement(original);
        const candidate = `${ref.path}.concurrent`;
        fsSync.writeFileSync(candidate, replacementBytes, { mode: 0o600 });
        fsSync.renameSync(candidate, ref.path);
        replacementPath = ref.path;
        replacementIno = fsSync.lstatSync(ref.path, { bigint: true }).ino;
        mutated = true;
      },
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);

    fixture.disableBootstrapInterrupt();
    const refused = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(refused.ok).toBe(false);
    expect(mutated).toBe(true);
    if (replacementPath === undefined || replacementIno === undefined || replacementBytes === undefined) {
      throw new Error("replacement hook did not retain its evidence");
    }
    const retained = await nodeFs.lstat(replacementPath, { bigint: true });
    expect(retained.ino).toBe(replacementIno);
    expect(await nodeFs.readFile(replacementPath)).toStrictEqual(replacementBytes);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("retains the fresh V1 compatibility arm when the bootstrap projection is absent", async () => {
    const fixture = await createCommandFixture("bootstrap-projection-missing");
    const result = await runInit({ ...fixture.context, bootstrap: undefined }, ACCEPTED);
    expect(result.ok && result.data.schemaVersion).toBe(1);
    expect(fixture.bootstrapTrace).toStrictEqual([]);
  });

  it("preserves a pre-existing Brain byte-for-byte", async () => {
    const fixture = await createCommandFixture("bootstrap-existing-brain", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true });
    const note = join(fixture.paths.brain, "mine.md");
    await nodeFs.writeFile(note, "mine\n");
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    expect(await nodeFs.readFile(note, "utf8")).toBe("mine\n");
    expect(await nodeFs.readdir(fixture.paths.brain)).toStrictEqual(["mine.md"]);
  });
});
