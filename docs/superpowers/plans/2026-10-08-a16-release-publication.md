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

- Orchestrator branch `integrate/a16`, cut from `development` after Task 11b is integrated (closed 2026-10-11, D98). Implementers branch `task/a16-<n>` from it in `../developer-os.worktrees/a16-<n>` (D33; an in-repository worktree breaks `eslint`).
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

## Tasks 1–10 (done 2026-10-08)

Integrated on `development`: packer CI refusal, release sequence and notes, deterministic tarballs and `SHA256SUMS`, tarball verifier, CI pins (`.github/release/pins.json`), secret-scan baseline (`.gitleaks.toml`), formula renderer, `release.yml`, `tap.yml`, and the public documentation set. Their steps are archived at `git show 71c9991d:docs/superpowers/plans/2026-10-08-a16-release-publication.md`. Only Task 11 remains.

---

### Task 11: Founder gates, VM gate and the first beta tag (L) — **Blocked by: L1, L2**

**Owner:** the founder. The orchestrator prepares commands and records evidence. Steps 1–2 each need the named gate.

**Files:**
- Create: `LICENSE` (L1 text, verbatim from counsel)
- Modify: `package.json` (add `"license": "<SPDX id>"`), `README.md` (License line becomes `See [LICENSE](LICENSE).`), `CHANGELOG.md` (date the `0.1.0` heading)
- Modify (orchestrator, `git add -f`): `docs/superpowers/ORDER.md`, `docs/superpowers/BACKLOG.md`, this plan's checkboxes

**Interfaces:**
- Consumes: Tasks 1–10 integrated on `development`, plus a green full `npm run check` (D32 plan close). Task 11b is closed (D98); its founder-machine leg runs in step 7.
- Produces: `v0.1.0` published through the tap, with VM evidence.

- [x] **Step 1: L1 — license.** Done 2026-10-14 (`915130c2`, MIT; `licenseOf` prints `MIT`, repository tests green). Counsel approves the exact OSI text (MIT proposed, D69 (9)). Commit `LICENSE`, add `"license": "MIT"` (or the approved SPDX id) to the root `package.json`, and change README's License line to a link. Verify: `node --input-type=module -e 'import { licenseOf } from "./tests/dist/tools/render-formula.js"; import { readFileSync } from "node:fs"; console.log(licenseOf(readFileSync("package.json","utf8")))'` prints the id, and `pnpm exec vitest run tests/repository/public-docs.test.ts` passes. Commit:

```bash
git add LICENSE package.json README.md
git commit -m "chore(license): add the counsel-approved license (L1)"
```

