---
name: brain-capture
description: Save a decision, lesson, or reference from the current session as a new note in the inbox of the user's Obsidian knowledge vault, with secrets redacted. Use when the user says "capture", "remember this", "save this to the brain/vault", or when a session produced a decision or lesson worth keeping.
---

# Brain capture

Writes exactly one new file, inside `_inbox/`. Never write anywhere else in the vault and never edit an existing note.

## 1. Locate the vault

Find the line `Brain vault: <absolute path>` in the user's `CLAUDE.md` or `AGENTS.md`. If there is none, ask the user once for the path and tell them to add that line. Never guess and never search the disk for vaults. If reading the vault is denied, tell the user to grant access (Claude Code: `--add-dir <vault>` or `permissions.additionalDirectories`).

## 2. Check for an existing note

```bash
V="/path/to/vault"
rg -il -g '*.md' -g '!templates/**' -e 'changelog' -e 'release notes' "$V"
```

If a note already covers the topic, name its path to the user and say the new note may duplicate it (the review step can merge them). Still write the capture unless the user says not to.

## 3. Redact secrets

Before writing, replace with `[REDACTED]`: API keys, tokens, passwords, private keys, connection strings or URLs with embedded credentials, and personal data of clients (names, emails, phone numbers, addresses). Tell the user what you redacted. If the note makes no sense without the secret, do not write it; say why.

## 4. Write the note

Path: `<vault>/_inbox/<kebab-case-topic>.md`. If the file exists, add a suffix (`-2`). One topic per note; link related notes as `[[note-name]]`.

```markdown
---
type: decision
status: inbox
created: 2026-10-14
updated: 2026-10-14
project: my-app
tags: [release, changelog]
summary: "Release notes live in CHANGELOG.md at the repository root."
---

# Release notes live in CHANGELOG.md

**Decision:** release notes are kept in `CHANGELOG.md`, one section per version.

**Why:** one file next to the code, reviewed in the same PR.

**Context:** decided while preparing the 1.2 release. Related: [[release-process]].
```

- `type`: `decision`, `knowledge` (a lesson or how-to), `reference`, or `project`.
- `created` and `updated`: today. `project`: the current project's slug, or empty.
- `summary`: one sentence in double quotes (a bare colon breaks YAML).

## 5. Report

```
Captured: _inbox/release-notes-in-changelog.md (decision, status: inbox)
Possible duplicate: DEV/release-process.md
Redacted: nothing
Review it with the brain-review skill or in Obsidian (_views/Inbox.base).
```
