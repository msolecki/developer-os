import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LifecycleRecoveryRequiredError,
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseUInt64Decimal,
  type OwnerExternalEffectLiteralV1,
  type OwnerExternalEffectProcessPolicyV1,
} from "@developer-os/core";
import { nodeSupervisedProcessDependencies, SupervisedProcessRunner } from "@developer-os/security";
import { afterEach, describe, expect, it } from "vitest";

import { codexRegistrationObserver, codexVersionToken, projectCodexRegistration, supervisedOwnerEffectRun } from "./codex-effect-ports.js";
import type { OwnerEffectProcessRequestV1, OwnerEffectProcessResultV1 } from "./external-effect.js";

const encoder = new TextEncoder();
const SECRET_MARKER = "SYNTHETIC-SECRET-MARKER";
// A non-default Codex home: the refresh must target it through CODEX_HOME, never `<home>/.codex`.
const tokens = { managedPluginRoot: "/synthetic/codex/plugin-root", pluginId: "developer-os@developer-os", privateEffectTmp: "/synthetic/tmp/effect", managedVendorHome: "/synthetic/elsewhere/codex-home" };
const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) await nodeFs.rm(home, { recursive: true, force: true });
});

const policy: OwnerExternalEffectProcessPolicyV1 = {
  kind: "codex_registration_refresh",
  providerProtocol: parsePositiveUInt32(3),
  executable: "pinned_codex_cli",
  executableIdentity: { dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("2"), mode: 493, sha256: parseLowerHexSha256(createHash("sha256").update("synthetic codex").digest("hex")) },
  argv: [{ kind: "literal", value: "plugin" as OwnerExternalEffectLiteralV1 }, { kind: "token", value: "plugin_id" }],
  cwd: "managed_plugin_root",
  environment: [{ name: "CODEX_HOME", value: "managed_vendor_home" }, { name: "TMPDIR", value: "private_effect_tmp" }],
  stdin: "closed",
  network: false,
  model: false,
  stdoutBytes: 4096,
  stderrBytes: 512,
  wallMilliseconds: 60_000,
  idleMilliseconds: 10_000,
  processCount: 1,
};

function listing(installed: unknown[]): string {
  return JSON.stringify({ installed, available: [] });
}

const ours = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  pluginId: "developer-os@developer-os",
  name: "developer-os",
  version: "1.1.0",
  enabled: true,
  source: { source: "local", path: tokens.managedPluginRoot },
  ...overrides,
});

describe("the Codex registration projection", () => {
  it.each<{ name: string; installed: unknown[]; expected: Record<string, unknown> }>([
    { name: "the managed registration", installed: [ours()], expected: { enabled: true, version: "v1_1_0", source: "managed_plugin_root" } },
    { name: "a disabled registration", installed: [ours({ enabled: false })], expected: { enabled: false, version: "v1_1_0", source: "managed_plugin_root" } },
    { name: "a registration from another root", installed: [ours({ source: { path: "/elsewhere" } })], expected: { enabled: true, version: "v1_1_0", source: "other" } },
    { name: "a registration with no source", installed: [ours({ source: undefined })], expected: { enabled: true, version: "v1_1_0", source: "other" } },
    { name: "a prerelease version", installed: [ours({ version: "2.0.0-rc.1" })], expected: { enabled: true, version: "v2_0_0_rc_1", source: "managed_plugin_root" } },
    { name: "an unsafe version", installed: [ours({ version: "1.0 /home/user" })], expected: { enabled: true, version: null, source: "managed_plugin_root" } },
    { name: "a match by name alone", installed: [ours({ pluginId: undefined })], expected: { enabled: true, version: "v1_1_0", source: "managed_plugin_root" } },
    { name: "only another plugin", installed: [{ name: "somebody-else", enabled: true, source: { path: tokens.managedPluginRoot } }], expected: { enabled: false, version: null, source: "absent" } },
    { name: "nothing installed", installed: [], expected: { enabled: false, version: null, source: "absent" } },
  ])("projects $name without the raw path", ({ installed, expected }) => {
    const projection = projectCodexRegistration(listing(installed), policy, tokens);
    expect(projection).toEqual({ pluginId: "developer_os", protocol: 3, ...expected });
    expect(JSON.stringify(projection)).not.toContain("/");
  });

  it.each<{ name: string; stdout: string }>([
    { name: "malformed JSON", stdout: "{" },
    { name: "a listing without installed", stdout: JSON.stringify({ plugins: [] }) },
    { name: "a top-level __proto__", stdout: '{"__proto__":{},"installed":[]}' },
    { name: "two matching registrations", stdout: listing([ours(), ours({ source: { path: "/elsewhere" } })]) },
  ])("refuses $name instead of reading it as absent", ({ stdout }) => {
    expect(() => projectCodexRegistration(stdout, policy, tokens)).toThrow(LifecycleRecoveryRequiredError);
  });
});

