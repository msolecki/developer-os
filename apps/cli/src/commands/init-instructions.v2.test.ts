import { existsSync } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { CODEX_HOOK_TRUST_STEP } from "@developer-os/adapter-codex";
import { decodeCanonicalJson, EXIT_CODES, INSTRUCTION_BLOCK_BEGIN, loadConfig } from "@developer-os/core";
import type { InstallationManifestV2 } from "@developer-os/core";
import type { AgentDiscovery } from "@developer-os/platform-macos";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";

import { ADAPTERS_NEXT_STEP } from "../instructions/apply.js";
import type { AdapterSelectionV1 } from "../instructions/apply.js";
import { UNPROVEN_CLAUDE_CATEGORIES } from "../instructions/attach.js";
import { loadReleaseWorkflows } from "../instructions/sources.js";
import { inspectPackagedRelease } from "../update/packaged-release.js";
import type { ReleaseFileV1 } from "../update/local-release.js";
import { runDoctorReport } from "./doctor.js";
import { runInit } from "./init.js";
import type { InitOptions } from "./init.js";
import { runUninstall } from "./uninstall.js";
import { createCommandFixture, inventory, inventoryDigest, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "./testing.js";
import type { CommandFixture } from "./testing.js";

afterAll(removeCommandFixtures);

const CLAUDE = "/opt/synthetic/bin/claude";
const CODEX = "/opt/synthetic/bin/codex";
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();

type Vendor = "claude" | "codex";

const CATALOG = {
  schemaVersion: 1,
  artifacts: [
    { category: "output-style", id: "terse", legacyName: "terse", vendors: ["claude", "codex"], thinCommand: false },
    { category: "rule", id: "careful", legacyName: "careful", vendors: ["claude", "codex"], thinCommand: false },
    { category: "scoped-rule", id: "typescript", legacyName: "typescript", vendors: ["claude", "codex"], thinCommand: false },
    { category: "skill", id: "triage", legacyName: "triage", vendors: ["claude", "codex"], thinCommand: false },
  ],
} as const;

function release(relativePath: string, text: string): ReleaseFileV1 {
  return { relativePath, bytes: encoder.encode(text), mode: 0o600 };
}

const INSTRUCTIONS: readonly ReleaseFileV1[] = [
  release("catalog.json", `${JSON.stringify(CATALOG)}\n`),
  release("output-styles/terse.md", "---\nname: terse\n---\nAnswer tersely.\n"),
  release("rules/careful.md", "Be careful.\n"),
  release("scoped-rules/typescript.md", "---\npaths:\n  - \"**/*.ts\"\n---\nUse strict types.\n"),
  release("skills/triage/SKILL.md", "---\nname: triage\ndescription: Triage a defect.\n---\nTriage.\n"),
];

/** A Codex CLI that keeps its marketplace and plugin state across calls. */
interface FakeCodex {
  marketplace: boolean;
  registered: boolean;
  /** `<argv> @ <CODEX_HOME>` of every non-`--version` call. */
  readonly calls: string[];
}

function vendorRunner(codex: FakeCodex, pluginRoot: () => string): ProcessRunner {
  const ok = (stdout: string): ProcessResult => ({ stdout, stderr: "", exitCode: 0, signal: null, timedOut: false });
  return {
    run(request: ProcessRequest): Promise<ProcessResult> {
      const argv = request.args.join(" ");
      if (argv === "--version") return Promise.resolve(ok(request.executable === CLAUDE ? "2.1.280 (Claude Code)\n" : "codex-cli 0.155.1\n"));
      codex.calls.push(`${argv} @ ${String(request.env.CODEX_HOME)}`);
      switch (argv) {
        case "plugin list --json":
          return Promise.resolve(ok(JSON.stringify({
            installed: codex.registered ? [{ name: "developer-os", enabled: true, source: { source: "local", path: pluginRoot() } }] : [],
          })));
        case "plugin marketplace list":
          return Promise.resolve(ok(codex.marketplace ? `developer-os  ${dirname(dirname(pluginRoot()))}\n` : "No plugin marketplaces in scope.\n"));
        case "plugin add developer-os@developer-os --json":
          codex.registered = true;
          return Promise.resolve(ok("{}"));
        case "plugin remove developer-os@developer-os":
          codex.registered = false;
          return Promise.resolve(ok(""));
        case "plugin marketplace remove developer-os":
          codex.marketplace = false;
          return Promise.resolve(ok(""));
        default:
          if (argv.startsWith("plugin marketplace add ")) {
            codex.marketplace = true;
            return Promise.resolve(ok(""));
          }
          return Promise.reject(new Error(`unexpected spawn: ${argv}`));
      }
    },
  };
}

const AGENTS: Readonly<Record<Vendor, AgentDiscovery>> = {
  claude: { name: "claude", installed: true, executablePath: CLAUDE, version: null },
  codex: { name: "codex", installed: true, executablePath: CODEX, version: null },
};

interface Home {
  readonly fixture: CommandFixture;
  readonly codex: FakeCodex;
  readonly claudeHome: string;
  readonly codexHome: string;
  readonly claudePlugin: string;
  readonly codexPlugin: string;
}

async function home(label: string): Promise<Home> {
  const codex: FakeCodex = { marketplace: false, registered: false, calls: [] };
  let codexPlugin = "";
  const fixture = await createCommandFixture(label, {
    bootstrapAvailable: true,
    instructions: INSTRUCTIONS,
    runner: vendorRunner(codex, () => codexPlugin),
    agents: AGENTS,
  });
  await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  codexPlugin = join(fixture.paths.home, "codex", "plugins", "developer-os");
  return {
    fixture,
    codex,
    claudeHome: join(fixture.userHome, ".claude"),
    codexHome: join(fixture.userHome, ".codex"),
    claudePlugin: join(fixture.userHome, ".claude", "skills", "developer-os"),
    codexPlugin,
  };
}

function options(adapters: AdapterSelectionV1 | null): InitOptions {
  return { dryRun: false, assumeYes: true, adapters };
}

async function manifestOf(fixture: CommandFixture): Promise<InstallationManifestV2> {
  return decodeCanonicalJson(await nodeFs.readFile(fixture.paths.manifestFile), MAX_MANIFEST_BYTES) as unknown as InstallationManifestV2;
}

async function instructionKeys(fixture: CommandFixture, owner: Vendor): Promise<readonly string[]> {
  return (await manifestOf(fixture)).artifacts
    .flatMap((row) => (row.kind === "instruction" && row.owner === owner ? [`${row.instruction.category}/${row.instruction.id}/${row.instruction.source}`] : []))
    .sort();
}

async function workflowIds(fixture: CommandFixture): Promise<readonly string[]> {
  const bootstrap = fixture.context.bootstrap;
  if (bootstrap?.state !== "available") throw new Error("the fixture has no admitted release");
  return (await loadReleaseWorkflows(await inspectPackagedRelease(bootstrap.packagedRelease))).map((workflow) => workflow.id);
}

describe("init --adapters: fresh install and reconcile (one chained home)", () => {
  let installed: Home;

  it("installs both vendor trees, every unheld artifact and the Codex block on a fresh init --adapters claude,codex", async () => {
    installed = await home("init-adapters");
    const { fixture } = installed;

    const result = await runInit(fixture.context, options(["claude", "codex"]));

    expect(result.ok).toBe(true);
    const ids = await workflowIds(fixture);
    expect(ids.length).toBeGreaterThan(0);
    expect(existsSync(join(installed.claudePlugin, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(installed.codexPlugin, ".codex-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(installed.codexPlugin, "hooks", "hooks.json"))).toBe(true);
    expect(result.ok && result.warnings).toContain(CODEX_HOOK_TRUST_STEP);
    for (const id of ids) {
      expect(existsSync(join(installed.claudePlugin, "skills", `developer-os-${id}`, "SKILL.md")), id).toBe(true);
      expect(existsSync(join(installed.codexPlugin, "skills", `developer-os-${id}`, "SKILL.md")), id).toBe(true);
    }

    const claude = CATALOG.artifacts
      .filter((row) => !UNPROVEN_CLAUDE_CATEGORIES.has(row.category))
      .map((row) => `${row.category}/${row.id}/default`);
    expect(claude.length).toBeGreaterThan(0);
    expect(await instructionKeys(fixture, "claude")).toStrictEqual(claude.sort());
    // Output styles are unsupported on Codex; the rest installs, the rules as block members.
    const codexKeys = await instructionKeys(fixture, "codex");
    expect(codexKeys).toContain("skill/triage/default");
    expect(codexKeys).toContain("vendor-file/agents-md/default");

    const agentsMd = await nodeFs.readFile(join(installed.codexHome, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain(INSTRUCTION_BLOCK_BEGIN);
    expect(agentsMd).toContain("Be careful.");
    // Every Claude block member is a rule, and `rule` is held back until the billed row passes.
    expect(UNPROVEN_CLAUDE_CATEGORIES.has("rule")).toBe(true);
    expect(existsSync(join(installed.claudeHome, "CLAUDE.md"))).toBe(false);

    const config = loadConfig(await nodeFs.readFile(fixture.paths.configFile, "utf8"));
    expect(config.adapters).toStrictEqual({ claude: true, codex: true });
    expect(fixture.vendorProcesses).toContain(`${CODEX} plugin add developer-os@developer-os --json`);
    expect(installed.codex.registered).toBe(true);
    const registration = (await manifestOf(fixture)).artifacts.find((row) => row.path === join(fixture.paths.home, "codex", "registration.json"));
    expect(registration?.verification).toMatchObject({ mode: "schema", schemaId: "codex-registration-v1" });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("performs no transaction and no registration on an unchanged re-run", async () => {
    const { fixture } = installed;
    const manifestBefore = await nodeFs.readFile(fixture.paths.manifestFile);
    const configBefore = await nodeFs.readFile(fixture.paths.configFile);
    const spawnedBefore = fixture.vendorProcesses.length;

    const result = await runInit(fixture.context, options(null));

    expect(result.ok).toBe(true);
    expect(await nodeFs.readFile(fixture.paths.manifestFile)).toStrictEqual(manifestBefore);
    expect(await nodeFs.readFile(fixture.paths.configFile)).toStrictEqual(configBefore);
    const spawned = fixture.vendorProcesses.slice(spawnedBefore);
    // Discovery still asks `--version`, and `plugin list` confirms the registration is live.
    expect(spawned.filter((line) => / plugin (add|marketplace add|remove|marketplace remove)/u.test(line))).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("converges an override add, change and removal in one re-run each", async () => {
    const { fixture } = installed;
    const skill = join(fixture.paths.home, "instructions", "claude", "skills", "mine");
    const installedSkill = join(installed.claudePlugin, "skills", "mine", "SKILL.md");
    await nodeFs.mkdir(skill, { recursive: true, mode: 0o700 });

    await nodeFs.writeFile(join(skill, "SKILL.md"), "---\nname: mine\ndescription: Mine.\n---\nFirst.\n", { mode: 0o600 });
    expect((await runInit(fixture.context, options(null))).ok).toBe(true);
    expect(await instructionKeys(fixture, "claude")).toContain("skill/mine/user");
    expect(await nodeFs.readFile(installedSkill, "utf8")).toContain("First.");

    await nodeFs.writeFile(join(skill, "SKILL.md"), "---\nname: mine\ndescription: Mine.\n---\nSecond.\n", { mode: 0o600 });
    expect((await runInit(fixture.context, options(null))).ok).toBe(true);
    expect(await nodeFs.readFile(installedSkill, "utf8")).toContain("Second.");

    await nodeFs.rm(skill, { recursive: true });
    expect((await runInit(fixture.context, options(null))).ok).toBe(true);
    expect(await instructionKeys(fixture, "claude")).not.toContain("skill/mine/user");
    expect(existsSync(installedSkill)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("strips the Codex block and unregisters, before any file change, when codex is deselected", async () => {
    const { fixture } = installed;
    const spawnedBefore = fixture.vendorProcesses.length;

    const result = await runInit(fixture.context, options(["claude"]));

    expect(result.ok).toBe(true);
    // Product-created with an empty remainder: removed rather than left empty.
    expect(existsSync(join(installed.codexHome, "AGENTS.md"))).toBe(false);
    expect(await instructionKeys(fixture, "codex")).not.toContain("vendor-file/agents-md/default");
    const spawned = fixture.vendorProcesses.slice(spawnedBefore);
    expect(spawned).toContain(`${CODEX} plugin remove developer-os@developer-os`);
    expect(spawned).toContain(`${CODEX} plugin marketplace remove developer-os`);
    expect(installed.codex.registered).toBe(false);
    const config = loadConfig(await nodeFs.readFile(fixture.paths.configFile, "utf8"));
    expect(config.adapters).toStrictEqual({ claude: true, codex: false });
    expect(existsSync(join(installed.claudePlugin, ".claude-plugin", "plugin.json"))).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("init without --adapters, then a failing attach (one chained home)", () => {
  let planted: Home;
  let occupied: string;

  it("writes nothing into either vendor home and names --adapters", async () => {
    planted = await home("init-no-adapters");
    const { fixture } = planted;
    occupied = join(planted.claudePlugin, ".claude-plugin", "plugin.json");
    await nodeFs.mkdir(dirname(occupied), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(occupied, "someone else's plugin\n", { mode: 0o600 });
    const claudeBefore = await inventory(planted.claudeHome);
    expect(claudeBefore.length).toBeGreaterThan(0);

    // `adapters` omitted, as `main` passes nothing but `null` and older callers pass nothing at all.
    const result = await runInit(fixture.context, { dryRun: false, assumeYes: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toContain(ADAPTERS_NEXT_STEP);
    expect(result.warnings.join("\n")).toContain("--adapters");
    expect(await inventory(planted.claudeHome)).toStrictEqual(claudeBefore);
    expect(existsSync(planted.codexHome)).toBe(false);
    expect(fixture.vendorProcesses).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("exits 3 on an occupied target and leaves a valid V2 home that doctor reads", async () => {
    const { fixture } = planted;
    const manifestBefore = await nodeFs.readFile(fixture.paths.manifestFile);

    const result = await runInit(fixture.context, options(["claude"]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
    expect(result.error.kind).toBe("instruction_target_occupied");
    expect(result.error.paths).toStrictEqual([occupied]);
    expect(result.error.message).not.toContain("someone else's plugin");
    expect(await nodeFs.readFile(occupied, "utf8")).toBe("someone else's plugin\n");
    expect(await nodeFs.readFile(fixture.paths.manifestFile)).toStrictEqual(manifestBefore);

    const report = await runDoctorReport(fixture.context);
    const manifestCheck = report.checks.find((check) => check.id === "manifest");
    expect(manifestCheck?.status).toBe("pass");
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

/** Every command string in a rendered Claude `hooks.json`. */
function hookCommands(text: string): readonly string[] {
  const parsed = JSON.parse(text) as {
    readonly hooks: Readonly<Record<string, readonly { readonly hooks: readonly { readonly command: string }[] }[]>>;
  };
  return Object.values(parsed.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks.map((hook) => hook.command)));
}

/** `~/.claude` apart from the plugin tree the attach owns (and the `skills` parent it creates for it). */
async function claudeOutsidePlugin(claudeHome: string): Promise<readonly string[]> {
  return (await inventoryDigest(claudeHome)).filter((row) => {
    const path = row.split("\0")[0] ?? "";
    return path !== "skills" && path !== "skills/developer-os" && !path.startsWith("skills/developer-os/");
  });
}

describe("init --adapters claude installs Claude hooks naming the local-build entrypoint (A13 Task 14, one chained home)", () => {
  let installed: Home;
  let hooksFile: string;
  let firstRender: string;
  let outsideBefore: readonly string[];

  it("installs hooks/hooks.json as a manifest row whose every command is <node> <entrypoint>", async () => {
    installed = await home("init-claude-hooks");
    const { fixture } = installed;
    await nodeFs.mkdir(installed.claudeHome, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(join(installed.claudeHome, "settings.json"), '{"theme":"dark"}\n', { mode: 0o600 });
    outsideBefore = await claudeOutsidePlugin(installed.claudeHome);

    const result = await runInit(fixture.context, options(["claude"]));

    expect(result.ok).toBe(true);
    hooksFile = join(installed.claudePlugin, "hooks", "hooks.json");
    firstRender = await nodeFs.readFile(hooksFile, "utf8");
    const commands = hookCommands(firstRender);
    expect(commands.length).toBeGreaterThan(0);
    const prefix = `${process.execPath} ${join(fixture.paths.home, "bin", "developer-os.mjs")} `;
    for (const command of commands) expect(command.startsWith(prefix), command).toBe(true);
    const row = (await manifestOf(fixture)).artifacts.find((artifact) => artifact.path === hooksFile);
    expect(row).toMatchObject({ owner: "claude", kind: "file", verification: { mode: "content" } });
    expect(await claudeOutsidePlugin(installed.claudeHome)).toStrictEqual(outsideBefore);
    // Review I1: the user is told what was held back.
    expect(result.ok && result.warnings).toContain(
      "held back until their Claude loading is proven: claude output-style/terse, claude rule/careful, claude scoped-rule/typescript",
    );
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("renders a byte-identical hooks.json on a second install of the same build", async () => {
    const result = await runInit(installed.fixture.context, options(["claude"]));

    expect(result.ok).toBe(true);
    expect(await nodeFs.readFile(hooksFile, "utf8")).toBe(firstRender);
    expect(await claudeOutsidePlugin(installed.claudeHome)).toStrictEqual(outsideBefore);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reports the held-back Claude categories as held back, not missing, on an unedited install", async () => {
    const report = await runDoctorReport(installed.fixture.context);

    expect(report.checks.find((check) => check.id === "instructions")?.status).toBe("warn");
    const claude = report.instructions.filter((status) => status.owner === "claude");
    expect(claude.filter((status) => status.state !== "installed").map((status) => `${status.category}/${status.id}: ${status.state}`)).toStrictEqual([
      "output-style/terse: held-back",
      "rule/careful: held-back",
      "scoped-rule/typescript: held-back",
    ]);
    expect(claude.some((status) => status.category === "vendor-file")).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reports an edit to hooks.json as drift in doctor", async () => {
    await nodeFs.writeFile(hooksFile, firstRender.replace("guard", "gaurd"));

    const report = await runDoctorReport(installed.fixture.context);

    const finding = report.checks.find((check) => check.id === "instructions");
    expect(finding?.status).toBe("fail");
    expect(finding?.paths).toContain(hooksFile);
    await nodeFs.writeFile(hooksFile, firstRender);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("removes hooks.json on uninstall, and state/hooks with it, leaving ~/.claude as it was", async () => {
    const { fixture } = installed;
    const records = join(fixture.paths.stateDir, "hooks");
    /** Fresh `init` creates it (Task 11); pinned so the removal below is of a directory that existed. */
    expect(existsSync(records)).toBe(true);

    const result = await runUninstall(fixture.context, { dryRun: false, assumeYes: true });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(existsSync(hooksFile)).toBe(false);
    expect(existsSync(records)).toBe(false);
    expect(await claudeOutsidePlugin(installed.claudeHome)).toStrictEqual(outsideBefore);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("init --adapters: a refused attach transaction leaves no product-created parent (one chained home)", () => {
  it("removes every directory it created for the attach when execute throws", async () => {
    const planted = await home("init-attach-refused");
    const { fixture } = planted;
    expect((await runInit(fixture.context, { dryRun: false, assumeYes: true })).ok).toBe(true);
    expect(existsSync(planted.claudeHome)).toBe(false);
    expect(existsSync(planted.codexHome)).toBe(false);
    const executor = fixture.context.executor;
    const context = {
      ...fixture.context,
      executor: {
        resume: (id: string) => executor.resume(id),
        rollback: (id: string) => executor.rollback(id),
        execute: (plan: Parameters<typeof executor.execute>[0]) => plan.kind === "instructions"
          ? Promise.reject(new Error("synthetic refusal after the parents were created"))
          : executor.execute(plan),
      },
    };

    const result = await runInit(context, options(["claude", "codex"]));

    expect(result.ok).toBe(false);
    expect(existsSync(planted.claudeHome)).toBe(false);
    expect(existsSync(planted.codexHome)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("init --adapters codex records CODEX_HOME for every later command (one chained home)", () => {
  let installed: Home;
  let recorded: string;
  let unset: CommandFixture["context"];

  it("installs into the CODEX_HOME in effect at attach", async () => {
    installed = await home("init-codex-home");
    const { fixture } = installed;
    recorded = join(fixture.userHome, "elsewhere", "codex");
    await nodeFs.mkdir(dirname(recorded), { recursive: true, mode: 0o700 });
    await nodeFs.mkdir(join(fixture.userHome, "other"), { mode: 0o700 });
    unset = { ...fixture.context, env: Object.fromEntries(Object.entries(fixture.context.env).filter(([name]) => name !== "CODEX_HOME")) };

    const result = await runInit({ ...unset, env: { ...unset.env, CODEX_HOME: recorded } }, options(["codex"]));

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(existsSync(join(recorded, "AGENTS.md"))).toBe(true);
    expect(existsSync(installed.codexHome)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an attach under a different explicit CODEX_HOME and writes nothing", async () => {
    const manifestBefore = await nodeFs.readFile(installed.fixture.paths.manifestFile);
    const other = join(installed.fixture.userHome, "other", "codex");

    const result = await runInit({ ...unset, env: { ...unset.env, CODEX_HOME: other } }, options(["codex"]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("codex_home_mismatch");
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
    expect(existsSync(other)).toBe(false);
    expect(await nodeFs.readFile(installed.fixture.paths.manifestFile)).toStrictEqual(manifestBefore);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("admits the manifest in doctor with CODEX_HOME unset", async () => {
    const report = await runDoctorReport(unset);

    expect(report.checks.find((check) => check.id === "manifest")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "instructions")?.status).not.toBe("fail");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("uninstalls with CODEX_HOME unset, unregistering against the recorded home", async () => {
    const callsBefore = installed.codex.calls.length;

    const result = await runUninstall(unset, { dryRun: false, assumeYes: true });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(installed.codex.calls.slice(callsBefore)).toContain(`plugin remove developer-os@developer-os @ ${recorded}`);
    expect(existsSync(join(recorded, "AGENTS.md"))).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
