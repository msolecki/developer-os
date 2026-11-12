#!/bin/sh
# The fixture vault plus two expired inbox notes on the dedupe topic of the active
# DEV/webhook-event-id-dedupe.md: one without `expires:` whose `created` is more than 30 days old, and
# one created ten days ago whose `expires:` date passed two days ago. brain-search must answer from the
# active note and name neither.
set -eu
d=${1:-$PWD}
sh "$(dirname "$0")/../fixtures/vault.sh" "$d"
v="$d/vault"
old=$(date -v-45d +%F 2>/dev/null || date -d '45 days ago' +%F)
recent=$(date -v-10d +%F 2>/dev/null || date -d '10 days ago' +%F)
passed=$(date -v-2d +%F 2>/dev/null || date -d '2 days ago' +%F)
cat > "$v/_inbox/webhook-dedupe-redis-ttl.md" <<EOF
---
type: decision
status: inbox
created: $old
updated: $old
project: sample-shop
tags: [webhooks, idempotency, deduplication]
summary: "Deduplicate webhook events on a Redis key per event ID with a 7-day TTL."
---

## Context

An idea from a spike on deduplicating webhook events without a schema change.

## Decision

Deduplicate webhook events on a Redis key per event ID that expires after 7 days.

## Why

No migration is needed.

## Links

- [[webhook-event-id-dedupe]]
EOF
cat > "$v/_inbox/webhook-dedupe-bloom-filter.md" <<EOF
---
type: decision
status: inbox
created: $recent
updated: $recent
expires: $passed
project: sample-shop
tags: [webhooks, idempotency, deduplication]
summary: "Deduplicate webhook events with an in-memory Bloom filter in front of the database."
---

## Context

An idea for cutting database reads when deduplicating webhook events.

## Decision

Deduplicate webhook events with an in-memory Bloom filter and ask the database only on a hit.

## Why

Most deliveries are first deliveries.

## Links

- [[webhook-event-id-dedupe]]
EOF
