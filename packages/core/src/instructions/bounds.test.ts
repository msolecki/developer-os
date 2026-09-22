import { describe, expect, it } from "vitest";

import {
  INSTRUCTION_BOUNDS_V1,
  InstructionSourceInvalidError,
  assertInstructionArtifactBounds,
  assertInstructionRelativePath,
  assertInstructionText,
  assertInstructionVendorBounds,
  assertNotWorkflowId,
  parseInstructionId,
  parseScopedRulePaths,
} from "./bounds.js";

const encoder = new TextEncoder();

function refusal(run: () => unknown): InstructionSourceInvalidError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(InstructionSourceInvalidError);
    return error as InstructionSourceInvalidError;
  }
  throw new Error("expected a refusal");
}

describe("InstructionIdV1", () => {
  it("admits 64 characters and refuses 65", () => {
    expect(parseInstructionId(`a${"b".repeat(63)}`)).toBe(`a${"b".repeat(63)}`);
    expect(() => parseInstructionId(`a${"b".repeat(64)}`)).toThrow();
  });

  it("refuses the product prefix, uppercase, a leading hyphen and the empty id", () => {
    expect(parseInstructionId("developer-os")).toBe("developer-os");
    for (const id of ["developer-os-review", "Review", "-review", "", "re_view"]) {
      expect(() => parseInstructionId(id)).toThrow();
    }
  });

  it("refuses a workflow id", () => {
    const workflows = new Set(["capture", "review"]);
    expect(workflows.size).toBeGreaterThan(0);
    expect(() => { assertNotWorkflowId(parseInstructionId("capture"), workflows); }).toThrow();
    expect(() => { assertNotWorkflowId(parseInstructionId("code-review"), workflows); }).not.toThrow();
  });
});

describe("assertInstructionRelativePath", () => {
  it("admits a 128-character segment and refuses 129", () => {
    expect(() => { assertInstructionRelativePath(`a${"b".repeat(127)}`); }).not.toThrow();
    expect(refusal(() => { assertInstructionRelativePath(`a${"b".repeat(128)}`); }).path).toBe(`a${"b".repeat(128)}`);
  });

  it("admits depth 4 and refuses depth 5", () => {
    expect(() => { assertInstructionRelativePath("a/b/c/SKILL.md"); }).not.toThrow();
    expect(refusal(() => { assertInstructionRelativePath("a/b/c/d/SKILL.md"); }).line).toBeNull();
  });

  it("refuses dot segments, empty segments, absolute paths and backslashes", () => {
    for (const path of ["", ".", "..", "a/../b", "/a", "a//b", "a/", "a\\b", ".hidden"]) {
      refusal(() => { assertInstructionRelativePath(path); });
    }
  });
});

describe("assertInstructionText", () => {
  it("admits exactly 262,144 bytes and refuses 262,145, naming the path only", () => {
    expect(() => { assertInstructionText("rules/a.md", new Uint8Array(INSTRUCTION_BOUNDS_V1.fileBytes).fill(0x61)); }).not.toThrow();
    const error = refusal(() => { assertInstructionText("rules/a.md", new Uint8Array(262_145).fill(0x61)); });
    expect(error.path).toBe("rules/a.md");
    expect(error.message).toBe("instruction_source_invalid: rules/a.md");
  });

  it("refuses a BOM on line 1", () => {
    expect(refusal(() => { assertInstructionText("a.md", Uint8Array.of(0xef, 0xbb, 0xbf, 0x61)); }).line).toBe(1);
  });

  it("refuses NUL and CR with the line, never the content", () => {
    const nul = refusal(() => { assertInstructionText("a.md", encoder.encode("secret\nsecret\0\n")); });
    expect(nul.line).toBe(2);
    expect(nul.message).not.toContain("secret");
    expect(refusal(() => { assertInstructionText("a.md", encoder.encode("a\r\nb\n")); }).line).toBe(1);
  });

  it("refuses invalid UTF-8 and admits multi-byte text", () => {
    refusal(() => { assertInstructionText("a.md", Uint8Array.of(0x61, 0xc3)); });
    expect(() => { assertInstructionText("a.md", encoder.encode("zażółć\n")); }).not.toThrow();
  });
});

