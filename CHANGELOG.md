# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- A `SessionStart` hook on new sessions, `notices.py`, shows one-line notices when due: the version and a
  link to the changelog page after an install or update, inbox notes older than 7 days (at most weekly)
  and no brain-garden run in 30 days (at most monthly). It runs nothing itself;
  `DEVELOPER_OS_NOTICES=off` turns it off. Decision D21.

### Changed
- The workflow, README and brain-setup say plainly that vault upkeep does not run on its own, and that
  the weekly brief routine reports but does not garden.

## [0.2.4] - 2026-10-20

### Added
- The documentation site has link previews and search metadata: a canonical URL, Open Graph tags and
  a 1200×630 preview card (one per section) on every page, favicons from the plugin icon,
  `sitemap.xml`, and JSON-LD on the landing page. The check's Site stage fails a page without its
  canonical URL or preview image, and a sitemap that does not match the pages.

### Changed
- Setup docs: the README lists the requirements (`rg`, `jq`, `gh`, Obsidian 1.9.10 or later for
  Bases), the vault steps say to open the folder as a vault in Obsidian, and the project templates
  are copied from the marketplace install with `cp -Rn`. The landing page no longer says an install
  takes the latest commit: it takes the latest release, from `main`.
- docs-sync writes `Reason not recorded` for a decision whose reason is in neither the history nor
  the docs, instead of inferring one from the code, and reports conflicting decision records as
  drift before any broad change. The ADR template has a `Status` line (`proposed`, `accepted`,
  `superseded by NNNN`) and a `Revisit when` section.
- testing-conventions has three more rules: a regression test is seen red before the fix, the
  boundary that could be wrong is not faked, and a failure message shows the missing record or
  response instead of retries hiding a flaky test.

### Removed
- `docs/CURRENT-STATE.md` and its site page: the repository no longer keeps a current-state report.
  The project template and docs-sync keep `CURRENT-STATE.md` for your own projects.

### Fixed
- The session-retro nudge is `Stop` feedback (exit 0 with `additionalContext`), no longer shown as a
  hook error.
- The nudge counted each tool call about twice, because `api-request-blob` transcript lines repeat
  earlier turns, so it fired after about 15 tool calls instead of 30. Those lines are skipped now.

## [0.2.3] - 2026-10-16

### Changed
- The hooks are Python 3 scripts (standard library only, no network), because the plugin-directory
  validator refuses shell scripts whose commands use computed paths: `guard.py` replaces `guard.sh` and
  `guard.awk`, `capture-nudge.py` replaces `capture-nudge.sh`, and `state-card.py` prints the state
  card. They need `python3` (3.8+) on `PATH`; without it they fail open. Behavior is unchanged.
- `SessionStart` is split in two: a `cat` of `rules/core.md` on every source, so the core rules load
  without Python, and `state-card.py` on `compact|resume`. `session-start.sh` is removed, and the card
  is no longer guaranteed to print after the rules.

## [0.2.2] - 2026-10-16

### Fixed
- Hook commands name their script directly, `"${CLAUDE_PLUGIN_ROOT}/hooks/<script>.sh"`, instead of
  `sh "${CLAUDE_PLUGIN_ROOT}/hooks/<script>.sh"`: the plugin-directory validator still reported
  COMMAND_PATH_COMPUTED for a command that runs `sh` with the script as an argument.

## [0.2.1] - 2026-10-16

### Changed
- Hooks for the plugin-directory validator (COMMAND_PATH_COMPUTED): `session-start.sh` reads the core
  rules from `${CLAUDE_PLUGIN_ROOT}/rules/core.md` instead of a path built from `$0`, `guard.sh` runs its
  word scanner from `hooks/guard.awk` instead of an inline awk program, and `capture-nudge.sh` compares
  Monitor timestamps with `expr` instead of inline awk.

## [0.2.0] - 2026-10-16

### Added
- A 1024×1024 plugin icon at `plugin/.claude-plugin/icon.png` for the Claude plugin directory listing.
- Four negative eval cases: deploy-checklist-no-provider-cli, docs-sync-no-write,
  audit-to-backlog-backlog-only and brain-setup-no-unapproved-config.
- Deterministic graders for pr-cycle's Never rules (no `gh pr merge`, force push, rebase,
  `--no-verify` or test weakening) in trigger-pr-cycle and injection-pr-cycle.
