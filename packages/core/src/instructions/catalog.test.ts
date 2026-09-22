import { describe, expect, it } from "vitest";

import { InstructionCatalogInvalidError, validateInstructionCatalog } from "./catalog.js";

const WORKFLOWS: ReadonlySet<string> = new Set(["brain-search", "capture", "doctor", "ingest", "review"]);

const skill = { category: "skill", id: "spec", legacyName: "spec", vendors: ["claude", "codex"], thinCommand: true };
const agent = { category: "agent", id: "qa-expert", legacyName: "qa-expert", vendors: ["claude", "codex"], thinCommand: false };
const rule = { category: "rule", id: "security", legacyName: "security.md", vendors: ["claude", "codex"], thinCommand: false };

function catalog(artifacts: readonly unknown[]): unknown {
  return { schemaVersion: 1, artifacts };
}

function refuses(value: unknown): void {
  expect(() => validateInstructionCatalog(value, WORKFLOWS)).toThrow(InstructionCatalogInvalidError);
}

describe("validateInstructionCatalog", () => {
  it("admits a sorted, unique catalog and the empty scaffold", () => {
    expect(WORKFLOWS.size).toBeGreaterThan(0);
    const valid = validateInstructionCatalog(catalog([agent, rule, skill]), WORKFLOWS);
    expect(valid.artifacts.map((row) => `${row.category}/${row.id}`)).toStrictEqual(["agent/qa-expert", "rule/security", "skill/spec"]);
    expect(validateInstructionCatalog(catalog([]), WORKFLOWS)).toStrictEqual({ schemaVersion: 1, artifacts: [] });
  });

  it("refuses unknown, missing or extra keys at both levels", () => {
    refuses({ schemaVersion: 1, artifacts: [], extra: true });
    refuses({ artifacts: [] });
    refuses({ schemaVersion: 2, artifacts: [] });
    refuses(catalog([{ ...rule, extra: 1 }]));
    refuses(catalog([Object.fromEntries(Object.entries(rule).filter(([key]) => key !== "legacyName"))]));
    refuses(null);
    refuses([]);
  });

  it("refuses rows out of (category, id) order and duplicates", () => {
    refuses(catalog([skill, agent]));
    refuses(catalog([rule, { ...rule, id: "communication" }]));
    refuses(catalog([rule, rule]));
    expect(() => validateInstructionCatalog(catalog([{ ...rule, id: "communication" }, rule]), WORKFLOWS)).not.toThrow();
  });

  it("refuses thinCommand on a non-skill row", () => {
    refuses(catalog([{ ...agent, thinCommand: true }]));
  });

  it("refuses empty, unknown, duplicated or unsorted vendors", () => {
    refuses(catalog([{ ...rule, vendors: [] }]));
    refuses(catalog([{ ...rule, vendors: ["cursor"] }]));
    refuses(catalog([{ ...rule, vendors: ["claude", "claude"] }]));
    refuses(catalog([{ ...rule, vendors: ["codex", "claude"] }]));
    expect(() => validateInstructionCatalog(catalog([{ ...rule, vendors: ["codex"] }]), WORKFLOWS)).not.toThrow();
  });

  it("refuses the command and vendor-file categories, a bad id and a workflow id", () => {
    refuses(catalog([{ ...rule, category: "command" }]));
    refuses(catalog([{ ...rule, category: "vendor-file" }]));
    refuses(catalog([{ ...rule, id: "developer-os-security" }]));
    refuses(catalog([{ ...skill, id: "capture" }]));
    refuses(catalog([{ ...rule, legacyName: "" }]));
  });
});
