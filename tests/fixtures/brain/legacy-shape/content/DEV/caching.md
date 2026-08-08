---
schemaVersion: 1
title: Cache invalidation on write
type: knowledge-note
created: 2026-01-05
updated: 2026-02-11
tags: [dev, caching]
aliases: [cache busting]
summary: Invalidate the cache when a value is written, never when it is read.
stage: established
author: human
reviewed: 2026-02-11
occurrences: 4
---

Writing through the cache keeps readers correct without a second round trip.
See [[DEV/testing]] for the cases that pin this.
