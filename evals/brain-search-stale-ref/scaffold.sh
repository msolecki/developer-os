#!/bin/sh
# The fixture vault plus three active notes with `refs:` and `verified:` (30 days ago), and the workspace
# as the sample-shop repository (`Vault project slug: sample-shop` in _Context.md). The first commit is
# 60 days old; a second, 5 days old, changes src/cart.js and src/format.js.
# - cart-total-integer-cents refs sample-shop:src/cart.js: changed since verified, so its claim gets the marker.
# - checkout-tax-rounding refs sample-shop:src/checkout.js: untouched, so no marker.
# - cart-price-format refs other-shop:src/format.js: the file changed, but the slug is another project's, so no marker.
set -eu
d=${1:-$PWD}
sh "$(dirname "$0")/../fixtures/vault.sh" "$d"
v="$d/vault"
ago() { date -v-"$1"d +%F 2>/dev/null || date -d "$1 days ago" +%F; }
base=$(ago 60); verified=$(ago 30); changed=$(ago 5)
note() { # note <name> <project> <ref> <summary> <why>
  { printf -- '---\ntype: decision\nstatus: active\ncreated: %s\nupdated: %s\nproject: %s\ntags: [cart, money]\n' "$verified" "$verified" "$2"
    printf 'refs: ["%s"]\nverified: %s\nsummary: "%s"\n---\n\n## Context\n\nSynthetic fixture.\n\n## Decision\n\n%s\n\n## Why\n\n%s\n\n## Links\n' "$3" "$verified" "$4" "$4" "$5"; } > "$v/DEV/$1.md"
}
note cart-total-integer-cents sample-shop sample-shop:src/cart.js "The cart total is summed in integer cents by cartTotal in src/cart.js." "Floats drift by a cent on large carts."
note checkout-tax-rounding sample-shop sample-shop:src/checkout.js "Tax on the cart total is rounded once, at the end, by addTax in src/checkout.js." "Rounding per line drifts by a cent."
note cart-price-format other-shop other-shop:src/format.js "Cart totals are formatted with two decimals by formatCents in src/format.js." "One formatter keeps every screen the same."
cd "$d"
git init -q -b main
git config user.name eval
git config user.email eval@example.invalid
printf 'vault/\nCLAUDE.md\n' > .gitignore
printf 'Vault project slug: sample-shop\n' > _Context.md
mkdir -p src
printf 'export function cartTotal(lines) {\n  return lines.reduce((sum, l) => sum + l.priceCents * l.quantity, 0);\n}\n' > src/cart.js
printf 'export function addTax(totalCents, rate) {\n  return Math.round(totalCents * (1 + rate));\n}\n' > src/checkout.js
printf 'export function formatCents(cents) {\n  return (cents / 100).toFixed(2);\n}\n' > src/format.js
git add -A
GIT_AUTHOR_DATE="${base}T12:00:00" GIT_COMMITTER_DATE="${base}T12:00:00" git commit -q -m "feat: cart total, tax and formatting"
printf 'export function cartTotal(lines) {\n  return lines.reduce((sum, l) => sum + l.price * l.quantity, 0);\n}\n' > src/cart.js
printf 'export function formatCents(cents) {\n  return (cents / 100).toFixed(2) + " EUR";\n}\n' > src/format.js
git add -A
GIT_AUTHOR_DATE="${changed}T12:00:00" GIT_COMMITTER_DATE="${changed}T12:00:00" git commit -q -m "refactor: cart lines carry price"
