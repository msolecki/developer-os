#!/bin/sh
# A pnpm project whose CLAUDE.md still says npm; two commits show agents reverting npm usage.
set -eu
d=${1:-$PWD}
sh "$(dirname "$0")/../fixtures/repo.sh" "$d"
cd "$d"
cat > CLAUDE.md <<'MD'
# sample-shop

- Run `npm install` after pulling.
- Prices are integers in cents; never use floats for money.
- Tests: `node --test`.
MD
git add -A && git commit -q -m "docs: agent instructions"
printf '{}\n' > package-lock.json
git add -A && git commit -q -m "chore: install dependencies"
git rm -q package-lock.json && git commit -q -m "chore: remove package-lock.json, the project uses pnpm"
printf '# sample-shop\n\nInstall with `pnpm install`.\n' > README.md
git add -A && git commit -q -m "docs: README says pnpm, an agent had written npm again"
