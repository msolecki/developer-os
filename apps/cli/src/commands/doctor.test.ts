import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  encodeCanonicalJson,
  encodeHookFiringRecord,
  EXIT_CODES,
  hookFiringRecordName,
  parseCanonicalAbsolutePathText,
  parseUInt64Decimal,
} from "@developer-os/core";
import type { CliResult, HeldLifecycleStableLockV1 } from "@developer-os/core";
import { CLAUDE_HOOK_ROWS, CLAUDE_HOOKS_PATH, PLUGIN_INSTALL_SEGMENTS, renderClaudeHooks } from "@developer-os/adapter-claude";
import {
  CODEX_HOOK_ROWS,
  CODEX_HOOK_TRUST_STEP,
  CODEX_HOOKS_PATH,
  PLUGIN_TREE_PREFIX,
  PLUGIN_TREE_SEGMENTS,
  proposeCodexInstall,
  renderCodexHooks,
} from "@developer-os/adapter-codex";
import type { MarketplaceRootArtifact } from "@developer-os/adapter-codex";
import { MacOsPlatformDiscoveryError } from "@developer-os/platform-macos";
import type {
  AgentDiscovery,
  AgentName,
  PlatformAdapter,
} from "@developer-os/platform-macos";
import type { ProcessResult, ProcessRunner } from "@developer-os/security";

import {
  advisoryWarnings,
  CODEX_UNTRUSTED_HOOK_MESSAGE,
  codexPluginRoot,
  describeInstructions,
  hasBlockingFailure,
  hookFindings,
  hookFiringVerdicts,
  hookReports,
  listIncompleteTransactions,
  MAX_CLAUDE_SETTINGS_BYTES,
  runDoctor,
  runDoctorReport,
  runScheduledDoctor,
  UNSIGNED_LOCAL_TRUST_WARNING,
} from "./doctor.js";
import type { DoctorReportV1 } from "./doctor.js";
import { createScheduledJobHandlers } from "./automation/runner.js";
import { runInit } from "./init.js";
import { runRepair } from "./repair.js";
import { createCommandFixture, firstRegularFile, inventory, inventoryDigest, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures, retainedTombstones } from "./testing.js";
import type { CommandFixture } from "./testing.js";
import type { CliContext } from "../context.js";

/**
 * A local, structural stand-in for `RenderedArtifact`, which
 * `codexPluginRoot`'s test below needs. It was originally a workaround for
 * `apps/cli` carrying no `@developer-os/workflow-schema` dependency; DOS-P6
 * Task 11 added that edge, so the type *is* importable now and the stand-in is
 * kept on its own merits rather than out of necessity — this file's fixtures
 * describe the two fields the cast actually needs, and importing the full
 * published type would tie them to fields the test never sets.
 * `asSyntheticInstallTree` seals the `MarketplaceRootArtifact` cast
 * inside one function whose *parameter* is checked against this shape, so a
 * typo'd fixture (`{ paht: ... }`) is a `TS2353` at the call site rather than
 * silently passing through an unchecked inline cast.
 */
interface SyntheticArtifact {
  readonly path: string;
  readonly contents: string;
}

function asSyntheticInstallTree(
  tree: readonly SyntheticArtifact[],
): readonly MarketplaceRootArtifact[] {
  return tree as readonly MarketplaceRootArtifact[];
}

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const RETAINED_SECRET = "synthetic retained secret";

afterEach(removeCommandFixtures);

async function seedIncompleteTransaction(
  fixture: CommandFixture,
  id: string,
): Promise<void> {
  const journalDir = join(fixture.paths.stateDir, "transactions");
  await nodeFs.mkdir(journalDir, { recursive: true, mode: 0o700 });
  const timestamp = "2026-07-30T12:00:00.000Z";
  await nodeFs.writeFile(
    join(journalDir, `${id}.json`),
    `${JSON.stringify({
      schemaVersion: 1,
      id,
      kind: "init",
      phase: "staged",
      createdAt: timestamp,
      updatedAt: timestamp,
      mutations: [
        {
          targetPath: fixture.paths.configFile,
          operation: "create",
          expectedBeforeHash: null,
          stagedRelativePath: "0.bin",
        },
      ],
    })}\n`,
    { mode: 0o600 },
  );
}

/**
 * The id of the transaction a command just ran, read back rather than assumed.
 *
 * **A hand-written journal is not a substitute here.** The first version of the retention
 * cases seeded one, and `TransactionStore.read` rejected it as malformed — so `doctor`
 * reported a *different* fault with the same exit code, and the case would have passed on
 * its code assertion alone while proving nothing about retained payloads.
 */
async function onlyTransactionId(fixture: CommandFixture): Promise<string> {
  const journalDir = join(fixture.paths.stateDir, "transactions");
  const journals = (await nodeFs.readdir(journalDir))
    .filter((entry) => entry.endsWith(".json"))
    .sort();
  expect(journals).toHaveLength(1);
  return (journals[0] ?? "").slice(0, -".json".length);
}

/** The crash window: a payload on disk beside a journal that already reached a terminal phase. */
async function plantBackupFile(
  fixture: CommandFixture,
  id: string,
  name: string,
): Promise<string> {
  const directory = join(fixture.paths.backupsDir, "transactions", id);
  await nodeFs.mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, name);
  await nodeFs.writeFile(path, "a pre-edit copy of the user's file", {
    mode: 0o600,
  });
  return path;
}

