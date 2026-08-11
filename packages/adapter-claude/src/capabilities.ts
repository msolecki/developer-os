import { CLAUDE_CAPABILITY_KEYS, tablePermits } from "./versions.js";
import type { ClaudeCapabilityKey } from "./versions.js";

/**
 * Spec §5.1. `yes` is earned by a documented floor **and** an observation;
 * everything uncertain degrades toward the wrapper; `unknown` is never `yes`.
 */
export type CapabilityState = "yes" | "wrapper-required" | "unknown";

/**
 * What the probe saw, which is a different question from what we report.
 * Keeping the two types distinct is deliberate: collapsing them is exactly how
 * a `yes` comes to be earned by an observation alone.
 */
export type ProbeObservation = "observed" | "absent" | "unavailable";

export type ClaudeCapabilities = Readonly<
  Record<ClaudeCapabilityKey, CapabilityState>
>;

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
