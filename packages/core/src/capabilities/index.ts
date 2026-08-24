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
 *
 * **`not-used` replaces `wrapper-required` rather than joining it**
 * (knowledge-pipeline architecture note §2). The old word meant "we are not certain, and
 * the `developer-os run claude|codex` wrapper produces the same capture
 * anyway"; decision 3.1 declines that wrapper, so all that survived was advice
 * to run a command that will not exist — a state that validates while the
 * property it names is false. What is left says one of three honest things: we
 * observed it (`yes`), we could not settle it (`unknown`), or this product does
 * not touch that surface at all (`not-used`).
 *
 * Substituting a member rather than adding one is the mechanism: every
 * consumer of the old union is a compile error until it is updated.
 */
export const CAPABILITY_STATES = ["yes", "unknown", "not-used"] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export const PROBE_OBSERVATIONS = ["observed", "absent", "unavailable"] as const;
export type ProbeObservation = (typeof PROBE_OBSERVATIONS)[number];
