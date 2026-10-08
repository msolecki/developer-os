import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

// The admitted synthetic findings, pinned exactly: [rule, file, the full literal token].
const ADMITTED: readonly (readonly [string, string, string])[] = [
  ["aws-access-token", "packages/brain/src/garden/validate.test.ts", ["AKIA", "ABCDEFGHIJKLMNOP"].join("")],
  ["generic-api-key", "apps/cli/src/commands/automation/runner.test.ts", "sk-synthetic-0123456789abcdef"],
  ["generic-api-key", "apps/cli/src/lifecycle/runtime-records.test.ts", "sk-synthetic-0123456789abcdef"],
  ["generic-api-key", "apps/cli/src/commands/project-check.test.ts", "c3ludGhldGljLXRlc3QtbWF0ZXJpYWwtbm90LWtleQ=="],
  ["generic-api-key", "apps/cli/src/commands/review.test.ts", "0f1e2d3c4b5a697"],
  ["stripe-access-token", "packages/security/src/redaction.test.ts", ["sk_", "test_0123456789abcdef"].join("")],
  ["generic-api-key", "docs/superpowers/plans/2026-07-21-developer-os-program.md", "hourly/daily/weekly"],
  ["generic-api-key", "docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md", "unsigned-UTF-8"],
  ["stripe-access-token", "docs/superpowers/plans/2026-07-21-developer-os-knowledge-pipeline.md", ["sk_", "live_0123456789abcdef"].join("")],
];
const anchored = (literal: string): string => `^${literal.replace(/[.*+?^${}()|[\]\\/-]/gu, (c) => (c === "/" || c === "-" ? c : `\\${c}`))}$`;

interface Entry {
  readonly fields: Map<string, string | string[]>;
}

// A parser for exactly the TOML this file may use; any other line is a problem, not skipped.
function parse(text: string): { problems: string[]; extendDefault: boolean; entries: Entry[] } {
  const problems: string[] = [];
  const entries: Entry[] = [];
  let section = "";
  let extendDefault = false;
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    if (line === "[extend]" || line === "[[allowlists]]") {
      section = line;
      if (line === "[[allowlists]]") entries.push({ fields: new Map() });
      continue;
    }
    const m = /^(\w+) = (.+)$/u.exec(line);
    if (m === null) { problems.push(`unparsable: ${line}`); continue; }
    const [, key, value] = m as unknown as [string, string, string];
    if (section === "[extend]") { if (line === "useDefault = true") extendDefault = true; else problems.push(`extend: ${line}`); continue; }
    const entry = entries[entries.length - 1];
    if (section !== "[[allowlists]]" || entry === undefined) { problems.push(`stray: ${line}`); continue; }
    const str = /^"([^"\n]*)"$/u.exec(value);
    const list = /^\[(.*)\]$/u.exec(value);
    if (str !== null) entry.fields.set(key, str[1] ?? "");
    else if (list !== null) entry.fields.set(key, [...(list[1] ?? "").matchAll(/'''([^']*)'''|"([^"]*)"/gu)].map((x) => x[1] ?? x[2] ?? ""));
    else problems.push(`value: ${line}`);
  }
  if (!extendDefault) problems.push("must extend the default rules");
  return { problems, extendDefault, entries };
}

function audit(text: string): string[] {
  const { problems, entries } = parse(text);
  if (entries.length !== ADMITTED.length) problems.push(`expected ${String(ADMITTED.length)} entries, got ${String(entries.length)}`);
  const want = new Set(ADMITTED.map(([rule, file, token]) => JSON.stringify([rule, anchored(file), anchored(token)])));
  const got = new Set<string>();
  for (const { fields } of entries) {
    const keys = [...fields.keys()].sort().join(",");
    if (keys !== "condition,description,paths,regexes,targetRules") problems.push(`keys: ${keys}`);
    if (fields.get("condition") !== "AND") problems.push("condition must be AND");
    if (!/^.{12,}$/u.test(String(fields.get("description") ?? ""))) problems.push("description missing");
    const rules = fields.get("targetRules");
    const paths = fields.get("paths");
    const regexes = fields.get("regexes");
    if (![rules, paths, regexes].every((v) => Array.isArray(v) && v.length === 1)) { problems.push("rules, paths, regexes must each hold one item"); continue; }
    got.add(JSON.stringify([(rules as string[])[0], (paths as string[])[0], (regexes as string[])[0]]));
  }
  for (const w of want) if (!got.has(w)) problems.push(`missing entry ${w}`);
  for (const g of got) if (!want.has(g)) problems.push(`unexpected entry ${g}`);
  return problems;
}

describe(".gitleaks.toml (A16 §5)", () => {
  it("is exactly the nine pinned entries: AND, one rule, anchored path, anchored literal token, a reason", async () => {
    const text = await readFile(join(root, ".gitleaks.toml"), "utf8");
    expect(audit(text)).toEqual([]);
  });

  describe("rejects each weakening of the config", async () => {
    const text = await readFile(join(root, ".gitleaks.toml"), "utf8");
    const mutations: readonly (readonly [string, string])[] = [
      ["condition turned into OR", text.replace(/^condition = "AND"$/mu, 'condition = "OR"')],
      ["regex widened with .*", text.replace("^0f1e2d3c4b5a697$", "^0f1e2d3c4b5a697.*$")],
      ["regex target moved to the line", text.replace(/^condition = "AND"$/mu, 'condition = "AND"\nregexTarget = "line"')],
      ["path anchor dropped", text.replace("'''^apps/cli/src/commands/review", "'''apps/cli/src/commands/review")],
      ["catch-all entry added", `${text}\n[[allowlists]]\ndescription = "everything is fine here"\ncondition = "AND"\ntargetRules = ["generic-api-key"]\npaths = ['''.*''']\nregexes = ['''^.*$''']\n`],
      ["entry removed", text.replace(/\n\[\[allowlists\]\]\n(?:(?!\[\[allowlists\]\]).*\n)*?regexes = \['''\^sk_live_[^\n]*\n/u, "\n")],
      ["default rules dropped", text.replace("useDefault = true", "useDefault = false")],
      ["global allowlist added", `${text}\n[allowlist]\npaths = ['''.*''']\n`],
    ];
    it.each(mutations)("%s", (_name, mutated) => {
      expect(mutated).not.toBe(text);
      expect(audit(mutated)).not.toEqual([]);
    });
  });
});
