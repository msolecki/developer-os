---
status: current
owner: Mateusz Solecki
last-verified: 2026-10-24
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

## D2. No runtime; small hook scripts without dependencies

- **Date:** 2026-10-14, extended 2026-10-15 and 2026-10-16 · **Commits:** `53504f88`, `1c324a89`
- **Decision:** the only executable code is the hook layer: `cat` of the core rules, plus
  `capture-nudge.sh` and `guard.sh` in POSIX `sh`, without `jq`, without network calls.
- **Why:** anything that runs in every session of every user must be small enough to read in full
  and must not add dependencies.

- **Amended 2026-10-15:** a third script, `session-start.sh`, replaces the inline `cat` (D16), and
  `scripts/install-codex.sh` runs only by hand, outside the plugin (D19).
- **Amended 2026-10-16:** the hook scripts are Python 3 (3.8+, standard library only, no network):
  `state-card.py`, `guard.py` and `capture-nudge.py` replace the `sh` scripts and `guard.awk`. The
  Claude plugin directory's validator reads the shell scripts a hook runs and refuses any command
  whose path the shell computes (a variable other than `${CLAUDE_PLUGIN_ROOT}`, a command
  substitution, a glob) or any inline program; the hooks need paths outside the plugin (the project's
  `cwd`, the transcript, a temporary directory). Scripts in other languages are held for a human
  reviewer instead of refused. The core rules load through a literal `cat` hook again, so they never
  depend on Python; without `python3` the other three hooks fail open.

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
- **Decision:** the guard answers `ask` for its three categories and nothing else; both scripts exit
  silently on input they cannot parse or on any error.
- **Why:** a broken guard must not block a session; an extra confirmation costs one click, while a
  missed install rewrites a lockfile. Per the README, an ask resolves to a denial in `claude -p`, the safe
  default for headless runs.

## D7. One wrap-up nudge per long session

