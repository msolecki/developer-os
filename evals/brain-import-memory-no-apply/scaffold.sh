#!/bin/sh
# The fixture vault plus a Claude Code auto-memory folder in the workspace: one fact the vault already
# has (dedupe webhooks by event ID), one new lesson (git fetch --prune-tags), one user preference and one
# dated progress log.
set -eu
d=${1:-$PWD}
sh "$(dirname "$0")/../fixtures/vault.sh" "$d"
printf 'Vault project slug: demo\n' > "$d/_Context.md"
m="$d/claude-config/projects/demo/memory"
mkdir -p "$m"
cat > "$m/MEMORY.md" <<'MD'
- [Webhook dedupe](webhook-dedupe.md) — dedupe provider webhooks by event ID.
- [git fetch prunes tags](git-fetch-prunes-tags.md) — push a new tag at once.
- [Reply in Polish](reply-in-polish.md) — the user wants answers in Polish.
- [Audit run 2026-09-01](audit-run-2026-09-01.md) — batch 3 of 7 done.
MD
cat > "$m/webhook-dedupe.md" <<'MD'
---
name: webhook-dedupe
description: dedupe provider webhooks by event ID
type: project
---
The payment provider retries webhooks, so we store the event ID with a unique constraint and process each event once.
MD
cat > "$m/git-fetch-prunes-tags.md" <<'MD'
---
name: git-fetch-prunes-tags
description: git fetch deletes unpushed local tags
type: feedback
---
With `fetch.pruneTags=true` in the global git config, `git fetch` deletes a local tag that is not on the remote yet.
Why: a release tag created locally vanished before it was pushed. How to apply: push a new tag right after creating it.
MD
cat > "$m/reply-in-polish.md" <<'MD'
---
name: reply-in-polish
description: the user wants answers in Polish
type: user
---
Answer in Polish, briefly; technical terms may stay in English.
MD
cat > "$m/audit-run-2026-09-01.md" <<'MD'
---
name: audit-run-2026-09-01
description: progress of one audit run
type: project
---
Audit run 2026-09-01: batches 1-3 of 7 done, batch 4 next. Resume with the backlog file.
MD
