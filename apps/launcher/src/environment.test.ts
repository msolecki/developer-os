import { describe, expect, it } from "vitest";

import { buildLauncherEnvironment, LauncherEnvironmentError } from "./environment.js";

const envFixture = {
  home: "/Users/test",
  productHome: "/Users/test/.developer-os",
  brainOverride: null,
  vendorSearchPath: null,
  vendorHomes: {},
} as const;

describe("buildLauncherEnvironment", () => {
  it("passes only the closed path context", () => {
    expect(buildLauncherEnvironment(envFixture)).toEqual({
      HOME: "/Users/test",
      DEVELOPER_OS_HOME: "/Users/test/.developer-os",
    });
  });

  it("adds a valid Brain override without opening it", () => {
    expect(
      buildLauncherEnvironment({ ...envFixture, brainOverride: "/Users/test/DeveloperBrain" }),
    ).toEqual({
      HOME: "/Users/test",
      DEVELOPER_OS_HOME: "/Users/test/.developer-os",
      DEVELOPER_OS_BRAIN: "/Users/test/DeveloperBrain",
    });
  });

  it("refuses an invalid Brain override grammar before exec", () => {
    expect(() =>
      buildLauncherEnvironment({ ...envFixture, brainOverride: "relative/not/absolute" }),
    ).toThrow(LauncherEnvironmentError);
    try {
      buildLauncherEnvironment({ ...envFixture, brainOverride: "not-absolute" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LauncherEnvironmentError);
      expect((error as LauncherEnvironmentError).code).toBe(2);
    }
  });

  it("refuses a missing HOME before exec", () => {
    expect(() => buildLauncherEnvironment({ ...envFixture, home: "" })).toThrow(LauncherEnvironmentError);
  });

  it("refuses a non-absolute HOME before exec", () => {
    expect(() => buildLauncherEnvironment({ ...envFixture, home: "relative" })).toThrow(LauncherEnvironmentError);
  });

  it("refuses a HOME that is not canonical", () => {
    for (const home of ["/Users/x/../y", "/Users/./test", "/Users//test", "/Users/test/"]) {
      expect(() => buildLauncherEnvironment({ ...envFixture, home }), home).toThrow(LauncherEnvironmentError);
    }
  });

  it("refuses a HOME containing a NUL byte", () => {
    expect(() => buildLauncherEnvironment({ ...envFixture, home: "/Users/te\0st" })).toThrow(
      LauncherEnvironmentError,
    );
  });

  it("never inherits or merges the ambient process environment", () => {
    const result = buildLauncherEnvironment(envFixture);
    expect(Object.keys(result).sort()).toEqual(["DEVELOPER_OS_HOME", "HOME"]);
  });

  it("adds the received PATH as the vendor search path, and only that variable (NEW-202)", () => {
    const result = buildLauncherEnvironment({ ...envFixture, vendorSearchPath: "/opt/homebrew/bin:/usr/bin:/bin" });
    expect(result).toEqual({
      HOME: "/Users/test",
      DEVELOPER_OS_HOME: "/Users/test/.developer-os",
      DEVELOPER_OS_VENDOR_SEARCH_PATH: "/opt/homebrew/bin:/usr/bin:/bin",
    });
  });

  it("drops an empty, NUL-carrying or oversize vendor search path instead of refusing (NEW-202)", () => {
    for (const vendorSearchPath of ["", "/opt/homebrew/bin\0:/usr/bin", `/${"a".repeat(32 * 1024)}`]) {
      expect(Object.keys(buildLauncherEnvironment({ ...envFixture, vendorSearchPath })).sort()).toEqual([
        "DEVELOPER_OS_HOME",
        "HOME",
      ]);
    }
  });

  it("passes a valid CODEX_HOME and CLAUDE_CONFIG_DIR on unchanged (NEW-208)", () => {
    const vendorHomes = { CODEX_HOME: "/Users/test/codex-home", CLAUDE_CONFIG_DIR: "/Users/test/claude-config" };
    expect(buildLauncherEnvironment({ ...envFixture, vendorHomes })).toEqual({
      HOME: "/Users/test",
      DEVELOPER_OS_HOME: "/Users/test/.developer-os",
      ...vendorHomes,
    });
  });

  it("omits an absent or empty vendor home (NEW-208)", () => {
    for (const vendorHomes of [{}, { CODEX_HOME: undefined, CLAUDE_CONFIG_DIR: undefined }, { CODEX_HOME: "", CLAUDE_CONFIG_DIR: "" }]) {
      expect(Object.keys(buildLauncherEnvironment({ ...envFixture, vendorHomes })).sort()).toEqual(["DEVELOPER_OS_HOME", "HOME"]);
    }
  });

  it("refuses a NUL-carrying, relative or non-canonical vendor home with exit 2 before exec (NEW-208)", () => {
    for (const variable of ["CODEX_HOME", "CLAUDE_CONFIG_DIR"] as const) {
      for (const raw of ["/Users/test/co\0dex", "relative/codex", "/Users/test/../codex", "/Users/test/codex/"]) {
        try {
          buildLauncherEnvironment({ ...envFixture, vendorHomes: { [variable]: raw } });
          expect.unreachable(`${variable}=${raw}`);
        } catch (error) {
          expect(error).toBeInstanceOf(LauncherEnvironmentError);
          expect((error as LauncherEnvironmentError).code).toBe(2);
          expect((error as LauncherEnvironmentError).message).toContain(variable);
        }
      }
    }
  });
});
