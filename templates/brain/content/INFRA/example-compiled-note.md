---
schemaVersion: 1
title: Folders decide what gets indexed
type: compiled-note
created: 2026-08-10
updated: 2026-08-10
tags: [infra]
summary: Only configured topic folders are indexed; everything else is ignored on purpose.
stage: established
author: human
reviewed: 2026-08-10
occurrences: 1
---

A compiled note gathers what several other notes agree on. This one gathers the
folder rules, because they are the thing people most often trip over.

Indexed: the topic folders named in your configuration — by default PROJECTS,
TOOLS, DEV, INFRA and QA — at any depth.

Never indexed, at any depth: `_raw/` and its children, `_outputs/`,
`_graveyard/`, `_indexes/`, `templates/`, and anything beginning with a dot.
Quarantined captures live in `_raw/`, so nothing there can reach a search result
before a human has looked at it.

A folder that is neither a topic folder nor one of those is reported by
`brain lint` rather than silently indexed, so adding one is a decision you make
rather than one that happens to you.