- [x] **Step 2: L2 — remote setup.** Done 2026-10-14. Checked 2026-10-14: tap repository public (default branch `dev`, which `tap.yml`'s `pr create` targets); `TAP_PR_TOKEN` is an environment secret of `tap`; environments `tap` and `release` admit only `v*` tags; private vulnerability reporting on; ruleset `release-tags` blocks only update, deletion and force-push of `v*`, so a tag push passes. Initial `Formula/developer-os.rb` merged to the tap's `dev` through tap PR #1 (D103 (5); the tap's ruleset makes a PR mandatory on `dev` only, 0 approvals, so `release/v*` branches are free). Render it with `node tests/dist/tools/render-formula.js --version 0.0.0 --sums <two zero-sum lines for 0.0.0>`; a dry run of `update-formula.sh v0.1.0` on it changed exactly 5/5 lines. Original text: Create the public repository `msolecki/homebrew-developer-os` with `Formula/` and a default branch `main`. Create the fine-grained token `TAP_PR_TOKEN`, scoped to that one repository with contents and pull-request write access, and store it as an Actions secret on `msolecki/developer-os`. Confirm that Actions may create releases (Settings → Actions → Workflow permissions allow `contents: write` for jobs that request it) and that private vulnerability reporting is enabled (for `SECURITY.md`). Confirm that the `baseline` ruleset lets the founder push tags `v*`: `gh api repos/msolecki/developer-os/rulesets` lists no tag rule that blocks it.
- [x] **Step 3: Date the changelog and ratify.** Done 2026-10-14 (D103): §3.3 and K7 ratified, D5 answered (no `.tar.zst` assets), `0.1.0` dated 2026-10-15. Ratify Spec A16 §3.3 and Spec 2 K7. Answer D5 (the `.tar.zst` assets). Set the `0.1.0` date in `CHANGELOG.md`. Commit:

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): date 0.1.0"
```

- [ ] **Step 4: Plan close (D32).** On a quiet machine, run `npm run check` once. Push to `development` (through a pull request, because of GH013) and wait for the `check.yml` push run on the resulting `development` head to complete green. Tick the deferred steps.
- [ ] **Step 5: Tag the first beta.** Run `git tag v0.1.0 <that green development head>` and `git push origin v0.1.0`. Watch `release.yml`: preflight, build (two packs, `cmp` equal, both verifies print `verified …`), publish. Locally, reproduce the bytes as §6 promises: check out the tag in a scratch clone, run `release.yml`'s build job steps with the same `.node-version` and pins, and confirm `cmp` against the draft's `SHA256SUMS`.
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

Record the SHA-256 of every Brain file (`find <vault> -type f -exec shasum -a 256 {} + | sort > before.txt`). Then build a second version locally for the upgrade leg. In a scratch clone at a later green commit, run `release.yml`'s build job steps for `0.1.1`, then point the local tap's formula at `file://` URLs of those tarballs with `node tests/dist/tools/render-formula.js --version 0.1.1 --sums <its SHA256SUMS>`, editing only the two `url` lines. Run `brew upgrade developer-os`, `developer-os update --apply`, `developer-os update rollback --apply` and `developer-os uninstall --yes`. Recompute the hash list and confirm `diff before.txt after.txt` is empty. Both `diff -r` and the mode diff must print nothing (Review Focus 1). `brew test` must pass (Review Focus 2). Repeat once on the founder machine (K6); that run is also Task 11b's founder-machine leg (D98): install from the tap per `docs/migration/founder-cutover.md` step 15's keg variant, and after `update --apply` and after `update rollback --apply` confirm that `~/.claude/skills/developer-os/hooks/hooks.json` is byte-identical to its copy before the command and names `/opt/homebrew/opt/developer-os/libexec/fallback/bundle/bin/node`, that the Codex plugin manifest's `version` is the active release, that `doctor` prints no `workflows not refreshed` warning, that the `update` preview's `packageSource` names the new Cellar keg with no download block, that `init --adapters claude,codex` found both vendors through the user's `PATH` under the launcher (NEW-202), and that `grep -c '"trust":"package-channel"' <product-home>/state/release-trust.json` prints `1`. The same founder-machine run is cutover step 16's items 6–7 (D99): take step 15's "before" hashes before the reinstall and require its three `diff`s empty, check the `uninstall --yes` against step 16 item 7's list, then reinstall through cutover step 17. Store the evidence (commands, outputs, hashes) in the A16 record. A failure here is a release blocker: close the tap pull request, and the published release reaches no user.
- [ ] **Step 8: Approval 2.** Review the formula diff in the tap pull request and merge it. Confirm that `brew update && brew info developer-os` shows `0.1.0`.
- [ ] **Step 9: Beta and close.** Invite participants with synthetic or their own vaults. Route each release blocker through the normal spec and plan flow, and rerun step 6 per beta. `1.0.0` needs no open release blocker, NEW-200 closed (D96 Q3), and L1 and L2 closed (§3.2). Orchestrator: update `ORDER.md` (A16 progress line) and `BACKLOG.md`, then commit with exact paths:

```bash
git add -f docs/superpowers/ORDER.md docs/superpowers/BACKLOG.md docs/superpowers/plans/2026-10-08-a16-release-publication.md
git commit -m "docs: A16 first beta v0.1.0 published; VM gate evidence recorded"
```
