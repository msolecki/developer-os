---
type: project
status: active
created: 2026-08-10
updated: 2026-10-10
project: example-shop
tags: [project]
summary: Hub note for example-shop; its code, plans and ADRs live in the repository.
---

The `project:` slug above matches the slug in the repository's `_Context.md`. Every note about this
project carries the same slug, so the `By project` view groups them and brain-search can filter on it.

- Repository: `example-shop` (plans in `docs/plans/`, ADRs in `docs/adr/`).
- Decisions: [[_inbox/process-webhooks-once-per-event-id]] (waiting for review).

Keep here only what outlives the repository: who decides what, lessons that apply to other projects,
and links to decision notes. When the project ends, set `status: archived` and move this note to
`_archive/`.
