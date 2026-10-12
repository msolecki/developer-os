import type { CapabilityVersionTable } from "@developer-os/core";
import { tablePermits as tablePermitsGeneric } from "@developer-os/core";

/**
 * Codex architecture former §5.4's capability keys, in product spec §11's order and identical to the
 * Claude adapter's — deliberately, because DOS-P6 consumes both and two
 * vocabularies would make its contract a translation layer (Codex architecture former §5). The
 * Codex and Claude adapters are peers that may never import one another, so
 * the list is spelled out here rather than shared, and the test asserts it in
 * full.
 *
 * `durable_project_guidance` is reported and used by nothing: Codex architecture former §6.1 writes
 * no `AGENTS.md` at any scope. `subagents` is in use: the catalog agents ship
 * as `agents/developer-os-<id>.toml` (D87, NEW-186).
 */
export const CODEX_CAPABILITY_KEYS = [
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

export type CodexCapabilityKey = (typeof CODEX_CAPABILITY_KEYS)[number];

/**
 * Raised to `0.155.1` by D102 (6), 2026-10-12 (AUD-071, NEW-256): the lowest
 * version the installed hooks were observed firing on (`hooks.md` §1 question
 * 10). `init` writes the hooks into the plugin tree for every supported
 * version, so the floor is the hook observation rather than the older install
 * observation.
 *
 * The previous floor, `0.147.0`, was the version DOS-P5's Task 17 proved the
 * install path against (Codex architecture §3); what `0.147.0`–`0.155.0` does
 * with the manifest's `"hooks"` key was never observed, so those versions are
 * now refused rather than installed into. One observed version, not a range.
 */
export const CODEX_MINIMUM_VERSION = "0.155.1";

/**
 * A documented floor per key, or `null` meaning "no documented floor above the
 * minimum; the probe decides".
 *
 * Every key is `null`: the hook keys' floor, `0.155.1`, is now the minimum
 * itself.
 *
 * A `Map`, not an object literal. `workflow-schema`'s architecture note §9
 * records four modules in one package that shipped `table[key] !== undefined`
 * over a plain object and had a key named `toString` resolve to a `Function`,
 * pass the guard, and crash a line later — twice while hiding a missing
 * refusal. A lookup table is not a lookup unless it cannot inherit.
 */
const DOCUMENTED_FLOORS: ReadonlyMap<CodexCapabilityKey, string | null> = new Map(
  CODEX_CAPABILITY_KEYS.map((key) => [key, null]),
);

const TABLE: CapabilityVersionTable<CodexCapabilityKey> = {
  minimum: CODEX_MINIMUM_VERSION,
  floors: DOCUMENTED_FLOORS,
};

/**
 * This adapter's one-line binding onto `@developer-os/core`'s generic
 * `tablePermits`, closing over Codex's own table. `compareVersions` and the
 * comparison-and-floor mechanism live in `@developer-os/core` (Task 3.5) so
 * both adapters share one copy; the table itself — `CODEX_MINIMUM_VERSION` and
 * `DOCUMENTED_FLOORS` above — stays here, because the floors are a Codex fact,
 * not a shared one.
 */
export function tablePermits(key: CodexCapabilityKey, version: string): boolean {
  return tablePermitsGeneric(TABLE, key, version);
}
