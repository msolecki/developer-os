import { describe, expect, it } from "vitest";
import {
  assertHookExecutablePath,
  HOOK_GUARD_KINDS,
  HOOK_VENDORS,
  HookExecutablePathError,
  renderHookCommand,
} from "./contract.js";

describe("hook contract", () => {
  it("renders the exact §4.1 command bytes", () => {
    expect(renderHookCommand("/Users/synthetic/.developer-os/bin/developer-os", "command", "claude"))
      .toBe("/Users/synthetic/.developer-os/bin/developer-os guard command --vendor claude");
    expect(renderHookCommand("/Users/synthetic/.developer-os/bin/developer-os", "inject", "codex"))
      .toBe("/Users/synthetic/.developer-os/bin/developer-os brain status --inject --vendor codex");
  });

  it.each([
    "relative/developer-os", "/a b/developer-os", "/a/'x'/developer-os", "/a/$HOME/x", "/a/../x",
    "/a//x", "/a/./x", "/a/1.2.3/developer-os", "/a/0123456789abcdef/developer-os", "/a/x;rm",
  ])("refuses the unsafe or unstable path %s", (path) => {
    expect(() => {
      assertHookExecutablePath(path);
    }).toThrow(HookExecutablePathError);
  });

  it("keeps the verb set equal to the CLI's closed set", () => {
    expect(HOOK_GUARD_KINDS).toStrictEqual(["command", "path", "commit", "stop", "format", "prompt", "edit"]);
    expect(HOOK_VENDORS).toStrictEqual(["claude", "codex"]);
  });
});
