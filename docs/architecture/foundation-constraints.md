# Foundation implementation constraints

Verbatim completion notes from Foundation Tasks 5 through 8, carried here unchanged when
`plans/2026-07-21-developer-os-foundation.md` was deleted at the close of Task 9, as the
session protocol requires. They are reproduced rather than summarised on purpose: each one was
written by the task that shipped the code and reviewed by someone who did not, and every bullet
exists because collapsing it broke something.

`docs/architecture/foundation.md` is the curated account of the same system and is where to
start. This file is the record — read it before changing any of the behaviour it describes, and
before assuming a piece of apparent redundancy is safe to remove.

Two items here are **open founder questions**, not settled decisions, both from Task 5:
whether `SpawnLockfRunner`'s non-blocking `lockf -t 0` call needs a watchdog, and whether
`<state>/transactions/` accumulating one permanent `0600` lock file per transaction id wants
collection. `docs/superpowers/BACKLOG.md` §1 routes readers here for them.

---

## Task 5: Implement recoverable filesystem transactions

> **Completed 2026-07-27.** Task 5 shipped with the kernel exclusion protocol
> designed in
> `docs/superpowers/specs/2026-07-22-developer-os-kernel-transaction-lock-design.md`,
> which remains the reference for review and drift checks. The implementation
> plan that carried it was deleted when its last step closed; recover it from
> git history if the reasoning is ever needed. No lease, heartbeat, stale-owner,
> quarantine, or lock-file deletion behavior exists anywhere in the result.
>
> **What Task 7 inherits, and must not undo:**
>
> - `packages/core` owns a mandatory, platform-neutral `TransactionLockProvider`
>   port; `packages/platform-macos` implements it over `/usr/bin/lockf` in
>   descriptor mode. Core contains no macOS conditional and never spawns.
> - `TransactionLockContext` carries a mutable `active` flag, cleared before
>   release. Reentrancy requires it, so an async descendant that outlives the
>   outer scope re-acquires instead of proceeding on a released handle.
> - The macOS provider is deliberately stricter than the design listing: it pins
>   the parent directory's `dev`/`ino` and re-asserts both parent and lock-file
>   identity *after* `lockf` returns, and it validates the descriptor's type and
>   owner *before* `chmod(0o600)`. Four adversarial tests pin this. Do not
>   simplify them away when adding platform facts.
> - The stable lock file is never unlinked. `<state>/transactions/` therefore
>   accumulates one permanent `0600` lock file per transaction id, and a core
>   test asserts that file's presence — wiring the real provider must not break
>   it. Whether that accumulation wants collection is an open founder question.
> - `SpawnLockfRunner` calls non-blocking `lockf -t 0` with no watchdog. Whether
>   it needs one is the second open founder question.
>
> **Environment note.** The offline `pnpm` store cannot materialize a full
> install in this checkout, so `pnpm install --frozen-lockfile --offline` fails
> on unrelated pre-existing tarballs after its lockfile check passes. The
> equivalent persistence check is
> `pnpm install --lockfile-only --frozen-lockfile --offline --ignore-scripts --trust-lockfile`.
> `packages/platform-macos` also needed its `node_modules/@developer-os/core`
> workspace symlink created by hand, mirroring `packages/security`; any working
> `pnpm install` creates it from the `link:../core` entry already in the
> lockfile. `packages/platform-macos/tsconfig.json` must stay free of a `paths`
> alias, like every sibling package.

## Task 6: Track owned artifacts and configuration drift

