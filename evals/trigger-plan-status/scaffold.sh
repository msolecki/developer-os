#!/bin/sh
# A git repository with one active plan: 3 done, 2 open, 1 blocked item and one open question.
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
cd "$d" && git add -A && git commit -q -m "docs: cart discounts plan"