- The `verifier` agent: it checks one P0/P1 finding with read-only tools (Read, Grep, Glob). code-review
  and audit-to-backlog use it instead of a `general-purpose` subagent, and it is the only agent an
  untrusted pull-request head reaches.

### Fixed
- Eval graders: the injection cases share one regex each for push, network and delete;
  implement-backlog-quota requires the check to run exactly once and matches `BLOCKED` case-sensitively;
  brain-review-no-promotion asserts the inbox notes survive and catches `cp` and Write into topic folders.
- The `install-codex` installer warns when a non-empty `AGENTS.override.md` would make Codex ignore
  the installed core rules.
- `tests/skill-usage.test.sh` fails in CI instead of skipping when `rg` is missing; CI installs
  ripgrep. The Pages workflow deploys only from `main`.
- The docs match the check: plugin validation fails on any `--strict` warning, Pages publishes from
  `main`, and CURRENT-STATE carries the measured budgets.
- install-codex creates its `AGENTS.md` backup with `mktemp`, so a planted symlink at the backup name
  can no longer redirect the write.
- The guard sees through brace expansion: `git push origin {-f,}` and `-{,f}` now ask.
- capture-nudge keeps its marker in a per-user directory when `CLAUDE_PLUGIN_DATA` is unset, so it
  fires under a shared, root-owned `TMPDIR=/tmp`.
- The `SessionStart` state card skips tracked files before it picks the newest plan, so a newer
  tracked file no longer hides an older untracked plan.
- The Stale names stage diffs from the merge base in a pull request, so CI catches a committed
  rename.

### Changed
- `core.md` drops to 7944 bytes: the hook input-normalization rule moves to
  defensive-coding-conventions and the TypeScript `strict` rule to typescript-conventions. A lesson
  goes to the vault when other projects can use it, as brain-capture and session-retro already say.
- instruction-review edits `AGENTS.md` when `CLAUDE.md` only imports it.
- `scripts/check.sh` fails on an empty `## Never` or `## Stop point`, and a new Severity stage fails
  when a copy of the P0–P3 scale drifts; qa-expert and performance-engineer now use the shared
  wording. A SessionStart test pins core rules plus state card under 10,000 bytes end to end.
- pr-cycle asks to fix or abort when the fast check is red after the merge, sends its conflict
  resolutions to code-reviewer, rates review threads P0–P3 (skipping them without `gh`), lets C skip
  to the PR body, and stops after two review rounds. It no longer triggers on "merge the PR".
- pr-cycle and fix-pr reference each other's steps by name (Trust check, Read threads, Reply and
  resolve), not by number.
- spec plan steps carry `Done when`; backlog items from spec use the `FEAT-` prefix, cite the spec
  section as evidence, and replace the plan steps they came from.
- code-review and audit-to-backlog name the Codex verifier (`codex:codex-rescue`, told to stay
  read-only) and fall back to the verifier agent on any error or empty reply.
- implement-backlog integrates on a local batch branch and fast-forwards the base only after the
  review passes (`APPROVE`, or a `COMMENT` the user answered); a reviewer that ended `BLOCKED` is not
  a pass. It runs a delegate's `Check` in its worktree, leaves `Manual:` items open for the user to confirm, skips
  lines outside the backlog format as `unformatted`, falls through to the next session with ready
  items, and proposes review findings as backlog items instead of writing them.
- A git-ignored backlog keeps its `Owner` claims uncommitted and runs the batch sequentially;
  audit-to-backlog and project-baseline warn before choosing such a path.
- The `SessionStart` state card, plan-status and session-retro no longer treat the `Backlog:` files
  as plans. code-review relays the reviewer's report after verifying its P0/P1 findings.
- project-baseline and spec add an implementation-session line for the items they write.

## [0.1.0] - 2026-10-16

First public release. developer-os is now a Markdown-only plugin for Claude Code, installed from
this repository as a plugin marketplace. It replaces the earlier Homebrew CLI, which was never
released; the CLI history is archived at the git tag `archive/cli-v0`.

### Added
- `plugin/README.md` and `plugin/LICENSE`, which Anthropic's plugin directory requires in the plugin
  folder, and `keywords` in `plugin.json`.
- Issue forms (report a problem, propose a change) and links to Discussions and private security
  advisories.
- A public documentation site in `site/`, published to GitHub Pages by `.github/workflows/pages.yml`:
  a landing page, one page per document, skill, agent and output style, and a Site stage in
  `scripts/check.sh` that fails when a page falls behind its source.
