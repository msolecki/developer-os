import { describe, expect, it } from "vitest";
import type { ProbeObservation } from "@developer-os/core";
import { CODEX_CAPABILITY_KEYS } from "./versions.js";
import type { CodexCapabilityKey } from "./versions.js";
import { resolveCapabilities } from "./capabilities.js";

const observed = new Map<string, ProbeObservation>([["skills", "observed"]]);

describe("resolveCapabilities", () => {
  it("earns yes only where the table permits and a probe observed", () => {
    expect(resolveCapabilities("0.147.0", observed).skills).toBe("yes");
  });

  it("reports yes for exactly the capabilities that were observed", () => {
    const granted = Object.entries(resolveCapabilities("0.147.0", observed))
      .filter(([, state]) => state === "yes")
      .map(([key]) => key);
    expect(granted).toEqual(["skills"]);
  });

  it("degrades an unmentioned key to unknown, never toward yes", () => {
    expect(resolveCapabilities("0.147.0", observed).non_interactive_run).toBe("unknown");
  });

  /**
   * Codex architecture former §15.1: the plugin-bundled hooks path is documented and unobserved, and
   * this plan ships no hooks file at all. That was `unknown` while hooks were
   * merely unobserved; knowledge-pipeline architecture note §2 **declines** them, which is
   * a settled fact rather than a missing one.
   */
  it("reports plugin_hooks as not-used, because no hooks file ships", () => {
    expect(resolveCapabilities("0.147.0", observed).plugin_hooks).toBe("not-used");
  });

  it("reports unknown, never no, for a probe that could not run", () => {
    const resolved = resolveCapabilities(
      "0.147.0",
      new Map<string, ProbeObservation>([["skills", "unavailable"]]),
    );
    expect(resolved.skills).toBe("unknown");
  });

  it("refuses to grant anything on a version below the floor", () => {
    expect(resolveCapabilities("0.1.0", observed).skills).toBe("unknown");
  });

  it("reports every key, so doctor prints a full matrix", () => {
    expect(Object.keys(resolveCapabilities("0.147.0", observed))).toHaveLength(
      CODEX_CAPABILITY_KEYS.length,
    );
  });

  it("ignores a key the probe invented", () => {
    const resolved = resolveCapabilities(
      "0.147.0",
      new Map<string, ProbeObservation>([["skills", "observed"], ["invented", "observed"]]),
    );
    expect(Object.keys(resolved)).not.toContain("invented");
  });

  /**
   * Precedence: the not-used list beats any observation. If a refactor moved
   * the observation lookup above that check, a real signal reporting
   * plugin_hooks as "observed" would incorrectly become "yes". This test pins
   * that the not-used gate fires first.
   */
  it("returns not-used for those keys even if the probe reported observed", () => {
    expect(
      resolveCapabilities("0.147.0", new Map<string, ProbeObservation>([["plugin_hooks", "observed"]]))
        .plugin_hooks,
    ).toBe("not-used");
  });

  it("returns unknown for unavailable observations even on a below-floor version", () => {
    expect(
      resolveCapabilities("0.1.0", new Map<string, ProbeObservation>([["skills", "unavailable"]]))
        .skills,
    ).toBe("unknown");
  });
});

/**
 * The Claude adapter carries this suite verbatim, over its own key list, and
 * `apps/cli/src/adapter-capability-parity.test.ts` asserts the two lists are
 * identical. Two adapters that disagree about which surfaces the product uses
 * is one report that means two things.
 */
describe("the surfaces this product does not use", () => {
  const NOT_USED_KEYS = [
    "plugin_hooks",
    "session_start_injection",
    "session_end_capture",
    "pre_compact_backup",
    "subagents",
    "durable_project_guidance",
  ] as const satisfies readonly CodexCapabilityKey[];

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
    expect(resolveCapabilities("99.0.0", new Map()).structured_result).toBe("unknown");
  });

  it("emits no wrapper-required anywhere in a full matrix", () => {
    const resolved = resolveCapabilities("99.0.0", new Map());
    expect(Object.values(resolved)).not.toContain("wrapper-required");
  });
});
