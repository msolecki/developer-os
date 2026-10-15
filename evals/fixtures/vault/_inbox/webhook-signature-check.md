---
type: knowledge
status: inbox
created: 2026-10-10
updated: 2026-10-10
project: sample-shop
tags: [webhooks, security]
summary: "Verify the webhook signature on the raw body before parsing or deduplicating the event."
---

## Context

A handler parsed the JSON body first and then failed to verify the signature over the re-serialized text.

## Decision

Verify the signature over the raw request body, then parse, then deduplicate on the event ID.

## Why

Re-serialized JSON differs byte for byte from what the provider signed.

## Links

- [[webhook-event-id-dedupe]]
