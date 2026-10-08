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

A release is a tag on a `development` commit that has already passed CI.

1. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md`.
2. Land it on `development`. Wait for the `check.yml` run of that push to finish green. A run that a later push cancelled does not count. A pull-request run does not count.
3. Tag that exact commit and push the tag:
   ```sh
   git tag vX.Y.Z <commit>
   git push origin vX.Y.Z
   ```
4. Review the draft release: its notes, the two tarballs, `SHA256SUMS` and the SBOM. Then publish it (approval 1).
5. Review and merge the tap pull request (approval 2).

To withdraw a release, delete the draft or close the tap pull request. To roll back a merged formula, revert the tap commit.

Never use Homebrew's `revision`. The launcher admits only `Cellar/developer-os/<X.Y.Z>`.

Version rule: minor and patch stay below 1000.
