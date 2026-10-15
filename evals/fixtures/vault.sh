#!/bin/sh
# Copies the synthetic vault into <dir>/vault and writes <dir>/CLAUDE.md with its `Brain vault:` line.
# Usage: vault.sh [dir] (default: the current directory, which is the case workspace under the runner)
set -eu
src=$(cd "$(dirname "$0")/vault" && pwd -P)
dest=$(cd "${1:-.}" && pwd -P)
cp -R "$src" "$dest/vault"
printf 'Brain vault: %s\n' "$dest/vault" > "$dest/CLAUDE.md"
