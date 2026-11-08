#!/bin/sh
# Copies the fixture vault into the case workspace (the runner's cwd, or the directory given), plus a newer
# inbox note on the same subtopic as the active DEV/webhook-event-id-dedupe.md, so active-first ranking is tested.
# It lives here, not in fixtures/vault/, so the other brain cases stay unchanged.
set -eu
d=${1:-$PWD}
sh "$(dirname "$0")/../fixtures/vault.sh" "$d"
cat > "$d/vault/_inbox/webhook-event-id-retention.md" <<'EOF'
---
type: decision
status: inbox
created: 2026-10-12
updated: 2026-10-12
project: sample-shop
tags: [webhooks, idempotency, deduplication]
summary: "Deduplicate webhook events on the event ID and keep the stored IDs for 30 days."
---

## Context

The table of processed webhook event IDs grows without bound.

## Decision

Deduplicate webhook events on the provider's event ID as before, and delete stored IDs older than 30 days.

## Why

The provider stops retrying an event after 3 days, so older IDs can never match again.

## Links

- [[webhook-event-id-dedupe]]
EOF
