import { describe, expect, it } from "vitest";

import { detectWorkflowDrift, firstDifferingLine, sourceMarker } from "./drift.js";

describe("firstDifferingLine", () => {
  it("returns null for identical text", () => {
    expect(firstDifferingLine("a\nb\n", "a\nb\n")).toBeNull();
  });

  it("names the first differing line, 1-based", () => {
    expect(firstDifferingLine("a\nb\n", "a\nc\n")).toBe(2);
  });

  it("reports a line past the end when one side is a prefix", () => {
    expect(firstDifferingLine("a\n", "a")).toBe(2);
  });
});

describe("sourceMarker", () => {
  it("names the canonical file and the contract version", () => {
    const marker = sourceMarker(
      { id: "sample", version: "1.2.0" },
      "workflows/sample/workflow.yaml",
    );
    expect(marker).toContain("workflows/sample/workflow.yaml");
    expect(marker).toContain("1.2.0");
    expect(marker.toLowerCase()).toContain("generated");
  });
});

describe("detectWorkflowDrift", () => {
  it("reports an artifact that has never been built", () => {
    const findings = detectWorkflowDrift(
      [{ path: "plugins/claude/sample.md", contents: "x\n" }],
      new Map(),
    );
    expect(findings).toStrictEqual([
      {
        path: "plugins/claude/sample.md",
        line: null,
        message:
          "this artifact has never been generated; run developer-os workflow render",
      },
    ]);
  });

  it("reports the first differing line and never a diff", () => {
    const findings = detectWorkflowDrift(
      [{ path: "plugins/claude/sample.md", contents: "a\nb\n" }],
      new Map([["plugins/claude/sample.md", "a\nSECRET\n"]]),
    );
    expect(findings[0]?.line).toBe(2);
    expect(JSON.stringify(findings)).not.toContain("SECRET");
  });

  it("finds nothing when every artifact matches", () => {
    expect(
      detectWorkflowDrift(
        [{ path: "p", contents: "a\n" }],
        new Map([["p", "a\n"]]),
      ),
    ).toStrictEqual([]);
  });

  it("reports every drifted artifact, not the first", () => {
    const findings = detectWorkflowDrift(
      [
        { path: "one", contents: "a\n" },
        { path: "two", contents: "b\n" },
        { path: "three", contents: "c\n" },
      ],
      new Map([
        ["one", "x\n"],
        ["three", "y\n"],
      ]),
    );
    expect(findings.map((finding) => finding.path)).toStrictEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("does not resolve an artifact path through the prototype chain", () => {
    /**
     * `onDisk` is a `Map` rather than a record for the reason three other
     * modules in this package were corrected: an artifact path of `toString`
     * would resolve to a `Function` on a plain object and be compared as if it
     * were file contents. A `Map` has no such chain, and this pins that the
     * parameter type stays one.
     */
    const findings = detectWorkflowDrift(
      [{ path: "toString", contents: "a\n" }],
      new Map(),
    );
    expect(findings[0]?.line).toBeNull();
    expect(findings[0]?.message).toContain("never been generated");
  });
});
