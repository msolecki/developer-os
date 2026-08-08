---
schemaVersion: 1
title: Rowlease CLI leasing model
type: reference-note
created: 2026-04-01
updated: 2026-05-20
tags: [tools]
aliases: [rowlease]
summary: A lease expires on its own, so an abandoned hold never needs a human to release it.
stage: established
author: human
reviewed: 2026-05-20
occurrences: 1
---

A lease carries a deadline rather than an owner flag. Nothing has to notice a
crashed picker: the hold lapses and the row returns to the pool by itself.
Renewing costs one call, so a long shift stays held without a second mechanism.
