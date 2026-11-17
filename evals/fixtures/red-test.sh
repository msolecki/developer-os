#!/bin/sh
# The cart repository with a real defect and a failing test that pins it: `|| 1` counts a line with
# quantity 0 as one item, so `pnpm test` is red until src/cart.js changes (`?? 1`).
# Usage: red-test.sh <dir>
set -eu
d=$1
sh "$(dirname "$0")/backlog.sh" "$d"
cat > "$d/src/cart.js" <<'JS'
// Sums line totals of a cart in cents; a line without a quantity counts once.
export function cartTotal(lines) {
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    total += lines[i].priceCents * (lines[i].quantity || 1);
  }
  return total;
}
JS
cat >> "$d/test/cart.test.js" <<'JS'
test('a line with quantity 0 adds nothing', () => {
  assert.equal(cartTotal([{ priceCents: 250, quantity: 0 }]), 0);
});
JS
cd "$d" && git add -A && git commit -q -m "fix: default a missing quantity to 1"
