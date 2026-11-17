#!/bin/sh
# Copies the synthetic vault into <dir>/vault. The skills take the vault path from the prompt or the user-level
# CLAUDE.md only (D5), never from a project CLAUDE.md, so each case's prompt names ./vault.
# The inbox notes get created/updated of ten days ago: an inbox note expires 30 days after `created`, and
# brain-search skips an expired one, so a fixed date would stop the cases from exercising their graders.
# Usage: vault.sh [dir] (default: the current directory, which is the case workspace under the runner)
set -eu
src=$(cd "$(dirname "$0")/vault" && pwd -P)
dest=$(cd "${1:-.}" && pwd -P)
cp -R "$src" "$dest/vault"
recent=$(date -v-10d +%F 2>/dev/null || date -d '10 days ago' +%F)
for f in "$dest"/vault/_inbox/*.md; do
  sed -E "s/^(created|updated): .*/\\1: $recent/" "$f" > "$f.tmp"
  mv "$f.tmp" "$f"
done
