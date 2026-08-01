# Foundation checkpoint

Evidence that the Foundation completion gate is satisfied. Every number here came from a run
recorded below, not from memory.

The gate lived in `docs/superpowers/plans/2026-07-21-developer-os-foundation.md`, which was
deleted in the same commit as this document because Task 9 was its last step — the session
protocol keeps only unfinished plans, and git history is the archive. Its per-task constraints
were carried into `docs/architecture/foundation-constraints.md` first; the gate itself is
restated in full at the end of this file.

**Date:** 2026-08-01 · **Branch:** `feat/foundation` · **Product version:** `0.0.0`

## Toolchain

| Tool | Version | How pinned |
|---|---|---|
| Node.js | `v24.16.0` | `.node-version`, `engines.node` |
| pnpm | `11.3.0` | `packageManager` |
| TypeScript | `5.9.3` | root `devDependencies` |
| Vitest | `4.1.8` | root `devDependencies` |
| ESLint | `9.39.4` | root `devDependencies` |

## Gate commands

Run from a clean tree, in this order.

```bash
npm run lint     # tsc -b --pretty false && eslint .
npm test         # vitest run  (all projects, including tests/e2e)
pnpm build       # tsc -b
pnpm test:e2e    # vitest run tests/e2e
git diff --check
```

| Command | Result |
|---|---|
| `npm run lint` | pass, no diagnostics |
| `npm test` | **19 files, 388 passed, 1 skipped** |
| `pnpm build` | pass |
| `pnpm test:e2e` | **1 file, 31 passed** |
| `git diff --check` | clean |

The one skipped test is `packages/platform-macos/src/macos.test.ts`, which carries a
`skipIf(process.platform === "darwin")` branch for non-macOS hosts. On this host the Darwin
branch ran and the non-Darwin branch skipped.

`npm test` includes the end-to-end project, so the 31 e2e cases are counted twice above —
once inside the 388, once on their own. That is deliberate: `npm run check` must not be able
to pass while the process-level evidence is failing.

**Ordering matters.** `lint` runs `tsc -b` first, so `dist/` is current by the time `test`
executes the binary. Running `vitest` alone against a stale or absent `dist/` fails loudly:
`run-cli.ts` refuses to spawn and names `pnpm build` in the error.

## What the end-to-end suite proves

31 cases. 30 of them spawn `apps/cli/dist/bin.js` as a real process with a sealed
environment (`HOME`, `DEVELOPER_OS_HOME`, `DEVELOPER_OS_BRAIN`, `PATH`, `TMPDIR` and nothing
else inherited), no shell, closed stdin, and every proxy variable pointed at `127.0.0.1:1`.

| Group | Cases | Proves |
|---|---:|---|
| Lifecycle | 1 | the full `init --dry-run → init → status → doctor → init → uninstall → uninstall → doctor` sequence, with a path-and-hash snapshot compared before and after every command |
| Refusals | 9 | nested Brain, symlinked product home, read-only target, unattended decline, strict dispatch, drift, and a forged out-of-root manifest — plus two cases that pin what the product does *not* refuse: an unusable discovered agent path still installs, and `uninstall` leaves its own transaction residue behind |
| Interruption | 18 | for each of the six non-terminal phases: reported by `doctor`, blocks `init`, resumes to `finalized`, and rolls back to `rolled_back` |
| Boundaries | 3 | no network capability in any compiled non-test module; the configuration parser never quotes what it failed to read; a secret sentinel is never echoed or persisted |

### Snapshot method

Before and after every command, the suite records every path beneath the temporary root with a
description: `dir`, `file:<sha256>`, `link:<target>`, `unreadable`, or `other`. Symlinks are
recorded, never followed. Assertions then compare that snapshot against what the command
*declared* in its `--json` result:

- `init --dry-run` must leave the snapshot **byte-identical**.
- `init --yes` must create exactly the paths it declared in `created`; any other new path must
  lie under `state/`, `staging/`, or `backups/`, which is the product's own bookkeeping.
