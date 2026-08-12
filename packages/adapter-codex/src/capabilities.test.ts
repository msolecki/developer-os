import { describe, expect, it } from "vitest";
import type { ProbeObservation } from "@developer-os/core";
import { CODEX_CAPABILITY_KEYS } from "./versions.js";
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

  it("degrades an unmentioned key toward the wrapper, never toward yes", () => {
    expect(resolveCapabilities("0.147.0", observed).session_end_capture).toBe("wrapper-required");
  });

  /**
   * Spec §15.1: the plugin-bundled hooks path is documented and unobserved, and
   * this plan ships no hooks file at all. `unknown` is what the model does with
   * a fact nobody has established. It must not quietly become
   * `wrapper-required` — that would claim we asked and got an answer.
   */
  it("reports plugin_hooks as unknown until an integration test settles it", () => {
    expect(resolveCapabilities("0.147.0", observed).plugin_hooks).toBe("unknown");
  });

  it("reports unknown, never no, for a probe that could not run", () => {
    const resolved = resolveCapabilities(
      "0.147.0",
      new Map<string, ProbeObservation>([["skills", "unavailable"]]),
    );
    expect(resolved.skills).toBe("unknown");
  });

  it("refuses to grant anything on a version below the floor", () => {
    expect(resolveCapabilities("0.1.0", observed).skills).toBe("wrapper-required");
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
   * Precedence: UNSETTLED beats any observation. If a refactor moved the
   * observation lookup (line 62) above the UNSETTLED check (line 58), a real
   * signal reporting plugin_hooks as "observed" would incorrectly become "yes".
   * This test pins that the UNSETTLED gate fires first.
   */
  it("returns unknown for UNSETTLED keys even if the probe reported observed", () => {
    expect(
      resolveCapabilities("0.147.0", new Map<string, ProbeObservation>([["plugin_hooks", "observed"]]))
        .plugin_hooks,
    ).toBe("unknown");
  });

  it("returns unknown for unavailable observations even on a below-floor version", () => {
    expect(
      resolveCapabilities("0.1.0", new Map<string, ProbeObservation>([["skills", "unavailable"]]))
        .skills,
    ).toBe("unknown");
  });
});
