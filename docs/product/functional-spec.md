# Functional specification

What Developer OS does, area by area, as shipped on `development`. Each area names its actors, the
commands that serve it, the rules it follows and the refusals a user can meet. Exact syntax is in the
[CLI reference](../reference/cli.md); the normative contract of each area is the architecture note
linked at its end.

Actors used below:

- **User** — the developer at the terminal.
- **Agent** — Claude Code or Codex acting in a user session, through the installed skills and hooks.
- **Scheduler** — macOS `launchd`, running a job the user enabled.
- **Vendor model** — the Claude or Codex model invoked by the product itself (`ingest`, `brain-garden`).

## 1. Installation lifecycle

### 1.1 Install the package

| | |
|---|---|
| Actor | User |
| Commands | `brew tap msolecki/developer-os`, `brew install developer-os` |
| Result | A Homebrew keg holding the shell launcher `bin/developer-os`, the bundled stable launcher and a complete packaged release with its own Node 24 runtime. |

The keg is inert until `init` runs; installing the package changes no product home and no agent
configuration.

### 1.2 Initialize (`init`)

| | |
|---|---|
| Actor | User |
| Command | `developer-os init [--dry-run] [--yes] [--adapters claude,codex\|claude\|codex\|none] [--json]` |
| Goal | Create the product home, select or create the Brain vault, install the active release and the selected agent integrations. |

Behaviour:

1. Resolves the product home (`~/.developer-os`, or `DEVELOPER_OS_HOME`) and the vault
   (`DEVELOPER_OS_BRAIN`, else the configured `brainPath`, else `~/DeveloperBrain`). The two must be
   disjoint after symlink resolution.
2. Admits the installed Homebrew keg as the release source, or a local build with `--local-release`.
3. Creates the product home (`0700`), writes `config.toml`, the installation manifest and the active
   release, through one recoverable bootstrap transaction.
4. If the vault does not exist, creates it from the synthetic template (four example notes, one note
   template, the folder skeleton). An existing vault is never modified.
5. Installs the instruction artifacts, plugins and hooks of every selected vendor and detaches every
   deselected one (§9).
6. Runs the init-owned health checks; a failure there reverts the install with a compensating
   transaction.

Rules:

- `--dry-run` prints what would be created and writes nothing.
- A fresh `init` without `--adapters` selects `none` and installs into no agent home.
- A re-run without `--adapters` keeps the stored selection and re-renders the workflows from the
  active release; this is how workflows are refreshed after an update that could not refresh them.
- `init` is idempotent: on an installed, undrifted home it reports "already initialized".

Refusals: an agent CLI that is absent or below its version floor (exit 4); no admissible release
(exit 4); a release identity different from the installed one (exit 4); drifted managed files
(exit 3); an interrupted earlier transaction (exit 6).

Contract: [foundation.md](../architecture/foundation.md) §3, §4, §10, §12.

### 1.3 Inspect (`status`, `doctor`)

- `status` prints, without changing anything: product home, vault path and presence, install state,
  product version, configuration presence, number of managed artifacts, drift count, incomplete
  transactions and agent presence.
- `doctor` runs every health check and repairs nothing: `platform`, `product-home`,
  `configuration`, `transactions`, `manifest`, `drift`, `brain`, `redaction-key`, `release-trust`,
  `agents`, `claude-capabilities`, `codex-capabilities`, `hooks`, `external-hooks`, `instructions`,
  `codex-registration`, plus `lifecycle`, `automation`, `manifest-anchor` and `bootstrap-evidence`
  findings when they apply. Every failing check names a recovery command. The exit code is the most
  severe failing code in the order 6, 5, 4, 3, 2, 1.
- `doctor --probe` additionally runs each agent CLI's version probe. Claude's probe writes
  `~/.claude.json`, so it is opt-in.

### 1.4 Repair an interrupted transaction (`repair`)

