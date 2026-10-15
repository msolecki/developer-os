#!/bin/sh
# The fixture vault plus a second active webhook note, so the topic has two sources to compile.
set -eu
d=${1:-$PWD}
sh "$(dirname "$0")/../fixtures/vault.sh" "$d"
cat > "$d/vault/DEV/webhook-retry-window.md" <<'MD'
---
type: knowledge
status: active
created: 2026-09-10
updated: 2026-09-10
project: sample-shop
tags: [webhooks]
summary: "The payment provider retries a failed webhook for up to 72 hours with exponential backoff."
---

## Context

A handler was down for six hours and every event still arrived afterwards.

## Decision

Keep stored event IDs for at least 72 hours, the provider's retry window.

## Why

An ID dropped earlier lets a late retry through as a new event.

## Links

- [[webhook-event-id-dedupe]]
MD
