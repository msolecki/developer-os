import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const workflow = await readFile(join(root, ".github/workflows/tap.yml"), "utf8");

const code = (text: string): string => text.replace(/#.*$/gmu, "");

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
  const body = code(text);
  if (!/^on:\n {2}release:\n {4}types: \[published\]\n\n/mu.test(text) || body.includes("pull_request_target")) found.push("trigger");
  if (!/^permissions:\n {2}contents: read\n/mu.test(text)) found.push("top-level permissions");
  if (/["']?contents["']?\s*:\s*["']?write/u.test(body) || /permissions:\s*(?:write-all|\{)/u.test(body)) found.push("contents write");
  if (Object.keys(jobs).join() !== "tap") found.push("jobs");
  if (/\b(?:pnpm|npm|npx|node|corepack)\b|actions\/(?:checkout|setup-node|download-artifact|upload-artifact)/u.test(body)) found.push("repository code or tooling");
  if (!/^ {4}environment: tap$/mu.test(jobs["tap"] ?? "")) found.push("tap environment");
  if (text.match(/secrets\.TAP_PR_TOKEN/gu)?.length !== 1) found.push("token count");
  const steps = text.split(/^ {6}- name: /mu).slice(1);
  const withToken = steps.filter((step) => step.includes("secrets.TAP_PR_TOKEN"));
  if (withToken.length !== 1 || steps.at(-1) !== withToken[0] || !/git push/u.test(withToken[0] ?? "") || !/gh pr create/u.test(withToken[0] ?? "")) found.push("token step");
  if (steps.slice(0, -1).some((step) => /\bgh pr\b|git push/u.test(step))) found.push("push before the token step");
  if (/(?<![/\w.-])git\s/u.test(body)) found.push("bare git");
  const usesRows = text.split("\n").filter((row) => /^\s+(?:- )?uses:/u.test(row));
  if (usesRows.some((row) => !/uses: [\w-]+\/[\w-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/u.test(row))) found.push("action pins");
  for (const line of text.split("\n").filter((row) => row.includes("github.event.release"))) if (!/^\s+TAG: \$\{\{ github\.event\.release\.tag_name \}\}$/u.test(line)) found.push("event data outside env");
  for (const run of text.split(/^\s+run: \|\n/mu).slice(1)) if ((run.split(/\n {6}(?:- |#)/u)[0] ?? "").includes("${{")) found.push("expression in run");
  if (!/\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/u.test(text)) found.push("tag validation");
  return found;
};

const SHA = "11d5960a326750d5838078e36cf38b85af677262";
const mutations: Record<string, [string, (t: string) => string]> = {
  "extra trigger": ["trigger", (t) => t.replace("types: [published]", "types: [published, created]")],
  pull_request_target: ["trigger", (t) => t.replace("on:\n", "on:\n  pull_request_target:\n")],
  "top-level write": ["top-level permissions", (t) => t.replace(/^permissions:\n {2}contents: read/mu, "permissions:\n  contents: write")],
  "job write, quoted": ["contents write", (t) => t.replace("    environment: tap\n", '    environment: tap\n    permissions:\n      "contents": write\n')],
  "job write-all": ["contents write", (t) => t.replace("    environment: tap\n", "    environment: tap\n    permissions: write-all\n")],
  "second job": ["jobs", (t) => `${t}  formula:\n    runs-on: macos-15\n    steps:\n      - run: echo hi\n`],
  checkout: ["repository code or tooling", (t) => t.replace("    steps:\n", `    steps:\n      - uses: actions/checkout@${SHA} # v4.4.0\n`)],
  node: ["repository code or tooling", (t) => t.replace('mkdir "$RUNNER_TEMP/in"', 'node x.js; mkdir "$RUNNER_TEMP/in"')],
  pnpm: ["repository code or tooling", (t) => t.replace('mkdir "$RUNNER_TEMP/in"', 'pnpm build; mkdir "$RUNNER_TEMP/in"')],
  "no environment": ["tap environment", (t) => t.replace("    environment: tap\n", "")],
  "token in first step": ["token step", (t) => t.replace("          GH_TOKEN: ${{ github.token }}", "          GH_TOKEN: ${{ secrets.TAP_PR_TOKEN }}")],
  "token twice": ["token count", (t) => t.replace("          GH_TOKEN: ${{ github.token }}", "          X: ${{ secrets.TAP_PR_TOKEN }}\n          GH_TOKEN: ${{ github.token }}")],
  "push before token": ["push before the token step", (t) => t.replace('/usr/bin/git checkout -b "release/${TAG}"', "/usr/bin/git push origin x")],
  "bare git": ["bare git", (t) => t.replace("/usr/bin/git add", "git add")],
  "unpinned action": ["action pins", (t) => t.replace("    steps:\n", "    steps:\n      - uses: actions/cache@v4 # v4.0.0\n")],
  "pin without version comment": ["action pins", (t) => t.replace("    steps:\n", `    steps:\n      - uses: actions/cache@${SHA}\n`)],
  "event data in run": ["expression in run", (t) => t.replace('mkdir "$RUNNER_TEMP/in"', 'echo ${{ github.event.release.name }}; mkdir "$RUNNER_TEMP/in"')],
  "event data off TAG": ["event data outside env", (t) => t.replace("          GH_TOKEN: ${{ github.token }}", "          GH_TOKEN: ${{ github.token }}\n          NAME: ${{ github.event.release.name }}")],
  "no tag validation": ["tag validation", (t) => t.replaceAll("^v[0-9]+\\.[0-9]+\\.[0-9]+$", "^v.*$")],
};

describe("tap.yml (A16 §2 step 7)", () => {
  it("is sound as committed: one job, no repository code", () => {
    expect(Object.keys(jobsOf(workflow))).toEqual(["tap"]);
    expect(workflow.match(/^ {6}- name: /gmu)?.length).toBeGreaterThan(0);
    expect(violations(workflow)).toEqual([]);
  });

  for (const [name, [expected, mutate]] of Object.entries(mutations)) {
    it(`fails on the mutation: ${name}`, () => {
      const mutated = mutate(workflow);
      expect(mutated).not.toBe(workflow);
      expect(violations(mutated)).toContain(expected);
    });
  }

  it("edits through the script and checks the diff before any push", () => {
    expect(workflow).toContain("update-formula.sh");
    expect(workflow).toContain("git diff --numstat");
    expect(workflow.indexOf("git diff --numstat")).toBeLessThan(workflow.indexOf("git push"));
    expect(workflow).toContain("gh pr create --repo msolecki/homebrew-developer-os");
  });
});
