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
 * Raised to `2.1.280` by D102 (6), 2026-10-12 (AUD-071, NEW-256), by the rule
 * that set Codex's floor: the lowest version the installed hooks were observed
 * firing on (`hooks.md` §1 question 10, the only Claude version tested for
 * hooks). `init` writes the hooks for every supported version, so a version on
 * which they were never observed is refused rather than installed into.
 *
 * The previous floor, `2.1.142`, was the oldest documented plugin-skill gate
 * (Claude architecture former §14.1). `baseline-capabilities.json`'s `2.1.216`
 * records the founder's hand-made hooks before this product existed, not the
 * installed ones, so it is no observation of them.
 */
export const CLAUDE_MINIMUM_VERSION = "2.1.280";

/**
 * A documented floor per key, or `null` meaning "no documented floor above the
 * minimum; the probe decides".
 *
 * Every key is `null`: the hook keys' floor, `2.1.280`, is now the minimum
 * itself. The manifest still depends on none of `metadata` (2.1.222),
 * `displayName` (2.1.143) or `defaultEnabled` (2.1.154); all three gates now
 * lie below the minimum.
 *
 * A `Map`, not an object literal. `workflow-schema`'s architecture note §9
 * records four modules in one package that shipped `table[key] !== undefined`
 * over a plain object and had a key named `toString` resolve to a `Function`,
 * pass the guard, and crash a line later — twice while hiding a missing
 * refusal. A lookup table is not a lookup unless it cannot inherit.
 */
const DOCUMENTED_FLOORS: ReadonlyMap<ClaudeCapabilityKey, string | null> = new Map(
  CLAUDE_CAPABILITY_KEYS.map((key) => [key, null]),
);

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
