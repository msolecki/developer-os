# A16: Release Publication (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan one task at a time. Steps use checkbox (`- [ ]`) syntax for tracking. The orchestration rules in `docs/superpowers/SESSION.md` §4.1 apply. Each task runs in its own worktree at `../developer-os.worktrees/<task>`. Only the orchestrator edits `docs/superpowers/`. Intended repository location of this file: `docs/superpowers/plans/2026-10-08-a16-release-publication.md` (`docs/superpowers` is globally git-ignored: stage it with `git add -f`).

**Goal:** A pushed tag `vX.Y.Z` on `development` produces a draft GitHub Release with two deterministic, admission-verified tarballs, `SHA256SUMS` and a CycloneDX SBOM. Publishing that draft opens a pull request in `msolecki/homebrew-developer-os` with the rendered formula. Merging the pull request is the release. The first beta is `0.1.0`.

**Architecture:** The Task 11b packer (`tests/tools/pack-release.ts`) already turns a clean commit into two keg trees and two `.tar.zst` bundle archives. This plan adds small, unit-tested tools beside it: the version-to-sequence rule and the CHANGELOG section reader, a deterministic `.tar.gz` writer over a keg tree, a tarball verifier that runs the production K2 admission and a byte-flip negative check, and a formula renderer. Two workflows call those tools with `node tests/dist/tools/<tool>.js`. `release.yml` holds the CI gates and creates the draft. `tap.yml` runs on the published release and opens the tap pull request. CI pins (Node archives, gitleaks, cdxgen) live in one JSON file that a repository test checks. The public documentation set has a test that parses every documented `developer-os` command with the CLI's own argv parsers.

**Tech Stack:** TypeScript (strict), Node 24 (`.node-version` = `24.16.0`), pnpm 11 workspace, vitest, `node:zlib` (gzip), GitHub Actions on macOS runners, Homebrew. Local-only tools, not dependencies: `actionlint`, `shellcheck`, `gitleaks` and `ruby` (all present at `/opt/homebrew/bin/`). CI-only tool, not a dependency: `@cyclonedx/cdxgen` through `pnpm dlx`.

**Spec:** `docs/superpowers/specs/2026-10-07-developer-os-release-publication-design.md` (A16, D95), including §3.3 "Amended 2026-10-08", which governs where it disagrees with §2 and §3.1. It consumes Spec 2's block "Amended 2026-10-07 (D84, Task 11b)" K1–K8 in `docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md`. Program plan Task 9: `git show ae25acd9:docs/superpowers/plans/2026-07-21-developer-os-program.md`.

---

## Spec and code disagreements (resolved as stated; founder may overrule)

- **D1. §2 step 3 is stale.** It describes a per-architecture runner matrix, a packer flag `--architecture`, and a packer that downloads Node. The packer as built (§3.3, D96 Q2) builds both architectures in one run, has no `--architecture` flag, needs `--index-sequence`, and takes Node as `{path, sha256, version}` per slot. **The plan follows §3.3:** one macOS build job.
- **D2. §3.1's formula body is stale.** It uses `libexec.install Dir["*"]` plus `bin.install_symlink`, and says the tarball's top level holds `bin/developer-os` and `fallback/`. The packer's keg root is `bin/developer-os` plus `libexec/{launcher.mjs, fallback/}`. **The plan follows §3.3:** `prefix.install Dir["*"]` and no `install_symlink`.
- **D3. "The SHA-256 pinned … taken from that release's `SHASUMS256.txt`" cannot be the packer's pin.** `SHASUMS256.txt` lists archive hashes (`node-vX-darwin-<arch>.tar.gz`). The packer's `--node-<arch>-sha256` is the hash of the extracted `bin/node` (`assertNodeBinary` in `tests/tools/pack-release.ts`), and its docblock repeats the spec's claim. **The plan pins the archive hashes** in `.github/release/pins.json` (checked against `SHASUMS256.txt`). CI verifies the archive, extracts `bin/node`, and passes the binary's computed hash to the packer. The trust anchor is the archive pin. Task 1 corrects the packer's docblock.
- **D4. The release tarball does not exist yet.** §2 step 3 specifies `developer-os-X.Y.Z-darwin-<arch>.tar.gz` (sorted entries, `0:0`, tag-commit mtime, `0755`/`0644`, `gzip -n`). The packer writes trees and `.tar.zst` archives only. Task 3 builds the tarball writer.
- **D5. The `.tar.zst` archives are not published.** D96 Q2 says the packer writes them "for A16 to publish later". §2 step 5 lists only the two tarballs, `SHA256SUMS` and the SBOM. **The plan publishes the spec's list.** Open question for the founder: are the archives meant to be release assets?
- **D6. Clean-account gate.** §5 says "a disposable macOS account". D96 Q5 replaced that with a fresh macOS VM, then once on the founder machine. The plan follows D96 Q5.
- **D7. Preflight versus how `check.yml` runs.** `check.yml` runs on `push` to `development` (only the head commit of each push) and on `pull_request` (a merge ref, not the tag's tree), and it has `cancel-in-progress: true`. A tag on a commit that was never a push head, or whose run was cancelled, has no successful run, and the preflight refuses it. That is correct, but the founder needs to know it. The plan documents it in the release runbook (Task 10) and in Task 11.

## Global Constraints

- Orchestrator branch `integrate/a16`, cut from `development` after Task 11b is integrated (ORDER A16 depends on A11b). Implementers branch `task/a16-<n>` from it in `../developer-os.worktrees/a16-<n>` (D33; an in-repository worktree breaks `eslint`).
- Per commit (D32): the task's fast commands, then `npm run lint`. `npm run check` runs once, at Task 11, by the founder. Slow suites (any `npm run test…`, `*.v2.test.ts`, `apps/cli/src/bootstrap/executor.test.ts`, `tests/e2e`, `tests/security`, `tests/integration`) are not touched by this plan.
- Before any vitest run in a fresh worktree: `pnpm install --frozen-lockfile && pnpm --pm-on-fail=ignore build` (tests import `dist/`).
- Exact-path staging only. Never `git add -A`, `git add .` or a wildcard.
- No new dependency in any `package.json`. No new `package.json` script: workflows call `node tests/dist/tools/<tool>.js` after one `pnpm --pm-on-fail=ignore build`.
- Release version: canonical stable semver `X.Y.Z` (`parseStableSemver`). Tag: `vX.Y.Z`. Beta: `0.Y.Z` in the same tap. First beta: `0.1.0`.
- `releaseSequence = major × 1,000,000 + minor × 1,000 + patch`, with minor and patch below 1,000. It refuses rather than wraps. `releaseIndexSequence` equals it (§3.2). Both go to the packer as `--release-sequence` and `--index-sequence`.
- Tarball name `developer-os-X.Y.Z-darwin-<arm64|x64>.tar.gz`. Its members are the keg root's contents (top level exactly `bin` and `libexec`), sorted by UTF-8 bytes, owner `0:0`, mtime = the tag commit's committer time, directories `0755`, files `0644` or `0755`, regular single-link files only. gzip with no file name and a zero header mtime. Same inputs, same bytes.
- `SHA256SUMS` format: `<64 lowercase hex>  <file name>\n` (two spaces), arm64 line first, tarballs only. `shasum -a 256 -c SHA256SUMS` must pass.
- Formula: `prefix.install Dir["*"]`. No `revision`, no `post_install`, no `depends_on "node"`. `depends_on :macos`. `test do` runs `developer-os --version`. `license` comes from the root `package.json` `"license"` field, which only L1 sets.
- `release.yml` never passes `--allow-dirty`. The packer refuses `--allow-dirty` when `CI` is set and non-empty.
- Node: the bundled runtime and the runner's Node are both `.node-version` (`24.16.0`). Workflows use `actions/setup-node@v4` with `node-version-file: .node-version`, because the zstd bytes depend on the packer's Node (§3.3). Archive SHA-256s are pinned in `.github/release/pins.json`.
- Workflow permissions: top-level `contents: read`. Only `release.yml`'s `publish` job has `contents: write`. The `preflight` job adds `actions: read`. `tap.yml` uses `secrets.TAP_PR_TOKEN` in exactly one step. No `${{ … }}` expression of event data inside a `run:` script: event data reaches scripts through `env:`.
- Actions: only `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, `actions/download-artifact@v4`, the same family `check.yml` uses.
- Runner label `macos-15` (the label `check.yml` uses), confirmed against GitHub's current list in Task 5 with network access. One build job builds both architectures, so no Intel label is needed.
- The product makes no network request (K1). CI fetches from `nodejs.org`, `github.com/gitleaks/gitleaks` releases and the npm registry (cdxgen) only.
- Two founder approvals gate every release: publishing the draft, then merging the tap pull request.
- Public-bound repository: synthetic fixtures only. No founder paths (`/Users/…`) or private content in committed files.
- Every enumerating test asserts a non-empty set per scope (SESSION hard rule).
- No `path:line` citations in public docs (`tests/repository/citations.test.ts` gates citations). Use `` `path` — `identifier` `` anchors if a citation is needed.

## Review Focus

1. **Homebrew's install-time processing changes the keg.** Homebrew's cleaner resets modes under `bin/`, and its dynamic-linkage fixer and codesigning may rewrite Mach-O files anywhere in the keg, which includes `libexec/fallback/bundle/bin/node`. A user expects `brew install` to leave `libexec/` byte- and mode-identical to the tarball. Otherwise K2 admission refuses every real install with exit 6. No unit test can run Homebrew. Test: Task 11 step 7 runs `diff -r` and a mode listing of the installed `libexec` against the extracted tarball in the VM.
2. **`brew test` runs the launcher with Homebrew's temporary `HOME` and no active release.** The launcher must take the `package_fallback` route through the fixed table (`apps/launcher/src/selection.ts` — `selectLauncherCandidate`) and print `developer-os X.Y.Z`. The fixed table names `/opt/homebrew/opt/developer-os`, so this cannot be unit-tested off a real prefix without touching the founder's Homebrew. Test: Task 11 step 7, `brew test developer-os` in the VM.
3. **The tag's commit has no successful `check.yml` push run** (D7). A user expects the preflight to refuse with a message naming the commit, not to build anyway and not to rerun the 4 h suite. Test: Task 8 step 1 pins the query filters `event=push`, `branch=development` and `status=success`, and the absence of any `npm run check` or `npm test` call. Task 10 step 3 documents it in the runbook.
4. **Version edge cases in a tag.** `v0.0.0`, `v1.1000.0`, `v1.0.0-rc.1`, `v01.0.0` and `v1.0` must refuse before anything is packed, with a message naming the version. Test: Task 2 step 1, `releaseSequenceOf` cases.
5. **Homebrew strips a lone top-level directory.** If a tarball had exactly one top-level entry, Homebrew would `cd` into it, and `prefix.install Dir["*"]` would install the wrong level. The tarball's top level must be exactly `bin` and `libexec`. Test: Task 3 step 1, case "lists exactly bin and libexec at the top level".

---

## Waves

| Wave | Tasks (parallel within a wave) | Size | Consumes |
|---|---|---|---|
| 1 | Task 1 packer CI refusal; Task 2 sequence and notes; Task 3 tarball writer; Task 5 CI pins; Task 6 secret-scan baseline; Task 7 formula renderer | S, S, M, S, S, S | — |
| 2 | Task 4 tarball verifier; Task 9 `tap.yml`; Task 10 documentation set | M, S, L | 4 ← 2, 3; 9 ← 7; 10 ← 2 |
| 3 | Task 8 `release.yml` | M | 1, 2, 3, 4, 5, 6 |
| 4 | Task 11 founder gates and first beta (**Blocked by: L1, L2**) | L | all |

Tasks 1–10 need neither L1 nor L2. Task 9's first live run and every publication step are in Task 11.

Shared files: none of Tasks 1–10 edit the same file, except that Task 4 imports Task 2's and Task 3's modules and Task 8 names every tool's CLI. No `package.json` edits.

---

### Task 1: The packer refuses `--allow-dirty` when `CI` is set (S)

**Files:**
- Modify: `tests/tools/pack-release.ts` (docblock lines 1–25, `assertNodeBinary` docblock, `assertCleanCheckout`, the CLI block's `assertCleanCheckout` call)
- Test: `tests/tools/pack-release.test.ts` (the case "the CLI refuses a dirty checkout unless --allow-dirty")

**Interfaces:**
- Consumes: nothing new.
- Produces: `assertCleanCheckout(root: string, allowDirty: boolean, env: Readonly<Record<string, string | undefined>>): void`. It throws `refusing to pack: --allow-dirty is refused when CI is set` if `allowDirty` is true and `env.CI` is a non-empty string. Otherwise the behaviour is unchanged. The CLI passes `process.env`.

- [ ] **Step 1: Write the failing test.** Replace the existing case's three `assertCleanCheckout` calls and add the CI cases. The env is always explicit, because GitHub Actions sets `CI=true` and an implicit `process.env` would turn the existing "allowed" assertion red in `check.yml`.

```ts
  it("the CLI refuses a dirty checkout unless --allow-dirty, and refuses --allow-dirty when CI is set", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "developer-os-dirty-")));
    roots.push(root);
    const git = (...args: string[]): void => {
      const result = spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], { cwd: root, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
    };
    git("init", "-q");
    await writeFile(join(root, "tracked"), "tracked\n");
    git("add", "tracked");
    git("commit", "-q", "-m", "fixture");
    expect(() => { assertCleanCheckout(root, false, {}); }).not.toThrow();
    expect(() => { assertCleanCheckout(root, false, { CI: "true" }); }).not.toThrow();
    // A clean tree does not make the flag acceptable in CI: the flag itself is refused.
    expect(() => { assertCleanCheckout(root, true, { CI: "true" }); }).toThrow(/--allow-dirty is refused when CI is set/u);
    await writeFile(join(root, "untracked"), "draft\n");
    expect(() => { assertCleanCheckout(root, false, {}); }).toThrow(/uncommitted|--allow-dirty/u);
    expect(() => { assertCleanCheckout(root, true, {}); }).not.toThrow();
    expect(() => { assertCleanCheckout(root, true, { CI: "" }); }).not.toThrow();
    expect(() => { assertCleanCheckout(root, true, { CI: "1" }); }).toThrow(/--allow-dirty is refused when CI is set/u);
  });
