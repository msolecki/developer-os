import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const workflow = await readFile(join(root, ".github/workflows/check.yml"), "utf8");

/** Splits the `jobs:` section into `{ name: text }`. */
const jobsOf = (text: string): Record<string, string> => {
  const section = text.split(/^jobs:\n/mu)[1] ?? "";
  const out: Record<string, string> = {};
  for (const part of section.split(/^ {2}(?=[a-z][\w-]*:\n)/mu).filter((part) => /^[a-z]/u.test(part))) out[part.slice(0, part.indexOf(":"))] = part;
  return out;
};

const RELEASE_JOBS = ["release-version", "release", "tap"];
const withoutComments = (text: string): string => text.replace(/(?:^|\s)#.*$/gmu, "");

/** Every release-trigger property as a list of violations; empty means the wiring is sound. */
const violations = (text: string): string[] => {
  const found: string[] = [];
  const jobs = jobsOf(text);
  const { "release-version": version = "", release = "", tap = "" } = jobs;
  const tests = Object.keys(jobs).filter((name) => !RELEASE_JOBS.includes(name));

  if (!/^on:\n {2}push:\n {4}branches:\n {6}- development\n {6}- main\n {2}pull_request:\n {4}branches-ignore:\n {6}- main\n/mu.test(text)) found.push("trigger");
  if (!text.includes("  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}\n")) found.push("no cancel on main");

  // The release waits for every test job of the same run, on a push to main only.
  const needs = /^ {4}needs: \[([^\]]*)\]$/mu.exec(version)?.[1]?.split(", ") ?? [];
  if (tests.length === 0 || JSON.stringify([...needs].sort()) !== JSON.stringify([...tests].sort())) found.push("needs every test job");
  if (!version.includes("    if: github.event_name == 'push' && github.ref == 'refs/heads/main'\n")) found.push("main push only");
  if (!version.includes('git ls-remote --exit-code --tags origin "refs/tags/v${version}"') || !version.includes('2) echo "tag=v${version}" >> "$GITHUB_OUTPUT" ;;') || !version.includes("persist-credentials: false")) found.push("existing tag skipped");

  if (!/^ {4}needs: release-version\n {4}if: needs\.release-version\.outputs\.tag != ''\n/mu.test(release) || !release.includes("    uses: ./.github/workflows/release.yml\n")) found.push("release call");
  if (!/^ {4}needs: \[release-version, release\]\n/mu.test(tap) || !tap.includes("    uses: ./.github/workflows/tap.yml\n")) found.push("tap call");
  for (const call of [release, tap]) {
    if (!call.includes("    with:\n      tag: ${{ needs.release-version.outputs.tag }}\n")) found.push("tag input");
    if (/always\(\)|secrets:/u.test(call)) found.push("skip or secrets");
  }

  // Only the release call may write.
  const writes = [...withoutComments(text).matchAll(/:\s*["']?write/gu)].length;
  if (writes !== 1 || !/^ {4}permissions:\n {6}contents: write\n/mu.test(release) || /write-all/u.test(text)) found.push("permissions");
  return found;
};

const mutations: Record<string, [string, (t: string) => string]> = {
  "no main push": ["trigger", (t) => t.replace("      - development\n      - main\n", "      - development\n")],
  "pull requests into main": ["trigger", (t) => t.replace("  pull_request:\n    branches-ignore:\n      - main\n", "  pull_request:\n")],
  "cancel on main": ["no cancel on main", (t) => t.replace("cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}", "cancel-in-progress: true")],
  "a test job dropped": ["needs every test job", (t) => t.replace("needs: [lint, ", "needs: [")],
  "on any push": ["main push only", (t) => t.replace(" && github.ref == 'refs/heads/main'", "")],
  "existing tag released": ["existing tag skipped", (t) => t.replace('git ls-remote --exit-code --tags origin "refs/tags/v${version}"', "false")],
  "any ls-remote failure releases": ["existing tag skipped", (t) => t.replace('2) echo "tag=v${version}"', '*) echo "tag=v${version}"')],
  "tap on a skipped release": ["skip or secrets", (t) => t.replace("    needs: [release-version, release]\n", "    needs: [release-version, release]\n    if: always()\n")],
  "secrets inherited": ["skip or secrets", (t) => t.replace("    uses: ./.github/workflows/release.yml\n", "    uses: ./.github/workflows/release.yml\n    secrets: inherit\n")],
  "tag input from elsewhere": ["tag input", (t) => t.replace("    uses: ./.github/workflows/tap.yml\n    with:\n      tag: ${{ needs.release-version.outputs.tag }}", "    uses: ./.github/workflows/tap.yml\n    with:\n      tag: ${{ github.ref_name }}")],
  "release without tag": ["release call", (t) => t.replace("    if: needs.release-version.outputs.tag != ''\n", "")],
  "tap before release": ["tap call", (t) => t.replace("needs: [release-version, release]", "needs: release-version")],
  "test job writes": ["permissions", (t) => t.replace("  lint:\n", "  lint:\n    permissions:\n      contents: write\n")],
  "top-level write": ["permissions", (t) => t.replace(/^permissions:\n {2}contents: read/mu, "permissions:\n  contents: write")],
};

describe("check.yml releases on a push to main (D104)", () => {
  it("is sound as committed, with a non-empty set of test jobs", () => {
    const names = Object.keys(jobsOf(workflow));
    expect(names.filter((name) => !RELEASE_JOBS.includes(name)).length).toBeGreaterThan(0);
    expect(names.slice(-3)).toEqual(RELEASE_JOBS);
    expect(violations(workflow)).toEqual([]);
  });

  for (const [name, [expected, mutate]] of Object.entries(mutations)) {
    it(`fails on the mutation: ${name}`, () => {
      const mutated = mutate(workflow);
      expect(mutated).not.toBe(workflow);
      expect(violations(mutated)).toContain(expected);
    });
  }
});
