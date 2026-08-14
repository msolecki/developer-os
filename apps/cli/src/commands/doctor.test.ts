import * as nodeFs from "node:fs/promises";
import { join, posix } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import { PLUGIN_TREE_PREFIX, proposeCodexInstall } from "@developer-os/adapter-codex";
import type { MarketplaceRootArtifact } from "@developer-os/adapter-codex";
import { MacOsPlatformDiscoveryError } from "@developer-os/platform-macos";
import type {
  AgentDiscovery,
  AgentName,
  PlatformAdapter,
} from "@developer-os/platform-macos";
import type { ProcessResult, ProcessRunner } from "@developer-os/security";

import { codexPluginRoot, runDoctor, runDoctorReport } from "./doctor.js";
import type { DoctorReportV1 } from "./doctor.js";
import { runInit } from "./init.js";
import {
  createCommandFixture,
  inventory,
  removeCommandFixtures,
} from "./testing.js";
import type { CommandFixture } from "./testing.js";

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
      "redaction-key",
      "agents",
      "claude-capabilities",
      "codex-capabilities",
    ]);
    /**
     * No Codex is installed in this fixture, and no `recovery=` is printed for
     * one that is either: the advice named `/hooks`, the command that grants
     * Codex's hook trust gate, and no hooks ship for it to gate
     * (knowledge-pipeline spec §3.1). The suite below pins that for the
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
