import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Expected red until the default-content tasks land every catalog row; the plan's
 * regeneration task is where it must be green.
 */
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const INVENTORY = readFileSync(join(ROOT, "docs/migration/instruction-inventory.md"), "utf8");
const BARE_NAME = /^[a-z][a-z0-9-]*$/u;

function section(number: number): string {
  const start = INVENTORY.indexOf(`\n## ${String(number)}. `);
  expect(start, `inventory §${String(number)}`).toBeGreaterThanOrEqual(0);
  const end = INVENTORY.indexOf("\n## ", start + 1);
  return INVENTORY.slice(start, end < 0 ? undefined : end);
}

function tableRows(text: string): readonly (readonly string[])[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .slice(2)
    .map((line) =>
      line
        .slice(1, -1)
        .split(/(?<!\\)\|/u)
        .map((cell) => cell.trim()),
    );
}

function ticks(text: string): readonly string[] {
  return [...text.matchAll(/`([^`]+)`/gu)].map((match) => match[1] ?? "");
}

function refused(row: readonly string[]): boolean {
  return /^refused\b/u.test(row.at(-1) ?? "");
}

function expectedLegacyNames(): ReadonlySet<string> {
  const rules = tableRows(section(1))
    .filter((row) => !refused(row))
    .map((row) => ticks(row[0] ?? "")[0] ?? "");
  const styleSentence = (section(2).split("\n\n")[1] ?? "").split(". ")[0] ?? "";
  const styles = ticks(styleSentence).filter((name) => BARE_NAME.test(name));
  const plugin = tableRows(section(3)).flatMap((row) =>
    ticks(row[2] ?? "").filter((name) => BARE_NAME.test(name)),
  );
  const research = tableRows(section(7))
    .filter((row) => (row[1] ?? "").startsWith("skills in A12") && !refused(row))
    .flatMap((row) => ticks(row[0] ?? ""));

  for (const [label, names] of [
    ["§1", rules],
    ["§2", styles],
    ["§3", plugin],
    ["§7", research],
  ] as const) {
    expect(names.length, `${label} yielded no names`).toBeGreaterThan(0);
  }
  const expected = new Set([...rules, ...styles, ...plugin, ...research]);
  expected.delete("brain-search");
  return expected;
}

describe("the catalog covers the inventory (spec §9, §10.2)", () => {
  it("parses the inventory into the expected names", () => {
    const expected = expectedLegacyNames();
    for (const name of [
      "rules/communication.md",
      "rules-lazy/typescript.md",
      "architect",
      "analizer",
      "code-reviewer",
      "weekly-report",
      "excalidraw-diagram",
    ]) {
      expect(expected, name).toContain(name);
    }
    expect(expected).not.toContain("brain-search");
  });

  it("lists every inventoried artifact exactly once", () => {
    const catalog = JSON.parse(
      readFileSync(join(ROOT, "instructions/catalog.json"), "utf8"),
    ) as { readonly artifacts: readonly { readonly legacyName: string }[] };
    const names = catalog.artifacts.map((row) => row.legacyName);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toStrictEqual([...expectedLegacyNames()].sort());
  });

  it("gives every §6 template row a status", () => {
    const rows = tableRows(section(6));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.at(-1) ?? "", row[0]).not.toBe("");
    }
  });
});
