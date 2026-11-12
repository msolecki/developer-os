#!/bin/sh
# The cart repository plus the fixture vault and one active note that records a rejected approach to
# discount codes; the prompt names ./vault. A spec must read that note before its first question.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/backlog.sh" "$d"
sh "$here/../fixtures/vault.sh" "$d"
cat > "$d/vault/DEV/cart-discount-codes-server-side.md" <<'EOF'
---
type: decision
status: active
created: 2026-09-18
updated: 2026-09-18
project: sample-shop
tags: [cart, discounts, pricing]
summary: "Discount codes are checked and applied on the server at checkout; a discounted total sent by the browser was rejected."
---

## Context

The cart total is computed in the browser for display and again on the server at checkout.

## Decision

A discount code is validated against the codes table and applied to the total on the server, at checkout.

## Rejected

Applying the code in the browser and sending the discounted total to the server: a client could send any total.

## Why

The server is the only place that can trust the code's validity, expiry and usage count.
EOF
cd "$d" && git add -A && git commit -q -m "docs: vault"
