---
type: decision
status: active
created: 2026-09-02
updated: 2026-09-20
project: sample-shop
tags: [webhooks, idempotency]
summary: "Webhook handlers deduplicate on the provider's event ID, stored in a unique column."
---

## Context

The payment provider retries a webhook until it gets a 2xx, so the same event can arrive several times.

## Decision

Every webhook handler stores the provider's event ID in a column with a unique constraint and skips an
event whose ID is already stored.

## Why

The database constraint holds under concurrent deliveries; an application-level check does not.

## Links

- [[webhook-signature-check]]
- [[queue-retry-policy]]
