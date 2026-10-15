#!/bin/sh
# A clean project in git for the state check.
exec sh "$(dirname "$0")/../fixtures/repo.sh" "${1:-$PWD}"
