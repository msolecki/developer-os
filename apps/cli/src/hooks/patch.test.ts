import { describe, expect, it } from "vitest";

import { applyPatchPaths, MAX_PATCH_HEADERS } from "./patch.js";

const patch = (...lines: string[]): string => ["*** Begin Patch", ...lines, "*** End Patch", ""].join("\n");

describe("applyPatchPaths", () => {
  it("reads every observed header and skips body lines", () => {
    expect(
      applyPatchPaths(
        patch(
          "*** Add File: note.txt",
          "+synthetic",
          "*** Update File: sub/a.ts",
          "*** Move to: sub/b.ts",
          "@@",
          "-synthetic",
          "+synthetic2",
          " context",
          "*** Delete File: old.txt",
        ),
      ),
    ).toStrictEqual(["note.txt", "sub/a.ts", "sub/b.ts", "old.txt"]);
  });

  it("accepts a body without a trailing newline", () => {
    expect(applyPatchPaths("*** Begin Patch\n*** Add File: a\n+x\n*** End Patch")).toStrictEqual(["a"]);
  });

  it.each([
    ["an absolute path", patch("*** Add File: /Users/synthetic/a")],
    ["a parent segment", patch("*** Update File: ../a")],
    ["a dot segment", patch("*** Update File: ./a")],
    ["an empty segment", patch("*** Update File: a//b")],
    ["a NUL byte", patch("*** Add File: a\0b")],
    ["an unobserved marker", patch("*** Update File: a", "@@", "-x", "+y", "*** End of File")],
    ["a line outside the grammar", patch("*** Add File: a", "plain")],
    ["an empty line", patch("*** Add File: a", "")],
    ["a missing begin marker", "*** Add File: a\n+x\n*** End Patch\n"],
    ["a missing end marker", "*** Begin Patch\n*** Add File: a\n+x\n"],
    ["no header at all", patch("+x")],
    ["an empty body", ""],
  ])("refuses %s", (_label, body) => {
    expect(applyPatchPaths(body)).toBeNull();
  });

  it(`accepts ${String(MAX_PATCH_HEADERS)} headers and refuses one more`, () => {
    const headers = (n: number): string[] => Array.from({ length: n }, (_, i) => `*** Add File: f${String(i)}`);
    expect(applyPatchPaths(patch(...headers(MAX_PATCH_HEADERS)))).toHaveLength(MAX_PATCH_HEADERS);
    expect(applyPatchPaths(patch(...headers(MAX_PATCH_HEADERS + 1)))).toBeNull();
  });
});
