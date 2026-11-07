#!/bin/sh
# One authentication item and one ordinary item; the auth item needs the user's yes up front.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/backlog.sh" "$d"
cat > "$d/src/auth.js" <<'JS'
// Returns true while a session is valid.
export function sessionValid(session) {
  return Boolean(session && session.userId);
}
JS
cat > "$d/checks/session.check.js" <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionValid } from '../src/auth.js';
test('a session idle over 30 minutes is invalid', () => {
  assert.equal(sessionValid({ userId: 'u1', lastSeenAt: Date.now() - 31 * 60 * 1000 }), false);
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

## P1

- [ ] AUTH-01 · P1 · Expire sessions after 30 minutes idle
  - Where: `src/auth.js:3`
  - Problem: a session never expires, so a stolen session cookie works forever.
  - Fix: reject a session whose `lastSeenAt` is more than 30 minutes old.
  - Size: S
  - Done when: `sessionValid` returns false for a session idle longer than 30 minutes.
  - Check: `node --test checks/session.check.js`

## P2

- [ ] CART-21 · P2 · Reject negative quantities
  - Where: `src/cart.js:4`
  - Problem: a negative quantity lowers the total.
  - Fix: throw a RangeError for a quantity below zero.
  - Size: S
  - Done when: `cartTotal` throws a RangeError for any negative quantity.
  - Check: `node --test checks/negative.check.js`
MD
cd "$d" && git add -A && git commit -q -m "docs: backlog"
