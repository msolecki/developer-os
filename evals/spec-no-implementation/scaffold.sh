#!/bin/sh
# The cart repository; a spec request must not turn into code.
set -eu
exec sh "$(dirname "$0")/../fixtures/backlog.sh" "${1:-$PWD}"
