import { tablePermits } from "./versions.js";
import type { ClaudeCapabilityKey } from "./versions.js";
import type { CapabilityState, ProbeObservation } from "@developer-os/core";
export type { CapabilityState, ProbeObservation } from "@developer-os/core";

export type ClaudeCapabilities = Readonly<
  Record<ClaudeCapabilityKey, CapabilityState>
>;

/**
 * The surfaces this product decided not to touch, and therefore never asks
 * about. Identical to the Codex adapter's own `CODEX_NOT_USED_KEYS` — the two
 * adapters are deliberately kept the same here, and
 * `apps/cli/src/adapter-capability-parity.test.ts` asserts it, because which
 * surfaces the product uses is one product decision rather than two vendor
 * ones.
 *
 * `plugin_hooks` was already here under the name `UNSETTLED`, for this
 * adapter's missing hooks file (founder-ratified 2026-08-12 — see `plugin.ts`'s
 * docblock on `hooks/hooks.json`). The other five join it because
 * knowledge-pipeline spec §3.1 declines both automatic capture paths: no
 * lifecycle hook fires, and no `developer-os run claude` wrapper is built, so
 * the three lifecycle keys describe surfaces nothing will ever reach.
 * `subagents` and `durable_project_guidance` are reported for `doctor`'s matrix
 * and depended on by nothing (see `versions.ts`).
 *
 * **Removing a key from this list requires, in the same change, the artifact it
 * describes and a test that observed it working.** That rule is why
 * `plugin_hooks` never resolved to `yes` over a file that does not exist.
 */
export const CLAUDE_NOT_USED_KEYS: readonly ClaudeCapabilityKey[] = [
  "plugin_hooks",
  "session_start_injection",
  "session_end_capture",
  "pre_compact_backup",
  "subagents",
  "durable_project_guidance",
];

/**
 * The asymmetry is the mechanism, not a mood.
 *
 * A capability the probe could not settle reports `unknown` (spec §9.2) —
 * never `no`, because "we could not ask" and "the answer is no" are different
 * facts and only one of them justifies telling a user their install lacks a
 * feature. Everything else uncertain reports `unknown` too: it used to report
 * `wrapper-required`, which claimed a wrapper produced the same capture, and
 * knowledge-pipeline decision 3.1 declines to build that wrapper.
 *
 * `CLAUDE_NOT_USED_KEYS` resolve unconditionally, before the table or the
 * observation is even consulted — no artifact ships for any of them, so a table
 * permission or a stray observation must never be allowed to produce a
 * confident answer nobody has verified.
 *
 * `observations` is keyed by `string` rather than `ClaudeCapabilityKey`: it
 * comes from the probe, which reports what it saw, not from the type system.
 * Every key is read by name below, so a key the probe invents reaches nothing.
 *
 * **The matrix is written out key by key rather than accumulated in a loop, and
 * that is the type check, not a style.** The accumulator was
 * `Record<string, CapabilityState>`, whose index signature satisfies
 * `ClaudeCapabilities`'s named properties, so the function compiled even if the
 * loop never assigned a required key — a renamed or dropped capability key was
 * not a compile error (`codex-adapter.md` §11.7). Written out, a key that
 * leaves `CLAUDE_CAPABILITY_KEYS` without leaving the type fails to compile
 * here, and one that joins it without being reported fails too.
 */
export function resolveCapabilities(
  version: string,
  observations: ReadonlyMap<string, ProbeObservation>,
): ClaudeCapabilities {
  const stateOf = (key: ClaudeCapabilityKey): CapabilityState => {
    if (CLAUDE_NOT_USED_KEYS.includes(key)) return "not-used";
    const observation = observations.get(key) ?? "absent";
    if (observation === "unavailable") return "unknown";
    return tablePermits(key, version) && observation === "observed"
      ? "yes"
      : "unknown";
  };

  const resolved: ClaudeCapabilities = {
    skills: stateOf("skills"),
    plugin_hooks: stateOf("plugin_hooks"),
    session_start_injection: stateOf("session_start_injection"),
    session_end_capture: stateOf("session_end_capture"),
    pre_compact_backup: stateOf("pre_compact_backup"),
    non_interactive_run: stateOf("non_interactive_run"),
    structured_result: stateOf("structured_result"),
    subagents: stateOf("subagents"),
    durable_project_guidance: stateOf("durable_project_guidance"),
  };
  return Object.freeze(resolved);
}
