#!/bin/sh
# Two S items in different files and one L item.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/backlog.sh" "$d"
cat > "$d/src/format.js" <<'JS'
// Formats cents as a price string.
export function formatPrice(cents) {
  return String(cents / 100);
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
cat > "$d/checks/discount.check.js" <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDiscount } from '../src/discount.js';
test('a valid code lowers the total', () => {
  assert.ok(applyDiscount(1000, { code: 'TEN', expiresAt: '2999-01-01T00:00:00Z' }) < 1000);
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

- [ ] CART-31 · P2 · Reject negative quantities
  - Where: `src/cart.js:4`
  - Size: S
  - Done when: `cartTotal` throws a RangeError for any negative quantity.
  - Check: `node --test checks/negative.check.js`

- [ ] FMT-02 · P2 · Always show two decimals
  - Where: `src/format.js:3`
  - Size: S
  - Done when: `formatPrice(500)` returns `5.00`.
  - Check: `node --test checks/format.check.js`

- [ ] CART-40 · P2 · Discount codes with expiry and per-customer limits
  - Where: `src/`
  - Size: L
  - Done when: a valid code lowers the total, an expired or overused code is rejected with a reason.
  - Check: `node --test checks/discount.check.js`

## Implementation sessions
MD
cd "$d" && git add -A && git commit -q -m "docs: backlog"
