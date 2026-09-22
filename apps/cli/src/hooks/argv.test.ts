import { describe, expect, it } from "vitest";

import { hookLastResortExit, isHookInvocation, parseHookArgv } from "./argv.js";

describe("parseHookArgv", () => {
  it.each([
    [["guard", "command", "--vendor", "claude"], { ok: true, verb: "command", vendor: "claude" }],
    [["guard", "edit", "--vendor", "codex"], { ok: true, verb: "edit", vendor: "codex" }],
    [["brain", "status", "--inject", "--vendor", "claude"], { ok: true, verb: "inject", vendor: "claude" }],
  ])("accepts %j", (argv, expected) => {
    expect(parseHookArgv(argv)).toStrictEqual(expected);
  });

  it.each([
    [["guard", "command", "--vendor", "bogus"], "closed"],
    [["guard", "commit"], "closed"],
    [["guard", "path", "--vendor", "claude", "--json"], "closed"],
    [["guard", "prompt", "--vendor", "bogus"], "open"],
    [["guard", "nonsense", "--vendor", "claude"], "open"],
    [["guard", "toString", "--vendor", "claude"], "open"],
    [["brain", "status", "--inject", "--json", "--vendor", "claude"], "open"],
    [["brain", "status", "--inject"], "open"],
  ])("refuses %j with fail mode %s", (argv, failMode) => {
    expect(parseHookArgv(argv)).toMatchObject({ ok: false, failMode, vendor: "claude" });
  });

  it("routes every argv beginning with guard, or containing --inject, to hook mode", () => {
    expect(isHookInvocation(["guard"])).toBe(true);
    expect(isHookInvocation(["brain", "status", "--inject"])).toBe(true);
    expect(isHookInvocation(["brain", "status"])).toBe(false);
  });

  it("uses the exit of the argv's own fail mode as the last resort", () => {
    expect(hookLastResortExit(["guard", "path"])).toBe(2);
    expect(hookLastResortExit(["guard", "stop", "--vendor", "claude"])).toBe(0);
    expect(hookLastResortExit(["brain", "status", "--inject"])).toBe(0);
  });
});