A transaction interrupted before `finalize` is incomplete, never successful. `doctor` and `status`
name its id; the user chooses `repair --resume <id>` to finish it or `repair --rollback <id>` to undo
it. Rollback restores the exact pre-transaction bytes and reports a concurrent user edit instead of
overwriting it. `repair` refuses transactions owned by other verbs and names the right one: `init`
for an interrupted install, `uninstall` for an interrupted uninstall, `update --apply` or
`update rollback --apply` for an interrupted update. No Git is needed.

### 1.5 Change configuration (`config`)

`config get [<key>]` prints the validated configuration or one key; redaction patterns are shown
only as a count. `config set <key> <value>` changes one mutable key through a transaction; the value
is canonical JSON (`"text"`, `true`, `10`, `{"key":"value"}`). Read-only keys (Git and automation
state, `telemetry`) refuse; they change only through their own commands. Key list:
[Configuration](../reference/configuration.md#2-configtoml).

### 1.6 Uninstall (`uninstall`)

`uninstall` first detaches both vendors, then removes every manifest-owned artifact through a drained,
recoverable uninstall, and unloads any product launchd job. It:

- never removes the Brain vault, user-created notes, user overrides under
  `<product-home>/instructions/`, unrelated configuration, transaction backups or Git history;
- strips the product's marked block from shared vendor files (`~/.claude/CLAUDE.md`,
  `~/.codex/AGENTS.md`) and keeps every byte the user wrote outside it;
- restores shared files the product replaced to their pre-install contents where that is safe;
- keeps non-empty directories and reports them as preserved;
- keeps the lifecycle bookkeeping set and retained bootstrap evidence, which a later `init` admits.

`--dry-run` previews; `--yes` accepts the confirmation. A drifted managed file refuses (exit 3).

## 2. Brain vault

### 2.1 Index and inspect (`brain reindex`, `brain status`, `brain lint`)

- `brain reindex` rebuilds the generated artifacts in `content/_indexes/` (`index.json`,
  `terms.json`, `graph.json`, `vault-map.md`, `catalog.md`) through a transaction. Notes are never
  modified. `--dry-run` lists what would be written.
- `brain status` reports the vault root, content root, note count, topic folders, unclassified
  folders, whether the index exists and how many artifacts a reindex would change.
- `brain lint` reports findings in eight classes — `frontmatter`, `provenance`, `links`,
  `duplicates`, `staleness`, `index-drift`, `isolated`, `gap` — with a severity of `error`, `warn` or
  `info`. It writes nothing.

### 2.2 Search (`brain search`, `search`)

`brain search <query>` (alias `search <query>`) is read-only and index-first: it ranks notes from the
generated index in two stages — first the notes reachable by tag, type, folder, title or alias, then
an integer score with weights title 4, alias 3, tag 3, summary 2, body 1 — and returns at most
`--limit` matches (default `brain.retrieval.maxCandidates`, 10). A query with no reachable
candidate says so and lists the folders it tried. Quarantine, raw inbox, outputs and graveyard are
never searched. Search does not stem: `cache` does not match `caching`; tags and aliases are the
mitigation.

### 2.3 Restructure (`brain retire`, `brain refactor`)

| Command | Effect |
|---|---|
| `brain retire <note>` | Moves the note to `content/_graveyard/` and rewrites links to it. |
| `brain refactor --rename <note> <new-name>` | Renames the note within its folder and rewrites every link. |
| `brain refactor --move <note> <topic-folder>` | Moves the note to another topic folder and rewrites links. |
| `brain refactor --merge <source> <target>` | Folds the source into the target and retires the source. |
| `brain refactor --split <note> <heading>` | Moves the section under the heading into a new note. |

Each runs as one transaction, accepts `--dry-run`, and refuses when a note changed since it was read.
These, plus ingest and note captures, are the only paths that change canonical notes.

Contract: [brain.md](../architecture/brain.md).

## 3. Knowledge pipeline

```text
agent or user ──capture/import──▶ quarantine ──review──▶ accepted ──ingest──▶ vault notes ──reindex──▶ search, session injection
```

### 3.1 Capture (`capture`)

