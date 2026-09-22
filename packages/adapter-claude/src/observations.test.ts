import { describe, expect, it } from "vitest";
import {
  CLAUDE_DENY_RULES,
  CLAUDE_MEMORY_LAYOUT,
  isValidClaudeObservation,
  type ClaudeObservationV1,
} from "./observations.js";

const SYNTHETIC: ClaudeObservationV1 = {
  claudeVersion: "2.1.142",
  observedOn: "2026-01-15",
  observedIn: "A disposable home, a synthetic command, a synthetic result.",
};

function isSingleSegment(name: string): boolean {
  return name.length > 0 && !name.includes("/") && name !== "." && name !== "..";
}

describe("isValidClaudeObservation", () => {
  it("accepts a well-formed synthetic row", () => {
    expect(isValidClaudeObservation(SYNTHETIC)).toBe(true);
  });

  it("rejects a version that is not semver", () => {
    expect(isValidClaudeObservation({ ...SYNTHETIC, claudeVersion: "latest" })).toBe(false);
  });

  it("rejects a malformed, impossible or future date", () => {
    expect(isValidClaudeObservation({ ...SYNTHETIC, observedOn: "15-01-2026" })).toBe(false);
    expect(isValidClaudeObservation({ ...SYNTHETIC, observedOn: "2026-02-30" })).toBe(false);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(isValidClaudeObservation({ ...SYNTHETIC, observedOn: tomorrow })).toBe(false);
  });

  it("rejects an empty observedIn", () => {
    expect(isValidClaudeObservation({ ...SYNTHETIC, observedIn: " " })).toBe(false);
  });
});

describe("CLAUDE_MEMORY_LAYOUT", () => {
  it("is null or a valid observation of single-segment names", () => {
    const row = CLAUDE_MEMORY_LAYOUT;
    if (row === null) return;
    expect(isValidClaudeObservation(row)).toBe(true);
    const names = [row.projectsDirectory, row.memoryDirectory, row.extension, row.indexFileName];
    for (const name of names) expect(isSingleSegment(name), name).toBe(true);
  });
});

describe("CLAUDE_DENY_RULES", () => {
  it("is null or a valid observation with non-empty rule strings", () => {
    const row = CLAUDE_DENY_RULES;
    if (row === null) return;
    expect(isValidClaudeObservation(row)).toBe(true);
    const entries = Object.entries(row.rules);
    expect(entries.length).toBeGreaterThan(0);
    for (const [id, strings] of entries) {
      expect(strings.length, id).toBeGreaterThan(0);
      for (const text of strings) expect(text.length, id).toBeGreaterThan(0);
    }
  });
});
