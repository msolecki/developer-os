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
 * no `AGENTS.md` at any scope. `subagents` likewise: the hook events exist and
 * no canonical workflow spawns a subagent (§15.4).
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
 * Raised to `0.147.0` by Task 17, 2026-08-12 — the integration test run
 * against a real installation, as this docblock always said would settle it.
 *
 * One version was available on this machine and one was tested; this is not
 * a range, and Codex architecture former §15 item 2 says so in as many words. It is a **raise**,
 * not a confirmation, of the prior provisional `0.144.6`: Task 17 also fixed
 * two real bugs in this adapter's own CLI argv (`install.ts`) and marketplace
 * document (`marketplace.ts`) that made every install step fail against the
 * real 0.147.0 binary before the fix — `codex plugin marketplace add` with a
 * separate name argument refused with a clap usage error, `codex plugin
 * remove` with an unqualified plugin name refused, and an absolute
 * `source.path` in the marketplace document was silently dropped from the
 * listing. Nothing establishes that those specific, corrected commands ever
 * worked on `0.144.6` — that version predates this observation entirely, and
 * may not even carry the `plugin`/`marketplace` subcommands this design
 * depends on. `0.147.0` is the only version this adapter's actual install
 * path has been proven against; see Codex architecture former §14.4 and §15 for the full record.
 */
export const CODEX_MINIMUM_VERSION = "0.147.0";

/**
 * A documented floor per key, or `null` meaning "no documented floor above the
 * minimum; the probe decides".
 *
 * Deliberately sparse: nobody has documented a per-key floor for Codex above
 * `CODEX_MINIMUM_VERSION` yet, so every key maps to `null`.
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
