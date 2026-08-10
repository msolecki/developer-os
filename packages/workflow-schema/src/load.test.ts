import { describe, expect, it } from "vitest";

import { loadWorkflow } from "./load.js";

const VALID = `schemaVersion: 1
id: sample
version: 1.0.0
description: A sample.
triggers:
  - manual
inputs: {}
output: {}
capabilities: []
scopes:
  read:
    - content/_indexes/**
  write: []
refusals: []
steps:
  - id: a
    do: brain.search
validators: []
recovery:
  leaves: nothing
  resume: developer-os brain search
`;

describe("loadWorkflow", () => {
  it("loads and validates a well-formed workflow", () => {
    const result = loadWorkflow({ file: "workflows/sample/workflow.yaml", text: VALID });
    expect(result.errorCount).toBe(0);
    expect(result.contract?.id).toBe("sample");
  });

  it("turns a parse refusal into an error finding rather than throwing", () => {
    const result = loadWorkflow({
      file: "workflows/sample/workflow.yaml",
      text: `${VALID}...\nid: second\n`,
    });
    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.findings[0]?.rule).toBe("parse");
    expect(result.contract).toBeNull();
  });

  it("has a message for every parse refusal, including the one added late", () => {
    /**
     * `PARSE_MESSAGE` was `Record<string, string>`, which accepts any subset —
     * so `anchor-or-alias`, added by Task 2's review, would have shipped its
     * author the generic fallback. It is the refusal a human is most likely to
     * trip on innocently and least likely to guess from "could not be parsed".
     * The type is now `Record<ParseRefusal, string>`, so the next added reason
     * is a compile error instead.
     */
    const cases: readonly (readonly [string, string])[] = [
      ["a: &anchor 1\nb: *anchor\n", "anchor"],
      ["id: !!str a\n", "tagged"],
      ["id: a\n---\nid: b\n", "more than one YAML document"],
      ["id: a\nid: b\n", "well-formed"],
    ];
    for (const [text, expected] of cases) {
      const result = loadWorkflow({ file: "f.yaml", text });
      expect(result.findings[0]?.rule, text).toBe("parse");
      expect(result.findings[0]?.message, text).toContain(expected);
      expect(result.findings[0]?.message, text).not.toContain("could not be parsed");
    }
  });

  it("never echoes the file into the finding it reports", () => {
    const result = loadWorkflow({
      file: "workflows/sample/workflow.yaml",
      text: "id: a\nid: SECRET-SENTINEL\n",
    });
    expect(JSON.stringify(result.findings)).not.toContain("SECRET-SENTINEL");
  });
});
