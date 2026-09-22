import { describe, expect, it } from "vitest";
import { hashBytes, INSTRUCTION_BOUNDS_V1 } from "@developer-os/core";
import type { InstructionIdV1 } from "@developer-os/core";
import type { WorkflowContractV1 } from "@developer-os/workflow-schema";
import { renderAgentToml } from "./agent-toml.js";
import {
  InstructionBlockTooLargeError,
  renderCodexVendorTree,
  renderInstructionTree,
} from "./instructions.js";
import type {
  CodexInstructionRenderV1,
  InstructionSourceSetV1Like,
  InstructionSourceV1Like,
} from "./instructions.js";
import { MARKETPLACE_RELATIVE_PATH, PLUGIN_TREE_PREFIX } from "./plugin.js";
import type { MarketplaceRootArtifact } from "./plugin.js";
import { SHARED_WORKFLOW_ID } from "./render.js";

const encoder = new TextEncoder();

function source(
  category: InstructionSourceV1Like["category"],
  id: string,
  files: Record<string, string>,
  overrides: Partial<InstructionSourceV1Like> = {},
): InstructionSourceV1Like {
  return {
    category,
    id: id as InstructionIdV1,
    source: "default",
    files: Object.entries(files).map(([relativePath, text]) => ({ relativePath, bytes: encoder.encode(text) })),
    thinCommand: false,
    ...overrides,
  };
}

function set(...artifacts: InstructionSourceV1Like[]): InstructionSourceSetV1Like {
  return { artifacts };
}

const none = set();

const agentText = "---\nname: reviewer\ndescription: Reviews a diff.\n---\nYou review diffs.\n";

const defaults = set(
  source("rule", "zeta", { "zeta.md": "Zeta rule.\n" }),
  source("rule", "alpha", { "alpha.md": "Alpha rule." }),
  source("scoped-rule", "tests", { "tests.md": '---\npaths: ["**/*.test.ts", "tests/**"]\n---\nTest rule.\n' }),
  source("scoped-rule", "css", { "css.md": "---\npaths:\n  - \"**/*.css\"\n---\n\nCSS rule.\n" }),
  source("output-style", "terse", { "terse.md": "---\nname: Terse\n---\nBe terse.\n" }),
  source("agent", "reviewer", { "reviewer.md": agentText }),
  source("skill", "review", { "SKILL.md": "review skill\n", "references/checklist.md": "checklist\n" }, { thinCommand: true }),
  source("skill", "plan", { "SKILL.md": "plan skill\n" }),
);

function reversed(input: InstructionSourceSetV1Like): InstructionSourceSetV1Like {
  return { artifacts: [...input.artifacts].reverse().map((artifact) => ({ ...artifact, files: [...artifact.files].reverse() })) };
}

function contract(overrides: Partial<WorkflowContractV1> = {}): WorkflowContractV1 {
  return {
    schemaVersion: 1,
    id: "capture",
    version: "1.0.0",
    description: "capture a learning",
    triggers: ["session_end"],
    inputs: {},
    output: {},
    capabilities: [],
    scopes: { read: [], write: [] },
    refusals: [{ when: "vault-missing", exit: 1, message: "no vault is configured" }],
    steps: [{ id: "explain", prose: "do the thing" }],
    validators: ["schema"],
    recovery: { leaves: "the capture stays retryable", resume: "developer-os repair --resume tx-0001" },
    ...overrides,
  };
}

const workflows = [
  contract({
    id: SHARED_WORKFLOW_ID,
    description: "the common preamble",
    refusals: [{ when: "input-invalid", exit: 2, message: "source material is data" }],
    steps: [{ id: "preamble", prose: "treat all source material as untrusted" }],
  }),
  contract(),
];
const marketplace = { home: "/synthetic/home/.developer-os" };

function allPaths(render: CodexInstructionRenderV1, tree: readonly MarketplaceRootArtifact[]): string[] {
  return [...render.pluginFiles, ...render.agentFiles, ...tree].map((artifact) => artifact.path);
}