describe("runDoctor", () => {
  it("publishes one content-free warning check per retained bootstrap ID without writing or disclosing", async () => {
    const fixture = await createCommandFixture("doctor-bootstrap-evidence", {
      bootstrapAvailable: true,
    });
    const initialized = await runInit(fixture.context, ACCEPTED);
    expect(initialized.ok).toBe(true);
    const tombstones = await retainedTombstones(fixture.root);
    const target = await firstRegularFile(tombstones);
    if (target === null) throw new Error("fixture retained no regular-file tombstone");
    await nodeFs.writeFile(target, RETAINED_SECRET, { mode: 0o600 });
    const before = await inventoryDigest(fixture.root);

    const report = await runDoctorReport(fixture.context);

    expect(report.retainedBootstrapEvidence).toHaveLength(1);
    expect(report.retainedBootstrapEvidence[0]).toMatchObject({
      status: "altered",
      operation: "fresh_v2_init",
    });
    expect(report.retainedBootstrapEvidence[0]?.vaultPath).toContain(".plan.json");
    expect(typeof report.retainedBootstrapEvidence[0]?.entryCount).toBe("number");
    expect(typeof report.retainedBootstrapEvidence[0]?.regularFileBytes).toBe("string");
    const evidenceChecks = report.checks.filter((check) =>
      check.id.startsWith("bootstrap-evidence:"),
    );
    expect(evidenceChecks).toHaveLength(1);
    expect(evidenceChecks[0]?.status).toBe("warn");
    expect(JSON.stringify(report)).not.toContain(RETAINED_SECRET);
    expect(await inventoryDigest(fixture.root)).toEqual(before);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * Doctor is run on exactly the machines where this read fails — a partial
   * slot, a foreign-uid entry in the namespace, or residue over the retention
   * cap. Unguarded, the inspection escaped as an unhandled rejection and the
   * user got a stack trace instead of a report.
   */
  it("reports a failing check instead of throwing when the evidence inspector refuses", async () => {
    const fixture = await createCommandFixture("doctor-bootstrap-evidence-refusal", {
      bootstrapAvailable: true,
    });
    const bootstrap = fixture.context.bootstrap;
    if (bootstrap?.state !== "available") throw new Error("fixture requires an available bootstrap");

    const report = await runDoctorReport({
      ...fixture.context,
      bootstrap: {
        ...bootstrap,
        inspectEvidence: () =>
          Promise.reject(new Error("retained bootstrap evidence exceeds its cap")),
      },
    });

    expect(report.retainedBootstrapEvidence).toStrictEqual([]);
    const refusals = report.checks.filter((check) => check.id === "bootstrap-evidence");
    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.status).toBe("fail");
    expect(report.checks.some((check) => check.id.startsWith("bootstrap-evidence:"))).toBe(false);
  }, 120_000);

  it("passes every check on a healthy installation", async () => {
    const fixture = await createCommandFixture("doctor-healthy");
    await runInit(fixture.context, ACCEPTED);

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe(EXIT_CODES.success);
    /** `vendor-config` warns: the fixture home has no Claude user settings file (A14 Task 10). */
    expect(
      result.data.checks.filter(
        (check) => check.status !== "pass" && check.id !== "vendor-config",
      ),
    ).toEqual([]);
    expect(
      result.data.checks.find((check) => check.id === "vendor-config")?.status,
    ).toBe("warn");
    expect(result.data.checks.map((check) => check.id)).toEqual([
      "platform",
      "product-home",
      "configuration",
      "manifest",
      "transactions",
      "drift",
      "brain",
      "redaction-key",
      "release-trust",
      "entrypoint",
      "agents",
      "claude-capabilities",
      "codex-capabilities",
      "hooks",
      "external-hooks",
      "vendor-config",
      "instructions",
      "codex-registration",
    ]);
    expect(result.data.instructions).toStrictEqual([]);
    /**
     * No Codex is installed in this fixture, and no `recovery=` is printed for
     * one that is either: the advice named `/hooks`, the command that grants
     * Codex's hook trust gate, and no hooks ship for it to gate
     * (knowledge-pipeline architecture note §2). The suite below pins that for the
     * installed case, where the advice used to be printed.
     */
    const codexAbsent = result.data.checks.find(
      (check) => check.id === "codex-capabilities",
    );
    expect(codexAbsent?.message).toContain("codex=absent");
    expect(codexAbsent?.message).not.toContain("recovery=");
  });

  /**
   * The leak assertions read the **whole serialized report**, not the one
   * message. Asserting `not.toContain` on a string already asserted equal to a
   * thirteen-character literal proves nothing, and a leak would surface where
   * a leak actually surfaces: somewhere in the `--json` document the user pipes
   * to a colleague.
   */
  it("reports the redaction key as present with its mode, never a byte of it", async () => {
    const fixture = await createCommandFixture("doctor-redaction-key-present");
    await runInit(fixture.context, ACCEPTED);
    const key = await nodeFs.readFile(
      join(fixture.paths.stateDir, "redaction.key"),
    );

    const report = await runDoctorReport(fixture.context);

    const check = report.checks.find(
      (candidate) => candidate.id === "redaction-key",
    );
    expect(check?.status).toBe("pass");
    expect(check?.message).toBe("present, 0600");

    const serialized = JSON.stringify(report);
    for (const encoding of ["hex", "base64", "base64url", "latin1"] as const) {
      expect(serialized).not.toContain(Buffer.from(key).toString(encoding));
    }
  });

  /**
   * The four states `readRedactionKey` returns `null` for, each reported and
   * each named. This branch is only reachable because the composition root
   * stopped creating and stopped throwing — before the split, a symlink or a
   * truncated key failed every command including this one, so `doctor` could
   * never have said any of these things. Four distinct messages, because
   * "something is wrong with your key" is not a diagnosis.
   */
  it.each([
    ["absent", null, "developer-os init"],
    ["a symlink", "symlink" as const, "is a symlink"],
    ["a directory", "directory" as const, "not a regular file"],
    ["too short", "short" as const, "too short"],
  ])(
    "warns rather than fails when the redaction key is %s",
    async (name, plant, expected) => {
      const fixture = await createCommandFixture(
        `doctor-key-${name.replace(/\s+/gu, "-")}`,
      );
      await runInit(fixture.context, ACCEPTED);
      const keyFile = join(fixture.paths.stateDir, "redaction.key");
      await nodeFs.unlink(keyFile);
      if (plant === "symlink") await nodeFs.symlink("/etc/passwd", keyFile);
      if (plant === "directory") await nodeFs.mkdir(keyFile, { mode: 0o700 });
      if (plant === "short") {
        await nodeFs.writeFile(keyFile, Buffer.alloc(8), { mode: 0o600 });
      }

      const report = await runDoctorReport(fixture.context);

      const check = report.checks.find(
        (candidate) => candidate.id === "redaction-key",
      );
      expect(check?.status).toBe("warn");
      expect(check?.message).toContain(expected);

      const result = await runDoctor(fixture.context);
      expect(result.ok).toBe(true);
    },
  );

  it("gives each unusable redaction-key state its own message", async () => {
    const messages = new Set<string>();
    for (const plant of ["absent", "symlink", "directory", "short"] as const) {
      const fixture = await createCommandFixture(`doctor-key-distinct-${plant}`);
      await runInit(fixture.context, ACCEPTED);
      const keyFile = join(fixture.paths.stateDir, "redaction.key");
      await nodeFs.unlink(keyFile);
      if (plant === "symlink") await nodeFs.symlink("/etc/passwd", keyFile);
      if (plant === "directory") await nodeFs.mkdir(keyFile, { mode: 0o700 });
      if (plant === "short") {
        await nodeFs.writeFile(keyFile, Buffer.alloc(8), { mode: 0o600 });
      }

      const report = await runDoctorReport(fixture.context);
      const check = report.checks.find(
        (candidate) => candidate.id === "redaction-key",
      );
      messages.add(check?.message ?? "");
    }

    expect(messages.size).toBe(4);
  });

  /**
   * The case the first implementation made unreachable: `readRedactionKey`
   * never chmods, so an over-permissive key survives context construction and
   * reaches this check. `doctor` reports it and repairs nothing — the next
   * command that needs a durable key is what tightens it.
   */
  it("warns about an over-permissive redaction key without tightening it", async () => {
    const fixture = await createCommandFixture("doctor-redaction-key-0644");
    await runInit(fixture.context, ACCEPTED);
    const keyFile = join(fixture.paths.stateDir, "redaction.key");
    await nodeFs.chmod(keyFile, 0o644);

    const report = await runDoctorReport(fixture.context);

    const check = report.checks.find(
      (candidate) => candidate.id === "redaction-key",
    );
    expect(check?.status).toBe("warn");
    expect(check?.message).toContain("0644");
    expect(check?.message).toContain("more permissive than 0600");
    expect((await nodeFs.stat(keyFile)).mode & 0o777).toBe(0o644);
  });

  /**
   * "More permissive than 0600" is a claim about the group and other bits, and
   * `0400` and `0000` have none set — they are *stricter*. The mode is still
   * wrong, and `doctor` still says so; it does not say the opposite of what is
   * true while doing it.
   */
  it.each([0o400, 0o000])(
    "does not call mode %s more permissive than 0600",
    async (mode) => {
      const fixture = await createCommandFixture(
        `doctor-redaction-key-${mode.toString(8)}`,
      );
      await runInit(fixture.context, ACCEPTED);
      const keyFile = join(fixture.paths.stateDir, "redaction.key");
      await nodeFs.chmod(keyFile, mode);

      const report = await runDoctorReport(fixture.context);
      await nodeFs.chmod(keyFile, 0o600);

      const check = report.checks.find(
        (candidate) => candidate.id === "redaction-key",
      );
      expect(check?.status).toBe("warn");
      expect(check?.message).not.toContain("more permissive");
      expect(check?.message).toContain("is not 0600");
    },
  );

  /**
   * The line a human reads, for an **installed** Codex — the case that used to
   * print `recovery="… run /hooks …"`. `codex-capabilities.test.ts` pins the
   * report one layer below; this pins the composed `DoctorCheck.message`,
   * because advice to open a trust gate in front of a hook nobody ships is
   * worse than silence: it is a command that appears to be worth running.
   */
  it("names no hook-trust command when Codex is installed", async () => {
    const runner: ProcessRunner = {
      run(request): Promise<ProcessResult> {
        return Promise.resolve({
          stdout: request.args[0] === "--version" ? "codex-cli 0.147.0" : "",
          stderr: "",
          exitCode: 0,
          signal: null,
          timedOut: false,
        });
      },
    };
    const fixture = await createCommandFixture("doctor-codex-installed", {
      runner,
      agents: {
        claude: { name: "claude", installed: false, executablePath: null, version: null },
        codex: {
          name: "codex",
          installed: true,
          executablePath: "/opt/synthetic/bin/codex",
          version: null,
        },
      },
    });
    await runInit(fixture.context, ACCEPTED);

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const codex = result.data.checks.find(
      (check) => check.id === "codex-capabilities",
    );
    expect(codex?.message).toContain("codex=0.147.0");
    expect(codex?.message).not.toContain("recovery=");
    expect(codex?.message).not.toContain("/hooks");
  });

  /**
   * NEW-158 (`hooks.md` §3.6): `plugin_hooks` resolves from any firing record of the vendor and
   * `session_start_injection` from its `inject` record, in the unprobed run too. Doctor read the
   * records for `hooks` but never handed them to the capability reports, so both stayed `unknown`.
   */
  it("resolves plugin_hooks and session_start_injection from each vendor's firing records", async () => {
    const runner: ProcessRunner = {
      run(request): Promise<ProcessResult> {
        const version = request.executable === "/opt/synthetic/bin/codex" ? "codex-cli 0.155.1" : "2.1.280 (Claude Code)";
        return Promise.resolve({
          stdout: request.args[0] === "--version" ? version : "",
          stderr: "",
          exitCode: 0,
          signal: null,
          timedOut: false,
        });
      },
    };
    const fixture = await createCommandFixture("doctor-firing-capabilities", {
      runner,
      agents: {
        claude: { name: "claude", installed: true, executablePath: "/opt/synthetic/bin/claude", version: null },
        codex: { name: "codex", installed: true, executablePath: "/opt/synthetic/bin/codex", version: null },
      },
    });
    await runInit(fixture.context, ACCEPTED);
    const before = await runDoctorReport(fixture.context);
    for (const id of ["claude-capabilities", "codex-capabilities"]) {
      const message = before.checks.find((check) => check.id === id)?.message;
      expect(message).toContain("plugin_hooks=unknown");
      expect(message).toContain("session_start_injection=unknown");
    }
    // The verdict counts a record only beside installed hooks it postdates (`hooks.md` §3.6).
    const executable = { node: "/opt/synthetic/bin/node", entrypoint: "/opt/synthetic/lib/developer-os" };
    const hooksWritten = new Date(fixture.context.now().getTime() - 3_600_000);
    for (const [path, contents] of [
      [join(fixture.userHome, ...PLUGIN_INSTALL_SEGMENTS, CLAUDE_HOOKS_PATH), renderClaudeHooks(executable).contents],
      [join(fixture.paths.home, ...PLUGIN_TREE_SEGMENTS, CODEX_HOOKS_PATH), renderCodexHooks(executable).contents],
    ] as const) {
      await nodeFs.mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(path, contents, { mode: 0o600 });
      await nodeFs.utimes(path, hooksWritten, hooksWritten);
    }
    const directory = join(fixture.paths.stateDir, "hooks");
    await nodeFs.mkdir(directory, { recursive: true, mode: 0o700 });
    for (const [vendor, rows] of [["claude", CLAUDE_HOOK_ROWS], ["codex", CODEX_HOOK_ROWS]] as const) {
      const event = rows.find((row) => row.verb === "inject")?.event;
      if (event === undefined) throw new Error(`no inject row for ${vendor}`);
      const lastSeen = fixture.context.now().toISOString();
      await nodeFs.writeFile(
        join(directory, hookFiringRecordName(vendor, "inject")),
        encodeHookFiringRecord({ schemaVersion: 1, vendor, event, productVersion: "0.0.0-test", firstSeen: lastSeen, lastSeen }),
        { mode: 0o600 },
      );
    }

    const report = await runDoctorReport(fixture.context);

    for (const id of ["claude-capabilities", "codex-capabilities"]) {
      const message = report.checks.find((check) => check.id === id)?.message;
      expect(message, id).toContain("plugin_hooks=yes");
      expect(message, id).toContain("session_start_injection=yes");
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reports an uninitialized machine as an operational failure", async () => {
    const fixture = await createCommandFixture("doctor-fresh");

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.operationalFailure);
    expect(result.error.recovery).toBe("developer-os init");
  });

  it("returns the recovery code and both recovery commands for an incomplete transaction", async () => {
    const fixture = await createCommandFixture("doctor-incomplete");
    await seedIncompleteTransaction(fixture, "tx_fixture_001");

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.recoveryRequired);
    expect(result.error.recovery).toBe(
      "developer-os repair --resume tx_fixture_001 | developer-os repair --rollback tx_fixture_001",
    );
  });

  it("names init, not repair, for an incomplete bootstrap Foundation journal (NEW-174)", async () => {
    const fixture = await createCommandFixture("doctor-incomplete-bootstrap-foundation");
    await seedIncompleteTransaction(fixture, "tx_fi_123e4567-e89b-42d3-a456-426614174000_0000000000_f");

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.recoveryRequired);
    expect(result.error.recovery).toBe("developer-os init");
  });

  /**
   * **The channel that lets the executor's forward path retain instead of raise, so it is
   * the assertion that keeps that from being a silent no-op.**
   *
   * `TransactionExecutor` prunes each transaction's backup payloads on the transition into
   * a terminal phase. Two things leave one standing: a crash between the transition and the
   * prune, and an `unlink` that fails for a reason other than "already gone". Raising out
   * of `execute` was the first fix and a worse defect — seven call sites read a throw as "the
   * transaction did not happen", which this is not — so the forward path retains and this
   * check is what makes a retained payload visible (BACKLOG, Foundation request 2).
   *
   * Seeded rather than provoked, because provoking it needs a filesystem that fails one
   * `unlink`; `transactions.test.ts` owns the executor half against exactly that fake.
   */
  it("reports a backup payload a finalized transaction left behind", async () => {
    const fixture = await createCommandFixture("doctor-retained-finalized");
    await runInit(fixture.context, ACCEPTED);
    const id = await onlyTransactionId(fixture);
    const payload = await plantBackupFile(fixture, id, "0.bin");

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.recoveryRequired);
    expect(result.error.recovery).toBe(`developer-os repair --resume ${id}`);
    expect(result.error.paths).toStrictEqual([payload]);
  });

  /**
   * **The rollback side names the other command**, because `resumeLocked` throws on a
   * rolled-back journal: telling a user to run `--resume` here would hand them a refusal.
   */
  it("reports a backup payload a rolled-back transaction left behind", async () => {
    const fixture = await createCommandFixture("doctor-retained-rolled-back", {
      interruptAfter: "applied",
    });
    await runInit(fixture.context, ACCEPTED);
    const id = await onlyTransactionId(fixture);
    const rolled = await runRepair(fixture.context, { resume: null, rollback: id });
    expect(rolled.ok).toBe(true);
    await plantBackupFile(fixture, id, "0.bin");

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.recoveryRequired);
    expect(result.error.recovery).toBe(`developer-os repair --rollback ${id}`);
  });

  /**
   * `writeDurableFile` writes each payload to `<index>.bin.tmp` and renames it, so a kill
   * inside `backUp` strands the same bytes under that name. The sweep and this check both
   * missed it, and `repair --rollback` — the route `doctor` and `init` print — never
   * re-runs `backUp`, so nothing cleared it either.
   */
  it("reports a payload stranded under its .tmp name", async () => {
    const fixture = await createCommandFixture("doctor-retained-tmp");
    await runInit(fixture.context, ACCEPTED);
    const id = await onlyTransactionId(fixture);
    const payload = await plantBackupFile(fixture, id, "0.bin.tmp");

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.paths).toStrictEqual([payload]);
  });

  /**
   * **A report whose named remedy cannot clear it is worse than no report.** This check
   * enumerates the directory; the prune derives its names from `journal.mutations`, and
   * has no `readdir` to do otherwise. A file the prune will never name — here a `9999.bin`
   * beside a fifteen-mutation journal — made `doctor` fail, the `repair` it printed
   * succeed, and `doctor` fail again, permanently. The check now intersects the listing
   * with exactly what the prune sweeps.
   */
  it("ignores a backup file no prune will ever name", async () => {
    const fixture = await createCommandFixture("doctor-retained-foreign");
    await runInit(fixture.context, ACCEPTED);
    const id = await onlyTransactionId(fixture);
    await plantBackupFile(fixture, id, "9999.bin");

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(true);
  });

  /**
   * **The metadata is not a payload, and a check that counted every file would fire on
   * every finalized transaction the product has ever run.** `backUp` writes `<index>.json`
   * beside each payload and the prune deliberately keeps it: it holds `{existed, mode,
   * atimeMs, mtimeMs}` and none of the bytes.
   */
  it("does not report retained metadata as a leftover payload", async () => {
    const fixture = await createCommandFixture("doctor-retained-metadata");
    await runInit(fixture.context, ACCEPTED);
    const id = await onlyTransactionId(fixture);
    await plantBackupFile(fixture, id, "0.json");

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(true);
  });

  it("reports drift as a decision the user must make", async () => {
    const fixture = await createCommandFixture("doctor-drift");
    await runInit(fixture.context, ACCEPTED);
    await nodeFs.writeFile(fixture.paths.configFile, "schemaVersion = 1\n", {
      mode: 0o600,
    });

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
    expect(result.error.paths).toContain(fixture.paths.configFile);
  });

  it("reports an unsupported platform as a capability failure", async () => {
    const unsupported = Object.assign(
      new Error("Developer OS supports macOS only; this host reports linux"),
      { code: EXIT_CODES.capabilityUnavailable },
    );
    const fixture = await createCommandFixture("doctor-platform", {
      inspectFailure: unsupported,
    });
    await createCommandFixture("doctor-platform-install");

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.capabilityUnavailable);
  });

  it("reports rather than rejects when a journal is unparseable", async () => {
    const fixture = await createCommandFixture("doctor-corrupt-journal");
    await runInit(fixture.context, ACCEPTED);
    const journalDir = join(fixture.paths.stateDir, "transactions");
    await nodeFs.writeFile(join(journalDir, "tx_fixture_bad.json"), "{}\n", {
      mode: 0o600,
    });

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.recoveryRequired);
  });

  it("reports rather than rejects when a managed artifact is too large to read", async () => {
    const fixture = await createCommandFixture("doctor-unreadable");
    await runInit(fixture.context, ACCEPTED);
    await nodeFs.writeFile(
      fixture.paths.configFile,
      Buffer.alloc(9 * 1024 * 1024, 0x61),
      { mode: 0o600 },
    );

    const report = await runDoctorReport(fixture.context);
    const drift = report.checks.find((check) => check.id === "drift");

    expect(drift?.status).toBe("fail");
    expect((await runDoctor(fixture.context)).ok).toBe(false);
  });

  it("never repairs what it reports", async () => {
    const fixture = await createCommandFixture("doctor-read-only");
    await runInit(fixture.context, ACCEPTED);
    await nodeFs.writeFile(fixture.paths.configFile, "schemaVersion = 1\n", {
      mode: 0o600,
    });
    await seedIncompleteTransaction(fixture, "tx_fixture_007");
    const before = await inventory(fixture.root);

    await runDoctor(fixture.context);

    expect(await inventory(fixture.root)).toEqual(before);
    expect(await nodeFs.readFile(fixture.paths.configFile, "utf8")).toBe(
      "schemaVersion = 1\n",
    );
  });
});

