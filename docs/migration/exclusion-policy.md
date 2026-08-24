# Publication Exclusion Policy

## Purpose

Developer OS uses a clean-room migration boundary. Public artifacts are reconstructed only from explicitly approved source candidates into reviewed destinations. Source repositories, private knowledge stores, repository history, and owner-only recovery evidence are never copied wholesale.

The default decision is exclusion. A file is eligible for publication only when it has an explicit public destination, an allowed classification, a content hash, and an independent reviewer. Eligibility is not permission to publish; all release gates still apply.

## Material that must never cross the boundary

The following material is prohibited from public artifacts, prompts, reports, logs, diffs, commits, release bundles, and remote repositories:

- Raw captures, transcripts, imports, scratch dumps, and unprocessed source exports.
- Client notes, founder notes, private knowledge, personal data, and identifying source metadata.
- Credentials, tokens, passwords, cookies, authorization headers, connection strings, and secret values.
- `.env`, `.env.*`, `.env.local`, and every equivalent environment or local-override file.
- Private keys, certificates, signing material, keystores, and files using key or certificate formats.
- `.obsidian` local state and other editor, user, or machine-local state.
- Machine configuration, host-specific paths, device metadata, and absolute machine paths.
- Real source remotes, credential-store data, or remote URLs copied from source repositories.
- Secret-bearing history, raw patches, revision exports, reflogs, deleted content, and recovery bundles.
- Owner-only backup evidence, its location, its filenames, and its raw contents.
- Command output, debug logs, model traces, or test fixtures containing source or private values.
- Generated artifacts that have not received content review and independent approval.
- Everything under `docs/superpowers/plans/legacy-runtime/`. These documents describe the owner's pre-Developer-OS machine, its repositories, its automation, and a credential-rotation checklist. They are tracked in this repository so the outstanding work has one home; they are never publication candidates and are never referenced from a public artifact.

## Paths this repository does not create

- **`.claude/`.** This repository creates no `.claude/` directory in version 1. Adapter output
  lives in `plugins/claude/` and installs into the user's `~/.claude/skills/`, so no generated
  artifact needs a home here; conveniences this repository would run on itself are declined rather
  than deferred. Recorded so the absence is a decision rather than a gap: the repository is public,
  and a `.claude/` here is inherited by every fork. The reasoning of record is
  `docs/architecture/claude-adapter.md` §2; reopening it is an amendment, not a `mkdir`.

## Clean-room migration procedure

1. Identify an approved candidate by its abstract source ID, exact repository-relative path, classification, destination, and evidence hash.
2. Reconstruct the public artifact in the target repository. Do not preserve source history, private metadata, deleted material, or unrelated context.
3. Redact at the earliest boundary. Sensitive input must be redacted before truncation, writing, logging, hashing for publication evidence, or submission to any model. Truncation and hashing do not make a secret safe.
4. Compare the reconstructed artifact against the allowed public contract, not against an unfiltered source dump.
5. Run schema, classification, provenance, and secret checks only over the exact publication candidates. Secret-scan findings must report path and line number only; suspect values must never be echoed.
6. Obtain independent review before staging or publication.

Hash-only evidence may be recorded only when an owner-controlled process has already kept the underlying sensitive material outside the publication boundary. A hash proves identity; it does not change the classification of the source content. Raw recovery artifacts are never publication evidence; candidate content hashes are allowed only after the exact candidate passes redaction and secret scanning with zero findings.

## Exact-path staging

Stage only reviewed, explicitly named target paths. Never use recursive staging, directory-wide staging, `git add .`, `git add -A`, or wildcard staging for migration work. Re-run the candidate-only secret scan against the exact staged paths and inspect the staged diff before any commit.

Task 0 is a control artifact task. Its publication candidates were deliberately left unstaged at the time, so that the Foundation bootstrap could incorporate them under its own verified boundary — which it did, in commit `098ea92` on 2026-07-21. All three have been tracked ever since; one was later retired under the finished-plan rule. Nothing from Task 0 remains unstaged, and the frozen evidence hashes in `source-manifest.json` are identity proofs as of 2026-07-21, not checksums of the current tree. See `publicationCandidateEvidence` in that file.

## Remote and release gates

Recording an origin is not remote verification.

**Corrected 2026-08-11 — the condition below ended on 2026-08-10 and the prohibition it gated no longer binds.** This section was written while remote verification was `blocked_by_environment`, and every bullet under it was conditional on that state. The remote now exists, the repository is public and deliberately so, and CI runs on it. Fetching, pushing and opening a pull request are therefore ordinary work; merging to the default branch is not, and remains a human decision under the repository's own pull-request rule. What survives of the original item is `ORDER.md` Track L's **L2** — destination remote, visibility and branch protections verified by the founder outside this environment — and L2 alone still gates a public release. The bullets are left standing rather than deleted, because they state the correct procedure for any future environment that re-enters the blocked state. Registered in `docs/superpowers/BACKLOG.md` §8.

While remote verification is `blocked_by_environment`:

- Do not fetch, push, open a pull request, create a public release, or otherwise transmit repository content.
- Do not access credential stores, SSH configuration, or private authentication material to work around the block.
- Require verification in an authorized external environment that the destination remote, repository visibility, branch protections, and publication target are correct.
- Require passing schema validation, exhaustive and unique classification checks, exact-candidate secret scanning, staged-diff review, and independent human or fresh-agent review before public release.

Local hooks being disabled is recorded state, not an exemption from any validation or release gate.

## Historical credential-rotation waiver

The owner waived four historical credential rotations only as implementation and publication blockers. The waiver does not declare any affected value safe, does not permit affected values or histories to enter the target, and does not authorize raw source, private content, patches, backups, logs, or recovery evidence. It does not relax redaction, secret scanning, independent review, remote verification, or release gates.
