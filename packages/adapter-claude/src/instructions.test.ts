import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { hashBytes, parseInstructionId } from "@developer-os/core";
import { loadWorkflow } from "@developer-os/workflow-schema";
import type { WorkflowContractV1 } from "@developer-os/workflow-schema";
import {
  InstructionPathNotImportableError,
  renderClaudeVendorTree,
  renderInstructionTree,
} from "./instructions.js";
import type {
  InstructionSourceSetV1Like,
  InstructionSourceV1Like,
} from "./instructions.js";

const P = "/Users/synthetic/.developer-os";
const encoder = new TextEncoder();
const WORKFLOWS = new URL("../../../workflows/", import.meta.url);

function artifact(
  category: InstructionSourceV1Like["category"],
  id: string,
  files: Readonly<Record<string, string>>,
  extra: Partial<InstructionSourceV1Like> = {},
): InstructionSourceV1Like {
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

function set(artifacts: readonly InstructionSourceV1Like[]): InstructionSourceSetV1Like {
  return { vendor: "claude", artifacts, unsupported: [] };
}

const SCOPED = '---\npaths:\n  - "**/*.ts"\n---\n\nPrefer strict types.\n';
const STYLE = "---\nname: Terse\ndescription: short answers\n---\n\nBe terse.\n";
const SKILL = "---\nname: review\ndescription: review a diff\n---\n\nThe full review procedure.\n";

const defaults = set([
  artifact("rule", "workflow", { "workflow.md": "Plan first.\n" }),
  artifact("rule", "communication", { "communication.md": "Be direct.\n" }),
  artifact("scoped-rule", "typescript", { "typescript.md": SCOPED }),
  artifact("output-style", "terse", { "terse.md": STYLE }),
  artifact("agent", "reviewer", { "reviewer.md": "---\nname: reviewer\n---\n\nReview.\n" }),
  artifact("skill", "review", { "SKILL.md": SKILL, "checklist.md": "- one\n" }, { thinCommand: true }),
]);
const none = set([]);

function reversed(input: InstructionSourceSetV1Like): InstructionSourceSetV1Like {
  return {
    ...input,
    artifacts: [...input.artifacts].reverse().map((a) => ({ ...a, files: [...a.files].reverse() })),
  };
}

async function workflows(reverse = false): Promise<readonly WorkflowContractV1[]> {
  const names = (await readdir(WORKFLOWS, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const contracts: WorkflowContractV1[] = [];
  for (const name of reverse ? names.reverse() : names) {
    const text = await readFile(new URL(`${name}/workflow.yaml`, WORKFLOWS), "utf8");
    const result = loadWorkflow({ file: `workflows/${name}/workflow.yaml`, text });
    if (result.contract === null) throw new Error(`workflows/${name} did not validate`);
    contracts.push(result.contract);
  }
  return contracts;
}

describe("renderInstructionTree", () => {
  it("is byte-identical across two renders and under a reversed input order", () => {
    const first = renderInstructionTree(defaults, none, P);
    expect(first.pluginFiles.length).toBeGreaterThan(0);
    expect(renderInstructionTree(defaults, none, P)).toEqual(first);
    expect(renderInstructionTree(reversed(defaults), none, P)).toEqual(first);
  });

  it("places each category at its claude-adapter.md §18 target", () => {
    const render = renderInstructionTree(defaults, none, P);
    expect(render.pluginFiles.map((file) => file.path)).toEqual([
      "agents/reviewer.md",
      "commands/review.md",
      "skills/review/SKILL.md",
      "skills/review/checklist.md",
    ]);
    expect(render.homeFiles.map((file) => `${file.target}/${file.path}`)).toEqual([
      "output-styles/developer-os-terse.md",
      "rules/developer-os-typescript.md",
    ]);
    expect(render.importFiles.map((file) => file.path)).toEqual(["communication.md", "workflow.md"]);
  });

  it("renders a thin command that only invokes its skill, one text rather than two", () => {
    const command = renderInstructionTree(defaults, none, P).pluginFiles.find((file) => file.path === "commands/review.md");
    expect(command?.contents).toContain("developer-os:review");
    expect(command?.contents).not.toContain("The full review procedure.");
  });

  it("emits no command for a skill without thinCommand", () => {
    const plain = set([artifact("skill", "review", { "SKILL.md": SKILL })]);
    const paths = renderInstructionTree(plain, none, P).pluginFiles.map((file) => file.path);
    expect(paths).toEqual(["skills/review/SKILL.md"]);
  });

  it("keeps a scoped rule's paths: frontmatter", () => {
    const rule = renderInstructionTree(defaults, none, P).homeFiles.find((file) => file.category === "scoped-rule");
    expect(rule?.contents).toBe(SCOPED);
  });

  it("keeps an output style's frontmatter name and selects nothing", () => {
    const render = renderInstructionTree(defaults, none, P);
    const style = render.homeFiles.find((file) => file.category === "output-style");
    expect(style?.contents).toBe(STYLE);
    const every = [...render.pluginFiles, ...render.homeFiles, ...render.importFiles];
    expect(every.length).toBeGreaterThan(0);
    for (const file of every) expect(file.path).not.toMatch(/settings/u);
    expect(render.block.body).not.toContain("Terse");
  });

  it("holds one @ import line per rule in the block, sorted by id", () => {
    const { block, importFiles } = renderInstructionTree(defaults, none, P);
    expect(block.body).toBe(
      `@${P}/claude/instructions/communication.md\n@${P}/claude/instructions/workflow.md\n`,
    );
    expect(block.members.map((member) => [member.category, member.id])).toEqual([
      ["rule", "communication"],
      ["rule", "workflow"],
    ]);
    expect(block.members[0]?.sha256).toBe(hashBytes(encoder.encode(`@${P}/claude/instructions/communication.md\n`)));
    expect(importFiles.find((file) => file.id === "workflow")?.contents).toBe("Plan first.\n");
  });

  it("refuses a product home that an @ line cannot import", () => {
    for (const home of ["/Users/synthetic user/.developer-os", "relative/home", "/Users/x/../y", "/Users/x/"]) {
      let caught: unknown;
      try {
        renderInstructionTree(defaults, none, home);
      } catch (error) {
        caught = error;
      }
      expect(caught, home).toBeInstanceOf(InstructionPathNotImportableError);
      expect((caught as InstructionPathNotImportableError).reason).toBe("instruction_path_not_importable");
      expect((caught as InstructionPathNotImportableError).code).toBe(2);
    }
  });

  it("does not prefix instruction skills with developer-os-", () => {
    const paths = renderInstructionTree(defaults, none, P).pluginFiles.map((file) => file.path);
    expect(paths.some((path) => path.startsWith("skills/"))).toBe(true);
    for (const path of paths) expect(path).not.toMatch(/^skills\/developer-os-/u);
  });

  it("lets an override replace a whole skill directory and add a new id", () => {
    const overrides = set([
      artifact("skill", "review", { "SKILL.md": "---\nname: review\n---\n\nMine.\n" }, { source: "user", vendors: ["claude"] }),
      artifact("rule", "extra", { "extra.md": "Mine too.\n" }, { source: "user", vendors: ["claude"] }),
    ]);
    const render = renderInstructionTree(defaults, overrides, P);
    const skill = render.pluginFiles.filter((file) => file.path.startsWith("skills/review/"));
    expect(skill.map((file) => file.path)).toEqual(["skills/review/SKILL.md"]);
    expect(skill[0]?.contents).toContain("Mine.");
    expect(render.pluginFiles.map((file) => file.path)).not.toContain("commands/review.md");
    expect(render.block.members.find((member) => member.id === "extra")?.source).toBe("user");
  });

  it("skips an artifact not offered to claude", () => {
    const codexOnly = set([artifact("agent", "reviewer", { "reviewer.md": "x\n" }, { vendors: ["codex"] })]);
    expect(renderInstructionTree(codexOnly, none, P).pluginFiles).toEqual([]);
  });

  it("refuses the codex source set", () => {
    expect(() => renderInstructionTree({ ...defaults, vendor: "codex" }, none, P)).toThrow(/claude/u);
  });
});

describe("renderClaudeVendorTree", () => {
  it("holds the plugin manifest, every workflow skill and the instruction files", async () => {
    const contracts = await workflows();
    expect(contracts.length).toBeGreaterThan(0);
    const paths = renderClaudeVendorTree(contracts, renderInstructionTree(defaults, none, P)).map((file) => file.path);
    expect(paths).toContain(".claude-plugin/plugin.json");
    for (const contract of contracts) expect(paths).toContain(`skills/developer-os-${contract.id}/SKILL.md`);
    expect(paths).toContain("skills/review/SKILL.md");
    expect(paths).toContain("commands/review.md");
  });

  it("is byte-identical under a reversed workflow and instruction order", async () => {
    const forward = renderClaudeVendorTree(await workflows(), renderInstructionTree(defaults, none, P));
    const backward = renderClaudeVendorTree(await workflows(true), renderInstructionTree(reversed(defaults), none, P));
    expect(backward).toEqual(forward);
  });

  it("refuses an instruction file on a workflow skill's path", async () => {
    const render = renderInstructionTree(defaults, none, P);
    const colliding = {
      ...render,
      pluginFiles: [...render.pluginFiles, { path: "skills/developer-os-capture/SKILL.md", contents: "x\n" }],
    };
    await expect(workflows().then((contracts) => renderClaudeVendorTree(contracts, colliding))).rejects.toThrow(/one path/u);
  });
});