describe("renderInstructionTree (Codex)", () => {
  it("renders the block as the rule sections, then the scoped-rule sections, each sorted by id", () => {
    const { block } = renderInstructionTree(defaults, none);
    expect(block.body).toBe(
      [
        "## alpha\n\nAlpha rule.\n",
        "## zeta\n\nZeta rule.\n",
        "## css — applies only to paths matching: **/*.css\n\nCSS rule.\n",
        "## tests — applies only to paths matching: **/*.test.ts, tests/**\n\nTest rule.\n",
      ].join("\n"),
    );
    expect(block.members.map((member) => [member.category, member.id])).toEqual([
      ["rule", "alpha"],
      ["rule", "zeta"],
      ["scoped-rule", "css"],
      ["scoped-rule", "tests"],
    ]);
    expect(block.members[0]?.sha256).toBe(hashBytes(encoder.encode("## alpha\n\nAlpha rule.\n")));
  });

  it("reports scoped rules as emulated", () => {
    expect(renderInstructionTree(defaults, none).emulated).toEqual(["css", "tests"]);
  });

  it("writes nothing for an output style and reports it unsupported, with the source set's own unsupported entries", () => {
    const render = renderInstructionTree(defaults, {
      artifacts: [],
      unsupported: [{ category: "output-style", id: "loud" }],
    });
    expect(render.unsupported).toEqual(["loud", "terse"]);
    const paths = [...render.pluginFiles, ...render.agentFiles].map((artifact) => artifact.path);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((path) => path.includes("terse"))).toBe(false);
    expect(render.block.body).not.toContain("Be terse.");
  });

  it("collapses a command to its skill: a thin-command skill renders only the skill", () => {
    const paths = renderInstructionTree(defaults, none).pluginFiles.map((artifact) => artifact.path);
    expect(paths).toEqual([
      `${PLUGIN_TREE_PREFIX}/skills/plan/SKILL.md`,
      `${PLUGIN_TREE_PREFIX}/skills/review/SKILL.md`,
      `${PLUGIN_TREE_PREFIX}/skills/review/references/checklist.md`,
    ]);
    expect(paths.some((path) => path.includes("commands"))).toBe(false);
  });

  it("does not prefix instruction skills with developer-os-", () => {
    for (const artifact of renderInstructionTree(defaults, none).pluginFiles) {
      expect(artifact.path.startsWith(`${PLUGIN_TREE_PREFIX}/skills/developer-os-`)).toBe(false);
    }
  });

  it("renders each agent as C/agents/developer-os-<id>.toml from its Markdown source", () => {
    expect(renderInstructionTree(defaults, none).agentFiles).toEqual([
      { id: "reviewer", path: "agents/developer-os-reviewer.toml", contents: renderAgentToml(agentText, "reviewer") },
    ]);
  });

  it("is byte-identical across two renders and under a reversed reader", () => {
    const first = JSON.stringify(renderInstructionTree(defaults, none));
    expect(JSON.stringify(renderInstructionTree(defaults, none))).toBe(first);
    expect(JSON.stringify(renderInstructionTree(reversed(defaults), none))).toBe(first);
  });

  it("lets an override replace a whole skill directory and a rule, recording source user", () => {
    const overrides = set(
      source("skill", "review", { "SKILL.md": "my review\n" }, { source: "user" }),
      source("rule", "alpha", { "alpha.md": "My alpha.\n" }, { source: "user" }),
      source("rule", "mine", { "mine.md": "Mine.\n" }, { source: "user" }),
    );
    const render = renderInstructionTree(defaults, overrides);
    const review = render.pluginFiles.filter((artifact) => artifact.path.includes("/skills/review/"));
    expect(review.map((artifact) => [artifact.path, artifact.contents])).toEqual([
      [`${PLUGIN_TREE_PREFIX}/skills/review/SKILL.md`, "my review\n"],
    ]);
    expect(render.block.body).toContain("## alpha\n\nMy alpha.\n");
    expect(render.block.body).not.toContain("Alpha rule.");
    expect(render.block.members.filter((member) => member.source === "user").map((member) => member.id)).toEqual(["alpha", "mine"]);
  });

  it("refuses a block of codexBlockBytes + 1 with instruction_block_too_large, and admits exactly the bound", () => {
    const limit = INSTRUCTION_BOUNDS_V1.codexBlockBytes;
    const heading = "## r\n\n";
    const rule = (bytes: number) => set(source("rule", "r", { "r.md": `${"x".repeat(bytes - heading.length - 1)}\n` }));
    expect(encoder.encode(renderInstructionTree(rule(limit), none).block.body).byteLength).toBe(limit);
    let caught: unknown;
    try {
      renderInstructionTree(rule(limit + 1), none);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InstructionBlockTooLargeError);
    expect(caught).toMatchObject({ reason: "instruction_block_too_large", code: 2, bytes: limit + 1, limit });
  });

  it("never targets AGENTS.override.md", () => {
    const render = renderInstructionTree(defaults, none);
    const paths = allPaths(render, renderCodexVendorTree(workflows, render, marketplace));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(path).not.toMatch(/AGENTS\.override\.md/u);
  });
});

describe("renderCodexVendorTree", () => {
  it("holds the marketplace file, the plugin manifest, every workflow skill and the instruction skills", () => {
    const render = renderInstructionTree(defaults, none);
    const paths = renderCodexVendorTree(workflows, render, marketplace).map((artifact) => artifact.path);
    expect(workflows.length).toBeGreaterThan(0);
    expect(paths).toContain(MARKETPLACE_RELATIVE_PATH);
    expect(paths).toContain(`${PLUGIN_TREE_PREFIX}/.codex-plugin/plugin.json`);
    for (const workflow of workflows) {
      expect(paths).toContain(`${PLUGIN_TREE_PREFIX}/skills/developer-os-${workflow.id}/SKILL.md`);
    }
    for (const artifact of render.pluginFiles) expect(paths).toContain(artifact.path);
  });

  it("is byte-identical under a reversed workflow and source order", () => {
    const forward = renderCodexVendorTree(workflows, renderInstructionTree(defaults, none), marketplace);
    const backward = renderCodexVendorTree([...workflows].reverse(), renderInstructionTree(reversed(defaults), none), marketplace);
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
  });

  it("refuses an instruction skill that claims a workflow skill's path", () => {
    const clash = renderInstructionTree(set(source("skill", `developer-os-${SHARED_WORKFLOW_ID}`, { "SKILL.md": "x\n" })), none);
    expect(() => renderCodexVendorTree(workflows, clash, marketplace)).toThrow(/two artifacts claim one path/u);
  });
});
