---
type: decision
status: archived
created: 2026-06-03
updated: 2026-09-02
project: sample-shop
tags: [webhooks, idempotency]
summary: "Superseded: webhook handlers deduplicated on a SHA-256 hash of the payload."
---

## Context

First version of webhook deduplication.

## Decision

Deduplicate webhook events on a SHA-256 hash of the payload, kept in Redis for 24 hours.

## Why

No schema change was needed.

## Links

- [[webhook-event-id-dedupe]]