describe("artifact and vendor bounds", () => {
  it("admits 64 files and refuses 65", () => {
    expect(() => { assertInstructionArtifactBounds("skills/a", Array<number>(64).fill(1)); }).not.toThrow();
    expect(refusal(() => { assertInstructionArtifactBounds("skills/a", Array<number>(65).fill(1)); }).path).toBe("skills/a");
  });

  it("admits 1 MiB per artifact and refuses 1 MiB + 1", () => {
    expect(() => { assertInstructionArtifactBounds("skills/a", [1_048_575, 1]); }).not.toThrow();
    refusal(() => { assertInstructionArtifactBounds("skills/a", [1_048_576, 1]); });
  });

  it("admits 128 artifacts and 8 MiB per vendor and refuses one more of either", () => {
    expect(() => { assertInstructionVendorBounds("claude", Array<number>(128).fill(1)); }).not.toThrow();
    refusal(() => { assertInstructionVendorBounds("claude", Array<number>(129).fill(1)); });
    expect(() => { assertInstructionVendorBounds("claude", Array<number>(8).fill(1_048_576)); }).not.toThrow();
    refusal(() => { assertInstructionVendorBounds("claude", [...Array<number>(8).fill(1_048_576), 1]); });
  });

  it("keeps the Codex block bound at 64 KiB (Task 2 observed no smaller limit)", () => {
    expect(INSTRUCTION_BOUNDS_V1.codexBlockBytes).toBe(65_536);
  });
});

describe("parseScopedRulePaths", () => {
  const rule = (frontmatter: string): string => `---\n${frontmatter}\n---\nbody\n`;

  it("reads a flow list, a block list and a scalar", () => {
    expect(parseScopedRulePaths("r.md", rule('paths: ["**/*.ts", \'src/**/*.{ts,tsx}\', app/page.tsx]'))).toStrictEqual([
      "**/*.ts",
      "src/**/*.{ts,tsx}",
      "app/page.tsx",
    ]);
    expect(parseScopedRulePaths("r.md", rule('name: x\npaths:\n  - "**/*.ts"\n  - src/a.ts\ndescription: y'))).toStrictEqual([
      "**/*.ts",
      "src/a.ts",
    ]);
    expect(parseScopedRulePaths("r.md", rule('paths: "**/*.md"'))).toStrictEqual(["**/*.md"]);
  });

  it("admits 32 globs and refuses 33", () => {
    const globs = (count: number): string => `paths: [${Array.from({ length: count }, (_, index) => `"g${String(index)}/**"`).join(", ")}]`;
    expect(parseScopedRulePaths("r.md", rule(globs(32)))).toHaveLength(32);
    expect(refusal(() => parseScopedRulePaths("r.md", rule(globs(33)))).line).toBe(2);
  });

  it("admits a 256-byte glob and refuses 257", () => {
    expect(parseScopedRulePaths("r.md", rule(`paths: ["${"a".repeat(256)}"]`))).toStrictEqual(["a".repeat(256)]);
    refusal(() => parseScopedRulePaths("r.md", rule(`paths: ["${"a".repeat(257)}"]`)));
  });

  it("refuses an empty list, a missing key, a duplicate key, missing frontmatter and an unquoted alias", () => {
    for (const text of [
      rule("paths: []"),
      rule("paths:"),
      rule("name: x"),
      rule('paths: ["a"]\npaths: ["b"]'),
      "paths: [\"a\"]\n",
      "---\npaths: [\"a\"]\n",
      rule("paths:\n  - **/*.ts"),
      rule("paths: [**/*.ts]"),
      rule('paths: ["a",]'),
      rule('paths: ["a"'),
    ]) {
      refusal(() => parseScopedRulePaths("r.md", text));
    }
  });
});
