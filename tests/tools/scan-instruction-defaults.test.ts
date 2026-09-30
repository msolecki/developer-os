import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  listInstructionFiles,
  loadInstructionHosts,
  parsePatternFile,
  runInstructionScan,
  scanInstructionDefaults,
} from "./scan-instruction-defaults.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "instruction-scan-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function scanFixture(
  files: Readonly<Record<string, string>>,
  options: { readonly extra?: readonly RegExp[]; readonly hosts?: readonly string[] } = {},
): readonly { path: string; line: number; rule: string }[] {
  return scanInstructionDefaults(fixture(files), options.extra ?? [], options.hosts ?? []);
}

function rulesFor(line: string, hosts: readonly string[] = []): readonly string[] {
  return scanFixture({ "a.md": `${line}\n` }, { hosts }).map((finding) => finding.rule);
}

const sourceVariable = ["DEVELOPER", "OS", "SOURCE", "REPO"].join("_");
const providerToken = `ghp_${"a1".repeat(18)}`;
const privateKey = [
  "-----BEGIN PRIVATE KEY-----", // gitleaks:allow -- synthetic test fixture
  "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",
  "-----END PRIVATE KEY-----",
].join("\n");

describe("scanInstructionDefaults", () => {
  it("reports path and line only, never the matched text", () => {
    const findings = scanFixture({ "rules/a.md": "ok\nmail me at someone@example.org\n" });
    expect(findings).toStrictEqual([{ path: "rules/a.md", line: 2, rule: "email" }]);
  });

  it("finds nothing in neutral prose", () => {
    expect(
      scanFixture({ "rules/a.md": "Prefer small commits.\nRun the tests before pushing.\n" }),
    ).toStrictEqual([]);
  });

  it.each([
    ["secret:provider-token", `token ${providerToken}`, "token placeholder"],
    ["home-path", "see /Users/someone/projects/x", "see <product-home>/projects/x"],
    ["home-path", "see /home/someone/projects/x", "see <product-home>/x"],
    ["home-relative-path", "open ~/projects/notes.md", "open ~/.claude/settings.json"],
    ["home-relative-path", "open ~/.claudex/file", "open ~/.codex/AGENTS.md and ~/.developer-os"],
    ["email", "write to someone@example.org", "write to the maintainer"],
    ["url", "see https://private.example.net/path", "see the project documentation"],
    ["source-variable", `set ${sourceVariable}`, "set DEVELOPER_OS_HOME"],
    [
      "legacy-runtime",
      "read docs/superpowers/plans/legacy-runtime/notes.md",
      "read docs/superpowers/plans/current.md",
    ],
  ])("rule %s has a positive and a negative case", (rule, positive, negative) => {
    expect(rulesFor(positive)).toContain(rule);
    expect(rulesFor(negative)).not.toContain(rule);
  });

  it("admits a URL whose host is allowlisted, ignoring port and case", () => {
    expect(rulesFor("see https://Docs.Example.org:8443/a", ["docs.example.org"])).toStrictEqual([]);
    expect(rulesFor("see https://other.example.org/a", ["docs.example.org"])).toStrictEqual(["url"]);
  });

  it("reports a multi-line private key at its header line", () => {
    const findings = scanFixture({ "skills/x/SKILL.md": `intro\n${privateKey}\n` });
    expect(findings).toStrictEqual([
      { path: "skills/x/SKILL.md", line: 2, rule: "secret:private-key" },
    ]);
  });

  it("fails on an injected e-mail, home path and legacy-runtime path", () => {
    const findings = scanFixture({
      "rules/clean.md": "neutral\n",
      "rules/leak.md": [
        "neutral",
        "contact someone@example.org",
        "under /Users/someone/projects",
        "from docs/superpowers/plans/legacy-runtime/x.md",
        "",
      ].join("\n"),
    });
    expect(findings).toStrictEqual([
      { path: "rules/leak.md", line: 2, rule: "email" },
      { path: "rules/leak.md", line: 3, rule: "home-path" },
      { path: "rules/leak.md", line: 4, rule: "legacy-runtime" },
    ]);
  });

  it("names an extra pattern by its index and never by its text", () => {
    const findings = scanFixture(
      { "a.md": "first\nAcme Holdings shipped it\n" },
      { extra: [/nothing/u, /acme\s+holdings/iu] },
    );
    expect(findings).toStrictEqual([{ path: "a.md", line: 2, rule: "extra:2" }]);
  });

  it("parses one expression per non-empty pattern-file line", () => {
    const patterns = parsePatternFile("acme\n\n  beta corp  \n");
    expect(patterns.map((pattern) => pattern.source)).toStrictEqual(["acme", "beta corp"]);
  });

  it("reports an oversized file without scanning it", () => {
    const findings = scanFixture({ "big.md": `${"a".repeat(256 * 1024)}\n` });
    expect(findings).toStrictEqual([{ path: "big.md", line: 1, rule: "file-too-large" }]);
  });

  it("admits a file of exactly the cap", () => {
    expect(scanFixture({ "cap.md": "a".repeat(256 * 1024) })).toStrictEqual([]);
    // ~55 s locally and over 120 s on a hosted runner, before and after the D70 lane (NEW-130).
  }, 300_000);

  it("reports a symlink instead of following it", () => {
    const outside = fixture({ "secret.md": "someone@example.org\n" });
    const root = fixture({ "rules/a.md": "neutral\n" });
    symlinkSync(join(outside, "secret.md"), join(root, "rules", "link.md"));
    expect(scanInstructionDefaults(root, [], [])).toStrictEqual([
      { path: "rules/link.md", line: 1, rule: "not-regular-file" },
    ]);
    expect(listInstructionFiles(root)).toStrictEqual(["rules/a.md"]);
  });

  it("lists nested files relative to the root, sorted", () => {
    const root = fixture({ "skills/b/SKILL.md": "x\n", "catalog.json": "{}\n", "rules/a.md": "y\n" });
    expect(listInstructionFiles(root)).toStrictEqual([
      "catalog.json",
      "rules/a.md",
      "skills/b/SKILL.md",
    ]);
  });

  it("loads the checked-in host allowlist", () => {
    expect(Array.isArray(loadInstructionHosts())).toBe(true);
  });
});

describe("runInstructionScan", () => {
  function run(root: string): { readonly code: number; readonly output: string } {
    let output = "";
    const code = runInstructionScan(root, ["instructions", "templates/project"], [], (text) => {
      output += text;
    });
    return { code, output };
  }

  it("prints the scanned-file count per root and passes a clean non-empty set", () => {
    const result = run(fixture({ "instructions/a.md": "Neutral prose.\n", "templates/project/b.md": "More prose.\n" }));
    expect(result.output).toContain("instructions: 1 files scanned\n");
    expect(result.output).toContain("templates/project: 1 files scanned\n");
    expect(result.output).toContain("0 findings\n");
    expect(result.code).toBe(0);
  });

  it("fails when a root holds no file, even with zero findings", () => {
    const root = fixture({ "templates/project/b.md": "More prose.\n" });
    mkdirSync(join(root, "instructions"));
    const result = run(root);
    expect(result.output).toContain("instructions: 0 files scanned\n");
    expect(result.code).toBe(1);
  });
});
