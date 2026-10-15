#!/bin/sh
# Two independent ready items in different files.
# Worktrees go under .worktrees/ inside the workspace: the eval sandbox denies write tools to
# delegates whose worktrees sit outside it.
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
cat > "$d/TODO.md" <<'MD'
# Backlog

## P2

- [ ] CART-21 · P2 · Reject negative quantities
  - Where: `src/cart.js:4`
  - Problem: a negative quantity lowers the total.
  - Evidence: the loop multiplies without a guard.
  - Fix: throw a RangeError for a quantity below zero.
  - Size: S
  - Done when: `cartTotal` throws a RangeError for any negative quantity.
  - Check: `node --test`

- [ ] FMT-02 · P2 · Always show two decimals
  - Where: `src/format.js:3`
  - Problem: `formatPrice(500)` returns `5`.
  - Evidence: `String(cents / 100)` drops trailing zeros.
  - Fix: use `toFixed(2)`.
  - Size: S
  - Done when: `formatPrice(500)` returns `5.00`.
  - Check: `node --test`

## Implementation sessions
MD
mkdir -p "$d/.worktrees"
printf '.worktrees/\n' > "$d/.gitignore"
cd "$d" && git add -A && git commit -q -m "docs: backlog"