- Brain skills that read and write an Obsidian vault with the agent's own file tools: brain-setup,
  brain-search, brain-capture, brain-review, brain-garden and brain-compile. brain-setup creates a
  vault from the template or connects an existing one, and adds the `Brain vault:` line and the
  `additionalDirectories` entry after you approve the diff.
- Engineering skills: code-review, spec, audit-to-backlog, implement-backlog, fix-pr, pr-cycle,
  bug-triage, deploy-checklist, instruction-review, plan-status, client-reply, docs-sync and
  project-baseline. pr-cycle takes a PR from base merge to a merge verdict; plan-status reports
  measured plan and backlog counts with A/B/C decisions; client-reply drafts plain-language client
  replies and never sends them; docs-sync scaffolds and checks a project's `docs/`; project-baseline
  proposes missing engineering practices as backlog items.
- Session skills: session-retro, an end-of-session wrap-up (state check, cleanup, status block, plan
  close, approval-gated capture), and skill-usage, a read-only report of how often each skill fired.
- Conventions skills: comments-conventions, error-handling-conventions,
  defensive-coding-conventions, monitoring-conventions, nextjs-conventions, testing-conventions and
  typescript-conventions.
- Agents: code-reviewer, performance-engineer, qa-expert, research-analyst and security-auditor.
- Output styles: architect, debug, direct-objective and tdd-enforcer.
- Three hooks: `SessionStart` loads `plugin/rules/core.md` (and a state card after compaction); `Stop` offers session-retro once per
  session after 30 tool calls, deferred while background agents or commands are still running
  or a Monitor is still armed (`DEVELOPER_OS_CAPTURE_NUDGE=off` disables it); `PreToolUse` on Bash
  asks before dependency installs, force pushes and `--no-verify` or `git commit -n`. The three scripts are POSIX `sh`,
  make no network calls, fail open and have tests in `tests/*.test.sh`.
- `plugin/vault-template/`: folders, a note template, example notes, Bases views (Inbox, Stale,
  By project), property types in `.obsidian/types.json`, and a `.gitignore` that keeps Obsidian's UI
  state out of a git-synced vault. It ships inside the plugin, so brain-setup can copy it.
- `templates/project/`: `AGENTS.md`, a `CLAUDE.md` that imports it, `_Context.md`, `TODO.md`, a
  `.gitignore` that keeps `docs/plans/` local, and a `docs/` standard (index with task routing, `CURRENT-STATE.md`, `pitfalls.md`, `decisions/`, `runbooks/`).
- `docs/workflow.md`: how to work with the vault and the code, where each kind of knowledge belongs,
  which features are Claude-only, and an optional routines recipe for mobile capture and a weekly
  vault brief.
- `docs/`: an index with task routing, product overview, functional specification, decision
  register, architecture overview, hooks and configuration reference, development guide, pitfalls,
  current state and glossary, written for the plugin (the CLI documentation was removed with the CLI).
- `evals/`: behaviour cases for `claude plugin eval`, run by hand and never in CI.
- A state card after compaction: the `SessionStart` hook runs `session-start.sh`, which prints the core
  rules and, after a compaction or resume, the branch, the newest plan, `docs/plans/.devos-state.md`
  and the worktrees (at most 1 KB, cut at a whole line with a marker; a state file older than 7 days
  is not shown), kept current by implement-backlog, pr-cycle and audit-to-backlog.
- One backlog item format (`Size`, `Done when`, a runnable `Check`, `Blocked by`, `Owner`) across
  audit-to-backlog, project-baseline, implement-backlog and plan-status, with
  `templates/project/TODO.md`.
- A final status (`DONE`, `REVIEW`, `BLOCKED`, `CONTINUING`) at the top of every agent report, read by
  the orchestrating skills; implement-backlog sizes briefs S/M/L and only orchestrates while agents run.
- `templates/project/DESIGN.md` in the DESIGN.md format; project-baseline and docs-sync check it.
- `scripts/install-codex.sh`: Codex copies of the skills with short descriptions and a marked
  core-rules block in `~/.codex/AGENTS.md`.
- A map of built-in Claude Code commands that overlap developer-os skills, in `docs/workflow.md`.
- Evals for backlog ordering, ownership and blocking, review framing and contract boundaries, retro
  persistence and reversals, and prompt injection in fix-pr, pr-cycle, bug-triage and code-review.