> **Derived contract (2026-07-27).** This task fixes `ManagedArtifactV1` and
> `InstallationManifestV1` exactly, and those ship field-for-field as written.
> It names `ChangePlanV1`, `DriftFinding`, `ManifestStore`, and
> `validateChangePlan` without defining them; those were derived from design
> spec §9.2–9.4 and reviewed. What a later task must not silently change:
>
> - **Ownership comes from the target's location, never from the manifest.**
>   `validateChangePlan` checks the target against `ownedRoots`/`excludedRoots`
>   first; a manifest entry naming an out-of-root path grants nothing. Roots are
>   matched **exactly** to grant and **case-folded, NFC-normalized** to deny,
>   because macOS volumes are case-insensitive by default and an exclusion
>   compared exactly would miss `<home>/BACKUPS`. Manifest lookup and duplicate
>   detection fold **canonicalized** paths; `validateManifest`'s own uniqueness
>   check folds **declared** paths, because it has no canonicalizer. Together
>   they stop `Settings.json` being created over a managed `settings.json`.
>   The roots are re-checked **after** canonicalization against the declared
>   ones, and the test is whether canonicalization *grew* authority — a canonical
>   root that contains its own declared root resolved to an ancestor. A
>   user-writable `~/.claude` symlinked to `/` or to `$HOME` would otherwise
>   widen ownership while every declared-root check still passed. Enumerating
>   forbidden roots instead would not work, because `$HOME`, `~/.ssh`, and `/etc`
>   would each need naming; a sideways relocation such as
>   `~/.claude -> ~/Dropbox/claude` stays allowed.
>
>   **Known residual.** The rule is anchored on each root's own declared path, so
>   it stops *widening* but not *relocation*: `~/.claude -> ~/Documents` is
>   neither an ancestor nor nested nor excluded, and is accepted, granting the
>   plan ownership of that tree. Credential directories are caught one layer
>   down by `ProtectedPathPolicy`; an ordinary directory is not. Closing this
>   needs an anchor on `ChangePlanContext` — the composition root knows the user
>   home — and is Task 8's call, not a silent gap.
> - **`validateChangePlan` is async and canonicalizes through an injected
>   `ChangePlanContext.canonicalize`** before any containment test. Lexical
>   matching alone is not enough: a symlink planted inside an owned root
>   otherwise resolves into the Brain while still matching the owned root as a
>   string, and nothing downstream catches it — `ProtectedPathPolicy` knows
>   about `.ssh`/`.aws`/`.gnupg`/`.env`, not about the Brain or `<state>/backups`.
>   The composition root supplies `canonicalizePlannedPath`, which resolves the
>   longest existing ancestor and tolerates a target that does not exist yet.
> - `replace` and `remove` additionally require the operation's `owner`, `kind`,
>   and `mergeStrategy` to equal the recorded artifact's, and its
>   `expectedBeforeHash` to equal the recorded `installedHash`.
> - A context with no `excludedRoots`, or with `/` as an owned root, is refused.
> - **Core reads user files through an injected `ManifestGuards.assertReadable`**,
>   because `packages/core` must not import `packages/security`. Drift inspection
>   and conflict evidence render file content into diagnostics, so every read
>   passes the guard, uses `O_RDONLY | O_NOFOLLOW` with a `dev`/`ino` re-check
>   after open, and is size capped.
>
>   **Task 8 must supply exactly this and no other shape.** `assertReadable`
>   returns `join(realpath(dirname(path)), basename(path))` — ancestors
>   canonicalized, final component verbatim — and unlike
>   `TransactionGuards.assertTarget` it returns a path rather than `void`.
>   `ProtectedPathPolicy.assertReadable` and the `SecurityPolicy` interface in
>   Task 4 still return `Promise<void>`, so wiring this is a compile error until
>   they change. **`canonicalizePlannedPath` is the wrong function here**: it
>   realpaths the whole path when the target exists and only walks up on
>   `ENOENT`, so it resolves the final component. It is the right function for
>   `ChangePlanContext.canonicalize`, which wants full resolution, and the wrong
>   one for `assertReadable`, which must not. Do not fix that error with
>   `async p => { await policy.assertReadable(p); return p; }` — that returns the
>   unvalidated path and reopens the intermediate-symlink hole. Do not use a full
>   `realpath` either: resolving the final component makes core's `lstat` check
>   dead, so a managed file swapped for a symlink is read through it and a
>   managed `kind: "symlink"` artifact reports `type_changed` forever.
> - `ManifestStore.read()` throws `ManifestMissingError` (code 2) when no
>   manifest exists and `ManifestStateError` (code 6) only when one exists and is
>   corrupt. `readOptional()` returns null for the absent case. A machine that
>   never ran `init` must not be told to run transaction recovery.
>
> **Deferred, failing closed.** `validateManifest` currently **refuses**
> `kind: "config-entry"`. Verifying one needs the semantic merge that arrives
> with the Claude and Codex adapters, and accepting it would let `doctor` report
> a clean tree it never actually checked. The kind stays in `ManagedArtifactV1`;
> lift the refusal in DOS-P4/DOS-P5 together with real semantic-merge drift
> detection, and add the three-way diff design §9.3 requires — Foundation ships
> the two-way form (current vs proposed) named in Step 4.

