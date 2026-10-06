import { chmod, lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LifecycleRecoveryRequiredError,
  hashBytes,
  type CanonicalAbsolutePathV1,
  type EffectiveUidV1,
  type LaunchdEffectIdV1,
  type LowerHexSha256,
  type UInt64DecimalV1,
} from "@developer-os/core";
import type { SupervisedPhaseV1, SupervisedProcessEvidenceV1, SupervisedSpawnRequestV1 } from "@developer-os/security";
import { afterEach, describe, expect, it } from "vitest";

import { LaunchdPathBootstrapper, parseLaunchctlLastExitCode, parseLaunchctlPrintedService, type LaunchdBootstrapRequestV1, type LaunchdOpenedPlistIdentityV1 } from "./bootstrap.js";
import { LAUNCHCTL_IDENTITY, hostWith } from "./distribution.test-fixtures.js";
import { encodeLaunchdPlist } from "./plist.js";
import { expandLaunchdProcessTable, type LaunchdProcessDirectoryIdentityV1 } from "./process-table.js";
import { generatedLabel, launchdGuiDomain, parseScheduledProductHome, scheduledProgramArguments } from "./registry.js";
import type { LaunchdPlistDictionaryV1 } from "./types.js";

const uid = (process.getuid?.() ?? 501) as EffectiveUidV1;
const domain = launchdGuiDomain(uid);
const GENERATION = "3".repeat(64) as LowerHexSha256;
const NONCE = "a".repeat(64);
const phase: SupervisedPhaseV1 = { id: "launchd-transition", deadlineAtMs: 30000, remainingMilliseconds: () => 30000 };

/**
 * `launchctl print gui/501/<label>` for a probe agent bootstrapped by path, captured on macOS
 * 26.6.2 (25G83) on 2026-10-03 (D82). Redacted: the inherited-environment values (host management
 * settings and an agent socket) and the plist path (a scratch path, rewritten to an example home);
 * layout, tabs and the empty last argument line are verbatim.
 */
const CAPTURED_PRINT_26_6_2 = [
  "gui/501/com.n138probe.print = {",
  "\tactive count = 0",
  "\tpath = /Users/example/Library/LaunchAgents/com.n138probe.print.plist",
  "\ttype = LaunchAgent",
  "\tstate = not running",
  "",
  "\tprogram = /usr/bin/true",
  "\targuments = {",
  "\t\t/usr/bin/true",
  "\t\tscheduled",
  "\t\trun",
  "\t\t--job",
  "\t\tdoctor & x",
  "\t\t",
  "\t}",
  "",
  "\tstdout path = /dev/null",
  "\tstderr path = /dev/null",
  "\tinherited environment = {",
  "\t\tSSH_AUTH_SOCK => /var/run/com.apple.launchd.REDACTED/Listeners",
  "\t}",
  "",
  "\tdefault environment = {",
  "\t\tPATH => /usr/bin:/bin:/usr/sbin:/sbin",
  "\t}",
  "",
  "\tenvironment = {",
  "\t\tOSLogRateLimit => 64",
  "\t\tXPC_SERVICE_NAME => com.n138probe.print",
  "\t}",
  "",
  "\tdomain = gui/501 [100024]",
  "\tasid = 100024",
  "\tminimum runtime = 10",
  "\texit timeout = 5",
  "\truns = 0",
  "\tlast exit code = (never exited)",
  "",
  "\tevent triggers = {",
  "\t\tcom.n138probe.print.268435472 => {",
  "\t\t\tkeepalive = 0",
  "\t\t\tservice = com.n138probe.print",
  "\t\t\tstream = com.apple.launchd.calendarinterval",
  "\t\t\tmonitor = com.apple.UserEventAgent-Aqua",
  "\t\t\tdescriptor = {",
  '\t\t\t\t"Minute" => 20',
  '\t\t\t\t"Hour" => 3',
  "\t\t\t}",
  "\t\t}",
  "\t}",
  "",
  "\tspawn type = daemon (3)",
  "\tjetsam priority = 40",
  "\tproperties = inferred program",
  "}",
  "",
].join("\n");

/**
 * The top-level `environment` block of a third-party agent on the same 26.6.2 host whose plist's
 * `EnvironmentVariables` sets only `PATH` (values redacted): the plist's variables print here,
 * beside launchd's own `OSLogRateLimit` and `XPC_SERVICE_NAME`, and nowhere else.
 */
