import type { BigIntStats } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  decodeCanonicalJson,
  EXIT_CODES,
  hashBytes,
  loadConfig,
  renderInstructionBlock,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  DeveloperOsConfigV1,
  InstallationManifestV2,
  LowerHexSha256,
  ManagedArtifactV2,
  PlannedFileMutation,
} from "@developer-os/core";

import { InstructionRefusal, planInstructionDetach } from "./detach.js";
import type { InstructionDetachInputV1, InstructionDetachPlanV1, InstructionFileSystemV1 } from "./detach.js";
import type { VendorHomesV1 } from "./vendor-homes.js";

const H = "/home/u";
const P = `${H}/.developer-os`;
const C = `${H}/.codex`;
const homes: VendorHomesV1 = {
  userHome: H as CanonicalAbsolutePathV1,
  productHome: P as CanonicalAbsolutePathV1,
  codexHome: C as CanonicalAbsolutePathV1,
};
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);
const sha = (value: Uint8Array | string): LowerHexSha256 =>
  hashBytes(typeof value === "string" ? bytes(value) : value) as LowerHexSha256;

/** A string value of "<dir>" or "<link>" makes that entry a directory or a symlink. */
type Files = Record<string, string | Uint8Array>;
const without = (files: Files, path: string): Files => Object.fromEntries(Object.entries(files).filter(([key]) => key !== path));

type Entry = { readonly type: "file"; readonly bytes: Uint8Array } | { readonly type: "dir" } | { readonly type: "link" };

function memoryFs(entries: Files): InstructionFileSystemV1 & { readonly map: Map<string, Entry> } {
  const map = new Map<string, Entry>();
  for (const [path, value] of Object.entries(entries)) {
    map.set(path, value === "<dir>" ? { type: "dir" } : value === "<link>" ? { type: "link" } : { type: "file", bytes: typeof value === "string" ? bytes(value) : value });
    for (let parent = dirname(path); parent !== "/" && !map.has(parent); parent = dirname(parent)) map.set(parent, { type: "dir" });
  }
  return {
    map,
    lstat: (path) => {
      const entry = map.get(path);
      if (entry === undefined) return Promise.resolve(null);
      return Promise.resolve({
        isFile: () => entry.type === "file",
        isDirectory: () => entry.type === "dir",
        isSymbolicLink: () => entry.type === "link",
      } as unknown as BigIntStats);
    },
    readFile: (path) => {
      const entry = map.get(path);
      return Promise.resolve(entry?.type === "file" ? entry.bytes : null);
    },
    readdir: (path) => {
      if (map.get(path)?.type !== "dir") return Promise.resolve(null);
      return Promise.resolve([...map.keys()].filter((key) => dirname(key) === path).map((key) => key.slice(path.length + 1)));
    },
  };
}

const common = {
  productVersion: "0.0.0",
  source: "release",
  verifiedAt: "2026-09-22T00:00:00Z",
} as const;

function fileRow(owner: "claude" | "codex" | "core", path: string, content: string): ManagedArtifactV2 {
  return {
    ...common, owner, path, kind: "file", existedBefore: false, beforeHash: null, backupRelativePath: null,
    mergeStrategy: "dedicated", verification: { mode: "content", installedHash: sha(content) },
  } as unknown as ManagedArtifactV2;
}

function contentRow(owner: "claude" | "codex", path: string, content: string, category: string, id: string): ManagedArtifactV2 {
  return {
    ...common, owner, path, kind: "instruction", existedBefore: false, beforeHash: null, backupRelativePath: null,
    mergeStrategy: "dedicated", instruction: { category, id, source: "default" },
    verification: { mode: "content", installedHash: sha(content) },
  } as unknown as ManagedArtifactV2;
}

function blockRow(owner: "claude" | "codex", path: string, block: Uint8Array, existedBefore: boolean): ManagedArtifactV2 {
  return {
    ...common, owner, path, kind: "instruction", existedBefore,
    beforeHash: existedBefore ? sha("before") : null,
    backupRelativePath: existedBefore ? "tx/0.bin" : null,
    mergeStrategy: "marked-block",
    instruction: { category: "vendor-file", id: "instructions", source: "default", members: [{ category: "rule", id: "a", source: "default", sha256: sha("a") }] },
    verification: { mode: "block", blockHash: sha(block) },
  } as unknown as ManagedArtifactV2;
}

function directoryRow(owner: "claude" | "codex", path: string): ManagedArtifactV2 {
  return {
    ...common, owner, path, kind: "directory", existedBefore: false, beforeHash: null, backupRelativePath: null,
    mergeStrategy: "dedicated", verification: { mode: "content" },
  } as unknown as ManagedArtifactV2;
}