## Task 7: Add the macOS platform boundary

> **Completed 2026-07-29.** `packages/platform-macos` was extended, not
> re-scaffolded: `transaction-lock.ts` and its tests are untouched, `index.ts`
> gained additive exports only, and `tsconfig.json` still carries no `paths`
> alias. The root `tsconfig.json` and `vitest.config.ts` already listed this
> package, so Task 7's "keep the existing entries without duplicating them"
> required no edit to either file.
>
> **What Task 8 inherits, and must not undo:**
>
> - **`AgentDiscovery.version` is always `null` in Foundation, by design.**
>   Filling it means executing a `PATH`-resolved binary, which this boundary
>   never does, and design spec §6.6 assigns version detection to the agent
>   adapters. DOS-P4/DOS-P5 populate it. Task 8 is the *no-agent* lifecycle and
>   has no consumer for it.
> - **`discoverExecutable` distinguishes absence from malfunction.** A non-zero
>   `which` exit, or a zero exit with empty output, is `installed: false` —
>   reported data, because printing nothing is consistent with absence. A zero
>   exit with output that `which` could never legitimately produce — any
>   `\p{Cc}` control character, non-absolute, or bearing a `[REDACTED:` marker —
>   throws `MacOsPlatformDiscoveryError` (code 1). This is not defensive
>   padding: `ProcessRunner` redacts its own stdout, and a real path such as
>   `<home>/.cache/<40-char-segment>/bin/claude` comes back as
>   `<home>/.[REDACTED:high-entropy]` — still absolute, still single-line. The
>   first implementation reported that as `installed: true` with a path that
>   never existed on disk. A test drives the real `redactText` over that input,
>   so it fails loudly if redaction is ever retuned. The control-character class
>   is `\p{Cc}` rather than `[\0\n\r]` because the directory component comes
>   from the caller's `PATH`, and Task 8 renders this value to a terminal and
>   writes it into the manifest; an embedded ESC is terminal-escape injection
>   into both. `MacOsPlatformDiscoveryError`'s message deliberately does not
>   interpolate the candidate — that would leak the `PATH`-derived string the
>   check just refused.
> - **`cwd: "/"` on the discovery request is load-bearing; do not change it to
>   `process.cwd()`.** Apple's `which` maps an empty `PATH` element to `.`, so a
>   trailing colon in `PATH` — common — makes it probe `./claude` and print a
>   relative result on success. Anchoring at `/`, where no agent binary lives,
>   is what keeps that from becoming a false positive before the non-absolute
>   check ever sees it.
> - **Malformed input is code 2 on every method.** `assertHomeShape` runs inside
>   `inspect()` *before* the injected canonicalizer, so a relative, upward-
>   traversing, NUL-bearing, or `/` home is `invalidInput` rather than
>   `securityRefusal`. Code 5 stays reserved for a genuine canonicalizer
>   refusal. Do not let a later composition root reintroduce the split by
>   canonicalizing first.
> - **Two gates, deliberately different widths. The test is whether the method
>   touches the host, not whether it reads architecture.** `inspect` and
>   `discoverExecutable` read host state and spawn a process, so both take
>   `#assertSupportedPlatform` (platform, architecture, release).
>   `productStateRoot`/`proposedBrainRoot` are pure string functions of their
>   argument, so they take `#assertDarwin` (platform identity only) — the only
>   question they owe is whether this is the right adapter. Do not "fix" the
>   asymmetry by dropping `discoverExecutable` to the narrow gate. The visible
>   consequence is that on a Darwin/`ia32` host `productStateRoot` answers while
>   `inspect` throws code 4; that is right for `doctor`, and unreachable for
>   `init`, which must call `inspect` first to obtain `userHome`.
> - `productStateRoot`/`proposedBrainRoot` agree with `resolveRuntimePaths` in
>   `packages/core/src/config/paths.ts`, and a test pins that agreement. The
>   literals are duplicated across two packages; the test is the drift guard.
> - Only `PATH` is forwarded to the discovery subprocess, and an empty `PATH`
>   falls back to `/usr/bin:/bin:/usr/sbin:/sbin`. `NodeProcessRunner` replaces
>   the child environment rather than merging it, so nothing else leaks.
>
> **Open question, reinforced not resolved — and now larger than Task 5 sized
> it.** `NodeProcessRunner.finishFromClose` returns early while
> `closeInformation` is `undefined`, so the post-`SIGKILL` escalation cannot
> settle the promise: a child that survives `SIGKILL` leaves it pending
> *forever*, not merely late, and `discoverExecutable` hangs with it. The defect
> is in `packages/security/src/process.ts`, outside this task's files and
> already reviewed under Task 4, so it was deliberately not fixed here. What
> changed is the blast radius: the runner now has **two** consumers that depend
> on its timeout being terminal — the transaction lock and agent discovery.
> That is the fact that should decide the founder's answer to the watchdog
> question Task 5 opened. Unreachable in the committed tree, because nothing
> wires `MacOsPlatformAdapter` to `NodeProcessRunner` yet; Task 8 is what makes
> it reachable.
>
> **One duplication accepted knowingly.** `REDACTION_MARKER` restates a literal
> that `packages/security/src/redaction.ts` owns and does not export. The test
> that drives the real `redactText` is the drift guard. The clean version is for
> the security package to export the marker, or a `containsRedaction` predicate,
> so the platform boundary asks the redactor what its own output looks like
> instead of guessing — that is a security-package change, not a Task 7 one.
>
> **Environment note.** `packages/platform-macos/node_modules/@developer-os/security`
> was created by hand, exactly as Task 5 recorded for `core`; any working
> `pnpm install` creates it from the `link:../security` entry now in the
> lockfile.

