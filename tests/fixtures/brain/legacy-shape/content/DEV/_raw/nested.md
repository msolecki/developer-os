---
schemaVersion: 1
title: Nested capture
type: knowledge-note
created: 2026-07-31
tags: [inbox]
summary: EXCLUDED-FROM-EVERY-INDEX. A private folder nested inside a topic folder.
stage: emerging
author: agent
reviewed: null
---

EXCLUDED-FROM-EVERY-INDEX. This file exists because exclusion applied only at
the top level of `content/` would index it. It sits one level deeper than the
other excluded fixtures on purpose: `content/DEV/_raw/` is a shape real vaults
produce, and an indexer that checks depth 1 only will happily read it.