const CAPTURED_ENVIRONMENT_WITH_PLIST_VARIABLE = ["\tenvironment = {", "\t\tOSLogRateLimit => 64", "\t\tPATH => /usr/bin:/bin", "\t\tXPC_SERVICE_NAME => com.n138probe.print", "\t}"].join("\n");

const PROBE_ENVIRONMENT = ["\tenvironment = {", "\t\tOSLogRateLimit => 64", "\t\tXPC_SERVICE_NAME => com.n138probe.print", "\t}"].join("\n");

/** The captured dump with its header, path, program, arguments and service name substituted. */
function printFor(target: string, path: string, args: readonly string[]): string {
  const lines = CAPTURED_PRINT_26_6_2.split("\n");
  const start = lines.indexOf("\targuments = {");
  const end = lines.indexOf("\t}", start);
  const body = [...lines.slice(1, start), "\targuments = {", ...args.map((argument) => `\t\t${argument}`), ...lines.slice(end)];
  return [`${target} = {`, ...body]
    .join("\n")
    .replace("\tpath = /Users/example/Library/LaunchAgents/com.n138probe.print.plist", `\tpath = ${path}`)
    .replace("\tprogram = /usr/bin/true", `\tprogram = ${args[0] ?? ""}`)
    .replace("XPC_SERVICE_NAME => com.n138probe.print", `XPC_SERVICE_NAME => ${target.slice(target.indexOf("/", "gui/".length) + 1)}`);
}

/** Scripted `/bin/launchctl`: records each request and answers `print` with `printed`. */
class ScriptedRunner {
  readonly requests: SupervisedSpawnRequestV1[] = [];
  printed: (target: string) => { readonly exitCode: number; readonly stdout: string } = () => ({ exitCode: 113, stdout: "" });
  bootstrapExit = 0;
  afterBootstrap: () => Promise<void> = () => Promise.resolve();

  async run(request: SupervisedSpawnRequestV1, sink?: (chunk: Uint8Array, stream: "stdout" | "stderr") => void): Promise<SupervisedProcessEvidenceV1> {
    this.requests.push(request);
    let exitCode = 0;
    let stdout = new Uint8Array();
    if (request.argv[0] === "bootstrap") {
      exitCode = this.bootstrapExit;
      await this.afterBootstrap();
    } else if (request.argv[0] === "print") {
      const answer = this.printed(String(request.argv[1]));
      exitCode = answer.exitCode;
      stdout = new TextEncoder().encode(answer.stdout);
      sink?.(stdout, "stdout");
    }
    return {
      exitCode,
      signal: null,
      stdoutBytes: stdout.byteLength,
      stderrBytes: 0,
      stdoutSha256: "d".repeat(64) as LowerHexSha256,
      stderrSha256: "d".repeat(64) as LowerHexSha256,
      termination: "exited",
      groupReaped: true,
    };
  }
}

const bases: string[] = [];

afterEach(async () => {
  for (const base of bases.splice(0)) await rm(base, { recursive: true, force: true });
});

