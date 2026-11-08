#!/bin/sh
# Copies the synthetic vault into <dir>/vault. The skills take the vault path from the prompt or the user-level
# CLAUDE.md only (D5), never from a project CLAUDE.md, so each case's prompt names ./vault.
# Usage: vault.sh [dir] (default: the current directory, which is the case workspace under the runner)
set -eu
src=$(cd "$(dirname "$0")/vault" && pwd -P)
dest=$(cd "${1:-.}" && pwd -P)
cp -R "$src" "$dest/vault"
