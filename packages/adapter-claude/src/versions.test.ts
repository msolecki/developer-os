import { describe, expect, it } from "vitest";
import { compareVersions } from "@developer-os/core";
import { CLAUDE_CAPABILITY_KEYS, CLAUDE_MINIMUM_VERSION, tablePermits } from "./versions.js";

/**
 * `compareVersions` and the generic floor mechanism moved to
 * `packages/core/src/versions/index.ts` (Task 3.5) — see `packages/core/src/versions/index.test.ts`
 * for that battery. What remains here is specific to Claude's own table: that
 * every documented capability key is actually reachable through it, and that
 * the minimum stays below the version gates spec §5.2 deliberately avoids.
 */
describe("tablePermits", () => {
  it("covers every capability key, so no key is silently unreachable", () => {
    expect(CLAUDE_CAPABILITY_KEYS.length).toBeGreaterThan(0);
    for (const key of CLAUDE_CAPABILITY_KEYS) {
      expect(tablePermits(key, "2.1.216"), `${key} must be reachable`).toBe(
        true,
      );
    }
  });

  /**
   * Spec §5.2 keeps the floor low on purpose by depending on none of the
   * documented version gates — `displayName` 2.1.143, `defaultEnabled` 2.1.154,
   * `metadata` 2.1.222. If the floor ever rises above the oldest of those, a
   * dependency crept in and the spec's §14.1 list needs revisiting.
   */
  it("keeps the minimum below every documented gate we deliberately avoid", () => {
    expect(compareVersions(CLAUDE_MINIMUM_VERSION, "2.1.143")).toBeLessThan(0);
  });
});
