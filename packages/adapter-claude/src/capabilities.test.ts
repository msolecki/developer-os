import { describe, expect, it } from "vitest";
import { resolveCapabilities } from "./capabilities.js";
import type { ProbeObservation } from "./capabilities.js";
import { CLAUDE_CAPABILITY_KEYS } from "./versions.js";

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

  it("reports wrapper-required when the probe did not observe", () => {
    const resolved = resolveCapabilities(
      "2.1.216",
      observed([["skills", "absent"]]),
    );
    expect(resolved.skills).toBe("wrapper-required");
  });

  /**
   * Spec §9.2: "we could not ask" and "the answer is no" are different facts,
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

  it("reports wrapper-required for a key the probe never mentioned", () => {
    const resolved = resolveCapabilities("2.1.216", observed([]));
    expect(resolved.session_end_capture).toBe("wrapper-required");
  });

  it("refuses to grant yes below the minimum version, whatever the probe saw", () => {
    const resolved = resolveCapabilities(
      "1.0.0",
      observed([["skills", "observed"]]),
    );
    expect(resolved.skills).toBe("wrapper-required");
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
   * `plugin_hooks` reports `unknown` throughout — matching the `UNSETTLED`
   * list on the Codex adapter's own `capabilities.ts`. `unknown` is what the
   * model does with a fact nobody has established;
   * `wrapper-required` would claim we asked and got an answer nobody gave.
   */
  it("reports plugin_hooks as unknown, matching the Codex adapter, because this adapter ships no hooks file either", () => {
    const resolved = resolveCapabilities(
      "2.1.216",
      observed([["skills", "observed"]]),
    );
    expect(resolved.plugin_hooks).toBe("unknown");
  });

  /**
   * Precedence: UNSETTLED beats any observation. If a refactor moved the
   * observation lookup above the UNSETTLED check, a stray observation
   * reporting `plugin_hooks` as "observed" would incorrectly become "yes".
   */
  it("returns unknown for plugin_hooks even if the probe reported observed", () => {
    const resolved = resolveCapabilities(
      "2.1.216",
      observed([["plugin_hooks", "observed"]]),
    );
    expect(resolved.plugin_hooks).toBe("unknown");
  });
});
