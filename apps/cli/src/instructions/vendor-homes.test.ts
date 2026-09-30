import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { claudeInstructionPaths, codexHomeRecordPath, codexInstructionPaths, resolveVendorHomes } from "./vendor-homes.js";

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

  it("derives the Claude targets of foundation.md §12.5 and claude-adapter.md §18", () => {
    expect(claudeInstructionPaths(homes)).toStrictEqual({
      pluginRoot: `${H}/.claude/skills/developer-os`,
      rulesDir: `${H}/.claude/rules`,
      outputStylesDir: `${H}/.claude/output-styles`,
      instructionFile: `${H}/.claude/CLAUDE.md`,
      importDir: `${P}/claude/instructions`,
    });
  });

  it("derives the Codex targets of foundation.md §12.5 and codex-adapter.md §16", () => {
    expect(codexInstructionPaths(homes)).toStrictEqual({
      agentsDir: "/synthetic/codex/agents",
      instructionFile: "/synthetic/codex/AGENTS.md",
      pluginRoot: `${P}/codex/plugins/developer-os`,
      registrationFile: `${P}/codex/registration.json`,
    });
  });
});

describe("resolveVendorHomes: the recorded Codex home", () => {
  const root = mkdtempSync(join(tmpdir(), "developer-os-vendor-homes-"));
  afterAll(() => { rmSync(root, { recursive: true, force: true }); });

  function product(name: string): string {
    const home = join(root, name);
    mkdirSync(join(home, "codex"), { recursive: true, mode: 0o700 });
    return home;
  }

  it("prefers the recorded home over CODEX_HOME and the default", () => {
    const home = product("recorded");
    writeFileSync(codexHomeRecordPath(home), "/synthetic/recorded-codex\n", { mode: 0o600 });
    for (const env of [{}, { CODEX_HOME: "/synthetic/codex" }]) {
      expect(resolveVendorHomes(env, H, home).codexHome).toBe("/synthetic/recorded-codex");
    }
  });

  it("refuses a symlinked or malformed record instead of falling back to the environment", () => {
    const linked = product("linked");
    const target = join(root, "target");
    writeFileSync(target, "/synthetic/recorded-codex\n", { mode: 0o600 });
    symlinkSync(target, codexHomeRecordPath(linked));
    expect(() => resolveVendorHomes({}, H, linked)).toThrow(/unreadable/u);
    const malformed = product("malformed");
    writeFileSync(codexHomeRecordPath(malformed), "relative/codex\n", { mode: 0o600 });
    expect(() => resolveVendorHomes({}, H, malformed)).toThrow();
  });
});
