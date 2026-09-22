import { existsSync } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { dirname, join, sep } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MARKETPLACE_NAME, PLUGIN_NAME } from "@developer-os/adapter-codex";
import {
  decodeCanonicalJson,
  encodeCanonicalJson,
  EXIT_CODES,
  hashBytes,
  insertInstructionBlock,
  loadConfig,
  renderInstructionBlock,
  serializeConfig,
} from "@developer-os/core";
import type {
  CanonicalJsonValue,
  HeldLifecycleStableLockV1,
  InstallationManifestV2,
  LifecycleCoordinatorStore,
  LowerHexSha256,
} from "@developer-os/core";
import type { AgentDiscovery } from "@developer-os/platform-macos";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";

import { runInit } from "../commands/init.js";
import { createCommandFixture, exists, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import { runUninstall } from "../commands/uninstall.js";
import type { CliContext } from "../context.js";
import { CODEX_CLI_ABSENT_WARNING } from "../instructions/codex-registration.js";
import type { LifecycleExecutionPlanV1 } from "./codecs.js";
import type { CliLifecycleContext } from "./context.js";
import { withLifecycleMutation } from "./mutation-gate.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const CODEX = "/opt/synthetic/bin/codex";
const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Vendor = "claude" | "codex";

const TEXT = {
  terse: "---\nname: terse\n---\nAnswer tersely.\n",
  careful: "Be careful.\n",
  skill: "---\nname: triage\ndescription: Triage a defect.\n---\nTriage.\n",
} as const;

const sha = (bytes: Uint8Array): LowerHexSha256 => hashBytes(bytes) as LowerHexSha256;

/** One Codex home's registration, and every argv the fake CLI saw with what was on disk then. */
interface FakeCodex {
  registered: boolean;
  marketplace: boolean;
  failOn: string | null;
  readonly calls: { readonly argv: string; readonly agentsPresent: boolean }[];
}

function codexRunner(codex: FakeCodex, agentsFile: () => string, pluginRoot: () => string): ProcessRunner {
  const result = (stdout: string, exitCode = 0): ProcessResult => ({ stdout, stderr: "", exitCode, signal: null, timedOut: false });
  return {
    run(request: ProcessRequest): Promise<ProcessResult> {
      const argv = request.args.join(" ");
      codex.calls.push({ argv, agentsPresent: existsSync(agentsFile()) });
      if (argv === codex.failOn) return Promise.resolve(result("", 1));
      if (argv === "plugin list --json") {
        return Promise.resolve(result(JSON.stringify({
          installed: codex.registered ? [{ name: PLUGIN_NAME, enabled: true, source: { source: "local", path: pluginRoot() } }] : [],
        })));
      }
      if (argv === "plugin marketplace list") {
        return Promise.resolve(result(codex.marketplace ? `${MARKETPLACE_NAME}  ${dirname(dirname(pluginRoot()))}\n` : "No plugin marketplaces in scope.\n"));
      }
      if (argv === `plugin remove ${PLUGIN_ID}`) codex.registered = false;
      if (argv === `plugin marketplace remove ${MARKETPLACE_NAME}`) codex.marketplace = false;
      return Promise.resolve(result(""));
    },
  };
}

function agents(codexInstalled: boolean): Readonly<Record<Vendor, AgentDiscovery>> {
  return {
    claude: { name: "claude", installed: false, executablePath: null, version: null },
    codex: codexInstalled
      ? { name: "codex", installed: true, executablePath: CODEX, version: null }
      : { name: "codex", installed: false, executablePath: null, version: null },
  };
}

function recordingStore(
  store: LifecycleCoordinatorStore<LifecycleExecutionPlanV1>,
  plans: LifecycleExecutionPlanV1[],
): LifecycleCoordinatorStore<LifecycleExecutionPlanV1> {
  return new Proxy(store, {
    get(target, property): unknown {
      if (property === "publish") {
        return async (plan: LifecycleExecutionPlanV1, global: HeldLifecycleStableLockV1) => {
          plans.push(plan);
          return target.publish(plan, global);
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  });
}

function instrument(context: CliContext, plans: LifecycleExecutionPlanV1[]): CliContext {
  const lifecycle = context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
  const instrumented: CliLifecycleContext = { ...lifecycle, store: (key) => recordingStore(lifecycle.store(key), plans) };
  return { ...context, lifecycle: instrumented };
}

interface Installed {
  readonly fixture: CommandFixture;
  readonly context: CliContext;
  readonly codex: FakeCodex;
  readonly plans: LifecycleExecutionPlanV1[];
  readonly home: string;
  readonly claudeRoot: string;
  readonly codexHome: string;
  readonly claudeMd: string;
  readonly agentsMd: string;
  readonly outputStyle: string;
  readonly pluginDir: string;
  readonly override: string;
  readonly vendorPaths: readonly string[];
}

/**
 * Tasks 16 and 18 own the real attach, and Task 18 is integrated alongside this one, so the
 * rows it records are planted: the files are written directly and the manifest and `adapters.*`
 * are rewritten by one gated transaction, the path `manifest-rewrite.v2.test.ts` pins.
 */
async function install(
  label: string,
  options: { readonly vendors: readonly Vendor[]; readonly claudeMdBefore?: string; readonly codexInstalled?: boolean },
): Promise<Installed> {
  const codex: FakeCodex = { registered: true, marketplace: true, failOn: null, calls: [] };
  const refs = { agents: "", pluginRoot: "" };
  const fixture = await createCommandFixture(label, {
    bootstrapAvailable: true,
    runner: codexRunner(codex, () => refs.agents, () => refs.pluginRoot),
    agents: agents(options.codexInstalled ?? true),
  });
  await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  const initialized = await runInit(fixture.context, ACCEPTED);
  if (!initialized.ok) throw new Error(`fixture init failed: ${JSON.stringify(initialized)}`);

  const home = fixture.paths.home;
  const claudeRoot = join(fixture.userHome, ".claude");
  const codexHome = join(fixture.userHome, ".codex");
  const pluginRoot = join(home, "codex", "plugins", "developer-os");
  const pluginDir = join(claudeRoot, "skills", "developer-os");
  refs.agents = join(codexHome, "AGENTS.md");
  refs.pluginRoot = pluginRoot;

  const manifestFile = fixture.paths.manifestFile;
  const manifestBefore = new Uint8Array(await nodeFs.readFile(manifestFile));
  const manifest = decodeCanonicalJson(manifestBefore, MAX_MANIFEST_BYTES) as unknown as InstallationManifestV2;
  const [template] = manifest.artifacts;
  if (template === undefined) throw new Error("the fresh manifest holds no artifact");
  const common = {
    productVersion: template.productVersion,
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    source: template.source,
    verifiedAt: template.verifiedAt,
  };

  const files: { readonly path: string; readonly bytes: Uint8Array }[] = [];
  const rows: Record<string, unknown>[] = [];
  const content = (owner: Vendor, path: string, category: string, id: string, text: string): void => {
    const bytes = encoder.encode(text);
    files.push({ path, bytes });
    rows.push({
      ...common,
      owner,
      path,
      mergeStrategy: "dedicated",
      kind: "instruction",
      instruction: { category, id, source: "default" },
      verification: { mode: "content", installedHash: sha(bytes) },
    });
  };
  const directory = (owner: Vendor, path: string): void => {
    rows.push({ ...common, owner, path, mergeStrategy: "dedicated", kind: "directory", verification: { mode: "content" } });
  };
  const block = async (owner: Vendor, path: string, id: string, body: string, before: string | undefined): Promise<void> => {
    const bytes = renderInstructionBlock({ productHome: home, vendor: owner, body });
    const restore = before === undefined
      ? {}
      : { existedBefore: true, beforeHash: sha(encoder.encode(before)), backupRelativePath: `instructions/${id}` };
    if (before !== undefined) {
      const backup = join(fixture.paths.backupsDir, "instructions", id);
      await nodeFs.mkdir(dirname(backup), { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(backup, before, { mode: 0o600 });
    }
    files.push({ path, bytes: before === undefined ? bytes : insertInstructionBlock(encoder.encode(before), bytes) });
    rows.push({
      ...common,
      ...restore,
      owner,
      path,
      mergeStrategy: "marked-block",
      kind: "instruction",
      instruction: {
        category: "vendor-file",
        id,
        source: "default",
        members: [{ category: "rule", id: "careful", source: "default", sha256: sha(encoder.encode("rule/careful")) }],
      },
      verification: { mode: "block", blockHash: sha(bytes) },
    });
  };

  const claudeMd = join(claudeRoot, "CLAUDE.md");
  const agentsMd = join(codexHome, "AGENTS.md");
  const outputStyle = join(claudeRoot, "output-styles", "developer-os-terse.md");
  if (options.vendors.includes("claude")) {
    content("claude", join(home, "claude", "instructions", "careful.md"), "rule", "careful", TEXT.careful);
    content("claude", outputStyle, "output-style", "terse", TEXT.terse);
    directory("claude", pluginDir);
    directory("claude", join(pluginDir, "skills"));
    directory("claude", join(pluginDir, "skills", "triage"));
    content("claude", join(pluginDir, "skills", "triage", "SKILL.md"), "skill", "triage", TEXT.skill);
    await block("claude", claudeMd, "claude-md", `@${home}/claude/instructions/careful.md\n`, options.claudeMdBefore);
  }
  if (options.vendors.includes("codex")) {
    content("codex", join(pluginRoot, "skills", "triage", "SKILL.md"), "skill", "triage", TEXT.skill);
    await block("codex", agentsMd, "agents-md", `## careful\n${TEXT.careful}`, undefined);
  }

  for (const file of files) {
    await nodeFs.mkdir(dirname(file.path), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(file.path, file.bytes, { mode: 0o600 });
  }
  const override = join(home, "instructions", "claude", "rules", "mine.md");
  await nodeFs.mkdir(dirname(override), { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(override, "My own rule.\n", { mode: 0o600 });

  const artifacts = [...manifest.artifacts, ...rows].sort((left, right) =>
    Buffer.compare(Buffer.from(String(left.path)), Buffer.from(String(right.path))),
  );
  const manifestAfter = encoder.encode(encodeCanonicalJson({ ...manifest, artifacts } as unknown as CanonicalJsonValue));
  const configFile = fixture.paths.configFile;
  const configBefore = new Uint8Array(await nodeFs.readFile(configFile));
  const configAfter = encoder.encode(serializeConfig({
    ...loadConfig(decoder.decode(configBefore)),
    adapters: { claude: options.vendors.includes("claude"), codex: options.vendors.includes("codex") },
  }));
  const lifecycle = fixture.context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
  await withLifecycleMutation(fixture.context, lifecycle, () =>
    fixture.context.executor.execute({
      kind: "instructions",
      mutations: [
        { targetPath: configFile, operation: "replace", content: configAfter, expectedBeforeHash: sha(configBefore) },
        { targetPath: manifestFile, operation: "replace", content: manifestAfter, expectedBeforeHash: sha(manifestBefore) },
      ],
    }),
  );

  codex.calls.length = 0;
  const plans: LifecycleExecutionPlanV1[] = [];
  const vendorPaths = rows.map((row) => String(row.path)).filter((path) => !path.startsWith(`${home}${sep}`));
  return {
    fixture,
    context: instrument(fixture.context, plans),
    codex,
    plans,
    home,
    claudeRoot,
    codexHome,
    claudeMd,
    agentsMd,
    outputStyle,
    pluginDir,
    override,
    vendorPaths,
  };
}

function coordinatorTargets(plan: LifecycleExecutionPlanV1 | undefined): readonly string[] {
  return (plan?.participants.foundation ?? []).flatMap((ref) => ref.mutations.map((mutation) => mutation.targetPath as string));
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

async function snapshot(installed: Installed): Promise<readonly string[]> {
  const read = async (path: string): Promise<string> => ((await exists(path)) ? sha(new Uint8Array(await nodeFs.readFile(path))) : "absent");
  return Promise.all([installed.fixture.paths.manifestFile, installed.fixture.paths.configFile, ...installed.vendorPaths].map(read));
}

describe("uninstall detaches vendor instruction artifacts before draining", () => {
  it("unregisters, detaches every vendor row, then drains a manifest of product-home rows only", async () => {
    const mine = "# Mine\n";
    const installed = await install("uninstall-detach-both", { vendors: ["claude", "codex"], claudeMdBefore: mine });
    const { codex, claudeMd, agentsMd, codexHome, claudeRoot } = installed;
    expect(installed.vendorPaths.length).toBeGreaterThan(0);
    const editedAfterInstall = `# Added after install\n${await nodeFs.readFile(claudeMd, "utf8")}`;
    await nodeFs.writeFile(claudeMd, editedAfterInstall);

    const result = await runUninstall(installed.context, ACCEPTED);

    if (!result.ok) throw new Error(`${String(result.code)} ${result.error.kind}: ${result.error.message}`);
    expect(result.warnings).toStrictEqual([]);
    expect(result.data.removed).toEqual(expect.arrayContaining([...installed.vendorPaths]));
    expect(codex.calls.map((call) => call.argv)).toEqual(expect.arrayContaining([
      `plugin remove ${PLUGIN_ID}`,
      `plugin marketplace remove ${MARKETPLACE_NAME}`,
    ]));
    expect(codex.calls.filter((call) => call.argv.includes("remove")).every((call) => call.agentsPresent)).toBe(true);
    expect(codex.registered).toBe(false);
    expect(codex.marketplace).toBe(false);

    const targets = coordinatorTargets(installed.plans.at(-1));
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((target) => inside(claudeRoot, target) || inside(codexHome, target))).toStrictEqual([]);

    expect(await nodeFs.readFile(claudeMd, "utf8")).toBe(`# Added after install\n${mine}`);
    expect(await exists(agentsMd)).toBe(false);
    for (const path of installed.vendorPaths.filter((path) => path !== claudeMd)) expect(await exists(path)).toBe(false);
    expect(await exists(installed.pluginDir)).toBe(false);
    expect(await nodeFs.readFile(installed.override, "utf8")).toBe("My own rule.\n");

    const reinstalled = await runInit(installed.fixture.rebuildContext(), ACCEPTED);
    expect(reinstalled.ok).toBe(true);
    expect(await nodeFs.readFile(installed.override, "utf8")).toBe("My own rule.\n");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a drifted managed file with exit 3 before any write or unregistration", async () => {
    const installed = await install("uninstall-detach-drift", { vendors: ["claude", "codex"] });
    await nodeFs.writeFile(installed.outputStyle, "edited by hand\n");
    const before = await snapshot(installed);

    const result = await runUninstall(installed.context, ACCEPTED);

    expect(result).toMatchObject({ ok: false, code: EXIT_CODES.decisionRequired });
    if (result.ok) throw new Error("uninstall succeeded over a drifted file");
    expect(result.error.paths).toContain(installed.outputStyle);
    expect(await snapshot(installed)).toStrictEqual(before);
    expect(installed.codex.calls.some((call) => call.argv.includes("remove"))).toBe(false);
    expect(installed.plans).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an edited block with exit 3 and conflict evidence before any write", async () => {
    const installed = await install("uninstall-detach-block", { vendors: ["codex"] });
    const text = await nodeFs.readFile(installed.agentsMd, "utf8");
    await nodeFs.writeFile(installed.agentsMd, text.replace("Be careful.", "Be reckless."));
    const before = await snapshot(installed);

    const result = await runUninstall(installed.context, ACCEPTED);

    expect(result).toMatchObject({
      ok: false,
      code: EXIT_CODES.decisionRequired,
      error: { kind: "instruction_block_conflict", paths: [installed.agentsMd] },
    });
    if (result.ok) throw new Error("uninstall succeeded over an edited block");
    expect(result.error.data).toHaveProperty("evidence");
    expect(await snapshot(installed)).toStrictEqual(before);
    expect(installed.codex.calls.some((call) => call.argv.includes("remove"))).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reports an absent Codex CLI as a warning and still detaches", async () => {
    const installed = await install("uninstall-detach-no-codex", { vendors: ["codex"], codexInstalled: false });

    const result = await runUninstall(installed.context, ACCEPTED);

    if (!result.ok) throw new Error(`${String(result.code)} ${result.error.kind}: ${result.error.message}`);
    expect(result.warnings).toStrictEqual([CODEX_CLI_ABSENT_WARNING]);
    expect(installed.codex.calls).toStrictEqual([]);
    expect(await exists(installed.agentsMd)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("aborts with exit 1 before any file change when the present Codex CLI fails", async () => {
    const installed = await install("uninstall-detach-codex-fails", { vendors: ["codex"] });
    installed.codex.failOn = `plugin remove ${PLUGIN_ID}`;
    const before = await snapshot(installed);

    const result = await runUninstall(installed.context, ACCEPTED);

    expect(result).toMatchObject({ ok: false, code: EXIT_CODES.operationalFailure, error: { kind: "codex_registration_failed" } });
    expect(await snapshot(installed)).toStrictEqual(before);
    expect(installed.plans).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("previews the detach in a dry run without unregistering or writing", async () => {
    const installed = await install("uninstall-detach-dry-run", { vendors: ["claude", "codex"] });
    const before = await snapshot(installed);

    const result = await runUninstall(installed.context, { dryRun: true, assumeYes: false });

    if (!result.ok) throw new Error(`${String(result.code)} ${result.error.kind}: ${result.error.message}`);
    expect(result.data.removed).toEqual(expect.arrayContaining([...installed.vendorPaths]));
    expect(result.data.removed).toContain(installed.fixture.paths.manifestFile);
    expect(await snapshot(installed)).toStrictEqual(before);
    expect(installed.codex.calls).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("keeps every vendor artifact when the confirmation is declined", async () => {
    const installed = await install("uninstall-detach-declined", { vendors: ["claude", "codex"] });
    const before = await snapshot(installed);
    const declining: CliContext = { ...installed.context, io: { ...installed.context.io, confirm: () => Promise.resolve(false) } };

    const result = await runUninstall(declining, { dryRun: false, assumeYes: false });

    expect(result).toMatchObject({ ok: false, code: EXIT_CODES.decisionRequired, error: { kind: "declined" } });
    expect(await snapshot(installed)).toStrictEqual(before);
    expect(installed.codex.calls).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("still refuses a configuration that no longer validates", async () => {
    const installed = await install("uninstall-detach-bad-config", { vendors: [] });
    await nodeFs.writeFile(installed.fixture.paths.configFile, "not = [valid\n");

    const result = await runUninstall(installed.context, ACCEPTED);

    expect(result).toMatchObject({ ok: false, code: EXIT_CODES.decisionRequired });
    if (result.ok) throw new Error("uninstall removed an invalid configuration");
    expect(result.error.paths).toContain(installed.fixture.paths.configFile);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