## Task 8: Implement the no-agent CLI lifecycle

> **Completed 2026-07-31.** Five commands over the Foundation contracts, no agent
> integration, no network. Two fresh-context reviewers found two P0 defects that
> the first implementation shipped with; both are fixed and pinned by regression
> tests. What Task 9 inherits, and must not undo:
>
> - **`CliContext` carries five members beyond the eight this plan fixes** —
>   `fs`, `executor`, `guards`, `paths`, `productVersion`. The eight cannot be
>   used without them: `transactions` and `manifests` are stores, not a
>   filesystem, and nothing else can build an executor. `ids` is in the contract
>   and deliberately unused — `TransactionExecutor` generates its own identifiers,
>   and calling `ids.next()` as well would desynchronise them.
> - **`ManifestGuards.assertReadable` is supplied by the composition root, not by
>   changing `packages/security`.** Task 6 predicted a compile error here and it
>   is real; the fix is `assertReadableArtifactPath` in `apps/cli/src/context.ts`,
>   which canonicalizes the **parent** with `canonicalizePlannedPath` and appends
>   `basename` verbatim. `ProtectedPathPolicy.assertReadable` and the `Task 4`
>   `SecurityPolicy` interface are untouched and still return `Promise<void>`.
>   **The policy is asked twice — about the caller's path and about the
>   ancestor-resolved result — and both calls are load-bearing.** A leaf symlink
>   that points back out of `~/.ssh` passes the first check and is refused only by
>   the second; a test asserts the single check accepts it, so collapsing the two
>   fails loudly.
> - **A finalized transaction cannot be rolled back, so `init` undoes itself with
>   a compensating transaction.** `TransactionExecutor.execute()` runs through to
>   `finalized` before returning, and `rollback` on a finalized journal throws
>   code 6. The revert is therefore the same operation `uninstall` performs, and
>   it is the same code (`revertArtifacts`). Do not "fix" this back into
>   `executor.rollback`. Running `doctor` inside the transaction's verify phase is
>   the other tempting shape and it deadlocks: `doctor` reads journals through
>   `context.transactions`, a different `TransactionStore` instance, so the
>   reentrancy check in `withTransactionLock` misses and the lock is unavailable.
> - **The Brain skeleton is recorded in the manifest, and uninstall still cannot
>   remove it.** `init` owns what it created, so a failed install undoes the
>   `.gitkeep` and the vault directory completely. `uninstall` passes
>   `ownedRoots: [productHome]` and `excludedRoots: [brain]`, so Brain artifacts
>   are refused by location. Those are two different ownership universes over one
>   manifest, and that is the point.
> - **Ownership is decided on the declared path *and* the canonical path, for
>   every artifact kind.** Directory artifacts never reach `validateChangePlan` —
>   the executor moves files only — so they carried no canonicalization at all in
>   the first implementation. A manifest naming `<productHome>/link/x`, where
>   `link` is a symlink to the vault, drove `rmdir` into the Brain. `rmdir` being
>   non-recursive bounds *what* is deleted, never *where*. `removeDirectories`
>   now `lstat`s the canonical path and skips anything that is not a real
>   directory.
> - **Ownership is re-resolved immediately before each `rmdir`, and an absent
>   directory is never removed.** Deciding once, before the transaction, is not
>   enough: the transaction writes a journal and then fsyncs for hundreds of
>   milliseconds, which is a deterministic signal and a deterministic window for
>   an attacker to turn an ancestor into a symlink after the decision. Two rules
>   close it — a directory whose drift is `missing` is skipped (its canonical form
>   is its own declared path, so nothing resolves it into the Brain until the
>   ancestor is planted), and the canonical path is recomputed in the removal loop
>   and any disagreement preserves the artifact. What remains is the gap between
>   that call and `rmdir` itself, which needs `unlinkat` on a directory descriptor
>   to close and is recorded rather than hidden.
> - **Machine health is a precondition of `init`, not a postcondition.** With the
>   full `doctor` report as the only post-apply gate, one stale journal from an
>   earlier interrupted run made every subsequent `init` install successfully and
>   then revert itself, forever. `assertNoIncompleteTransaction` runs before any
>   mutation and returns code 6 with both repair commands.
> - **Configuration is read through the policy, and the TOML parser's message
>   never escapes.** `smol-toml` embeds three raw source lines in `TomlError`, so
>   propagating it printed the contents of whatever file was read into `status`,
>   `doctor`, and their JSON. Redaction is a heuristic — it does not catch
>   `DATABASE_URL=postgres://user:pw@host/db` — and must not be the only thing
>   standing there. Absence is detected with `lstat` first, because the guarded
>   reader reports a missing file as a security refusal.
> - **`renderPath` sanitizes every path that reaches a terminal or a JSON field.**
>   `isManagedPath` accepts any absolute NUL-free string, so an artifact path may
>   carry ANSI escapes and repaint the uninstall confirmation prompt — the only
>   consent gate on deletion. `config.brainPath` reaches the `init` prompt the
>   same way. Task 7 already refuses control characters coming out of `which`;
>   this is the same rule on the way back out. It covers `\p{Cf}` as well as
>   `\p{Cc}`, because U+202E reorders rendered text without being a control
>   character, and it is deliberately **not** applied to `--json`, where
>   `JSON.stringify` escapes those code points itself and a machine consumer needs
>   the value as recorded.
> - **Every `doctor` check has its own error boundary.** Doctor is the command run
>   on exactly the machines where reads fail, and an escaping rejection there
>   became an unhandled top-level rejection with a stack trace and no report.
>
> **Deviations from this task's staged path list**, all additive: this task also
> stages `apps/cli/vitest.config.ts` (aliases for the two new workspace
> dependencies, so tests run against source rather than `dist`),
> `apps/cli/src/context.test.ts` and `apps/cli/src/commands/testing.ts` (the guard
> wiring and the shared fixture are the highest-risk code here and were otherwise
> untested), `apps/cli/src/main.test.ts` (the usage string it pinned no longer
> exists), and `pnpm-lock.yaml` (the CLI gained two workspace dependencies; a
> lockfile disagreeing with `package.json` breaks `--frozen-lockfile`).
>
> **Environment note.** `apps/cli/node_modules/@developer-os/{security,platform-macos}`
> were created by hand, exactly as Tasks 5 and 7 recorded; any working
> `pnpm install` creates them from the `link:` entries now in the lockfile.
>
> **Named residuals, for Task 9 to close or record.** Two fresh-context reviewers
> agreed none of these blocks the commit. Numbers 1 and 2 are the ones that matter:
> each is a state a user can reach and not command their way out of, and number 1
> reports *success* while doing it.
>
> 1. **A crash between `executor.execute()` returning and the manifest write
>    leaves an installation no command repairs.** The config file exists, the
>    journal says `finalized`, no manifest exists: `init` reports "already
>    initialized", `doctor` says "run init", `uninstall` removes nothing. The
>    remedy today is deleting the product home by hand. Closing it means writing
>    the manifest inside the transaction, or teaching `buildPlan` to re-adopt
>    on-disk artifacts when no manifest exists.
> 2. **A managed artifact that is *deleted* blocks `init`.** `assertNoDrift`
>    refuses on any finding, including `missing`, while `revertArtifacts`
>    deliberately skips `missing`. `doctor`'s drift check now carries the escape
>    (`uninstall`, then initialize again) as its `recovery` string, but `init`
>    should probably re-create what is missing rather than refuse.
> 3. **A malformed journal cannot be repaired through the CLI.** `repair` reads
>    the journal before checking its phase, so both actions fail with code 6 and
>    no command quarantines the file. `doctor` points at `repair`, which cannot
>    help, and `init` refuses with the generic state-error message and no
>    recovery. It wants a `repair --discard <id>`, which is a new command surface
>    and therefore not Task 8's to add.
> 4. **A revert leaves the product directories unmanaged.** `state`, `staging`,
>    and `backups` always hold the journal and backups of the transaction being
>    reverted, so `rmdir` refuses them and the manifest is then deleted. They
>    exist with no manifest entry, and `buildPlan` records only *missing*
>    directories, so no later `init` adopts them and no later `uninstall` removes
>    them. Empty directories only — no data loss, nothing misreported — but the
>    fix is to record every product directory the plan depends on, not only the
>    ones it created.
> 5. **A `kind: "symlink"` artifact would delete its target, not the link.**
>    `validateChangePlan` canonicalizes the leaf, so the executor unlinks the
>    resolved path. Latent — Foundation emits no symlink artifacts — and it lands
>    in DOS-P4/DOS-P5, which will.
> 6. **Directory removal still has a check-to-use window.** It is now one
>    canonicalization away from the `rmdir`, rather than a whole transaction away,
>    and an absent directory is never a candidate. Closing it entirely needs
>    `unlinkat` against a directory descriptor, which Node does not expose.
> 7. **A relocated product home makes `uninstall` a no-op.** `isRemovableAt`
>    requires declared-path containment while `recordArtifacts` stores canonical
>    paths, so `~/.developer-os -> ~/Dropbox/developer-os` preserves everything and
>    still deletes the manifest. Pre-existing, fails closed, and the declared check
>    is conservatism only — the canonical check carries the security — but it
>    should be decided deliberately rather than inherited.
> 8. **`assertRootsAnchored` is inert for a root named through
>    `DEVELOPER_OS_HOME`/`DEVELOPER_OS_BRAIN`**, because such a root anchors to
>    itself. It constrains symlink relocation of the default paths and of
>    `config.brainPath`, which is what Task 6's residual asked for; it is not a
>    containment policy for the environment.
>
> **Foundation ships no `--verbose`.** Design spec §8 lists it for every mutating
> command; Step 6 of this task does not, and dispatch is strict, so `--verbose`
> is rejected with code 2. Add it with the subsystem that has diagnostics worth
> printing.

