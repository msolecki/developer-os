#!/bin/sh
# Creates a tiny pnpm project in <dir> as a git repository with one commit on main.
# Usage: repo.sh [dir]
set -eu
cd "${1:-.}"
git init -q -b main
git config user.name eval
git config user.email eval@example.invalid
mkdir -p src
cat > package.json <<'JSON'
{
  "name": "sample-shop",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "scripts": { "test": "node --test" }
}
JSON
printf "lockfileVersion: '9.0'\n" > pnpm-lock.yaml
cat > src/cart.js <<'JS'
// Sums line totals of a cart in cents.
export function cartTotal(lines) {
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    total += lines[i].priceCents * lines[i].quantity;
  }
  return total;
}
JS
git add -A
git commit -q -m "feat: cart total"
