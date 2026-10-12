import { parseStableSemver } from "@developer-os/core";
import { PROTECTED_PATH_RULES } from "@developer-os/security";
import { describe, expect, it } from "vitest";
import {
  CLAUDE_DENY_RULES,
  CLAUDE_MEMORY_LAYOUT,
  type ClaudeObservationV1,
} from "./observations.js";

function isPastOrTodayIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  // Date rolls 2026-02-30 over to March; the round trip rejects it.
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return false;
  return text <= new Date().toISOString().slice(0, 10);
}

/** A recorded observation names a stable Claude version, a real past date and where it was seen. */
function isValidClaudeObservation(row: ClaudeObservationV1): boolean {
  try {
    parseStableSemver(row.claudeVersion);
  } catch {
    return false;
  }
  return isPastOrTodayIsoDate(row.observedOn) && row.observedIn.trim().length > 0;
}

function isSingleSegment(name: string): boolean {
  return name.length > 0 && !name.includes("/") && name !== "." && name !== "..";
}

describe("CLAUDE_MEMORY_LAYOUT", () => {
  it("is a recorded, valid observation of single-segment names", () => {
    const row = CLAUDE_MEMORY_LAYOUT;
    expect(row).not.toBeNull();
    if (row === null) return;
    expect(isValidClaudeObservation(row)).toBe(true);
    const names = [row.projectsDirectory, row.memoryDirectory, row.extension, row.indexFileName];
    for (const name of names) expect(isSingleSegment(name), name).toBe(true);
  });
});

describe("CLAUDE_DENY_RULES", () => {
  it("is a recorded, valid observation with non-empty rule strings", () => {
    const row = CLAUDE_DENY_RULES;
    expect(row).not.toBeNull();
    if (row === null) return;
    expect(isValidClaudeObservation(row)).toBe(true);
    const entries = Object.entries(row.rules);
    expect(entries.length).toBeGreaterThan(0);
    for (const [id, strings] of entries) {
      expect(strings.length, id).toBeGreaterThan(0);
      for (const text of strings) expect(text.length, id).toBeGreaterThan(0);
    }
  });

  it("is keyed by exactly the protected-path rule ids", () => {
    const ids = PROTECTED_PATH_RULES.map((rule) => rule.id).sort();
    expect(ids.length).toBeGreaterThan(0);
    expect(Object.keys(CLAUDE_DENY_RULES?.rules ?? {}).sort()).toEqual(ids);
  });
});
