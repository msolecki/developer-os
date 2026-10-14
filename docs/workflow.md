# How to work: brain + code

This is the workflow developer-os is built for. The plugin gives the agent skills; this document
tells you when to use them and where each piece of knowledge belongs.

## The idea

- **Agent sessions forget.** Every new session starts from zero. What you explained yesterday, the
  bug you chased for an hour, the reason you chose one library over another: gone.
- **The vault remembers.** An Obsidian vault of plain Markdown files holds what should survive the
  session. The agent reads it with its own file tools; no server, no index, no database.
- **The repository remembers the code.** Plans, ADRs and code facts stay next to the code they
  describe, in the repository. Whether plans are committed is each project's choice.
- **You decide what becomes knowledge.** The agent creates notes only in `_inbox/`; it edits or moves
  any other note only after you approve (brain-review, brain-garden). Nothing is trusted until you
  review it and set `status: active`. An unreviewed agent note is a draft, not a fact.

## Setup in 5 minutes

The [README](../README.md) has the short version; this is the full one.

1. Install the plugin in Claude Code:
   ```
   /plugin marketplace add msolecki/developer-os
   /plugin install developer-os@developer-os
   ```
2. Copy `vault-template/` to where you keep your vault (or merge its folders into an existing vault)
   and open it in Obsidian. When merging, do not overwrite your own `.obsidian/` folder; see
   `vault-template/README.md`.
3. In Obsidian, Settings, Core plugins: enable **Bases** and **Templates**; set the Templates folder
   to `templates`.