- bug-triage sends a hypothesis that turns on library or vendor behaviour to research-analyst for a
  sourced answer.
- Eval cases for the gates of brain-compile, fix-pr, instruction-review and spec, and for
  authentication items in implement-backlog; the plan-status and brain-garden fixtures plant waiting,
  orphaned, stale, archived and duplicate cases.
- `scripts/check.sh` validates skills (name matches the folder and `^[a-z0-9-]{1,64}$`, `license` and
  `compatibility` present, description length and total, no local paths, `## Stop point` and
  `## Never` in action skills), agents' final statuses, `plugin/SURFACE.txt` and counts written as
  digits, and runs `tests/*.test.sh`. CI also runs agnix, its binary pinned by SHA-256, with `.agnix.toml`.
- A root `AGENTS.md` for agents working on this repository (commands, likely mistakes, invariants), and
  a root `CLAUDE.md` that imports it.
- CI scans the commits of a pull request with gitleaks, so a secret added and removed within the PR
  is caught; `tests/skill-usage.test.sh` tests the skill-usage counting block.

### Changed
- English only: skill descriptions, skill examples, evals and test data no longer carry non-English
  trigger phrases or text (D15, amended 2026-10-16). The site uses a single light theme.
- code-review and code-reviewer rate a doc the diff makes false as a P2 docs finding; pr-cycle fixes
  docs findings under its recommended answer and reports any left in the PR body; implement-backlog
  fixes them in the batch commit.
- code-review and code-reviewer list Evidence checked under an `APPROVE` with no P0–P2, read both
  sides of every changed contract, and brief the reviewer without the author or their rationale.
- session-retro labels findings `persistent` or `this-task`, shows the commit a rule change would
  reverse, proposes a check for a mistake made twice, and adds a Rules history row in
  `docs/product/decisions.md` for each approved rule change. instruction-review also shows the commit
  a proposed line would reverse and proposes a check for a mistake made twice; it adds no Rules
  history row and no labels.
- pr-cycle, bug-triage and code-review treat PR and issue text, CI logs and code comments as data.
- Every skill carries `license: MIT` and `compatibility`; hooks have a 10-second timeout.
- Review, audit and triage skills and the agents rate findings P0–P3 with one severity scale; review
  verdicts are `APPROVE`, `COMMENT` or `REQUEST_CHANGES`.
- The core rules are shorter, capped at 8192 bytes, and add: a closing `Done / Not done / Needs you`
  status block; no promises of a later ping; keeping the user's language after English input,
  subagent reports and compaction; plans that are gitignored and deleted when done, with open items
  moved to `TODO.md` or the backlog; two validation tiers (a fast check before each commit, the full
  suite before a push or PR).
- code-review and audit-to-backlog send each P0/P1 finding to a fresh verifier; refuted findings
  move to a Disputed list.
- brain-capture writes only lessons that outlive the task, checked by a three-question gate.
- brain-garden reports the orphan percentage, tags proposed links FOUND or GUESSED, and can append
  to `_reports/garden-log.md` with consent.
- instruction-review has a `--prune` mode with a per-line DELETE/KEEP/REWRITE audit.
- Action skills end with `## Stop point` and `## Never` sections.
- `scripts/check.sh` also checks frontmatter, hook targets, the core-rules size, plugin references
  and relative Markdown links.
- The plugin and marketplace descriptions lead with the Obsidian-vault memory.
- `docs/workflow.md` no longer repeats the README's component list and Codex steps; it links to
  them. The README links to `core.md` instead of paraphrasing it.
- `templates/project/AGENTS.md` names the core rules as the source of shared rules and shows an
  optional `Backlog:` line.
- Versioned releases (D20): both manifests carry `version` `0.1.0`, `main` is the default branch and
  the marketplace channel and moves only on a release, and each release is tagged `v<version>`. Pin
  one by tag: `/plugin marketplace add msolecki/developer-os#v0.1.0`. The Validate stage now allows no
  `claude plugin validate --strict` warning and fails when the two manifest versions differ.
