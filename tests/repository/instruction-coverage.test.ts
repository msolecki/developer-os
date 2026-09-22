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

/** Each Markdown table in `text`, as rows of cells without the header and divider lines. */
function tables(text: string): readonly (readonly (readonly string[])[])[] {
  return text
    .split(/\n(?!\|)/u)
    .map((block) => block.split("\n").filter((line) => line.startsWith("|")))
    .filter((lines) => lines.length > 2)
    .map((lines) =>
      lines.slice(2).map((line) =>
        line
          .slice(1, -1)
          .split(/(?<!\\)\|/u)
          .map((cell) => cell.trim()),
      ),
    );
}

function tableRows(text: string): readonly (readonly string[])[] {
  return tables(text)[0] ?? [];
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
  const [pluginTable = [], dispositions = []] = tables(section(3));
  const pluginRefusals = new Set(
    dispositions.filter(refused).map((row) => ticks(row[0] ?? "")[0] ?? ""),
  );
  const plugin = pluginTable
    .flatMap((row) => ticks(row[2] ?? "").filter((name) => BARE_NAME.test(name)))
    .filter((name) => !pluginRefusals.has(name));
  // D51 refused every §7 row; a future "skills in A12" row that is not refused joins the set.
  const research = tableRows(section(7))
    .filter((row) => (row[1] ?? "").startsWith("skills in A12") && !refused(row))
    .flatMap((row) => ticks(row[0] ?? ""));

  for (const [label, names] of [
    ["§1", rules],
    ["§2", styles],
    ["§3", plugin],
    ["§3 dispositions", [...pluginRefusals]],
  ] as const) {
    expect(names.length, `${label} yielded no names`).toBeGreaterThan(0);
  }
  return new Set([...rules, ...styles, ...plugin, ...research]);
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
      "rules-lazy/lessons-code.md",
    ]) {
      expect(expected, name).toContain(name);
    }
    for (const name of [
      "brain-search",
      "release",
      "rev-eng",
      "wrap-up",
      "react-best-practices",
      "claudeception",
      "excalidraw-diagram",
      "research",
    ]) {
      expect(expected, name).not.toContain(name);
    }
    expect(expected.size).toBe(33);
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
