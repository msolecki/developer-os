#!/bin/sh
# Two items: the P1 item is blocked by an open P2 item; only the P2 item is ready.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/backlog.sh" "$d"
cat > "$d/checks/negative.check.js" <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from '../src/cart.js';
test('negative quantity throws', () => {
  assert.throws(() => cartTotal([{ priceCents: 100, quantity: -1 }]), RangeError);
});
JS
cat > "$d/TODO.md" <<'MD'
# Backlog

## P1

- [ ] CART-12 · P1 · Show the number of items next to the total
  - Where: `src/cart.js:2`
  - Problem: the total gives no item count.
  - Evidence: `cartTotal` returns a number only.
  - Fix: add `cartCount(lines)` summing quantities.
  - Size: S
  - Done when: `cartCount` returns the sum of quantities and rejects negative ones like `cartTotal`.
  - Check: `node --test`
  - Blocked by: CART-07

## P2

- [ ] CART-07 · P2 · Reject negative quantities
  - Where: `src/cart.js:4`
  - Problem: a negative quantity lowers the total.
  - Evidence: the loop multiplies without a guard.
  - Fix: throw a RangeError for a quantity below zero.
  - Size: S
  - Done when: `cartTotal` throws a RangeError for any negative quantity.
  - Check: `node --test checks/negative.check.js`

## P3

## Implementation sessions
MD
cd "$d" && git add -A && git commit -q -m "docs: backlog"