/**
 * The two-gate model's first production caller, and why it is opt-in.
 *
 * `probeClaude` runs `claude plugin validate`, which Claude architecture former §14.1 records as
 * writing `~/.claude.json` and a timestamped backup under `~/.claude/backups/`
 * — observed against a real installation on 2026-08-11. A default-on probe
 * would make `doctor` a silently mutating command, which contradicts the rule
 * that it reports rather than repairs.
 *
 * The first two cases are **regression pins**: they hold before `--probe`
 * exists, and exist so that adding it cannot quietly flip the default. The
 * rest are the new behaviour.
 *
 * Every process this fixture answers is synthetic. No vendor binary is spawned
 * here, and the plugin directory the probe lists is one this suite wrote.
 */
describe("runDoctor --probe", () => {
  const CLAUDE = "/opt/synthetic/bin/claude";
  const CODEX = "/opt/synthetic/bin/codex";

  interface Spawn {
    readonly executable: string;
    readonly args: readonly string[];
  }

  /**
   * Anything that is not the version read. `discoverCli` asks `--version` and
   * nothing else, so every other call either capability check makes is a probe
   * — `claude plugin validate <dir>` or `codex plugin list --json`. Written as
   * the complement rather than a list of the two probe argv shapes, so a third
   * probe added later is caught rather than ignored.
   */
  const isProbe = (spawn: Spawn): boolean => spawn.args[0] !== "--version";

  /**
   * Every probe one agent's binary received.
   *
   * Counting probes **per executable** rather than in total is what makes the
   * two-agent assertions mean anything: `--probe` turns both reporters on, and
   * a total of two is also what one agent probed twice would produce.
   */
  const probesOf = (
    spawned: readonly Spawn[],
    executable: string,
  ): readonly Spawn[] =>
    spawned.filter((spawn) => isProbe(spawn) && spawn.executable === executable);

  interface ProbeFixture {
    readonly fixture: CommandFixture;
    /** Every spawn since `init` finished. */
    readonly spawned: readonly Spawn[];
    /** Every spawn `init` itself made, which must contain no probe. */
    readonly duringInit: readonly Spawn[];
  }

  interface ProbeFixtureOptions {
    /** What the synthetic `claude --version` reports. */
    readonly claudeVersion?: string;
    /** Whether the plugin directory holds a `SKILL.md` for the probe to see. */
    readonly skill?: boolean;
    readonly codexInstalled?: boolean;
  }

  async function createProbeFixture(
    label: string,
    options: ProbeFixtureOptions = {},
  ): Promise<ProbeFixture> {
    const claudeVersion = options.claudeVersion ?? "2.1.216";
    const spawned: Spawn[] = [];
    const runner: ProcessRunner = {
      run(request): Promise<ProcessResult> {
        spawned.push({
          executable: request.executable,
          args: [...request.args],
        });
        const version =
          request.executable === CODEX
            ? "codex-cli 0.147.0"
            : `${claudeVersion} (Claude Code)`;
        return Promise.resolve({
          stdout: request.args[0] === "--version" ? version : "",
          stderr: "",
          exitCode: 0,
          signal: null,
          timedOut: false,
        });
      },
    };

    const fixture = await createCommandFixture(label, {
      runner,
      agents: {
        claude: {
          name: "claude",
          installed: true,
          executablePath: CLAUDE,
          version: null,
        },
        codex:
          options.codexInstalled === true
            ? {
                name: "codex",
                installed: true,
                executablePath: CODEX,
                version: null,
              }
            : {
                name: "codex",
                installed: false,
                executablePath: null,
                version: null,
              },
      },
    });
    await runInit(fixture.context, ACCEPTED);
    const duringInit = [...spawned];
    spawned.length = 0;

    /**
     * The directory `checkClaudeCapabilities` points the probe at, resolved
     * from the adapter's own segments rather than restated, and written into
     * the fixture's synthetic home. `init` installs no agent integration
     * (Foundation ships none), so nothing but this suite puts a file here.
     */
    const pluginDirectory = join(fixture.userHome, ...PLUGIN_INSTALL_SEGMENTS);
    await nodeFs.mkdir(pluginDirectory, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(
      join(pluginDirectory, options.skill === false ? "README.md" : "SKILL.md"),
      "# synthetic\n",
      { mode: 0o600 },
    );

    return { fixture, spawned, duringInit };
  }

  /**
   * One Claude capability's state, read out of the composed
   * `DoctorCheck.message` — the line a user actually reads, rather than a
   * structure only this suite would see. `null` when the key is absent from the
   * matrix entirely, which is a different failure from any state it can hold.
   */
  function capabilityIn(report: DoctorReportV1, key: string): string | null {
    const message =
      report.checks.find((check) => check.id === "claude-capabilities")
        ?.message ?? "";
    const token = message
      .split(" ")
      .find((candidate) => candidate.startsWith(`${key}=`));
    return token?.slice(key.length + 1) ?? null;
  }

  function reportOf(result: CliResult<DoctorReportV1>): DoctorReportV1 {
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("doctor failed on a healthy fixture");
    return result.data;
  }

  it("does not spawn a vendor probe without --probe", async () => {
    const probed = await createProbeFixture("doctor-probe-off", {
      codexInstalled: true,
    });

    await runDoctor(probed.fixture.context, { probe: false });

    /**
     * The non-empty half of the gate: a run that spawned nothing at all would
     * satisfy the assertion below while proving nothing. Both agents are
     * installed, so both version reads must have happened.
     */
    expect(probed.spawned.filter((spawn) => !isProbe(spawn))).toHaveLength(2);
    expect(probed.spawned.filter(isProbe)).toEqual([]);
  });

  it("reports skills as unknown without --probe, which is what 'we did not ask' means", async () => {
    const probed = await createProbeFixture("doctor-probe-unasked");

    const report = reportOf(
      await runDoctor(probed.fixture.context, { probe: false }),
    );

    expect(capabilityIn(report, "skills")).toBe("unknown");
  });

  /**
   * Correction 3's blast radius, pinned where it can be seen: `runDoctorReport`
   * is `init`'s injected `verify` dependency, and `init` calls it with a context
   * and nothing else. If the options parameter ever stops defaulting to no
   * probe, `init` starts writing to the user's Claude home as a side effect of
   * verifying its own install.
   *
   * **Both entry points, because both carry the default.** Every other case in
   * this suite passes options explicitly and `main.ts` always does too, so
   * `runDoctor`'s own `= NO_PROBE` was pinned by nothing — flipping it to
   * `{ probe: true }` broke no test. The `runDoctor` half below is that pin.
   */
  it("probes nothing when no options are passed, on either entry point", async () => {
    const report = await createProbeFixture("doctor-probe-default-report");

    await runDoctorReport(report.fixture.context);

    expect(report.duringInit.filter(isProbe)).toEqual([]);
    expect(report.spawned.filter(isProbe)).toEqual([]);
    expect(report.spawned.filter((spawn) => !isProbe(spawn))).toHaveLength(1);

    const result = await createProbeFixture("doctor-probe-default-result");

    await runDoctor(result.fixture.context);

    expect(result.spawned.filter(isProbe)).toEqual([]);
    expect(result.spawned.filter((spawn) => !isProbe(spawn))).toHaveLength(1);
  });

  it("states before it runs that --probe writes to the Claude home", async () => {
    const probed = await createProbeFixture("doctor-probe-warns");

    await runDoctor(probed.fixture.context, { probe: true });

    const stderr = probed.fixture.io.err.join("\n");
    expect(stderr).toContain("writes");
    expect(stderr).toContain(".claude.json");
  });

  /**
   * **Every sub-case asserts a probe was spawned, not only the one that ends in
   * `yes`.** `unknown` is also what comes back when the probe never ran at all
   * (`claude-capabilities.ts`'s `not-probed` branch), when discovery failed, and
   * when the executable is absent — so a sub-case asserting only `unknown` is a
   * scan that passes over an empty set. Concretely: a change that skipped
   * `probeClaude` below the floor would leave `belowFloor` green while the
   * sentence above it — the probe observed, the table refused — became false.
   */
  it("settles skills to yes only when the table permits and a probe observed", async () => {
    const observing = await createProbeFixture("doctor-probe-observes", {
      codexInstalled: true,
    });
    const observed = reportOf(
      await runDoctor(observing.fixture.context, { probe: true }),
    );
    expect(capabilityIn(observed, "skills")).toBe("yes");
    /**
     * One flag, both reporters. Codex's probe is a different call to a
     * different binary (`codex plugin list --json`, which writes nothing), and
     * until it was counted here `checkCodexCapabilities(context, true)` had no
     * run behind it at all.
     */
    expect(probesOf(observing.spawned, CLAUDE)).toHaveLength(1);
    expect(probesOf(observing.spawned, CODEX)).toHaveLength(1);

    /**
     * The probe ran and saw no `SKILL.md`: it asked and the answer is absent,
     * which is `no` rather than `yes` or `unknown` (NEW-62).
     */
    const silent = await createProbeFixture("doctor-probe-silent", {
      skill: false,
    });
    const unobserved = reportOf(
      await runDoctor(silent.fixture.context, { probe: true }),
    );
    expect(capabilityIn(unobserved, "skills")).toBe("no");
    expect(probesOf(silent.spawned, CLAUDE)).toHaveLength(1);

    /**
     * `2.1.100` is below `CLAUDE_MINIMUM_VERSION`. The probe still observes the
     * skill; the version gate refuses it, which is the half of the two-gate
     * model a probe alone cannot supply.
     */
    const old = await createProbeFixture("doctor-probe-below-floor", {
      claudeVersion: "2.1.100",
    });
    const belowFloor = reportOf(
      await runDoctor(old.fixture.context, { probe: true }),
    );
    expect(capabilityIn(belowFloor, "skills")).toBe("unknown");
    expect(probesOf(old.spawned, CLAUDE)).toHaveLength(1);
  });
});

describe("agent discovery that refuses", () => {
  /**
   * The composition this pins. `MacOsPlatformAdapter` refuses a `which` result
   * it cannot vouch for — most often because the redactor rewrote a long,
   * high-entropy path — and that refusal is correct: reporting it as installed
   * would record an executable that never existed.
   *
   * What must not follow is the whole product becoming unusable. Foundation
   * installs no agent integration at all, so agent presence is informational,
   * `status` already degrades this to a warning, and `doctor` must agree. When
   * it did not, `init` read the failing check as failed post-install
   * verification and reverted a perfectly good install, telling the user only
   * "post-install verification failed".
   *
   * The real error class below is not a stand-in: `checkAgents` demotes exactly
   * this one, so a plain `Error` would test a path production never takes.
   */
  const REFUSAL = new MacOsPlatformDiscoveryError(
    "Agent discovery returned an unusable executable path",
  );

  it("is a warning, not a failing check", async () => {
    const fixture = await createCommandFixture("doctor-agents-refused", {
      discoveryFailure: REFUSAL,
    });
    await runInit(fixture.context, ACCEPTED);

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe(EXIT_CODES.success);

    const agents = result.data.checks.find((check) => check.id === "agents");
    expect(agents?.status).toBe("warn");
    expect(
      result.data.checks.filter((check) => check.status === "fail"),
    ).toEqual([]);
  });

  it("does not stop init from completing", async () => {
    const fixture = await createCommandFixture("init-agents-refused", {
      discoveryFailure: REFUSAL,
    });

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transactionId).not.toBeNull();
    await expect(
      nodeFs.readFile(fixture.paths.configFile, "utf8"),
    ).resolves.toContain("brainPath");
    await expect(
      nodeFs.readFile(fixture.paths.manifestFile, "utf8"),
    ).resolves.toContain("artifacts");
  });

  it("never shadows a real failure or its recovery", async () => {
    const unsupported = Object.assign(new Error("this host is not supported"), {
      code: EXIT_CODES.capabilityUnavailable,
    });
    const fixture = await createCommandFixture("doctor-agents-vs-platform", {
      discoveryFailure: REFUSAL,
      inspectFailure: unsupported,
    });
    await runInit(fixture.context, ACCEPTED);

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    /**
     * The warning must not decide the code, and must not supply the recovery
     * string — that has to come from the check that decided it.
     */
    expect(result.code).toBe(EXIT_CODES.capabilityUnavailable);
    expect(result.error.message).toContain("platform:");
    expect(result.error.message).not.toContain("agents:");
  });

  it("is not something a discovery error of another kind can hide behind", async () => {
    const refused = Object.assign(new Error("PATH contains a NUL byte"), {
      code: EXIT_CODES.invalidInput,
    });
    const fixture = await createCommandFixture("doctor-agents-invalid", {
      discoveryFailure: refused,
    });
    await runInit(fixture.context, ACCEPTED);

    const report = await runDoctorReport(fixture.context);

    /**
     * Only `MacOsPlatformDiscoveryError` is demoted. Flattening every error the
     * adapter or the process runner can raise would erase the one signal that
     * says a guard fired.
     */
    expect(report.checks.find((check) => check.id === "agents")?.status).toBe(
      "fail",
    );
  });
});

