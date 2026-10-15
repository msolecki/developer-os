---
status: current
owner: Mateusz Solecki
last-verified: 2026-10-15
---

# Current state

Verified at commit: `bca1c90e`

What is true at the commit above, checked against the files and by running `scripts/check.sh`
(green) and both hook tests (green). If `development` has moved far past this commit, treat each
line as unverified.

## Works

- Install from the marketplace on `development`: `.claude-plugin/marketplace.json` → `plugin/`.
- 28 skills, 5 agents, 4 output styles, 3 hooks, as listed in
  [product/functional-spec.md](product/functional-spec.md).
- Per-session cost: core rules 8148 of 8192 bytes; skill descriptions 9864 of 12000 characters.
- The shared "Locate the vault" paragraph is identical in brain-capture, brain-compile,
  brain-garden, brain-review and brain-search.
- `scripts/check.sh` enforces every rule CONTRIBUTING.md lists; CI runs it on `development`, `main`
  and pull requests.
- 15 eval cases with a baseline arm, run by hand.

## In progress

- Version 0.1.0 is "Unreleased" in `CHANGELOG.md`; no release tag exists.
- Proposals under consideration, not implemented (kept in a local, git-ignored plan): the vault path
  through plugin `userConfig`; `paths:` for conventions skills; `context: fork` for report skills;
  `allowed-tools` for read-only commands; `${CLAUDE_SKILL_DIR}` in brain-setup; one budget for all
  fixed context; a `DESIGN.md` in the project template; trigger evals for every action skill; a
  short subagent report contract; `effort` per skill.

## Known broken or missing

Found in the review of 2026-10-15 (independent code-reviewer and security-auditor passes, each finding reproduced or read in the code). Severity on the plugin's P0–P3 scale; none is P0 or P1.

| ID | Sev | Where | Problem |
|---|---|---|---|
| R1 | P2 | `plugin/hooks/guard.sh` | Newlines are not segment separators, so `pnpm install` followed by another command on the next line asks. Reproduced. |
| R2 | P3 | `plugin/hooks/guard.sh` | Any non-dash word after `install` asks: `pnpm install --filter web`, `npm install --prefix dir`. Reproduced. |
| R3 | P2 | `plugin/skills/brain-setup/SKILL.md`, step 3 | The config-edit snippet sets `$tmp`, `$S`, `$V`, `$C` in one block and uses them after the approval pause; Bash calls do not keep variables, so the second half runs with empty values unless the agent re-assigns them. `diff` errors when `settings.json` is missing. |
| R4 | P2 | `plugin/skills/brain-setup/SKILL.md`, step 3 | The `sed` replacement of the `Brain vault:` line corrupts a path containing `&`, a pipe or a backslash. |
| R5 | P2 | `plugin/skills/brain-garden/SKILL.md`, frontmatter checks | Dates are compared as raw strings; a quoted value (`created: "2026-09-28"`, common in vaults written by other tools) sorts below every date, so the note is reported as old or stale. |
| R6 | P2 | `plugin/skills/brain-garden/SKILL.md`, link checks | `find -name` is case-sensitive and globs; Obsidian resolves links case-insensitively, so `[[Release Process]]` is reported broken. Note names containing a dot are skipped as attachments. |
| R7 | P2 | `SECURITY.md`; no release procedure | "Only the latest release" and "pin a version" have no release, tag or pinning instructions behind them; `main` is 10 commits behind `development`, yet `vault-template/README.md` links the workflow guide on `main`. |
| R8 | P3 | `plugin/vault-template/README.md` | Says to add three entries from `.obsidian/types.json`; the file has four (`sources` as multitext). |
| R9 | P3 | `plugin/.claude-plugin/plugin.json` | The description says "fail-closed validation" while both hooks fail open. The phrase most likely means the core rule that stops a commit when no validation command is known; the wording invites the wrong reading. |
| R10 | P3 | `tests/*.test.sh` | Untested branches: bare `--force`, `git push --no-verify`, `;`, pipe and `$( )` separators, newline-separated commands, `bun`; the 29/30 nudge boundary, non-numeric threshold, `TMPDIR` fallback. |
| R11 | P3 | `plugin/skills/skill-usage/SKILL.md` | The name pattern `[a-z-]+` misses names with digits; resumed or forked transcripts can repeat history and double-count. |
| R12 | P3 | Repository root | The repository tracks no `AGENTS.md`/`CLAUDE.md` of its own (`_Context.md` is local and git-ignored), so it does not follow the `templates/project/` standard it ships. |
| R17 | P3 | README, `SECURITY.md` | Both call the hook scripts POSIX `sh`; `capture-nudge.sh` uses `grep -o`, which POSIX does not define (macOS and Linux provide it). The README claim that an `ask` becomes a denial in `claude -p` was not re-verified. |
| R13 | P3 | `plugin/hooks/guard.sh` | Forms that pass without a prompt (reproduced): a full binary path (`/usr/bin/git push -f`), npm aliases (`npm in zod`), abbreviated `--no-veri`, and hook bypasses via `HUSKY=0` or `core.hooksPath=`. Lockfile-changing `update`/`remove` are outside the stated categories. The normal permission flow still applies. |
| R14 | P3 | `plugin/hooks/capture-nudge.sh` | When `CLAUDE_PLUGIN_DATA` and `TMPDIR` are both unset, markers go to a shared `/tmp/capture-nudge`; on a multi-user Linux host another user can own it and race the 7-day cleanup. Claude Code 2.1.300 sets `CLAUDE_PLUGIN_DATA`. |
| R15 | P3 | `.github/workflows/check.yml` | `npm install -g` of the pinned Claude Code still resolves its dependencies fresh and runs their install scripts; the job has a read-only token and no secrets. |
| R16 | P3 | `scripts/check.sh` | gitleaks scans files, not history, so a secret added and removed within one PR passes CI. |
