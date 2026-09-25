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

  it.each([
    ["a space", " "],
    ["a tab", "\t"],
    ["a no-break space", "\u00a0"],
    ["an ideographic space", "\u3000"],
    ["a next-line character", "\u0085"],
  ])("refuses a header path with trailing whitespace: %s", (_label, space) => {
    expect(applyPatchPaths(patch(`*** Update File: .env${space}`, "@@", "-S=1", "+S=2"))).toBeNull();
    expect(applyPatchPaths(patch("*** Update File: a.txt", `*** Move to: .env${space}`, "@@", "-x", "+y"))).toBeNull();
    expect(applyPatchPaths(patch(`*** Add File: ${space}.env`, "+S=2"))).toBeNull();
  });

  it("refuses a header path edged with any Unicode White_Space character", () => {
    const spaces = Array.from({ length: 0x3001 }, (_, code) => String.fromCodePoint(code)).filter((c) =>
      /\p{White_Space}/u.test(c),
    );
    expect(spaces.length).toBeGreaterThan(20);
    for (const space of spaces) {
      expect(applyPatchPaths(patch(`*** Update File: .env${space}`, "@@", "-S=1", "+S=2"))).toBeNull();
      expect(applyPatchPaths(patch(`*** Add File: ${space}.env`, "+S=2"))).toBeNull();
    }
  });

  it("refuses a header smuggled behind leading whitespace as a context line", () => {
    expect(
      applyPatchPaths(patch("*** Add File: new.txt", "+x", " *** Update File: .env", "@@", "-S=1", "+S=pwned")),
    ).toBeNull();
    expect(applyPatchPaths(patch("*** Delete File: z.txt", " *** Add File: .env.local", "+S=1"))).toBeNull();
  });

  it(`accepts ${String(MAX_PATCH_HEADERS)} headers and refuses one more`, () => {
    const headers = (n: number): string[] => Array.from({ length: n }, (_, i) => `*** Add File: f${String(i)}`);
    expect(applyPatchPaths(patch(...headers(MAX_PATCH_HEADERS)))).toHaveLength(MAX_PATCH_HEADERS);
    expect(applyPatchPaths(patch(...headers(MAX_PATCH_HEADERS + 1)))).toBeNull();
  });
});
