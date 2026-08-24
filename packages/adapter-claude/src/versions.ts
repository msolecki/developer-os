import type { CapabilityVersionTable } from "@developer-os/core";
import { tablePermits as tablePermitsGeneric } from "@developer-os/core";

/**
 * Claude architecture former §5.4's capability keys.
 *
 * `durable_project_guidance` is reported for `doctor`'s matrix and depended on
 * by nothing: Claude architecture former §7.1 chose to concatenate the `shared` preamble into every
 * artifact rather than reference one shared guidance surface, so nothing in
 * this package may start relying on it. Reporting a capability this adapter
 * does not use is worth doing; relying on it is not.
 */
export const CLAUDE_CAPABILITY_KEYS = [
  "skills",
  "plugin_hooks",
  "session_start_injection",
  "session_end_capture",
  "pre_compact_backup",
  "non_interactive_run",
  "structured_result",
  "subagents",
  "durable_project_guidance",
] as const;

export type ClaudeCapabilityKey = (typeof CLAUDE_CAPABILITY_KEYS)[number];

/**
 * Provisional; the integration test confirms or raises it.
 *
 * Claude architecture former §15.1: the skills-directory-plugin floor is not documented on the page
 * read on 2026-08-11, so it is established by probe. `2.1.142` is the oldest
 * documented plugin-skill gate in Claude architecture former §14.1 and is the floor below which
 * nothing here is worth attempting.
 *
 * `baseline-capabilities.json` records `2.1.216`. That is a historical
 * observation of one machine on 2026-07-21 and is deliberately **not** this
 * floor — Claude architecture former §5.2 says so in as many words.
 */
export const CLAUDE_MINIMUM_VERSION = "2.1.142";

/**
 * A documented floor per key, or `null` meaning "no documented floor above the
 * minimum; the probe decides".
 *
 * Deliberately sparse. Claude architecture former §5.2 keeps the floor low by refusing to depend on
 * `metadata` (2.1.222), `displayName` (2.1.143) or `defaultEnabled` (2.1.154),
 * so none of them appears here — that absence is the mechanism, not an
 * oversight.
 *
 * A `Map`, not an object literal. `workflow-schema`'s architecture note §9
 * records four modules in one package that shipped `table[key] !== undefined`
 * over a plain object and had a key named `toString` resolve to a `Function`,
 * pass the guard, and crash a line later — twice while hiding a missing
 * refusal. A lookup table is not a lookup unless it cannot inherit.
 */
const DOCUMENTED_FLOORS: ReadonlyMap<ClaudeCapabilityKey, string | null> =
  new Map([
    ["skills", null],
    ["plugin_hooks", null],
    ["session_start_injection", null],
    ["session_end_capture", null],
    ["pre_compact_backup", null],
    ["non_interactive_run", null],
    ["structured_result", null],
    ["subagents", null],
    ["durable_project_guidance", null],
  ]);

const TABLE: CapabilityVersionTable<ClaudeCapabilityKey> = {
  minimum: CLAUDE_MINIMUM_VERSION,
  floors: DOCUMENTED_FLOORS,
};

/**
 * This adapter's one-line binding onto `@developer-os/core`'s generic
 * `tablePermits`, closing over Claude's own table. `compareVersions` and the
 * comparison-and-floor mechanism moved to `@developer-os/core` (Task 3.5) so
 * both adapters share one copy; the table itself — `CLAUDE_MINIMUM_VERSION`
 * and `DOCUMENTED_FLOORS` above — stays here, because the floors are a Claude
 * fact, not a shared one.
 */
export function tablePermits(key: ClaudeCapabilityKey, version: string): boolean {
  return tablePermitsGeneric(TABLE, key, version);
}