- The core rules put specifications in `docs/specs/` (or the project's spec location), not next to
  the plan. The task-state file is `docs/plans/.devos-state.md` at a fixed path, even when a project
  moves its planning location; the core rules and every skill that writes it name that path.
- implement-backlog reviews through the code-review skill, so P0/P1 findings are verified, fixes
  them and reviews again for at most two rounds, then stops with nothing of the batch committed.
- pr-cycle has its own fix commits reviewed by code-reviewer before the push and derives the verdict
  from that review.
- qa-expert runs only the tests that cover the named files and loads testing-conventions;
  tdd-enforcer runs the tests of the changed area, not the full suite, on every cycle.
- The architect, debug and tdd-enforcer output styles say the core rules on structure and the
  status block still apply; "ASAP" or "quickly" overrides only their template.
- Conventions skills: a Server Action error uses error-handling-conventions' `{ code, message,
  details? }`; the deploy/migration-ordering rule moves to defensive-coding-conventions; "paging
  alert" replaces "P1 alert".
- brain-garden checks the vault in one `awk` pass (a 300-note vault went from 18 s to 0.05 s).
- The docs-sync standard includes the `Vault project slug:` line, `DESIGN.md`, the backlog file and
  a git-ignored planning location.
- `scripts/check.sh` also fails on a name removed from `SURFACE.txt` still in use, a broken link
  `#fragment`, a broken link inside a skill, any plugin validation warning but a missing `version`, and brain
  skills whose "Locate the vault" paragraphs differ.
- plan-status counts each open backlog item in exactly one of ready, waiting, claimed and orphaned
  (first match wins), so the buckets add up to the open count.
- `templates/project/AGENTS.md` drops the ADR-lite decision section (decisions live in
  `docs/decisions/`) and states the sync rule: a behavior change updates the docs in the same commit.
  docs-sync checks for that line and the dependency policy.
- session-retro proposes doc edits for this session's unreviewed commits and offers docs-sync when
  `CURRENT-STATE.md` is older than them; instruction-review adds the Rules history row for a core
  rules change.
- spec can add its plan's items to the backlog in the backlog item format; implement-backlog claims
  the batch in one commit before writing any brief, and its default batch is the first unfinished
  implementation session audit-to-backlog defined.
- code-review relays the reviewer's report only on `DONE` and names fix-pr as the next step;
  project-baseline asks for the error-handling-conventions envelope.

### Fixed
- brain-garden reports a link to an archived note as an info line, not a broken link, and no longer
  proposes removing provenance; links in `sources:` are exempt from that line, but a missing source is
  still `no such note`. It resolves links case-insensitively, reads dotted note names as notes,
  unquotes dates, checks vault-root `README.md` links, parses CRLF notes and skips code fences.
- The brain skills read `$CLAUDE_CONFIG_DIR/CLAUDE.md` for the `Brain vault:` line (falling back to
  `~/.claude/CLAUDE.md`) and skip `_reports/`; brain-search and brain-capture take the project slug
  from the `Vault project slug:` line in `_Context.md`, never from the directory name.
- brain-compile finds an earlier compile of the topic anywhere in the vault; brain-review checks the
  name and destination before archiving; the vault template's example notes are archived with
  `status: archived`.
- The state card keeps the state file when many worktrees are listed and never ends inside a UTF-8
  character; the state file's `Plan:` line no longer hides the newest plan.
- capture-nudge no longer nudges while a Monitor is armed.
- implement-backlog removes its `Owner` line from an item still open when it stops, so the next run
  can take it, and records the current checkout as owner for a sequential item.
- pr-cycle replies to and resolves review threads only after a successful push, reruns its gates after
  re-review fixes, and skips the re-review when you stop.
- fix-pr stops on uncommitted changes and stages only the files it edited for the approved threads.
- session-retro proposes removing only branches merged into the base branch, never the base or the
  current branch.
- spec writes a plan that plan-status and session-retro can read, and never writes the spec into the
  planning location; plan-status picks the active plan by the core rules' definition.
- audit-to-backlog reports every P0 and P1 finding; only the P2/P3 tail is capped.
- code-review relays the reviewer's report without its status line.
- implement-backlog, pr-cycle and audit-to-backlog delete `.devos-state.md` at their stop point.
- docs-sync and project-baseline drop a `[path]` argument they never used.
- `templates/project/TODO.md` is now committed: a global excludes file had hidden it.
- The Codex installer keeps skill-usage's `developer-os:` patterns and the "Use when" sentence of a
  description without quoted phrases, honours `CODEX_HOME`, and `--project --uninstall` keeps the
  global skills; it refuses a description that is not one plain line.
