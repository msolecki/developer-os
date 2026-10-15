#!/bin/sh
# AGENTS.md was changed on purpose to require asking before a push; the session correction reverses it.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
cd "$d"
printf '# sample-shop\n\n## Anti-patterns (do NOT)\n\n- Push without asking: CI deploys main on every push.\n' > AGENTS.md
printf '@AGENTS.md\n' > CLAUDE.md
git add -A && git commit -q -m "docs: ask before every push, CI deploys main on push"
