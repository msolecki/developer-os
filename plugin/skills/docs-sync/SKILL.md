---
name: docs-sync
description: Check a repository's docs against its code and the project docs standard — scaffold missing pieces, refresh docs/CURRENT-STATE.md, report docs-vs-code drift, and propose the "Likely agent mistakes here" section from git history — writing nothing until the user approves. Use when docs may be stale, after a large change, or when setting up docs in a project; for example "odśwież dokumentację", "czy docsy są aktualne", "zsynchronizuj docs z kodem".
argument-hint: "[path]"
---

# Docs sync

Read-only until the user approves a numbered list of changes.

## The standard

The developer-os repository keeps copyable versions in `templates/project/`; the installed plugin does not ship them, so scaffold from this list:

- Root `AGENTS.md` (under 100 lines): purpose, commands, `## Likely agent mistakes here`, stack, non-obvious architecture, conventions, do NOT, `## Invariants`, docs map. `CLAUDE.md` is one line, `@AGENTS.md`. `_Context.md`: a signpost of at most 25 lines with a dated "State as of".
- Every doc under `docs/` starts with frontmatter `status` (`current`, `draft`, or `deprecated`), `owner`, and `last-verified` (`YYYY-MM-DD`, the day it was checked against the code).
- `docs/index.md`: a `| Task | Read first |` table routing each common task to one doc.
- `docs/CURRENT-STATE.md`: a `Verified at commit: <short sha>` line, then `## Works` (with entry points as `path:line`), `## In progress`, `## Known broken or missing`.
- `docs/pitfalls.md`: deliberate settings that look like defects; per entry Where, Looks like, Why it is deliberate, Breaks if changed.
- `docs/decisions/NNNN-slug.md`: Date, Context, Decision, Consequences, Alternatives rejected. One decision register with IDs is an accepted alternative.
- `docs/runbooks/`: deploy, rollback, incident procedures.

Propose only pieces that would carry real content now; say which you skip as empty.

## 1. Inventory

- Find the instruction files (`AGENTS.md`, `CLAUDE.md`, `_Context.md`) and the docs root (`docs/`, or the one `AGENTS.md` names). Respect an existing layout that serves the same purpose (one decision register with IDs instead of ADR files, `doc/` instead of `docs/`); do not propose renaming it.
- Read `git log --oneline -30` and `git rev-parse --short HEAD`.

## 2. Missing pieces

List each piece of the standard that is absent, with the content it would start with. Docs without the three frontmatter keys count as one item, listing the files.

## 3. Drift

Check claims against the code. Each finding names the doc `path:line`, the claim, and the evidence that contradicts it:

- Commands in `AGENTS.md`/`CLAUDE.md`/`README` that are not scripts in the package manifest, `Makefile`, or equivalent, and manifest scripts used in CI that no doc mentions.
- Paths, files, and `path:line` references in docs that no longer exist (`git ls-files`, `rg`).
- Stack versions that differ from the manifest or lockfile.
- `docs/CURRENT-STATE.md`: its commit is not an ancestor of HEAD (`git merge-base --is-ancestor`), or more than 50 commits behind; claims under "Works" whose entry point is gone.
- `_Context.md` "State as of" date older than the last commit touching the code it describes.
- Docs whose `last-verified` is older than the last change to the code they cite.

Report only what you checked; say which probes did not apply.

## 4. Refresh CURRENT-STATE

Draft the new `docs/CURRENT-STATE.md`: verify each existing line against the code, drop or move the ones that no longer hold, add shipped work from the commits since the recorded one, set `Verified at commit:` to HEAD's short SHA and `last-verified` to today. Show it as a diff.

## 5. Likely agent mistakes

Propose at most three items for `## Likely agent mistakes here` in `AGENTS.md`, from git history (reverts, "fix"/"revert" commits that undo a change in the same files, files changed repeatedly in fix commits) and from corrections the user made in the current conversation; never open session transcript files. Each item states the mistake, the correct action, and its evidence as `commit <short sha>` or `session <YYYY-MM-DD>`. Propose nothing without evidence. Keep `AGENTS.md` under 100 lines; if the section would push it over, say what to cut.

## 6. Report and ask

```
Docs sync — <repo> at <short sha>
Missing: 3   Drift: 5   CURRENT-STATE: 41 commits behind   Mistake candidates: 2

1. [missing] docs/pitfalls.md — two entries: the disabled lint rule in eslint.config.js:12, the retry cap
2. [drift] AGENTS.md:24 says `npm run test:e2e`; package.json has no such script
...
Apply which? A: all (recommended)  B: list numbers  C: none
```

## Stop point

Stop after the report and the question. After approval, apply exactly the approved items, show `git diff --stat`, and stop; the user commits.

## Never

- Write, create, or delete any file before the user approves the numbered items.
- Overwrite an existing doc wholesale; edit only the approved lines.
- Commit, push, or open a pull request.
- Invent evidence for a mistake item or a drift finding.
- Read session transcripts or files outside the repository.
