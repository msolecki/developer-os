import { describe, expect, it } from "vitest";
import {
  CLAUDE_CAPABILITY_KEYS,
  CLAUDE_MINIMUM_VERSION,
  compareVersions,
  tablePermits,
} from "./versions.js";

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
});

describe("tablePermits", () => {
  /** The same regression, at the gate that actually grants a capability. */
  it("fails closed on a version it cannot parse", () => {
    for (const unparsable of ["garbage", "v2.1.216", "2.1", "", "2.1.216-rc.1"]) {
      expect(
        tablePermits("skills", unparsable),
        `${JSON.stringify(unparsable)} must not permit`,
      ).toBe(false);
    }
  });

  it("permits a version above the minimum", () => {
    expect(tablePermits("session_end_capture", "2.1.216")).toBe(true);
  });

  it("permits an unknown newer version rather than refusing it", () => {
    expect(tablePermits("session_end_capture", "9.9.9")).toBe(true);
  });

  it("refuses a version below the minimum", () => {
    expect(tablePermits("session_end_capture", "1.0.0")).toBe(false);
  });

  it("permits exactly at the minimum, so the floor is inclusive", () => {
    expect(tablePermits("skills", CLAUDE_MINIMUM_VERSION)).toBe(true);
  });

  /**
   * The defect `workflow-schema`'s architecture note §9 records four times: a
   * lookup over a plain object literal resolves `toString` through
   * `Object.prototype`, returns a `Function`, passes an `!== undefined` guard,
   * and crashes one line later — while the declared type says that value
   * cannot exist. This table is a `Map` so the lookup cannot inherit.
   */
  it("refuses an inherited key rather than resolving it through the prototype", () => {
    for (const hostile of ["toString", "constructor", "valueOf", "__proto__"]) {
      expect(
        tablePermits(hostile as never, "2.1.216"),
        `${hostile} must not resolve`,
      ).toBe(false);
    }
  });

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