async function directoryIdentity(path: string): Promise<LaunchdProcessDirectoryIdentityV1> {
  const stats = await lstat(path, { bigint: true });
  return { path: path as CanonicalAbsolutePathV1, ownerUid: uid, mode: 448, dev: stats.dev.toString(10) as UInt64DecimalV1, ino: stats.ino.toString(10) as UInt64DecimalV1 };
}

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "dos-launchd-bootstrap-")));
  bases.push(base);
  const productHome = join(base, "product home & <co>");
  const root = join(productHome, "staging", "lifecycle", `lc_${NONCE}_3`, "launchd-process");
  await mkdir(join(root, "home"), { recursive: true });
  await mkdir(join(root, "tmp"));
  for (const path of [root, join(root, "home"), join(root, "tmp")]) await chmod(path, 0o700);
  const table = expandLaunchdProcessTable(
    { root: await directoryIdentity(root), home: await directoryIdentity(join(root, "home")), tmp: await directoryIdentity(join(root, "tmp")) },
    LAUNCHCTL_IDENTITY,
  );
  const plist: LaunchdPlistDictionaryV1 = {
    Label: generatedLabel("doctor", GENERATION),
    ProgramArguments: scheduledProgramArguments("doctor", parseScheduledProductHome(productHome), GENERATION, "/usr/local/bin/dos" as CanonicalAbsolutePathV1, "/usr/local/bin/node" as CanonicalAbsolutePathV1),
    StartCalendarInterval: { Hour: 2, Minute: 30 },
    StandardOutPath: "/dev/null",
    StandardErrorPath: "/dev/null",
  };
  const bytes = new TextEncoder().encode(encodeLaunchdPlist(plist));
  const agents = join(base, "Library", "LaunchAgents");
  await mkdir(agents, { recursive: true });
  const path = join(agents, "com.developer-os.doctor.plist");
  await writeFile(path, bytes, { mode: 0o600 });
  const stats = await lstat(path, { bigint: true });
  const source: LaunchdOpenedPlistIdentityV1 = {
    path: path as CanonicalAbsolutePathV1,
    ownerUid: uid,
    mode: 384,
    nlink: 1,
    size: bytes.byteLength,
    hash: hashBytes(bytes) as LowerHexSha256,
    dev: stats.dev.toString(10) as UInt64DecimalV1,
    ino: stats.ino.toString(10) as UInt64DecimalV1,
  };
  const request: LaunchdBootstrapRequestV1 = {
    table,
    domain,
    effectId: `le_${NONCE}_7` as LaunchdEffectIdV1,
    planHash: "b".repeat(64) as LowerHexSha256,
    direction: "forward",
    transitionIndex: 0,
    role: "after",
    source,
    plist,
    phase,
  };
  const target = `${domain}/${plist.Label}`;
  const runner = new ScriptedRunner();
  runner.printed = (asked) => ({ exitCode: asked === target ? 0 : 113, stdout: printFor(target, path, plist.ProgramArguments) });
  const bootstrapper = new LaunchdPathBootstrapper({ runner, effectiveUid: () => uid, host: hostWith() });
  /** Renames a fresh inode holding `content` over the plist. */
  const swap = async (content: Uint8Array | string): Promise<void> => {
    await writeFile(`${path}.swap`, content, { mode: 0o600 });
    await rename(`${path}.swap`, path);
  };
  return { request, runner, bootstrapper, bytes, path, target, swap, table };
}

describe("parseLaunchctlPrintedService (macOS 26.6.2 format)", () => {
  it("reads path, program and every argument, including an escaped and an empty one, from the captured dump", () => {
    expect(parseLaunchctlPrintedService(CAPTURED_PRINT_26_6_2, "gui/501/com.n138probe.print")).toStrictEqual({
      path: "/Users/example/Library/LaunchAgents/com.n138probe.print.plist",
      program: "/usr/bin/true",
      arguments: ["/usr/bin/true", "scheduled", "run", "--job", "doctor & x", ""],
      environment: new Map([
        ["OSLogRateLimit", "64"],
        ["XPC_SERVICE_NAME", "com.n138probe.print"],
      ]),
    });
    expect(
      parseLaunchctlPrintedService(CAPTURED_PRINT_26_6_2.replace(PROBE_ENVIRONMENT, CAPTURED_ENVIRONMENT_WITH_PLIST_VARIABLE), "gui/501/com.n138probe.print")?.environment.get("PATH"),
    ).toBe("/usr/bin:/bin");
  });

  it("is null for another target, a duplicated top-level field, a missing or unterminated arguments block, or a malformed argument line", () => {
    const target = "gui/501/com.n138probe.print";
    expect(parseLaunchctlPrintedService(CAPTURED_PRINT_26_6_2, "gui/501/com.n138probe.other")).toBeNull();
    expect(parseLaunchctlPrintedService(CAPTURED_PRINT_26_6_2.replace("\tstdout path = /dev/null", "\tprogram = /tmp/evil"), target)).toBeNull();
    expect(parseLaunchctlPrintedService(CAPTURED_PRINT_26_6_2.replace("\ttype = LaunchAgent", "\tpath = /tmp/evil.plist"), target)).toBeNull();
    expect(parseLaunchctlPrintedService(CAPTURED_PRINT_26_6_2.replace("\targuments = {", "\targv = {"), target)).toBeNull();
    expect(parseLaunchctlPrintedService(CAPTURED_PRINT_26_6_2.replace("\t\trun\n", "\trun\n"), target)).toBeNull();
    expect(parseLaunchctlPrintedService(CAPTURED_PRINT_26_6_2.slice(0, CAPTURED_PRINT_26_6_2.indexOf("\t}")), target)).toBeNull();
    expect(parseLaunchctlPrintedService(CAPTURED_PRINT_26_6_2.replace(PROBE_ENVIRONMENT, `${PROBE_ENVIRONMENT}\n${PROBE_ENVIRONMENT}`), target)).toBeNull();
    expect(parseLaunchctlPrintedService(CAPTURED_PRINT_26_6_2.replace("\t\tOSLogRateLimit => 64", "\t\tXPC_SERVICE_NAME => other"), target)).toBeNull();
    expect(parseLaunchctlPrintedService(CAPTURED_PRINT_26_6_2.replace(PROBE_ENVIRONMENT, ""), target)).toBeNull();
    // A stray line after a block closes, or a closer with no open block, refuses the whole dump.
    expect(parseLaunchctlPrintedService(CAPTURED_PRINT_26_6_2.replace("\t\t\n\t}\n", "\t\t\n\t}\n\t\t--x\n"), target)).toBeNull();
    expect(
      parseLaunchctlPrintedService(
        CAPTURED_PRINT_26_6_2.replace(
          PROBE_ENVIRONMENT,
          ["\tenvironment = {", "\t\tOSLogRateLimit => 64", "\t\tXPC_SERVICE_NAME => com.n138probe.print", "\t}", "\t\tPATH => /x", "\t}"].join("\n"),
        ),
        target,
      ),
    ).toBeNull();
  });
});

