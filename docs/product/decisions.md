---
status: current
owner: Mateusz Solecki
last-verified: 2026-10-15
---

# Decisions

One register for the plugin era. Each entry: date, decision, why, and the commit that put it in the code.
Alternatives are listed only where the history records them. Never renumber; when a decision is replaced, mark it superseded and
add a new entry. Decisions of the CLI era are not carried over; their history is at the git tag
`archive/cli-v0`.

## D1. Plugin only

- **Date:** 2026-10-14 · **Commit:** `19e4f61a`
- **Decision:** developer-os is a Claude Code plugin of Markdown and JSON. The CLI, its bundled Node
  runtime, background jobs, generated indexes and Homebrew tap are removed.
- **Why:** the CLI had grown to roughly 125k lines and a multi-hour validation gate to deliver what
  skills, rules and the agent's own file tools already do.

## D2. No runtime; two POSIX `sh` scripts at most

- **Date:** 2026-10-14, extended 2026-10-15 · **Commits:** `53504f88`, `1c324a89`
- **Decision:** the only executable code is the hook layer: `cat` of the core rules, plus
  `capture-nudge.sh` and `guard.sh` in POSIX `sh`, without `jq`, without network calls.
- **Why:** anything that runs in every session of every user must be small enough to read in full
  and must not add dependencies.

- **Amended 2026-10-15:** a third script, `session-start.sh`, replaces the inline `cat` (D16), and
  `scripts/install-codex.sh` runs only by hand, outside the plugin (D19).

## D3. The vault is read and written with the agent's own file tools

- **Date:** 2026-10-14 · **Commit:** `255c798e`
- **Decision:** brain skills use `rg`, `find`, Read, Write and Edit on plain Markdown. No index, no
  search server, no database.
- **Why:** `rg` over plain Markdown is enough for a personal vault; an index is one more thing to
  rebuild and drift. It replaces the CLI's `brain reindex` and `brain search`.

## D4. The agent writes only to `_inbox/`; archive, never delete

- **Date:** 2026-10-14 · **Commits:** `369028cc`, `0c4ab694`, `9242bf87`
- **Decision:** agent-created notes go to `_inbox/` with `status: inbox`. Any other edit, move,
  merge or archive happens only for notes the user names. Retired notes move to `_archive/` with
  `status: archived`; nothing is deleted.
- **Why:** an unreviewed agent note is a draft, not a fact; approval is the one step that keeps the
  vault trustworthy. Archiving keeps mistakes recoverable.

## D5. Find the vault through a `Brain vault:` line

- **Date:** 2026-10-14, lookup order extended 2026-10-15 · **Commits:** `255c798e`, `f8c6eac3`
- **Decision:** the vault path is one line, `Brain vault: <absolute path>`, in a `CLAUDE.md` or
  `AGENTS.md`. Skills look in context, the working directory, `~/.claude/CLAUDE.md` and
  `~/.codex/AGENTS.md`, ask once if it is missing, and never search the disk.
- **Why:** works identically in Claude Code and Codex with no plugin configuration mechanism.
- **Open:** replacing the line with the plugin's `userConfig` is under consideration (a local,
  git-ignored proposal, not in the repository).

## D6. Hooks ask, never deny, and fail open

- **Date:** 2026-10-15 · **Commit:** `1c324a89`
- **Decision:** `guard.sh` answers `ask` for its three categories and nothing else; both scripts exit
  silently on input they cannot parse or on any error.
- **Why:** a broken guard must not block a session; an extra confirmation costs one click, while a
  missed install rewrites a lockfile. Per the README, an ask resolves to a denial in `claude -p`, the safe
  default for headless runs.

## D7. One wrap-up nudge per long session

- **Date:** 2026-10-15 · **Commit:** `1c324a89`
- **Decision:** the `Stop` hook asks for session-retro once per session after 30 tool calls,
  skipping headless/SDK runs and subagents. It counts entries and never reads their content.
- **Why:** lessons are lost at the end of long sessions, but a nudge on every stop is noise.
- **Superseded draft:** the first design nudged brain-capture directly; session-retro replaced it
  because it routes each finding to its destination, the vault being only one of them.

## D8. One severity scale and a fresh verifier

- **Date:** 2026-10-15 · **Commit:** `9d4319d8`
- **Decision:** every review, audit and triage skill and every reviewer agent rates P0–P3 with the
  same definitions; verdicts are `APPROVE`, `COMMENT`, `REQUEST_CHANGES`. code-review and
  audit-to-backlog send each P0/P1 finding to a verifier that sees only the claim (Codex when its
  plugin is installed, otherwise a fresh subagent); refuted findings move to a Disputed list.
- **Why:** one scale makes findings comparable across skills; a verifier without the reviewer's
  reasoning catches confident false positives before they block a merge.

## D9. Action skills declare where they stop and what they never do

- **Date:** 2026-10-15 · **Commit:** `1c324a89`
- **Decision:** every skill that can write, send or change git state ends with `## Stop point` and
  `## Never`. Read-only skills (`brain-search`, `code-review`, `plan-status`, `skill-usage`) and
  `*-conventions` are exempt. `scripts/check.sh` enforces it.
- **Why:** the stop point and the forbidden side effects are the contract a user relies on; a
  check keeps new skills from omitting them.

## D10. Fixed per-session budget

- **Date:** 2026-10-15 · **Commits:** `c8129daf`, `1c324a89`
- **Decision:** `plugin/rules/core.md` is at most 8192 bytes; each skill description is 80–1024
  characters and all descriptions together at most 12000.
