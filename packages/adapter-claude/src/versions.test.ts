import { describe, expect, it } from "vitest";
import { compareVersions } from "@developer-os/core";
import { CLAUDE_CAPABILITY_KEYS, CLAUDE_MINIMUM_VERSION, tablePermits } from "./versions.js";

/**
 * `compareVersions` and the generic floor mechanism moved to
 * `packages/core/src/versions/index.ts` (Task 3.5) — see `packages/core/src/versions/index.test.ts`
 * for that battery. What remains here is specific to Claude's own table: that
 * every documented capability key is actually reachable through it, and that
 * the minimum stays below the version gates Claude architecture former §5.2 deliberately avoids.
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
   * Claude architecture former §5.2 keeps the floor low on purpose by depending on none of the
   * documented version gates — `displayName` 2.1.143, `defaultEnabled` 2.1.154,
   * `metadata` 2.1.222. If the floor ever rises above the oldest of those, a
   * dependency crept in and Claude architecture former §14.1 needs revisiting.
   */
  it("keeps the minimum below every documented gate we deliberately avoid", () => {
    expect(compareVersions(CLAUDE_MINIMUM_VERSION, "2.1.143")).toBeLessThan(0);
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
