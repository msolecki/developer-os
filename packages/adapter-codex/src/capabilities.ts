import { CODEX_CAPABILITY_KEYS, tablePermits } from "./versions.js";
import type { CodexCapabilityKey } from "./versions.js";
import type { CapabilityState, ProbeObservation } from "@developer-os/core";
export type { CapabilityState, ProbeObservation } from "@developer-os/core";

export type CodexCapabilities = Readonly<Record<CodexCapabilityKey, CapabilityState>>;

/**
 * Keys nothing may settle yet. `plugin_hooks` is here because this subsystem
 * ships no hooks file (see the plan's opening decisions) and spec §15.1 records
 * the plugin-bundled path as documented and unobserved. **Removing a key from
 * this list requires, in the same change, the artifact it describes and a test
 * that observed it working.**
 */
const UNSETTLED: readonly CodexCapabilityKey[] = ["plugin_hooks"];

/**
 * The join: table permission and probe observation into one three-value
 * state per capability. `doctor` prints this and DOS-P6 consumes it.
 *
 * `yes` is earned twice or not at all — the version table must permit *and*
 * a probe must have observed. Either alone is not enough, and that is the
 * whole point of the two-gate design: a version new enough to support a
 * feature says nothing about whether this install actually has it wired up,
 * and an observation says nothing about whether the vendor promises to keep
 * it working at this version.
 *
 * Degradation always points toward the wrapper, never toward `yes`. A key
 * the probe said nothing about (`observations.has(key)` is `false`) is
 * `wrapper-required` — the wrapper is a working path, not a degraded state,
 * so silence about a capability the table would otherwise permit still
 * leaves a working fallback rather than a false claim. A key the probe
 * could not check (`unavailable`) is `unknown`, because "we could not ask"
 * is not "it is not there" — collapsing the two would let a probe failure
 * masquerade as settled information in either direction.
 *
 * `UNSETTLED` keys report `unknown` unconditionally, before the table or the
 * observation is even consulted — no probe exists yet for `plugin_hooks`
 * (spec §15.1), so a table permission or a stray observation for that key
 * must never be allowed to produce a confident answer nobody has verified.
 *
 * Iteration is over `CODEX_CAPABILITY_KEYS`, never over `observations`, so a
 * key the probe invented reaches nothing and the result always reports every
 * key `doctor` expects — a full matrix, not a sparse one.
 *
 * `observations` is keyed by `string` rather than `CodexCapabilityKey`: it
 * comes from the probe, which reports what it saw, not from the type system.
 */
export function resolveCapabilities(
  version: string,
  observations: ReadonlyMap<string, ProbeObservation>,
): CodexCapabilities {
  const resolved: Record<string, CapabilityState> = Object.create(null) as Record<
    string,
    CapabilityState
  >;
  for (const key of CODEX_CAPABILITY_KEYS) {
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
      tablePermits(key, version) && observation === "observed" ? "yes" : "wrapper-required";
  }
  return Object.freeze(resolved);
}
