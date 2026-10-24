#!/bin/sh
# The fixture vault plus superseded notes (cycle); see fixtures/superseded.sh.
exec sh "$(dirname "$0")/../fixtures/superseded.sh" "${1:-$PWD}" cycle
