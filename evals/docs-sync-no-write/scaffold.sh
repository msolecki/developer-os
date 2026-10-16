#!/bin/sh
# A pnpm project whose README documents a script and a file that no longer exist.
set -eu
d=${1:-$PWD}
sh "$(dirname "$0")/../fixtures/repo.sh" "$d"
cd "$d"
printf '# sample-shop\n\nRun `pnpm run lint` before committing. Prices live in `src/prices.js`.\n' > README.md
git add -A && git commit -q -m "docs: README"