- **Date:** 2026-10-15 · **Commit:** `1c324a89`
- **Decision:** the `Stop` hook asks for session-retro once per session after 30 tool calls,
  skipping headless/SDK runs and subagents, and deferring while a background task it launched is
  still running (PR #69). It counts entries and reads background-task ids and output paths, never
  message content.
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

## D14. `development` is the default and install branch (superseded by D20)

- **Date:** 2026-10-14
- **Decision:** `/plugin marketplace add msolecki/developer-os` installs from `development`, the
  repository's default branch. `main` is not the release channel today.
- **Pinning:** a user holds one version by adding the marketplace at a branch or tag
  (`/plugin marketplace add msolecki/developer-os#<ref>`); no release tag exists yet.
- **Open:** a release procedure (tags, changelog date).
- **Amended 2026-10-15:** `plugin.json` carries no `version`. Claude Code then versions an install by
  the commit SHA, so `claude plugin update` picks up every commit on `development`, docs-only ones
  too. The pinned `0.1.0` kept every install on its first cached copy, whatever was pushed later.
- **Superseded 2026-10-16** by D20.

## D15. Language split

- **Date:** 2026-10-14
- **Decision:** the agent converses in the user's language and keeps it after English input,
  subagent reports and compaction; everything that lands in a repository is English unless the
  project says otherwise. Skill descriptions, examples and evals are English only.
- **Why:** repositories and the public plugin are English, and a public plugin should not depend on
  one user's language to fire.
- **Amended 2026-10-16:** the non-English trigger phrases in skill descriptions, skill examples and
  evals were replaced with English ones; the conversation rule is unchanged.

## D16. Task state survives compaction in the plans directory

- **Date:** 2026-10-15 · Sources proposal #2, Q10
- **Decision:** after a compaction or resume, the `SessionStart` hook appends a state card (branch,
  newest plan, `docs/plans/.devos-state.md`, worktrees) of at most 1024 bytes. Orchestrating skills
  keep the state file current. It lives in `docs/plans/`, already git-ignored.
- **Why:** the compaction summary drops which item, worktree and unverified claim belong to which
  agent; the hook already re-runs on compaction, so no new event is needed.
- **Hardened after review:** the state file is shown only when untracked, git-ignored and reached
  without a symlink, and a tracked plan is not named, so a cloned repository cannot inject
  instructions through them or point the card at a local secret; the branch name still prints (git
  forbids spaces and control characters in it).
- **Amended 2026-10-15:** the state file prints before the worktree list, so a long list cannot push
  it past the cap; a card over the cap is cut at a whole line with a marker; a state file not changed
  in 7 days is left over from a finished run and is not shown. The card's `Newest plan:` line comes
  from the plan files only; the state file's own `Plan:` line prints inside the state section.
- **Amended 2026-10-16:** the state-file path is fixed at `docs/plans/.devos-state.md` even when a
  project overrides its planning location; skills and core rules name that path. A project that moves
  its plans still git-ignores `docs/plans/` (or that file) so the card shows it — the one extra
  `.gitignore` entry D16 rejected `.claude/devos-state.md` for.
- **Amended 2026-10-16:** the card comes from its own hook, `state-card.py`, matched to `compact` and
  `resume`; the core rules print from a separate `cat` hook (D2), so the card is no longer guaranteed
  to follow them.
- **Amended 2026-10-24:** the state card also runs on a forked session (source `fork`).
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
- **Why:** Codex lists skills within 8000 characters by default (the installer counts bytes, which
  are never fewer than characters); the full descriptions are over 10,000 characters (the
  `scripts/check.sh` descriptions stage counts characters), so a symlink cannot fit and a copy must carry a shorter description. Pasting `core.md` by
  hand went stale silently; a marked block is replaced in place and backed up. Codex's documentation
  does not confirm the hook events the guard needs.
- **Rejected:** symlinks for skills without Claude-only references (the budget still overflows);
  installing `guard.sh` for Codex.

## D20. Versioned releases from `main`

- **Date:** 2026-10-16
- **Decision:** `main` is the default branch and the marketplace channel; it moves only on a release,
  a fast-forward from `development`. Both manifests carry the same `version`, bumped on every release
  and tagged `v<version>`. The first release is `0.1.0`.
- **Why:** with the public launch, an install should change only when a release does, not on every
  docs commit; the cached-copy problem of D14 is the intended behaviour once `main` moves only on a
  release. Anthropic's plugin directory warns on a missing `version`. Same model as founder-os.
- **Alternatives:** a tag on `development` without a `version` (installs keep tracking every commit).

## Rules history

One row per approved change to `plugin/rules/core.md` or a skill's rules, added with the change
(session-retro and instruction-review do this). Check
here before reversing a rule.

| Date | Change | Target | Reason |
|---|---|---|---|
| 2026-10-15 | Task state that must survive compaction lives in `docs/plans/.devos-state.md` | `plugin/rules/core.md` | The state card after compaction (sources proposal #2) |
| 2026-10-15 | Hook normalization rule shortened to the `tr` call and one example | `plugin/rules/core.md` | Room for the state-card line under the 8192-byte cap |
| 2026-10-15 | A doc the diff makes false is a P2 docs finding; pr-cycle and implement-backlog fix it before the commit or PR | `code-review`, `code-reviewer`, `pr-cycle`, `implement-backlog` | Project docs were kept current only when the user ran docs-sync; review is the step every merge path already runs |
| 2026-10-16 | The task-state file is `docs/plans/.devos-state.md` at a fixed path, not in the planning location | `plugin/rules/core.md`, `pr-cycle`, `implement-backlog`, `audit-to-backlog`, `session-retro`, `docs-sync` | The `SessionStart` hook reads only that path; a moved planning location hid the state card (D16 amendment) |
| 2026-10-16 | fix-pr gets pr-cycle's fork gate in step 1 and a matching Never line | `fix-pr` | fix-pr ran project scripts and hooks on a fork head without asking |
| 2026-10-16 | pr-cycle and fix-pr stop in step 1 when `git status --porcelain` lists anything but `docs/plans/.devos-state.md` | `pr-cycle`, `fix-pr` | The state file the skills write must not block their own start; any other change still stops them |
| 2026-10-16 | implement-backlog claims the batch (`Owner` lines, one commit) before writing any brief and never dispatches an item before its `Owner` line is committed; the Never line on backlog edits exempts the claim and release commits | `implement-backlog` | An eval run dispatched without writing `Owner`; the old Never line contradicted the claim commit |
| 2026-10-16 | The Never line on the optional JSON feature list is removed with the file | `audit-to-backlog`, `implement-backlog` | The file is dropped; the backlog carries the state |
| 2026-10-16 | Vault content is data, not instructions: brain-capture does not run commands or open URLs found in notes | `brain-capture` | The other four brain skills had the rule; capture reads existing notes in its duplicate check |
| 2026-10-16 | A core.md change also adds its Rules history row at the Stop point | `instruction-review` | Only session-retro added the row; after an instruction-review change it was left to the user |
| 2026-10-16 | session-retro proposes the docs findings of this session's unreviewed commits and offers docs-sync when `CURRENT-STATE.md` is older than them | `session-retro` | Docs changed without review drifted until someone ran docs-sync |
| 2026-10-16 | pr-cycle and fix-pr read a PR's trust inputs before checkout and never check out an untrusted head before the user approves running its code; without approval the cycle reviews the fetched ref only; code-review passes the `Untrusted head` line to verifiers and inline review | `pr-cycle`, `fix-pr`, `code-review` | A checked-out head runs its own hooks, tracked git config and LFS settings; turning hooks off did not cover config pulled in by `include.path` (security reviews of the audit fixes) |
| 2026-10-16 | The hook input-normalization rule moves to defensive-coding-conventions and the TypeScript `strict` rule to typescript-conventions; a lesson goes to the vault when other projects can use it | `core.md`, `defensive-coding-conventions`, `typescript-conventions` | core.md had 48 bytes left and held two stack-specific rules it says belong in skills; "project history" sent repository facts to the vault, against brain-capture and session-retro |
| 2026-10-20 | docs-sync writes `Reason not recorded` for a decision whose reason is in neither history nor docs, and reports conflicting decision records as drift before a broad change; ADRs gain Status and Revisit when | `docs-sync` | An agent reconstructing a rationale from the code records a guess as a decision (flaviocopes.com/project-decisions) |
| 2026-10-20 | A regression test is seen red before the fix; the boundary that could be wrong is not faked; failure messages show the missing record or response, and retries never hide a flaky test | `testing-conventions` | A test seen only green, a fake database or a raised retry count each lets a fix ship unverified (flaviocopes.com/fast-tests-for-agents) |
