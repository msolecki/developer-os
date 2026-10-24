#!/bin/sh
# The fixture vault plus superseded notes (dangling); see fixtures/superseded.sh.
exec sh "$(dirname "$0")/../fixtures/superseded.sh" "${1:-$PWD}" dangling
