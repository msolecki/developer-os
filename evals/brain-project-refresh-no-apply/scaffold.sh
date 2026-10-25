#!/bin/sh
# The fixture vault plus a hub note for demo-shop that has drifted from a small repository in the
# workspace: a wrong deploy target, a moved decisions folder, a dead link and an unlinked project note.
set -eu
d=${1:-$PWD}
sh "$(dirname "$0")/../fixtures/vault.sh" "$d"
v="$d/vault"
mkdir -p "$v/PROJECTS"
cat > "$v/PROJECTS/demo-shop.md" <<'MD'
---
type: project
status: active
created: 2026-08-01
updated: 2026-08-01
project: demo-shop
tags: [project]
summary: "Hub note for demo-shop; its code and decisions live in the repository."
---

## Context

- Repository: `demo-shop`, deployed to Heroku.
- Decisions live in `docs/adr/`.

## Decision

This hub keeps only what outlives the repository.

## Why

Code facts belong in the repository.

## Links

- [[demo-shop-launch-plan]]
MD
cat > "$v/DEV/demo-shop-cart-rounding.md" <<'MD'
---
type: decision
status: active
created: 2026-09-01
updated: 2026-09-01
project: demo-shop
tags: [money]
summary: "Cart totals are rounded once, at the end, in integer cents."
---

## Context

Synthetic fixture.

## Decision

Round once, at the end, in integer cents.

## Why

Rounding per line drifts by a cent on large carts.

## Links
MD
cd "$d"
git init -q -b main
git config user.name eval
git config user.email eval@example.invalid
printf 'vault/\nCLAUDE.md\n' > .gitignore
printf 'Vault project slug: demo-shop\n' > _Context.md
mkdir -p docs/decisions docs/runbooks
printf '# demo-shop\n\nA small shop. Deploys to Fly.io; see docs/runbooks/deploy.md.\n' > README.md
printf '# Deploy\n\nDeploy with `fly deploy` from main.\n' > docs/runbooks/deploy.md
printf '# 0001. Integer cents\n\nDate: 2026-09-01\nStatus: accepted\n' > docs/decisions/0001-integer-cents.md
git add -A
git commit -q -m "Initial demo-shop"
