---
type: reference
status: active
created: 2026-03-02
updated: 2026-03-02
project:
tags: [obsidian, bases]
summary: The three views in _views/ and how to change them.
---

A reference note is something you look up rather than reason about.

- `_views/Inbox.base`: notes with `status: inbox`. Review them there: change `status` in the
  properties panel, move the file to a topic folder, or delete it.
- `_views/Stale.base`: active notes whose `updated` date is more than 180 days old.
- `_views/By project.base`: active notes grouped by `project`.
- A `.base` file is YAML with `filters`, `formulas`, `properties` and `views`. Edit it in the Bases
  toolbar or as text; the reference is the Obsidian help page "Bases syntax".
- Bases and Templates are core plugins: Settings, Core plugins.

This note's `updated` date is old on purpose, so `Stale.base` has something to show. Re-read a
stale note, then either bump `updated`, rewrite it, or set `status: archived`.
