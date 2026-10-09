import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const workflow = await readFile(join(root, ".github/workflows/release.yml"), "utf8");

/** Splits the `jobs:` section into `{ name: text }`. */
const jobsOf = (text: string): Record<string, string> => {
  const section = text.split(/^jobs:\n/mu)[1] ?? "";
  const out: Record<string, string> = {};
  for (const part of section.split(/^ {2}(?=[a-z][\w-]*:\n)/mu).filter(Boolean)) out[part.slice(0, part.indexOf(":"))] = part;
  return out;
};

/** A job's `permissions:` block as sorted `key: value` rows; empty when the job declares none. */
const permissionsOf = (job: string): string[] => {
  const block = /^ {4}permissions:\n((?: {6}.*\n)*)/mu.exec(job)?.[1] ?? "";
  return block.split("\n").map((row) => row.trim()).filter(Boolean).sort();
};

/** Each `run:` script's text, up to the next step. */
const scriptsOf = (text: string): string[] => text.split(/^\s+run: /mu).slice(1).map((block) => block.split(/\n {6}- /u)[0] ?? "");

const withoutComments = (text: string): string => text.replace(/(?:^|\s)#.*$/gmu, "");

const TAG_CHECK = '[[ "$GITHUB_REF_NAME" =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+$ ]]';

/** Every release property as a list of violations; empty means the workflow is sound. */
const violations = (text: string): string[] => {
  const found: string[] = [];
  const code = withoutComments(text);
  const jobs = jobsOf(text);
  const { preflight = "", build = "", sbom = "", publish = "" } = jobs;

  if (!/^on:\n {2}push:\n {4}tags:\n {6}- 'v\*'\n(?=\n|\S)/mu.test(text)) found.push("trigger");

  // 1. Least privilege; the write-token job runs no repository or dependency code and re-verifies.
  if (!/^permissions:\n {2}contents: read\n(?=\n|\S)/mu.test(text)) found.push("top-level permissions");
  const allowed: Record<string, string[]> = {
    preflight: ["actions: read", "contents: read"],
    build: ["contents: read"],
    sbom: ["contents: read"],
    publish: ["contents: write"],
  };
  if (/write-all|read-all|permissions:\s*\{/u.test(code) || (code.match(/:\s*["']?write/gu)?.length ?? 0) !== 1) found.push("permissions");
  for (const [name, body] of Object.entries(jobs)) {
    if (JSON.stringify(permissionsOf(body)) !== JSON.stringify(allowed[name] ?? ["unexpected job"])) found.push("permissions");
  }
  if (/actions\/checkout|setup-node|\b(?:pnpm|npm|npx|node|corepack|tsc)\b|tests\/dist/u.test(withoutComments(publish))) found.push("publish runs repo code");
  if (!/^ {4}needs: \[build, sbom\]$/mu.test(publish)) found.push("publish needs");
  if (!/^ {4}environment: release$/mu.test(publish)) found.push("publish environment");
  if (!publish.includes('cmp SHA256SUMS "$RUNNER_TEMP/SHA256SUMS.recomputed"') || !/shasum -a 256 "developer-os-\$\{version\}-darwin-\$\{arch\}\.tar\.gz"/u.test(publish)) found.push("publish re-verifies");
  const downloads = [...publish.matchAll(/uses: actions\/download-artifact@\S+ # v[\d.]+\n {8}with:\n(?: {10}.*\n)*? {10}path: (.*)\n/gu)].map((match) => match[1]);
  if (downloads.length !== 2 || new Set(downloads).size !== downloads.length) found.push("download paths");
  const releaseList = '[ "$actual" = "$expected" ] && [ -z "$(find "$release" -mindepth 1 ! -type f)" ] || { echo "::error::unexpected release artifact';
  const sbomList = '[ "$actual" = "developer-os-${version}.cdx.json" ] && [ -z "$(find "$sbom" -mindepth 1 ! -type f)" ] || { echo "::error::unexpected sbom artifact';
  const listed = publish.indexOf(releaseList);
  const sbomListed = publish.indexOf(sbomList);
  if (listed < 0 || sbomListed < 0 || Math.max(listed, sbomListed) > publish.indexOf("shasum -a 256") || !publish.includes("expected=$(printf '%s\\n' SHA256SUMS \"developer-os-${version}-darwin-arm64.tar.gz\" \"developer-os-${version}-darwin-x64.tar.gz\" notes.md | LC_ALL=C sort)")) found.push("accept list");
  if (!publish.includes('gh release create "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" --draft --verify-tag')) found.push("draft");

  // 2. Every action pinned by full commit SHA with its version.
  const uses = text.split("\n").filter((row) => /^\s+(?:- )?uses:/u.test(row));
  if (uses.length < 6 || !uses.every((row) => /uses: actions\/[\w-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/u.test(row))) found.push("action pins");
  for (const name of ["preflight", "build", "sbom"]) {
    if (!/actions\/checkout@[0-9a-f]{40} # v[\d.]+\n {8}with:\n(?: {10}.*\n)*? {10}persist-credentials: false\n/u.test(jobs[name] ?? "")) found.push("persist-credentials");
  }

  // 3. No expression in a script; the tag is validated before any job uses it.
  if (scriptsOf(text).some((script) => script.includes("${{"))) found.push("expression in run");
  for (const [name, body] of Object.entries(jobs)) {
    const first = scriptsOf(body)[0] ?? "";
    if (!first.includes(TAG_CHECK)) found.push(`tag check ${name}`);
  }

  // 4. Never a dirty pack.
  if (text.includes("--allow-dirty")) found.push("allow-dirty");

  // 5. One runner type, packed twice and compared.
  const runners = text.match(/runs-on: .*/gu) ?? [];
  if (runners.length !== 4 || runners.some((row) => row !== "runs-on: macos-15")) found.push("runner");
  if (!build.includes("for run in 1 2; do") || !build.includes('cmp "$RUNNER_TEMP/dist-1/SHA256SUMS" "$RUNNER_TEMP/dist-2/SHA256SUMS"') || build.match(/node tests\/dist\/tools\/pack-release\.js/gu)?.length !== 1) found.push("determinism");

  // 6. Node runtimes verified against pins.json, and the runner's Node is .node-version.
  if (!/\.node\[\$key\]' \.github\/release\/pins\.json\) {2}\$RUNNER_TEMP\/\$archive" \| shasum -a 256 -c -/u.test(build) || !build.includes("node-version-file: .node-version")) found.push("node pins");

  // 7. Pinned, checksummed gitleaks over every ref with the repository's config.
  if (!/gitleaks\["darwin-arm64"\]' \.github\/release\/pins\.json/u.test(preflight) || !preflight.includes('echo "${sum}  $RUNNER_TEMP/$archive" | shasum -a 256 -c -')) found.push("gitleaks checksum");
  if (!preflight.includes('"$RUNNER_TEMP/gitleaks/gitleaks" git --config .gitleaks.toml --log-opts=--all --redact --exit-code 1 .')) found.push("gitleaks scan");

  // 8. A completed, successful check.yml push run on the tag's commit.
  const query = /actions\/workflows\/check\.yml\/runs\?head_sha=\$\{sha\}&branch=development&event=push&status=success/u.test(preflight);
  const filter = preflight.includes('select(.head_sha == $sha and .event == "push" and .head_branch == "development" and .status == "completed" and .conclusion == "success")');
  if (!query || !filter) found.push("check.yml run");
  if (!preflight.includes("git merge-base --is-ancestor HEAD origin/development")) found.push("on development");

  // 9. Pinned cdxgen in a read-only job.
  const pinned = sbom.includes('cdxgen=$(jq -r \'.cdxgen.version\' .github/release/pins.json)') && sbom.includes('[ "$installed" = "$cdxgen" ] ||');
  const locked = sbom.includes("pnpm install --frozen-lockfile --ignore-scripts") && sbom.includes("pnpm exec cdxgen ") && !sbom.includes("pnpm dlx");
  if (!pinned || !locked) found.push("cdxgen");

  // 10. Release notes from the CHANGELOG reader.
  if (!build.includes('node tests/dist/tools/release-metadata.js notes "$VERSION" > "$RUNNER_TEMP/dist-1/notes.md"')) found.push("notes");

  return found;
};

const CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0";

const mutations: Record<string, [string, (t: string) => string]> = {
  "pull_request trigger": ["trigger", (t) => t.replace("on:\n", "on:\n  pull_request:\n")],
  "top-level write": ["top-level permissions", (t) => t.replace(/^permissions:\n {2}contents: read/mu, "permissions:\n  contents: write")],
  "build widened": ["permissions", (t) => t.replace(/(\n {2}build:\n(?:.*\n)*? {4}permissions:\n {6})contents: read/u, "$1contents: write")],
  "publish widened": ["permissions", (t) => t.replace("      contents: write\n", "      contents: write\n      packages: write\n")],
  "sbom without permissions": ["permissions", (t) => t.replace(/(\n {2}sbom:\n(?:.*\n)*?) {4}permissions:\n {6}contents: read\n/u, "$1")],
  "write-all": ["permissions", (t) => t.replace(/^permissions:\n {2}contents: read/mu, "permissions: write-all")],
  "publish checkout": ["publish runs repo code", (t) => t.replace(/( {2}publish:\n(?:.*\n)*? {4}steps:\n)/u, `$1      - uses: ${CHECKOUT}\n`)],
  "publish node": ["publish runs repo code", (t) => t.replace('cmp SHA256SUMS "$RUNNER_TEMP/SHA256SUMS.recomputed"', 'node x.js; cmp SHA256SUMS "$RUNNER_TEMP/SHA256SUMS.recomputed"')],
  "publish pnpm": ["publish runs repo code", (t) => t.replace('gh release create "$GITHUB_REF_NAME"', 'pnpm exec x; gh release create "$GITHUB_REF_NAME"')],
  "publish without re-verify": ["publish re-verifies", (t) => t.replace('cmp SHA256SUMS "$RUNNER_TEMP/SHA256SUMS.recomputed"', "true")],
  "publish before sbom": ["publish needs", (t) => t.replace("needs: [build, sbom]", "needs: build")],
  "publish without environment": ["publish environment", (t) => t.replace("    environment: release\n", "")],
  "shared download path": ["download paths", (t) => t.replace("path: ${{ runner.temp }}/sbom\n          if-no-files-found", "§").replace("path: ${{ runner.temp }}/sbom", "path: ${{ runner.temp }}/release").replace("§", "path: ${{ runner.temp }}/sbom\n          if-no-files-found")],
  "no release accept list": ["accept list", (t) => t.replace(/\[ "\$actual" = "\$expected" \] && \[ -z "\$\(find "\$release" -mindepth 1 ! -type f\)" \] \|\| /u, "")],
  "no sbom accept list": ["accept list", (t) => t.replace(/\[ "\$actual" = "developer-os-\$\{version\}\.cdx\.json" \] && \[ -z "\$\(find "\$sbom" -mindepth 1 ! -type f\)" \] \|\| /u, "")],
  "sbom admitted to release list": ["accept list", (t) => t.replace('"developer-os-${version}-darwin-x64.tar.gz" notes.md | LC_ALL=C sort)', '"developer-os-${version}-darwin-x64.tar.gz" "developer-os-${version}.cdx.json" notes.md | LC_ALL=C sort)')],
  "not a draft": ["draft", (t) => t.replace(" --draft --verify-tag", " --verify-tag")],
  "tag pin": ["action pins", (t) => t.replace("# v4.6.2", "# v4")],
  "branch pin": ["action pins", (t) => t.replace(/@d3f86a106a0bac45b974a628896c90dbdf5c8093/u, "@v4")],
  "third-party action": ["action pins", (t) => t.replace("actions/upload-artifact@", "someone/upload-artifact@")],
  "persisted credentials": ["persist-credentials", (t) => t.replace("persist-credentials: false", "persist-credentials: true")],
  "expression in run": ["expression in run", (t) => t.replace('version="${GITHUB_REF_NAME#v}"', 'version="${{ github.ref_name }}"')],
  "tag check dropped": ["tag check publish", (t) => t.replace(/(\n {2}publish:\n(?:.*\n)*?) +\[\[ "\$GITHUB_REF_NAME" =~ [^\n]*\n/u, "$1")],
  "loose tag check": ["tag check preflight", (t) => t.replace(TAG_CHECK, '[[ "$GITHUB_REF_NAME" =~ ^v ]]')],
  "allow-dirty": ["allow-dirty", (t) => t.replace('--node-x64-version "$NODE_VERSION"', '--node-x64-version "$NODE_VERSION" --allow-dirty')],
  "second runner type": ["runner", (t) => t.replace(/(\n {2}sbom:\n(?:.*\n)*? {4})runs-on: macos-15/u, "$1runs-on: macos-15-intel")],
  "single pack": ["determinism", (t) => t.replace("for run in 1 2; do", "for run in 1; do")],
  "no compare": ["determinism", (t) => t.replace('cmp "$RUNNER_TEMP/dist-1/SHA256SUMS" "$RUNNER_TEMP/dist-2/SHA256SUMS"', "true")],
  "unverified node": ["node pins", (t) => t.replace(/\| shasum -a 256 -c -\n(\s+mkdir "\$RUNNER_TEMP\/node-)/u, "| cat\n$1")],
  "unverified gitleaks": ["gitleaks checksum", (t) => t.replace('echo "${sum}  $RUNNER_TEMP/$archive" | shasum -a 256 -c -', "true")],
  "gitleaks without --all": ["gitleaks scan", (t) => t.replace(" --log-opts=--all", "")],
  "gitleaks without config": ["gitleaks scan", (t) => t.replace(" --config .gitleaks.toml", "")],
  "gitleaks exit 0": ["gitleaks scan", (t) => t.replace("--exit-code 1", "--exit-code 0")],
  "any event": ["check.yml run", (t) => t.replace("&event=push", "")],
  "any status": ["check.yml run", (t) => t.replace("&status=success", "")],
  "any conclusion": ["check.yml run", (t) => t.replace(' and .conclusion == "success"', "")],
  "in progress": ["check.yml run", (t) => t.replace(' and .status == "completed"', "")],
  "other commit": ["check.yml run", (t) => t.replace("select(.head_sha == $sha and ", "select(")],
  "off development": ["on development", (t) => t.replace("git merge-base --is-ancestor HEAD origin/development", "true")],
  "cdxgen unlocked": ["cdxgen", (t) => t.replace("pnpm exec cdxgen ", 'pnpm dlx "@cyclonedx/cdxgen@latest" ')],
  "cdxgen version unchecked": ["cdxgen", (t) => t.replace('[ "$installed" = "$cdxgen" ] ||', "true ||")],
  "cdxgen lockfile ignored": ["cdxgen", (t) => t.replace("pnpm install --frozen-lockfile --ignore-scripts", "pnpm install")],
  "notes dropped": ["notes", (t) => t.replace("release-metadata.js notes", "release-metadata.js sequence")],
};

describe("release.yml (A16 §2 steps 2-5)", () => {
  it("is sound as committed, with a non-empty set of jobs, scripts and actions", () => {
    expect(Object.keys(jobsOf(workflow))).toEqual(["preflight", "build", "sbom", "publish"]);
    expect(scriptsOf(workflow).length).toBeGreaterThan(0);
    expect(violations(workflow)).toEqual([]);
  });

  for (const [name, [expected, mutate]] of Object.entries(mutations)) {
    it(`fails on the mutation: ${name}`, () => {
      const mutated = mutate(workflow);
      expect(mutated).not.toBe(workflow);
      expect(violations(mutated)).toContain(expected);
    });
  }

  it("verifies both tarballs by K2 admission and never reruns the suite", () => {
    const build = jobsOf(workflow)["build"] ?? "";
    for (const architecture of ["arm64", "x64"]) {
      expect(build).toContain(`node tests/dist/tools/verify-release-tarball.js --tarball "$RUNNER_TEMP/dist-1/developer-os-\${VERSION}-darwin-${architecture}.tar.gz" --version "$VERSION" --architecture ${architecture}`);
    }
    expect(build.indexOf("verify-release-tarball.js")).toBeGreaterThan(build.indexOf("cmp "));
    expect(workflow).not.toMatch(/npm (?:run check|test)|test:suite|vitest/u);
  });
});