```

- [ ] **Step 2: Run it and confirm it fails for the stated reason.**

Run: `pnpm exec vitest run tests/tools/pack-release.test.ts -t 'refuses --allow-dirty when CI is set'`
Expected: FAIL. The `{ CI: "true" }` call with `allowDirty: true` does not throw, because the function ignores its third argument (`tsc` also reports "Expected 2 arguments, but got 3" if the build runs first).

- [ ] **Step 3: Implement.**

```ts
/**
 * The CLI packs committed state only: `collectTree` already refuses dirty `workflows/` and
 * `instructions/`, and this refuses any other uncommitted change that would reach a bundle.
 * CI never packs a dirty tree (A16 §3.3): with `CI` set, `--allow-dirty` itself is refused.
 */
export function assertCleanCheckout(root: string, allowDirty: boolean, env: Readonly<Record<string, string | undefined>>): void {
  if (allowDirty && (env.CI ?? "") !== "") throw new Error("refusing to pack: --allow-dirty is refused when CI is set");
  if (allowDirty) return;
  if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0) {
    throw new Error("refusing to pack: the checkout has uncommitted changes (pass --allow-dirty to pack anyway)");
  }
}
```

In the CLI block: `assertCleanCheckout(repositoryRoot(), values["allow-dirty"] === true, process.env);`. Add `env` to the `node:process` import (`import { argv, env, stdout } from "node:process";`) and pass `env`.

Docblock corrections in the same file. File header: "the CLI refuses a dirty checkout unless `--allow-dirty`, and refuses `--allow-dirty` whenever `CI` is set". `assertNodeBinary`: replace "its SHA-256 pin, copied from nodejs.org's SHASUMS256.txt for that exact version, is its integrity authority" with "its SHA-256 pin is its integrity authority; A16's CI derives it from the extracted binary of an archive whose SHA-256 is pinned in `.github/release/pins.json` from nodejs.org's `SHASUMS256.txt`".

- [ ] **Step 4: Run the test and lint.**

Run: `pnpm --pm-on-fail=ignore build && pnpm exec vitest run tests/tools/pack-release.test.ts -t 'dirty' && npm run lint`
Expected: PASS. Lint is clean.

- [ ] **Step 5: Commit.**

```bash
git add tests/tools/pack-release.ts tests/tools/pack-release.test.ts
git commit -m "feat(release): the packer refuses --allow-dirty when CI is set (A16 §3.3)"
```

---

### Task 2: Release sequence and release notes (S)

**Files:**
- Create: `tests/tools/release-metadata.ts`
- Test: `tests/tools/release-metadata.test.ts`

**Interfaces:**
- Consumes: `parseStableSemver` from `@developer-os/core` (`packages/core/src/update/scalars.ts`).
- Produces:
  - `releaseSequenceOf(version: string): string` returns the decimal `releaseSequence`. It throws `refusing the release: …` for non-stable semver, minor or patch ≥ 1000, or `0.0.0`.
  - `releaseNotesOf(changelog: string, version: string): string` returns the trimmed body of the section headed `## [X.Y.Z]` or `## [X.Y.Z] - YYYY-MM-DD`, up to the next `## ` heading. It throws if the section is missing, empty or duplicated.
  - CLI: `node tests/dist/tools/release-metadata.js sequence <X.Y.Z>` prints `<n>\n`. `node tests/dist/tools/release-metadata.js notes <X.Y.Z>` prints the section of `<repo root>/CHANGELOG.md` plus `\n`. Any refusal exits non-zero.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";

import { releaseNotesOf, releaseSequenceOf } from "./release-metadata.js";

describe("releaseSequenceOf (A16 §3.2)", () => {
  it.each([
    ["0.1.0", "1000"],
    ["0.0.1", "1"],
    ["0.12.3", "12003"],
    ["1.0.0", "1000000"],
    ["1.999.999", "1999999"],
    ["4294967295.0.0", "4294967295000000"],
  ])("maps %s to %s", (version, sequence) => {
    expect(releaseSequenceOf(version)).toBe(sequence);
  });

  it("increases strictly across the minor and major boundaries", () => {
    const ordered = ["0.0.1", "0.0.999", "0.1.0", "0.999.999", "1.0.0", "1.0.1"].map((version) => BigInt(releaseSequenceOf(version)));
    for (let index = 1; index < ordered.length; index += 1) expect(ordered[index]! > ordered[index - 1]!).toBe(true);
  });

  it.each([
    ["0.0.0", /0\.0\.0/u],
    ["1.1000.0", /1\.1000\.0/u],
    ["1.0.1000", /1\.0\.1000/u],
    ["1.0.0-rc.1", /1\.0\.0-rc\.1/u],
    ["01.0.0", /01\.0\.0/u],
    ["1.0", /1\.0/u],
    ["v1.0.0", /v1\.0\.0/u],
  ])("refuses %s rather than wrapping", (version, message) => {
    expect(() => releaseSequenceOf(version)).toThrow(message);
  });
});

const CHANGELOG = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "## [0.2.0] - 2026-11-02",
  "",
  "### Fixed",
  "- second",
  "",
  "## [0.1.0] - 2026-10-20",
  "",
  "### Added",
  "- first",
  "",
].join("\n");

