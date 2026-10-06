import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  decodeCanonicalJson,
  encodeCanonicalJson,
  EXIT_CODES,
  hashBytes,
  INSTRUCTION_BLOCK_BEGIN,
  loadConfig,
  renderInstructionBlock,
  serializeConfig,
} from "@developer-os/core";
import type { CanonicalJsonValue, InstallationManifestV2, LowerHexSha256 } from "@developer-os/core";
import type { AgentDiscovery } from "@developer-os/platform-macos";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";

import { codexPluginTreeHash } from "../instructions/codex-registration.js";
import { withLifecycleMutation } from "../lifecycle/mutation-gate.js";
import { run } from "../main.js";
import type { ReleaseFileV1 } from "../update/local-release.js";
import { describeInstructions, hasBlockingFailure, runDoctor, runDoctorReport } from "./doctor.js";
import type { DoctorReportV1, InstructionStatusV1 } from "./doctor.js";
import { runInit } from "./init.js";
import { createCommandFixture, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "./testing.js";
import type { CommandFixture } from "./testing.js";

afterAll(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const CODEX = "/opt/synthetic/bin/codex";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Vendor = "claude" | "codex";

const CATALOG = {
  schemaVersion: 1,
  artifacts: [
    { category: "output-style", id: "terse", legacyName: "terse", vendors: ["claude", "codex"], thinCommand: false },
    { category: "rule", id: "careful", legacyName: "careful", vendors: ["claude", "codex"], thinCommand: false },
    { category: "scoped-rule", id: "typescript", legacyName: "typescript", vendors: ["claude", "codex"], thinCommand: false },
    { category: "skill", id: "triage", legacyName: "triage", vendors: ["claude", "codex"], thinCommand: false },
  ],
};

const TEXT = {
  terse: "---\nname: terse\n---\nAnswer tersely.\n",
  careful: "Be careful.\n",
  typescript: "---\npaths:\n  - \"**/*.ts\"\n---\nUse strict types.\n",
  skill: "---\nname: triage\ndescription: Triage a defect.\n---\nTriage.\n",
  reference: "Reference notes.\n",
} as const;

function release(relativePath: string, text: string): ReleaseFileV1 {
  return { relativePath, bytes: encoder.encode(text), mode: 0o600 };
}

const INSTRUCTIONS: readonly ReleaseFileV1[] = [
  release("catalog.json", `${JSON.stringify(CATALOG)}\n`),
  release("output-styles/terse.md", TEXT.terse),
  release("rules/careful.md", TEXT.careful),
  release("scoped-rules/typescript.md", TEXT.typescript),
  release("skills/triage/SKILL.md", TEXT.skill),
  release("skills/triage/reference.md", TEXT.reference),
];

/** Mutable so one installed home can walk every registration state. */
interface FakeCodexState {
  registered: boolean;
  promptInput: string;
}

function codexRunner(state: FakeCodexState, pluginRoot: () => string): ProcessRunner {
  const ok = (stdout: string): ProcessResult => ({ stdout, stderr: "", exitCode: 0, signal: null, timedOut: false });
  return {
    run(request: ProcessRequest): Promise<ProcessResult> {
      const argv = request.args.join(" ");
      if (argv === "plugin list --json") {
        return Promise.resolve(ok(JSON.stringify({
          installed: state.registered ? [{ name: "developer-os", enabled: true, source: { source: "local", path: pluginRoot() } }] : [],
        })));
      }
      if (argv === "debug prompt-input probe") return Promise.resolve(ok(state.promptInput));
      return Promise.resolve(ok(argv === "--version" ? "codex-cli 0.155.1" : ""));
    },
  };
}

const AGENTS: Readonly<Record<Vendor, AgentDiscovery>> = {
  claude: { name: "claude", installed: false, executablePath: null, version: null },
  codex: { name: "codex", installed: true, executablePath: CODEX, version: null },
};

interface Planted {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly row: Record<string, unknown>;
}

interface Installed {
  readonly fixture: CommandFixture;
  readonly codex: FakeCodexState;
  readonly home: string;
  readonly userHome: string;
  readonly codexHome: string;
  readonly pluginRoot: string;
  readonly treeFiles: readonly { readonly path: string; readonly sha256: LowerHexSha256 }[];
}

function sha(bytes: Uint8Array): LowerHexSha256 {
  return hashBytes(bytes) as LowerHexSha256;
}

/**
 * Tasks 16–18 own the real attach. Until then the rows it will record are planted by hand:
 * the files are written directly and the manifest and `adapters.*` are rewritten by one gated
 * transaction, the path `manifest-rewrite.v2.test.ts` pins.
 */
async function install(
  label: string,
  options: { readonly vendors: readonly Vendor[]; readonly userRules?: readonly string[] },
): Promise<Installed> {
  const codex: FakeCodexState = { registered: true, promptInput: "" };
  let pluginRootRef = "";
  const fixture = await createCommandFixture(label, {
    bootstrapAvailable: true,
    instructions: INSTRUCTIONS,
    runner: codexRunner(codex, () => pluginRootRef),
    agents: AGENTS,
  });
  await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  const initialized = await runInit(fixture.context, ACCEPTED);
  expect(initialized.ok).toBe(true);

  const home = fixture.paths.home;
  const userHome = fixture.userHome;
  const codexHome = join(userHome, ".codex");
  const pluginRoot = join(home, "codex", "plugins", "developer-os");
  pluginRootRef = pluginRoot;

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
  const sourceOf = (vendor: Vendor, id: string): "default" | "user" =>
    vendor === "claude" && (options.userRules ?? []).includes(id) ? "user" : "default";

  const planted: Planted[] = [];
  const content = (owner: Vendor, path: string, category: string, id: string, text: string): void => {
    const bytes = encoder.encode(text);
    planted.push({
      path,
      bytes,
      row: {
        ...common,
        owner,
        path,
        mergeStrategy: "dedicated",
        kind: "instruction",
        instruction: { category, id, source: category === "rule" ? sourceOf(owner, id) : "default" },
        verification: { mode: "content", installedHash: sha(bytes) },
      },
    });
  };
  const block = (owner: Vendor, path: string, id: string, body: string, members: readonly (readonly [string, string])[]): void => {
    const bytes = renderInstructionBlock({ productHome: home, vendor: owner, body });
    planted.push({
      path,
      bytes,
      row: {
        ...common,
        owner,
        path,
        mergeStrategy: "marked-block",
        kind: "instruction",
        instruction: {
          category: "vendor-file",
          id,
          source: "default",
          members: members.map(([category, memberId]) => ({
            category,
            id: memberId,
            source: sourceOf(owner, memberId),
            sha256: sha(encoder.encode(`${category}/${memberId}`)),
          })),
        },
        verification: { mode: "block", blockHash: sha(bytes) },
      },
    });
  };

  if (options.vendors.includes("claude")) {
    const claude = join(userHome, ".claude");
    content("claude", join(home, "claude", "instructions", "careful.md"), "rule", "careful", TEXT.careful);
    content("claude", join(claude, "rules", "developer-os-typescript.md"), "scoped-rule", "typescript", TEXT.typescript);
    content("claude", join(claude, "output-styles", "developer-os-terse.md"), "output-style", "terse", TEXT.terse);
    content("claude", join(claude, "skills", "developer-os", "skills", "triage", "SKILL.md"), "skill", "triage", TEXT.skill);
    content("claude", join(claude, "skills", "developer-os", "skills", "triage", "reference.md"), "skill", "triage", TEXT.reference);
    block("claude", join(claude, "CLAUDE.md"), "claude-md", `@${home}/claude/instructions/careful.md\n`, [["rule", "careful"]]);
  }

  const treeFiles: { path: string; sha256: LowerHexSha256 }[] = [];
  if (options.vendors.includes("codex")) {
    content("codex", join(pluginRoot, "skills", "triage", "SKILL.md"), "skill", "triage", TEXT.skill);
    content("codex", join(pluginRoot, "skills", "triage", "reference.md"), "skill", "triage", TEXT.reference);
    block("codex", join(codexHome, "AGENTS.md"), "agents-md", `## careful\n${TEXT.careful}## typescript — applies only to paths matching: **/*.ts\nUse strict types.\n`, [
      ["rule", "careful"],
      ["scoped-rule", "typescript"],
    ]);
    for (const [relative, text] of [["skills/triage/SKILL.md", TEXT.skill], ["skills/triage/reference.md", TEXT.reference]] as const) {
      treeFiles.push({ path: relative, sha256: sha(encoder.encode(text)) });
    }
    const registration = encoder.encode(encodeCanonicalJson({ codexHome, treeHash: codexPluginTreeHash(treeFiles) }));
    planted.push({
      path: join(home, "codex", "registration.json"),
      bytes: registration,
      row: {
        ...common,
        owner: "codex",
        path: join(home, "codex", "registration.json"),
        mergeStrategy: "dedicated",
        kind: "file",
        verification: { mode: "schema", schemaId: "codex-registration-v1", installedHash: sha(registration) },
      },
    });
  }

  for (const file of planted) {
    await nodeFs.mkdir(dirname(file.path), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(file.path, file.bytes, { mode: 0o600 });
  }
  for (const id of options.userRules ?? []) {
    const path = join(home, "instructions", "claude", "rules", `${id}.md`);
    await nodeFs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(path, "My own rule.\n", { mode: 0o600 });
  }

  const artifacts = [...manifest.artifacts, ...planted.map((file) => file.row)].sort((left, right) =>
    Buffer.compare(Buffer.from(String(left.path)), Buffer.from(String(right.path))),
  );
  const manifestAfter = encoder.encode(encodeCanonicalJson({ ...manifest, artifacts } as unknown as CanonicalJsonValue));
  const configFile = fixture.paths.configFile;
  const configBefore = new Uint8Array(await nodeFs.readFile(configFile));
  const config = loadConfig(decoder.decode(configBefore));
  const configAfter = encoder.encode(serializeConfig({
    ...config,
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
  return { fixture, codex, home, userHome, codexHome, pluginRoot, treeFiles };
}

function brief(statuses: readonly InstructionStatusV1[]): readonly string[] {
  return statuses.map((status) => `${status.owner} ${status.category}/${status.id}: ${status.source}, ${status.state}`);
}

function check(report: DoctorReportV1, id: string) {
  const found = report.checks.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`doctor reported no ${id} check`);
  return found;
}

const BOTH_VENDORS = [
  "claude output-style/terse: default, installed",
  "claude rule/careful: default, installed",
  "claude scoped-rule/typescript: default, installed",
  "claude skill/triage: default, installed",
  "claude vendor-file/claude-md: default, installed",
  "codex output-style/terse: default, unsupported-vendor",
  "codex rule/careful: default, installed",
  "codex scoped-rule/typescript: default, emulated",
  "codex skill/triage: default, installed",
  "codex vendor-file/agents-md: default, installed",
];

describe("doctor names every instruction artifact", () => {
  it("lists every catalog artifact and each block once per selected vendor, from the hash-verified catalog", async () => {
    const { fixture, home } = await install("doctor-instructions-both", { vendors: ["claude", "codex"] });

    const report = await runDoctorReport(fixture.context);

    expect(BOTH_VENDORS.length).toBeGreaterThan(0);
    expect(brief(report.instructions)).toStrictEqual(BOTH_VENDORS);
    expect(describeInstructions(report)).toStrictEqual(BOTH_VENDORS);
    expect(check(report, "manifest").status).toBe("pass");
    expect(check(report, "drift").status).toBe("pass");
    expect(check(report, "instructions").status).toBe("warn");
    expect(check(report, "instructions").message).toContain("codex output-style/terse");
    expect(check(report, "codex-registration")).toMatchObject({ status: "pass", message: "registered" });

    const catalog = join(home, "releases", "1.0.0", "darwin-arm64", "instructions", "catalog.json");
    await nodeFs.chmod(catalog, 0o600);
    await nodeFs.writeFile(catalog, `${JSON.stringify({ schemaVersion: 1, artifacts: [] })}\n`);
    const tampered = await runDoctorReport(fixture.context);
    expect(check(tampered, "instructions").status).toBe("fail");
    expect(check(tampered, "instructions").message).toContain("does not match its manifest record");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("lists nothing for an unselected vendor", async () => {
    const { fixture } = await install("doctor-instructions-claude", { vendors: ["claude"] });

    const report = await runDoctorReport(fixture.context);

    expect(report.instructions.length).toBeGreaterThan(0);
    expect(report.instructions.every((status) => status.owner === "claude")).toBe(true);
    expect(check(report, "codex-registration")).toMatchObject({ status: "pass", message: "codex is not selected" });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("produces drifted and missing states, fails `instructions` alone, and never blocks init", async () => {
    const { fixture, userHome, codexHome } = await install("doctor-instructions-drift", { vendors: ["claude", "codex"] });
    await nodeFs.writeFile(join(userHome, ".claude", "skills", "developer-os", "skills", "triage", "reference.md"), "Edited.\n");
    await nodeFs.unlink(join(userHome, ".claude", "output-styles", "developer-os-terse.md"));
    const agents = join(codexHome, "AGENTS.md");
    await nodeFs.writeFile(agents, (await nodeFs.readFile(agents, "utf8")).replace("Be careful.", "Be reckless."));

    const result = await runDoctor(fixture.context);
    const report = await runDoctorReport(fixture.context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
    expect(brief(report.instructions)).toStrictEqual([
      "claude output-style/terse: default, missing",
      "claude rule/careful: default, installed",
      "claude scoped-rule/typescript: default, installed",
      "claude skill/triage: default, drifted",
      "claude vendor-file/claude-md: default, installed",
      "codex output-style/terse: default, unsupported-vendor",
      "codex rule/careful: default, drifted",
      "codex scoped-rule/typescript: default, drifted",
      "codex skill/triage: default, installed",
      "codex vendor-file/agents-md: default, drifted",
    ]);
    expect(check(report, "instructions").status).toBe("fail");
    expect(check(report, "drift").status).toBe("pass");
    expect(hasBlockingFailure(report)).toBe(false);
    expect(JSON.stringify(report)).not.toContain("Be reckless.");

    /** NEW-150/NEW-155: the human failure names each drifted artifact, not only a count. */
    fixture.io.out.length = 0;
    expect(await run(["doctor"], fixture.io, () => fixture.context)).toBe(EXIT_CODES.decisionRequired);
    const human = fixture.io.out.join("\n");
    expect(human).toMatch(/^\[fail\] instructions: /mu);
    expect(human).toContain("claude skill/triage: default, drifted");
    expect(human).toContain("claude output-style/terse: default, missing");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reports malformed block markers as block_malformed and the block's members as drifted", async () => {
    const { fixture, userHome } = await install("doctor-instructions-malformed", { vendors: ["claude"] });
    const claudeMd = join(userHome, ".claude", "CLAUDE.md");
    await nodeFs.appendFile(claudeMd, `${INSTRUCTION_BLOCK_BEGIN}\n`);

    const report = await runDoctorReport(fixture.context);

    expect(brief(report.instructions)).toContain("claude rule/careful: default, drifted");
    expect(brief(report.instructions)).toContain("claude vendor-file/claude-md: default, drifted");
    expect(check(report, "instructions").status).toBe("fail");
    expect(check(report, "instructions").message).toContain("block_malformed");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("flips exactly the overridden row to `user`, and lists an uninstalled override as missing, and an uninstalled Claude rule override too", async () => {
    const { fixture, home } = await install("doctor-instructions-override", { vendors: ["claude", "codex"], userRules: ["careful"] });
    const extra = join(home, "instructions", "claude", "rules", "extra.md");
    await nodeFs.writeFile(extra, "Another rule of mine.\n", { mode: 0o600 });
    const extraSkill = join(home, "instructions", "claude", "skills", "extra");
    await nodeFs.mkdir(extraSkill, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(join(extraSkill, "SKILL.md"), "---\nname: extra\ndescription: Mine.\n---\nMine.\n", { mode: 0o600 });

    const report = await runDoctorReport(fixture.context);

    const flipped = BOTH_VENDORS.map((line) =>
      line === "claude rule/careful: default, installed" ? "claude rule/careful: user, installed" : line,
    );
    expect(brief(report.instructions)).toStrictEqual([
      ...flipped.slice(0, 2),
      // Nothing is held back since the billed row (NEW-101): an uninstalled rule override is missing.
      "claude rule/extra: user, missing",
      flipped[2],
      "claude skill/extra: user, missing",
      ...flipped.slice(3),
    ]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reports every Codex registration state: unregistered, stale and, with --probe, cache-stale", async () => {
    const { fixture, codex, codexHome, home, treeFiles } = await install("doctor-instructions-registration", { vendors: ["codex"] });
    const registration = () => runDoctorReport(fixture.context).then((report) => check(report, "codex-registration"));
    const probed = () => runDoctorReport(fixture.context, { probe: true }).then((report) => check(report, "codex-registration"));
    expect(treeFiles.length).toBeGreaterThan(0);

    expect(await registration()).toMatchObject({ status: "pass", message: "registered" });

    const cacheRoot = join(codexHome, "plugins", "cache", "developer-os", "developer-os", "0.0.0");
    codex.promptInput = `\`r1\` = \`${cacheRoot}/skills\`\ndeveloper-os:triage: Triage a defect. (file: r1/triage/SKILL.md)\n`;
    expect((await probed()).message).toMatch(/^cache-stale/u);
    for (const [relative, text] of [["skills/triage/SKILL.md", TEXT.skill], ["skills/triage/reference.md", TEXT.reference]] as const) {
      await nodeFs.mkdir(dirname(join(cacheRoot, relative)), { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(join(cacheRoot, relative), text, { mode: 0o600 });
    }
    expect(await probed()).toMatchObject({ status: "pass", message: "registered" });

    const record = join(home, "codex", "registration.json");
    await nodeFs.writeFile(record, encodeCanonicalJson({ codexHome, treeHash: "f".repeat(64) }));
    expect(await registration()).toMatchObject({ status: "fail" });
    expect((await registration()).message).toMatch(/^stale/u);

    codex.registered = false;
    expect((await registration()).message).toMatch(/^unregistered/u);
    expect(hasBlockingFailure(await runDoctorReport(fixture.context))).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
