import { describe, expect, it } from "vitest";

import { pathSegmentViolation } from "./segment.js";

describe("pathSegmentViolation", () => {
  it("accepts an ordinary segment", () => {
    expect(pathSegmentViolation("content")).toBeNull();
    expect(pathSegmentViolation("_indexes")).toBeNull();
    expect(pathSegmentViolation("my-content")).toBeNull();
    expect(pathSegmentViolation("café")).toBeNull();
  });

  it("refuses an empty segment", () => {
    expect(pathSegmentViolation("")).not.toBeNull();
  });

  it("refuses a NUL byte", () => {
    expect(pathSegmentViolation("a\0b")).not.toBeNull();
  });

  it("refuses a forward or back slash, since that stops being one segment", () => {
    expect(pathSegmentViolation("a/b")).not.toBeNull();
    expect(pathSegmentViolation("/etc")).not.toBeNull();
    expect(pathSegmentViolation("a\\b")).not.toBeNull();
  });

  it("refuses '.' and '..', the two relative-directory segments", () => {
    expect(pathSegmentViolation(".")).not.toBeNull();
    expect(pathSegmentViolation("..")).not.toBeNull();
  });

  /**
   * Regression: an earlier version of this predicate refused a bare glob
   * metacharacter, which this schema also governs `topicFolders` and
   * `topicAliases` through — so it refused ordinary vault directory names
   * that happen to use one, `!inbox` (the standard "sort to the top of an
   * alphabetical listing" convention) foremost among them. `loadConfig`
   * threw for any vault already using such a name, with no way to rewrite
   * the file to fix it either, since `serializeConfig` re-validates the same
   * value on the way out. The mitigation for a metacharacter now lives where
   * the splice into a glob happens (`resolveScopeGlob`'s escaping in
   * `packages/workflow-schema`), not here.
   */
  it.each([
    "!inbox",
    "!archive",
    "PROJECTS (2024)",
    "[archive]",
    "TODO!",
    "notes{drafts}",
    "content (v2)",
    "_indexes!",
    "Notatki (stare)",
  ])("accepts the ordinary directory name %s, a glob metacharacter alone is not a violation", (name) => {
    expect(pathSegmentViolation(name)).toBeNull();
  });

  it("names a distinct reason per remaining clause, so a caller can report it", () => {
    expect(pathSegmentViolation("")).toMatch(/empty/u);
    expect(pathSegmentViolation("a\0b")).toMatch(/NUL/u);
    expect(pathSegmentViolation("a/b")).toMatch(/segment/u);
    expect(pathSegmentViolation("..")).toMatch(/relative-directory/u);
  });
});
