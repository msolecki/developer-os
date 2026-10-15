#!/bin/sh
# A clean pnpm project in a git repository, so the retro's state check has something to read.
exec sh "$(dirname "$0")/../fixtures/repo.sh" "${1:-$PWD}"
