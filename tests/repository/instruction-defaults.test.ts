import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  INSTRUCTION_SCAN_ROOTS,
  listInstructionFiles,
  scanInstructionDefaults,
} from "../tools/scan-instruction-defaults.js";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const INSTRUCTIONS = join(ROOT, "instructions");

describe("default instructions are redacted (foundation.md §12.1)", () => {
  it("enumerates the catalog, and every listed artifact once the catalog has rows", () => {
    const files = listInstructionFiles(INSTRUCTIONS);
    expect(files).toContain("catalog.json");
    const catalog = JSON.parse(readFileSync(join(INSTRUCTIONS, "catalog.json"), "utf8")) as {
      readonly artifacts: readonly unknown[];
    };
    if (catalog.artifacts.length > 0) {
      expect(files.filter((path) => path !== "catalog.json").length).toBeGreaterThan(0);
    }
  });

  it("scans instructions/ and templates/project/, each non-empty", () => {
    expect(INSTRUCTION_SCAN_ROOTS).toStrictEqual(["instructions", "templates/project"]);
    for (const root of INSTRUCTION_SCAN_ROOTS) {
      expect(listInstructionFiles(join(ROOT, root)).length, root).toBeGreaterThan(0);
    }
  });

  it.each(INSTRUCTION_SCAN_ROOTS)("finds nothing under %s/", (root) => {
    expect(scanInstructionDefaults(join(ROOT, root), [])).toStrictEqual([]);
  });
});