const config: DeveloperOsConfigV1 = {
  schemaVersion: 1,
  brainPath: `${H}/DeveloperBrain`,
  adapters: { claude: true, codex: true },
  git: { enabled: false },
  automation: { enabled: false },
  telemetry: false,
};

const claudeBlock = renderInstructionBlock({ productHome: P, vendor: "claude", body: `@${P}/claude/instructions/a.md\n` });
const codexBlock = renderInstructionBlock({ productHome: P, vendor: "codex", body: "## a\nrule text\n" });
const concat = (...parts: readonly (string | Uint8Array)[]): Uint8Array =>
  new Uint8Array(parts.flatMap((part) => [...(typeof part === "string" ? bytes(part) : part)]));

const pluginSkill = `${H}/.claude/skills/developer-os/skills/developer-os-capture/SKILL.md`;
const pluginManifest = `${H}/.claude/skills/developer-os/.claude-plugin/plugin.json`;
const rule = `${H}/.claude/rules/developer-os-a.md`;
const claudeMd = `${H}/.claude/CLAUDE.md`;
const agentsMd = `${C}/AGENTS.md`;
const agentToml = `${C}/agents/developer-os-r.toml`;
const importFile = `${P}/claude/instructions/a.md`;
const codexPluginFile = `${P}/codex/plugins/developer-os/.codex-plugin/plugin.json`;
const configFile = `${P}/config.toml`;
const manifestFile = `${P}/installation-manifest.json`;

function installed(): { readonly manifest: InstallationManifestV2; readonly files: Files } {
  const artifacts = [
    fileRow("core", configFile, "config"),
    fileRow("claude", pluginManifest, "{}"),
    fileRow("claude", pluginSkill, "skill"),
    contentRow("claude", rule, "rule", "scoped-rule", "a"),
    contentRow("claude", importFile, "import", "rule", "a"),
    blockRow("claude", claudeMd, claudeBlock, true),
    directoryRow("claude", `${H}/.claude/rules`),
    directoryRow("claude", `${H}/.claude/skills/developer-os`),
    directoryRow("claude", `${H}/.claude/skills/developer-os/.claude-plugin`),
    directoryRow("claude", `${H}/.claude/skills/developer-os/skills`),
    directoryRow("claude", `${H}/.claude/skills/developer-os/skills/developer-os-capture`),
    fileRow("codex", codexPluginFile, "{}"),
    contentRow("codex", agentToml, "toml", "agent", "r"),
    blockRow("codex", agentsMd, codexBlock, false),
    directoryRow("codex", C),
    directoryRow("codex", `${C}/agents`),
  ];
  return {
    manifest: { schemaVersion: 2, productVersion: "0.0.0", installedAt: "2026-09-22T00:00:00Z", artifacts } as unknown as InstallationManifestV2,
    files: {
      [configFile]: "config",
      [pluginManifest]: "{}",
      [pluginSkill]: "skill",
      [rule]: "rule",
      [importFile]: "import",
      [claudeMd]: concat("# mine\n", claudeBlock, "user tail\n"),
      [`${H}/.claude/settings.json`]: "{}",
      [codexPluginFile]: "{}",
      [agentToml]: "toml",
      [agentsMd]: codexBlock,
    },
  };
}

function input(overrides: Partial<InstructionDetachInputV1> & { readonly files?: Files } = {}): InstructionDetachInputV1 {
  const base = installed();
  return {
    vendors: ["claude", "codex"],
    homes,
    manifest: base.manifest,
    manifestHash: sha("manifest"),
    config,
    configHash: sha("config"),
    fs: memoryFs(overrides.files ?? base.files),
    ...overrides,
  };
}

function transaction(plan: InstructionDetachPlanV1): Extract<InstructionDetachPlanV1, { kind: "transaction" }> {
  if (plan.kind !== "transaction") throw new Error("expected a transaction plan");
  return plan;
}

function mutationAt(plan: InstructionDetachPlanV1, path: string): PlannedFileMutation | undefined {
  return transaction(plan).mutations.find((mutation) => mutation.targetPath === path);
}

async function refusal(promise: Promise<unknown>): Promise<InstructionRefusal> {
  const error: unknown = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(InstructionRefusal);
  return error as InstructionRefusal;
}

