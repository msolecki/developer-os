import { describe, expect, it } from "vitest";

import { isValidPathSegment, pathSegmentViolation } from "./segment.js";

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
   * The gap a prior implementation of this rule missed: none of the checks
   * above catch a bare glob metacharacter, and a value that passes every one
   * of them can still widen every glob it is later spliced into.
   */
  it.each(["*", "?", "[", "]", "{", "}", "(", ")", "!"])(
    "refuses the glob metacharacter %s",
    (character) => {
      expect(pathSegmentViolation(character)).not.toBeNull();
      expect(pathSegmentViolation(`content${character}`)).not.toBeNull();
    },
  );

  it("names a distinct reason per clause, so a caller can report it", () => {
    expect(pathSegmentViolation("")).toMatch(/empty/u);
    expect(pathSegmentViolation("a\0b")).toMatch(/NUL/u);
    expect(pathSegmentViolation("a/b")).toMatch(/segment/u);
    expect(pathSegmentViolation("..")).toMatch(/relative-directory/u);
    expect(pathSegmentViolation("*")).toMatch(/metacharacter/u);
  });
});

describe("isValidPathSegment", () => {
  it("is the boolean view of pathSegmentViolation", () => {
    expect(isValidPathSegment("content")).toBe(true);
    expect(isValidPathSegment("*")).toBe(false);
    expect(isValidPathSegment("..")).toBe(false);
  });
});
