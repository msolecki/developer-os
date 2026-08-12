import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import { MacOsPlatformDiscoveryError } from "@developer-os/platform-macos";
import type { ProcessResult, ProcessRunner } from "@developer-os/security";

import { runDoctor, runDoctorReport } from "./doctor.js";
import { runInit } from "./init.js";
import {
  createCommandFixture,
  inventory,
  removeCommandFixtures,
} from "./testing.js";
import type { CommandFixture } from "./testing.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

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

describe("runDoctor", () => {
  it("passes every check on a healthy installation", async () => {
    const fixture = await createCommandFixture("doctor-healthy");
    await runInit(fixture.context, ACCEPTED);

    const result = await runDoctor(fixture.context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe(EXIT_CODES.success);
    expect(
      result.data.checks.filter((check) => check.status !== "pass"),
    ).toEqual([]);
    expect(result.data.checks.map((check) => check.id)).toEqual([
      "platform",
      "product-home",
      "configuration",
      "manifest",
      "transactions",
      "drift",
      "brain",
      "agents",
      "claude-capabilities",
      "codex-capabilities",
    ]);
    /**
     * No Codex is installed in this fixture, so the hook-trust command is not
     * actionable — nothing is there to open a session in. Spec §5.3: the
     * fix is one command, and a report that prints it unconditionally reads as
     * advice to run `/hooks` inside a CLI the machine does not have.
     */
    const codexAbsent = result.data.checks.find(
      (check) => check.id === "codex-capabilities",
    );
    expect(codexAbsent?.message).toContain("codex=absent");
    expect(codexAbsent?.message).not.toContain("recovery=");
  });

  /**
   * Spec §5.3: the fix is one command, and a report that omits it — where it
   * is actionable — is not a report. `codex-capabilities.ts`'s own unit tests
   * pin `report.recovery` one layer below the user; this pins the composed
   * `DoctorCheck.message` the user actually reads.
   */
  it("names the hook-trust command when Codex is installed", async () => {
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
    expect(codex?.message).toContain('recovery="');
    expect(codex?.message).toContain("/hooks");
  });

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
