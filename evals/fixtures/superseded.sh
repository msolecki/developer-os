#!/bin/sh
# Copies the fixture vault into <dir>, then adds superseded notes for each mode named.
# Usage: superseded.sh <dir> <mode>...
#   chain     session-store-redis superseded by the active session-store-postgres
#   dangling  session-store-redis superseded by session-store-dynamo, which does not exist
#   cycle     rate-limit-redis and rate-limit-gateway supersede each other
#   nofield   csv-export-sync is superseded with no superseded_by
# They live here, not in fixtures/vault/, so the other brain cases stay unchanged.
set -eu
d=$1; shift
sh "$(dirname "$0")/vault.sh" "$d"
v="$d/vault"
note() { # note <name> <status> <superseded_by or -> <summary> <why>
  { printf -- '---\ntype: decision\nstatus: %s\ncreated: 2026-05-04\nupdated: 2026-09-10\nproject: sample-shop\n' "$2"
    [ "$3" = - ] || printf 'superseded_by: "[[%s]]"\n' "$3"
    printf 'tags: [architecture]\nsummary: "%s"\n---\n\n## Context\n\nSynthetic superseded fixture.\n\n' "$4"
    printf '## Decision\n\n%s\n\n## Why\n\n%s\n\n## Links\n\n- [[webhook-event-id-dedupe]]\n' "$4" "$5"; } > "$v/DEV/$1.md"
}
for m in "$@"; do case $m in
  chain)
    note session-store-redis superseded session-store-postgres "User sessions are stored in Redis with a 30-day TTL." "Redis was already running for the cache."
    note session-store-postgres active - "User sessions are stored in a Postgres sessions table." "One store to back up; Redis evictions logged users out." ;;
  dangling)
    note session-store-redis superseded session-store-dynamo "User sessions are stored in Redis with a 30-day TTL." "Redis was already running for the cache." ;;
  cycle)
    note rate-limit-redis superseded rate-limit-gateway "API rate limits are counted in Redis per API key." "Limits must hold across app instances."
    note rate-limit-gateway superseded rate-limit-redis "API rate limits are enforced by the API gateway." "No limiter code to maintain in the app." ;;
  nofield)
    note csv-export-sync superseded - "CSV exports are generated inside the HTTP request." "Exports were small at launch." ;;
  *) echo "unknown mode: $m" >&2; exit 2 ;;
esac; done
