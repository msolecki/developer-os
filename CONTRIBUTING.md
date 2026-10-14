# Contributing

## Setup

Use Node `24.16.0` (the `.node-version` file).

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --pm-on-fail=ignore build
```

## Gates

- `npm run lint` before every commit.
- `npm run check` for a full run. It takes about 4 hours and runs on macOS only.

Use synthetic fixtures only. Never commit a real vault or a credential.

## Releasing

A release is a merged pull request from `development` into `main`. Nothing else is manual.

1. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md`, above every older version.
2. Land it on `development`.
3. Open a pull request from `development` into `main` and merge it.

The `check.yml` run on `main` runs the whole suite on the merged commit. When every test job passes and the tag `vX.Y.Z` does not exist yet, the same run builds, verifies and publishes the release, then opens and merges the tap pull request. A merge whose `CHANGELOG.md` version already has a tag releases nothing.

If the run fails after the release is published (for example in `tap`), use **Re-run failed jobs** on that run. A full re-run, or a later merge, sees the tag and skips both `release` and `tap`. If the tap branch `release/vX.Y.Z` was already pushed, delete it in the tap first.

To withdraw a release, revert the tap commit and delete the GitHub release. The tag stays: the `release-tags` ruleset forbids deleting or moving a `v*` tag, so the fix ships as the next version.

Never use Homebrew's `revision`. The launcher admits only `Cellar/developer-os/<X.Y.Z>`.

Version rule: minor and patch stay below 1000.
