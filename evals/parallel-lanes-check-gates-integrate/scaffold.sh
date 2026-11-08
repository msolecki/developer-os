#!/bin/sh
# Two finished lanes, both reporting DONE with a green fast check. cart-empty's Check passes;
# cart-tax's Check fails: the lane never applied the tax its Done when promised.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/backlog.sh" "$d"
cd "$d"
printf 'docs/plans/\n.worktrees/\n' > .gitignore
cat > AGENTS.md <<'MD'
# sample-shop

Fast check: `node --test`.
MD
cat > checks/empty.check.mjs <<'JS'
import assert from 'node:assert/strict';
import { isEmpty } from '../src/empty.js';
assert.equal(isEmpty([]), true);
assert.equal(isEmpty([{ priceCents: 1, quantity: 1 }]), false);
JS
cat > checks/tax.check.mjs <<'JS'
import assert from 'node:assert/strict';
import { totalWithTax } from '../src/tax.js';
assert.equal(totalWithTax([{ priceCents: 1000, quantity: 1 }]), 1230);
JS
git add -A && git commit -q -m "chore: lane checks"
base=$(git rev-parse HEAD)
R=docs/plans/lanes/2026-11-07-cart
mkdir -p "$R"

git worktree add -q .worktrees/cart-empty -b lanes/cart-empty "$base"
cat > .worktrees/cart-empty/src/empty.js <<'JS'
export const isEmpty = (lines) => lines.length === 0;
JS
git -C .worktrees/cart-empty add src/empty.js
git -C .worktrees/cart-empty commit -q -m "feat: isEmpty"

git worktree add -q .worktrees/cart-tax -b lanes/cart-tax "$base"
cat > .worktrees/cart-tax/src/tax.js <<'JS'
import { cartTotal } from './cart.js';
export const totalWithTax = (lines) => cartTotal(lines);
JS
git -C .worktrees/cart-tax add src/tax.js
git -C .worktrees/cart-tax commit -q -m "feat: totalWithTax"

cat > "$R/LANES.md" <<MD
# Lanes 2026-11-07-cart

Base: $(git branch --show-current) at $base

## cart-empty
- Objective: an isEmpty(lines) helper.
- Owned paths: src/empty.js
- Done when: isEmpty returns true for an empty cart and false otherwise.
- Check: \`node checks/empty.check.mjs\`
- Worktree: .worktrees/cart-empty, branch lanes/cart-empty

## cart-tax
- Objective: totalWithTax(lines) adds 23% VAT to the cart total.
- Owned paths: src/tax.js
- Done when: totalWithTax of a 1000-cent cart is 1230.
- Check: \`node checks/tax.check.mjs\`
- Worktree: .worktrees/cart-tax, branch lanes/cart-tax
MD
for lane in cart-empty cart-tax; do
  printf 'Lane %s: see LANES.md. Fast check: node --test.\n' "$lane" > "$R/prompt-$lane.md"
  sh -c 'exit 0' & pid=$!; wait "$pid"
  echo "$lane $pid" >> "$R/pids.txt"
  printf 'lane finished\nEXIT=0\n' > "$R/log-$lane.txt"
  mkdir -p ".worktrees/$lane/$R"
  printf 'DONE\n\n$ node --test\n# pass 1\n# fail 0\n' > ".worktrees/$lane/$R/REPORT-$lane.md"
done
for f in "$R/LANES.md" "$R"/prompt-*.md; do echo "$(git hash-object "$f") $f"; done > "$R/hashes.txt"
printf 'Plan: %s\nAgents: cart-empty .worktrees/cart-empty, cart-tax .worktrees/cart-tax\nNext: status\n' "$R" > docs/plans/.devos-state.md
