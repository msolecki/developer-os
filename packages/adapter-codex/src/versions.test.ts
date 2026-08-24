import { describe, expect, it } from "vitest";
import { CODEX_CAPABILITY_KEYS, CODEX_MINIMUM_VERSION, tablePermits } from "./versions.js";

describe("the capability keys", () => {
  /**
   * Spelled out rather than imported from the other adapter, which Codex architecture former §1
   * forbids — so the list is asserted in full, in order. A length check would
   * catch no rename, no reorder and no substitution, and this is the one place
   * a duplicated list can drift.
   */
  it("are exactly product spec §11's, in order, resolved against Codex architecture former §5.4", () => {
    expect([...CODEX_CAPABILITY_KEYS]).toEqual([
      "skills",
      "plugin_hooks",
      "session_start_injection",
      "session_end_capture",
      "pre_compact_backup",
      "non_interactive_run",
      "structured_result",
      "subagents",
      "durable_project_guidance",
    ]);
  });
});

describe("tablePermits", () => {
  it("refuses every key below the supported floor", () => {
    expect(CODEX_CAPABILITY_KEYS.length).toBeGreaterThan(0);
    for (const key of CODEX_CAPABILITY_KEYS) {
      expect(tablePermits(key, "0.1.0"), key).toBe(false);
    }
  });

  it("permits a version above everything the table knows", () => {
    expect(tablePermits("skills", "99.0.0")).toBe(true);
  });

  it("refuses a version it cannot parse", () => {
    expect(tablePermits("skills", "not a version")).toBe(false);
  });

  it("never grants a capability by itself, which is the probe's job", () => {
    expect(tablePermits("session_end_capture", CODEX_MINIMUM_VERSION)).toBe(true);
  });
});
