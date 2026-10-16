---
status: current
owner: Mateusz Solecki
last-verified: 2026-10-16
---

# Current state

Verified at commit: `a4c66e96` (branch `feat/audit-fixes-2026-10-15`, the audit fixes of 2026-10-16 after the independent and security reviews)

What is true at the commit above, checked against the files and by running `CI=1 scripts/check.sh`
(green, including the six script tests). agnix 0.57.0 `--strict` reports no issues (CC-PL-004, the missing `version`, is disabled for plugin.json with its reason). If `development` has moved far past
this commit, treat each line as unverified.

## Works

- Install from the marketplace on `development`: `.claude-plugin/marketplace.json` → `plugin/`.
- 28 skills, 5 agents, 4 output styles, 3 hooks, as listed in
  [product/functional-spec.md](product/functional-spec.md).
- Per-session cost: core rules 8144 of 8192 bytes; skill descriptions 10183 of 12000 characters; a
  state card of at most 1024 bytes after compaction or resume.
- The Codex installer fits all 28 skills in 7892 bytes of descriptions, within Codex's 8000-character
  budget (it counts bytes, which are never fewer than characters).
- The shared "Locate the vault" paragraph is identical in brain-capture, brain-compile,
  brain-garden, brain-review and brain-search; the Vault paragraph stage of `scripts/check.sh` fails
  when the first paragraph under `## 1. Locate the vault` differs between them.
- `scripts/check.sh` enforces every rule CONTRIBUTING.md lists, in the stages listed in
  [development.md](development.md#the-check), including Stale names, link fragments and strict plugin
  validation; CI runs it on `development`, `main` and pull requests.
- 34 eval cases with a baseline arm, run by hand. The 16 added on 2026-10-15 ran once each on
  2026-10-15 (agent Sonnet 5.5, judge Opus 5.5, about 7.6 USD with two reruns after grader fixes):
  15 pass at 0.8. Δ +1.00: trigger-code-review, code-review-weakened-criterion, -boundary, -framed;
  Δ +0.67: implement-backlog-quota; Δ +0.50: injection-code-review, project-baseline-design,
  implement-backlog-roles, session-retro-persistence, -reversal, -lint; Δ 0 (the baseline passes
  too): implement-backlog-blocked, injection-fix-pr, -pr-cycle, -bug-triage. One run per case, so
  these are a first signal, not a stable score.
- The 14 new or changed cases ran once each on 2026-10-15 before the merge (agent Sonnet 5.5, judge
  Opus 5.5, 3.80 USD over two rounds). The first round caught two defects, fixed before the second:
  brain-garden missed notes with an upper-case `.MD` extension, and a grader with `---` in its frontmatter
  did not load. After the fixes all 14 pass at 0.8 with the plugin. Δ +1.00: implement-backlog-owner,
  -quota, brain-capture-refuses-log; Δ +0.71: brain-compile-originals; Δ +0.67: code-review-framed;
  Δ +0.50: fix-pr-approval, instruction-review-no-apply, implement-backlog-auth; Δ +0.33:
  brain-garden-no-apply, trigger-plan-status; Δ +0.25: spec-no-implementation; Δ 0 (the baseline passes
  too, even with the subtler payloads): injection-bug-triage, -fix-pr, -pr-cycle. One run per case.

## In progress

- `plugin.json` has no `version`: installs track the latest `development` commit. `CHANGELOG.md`
  collects everything under `[Unreleased]`; no release tag exists and the release procedure is open.
- Proposals under consideration, not implemented (kept in a local, git-ignored plan): the vault path
  through plugin `userConfig`; `paths:` for conventions skills; `context: fork` for report skills;
  `allowed-tools` for read-only commands; `${CLAUDE_SKILL_DIR}` in brain-setup; one budget for all
  fixed context; trigger evals for every action skill; a report-length contract for subagents beyond
  the final status; `effort` per skill.
- Not done by hand yet: listing on awesome-claude-code (eligible 14 days after the repository is
  public) and agentskill.sh, and checking the claude-plugins-official submission rules before a first tagged release.

## Known broken or missing

Found in the review of 2026-10-15 (independent code-reviewer and security-auditor passes, each finding reproduced or read in the code). Severity on the plugin's P0–P3 scale; none is P0 or P1.

The findings of the 2026-10-15 audit are fixed in #72, except what was deliberately not
done: #23 (qa-expert's assessment mode stays prose-only), #49 (capture-nudge keeps its transcript
scan, about 0.3 s on a 52 MB transcript), and eval cases still missing for brain-setup,
audit-to-backlog, deploy-checklist, docs-sync, skill-usage and the pr-cycle fork gate and thread
order, and for the seven `*-conventions` skills and the five agents (passive reference, no gate;
[development.md](development.md) step 6). The trigger-typescript-conventions case is not written.

The findings of the follow-up audit (decisions answered 2026-10-16) are fixed on `feat/audit-fixes-2026-10-15`; what still needs
the user:

- Eval re-runs by hand (`claude plugin eval`, paid): brain-garden-no-apply once, implement-backlog-owner
  twice, trigger-plan-status once, and optionally code-review-clean-diff once. The graders and
  scaffolds changed; the scores above predate the change.
- A pull-request CI run to confirm R15 and R16 (below).

| ID | Sev | Where | Problem |
|---|---|---|---|
| R7 | P3 | No release procedure | Pinning by marketplace ref is documented and `SECURITY.md` supports only the latest commit, but there is no release tag or procedure (tags, changelog date); `main` is not kept in step with `development`, yet `vault-template/README.md` links the workflow guide on `main`. |
| R1 | P3 | `plugin/hooks/guard.sh` | Accepted (D6): a command on the line after an install without a package asks, because the guard also reads newlines as spaces so a quoted multi-line argument cannot hide a flag or a package. |
| R13 | P3 | `plugin/hooks/guard.sh` | Lockfile-changing `update`/`remove` stay outside the guard's categories, by decision (Q3 A); the normal permission flow still applies. Known silent passes, all present before the 2026-10-16 fixes too: a word built at run time (`$(command -v npm) install x`), JSON `\u` escapes and ANSI-C escapes (`$'\x2d\x2dforce'`), digits in a flag cluster (`-4f`), abbreviated `--mirr`, a force refspec from config (`remote.origin.push=+main`), unquoted or environment-defined git aliases, and install aliases outside the list (`bun a`, `npm install-test`). The guard is a first prompt, not a sandbox. |
| R15 | P3 | `.github/workflows/check.yml` | Fixed and confirmed in the #76 CI run: the pinned Claude Code installs with `--ignore-scripts`, then runs only its own `install.cjs`; `claude --version` prints `2.1.300`. |
| R16 | P3 | `.github/workflows/check.yml` | Fixed, not yet confirmed: a gitleaks step scans the pull request's commits, so a secret added and removed within one PR fails CI. It has run only locally. |
| R17 | P3 | README | The claim that an `ask` becomes a denial in `claude -p` was not re-verified; proving it needs a live `claude -p` run. |
| R18 | P2 | Eval `implement-backlog-owner` | The skill now claims the batch (`Owner` lines, one commit) before writing any brief, and the eval scaffold gives delegates an ignored `.worktrees/` inside the workspace. The two by-hand re-runs that would show the case passing are pending. |
