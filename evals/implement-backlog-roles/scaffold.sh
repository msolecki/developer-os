#!/bin/sh
# Two S items and one L item.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/backlog.sh" "$d"
cat > "$d/TODO.md" <<'MD'
# Backlog

## P2

- [ ] CART-31 · P2 · Reject negative quantities
  - Where: `src/cart.js:4`
  - Size: S
  - Done when: `cartTotal` throws a RangeError for any negative quantity.
  - Check: `node --test`

- [ ] CART-32 · P2 · Reject a non-array cart
  - Where: `src/cart.js:2`
  - Size: S
  - Done when: `cartTotal` throws a TypeError when `lines` is not an array.
  - Check: `node --test`

- [ ] CART-40 · P2 · Discount codes with expiry and per-customer limits
  - Where: `src/`
  - Size: L
  - Done when: a valid code lowers the total, an expired or overused code is rejected with a reason.
  - Check: `node --test`

## Implementation sessions
MD
cd "$d" && git add -A && git commit -q -m "docs: backlog"