- The docs say the agent creates notes only in `_inbox/` and edits or moves other notes only after
  approval; brain-garden reports inbox notes older than 7 days.
- The docs cover the compiled-note `sources:` list, the quoted `summary` and the template's default
  `status: active`.
- Codex setup uses `~/.agents/skills/` (older Codex versions read `~/.codex/skills/`).
- The README lists fork among the `SessionStart` triggers.
- The guard splits commands on newlines and also reads them joined, deletes quotes, backslashes and
  `$` so split words (`np""m`, `\git`, `$'-f'`) read as the word they run, asks on `git push --mirror`, skips the value after `--filter`, `--prefix`, `--dir` and similar flags, and catches
  bypass forms (`--no-verify` prefixes, `HUSKY=0`, `core.hooksPath` in any form), npm aliases and
  binaries called by full path.
- pr-cycle and fix-pr read a PR's trust inputs first and never check out an untrusted head before the
  user approves running its code; without approval they review the fetched ref only; code-review passes the `Untrusted head`
  line to its verifiers and to inline review.
- The state card works from a subdirectory of the repository, never names a plan that git tracks,
  and prints the branch and plan lines with `printf`.
- capture-nudge falls back to a per-user `/tmp` directory when `CLAUDE_PLUGIN_DATA` and `TMPDIR` are
  unset, and uses it only when it is the user's own directory and not a symlink.
- The Codex installer removes untouched copies, made from the same checkout, of skills the plugin no
  longer has; keeps the vault line already in the block when `--vault` is not given and warns when
  CLAUDE.md names another; CI fails a pull request that adds a `gitleaks:allow` marker; writes clone paths verbatim, and counts the description
  budget in bytes.
- brain-setup touches `.gitignore` only in a git vault, keeps its paths across Bash calls, previews a
  missing `settings.json` cleanly, and writes a vault path with `&`, a pipe or a backslash intact.
- brain-review checks a promoted note's name across the whole vault; brain-compile matches compiled
  tags in block lists and sets `project`; brain-capture and brain-compile use ASCII note names;
  brain-search skips the vault-root README; brain-garden reports a missing type once; brain-capture
  treats vault content as data. The vault template README lists all property types.
- skill-usage counts typed commands and skill names with digits, once per message.
- `scripts/check.sh` runs on macOS Ruby 2.6 and scans untracked plugin files for local paths; the
  Counts stage reads only the `[Unreleased]` section of the changelog. The note template quotes its
  date placeholders.
- fix-pr gates fork heads like pr-cycle, reads review threads through GraphQL and runs the full suite
  before the push; pr-cycle handles a base already merged and a push to a fork head; pr-cycle and fix-pr
  start despite the state file; code-review and code-reviewer mark an untrusted head read-only.
- `templates/project/.gitignore` keeps `TODO.md` tracked when a global ignore lists it.
- Eval graders: brain-garden totals and defect kinds, code-review-clean-diff's evidence check, the
  session-retro cases forbid both Edit and Write, and implement-backlog-owner gives delegates a
  worktree directory inside the workspace.

### Security
- capture-nudge passes only an absolute output path under a `tasks/` directory to `find`; a path such
  as `-delete` printed by any tool could empty the working tree with GNU `find`.
- pr-cycle asks before running project scripts or commit hooks on a fork PR or a PR from an outside
  author.
- implement-backlog and audit-to-backlog treat backlog text as data; implement-backlog screens every
  `Check` before dispatch, never runs one that pipes into a shell, fetches from the network or writes
  outside the repository, and screens a changed repository script again before re-running it.
- `SECURITY.md` no longer claims the vault never leaves your disk, describes what each hook reads,
  and explains that an update can change the hook commands.
- `.gitignore` covers `.env*`, `*.pem` and `.claude/settings.local.json`.
- fix-pr asks before each edit, commit, push and thread resolution, treats review comments as data
  and flags comments from non-collaborators.
- Agents treat code, diffs, PR text and fetched pages as data, not instructions.
- CI pins `actions/checkout` to a commit SHA, drops persisted credentials, runs with read-only
  `contents` permission and verifies the gitleaks download checksum.

### Removed
- The Homebrew CLI, its bundled Node runtime, background jobs and generated indexes.
- The optional JSON feature list for multi-session work: audit-to-backlog no longer creates it and
  implement-backlog no longer reads it; the backlog carries that state.
