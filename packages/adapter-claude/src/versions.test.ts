import { describe, expect, it } from "vitest";
import { CLAUDE_CAPABILITY_KEYS, CLAUDE_MINIMUM_VERSION, tablePermits } from "./versions.js";

/**
 * `compareVersions` and the generic floor mechanism moved to
 * `packages/core/src/versions/index.ts` (Task 3.5) — see `packages/core/src/versions/index.test.ts`
 * for that battery. What remains here is specific to Claude's own table: that
 * every documented capability key is actually reachable through it, and that
 * the minimum is D102's hook-observation floor.
 */
describe("tablePermits", () => {
  it("covers every capability key, so no key is silently unreachable", () => {
    expect(CLAUDE_CAPABILITY_KEYS.length).toBeGreaterThan(0);
    for (const key of CLAUDE_CAPABILITY_KEYS) {
      expect(tablePermits(key, "2.1.280"), `${key} must be reachable`).toBe(
        true,
      );
    }
  });

  /**
   * D102 (6): the floor is the lowest version the installed hooks were
   * observed firing on (`hooks.md` §1 question 10), so every key is refused
   * one patch below it and permitted at it.
   */
  it("refuses every key below the 2.1.280 floor and accepts every key at it (D102)", () => {
    expect(CLAUDE_MINIMUM_VERSION).toBe("2.1.280");
    for (const key of CLAUDE_CAPABILITY_KEYS) {
      expect(tablePermits(key, "2.1.279"), key).toBe(false);
      expect(tablePermits(key, "2.1.142"), key).toBe(false);
      expect(tablePermits(key, "2.1.280"), key).toBe(true);
    }
  });

  /**
   * Regression, exercised through Claude's own real table rather than the
   * synthetic one in `packages/core/src/versions/index.test.ts`. The original
   * defect was a comparison returning `NaN` for unparsable input: `NaN !== 0`
   * propagated, `NaN < 0` was **false**, so the floor check did not refuse,
   * and every capability the probe had observed was granted on a version
   * string nobody could parse. `compareVersions` now returns `null` rather
   * than `NaN` and `tablePermits` in `@developer-os/core` refuses on `null`
   * — but nothing wired that fix to this adapter's own table until now, so a
   * regression in the wiring here (not the shared function) would have gone
   * unnoticed.
   */
  it("fails closed on a version it cannot parse, through Claude's own table", () => {
    for (const unparsable of ["garbage", "v2.1.216", "2.1", "", "2.1.216-rc.1"]) {
      expect(
        tablePermits("skills", unparsable),
        `${JSON.stringify(unparsable)} must not permit`,
      ).toBe(false);
    }
  });
});