4. Tell the agent where the vault is. Add one line to `~/.claude/CLAUDE.md` (and `~/.codex/AGENTS.md`
   if you also use Codex; see [Codex](../README.md#codex-manual-best-effort)):
   ```
   Brain vault: /absolute/path/to/your/vault
   ```
   Brain skills ask once for the vault path when this line is missing, and stop if you have none;
   the core rules run brain-search only when the line exists.
5. Let Claude Code read and write the vault outside your project folders. Add it to
   `~/.claude/settings.json`:
   ```json
   { "permissions": { "additionalDirectories": ["/absolute/path/to/your/vault"] } }
   ```
   (or start a session with `claude --add-dir /absolute/path/to/your/vault`).
6. Start a session and ask: "brain-search webhooks". It should find the example inbox note.

For each project repository, copy `templates/project/` (`AGENTS.md`, `CLAUDE.md`, `_Context.md`) into
its root and fill in `AGENTS.md` and `_Context.md`. `CLAUDE.md` is one line, `@AGENTS.md`, so both
agents read the same file. `_Context.md` carries the project's vault slug.

## Vault layout

| Folder | Holds |
|---|---|
| `_inbox/` | New notes the agent captured, `status: inbox`. brain-garden reports notes older than a week. The `Inbox` view selects by this folder. |
| `PROJECTS/` | One hub note per project, plus project notes that outlive the repository. |
| `DEV/` | Programming knowledge: patterns, language and framework lessons. |
| `TOOLS/` | References for tools, services and APIs you use. |
| `INFRA/` | Hosting, deploys, networking, databases, CI. |
| `QA/` | Testing approaches and lessons from defects. |
| `_archive/` | Notes that are no longer true, no longer relevant, merged or rejected, `status: archived`. Nothing is deleted. |
| `templates/` | The note template for Obsidian's Templates plugin. |
| `_views/` | Bases views: `Inbox`, `Stale`, `By project`. |

Every note starts with the same frontmatter. The Brain skills rely on it, so do not rename the keys:

```yaml
---
type: decision | knowledge | reference | project
status: inbox | active | archived
created: YYYY-MM-DD
updated: YYYY-MM-DD
project: <project slug or empty>
tags: []
summary: "<one sentence>"
sources: []  # optional, compiled notes only
---
```

`summary` is always double-quoted, so a colon in the sentence does not break the YAML. The note
template defaults to `status: active` for notes you write yourself; the agent's notes start as
`status: inbox`.

- `decision`: something you chose, with the reason and the rejected alternatives.
- `knowledge`: something you learned that will be true next time.
- `reference`: something you look up: commands, limits, contacts by role, settings.
- `project`: the hub note of a project.

The body uses four headings: `## Context`, `## Decision`, `## Why`, `## Links`. In a decision note,
`## Decision` is what you chose; in a lesson, it states the lesson. Compiled notes use the same four
headings.

## The daily loop

### 1. Start a task: search first

Before planning anything non-trivial, ask the agent to run **brain-search** with the topic, the
project slug, or the error message. It reads `active` notes first and tells you when a hit is still
in the inbox. Two minutes here routinely saves an hour of rediscovering a decision you already made.

If the search finds nothing, that is useful too: you are in new territory, so expect to capture
something at the end.

### 2. During work: the plan lives in the repository

Work from a plan file in the repository's planning location (for example
`docs/plans/2026-10-14-checkout-retry.md`): goal, decisions, steps, next action. Update it after
each step. Committing plans is the project's choice; some repositories keep them local and
gitignored. A spec from the **spec** skill is named `<date>-<feature>-spec.md`. End each session at
a committable, validated state, and commit when the project allows it.

Do not write the plan in the vault. A plan in the vault drifts away from the code it describes.

### 3. A decision is made: capture it

When you settle something that you, or another project, will want to know again, ask for
**brain-capture**: "capture the decision about webhook idempotency". The agent writes one note to
`_inbox/` with `status: inbox`, the right `type` and `project`, a one-line `summary`, and the why.
It redacts secrets before writing.

Capture at the moment of the decision, not at the end of the day. The reasons are sharpest when the
rejected options are still on screen.

### 4. End of day or week: review the inbox

Open `_views/Inbox.base` in Obsidian, or ask for **brain-review** to summarize the inbox and propose
what to keep. For each note:

- **Keep**: fix the summary if needed, set `status: active`, move it to its topic folder.
- **Merge**: if an active note already covers it, add the new part there, then move the inbox note
  to `_archive/` with `status: archived`.
- **Reject**: if it was only true for that afternoon, move it to `_archive/` with
  `status: archived`.

The policy is archive, never delete: a merged or rejected note stays in `_archive/`, out of search
and the views, but recoverable. brain-garden follows the same rule.

brain-review proposes; it never promotes a note without you. Approval is the one step that keeps the
vault trustworthy, so it stays human.

### 5. Monthly: garden

Ask for **brain-garden**. It reports stale notes (also visible in `_views/Stale.base`: active notes
not updated in 180 days), `_inbox/` notes older than 7 days, notes whose folder and `status`
disagree, broken links, links into `_archive/`, duplicates and notes without a summary. It proposes
changes and applies them only after you approve. A stale note gets re-read and then updated,
archived, or confirmed by bumping `updated`.

When several notes circle the same topic, **brain-compile** drafts one consolidated note from them,
also into the inbox for your review. Only `active` notes are sources; the compiled note lists them in
`sources:` as quoted links (`"[[note-name]]"`).

## Vault or repository?

| Belongs in the repository | Belongs in the vault |
|---|---|
| Code facts: how this module works, its invariants | Lessons that apply across projects |
| Plans and task progress | Decisions with their why, when the why matters beyond one repo |
| ADRs for this codebase | Client and stakeholder context, by role |
| Setup, commands, conventions (`CLAUDE.md`, `AGENTS.md`) | Tool and service references: limits, gotchas, pricing traps |
| Anything a reviewer of the code needs | Anything you would otherwise re-explain to the next session |

Rule of thumb: if it should change when the code changes, it goes in the repository. If it should
survive the repository, it goes in the vault. When both apply, the ADR lives in the repository and a
short vault note links to it and says what the lesson is for other projects.

Do not capture:

- what the code already says (the agent can read the code);
- session logs, transcripts, or "today I did X" diaries;
- anything you would not want an agent to repeat back as fact.

## How project repositories link to the vault

- Each project has a slug, for example `example-shop`. It is written once in the repository's
  `_Context.md` (`Vault project slug:`) and used as `project:` in every vault note about it.
- `PROJECTS/<slug>.md` is the hub note: what the project is, who decides, links to its decision notes.
- Ask the agent to read `_Context.md` first in that repository (the template `CLAUDE.md` and
  `AGENTS.md` point to it), so brain-search and brain-capture use the slug without you typing it.
- `_views/By project.base` groups active notes by slug: a project's whole memory on one screen.
- Cross-project notes leave `project:` empty.

Link from the vault to the repository by path or URL; do not copy repository content into notes.

## Writing a note that will be found

- **One topic per note.** Two topics make two notes that link to each other.
- **The title is the question you will search for.** "Process webhooks once per event ID", not
  "Notes from Tuesday".
- **The summary stands on its own.** It is what search results and Bases tables show. One sentence,
  with the conclusion in it.
- **Write the why, not just the what.** "We use a unique constraint" is a fact; "because an
  in-app check races under parallel retries" is the knowledge.
- **Name the rejected options** in decision notes, so nobody reopens them without new information.
- **Link.** Use `[[note-name]]` links (no folder) to related notes and the project hub, so links
  survive moving a note out of `_inbox/`. Unlinked notes are hard to find and easy to duplicate.
- **Keep it short.** If a note needs headings beyond Context, Decision, Why and Links, it is
  probably two notes.
- **Update `updated`** whenever you change what a note says.

## Privacy

- The vault is local Markdown on your disk. The plugin sends nothing anywhere by itself; what the
  agent reads from the vault goes to your model provider as part of the session, like any file it
  reads. An agent with web access could also send it elsewhere.
- Never commit the vault to a public repository. If you sync it with git, use a private remote; a
  vault holds client context and decisions you would not publish.
- brain-capture redacts secrets (tokens, passwords, keys, connection strings) before writing. Review
  still matters: check inbox notes for client names, personal data and internal URLs before you set
  `status: active`.
- Keep credentials out of the vault entirely. Refer to where a secret lives ("in the password
  manager, entry X"), never to its value.
- Anything you paste into a note can come back in a later session. Write as if the agent will quote it.

## What else the plugin ships

The full list of skills, agents and output styles, and the manual Codex setup, are in the
[README](../README.md#whats-inside).
