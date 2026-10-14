---
type: decision
status: inbox
created: 2026-10-10
updated: 2026-10-10
project: example-shop
tags: [webhooks, payments]
summary: Payment webhooks are processed once per event ID, because the provider retries for up to three days.
---

## Context

The payment provider used by example-shop retries a webhook until it receives a 2xx response, for up
to three days. A slow deploy produced duplicate order confirmations.

## Decision

Insert the event ID into a column with a unique constraint before doing any work. A duplicate insert
ends the handler with 200.

## Why

A unique constraint is atomic. An "if not seen yet" check in application code races when retries
arrive in parallel.

## Links

- [[PROJECTS/example-shop]]
- [[DEV/write-the-note-you-wanted-to-find]]

<!-- An agent wrote this note with brain-capture. It stays in _inbox/ with status: inbox until you
     review it: set status to active and move it to a topic folder, or delete it. -->