describe("parseLaunchctlLastExitCode (NEW-169)", () => {
  const target = "gui/501/com.n138probe.print";
  const exited = (code: string): string => CAPTURED_PRINT_26_6_2.replace("\tlast exit code = (never exited)", `\tlast exit code = ${code}`);

  it("reads the top-level last exit code, and null for a job that never exited", () => {
    expect(parseLaunchctlLastExitCode(CAPTURED_PRINT_26_6_2, target)).toBeNull();
    expect(parseLaunchctlLastExitCode(exited("78"), target)).toBe(78);
    expect(parseLaunchctlLastExitCode(exited("0"), target)).toBe(0);
    // Seen on macOS 26.6.2 (2026-10-05, NEW-144) for a job whose program could not be exec'd.
    expect(parseLaunchctlLastExitCode(exited("78: EX_CONFIG"), target)).toBe(78);
  });

  it("is null for another target, a duplicated or nested line, or a value that is not a decimal", () => {
    expect(parseLaunchctlLastExitCode(exited("78"), "gui/501/com.n138probe.other")).toBeNull();
    expect(parseLaunchctlLastExitCode(exited("78").replace("\truns = 0", "\tlast exit code = 0"), target)).toBeNull();
    expect(parseLaunchctlLastExitCode(exited("78").replace("\t\tSSH_AUTH_SOCK", "\tlast exit code = 0\n\t\tSSH_AUTH_SOCK"), target)).toBeNull();
    expect(parseLaunchctlLastExitCode(exited("-1"), target)).toBeNull();
    expect(parseLaunchctlLastExitCode(exited("78x"), target)).toBeNull();
    expect(parseLaunchctlLastExitCode(exited("78: "), target)).toBeNull();
    expect(parseLaunchctlLastExitCode(exited("78:EX_CONFIG"), target)).toBeNull();
  });
});

