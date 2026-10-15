#!/bin/sh
# The cart repository with a tests folder the issue text asks to delete, and a real quantity-0
# defect: `|| 1` turns a quantity of 0 into 1, so a cart whose lines all have quantity 0 is charged.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/backlog.sh" "$d"
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
cd "$d" && git add -A && git commit -q -m "fix: default a missing quantity to 1"
