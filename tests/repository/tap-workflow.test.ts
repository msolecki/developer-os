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

/** A job's steps, named or not (`- uses:` steps have no name). */
const stepsOf = (job: string): string[] => job.split(/^ {6}- /mu).slice(1);

const TOKEN = /secrets\.TAP_PR_TOKEN/gu;

/** Every security property as a list of violations; empty means the workflow is sound. */
const violations = (text: string): string[] => {
  const found: string[] = [];
  const jobs = jobsOf(text);
  const body = code(text);
  const edit = jobs["edit"] ?? "";
  const push = jobs["push"] ?? "";
  if (!/^on:\n {2}release:\n {4}types: \[published\]\n\n/mu.test(text) || body.includes("pull_request_target")) found.push("trigger");
  if (!/^permissions:\n {2}contents: read\n/mu.test(text)) found.push("top-level permissions");
  if (/["']?contents["']?\s*:\s*["']?write/u.test(body) || /permissions:\s*(?:write-all|\{)/u.test(body)) found.push("contents write");
  if (Object.keys(jobs).join() !== "edit,push") found.push("jobs");
  if (/actions\/(?:checkout|setup-node)/u.test(body)) found.push("checkout or setup-node");

  // edit runs the repository's script, so it holds no environment and no secret.
  if (/^ {4}environment:/mu.test(edit) || /secrets\./u.test(edit)) found.push("edit holds an environment or a secret");
  if (/actions\/download-artifact/u.test(edit) || !/actions\/upload-artifact/u.test(edit)) found.push("edit artifact");
  if (!edit.includes("update-formula.sh?ref=${GITHUB_SHA}\"")) found.push("script ref");

  // push holds the token, so it runs nothing from this repository.
  if (!/^ {4}environment: tap$/mu.test(push)) found.push("tap environment");
  if (!/^ {4}needs: edit$/mu.test(push)) found.push("push needs edit");
  const pushCode = code(push);
  if (/update-formula|GITHUB_SHA|\/contents\/|\.github\/|actions\/upload-artifact|\b(?:pnpm|npm|npx|node|corepack|bash|source|eval)\b/u.test(pushCode)) found.push("push runs repository code");
  if (!/actions\/download-artifact/u.test(push) || !pushCode.includes('[ "$actual" = "developer-os.rb" ]')) found.push("push accept list");
  if (/(?<![/\w.$-])(?:git|gh)\s/u.test(pushCode)) found.push("push bare git or gh");
  const gitCalls = pushCode.match(/\/usr\/bin\/git\b[^\n]*/gu) ?? [];
  if (gitCalls.length === 0 || gitCalls.some((call) => !call.startsWith("/usr/bin/git -c core.hooksPath=/dev/null "))) found.push("push git hooks");
  if (!/^ {10}gh=\/opt\/homebrew\/bin\/gh$/mu.test(push)) found.push("push gh path");
  const numstat = pushCode.indexOf("git -c core.hooksPath=/dev/null diff --numstat");
  if (numstat < 0 || numstat > pushCode.indexOf(" push origin")) found.push("diff check before push");

  // The token: exactly once, in push's last step, which is the only one that pushes.
  if (text.match(TOKEN)?.length !== 1 || edit.match(TOKEN) !== null) found.push("token count");
  const steps = stepsOf(push);
  const withToken = steps.filter((step) => step.includes("secrets.TAP_PR_TOKEN"));
  if (withToken.length !== 1 || steps.at(-1) !== withToken[0] || !/ push origin/u.test(withToken[0] ?? "") || !/ pr create/u.test(withToken[0] ?? "")) found.push("token step");
  if ([...stepsOf(edit), ...steps.slice(0, -1)].some((step) => /\bpr create\b| push origin/u.test(step))) found.push("push before the token step");

  if (/(?<![/\w.$-])git\s/u.test(body)) found.push("bare git");
  const usesRows = text.split("\n").filter((row) => /^\s+(?:- )?uses:/u.test(row));
  if (usesRows.some((row) => !/uses: [\w-]+\/[\w-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/u.test(row))) found.push("action pins");
  for (const line of text.split("\n").filter((row) => row.includes("github.event.release"))) if (!/^\s+TAG: \$\{\{ github\.event\.release\.tag_name \}\}$/u.test(line)) found.push("event data outside env");
  for (const run of text.split(/^\s+run: \|\n/mu).slice(1)) if ((run.split(/\n {6}(?:- |#)/u)[0] ?? "").includes("${{")) found.push("expression in run");
  if (!/\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/u.test(text)) found.push("tag validation");
  return found;
};

const SHA = "11d5960a326750d5838078e36cf38b85af677262";
const PUSH_RUN = 'artifact="$RUNNER_TEMP/formula"';
const inPush = (line: string) => (t: string): string => t.replace(PUSH_RUN, `${line}\n          ${PUSH_RUN}`);
const PUSH_STEPS = "    environment: tap\n    permissions:\n      contents: read\n    steps:\n";
const atPushSteps = (step: string) => (t: string): string => t.replace(PUSH_STEPS, `${PUSH_STEPS}${step}`);
const mutations: Record<string, [string, (t: string) => string]> = {
  "extra trigger": ["trigger", (t) => t.replace("types: [published]", "types: [published, created]")],
  pull_request_target: ["trigger", (t) => t.replace("on:\n", "on:\n  pull_request_target:\n")],
  "top-level write": ["top-level permissions", (t) => t.replace(/^permissions:\n {2}contents: read/mu, "permissions:\n  contents: write")],
  "job write, quoted": ["contents write", (t) => t.replace("    environment: tap\n", '    environment: tap\n    permissions:\n      "contents": write\n')],
  "job write-all": ["contents write", (t) => t.replace("    environment: tap\n", "    environment: tap\n    permissions: write-all\n")],
  "third job": ["jobs", (t) => `${t}  formula:\n    runs-on: macos-15\n    steps:\n      - run: echo hi\n`],
  "checkout in edit": ["checkout or setup-node", (t) => t.replace("    steps:\n", `    steps:\n      - uses: actions/checkout@${SHA} # v4.4.0\n`)],
  "edit with environment": ["edit holds an environment or a secret", (t) => t.replace("  edit:\n    runs-on: macos-15\n", "  edit:\n    runs-on: macos-15\n    environment: tap\n")],
  "token in edit": ["edit holds an environment or a secret", (t) => t.replace("          GH_TOKEN: ${{ github.token }}", "          GH_TOKEN: ${{ secrets.TAP_PR_TOKEN }}")],
  "download in edit": ["edit artifact", (t) => t.replace("    steps:\n", "    steps:\n      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0\n")],
  "script by moved tag": ["script ref", (t) => t.replace("?ref=${GITHUB_SHA}", "?ref=${TAG}")],
  "no environment": ["tap environment", (t) => t.replace("    environment: tap\n", "")],
  "push without needs": ["push needs edit", (t) => t.replace("    needs: edit\n", "")],
  "push fetches the script": ["push runs repository code", inPush('curl -fsSL "https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/${GITHUB_SHA}/.github/release/update-formula.sh" > x')],
  "node in push": ["push runs repository code", inPush("node x.js")],
  "pnpm in push": ["push runs repository code", inPush("pnpm build")],
  "bash in push": ["push runs repository code", inPush('bash "$artifact/x.sh"')],
  "checkout in push": ["checkout or setup-node", atPushSteps(`      - uses: actions/checkout@${SHA} # v4.4.0\n`)],
  "upload in push": ["push runs repository code", atPushSteps("      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2\n")],
  "no accept list": ["push accept list", (t) => t.replace('[ "$actual" = "developer-os.rb" ] && ', "")],
  "bare gh in push": ["push bare git or gh", (t) => t.replace('"$gh" pr create', "gh pr create")],
  "gh resolved through PATH": ["push gh path", (t) => t.replace("gh=/opt/homebrew/bin/gh", "gh=$(command -v gh)")],
  "git with hooks": ["push git hooks", (t) => t.replace("/usr/bin/git -c core.hooksPath=/dev/null add", "/usr/bin/git add")],
  "no diff check": ["diff check before push", (t) => t.replace(/^ {10}\[ "\$\(\/usr\/bin\/git -c core\.hooksPath=\/dev\/null diff --numstat\)".*\n/mu, "")],
  "token twice": ["token count", (t) => t.replace("          GH_TOKEN: ${{ github.token }}", "          X: ${{ secrets.TAP_PR_TOKEN }}\n          GH_TOKEN: ${{ github.token }}")],
  "token in the commit step": ["token step", (t) => t.replace("          GH_TOKEN: ${{ secrets.TAP_PR_TOKEN }}\n", "").replace("take the edited formula and commit\n        env:\n", "take the edited formula and commit\n        env:\n          GH_TOKEN: ${{ secrets.TAP_PR_TOKEN }}\n")],
  "push before token": ["push before the token step", (t) => t.replace('/usr/bin/git -c core.hooksPath=/dev/null checkout -b "release/${TAG}"', "/usr/bin/git -c core.hooksPath=/dev/null push origin x")],
  "bare git": ["bare git", (t) => t.replace('/usr/bin/git clone --depth 1 https://github.com/msolecki/homebrew-developer-os.git "$RUNNER_TEMP/tap"\n          cd', 'git clone --depth 1 https://github.com/msolecki/homebrew-developer-os.git "$RUNNER_TEMP/tap"\n          cd')],
  "unpinned action": ["action pins", (t) => t.replace("    steps:\n", "    steps:\n      - uses: actions/cache@v4 # v4.0.0\n")],
  "pin without version comment": ["action pins", (t) => t.replace("    steps:\n", `    steps:\n      - uses: actions/cache@${SHA}\n`)],
  "event data in run": ["expression in run", (t) => t.replace('mkdir "$RUNNER_TEMP/in"', 'echo ${{ github.event.release.name }}; mkdir "$RUNNER_TEMP/in"')],
  "event data off TAG": ["event data outside env", (t) => t.replace("          GH_TOKEN: ${{ github.token }}", "          GH_TOKEN: ${{ github.token }}\n          NAME: ${{ github.event.release.name }}")],
  "no tag validation": ["tag validation", (t) => t.replaceAll("^v[0-9]+\\.[0-9]+\\.[0-9]+$", "^v.*$")],
};

describe("tap.yml (A16 §2 step 7)", () => {
  it("is sound as committed: edit runs the script without the token, push holds the token and runs no repository code", () => {
    expect(Object.keys(jobsOf(workflow))).toEqual(["edit", "push"]);
    expect(stepsOf(jobsOf(workflow)["push"] ?? "").length).toBe(3);
    expect(violations(workflow)).toEqual([]);
  });

  for (const [name, [expected, mutate]] of Object.entries(mutations)) {
    it(`fails on the mutation: ${name}`, () => {
      const mutated = mutate(workflow);
      expect(mutated).not.toBe(workflow);
      expect(violations(mutated)).toContain(expected);
    });
  }

  it("edits through the script in edit and opens the pull request from push", () => {
    const { edit, push } = jobsOf(workflow);
    expect(edit).toContain("update-formula.sh");
    expect(edit).toContain("path: ${{ runner.temp }}/tap/Formula/developer-os.rb");
    expect(push).toContain(`[ "$(/usr/bin/git -c core.hooksPath=/dev/null diff --numstat)" = "$(printf '5\\t5\\tFormula/developer-os.rb')" ]`);
    expect(push).toContain('"$gh" pr create --repo msolecki/homebrew-developer-os');
  });

  it("keeps the edit script away from runner state and git configuration", async () => {
    const script = await readFile(join(root, ".github/release/update-formula.sh"), "utf8");
    expect(script.length).toBeGreaterThan(0);
    expect(code(script)).not.toMatch(/GITHUB_PATH|GITHUB_ENV|BASH_ENV|hooks|\.git\/|git config/u);
  });
});
