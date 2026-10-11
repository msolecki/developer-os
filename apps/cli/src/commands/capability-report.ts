import type { CapabilityState, ProbeObservation } from "@developer-os/core";

/** The keys only a firing record under `state/hooks/` may settle (`hooks.md` §3.6). */
const FIRING_KEYS = ["plugin_hooks", "session_start_injection"] as const;

/** NEW-65: listing is not firing, so only these two keys are taken from the records. */
export function firingOnly(
  observations: ReadonlyMap<string, ProbeObservation> | undefined,
): ReadonlyMap<string, ProbeObservation> {
  const kept = new Map<string, ProbeObservation>();
  for (const key of FIRING_KEYS) {
    const observation = observations?.get(key);
    if (observation !== undefined) kept.set(key, observation);
  }
  return kept;
}

/** A probe's observations with the firing keys replaced by the records', never by the probe's own. */
export function withFiring(
  probed: ReadonlyMap<string, ProbeObservation>,
  firing: ReadonlyMap<string, ProbeObservation>,
): ReadonlyMap<string, ProbeObservation> {
  const merged = new Map(probed);
  for (const key of FIRING_KEYS) merged.delete(key);
  for (const [key, observation] of firing) merged.set(key, observation);
  return merged;
}

export function summarise<Key extends string>(
  keys: readonly Key[],
  capabilities: Readonly<Record<Key, CapabilityState>>,
): string {
  return keys.map((key) => `${key}=${capabilities[key]}`).join(" ");
}
