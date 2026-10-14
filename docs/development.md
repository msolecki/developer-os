# Development guide

How to build, test and change Developer OS. `CONTRIBUTING.md` is the short version; this guide adds
the repository layout, every script, the test lanes, CI and the rules the lint gate enforces. The
architecture is in [architecture/overview.md](architecture/overview.md).

## 1. Setup

Requirements: macOS, Node `24.16.0` (`.node-version`), pnpm through Corepack.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --pm-on-fail=ignore build
```

Use the package manager the lockfile declares (pnpm 11); never mix managers. `esbuild`'s install
script is declined in `pnpm-workspace.yaml` on purpose.

## 2. Repository layout

| Path | Holds |
|---|---|
| `apps/cli/` | The `developer-os` CLI: `src/main.ts` (parse and dispatch), `src/bin.ts` (process boundary), `src/context.ts` (composition root), `src/commands/`, `src/hooks/`, `src/bootstrap/`, `src/lifecycle/`, `src/update/`, `src/instructions/` |
| `apps/launcher/` | The stable launcher shipped in the Homebrew keg |
| `packages/core/` | Contracts, configuration, transactions, manifest, lifecycle kernel, Git planning, update coordinator |
| `packages/security/` | Paths, protected paths, redaction, process runner, Git transport supervision |
| `packages/platform-macos/` | macOS facts, locks, launchd, launcher admission |
| `packages/brain/` | The Brain engine and knowledge-pipeline logic |
| `packages/workflow-schema/` | The workflow contract and compiler |
| `packages/adapter-claude/`, `packages/adapter-codex/` | Vendor adapters |
| `workflows/<id>/workflow.yaml` | The eleven canonical workflow contracts |
| `instructions/` | Instruction defaults and `catalog.json` |
| `plugins/claude/`, `plugins/codex/` | Generated vendor trees; regenerate, never hand-edit |
| `templates/brain/`, `templates/project/`, `templates/schemas/` | The vault template, project templates and agent-output JSON Schemas |
| `tests/` | Process-level tests, fixtures, helpers, repository gates (`tests/repository/`) and release tools (`tests/tools/`) |
| `.github/workflows/` | `check.yml` (CI), `release.yml`, `tap.yml` |
| `.github/release/` | Pinned release inputs (`pins.json`) and the formula edit script |
| `docs/` | Documentation ([map](README.md)) |

## 3. Scripts

| Script | Runs | Typical time |
|---|---|---|
| `npm run build` | `tsc -b` | minutes |
| `npm run lint` | `tsc -b`, `eslint .`, the repository gate `tests/dist/repository/check.js` | minutes; **every commit** |
| `npm test` | `test:bootstrap`, `test:suite`, `test:lifecycle`, `test:update-recovery` | hours |
| `npm run test:suite` | Every Vitest file except the slow lanes below | long |
| `npm run test:bootstrap` | `apps/cli/src/bootstrap/executor.test.ts` (also `:main`, `:fine-grained`) | long |
| `npm run test:lifecycle` | `*.v2.test.ts` (also `:uninstall`, `:core`, `:rest`) | long |
| `npm run test:update-recovery` | `tests/integration/update/recovery.test.ts` without the sweeps (also `:deaths`, `:rest`) | long |
| `npm run test:update-recovery:sweeps` | The death-point sweeps; not part of `check` | ~8 h sharded |
| `npm run test:e2e` | `tests/e2e` against the compiled binary | long |
| `npm run test:vendor-ingest` | Ingest isolation against vendor fixtures | short |
| `npm run test:vendor-brain` | Brain workflows against a real Claude; spends credits | manual |
| `npm run test:pinned-host` | Tests that mutate the host (`launchctl`, the real home); opt-in | manual |
| `npm run check` | `lint`, `test`, `test:e2e`, `test:vendor-ingest`, build, `git diff --check` | about 4–5 h |
| `npm run render:claude`, `npm run render:codex` | Regenerate `plugins/claude/`, `plugins/codex/` | seconds |
| `npm run pack:local-release -- <dir>` | Pack the working tree into an `unsigned-local` release for `init --local-release` | minutes |
| `npm run pack:release -- …` | Pack the Homebrew kegs for both architectures (used by CI) | minutes |
| `npm run link:tests` | Link workspace packages for the test package | seconds |

Run one file or case with Vitest directly, for example
`pnpm vitest run packages/brain/src/lint/lint.test.ts -t 'isolated'`.

## 4. The validation ladder

- **Per commit:** `npm run lint` plus the fast tests the change touches. A test asked to fail first
  must fail for the stated reason before the fix.
- **Plan or phase close:** `npm run check` in full, locally or on CI. A plan does not close on a
  skipped or partial suite.
- **CI:** `check.yml` runs the full suite, sharded, on every push to `development` and on pull
  requests. A red run stops new commits until it is fixed. A run cancelled by a later push proves
  nothing about its commit.
- **Host-mutating tests** (`*.pinned-host.test.ts`) never run by default.

Never delete or skip a test to make a gate pass. The decisions behind this ladder are D17 and D32 in
[superpowers/DECISIONS.md](superpowers/DECISIONS.md).

## 5. CI

`check.yml` splits the suite into parallel jobs that each run a `package.json` script a developer can
run verbatim, so CI cannot drift from local:

| Job | Script |
|---|---|
| `lint` | `npm run lint`, build, `git diff --check` |
| `bootstrap-executor` (2 shards) | `test:bootstrap:main`, `test:bootstrap:fine-grained` |
| `suite` (6 shards) | `test:suite` |
| `lifecycle-v2` (3 shards) | `test:lifecycle:uninstall`, `:core`, `:rest` |
| `update-recovery` (2 shards) | `test:update-recovery:deaths`, `:rest` |
| `e2e` | `test:e2e` |
| `vendor-ingest` | `test:vendor-ingest` |

All jobs run on `macos-15` with read-only permissions. Gate costs and measured timings are in
[architecture/foundation.md](architecture/foundation.md) §9.

## 6. Release pipeline

The procedure an operator follows is `CONTRIBUTING.md` → *Releasing*; the design is
[superpowers/specs/2026-10-07-developer-os-release-publication-design.md](superpowers/specs/2026-10-07-developer-os-release-publication-design.md)
with its recorded amendments in [superpowers/DECISIONS.md](superpowers/DECISIONS.md). In outline:

1. A release starts only from a commit whose full `check.yml` run passed; the version and notes come
   from `CHANGELOG.md`.
2. **Preflight** checks the version is stable semver and runs a pinned `gitleaks` scan over the full
   history.
3. **Build** packs both kegs with `npm run pack:release`, using the Node 24 runtimes pinned by SHA-256
   in `.github/release/pins.json`, packs twice and compares the bytes (the build is reproducible),
   then verifies each tarball by keg admission and by a negative byte-flip check.
4. **SBOM** is generated with the pinned `@cyclonedx/cdxgen`.
5. **Publish** re-verifies the assets with the runner's own tools and creates the GitHub Release with
   the two tarballs `developer-os-X.Y.Z-darwin-<arm64|x64>.tar.gz`, `SHA256SUMS` and the SBOM.
6. **Tap** rewrites only the version, URLs and SHA-256 sums of `Formula/developer-os.rb` and opens a
   pull request in `msolecki/homebrew-developer-os`. Merging it is what makes `brew upgrade` see the
   release.

Rules: never use Homebrew's `revision` (the launcher admits only `Cellar/developer-os/<X.Y.Z>`);
minor and patch stay below 1000; a release is withdrawn by deleting it or closing the tap pull
request, and a merged formula is rolled back by reverting the tap commit.

## 7. Repository rules

Enforced by `npm run lint` (`tests/repository/check.ts`) or by tests in `tests/repository/`:

| Rule | Enforced by |
|---|---|
| No reference to the founder's legacy runtime outside the files that describe the boundary | `tests/repository/self-containment.ts` — `FORBIDDEN`, `ALLOWLIST` |
| No filesystem identity rendered through a JavaScript number (`String(x.ino)`); stats use `{ bigint: true }` | `tests/repository/check.ts` — `IDENTITY_RENDERING` |
| No product module reaches the network, and every planner entrypoint stays network-free | `tests/repository/check.ts` — `inspectReleaseAuthoritySurfaces`, `PLANNER_ENTRYPOINTS` |
| Process spawns, Git supervisors, `launchctl` and scheduled handlers only at allowlisted sites | `tests/repository/opt-in-authority.ts` |
| Public docs exist, contain no macOS user-home path, run only commands the CLI parses, and resolve every relative link | `tests/repository/public-docs.test.ts` |
| Instruction defaults and project templates carry no secret | `tests/repository/instruction-defaults.test.ts`, `tests/tools/scan-instruction-defaults.ts` |
| Generated plugin trees equal a fresh render | the adapter contract tests in `tests/contracts/adapters/` |

Rules that are process, not code:

- Stage exact paths. Never `git add -A`, `git add .` or a wildcard.
- Fixtures are synthetic. Never commit a real vault, a credential, a client name or a
  machine-specific absolute path.
- The repository has no `.claude/` directory; see
  [migration/exclusion-policy.md](migration/exclusion-policy.md).
- Every filesystem mutation in product code follows `plan → backup → stage → validate → apply →
  verify → finalize`.
- Every enumerating gate asserts a non-empty set per scope.
- Redact before truncating, hashing, logging, persisting, publishing or sending to a model.
- A reviewer never reviews code they wrote.

## 8. Changing a subsystem

1. Read the owning architecture note ([map](README.md#canonical-architecture-notes)).
2. A new subsystem or a contract change gets an approved spec and a plan under
   `docs/superpowers/specs/` and `docs/superpowers/plans/`, registered in
   [superpowers/BACKLOG.md](superpowers/BACKLOG.md) in the same change.
3. Write the failing test first, then the smallest change.
4. Update the architecture note and any guide or reference stating the changed fact in the same
   commit.
5. When a plan closes, move its surviving contract into the architecture note and delete the plan.

Specific procedures:

- **Change a workflow:** edit `workflows/<id>/workflow.yaml`, bump its `version`, run
  `npm run render:claude` and `npm run render:codex`, and commit the regenerated trees.
- **Change an instruction default:** edit `instructions/` and `instructions/catalog.json`, re-render,
  and run the instruction scanner with a private pattern file kept outside the repository
  (`node tests/dist/tools/scan-instruction-defaults.js --patterns <file>`); record its zero finding
  count.
- **Try a local build end to end:** `npm run pack:local-release -- <dir>`, then run that bundle's CLI
  with `init --local-release <dir>` against a disposable `HOME`.

## 9. Process records

Build sessions follow [superpowers/SESSION.md](superpowers/SESSION.md): orient, read the `NOW` entry of
[superpowers/ORDER.md](superpowers/ORDER.md), execute one entry, close the loop with evidence.
Open work is in [superpowers/BACKLOG.md](superpowers/BACKLOG.md); founder decisions are in
[superpowers/DECISIONS.md](superpowers/DECISIONS.md). Identifiers are explained in the
[glossary](glossary.md).
