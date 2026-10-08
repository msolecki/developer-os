import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseUpdateArgv } from "@developer-os/cli/dist/commands/update/index.js";
import { parse } from "@developer-os/cli/dist/main.js";

import { releaseNotesOf } from "../tools/release-metadata.js";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const DOCS = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "docs/privacy.md",
  "docs/install/README.md",
  "docs/tutorials/claude-only.md",
  "docs/tutorials/codex-only.md",
  "docs/tutorials/dual-agent.md",
  "docs/troubleshooting/README.md",
] as const;

const text = new Map<string, string>();
for (const path of DOCS) text.set(path, await readFile(join(root, path), "utf8"));

/** Every `developer-os …` line inside a ```sh fence, as argv after the program name. */
function commandsOf(markdown: string): string[][] {
  const commands: string[][] = [];
  for (const fence of markdown.matchAll(/^```sh\n([\s\S]*?)^```$/gmu)) {
    for (const line of (fence[1] ?? "").split("\n")) {
      if (!line.startsWith("developer-os ")) continue;
      commands.push([...line.matchAll(/"([^"]*)"|(\S+)/gu)].map((token) => token[1] ?? token[2] ?? "").slice(1));
    }
  }
  return commands;
}

describe("public documentation set (A16 §4)", () => {
  it("has every file, non-empty, and no founder path", () => {
    for (const path of DOCS) {
      expect(text.get(path)?.trim().length ?? 0, path).toBeGreaterThan(200);
      expect(text.get(path), path).not.toMatch(/\/Users\//u);
    }
  });

  it("documents only commands the CLI parses", () => {
    const all = DOCS.flatMap((path) => commandsOf(text.get(path) ?? "").map((argv) => [path, argv] as const));
    expect(all.length).toBeGreaterThan(15);
    for (const [path, argv] of all) {
      const parsed = argv[0] === "update" ? parseUpdateArgv(argv) : parse(argv);
      expect(parsed, `${path}: developer-os ${argv.join(" ")}`).not.toBeNull();
    }
    for (const tutorial of ["docs/tutorials/claude-only.md", "docs/tutorials/codex-only.md", "docs/tutorials/dual-agent.md"]) {
      const verbs = new Set(commandsOf(text.get(tutorial) ?? "").map((argv) => argv[0]));
      for (const verb of ["init", "capture", "review", "ingest", "search"]) expect(verbs.has(verb), `${tutorial} runs ${verb}`).toBe(true);
    }
  });

  it("resolves every relative link", async () => {
    let links = 0;
    for (const path of DOCS) {
      for (const match of (text.get(path) ?? "").matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/gu)) {
        const target = match[1] ?? "";
        if (/^[a-z]+:/u.test(target)) continue;
        links += 1;
        await expect(stat(join(root, dirname(path), target)), `${path} → ${target}`).resolves.toBeDefined();
      }
    }
    expect(links).toBeGreaterThan(5);
  });

  it("states the network actions, the private reporting channel and the first beta's notes", () => {
    const privacy = text.get("docs/privacy.md") ?? "";
    expect(privacy).toContain("The product itself makes no network request.");
    expect(privacy).toContain("Homebrew");
    expect(text.get("SECURITY.md")).toContain("https://github.com/msolecki/developer-os/security/advisories/new");
    expect(releaseNotesOf(text.get("CHANGELOG.md") ?? "", "0.1.0").length).toBeGreaterThan(50);
  });
});