- **Why:** both load into every session; `SessionStart` hook output is capped at 10,000 characters.

## D11. Plans are local

- **Date:** 2026-10-14 · **Commits:** `2efedc27`, `0c4ab694`
- **Decision:** plans live in a git-ignored planning location (default `docs/plans/`) and are deleted
  when done, with open items moved to `TODO.md` or the backlog. A project may override this in its
  `AGENTS.md`. This repository's `docs/plans/` is git-ignored.
- **Why:** a committed plan goes stale the day the task ends; a plan in the vault drifts from the
  code.

## D12. Codex is manual and best-effort (superseded by D19)

- **Date:** 2026-10-14 · **Commit:** `369028cc`
- **Decision:** no Codex manifest. Users copy skills to `~/.agents/skills/` and paste the core rules
  into `~/.codex/AGENTS.md`. Not tested on releases.
- **Why:** the skills need only file and shell tools; hooks, agents and output styles have no Codex
  equivalent worth maintaining.

## D13. Evals run by hand, never in CI

- **Date:** 2026-10-15 · **Commit:** `1c324a89`
- **Decision:** `evals/` holds `claude plugin eval` cases with a with-plugin and a baseline arm; they
  run by hand before a release or after changing a tested skill.
- **Why:** every run spends real plan usage (two agent sessions per case and run, plus judge calls).

## D14. `development` is the default and install branch

- **Date:** 2026-10-14
- **Decision:** `/plugin marketplace add msolecki/developer-os` installs from `development`, the
  repository's default branch. `main` is not the release channel today.
- **Open:** a release and pinning procedure; see [CURRENT-STATE.md](../CURRENT-STATE.md).

## D16. Task state survives compaction in the plans directory

- **Date:** 2026-10-15 · Sources proposal #2, Q10
- **Decision:** after a compaction or resume, the `SessionStart` hook appends a state card (branch,
  worktrees, active plan, `docs/plans/.devos-state.md`) of at most 1024 bytes. Orchestrating skills
  keep the state file current. It lives in `docs/plans/`, already git-ignored.
- **Why:** the compaction summary drops which item, worktree and unverified claim belong to which
  agent; the hook already re-runs on compaction, so no new event is needed.
- **Hardened after review:** the state file is shown only when untracked, git-ignored and reached
  without a symlink, so a repository cannot inject instructions or point it at a local secret.
- **Rejected:** a `PreCompact` hook (its input and output are undocumented); `.claude/devos-state.md`
  (one more `.gitignore` entry per project).

## D17. One backlog item format, defined in the skills only

- **Date:** 2026-10-15 · Sources proposal #3, Q11
- **Decision:** backlog items carry `Size`, `Done when`, a runnable `Check`, `Blocked by` and `Owner`;
  `Done when` changes only by an appended `Amended` line. The skills write and read the format; no
  lint is proposed to projects yet.
- **Why:** parallel agents took the same or blocked items, and implementers could lower a criterion
  to pass. A project lint waits until plan-status shows the format drifting.

## D18. agnix in CI only, pinned

- **Date:** 2026-10-15 · Sources proposal #13, Q12
- **Decision:** CI downloads the `agent-sh/agnix` v0.57.0 release binary, checks it against a SHA-256
  in the workflow, and runs it strict, with suppressions in
  `.agnix.toml`, each with its reason. `scripts/check.sh` adds `plugin/SURFACE.txt` and digit-count
  checks, which need no new tool.
- **Why:** a local agnix would need an install on every contributor's machine. The hash lives in the
  workflow because the action's own checksum file comes from the same release and proves nothing
  if the release is replaced.

## D19. A Codex installer that copies, not symlinks

- **Date:** 2026-10-15 · Sources proposal #15, Q13
- **Decision:** `scripts/install-codex.sh`, run by hand, writes a Codex copy of every skill (name and
  a short description only, Claude-only references rewritten, a `.developer-os-codex` marker) and
  keeps the core rules and the `Brain vault:` line between markers in `~/.codex/AGENTS.md`. No Codex
  hooks.
- **Why:** Codex lists skills within 8000 characters by default; the full descriptions are over
  10,000, so a symlink cannot fit and a copy must carry a shorter description. Pasting `core.md` by
  hand went stale silently; a marked block is replaced in place and backed up. Codex's documentation
  does not confirm the hook events the guard needs.
- **Rejected:** symlinks for skills without Claude-only references (the budget still overflows);
  installing `guard.sh` for Codex.

## Rules history

One row per approved change to `plugin/rules/core.md` or a skill's rules, added with the change
(session-retro and instruction-review do this). Check here before reversing a rule.

| Date | Change | Target | Reason |
|---|---|---|---|
| 2026-10-15 | Task state that must survive compaction lives in `docs/plans/.devos-state.md` | `plugin/rules/core.md` | The state card after compaction (sources proposal #2) |
| 2026-10-15 | Hook normalization rule shortened to the `tr` call and one example | `plugin/rules/core.md` | Room for the state-card line under the 8192-byte cap |

## D15. Language split

- **Date:** 2026-10-14
- **Decision:** the agent converses in the user's language and keeps it after English input,
  subagent reports and compaction; everything that lands in a repository is English unless the
  project says otherwise. Skill descriptions carry Polish trigger phrases next to English ones.
- **Why:** the primary user works in Polish; repositories and the public plugin are English.
