import { describe, expect, it } from "vitest";
import { resolveCapabilities } from "./capabilities.js";
import type { ProbeObservation } from "./capabilities.js";
import { CLAUDE_CAPABILITY_KEYS } from "./versions.js";
import type { ClaudeCapabilityKey } from "./versions.js";

function observed(
  entries: readonly (readonly [string, ProbeObservation])[],
): ReadonlyMap<string, ProbeObservation> {
  return new Map(entries);
}

describe("resolveCapabilities", () => {
  it("reports yes only when the table permits and the probe observed", () => {
    const resolved = resolveCapabilities(
      "2.1.216",
      observed([["skills", "observed"]]),
    );
    expect(resolved.skills).toBe("yes");
  });

  it("reports unknown when the probe did not observe", () => {
    const resolved = resolveCapabilities(
      "2.1.216",
      observed([["skills", "absent"]]),
    );
    expect(resolved.skills).toBe("unknown");
  });

  /**
   * Claude architecture former §9.2: "we could not ask" and "the answer is no" are different facts,
   * and only one of them justifies telling a user their install lacks a
   * feature. `unavailable` must never collapse into either `yes` or a claim of
   * absence.
   */
  it("reports unknown when the probe could not run", () => {
    const resolved = resolveCapabilities(
      "2.1.216",
      observed([["skills", "unavailable"]]),
    );
    expect(resolved.skills).toBe("unknown");
  });

  it("reports unknown even for a version below the minimum, because the probe still could not run", () => {
    const resolved = resolveCapabilities(
      "1.0.0",
      observed([["skills", "unavailable"]]),
    );
    expect(resolved.skills).toBe("unknown");
  });

  it("reports unknown for a probe-settled key the probe never mentioned", () => {
    const resolved = resolveCapabilities("2.1.216", observed([]));
    expect(resolved.non_interactive_run).toBe("unknown");
  });

  it("refuses to grant yes below the minimum version, whatever the probe saw", () => {
    const resolved = resolveCapabilities(
      "1.0.0",
      observed([["skills", "observed"]]),
    );
    expect(resolved.skills).toBe("unknown");
  });

  it("returns a value for every key and no others", () => {
    const resolved = resolveCapabilities("2.1.216", observed([]));
    for (const key of CLAUDE_CAPABILITY_KEYS) {
      expect(resolved[key], `${key} must be reported`).toBeDefined();
    }
    expect(Object.keys(resolved)).toHaveLength(CLAUDE_CAPABILITY_KEYS.length);
  });

  /**
   * A hostile observation key must not reach a capability. The observations map
   * is keyed by `string` because it comes from the probe, not from the type
   * system.
   */
  it("ignores an observation for a key that is not a capability", () => {
    const resolved = resolveCapabilities(
      "2.1.216",
      observed([
        ["toString", "observed"],
        ["__proto__", "observed"],
      ]),
    );
    expect(Object.keys(resolved)).toHaveLength(CLAUDE_CAPABILITY_KEYS.length);
    expect(Object.keys(resolved)).not.toContain("toString");
  });

  it("never reports yes for anything the probe cannot settle", () => {
    const resolved = resolveCapabilities("2.1.216", observed([]));
    expect(Object.values(resolved)).not.toContain("yes");
  });

  /**
   * Founder-ratified 2026-08-12: neither adapter ships a hooks file, and
   * `plugin_hooks` reported `unknown` throughout — matching the list on the
   * Codex adapter's own `capabilities.ts`. It is `not-used` now rather than
   * `unknown`, because hooks were **declined** on 2026-08-12 rather than
   * deferred: `unknown` is what the model does with a fact nobody has
   * established, and this one is established.
   */
  it("reports plugin_hooks as not-used, matching the Codex adapter, because neither ships a hooks file", () => {
    const resolved = resolveCapabilities(
      "2.1.216",
      observed([["skills", "observed"]]),
    );
    expect(resolved.plugin_hooks).toBe("not-used");
  });

  /**
   * Precedence: the not-used list beats any observation. If a refactor moved
   * the observation lookup above that check, a stray observation reporting
   * `plugin_hooks` as "observed" would incorrectly become "yes".
   */
  it("returns not-used for plugin_hooks even if the probe reported observed", () => {
    const resolved = resolveCapabilities(
      "2.1.216",
      observed([["plugin_hooks", "observed"]]),
    );
    expect(resolved.plugin_hooks).toBe("not-used");
  });
});

/**
 * Six of the nine keys name surfaces this product decided not to touch
 * (knowledge-pipeline architecture note §2): no hooks file ships, and the
 * `developer-os run claude` wrapper the old word advised is not being built.
 * A state that advises a command which will not exist is a value that
 * validates while the property it names is false.
 */
describe("the surfaces this product does not use", () => {
  const NOT_USED_KEYS = [
    "plugin_hooks",
    "session_start_injection",
    "session_end_capture",
    "pre_compact_backup",
    "subagents",
    "durable_project_guidance",
  ] as const satisfies readonly ClaudeCapabilityKey[];

  it.each(NOT_USED_KEYS)(
    "reports %s as not-used, before the table or an observation is consulted",
    (key) => {
      const observations: ReadonlyMap<string, ProbeObservation> = new Map([
        [key, "observed"],
      ]);
      expect(resolveCapabilities("99.0.0", observations)[key]).toBe("not-used");
    },
  );

  it("degrades an unobserved but permitted key to unknown, never to a wrapper", () => {
    expect(resolveCapabilities("99.0.0", new Map()).structured_result).toBe(
      "unknown",
    );
  });

  it("emits no wrapper-required anywhere in a full matrix", () => {
    const resolved = resolveCapabilities("99.0.0", new Map());
    expect(Object.values(resolved)).not.toContain("wrapper-required");
  });
});
