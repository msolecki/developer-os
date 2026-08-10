import { describe, expect, it } from "vitest";

import { BRAIN_MIGRATIONS } from "./index.js";

describe("BRAIN_MIGRATIONS", () => {
  it("is empty, because there is no prior schema version", () => {
    expect(BRAIN_MIGRATIONS).toEqual([]);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(BRAIN_MIGRATIONS)).toBe(true);
  });

  it("only ever contains migrations that move a version forward", () => {
    /**
     * Vacuous today, and written anyway: the invariant is pinned before the
     * first migration lands rather than after, so the day someone adds one
     * with `from >= to` — a loop, or a downgrade dressed as an upgrade — the
     * failure is already waiting.
     */
    for (const migration of BRAIN_MIGRATIONS) {
      expect(migration.from).toBeLessThan(migration.to);
      expect(Number.isInteger(migration.from)).toBe(true);
      expect(Number.isInteger(migration.to)).toBe(true);
    }
  });

  it("has no two migrations claiming the same starting version", () => {
    /** Also vacuous today: two paths out of one version is an ambiguity. */
    const froms = BRAIN_MIGRATIONS.map((migration) => migration.from);
    expect(new Set(froms).size).toBe(froms.length);
  });
});
