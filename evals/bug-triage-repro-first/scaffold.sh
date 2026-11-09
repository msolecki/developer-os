#!/bin/sh
# The cart repository with a quantity-0 defect: `|| 1` turns a quantity of 0 into 1, so a line with
# quantity 0 is charged once. A run that follows bug-triage reproduces it with a command before ranking
# hypotheses and demonstrates the cause with a toggle (quantity 0 against undefined or 1, or `??`).
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
