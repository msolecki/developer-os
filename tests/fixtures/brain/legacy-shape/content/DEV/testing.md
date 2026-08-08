---
schemaVersion: 1
title: Tests that pin the invalidation contract
type: knowledge-note
created: 2026-01-12
updated: 2026-02-11
tags: [dev, testing]
aliases: [invalidation tests]
summary: A read-path test cannot prove a write-path guarantee; assert on the write.
stage: established
author: human
reviewed: 2026-02-11
occurrences: 2
---

Each case writes a value, then reads it back through a second handle.
A test that only reads passes against a cache that never invalidates at all.
