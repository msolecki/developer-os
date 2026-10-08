import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const workflow = await readFile(join(root, ".github/workflows/tap.yml"), "utf8");

describe("tap.yml (A16 §2 step 7)", () => {
  it("runs only when a release is published, with read-only GITHUB_TOKEN", () => {
    expect(workflow).toMatch(/^on:\n {2}release:\n {4}types: \[published\]\n/mu);
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/mu);
    expect(workflow).not.toContain("contents: write");
    expect(workflow).not.toContain("pull_request_target");
  });

  it("pins every third-party action by full commit SHA", () => {
    const uses = workflow.split("\n").filter((row) => /^\s+- uses:/u.test(row));
    expect(uses.length).toBeGreaterThan(0);
    for (const row of uses) expect(row).toMatch(/uses: [\w-]+\/[\w-]+@[0-9a-f]{40}(?: #.*)?$/u);
  });

  it("verifies the published tarballs against SHA256SUMS before rendering", () => {
    const verify = workflow.indexOf("shasum -a 256 -c SHA256SUMS");
    const render = workflow.indexOf("node tests/dist/tools/render-formula.js");
    expect(verify).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(verify);
    expect(workflow).toContain('ruby -c "$RUNNER_TEMP/developer-os.rb"');
  });

  it("uses TAP_PR_TOKEN once, in the last step, against the tap repository only", () => {
    expect(workflow.match(/secrets\.TAP_PR_TOKEN/gu)?.length).toBe(1);
    expect(workflow).toContain("gh pr create --repo msolecki/homebrew-developer-os");
    expect(workflow).toContain("Formula/developer-os.rb");
    const steps = workflow.split(/^ {6}- /mu);
    expect(steps.at(-1)).toContain("secrets.TAP_PR_TOKEN");
    expect(steps.slice(0, -1).join("")).not.toContain("TAP_PR_TOKEN");
    expect(steps.at(-1)).not.toMatch(/\b(?:pnpm|npm|node)\b/u);
  });

  it("reaches scripts with event data only through env, after validating the tag", () => {
    const rows = workflow.split("\n").filter((row) => row.includes("github.event.release"));
    expect(rows.length).toBeGreaterThan(0);
    for (const line of rows) expect(line).toMatch(/^\s+(?:TAG|ref): \$\{\{ github\.event\.release\.tag_name \}\}$/u);
    expect(workflow).toContain("^v[0-9]+\\.[0-9]+\\.[0-9]+$");
    for (const block of workflow.split(/^\s+run: /mu).slice(1)) expect(block.split(/\n {6}- /u)[0]).not.toContain("${{");
  });
});
