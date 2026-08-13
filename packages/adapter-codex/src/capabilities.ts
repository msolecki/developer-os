import { tablePermits } from "./versions.js";
import type { CodexCapabilityKey } from "./versions.js";
import type { CapabilityState, ProbeObservation } from "@developer-os/core";
export type { CapabilityState, ProbeObservation } from "@developer-os/core";

export type CodexCapabilities = Readonly<Record<CodexCapabilityKey, CapabilityState>>;

/**
 * The surfaces this product decided not to touch, and therefore never asks
 * about. Identical to the Claude adapter's own `CLAUDE_NOT_USED_KEYS` — the two
 * adapters are deliberately kept the same here, and
 * `apps/cli/src/adapter-capability-parity.test.ts` asserts it, because which
 * surfaces the product uses is one product decision rather than two vendor
 * ones.
 *
 * `plugin_hooks` was already here under the name `UNSETTLED`: this subsystem
 * ships no hooks file (see the plan's opening decisions) and spec §15.1 records
 * the plugin-bundled path as documented and unobserved. The other five join it
 * because knowledge-pipeline spec §3.1 declines both automatic capture paths —
 * no lifecycle hook fires, and no `developer-os run codex` wrapper is built.
 *
 * **Removing a key from this list requires, in the same change, the artifact it
 * describes and a test that observed it working.** That rule is why
 * `plugin_hooks` never resolved to `yes` over a file that does not exist.
 */
export const CODEX_NOT_USED_KEYS: readonly CodexCapabilityKey[] = [
  "plugin_hooks",
  "session_start_injection",
  "session_end_capture",
  "pre_compact_backup",
  "subagents",
  "durable_project_guidance",
];

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
 * Degradation never points toward `yes`. A key the probe said nothing about
 * (`observations.has(key)` is `false`) is `unknown` — it used to be
 * `wrapper-required`, on the reasoning that the wrapper was a working path
 * rather than a degraded state, and knowledge-pipeline decision 3.1 declines
 * to build that wrapper. A key the probe could not check (`unavailable`) is
 * `unknown` for the older reason: "we could not ask" is not "it is not there",
 * and collapsing the two would let a probe failure masquerade as settled
 * information in either direction.
 *
 * `CODEX_NOT_USED_KEYS` resolve unconditionally, before the table or the
 * observation is even consulted — nothing ships behind any of them, so a table
 * permission or a stray observation must never be allowed to produce a
 * confident answer nobody has verified.
 *
 * `observations` is keyed by `string` rather than `CodexCapabilityKey`: it
 * comes from the probe, which reports what it saw, not from the type system.
 * Every key is read by name below, so a key the probe invented reaches nothing
 * and the result always reports every key `doctor` expects — a full matrix,
 * not a sparse one.
 *
 * **The matrix is written out key by key rather than accumulated in a loop, and
 * that is the type check, not a style.** The accumulator was
 * `Record<string, CapabilityState>`, whose index signature satisfies
 * `CodexCapabilities`'s named properties, so the function compiled even if the
 * loop never assigned a required key — a renamed or dropped capability key was
 * not a compile error (`codex-adapter.md` §11.7). Written out, a key that
 * leaves `CODEX_CAPABILITY_KEYS` without leaving the type fails to compile
 * here, and one that joins it without being reported fails too.
 */
export function resolveCapabilities(
  version: string,
  observations: ReadonlyMap<string, ProbeObservation>,
): CodexCapabilities {
  const stateOf = (key: CodexCapabilityKey): CapabilityState => {
    if (CODEX_NOT_USED_KEYS.includes(key)) return "not-used";
    const observation = observations.get(key) ?? "absent";
    if (observation === "unavailable") return "unknown";
    return tablePermits(key, version) && observation === "observed" ? "yes" : "unknown";
  };

  const resolved: CodexCapabilities = {
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
