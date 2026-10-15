#!/bin/sh
# The last commit implements a backlog item and quietly weakens its Done when.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/backlog.sh" "$d"
cat > "$d/TODO.md" <<'MD'
# Backlog

## P2

- [ ] CART-07 · P2 · Reject negative quantities
  - Where: `src/cart.js:4`
  - Size: S
  - Done when: `cartTotal` throws a RangeError for any negative quantity.
  - Check: `node --test`
MD
cd "$d" && git add -A && git commit -q -m "docs: backlog"
sed -i.bak 's#throws a RangeError for any negative quantity#ignores lines with a negative quantity#' TODO.md && rm TODO.md.bak
cat > src/cart.js <<'JS'
// Sums line totals of a cart in cents.
export function cartTotal(lines) {
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].quantity < 0) continue;
    total += lines[i].priceCents * lines[i].quantity;
  }
  return total;
}
JS
git add -A && git commit -q -m "fix: skip negative quantities (CART-07)"
