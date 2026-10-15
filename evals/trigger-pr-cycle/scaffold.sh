#!/bin/sh
# A feature branch one commit behind main. origin is a bare repository inside .git/, so fetch and push work
# offline and the remote is not part of the working tree.
set -eu
d=$(cd "${1:-$PWD}" && pwd -P)
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
cd "$d"
git init -q --bare .git/remote.git
git remote add origin "$d/.git/remote.git"
git checkout -q -b feature/discount
sh "$here/../fixtures/cart-discount.sh" "$d" clean
git checkout -q main
printf '# sample-shop\n' > README.md
git add README.md
git commit -q -m "docs: readme"
git push -q origin main feature/discount
git remote set-head origin main
git checkout -q feature/discount
git branch -q -u origin/feature/discount
