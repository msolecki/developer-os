---
schemaVersion: 1
title: Restore drills for object-store backups
type: compiled-note
created: 2025-02-01
updated: 2025-03-02
tags: [infra]
summary: A backup nobody has restored is a hypothesis, so drill the restore on a schedule.
stage: established
author: human
reviewed: 2025-03-02
occurrences: 2
---

The drill restores into an empty namespace and compares object counts and a
sampled checksum. Restoring over the live namespace would make a failed drill
an outage.