describe("planInstructionDetach", () => {
  it("removes every content row and plugin-tree file row outside the product home", async () => {
    const plan = transaction(await planInstructionDetach(input()));
    const removes = plan.mutations.filter((mutation) => mutation.operation === "remove").map((mutation) => mutation.targetPath);
    expect(removes.length).toBeGreaterThan(0);
    expect(removes).toEqual(expect.arrayContaining([pluginManifest, pluginSkill, rule, agentToml, agentsMd]));
    for (const mutation of plan.mutations.filter((each) => each.operation === "remove")) {
      expect(mutation.content).toBeNull();
      expect(mutation.expectedBeforeHash).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect(mutationAt(plan, importFile)).toBeUndefined();
    expect(mutationAt(plan, codexPluginFile)).toBeUndefined();
  });

  it("the resulting manifest holds only product-home rows when both vendors detach", async () => {
    const plan = transaction(await planInstructionDetach(input()));
    expect(plan.manifest.artifacts.length).toBeGreaterThan(0);
    for (const artifact of plan.manifest.artifacts) expect(artifact.path.startsWith(`${P}/`)).toBe(true);
    const write = mutationAt(plan, manifestFile);
    expect(write).toMatchObject({ operation: "replace", expectedBeforeHash: sha("manifest") });
    expect(decodeCanonicalJson(write?.content ?? new Uint8Array(), 1_048_576)).toEqual(plan.manifest);
  });

  it("detaches only the named vendor", async () => {
    const plan = transaction(await planInstructionDetach(input({ vendors: ["codex"] })));
    const targets = plan.mutations.map((mutation) => mutation.targetPath);
    expect(targets).toEqual(expect.arrayContaining([agentToml, agentsMd]));
    expect(targets).not.toContain(claudeMd);
    expect(targets).not.toContain(rule);
    expect(plan.manifest.artifacts.some((artifact) => artifact.path === claudeMd)).toBe(true);
    expect(plan.manifest.artifacts.some((artifact) => artifact.owner === "codex" && !artifact.path.startsWith(`${P}/`))).toBe(false);
  });

  it("refuses a drifted managed file with exit 3 before returning any mutation", async () => {
    const files = { ...installed().files, [rule]: "edited by the user" };
    const error = await refusal(planInstructionDetach(input({ files })));
    expect(error.code).toBe(EXIT_CODES.decisionRequired);
    expect(error.paths).toEqual([rule]);
    expect(error.message).not.toContain("edited by the user");
  });

  it("strips a block equal to base from a pre-existing file, keeping bytes outside it", async () => {
    const plan = await planInstructionDetach(input());
    const write = mutationAt(plan, claudeMd);
    const original = installed().files[claudeMd] as Uint8Array;
    expect(write).toMatchObject({ operation: "replace", expectedBeforeHash: sha(original) });
    expect(decoder.decode(write?.content ?? new Uint8Array())).toBe("# mine\nuser tail\n");
  });

  it("never restores the whole-file backup", async () => {
    const plan = transaction(await planInstructionDetach(input()));
    const write = mutationAt(plan, claudeMd);
    expect(write?.content).not.toEqual(bytes("before"));
    expect(plan.mutations.some((mutation) => mutation.targetPath.includes(`${P}/backups`))).toBe(false);
  });

  it("removes a product-created file whose remainder is empty", async () => {
    expect(mutationAt(await planInstructionDetach(input()), agentsMd)).toMatchObject({
      operation: "remove",
      content: null,
      expectedBeforeHash: sha(codexBlock),
    });
  });

  it("replaces a pre-existing file whose remainder is empty with empty bytes rather than removing it", async () => {
    const files = { ...installed().files, [claudeMd]: claudeBlock };
    const write = mutationAt(await planInstructionDetach(input({ files })), claudeMd);
    expect(write).toMatchObject({ operation: "replace" });
    expect(write?.content?.byteLength).toBe(0);
  });

  it("drops a block row with no write when the markers are absent or the file is gone", async () => {
    const files = without({ ...installed().files, [claudeMd]: "# mine only\n" }, agentsMd);
    const plan = transaction(await planInstructionDetach(input({ files })));
    expect(mutationAt(plan, claudeMd)).toBeUndefined();
    expect(mutationAt(plan, agentsMd)).toBeUndefined();
    expect(plan.removed).toEqual(expect.arrayContaining([claudeMd, agentsMd]));
    expect(plan.manifest.artifacts.some((artifact) => artifact.path === claudeMd || artifact.path === agentsMd)).toBe(false);
  });

  it("drops a content row whose file is already gone without a remove", async () => {
    const files = without({ ...installed().files }, agentToml);
    const plan = transaction(await planInstructionDetach(input({ files })));
    expect(mutationAt(plan, agentToml)).toBeUndefined();
    expect(plan.removed).toContain(agentToml);
  });

  it("refuses an edited block with exit 3 and conflict evidence", async () => {
    const edited = concat(
      "# mine\n",
      decoder.decode(claudeBlock).replace("@", "user edit @"),
      "user tail\n",
    );
    const files = { ...installed().files, [claudeMd]: edited };
    const error = await refusal(planInstructionDetach(input({ files })));
    expect(error.reason).toBe("instruction_block_conflict");
    expect(error.name).toBe("InstructionBlockConflictError");
    expect(error.code).toBe(EXIT_CODES.decisionRequired);
    expect(error.paths).toEqual([claudeMd]);
    expect(error.evidence).toMatchObject({
      path: claudeMd,
      baselineHash: sha(claudeBlock),
      baselineBackupRelativePath: "tx/0.bin",
      proposedHash: sha(new Uint8Array(0)),
    });
    expect(error.evidence?.currentHash).not.toBe(sha(claudeBlock));
    expect(error.recovery).toBe(
      `move the edits into ${P}/instructions/claude/, delete the whole block (both markers included), and re-run the command`,
    );
  });

  it("refuses malformed markers with exit 3 and no evidence", async () => {
    const files = { ...installed().files, [agentsMd]: concat(codexBlock, codexBlock) };
    const error = await refusal(planInstructionDetach(input({ files })));
    expect(error.reason).toBe("instruction_block_malformed");
    expect(error.code).toBe(EXIT_CODES.decisionRequired);
    expect(error.evidence).toBeNull();
  });

  it("refuses a symlinked CLAUDE.md or a symlinked parent with exit 5", async () => {
    const linkedFile = await refusal(planInstructionDetach(input({ files: { ...installed().files, [claudeMd]: "<link>" } })));
    expect(linkedFile.reason).toBe("instruction_target_symlinked");
    expect(linkedFile.code).toBe(EXIT_CODES.securityRefusal);
    expect(linkedFile.paths).toEqual([claudeMd]);

    const files = without({ ...installed().files, [`${C}/agents`]: "<link>" }, agentToml);
    const linkedParent = await refusal(planInstructionDetach(input({ files })));
    expect(linkedParent.code).toBe(EXIT_CODES.securityRefusal);
    expect(linkedParent.paths).toEqual([`${C}/agents`]);
  });

  it("removes product-created directories the plan empties, deepest first, and preserves a non-empty one", async () => {
    const files = { ...installed().files, [`${C}/config.toml`]: "user" };
    const plan = transaction(await planInstructionDetach(input({ files })));
    const plugin = `${H}/.claude/skills/developer-os`;
    expect(plan.directories.length).toBeGreaterThan(0);
    expect(new Set(plan.directories)).toEqual(new Set([
      `${plugin}/skills/developer-os-capture`,
      `${plugin}/.claude-plugin`,
      `${plugin}/skills`,
      `${C}/agents`,
      `${H}/.claude/rules`,
      plugin,
    ]));
    for (const [index, path] of plan.directories.entries()) {
      for (const later of plan.directories.slice(index + 1)) expect(later.startsWith(`${path}/`)).toBe(false);
    }
    expect(plan.preserved).toEqual([C]);
    expect(plan.manifest.artifacts.some((artifact) => artifact.kind === "directory" && !artifact.path.startsWith(`${P}/`))).toBe(false);
  });

  it("preserves a product-created directory holding a user file", async () => {
    const extra = `${H}/.claude/skills/developer-os/skills/developer-os-capture/notes.md`;
    const plan = transaction(await planInstructionDetach(input({ files: { ...installed().files, [extra]: "mine" } })));
    expect(plan.preserved).toContain(`${H}/.claude/skills/developer-os/skills/developer-os-capture`);
    expect(plan.preserved).toContain(`${H}/.claude/skills/developer-os`);
    expect(plan.directories).not.toContain(`${H}/.claude/skills/developer-os`);
    expect(mutationAt(plan, extra)).toBeUndefined();
  });

  it("sets adapters.<vendor> to false in the same mutation list, guarded by the config hash", async () => {
    const plan = await planInstructionDetach(input({ vendors: ["claude"] }));
    const write = mutationAt(plan, configFile);
    expect(write).toMatchObject({ operation: "replace", expectedBeforeHash: sha("config") });
    const written = loadConfig(decoder.decode(write?.content ?? new Uint8Array()));
    expect(written.adapters).toEqual({ claude: false, codex: true });
    expect({ ...written, adapters: config.adapters }).toEqual(config);
  });

  it("is a noop when nothing is attached and the adapters are already false", async () => {
    const manifest = { ...installed().manifest, artifacts: installed().manifest.artifacts.filter((artifact) => artifact.path.startsWith(`${P}/`)) };
    const detached = { ...config, adapters: { claude: false, codex: false } };
    expect(await planInstructionDetach(input({ manifest, config: detached }))).toEqual({ kind: "noop" });
    expect(await planInstructionDetach(input({ vendors: [] }))).toEqual({ kind: "noop" });
  });

  it("writes only the config when no vendor row exists but the adapter is still selected", async () => {
    const manifest = { ...installed().manifest, artifacts: installed().manifest.artifacts.filter((artifact) => artifact.path.startsWith(`${P}/`)) };
    const plan = transaction(await planInstructionDetach(input({ manifest })));
    expect(plan.mutations.map((mutation) => mutation.targetPath)).toEqual([join(P, "config.toml")]);
  });
});
