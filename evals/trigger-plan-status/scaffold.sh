#!/bin/sh
# A git repository with one active plan (3 done, 2 open, 1 blocked item, one open question) and a
# backlog with one ready, one waiting (Blocked by) and one orphaned (Owner from 2020) item.
set -eu
d=${1:-$PWD}
sh "$(dirname "$0")/../fixtures/repo.sh" "$d"
mkdir -p "$d/docs/plans"
cat > "$d/docs/plans/2026-10-01-cart-discounts.md" <<'MD'
# Cart discounts

**Goal:** customers can apply one discount code at checkout.

## Steps

- [x] Discount parameter in `cartTotal`
- [x] Clamp the total at zero
- [x] Unit tests for the discount
- [ ] Discount code field on the checkout page
- [ ] Show the discount line on the receipt
- [ ] Charge the discounted total in the payment sandbox (blocked: no sandbox credentials yet)

## Open questions

- Q1: Can a discount code be combined with free shipping?

## Status

In progress.
MD
cat > "$d/TODO.md" <<'MD'
# Backlog

## P2

- [ ] CART-30 · P2 · Round line totals to whole cents
  - Size: S
  - Check: `node --test`

- [ ] CART-31 · P2 · Show the rounded total on the receipt
  - Blocked by: CART-30
  - Size: S
  - Check: `node --test`

- [ ] DOCS-04 · P2 · Document the discount rules
  - Owner: .worktrees/docs-04 (2020-01-01)
  - Size: S
  - Check: `test -f docs/discounts.md`
MD
cd "$d" && git add -A && git commit -q -m "docs: cart discounts plan and backlog"
