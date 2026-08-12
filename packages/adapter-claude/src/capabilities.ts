import { CLAUDE_CAPABILITY_KEYS, tablePermits } from "./versions.js";
import type { ClaudeCapabilityKey } from "./versions.js";
import type { CapabilityState, ProbeObservation } from "@developer-os/core";
export type { CapabilityState, ProbeObservation } from "@developer-os/core";

export type ClaudeCapabilities = Readonly<
  Record<ClaudeCapabilityKey, CapabilityState>
>;

/**
 * Keys nothing may settle yet. `plugin_hooks` is here because this adapter
 * ships no hooks file (spec-amended, founder-ratified 2026-08-12 — see
 * `plugin.ts`'s docblock on `hooks/hooks.json`) and matches the identical
 * `UNSETTLED` list on the Codex adapter's own `capabilities.ts`: the two
 * adapters are deliberately kept identical here. **Removing a key from this
 * list requires, in the same change, the artifact it describes and a test
 * that observed it working.**
 */
const UNSETTLED: readonly ClaudeCapabilityKey[] = ["plugin_hooks"];

/**
 * The asymmetry is the mechanism, not a mood.
 *
 * A capability the probe could not settle reports `unknown` (spec §9.2) —
 * never `no`, because "we could not ask" and "the answer is no" are different
 * facts and only one of them justifies telling a user their install lacks a
 * feature. Everything else uncertain reports `wrapper-required`, because the
 * wrapper produces the same capture while a false `yes` produces silent data
 * loss.
 *
 * `UNSETTLED` keys report `unknown` unconditionally, before the table or the
 * observation is even consulted — no artifact ships for `plugin_hooks`, so a
 * table permission or a stray observation for that key must never be allowed
 * to produce a confident answer nobody has verified.
 *
 * `observations` is keyed by `string` rather than `ClaudeCapabilityKey`: it
 * comes from the probe, which reports what it saw, not from the type system.
 * Iteration is over `CLAUDE_CAPABILITY_KEYS`, so a key the probe invents
 * reaches nothing.
 */
export function resolveCapabilities(
  version: string,
  observations: ReadonlyMap<string, ProbeObservation>,
): ClaudeCapabilities {
  const resolved: Record<string, CapabilityState> = Object.create(
    null,
  ) as Record<string, CapabilityState>;
  for (const key of CLAUDE_CAPABILITY_KEYS) {
    if (UNSETTLED.includes(key)) {
      resolved[key] = "unknown";
      continue;
    }
    const observation = observations.get(key) ?? "absent";
    if (observation === "unavailable") {
      resolved[key] = "unknown";
      continue;
    }
    resolved[key] =
      tablePermits(key, version) && observation === "observed"
        ? "yes"
        : "wrapper-required";
  }
  return Object.freeze(resolved);
}
