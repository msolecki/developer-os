import { describe, expect, it } from "vitest";

import { admitGitDistribution, SUPPORTED_GIT_DISTRIBUTION, validateSupportedGitDistribution } from "./distribution.js";
import { mutate, observedFromRow, sameVersionOtherHash } from "./distribution.test-fixtures.js";
import { hashGitProcessTable } from "./process-table.js";
import { GIT_EXEC_PATH_LINK_NAMES, GIT_EXECUTABLE_IDS } from "./types.js";

const observedFields = Object.keys(observedFromRow(SUPPORTED_GIT_DISTRIBUTION));

describe("the supported Git distribution row", () => {
  it("round-trips the sole supported row byte-identically", () => {
    expect(validateSupportedGitDistribution(SUPPORTED_GIT_DISTRIBUTION)).toEqual(SUPPORTED_GIT_DISTRIBUTION);
    expect(hashGitProcessTable(SUPPORTED_GIT_DISTRIBUTION.processTable)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("admits the exact measured identity", () => {
    expect(() => { admitGitDistribution(observedFromRow(SUPPORTED_GIT_DISTRIBUTION), SUPPORTED_GIT_DISTRIBUTION); }).not.toThrow();
  });

  it("measures every identity field", () => {
    expect(observedFields.length).toBeGreaterThan(0);
    expect([...observedFields].sort()).toEqual(["architecture", "buildOptionLines", "execPathLinks", "executables", "xcode"]);
  });

  it.each(observedFields)("refuses a one-field change to %s as unsupported_git_distribution", (field) => {
    expect(() =>
      { admitGitDistribution(mutate(observedFromRow(SUPPORTED_GIT_DISTRIBUTION), field), SUPPORTED_GIT_DISTRIBUTION); },
    ).toThrow("unsupported_git_distribution");
  });

  it("refuses a same-version different binary", () => {
    expect(() => { admitGitDistribution(sameVersionOtherHash(), SUPPORTED_GIT_DISTRIBUTION); }).toThrow("unsupported_git_distribution");
  });

  it("refuses an observation with an extra or missing field", () => {
    const observed = observedFromRow(SUPPORTED_GIT_DISTRIBUTION);
    expect(() => { admitGitDistribution({ ...observed, extra: 1 } as typeof observed, SUPPORTED_GIT_DISTRIBUTION); }).toThrow(
      "unsupported_git_distribution",
    );
    const missing: Record<string, unknown> = { ...observed };
    delete missing.architecture;
    expect(() => { admitGitDistribution(missing as unknown as typeof observed, SUPPORTED_GIT_DISTRIBUTION); }).toThrow(
      "unsupported_git_distribution",
    );
  });

  it("refuses to admit against a row that is not the compiled row", () => {
    const row = structuredClone(SUPPORTED_GIT_DISTRIBUTION) as unknown as { buildOptionLines: string[] };
    row.buildOptionLines[0] = `${row.buildOptionLines[0] ?? ""}x`;
    expect(() => validateSupportedGitDistribution(row)).toThrow();
    expect(() =>
      { admitGitDistribution(observedFromRow(SUPPORTED_GIT_DISTRIBUTION), row as unknown as typeof SUPPORTED_GIT_DISTRIBUTION); },
    ).toThrow("unsupported_git_distribution");
  });

  it("pins thirteen build-option lines without the version line", () => {
    const main = SUPPORTED_GIT_DISTRIBUTION.executables.find((executable) => executable.id === "git_main");
    expect(SUPPORTED_GIT_DISTRIBUTION.buildOptionLines).toHaveLength(13);
    expect(main?.versionLines).toHaveLength(1);
    expect(SUPPORTED_GIT_DISTRIBUTION.buildOptionLines).not.toContain(main?.versionLines[0]);
  });

  it("pins the three executables in id order, with empty versionLines only for the HTTPS helper", () => {
    const ids = SUPPORTED_GIT_DISTRIBUTION.executables.map((executable) => executable.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual([...GIT_EXECUTABLE_IDS]);
    for (const executable of SUPPORTED_GIT_DISTRIBUTION.executables) {
      expect(executable.target.ownerUid).toBe(0);
      expect(executable.target.mode).toBe(0o755);
      expect(executable.versionLines.length === 0).toBe(executable.id === "git_remote_https");
    }
    const helper = SUPPORTED_GIT_DISTRIBUTION.executables.find((executable) => executable.id === "git_remote_https");
    expect(helper?.linkChain).toEqual([{ path: helper?.invokedPath, target: "git-remote-http" }]);
  });

  it("pins six exec-path links sorted by name", () => {
    const links = SUPPORTED_GIT_DISTRIBUTION.execPathLinks;
    expect(links.length).toBeGreaterThan(0);
    expect(links.map((link) => link.name)).toEqual([...GIT_EXEC_PATH_LINK_NAMES]);
    for (const link of links) {
      expect(link.path.endsWith(`/usr/libexec/git-core/${link.name}`)).toBe(true);
      expect([link.ownerUid, link.mode]).toEqual([0, 493]);
      expect([link.size, link.target]).toEqual(
        link.name === "git-remote-https" ? [15, "git-remote-http"] : [13, "../../bin/git"],
      );
    }
  });

  it("binds the process table to this row", () => {
    expect(SUPPORTED_GIT_DISTRIBUTION.processTable.distributionId).toBe(SUPPORTED_GIT_DISTRIBUTION.id);
  });

  it.each([
    ["schemaVersion", 2],
    ["id", "apple-git-000-arm64-xcode-0.0-000000a"],
    ["architecture", "x86_64"],
    ["extra", true],
  ])("refuses a row with %s changed", (field, value) => {
    expect(() => validateSupportedGitDistribution({ ...SUPPORTED_GIT_DISTRIBUTION, [field]: value })).toThrow();
  });

  it("refuses a row with twelve or fourteen build-option lines", () => {
    const lines = SUPPORTED_GIT_DISTRIBUTION.buildOptionLines;
    expect(() => validateSupportedGitDistribution({ ...SUPPORTED_GIT_DISTRIBUTION, buildOptionLines: lines.slice(1) })).toThrow();
    expect(() =>
      validateSupportedGitDistribution({ ...SUPPORTED_GIT_DISTRIBUTION, buildOptionLines: [...lines, "extra: line"] }),
    ).toThrow();
  });

  it("refuses a link whose size and target disagree", () => {
    const execPathLinks = SUPPORTED_GIT_DISTRIBUTION.execPathLinks.map((link) =>
      link.name === "git" ? { ...link, target: "git-remote-http" } : link,
    );
    expect(() => validateSupportedGitDistribution({ ...SUPPORTED_GIT_DISTRIBUTION, execPathLinks })).toThrow();
  });

  it("keeps the compiled row immutable", () => {
    expect(Object.isFrozen(SUPPORTED_GIT_DISTRIBUTION)).toBe(true);
    expect(Object.isFrozen(SUPPORTED_GIT_DISTRIBUTION.executables[0]?.target)).toBe(true);
  });
});
