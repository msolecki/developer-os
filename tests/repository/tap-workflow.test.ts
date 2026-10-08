import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const workflow = await readFile(join(root, ".github/workflows/tap.yml"), "utf8");

/** Splits the `jobs:` section into `{ name: text }`. */
const jobsOf = (text: string): Record<string, string> => {
  const section = text.split(/^jobs:\n/mu)[1] ?? "";
  const out: Record<string, string> = {};
  for (const part of section.split(/^ {2}(?=[a-z][\w-]*:\n)/mu).filter(Boolean)) out[part.slice(0, part.indexOf(":"))] = part;
  return out;
};

/** Every security property as a list of violations; empty means the workflow is sound. */
const violations = (text: string): string[] => {
  const found: string[] = [];
  const jobs = jobsOf(text);
  const { formula = "", tap = "" } = jobs;
  if (!/^on:\n {2}release:\n {4}types: \[published\]\n(?=\n|\S)/mu.test(text) || text.includes("pull_request_target")) found.push("trigger");
  if (!/^permissions:\n {2}contents: read\n/mu.test(text)) found.push("top-level permissions");
  if (/["']?contents["']?\s*:\s*["']?write/u.test(text) || /^\s*permissions:\s*(?:write-all|\{)/mu.test(text)) found.push("contents write");
  if (/\b(?:pnpm|npm|node|corepack|setup-node)\b|actions\/checkout/u.test(tap.replace(/#.*$/gmu, ""))) found.push("tap runs repo tooling");
  if (!/^ {4}environment: tap$/mu.test(tap)) found.push("tap environment");
  if (!/persist-credentials: false/u.test(formula)) found.push("persist-credentials");
  if (formula.includes("TAP_PR_TOKEN") || Object.entries(jobs).some(([name, body]) => name !== "tap" && body.includes("TAP_PR_TOKEN"))) found.push("token outside tap");
  if (text.match(/secrets\.TAP_PR_TOKEN/gu)?.length !== 1) found.push("token count");
  const uses = text.split("\n").filter((row) => /^\s+(?:- )?uses:/u.test(row));
  if (uses.length < 4 || !uses.every((row) => /uses: [\w-]+\/[\w-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/u.test(row))) found.push("action pins");
  if (!/^ {4}needs: formula$/mu.test(tap)) found.push("needs");
  return found;
};

const mutations: Record<string, [string, (t: string) => string]> = {
  trigger: ["trigger", (t) => t.replace("types: [published]", "types: [published, created]")],
  "pull_request_target": ["trigger", (t) => t.replace("on:\n", "on:\n  pull_request_target:\n")],
  "top-level permissions": ["top-level permissions", (t) => t.replace(/^permissions:\n {2}contents: read/mu, "permissions:\n  contents: write")],
  "job permissions write": ["contents write", (t) => t.replace("    environment: tap\n", "    environment: tap\n    permissions:\n      \"contents\": write\n")],
  "tap checkout": ["tap runs repo tooling", (t) => t.replace("      - uses: actions/download-artifact", "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0\n      - uses: actions/download-artifact")],
  "tap node": ["tap runs repo tooling", (t) => t.replace("mkdir \"$RUNNER_TEMP/sums\"", "node x.js; mkdir \"$RUNNER_TEMP/sums\"")],
  "tap environment": ["tap environment", (t) => t.replace("    environment: tap\n", "")],
  "persist-credentials": ["persist-credentials", (t) => t.replace("persist-credentials: false", "persist-credentials: true")],
  "token in formula": ["token outside tap", (t) => t.replace("      - name: Install\n", "      - name: Install\n        env:\n          X: ${{ secrets.TAP_PR_TOKEN }}\n")],
  "tag pin": ["action pins", (t) => t.replace("# v4.6.2", "# v4")],
  "branch pin": ["action pins", (t) => t.replace(/@d3f86a106a0bac45b974a628896c90dbdf5c8093/u, "@v4")],
};

describe("tap.yml (A16 §2 steps 6-8)", () => {
  it("is sound as committed, with a non-empty set of jobs and actions", () => {
    expect(Object.keys(jobsOf(workflow)).sort()).toEqual(["formula", "tap"]);
    expect(violations(workflow)).toEqual([]);
  });

  for (const [name, [expected, mutate]] of Object.entries(mutations)) {
    it(`fails on the mutation: ${name}`, () => {
      const mutated = mutate(workflow);
      expect(mutated).not.toBe(workflow);
      expect(violations(mutated)).toContain(expected);
    });
  }

  it("verifies tarballs against SHA256SUMS before rendering, and re-verifies in the tap job", () => {
    const verify = workflow.indexOf("shasum -a 256 -c SHA256SUMS");
    expect(verify).toBeGreaterThan(-1);
    expect(workflow.indexOf("node tests/dist/tools/render-formula.js")).toBeGreaterThan(verify);
    expect(workflow).toContain('ruby -c "$RUNNER_TEMP/developer-os.rb"');
    const tap = jobsOf(workflow)["tap"] ?? "";
    expect(tap.indexOf("releases/download/${TAG}/")).toBeGreaterThan(-1);
    expect(tap.indexOf("sha256 not in SHA256SUMS")).toBeLessThan(tap.indexOf("secrets.TAP_PR_TOKEN"));
    expect(tap).toContain("gh pr create --repo msolecki/homebrew-developer-os");
  });

  it("reaches scripts with event data only through env, after validating the tag", () => {
    const rows = workflow.split("\n").filter((row) => row.includes("github.event.release"));
    expect(rows.length).toBeGreaterThan(0);
    for (const line of rows) expect(line).toMatch(/^\s+(?:TAG|ref): \$\{\{ github\.event\.release\.tag_name \}\}$/u);
    expect(workflow).toContain("^v[0-9]+\\.[0-9]+\\.[0-9]+$");
    for (const block of workflow.split(/^\s+run: /mu).slice(1)) expect(block.split(/\n {6}- /u)[0]).not.toContain("${{");
  });
});
