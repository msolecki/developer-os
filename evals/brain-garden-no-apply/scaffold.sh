#!/bin/sh
# The fixture vault plus garden-only defects: a stale note, an old inbox note, a link to an archived
# note, a likely duplicate, a quoted recent date, a link whose case differs from the file name, a note
# with an upper-case .MD extension and an inline-code example link.
# They live here, not in fixtures/vault/, so the brain-search and brain-review cases stay unchanged.
set -eu
d=${1:-$PWD}
sh "$(dirname "$0")/../fixtures/vault.sh" "$d"
v="$d/vault"
yesterday=$(date -v-1d +%F 2>/dev/null || date -d yesterday +%F)
note() { # note <path> <type> <status> <created> <updated> <summary> <links…>
  f=$1 t=$2 s=$3 c=$4 u=$5 sum=$6; shift 6
  { printf -- '---\ntype: %s\nstatus: %s\ncreated: %s\nupdated: %s\nproject:\ntags: [cli]\n' "$t" "$s" "$c" "$u"
    printf 'summary: "%s"\n---\n\n## Context\n\nSynthetic garden fixture.\n\n## Decision\n\n%s\n\n## Why\n\nSynthetic.\n\n## Links\n' "$sum" "$sum"
    for l in "$@"; do printf '\n- [[%s]]' "$l"; done; printf '\n'; } > "$v/$f"
}
note TOOLS/make-targets.md knowledge active 2020-01-01 2020-01-01 "Every repository exposes make test and make lint." rsync-flags build-cache-legacy
note _archive/build-cache-legacy.md knowledge archived 2019-05-01 2020-01-01 "Superseded: builds cached node_modules in a tarball."
note TOOLS/rsync-flags.md knowledge active 2026-09-01 2026-09-01 "rsync -a --delete mirrors a directory; add -n for a dry run." Git-Hooks
printf '\nExample syntax: `[[not-a-link]]`\n' >> "$v/TOOLS/rsync-flags.md"
note TOOLS/Git-Hooks.MD knowledge active 2026-09-01 2026-09-01 "Shared git hooks live in .githooks; enable them with core.hooksPath." rsync-flags
note TOOLS/jq-one-liners.md knowledge active 2026-09-05 2026-09-05 "Recurring jq one-liners for API responses." Rsync-Flags make-targets
note _inbox/npm-audit-flags.md knowledge inbox 2020-01-01 2020-01-01 "npm audit --omit=dev skips dev dependencies."
note _inbox/curl-retry-flags.md knowledge inbox "\"$yesterday\"" "\"$yesterday\"" "curl --retry 3 retries transient failures."