| | |
|---|---|
| Actors | Agent (through the `developer-os-capture` skill) or User |
| Command | `developer-os capture [--text <text>] [--note <path>] [--json]` |

- Takes the observation from `--text` or stdin, at most 64 KiB; a longer one is refused, never
  shortened.
- Redacts it before anything else, normalizes it, computes the deduplication hash after redaction,
  and writes one capture file into `content/_raw/quarantine/`. The raw text is never written.
- The capture envelope records source agent and version, capture method, project slug, a working
  directory fingerprint, timestamp, the redacted content and the redaction findings as class and
  fingerprint only.
- A duplicate exits 0, writes nothing, and names the status the earlier capture already holds.
- `--note <path>` makes a **note capture**: a proposed full note that will create or replace that
  vault path, bound to the target's bytes at capture time. Brain workflows use it.

### 3.2 Import (`import`)

`import` is the second entrance to quarantine. It turns files into captures through the same
redaction and deduplication path and never reviews, ingests or reindexes.

- `import` with no argument reads the vault inbox `content/_raw/inbox/`.
- `import <path>` reads a file or directory.
- `import --claude-memory` reads Claude Code's per-project auto-memory files.
- Accepted file types: `.md`, `.markdown`, `.txt`. Sources stay in place; the capture id is the
  deduplication cursor. Bounds: 10,000 entries walked, depth 16, 1,000 files per run (`--limit`
  lowers it).
- `--dry-run` reports `would_import` per file.

### 3.3 Review (`review`)

| | |
|---|---|
| Actor | User (a human decision is the point of this step) |
| Commands | `review [--status <s>]` lists; `review --id <id> --decision accept\|reject\|edit` decides |

- The listing shows capture ids, the note a note capture would create or replace, and the redaction
  count; never the observation itself, which the user reads in the vault.
- `accept`: `quarantined → accepted`. `reject`: `quarantined → rejected`, and also withdraws an
  `accepted` capture. `edit`: re-reads a capture the user edited in place, re-redacts it and keeps it
  `quarantined`.
- No decision deletes a source file. A capture edited on disk during a review refuses and keeps the
  edit.

### 3.4 Ingest (`ingest`)

| | |
|---|---|
| Actors | User, Vendor model |
| Command | `developer-os ingest [--agent claude\|codex] [--limit <n>] [--json]` |

For each `accepted` capture (up to `--limit`):

1. The capture moves to `staging`.
2. The product builds a prompt in which the capture is marked as data, adds a bounded index excerpt,
   and calls the selected vendor CLI once, isolated from the user's settings, hooks, MCP servers,
   rules and history, with no tools and no write scope. Timeout: 120 s.
3. The model returns a structured proposal. Nine deterministic validators judge it:
   `schema-and-frontmatter`, `source-and-provenance`, `link-and-graph`, `duplicate-detection`,
   `confidence-and-lifecycle`, `secret-scan`, `deterministic-reindex`,
   `generated-output-consistency`, `write-scope`.
4. Only a fully accepted proposal is applied, as one `create` per note, by the product.
5. The capture moves to `ingested`.

After the last capture, one reindex runs for the whole run. A note capture is applied verbatim with no
vendor call. A hand edit to the vault during the agent call refuses that capture and writes nothing.
`secret-scan` and `write-scope` refusals exit 5; other refusals exit 1. `--agent` defaults to the
first installed vendor.

Contract: [knowledge-pipeline.md](../architecture/knowledge-pipeline.md),
[threat-model.md](../architecture/threat-model.md).

## 4. Brain workflows (agent skills)

Installed into both agents as skills named `developer-os-<id>`; each is rendered from
`workflows/<id>/workflow.yaml`. Every workflow that would change the vault does so only by writing a
capture for review.

