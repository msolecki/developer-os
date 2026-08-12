import { describe, expect, it } from "vitest";
import type { CapabilityVersionTable } from "./index.js";
import { compareVersions, tablePermits } from "./index.js";

describe("compareVersions", () => {
  it("orders numerically, not lexically", () => {
    expect(compareVersions("2.1.9", "2.1.10")).toBeLessThan(0);
    expect(compareVersions("2.1.216", "2.1.216")).toBe(0);
    expect(compareVersions("2.2.0", "2.1.999")).toBeGreaterThan(0);
  });

  it("orders by major before minor before patch", () => {
    expect(compareVersions("3.0.0", "2.99.99")).toBeGreaterThan(0);
    expect(compareVersions("2.2.0", "2.1.0")).toBeGreaterThan(0);
  });
});

describe("compareVersions on input that is not a version", () => {
  /**
   * Regression, found by fresh-context review of Tasks 1–5 on 2026-08-11.
   *
   * `Number("garbage")` is `NaN`, `NaN !== 0` is true, so the loop returned
   * `NaN` — and `NaN < 0` is **false**, so the floor check in `tablePermits`
   * did not refuse. Every capability the probe observed was then granted on a
   * version string nobody could parse. A comparison that cannot answer must
   * say so, not return a number that silently fails every inequality.
   */
  it("reports that it cannot compare, rather than returning NaN", () => {
    expect(compareVersions("garbage", "2.1.142")).toBeNull();
    expect(compareVersions("2.1.142", "garbage")).toBeNull();
    expect(compareVersions("v2.1.216", "2.1.142")).toBeNull();
    expect(compareVersions("2.1", "2.1.142")).toBeNull();
    expect(compareVersions("2.1.216-rc.1", "2.1.142")).toBeNull();
    expect(compareVersions("", "2.1.142")).toBeNull();
  });

  /**
   * Regression: `discoverCli`'s `VERSION_PATTERN`
   * (`packages/security/src/cli.ts`) already forbids a leading zero per
   * component (`(?:0|[1-9]\d*)`), and DOS-P3 narrowed workflow versions the
   * same way (`packages/workflow-schema/src/contract.ts`). `compareVersions`
   * disagreed: its `(\d+)` component accepted `01.2.3`, so
   * `compareVersions("01.2.3", "1.2.3")` returned `0` instead of refusing to
   * compare. Unreachable while this function was internal to one adapter;
   * Task 3.5 put it on `@developer-os/core`'s public door, callable by
   * anything.
   */
  it("reports that it cannot compare a version with a leading zero", () => {
    expect(compareVersions("01.2.3", "1.2.3")).toBeNull();
    expect(compareVersions("1.2.3", "01.2.3")).toBeNull();
    expect(compareVersions("1.02.3", "1.2.3")).toBeNull();
    expect(compareVersions("1.2.03", "1.2.3")).toBeNull();
  });
});

/**
 * A synthetic table, not a vendor's. `compareVersions` and the floor logic
 * moved here so both adapters share one copy; the table itself stays with
 * each vendor (Task 3.5), so this suite proves the generic mechanism with
 * data that owes nothing to Claude or Codex.
 */
type SyntheticKey = "alpha" | "beta" | "gamma" | "delta";

const MINIMUM = "2.1.142";

/**
 * `beta`'s floor sits above `MINIMUM` on purpose — see the tests below that
 * exercise the version-between-the-two branch, which a table of all-null
 * floors (as Claude's was, until Codex needed a real one) never reaches.
 *
 * `delta`'s floor is not a version at all. `table.floors` is vendor-supplied
 * data, not something this function controls, so `compareVersions` returning
 * `null` for a malformed *floor* — not just a malformed probed version — has
 * to be exercised too, or the `aboveFloor !== null` guard in `tablePermits`
 * is dead code no test would catch breaking.
 */
const TABLE: CapabilityVersionTable<SyntheticKey> = {
  minimum: MINIMUM,
  floors: new Map([
    ["alpha", null],
    ["beta", "2.1.200"],
    ["delta", "not-a-version"],
  ]),
};

describe("tablePermits", () => {
  it("fails closed on a version it cannot parse", () => {
    for (const unparsable of ["garbage", "v2.1.216", "2.1", "", "2.1.216-rc.1"]) {
      expect(
        tablePermits(TABLE, "alpha", unparsable),
        `${JSON.stringify(unparsable)} must not permit`,
      ).toBe(false);
    }
  });

  it("permits a version above the minimum when the floor is null", () => {
    expect(tablePermits(TABLE, "alpha", "2.1.216")).toBe(true);
  });

  it("permits an unknown newer version rather than refusing it", () => {
    expect(tablePermits(TABLE, "alpha", "9.9.9")).toBe(true);
  });

  it("refuses a version below the minimum", () => {
    expect(tablePermits(TABLE, "alpha", "1.0.0")).toBe(false);
  });

  it("permits exactly at the minimum, so the floor is inclusive", () => {
    expect(tablePermits(TABLE, "alpha", MINIMUM)).toBe(true);
  });

  /**
   * The `floors` map omits this key entirely — not `null`, absent. `Map#get`
   * returns `undefined`, and `tablePermits` must refuse on that branch rather
   * than treating a missing entry as "no documented floor".
   */
  it("refuses a key the floors map omits entirely", () => {
    expect(tablePermits(TABLE, "gamma", "9.9.9")).toBe(false);
  });

  /**
   * The defect `workflow-schema`'s architecture note §9 records four times: a
   * lookup over a plain object literal resolves `toString` through
   * `Object.prototype`, returns a `Function`, passes an `!== undefined` guard,
   * and crashes one line later — while the declared type says that value
   * cannot exist. `floors` is a `Map`, so a key named `toString` is simply
   * absent, and the mechanism that refuses it is the `Map`, not a denylist of
   * hostile names.
   */
  it("refuses an inherited key rather than resolving it through the prototype", () => {
    for (const hostile of ["toString", "constructor", "valueOf", "__proto__"]) {
      expect(
        tablePermits(TABLE, hostile as SyntheticKey, "2.1.216"),
        `${hostile} must not resolve`,
      ).toBe(false);
    }
  });

  it("refuses a version between the minimum and a floor set above it", () => {
    expect(tablePermits(TABLE, "beta", "2.1.150")).toBe(false);
  });

  it("permits a version at or above a floor set above the minimum", () => {
    expect(tablePermits(TABLE, "beta", "2.1.200")).toBe(true);
    expect(tablePermits(TABLE, "beta", "2.1.216")).toBe(true);
  });

  it("refuses closed when the table's own floor is not a parseable version", () => {
    expect(tablePermits(TABLE, "delta", "9.9.9")).toBe(false);
  });
});