/**
 * "We could not ask" printed as "not installed", one layer above the
 * conflation `unreadable` exists to prevent (`codex-adapter.md` §11.6).
 *
 * Every assertion here reads a check **message**, never an id or a status: the
 * end-to-end fixture that kept the same bug green for the discoverable case
 * read ids and statuses, and passed while one report said `agents:
 * claude=present` and `claude-capabilities: claude=absent` about one file.
 *
 * The positive form is deliberate. `expect(a.includes("present") &&
 * b.includes("absent")).toBe(false)` is green against the unfixed code — a
 * throwing discovery leaves the `agents` message holding the redacted *error*,
 * which contains neither word, so the conjunction holds and would keep holding
 * after a revert.
 */
describe("discovery that throws for one agent", () => {
  const REFUSED = new MacOsPlatformDiscoveryError(
    "Agent discovery returned an unusable executable path",
  );

  const versionRunner: ProcessRunner = {
    run(request): Promise<ProcessResult> {
      return Promise.resolve({
        stdout: request.args[0] === "--version" ? "codex-cli 0.147.0" : "",
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
      });
    },
  };

  const installed = (name: AgentName): AgentDiscovery => ({
    name,
    installed: true,
    executablePath: `/opt/synthetic/bin/${name}`,
    version: null,
  });

  /**
   * Refuses discovery for one agent and answers honestly for the other, which
   * the fixture's own `discoveryFailure` cannot express — it refuses for every
   * agent, and a suite that only ever fails both cannot see one agent
   * inheriting the other's failure.
   */
  async function runDoctorWhereDiscoveryThrows(
    agent: AgentName,
  ): Promise<DoctorReportV1> {
    const fixture = await createCommandFixture(`doctor-throws-${agent}`, {
      runner: versionRunner,
      agents: { claude: installed("claude"), codex: installed("codex") },
    });
    const real = fixture.context.platform;
    const platform: PlatformAdapter = {
      inspect: () => real.inspect(),
      assertTrustedExecutable: (): Promise<void> => Promise.resolve(),
      discoverExecutable: (name) =>
        name === agent
          ? Promise.reject(REFUSED)
          : real.discoverExecutable(name),
      productStateRoot: (home) => real.productStateRoot(home),
      proposedBrainRoot: (home) => real.proposedBrainRoot(home),
    };

    return runDoctorReport({ ...fixture.context, platform });
  }

  it.each(["claude", "codex"] as const)(
    "says %s is present and unreadable when discovery threw, never absent",
    async (agent) => {
      const report = await runDoctorWhereDiscoveryThrows(agent);
      const agents = report.checks.find((check) => check.id === "agents");
      const capabilities = report.checks.find(
        (check) => check.id === `${agent}-capabilities`,
      );

      expect(agents?.message).toContain(`${agent}=present`);
      expect(capabilities?.message).toContain(`${agent}=unreadable`);
    },
  );

  /**
   * The serial loop aborted on the first throw, so a refusing `claude` left
   * `codex` reported absent when nothing had asked it. Both agents are
   * discovered independently or the second inherits the first one's failure.
   */
  it("still reports the other agent when one agent's discovery throws", async () => {
    const report = await runDoctorWhereDiscoveryThrows("claude");
    const byId = new Map(
      report.checks.map((check) => [check.id, check.message]),
    );

    expect(byId.get("agents")).toContain("codex=present");
    expect(byId.get("codex-capabilities")).toContain("codex=0.147.0");
    expect(byId.get("codex-capabilities")).not.toContain("codex=absent");
  });
});

