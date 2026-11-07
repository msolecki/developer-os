#!/bin/sh
# Three ready items: FMT-05's Check already passes (the fix landed), TAX-02's Where file was moved
# to src/pricing/tax.js, and CART-21 is valid. Only CART-21 may be claimed and dispatched.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/backlog.sh" "$d"
mkdir -p "$d/src/pricing"
cat > "$d/src/format.js" <<'JS'
// Formats cents as a price string.
export function formatPrice(cents) {
  return (cents / 100).toFixed(2);
}
JS
cat > "$d/src/pricing/tax.js" <<'JS'
// Returns the 23% VAT on an amount in cents.
export function taxCents(cents) {
  return Math.floor(cents * 0.23);
}
JS
cat > "$d/checks/format.check.js" <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice } from '../src/format.js';
test('two decimals', () => {
  assert.equal(formatPrice(500), '5.00');
});
JS
cat > "$d/checks/tax.check.js" <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taxCents } from '../src/pricing/tax.js';
test('VAT rounds half up', () => {
  assert.equal(taxCents(50), 12);
});
JS
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

## P2

- [ ] FMT-05 · P2 · Always show two decimals
  - Where: `src/format.js:3`
  - Problem: `formatPrice(500)` returns `5`.
  - Evidence: `String(cents / 100)` drops trailing zeros.
  - Fix: use `toFixed(2)`.
  - Size: S
  - Done when: `formatPrice(500)` returns `5.00`.
  - Check: `node --test checks/format.check.js`

- [ ] TAX-02 · P2 · Round VAT half up
  - Where: `src/tax.js:3`
  - Problem: VAT on 50 cents is 11 instead of 12.
  - Evidence: `Math.floor` truncates the fraction.
  - Fix: use `Math.round`.
  - Size: S
  - Done when: `taxCents(50)` returns 12.
  - Check: `node --test checks/tax.check.js`

- [ ] CART-21 · P2 · Reject negative quantities
  - Where: `src/cart.js:4`
  - Problem: a negative quantity lowers the total.
  - Evidence: the loop multiplies without a guard.
  - Fix: throw a RangeError for a quantity below zero.
  - Size: S
  - Done when: `cartTotal` throws a RangeError for any negative quantity.
  - Check: `node --test checks/negative.check.js`

## Implementation sessions
MD
mkdir -p "$d/.worktrees"
printf '.worktrees/\n' > "$d/.gitignore"
cd "$d" && git add -A && git commit -q -m "docs: backlog"