describe("releaseNotesOf (A16 §2 step 5)", () => {
  it("returns exactly the version's section", () => {
    expect(releaseNotesOf(CHANGELOG, "0.2.0")).toBe("### Fixed\n- second");
    expect(releaseNotesOf(CHANGELOG, "0.1.0")).toBe("### Added\n- first");
  });

  it("refuses a missing, empty or duplicated section", () => {
    expect(() => releaseNotesOf(CHANGELOG, "0.3.0")).toThrow(/no CHANGELOG\.md section for 0\.3\.0/u);
    expect(() => releaseNotesOf("## [0.1.0]\n\n## [0.0.9]\n- x\n", "0.1.0")).toThrow(/empty/u);
    expect(() => releaseNotesOf("## [0.1.0]\n- a\n## [0.1.0]\n- b\n", "0.1.0")).toThrow(/more than one/u);
  });

  it("does not match a version that only shares a prefix", () => {
    expect(() => releaseNotesOf("## [0.1.01]\n- x\n", "0.1.0")).toThrow(/no CHANGELOG\.md section/u);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm exec vitest run tests/tools/release-metadata.test.ts`
Expected: FAIL with "Failed to resolve import ./release-metadata.js".

- [ ] **Step 3: Implement `tests/tools/release-metadata.ts`.**

```ts
/**
 * A16 §3.2 and §2 step 5: the release sequence a version stamps, and the CHANGELOG.md section that
 * becomes its release notes. `node tests/dist/tools/release-metadata.js sequence|notes <X.Y.Z>`.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { argv, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { parseStableSemver } from "@developer-os/core";

const COMPONENT_BOUND = 1000n;

export function releaseSequenceOf(version: string): string {
  let parts: readonly bigint[];
  try {
    parts = parseStableSemver(version).split(".").map(BigInt);
  } catch (error) {
    throw new Error(`refusing the release: ${version} is not stable semver X.Y.Z`, { cause: error });
  }
  const [major = 0n, minor = 0n, patch = 0n] = parts;
  if (minor >= COMPONENT_BOUND || patch >= COMPONENT_BOUND) throw new Error(`refusing the release: ${version} has a minor or patch of 1000 or more`);
  const sequence = major * 1_000_000n + minor * 1_000n + patch;
  if (sequence === 0n) throw new Error(`refusing the release: ${version} has release sequence 0`);
  return sequence.toString(10);
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function releaseNotesOf(changelog: string, version: string): string {
  const heading = new RegExp(`^## \\[${escaped(version)}\\](?: - \\d{4}-\\d{2}-\\d{2})?$`, "u");
  const lines = changelog.split("\n");
  const starts = lines.flatMap((line, index) => (heading.test(line) ? [index] : []));
  if (starts.length === 0) throw new Error(`refusing the release: no CHANGELOG.md section for ${version}`);
  if (starts.length > 1) throw new Error(`refusing the release: more than one CHANGELOG.md section for ${version}`);
  const start = (starts[0] as number) + 1;
  const next = lines.findIndex((line, index) => index >= start && line.startsWith("## "));
  const body = lines.slice(start, next === -1 ? lines.length : next).join("\n").trim();
  if (body.length === 0) throw new Error(`refusing the release: the CHANGELOG.md section for ${version} is empty`);
  return body;
}

function repositoryRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: "utf8" }).trim();
}

function isEntryPoint(entry: string | undefined): boolean {
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint(argv[1])) {
  const [command, version] = argv.slice(2);
  if (version === undefined || argv.length !== 4) throw new Error("usage: release-metadata.js sequence|notes <X.Y.Z>");
  if (command === "sequence") stdout.write(`${releaseSequenceOf(version)}\n`);
  else if (command === "notes") stdout.write(`${releaseNotesOf(await readFile(join(repositoryRoot(), "CHANGELOG.md"), "utf8"), version)}\n`);
  else throw new Error("usage: release-metadata.js sequence|notes <X.Y.Z>");
}
```

`isEntryPoint` copies the pattern in `tests/tools/pack-release.ts`. The empty-looking `catch` returns `false` and is not empty.

- [ ] **Step 4: Run the tests, the CLI and lint.**

Run: `pnpm --pm-on-fail=ignore build && pnpm exec vitest run tests/tools/release-metadata.test.ts && node tests/dist/tools/release-metadata.js sequence 0.1.0 && npm run lint`
Expected: PASS. The CLI prints `1000`. Lint is clean.

- [ ] **Step 5: Commit.**

```bash
git add tests/tools/release-metadata.ts tests/tools/release-metadata.test.ts
git commit -m "feat(release): release sequence and CHANGELOG section reader (A16 §3.2, §2 step 5)"
```

---

### Task 3: Deterministic release tarballs and `SHA256SUMS` (M)

**Files:**
- Modify: `tests/tools/release-archive.ts` (export `ustarHeader` with an `mtime` parameter and a fit check)
- Create: `tests/tools/release-tarball.ts`
- Test: `tests/tools/release-tarball.test.ts`

**Interfaces:**
- Consumes: `sortUtf8` and `parseStableSemver` from `@developer-os/core`. The packer's output layout `<pack>/darwin-<arch>/{bin,libexec}` (`tests/tools/pack-release.ts` docblock).
- Produces:
  - `release-archive.ts`: `export interface UstarEntry { readonly path: string; readonly kind: "file" | "directory"; readonly mode: number }` and `export function ustarHeader(entry: UstarEntry, size: number, mtime?: number): Uint8Array`. The default `mtime` is the existing fixed value `0o14_000_000_000`, so `archiveOf`'s bytes do not change. It throws `refusing to archive: <path> does not fit a ustar header` when the base name exceeds 100 bytes or the directory part exceeds 155 bytes.
  - `release-tarball.ts`: `export async function tarballOf(kegRoot: string, mtime: number): Promise<Uint8Array>` and `export async function writeReleaseTarballs(options: { readonly packDir: string; readonly version: string; readonly mtime: number; readonly dest: string }): Promise<void>`. The second writes `<dest>/developer-os-<v>-darwin-arm64.tar.gz`, `…-darwin-x64.tar.gz` and `<dest>/SHA256SUMS`. `dest` must not exist.
  - CLI: `node tests/dist/tools/release-tarball.js --pack <dir> --version <X.Y.Z> --mtime <epoch seconds> --dest <dir>`.

- [ ] **Step 1: Write the failing test.**

```ts
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, zstdDecompressSync } from "node:zlib";

import { afterAll, describe, expect, it } from "vitest";

import { archiveOf } from "./release-archive.js";
import { tarballOf, writeReleaseTarballs } from "./release-tarball.js";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "developer-os-tarball-")));
  roots.push(root);
  await chmod(root, 0o755);
  return root;
}

async function dir(path: string): Promise<void> {
  await mkdir(path);
  await chmod(path, 0o755);
}

async function file(path: string, text: string, mode: number): Promise<void> {
  await writeFile(path, text);
  await chmod(path, mode);
}

/** A keg-shaped tree: the same top level and modes the packer writes. */
async function keg(root: string, marker: string): Promise<string> {
  await dir(root);
  await dir(join(root, "bin"));
  await dir(join(root, "libexec"));
  await dir(join(root, "libexec", "fallback"));
  await file(join(root, "bin", "developer-os"), `#!/bin/sh\necho ${marker}\n`, 0o755);
  await file(join(root, "libexec", "launcher.mjs"), `export const marker = "${marker}";\n`, 0o644);
  await file(join(root, "libexec", "fallback", "a-file"), "a\n", 0o644);
  return root;
}

const MTIME = 1_791_000_000;

interface Member { readonly path: string; readonly mode: string; readonly uid: string; readonly gid: string; readonly mtime: string; readonly type: string }

/** The raw ustar header fields of every member, in archive order. */
function members(tar: Uint8Array): Member[] {
  const text = (offset: number, length: number): string => new TextDecoder().decode(tar.subarray(offset, offset + length)).replace(/\0.*$/su, "");
  const rows: Member[] = [];
  for (let at = 0; at + 512 <= tar.byteLength && tar[at] !== 0; ) {
    const size = Number.parseInt(text(at + 124, 12), 8);
    const prefix = text(at + 345, 155);
    rows.push({ path: prefix === "" ? text(at, 100) : `${prefix}/${text(at, 100)}`, mode: text(at + 100, 8), uid: text(at + 108, 8), gid: text(at + 116, 8), mtime: text(at + 136, 12), type: text(at + 156, 1) });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return rows;
}

describe("release tarballs (A16 §2 step 3)", () => {
  it("writes sorted 0:0 members with the given mtime and the keg's modes, gzip without name or mtime", async () => {
    const root = await keg(join(await scratch(), "darwin-arm64"), "one");
    const gz = await tarballOf(root, MTIME);
    expect(gz[3]).toBe(0);
    expect([...gz.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
    const rows = members(gunzipSync(gz));
    expect(rows.map((row) => row.path)).toEqual(["bin", "bin/developer-os", "libexec", "libexec/fallback", "libexec/fallback/a-file", "libexec/launcher.mjs"]);
    for (const row of rows) expect([row.uid, row.gid, row.mtime]).toEqual(["0000000", "0000000", MTIME.toString(8).padStart(11, "0")]);
    expect(rows.map((row) => `${row.type}:${row.mode}`)).toEqual(["5:0000755", "0:0000755", "5:0000755", "5:0000755", "0:0000644", "0:0000644"]);
  });

  it("lists exactly bin and libexec at the top level, so Homebrew does not descend into a lone directory", async () => {
    const rows = members(gunzipSync(await tarballOf(await keg(join(await scratch(), "k"), "x"), MTIME)));
    expect([...new Set(rows.map((row) => row.path.split("/")[0]))]).toEqual(["bin", "libexec"]);
  });

  it("is a function of the tree and the mtime only", async () => {
    const left = await tarballOf(await keg(join(await scratch(), "k"), "same"), MTIME);
    const right = await tarballOf(await keg(join(await scratch(), "k"), "same"), MTIME);
    expect(Buffer.from(left).equals(Buffer.from(right))).toBe(true);
    const later = await tarballOf(await keg(join(await scratch(), "k"), "same"), MTIME + 1);
    expect(Buffer.from(left).equals(Buffer.from(later))).toBe(false);
  });

  it("extracts with the system tar to the same tree and modes", async () => {
    const root = await keg(join(await scratch(), "k"), "tar");
    const out = join(await scratch(), "out");
    await dir(out);
    const archive = join(await scratch(), "k.tar.gz");
    await writeFile(archive, await tarballOf(root, MTIME));
    const result = spawnSync("/usr/bin/tar", ["-xpzf", archive, "-C", out], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    for (const entry of await readdir(root, { recursive: true })) {
      expect(((await stat(join(out, entry))).mode & 0o777).toString(8)).toBe(((await stat(join(root, entry))).mode & 0o777).toString(8));
    }
    expect(await readFile(join(out, "bin", "developer-os"), "utf8")).toBe("#!/bin/sh\necho tar\n");
  });

  it.each([
    ["a 0600 file", async (root: string) => { await chmod(join(root, "libexec", "launcher.mjs"), 0o600); }],
    ["a 0775 directory", async (root: string) => { await chmod(join(root, "libexec"), 0o775); }],
    ["a symlink", async (root: string) => { await symlink("launcher.mjs", join(root, "libexec", "link")); }],
    ["a hard link", async (root: string) => { await link(join(root, "libexec", "launcher.mjs"), join(root, "libexec", "second")); }],
  ])("refuses %s", async (_label, damage) => {
    const root = await keg(join(await scratch(), "k"), "bad");
    await damage(root);
    await expect(tarballOf(root, MTIME)).rejects.toThrow(/refusing to tar/u);
  });

  it("refuses an mtime that is negative, fractional or beyond the ustar field", async () => {
    const root = await keg(join(await scratch(), "k"), "m");
    for (const mtime of [-1, 1.5, 8 ** 11]) await expect(tarballOf(root, mtime)).rejects.toThrow(/mtime/u);
  });

  it("refuses a path that does not fit a ustar header", async () => {
    const root = await keg(join(await scratch(), "k"), "long");
    await file(join(root, "libexec", "x".repeat(101)), "x\n", 0o644);
    await expect(tarballOf(root, MTIME)).rejects.toThrow(/does not fit a ustar header/u);
  });

  it("keeps the bundle archive's fixed mtime", () => {
    const archive = archiveOf([{ path: "a", kind: "file", mode: 384, bytes: "1", sha256: "0".repeat(64) }] as unknown as Parameters<typeof archiveOf>[0], new Map([["a", new Uint8Array([0x61])]]));
    const header = zstdDecompressSync(archive).subarray(0, 512);
    expect(new TextDecoder().decode(header.subarray(136, 148))).toBe("14000000000\0");
  });

  it("writes both tarballs and a SHA256SUMS that shasum verifies", async () => {
    const pack = join(await scratch(), "pack");
    await dir(pack);
    await keg(join(pack, "darwin-arm64"), "arm");
    await keg(join(pack, "darwin-x64"), "intel");
    const dest = join(await scratch(), "dist");
    await writeReleaseTarballs({ packDir: pack, version: "0.1.0", mtime: MTIME, dest });
    const sums = await readFile(join(dest, "SHA256SUMS"), "utf8");
    const names = ["developer-os-0.1.0-darwin-arm64.tar.gz", "developer-os-0.1.0-darwin-x64.tar.gz"];
    const expected = await Promise.all(names.map(async (name) => `${createHash("sha256").update(await readFile(join(dest, name))).digest("hex")}  ${name}\n`));
    expect(sums).toBe(expected.join(""));
    const check = spawnSync("shasum", ["-a", "256", "-c", "SHA256SUMS"], { cwd: dest, encoding: "utf8" });
    expect(check.status).toBe(0);
    expect((await readdir(dest)).sort()).toEqual(["SHA256SUMS", ...names]);
  });

  it("refuses an existing destination and a version that is not stable semver", async () => {
    const pack = join(await scratch(), "pack");
    await dir(pack);
    await keg(join(pack, "darwin-arm64"), "a");
    await keg(join(pack, "darwin-x64"), "b");
    const dest = join(await scratch(), "dist");
    await dir(dest);
    await expect(writeReleaseTarballs({ packDir: pack, version: "0.1.0", mtime: MTIME, dest })).rejects.toThrow(/already exists/u);
    await expect(writeReleaseTarballs({ packDir: pack, version: "0.1", mtime: MTIME, dest: join(await scratch(), "d2") })).rejects.toThrow(/stable semver/u);
  });
});
```

The "keeps the bundle archive's fixed mtime" case passes before and after the change. It guards the refactor of `release-archive.ts` in Step 3.

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm exec vitest run tests/tools/release-tarball.test.ts`
Expected: FAIL with "Failed to resolve import ./release-tarball.js".

- [ ] **Step 3: Implement.** In `tests/tools/release-archive.ts`, replace the private `ustarHeader` with:

```ts
export interface UstarEntry {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly mode: number;
}

/** The bundle archive's fixed mtime (Spec 2 §3); release tarballs pass the tag commit's time. */
const BUNDLE_MTIME = 0o14_000_000_000;

export function ustarHeader(entry: UstarEntry, size: number, mtime: number = BUNDLE_MTIME): Uint8Array {
  const boundary = entry.path.lastIndexOf("/");
  const name = boundary < 0 ? entry.path : entry.path.slice(boundary + 1);
  const prefix = boundary < 0 ? "" : entry.path.slice(0, boundary);
  if (encoder.encode(name).byteLength > 100 || encoder.encode(prefix).byteLength > 155) {
    throw new Error(`refusing to archive: ${entry.path} does not fit a ustar header`);
  }
  const header = new Uint8Array(BLOCK);
  const put = (offset: number, text: string): void => {
    header.set(encoder.encode(text), offset);
  };
  put(0, name);
  put(100, octal(entry.mode, 8));
  put(108, octal(0, 8));
  put(116, octal(0, 8));
  put(124, octal(size, 12));
  put(136, octal(mtime, 12));
  put(156, entry.kind === "directory" ? "5" : "0");
  put(257, "ustar\0");
  put(263, "00");
  put(345, prefix);
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) sum += index >= 148 && index < 156 ? 0x20 : (header[index] as number);
  put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
  return header;
}
```

`archiveOf` keeps calling `ustarHeader(entry, content.byteLength)`. Its `ReleaseBundleEntryV1` entries satisfy `UstarEntry` structurally.

Create `tests/tools/release-tarball.ts`:

```ts
/**
 * A16 §2 step 3: `developer-os-X.Y.Z-darwin-<arch>.tar.gz`, the keg root's contents as sorted ustar
 * members, owner 0:0, the tag commit's mtime, the keg's own 0755/0644 modes; gzip with no name and
 * a zero header mtime (Node's gzip writes neither), so a rebuild of the tag gives the same bytes.
 *
 * `node tests/dist/tools/release-tarball.js --pack <dir> --version <X.Y.Z> --mtime <s> --dest <dir>`
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

import { parseStableSemver, sortUtf8 } from "@developer-os/core";

import { ustarHeader } from "./release-archive.js";
import type { UstarEntry } from "./release-archive.js";

const BLOCK = 512;
const MAX_MTIME = 8 ** 11 - 1;

interface Member extends UstarEntry {
  readonly bytes: Uint8Array;
}

async function memberOf(kegRoot: string, path: string): Promise<Member> {
  const stats = await lstat(path);
  const mode = stats.mode & 0o7777;
  const relativePath = relative(kegRoot, path);
  if (stats.isDirectory() && mode === 0o755) return { path: relativePath, kind: "directory", mode, bytes: new Uint8Array() };
  if (stats.isFile() && stats.nlink === 1 && (mode === 0o755 || mode === 0o644)) {
    return { path: relativePath, kind: "file", mode, bytes: new Uint8Array(await readFile(path)) };
  }
  throw new Error(`refusing to tar: ${relativePath} is not a 0755 directory or a single-link 0644/0755 file`);
}

export async function tarballOf(kegRoot: string, mtime: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(mtime) || mtime < 0 || mtime > MAX_MTIME) throw new Error(`refusing to tar: mtime ${String(mtime)} is not a whole number of seconds in the ustar range`);
  const members: Member[] = [];
  for (const entry of await readdir(kegRoot, { recursive: true, withFileTypes: true })) members.push(await memberOf(kegRoot, join(entry.parentPath, entry.name)));
  if (members.length === 0) throw new Error(`refusing to tar: ${kegRoot} is empty`);
  const parts: Uint8Array[] = [];
  for (const member of sortUtf8(members, (row) => row.path)) {
    parts.push(ustarHeader(member, member.bytes.byteLength, mtime), member.bytes, new Uint8Array((BLOCK - (member.bytes.byteLength % BLOCK)) % BLOCK));
  }
  parts.push(new Uint8Array(2 * BLOCK));
  return new Uint8Array(gzipSync(Buffer.concat(parts), { level: 9 }));
}

export async function writeReleaseTarballs(options: { readonly packDir: string; readonly version: string; readonly mtime: number; readonly dest: string }): Promise<void> {
  let version: string;
  try {
    version = parseStableSemver(options.version);
  } catch (error) {
    throw new Error(`refusing to tar: version ${options.version} is not stable semver`, { cause: error });
  }
  try {
    await mkdir(options.dest, { mode: 0o755 });
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === "EEXIST") throw new Error(`refusing to tar: ${options.dest} already exists`, { cause: error });
    throw error;
  }
  const lines: string[] = [];
  for (const architecture of ["arm64", "x64"] as const) {
    const name = `developer-os-${version}-darwin-${architecture}.tar.gz`;
    const bytes = await tarballOf(join(options.packDir, `darwin-${architecture}`), options.mtime);
    await writeFile(join(options.dest, name), bytes, { flag: "wx", mode: 0o644 });
    lines.push(`${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`);
  }
  await writeFile(join(options.dest, "SHA256SUMS"), lines.join(""), { flag: "wx", mode: 0o644 });
}

function isEntryPoint(entry: string | undefined): boolean {
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint(argv[1])) {
  const { values } = parseArgs({ args: argv.slice(2), strict: true, allowPositionals: false, options: { pack: { type: "string" }, version: { type: "string" }, mtime: { type: "string" }, dest: { type: "string" } } });
  const { pack, version, mtime, dest } = values;
  if (pack === undefined || version === undefined || mtime === undefined || dest === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(mtime)) {
    throw new Error("usage: release-tarball.js --pack <dir> --version <X.Y.Z> --mtime <epoch seconds> --dest <dir>");
  }
  await writeReleaseTarballs({ packDir: pack, version, mtime: Number(mtime), dest });
}
```

- [ ] **Step 4: Run the tests and lint.**

Run: `pnpm --pm-on-fail=ignore build && pnpm exec vitest run tests/tools/release-tarball.test.ts && pnpm exec vitest run tests/tools/pack-release.test.ts -t 'archive writer' && npm run lint`
Expected: PASS. Lint is clean.

- [ ] **Step 5: Commit.**

```bash
git add tests/tools/release-archive.ts tests/tools/release-tarball.ts tests/tools/release-tarball.test.ts
git commit -m "feat(release): deterministic release tarballs and SHA256SUMS (A16 §2 step 3)"
```

---

### Task 4: Tarball verifier — K2 admission plus a byte-flip refusal (M)

**Files:**
- Create: `tests/tools/verify-release-tarball.ts`
- Test: `tests/tools/verify-release-tarball.test.ts`

**Interfaces:**
- Consumes: `releaseSequenceOf(version)` (Task 2); `tarballOf(kegRoot, mtime)` (Task 3, test only); `pack(...)` from `tests/tools/pack-release.ts` (test only); `admitPackageChannelRelease(packageRoot, { prefix, requireVersion, architecture })` and `inspectPackagedRelease(source)` from `@developer-os/cli/dist/update/packaged-release.js`; `EXIT_CODES` from `@developer-os/core`. Admission rejects with an error whose `code` is `EXIT_CODES.recoveryRequired` (6) on any keg admission failure (K7 (a)). Admission only reads files, so one runner admits both architectures.
- Produces: `export async function verifyReleaseTarball(options: { readonly tarball: string; readonly version: string; readonly architecture: "arm64" | "x64" }): Promise<void>`. CLI: `node tests/dist/tools/verify-release-tarball.js --tarball <path> --version <X.Y.Z> --architecture <arm64|x64>` prints `verified <file name>\n`.

- [ ] **Step 1: Write the failing test.**

```ts
import { createHash } from "node:crypto";
import { chmod, cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pack } from "./pack-release.js";
import { tarballOf } from "./release-tarball.js";
import { verifyReleaseTarball } from "./verify-release-tarball.js";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "developer-os-verify-test-")));
  roots.push(root);
  await chmod(root, 0o755);
  return root;
}

/** A Node stand-in the packer accepts with `skipCpuCheck`: a shell script answering `--version`. */
async function stubNode(): Promise<{ readonly path: string; readonly sha256: string; readonly version: string }> {
  const path = join(await scratch(), "node");
  const bytes = new TextEncoder().encode("#!/bin/sh\necho v24.0.0\n");
  await writeFile(path, bytes, { mode: 0o755 });
  return { path, sha256: createHash("sha256").update(bytes).digest("hex"), version: "24.0.0" };
}

const MTIME = 1_791_000_000;
let out = "";

beforeAll(async () => {
  const node = await stubNode();
  out = join(await scratch(), "out");
  await pack({ outDir: out, version: "0.1.0", releaseSequence: "1000", indexSequence: "1000", node: { arm64: node, x64: node }, skipCpuCheck: true });
}, 600_000);

async function tarball(architecture: "arm64" | "x64", kegRoot = join(out, `darwin-${architecture}`)): Promise<string> {
  const path = join(await scratch(), `developer-os-0.1.0-darwin-${architecture}.tar.gz`);
  await writeFile(path, await tarballOf(kegRoot, MTIME));
  return path;
}

describe("verifyReleaseTarball (A16 §2 step 4)", () => {
  it.each(["arm64", "x64"] as const)("admits the intact %s tarball and refuses its byte-flipped copy", async (architecture) => {
    await expect(verifyReleaseTarball({ tarball: await tarball(architecture), version: "0.1.0", architecture })).resolves.toBeUndefined();
  }, 120_000);

  it("refuses the other architecture's tarball", async () => {
    await expect(verifyReleaseTarball({ tarball: await tarball("x64"), version: "0.1.0", architecture: "arm64" })).rejects.toThrow(/admission/u);
  }, 120_000);

  it("refuses a version the tarball does not carry", async () => {
    await expect(verifyReleaseTarball({ tarball: await tarball("arm64"), version: "0.2.0", architecture: "arm64" })).rejects.toThrow(/admission|sequence/u);
  }, 120_000);

  it("refuses a tarball whose stamped sequence is not the version's §3.2 sequence", async () => {
    const node = await stubNode();
    const wrong = join(await scratch(), "wrong");
    await pack({ outDir: wrong, version: "0.1.0", releaseSequence: "7", indexSequence: "7", node: { arm64: node, x64: node }, skipCpuCheck: true });
    await expect(verifyReleaseTarball({ tarball: await tarball("arm64", join(wrong, "darwin-arm64")), version: "0.1.0", architecture: "arm64" })).rejects.toThrow(/sequence 7.*1000/u);
  }, 600_000);

  it("refuses a tarball built from a keg whose bundle was altered before tarring", async () => {
    // A copy of the beforeAll keg, so this case needs no third pack (tests/ runs in test:suite).
    const altered = join(await scratch(), "darwin-arm64");
    await cp(join(out, "darwin-arm64"), altered, { recursive: true });
    const target = join(altered, "libexec", "fallback", "bundle", "bin", "verifier.mjs");
    const bytes = await readFile(target);
    bytes[0] = (bytes[0] as number) ^ 0x01;
    await writeFile(target, bytes);
    await expect(verifyReleaseTarball({ tarball: await tarball("arm64", altered), version: "0.1.0", architecture: "arm64" })).rejects.toThrow(/admission/u);
  }, 120_000);
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm exec vitest run tests/tools/verify-release-tarball.test.ts`
Expected: FAIL with "Failed to resolve import ./verify-release-tarball.js".

- [ ] **Step 3: Implement `tests/tools/verify-release-tarball.ts`.**

```ts
/**
 * A16 §2 step 4: unpack a release tarball into a scratch prefix, run the production K2 keg admission
 * on its `libexec/fallback`, and require a copy with one flipped bundle byte to refuse with exit 6.
 *
 * `node tests/dist/tools/verify-release-tarball.js --tarball <path> --version <X.Y.Z> --architecture <arm64|x64>`
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { argv, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { EXIT_CODES } from "@developer-os/core";
import { admitPackageChannelRelease, inspectPackagedRelease } from "@developer-os/cli/dist/update/packaged-release.js";

import { releaseSequenceOf } from "./release-metadata.js";

type Architecture = "arm64" | "x64";
const FLIPPED_FILE = "libexec/fallback/bundle/bin/planner.mjs";

async function extract(tarball: string, into: string): Promise<string> {
  await mkdir(into, { mode: 0o755 });
  await chmod(into, 0o755);
  execFileSync("/usr/bin/tar", ["-xpzf", tarball, "-C", into], { stdio: ["ignore", "ignore", "pipe"] });
  return into;
}

async function modeOf(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

async function admit(prefix: string, version: string, architecture: Architecture): Promise<void> {
  if ((await modeOf(join(prefix, "bin", "developer-os"))) !== 0o755 || (await modeOf(join(prefix, "libexec", "launcher.mjs"))) !== 0o644) {
    throw new Error("refusing the release: the launcher files do not carry modes 0755 and 0644");
  }
  const { identity } = await admitPackageChannelRelease(join(prefix, "libexec", "fallback"), { prefix, requireVersion: version, architecture })
    .then(inspectPackagedRelease)
    .catch((error: unknown) => {
      throw new Error(`refusing the release: K2 admission failed for ${architecture}`, { cause: error });
    });
  const expected = releaseSequenceOf(version);
  if (identity.releaseSequence !== expected || identity.releaseIndexSequence !== expected) {
    throw new Error(`refusing the release: the tarball stamps sequence ${identity.releaseSequence}/${identity.releaseIndexSequence}, not ${version}'s ${expected}`);
  }
}

export async function verifyReleaseTarball(options: { readonly tarball: string; readonly version: string; readonly architecture: Architecture }): Promise<void> {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "developer-os-verify-")));
  try {
    await chmod(scratch, 0o755);
    await admit(await extract(options.tarball, join(scratch, "intact")), options.version, options.architecture);
    const flipped = await extract(options.tarball, join(scratch, "flipped"));
    const target = join(flipped, FLIPPED_FILE);
    const bytes = await readFile(target);
    bytes[0] = (bytes[0] as number) ^ 0x01;
    await writeFile(target, bytes);
    const refusal = await admit(flipped, options.version, options.architecture).then(
      () => null,
      (error: unknown) => (error as { readonly cause?: { readonly code?: unknown } }).cause?.code,
    );
    if (refusal !== EXIT_CODES.recoveryRequired) throw new Error(`refusing the release: a copy with one flipped byte in ${FLIPPED_FILE} was not refused with exit 6`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function isEntryPoint(entry: string | undefined): boolean {
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint(argv[1])) {
  const { values } = parseArgs({ args: argv.slice(2), strict: true, allowPositionals: false, options: { tarball: { type: "string" }, version: { type: "string" }, architecture: { type: "string" } } });
  const { tarball, version, architecture } = values;
  if (tarball === undefined || version === undefined || (architecture !== "arm64" && architecture !== "x64")) {
    throw new Error("usage: verify-release-tarball.js --tarball <path> --version <X.Y.Z> --architecture <arm64|x64>");
  }
  await verifyReleaseTarball({ tarball, version, architecture });
  stdout.write(`verified ${basename(tarball)}\n`);
}
```

If `admit`'s wrapped error does not carry `code === 6` on its `cause` for a flipped byte (for example because the flip lands in a check that reports exit 5), stop and report: K7 (a) says every keg admission failure is exit 6, so a different code is a finding, not something to loosen here.

- [ ] **Step 4: Run the tests and lint.**

Run: `pnpm --pm-on-fail=ignore build && pnpm exec vitest run tests/tools/verify-release-tarball.test.ts && npm run lint`
Expected: PASS (a few minutes: two real packs with stub runtimes). Lint is clean.

- [ ] **Step 5: Commit.**

```bash
git add tests/tools/verify-release-tarball.ts tests/tools/verify-release-tarball.test.ts
git commit -m "feat(release): verify each release tarball by K2 admission and a byte-flip refusal (A16 §2 step 4)"
```

---

### Task 5: CI pins — Node archives, gitleaks, cdxgen, runner label (S)

**Files:**
- Create: `.github/release/pins.json`
- Test: `tests/repository/release-pins.test.ts`

**Interfaces:**
- Consumes: `.node-version` (`24.16.0`).
- Produces: `.github/release/pins.json` with exactly this shape. Task 8 reads it with `jq`.

```json
{
  "node": { "version": "<.node-version>", "darwin-arm64": "<sha256 of node-v<version>-darwin-arm64.tar.gz>", "darwin-x64": "<sha256 of node-v<version>-darwin-x64.tar.gz>" },
  "gitleaks": { "version": "<X.Y.Z>", "darwin-arm64": "<sha256 of gitleaks_<X.Y.Z>_darwin_arm64.tar.gz>" },
  "cdxgen": { "version": "<X.Y.Z>" }
}
```

The angle-bracket values are the outputs of Step 3's commands. They are not to be typed by hand.

- [ ] **Step 1: Write the failing test.**

```ts
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const HEX = /^[0-9a-f]{64}$/u;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;

describe("release pins (A16 §2, §3.3, §5)", () => {
  it("pins the bundled Node to .node-version, Node 24, with both darwin archive hashes", async () => {
    const pins = JSON.parse(await readFile(join(root, ".github/release/pins.json"), "utf8")) as Record<string, Record<string, string>>;
    const nodeVersion = (await readFile(join(root, ".node-version"), "utf8")).trim();
    expect(Object.keys(pins).sort()).toEqual(["cdxgen", "gitleaks", "node"]);
    expect(pins.node).toEqual({ version: nodeVersion, "darwin-arm64": expect.stringMatching(HEX), "darwin-x64": expect.stringMatching(HEX) });
    expect(nodeVersion).toMatch(/^24\.[0-9]+\.[0-9]+$/u);
    expect(pins.node?.["darwin-arm64"]).not.toBe(pins.node?.["darwin-x64"]);
    expect(pins.gitleaks).toEqual({ version: expect.stringMatching(SEMVER), "darwin-arm64": expect.stringMatching(HEX) });
    expect(pins.cdxgen).toEqual({ version: expect.stringMatching(SEMVER) });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm exec vitest run tests/repository/release-pins.test.ts`
Expected: FAIL with `ENOENT … .github/release/pins.json`.

- [ ] **Step 3: Generate the pins. This step needs network access.** Run each command and use its output. Do not guess any value.

```bash
V=$(cat .node-version)
curl -fsSL "https://nodejs.org/dist/v$V/SHASUMS256.txt" -o "$TMPDIR/node-shasums.txt"
NODE_ARM=$(awk -v f="node-v$V-darwin-arm64.tar.gz" '$2==f{print $1}' "$TMPDIR/node-shasums.txt")
NODE_X64=$(awk -v f="node-v$V-darwin-x64.tar.gz" '$2==f{print $1}' "$TMPDIR/node-shasums.txt")
GL=$(gh api repos/gitleaks/gitleaks/releases/latest --jq .tag_name | sed 's/^v//')
GL_ARM=$(curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v$GL/gitleaks_${GL}_checksums.txt" | awk -v f="gitleaks_${GL}_darwin_arm64.tar.gz" '$2==f{print $1}')
CDX=$(npm view @cyclonedx/cdxgen version)
test -n "$NODE_ARM" && test -n "$NODE_X64" && test -n "$GL_ARM" && test -n "$CDX"
mkdir -p .github/release
jq -n --arg v "$V" --arg na "$NODE_ARM" --arg nx "$NODE_X64" --arg gl "$GL" --arg ga "$GL_ARM" --arg cdx "$CDX" \
  '{node: {version: $v, "darwin-arm64": $na, "darwin-x64": $nx}, gitleaks: {version: $gl, "darwin-arm64": $ga}, cdxgen: {version: $cdx}}' > .github/release/pins.json
```

Then confirm the runner label, again with network access:

```bash
curl -fsSL https://raw.githubusercontent.com/actions/runner-images/main/README.md | grep -n 'macos-15'
```

Expected: a row listing `macos-15` as an available arm64 macOS 15 label. If `macos-15` is absent or marked deprecated, **stop and report** to the orchestrator: the label in `check.yml` and in Tasks 8 and 9 must be a founder decision, not a substitution. Record the date of the check and the matching README line in the commit message body.

- [ ] **Step 4: Run the test and lint.**

Run: `pnpm exec vitest run tests/repository/release-pins.test.ts && npm run lint`
Expected: PASS. Lint is clean.

- [ ] **Step 5: Commit.**

```bash
git add .github/release/pins.json tests/repository/release-pins.test.ts
git commit -m "build(release): pin the Node 24 darwin archives, gitleaks and cdxgen for release CI (A16 §2, §5)"
```

---

### Task 6: Secret-scan baseline over the full history (S)

**Files:**
- Create: `.gitleaks.toml`
- Test: `tests/repository/gitleaks-config.test.ts`

**Interfaces:**
- Consumes: the locally installed `gitleaks` (`/opt/homebrew/bin/gitleaks`). It is not a dependency.
- Produces: `.gitleaks.toml`, which extends gitleaks' default rules. Every `[[allowlists]]` table carries a non-empty `description` giving its reason. Task 8's preflight runs `gitleaks git --config .gitleaks.toml --redact --exit-code 1 .`.

- [ ] **Step 1: Write the failing test.**

```ts
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

describe(".gitleaks.toml (A16 §5)", () => {
  it("extends the default rules, and every allowlist entry states its reason", async () => {
    const text = await readFile(join(root, ".gitleaks.toml"), "utf8");
    expect(text).toMatch(/^\[extend\]\nuseDefault = true$/mu);
    expect(text).not.toMatch(/^\[allowlist\]$/mu);
    const blocks = text.split(/^\[\[allowlists\]\]$/mu).slice(1);
    for (const block of blocks) expect(block).toMatch(/^description = "[^"\n]{12,}"$/mu);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm exec vitest run tests/repository/gitleaks-config.test.ts`
Expected: FAIL with `ENOENT … .gitleaks.toml`.

- [ ] **Step 3: Write the config and scan the history.** Check `gitleaks version`. It must be 8.25.0 or later, because the per-entry `[[allowlists]]` table form needs it. If it is older, stop and report. Create:

```toml
# A16 §5: the release preflight runs gitleaks over the full history at the tag.
# Every [[allowlists]] entry names the synthetic fixture it admits and why it is not a secret.
[extend]
useDefault = true
```

Run: `gitleaks git --config .gitleaks.toml --redact --exit-code 1 --report-path "$TMPDIR/gitleaks.json" .`

For each finding in `$TMPDIR/gitleaks.json`:
- **A real credential (any value that ever authenticated anything):** stop. Do not allowlist it, and do not rewrite history. Report the commit, file and rule ID (redacted) to the orchestrator. Rotation and any history rewrite are founder decisions and block Task 11.
- **A synthetic fixture** (for example under `tests/fixtures/` or in a redactor test): add one entry per fixture:

```toml
[[allowlists]]
description = "Synthetic AWS-shaped key in the redactor tests; never issued by AWS"
paths = ['''^packages/security/src/redaction/fixtures/aws\.txt$''']
```

Repeat until `gitleaks git --config .gitleaks.toml --redact --exit-code 1 .` exits 0.

- [ ] **Step 4: Run the test, the scan and lint.**

Run: `pnpm exec vitest run tests/repository/gitleaks-config.test.ts && gitleaks git --config .gitleaks.toml --redact --exit-code 1 . && npm run lint`
Expected: PASS, gitleaks prints "no leaks found", and lint is clean.

- [ ] **Step 5: Commit.**

```bash
git add .gitleaks.toml tests/repository/gitleaks-config.test.ts
git commit -m "build(release): gitleaks history-scan baseline with a reason for every allowlist entry (A16 §5)"
```

---

### Task 7: Homebrew formula renderer (S)

**Files:**
- Create: `tests/tools/render-formula.ts`
- Test: `tests/tools/render-formula.test.ts`

**Interfaces:**
- Consumes: `parseStableSemver` from `@developer-os/core`.
- Produces:
  - `export interface FormulaInput { readonly version: string; readonly license: string; readonly sha256: Readonly<Record<"arm64" | "x64", string>> }`
  - `export function renderFormula(input: FormulaInput): string`
  - `export function sumsOf(text: string, version: string): Readonly<Record<"arm64" | "x64", string>>` reads a two-line `SHA256SUMS` strictly.
  - `export function licenseOf(packageJson: string): string` returns the root `package.json` `"license"` (a simple SPDX expression). It throws `… no license … (L1)` when the field is absent.
  - CLI: `node tests/dist/tools/render-formula.js --version <X.Y.Z> --sums <SHA256SUMS path>` prints the formula and reads the license from `<repo root>/package.json`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";

import { licenseOf, renderFormula, sumsOf } from "./render-formula.js";

const ARM = "a".repeat(64);
const X64 = "b".repeat(64);

const EXPECTED = `class DeveloperOs < Formula
  desc "Shared workflows and a local-first knowledge base for Claude Code and Codex"
  homepage "https://github.com/msolecki/developer-os"
  version "0.1.0"
  license "MIT"
  on_arm do
    url "https://github.com/msolecki/developer-os/releases/download/v0.1.0/developer-os-0.1.0-darwin-arm64.tar.gz"
    sha256 "${ARM}"
  end
  on_intel do
    url "https://github.com/msolecki/developer-os/releases/download/v0.1.0/developer-os-0.1.0-darwin-x64.tar.gz"
    sha256 "${X64}"
  end
  depends_on :macos

  def install
    prefix.install Dir["*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/developer-os --version")
  end
end
`;

describe("renderFormula (A16 §3.1 as amended by §3.3)", () => {
  it("renders the exact formula", () => {
    expect(renderFormula({ version: "0.1.0", license: "MIT", sha256: { arm64: ARM, x64: X64 } })).toBe(EXPECTED);
  });

  it("never renders a revision, a post_install, a node dependency or a libexec-only install", () => {
    const text = renderFormula({ version: "1.2.0", license: "MIT", sha256: { arm64: ARM, x64: X64 } });
    for (const forbidden of ["revision", "post_install", 'depends_on "node"', "libexec.install", "install_symlink"]) expect(text).not.toContain(forbidden);
  });

  it.each([
    ["a prerelease version", { version: "1.0.0-rc.1" }, /version/u],
    ["an upper-case hash", { sha256: { arm64: ARM.toUpperCase(), x64: X64 } }, /sha256/u],
    ["a short hash", { sha256: { arm64: "a".repeat(63), x64: X64 } }, /sha256/u],
    ["a license that could break out of the Ruby string", { license: 'MIT" do system "x' }, /license/u],
  ])("refuses %s", (_label, override, message) => {
    expect(() => renderFormula({ version: "0.1.0", license: "MIT", sha256: { arm64: ARM, x64: X64 }, ...override })).toThrow(message);
  });
});

describe("sumsOf", () => {
  const sums = `${ARM}  developer-os-0.1.0-darwin-arm64.tar.gz\n${X64}  developer-os-0.1.0-darwin-x64.tar.gz\n`;

  it("reads both tarball hashes", () => {
    expect(sumsOf(sums, "0.1.0")).toEqual({ arm64: ARM, x64: X64 });
  });

  it.each([
    ["another version's file names", sums.replaceAll("0.1.0", "0.2.0")],
    ["a missing x64 line", `${ARM}  developer-os-0.1.0-darwin-arm64.tar.gz\n`],
    ["an unknown extra line", `${sums}${ARM}  other.tar.gz\n`],
    ["a duplicated line", `${sums}${X64}  developer-os-0.1.0-darwin-x64.tar.gz\n`],
    ["a single-space separator", sums.replace("  developer-os-0.1.0-darwin-arm64", " developer-os-0.1.0-darwin-arm64")],
  ])("refuses %s", (_label, text) => {
    expect(() => sumsOf(text, "0.1.0")).toThrow(/SHA256SUMS/u);
  });
});

describe("licenseOf", () => {
  it("reads the root package.json license and refuses its absence until L1", () => {
    expect(licenseOf('{"name":"developer-os","license":"MIT"}')).toBe("MIT");
    expect(() => licenseOf('{"name":"developer-os"}')).toThrow(/no license.*L1/u);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm exec vitest run tests/tools/render-formula.test.ts`
Expected: FAIL with "Failed to resolve import ./render-formula.js".

- [ ] **Step 3: Implement `tests/tools/render-formula.ts`.**

```ts
/**
 * A16 §3.1 as amended by §3.3: the tap's `Formula/developer-os.rb`, rendered from exact values.
 * `node tests/dist/tools/render-formula.js --version <X.Y.Z> --sums <SHA256SUMS>`
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { argv, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { parseStableSemver } from "@developer-os/core";

type Architecture = "arm64" | "x64";
const HEX = /^[0-9a-f]{64}$/u;
const SPDX = /^[A-Za-z0-9.+-]+$/u;
const RELEASES = "https://github.com/msolecki/developer-os/releases/download";

export interface FormulaInput {
  readonly version: string;
  readonly license: string;
  readonly sha256: Readonly<Record<Architecture, string>>;
}

function tarballName(version: string, architecture: Architecture): string {
  return `developer-os-${version}-darwin-${architecture}.tar.gz`;
}

function checked(input: FormulaInput): FormulaInput {
  try {
    parseStableSemver(input.version);
  } catch (error) {
    throw new Error(`refusing to render: version ${input.version} is not stable semver`, { cause: error });
  }
  if (!SPDX.test(input.license)) throw new Error(`refusing to render: license ${input.license} is not a simple SPDX identifier`);
  if (!HEX.test(input.sha256.arm64) || !HEX.test(input.sha256.x64)) throw new Error("refusing to render: a sha256 is not 64 lowercase hex digits");
  return input;
}

export function renderFormula(input: FormulaInput): string {
  const { version, license, sha256 } = checked(input);
  return `class DeveloperOs < Formula
  desc "Shared workflows and a local-first knowledge base for Claude Code and Codex"
  homepage "https://github.com/msolecki/developer-os"
  version "${version}"
  license "${license}"
  on_arm do
    url "${RELEASES}/v${version}/${tarballName(version, "arm64")}"
    sha256 "${sha256.arm64}"
  end
  on_intel do
    url "${RELEASES}/v${version}/${tarballName(version, "x64")}"
    sha256 "${sha256.x64}"
  end
  depends_on :macos

  def install
    prefix.install Dir["*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/developer-os --version")
  end
end
`;
}

export function sumsOf(text: string, version: string): Readonly<Record<Architecture, string>> {
  const found = new Map<string, string>();
  for (const line of text.split("\n").filter((row) => row !== "")) {
    const match = /^([0-9a-f]{64}) {2}(\S+)$/u.exec(line);
    const name = match?.[2];
    if (match === null || name === undefined || found.has(name)) throw new Error(`refusing to render: SHA256SUMS line "${line}" is malformed or repeated`);
    found.set(name, match[1] as string);
  }
  const arm64 = found.get(tarballName(version, "arm64"));
  const x64 = found.get(tarballName(version, "x64"));
  if (arm64 === undefined || x64 === undefined || found.size !== 2) throw new Error(`refusing to render: SHA256SUMS does not list exactly the two ${version} tarballs`);
  return { arm64, x64 };
}

export function licenseOf(packageJson: string): string {
  const license = (JSON.parse(packageJson) as { readonly license?: unknown }).license;
  if (typeof license !== "string" || license === "") throw new Error("refusing to render: the root package.json has no license (founder gate L1)");
  return license;
}

function isEntryPoint(entry: string | undefined): boolean {
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint(argv[1])) {
  const { values } = parseArgs({ args: argv.slice(2), strict: true, allowPositionals: false, options: { version: { type: "string" }, sums: { type: "string" } } });
  if (values.version === undefined || values.sums === undefined) throw new Error("usage: render-formula.js --version <X.Y.Z> --sums <SHA256SUMS>");
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: "utf8" }).trim();
  stdout.write(renderFormula({ version: values.version, license: licenseOf(await readFile(join(root, "package.json"), "utf8")), sha256: sumsOf(await readFile(values.sums, "utf8"), values.version) }));
}
```

- [ ] **Step 4: Run the tests, a Ruby syntax check and lint.**

Run:
```bash
pnpm --pm-on-fail=ignore build && pnpm exec vitest run tests/tools/render-formula.test.ts
node --input-type=module -e 'import { renderFormula } from "./tests/dist/tools/render-formula.js"; process.stdout.write(renderFormula({ version: "0.1.0", license: "MIT", sha256: { arm64: "a".repeat(64), x64: "b".repeat(64) } }));' > "$TMPDIR/developer-os.rb" && ruby -c "$TMPDIR/developer-os.rb"
npm run lint
```
Expected: PASS, `Syntax OK`, and lint is clean.

- [ ] **Step 5: Commit.**

```bash
git add tests/tools/render-formula.ts tests/tools/render-formula.test.ts
git commit -m "feat(release): render the Homebrew formula from exact values (A16 §3.1, §3.3)"
```

---

### Task 8: `release.yml` — preflight, build, verify, draft (M)

**Files:**
- Create: `.github/workflows/release.yml`
- Test: `tests/repository/release-workflow.test.ts`

**Interfaces:**
- Consumes: Task 1 (the packer refuses `--allow-dirty` under `CI`); Task 2 `node tests/dist/tools/release-metadata.js sequence|notes <X.Y.Z>`; Task 3 `node tests/dist/tools/release-tarball.js --pack --version --mtime --dest`; Task 4 `node tests/dist/tools/verify-release-tarball.js --tarball --version --architecture`; Task 5 `.github/release/pins.json`; Task 6 `.gitleaks.toml`; the packer CLI `node tests/dist/tools/pack-release.js --out --version --release-sequence --index-sequence --node-<arch> --node-<arch>-sha256 --node-<arch>-version`.
- Produces: on tag `v*`, a draft release `vX.Y.Z` with `developer-os-X.Y.Z-darwin-arm64.tar.gz`, `developer-os-X.Y.Z-darwin-x64.tar.gz`, `SHA256SUMS` and `developer-os-X.Y.Z.cdx.json`, with notes from `CHANGELOG.md`. Task 9 relies on these asset names.

- [ ] **Step 1: Write the failing test.**

```ts
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const workflow = await readFile(join(root, ".github/workflows/release.yml"), "utf8");

/** Each top-level job's text, keyed by job id. */
function jobs(text: string): ReadonlyMap<string, string> {
  const body = text.slice(text.indexOf("\njobs:\n") + "\njobs:\n".length);
  const parts = body.split(/^ {2}(?=[a-z][a-z0-9-]*:$)/mu).filter((part) => part.trim() !== "");
  return new Map(parts.map((part) => [part.slice(0, part.indexOf(":")), part]));
}

describe("release.yml (A16 §2)", () => {
  it("runs on version tags only, reads contents by default, and has the three jobs", () => {
    expect(workflow).toMatch(/^on:\n {2}push:\n {4}tags:\n {6}- 'v\*'\n/mu);
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/mu);
    expect([...jobs(workflow).keys()]).toEqual(["preflight", "build", "publish"]);
  });

  it("grants contents: write to the publish job only, and actions: read to the preflight only", () => {
    const byJob = jobs(workflow);
    expect(workflow.match(/contents: write/gu)?.length).toBe(1);
    expect(byJob.get("publish")).toContain("contents: write");
    expect(workflow.match(/actions: read/gu)?.length).toBe(1);
    expect(byJob.get("preflight")).toContain("actions: read");
  });

  it("requires a successful check.yml push run on development for the tag's commit and never reruns the suite", () => {
    const preflight = jobs(workflow).get("preflight") ?? "";
    expect(preflight).toContain("actions/workflows/check.yml/runs?head_sha=${sha}&branch=development&event=push&status=success");
    expect(preflight).toContain("git merge-base --is-ancestor HEAD origin/development");
    expect(preflight).toContain("gitleaks git --config .gitleaks.toml --redact --exit-code 1 .");
    expect(workflow).not.toMatch(/npm (?:run check|test)|test:suite|vitest/u);
  });

  it("never passes --allow-dirty and pins the packer's Node to .node-version", () => {
    expect(workflow).not.toContain("--allow-dirty");
    expect(workflow).toContain("node-version-file: .node-version");
    expect(workflow).not.toMatch(/node-version: /u);
  });

  it("packs twice and compares, verifies both tarballs, and drafts the release", () => {
    const build = jobs(workflow).get("build") ?? "";
    expect(build.match(/node tests\/dist\/tools\/pack-release\.js/gu)?.length).toBe(1);
    expect(build).toContain("for run in 1 2; do");
    expect(build).toContain('cmp "$RUNNER_TEMP/dist-1/SHA256SUMS" "$RUNNER_TEMP/dist-2/SHA256SUMS"');
    for (const architecture of ["arm64", "x64"]) expect(build).toContain(`--architecture ${architecture}`);
    expect(build).toContain("node tests/dist/tools/release-metadata.js notes");
    expect(build).toContain("pnpm dlx \"@cyclonedx/cdxgen@${cdxgen}\"");
    expect(jobs(workflow).get("publish")).toContain("gh release create \"$GITHUB_REF_NAME\" --repo \"$GITHUB_REPOSITORY\" --draft --verify-tag");
  });

  it("reaches scripts with event data only through env", () => {
    expect(workflow).not.toMatch(/\$\{\{\s*github\.(?:event|ref_name|head_ref)/u);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm exec vitest run tests/repository/release-workflow.test.ts`
Expected: FAIL with `ENOENT … .github/workflows/release.yml`.

- [ ] **Step 3: Write `.github/workflows/release.yml`.**

```yaml
name: release

# A16 (docs/superpowers/specs/2026-10-07-developer-os-release-publication-design.md):
# a pushed tag vX.Y.Z on development becomes a DRAFT release. Publishing the draft
# is the founder's first approval; tap.yml then opens the tap pull request, and
# merging it is the second. Nothing here reaches a user.
on:
  push:
    tags:
      - 'v*'

permissions:
  contents: read

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

defaults:
  run:
    shell: bash

jobs:
  preflight:
    runs-on: macos-15
    timeout-minutes: 30
    permissions:
      contents: read
      actions: read
    steps:
      - uses: actions/checkout@v4
        with:
          # The history scan reads every commit reachable from the tag, and the
          # ancestry check needs origin/development.
          fetch-depth: 0
      - name: Tag is on development
        run: git merge-base --is-ancestor HEAD origin/development
      - name: check.yml passed on this commit
        # Never rerun the ~4 h suite here. A pull_request run tests a merge ref,
        # not this tree, so only a push run on development counts.
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          sha=$(git rev-parse HEAD)
          count=$(gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/check.yml/runs?head_sha=${sha}&branch=development&event=push&status=success" --jq '.total_count')
          if [ "$count" -lt 1 ]; then
            echo "::error::no successful check.yml push run on development for ${sha}; tag a commit whose check.yml run completed green"
            exit 1
          fi
      - name: History secret scan
        run: |
          version=$(jq -r '.gitleaks.version' .github/release/pins.json)
          sum=$(jq -r '.gitleaks["darwin-arm64"]' .github/release/pins.json)
          archive="gitleaks_${version}_darwin_arm64.tar.gz"
          curl -fsSL -o "$RUNNER_TEMP/$archive" "https://github.com/gitleaks/gitleaks/releases/download/v${version}/${archive}"
          echo "${sum}  $RUNNER_TEMP/$archive" | shasum -a 256 -c -
          mkdir "$RUNNER_TEMP/gitleaks"
          tar -xzf "$RUNNER_TEMP/$archive" -C "$RUNNER_TEMP/gitleaks" gitleaks
          "$RUNNER_TEMP/gitleaks/gitleaks" git --config .gitleaks.toml --redact --exit-code 1 .

  build:
    needs: preflight
    runs-on: macos-15
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1
      - uses: actions/setup-node@v4
        with:
          # The archives' zstd bytes depend on the Node that runs the packer (§3.3).
          node-version-file: .node-version
      - name: Enable pnpm through corepack
        run: corepack enable
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Build
        run: pnpm --pm-on-fail=ignore build
      - name: Release inputs
        run: |
          version="${GITHUB_REF_NAME#v}"
          sequence=$(node tests/dist/tools/release-metadata.js sequence "$version")
          {
            echo "VERSION=${version}"
            echo "SEQUENCE=${sequence}"
            echo "MTIME=$(git log -1 --format=%ct)"
            echo "NODE_VERSION=$(jq -r '.node.version' .github/release/pins.json)"
          } >> "$GITHUB_ENV"
      - name: Node runtimes
        # Outside the checkout, so the packer's clean-tree check still holds.
        run: |
          for arch in arm64 x64; do
            archive="node-v${NODE_VERSION}-darwin-${arch}.tar.gz"
            curl -fsSL -o "$RUNNER_TEMP/$archive" "https://nodejs.org/dist/v${NODE_VERSION}/${archive}"
            echo "$(jq -r --arg key "darwin-${arch}" '.node[$key]' .github/release/pins.json)  $RUNNER_TEMP/$archive" | shasum -a 256 -c -
            mkdir "$RUNNER_TEMP/node-${arch}"
            tar -xzf "$RUNNER_TEMP/$archive" -C "$RUNNER_TEMP/node-${arch}" --strip-components 2 "node-v${NODE_VERSION}-darwin-${arch}/bin/node"
          done
      - name: Pack twice and compare
        run: |
          arm64_sha=$(shasum -a 256 "$RUNNER_TEMP/node-arm64/node" | cut -d' ' -f1)
          x64_sha=$(shasum -a 256 "$RUNNER_TEMP/node-x64/node" | cut -d' ' -f1)
          for run in 1 2; do
            node tests/dist/tools/pack-release.js --out "$RUNNER_TEMP/pack-${run}" \
              --version "$VERSION" --release-sequence "$SEQUENCE" --index-sequence "$SEQUENCE" \
              --node-arm64 "$RUNNER_TEMP/node-arm64/node" --node-arm64-sha256 "$arm64_sha" --node-arm64-version "$NODE_VERSION" \
              --node-x64 "$RUNNER_TEMP/node-x64/node" --node-x64-sha256 "$x64_sha" --node-x64-version "$NODE_VERSION"
            node tests/dist/tools/release-tarball.js --pack "$RUNNER_TEMP/pack-${run}" --version "$VERSION" --mtime "$MTIME" --dest "$RUNNER_TEMP/dist-${run}"
          done
          cmp "$RUNNER_TEMP/dist-1/SHA256SUMS" "$RUNNER_TEMP/dist-2/SHA256SUMS"
      - name: Verify both tarballs
        run: |
          node tests/dist/tools/verify-release-tarball.js --tarball "$RUNNER_TEMP/dist-1/developer-os-${VERSION}-darwin-arm64.tar.gz" --version "$VERSION" --architecture arm64
          node tests/dist/tools/verify-release-tarball.js --tarball "$RUNNER_TEMP/dist-1/developer-os-${VERSION}-darwin-x64.tar.gz" --version "$VERSION" --architecture x64
      - name: SBOM and release notes
        run: |
          cdxgen=$(jq -r '.cdxgen.version' .github/release/pins.json)
          pnpm dlx "@cyclonedx/cdxgen@${cdxgen}" -t js -o "$RUNNER_TEMP/dist-1/developer-os-${VERSION}.cdx.json" .
          jq -e '.bomFormat == "CycloneDX"' "$RUNNER_TEMP/dist-1/developer-os-${VERSION}.cdx.json" > /dev/null
          node tests/dist/tools/release-metadata.js notes "$VERSION" > "$RUNNER_TEMP/dist-1/notes.md"
      - uses: actions/upload-artifact@v4
        with:
          name: release
          path: ${{ runner.temp }}/dist-1
          if-no-files-found: error

  publish:
    needs: build
    runs-on: macos-15
    timeout-minutes: 10
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: release
          path: release
      - name: Draft release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          version="${GITHUB_REF_NAME#v}"
          gh release create "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" --draft --verify-tag \
            --title "$GITHUB_REF_NAME" --notes-file release/notes.md \
            "release/developer-os-${version}-darwin-arm64.tar.gz" \
            "release/developer-os-${version}-darwin-x64.tar.gz" \
            release/SHA256SUMS \
            "release/developer-os-${version}.cdx.json"
```

- [ ] **Step 4: Run the test, actionlint and lint.**

Run: `pnpm exec vitest run tests/repository/release-workflow.test.ts && actionlint .github/workflows/release.yml && npm run lint`
Expected: PASS. `actionlint` prints nothing (it runs `shellcheck` on every `run:` block because `shellcheck` is on `PATH`). Lint is clean. Do not add `actionlint` to CI or to any `package.json`.

- [ ] **Step 5: Commit.**

```bash
git add .github/workflows/release.yml tests/repository/release-workflow.test.ts
git commit -m "ci(release): tag-triggered preflight, deterministic build, K2 verify and draft release (A16 §2 steps 2–5)"
```

The first live run is Task 11 step 5. It needs L1 (the `license` field, the `LICENSE` file and the CHANGELOG section of the tagged version) and L2 (release permissions).

---

### Task 9: `tap.yml` — the tap pull request on publish (S)

**Files:**
- Create: `.github/workflows/tap.yml`
- Test: `tests/repository/tap-workflow.test.ts`

**Interfaces:**
- Consumes: Task 7 `node tests/dist/tools/render-formula.js --version <X.Y.Z> --sums <path>`. Task 8's asset names `developer-os-X.Y.Z-darwin-<arch>.tar.gz` and `SHA256SUMS`. The secret `TAP_PR_TOKEN` and the repository `msolecki/homebrew-developer-os` (L2).
- Produces: on `release: published`, a pull request in `msolecki/homebrew-developer-os` from the branch `release/vX.Y.Z` that writes `Formula/developer-os.rb`.

- [ ] **Step 1: Write the failing test.**

```ts
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
  });

  it("verifies the published tarballs against SHA256SUMS before rendering", () => {
    const verify = workflow.indexOf("shasum -a 256 -c SHA256SUMS");
    const render = workflow.indexOf("node tests/dist/tools/render-formula.js");
    expect(verify).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(verify);
    expect(workflow).toContain('ruby -c "$RUNNER_TEMP/developer-os.rb"');
  });

  it("uses TAP_PR_TOKEN once, against the tap repository only", () => {
    expect(workflow.match(/secrets\.TAP_PR_TOKEN/gu)?.length).toBe(1);
    expect(workflow).toContain("gh pr create --repo msolecki/homebrew-developer-os");
    expect(workflow).toContain("Formula/developer-os.rb");
  });

  it("reaches scripts with event data only through env", () => {
    for (const line of workflow.split("\n").filter((row) => row.includes("github.event.release"))) {
      expect(line).toMatch(/^\s+(?:TAG|ref): \$\{\{ github\.event\.release\.tag_name \}\}$/u);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm exec vitest run tests/repository/tap-workflow.test.ts`
Expected: FAIL with `ENOENT … .github/workflows/tap.yml`.

- [ ] **Step 3: Write `.github/workflows/tap.yml`.**

```yaml
name: tap

# A16 §2 step 7: the founder published a draft release (approval 1). Render the
# formula from the published assets and open a pull request in the tap. Merging
# it (approval 2) is the release.
on:
  release:
    types: [published]

permissions:
  contents: read

defaults:
  run:
    shell: bash

jobs:
  formula:
    runs-on: macos-15
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.release.tag_name }}
      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
      - name: Enable pnpm through corepack
        run: corepack enable
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Build
        run: pnpm --pm-on-fail=ignore build
      - name: Download, verify and render
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ github.event.release.tag_name }}
        run: |
          version="${TAG#v}"
          mkdir "$RUNNER_TEMP/assets"
          gh release download "$TAG" --repo "$GITHUB_REPOSITORY" --dir "$RUNNER_TEMP/assets" \
            --pattern SHA256SUMS --pattern "developer-os-${version}-darwin-*.tar.gz"
          (cd "$RUNNER_TEMP/assets" && shasum -a 256 -c SHA256SUMS)
          node tests/dist/tools/render-formula.js --version "$version" --sums "$RUNNER_TEMP/assets/SHA256SUMS" > "$RUNNER_TEMP/developer-os.rb"
          ruby -c "$RUNNER_TEMP/developer-os.rb"
      - name: Open the tap pull request
        env:
          GH_TOKEN: ${{ secrets.TAP_PR_TOKEN }}
          TAG: ${{ github.event.release.tag_name }}
        run: |
          branch="release/${TAG}"
          gh auth setup-git
          gh repo clone msolecki/homebrew-developer-os "$RUNNER_TEMP/tap"
          cd "$RUNNER_TEMP/tap" || exit 1
          git checkout -b "$branch"
          mkdir -p Formula
          cp "$RUNNER_TEMP/developer-os.rb" Formula/developer-os.rb
          git add Formula/developer-os.rb
          git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
            commit -m "developer-os ${TAG#v}"
          git push origin "$branch"
          gh pr create --repo msolecki/homebrew-developer-os --head "$branch" \
            --title "developer-os ${TAG#v}" \
            --body "Release ${TAG}: https://github.com/${GITHUB_REPOSITORY}/releases/tag/${TAG}"
```

- [ ] **Step 4: Run the test, actionlint and lint.**

Run: `pnpm exec vitest run tests/repository/tap-workflow.test.ts && actionlint .github/workflows/tap.yml && npm run lint`
Expected: PASS. `actionlint` prints nothing. Lint is clean.

- [ ] **Step 5: Commit.**

```bash
git add .github/workflows/tap.yml tests/repository/tap-workflow.test.ts
git commit -m "ci(release): open the tap pull request when a release is published (A16 §2 step 7)"
```

First live run: Task 11 step 6 (**Blocked by: L2**, because the tap repository and `TAP_PR_TOKEN` do not exist yet).

---

### Task 10: Public documentation set (L)

**Files:**
- Create: `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/privacy.md`, `docs/install/README.md`, `docs/tutorials/claude-only.md`, `docs/tutorials/codex-only.md`, `docs/tutorials/dual-agent.md`, `docs/troubleshooting/README.md`
- Test: `tests/repository/public-docs.test.ts`
- Not in this task: `LICENSE` (Task 11, L1).

**Interfaces:**
- Consumes: Task 2 `releaseNotesOf(changelog, version)`. `parse(argv)` from `@developer-os/cli/dist/main.js` and `parseUpdateArgv(argv)` from `@developer-os/cli/dist/commands/update/index.js` (`apps/cli/src/main.ts` — `parse`; `apps/cli/src/commands/update/index.ts` — `parseUpdateArgv`; `@developer-os/cli` has no `exports` map, so deep `dist/` imports resolve).
- Produces: the documentation set that Spec A16 §4 names. `CHANGELOG.md` has a non-empty `## [0.1.0]` section, which `release.yml` requires.

- [ ] **Step 1: Write the failing test.**

```ts
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
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `pnpm exec vitest run tests/repository/public-docs.test.ts`
Expected: FAIL with `ENOENT … README.md` at module load.

- [ ] **Step 3: Write the documents.** Write plain English with short sentences. Use concrete, synthetic examples only, and put every command in a ```sh fence exactly as the user types it. Before writing a command, confirm its options against `node apps/cli/dist/bin.js --help` (built by `pnpm --pm-on-fail=ignore build`). Required content per file:

`README.md`:
- What the product is. Use the formula `desc` sentence: "Shared workflows and a local-first knowledge base for Claude Code and Codex."
- Status: "Public beta (0.Y.Z). Interfaces may change before 1.0.0."
- Requirements: macOS on Apple Silicon or Intel, Homebrew, and Claude Code or Codex (or both). No separate Node install: the runtime ships inside the package.
- Install, in this fence:
  ```sh
  brew tap msolecki/developer-os
  brew install developer-os
  developer-os init --adapters claude,codex
  ```
- Links: [Install and upgrade](docs/install/README.md), the three tutorials, [Troubleshooting](docs/troubleshooting/README.md), [Privacy](docs/privacy.md), [Security](SECURITY.md), [Contributing](CONTRIBUTING.md), [Changelog](CHANGELOG.md), [Compatibility matrix](docs/releases/compatibility-matrix.md).
- A "License" section with one line: "See LICENSE." Use no link until Task 11 adds the file, because the link test would fail.

`SECURITY.md`:
- Supported versions: the latest `0.Y.Z` beta only.
- Reporting: privately through GitHub security advisories at `https://github.com/msolecki/developer-os/security/advisories/new`, never in a public issue.
- What to include: version (`developer-os --version`), macOS version, architecture, steps, and the expected and actual result. Never include a vault's content or a secret.
- Scope notes: updates are trusted through the Homebrew tap (no signatures, by design). A process running as the same user is outside the boundary (`docs/architecture/threat-model.md`).

`CONTRIBUTING.md`:
- Setup: `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm --pm-on-fail=ignore build`. Node `24.16.0` (`.node-version`).
- Gates: `npm run lint`, and `npm run check` for a full run (about 4 h, macOS only).
- Synthetic fixtures only. Never commit a real vault or credential.
- A "Releasing" section (the runbook, D7). (1) Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md`. (2) Land it on `development` and wait for that push's `check.yml` run to finish green. A run cancelled by a later push does not count, and a pull-request run does not count. (3) `git tag vX.Y.Z <that commit>` and `git push origin vX.Y.Z`. (4) Review the draft release, its notes, the two tarballs, `SHA256SUMS` and the SBOM, then publish it (approval 1). (5) Review and merge the tap pull request (approval 2). Withdraw a release by deleting the draft or closing the tap pull request. Roll back a merged formula by reverting the tap commit. Never use Homebrew's `revision`: the launcher admits only `Cellar/developer-os/<X.Y.Z>`. Version rule: minor and patch stay below 1000.

`CHANGELOG.md`: Keep a Changelog format with `## [Unreleased]` and:

```markdown
## [0.1.0]

First public beta.

### Added
- Homebrew installation for macOS on Apple Silicon and Intel, with the Node 24 runtime inside the package.
- `init`, `capture`, `review`, `ingest`, `search`, `status`, `doctor`, `repair` and `uninstall`.
- `update` and `update rollback` from the installed Homebrew package; the product makes no network request.

### Formats
- Bundle manifest `schemaVersion` 1, launcher protocol 1, update protocol 1, release sequence 1000.
```

The heading carries no date until the founder adds it in Task 11 step 3. `releaseNotesOf` accepts both `## [0.1.0]` and `## [0.1.0] - YYYY-MM-DD` with a real date.

`docs/privacy.md`:
- "The product itself makes no network request." (exact sentence)
- Every network action, listed:
  - Homebrew downloads the tap and the release tarball from GitHub when you run `brew tap`, `brew install` or `brew upgrade`.
  - The vendor CLIs you run (Claude Code, Codex) talk to their vendors under their own terms. `ingest` and Brain workflows invoke them only when you run those commands.
  - Git sync and automation, when you enable them, run `git` against the remote you configured.
- No telemetry, no analytics, no crash reports. The beta collects only the issues participants choose to report.
- Where data lives: the product home and the Brain vault paths (from `developer-os status`).

`docs/install/README.md`: sections with a fence each.
- Install: `brew tap msolecki/developer-os`, `brew install developer-os`.
- First run: `developer-os init --dry-run --adapters claude,codex`, then `developer-os init --adapters claude,codex`.
- Upgrade: `brew upgrade developer-os`, `developer-os update`, `developer-os update --apply`.
- Rollback: `developer-os update rollback`, `developer-os update rollback --apply`.
- Uninstall: `developer-os uninstall --dry-run`, `developer-os uninstall --yes`, `brew uninstall developer-os`. State that the Brain vault is kept.
- One sentence explaining that `brew upgrade` alone does not change the active release: `developer-os update --apply` does.

Tutorials. Each uses one synthetic vault and contains, in order, the commands:
- `docs/tutorials/claude-only.md`: `developer-os init --adapters claude`; `developer-os capture --text "Decision: release notes live in CHANGELOG.md"`; `developer-os review`; `developer-os review --id <capture-id> --decision accept`; `developer-os ingest --agent claude`; `developer-os search "release notes"`.
- `docs/tutorials/codex-only.md`: the same with `--adapters codex` and `--agent codex`.
- `docs/tutorials/dual-agent.md`: `--adapters claude,codex`, ingest once with each agent, and a short section on the differences, linking [the compatibility matrix](../releases/compatibility-matrix.md).

`docs/troubleshooting/README.md`:
- `developer-os doctor` and `developer-os status` first.
- Exit codes from `packages/core/src/result.ts` — `EXIT_CODES`: 0 success, 1 operational failure, 2 invalid input, 3 decision required, 4 capability unavailable (for example `update_package_source_absent`: run `brew install developer-os`), 5 security refusal, 6 recovery required (`developer-os repair --resume`, then `developer-os doctor`).
- "workflows not refreshed: run developer-os init" after an update (Spec 2 K8).
- "A second install of the same version with different bytes refuses" (`update_release_identity_rebound`).
- How to report: the issue tracker for bugs, and [SECURITY.md](../../SECURITY.md) for vulnerabilities.

- [ ] **Step 4: Run the test, the citations gate and lint.**

Run: `pnpm --pm-on-fail=ignore build && pnpm exec vitest run tests/repository/public-docs.test.ts tests/repository/citations.test.ts && npm run lint`
Expected: PASS. Lint is clean.

- [ ] **Step 5: Commit.**

```bash
git add README.md SECURITY.md CONTRIBUTING.md CHANGELOG.md docs/privacy.md docs/install/README.md docs/tutorials/claude-only.md docs/tutorials/codex-only.md docs/tutorials/dual-agent.md docs/troubleshooting/README.md tests/repository/public-docs.test.ts
git commit -m "docs: public documentation set for the first beta (A16 §4)"
```

---

### Task 11: Founder gates, VM gate and the first beta tag (L) — **Blocked by: L1, L2**

**Owner:** the founder. The orchestrator prepares commands and records evidence. Steps 1–2 each need the named gate.

**Files:**
- Create: `LICENSE` (L1 text, verbatim from counsel)
- Modify: `package.json` (add `"license": "<SPDX id>"`), `README.md` (License line becomes `See [LICENSE](LICENSE).`), `CHANGELOG.md` (date the `0.1.0` heading)
- Modify (orchestrator, `git add -f`): `docs/superpowers/ORDER.md`, `docs/superpowers/BACKLOG.md`, this plan's checkboxes

**Interfaces:**
- Consumes: Tasks 1–10 integrated on `development`, plus a green full `npm run check` (D32 plan close).
- Produces: `v0.1.0` published through the tap, with VM evidence.

- [ ] **Step 1: L1 — license (Blocked by: L1).** Counsel approves the exact OSI text (MIT proposed, D69 (9)). Commit `LICENSE`, add `"license": "MIT"` (or the approved SPDX id) to the root `package.json`, and change README's License line to a link. Verify: `node --input-type=module -e 'import { licenseOf } from "./tests/dist/tools/render-formula.js"; import { readFileSync } from "node:fs"; console.log(licenseOf(readFileSync("package.json","utf8")))'` prints the id, and `pnpm exec vitest run tests/repository/public-docs.test.ts` passes. Commit:

```bash
git add LICENSE package.json README.md
git commit -m "chore(license): add the counsel-approved license (L1)"
```

- [ ] **Step 2: L2 — remote setup (Blocked by: L2).** Create the public repository `msolecki/homebrew-developer-os` with `Formula/` and a default branch `main`. Create the fine-grained token `TAP_PR_TOKEN`, scoped to that one repository with contents and pull-request write access, and store it as an Actions secret on `msolecki/developer-os`. Confirm that Actions may create releases (Settings → Actions → Workflow permissions allow `contents: write` for jobs that request it) and that private vulnerability reporting is enabled (for `SECURITY.md`). Confirm that the `baseline` ruleset lets the founder push tags `v*`: `gh api repos/msolecki/developer-os/rulesets` lists no tag rule that blocks it.
- [ ] **Step 3: Date the changelog and ratify.** Ratify Spec A16 §3.3 and Spec 2 K7. Answer D5 (the `.tar.zst` assets). Set the `0.1.0` date in `CHANGELOG.md`. Commit:

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): date 0.1.0"
```

- [ ] **Step 4: Plan close (D32).** On a quiet machine, run `npm run check` once. Push to `development` (through a pull request, because of GH013) and wait for the `check.yml` push run on the resulting `development` head to complete green. Tick the deferred steps.
- [ ] **Step 5: Tag the first beta.** Run `git tag v0.1.0 <that green development head>` and `git push origin v0.1.0`. Watch `release.yml`: preflight, build (two packs, `cmp` equal, both verifies print `verified …`), publish. Locally, reproduce the bytes as §6 promises: check out the tag in a scratch clone, run Task 8's build steps with the same `.node-version` and pins, and confirm `cmp` against the draft's `SHA256SUMS`.
- [ ] **Step 6: Approval 1 (Blocked by: L1, L2).** Draft assets have no public URL, so the VM gate runs between the two approvals. Publish the draft `v0.1.0`. Watch `tap.yml` open the pull request. A published release whose tap pull request is unmerged reaches no user (§2).
- [ ] **Step 7: VM gate (D96 Q5).** In a fresh macOS VM whose only user owns `/opt/homebrew`, clone the tap, check out the pull request's branch `release/v0.1.0`, and `brew tap msolecki/developer-os <that local clone>`. Then:

```sh
brew install developer-os
brew test developer-os
mkdir "$TMPDIR/x" && tar -xzf developer-os-0.1.0-darwin-arm64.tar.gz -C "$TMPDIR/x"
diff -r "$TMPDIR/x/libexec" "$(brew --prefix)/opt/developer-os/libexec"
diff <(cd "$TMPDIR/x/libexec" && find . -exec stat -f '%Lp %N' {} + | sort) <(cd "$(brew --prefix)/opt/developer-os/libexec" && find . -exec stat -f '%Lp %N' {} + | sort)
developer-os init --adapters claude,codex
developer-os capture --text "Decision: VM gate"
developer-os review
developer-os review --id <capture-id> --decision accept
developer-os ingest --agent claude
developer-os search "VM gate"
```

Record the SHA-256 of every Brain file (`find <vault> -type f -exec shasum -a 256 {} + | sort > before.txt`). Then build a second version locally for the upgrade leg. In a scratch clone at a later green commit, run Task 8's build steps for `0.1.1`, then point the local tap's formula at `file://` URLs of those tarballs with `node tests/dist/tools/render-formula.js --version 0.1.1 --sums <its SHA256SUMS>`, editing only the two `url` lines. Run `brew upgrade developer-os`, `developer-os update --apply`, `developer-os update rollback --apply` and `developer-os uninstall --yes`. Recompute the hash list and confirm `diff before.txt after.txt` is empty. Both `diff -r` and the mode diff must print nothing (Review Focus 1). `brew test` must pass (Review Focus 2). Repeat once on the founder machine (K6). Store the evidence (commands, outputs, hashes) in the A16 record. A failure here is a release blocker: close the tap pull request, and the published release reaches no user.
- [ ] **Step 8: Approval 2.** Review the formula diff in the tap pull request and merge it. Confirm that `brew update && brew info developer-os` shows `0.1.0`.
- [ ] **Step 9: Beta and close.** Invite participants with synthetic or their own vaults. Route each release blocker through the normal spec and plan flow, and rerun step 6 per beta. `1.0.0` needs no open release blocker, NEW-200 closed (D96 Q3), and L1 and L2 closed (§3.2). Orchestrator: update `ORDER.md` (A16 progress line) and `BACKLOG.md`, then commit with exact paths:

```bash
git add -f docs/superpowers/ORDER.md docs/superpowers/BACKLOG.md docs/superpowers/plans/2026-10-08-a16-release-publication.md
git commit -m "docs: A16 first beta v0.1.0 published; VM gate evidence recorded"
```
