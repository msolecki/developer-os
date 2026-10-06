import { CLAUDE_HOOK_ROWS } from "@developer-os/adapter-claude";
import { CODEX_HOOK_ROWS } from "@developer-os/adapter-codex";
import { expect, it } from "vitest";

import { HOOK_EVENT_OF } from "./firing-records.js";
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
