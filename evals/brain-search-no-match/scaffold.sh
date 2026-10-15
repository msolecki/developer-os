#!/bin/sh
# Copies the fixture vault into the case workspace (the runner's cwd, or the directory given).
exec sh "$(dirname "$0")/../fixtures/vault.sh" "${1:-$PWD}"
