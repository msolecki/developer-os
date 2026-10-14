# Release on merge to `main` (D104)

**Goal:** merging a pull request from `development` into `main` releases the version named by the
first `## [X.Y.Z]` heading of `CHANGELOG.md`, with no manual tag and no manual approval: the full
suite runs on the merged commit, then the release is built, published and the tap pull request is
opened and merged in the same `check.yml` run. A merge whose version already has a tag releases
nothing.

**Decisions (D104, founder 2026-10-14):** full automation (no draft, no manual tap merge); the VM
gate is waived for `0.1.0`; `check.yml` skips pull requests into `main` (the push run on `main` is
the gate).

**Why one run:** a tag or release created with `GITHUB_TOKEN` does not trigger other workflows, and
a merge creates a new SHA, so the chain is `check.yml` jobs → `release.yml` and `tap.yml` as
reusable workflows, gated by `needs:` on every test job of the same run.

| Step | What | Where | How | Test | Size |
|---|---|---|---|---|---|
| 1 | Reusable `release.yml` | `.github/workflows/release.yml`, `tests/repository/release-workflow.test.ts` | `workflow_call` input `tag`; `$TAG` replaces `$GITHUB_REF_NAME`; preflight refuses an existing tag instead of querying `check.yml`; publish creates the release at `$GITHUB_SHA`, not a draft | mutation test updated, green | M |
| 2 | Reusable `tap.yml` with auto-merge | `.github/workflows/tap.yml`, `tests/repository/tap-workflow.test.ts` | `workflow_call` input `tag`; the token step opens and merges the tap pull request | mutation test updated, green | S |
| 3 | Release jobs in `check.yml` | `.github/workflows/check.yml`, `tests/repository/release-trigger.test.ts` | push on `main`; `release-version` needs every test job; `release` and `tap` call the reusable workflows; no cancel on `main` | new test, green; `actionlint` | S |
| 4 | Docs | `CONTRIBUTING.md`, spec A16 amendment block, `DECISIONS.md` D104, A16 plan Task 11 | describe the merge-to-`main` release | lint + repository tests | S |
| 5 | Remote (founder-approved) | GitHub settings | create `main`; ruleset on `main` (PR only, no deletion, no force push); allow branch `main` in environments `release` and `tap` | `gh api` reads | S |
| 6 | Release `0.1.0` | PR `development` → `main` | merge; watch `check.yml` on `main` | `brew info msolecki/developer-os/developer-os` shows `0.1.0` | — |

**Status 2026-10-14:** steps 1–5 done (`cf9bc63c`, `058ef5b1`; remote: branch `main`, ruleset `main`, environments admit `main`). **Next action:** merge PR #62 into `development`, then open and merge the PR `development` → `main` (step 6).
