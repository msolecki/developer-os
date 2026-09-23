import { describe, expect, it } from "vitest";

import {
  GIT_EFFECT_STAGING_SIDES,
  LAUNCHD_BOOTSTRAP_SNAPSHOT_CHILD,
  LAUNCHD_PROCESS_STAGING_CHILDREN,
  MAX_GIT_EFFECT_JOURNAL_BYTES,
  MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES,
  MAX_LAUNCHD_EFFECT_JOURNAL_BYTES,
  effectJournalBinding,
  parseEffectStagingChildren,
} from "./effect-ledger.js";

describe("the effect staging tables", () => {
  it("names the closed Git sides and launchd process children in byte order", () => {
    expect(GIT_EFFECT_STAGING_SIDES).toStrictEqual(["destination", "source"]);
    expect(LAUNCHD_PROCESS_STAGING_CHILDREN).toStrictEqual(["home", "tmp"]);
    for (const table of [GIT_EFFECT_STAGING_SIDES, LAUNCHD_PROCESS_STAGING_CHILDREN]) {
      expect(table.length).toBeGreaterThan(0);
      expect([...table].sort()).toStrictEqual([...table]);
    }
  });

  it("places the bootstrap snapshot inside tmp, never home", () => {
    expect(LAUNCHD_BOOTSTRAP_SNAPSHOT_CHILD).toBe("tmp/bootstrap-plist");
    expect(parseEffectStagingChildren(["tmp", LAUNCHD_BOOTSTRAP_SNAPSHOT_CHILD]).has("tmp/bootstrap-plist")).toBe(
      true,
    );
  });

  it("pins the spec §2.4 journal and snapshot ceilings", () => {
    expect(MAX_GIT_EFFECT_JOURNAL_BYTES).toBe(16_777_216);
    expect(MAX_LAUNCHD_EFFECT_JOURNAL_BYTES).toBe(1_048_576);
    expect(MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES).toBe(1_048_576);
  });
});

describe("parseEffectStagingChildren", () => {
  it("admits exact relative paths whose parents are all listed", () => {
    const children = ["post", "post/0", "before", "before/1", "post/2", "post/2/objects"];
    expect(children.length).toBeGreaterThan(0);
    expect([...parseEffectStagingChildren(children)]).toStrictEqual(children);
  });

  it("admits an empty answer", () => {
    expect(parseEffectStagingChildren([]).size).toBe(0);
  });

  it.each(["", "/post", "post/", "post//0", ".", "..", "post/..", "./post", "post/\0"])(
    "refuses the malformed child %j",
    (child) => {
      expect(() => parseEffectStagingChildren(["post", child])).toThrow();
    },
  );

  it("refuses a duplicate child", () => {
    expect(() => parseEffectStagingChildren(["post", "post"])).toThrow();
  });

  it("refuses a child whose parent is not listed", () => {
    expect(() => parseEffectStagingChildren(["post/0"])).toThrow();
    expect(() => parseEffectStagingChildren(["post", "post/2/objects"])).toThrow();
  });
});

describe("effectJournalBinding", () => {
  it("reads the journal's own ID, coordinator and plan hash", () => {
    expect(
      effectJournalBinding({ id: "ge_x_1", coordinatorId: "lc_x_0", planHash: "a".repeat(64), phase: "finalized" }),
    ).toStrictEqual({ id: "ge_x_1", coordinatorId: "lc_x_0", planHash: "a".repeat(64) });
  });

  it.each([
    null,
    "journal",
    7,
    [],
    {},
    { id: "ge_x_1", coordinatorId: "lc_x_0" },
    { coordinatorId: "lc_x_0", planHash: "a" },
    { id: "ge_x_1", planHash: "a" },
    { id: 1, coordinatorId: "lc_x_0", planHash: "a" },
    { id: "ge_x_1", coordinatorId: null, planHash: "a" },
  ])(
    "refuses a journal without a string id, coordinatorId and planHash: %j",
    (journal) => {
      expect(effectJournalBinding(journal)).toBeNull();
    },
  );
});
