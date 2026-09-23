import type { BigIntStats } from "node:fs";
import { readdir, readFile } from "node:fs/promises";

import { renderClaudePlugin } from "@developer-os/adapter-claude";
import {
  EXIT_CODES,
  encodeCanonicalJson,
  extractInstructionBlock,
  hashBytes,
  INSTRUCTION_BLOCK_BEGIN,
  loadConfig,
  parseInstructionId,
  parseLowerHexSha256,
  parseStableSemver,
  parseUtcTimestamp,
  serializeConfig,
  validateManifestV2,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  DeveloperOsConfigV1,
  InstallationManifestV2,
  InstructionCategoryV1,
  ManagedArtifactV2,
  VaultFreeRelativePathV1,
} from "@developer-os/core";
import { loadWorkflow } from "@developer-os/workflow-schema";
import type { WorkflowContractV1 } from "@developer-os/workflow-schema";
import { beforeAll, describe, expect, it } from "vitest";

import { createCanonicalPathEvidence, createOwnerPathAdmission } from "../bootstrap/admission.js";
import {
  InstructionRefusal,
  planInstructionAttach,
  UNPROVEN_CLAUDE_CATEGORIES,
} from "./attach.js";
import type { InstructionAttachInputV1, InstructionAttachPlanV1 } from "./attach.js";
import type { InstructionSourceSetV1, InstructionSourceV1 } from "./sources.js";
import type { VendorHomesV1 } from "./vendor-homes.js";

const H = "/synthetic/user";
const P = `${H}/.developer-os`;
const C = `${H}/.codex`;
const homes: VendorHomesV1 = {
  userHome: H as CanonicalAbsolutePathV1,
  productHome: P as CanonicalAbsolutePathV1,
  codexHome: C as CanonicalAbsolutePathV1,
};
const WORKFLOWS = new URL("../../../../workflows/", import.meta.url);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const NONE: ReadonlySet<InstructionCategoryV1> = new Set();
const VERSION = parseStableSemver("0.0.0");
const NOW = parseUtcTimestamp("2026-09-22T00:00:00.000Z");
const EARLIER = parseUtcTimestamp("2026-09-21T00:00:00.000Z");

const CONFIG_TOML = `schemaVersion = 1
brainPath = "/synthetic/user/DeveloperBrain"
telemetry = false

[adapters]
claude = false
codex = false

[git]
enabled = false

[automation]
enabled = false
`;

let workflows: readonly WorkflowContractV1[] = [];

