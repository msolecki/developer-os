/**
 * The capability vocabulary both adapters speak.
 *
 * It lived in `packages/adapter-claude` while there was one adapter. Codex spec
 * §1 forbids either adapter importing the other and §11 defines
 * `CodexCapabilities` in terms of this exact type, so it moves here rather than
 * being copied — which is how two vocabularies come to disagree.
 *
 * `CapabilityState` and `ProbeObservation` stay distinct on purpose: the probe
 * reports what it saw, the resolver reports what we claim, and collapsing them
 * is how a `yes` gets earned by an observation alone.
 */
export const CAPABILITY_STATES = ["yes", "wrapper-required", "unknown"] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export const PROBE_OBSERVATIONS = ["observed", "absent", "unavailable"] as const;
export type ProbeObservation = (typeof PROBE_OBSERVATIONS)[number];