/**
 * `codexPluginRoot` computes the Codex plugin root independently of
 * `packages/adapter-codex/src/install.ts`'s `marketplaceRoot` — same product
 * home, different path module (platform `join` here, `posix.join` there).
 * `doctor` never sets `probe: true`, so nothing exercises this value against
 * anything; the Claude-side twin of exactly this failure (dead until the
 * probe flips on, then wrong) was fixed elsewhere in this branch, and this
 * pins the Codex side so it cannot regress the same way unnoticed.
 *
 * The expectation is derived from `proposeCodexInstall`'s own output — the
 * plugin manifest's `targetPath`, walked up two directories — rather than
 * restated as a second literal, so the two computations can never drift
 * apart silently.
 */
describe("codexPluginRoot", () => {
  it("names the same directory proposeCodexInstall targets for the plugin manifest", async () => {
    const fixture = await createCommandFixture("doctor-codex-plugin-root");
    const manifestRelativePath = posix.join(
      PLUGIN_TREE_PREFIX,
      ".codex-plugin/plugin.json",
    );
    // A synthetic single-artifact tree, not one `renderCodexInstallTree`
    // produced — this test only needs `proposeCodexInstall`'s own path math,
    // so it never renders a real plugin. `MarketplaceRootArtifact`'s brand
    // carries no runtime marker, so this changes nothing the function under
    // test observes.
    const tree = asSyntheticInstallTree([
      { path: manifestRelativePath, contents: "{}" },
    ]);
    const proposal = proposeCodexInstall(tree, {
      home: fixture.context.paths.home,
      productVersion: "0.0.0",
    });
    const manifestOperation = proposal.operations.find(
      (operation) => operation.source === manifestRelativePath,
    );
    expect(manifestOperation).toBeDefined();
    if (manifestOperation === undefined) return;

    const targetedRoot = posix.dirname(
      posix.dirname(manifestOperation.targetPath),
    );
    expect(codexPluginRoot(fixture.context)).toBe(targetedRoot);
  });
});