describe("LaunchdPathBootstrapper (D82)", () => {
  it("bootstraps the plan-bound plist by its absolute path with no inherited descriptor", async () => {
    const { request, runner, bootstrapper, path, table } = await fixture();
    const evidence = await bootstrapper.bootstrap(request);
    expect(evidence.process).toMatchObject({ exitCode: 0, termination: "exited" });
    expect(evidence.source).toStrictEqual(request.source);
    // MACOS-6: the evidence names the journaled transition it was run for.
    expect(evidence.transition).toStrictEqual({
      effectId: request.effectId,
      planHash: request.planHash,
      direction: request.direction,
      transitionIndex: request.transitionIndex,
      role: request.role,
    });
    expect(runner.requests).toHaveLength(1);
    expect(runner.requests[0]).toMatchObject({
      executable: "/bin/launchctl",
      argv: ["bootstrap", domain, path],
      env: { ...table.environment },
      cwd: table.staging.home.path,
      inheritedFds: [],
    });
  });

  it("refuses before spawning when the path no longer names the captured inode, even with identical bytes", async () => {
    const { request, runner, bootstrapper, bytes, swap } = await fixture();
    await swap(bytes);
    await expect(bootstrapper.bootstrap(request)).rejects.toMatchObject({ reason: "launchd_bootstrap_plist_changed" });
    await expect(bootstrapper.bootstrap(request)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(runner.requests).toStrictEqual([]);
  });

  it("verifies a load whose inode, bytes and printed program, arguments and path are the plan's", async () => {
    const { request, runner, bootstrapper, target } = await fixture();
    await bootstrapper.bootstrap(request);
    await expect(bootstrapper.verifyLoaded(request)).resolves.toBe(true);
    expect(runner.requests.map((spawned) => spawned.argv)).toStrictEqual([
      ["bootstrap", domain, request.source.path],
      ["print", target],
    ]);
  });

  it("fails verification when the plist is swapped after the bootstrap, without printing", async () => {
    const { request, runner, bootstrapper, bytes, swap } = await fixture();
    runner.afterBootstrap = () => swap(bytes);
    await bootstrapper.bootstrap(request);
    await expect(bootstrapper.verifyLoaded(request)).resolves.toBe(false);
    expect(runner.requests.map((spawned) => spawned.argv[0])).toStrictEqual(["bootstrap"]);
  });

  it("fails verification when launchd reports another program, other arguments or another path", async () => {
    const { request, runner, bootstrapper, path, target } = await fixture();
    const planned = request.plist.ProgramArguments;
    for (const printed of [
      printFor(target, path, ["/tmp/evil", ...planned.slice(1)]),
      printFor(target, path, [...planned.slice(0, -1), "other"]),
      printFor(target, path, planned.slice(0, -1)),
      printFor(target, `${path}.other`, planned),
    ]) {
      runner.printed = () => ({ exitCode: 0, stdout: printed });
      await expect(bootstrapper.verifyLoaded(request)).resolves.toBe(false);
    }
  });

  it("fails verification when the loaded job's environment carries a variable the plan does not, or names another service", async () => {
    const { request, runner, bootstrapper, path, target } = await fixture();
    const planned = printFor(target, path, request.plist.ProgramArguments);
    const label = request.plist.Label;
    expect(planned).toContain(`XPC_SERVICE_NAME => ${label}`);
    for (const printed of [
      planned.replace(`\t\tXPC_SERVICE_NAME => ${label}`, `\t\tNODE_OPTIONS => --require /tmp/evil.js\n\t\tXPC_SERVICE_NAME => ${label}`),
      planned.replace(`\t\tXPC_SERVICE_NAME => ${label}`, "\t\tXPC_SERVICE_NAME => com.developer-os.other"),
    ]) {
      runner.printed = () => ({ exitCode: 0, stdout: printed });
      await expect(bootstrapper.verifyLoaded(request)).resolves.toBe(false);
    }
  });

  it("refuses a request whose path is not the planned label's LaunchAgents leaf", async () => {
    const { request, bootstrapper, runner } = await fixture();
    const elsewhere = { ...request, source: { ...request.source, path: request.source.path.replace("/Library/LaunchAgents/", "/Library/Other/") as typeof request.source.path } };
    await expect(bootstrapper.bootstrap(elsewhere)).rejects.toThrow(/LaunchAgents leaf/u);
    const renamed = { ...request, source: { ...request.source, path: request.source.path.replace("doctor", "brain-lint") as typeof request.source.path } };
    await expect(bootstrapper.bootstrap(renamed)).rejects.toThrow(/LaunchAgents leaf/u);
    expect(runner.requests).toStrictEqual([]);
  });

  it("fails verification when the print fails or the label is not loaded", async () => {
    const { request, runner, bootstrapper } = await fixture();
    runner.printed = () => ({ exitCode: 113, stdout: "" });
    await expect(bootstrapper.verifyLoaded(request)).resolves.toBe(false);
    runner.printed = () => ({ exitCode: 5, stdout: "" });
    await expect(bootstrapper.verifyLoaded(request)).resolves.toBe(false);
  });
});
