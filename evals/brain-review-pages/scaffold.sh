#!/bin/sh
# The fixture vault with 25 inbox notes: its own two plus 23 planted here, all created ten days ago so
# none is expired. Above 20 notes brain-review shows a first page of 20 numbered lines, each with a
# recommendation, and moves nothing. One planted note is a per-task log, one restates the active
# DEV/webhook-event-id-dedupe.md, so the page has a reject and a merge to recommend.
set -eu
d=${1:-$PWD}
sh "$(dirname "$0")/../fixtures/vault.sh" "$d"
v="$d/vault"
recent=$(date -v-10d +%F 2>/dev/null || date -d '10 days ago' +%F)
note() { # note <name> <type> <tag> <summary> <why>
  { printf -- '---\ntype: %s\nstatus: inbox\ncreated: %s\nupdated: %s\nproject:\ntags: [%s]\n' "$2" "$recent" "$recent" "$3"
    printf 'summary: "%s"\n---\n\n## Context\n\nSynthetic review fixture.\n\n## Decision\n\n%s\n\n## Why\n\n%s\n\n## Links\n' "$4" "$4" "$5"; } > "$v/_inbox/$1.md"
}
note api-error-envelope decision api "Every API error uses one JSON envelope with code, message and requestId." "Clients parse one shape."
note api-pagination-cursor decision api "List endpoints paginate with an opaque cursor, never an offset." "Offsets skip rows when data changes."
note api-idempotency-key decision api "POST endpoints that create money movements require an Idempotency-Key header." "A retried request must not charge twice."
note webhook-event-id-unique-column decision webhooks "Webhook handlers deduplicate on the provider event ID in a unique column." "The constraint holds under concurrent deliveries."
note money-integer-cents decision money "Money is stored and summed in integer cents; formatting happens at the edge." "Floats drift by a cent."
note timezone-utc-storage decision time "Timestamps are stored in UTC and converted in the UI only." "One zone in the database removes DST bugs."
note feature-flag-naming knowledge flags "Feature flags are named area.feature.variant and removed within one release." "Stale flags hide dead code."
note migration-forward-only decision database "Database migrations are forward-only; a rollback is a new migration." "Down migrations are never tested."
note index-before-foreign-key knowledge database "Add the index in the same migration as a foreign key on a large table." "An unindexed key locks the table on delete."
note ci-cache-key-lockfile knowledge ci "CI cache keys hash the lockfile, not the branch name." "A branch key never hits on a new branch."
note ci-fail-fast-off knowledge ci "Matrix jobs run with fail-fast off so every failing version is visible." "One red job otherwise hides the others."
note docker-non-root-user knowledge docker "Container images run as a non-root user with a fixed UID." "A fixed UID keeps volume permissions stable."
note terraform-state-per-env decision terraform "Each environment keeps its own Terraform state and backend." "A shared state couples staging to production."
note secrets-in-parameter-store decision secrets "Runtime secrets live in the parameter store, never in the image or the repository." "Rotation needs no rebuild."
note log-request-id knowledge logging "Every log line carries the request ID from the incoming header." "One grep follows a request across services."
note alert-on-symptoms knowledge monitoring "Alerts fire on user-visible symptoms, not on causes such as CPU." "Cause alerts page without an outage."
note e2e-test-data-builders knowledge testing "End-to-end tests create their data with builders, never with a shared seed." "A shared seed couples unrelated tests."
note flaky-test-quarantine decision testing "A flaky test is quarantined with an issue link and fixed within a week." "Re-running hides the cause."
note jq-tsv-export knowledge cli "jq with @tsv exports API items as tab-separated rows." "It pastes cleanly into a spreadsheet."
note git-bisect-run knowledge git "git bisect run with the failing test finds a regression commit unattended." "It needs no manual stepping."
note pnpm-frozen-lockfile knowledge pnpm "CI installs with pnpm install --frozen-lockfile." "A drifting lockfile must fail the build."
note eslint-no-floating-promises knowledge lint "The no-floating-promises lint rule is an error in every TypeScript package." "An unawaited promise swallows its rejection."
note tuesday-login-debug-session knowledge debug "Today I restarted the login service twice and the test passed again." "It was a one-off."