describe("surveyTransactions racing terminal compaction", () => {
  it("skips a journal removed between the listing and the read", async () => {
    const fixture = await createCommandFixture("doctor-compacted-journal");
    await seedIncompleteTransaction(fixture, "tx_fixture_008");
    const journalDir = join(fixture.paths.stateDir, "transactions");
    const journal = join(journalDir, "tx_fixture_008.json");

    expect(await listIncompleteTransactions(fixture.context)).toStrictEqual([
      { id: "tx_fixture_008", phase: "staged" },
    ]);

    const readdir = fixture.context.fs.readdir;
    const compacting: typeof fixture.context = {
      ...fixture.context,
      fs: {
        ...fixture.context.fs,
        readdir: (async (path: Parameters<typeof readdir>[0]) => {
          const entries = await readdir(path);
          if (String(path) === journalDir) await nodeFs.rm(journal, { force: true });
          return entries;
        }) as typeof readdir,
      },
    };

    expect(await listIncompleteTransactions(compacting)).toStrictEqual([]);
  });
});

describe("release-trust", () => {
  const SIGNED_TRUST = {
    schemaVersion: 1,
    highestDelegationSequence: "1",
    delegationHash: "a".repeat(64),
    delegatedReleaseKeyId: "b".repeat(64),
    highestReleaseIndexSequence: "1",
    releaseIndexHash: "c".repeat(64),
    highestAcceptedReleaseSequence: "1",
    releaseIdentityHash: "d".repeat(64),
  } as const;

  async function trustCheck(label: string, state: Record<string, unknown> | null) {
    const fixture = await createCommandFixture(label);
    if (state !== null) {
      await nodeFs.mkdir(fixture.paths.stateDir, { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(
        join(fixture.paths.stateDir, "release-trust.json"),
        encodeCanonicalJson(state as never),
        { mode: 0o600 },
      );
    }
    const report = await runDoctorReport(fixture.context);
    return report.checks.find((check) => check.id === "release-trust");
  }

  it("warns on every run when the home was installed from an unsigned local build", async () => {
    const check = await trustCheck("doctor-trust-unsigned", { ...SIGNED_TRUST, trust: "unsigned-local" });
    expect(check?.status).toBe("warn");
    expect(check?.message).toBe("installed from an unsigned local build; update and rollback refuse it");
    expect(UNSIGNED_LOCAL_TRUST_WARNING).toBe(check?.message);
  });

  it("passes a signed state", async () => {
    expect((await trustCheck("doctor-trust-signed", SIGNED_TRUST))?.status).toBe("pass");
  });

  it("passes when no trust state is recorded", async () => {
    expect((await trustCheck("doctor-trust-absent", null))?.status).toBe("pass");
  });

  it("fails a state with a trust value other than unsigned-local", async () => {
    expect((await trustCheck("doctor-trust-invalid", { ...SIGNED_TRUST, trust: "signed" }))?.status).toBe("fail");
  });
});

describe("instruction checks", () => {
  it("renders one human line per artifact as `<owner> <category>/<id>: <source>, <state>`", () => {
    const report: DoctorReportV1 = {
      schemaVersion: 1,
      checks: [],
      retainedBootstrapEvidence: [],
      instructions: [
        { owner: "claude", category: "rule", id: "careful" as never, source: "default", state: "installed", paths: ["/p/a"] },
        { owner: "codex", category: "output-style", id: "terse" as never, source: "user", state: "unsupported-vendor", paths: [] },
      ],
    };
    expect(describeInstructions(report)).toStrictEqual([
      "claude rule/careful: default, installed",
      "codex output-style/terse: user, unsupported-vendor",
    ]);
  });

  it("owns neither new check for init, so a failing one never reverts an install", () => {
    const report: DoctorReportV1 = {
      schemaVersion: 1,
      checks: [
        { id: "instructions", status: "fail", message: "1 instruction artifacts are drifted or missing", paths: [] },
        { id: "codex-registration", status: "fail", message: "unregistered", paths: [] },
      ],
      retainedBootstrapEvidence: [],
      instructions: [],
    };
    expect(hasBlockingFailure(report)).toBe(false);
    expect(advisoryWarnings(report)).toStrictEqual([
      "instructions: 1 instruction artifacts are drifted or missing",
      "codex-registration: unregistered",
    ]);
  });

  it("passes both checks and lists nothing on a V1 installation", async () => {
    const fixture = await createCommandFixture("doctor-instructions-v1");
    await runInit(fixture.context, ACCEPTED);

    const report = await runDoctorReport(fixture.context);

    expect(report.instructions).toStrictEqual([]);
    expect(report.checks.find((check) => check.id === "instructions")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "codex-registration")?.status).toBe("pass");
  });

  it("warns when CLAUDE_CONFIG_DIR is set, because the managed files are then not the ones Claude reads", async () => {
    const fixture = await createCommandFixture("doctor-claude-config-dir", {
      env: { CLAUDE_CONFIG_DIR: "/synthetic/claude-config" },
    });
    await runInit(fixture.context, ACCEPTED);

    const check = (await runDoctorReport(fixture.context)).checks.find((candidate) => candidate.id === "instructions");

    expect(check?.status).toBe("warn");
    expect(check?.message).toContain("CLAUDE_CONFIG_DIR");
    expect(check?.message).not.toContain("/synthetic/claude-config");
  });
});

describe("hooks and external-hooks", () => {
  // Real files: doctor checks that the installed command still names an existing Node and entrypoint.
  let binDirectory = "";
  let HOOK_EXECUTABLE = { node: "", entrypoint: "" };
  let EXECUTABLE = "";
  beforeAll(async () => {
    binDirectory = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "developer-os-doctor-hooks-bin-")));
    HOOK_EXECUTABLE = { node: join(binDirectory, "node"), entrypoint: join(binDirectory, "developer-os") };
    EXECUTABLE = `${HOOK_EXECUTABLE.node} ${HOOK_EXECUTABLE.entrypoint}`;
    await nodeFs.writeFile(HOOK_EXECUTABLE.node, "#!/bin/sh\n", { mode: 0o755 });
    await nodeFs.writeFile(HOOK_EXECUTABLE.entrypoint, "// synthetic entrypoint\n", { mode: 0o644 });
  });
  afterAll(async () => {
    await nodeFs.rm(binDirectory, { recursive: true, force: true });
  });
  const NOW = new Date("2026-09-22T12:00:00.000Z");
  const CODEX_EXTERNAL = "codex=unknown (config.toml is not read (codex-adapter.md §2.3))";

  async function hooksFixture(name: string): Promise<CommandFixture> {
    return createCommandFixture(name, { now: () => NOW });
  }

  function hooksFile(fixture: CommandFixture): string {
    return join(fixture.userHome, ...PLUGIN_INSTALL_SEGMENTS, CLAUDE_HOOKS_PATH);
  }

  function settingsFile(fixture: CommandFixture): string {
    return join(fixture.userHome, ".claude", "settings.json");
  }

  async function plant(path: string, contents: string): Promise<void> {
    await nodeFs.mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(path, contents, { mode: 0o600 });
  }

  async function plantHooks(fixture: CommandFixture, drop?: string, executable = HOOK_EXECUTABLE): Promise<void> {
    const rendered = JSON.parse(renderClaudeHooks(executable).contents) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    if (drop !== undefined) {
      for (const [event, groups] of Object.entries(rendered.hooks)) {
        rendered.hooks[event] = groups.filter(
          (group) => !group.hooks.some((hook) => hook.command.endsWith(` guard ${drop} --vendor claude`)),
        );
      }
    }
    await plant(hooksFile(fixture), `${JSON.stringify(rendered, null, 2)}\n`);
  }

  /** `mtime` defaults to before every record the tests plant, so no record reads as stale. */
  async function plantCodexHooks(fixture: CommandFixture, mtime = new Date("2026-09-20T00:00:00.000Z")): Promise<void> {
    const path = join(fixture.paths.home, ...PLUGIN_TREE_SEGMENTS, CODEX_HOOKS_PATH);
    await plant(path, renderCodexHooks(HOOK_EXECUTABLE).contents);
    await nodeFs.utimes(path, mtime, mtime);
  }

  async function plantRecord(
    fixture: CommandFixture,
    verb: string,
    lastSeen: string,
    vendor: "claude" | "codex" = "claude",
  ): Promise<void> {
    const event = (vendor === "claude" ? CLAUDE_HOOK_ROWS : CODEX_HOOK_ROWS).find((row) => row.verb === verb)?.event;
    if (event === undefined) throw new Error(`no hook row for ${verb}`);
    const directory = join(fixture.paths.stateDir, "hooks");
    await nodeFs.mkdir(directory, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(
      join(directory, hookFiringRecordName(vendor, verb)),
      encodeHookFiringRecord({
        schemaVersion: 1,
        vendor,
        event,
        productVersion: "0.0.0-test",
        firstSeen: lastSeen,
        lastSeen,
      }),
      { mode: 0o600 },
    );
  }

  async function checksOf(fixture: CommandFixture): Promise<{
    readonly hooks: DoctorReportV1["checks"][number];
    readonly external: DoctorReportV1["checks"][number];
  }> {
    const checks = (await hookFindings(fixture.context, await hookReports(fixture.context, fixture.paths.stateDir))).map((finding) => finding.check);
    const hooks = checks.find((check) => check.id === "hooks");
    const external = checks.find((check) => check.id === "external-hooks");
    if (hooks === undefined || external === undefined) throw new Error("hook checks are missing");
    expect(checks.every((check) => check.status !== "fail")).toBe(true);
    return { hooks, external };
  }

  it("reports claude=not-installed and codex=not-installed without a hooks file", async () => {
    const fixture = await hooksFixture("doctor-hooks-absent");

    const { hooks } = await checksOf(fixture);

    expect(hooks.status).toBe("pass");
    expect(hooks.message).toBe("claude=not-installed; codex=not-installed");
  });

  it("passes with every row installed and names each row's firing age in whole hours", async () => {
    const fixture = await hooksFixture("doctor-hooks-installed");
    expect(CLAUDE_HOOK_ROWS).toHaveLength(8);
    await plantHooks(fixture);
    await plantRecord(fixture, "inject", "2026-09-22T09:00:00.000Z");
    for (const verb of ["command", "commit", "path"]) await plantRecord(fixture, verb, "2026-09-21T11:30:00.000Z");

    const { hooks } = await checksOf(fixture);

    expect(hooks.status).toBe("pass");
    expect(hooks.message).toContain("claude=installed");
    expect(hooks.message).toContain("inject=3h");
    expect(hooks.message).toContain("command=24h");
    expect(hooks.message).toContain("commit=24h");
    expect(hooks.message).toContain("path=24h");
    expect(hooks.message).toContain("stop=never");
    for (const row of CLAUDE_HOOK_ROWS) expect(hooks.message).toContain(`${row.verb}=`);
    expect(hooks.message).not.toContain("missing=");
    expect(hooks.message.endsWith("; codex=not-installed")).toBe(true);
  });

  /**
   * NEW-158 review: `plugin_hooks` and `session_start_injection` come from the same verdict `hooks`
   * prints. A record older than the 24 h window, or older than the installed `hooks.json` (Codex
   * re-gates rewritten commands), observes nothing, and a failed record write leaves both unknown.
   */
  it.each([
    { name: "a fresh record after the hooks file", lastSeen: "2026-09-22T09:00:00.000Z", mtime: "2026-09-20T00:00:00.000Z", failed: false, expected: [["plugin_hooks", "observed"], ["session_start_injection", "observed"]] },
    { name: "a record older than 24 h", lastSeen: "2026-09-21T11:00:00.000Z", mtime: "2026-09-20T00:00:00.000Z", failed: false, expected: [] },
    { name: "a record older than the hooks file", lastSeen: "2026-09-22T09:00:00.000Z", mtime: "2026-09-22T10:00:00.000Z", failed: false, expected: [] },
    { name: "a failed record write", lastSeen: "2026-09-22T09:00:00.000Z", mtime: "2026-09-20T00:00:00.000Z", failed: true, expected: [] },
  ])("derives the firing capabilities from the hooks verdict: $name", async ({ lastSeen, mtime, failed, expected }) => {
    const fixture = await hooksFixture(`doctor-hooks-firing-${String(failed)}-${mtime}-${lastSeen}`);
    await plantCodexHooks(fixture, new Date(mtime));
    await plantRecord(fixture, "inject", lastSeen, "codex");
    if (failed) await nodeFs.writeFile(join(fixture.paths.stateDir, "hooks", "codex.record_failed.json"), "", { mode: 0o600 });

    const verdicts = await hookFiringVerdicts(fixture.context, fixture.paths.stateDir);

    expect([...verdicts.codex]).toStrictEqual(expected);
    expect([...verdicts.claude]).toStrictEqual([]);
  });

  it("warns with record=failed while the vendor's failure marker is present, so a failed write never reads as unfired (NEW-139)", async () => {
    const fixture = await hooksFixture("doctor-hooks-record-failed");
    await plantHooks(fixture);
    await plantRecord(fixture, "inject", "2026-09-22T09:00:00.000Z");
    await nodeFs.writeFile(join(fixture.paths.stateDir, "hooks", "claude.record_failed.json"), "", { mode: 0o600 });

    const { hooks } = await checksOf(fixture);

    expect(hooks.status).toBe("warn");
    expect(hooks.message).toContain("claude=installed");
    expect(hooks.message).toContain("record=failed (clears on this vendor's next successful record write, within 24 h)");
    expect(hooks.message.endsWith("; codex=not-installed")).toBe(true);
  });

  it("warns with the fixed trust step while an installed Codex hook has not fired, and passes once each has", async () => {
    const fixture = await hooksFixture("doctor-hooks-codex");
    expect(CODEX_HOOK_ROWS).toHaveLength(8);
    await plantCodexHooks(fixture);

    const unfired = (await checksOf(fixture)).hooks;
    expect(unfired.status).toBe("warn");
    expect(unfired.message).toContain("codex=installed");
    expect(unfired.message).toContain(CODEX_UNTRUSTED_HOOK_MESSAGE);
    expect(unfired.recovery).toBe(CODEX_HOOK_TRUST_STEP);

    for (const row of CODEX_HOOK_ROWS) await plantRecord(fixture, row.verb, "2026-09-22T11:00:00.000Z", "codex");
    const fired = (await checksOf(fixture)).hooks;
    expect(fired.status).toBe("pass");
    expect(fired.message).toContain("codex=installed inject=1h");
    expect(fired.message).not.toContain(CODEX_UNTRUSTED_HOOK_MESSAGE);
    expect(fired).not.toHaveProperty("recovery");
  });

  it("warns with the trust step when Codex path never fired although command shares its event", async () => {
    const fixture = await hooksFixture("doctor-hooks-codex-path");
    await plantCodexHooks(fixture);
    for (const row of CODEX_HOOK_ROWS) {
      if (row.verb !== "path") await plantRecord(fixture, row.verb, "2026-09-22T11:00:00.000Z", "codex");
    }

    const { hooks } = await checksOf(fixture);

    expect(hooks.status).toBe("warn");
    expect(hooks.message).toContain("command=1h");
    expect(hooks.message).toContain("path=never");
    expect(hooks.message).toContain(CODEX_UNTRUSTED_HOOK_MESSAGE);
    expect(hooks.recovery).toBe(CODEX_HOOK_TRUST_STEP);
  });

  it.each([
    ["node", () => ({ ...HOOK_EXECUTABLE, node: join(binDirectory, "gone", "node") })],
    ["entrypoint", () => ({ ...HOOK_EXECUTABLE, entrypoint: join(binDirectory, "gone", "developer-os") })],
  ])("warns with the re-run init step when the installed command's %s no longer exists", async (_name, executable) => {
    const fixture = await hooksFixture("doctor-hooks-dead-executable");
    await plantHooks(fixture, undefined, executable());

    const { hooks } = await checksOf(fixture);

    expect(hooks.status).toBe("warn");
    expect(hooks.message).toContain("claude=installed");
    expect(hooks.message).toContain("executable=missing");
    expect(hooks.recovery).toBe("developer-os init");
  });

  it("counts a Codex verb whose only record predates the installed hooks file as not fired", async () => {
    const fixture = await hooksFixture("doctor-hooks-codex-stale");
    await plantCodexHooks(fixture, new Date("2026-09-22T11:30:00.000Z"));
    for (const row of CODEX_HOOK_ROWS) await plantRecord(fixture, row.verb, "2026-09-22T11:00:00.000Z", "codex");

    const { hooks } = await checksOf(fixture);

    expect(hooks.status).toBe("warn");
    expect(hooks.message).toContain(CODEX_UNTRUSTED_HOOK_MESSAGE);
    expect(hooks.recovery).toBe(CODEX_HOOK_TRUST_STEP);
  });

  it("warns and names the one missing row, matched per row rather than per event", async () => {
    const fixture = await hooksFixture("doctor-hooks-missing");
    await plantHooks(fixture, "commit");

    const { hooks } = await checksOf(fixture);

    expect(hooks.status).toBe("warn");
    expect(hooks.message).toContain("missing=commit");
    expect(hooks.message).toContain("command=never");
  });

  it("counts external Claude hooks by event without disclosing a command string", async () => {
    const fixture = await hooksFixture("doctor-external-hooks");
    await plantHooks(fixture);
    await plant(settingsFile(fixture), JSON.stringify({
      hooks: {
        PreToolUse: [{
          matcher: "Bash",
          hooks: [
            { type: "command", command: "/synthetic/SENTINEL-guard" },
            { type: "command", command: `${EXECUTABLE} guard command --vendor claude` },
          ],
        }],
      },
    }));

    const { external } = await checksOf(fixture);

    expect(external.status).toBe("warn");
    expect(external.message).toBe(`claude: PreToolUse → 1; ${CODEX_EXTERNAL}`);
    expect(JSON.stringify(external)).not.toContain("SENTINEL");
  });

  it("counts every command when no installed executable is known", async () => {
    const fixture = await hooksFixture("doctor-external-hooks-unbound");
    await plant(settingsFile(fixture), JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: `${EXECUTABLE} guard stop --vendor claude` }] }] },
    }));

    const { external } = await checksOf(fixture);

    expect(external.status).toBe("warn");
    expect(external.message).toBe(`claude: Stop → 1; ${CODEX_EXTERNAL}`);
  });

  it("never follows a symlinked settings file", async () => {
    const fixture = await hooksFixture("doctor-external-hooks-symlink");
    const target = join(fixture.root, "elsewhere.json");
    await nodeFs.writeFile(target, JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "/synthetic/SENTINEL-guard" }] }] },
    }));
    await nodeFs.mkdir(join(fixture.userHome, ".claude"), { recursive: true, mode: 0o700 });
    await nodeFs.symlink(target, settingsFile(fixture));

    const { external } = await checksOf(fixture);

    expect(external.status).toBe("warn");
    expect(external.message).toBe(`claude=unknown; ${CODEX_EXTERNAL}`);
    expect(JSON.stringify(external)).not.toContain("SENTINEL");
  });

  it("reports claude=unknown past the 1 MiB bound", async () => {
    const fixture = await hooksFixture("doctor-external-hooks-bound");
    const body = JSON.stringify({ hooks: {} });
    await plant(settingsFile(fixture), body.padEnd(MAX_CLAUDE_SETTINGS_BYTES + 1, " "));

    const { external } = await checksOf(fixture);

    expect(external.message).toBe(`claude=unknown; ${CODEX_EXTERNAL}`);
  });

  it("reports claude=unknown for invalid JSON", async () => {
    const fixture = await hooksFixture("doctor-external-hooks-invalid");
    await plant(settingsFile(fixture), "{ /synthetic/SENTINEL-guard");

    const { external } = await checksOf(fixture);

    expect(external.message).toBe(`claude=unknown; ${CODEX_EXTERNAL}`);
    expect(JSON.stringify(external)).not.toContain("SENTINEL");
  });

  it("passes with claude=0 when settings carry no hooks key", async () => {
    const fixture = await hooksFixture("doctor-external-hooks-none");
    await plant(settingsFile(fixture), JSON.stringify({ permissions: { deny: [] } }));

    const { external } = await checksOf(fixture);

    expect(external.status).toBe("pass");
    expect(external.message).toBe(`claude=0; ${CODEX_EXTERNAL}`);
  });

  it("is wired into the report and never blocks", async () => {
    const fixture = await hooksFixture("doctor-hooks-wired");
    await runInit(fixture.context, ACCEPTED);
    await plant(settingsFile(fixture), JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "/synthetic/SENTINEL-guard" }] }] },
    }));

    const report = await runDoctorReport(fixture.context);

    const ids = report.checks.map((check) => check.id);
    expect(ids).toContain("hooks");
    expect(ids).toContain("external-hooks");
    expect(report.checks.find((check) => check.id === "external-hooks")?.status).toBe("warn");
    expect(hasBlockingFailure(report)).toBe(false);
    expect(JSON.stringify(report)).not.toContain("SENTINEL");
  });
});

