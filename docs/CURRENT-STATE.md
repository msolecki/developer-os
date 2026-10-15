---
status: current
owner: Mateusz Solecki
last-verified: 2026-10-15
---

# Current state

Verified at: branch `fix/audit-2026-10-15` (not yet merged)

What is true on the branch above, checked against the files and by running `CI=1 scripts/check.sh`
(green, including the five script tests). agnix was not re-run on this branch. Once the branch is
merged and `development` has moved far past it, treat each line as unverified.

## Works

- Install from the marketplace on `development`: `.claude-plugin/marketplace.json` → `plugin/`.
- 28 skills, 5 agents, 4 output styles, 3 hooks, as listed in
  [product/functional-spec.md](product/functional-spec.md).
- Per-session cost: core rules 8158 of 8192 bytes; skill descriptions 10183 of 12000 characters; a
  state card of at most 1024 bytes after compaction or resume.
- The Codex installer fits all 28 skills in 7824 description characters of Codex's 8000.
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
- Eval run of the changed cases: pending

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

The findings of the 2026-10-15 audit are fixed on this branch, except what was deliberately not
done: #23 (qa-expert's assessment mode stays prose-only), #49 (capture-nudge keeps its transcript
scan, about 0.3 s on a 52 MB transcript), and eval cases still missing for brain-setup,
audit-to-backlog, deploy-checklist, docs-sync, skill-usage and the pr-cycle fork gate and thread
order.

| ID | Sev | Where | Problem |
|---|---|---|---|
| R1 | P2 | `plugin/hooks/guard.sh` | Newlines are not segment separators, so `pnpm install` followed by another command on the next line asks. Reproduced. |
| R2 | P3 | `plugin/hooks/guard.sh` | Any non-dash word after `install` asks: `pnpm install --filter web`, `npm install --prefix dir`. Reproduced. |
| R3 | P2 | `plugin/skills/brain-setup/SKILL.md`, step 3 | The config-edit snippet sets `$tmp`, `$S`, `$V`, `$C` in one block and uses them after the approval pause; Bash calls do not keep variables, so the second half runs with empty values unless the agent re-assigns them. `diff` errors when `settings.json` is missing. |
| R4 | P2 | `plugin/skills/brain-setup/SKILL.md`, step 3 | The `sed` replacement of the `Brain vault:` line corrupts a path containing `&`, a pipe or a backslash. |
| R7 | P3 | No release procedure | Pinning by marketplace ref is documented and `SECURITY.md` supports only the latest commit, but there is no release tag or procedure (tags, changelog date); `main` is not kept in step with `development`, yet `vault-template/README.md` links the workflow guide on `main`. |
| R8 | P3 | `plugin/vault-template/README.md` | Says to add three entries from `.obsidian/types.json`; the file has four (`sources` as multitext). |
| R9 | P3 | `plugin/.claude-plugin/plugin.json` | The description says "fail-closed validation" while both hooks fail open. The phrase most likely means the core rule that stops a commit when no validation command is known; the wording invites the wrong reading. |
| R10 | P3 | `tests/*.test.sh` | The hook branches added on this branch (state-card order, cut and age; Monitor deferral; `tasks/` output paths) have tests. Still untested: bare `--force`, `git push --no-verify`, `;`, pipe and `$( )` separators, newline-separated commands, `bun`; the 29/30 nudge boundary, non-numeric threshold, `TMPDIR` fallback. |
| R11 | P3 | `plugin/skills/skill-usage/SKILL.md` | The name pattern `[a-z-]+` misses names with digits; resumed or forked transcripts can repeat history and double-count. |
| R12 | P3 | Repository root | The repository tracks no `AGENTS.md`/`CLAUDE.md` of its own (`_Context.md` is local and git-ignored), so it does not follow the `templates/project/` standard it ships. |
| R18 | P2 | `plugin/skills/implement-backlog/SKILL.md`, eval `implement-backlog-owner` | In one of two runs the orchestrator dispatched without writing the `Owner` lines; the case scored 0 in both runs, partly because the eval sandbox denied write tools to delegates whose worktrees sat outside the workspace. |
| R17 | P3 | README, `SECURITY.md` | Both call the hook scripts POSIX `sh`; `capture-nudge.sh` uses `grep -o`, which POSIX does not define (macOS and Linux provide it). The README claim that an `ask` becomes a denial in `claude -p` was not re-verified. |
| R13 | P3 | `plugin/hooks/guard.sh` | Forms that pass without a prompt (reproduced): a full binary path (`/usr/bin/git push -f`), npm aliases (`npm in zod`), abbreviated `--no-veri`, and hook bypasses via `HUSKY=0` or `core.hooksPath=`. Lockfile-changing `update`/`remove` are outside the stated categories. The normal permission flow still applies. |
| R14 | P3 | `plugin/hooks/capture-nudge.sh` | When `CLAUDE_PLUGIN_DATA` and `TMPDIR` are both unset, markers go to a shared `/tmp/capture-nudge`; on a multi-user Linux host another user can own it and race the 7-day cleanup. Claude Code 2.1.300 sets `CLAUDE_PLUGIN_DATA`. |
| R15 | P3 | `.github/workflows/check.yml` | `npm install -g` of the pinned Claude Code still resolves its dependencies fresh and runs their install scripts; the job has a read-only token and no secrets. |
| R16 | P3 | `scripts/check.sh` | gitleaks scans files, not history, so a secret added and removed within one PR passes CI. |