beforeAll(async () => {
  const names = (await readdir(WORKFLOWS, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const contracts: WorkflowContractV1[] = [];
  for (const name of names) {
    const text = await readFile(new URL(`${name}/workflow.yaml`, WORKFLOWS), "utf8");
    const result = loadWorkflow({ file: `workflows/${name}/workflow.yaml`, text });
    if (result.contract === null) throw new Error(`workflows/${name} did not validate`);
    contracts.push(result.contract);
  }
  workflows = contracts;
});

/* ------------------------------------------------------------------ fixture */

type Entry = { readonly kind: "file"; readonly bytes: Uint8Array } | { readonly kind: "dir" } | { readonly kind: "symlink" };

class MemoryFs {
  readonly entries = new Map<string, Entry>();

  constructor() {
    for (const dir of ["/synthetic", H, P, `${P}/backups`]) this.dir(dir);
  }

  dir(path: string): void {
    this.entries.set(path, { kind: "dir" });
  }

  /** Missing parents are created, as a real write would need them. */
  file(path: string, text: string | Uint8Array): void {
    const parts = path.split("/");
    for (let depth = 2; depth < parts.length; depth += 1) {
      const parent = parts.slice(0, depth).join("/");
      if (!this.entries.has(parent)) this.dir(parent);
    }
    this.entries.set(path, { kind: "file", bytes: typeof text === "string" ? encoder.encode(text) : text });
  }

  link(path: string): void {
    this.entries.set(path, { kind: "symlink" });
  }

  text(path: string): string | null {
    const entry = this.entries.get(path);
    return entry?.kind === "file" ? decoder.decode(entry.bytes) : null;
  }

  readonly port: InstructionAttachInputV1["fs"] = {
    lstat: (path) => {
      const entry = this.entries.get(path);
      if (entry === undefined) return Promise.resolve(null);
      return Promise.resolve({
        isFile: () => entry.kind === "file",
        isDirectory: () => entry.kind === "dir",
        isSymbolicLink: () => entry.kind === "symlink",
      } as unknown as BigIntStats);
    },
    readFile: (path) => {
      const entry = this.entries.get(path);
      return Promise.resolve(entry?.kind === "file" ? entry.bytes : null);
    },
  };
}

function artifact(category: InstructionSourceV1["category"], id: string, files: Readonly<Record<string, string>>, extra: Partial<InstructionSourceV1> = {}): InstructionSourceV1 {
  return {
    category,
    id: parseInstructionId(id),
    source: "default",
    files: Object.entries(files).map(([relativePath, text]) => ({ relativePath, bytes: encoder.encode(text) })),
    thinCommand: false,
    vendors: ["claude", "codex"],
    ...extra,
  };
}

const SCOPED = '---\npaths:\n  - "**/*.ts"\n---\n\nPrefer strict types.\n';
const STYLE = "---\nname: Terse\ndescription: short answers\n---\n\nBe terse.\n";
const SKILL = "---\nname: review\ndescription: review a diff\n---\n\nThe full review procedure.\n";
const AGENT = "---\nname: reviewer\ndescription: reviews code\n---\n\nReview.\n";

function artifacts(rule = "Be direct.\n", skillFiles: Readonly<Record<string, string>> = { "SKILL.md": SKILL, "checklist.md": "- one\n" }): InstructionSourceV1[] {
  return [
    artifact("agent", "reviewer", { "reviewer.md": AGENT }),
    artifact("output-style", "terse", { "terse.md": STYLE }),
    artifact("rule", "communication", { "communication.md": rule }),
    artifact("scoped-rule", "typescript", { "typescript.md": SCOPED }),
    artifact("skill", "code-review", skillFiles, { thinCommand: true }),
  ];
}

function sources(list: readonly InstructionSourceV1[] = artifacts()): ReadonlyMap<"claude" | "codex", InstructionSourceSetV1> {
  return new Map([
    ["claude", { vendor: "claude", artifacts: list, unsupported: [] }],
    ["codex", { vendor: "codex", artifacts: list, unsupported: [] }],
  ]);
}

const HASH_A = parseLowerHexSha256("a".repeat(64));
const HASH_B = parseLowerHexSha256("b".repeat(64));

function row(path: string, owner: ManagedArtifactV2["owner"], schemaId: "developer-os-config-v1" | "codex-registration-v1", hash: typeof HASH_A): ManagedArtifactV2 {
  return {
    owner,
    path: path as CanonicalAbsolutePathV1,
    productVersion: VERSION,
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    source: "generated/fixture" as VaultFreeRelativePathV1,
    mergeStrategy: "dedicated",
    verifiedAt: EARLIER,
    kind: "file",
    verification: { mode: "schema", schemaId, installedHash: hash },
  };
}

const CONFIG_ROW = row(`${P}/config.toml`, "core", "developer-os-config-v1", HASH_A);
const REGISTRATION_ROW = row(`${P}/codex/registration.json`, "codex", "codex-registration-v1", HASH_B);

interface State {
  readonly fs: MemoryFs;
  manifest: InstallationManifestV2;
  config: DeveloperOsConfigV1;
}

function freshState(): State {
  return {
    fs: new MemoryFs(),
    manifest: { schemaVersion: 2, productVersion: VERSION, installedAt: EARLIER, artifacts: [CONFIG_ROW, REGISTRATION_ROW] },
    config: loadConfig(CONFIG_TOML),
  };
}

const HOOK_EXECUTABLE = { node: "/opt/synthetic/node/bin/node", entrypoint: `${P}/bin/developer-os.mjs` } as const;

function input(state: State, overrides: Partial<InstructionAttachInputV1> = {}): InstructionAttachInputV1 {
  return {
    vendors: ["claude", "codex"],
    homes,
    manifest: state.manifest,
    manifestHash: parseLowerHexSha256(hashBytes(encoder.encode(encodeCanonicalJson(state.manifest as never)))),
    config: state.config,
    configHash: parseLowerHexSha256(hashBytes(encoder.encode(serializeConfig(state.config)))),
    sources: sources(),
    workflows,
    productVersion: VERSION,
    now: NOW,
    fs: state.fs.port,
    redactDiagnostic: (text) => text.replaceAll("synthetic-secret-token", "[REDACTED]"),
    heldBackClaudeCategories: NONE,
    hookExecutable: HOOK_EXECUTABLE,
    ...overrides,
  };
}

type Transaction = Extract<InstructionAttachPlanV1, { readonly kind: "transaction" }>;

function transaction(plan: InstructionAttachPlanV1): Transaction {
  expect(plan.kind).toBe("transaction");
  return plan as Transaction;
}

/** Applies a plan the way Task 18's apply will: parents first, then the mutations. */
function apply(state: State, plan: Transaction): void {
  for (const dir of plan.directories) state.fs.dir(dir);
  for (const mutation of plan.mutations) {
    if (mutation.operation === "remove") state.fs.entries.delete(mutation.targetPath);
    else if (mutation.content !== null) state.fs.file(mutation.targetPath, mutation.content);
  }
  state.manifest = plan.manifest;
  const config = state.fs.text(`${P}/config.toml`);
  if (config !== null) state.config = loadConfig(config);
}

async function installed(overrides: Partial<InstructionAttachInputV1> = {}): Promise<State> {
  const state = freshState();
  apply(state, transaction(await planInstructionAttach(input(state, overrides))));
  return state;
}

async function refusal(promise: Promise<unknown>, reason: string, code: number): Promise<InstructionRefusal> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(InstructionRefusal);
  const refused = error as InstructionRefusal;
  expect(refused.reason).toBe(reason);
  expect(refused.code).toBe(code);
  return refused;
}

function mutationAt(plan: Transaction, path: string) {
  return plan.mutations.find((mutation) => mutation.targetPath === path);
}

function rowAt(manifest: InstallationManifestV2, path: string): ManagedArtifactV2 | undefined {
  return manifest.artifacts.find((artifact) => artifact.path === path);
}

function blockRowAt(manifest: InstallationManifestV2, path: string) {
  const found = rowAt(manifest, path);
  if (found?.verification.mode !== "block") throw new Error(`no block row at ${path}`);
  return found as Extract<ManagedArtifactV2, { readonly verification: { readonly mode: "block" } }>;
}

const admission = {
  evidence: createCanonicalPathEvidence(),
  sourceRoot: "/synthetic/release" as CanonicalAbsolutePathV1,
  backupRoot: `${P}/backups` as CanonicalAbsolutePathV1,
  admitOwnerPath: createOwnerPathAdmission({ kind: "confined", roots: [P as CanonicalAbsolutePathV1], vendors: homes }),
};

const CLAUDE_MD = `${H}/.claude/CLAUDE.md`;
const AGENTS_MD = `${C}/AGENTS.md`;
const PLUGIN = `${H}/.claude/skills/developer-os`;

/* ------------------------------------------------------------------ tests */

describe("planInstructionAttach: a fresh attach", () => {
  it("adds the Claude hooks file to the plugin tree, naming the node and entrypoint it was given", async () => {
    const plan = transaction(await planInstructionAttach(input(freshState())));
    const write = mutationAt(plan, `${PLUGIN}/hooks/hooks.json`);
    expect(write?.operation).toBe("create");
    const text = decoder.decode(write?.content ?? new Uint8Array());
    expect(text).toContain(`"${HOOK_EXECUTABLE.node} ${HOOK_EXECUTABLE.entrypoint} guard command --vendor claude"`);
    expect(rowAt(plan.manifest, `${PLUGIN}/hooks/hooks.json`)).toMatchObject({ owner: "claude", kind: "file" });
  });

  it("adds the Codex hooks file and points the plugin manifest at it (A13 Task 15)", async () => {
    const plan = transaction(await planInstructionAttach(input(freshState())));
    const codexPlugin = `${P}/codex/plugins/developer-os`;
    const write = mutationAt(plan, `${codexPlugin}/hooks/hooks.json`);
    expect(write?.operation).toBe("create");
    const text = decoder.decode(write?.content ?? new Uint8Array());
    expect(text).toContain(`"${HOOK_EXECUTABLE.node} ${HOOK_EXECUTABLE.entrypoint} guard path --vendor codex"`);
    const manifest = mutationAt(plan, `${codexPlugin}/.codex-plugin/plugin.json`);
    expect(JSON.parse(decoder.decode(manifest?.content ?? new Uint8Array()))).toMatchObject({ hooks: "./hooks/hooks.json" });
    expect(rowAt(plan.manifest, `${codexPlugin}/hooks/hooks.json`)).toMatchObject({ owner: "codex", kind: "file" });
  });

  it("plans one transaction whose manifest admits under the closed vendor authorization", async () => {
    const plan = transaction(await planInstructionAttach(input(freshState())));
    expect(plan.mutations.length).toBeGreaterThan(0);
    expect(validateManifestV2(JSON.parse(encodeCanonicalJson(plan.manifest as never)) as unknown, admission)).toStrictEqual(plan.manifest);
    for (const mutation of plan.mutations.filter((entry) => entry.operation === "create")) {
      expect(mutation).not.toHaveProperty("expectedBeforeHash");
    }
  });

  it("rewrites the manifest with one replace guarded by the manifest hash, last", async () => {
    const state = freshState();
    const request = input(state);
    const plan = transaction(await planInstructionAttach(request));
    const manifestWrites = plan.mutations.filter((mutation) => mutation.targetPath === `${P}/installation-manifest.json`);
    expect(manifestWrites).toStrictEqual([{
      targetPath: `${P}/installation-manifest.json`,
      operation: "replace",
      content: encoder.encode(encodeCanonicalJson(plan.manifest as never)),
      expectedBeforeHash: request.manifestHash,
    }]);
    expect(plan.mutations.at(-1)?.targetPath).toBe(`${P}/installation-manifest.json`);
  });

  it("writes the adapters.* selection in the same mutation list and leaves the config row exactly as config set does", async () => {
    const state = freshState();
    const request = input(state, { vendors: ["codex"] });
    const plan = transaction(await planInstructionAttach(request));
    const write = mutationAt(plan, `${P}/config.toml`);
    expect(write).toMatchObject({ operation: "replace", expectedBeforeHash: request.configHash });
    const written = loadConfig(decoder.decode(write?.content ?? new Uint8Array()));
    expect(written.adapters).toStrictEqual({ claude: false, codex: true });
    expect(serializeConfig(written)).toBe(serializeConfig({ ...state.config, adapters: { claude: false, codex: true } }));
    expect(rowAt(plan.manifest, `${P}/config.toml`)).toBe(CONFIG_ROW);
    expect(rowAt(plan.manifest, `${P}/codex/registration.json`)).toBe(REGISTRATION_ROW);
  });

  it("does not rewrite a config that already holds the selection", async () => {
    const state = freshState();
    state.config = { ...state.config, adapters: { claude: true, codex: true } };
    const plan = transaction(await planInstructionAttach(input(state)));
    expect(mutationAt(plan, `${P}/config.toml`)).toBeUndefined();
  });

  it("records missing parents as exact directory rows and never an existing parent", async () => {
    const plan = transaction(await planInstructionAttach(input(freshState())));
    const expected = [
      `${H}/.claude`, `${H}/.claude/skills`, PLUGIN, `${H}/.claude/rules`, `${H}/.claude/output-styles`,
      C, `${C}/agents`, `${P}/claude`, `${P}/claude/instructions`, `${P}/codex`,
    ];
    expect(expected.length).toBeGreaterThan(0);
    for (const path of expected) {
      expect(plan.directories).toContain(path);
      expect(rowAt(plan.manifest, path)).toMatchObject({ kind: "directory", existedBefore: false, beforeHash: null, backupRelativePath: null, verification: { mode: "content" } });
    }
    for (const existing of ["/synthetic", H, P, `${P}/backups`]) {
      expect(plan.directories).not.toContain(existing);
      expect(rowAt(plan.manifest, existing)).toBeUndefined();
    }
    const depth = (path: string): number => path.split("/").length;
    const depths = plan.directories.map(depth);
    expect(depths).toStrictEqual([...depths].sort((left, right) => left - right));
    expect(plan.manifest.artifacts.filter((artifact) => artifact.kind === "directory").map((artifact) => artifact.path).sort())
      .toStrictEqual([...plan.directories].sort());
  });

  it("keeps a parent that already exists out of the rows", async () => {
    const state = freshState();
    state.fs.dir(`${H}/.claude`);
    state.fs.dir(C);
    const plan = transaction(await planInstructionAttach(input(state)));
    expect(plan.directories).not.toContain(`${H}/.claude`);
    expect(plan.directories).not.toContain(C);
    expect(rowAt(plan.manifest, `${H}/.claude`)).toBeUndefined();
    expect(plan.directories).toContain(`${H}/.claude/skills`);
  });

  it("always includes the plugin manifest and every workflow skill in the Claude plugin tree", async () => {
    const plan = transaction(await planInstructionAttach(input(freshState())));
    const workflowPaths = renderClaudePlugin(workflows).map((file) => `${PLUGIN}/${file.path}`);
    expect(workflowPaths.length).toBeGreaterThan(0);
    expect(workflowPaths).toContain(`${PLUGIN}/.claude-plugin/plugin.json`);
    for (const path of workflowPaths) {
      expect(rowAt(plan.manifest, path)).toMatchObject({ owner: "claude", kind: "file", verification: { mode: "content" } });
      expect(mutationAt(plan, path)?.operation).toBe("create");
    }
  });

  it("records instruction rows with their identity and the report names each artifact", async () => {
    const plan = transaction(await planInstructionAttach(input(freshState())));
    expect(rowAt(plan.manifest, `${PLUGIN}/skills/code-review/SKILL.md`)).toMatchObject({ kind: "instruction", instruction: { category: "skill", id: "code-review", source: "default" }, mergeStrategy: "dedicated", existedBefore: false });
    expect(rowAt(plan.manifest, `${PLUGIN}/skills/code-review/checklist.md`)).toMatchObject({ instruction: { category: "skill", id: "code-review" } });
    expect(rowAt(plan.manifest, `${PLUGIN}/commands/code-review.md`)).toMatchObject({ instruction: { category: "command", id: "code-review" } });
    expect(rowAt(plan.manifest, `${PLUGIN}/agents/reviewer.md`)).toMatchObject({ instruction: { category: "agent", id: "reviewer" } });
    expect(rowAt(plan.manifest, `${H}/.claude/rules/developer-os-typescript.md`)).toMatchObject({ instruction: { category: "scoped-rule", id: "typescript" } });
    expect(rowAt(plan.manifest, `${H}/.claude/output-styles/developer-os-terse.md`)).toMatchObject({ instruction: { category: "output-style", id: "terse" } });
    expect(rowAt(plan.manifest, `${P}/claude/instructions/communication.md`)).toMatchObject({ owner: "claude", instruction: { category: "rule", id: "communication" } });
    expect(rowAt(plan.manifest, `${C}/agents/developer-os-reviewer.toml`)).toMatchObject({ owner: "codex", instruction: { category: "agent", id: "reviewer" } });
    expect(rowAt(plan.manifest, `${P}/codex/plugins/developer-os/skills/code-review/SKILL.md`)).toMatchObject({ owner: "codex", instruction: { category: "skill", id: "code-review" } });
    expect(plan.report.installed).toStrictEqual(expect.arrayContaining([
      "claude agent/reviewer", "claude command/code-review", "claude output-style/terse", "claude rule/communication",
      "claude scoped-rule/typescript", "claude skill/code-review", "claude vendor-file/claude-md",
      "codex agent/reviewer", "codex skill/code-review", "codex vendor-file/agents-md",
    ]));
    expect(plan.report.emulated).toStrictEqual(["codex scoped-rule/typescript"]);
    expect(plan.report.unsupported).toStrictEqual(["codex output-style/terse"]);
    expect(plan.report.heldBack).toStrictEqual([]);
  });

  it("creates a missing vendor file holding only the block, with a product-created block row", async () => {
    const plan = transaction(await planInstructionAttach(input(freshState())));
    const write = mutationAt(plan, CLAUDE_MD);
    expect(write?.operation).toBe("create");
    const bytes = write?.content ?? new Uint8Array();
    const extraction = extractInstructionBlock(bytes);
    expect(extraction.kind).toBe("present");
    expect(extraction.kind === "present" && extraction.start === 0 && extraction.end === bytes.byteLength).toBe(true);
    expect(decoder.decode(bytes)).toContain(`@${P}/claude/instructions/communication.md\n`);
    expect(blockRowAt(plan.manifest, CLAUDE_MD)).toMatchObject({
      owner: "claude", mergeStrategy: "marked-block", existedBefore: false, beforeHash: null, backupRelativePath: null,
      instruction: { category: "vendor-file", id: "claude-md", source: "default", members: [{ category: "rule", id: "communication", source: "default" }] },
      verification: { mode: "block", blockHash: hashBytes(bytes) },
    });
    const agents = blockRowAt(plan.manifest, AGENTS_MD);
    expect(agents.instruction.members.map((member) => `${member.category}/${member.id}`)).toStrictEqual(["rule/communication", "scoped-rule/typescript"]);
  });

  it("appends the block to a pre-existing CLAUDE.md, recording existedBefore and a whole-file backup", async () => {
    const state = freshState();
    state.fs.dir(`${H}/.claude`);
    const original = encoder.encode("# my rules\nno final newline");
    state.fs.file(CLAUDE_MD, original);
    const plan = transaction(await planInstructionAttach(input(state)));
    const beforeHash = hashBytes(original);
    const write = mutationAt(plan, CLAUDE_MD);
    expect(write).toMatchObject({ operation: "replace", expectedBeforeHash: beforeHash });
    const next = write?.content ?? new Uint8Array();
    expect(decoder.decode(next.subarray(0, original.byteLength + 1))).toBe("# my rules\nno final newline\n");
    expect(decoder.decode(next.subarray(original.byteLength + 1)).startsWith(INSTRUCTION_BLOCK_BEGIN)).toBe(true);
    const backup = `instruction-claude-${beforeHash}`;
    expect(mutationAt(plan, `${P}/backups/${backup}`)).toStrictEqual({ targetPath: `${P}/backups/${backup}`, operation: "create", content: original });
    expect(blockRowAt(plan.manifest, CLAUDE_MD)).toMatchObject({ existedBefore: true, beforeHash, backupRelativePath: backup });
  });

  it("reuses an identical backup an earlier uninstall left behind, and refuses a different one", async () => {
    const state = freshState();
    state.fs.dir(`${H}/.claude`);
    const original = encoder.encode("# mine\n");
    state.fs.file(CLAUDE_MD, original);
    const backup = `${P}/backups/instruction-claude-${hashBytes(original)}`;
    state.fs.file(backup, original);
    const plan = transaction(await planInstructionAttach(input(state)));
    expect(mutationAt(plan, backup)).toBeUndefined();
    state.fs.file(backup, "tampered\n");
    await refusal(planInstructionAttach(input(state)), "instruction_target_occupied", EXIT_CODES.decisionRequired);
  });
});

describe("planInstructionAttach: target refusals", () => {
  it("refuses an unmanaged file at a content target with instruction_target_occupied, exit 3", async () => {
    for (const path of [`${H}/.claude/rules/developer-os-typescript.md`, `${PLUGIN}/skills/code-review/SKILL.md`, `${C}/agents/developer-os-reviewer.toml`]) {
      const state = freshState();
      state.fs.file(path, "someone else's file\n");
      const refused = await refusal(planInstructionAttach(input(state)), "instruction_target_occupied", EXIT_CODES.decisionRequired);
      expect(refused.paths).toStrictEqual([path]);
      // failureFrom publishes kindOf(name): the name must spell the reason code.
      expect(refused.name).toBe("InstructionTargetOccupiedError");
      expect(refused.message).not.toContain("someone else's file");
    }
  });

  it("refuses a symlink at any component of a target, including linked vendor files, with exit 5", async () => {
    const cases = [`${H}/.claude`, `${H}/.claude/skills`, CLAUDE_MD, AGENTS_MD, C, `${C}/agents`];
    expect(cases.length).toBeGreaterThan(0);
    for (const link of cases) {
      const state = freshState();
      const parts = link.split("/");
      for (let depth = 2; depth < parts.length; depth += 1) state.fs.dir(parts.slice(0, depth).join("/"));
      state.fs.link(link);
      const refused = await refusal(planInstructionAttach(input(state)), "instruction_target_symlinked", EXIT_CODES.securityRefusal);
      expect(refused.paths).toStrictEqual([link]);
      expect(refused.recovery).toContain("regular file");
    }
  });

  it("refuses a drifted managed file with exit 3 and writes nothing", async () => {
    const state = await installed();
    const path = `${H}/.claude/rules/developer-os-typescript.md`;
    state.fs.file(path, "hand edit\n");
    const refused = await refusal(planInstructionAttach(input(state)), "instruction_target_drifted", EXIT_CODES.decisionRequired);
    expect(refused.paths).toStrictEqual([path]);
  });
});

describe("planInstructionAttach: the §5.2 merge", () => {
  it("returns noop for an unchanged re-plan", async () => {
    const state = await installed();
    expect(await planInstructionAttach(input(state))).toStrictEqual({ kind: "noop" });
  });

  it("writes proposed when current equals base, guarded by the whole-file hash, and copies outside bytes", async () => {
    const state = await installed();
    const before = `# user top\n${state.fs.text(AGENTS_MD) ?? ""}user bottom\n`;
    state.fs.file(AGENTS_MD, before);
    // User bytes around the block are never drift.
    expect(await planInstructionAttach(input(state))).toStrictEqual({ kind: "noop" });
    const plan = transaction(await planInstructionAttach(input(state, { sources: sources(artifacts("Be very direct.\n")) })));
    const write = mutationAt(plan, AGENTS_MD);
    expect(write).toMatchObject({ operation: "replace", expectedBeforeHash: hashBytes(encoder.encode(before)) });
    const after = decoder.decode(write?.content ?? new Uint8Array());
    expect(after.startsWith("# user top\n")).toBe(true);
    expect(after.endsWith("user bottom\n")).toBe(true);
    expect(after).toContain("Be very direct.");
    expect(plan.report.installed).toContain("codex vendor-file/agents-md");
  });

  it("does not write when current already equals proposed, and refreshes the row", async () => {
    const state = await installed();
    const next = transaction(await planInstructionAttach(input(state, { sources: sources(artifacts("Be very direct.\n")) })));
    const proposed = mutationAt(next, AGENTS_MD)?.content ?? new Uint8Array();
    state.fs.file(AGENTS_MD, proposed);
    const plan = transaction(await planInstructionAttach(input(state, { sources: sources(artifacts("Be very direct.\n")) })));
    expect(mutationAt(plan, AGENTS_MD)).toBeUndefined();
    expect(blockRowAt(plan.manifest, AGENTS_MD).verification.blockHash).toBe(hashBytes(proposed));
    expect(plan.report.unchanged).toContain("codex vendor-file/agents-md");
  });

  it("re-inserts the block when the user deleted it, reported restored", async () => {
    const state = await installed();
    state.fs.file(AGENTS_MD, "# only mine\n");
    const plan = transaction(await planInstructionAttach(input(state)));
    const write = mutationAt(plan, AGENTS_MD);
    expect(write?.operation).toBe("replace");
    expect(decoder.decode(write?.content ?? new Uint8Array()).startsWith(`# only mine\n${INSTRUCTION_BLOCK_BEGIN}\n`)).toBe(true);
    expect(plan.report.restored).toContain("codex vendor-file/agents-md");
  });

  it("re-creates a deleted vendor file, reported restored", async () => {
    const state = await installed();
    state.fs.entries.delete(AGENTS_MD);
    const plan = transaction(await planInstructionAttach(input(state)));
    expect(mutationAt(plan, AGENTS_MD)?.operation).toBe("create");
    expect(plan.report.restored).toContain("codex vendor-file/agents-md");
  });

  it("refuses malformed markers with instruction_block_malformed, exit 3", async () => {
    const state = await installed();
    state.fs.file(AGENTS_MD, `${state.fs.text(AGENTS_MD) ?? ""}${INSTRUCTION_BLOCK_BEGIN}\n`);
    const refused = await refusal(planInstructionAttach(input(state)), "instruction_block_malformed", EXIT_CODES.decisionRequired);
    expect(refused.evidence).toBeNull();
    expect(refused.recovery).toBe(`move the edits into ${P}/instructions/codex/, delete the whole block (both markers included), and re-run the command`);
  });

  it("refuses an edited block with instruction_block_conflict, exit 3, carrying ConflictEvidence and the recovery text", async () => {
    const state = await installed();
    const base = blockRowAt(state.manifest, CLAUDE_MD).verification.blockHash;
    const edited = (state.fs.text(CLAUDE_MD) ?? "").replace("<!-- developer-os:end v1 -->", "synthetic-secret-token\n<!-- developer-os:end v1 -->");
    state.fs.file(CLAUDE_MD, edited);
    const refused = await refusal(planInstructionAttach(input(state)), "instruction_block_conflict", EXIT_CODES.decisionRequired);
    expect(refused.paths).toStrictEqual([CLAUDE_MD]);
    expect(refused.recovery).toBe(`move the edits into ${P}/instructions/claude/, delete the whole block (both markers included), and re-run the command`);
    const extraction = extractInstructionBlock(encoder.encode(edited));
    expect(refused.evidence).toMatchObject({
      path: CLAUDE_MD,
      baselineHash: base,
      baselineBackupRelativePath: null,
      currentHash: extraction.kind === "present" ? hashBytes(extraction.block) : "",
      proposedHash: base,
    });
    expect(refused.evidence?.diff).toContain("[REDACTED]");
    expect(refused.evidence?.diff).not.toContain("synthetic-secret-token");
    expect(refused.message).not.toContain("synthetic-secret-token");
  });
});

describe("planInstructionAttach: held-back Claude categories (invariant 3)", () => {
  it("pins the initial value", () => {
    expect([...UNPROVEN_CLAUDE_CATEGORIES].sort()).toStrictEqual(["output-style", "rule", "scoped-rule"]);
  });

  it("filters the unproven Claude categories out by default and reports them held back", async () => {
    const { heldBackClaudeCategories, ...request } = input(freshState());
    expect(heldBackClaudeCategories).toBe(NONE);
    const plan = transaction(await planInstructionAttach(request));
    expect(plan.report.heldBack).toStrictEqual(["claude output-style/terse", "claude rule/communication", "claude scoped-rule/typescript"]);
    expect(mutationAt(plan, CLAUDE_MD)).toBeUndefined();
    expect(rowAt(plan.manifest, CLAUDE_MD)).toBeUndefined();
    const claudeHome = plan.mutations.filter((mutation) => mutation.targetPath.startsWith(`${H}/.claude/rules`)
      || mutation.targetPath.startsWith(`${H}/.claude/output-styles`) || mutation.targetPath.startsWith(`${P}/claude/`));
    expect(claudeHome).toStrictEqual([]);
    expect(plan.directories).not.toContain(`${H}/.claude/rules`);
    expect(mutationAt(plan, `${PLUGIN}/skills/code-review/SKILL.md`)?.operation).toBe("create");
    // Codex is not gated: its block still carries the rule.
    expect(mutationAt(plan, AGENTS_MD)?.operation).toBe("create");
  });

  it("installs every Claude category when the held-back set is empty", async () => {
    const plan = transaction(await planInstructionAttach(input(freshState(), { heldBackClaudeCategories: NONE })));
    expect(plan.report.heldBack).toStrictEqual([]);
    expect(mutationAt(plan, CLAUDE_MD)?.operation).toBe("create");
    expect(mutationAt(plan, `${H}/.claude/rules/developer-os-typescript.md`)?.operation).toBe("create");
    expect(mutationAt(plan, `${H}/.claude/output-styles/developer-os-terse.md`)?.operation).toBe("create");
    expect(mutationAt(plan, `${P}/claude/instructions/communication.md`)?.operation).toBe("create");
  });
});

describe("planInstructionAttach: reconcile", () => {
  it("removes a file an override no longer renders, guarded by its recorded hash", async () => {
    const state = await installed();
    const path = `${PLUGIN}/skills/code-review/checklist.md`;
    const recorded = rowAt(state.manifest, path);
    expect(recorded).toBeDefined();
    const plan = transaction(await planInstructionAttach(input(state, { sources: sources(artifacts(undefined, { "SKILL.md": SKILL })) })));
    expect(mutationAt(plan, path)).toStrictEqual({
      targetPath: path,
      operation: "remove",
      content: null,
      expectedBeforeHash: recorded?.verification.mode === "content" && "installedHash" in recorded.verification ? recorded.verification.installedHash : "",
    });
    expect(rowAt(plan.manifest, path)).toBeUndefined();
    expect(rowAt(plan.manifest, `${P}/codex/registration.json`)).toBe(REGISTRATION_ROW);
  });

  it("replaces a changed file under its recorded hash", async () => {
    const state = await installed();
    const path = `${PLUGIN}/skills/code-review/SKILL.md`;
    const recorded = rowAt(state.manifest, path);
    const plan = transaction(await planInstructionAttach(input(state, { sources: sources(artifacts(undefined, { "SKILL.md": `${SKILL}More.\n`, "checklist.md": "- one\n" })) })));
    expect(mutationAt(plan, path)).toMatchObject({
      operation: "replace",
      expectedBeforeHash: recorded !== undefined && "installedHash" in recorded.verification ? recorded.verification.installedHash : "",
    });
    expect(plan.report.installed).toContain("claude skill/code-review");
  });
});
