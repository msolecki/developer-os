import { CLAUDE_HOOK_ROWS, CLAUDE_HOOKS_PATH, PLUGIN_INSTALL_SEGMENTS } from "@developer-os/adapter-claude";
import { CODEX_HOOK_ROWS, CODEX_HOOKS_PATH, PLUGIN_TREE_SEGMENTS } from "@developer-os/adapter-codex";
import { expect, it } from "vitest";

import { HOOK_EVENT_OF, INSTALLED_HOOKS_FILE_SEGMENTS } from "./firing-records.js";
import { HOOK_TOOL_MATCHERS } from "./payload.js";

it.each([
  ["claude", CLAUDE_HOOK_ROWS],
  ["codex", CODEX_HOOK_ROWS],
] as const)("renders %s rows whose events and matchers are the ones the runtime decodes", (vendor, rows) => {
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(HOOK_EVENT_OF[vendor][row.verb], row.verb).toBe(row.event);
    if (row.matcher === null) continue;
    const tools = row.verb === "command" || row.verb === "commit" ? HOOK_TOOL_MATCHERS[vendor].shell : HOOK_TOOL_MATCHERS[vendor].file;
    expect(row.matcher.split("|"), row.verb).toStrictEqual([...tools]);
  }
});

it("finds each vendor's installed hooks.json where the adapters install it (FLOW-INIT-3)", () => {
  expect(INSTALLED_HOOKS_FILE_SEGMENTS.claude).toStrictEqual([...PLUGIN_INSTALL_SEGMENTS, ...CLAUDE_HOOKS_PATH.split("/")]);
  expect(INSTALLED_HOOKS_FILE_SEGMENTS.codex).toStrictEqual([...PLUGIN_TREE_SEGMENTS, ...CODEX_HOOKS_PATH.split("/")]);
});