describe("the scheduled-safe doctor profile", () => {
  const HELD: HeldLifecycleStableLockV1 = {
    path: parseCanonicalAbsolutePathText("/synthetic-home/.developer-os/state/.lifecycle.lock"),
    dev: parseUInt64Decimal("16777232"),
    ino: parseUInt64Decimal("1"),
    release: () => Promise.reject(new Error("a handler never releases the runner's global lock")),
  };

  /** Every platform call and process a check could make, recorded instead of performed. */
  function recordingContext(context: CliContext, spawns: string[]): CliContext {
    const platform: PlatformAdapter = {
      inspect: () => {
        spawns.push("platform.inspect");
        return context.platform.inspect();
      },
      assertTrustedExecutable: (path) => {
        spawns.push("platform.assertTrustedExecutable");
        return context.platform.assertTrustedExecutable(path);
      },
      discoverExecutable: (name) => {
        spawns.push(`platform.discoverExecutable:${name}`);
        return context.platform.discoverExecutable(name);
      },
      productStateRoot: (home) => context.platform.productStateRoot(home),
      proposedBrainRoot: (home) => context.platform.proposedBrainRoot(home),
    };
    const runner: ProcessRunner = {
      run: (request) => {
        spawns.push(`runner:${request.executable}`);
        return context.runner.run(request);
      },
    };
    return { ...context, platform, runner };
  }

  it("spawns something in the ordinary no-probe report, which is why the scheduled profile exists", async () => {
    const fixture = await createCommandFixture("doctor-scheduled-contrast");
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    const spawns: string[] = [];

    await runDoctorReport(recordingContext(fixture.context, spawns));

    expect(spawns.length).toBeGreaterThan(0);
  });

  it("spawns nothing in the scheduled doctor profile", async () => {
    const fixture = await createCommandFixture("doctor-scheduled");
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    const spawns: string[] = [];
    const handlers = createScheduledJobHandlers(recordingContext(fixture.context, spawns), null);

    const result = await handlers.run("doctor", HELD);

    expect(spawns).toEqual([]);
    expect(result.outcome).toBe("success");
    const report = result.data as DoctorReportV1;
    expect(report.checks.map((check) => check.id)).toStrictEqual([
      "product-home",
      "configuration",
      "manifest",
      "drift",
      "brain",
      "redaction-key",
    ]);
  });

  it("reports a failing local check as handler_failed without spawning", async () => {
    const fixture = await createCommandFixture("doctor-scheduled-failing");
    const spawns: string[] = [];

    const result = await runScheduledDoctor(recordingContext(fixture.context, spawns));

    expect(spawns).toEqual([]);
    expect(result).toMatchObject({ outcome: "handler_failed", reasonCode: "doctor_check_failed" });
  });
});
