import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

/** The Brain workflows whose rendered skills print a shell command built from vault data. */
const WORKFLOWS = ["brain-answer", "brain-compile", "brain-enhance", "brain-garden", "brain-report"];
const SKILLS = ["claude", "codex"].flatMap((host) =>
  WORKFLOWS.map((id) => `plugins/${host}/skills/developer-os-${id}/SKILL.md`),
);

/**
 * A note path comes from the vault, and a note body is copied from it: an
 * unquoted `$(…)` in the path, or a body line equal to a fixed heredoc word,
 * turns vault text into a shell command (phase 5b review I2).
 */
describe("rendered Brain skills keep vault text out of the shell", () => {
  it.each(SKILLS)("%s single-quotes every path and picks a heredoc word absent from the note", (skill) => {
    const text = readFileSync(join(ROOT, skill), "utf8");
    const heredocs = [...text.matchAll(/<<'([^']*)'/gu)].map((match) => match[1]);
    expect(heredocs.length).toBeGreaterThan(0);
    expect(heredocs.every((word) => word === "<word>")).toBe(true);
    expect(text).toContain("where <word> is a delimiter that appears on no line of the text");
    for (const [, path] of text.matchAll(/--note (\S+)/gu)) {
      if (path === "naming") continue;
      expect(path).toMatch(/^'<[a-z]+>'$/u);
    }
  });

  it("brain-garden prints its refactor and retire commands with single-quoted paths", () => {
    for (const host of ["claude", "codex"]) {
      const text = readFileSync(
        join(ROOT, `plugins/${host}/skills/developer-os-brain-garden/SKILL.md`),
        "utf8",
      );
      expect(text).toContain("developer-os brain refactor --merge '<source>' '<target>' --dry-run");
      expect(text).toContain("developer-os brain retire '<path>' --dry-run");
    }
  });
});