it("tokenizes a vendor version the same way for expected and proposed projections", () => {
  expect(codexVersionToken("1.2.0")).toBe("v1_2_0");
  expect(codexVersionToken("x".repeat(62))).toBe(`v${"x".repeat(62)}`);
  expect(codexVersionToken("x".repeat(63))).toBeNull();
  expect(codexVersionToken(12)).toBeNull();
});

describe("the production Codex observer", () => {
  function observer(result: OwnerEffectProcessResultV1) {
    const requests: OwnerEffectProcessRequestV1[] = [];
    const identities: unknown[] = [];
    const observe = codexRegistrationObserver({
      policy,
      tokens,
      resolveExecutable: (identity) => {
        identities.push(identity);
        return Promise.resolve("/synthetic/bin/codex");
      },
      run: (request) => {
        requests.push(request);
        return Promise.resolve(result);
      },
      screen: (text) => text.includes(SECRET_MARKER),
    });
    return { observe, requests, identities };
  }

  it("lists through the pinned executable under the plan's closed environment and bounds", async () => {
    const { observe, requests, identities } = observer({ exitCode: 0, stdout: encoder.encode(listing([ours()])), stderr: new Uint8Array() });
    expect(await observe()).toEqual({ pluginId: "developer_os", enabled: true, protocol: 3, version: "v1_1_0", source: "managed_plugin_root" });
    expect(identities).toEqual([policy.executableIdentity]);
    expect(requests).toEqual([{
      executable: "/synthetic/bin/codex",
      argv: ["plugin", "list", "--json"],
      env: { CODEX_HOME: tokens.managedVendorHome, TMPDIR: tokens.privateEffectTmp },
      cwd: tokens.managedPluginRoot,
      stdin: "ignore",
      stdoutCap: 4096,
      stderrCap: 512,
      idleMs: 10_000,
      wallMs: 60_000,
    }]);
  });

  it.each<{ name: string; result: OwnerEffectProcessResultV1 }>([
    { name: "a failed listing", result: { exitCode: 1, stdout: encoder.encode(listing([ours()])), stderr: new Uint8Array() } },
    { name: "a terminated listing", result: { exitCode: null, stdout: new Uint8Array(), stderr: new Uint8Array() } },
    { name: "a listing carrying a secret", result: { exitCode: 0, stdout: encoder.encode(listing([ours({ version: SECRET_MARKER })])), stderr: new Uint8Array() } },
  ])("refuses $name", async ({ result }) => {
    const { observe } = observer(result);
    await expect(observe()).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });
});

describe("the production owner-effect run", () => {
  async function runScript(script: string, overrides: Partial<OwnerEffectProcessRequestV1> = {}): Promise<OwnerEffectProcessResultV1> {
    const home = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "dos-codex-run-")));
    homes.push(home);
    const run = supervisedOwnerEffectRun(new SupervisedProcessRunner(nodeSupervisedProcessDependencies));
    return run({
      executable: process.execPath,
      argv: ["-e", script],
      env: { CODEX_HOME: `${home}/vendor`, TMPDIR: `${home}/tmp` },
      cwd: home,
      stdin: "ignore",
      stdoutCap: 4096,
      stderrCap: 4096,
      idleMs: 10_000,
      wallMs: 20_000,
      ...overrides,
    });
  }

  it("returns the exact bytes of a clean exit under exactly the two environment entries", async () => {
    // macOS's libSystem adds __CF_USER_TEXT_ENCODING to every process it launches, even under an
    // empty environment; the child's own loader wrote it, not the runner.
    const result = await runScript("process.stdout.write(JSON.stringify(Object.keys(process.env).filter((key) => key !== '__CF_USER_TEXT_ENCODING').sort())); process.stderr.write('warn');");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual(["CODEX_HOME", "TMPDIR"]);
    expect(new TextDecoder().decode(result.stderr)).toBe("warn");
  });

  it("reports a non-zero exit as-is", async () => {
    expect((await runScript("process.exit(3)")).exitCode).toBe(3);
  });

  it.each<{ name: string; script: string; overrides: Partial<OwnerEffectProcessRequestV1> }>([
    { name: "stdout beyond its cap", script: "process.stdout.write('x'.repeat(64)); setInterval(() => undefined, 1000);", overrides: { stdoutCap: 16 } },
    { name: "stderr beyond its cap", script: "process.stderr.write('x'.repeat(64)); setInterval(() => undefined, 1000);", overrides: { stderrCap: 16 } },
    { name: "the idle deadline", script: "setInterval(() => undefined, 1000);", overrides: { idleMs: 200 } },
    { name: "the wall deadline", script: "setInterval(() => process.stdout.write('.'), 50);", overrides: { wallMs: 400 } },
  ])("reports no exit code after $name", async ({ script, overrides }) => {
    expect((await runScript(script, overrides)).exitCode).toBeNull();
  });
});
