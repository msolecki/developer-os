import { describe, expect, it } from "vitest";

import { claudeInstructionPaths, codexInstructionPaths, resolveVendorHomes } from "./vendor-homes.js";

const H = "/synthetic/user";
const P = "/synthetic/user/.developer-os";

describe("resolveVendorHomes", () => {
  it("uses an absolute CODEX_HOME", () => {
    expect(resolveVendorHomes({ CODEX_HOME: "/synthetic/codex" }, H, P)).toStrictEqual({
      userHome: H,
      productHome: P,
      codexHome: "/synthetic/codex",
    });
  });

  it("normalizes an absolute CODEX_HOME", () => {
    expect(resolveVendorHomes({ CODEX_HOME: "/synthetic/x/../codex/" }, H, P).codexHome).toBe("/synthetic/codex");
  });

  it("falls back to H/.codex for a relative, empty or unset CODEX_HOME", () => {
    for (const env of [{ CODEX_HOME: "relative/codex" }, { CODEX_HOME: "" }, {}]) {
      expect(resolveVendorHomes(env, H, P).codexHome).toBe(`${H}/.codex`);
    }
  });

  it("never follows CLAUDE_CONFIG_DIR", () => {
    const homes = resolveVendorHomes({ CLAUDE_CONFIG_DIR: "/synthetic/claude-config" }, H, P);
    expect(claudeInstructionPaths(homes).instructionFile).toBe(`${H}/.claude/CLAUDE.md`);
  });
});

describe("vendor instruction paths", () => {
  const homes = resolveVendorHomes({ CODEX_HOME: "/synthetic/codex" }, H, P);

  it("derives the Claude targets of spec §2.2 and §4", () => {
    expect(claudeInstructionPaths(homes)).toStrictEqual({
      pluginRoot: `${H}/.claude/skills/developer-os`,
      rulesDir: `${H}/.claude/rules`,
      outputStylesDir: `${H}/.claude/output-styles`,
      instructionFile: `${H}/.claude/CLAUDE.md`,
      importDir: `${P}/claude/instructions`,
    });
  });

  it("derives the Codex targets of spec §2.2, §4 and §6.4", () => {
    expect(codexInstructionPaths(homes)).toStrictEqual({
      agentsDir: "/synthetic/codex/agents",
      instructionFile: "/synthetic/codex/AGENTS.md",
      pluginRoot: `${P}/codex/plugins/developer-os`,
      registrationFile: `${P}/codex/registration.json`,
    });
  });
});
