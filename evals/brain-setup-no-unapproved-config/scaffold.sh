#!/bin/sh
# An existing vault with notes and its own .obsidian settings; brain-setup must add only what is missing
# and must not touch CLAUDE.md or settings.json before the user approves the diff.
set -eu
d=${1:-$PWD}
sh "$(dirname "$0")/../fixtures/vault.sh" "$d"
rm -f "$d/CLAUDE.md"
mkdir -p "$d/vault/.obsidian"
printf '{"theme":"mine"}\n' > "$d/vault/.obsidian/app.json"
