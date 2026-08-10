---
schemaVersion: 1
title: Developer OS brain commands
type: reference-note
created: 2026-08-10
updated: 2026-08-10
tags: [tools]
aliases: [brain commands]
summary: reindex builds the indexes, lint checks the vault, search reads the index.
stage: established
author: human
reviewed: 2026-08-10
occurrences: 1
---

A reference note is something you look up rather than reason about.

- `developer-os brain reindex` rebuilds the four generated files under
  `content/_indexes/`. It is the only command that writes to this vault.
- `developer-os brain lint` reports what is wrong and exits non-zero on errors.
- `developer-os brain search <query>` reads the index; it never rebuilds it, so
  reindex first if results look stale.
- `developer-os brain status` reports what the vault looks like and changes
  nothing.
