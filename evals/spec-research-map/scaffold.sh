#!/bin/sh
# The cart repository with its test; a spec request must show a research map of it before the first question.
set -eu
exec sh "$(dirname "$0")/../fixtures/backlog.sh" "${1:-$PWD}"