---

## Found after Foundation closed

Not part of the verbatim record above — each was discovered by a later subsystem and is
recorded here because that is where a reader looks for what Foundation cannot do.

### Residual 9: configuration cannot be changed after `init`

**Found 2026-08-07, by the fresh-context review of DOS-P2 Task 1.**

`init` records `config.toml` as a managed artifact (`apps/cli/src/commands/init.ts:226`), and
drift compares its content hash. Foundation ships **no command that edits configuration**, so
the only way to change any setting is to edit the file by hand — which is drift.

The consequence is worse than inconvenient, and it is the shape of residual 1: `doctor` reports
the drift and prints "uninstall, then initialize again" as its recovery, and `uninstall` refuses
on that same drift (`uninstall.ts:397`). `init` refuses too. The user's only exit is deleting the
product home by hand. `tests/e2e/foundation.test.ts:990` already states the mechanism in its own
comment; what it does not say is that no supported path exists to reach the state legitimately.

**This is not new with DOS-P2.** `git.enabled` and `automation.enabled` are written as fixed
defaults by `init` (`init.ts:112`) and have had the identical problem since Foundation shipped.
The `[brain]` section added by DOS-P2 is mechanically the third instance, and is unreachable
until a command writes or reads it.

**Owner: DOS-P7**, which already owns `developer-os git enable|disable` and
`automation enable|disable` — the two existing consumers. One transactional write path that
rewrites `config.toml` and re-records its manifest hash serves all three. **Recommendation on
record, not a decision**: DOS-P2 ships `[brain]` written by `init` inside the existing
transaction and not editable afterwards; DOS-P7 adds the general command. Settle it before
DOS-P7 starts, not during.
