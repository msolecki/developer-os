import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { InstructionSourceInvalidError } from "@developer-os/core";
import { AGENT_TOML_KEYS, renderAgentToml } from "./agent-toml.js";

/**
 * `smol-toml` is `@developer-os/core`'s dependency, not this package's; resolving it from core's
 * manifest reads it without declaring (and installing) a second copy here.
 */
const { parse } = createRequire(new URL("../../core/package.json", import.meta.url))("smol-toml") as {
  parse: (text: string) => Record<string, unknown>;
};

const agent = [
  "---",
  "name: reviewer",
  "description: Reviews a diff for correctness.",
  "tools: Read, Grep",
  "model: sonnet",
  "---",
  "",
  "You review diffs.",
  "Report findings only.",
  "",
].join("\n");

describe("renderAgentToml", () => {
  it("emits exactly the key set Codex 0.155.1 was observed to load, and round-trips through smol-toml", () => {
    const parsed = parse(renderAgentToml(agent, "reviewer"));
    expect(AGENT_TOML_KEYS.length).toBeGreaterThan(0);
    expect(Object.keys(parsed).sort()).toEqual([...AGENT_TOML_KEYS].sort());
    expect(parsed).toEqual({
      name: "developer-os-reviewer",
      description: "Reviews a diff for correctness.",
      developer_instructions: "You review diffs.\nReport findings only.\n",
    });
  });

  it("carries quotes, backslashes, tabs, DEL and non-ASCII through TOML escaping unchanged", () => {
    const body = 'Say "hi" \\ not \t tabs \u007f del — zażółć 🚀\n';
    const source = ["---", "description: 'It''s a \"probe\"'", "---", body].join("\n");
    const parsed = parse(renderAgentToml(source, "probe"));
    expect(parsed.description).toBe('It\'s a "probe"');
    expect(parsed.developer_instructions).toBe(body);
  });

  it("is byte-identical across two renders", () => {
    expect(renderAgentToml(agent, "reviewer")).toBe(renderAgentToml(agent, "reviewer"));
  });

  it.each([
    { name: "no frontmatter", source: "You review diffs.\n", line: 1 },
    { name: "an unterminated frontmatter", source: "---\ndescription: x\n", line: 1 },
    { name: "no description", source: "---\nname: x\n---\nbody\n", line: 1 },
    { name: "a block-scalar description", source: "---\ndescription: >\n  folded\n---\nbody\n", line: 2 },
    { name: "two descriptions", source: "---\ndescription: a\ndescription: b\n---\nbody\n", line: 3 },
    { name: "an empty body", source: "---\ndescription: a\n---\n\n", line: 3 },
  ])("refuses $name with path and line, never content", ({ source, line }) => {
    let caught: unknown;
    try {
      renderAgentToml(source, "secret-agent");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InstructionSourceInvalidError);
    const refusal = caught as InstructionSourceInvalidError;
    expect(refusal.path).toBe("agents/secret-agent.md");
    expect(refusal.line).toBe(line);
    expect(refusal.message).not.toContain("body");
    expect(refusal.message).not.toContain("folded");
  });
});
