import { describe, expect, it } from "vitest";

import { buildLauncherEnvironment, LauncherEnvironmentError } from "./environment.js";

const envFixture = {
  home: "/Users/test",
  productHome: "/Users/test/.developer-os",
  brainOverride: null,
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
});