- `status`, `doctor`, and a repeated `init` must leave the snapshot byte-identical.
- `uninstall` must remove exactly what it declared, and nothing outside the product home may
  be added, removed, or changed.

### Reference installation

A fresh `init --yes` under a temporary HOME produces 8 manifest artifacts, 13 files, and 12
directories. The 13 includes the transaction's `.<id>.lock`, which is never unlinked — one
permanent `0600` file accumulates per transaction id, and whether that wants collection is an
open founder question recorded in `docs/architecture/foundation-constraints.md`.

| Kind | `installedHash` prefix | Path, relative to HOME |
|---|---|---|
| directory | `e3b0c44298fc1c14` | `.developer-os` |
| directory | `e3b0c44298fc1c14` | `.developer-os/state` |
| directory | `e3b0c44298fc1c14` | `.developer-os/staging` |
| directory | `e3b0c44298fc1c14` | `.developer-os/backups` |
| directory | `e3b0c44298fc1c14` | `.developer-os/logs` |
| directory | `e3b0c44298fc1c14` | `DeveloperBrain` |
| file | machine-specific | `.developer-os/config.toml` |
| file | `e3b0c44298fc1c14` | `DeveloperBrain/.gitkeep` |

`e3b0c44298fc1c14…` is the SHA-256 of the empty byte string. For directories it is a constant
placeholder — drift compares a directory's *kind*, never its contents — and for `.gitkeep` it
is the real hash of a genuinely empty file. `config.toml` embeds the resolved Brain path, so
its hash is machine-specific by construction and is deliberately not pinned here.

### Interruption matrix

For each phase, the fixture runs a real install to completion so that every journal, staged
blob, backup, and digest is written by the product itself, then rewinds the recorded phase —
and `updatedAt` with it — and undoes the side effects of the later phases: the manifest is
removed for every phase (it is written only after the transaction finalizes), targets are
removed for `planned` through `validated` (`apply` is what creates them), and backups are
removed for `planned` (`backUp` is what writes them).

These are phase *boundaries*, not arbitrary crash points. A real crash can also land mid-phase
— half the mutations applied, a `.tmp` left beside a target, a backup blob without its metadata
pair — and that is covered by the unit suite in
`packages/core/src/transactions/transactions.test.ts`, not here. `repair --resume` is
additionally asserted to restore each target to the *hash* the original install produced, not
merely to recreate a file at that path; `repair --rollback` is asserted to leave no file
outside the product's own bookkeeping, and to leave the machine installable again.

| Phase | `doctor` | `init` | `repair --resume` | `repair --rollback` |
|---|---|---|---|---|
| `planned` | 6 | 6 | `finalized` | `rolled_back` |
| `backed_up` | 6 | 6 | `finalized` | `rolled_back` |
| `staged` | 6 | 6 | `finalized` | `rolled_back` |
| `validated` | 6 | 6 | `finalized` | `rolled_back` |
| `applied` | 6 | 6 | `finalized` | `rolled_back` |
| `verified` | 6 | 6 | `finalized` | `rolled_back` |

In every row `doctor` names both ways out verbatim —
`developer-os repair --resume <id> | developer-os repair --rollback <id>` — and `init` refuses
with the same recovery text before mutating anything.

### Secret sentinel

`DEVELOPER_OS_SECRET_SENTINEL_7f4c` is planted in three places: a Brain note, a deliberately
malformed `config.toml` (so the TOML parser's own message would carry the surrounding source
lines), and the child process's environment.

Two cases cover it, because the obvious one is shallower than it looks. On an *installed*
machine a hand-edited `config.toml` is a drifted managed artifact, so `init` and `uninstall`
refuse on drift long before anything parses TOML. The first case therefore plants the malformed
file on a machine that was never initialised, where nothing can refuse ahead of the parser, and
runs `status` and `doctor` both with and without `--json`. The second runs seven invocations on
an installed machine — `status` and `doctor` both ways, `init`, `uninstall`, and `repair` as
`--json`.

