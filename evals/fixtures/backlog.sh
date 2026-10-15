#!/bin/sh
# The cart repository plus a passing test suite, so the validation baseline is green.
# Usage: backlog.sh <dir>; the caller writes TODO.md and commits.
set -eu
d=$1
sh "$(dirname "$0")/repo.sh" "$d"
# A global excludes file on the host may ignore TODO.md; the fixture must not depend on it.
git -C "$d" config core.excludesFile /dev/null
mkdir -p "$d/test" "$d/checks"
cat > "$d/test/cart.test.js" <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from '../src/cart.js';
test('sums line totals', () => {
  assert.equal(cartTotal([{ priceCents: 250, quantity: 2 }]), 500);
});
JS
cd "$d" && git add -A && git commit -q -m "test: cart total"
