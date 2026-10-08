import { describe, expect, it } from "vitest";

import { releaseNotesOf, releaseSequenceOf } from "./release-metadata.js";

describe("releaseSequenceOf (A16 §3.2)", () => {
  it.each([
    ["0.1.0", "1000"],
    ["0.0.1", "1"],
    ["0.12.3", "12003"],
    ["1.0.0", "1000000"],
    ["1.999.999", "1999999"],
    ["4294967295.0.0", "4294967295000000"],
  ])("maps %s to %s", (version, sequence) => {
    expect(releaseSequenceOf(version)).toBe(sequence);
  });

  it("increases strictly across the minor and major boundaries", () => {
    const ordered = ["0.0.1", "0.0.999", "0.1.0", "0.999.999", "1.0.0", "1.0.1"].map((version) => BigInt(releaseSequenceOf(version)));
    for (let index = 1; index < ordered.length; index += 1) expect((ordered[index] ?? 0n) > (ordered[index - 1] ?? 0n)).toBe(true);
  });

  it.each([
    ["0.0.0", /0\.0\.0/u],
    ["1.1000.0", /1\.1000\.0/u],
    ["1.0.1000", /1\.0\.1000/u],
    ["1.0.0-rc.1", /1\.0\.0-rc\.1/u],
    ["01.0.0", /01\.0\.0/u],
    ["1.0", /1\.0/u],
    ["v1.0.0", /v1\.0\.0/u],
  ])("refuses %s rather than wrapping", (version, message) => {
    expect(() => releaseSequenceOf(version)).toThrow(message);
  });
});

const CHANGELOG = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "## [0.2.0] - 2026-11-02",
  "",
  "### Fixed",
  "- second",
  "",
  "## [0.1.0] - 2026-10-20",
  "",
  "### Added",
  "- first",
  "",
].join("\n");

describe("releaseNotesOf (A16 §2 step 5)", () => {
  it("returns exactly the version's section", () => {
    expect(releaseNotesOf(CHANGELOG, "0.2.0")).toBe("### Fixed\n- second");
    expect(releaseNotesOf(CHANGELOG, "0.1.0")).toBe("### Added\n- first");
  });

  it("refuses a missing, empty or duplicated section", () => {
    expect(() => releaseNotesOf(CHANGELOG, "0.3.0")).toThrow(/no CHANGELOG\.md section for 0\.3\.0/u);
    expect(() => releaseNotesOf("## [0.1.0]\n\n## [0.0.9]\n- x\n", "0.1.0")).toThrow(/empty/u);
    expect(() => releaseNotesOf("## [0.1.0]\n- a\n## [0.1.0]\n- b\n", "0.1.0")).toThrow(/more than one/u);
  });

  it("does not match a version that only shares a prefix", () => {
    expect(() => releaseNotesOf("## [0.1.01]\n- x\n", "0.1.0")).toThrow(/no CHANGELOG\.md section/u);
  });
});