The sentinel appears in no stdout and no stderr. Each invocation is additionally asserted not
to have timed out and to have produced some output, so a killed child cannot satisfy the
absence checks by printing nothing. A scan of every regular file beneath the temporary root
finds the sentinel in exactly the files the tests planted and nowhere the product wrote.

The scan decodes as `latin1`, which maps every byte to a character without loss, so the marker
would still be found inside output that is not valid UTF-8.

### Network

Two independent arguments:

- **Static.** Every compiled non-test module in the four packages is scanned for `node:http`,
  `node:https`, `node:net`, `node:tls`, `node:dgram`, `node:dns`, `node:http2`, `fetch(`,
  `XMLHttpRequest`, and `WebSocket`. Zero matches across **37** modules — `apps/cli` 10,
  `core` 18, `security` 5, `platform-macos` 4. The scan asserts a non-zero file count per
  package and a total above 20, so an unbuilt tree fails rather than passing vacuously.
- **Behavioural.** Every case that spawns the CLI — 30 of the 31; the static scan spawns
  nothing — runs with `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, their lowercase forms, and
  `NODE_USE_ENV_PROXY=1` pointed at a closed port. Any outbound request would fail the
  command.

## Negative control

The suite was verified to fail when the thing it tests is absent. With `apps/cli/dist` moved
aside, **all 31 cases fail** — 30 on `bin.js does not exist`, and the network scan on its
file-count assertion. No case passes without the compiled artifact.

## Deviations from the plan

Recorded rather than silently absorbed.

1. **`pnpm vitest run …` (plan Steps 2 and 6) does not work in this workspace.** Observed:
   `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL … Command "vitest" not found`. No workspace manifest
   declares `vitest` — it is a root devDependency only — which is consistent with the failure,
   though the exact resolution path was not investigated further. The working forms are
   `npm test`, `pnpm test:e2e`, and `node_modules/.bin/vitest`.
2. **The end-to-end sandbox lives under `/tmp`, not `os.tmpdir()`.** On macOS the per-user
   temporary directory is `/var/folders/<2>/<30 random chars>/T/`, and an executable path
   beneath it is long and mixed enough that the product's redactor rewrites it — at which point
   agent discovery correctly refuses a path it can no longer vouch for and reports nothing
   found. Since the fix below that is a warning rather than a failure, so it no longer breaks
   the product — but it still breaks these tests, which plant a fake `claude` and assert it is
   discovered. `createTempHome` asserts its own executable path survives `redactText` and fails
   with an explanatory message if a future change breaks that.
3. **`uninstall` leaves the product home and three non-empty directories behind.** The plan's
   Step 1 wording is "product artifacts removed, Brain retained". What actually happens is that
   every *removable* manifest artifact is removed, and `state/`, `staging/`, `backups/` and the
   product home itself survive — still holding both transactions' journals, the never-unlinked
   lock files, the staged blobs, and the backups, **including a readable byte copy of the
   `config.toml` just removed, which names the user's Brain path**. `rmdir` refuses a non-empty
   directory, which is the safety property working as designed; the residue is the cost. This
   is Foundation Task 8's residual 4, restated accurately after a reviewer showed the original
   "three empty directories" description was wrong, and the suite now pins the real behaviour.
4. **`tests/node_modules/@developer-os/*` were created by hand**, exactly as Tasks 5, 7, and 8
   recorded for the other packages. Any working `pnpm install` recreates them from the `link:`
   entries now in `pnpm-lock.yaml`. Like every sibling package, `tests` declares neither
   `vitest` nor `@types/node` and resolves both by walking up to the root — consistent with the
   rest of the workspace, and the same fragility that produced deviation 6.

5. **`docs/architecture/foundation-constraints.md` was added beyond this task's declared file
   list.** The session protocol deletes a plan when its last step closes, and Task 9 is the
   foundation plan's last task — but that plan carried 352 lines of reviewed "what the next task
   must not undo" notes from Tasks 5 through 8, including two questions explicitly left open for
   the founder that `BACKLOG.md` §1 routes readers to. They are reproduced there verbatim rather
   than summarised, and `BACKLOG.md` §1 now points at the new location.

6. **The repository's `node_modules/vitest` symlink was dangling** at the start of this task —
   it pointed into a sibling project that had since been reinstalled, so `npm test` could not
   run at all for the whole repository. It was relinked to a 4.1.8 installation, matching the
   locked version and the mechanism already used for `eslint`, `typescript`, and `zod`. This is
   local environment repair, not a dependency change; nothing tracked was modified. It will
   break again the next time that sibling project is reinstalled, and the durable fix is a real
   `pnpm install`, which needs network access and the founder's approval.

## Fresh-context review

Three reviewers were dispatched, none of which wrote the code, each given the constraints, the
exact file list, and instructions to review only. The first stalled without reporting and was
discarded; the remaining two split the work.

**Reviewer A — end-to-end suite correctness and sandbox safety.** No P0. Seven P1 findings,
all accepted and fixed:

| Finding | Fix |
|---|---|
| `failedChecks` recovered check ids by splitting on `"; "` and cutting at the first `":"`; a redacted filesystem error containing either separator could invent or hide an id, silently satisfying a `not.toContain` | matches each *known* check id against an anchored pattern instead |
| the sentinel loop asserted only absences, so a SIGKILLed child with empty streams passed | asserts `timedOut === false` and non-empty output first |
| the nested-Brain case ran `--dry-run`, so its no-mutation assertion was satisfied by the flag | switched to `--yes`; the refusal happens before any mutation, so the assertion now carries weight |
| `repair --resume` asserted target *presence*, which the fixture already guaranteed for `applied`/`verified` | compares against the hashes the original install produced |
| the post-`init` half of the residual-1 claim re-read a `doctor` result taken before the `init` | re-runs `doctor` after it |
| `expect(error.kind).not.toBe("")` was a tautology — `kindOf` cannot produce `""` | asserts the actual kind |
| "every phase a crash can leave behind" over-promised: mid-phase crashes are not reachable through the fixture | narrowed to phase *boundaries*, with a pointer to the unit suite that covers the rest |

Five P2 findings also accepted: containment checks on the three `rm` calls in `interruptAt`,
`HOME`/`PATH`/`TMPDIR` made non-removable from the sandbox environment, process-*group* kill on
timeout so a surviving `lockf` cannot hold a lock on a directory about to be removed, the
read-only case's snapshot taken after the `chmod`, and `updatedAt` rewound with the phase. One
P2 was accepted as a documented limitation rather than fixed: `assertBinaryBuilt` checks that
`dist/bin.js` exists but not that it is current, so `pnpm test:e2e` run alone against a stale
build reports green. The documented gate order runs `lint` — which is `tsc -b` — first.

Reviewer A independently confirmed the interruption fixture is faithful, walking the
phase→side-effect mapping against `executor.ts` line by line, and found no reachable input that
lets `removeTempHome` delete outside its sandbox or lets a child resolve the developer's real
home.

**Reviewer C — the post-review fix.** The `warn` change was itself reviewed by a third
reviewer that did not write it. No P0. One P1: the sandbox comment in `tests/helpers/temp-home.ts`
still described the pre-fix symptom, which would have sent the next person debugging a deep
sandbox after a message that can no longer appear — and, worse, invited them to delete a guard
that is still load-bearing. Fixed. Five P2s accepted and fixed: the demotion now applies only to
`MacOsPlatformDiscoveryError`, so an unsupported platform, invalid input, or a security refusal
from the process runner still fails; `init` now carries non-blocking findings out through
`CliResult.warnings` instead of discarding them; the `warn` helper's doc comment named the wrong
mechanism (`status`, not `code`, is what keeps it harmless); one new test asserted only statuses
and never touched the exit-code composition it was named for; and the residual cross-references
were renumbered. The reviewer also confirmed by probing the real `redactText` over 3000 synthetic
sandbox roots that the end-to-end case's deep path triggers the redactor in 3000 of 3000 — it is
not a borderline fixture.

Its most valuable finding was structural and is also fixed: demoting one check is a point fix for
a general defect, because `runInit` gated on the *whole* doctor report, so any check failing for a
reason the install did not cause reverted a good install. That had already happened once before,
with a stale journal. The gate is now scoped to the five checks `init` is answerable for —
`product-home`, `configuration`, `manifest`, `drift`, `brain` — with `platform` and `transactions`
excluded as preconditions already checked before any mutation, and `agents` excluded as something
Foundation does not depend on. Two further regressions pin both halves.

One P2 was accepted as a limitation rather than fixed: a warning is invisible on a *failing*
`doctor` run, because `CliResult`'s failure branch carries no data and therefore no checks. Fixing
that means changing a frozen interface, which is not this task's to do.

**Reviewer B — documentation accuracy against source.** Two P0 findings, both accepted, both
errors in this checkpoint and in `docs/architecture/foundation.md`:

1. **`uninstall` does not leave "three empty directories".** It leaves the product home plus
   three directories holding journals, lock files, staged blobs, and backups — including a
   readable copy of the removed `config.toml`. Verified by a live run. Both documents were
   corrected and a new end-to-end case now pins it.
2. **"No command writes file content directly" was false.** `ManifestStore.write` creates and
   replaces the installation manifest outside any transaction — which is exactly why residual 1
   exists. The "exactly three direct filesystem touches" claim was wrong; there are four.

Nine P1 and nine P2 accuracy findings were accepted and corrected: the journal records a phase
*after* its work rather than before; `backed_up` copies content only where the target already
existed; the protected-path policy matches `.env` and `.env.*` but not `.envrc`; the compiled
module count is 37, not "40+"; 30 of 31 cases spawn the CLI, not all of them; the
incomplete-transaction check moved to a precondition but the post-apply `doctor` gate remains;
`containsPath` lives in `core`, not `security/paths.ts`; the rollback arrow reaches
`rolled_back` from four phases, not one; and the evidence suite pins ten types by import, not
the whole frozen-interface table. Reviewer B also verified as correct — and these were not
changed — the exit-code table and `doctor` severity order, the ownership roots, all six §5
invariants, every row of the frozen-interface table, every residual it checked, the reference
installation, and the whole workspace wiring.

**Verdict: no unresolved P0 or P1.** Every accepted finding across the three reviewers is fixed
and re-verified. Two items are knowingly unfixed and recorded rather than silently carried: the
`dist` staleness check, and warnings being invisible on a failing `doctor` run.

**After the review, the agent-discovery defect was fixed rather than carried.** It was a real
defect in Task 8's committed code — a refusal that made the product impossible to install for
anyone whose agent sat at a long, high-entropy path — and the founder asked for it to be
corrected. `doctor` now grades a `MacOsPlatformDiscoveryError` as `warn` instead of `fail`,
which is what `status` had always done, and `init`'s post-install gate is scoped to the checks
init is answerable for. Regressions in `apps/cli/src/commands/doctor.test.ts` and
`apps/cli/src/commands/init.test.ts`, plus the rewritten end-to-end case, pin both the demotion
and the scoped gate.

## Gate

| Requirement | Status |
|---|---|
| `npm run lint && npm test`, `pnpm build`, `pnpm test:e2e` pass freshly | yes |
| the temporary-HOME lifecycle is idempotent | yes — second `init` declares nothing, second `uninstall` removes nothing, snapshots identical |
| interruption recovery and rollback pass at every phase | yes — 6 phases × 3 cases |
| overlap, symlink escape, drift, forged manifest, secret sentinel fail closed | yes |
| no real agent config, Brain, credential, scheduler, Git remote, or network is touched | yes — sealed environment, static scan, dead proxies |
| fresh-context review has no unresolved P0/P1 finding | yes — two reviewers, two P0 and sixteen P1 accepted and fixed |
| the target working tree is clean | yes, as of the commit this document ships in — `git status --porcelain` empty and `git diff --check` clean |
| Program Task 2 can consume the frozen interfaces | yes — listed in `docs/architecture/foundation.md` §2 and imported by name from the e2e suite |
