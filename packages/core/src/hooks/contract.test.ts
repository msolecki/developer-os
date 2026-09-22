import { describe, expect, it } from "vitest";
import {
  assertHookExecutablePath,
  assertHookNodePath,
  HOOK_GUARD_KINDS,
  HOOK_VENDORS,
  HookExecutablePathError,
  renderHookCommand,
} from "./contract.js";

describe("hook contract", () => {
  const EXE = {
    node: "/opt/homebrew/Cellar/node@24/24.16.0/bin/node",
    entrypoint: "/Users/synthetic/.developer-os/bin/developer-os",
  };

  it("renders the exact two-token §4.1 command bytes (G1 as resolved)", () => {
    expect(renderHookCommand(EXE, "command", "claude"))
      .toBe(`${EXE.node} ${EXE.entrypoint} guard command --vendor claude`);
    expect(renderHookCommand(EXE, "inject", "codex"))
      .toBe(`${EXE.node} ${EXE.entrypoint} brain status --inject --vendor codex`);
  });

  it("renders identical bytes twice", () => {
    expect(renderHookCommand(EXE, "stop", "claude")).toBe(renderHookCommand(EXE, "stop", "claude"));
  });

  it("accepts a cellar-style Node path with a version segment", () => {
    expect(() => {
      assertHookNodePath(EXE.node);
    }).not.toThrow();
  });

  it.each(["relative/node", "/a b/node", "/a/../node", "/a//node", "/a/./node", "/a/x;rm"])(
    "refuses the unsafe Node path %s",
    (node) => {
      expect(() => {
        assertHookNodePath(node);
      }).toThrow(HookExecutablePathError);
      expect(() => renderHookCommand({ ...EXE, node }, "command", "claude")).toThrow(HookExecutablePathError);
    },
  );

  it.each(["/a/1.2.3/developer-os", "/a/0123456789abcdef/developer-os"])(
    "still refuses an entrypoint with a version or hash segment %s",
    (entrypoint) => {
      expect(() => renderHookCommand({ ...EXE, entrypoint }, "command", "claude")).toThrow(HookExecutablePathError);
    },
  );

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
