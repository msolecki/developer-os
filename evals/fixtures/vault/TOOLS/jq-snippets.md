---
type: knowledge
status: active
created: 2026-08-11
updated: 2026-08-11
project:
tags: [jq, cli]
---

## Context

Recurring jq one-liners for API responses.

## Decision

`jq -r '.items[] | [.id, .status] | @tsv'` prints one row per item, tab-separated.

## Why

Pastes cleanly into a spreadsheet.

## Links
