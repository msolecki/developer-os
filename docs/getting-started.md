---
status: current
owner: Mateusz Solecki
last-verified: 2026-11-08
---

# Your first 30 minutes

A guided path from an empty install to a first review. Each step says what to type and what you
should see. Examples of output are marked as examples; your text will differ.

## Install

In Claude Code, type:

```
/plugin marketplace add msolecki/developer-os
/plugin install developer-os@developer-os
```

An install takes the latest release, from `main`. Later releases arrive with
`claude plugin update developer-os@developer-os`; auto-update is off unless you turn it on under `/plugin`.

## Set up the vault

Ask Claude Code to run `brain-setup`. It asks for the vault's absolute path. An empty or missing
directory becomes a new vault copied from the template. A non-empty one is connected only after you
say so, and only missing folders, views and the note template are added; no file is overwritten.

Then it shows a diff and changes nothing until you approve: a `Brain vault: <path>` line in
`~/.claude/CLAUDE.md` and the vault path in `permissions.additionalDirectories` in
`~/.claude/settings.json`. It asks separately whether to set `"autoMemoryEnabled": false`, which
stops Claude Code's auto memory from keeping a second, unreviewed store.

It ends with a smoke test: a search for "webhooks" in a new vault. If auto memory files already
exist, it gives a count per project and offers `brain-import-memory`, which moves what is worth
keeping into the vault.

## Open the vault in Obsidian

Open the vault folder with "Open folder as vault"; Bases needs Obsidian 1.9.10 or later. In
Settings, Core plugins, enable **Bases** and **Templates**, and set the Templates folder to `templates`.

## Search

Ask: `brain-search webhooks`. In a new vault it finds the template's example note,
`_inbox/process-webhooks-once-per-event-id.md`. The answer cites the note's path and marks it as
unreviewed, because it is in `_inbox/` and nobody has checked it. Example:

```
Payment webhooks are processed once per event ID.
  — _inbox/process-webhooks-once-per-event-id.md (inbox, unreviewed)
```

## Review

Ask: `brain-review`. It lists each inbox note with its summary, the topic folder that fits and any
likely duplicate, then asks which to approve. Answer, for example, `promote 1`. Silence or "looks good"
is not approval. For the named note it moves the file from `_inbox/` to its topic folder, then sets
`status: active` and today's `updated`.

## Capture

Ask: "capture the decision about X", with a real decision of yours. brain-capture checks that the
note outlives the task and has a written reason, redacts secrets, and writes one new file,
`_inbox/<kebab-case-topic>.md`, with the headings Context, Decision, Why and Links. It tells you what it redacted.
The note stays an unreviewed draft until you run brain-review on it.

## Bring a project in

In a terminal, copy the project template into your repository:

```
cp -Rn ~/.claude/plugins/marketplaces/developer-os/templates/project/. /path/to/project/
```

`-n` keeps any file that already exists. Then ask Claude Code to run `project-init` in that
repository. It detects the stack, runs project-baseline, docs-sync and instruction-review, audits
the code against the conventions that apply, and gives one numbered report. It writes nothing until
you approve items from that one report.

## Review a change

Make a small change, then ask for `code-review` on it. If the agent wrote the change in this
session, an independent reviewer agent reviews it. The report starts with a verdict, `APPROVE`, `COMMENT`
or `REQUEST_CHANGES`, then lists findings under P0, P1, P2 and P3. Each finding has a
`file:line`, evidence, impact and a fix.

## Wrap up

Ask for `session-retro` when you finish. It checks for uncommitted, unpushed and unmerged work,
proposes cleanup, and gives a Done, Not done and Needs you status. After 30 tool calls the `Stop`
hook offers it once per session.

## Where next

- [workflow.md](workflow.md): the daily loop, the vault layout and the recommended configuration.
- [reference/skills.md](reference/skills.md): what each skill checks and how.