| Workflow | What the agent does |
|---|---|
| `brain-search` | Searches the index and explains each ranked match with its source path. |
| `brain-answer` | Answers a question from the vault alone, citing a note path for every claim; can file the answer back as a capture. |
| `brain-report` | Writes a report on one subject from the vault and its lint state, with citations; can file it back as a capture. |
| `brain-compile` | Synthesises one compiled note from the notes on a topic, as a note capture. |
| `brain-enhance` | Proposes a revision of one existing note as a note capture bound to its current bytes. |
| `brain-garden` | Turns lint findings into proposals: note captures for content fixes, printed dry-run commands for structural ones. |
| `capture` | Writes an observation into quarantine. |
| `review` | Lists captures and records a decision. |
| `ingest` | Stages, validates and applies accepted captures. |
| `doctor` | Reports health and the agent capability matrix. |
| `shared` | Reads back the safety rules every workflow carries. |

Contract: [workflow-schema.md](../architecture/workflow-schema.md); catalog with versions:
[Agent integration](../reference/agent-integration.md#1-workflows).

## 5. Agent guardrails (hooks)

Installed into both agents by `init`. Each hook runs the product CLI with a fixed verb.

| Verb | Fires on | Effect |
|---|---|---|
| `brain status --inject` | session start | Injects the vault map and the note whose title or alias matches the project directory, at most 16 KiB. |
| `guard prompt` | prompt submit | Suggests up to three skills from the project's `.developer-os/skill-rules.json`. |
| `guard command` | before a shell command | Blocks `curl`/`wget` piped to a shell or interpreter, download process substitution, recursive delete of `/` or home, destructive SQL. |
| `guard commit` | before a shell command | Blocks hook bypass (`--no-verify`, `-n`, `core.hooksPath` override) and force push (`--force-with-lease` is allowed). |
| `guard path` | before a file edit | Blocks edits of protected paths (credentials, keys, `.env`, secrets) and of product-owned state. |
| `guard edit` | after a file edit | Advises when an edited path resolves through a symlink out of the project. |
| `guard format`, `guard stop` | after an edit, at stop | Allow; they run no project tool (D102). |

Blocking verbs fail closed: a malformed payload or internal error blocks. The others fail open. Codex
hooks need a one-time manual trust approval in Codex; `doctor` prints the step until a Codex hook has
fired. Contract: [hooks.md](../architecture/hooks.md) §3.

## 6. Shared instructions

`init` installs one set of instruction defaults into each selected agent:

- **Rules** (always loaded): `communication`, `security`, `stack-preferences`, `workflow`.
- **Scoped rules** (loaded for matching files): `comments`, `error-handling`, `lessons-code`,
  `monitoring`, `nextjs`, `testing`, `typescript`.
- **Subagents:** `code-reviewer`, `performance-engineer`, `qa-expert`, `research-analyst`,
  `security-auditor`.
- **Output styles** (Claude only): `architect`, `debug`, `direct-objective`, `tdd-enforcer`.
- **Skills:** thirteen general skills (code review, bug triage, deploy checklist, spec, and others)
  plus the eleven workflow skills of §4.

The user overrides or adds any artifact by placing a file under
`<product-home>/instructions/<vendor>/<category>/`; the next `init` renders it. The product never
edits that tree. Shared vendor files receive one marked block; editing inside the block makes the next
`init` stop with a conflict report. Catalog and placement:
[Agent integration](../reference/agent-integration.md).

## 7. Project templates

- `project init [<dir>]` writes `AGENTS.md`, `CLAUDE.md` and `_Context.md` into a repository,
  create-only: if any exists, it refuses (exit 3) and writes nothing. Overrides:
  `<product-home>/templates/project/<name>`. A template carrying a secret refuses (exit 5).
- `project check [<dir>]` warns on a missing instruction file, a file over 40,000 bytes or a missing
  template name, and fails (exit 5) on a secret, reported as file, class and line only.

These files are the user's: no manifest row, no drift check, and `uninstall` never removes them.

## 8. Opt-in Git synchronization

| | |
|---|---|
| Actor | User, optionally Scheduler (`git-sync` job) |
| Commands | `git enable --remote <url> [--branch <name>] [--apply]`, `git disable [--apply]`, `git status`, `git sync` |

- Disabled until enabled; a disabled install spawns no Git process.
- `enable` and `disable` print a plan; `--apply` executes it after rechecking that nothing changed.
  Enable initializes or adopts the vault repository, records the branch and adds the remote
  `developer-os`.
- `sync` commits and pushes only canonical notes in configured topic folders plus four index files
  (`index.json`, `graph.json`, `vault-map.md`, `catalog.md`). Quarantine, inbox, outputs, graveyard,
  templates and `.obsidian` never enter a commit. It stages exact paths, never `git add -A`, scans for
  secrets before committing, and never fetches, pulls, merges, rebases or force-pushes.
- A failed push keeps the local commit and exits non-zero with `git sync` as the recovery; it is
  never reported as success.
- The product never stores or prompts for a Git credential; Git uses the user's own authentication.
- Push transfers reachable history: a path committed by hand before or between syncs can reach the
  remote. The enable plan says so.

## 9. Opt-in scheduled automation

| Job | Kind | Runs |
|---|---|---|
| `brain-reindex` | required when automation is on | `brain reindex` |
| `brain-lint` | required | `brain lint` |
| `doctor` | required | the local doctor profile, without vendor probes |
| `git-sync` | included when Git is enabled | `git sync` |
| `brain-garden` | optional, off by default | one isolated Claude call that proposes at most 8 note captures for gap and isolated notes; skipped when 20 or more captures wait for review or lint has errors |
| `brain-pulse` | optional, off by default | no agent; writes a health report (`state/pulse.<n>.md`) with a `healthy`, `attention` or `failure` verdict and raises a macOS notification on the last two |

- `automation enable --schedule <job>=<schedule> … [--garden-agent claude] [--apply]` plans, then
  installs one LaunchAgent per eligible job. There are no default times; schedules are
  `hourly@MM`, `daily@HH:MM` or `weekly@<day>,HH:MM` in local time. The first enable needs a schedule
  for every eligible job.
- `automation disable [--apply]` removes only product jobs. `automation status` shows each job's
  eligibility, installed state, last run and, for the pulse, its last verdict.
- Scheduled jobs use the same locks, validation, redaction and transactions as manual runs. No job
  ingests or imports: `import` and `ingest` stay manual (D47).
- `brain-garden` refuses Codex, which has no tool-free mode.

Contract: `superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md` §4–§5,
[brain.md](../architecture/brain.md) §6.15.

## 10. Update and rollback

| | |
|---|---|
| Actor | User |
| Commands | `update [--version <x.y.z>] [--apply]`, `update rollback [--apply]` |

- `brew upgrade developer-os` replaces the Homebrew package only; the active release changes only
  with `update --apply`.
- `update` previews the move from the active release to the installed package's release and writes
  nothing. `--apply` revalidates the preview under the global lock and runs one coordinated, journaled
  update: the new bundle, the owner files, a retained rollback payload, the manifest, trust
  watermarks, the active release record, then verification. Before the verifier succeeds, a failure
  compensates back to the old release; after it, recovery only moves forward.
- One previous release is retained. `update rollback` previews returning to it from local evidence
  only; `--apply` performs it.
- Both refresh the installed workflows; if either reports `workflows not refreshed`, the user runs
  `developer-os init`.
- Trust never moves backwards: a lower release, index or delegation sequence refuses as replay
  (exit 5). A package whose bytes differ from the release of the same version refuses
  `update_release_identity_rebound` (exit 5).
- The product makes no network request during update.

Contract: [foundation.md](../architecture/foundation.md) §11.

## 11. Output and exit codes

Every command prints human lines, or exactly one JSON line with `--json`. Every string leaf of JSON
output is redacted. Exit codes are stable:

| Code | Meaning |
|---:|---|
| 0 | success |
| 1 | operational failure |
| 2 | invalid input |
| 3 | decision required (drift, conflict, declined confirmation) |
| 4 | capability unavailable |
| 5 | security refusal |
| 6 | recovery required |

A failure prints its message, the paths involved, and a `Recovery:` line when one command fixes it.
