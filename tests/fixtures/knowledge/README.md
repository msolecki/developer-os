# Knowledge-pipeline fixtures

`ingest-proposal.json` is the proposal the **scripted vendor** returns in
`tests/e2e/knowledge-lifecycle/lifecycle.test.ts`. It is wholly invented: no note, title,
tag, folder, tool, or repository here corresponds to anything real, and no real vendor is
ever spawned to produce it — the suite writes a shell script that prints this document and
plants it on the disposable `PATH`. Spawning an actual agent CLI belongs to Task 17 alone.

`sourceCaptureId` carries the placeholder `__CAPTURE_ID__` because a capture id is the first
sixteen characters of a content hash and therefore cannot be canned. The suite substitutes
the id the real `capture` invocation returned, and asserts the placeholder was there to
substitute — a proposal that named the wrong capture is refused by the
`source-and-provenance` validator, which is the behaviour that keeps this substitution
honest rather than cosmetic.
