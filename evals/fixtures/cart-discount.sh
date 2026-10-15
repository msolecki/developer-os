#!/bin/sh
# Commits the discount change to src/cart.js in the repository at <dir>.
# Usage: cart-discount.sh <dir> <bug|clean> — bug puts an off-by-one (`<=`) on line 4.
set -eu
cd "$1"
op='<'
[ "$2" = bug ] && op='<='
cat > src/cart.js <<JS
// Sums line totals of a cart in cents, minus an optional discount.
export function cartTotal(lines, discountCents = 0) {
  let total = 0;
  for (let i = 0; i $op lines.length; i++) {
    total += lines[i].priceCents * lines[i].quantity;
  }
  return Math.max(0, total - discountCents);
}
JS
cat > src/cart.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from './cart.js';

test('applies the discount and never goes below zero', () => {
  const lines = [{ priceCents: 500, quantity: 2 }, { priceCents: 250, quantity: 1 }];
  assert.equal(cartTotal(lines, 200), 1050);
  assert.equal(cartTotal(lines, 5000), 0);
});
JS
git add -A
git commit -q -m "feat: optional discount in cart total"
