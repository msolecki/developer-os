# Foundation architecture

What the Foundation layer is, what it guarantees, and — at least as importantly — what it
deliberately cannot do. Written at the close of Foundation Task 9; the evidence behind every
claim here is in `docs/releases/foundation-checkpoint.md`.

Foundation is the part of Developer OS that installs and removes *itself*. It integrates no
agent, writes no Brain note, and touches no network. Everything a user would recognise as the
product is built on top of it, by the subsystems listed in `docs/superpowers/BACKLOG.md` §3.

---

## 1. Boundaries

Foundation is four packages and one test package. The workspace (`pnpm-workspace.yaml`) holds ten;
the other five belong to the subsystems built on top of Foundation — `@developer-os/brain`
(`brain.md`), `@developer-os/workflow-schema` (`workflow-schema.md`), `@developer-os/adapter-claude`
(`claude-adapter.md`), `@developer-os/adapter-codex` (`codex-adapter.md`), and the installed launcher
`@developer-os/launcher` (`apps/launcher`, release-update design). `brain` and `workflow-schema`
depend on `core` and `security`; both adapters add `workflow-schema`; the launcher adds
`platform-macos`; none of them depends on `cli`. The dependency direction is strictly downward;
nothing below the CLI knows a command exists.

| Package | Owns | May depend on |
|---|---|---|
| `@developer-os/core` | result and exit contracts, configuration, runtime paths, change plans, transactions, manifest and drift | nothing in this repository |
| `@developer-os/security` | canonical paths and containment, the protected-path policy, redaction, shell-free process execution | `core` |
| `@developer-os/platform-macos` | macOS facts, agent discovery, the transaction lock | `core`, `security` |
| `@developer-os/cli` | argv, output, exit status, the command modules, and the composition root | every package except `launcher` and `tests` |
| `@developer-os/tests` | process-level evidence against the compiled binary | every package except `brain` and `launcher`; it imports `cli`'s compiled `dist/` modules at runtime, not only its types |

Within those packages, one responsibility per path:

| Path | Responsibility |
|---|---|
| `apps/cli/src/bin.ts` | process boundary: argv, output, and exit code |
| `apps/cli/src/main.ts` | pure command dispatch returning `CliResult` |
| `apps/cli/src/io.ts` | injectable user interaction |
| `apps/cli/src/context.ts` | the composition root and the guards it supplies |
| `apps/cli/src/commands/` | one module or directory per top-level command (`automation/`, `git/` and `update/` are directories; `brain.ts` dispatches `reindex.ts` and `refactor.ts`; `project` has no module of its own, and `main.ts` routes `project init` to `project-init.ts` and `project check` to `project-check.ts`), plus shared support modules that are not commands: `brain-dependencies.ts`, `brain-template.ts`, `claude-capabilities.ts`, `codex-capabilities.ts`, `output-schemas.ts`, `project-template.ts`, `quarantine.ts`, `testing.ts`, `untrusted-file.ts` and `vendor-config.ts` |
| `packages/core/src/result.ts` | stable exit and error contracts |
| `packages/core/src/config/` | runtime paths and TOML configuration |
| `packages/core/src/plans/` | exact change-plan model |
| `packages/core/src/transactions/` | journal, backup, apply, recovery |
| `packages/core/src/manifest/` | managed ownership and drift |
| `packages/security/src/paths.ts` | canonicalization, disjointness, owned-path resolution (`containsPath` itself lives in `core/manifest/store.ts`) |
| `packages/security/src/protected-paths.ts` | default deny policy |
| `packages/security/src/redaction.ts` | redact-before-log primitives |
| `packages/security/src/screen.ts` | the one display screen and grapheme cap, shared by `brain` and `workflow-schema` (moved here in DOS-P3 Task 1) |
| `packages/security/src/process.ts` | shell-free process runner |
| `packages/platform-macos/src/` | macOS facts and executable discovery |
| `tests/helpers/` | temporary HOME, hash inventory, process runner |
| `tests/repository/` | the self-containment rule, its allowlist, and the git-driven enumerator `npm run lint` runs over tracked and untracked files alike |
| `tests/e2e/foundation.test.ts` | the temporary-HOME lifecycle |

Two boundaries carry more weight than the rest:

- **`bin.ts` is the only place production dependencies are constructed.** Every command
  receives a `CliContext`; no command reaches for a filesystem, a clock, or an identifier
  generator of its own. That is what lets the unit suites run without a real home, and what
  lets `tests/` run against a temporary one.
- **Every file the product *manages* is written transactionally — and the manifest is not one
  of them.** Creating, replacing, or removing a managed artifact is always a validated change
  plan handed to the executor, so it is journalled, backed up, and recoverable. Four direct
  filesystem writes sit outside that, and it is worth knowing all four:

  | Site | Operation | Why it is outside a transaction |
  |---|---|---|
  | `init.ts` | `mkdir` + `chmod 0o700` | the executor moves files, never directories. The `chmod` loop covers the *product* directories only; the Brain is created and left alone. `mkdir`'s mode applies only to directories it actually created, so a pre-existing world-writable one would otherwise keep its mode |
  | `uninstall.ts` | `rmdir` | never a recursive delete, so a directory still holding backups, logs, or anything a user put there refuses to go and is reported as preserved |
  | `uninstall.ts` | `unlink` of the manifest | product bookkeeping, deliberately not one of its own managed artifacts |
  | `init.ts` → `ManifestStore.write` | `open("wx")` → `write` → `rename` | **the manifest writes its own content outside any transaction.** Durable, but not journalled and not recoverable — which is precisely why residual 1 exists |

## 2. Frozen interfaces

These are what Program Task 2 (`DOS-P2`, the Brain engine) consumes. Changing any of them
after this point is a breaking change to a downstream subsystem that has not been written yet,
which is exactly when it is cheapest to get right and easiest to get wrong.

| Interface | Where | Purpose |
|---|---|---|
| `CliResult<T>` / `CliError` / `EXIT_CODES` | `core/src/result.ts` | the only success and failure shape any command returns |
| `DeveloperOsConfigV1`, `RuntimePaths`, `PathEnvironment` | `core/src/config/` | configuration and every path derived from it |
| `ChangePlanV1`, `ValidatedChangePlanOperationV1` | `core/src/plans/` | the exact set of mutations a command proposes |
| `TransactionJournalV1`, `TransactionPhase`, `TransactionPlan` | `core/src/transactions/` | the durable record a crash is recovered from |
| `InstallationManifestV1`, `ManagedArtifactV1`, `DriftFinding` | `core/src/manifest/` | what the product owns and how it detects that ownership was violated |
| `PlatformAdapter`, `PlatformFacts`, `AgentDiscovery` | `platform-macos/src/types.ts` | the whole of what the product knows about the host |
| `CliContext`, `CliGuards`, `CliFileSystem` | `apps/cli/src/context.ts` | the composition contract every command is written against |
| `InitResultV1`, `StatusReportV1`, `DoctorReportV1`, `RepairResultV1`, `UninstallResultV1` | `apps/cli/src/commands/` | the `--json` surface, version-stamped with `schemaVersion: 1` |

`tests/e2e/foundation.test.ts` imports the five `--json` result types by name, plus
`CliResult`, `CliError`, `InstallationManifestV1`, `TransactionJournalV1`, and `EXIT_CODES`, so
a change to any of *those* fails the build of the evidence suite rather than passing silently.
The rest of this table is frozen by convention and review, not by a compiler.

**One of them has been amended since, exactly as this section invited.** On 2026-08-07
(`4cd7224`) DOS-P2 gave `DeveloperOsConfigV1` an **optional** `brain?: BrainConfigV1` member,
and `core/src/config/` now also owns and exports `BrainConfigV1`. The change is additive:
`configSchema` stays `.strict()`, `schemaVersion` stays `1`, `serializeConfig` emits the
section only when the key is present, and `exactOptionalPropertyTypes` keeps "absent"
distinguishable from "present-and-undefined" — so a configuration written before the section
existed still loads and still serializes byte-identically. The surviving rationale is in
`docs/architecture/brain.md` §3. Every amendment to a frozen interface was indexed in
`docs/superpowers/BACKLOG.md` §8 until `d72287a` (2026-08-28) replaced that section with an
inbound-reference index; the amendment record is §8 of `git show d72287a^:docs/superpowers/BACKLOG.md`.

**A second amendment landed on 2026-08-17, on exactly the same terms.** Track R entry R2 gave
`DeveloperOsConfigV1` an optional `redaction?: { patterns }` member — a bounded list of literal
substrings, never expressions — because `threat-model.md` §5.7 and the since-closed `BACKLOG.md` §1 NEW-16 recorded the
user-extensible redaction class that was **unreachable**: `redactText` accepted the option and no
production caller passed it, and this schema had no key a user could set.
Additive in the same three senses as `brain`: `.strict()` and `schemaVersion = 1` are unchanged, the
table is emitted only when present, and a configuration predating it loads and re-serializes
byte-identically. The row's last record is §8 of `git show d72287a^:docs/superpowers/BACKLOG.md`,
**unratified** — the founder decided to implement NEW-16, which is not the same as ratifying the
amendment it required — and `d72287a` removed it without recording a ratification.

**A third amendment landed on 2026-08-19, and it is the first to touch `CliError` rather than
the configuration.** Track R entry R2 gave `CliError` an optional `data?: RedactedPayload` member, because
`CliResult`'s failure arm carried nothing machine-readable: `ingest` processes a batch and contains
each capture's refusal to that capture, so a partly-succeeded run had to ship its per-capture
outcomes as lines inside `message` and a consumer parsed prose. `brain lint` recorded the same
constraint and answered it the same way, and `releases/foundation-checkpoint.md` records `doctor`
hitting it a third time — three commands reaching for the same missing field is what made it a
Foundation change rather than any one command's to work around.

Additive in the senses that matter here: the field is **optional and absent when unset**, so every
`--json` document a command emitted before it is byte-identical, and no existing caller changes
because nothing populates a field that does not exist yet. What it costs is a new publishing
surface — the failure arm is serialized into `--json` — so `failureFrom` redacts every string leaf
of it, keys included, cycle-safe, depth-bounded and bounded in *breadth* — a caller's list is copied
entry by entry under its own cap rather than spread, because a spread drives a hostile iterator to
completion and V8 aborts with `FATAL ERROR: invalid array length`, which no `catch` contains. The same copy
guards `warnings` on the success arm, and it drives the iterator's `next()` by hand rather than
breaking out of a `for…of`: any early exit from `for…of` calls the iterator's `return()`, which is
the caller's code, so the obvious spelling substitutes an uncatchable hang for the abort. And **three mechanisms make that the way in: the
type closes the shape half, `failure` refuses what it cannot vouch for, and `publish` — the seam that decides the bytes and the exit status together — rebuilds anything it
was not handed by `failure`, field by field**. The slot is `RedactedPayload`,
branded with a `unique symbol` only `result.ts` can name, so `redactPayload` is its sole producer —
and it takes the redactor and performs the walk, rather than asserting, so obtaining the type means
having redacted. Every *shape* that writes the field another way is a compile error.

The type alone was not enough, and a review demonstrated it six ways: `failure` kept the caller's
object and `formatJsonResult` serialized it whole, so a `toJSON` on the error, a class
`implements CliError`, `Object.defineProperty`, and mutating the returned result all published a raw
value without writing the field in any shape a parse could see. Three mechanisms answer it, and the
order they arrived in is the argument for the third. `failure` rebuilds the arm from its five named
fields: `kind`, `message` and `recovery` coerced to strings, `paths` copied and frozen, and
`data` accepted only if `redactPayload` produced it. The arm is branded `Constructed`, so a hand-built
`{ ok: false, code, error }` is a compile error. And `publish` rebuilds any failure arm
`failure` did not return, dropping `data`, because a payload on an arm this module never produced
cannot be vouched for. An unregistered *success* arm has no such rebuild available — `data` is
generic, so there is no coercion that makes it safe — and it is refused outright rather than
serialized as given. A round-24 review measured the alternative: publishing it verbatim printed a
secret and returned exit status `0` for an arm whose own code said `5`.

**The third is what closes the class.** Rebuilding helps only callers who choose to call, and a
*phantom* brand rides through `Object.assign`, object spread, `Proxy` and `structuredClone` while
every runtime property it stood for is discarded — `{ ...result, error }`, which is what re-wrapping
a sub-command's failure looks like, typechecks and skips all of it. Identity is the one thing those
operations cannot forge, so the question is asked at the seam that decides the bytes. Both brands
are type-only, so the published bytes are unchanged.

**What the brand does not stop**, recorded because two successive versions of this paragraph each
named something that is in fact closed: **a caller who supplies an identity redactor**, and **a
producer call outside the composition root**. That is the whole list, verified by running each
candidate against the built module. Merging with `Object.assign`, spreading into a wider object,
`Object.defineProperty` before the call, and mutating through a cast are all closed — but by **two**
mechanisms, and an earlier version of this paragraph credited them all to one. Spreading,
`Object.assign({}, payload, …)` and `Object.defineProperty` on a fresh literal each yield a value
`payloads` does not hold, so `failure` drops the field entirely. In-place `Object.assign(payload, …)`
and mutation through a cast are stopped by the deep freeze instead: those return the payload itself,
which the registry *does* hold, so the registry cannot be what refuses them. The distinction is
load-bearing — moving the freeze to the publishing seam would leave the first pair closed and the
second pair open. An identity redactor is the one
that survives, because obtaining the brand means having performed the walk *with the function the
caller supplied*, and no type can audit a function.
`tests/repository/failure-data-entry.test.ts` keeps the producer at the composition root and sweeps
the greppable spellings — over thirty, split between casts and brand-naming
annotations on one side and ways of reaching the producer under another name on the other. The
exact split is deliberately not quoted here: two reviews counting it disagreed, and a number three
documents repeat is worth less than the test file, which is the only thing that can be right. The original pair
was a cast onto the brand and a producer call outside the composition root; reviews then added
`as never`, a type predicate or `asserts` signature naming it, a variable bound to the producer, and
a re-export of it. The list records what was measured rather than what is believed to remain.

**That was the second design.** It began as `data?: unknown` guarded by a repository sweep, on the
argument that `failure` is exported and called directly at seven command sites besides
`failureFrom`, and that `failureFrom` builds
its error with a spread — which is exempt from excess-property checking, so the type policed
neither. The sweep was then falsified in five consecutive review rounds: four evasions, seven, a
conditional spread, five inline shapes, five more — never trending to zero, because `CliResult` is a
plain structural union and the set of syntactic shapes producing a failure arm is unbounded. A brand
answers all of them at once. `tests/repository/failure-data-entry.test.ts` survives, narrowed to the
holes a brand cannot close: obtaining one without redacting, and minting one outside the composition
root. A sixth round then found five more ways to reach it — `as never`, a type predicate, an
`asserts` signature, a variable bound to the producer, and a re-export of it — so the sweep's
coverage is a measured list rather than an argument.

The row's last record is §8 of `git show d72287a^:docs/superpowers/BACKLOG.md`, **unratified** — the
founder decided to implement Foundation request 3, which is not the same as ratifying the amendment
it required — and `d72287a` removed it without recording a ratification.

**A fourth frozen-interface amendment was ratified for DOS-P7 on 2026-08-25, before its code
lands.** `DeveloperOsConfigV1` keeps `schemaVersion: 1`, its required `git.enabled` and
`automation.enabled` booleans, and strict unknown-key refusal, and adds exactly two optional nested
records: `git.lifecycle?: GitSyncConfigV1` and
`automation.lifecycle?: AutomationConfigV1`. Serialization emits each record only when present;
absent remains distinct from present-and-undefined, so pre-DOS-P7 configuration still loads and
serializes byte-identically. An enabled flag without its complete record is readable but
operationally inert; even a complete record is inert without the matching active arm in the
manifest-owned `LifecycleActivationRecordV1` and a clear `LifecycleJournalClosureV1`. Both lifecycle
records are strict, exhaustive recursive schemas with bounded paths, Git identity/scope, normalized
closed schedules, and canonical encodings; interrupted or malformed participant journals make every
otherwise matching lifecycle state recovery-required rather than active, apart from the exact non-
clear Git `retry_only` outcome that may consume only its persisted push plan, and the exact typed
`uninstall_draining` outcome that grants only silent exit to a runner whose bound lease was removed.
The active opt-in-
surfaces design §2.2 is the full lifecycle contract, and
§8 of `git show d72287a^:docs/superpowers/BACKLOG.md` carries the same-change ratification record.

**The 2026-08-27 final review correction closes the command interface around that schema without
widening it.** `config get/set` has exhaustive readable/mutable dotted-key unions, one
`CanonicalJsonV1` value argument with per-key types, `null` only for complete optional `brain` or
`redaction` removal, typed canonical-JSON results, and a publishable projection that exposes
redaction patterns only as `patternsCount`. Schema/lifecycle/telemetry state stays readable but cannot
be mutated through `config set`. The same correction separates allocation-free
`LifecyclePlanPreviewV1` from the internal `LifecycleExecutionPlanV1`: preview performs no write,
allocation, staging creation, or inode capture, and apply revalidates its hash under the global lock
before reserving IDs. The active opt-in-surfaces design §§2.2–2.4 is the exact contract; this was a
ratified correction to the then-pending written specification, not approval of that complete document
at that point. The founder approved the complete Spec 1 on 2026-08-28; its written implementation
plan remains blocked on Spec 2's `InstallationManifestV2` handoff.

## 3. The mutation pipeline

Every filesystem mutation in the product goes through seven phases, recorded in a journal at
`<product home>/state/transactions/<id>.json` *after* the phase it names completes and before
the next one is attempted. So the journal always describes work already done — which is what
makes the table below, and recovery itself, meaningful.

```
planned → backed_up → staged → validated → applied → verified → finalized
   │            │          │          │           │          │
   └────────────┴──────────┴──────────┴───────────┴──────────┴──→ rolled_back
```

| Phase | What has happened on disk when the journal says this |
|---|---|
| `planned` | the staging and backup directories exist, and every non-`remove` mutation's staged blob and digest is written |
| `backed_up` | each target's metadata is recorded under `backups/`, plus its prior content where the target already existed — an all-`create` plan such as `init` copies no content at all |
| `staged` | staged blobs re-read and verified against their digests |
| `validated` | targets re-asserted against the guards; staged content verified again |
| `applied` | targets created, replaced, or unlinked; the only phase that changes user-visible files |
| `verified` | targets re-read and compared to what was staged |
| `finalized` | terminal; the transaction cannot be rolled back |

Two consequences are load-bearing and easy to get wrong later:

- **Rollback is only meaningful from `validated`, `applied`, or `verified`.** From the earlier
  phases there is nothing applied to undo, so rollback is a transition and nothing else.
- **`finalized` cannot be rolled back.** `init` therefore undoes itself with a second,
  compensating transaction over the artifacts it just recorded — the same code path
  `uninstall` uses. See `revertArtifacts` in `apps/cli/src/commands/uninstall.ts`.

The lock is advisory and per-transaction, taken at `<state>/transactions/.<id>.lock` by
`MacOsTransactionLockProvider`, and re-entrant within one `TransactionStore` instance only.
Two different store instances in one process do *not* share re-entrancy, so `doctor` could not
be run from inside a transaction's verify phase — it reads journals through a different
`TransactionStore` and would deadlock. Nothing in production registers an `afterPhase` hook, so
this is a constraint on future changes rather than an observed failure.

**DOS-P7 cross-reference, ratified 2026-08-25.** Foundation's file executor remains unchanged.
The active opt-in-surfaces design §2.4 extends the same phased/journaled guarantee to two states that
are not manifest-owned files: exact `.git` internals (including an explicitly configured bare local
Git destination) and the closed Developer OS launchd base/generated labels. A local push uses separate source and
destination Git-effect journals; before-files and after-files launchd effects are likewise distinct,
so no participant is consumed on two sides of another publication. Their exact phase/cursor/
observation table keeps a completed effect `verified` and compensatable until the composite operation's
point of no return, then finalizes it; apply-before-journal states resolve only from pre-recorded
identity. A local receive runs entirely between private shadows before coordinator intent and the later
destination effect is process-free promotion. Its private bare config forces `receive.unpackLimit=0`,
so every ref-update command uses the pinned `index-pack` branch, including a zero-object pack; the
measured already-up-to-date target emits no pack/index child and binds a zero-transition destination
effect after the real destination target ref verifies at the commit. Git rollback restores source/
destination control preimages first but never deletes an already published source object,
destination pack/index, or newly published `.git` root; it verifies and relinquishes the exact object
inode or tree-root identity as ownership-neutral because a concurrent Git writer could have made it
reachable or mutated descendants without changing that identity. Neither compensation nor compaction
recursively deletes published Git state.
Launchd uses plan-derived generation labels observable through exact domain-targeted
`launchctl print gui/<uid>/<label>` service probes rather than claiming launchd exposes plist hashes or
using the caller's implicit bootstrap namespace. Its hash-bound process table also confines
`bootstrap`/`bootout`, streams, deadlines, and whole-group termination. Authority, pre-recorded inode
evidence, no-replace verification/compensation, and the push-last exception are indexed in §8 of
`git show d72287a^:docs/superpowers/BACKLOG.md`. Git execution is additionally confined to an exact root-owned
`SupportedGitDistributionV1`/canonical `SupportedGitProcessTableV1` row and an owner-only
`GitExecGatewayV1` whose Node-24 trampolines and one-shot `GitProcessSupervisorV1` graph mediate every
dynamic child. SSH enters its internal bridge through that gateway and consumes a second supervised
same-PID edge before the pinned system client. The extension grants no ownership over either Git
worktree's files or unrelated services.

The 2026-08-27 closure keeps both boundaries exact. A source Git snapshot tags its index as absent or
present, permitting absence only for the supported unborn empty repository and never synthesizing a
hash. An automation reconcile whose config, activation, manifest, and plist bytes are unchanged may
select `automation_reconcile/live_only`: its sole participant is the hash-bound after-files launchd
effect, with no Foundation/manifest mutation, and it may contain zero transitions when every expected
generation is already loaded. A later same-day closure requires every new standalone/participant
Foundation journal and coordinator journal to prove before ID reservation that every reachable exact
encoding fits its derived/plan-bound 1-MiB ceiling; launchd effects prove the same ceiling and Git
effects prove their plan-bound 16-MiB ceiling. The Git process table now hashes counted-stream and
per-invocation phase budgets with whole-group termination: a descendant/internal attempt cannot reset
the current push's 600 seconds, while a later exact `push_pending` invocation receives a fresh bounded
phase rather than a persisted lifetime clock. Launchd plist generation is one exact five-key XML/
calendar grammar rather than an implementation-selected serializer. The final same-day correction
also gives guarded Git configs/index/`HEAD`/loose refs numeric pre-read limits, freezes the legacy
Foundation mutation-index grammar at canonical `0..4294967294`, inventories exact
`launchd-process/{home,tmp}` staging, and makes the existing per-job zero-byte lock a runner lifetime
lease acquired before the global lock. The post-package correction hash-binds the launchd-process
root/home/tmp path-owner-mode-device-inode identities, classifies a removed lease only from marker,
manifest, or the exact typed uninstall ledger, and makes fresh absent-manifest admission process-free
before any recovery ID because no product-owned generated label remains derivable. Git source and
destination shadows likewise bind one canonical `SanitizedGitShadowConfigV1` byte projection before
spawn, including `http.followRedirects=false`; a redirect cannot authorize a second request target.
The subsequent correction additionally puts the guarded product home in generation-bound scheduled
argv, distinguishes symbolic/OID Git `HEAD` state so an empty bare destination is representable,
persists a path-slot shadow-config template hash across retries, and rejects alternate-object path
bytes that Git could interpret as list/C-quote syntax.
The final review correction narrows those boundaries again: only enable may publish a new `.git`, so
even the first unborn sync uses existing-repository object/index/reflog/ref transitions. Source
`logs/HEAD`, source branch logs, and local bare branch logs are bounded staged/CAS postimages whenever
the validated Git policy or an existing log requires them; compensation restores refs before logs.
`GitConfigQuotedPathV1` excludes controls/line breaks from generated config paths, and the in-process
pack/ref reader streams under exact compressed/object/inflation/delta/RAM/temp limits plus the one
inherited 600-second phase. Launchd bootstrap (**amended 2026-10-03, D82**: `/dev/fd/3` fails with
error 5 on macOS 26.6.2, so the FD-3 snapshot is gone) names the plan-bound plist's absolute path on an
admitted `/bin/launchctl` (§10, D71) after rechecking that the path is the inode the reader admitted
and holds the plan bytes, then re-proves both and requires `launchctl print` to report the plan's path,
program and arguments, booting the label out and refusing `launchd_bootstrap_plist_changed` otherwise
(`threat-model.md` §5.15 carries the residual). A scheduled runner first authenticates manifest/plist/generation
installation evidence independently of current active provenance, then under its lease/global lock
runs an eligible handler, writes only `automation_disabled` for inactive automation, or writes only
`git_disabled` when active automation's installed sync job alone is Git-ineligible, without resolving
Brain or reaching Git/vendor/network authority in either inert branch.
Any retained or missing install/label derivation evidence remains recovery-required.
The post-final correction makes the reflog postimage bound exactly 64 MiB plus its separately bounded
4-KiB append and binds every append bijectively to its effect/ref projection; the private pack header,
admitted-entry, and closed-OID counts are equal and capped at 200,001 before a child permit. Launchd
bootstrap's post-check (D82) detects an in-place write or swap of the real plist after the bootstrap and
boots the loaded label out. Before the permanent global lock exists, init uses the exact transient
`LifecycleBootstrapLockV1` protocol with a second complete inventory, and absent-manifest uninstall
carries no coordinator envelope at all (A3): `key_absent` performs two identical read-only walks and
creates nothing, while `key_present` acquires only the bootstrap leaf, repeats the inventory under it,
and deletes the redaction key by rechecked `dev`/`ino` identity without reading a byte of it. A live
attempt removes only its identity-recorded empty directories; after crash, the indistinguishable exact
empty product/state skeleton is preserved, and neither uninstall arm unlinks or `rmdir`s the bootstrap
leaf or any member of A12's bookkeeping set — §8.3's residual 8, the check-then-unlink window the
identity recheck narrows but cannot close, and residual 9, shape admission, both stand accepted.
Launchd inherits only the already-unlinked snapshot; its sole linked creation prefix is frontier-bound
and recoverable. The active opt-in-surfaces design
§§2.3–2.4, 4.4, 5.3–5.4, 6, and 7 is
normative; implementation remains pending.

## 4. Ownership

The installation manifest at `<product home>/installation-manifest.json` records every
artifact the product created, with the hash it installed and whether the path existed before.
Ownership is decided on **both** the declared path and the canonical path, for every artifact
kind, and re-resolved immediately before each removal.

Two ownership universes exist over that one manifest, and the difference is the point:

| Operation | Owned roots | Excluded roots | Effect |
|---|---|---|---|
| `init` revert | product home **and** a Brain it just created | `backups/` | undoes its own work completely, Brain skeleton included |
| `uninstall` | product home only | the Brain | Brain artifacts are refused by location, whatever the manifest says |

**DOS-P7 manifest/ownership amendment, ratified 2026-08-25.** Spec 2 upgrades the stored interface to
`InstallationManifestV2`/`ManagedArtifactV2` before the opt-in surfaces land. The artifact is a
kind/verification-mode tagged union: regular files support `content`, `schema`, or exact-path
`ephemeral`; directories and symlinks support `content` with kind-specific evidence. Every V1 owner,
path, product version, restore field, source, merge strategy, and verification timestamp survives.
`schema_invalid` joins the drift classes. Restore evidence is legal only for regular-file
content/schema entries; directories, symlinks, and ephemeral reservations require
`existedBefore: false` and null restore fields. Migration verifies shared-file backups and refuses V1
symlinks, shared directories, unsafe backup evidence, or pre-existing ephemeral-path collisions
before writing V2. It also refuses before reading artifact bytes if either a V1 declared/canonical
artifact path or any existing filesystem leaf collides with the newly reserved exact lifecycle-
activation path; no V1 claim is adopted or retyped there. The active opt-in-surfaces design §2.1
freezes every retained sync/marker/status/lock/log path and record schema plus the three owned journal
directories that spec 2 must reserve/create at migration.

**The `instruction` kind (A12, 2026-09-26).** `ManagedArtifactV2` has two `instruction` arms
(`packages/core/src/manifest/v2.ts` — `instructionArtifact`). A `content` row is a whole file the
product created: `mergeStrategy: "dedicated"`, `existedBefore: false`, null restore fields, and an
identity `{ category, id, source }`. A `block` row is the one marked block in a shared vendor
instruction file: `mergeStrategy: "marked-block"`, owner `claude` or `codex`, category
`vendor-file`, source `default`, 1 to 64 `members` in strict `(category, id)` order, and at most
one per owner. Its `existedBefore` follows the file, and the whole-file backup is evidence only,
never restored. `marked-block` is refused on every other arm. Drift hashes a `content` row like a
regular file and a `block` row by its extracted block alone: absent markers are `missing`,
malformed ones `block_malformed`, an edit `content_changed`, and bytes outside the block are never
drift. Uninstall never downcasts a `block` row
(`apps/cli/src/commands/uninstall.ts` — `downcastArtifactV2`); the instruction detach (§12.4)
removes it first.

**V1 refusal, bootstrap recovery routing, and the V2 handoff admission — 2026-09-17 (decision D18).**
The migration half of the amendment above is withdrawn: no V1 manifest is ever migrated, and only
Spec 2's fresh V2 `init` creates V2 state. The `v1_to_v2` arm Core had already shipped was deleted
on 2026-09-28 (NEW-78): the bootstrap plan, journal, payload-path, Foundation-participant and
manifest-envelope grammars admit only `fresh_v2_init`, so a persisted `v1_to_v2` plan, an `mm_` or
`tx_mm_` identifier, a `manifest-migration` path, a `guarded_migration_preimage` source or a
`v1_migration` envelope is malformed bootstrap state and is refused. Core's unused
`validateMigratableManifestV1` went with it. Three contracts take the migration's place.

- **`init` refuses a V1 manifest once the packaged bootstrap capability is available.** It exits 4
  (`capabilityUnavailable`) with reason `manifest_v1_not_migratable`, names the manifest path, and
  gives the recovery `developer-os uninstall, then archive the product home manually, then
  developer-os init` (D20 — the shorter form does not work, because V1 `uninstall` leaves
  `staging/`, `state/transactions` and `backups/` behind and a fresh V2 `init` then refuses that
  residue). It refuses before the
  bootstrap evidence inventory and before any plan, so a dry run and a real run mutate nothing.
  Without the capability — production pins it unavailable until roadmap Phase 4b
  (`apps/cli/src/context.ts`) — the V1 `init` path is unchanged. The refusal is
  `ManifestV1RefusalError` in `apps/cli/src/bootstrap/report.ts`. Its reason is typed from Core's
  `ManifestV1NotMigratableError`, and its `name` is spelled `ManifestV1NotMigratableError` so that
  `failureFrom`, which publishes the kind derived from the name, publishes exactly that reason on
  every path; Core's class itself is not thrown because it carries exit 6. Evidence:
  `apps/cli/src/commands/init.test.ts` — `refuses a shipped V1 installation once the packaged
  capability is available, and keeps the V1 path without it`; `apps/cli/src/bootstrap/report.test.ts`
  — `refuses a manifest the shipped V1 init produced`, which publishes the rejection through
  `failureFrom`.
- **Every command except `init` is routed by the bootstrap state before it runs.** Dispatch
  (`apps/cli/src/main.ts`) calls `assertOrdinaryCommandAdmitted` in
  `apps/cli/src/bootstrap/report.ts`, which decides by the current installation manifest:
  - **A manifest declaring `schemaVersion: 2` must first pass structural V2 validation.**
    `isStructurallyValidV2Manifest` in `apps/cli/src/bootstrap/report.ts` runs Core's
    `validateManifestBytes` over the guarded manifest bytes — canonical JSON, exact keys, stable
    version, timestamps, artifact arms, restore evidence, sorted unique paths — with an
    `unconfined` owner-path admission. It reads neither `config.toml` nor the Brain path, so an
    unparseable configuration or a relocated Brain never makes a valid V2 manifest look malformed;
    those remain `doctor`'s findings and the confined reads of the commands that act on them (for
    example `uninstall`'s relocated-Brain refusal). A manifest that declares version 2 but fails —
    a planted `{"schemaVersion":2}`, or a shipped manifest altered into an invalid one — is
    malformed local manifest state (Spec 2 §11). Every command then exits 6 with message `the V2
    installation manifest failed validation; restore it or archive the product home manually
    before running init again` and the manifest path, and `init` refuses with the same message,
    from the same check, before reading any bootstrap evidence.
  - **A valid V2 manifest: the handoff arm.** Retained evidence is inert. The gate lists `state/`
    and reads only names of the form `fresh-v2-init.<id>.plan.json`; it never stats a tombstone, a
    payload or evidence name, or `.lifecycle-bootstrap.lock`. It refuses only when an admitted
    plan's two plan-bound slots hold a valid selected journal with no terminal outcome **and** that
    plan published the current manifest bytes (`exactV2Handoff`): the envelope interrupted after the
    manifest point of no return and before verification finalized, which `init` resumes. It admits
    every other state, whether the plan, slot or tombstone is missing, added, altered, a symlink,
    oversized, emptied or replaced. **Known limitation:** a crash after manifest publication and
    before verification, followed by journal-slot corruption, is indistinguishable from a tampered
    finalized install and is admitted. For the same reason, a plan that no longer admits, or a
    still-valid manifest whose bytes no longer match the interrupted plan, is admitted rather than
    routed to `init`.
  - **No manifest declaring version 2 (a V1 home, a home where bootstrap never ran, or one after
    `uninstall`): the recovery arm.** The gate runs the same bounded evidence inspection `init`
    runs and refuses on that inspection's verdict. An active envelope whose journal is absent or has no terminal
    outcome refuses with reason `bootstrap_recovery_required`, message `an interrupted bootstrap
    must be resumed by init` and recovery `developer-os init`; `init` resumes it. Evidence that
    blocks a new intent — live residue beside a plan that no longer admits or a slot whose inode
    changed, or any unconfined bootstrap residue — refuses with `init`'s own message, `retained
    bootstrap evidence requires manual archive before a new bootstrap intent`, and its retained
    paths. An inspection that cannot read the namespace (for example a symlink named
    `.lifecycle-bootstrap.lock`) refuses with that same message, and `init` refuses the same way
    rather than failing with an unclassified error. Terminal retained envelopes and confined
    `unverified` residue block nothing, because `init` itself starts beside them. A V1 or
    never-bootstrapped home without bootstrap-namespace residue is admitted when its product home
    and `state` are real directories; a symlinked root makes the inspection unreadable and refuses
    as above.

  Every refusal exits 6 (`recoveryRequired`) and writes nothing. Evidence:
  `apps/cli/src/main.test.ts` — `refuses every non-init command while a fresh V2 envelope is
  non-terminal, and none after init completes the handoff`; `admits every ordinary command when
  retained evidence goes missing or is altered after a complete V2 handoff`; `refuses every non-init
  command with init's own archive guidance when an interrupted envelope's plan or slot stops
  matching`; `refuses only genuine bootstrap residue in a home where bootstrap never ran, with the
  guidance init gives`; `refuses every command, and init, when a planted manifest declaring schema
  version 2 fails strict validation`; `refuses every command, and init, when a shipped V2 manifest is
  altered into an invalid one`; `does not refuse a valid V2 install as a malformed manifest when its
  configuration is unparseable or its Brain moved`; and `keeps Foundation commands working over a shipped V1 manifest
  while init refuses it`.
- **`admitInstalledV2Home` admits an installed V2 home structurally, for Spec 1 commands to call.**
  Plan 1a Task 17 deleted `admitV2Handoff`, which was a fresh-install snapshot: it pinned the current
  manifest to exactly one `finalized` envelope and refused anything a legitimate later apply would
  change. Structural admission replaces it (Spec 1 §2.1, "Admission of an installed V2 home"), and
  binds to no bootstrap plan, no drift, no activation record and no closure. It requires
  `validateManifestV2` to pass with the confined admission context, then every lifecycle reservation
  row by exact path and mode, then an exact install nonce, a canonical allocator whose nonce agrees,
  an owner `0600` zero-byte single-link global lock, and three owner `0700` journal-root directories.
  Refusals carry their own reason: `manifest_absent` → exit 2; `manifest_v1_not_migratable` → exit 4;
  `manifest_invalid`, `reservations_incomplete`, `nonce_invalid`, `allocator_invalid`,
  `nonce_allocator_mismatch`, `global_lock_invalid` and `journal_root_invalid` → exit 6. No catch-all:
  each missing member refuses as itself, and a programming error propagates unchanged rather than
  being relabelled as a refusal.

  What it deliberately admits is the other half of the change. A missing schema file, a drifted
  bundle file, a missing or altered retained tombstone, and a planted plan under
  `state/lifecycle-journals` all still admit — drift and closure own those, not admission. So does an
  allocator at a non-zero counter, which the handoff snapshot could not accept. Evidence:
  `apps/cli/src/lifecycle/admission.v2.test.ts` — `admits a fresh V2 home and binds to no bootstrap
  plan, drift or retained evidence`, `keeps the Spec 2 §6.4 handoff set as a fact of a fresh init`,
  the per-member refusal table, `refuses a directory at %s as %s instead of treating it as absent
  (NEW-82)`, and `lets a programming error escape instead of relabelling it (NEW-82)`.

  **NEW-82 and NEW-126 close it one layer out too.** `admission.ts` reaches the filesystem through
  the guarded port, whose `lstat` refuses a directory or a symlink with the member's own reason.
  `report.ts`'s `guardedFile`, which `assertOrdinaryCommandAdmitted` reads the manifest and each plan
  through (and the superseded-handoff check its anchor), calls `inventoryExactNamespaces` with
  `leaves: true`, which reports a directory root as that one entry, so
  a directory at `installation-manifest.json` refuses as `NON_REGULAR_BOOTSTRAP_LEAF` naming it
  instead of reading as an absent manifest. Every other caller keeps the default, where a
  direct-namespace root records its children only: the product home, `state` and the retention row
  parents are containers, and recording them would put them into `retainedPaths`. Evidence:
  `apps/cli/src/bootstrap/report.test.ts` — `distinguishes a directory at the manifest path from an
  absent one (NEW-126)` and `keeps namespace-container roots out of the inventory (NEW-126)`.

None of these refusal paths spawns a process, which is the only way this product reaches a network:
`tests/security/network.test.ts` — `the bootstrap refusal paths`.

The manifest remains Foundation's durable direct-write exception, not a managed artifact and not a
nested file transaction. DOS-P7 adds `ManifestStatePlanV1`, whose before/after arms are exact
`present { bytes, hash }` or `absent`, plus exact sibling tombstones and present-inode identity. A
present preimage is atomically moved no-replace to its journal-owned tombstone and verified before an
exact present postimage is no-replace-published or committed absence is durably recorded. Rollback uses
only no-replace moves, and every concurrent third state is preserved rather than overwritten or
unlinked. The composite journal retains its bytes, tombstones, and backups until the manifest postimage
and all participants are terminal, so recovery can finish or restore around every move, publication,
or absence-commit boundary. The active opt-in-surfaces design §2.4 owns ordering and failure semantics;
§8 of `git show d72287a^:docs/superpowers/BACKLOG.md` carries the same-change ratification record.

For coordinator-owned Foundation participants, §2.4 also pre-stages the exact canonical initial
`planned` journal and records its device/inode before coordinator intent is published. Under the
existing stable transaction lock, the coordinator no-replace-publishes that bound inode or resumes an
already published identical inode before handing control to the unchanged executor. This is limited
to the first journal write: ordinary transaction phases/schema and post-publication generic rewrite-
temp recovery stay unchanged. Before first participant intent, one guarded owner-owned
empty/partial/complete initial plan/journal temp may instead be deleted only when the exact surrounding
coordinator/effect/participant ledger proves that no target or live transition began; once one did,
the temp is preserved as recovery evidence. This removes both the crash state in which a valid first-
write temp existed with no final journal and the opposite risk of deleting evidence after an effect.
The executor's ordinary staged mutation bytes live at their
existing exact `<product home>/staging/transactions/<id>/<index>.bin[.sha256]` paths and are likewise
durable before coordinator intent. DOS-P7 raises their common bounded payload ceiling to 16 MiB,
matching `SyncRecordV1`, and requires streaming size/hash verification; the separate planned-journal
file remains bounded to 1 MiB. The lifecycle staging tree holds only the separately named initial
journal plus external-effect quarantine.

**DOS-P7 compensation/collection amendment, ratified 2026-08-26.** The executor still runs a reached
Foundation participant through `finalized` and still cannot roll that journal back. Every such
participant that occurs before the composite operation's exact point of no return therefore binds a
second, separately pre-staged Foundation transaction containing the exact inverse mutations in reverse
order. Prior bytes belong to that inverse plan before the forward executor starts, so the existing
terminal backup prune cannot destroy composite rollback authority. A current non-finalized forward
journal may use the executor's ordinary rollback; an already finalized prefix is restored only by its
paired inverse transaction. The active opt-in-surfaces design §2.4 owns the closed operation table,
pairing rules, and point-of-no-return table.

The same ratification answers Foundation's permanent-lock question in favor of bounded terminal
collection. Once a generic Foundation transaction or composite lifecycle coordinator is terminal and
no recovery may consume its evidence, a guarded compactor runs under the global mutation lock plus the
still-held stable ID locks. It removes only journal-derived staged/backup leaves and empty exact ID
directories. A coordinator unlinks its journal, then the exact held lock inode, and its immutable plan
last, so crashes leave plan-plus-lock or plan-only recovery evidence and never a lock-only envelope. An immutable
installation nonce plus crash-safely advanced monotonic allocator reserves every new Foundation/
lifecycle ID under that global lock before publication, so collection never permits reuse within the
installation epoch. New Foundation plans are bounded to 256 mutations. The active design also freezes
aggregate journal/staging/backup caps, phase-specific reservation, and a guarded planless-orphan
cleanup grammar for the staging/backup directories and lock that today's executor can leave before its
first journal write. That grammar admits remove-induced numeric gaps and only the exact three
highest-index partial `writeStaged` states; the same guarded pre-intent proof controls initial
coordinator, participant, and effect plan/journal temps. A partial allocator temp is cleanable only while the old
allocator inode remains authoritative and no ID was exposed. Foundation journal bytes keep the
implemented `JSON.stringify` insertion order (`FoundationJournalJsonV1`) rather than silently adopting
the new coordinator's `CanonicalJsonV1`; new work derives its largest reachable encoded journal before
ID reservation, binds the exact maximum in composite refs, and checks every rewrite before rename.
Legacy journal reads keep the current strict-schema
compatibility. A lifecycle compaction cursor makes every participant/envelope deletion resumable, and
a journal-less plan or lock is collectible only after all referenced state is proved absent. Unknown
children, identity swaps, and non-empty directories are preserved. The global
lifecycle lock remains never-unlinked. Until DOS-P7 implementation lands, the current code and
residual §8 item 4 still retain terminal journals, metadata, staging, and per-ID locks; the design decision
is closed, not yet shipped.

The same ratified DOS-P7 contract makes
`<product home>/state/lifecycle-activation.json` an ordinary V2 regular-file `content` artifact,
created only by the first successful lifecycle enable with `existedBefore: false`. Its strict
`LifecycleActivationRecordV1` has independent inactive/active arms for Git and automation; each active
arm binds SHA-256 of the exact canonical complete lifecycle configuration plus literal enabled state.
Lifecycle apply updates the record and its manifest installed hash through the composite coordinator.
Config without matching active provenance is inert, disable records the corresponding arm inactive,
and independent record/manifest edits are content drift or missing ownership rather than an enable
surface. Operational provenance additionally requires `LifecycleJournalClosureV1.clear`: malformed,
unknown, or non-terminal participant journals in the active spec's exact four-root ledger keep
matching config/record/manifest bytes inert. The
exact bound Git `push_pending` journal is a separate non-clear `retry_only` outcome that can consume
only its persisted push plan; exact verified uninstall lease removal is non-clear
`uninstall_draining` and grants only silent runner exit plus recovery of that uninstall. The activation-
record/manifest pair is not a
cryptographic boundary against a hostile process that rewrites both, in line with the threat model's
existing local-write scope. The active opt-in-surfaces design §2.2 defines the exact encoding and
failure gates.

The uninstall ownership universe above does not widen for V2. DOS-P7 separately authorizes only the
exact regular-file plist path derived from each closed Developer OS launchd label under the canonical
user `Library/LaunchAgents`, with product-created restore fields and matching content evidence. Every
other out-of-home artifact and every Brain-located artifact is preserved by the declared-and-canonical
partition regardless of what the manifest claims.

The already-ratified exact redaction-key exception remains outside the manifest and is not content
hashed. DOS-P7 coordinates it through `RedactionKeyStatePlanV1` as a secret-opaque same-directory
rename: the journal records only the one architecture-defined path, its exact tombstone, and
type/device/inode identity, never key bytes or a content hash. Before the manifest becomes absent,
rollback may rename that bound tombstone back; manifest absence is the uninstall point of no return,
after which recovery only force-forwards the guarded tombstone unlink. This operationalizes the
existing one-path exception without widening either ownership universe.

When the manifest is absent, that exception is available only after a complete bounded no-follow
inventory of the entire product home. Fresh admission accepts exactly an absent/empty product home,
an exact empty `state` skeleton, or that skeleton with the redaction key as its sole leaf, plus absence
of every closed external plist. Any other known or unknown file or directory, identity race, special
entry, or inventory-limit overrun preserves everything as recovery-required before the key is read,
renamed, or deleted. A selected-known-path checklist is not ownership evidence.

For a V1 manifest, drift compares each recorded artifact against the filesystem on three axes —
presence, kind, and content — and reports one of four findings: `missing`, `type_changed`,
`content_changed`, or `target_changed` (symlinks, whose "content" is the hash of their target). Any V1
finding stops `init` and `uninstall`. A V1 `missing` finding is skipped by the revert itself, because a
file that is already gone is not work this run did — which is also why a deleted managed artifact
currently blocks `init` while the revert would have tolerated it (residual 2).

For a V2 manifest, the tagged verification mode controls the result: `schema_invalid` is the fifth
finding; absence is clean only for an `ephemeral` reservation and is `missing` for every other arm;
content/schema files, directories, and symlinks use their kind-specific evidence from the amendment
above. Any V2 finding stops the owning operation. Every V1 or V2 read goes through the guard's
canonical path, with `O_NOFOLLOW` and a `dev`/`ino` re-check after open.

**One canonicalizer and one owner-admission predicate, in `apps/cli/src/bootstrap/admission.ts`.**
The executor, the bootstrap report and `uninstall` each carried their own copy, and all three
supplied `reopenCanonicalAbsolutePath: (path) => resolve(path)` beside `hasFoldedAlias: () => false`.
`node:path.resolve` is lexical, so on an already-canonical absolute string it returns that same
string and `admitCanonicalAbsolutePath`'s `reopenCanonicalAbsolutePath(value) !== value` refusal
(`packages/core/src/update/paths.ts`) could never fire: a symlinked ancestor was indistinguishable
from a plain one. Two of the three also supplied an identity `admitOwnerPath`, which made
`validateManifestV2`'s `admitOwnerPath(owner, canonical) !== canonical` check
(`packages/core/src/manifest/v2.ts`) a tautology. That pair of defects
was `BACKLOG.md` NEW-51, closed 2026-09-05.

The shared canonicalizer resolves **existing ancestors only** and leaves the final component exactly
as given, mirroring `ManifestGuards.assertReadable` (`packages/core/src/manifest/types.ts`):
canonicalizing ancestors closes the hole a leaf-only guard cannot, and preserving the leaf keeps a
later identity check on it meaningful. Tolerating a path that does not exist yet is load-bearing
rather than lenient — the executor canonicalizes the manifest it is *about to* write, naming paths
one plan ordinal away from existing, so a canonicalizer that required existence would throw on every
fresh `init` before a single file was created.

**The confinement difference between the three sites is preserved rather than averaged away**, and
this is the reason the module is a factory instead of a constant. `createOwnerPathAdmission` takes a
closed `OwnerPathConfinementV1`. The executor and `uninstall` are `confined` to the product home and
the Brain, because each acts on a live request whose owner authority is known. The bootstrap report
is `unconfined`, because it validates a *historical* plan's manifest whose bytes are already
hash-pinned to `plan.manifest.after.hash` and for which no live owner authority exists — and an
unconfined site must state that in a `reason` field it cannot omit, since there is no default arm and
no zero-argument call. A refused path is rewritten to a value guaranteed to differ from its input
rather than thrown, because `admitOwnerPath`'s contract is a value comparison and `validateManifestV2`
is what turns the mismatch into a refusal.

Folded-alias detection (NFC/case aliasing) is still not implemented. None of the three predecessors
had it and NEW-51 was scoped to the confinement predicate silently admitting everything, so the gap
is carried forward knowingly rather than closed as a side effect.

## 5. Invariants that must not be collapsed

Each of these looks like redundancy and is not, and every one was written in response to a
defect that shipped. What follows is a summary; the full, verbatim record from the tasks that
shipped the code — including the one question still open for the founder — is in
[`foundation-constraints.md`](./foundation-constraints.md). Read that before changing any
behaviour described here.

- **`ManifestGuards.assertReadable` is supplied by the composition root, not by
  `packages/security`.** `assertReadableArtifactPath` canonicalizes the *parent* with
  `canonicalizePlannedPath` and appends `basename` verbatim, so the leaf is never resolved and
  core's `lstat` check stays meaningful. **The policy is asked twice** — about the caller's path
  and about the ancestor-resolved result — and both calls are load-bearing: a leaf symlink
  pointing back out of `~/.ssh` passes the first and is refused only by the second.
- **The incomplete-transaction check is a precondition of `init`, not a postcondition.** With
  the full `doctor` report as the only post-apply gate, one stale journal from an earlier
  interrupted run made every subsequent `init` install successfully and then revert itself,
  forever. `assertNoIncompleteTransaction` now runs before any mutation. The post-apply
  `runDoctorReport` gate still exists and still reverts on any *failing* check, which is why
  the distinction between a failing check and a warning below is load-bearing.
- **The TOML parser's message never escapes.** `smol-toml` embeds three raw source lines in
  `TomlError`, so propagating it printed the contents of whatever file was read into `status`,
  `doctor`, and their JSON. Configuration is read through the protected-path policy, absence is
  detected with `lstat` first — the guarded reader reports a missing file as a security refusal
  — and any parse failure becomes a content-free `ConfigurationError`. Redaction is a heuristic
  and must not be the only thing standing there.
- **`renderPath` sanitizes every path that reaches a terminal or a JSON *rendering*.**
  `isManagedPath` accepts any absolute NUL-free string, so an artifact path may carry ANSI
  escapes and repaint the uninstall confirmation prompt — the only consent gate on deletion. It
  covers `\p{Cf}` as well as `\p{Cc}`, because U+202E reorders rendered text without being a
  control character. It is deliberately **not** applied to `--json`, where `JSON.stringify`
  escapes those code points itself and a machine consumer needs the value as recorded. Sanitize
  per line, never per message: `\n` is a control character, and rendering a whole message
  through it collapses the usage block into replacement characters.
- **Every `doctor` check has its own error boundary.** Doctor is the command run on exactly the
  machines where reads fail, and an escaping rejection there became an unhandled top-level
  rejection with a stack trace and no report at all.
- **The full check set is `platform`, `product-home`, `configuration`, `manifest`, `transactions`,
  `drift`, `brain`, `redaction-key`, `agents`, `claude-capabilities`, `codex-capabilities`, and one
  `bootstrap-evidence:<id>` row per retained bootstrap envelope** (`apps/cli/src/commands/doctor.ts`).
  `redaction-key` reports the key's presence, symlink/regular-file/size shape, and octal mode from
  `lstat` alone — never its bytes — and is a `warn` in every state but exactly `0600`, never a
  `fail`: nothing is encrypted with the key, so a lost or loose one degrades a diagnostic, not the
  knowledge it protects. `claude-capabilities` and `codex-capabilities` report each agent's
  capability summary and `capture-via`, and both are `pass` in every branch — Product spec §11 asks
  for a matrix of what was detected, not a verdict on it. Each `bootstrap-evidence:<id>` row reports
  its envelope's operation, status (`verified`, `incomplete`, `altered`, or `unverified`), entry
  count, and retained regular-file bytes at its vault path, as a `warn`; if inspecting bootstrap
  evidence itself throws, an unsuffixed `bootstrap-evidence` row reports the failure as a `fail`
  instead.
- **`init`'s post-install gate is scoped to the checks it is answerable for**, listed in
  `INIT_OWNED_CHECKS`: `product-home`, `configuration`, `manifest`, `drift`, `brain`. It used to
  gate on the whole `doctor` report, which meant any check failing for a reason the install did
  not cause reverted a good install — and that happened twice, first with a stale journal from
  an unrelated interrupted run, then with agent discovery. `platform` and `transactions` are
  excluded because both are already preconditions checked before any mutation; `agents` is
  excluded because Foundation does not depend on an agent existing. Adding an id to that set is
  a deliberate statement that its failure means the *installation* is broken.
- **A `doctor` check that cannot answer, about something Foundation does not depend on, is a
  `warn` and never a `fail`** — and the demotion is narrow. Only `MacOsPlatformDiscoveryError`
  from agent discovery is treated this way; an unsupported platform, invalid input, or a
  security refusal from the process runner still fails, because flattening those would erase the
  one signal that says a guard fired. `status` had always treated the refusal as a warning;
  `doctor` now agrees, and non-blocking findings are carried out through `CliResult.warnings`
  rather than discarded, so a successful `init` still says what it could not check.
- **`ids` on `CliContext` is deliberately unused.** `TransactionExecutor` generates its own
  identifiers; calling `ids.next()` as well would desynchronise them.

## 6. Exit codes

Stable, and part of the contract. `doctor` picks the most severe code among failing checks, in
this order, and the recovery text it prints comes from the check that decided the code.

| Code | Name | Means |
|---:|---|---|
| 0 | `success` | — |
| 1 | `operationalFailure` | something went wrong that is nobody's decision |
| 2 | `invalidInput` | the command line, environment, or a file was not valid |
| 3 | `decisionRequired` | a human must choose: drift, or a declined confirmation |
| 4 | `capabilityUnavailable` | the host cannot run this product |
| 5 | `securityRefusal` | a path or command was refused by policy |
| 6 | `recoveryRequired` | an unfinished transaction or malformed state blocks progress |

Severity order for `doctor`: 6, 5, 4, 3, 2, 1.

## 7. What Foundation deliberately cannot do

Stated as capabilities that are *absent*, because "we did not implement it yet" and "it must
not exist here" look identical from outside and are not the same thing.

- **No network.** No HTTP client, no socket, no DNS. `tests/e2e/foundation.test.ts` scans
  every compiled non-test module in **every workspace under `apps/` and `packages/`** — for
  `node:http`, `node:https`, `node:net`, `node:tls`, `node:dgram`, `node:dns`, `node:http2`,
  `fetch(`, `XMLHttpRequest`, and `WebSocket`, and every command the suite spawns runs with
  all proxy variables pointed at a closed port.

  The workspace list is **discovered, not written down**, and that is the whole of the fix
  for the closed `BACKLOG.md` NEW-1: it used to be a hard-coded array of four directories, so
  `packages/brain` was added on 2026-08-07 and scanned by nothing while this paragraph
  claimed otherwise. The non-empty assertion is made per workspace rather than over the
  total, because a floor over the sum is satisfied by one populated directory while every
  other goes unread — which is how the gap stayed invisible. No module count is stated here
  any more: a number in prose that no test pins is the same defect in a different shape.

  **Amended 2026-09-28 (Spec 2, D72 P7(f)): one explicit exception.** The release transport
  (`packages/security/src/update/transport.ts`) is the product's only network module, and only
  `update` plan and apply compose it (§11). The same scan classifies it by name, and the lint
  gate's `inspectReleaseAuthoritySurfaces` (`tests/repository/check.ts`) holds both halves on
  every run: exactly that module reaches a network, and exactly `apps/cli/src/update/context.ts`
  composes it.
- **No agent integration.** Agents are *discovered* — `/usr/bin/which`, with a `PATH` and
  nothing else — and never executed. `AgentDiscovery.version` is permanently `null` in
  Foundation because determining it requires running the binary. Discovery that refuses, or
  finds nothing, is reported and never blocks a command: nothing in Foundation depends on an
  agent being present.
- **No modification of an existing vault.** When the vault does not exist, `init` creates it and
  installs the synthetic Brain template: four example notes, one note template, and eight
  `.gitkeep` files — one at the vault root, seven within `content/`. The example notes are
  canonical once indexed, the same as any note a user writes; what `init` will not do is touch a
  vault that already exists.
- **No credentials.** No Keychain, no token store. The protected-path policy refuses `.ssh`,
  `.aws`, `.gnupg`, `.env` and `.env.*` — but *not* `.envrc` or `.environment` — and three
  exact files (`.config/gh/hosts.yml`, `.codex/auth.json`, `.claude/.credentials.json`), on
  both the declared and the canonical path.
- **No scheduler, no Git mutation, no telemetry.**
- **No `--verbose`.** Design spec §8 lists it for every mutating command; dispatch is strict,
  so it exits 2. It belongs to the first subsystem with diagnostics worth printing.
- **macOS only.** `PlatformAdapter.inspect()` refuses any other platform with code 4.

## 8. Known residuals

Recorded rather than hidden. Each is reachable, none blocks the Foundation gate, and the first
three are the ones a user can hit.

1. **A crash between the transaction finalizing and the manifest write leaves an installation
   no command repairs.** The config exists, the journal says `finalized`, no manifest exists:
   `init` reports "already initialized", `doctor` says "run init", `uninstall` removes nothing.
   The remedy today is deleting the product home by hand.
2. **A managed artifact that is deleted blocks `init`.** `assertNoDrift` refuses on any finding
   including `missing`, while the revert deliberately skips `missing`. `doctor` carries the
   escape as recovery text; `init` should arguably re-create what is gone.
3. **A malformed journal cannot be repaired through the CLI.** `repair` reads the journal
   before checking its phase, so both actions fail with code 6 and no command quarantines the
   file. It wants a `repair --discard <id>`.
4. **`uninstall` leaves the product home and its three bookkeeping directories behind, and
   they are not empty.** `state/`, `staging/`, and `backups/` still hold both transactions'
   journals, the never-unlinked `.<id>.lock` files, and the staged blobs. `rmdir` refuses them
   because they are non-empty, so the product home refuses too, and the manifest is deleted,
   leaving residue no later run adopts or removes. No user data is lost and nothing is
   misreported, but "uninstall" does not mean "gone". Pinned by
   `tests/e2e/foundation.test.ts`.

   **The readable byte copy of `config.toml` is no longer among them, and this entry used to
   say it was.** `backups/` held it — the file names the user's Brain path — and
   `pruneBackups` removes every payload at both terminal phases as of 2026-08-17. What
   survives is the same content in `staging/`, which nothing removes, so the residual is
   narrower rather than closed: `tests/e2e/foundation.test.ts` now asserts both halves, an
   empty `backups/` copy list and a surviving staged one.

   **Disposition ratified 2026-08-26, implementation pending in DOS-P7.** Terminal collection is
   required, including exact staging/backup metadata, journals/plans, and per-ID stable locks; the
   global lifecycle lock alone remains permanent. The guarded, crash-resumable protocol, monotonic ID
   allocator, legacy planless-orphan cleanup, aggregate caps, and capacity reservation are in the
   active opt-in-surfaces design §2.4. This residual remains an observed fact about the current
   implementation until that plan ships.
5. **A `kind: "symlink"` artifact would delete its target, not the link.** Latent: Foundation
   emits no symlink artifacts. It lands in the Claude and Codex adapters, which will.
6. **Directory removal retains a check-to-use window.** Narrowed to one canonicalization before
   the `rmdir`; closing it entirely needs `unlinkat` against a directory descriptor, which Node
   does not expose.
7. **A relocated product home makes `uninstall` a no-op.** `isRemovableAt` requires
   declared-path containment while artifacts are recorded canonically, so
   `~/.developer-os -> ~/Dropbox/developer-os` preserves everything and still deletes the
   manifest. Fails closed.
8. **`assertRootsAnchored` is inert for a root named through `DEVELOPER_OS_HOME` or
   `DEVELOPER_OS_BRAIN`**, because such a root anchors to itself. It constrains symlink
   relocation of the default paths and of `config.brainPath` only. Through the CLI's default
   paths it is unreachable in practice: a product home that is a symlink is refused earlier, by
   the `lstat` check in `init`, with code 2.
9. **Configuration cannot be changed after `init`.** `config.toml` is a managed artifact and
   Foundation ships no command that edits it, so changing any setting means hand-editing a
   hash-tracked file — which drifts the manifest and makes `init`, `doctor` and `uninstall`
   all refuse, including the recovery `doctor` itself prints. Affects `git.enabled` and
   `automation.enabled` today. Found after Foundation closed; owner and full detail in
   [`foundation-constraints.md`](./foundation-constraints.md), "Found after Foundation closed".

## 9. Bootstrap and test-suite cost, measured

No earlier version of this file recorded a number here; this section exists because the
2026-09-05 bootstrap-performance program needed a baseline and found none to check itself
against. Every row below names the exact command that produced it, because a number without
its command cannot be reproduced or challenged.

`test:bootstrap` and `test:suite` are the two long-running `package.json` scripts outside
`npm test`. `test:bootstrap` runs `apps/cli/src/bootstrap/executor.test.ts` in two phases — the
single named case that retains a complete V2 handoff, then every other case in the file — and
must never be run as one untimed invocation; budget hours. `test:suite` is the main run,
excluding that file, `e2e`, and the vendor-ingest integration case. Both exercise the real
seven-phase transactional pipeline (section 3) against a real filesystem.

**Corrected 2026-09-07: that cost is CPU-bound, not fsync-bound, and this section said the
opposite.** The claim mattered, because it is what let the residual below be written off as an
inherent price of durability. Measured against the live `test:suite` worker of the 2026-09-07
gate: CPU time advanced 20.30 s in a 20 s wall window, a ratio of **1.01**, where a process
waiting on fsync sits near 0.1-0.3; a 5 s stack sample contained **zero** `fsync`,
`F_FULLFSYNC` or `uv_fs_fsync` frames; the heaviest leaf frame was
`node::encoding_binding::BindingData::EncodeUtf8String`, which is
`encoder.encode(encodeCanonicalJson(value))` at `apps/cli/src/bootstrap/journal-store.ts`; and
`MarkCompact` — major GC — appeared 109 times, matching the allocation counts in `BACKLOG.md`
NEW-53. The pipeline does fsync, through `handle.sync()` in `packages/core/src/transactions/`
and `packages/core/src/manifest/`; the time simply is not spent there.

The arithmetic already in this repository says the same thing and predates the profile.
`apps/cli/vitest.config.ts` records that **a real install writes its 73 files in about 0.8 s on
an idle disk**, while NEW-53 records that one `init` costs **roughly 101 s**. So about 99% of an
`init` is not disk, and NEW-53's own profile names what it is instead: **91,052,556 canonical
JSON key encodes** for those 73 files. Read the wall-clock rows below as measurements of that
overhead, not of durability.

| Measurement | Before | After |
|---|---|---|
| The plan's e2e target — `fresh V2 retained bootstrap lifecycle` in `tests/e2e/fresh-v2-retained-bootstrap.test.ts`, run with `npx vitest run tests/e2e/fresh-v2-retained-bootstrap.test.ts` | 299.5 s against its 600000 ms timeout (2026-09-04, recorded in `BACKLOG.md` NEW-53) | **141.00 s** (2026-09-06, 03:55:12→03:57:34, quiet machine, load average 2.5) |
| `npm run test:bootstrap`, whole script | ~169 minutes (2026-09-05; phase 2 alone measured 10010 s) | **127.5 minutes** (2026-09-06, 00:08:48→02:16:19) |
| `test:bootstrap` phase 1 — an internal proxy, **not** the plan's e2e target above; it is the single named case "publishes a complete V2 handoff and permanently retains its exact plan and two slots" inside `executor.test.ts`, run separately so its evidence is on record before phase 2 starts | ~118-127 s (2026-09-05) | 97.89 s (2026-09-06) |
| `npm run test:suite` | 54 minutes, 135 files, 4570 cases (2026-09-05); 41 minutes recorded at the prior program checkpoint | **35.4 minutes** (2026-09-06, 03:07:29→03:42:51), 133 files and 4583 tests passed |
| Eight retained-evidence cases timing out under full-suite parallelism | 300 s each (2026-09-05, `npm run test:suite` at load average 47 from several concurrent test runs) | **gone — they do not appear at all** (2026-09-06, `npm run test:suite` on a quiet machine, load average 2.4 at start) |
| Three uninstall cases previously timing out | 300 s each | 112.11 s, 117.25 s, 119.60 s (measured during Task 6, `npx vitest run apps/cli/src/commands/uninstall.test.ts`) |
| Evidence inspections per fresh `init` | 6 | **3**, counted by a test rather than estimated |
| Retention tree projections per inspection | 6 | **2** (the surviving anti-TOCTOU pair; **1** since D84, 2026-10-05 — see the D84 amendment below) |
| Retained-row lookups | 314 linear `Array.prototype.find` calls | **2** |

**The `test:bootstrap` whole-script run that produced 127.5 minutes and the 97.89 s proxy figure
contained a since-fixed regression.** That run reported `1 failed | 75 passed | 1 skipped`: Task 1's
change made one unrelated case, "refuses an unmatched post-terminal staging child before any
retained rename", start passing when it should refuse. The fix, commit `044f7d2`, was verified
only by re-running the named cases it touched in isolation, never by a second clean run of the
whole two-hour file — that cost is exactly what this program was trying to avoid spending twice.
The fix adds one per-root emptiness check to `buildBootstrapRetentionEvidence`, scoped to
`staging_subtree` roots only, which is unlikely to move wall time materially; so 127.5 minutes and
97.89 s are treated as expectations for the fixed code, not as measurements of it. The plan's own
final gate runs `test:bootstrap` again in full; that run will produce a clean number and
supersedes this one.

**The eight timeouts had two causes, and only one of them was the code.** They were first
measured while several vitest processes ran on the same machine at once — self-inflicted
contention that drove load average to 47 — and on a quiet machine, which is what a CI runner
gives each job, they do not reproduce at all. The other cause was real and Tasks 3-8 fixed it:
fewer redundant evidence inspections, tree walks, and linear scans in the retained-bootstrap
admission path. Anyone who sees one of these cases hit 300 s again should check the machine's
load average before concluding the suite regressed.

**Neither of the plan's two targets was met.** The targets were the retained-init e2e case —
`tests/e2e/fresh-v2-retained-bootstrap.test.ts` — under 60 s, and the whole `executor.test.ts`
file under 10 minutes. The e2e case fell from 299.5 s to 141.00 s, a bit over half, and is still
missed by more than double. The whole file fell from ~169 minutes to 127.5 minutes — a real,
measured 25% improvement (subject to the regression disclosure above) — and is still short of its
target by more than twelvefold. The shortfall is not the eight timeouts, which are gone; it is
the remaining ~126 minutes of ordinary cases in `executor.test.ts` phase 2, each paying the same
real journal/backup/stage/validate/apply/verify/finalize cost this program never targeted. Tasks
3-8 removed redundant computation inside that pipeline; they did not reduce the number of real,
fsync-backed transactions the file exercises, and that count is what phase 2's wall time is now
made of.

**Decision: no timeout changes.** Raising `executor.test.ts`'s or any case's timeout would hide
that remaining cost rather than pay it down, and every retained-evidence case that used to hit
300 s under contention now finishes in 112-120 s against the same 300 s budget — headroom, not
danger. Lowering that budget risks reintroducing exactly the flakiness the eight
now-unreproducible timeouts already demonstrated on a merely busy machine. No number measured
here justifies moving a timeout in either direction, so none moved.

**Amended 2026-09-07: the per-test budget moved from 300 s to 900 s, and the decision above is
why it took CI to justify it.** Every measurement behind "headroom, not danger" was taken on this
laptop. Run 34133320221 failed `apps/cli/src/commands/init.test.ts`'s "starts a distinct durable
bootstrap beside an untouched noncanonical pre-plan envelope" with `Test timed out in 300000ms`,
while the same case measures **121.21 s here in isolation**. Two factors multiply on a hosted
runner and neither was in the original reasoning: GitHub's `macos-15` was measured at **~1.9x**
this machine on 2026-09-07 (identical retained-evidence cases at 237,571 ms and 208,545 ms
against 112-120 s here), and this section already records full-suite contention pushing 112-120 s
cases to 300 s. 121 s x 1.9 x contention does not fit 300 s.

The distinction the original decision missed is what a per-test timeout is *for*. It guards
against a hang. It is not a performance bound — that is NEW-53's job, and nothing here accepts
the cost. A budget that fires on a healthy but slow machine reports a failure that did not
happen, which is worse than no signal: four hours of 2026-09-07 went into three CI cycles whose
red was entirely clock, not code. The budget now lives in one place,
`apps/cli/src/commands/testing.ts`'s `REAL_FILESYSTEM_TIMEOUT_MS`, rather than as the literal
`300_000` repeated at 24 sites across six files with a private copy of the same name in
`executor.test.ts`. Lower it only against a measurement taken on the slowest machine that runs
it.

**Added 2026-10-03 (NEW-133): a fresh `init` was retention-walk-bound, not fsync- or
osascript-bound.** A profile of `init --yes --adapters none` at `0b2d31df` found ~85% of its wall
time in bootstrap retention re-walking `state/`: ~19.9k `readdir`s of `state/` (≈6,645 walks of
≈466 entries), 3.09M `open`, 6.28M `lstat`, 6.18M `FileHandle.stat` and 2.88M reads for a home
that ends with 603 files. Each retained row ran `observe` twice and the final loop once more; each
`observe` projects the parent before and after; each projection walks twice and hashes every file.
Canonical-JSON comparison of those trees cost another ~31 s (`sameValue` 13.1 s, the `treeHash`
encode 10 s, key ordering 7.8 s).

The fix keeps every comparison and changes only their cost (option A, founder 2026-10-03):

- **Per-retainer content cache** (`BootstrapRetentionContentCacheV1` in
  `apps/cli/src/bootstrap/retention.ts`, created in `executor.ts` `retainTerminal`): a regular
  file's sha256 is reused while its bigint lstat key — dev, ino, size, mode, uid, nlink,
  mtime_ns, ctime_ns — is unchanged; a hit opens nothing. **Why a hit cannot hide a change:** a
  same-uid process cannot set ctime (`utimes` sets atime and mtime and itself moves ctime), and
  every write(2), truncate, chmod, chown or link change moves it; a replacement by rename has
  another inode. A changed file therefore misses and is hashed as before, so the before/after
  parent pair still detects a content change to any file in the observed tree. ctime has the
  filesystem's granularity — nanoseconds on APFS, one second on HFS+, two on exFAT — so a
  same-size rewrite inside one granule keeps the whole key; a file is therefore cached only when
  its ctime is more than two seconds older than the wall clock sampled before its read, and only
  when every stat around the read agrees on the key. (Review round 1 found the first version,
  which compared against the millisecond clock with no margin, defeated on an HFS+ image.)
  **Residual:** a writer that changes a file through a shared mmap without msync(2) may not move
  ctime until write-back; no writer of `state/` uses mmap. The cache lives in memory for one retainer; it is never persisted or shared
  across processes. `report.ts`'s evidence inspection does not use it.
- **One observation round for loops that mutate nothing**: the resumed prefix and the final check
  of `retainBootstrapEnvelope` project each distinct parent once before and once after all their
  rows (`BootstrapRetainer.observeAll`). The retain loop stays one row per round, because its
  rename and journal advance change `state/` between rows.
- **Fresh-walk comparison by hash**: two walks this code just made compare `treeHash`,
  `entryCount` and the root fields, since `treeHash` is sha256 over exactly
  `encodeCanonicalJson(entries)`. A postimage read from a table or journal keeps the full
  canonical comparison.
- **Canonical-JSON key order** sorts keys with no code unit at or above U+D800 by code unit,
  which equals UTF-8 byte order there, and encodes nothing; other keys keep the byte path. Output
  bytes are pinned against the previous algorithm.
- Directory entries are `lstat`ed eight at a time; results are processed in the same order.

| Measurement (this laptop, unsandboxed, load average 4-42 from other sessions) | Before (`0b2d31df`) | After |
|---|---|---|
| `init --yes --local-release <pkg> --adapters none`, `/usr/bin/time -l`, packed release, fresh `HOME` | 475.80 s, 522.71 s, 453.36 s | **135.96 s, 146.53 s** |
| `npx vitest run apps/cli/src/bootstrap/evidence-identity.v2.test.ts` (3 cases, real init) | 454.29 s | **180.75 s** |
| `doctor` on the resulting home | 16 pass, 3 warn, 0 fail | 16 pass, 3 warn, 0 fail |

**Residual.** A CPU profile of the fixed `init` (140.7 s) shows ~47 s on CPU and ~94 s waiting:
the per-rename `osascript` (~20 s) and fsync (~9 s) are untouched by design. The profile does
not attribute the rest of the wait; the largest known contributor is the retain loop, which
still walks the parent eight times per row (two `observe`s × before/after × the projection's own
first/second pair) — now `lstat`/`readdir` only for unchanged files, but still O(rows × tree) in
metadata calls. Dropping the projection's internal pair inside `observe`
would halve that; it is a founder decision, not taken here (taken since by D84, below). Option B (metadata-only parent
checks) was rejected. The content cache adds one detection residual: a change made through a
shared mmap without msync(2) may not move ctime before write-back, so it could be missed until
then; no writer of `state/` uses mmap.

**Amended 2026-10-05 (D84 (7)): one walk per directory projection; the anti-TOCTOU pair is
the before/after projection pair around each mutation.** `projectBootstrapRetentionPostimage`
used to walk a directory tree twice and refuse unless both walks agreed, so that each projection
proved the tree stable during its own observation. It now walks once. The protection against a
check-then-act race is argued from the projections that bracket each mutation alone:

- **Retain loop.** `BootstrapRetainer.observeAll` projects each distinct parent before and after
  all its rows' source and tombstone projections and refuses unless the two agree
  (`sameFreshProjection`: `treeHash`, counts and root identity), and the source or tombstone
  must equal the table's recorded postimage. `retain` renames only from such a `before`
  observation, then observes again and requires the `after` state, so the rename sits between
  two observations that each must match the table.
- **Evidence inspection.** `inspectBootstrapEvidenceAdmission` projects each path once per
  inspection (`memoizePostimageProjector`) and compares it with the postimage recorded in the
  retained table or journal; the Foundation terminal journal keeps its unmemoized before/after
  pair around its read. Retention tree projections per inspection: 2 → **1**, pinned by
  `report.test.ts`.
- **Content.** The NEW-133 content cache and its two-second racy-ctime margin are unchanged, so
  a changed file still misses the cache and is hashed again in whichever projection follows the
  change.

A regular-file projection still reads its file twice; that costs two reads of one file, not
two walks of a tree, and is unchanged. `projectRetainedDirectoryTree`, the test-only
expected-tree helper, keeps its own pair.

**Accepted residual.** A change that starts and reverts inside one observation — between the
before and after projections, or within a single walk — and leaves the tree byte- and
metadata-identical by the after projection is no longer detected; the removed second walk could
catch one that was still in flight when the first walk ended. Such a change leaves no state the
retainer acts on: what is renamed and recorded is what both bracketing projections saw. A
`state/` writer that could exploit it already has the same uid as the retainer.

| Measurement (this laptop, unsandboxed, exit 0 each) | Before (`cfc00068`) | After |
|---|---|---|
| `init --yes --local-release <pkg> --adapters none` from `npm run pack:local-release`, `/usr/bin/time -p`, fresh `HOME` | 296.93 s (load average 15-18); 199.55 s (load average 7-10) | **140.57 s** (load average 7-10) |

**Added 2026-10-04 (NEW-140): the ordinary-command gate scaled with retained envelopes.** With a
valid V2 manifest, `assertOrdinaryCommandAdmitted` read, decoded and fully admitted every retained
`fresh-v2-init.<id>.plan.json` before asking whether that plan published the current manifest. On
the founder home (nine envelopes, one per reinstall, ~4 MB) a counting profile put ~80% of the
~700 ms in nine whole-plan admissions (~85 ms each), the rest in nine canonical decodes (~9 ms
each), slot selection (~55 ms) and one structural manifest validation (~20 ms). The gate now
skips, before decoding, any plan whose bytes do not contain the current manifest's sha256: only
such a plan can pass `exactV2Handoff`, because admission keeps `manifest.after.hash` verbatim and
pins `manifest.manifestPath`, and `decodeCanonicalJson` accepts only byte-exact canonical JSON,
which never escapes a lowercase hex digit. No admit or refuse decision changes. Measured on that
home: gate 665-717 ms → 21-36 ms; `status` 0.90 s → 0.23 s. The cost left is one bounded read
per plan and the constant manifest validation; `evidence-identity.v2.test.ts` pins that added
earlier-install plans add no plan admission.

## 10. Lifecycle kernel (Spec 1a)

Plan 1a (Tasks 1–25, `43c6876..082e098`; the plan file was deleted 2026-09-26) shipped
the kernel this section describes, and plan 1b (Tasks 1–18 and 20, `5e6c9b2..d1b1e77`, phase close on
`bc17550`) filled its Git, launchd, automation and network-push slots. §4's "active opt-in-surfaces
design … normative; implementation remains pending" no longer holds for the surfaces named here; what
follows is the shipped contract, not the design intent. The last two bullets state what plan 1b added
and what still refuses. This section cites files without lines, by this document's own convention;
`foundation-constraints.md` and `threat-model.md` carry the bound-by-bound and boundary-by-boundary
record.

- **The bookkeeping set and its shape admission.** `LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS`
  (`packages/core/src/lifecycle/bookkeeping.ts`) is the closed set — `state/.lifecycle.lock`, the
  three journal roots, `state/transactions`, `staging`, `staging/lifecycle`, `staging/transactions`,
  `backups`, `backups/transactions` — and it is never a manifest row and never removed by uninstall
  (A12). Where no manifest exists, `inspectLifecycleBookkeepingShape` admits each member only by its
  exact shape: the lock as an owner `0600` zero-byte single-link regular file, every directory owner
  `0700`, and every child either a bookkeeping path, a retained-evidence path, an ancestor of one, or
  a bootstrap-participant lock/staging entry named by `LifecycleBookkeepingResidueV1`. Shape grants no
  authority by itself — a lock's liveness is decided only by acquiring it. The residue's participant
  IDs come from every reported fresh-init envelope, verified or `unverified`: from its plan when the
  plan bytes were admitted, otherwise derived from the init ID as the ordinal-0 pair
  `BootstrapExecutor` allocates (NEW-123). An `unverified` envelope's tombstones under
  `state/transactions` and its participants' staging and backup directories join the retained
  paths, so a fresh init that died after its handoff stays uninstallable in place (NEW-114). Once no
  live target is attributable to an `unverified` envelope, it no longer blocks a new intent: its
  retained tombstones (whatever their mode) and its bootstrap leaf count as inert residue, and a later
  `init` installs a new ID beside it, with both envelopes retained (founder decision B, NEW-123). Other
  residue named with its ID (a live staging subtree, a `.fresh-v2-init.<id>.*` leaf) still blocks, and
  `altered` envelopes are unaffected. Evidence: `apps/cli/src/bootstrap/executor.test.ts` —
  `installs a new ID beside the unverified envelope after its uninstall, retaining both (NEW-123)`.
- **The two present-manifest uninstall variants and their derivation (D24).** `deriveVariant`
  (`apps/cli/src/lifecycle/uninstall.ts`) calls Core's `deriveUninstallLaunchdEvidence` on the
  observed manifest's plist rows, the validated configuration's `automation.lifecycle` record, and
  the activation record; it never hand-computes the disjunction. With no launchd evidence it selects
  `uninstall/present_manifest_without_launchd` (a null launchd arm, empty `plistPaths`,
  `previewHash: null`, D24). A plist row or an automation arm selects `uninstall/present_manifest`
  (`P`), which plan 1a refused and plan 1b Task 18 admits: `planUninstallLaunchd` plans the unload of
  every manifest-owned generated label through a `LaunchdEffectPlanV1` before the lease drain. The variant is
  derived once, at planning time, because the evidence it reads is gone by the time recovery would
  need to re-derive it; the plan hash binds the shape instead.
- **The empty-directory removal inside `M(finalize_tombstones)` (D25).** `finalizeUninstallTombstones`
  (`apps/cli/src/lifecycle/uninstall.ts`) authenticates the preimage manifest by SHA-256 against the
  tombstone alone — never a live read — then removes every directory row of that preimage, deepest
  first, through the guarded `removeDirectories`, excluding the bookkeeping set. A non-empty
  directory is preserved and reported rather than emptied; recovery re-derives the same list from the
  still-present tombstone, so a death mid-removal resumes deterministically.
- **The `mf` reservation order (D28).** The manifest participant's allocated ID is reserved last in
  the coordinator's one contiguous ID block, after `lc` and every `tx` ID: `formatAllocatedLifecycleId`
  is called with `"mf"` only once the four Foundation IDs are already bound
  (`apps/cli/src/lifecycle/uninstall.ts`). The reserved-prefix order for the present-manifest,
  no-launchd coordinator is exactly `lc, tx, tx, tx, tx, mf`.
- **The capacity refusal (D26, D45).** `MAX_UNINSTALL_ARTIFACTS` is 31 `F(uninstall_artifacts)`
  steps of 256 mutations, 7,936 (`apps/cli/src/lifecycle/uninstall.ts` — `MAX_UNINSTALL_ARTIFACTS`);
  `LifecycleUninstaller.preview` throws `UninstallCapacityError` (`reason:
  "uninstall_artifact_capacity_exceeded"`, exit 4) before any ID is reserved when the partitioned
  artifact mutations exceed it. D45 replaced the single 256-mutation step; NEW-85 closed 2026-09-26.
- **The non-creating global lock and lock order.** `packages/core/src/lifecycle/locks.ts` states the
  rule its types enforce: the global lock at `state/.lifecycle.lock` is created only by Spec 2's
  fresh `init`, so every other acquirer opens an existing path without `O_CREAT` and refuses
  `lifecycle_lock_missing` or `lifecycle_lock_busy` (both exit 6) rather than creating or waiting past
  a deadline. `MacOsStableLockProvider.acquireExisting` (`packages/platform-macos/src/stable-lock.ts`)
  opens with `O_RDWR | O_NOFOLLOW` and nothing else — no `O_CREAT` appears anywhere in that class.
  The creating provider, `MacOsTransactionLockProvider` (`packages/platform-macos/src/transaction-lock.ts`),
  is wired as `transactionLocks`/`lockProvider` in the CLI's production composition root
  (`apps/cli/src/context.ts`), and the one call site that uses it to create the global lock is the
  fresh-`init` executor's `acquireLifecycleLock` (`apps/cli/src/bootstrap/executor.ts`); every
  lifecycle service reached after install — the mutation gate, `config`, uninstall and its
  recovery-only arm — acquires the same path only through `MacOsStableLockProvider`. Order (Global
  Constraints): runner lease → global → transaction-specific; uninstall acquires leases only while
  holding no global lock, and its lease drain is bounded by one absolute ten-minute deadline.
- **Structural V2 admission.** `admitInstalledV2Home` (`apps/cli/src/lifecycle/admission.ts`)
  replaced the deleted `admitV2Handoff`; §4 above ("`admitInstalledV2Home` admits an installed V2
  home structurally") already carries its full contract and refusal table, including the closed
  `V2HomeAdmissionReasonV1` union and `LIFECYCLE_RESERVATION_ROWS`'s 52 exact entries.
- **The mutation gate every V2 Foundation mutator passes through** (`apps/cli/src/lifecycle/mutation-gate.ts`).
  `withLifecycleMutation` runs, under one held global lock acquired with `acquireExisting` (never
  `O_CREAT`): re-admission and lock identity agreement, `requireLifecycleStagingRoot`,
  `LifecycleRecoveryService.recover(global, { resumeUninstall: false, standaloneFoundationId })`, a
  closure requirement of `clear` — or, for `repair`, that the one non-terminal standalone Foundation
  journal named by `resolution.standaloneFoundationId` is the *only* non-clear item
  (`requireResolvedClosure`) — and only then `assertLifecycleCapacity` plus
  `reserveLifecycleIdBlock(1)` inside `allocateStandaloneFoundationId`, which issues exactly one
  allocated `tx_<nonce>_<counter>` ID per mutation and throws on a second call (`live`/`allocatedIdOnce`).
  `capture`, `ingest`, `review`, `reindex`, `config set` and the V2 downcast `uninstall` (until Task
  22 replaced it with a coordinator) all reach it via `createGatedTransactionExecutor`; `repair
  --resume|--rollback <id>` is the explicit resolution of exactly that standalone journal, dispatched
  from `apps/cli/src/commands/repair.ts`. A non-terminal standalone Foundation journal outside that
  resolution, or a non-terminal uninstall coordinator, refuses exit 6 naming `developer-os repair
  --resume <id>`/`--rollback <id>` or `developer-os uninstall`. The `retry_only` closure kind
  (`packages/core/src/lifecycle/ledger.ts`, `classify`) is the healthy, retryable state of a
  coordinator stuck on a failed `network_push`/`destination_git_effect` step. Since plan 1b it is
  reachable in production: a `git sync` whose push fails leaves the persisted push plan and a
  `retry_only` closure, and the next sync retries only that push. Commit `11f1b55` (`packages/core/src/lifecycle/recovery.ts`) fixed `recover()`'s
  `collectCoordinator` to leave such a coordinator alone rather than throw
  `lifecycle_coordinator_not_terminal`, by reusing the inspected snapshot's own `closure` instead of
  re-deriving the condition.
- **The closed `config` key and result grammar.** `CONFIG_MUTABLE_KEYS` and `ConfigRefusalReasonV1`
  (`packages/core/src/config/keys.ts`) are the closed sets `runConfig`
  (`apps/cli/src/commands/config.ts`) reads and refuses against. `admitV2Home` refuses a V1 manifest
  with `manifest_v1_not_migratable` (exit 4) before any lock, and a manifest-absent home takes the
  existing global lock only to reclassify and release it (`reclassifyUnderGlobalLock`), never to
  create one. `get` on a V2 home takes no lock; `set` runs one standalone Foundation transaction
  through `withLifecycleMutation`, guarded by the pre-read `expectedBeforeHash` (`applyConfigValue`).
  Success output is exactly `encodeCanonicalJson(result)`, with or without `--json`; refusals use the
  standing error envelope.
- **The uninstall variants, point of no return, lease drain, and absent-manifest arms.**
  `LifecycleUninstaller` (`apps/cli/src/lifecycle/uninstall.ts`) plans and executes the
  present-manifest coordinator described above; `dispatchUninstall`
  (`apps/cli/src/lifecycle/uninstall-recovery.ts`) routes a V1 manifest to the unchanged Foundation
  path, a V2 manifest to that coordinator (resuming a non-terminal one rather than starting a
  second), a missing manifest with a live uninstall coordinator to the recovery-only arm
  (`admitRecoveryOnlyUninstall`, admitting only `compensation`, `force_forward` or `envelope_suffix`
  per §2.1's microstates), and a missing manifest with nothing of ours to the absent-manifest arms —
  which never acquire the permanent global lock. `runAbsentManifestUninstall`
  (`apps/cli/src/lifecycle/absent-manifest-uninstall.ts`) has no coordinator envelope at all (A3):
  `key_absent` performs two identical read-only walks and creates nothing; `key_present` acquires
  only the transient bootstrap leaf, repeats the walk under it, and deletes the redaction key by
  rechecked `dev`/`ino` identity without reading a byte of it. Any other residue — V1 Foundation
  leftovers, a plist, an attributed bootstrap leaf — refuses exit 6 with D20's archive guidance and
  changes nothing.
- **What plan 1b added: Git, launchd and scheduled automation.** The five step kinds plan 1a refused
  (`source_git_effect`, `destination_git_effect`, `launchd_before_files`, `launchd_after_files`,
  `network_push`) are real leaves. `LifecycleExecutionPlanV1` (`apps/cli/src/lifecycle/codecs.ts`)
  binds `LaunchdPlanV1` and `PersistedGitPushPlanV1`, and `createLifecycleEffectAdapters`
  (`apps/cli/src/lifecycle/adapters.ts`) wires the Git and launchd effect executors and the push into
  the coordinator, so the mutation gate's recovery can finish a non-terminal Git or launchd
  coordinator. The effect journals are `state/git-effect-journals` (`GitEffectJournalV1`,
  `packages/core/src/git/effect-journal.ts`, at most `MAX_GIT_EFFECT_JOURNAL_BYTES`, 16 MiB) and
  `state/launchd-effect-journals` (`LaunchdEffectJournalV1`,
  `packages/platform-macos/src/launchd/effect-journal.ts`, at most `MAX_LAUNCHD_EFFECT_JOURNAL_BYTES`,
  1 MiB), both inspected by the ledger. **Amended 2026-09-28 (NEW-113 review finding 1):**
  `LaunchdEffectJournalV1.launchctlIdentityHash` records the `launchctl` identity the journal was
  opened with (`null` exactly for a zero-transition effect). A resumed `apply` or `compensate` whose
  freshly admitted `launchctl` differs — a macOS update between a killed run and its resume — refuses
  `unsupported_launchd_distribution` with the manual `launchctl bootout gui/<uid>/<label>` for every
  label the plan may have loaded (`refuseUnsupportedLaunchd`, mapped in `createLifecycleEffectAdapters`),
  instead of recovery-required `launchd_process_table_changed`, which still covers a changed staging
  identity. The field changes `maximumLaunchdEffectJournalBytes` and therefore every launchd effect
  plan hash; no migration exists because no production launchd effect journal was ever written
  (automation had never been enabled on any install). `LifecycleUnsupportedLeafError` is still defined in
  `codecs.ts` but nothing throws it, so `unsupported_until_plan_1b` is no longer a reachable reason.
  - **Commands.** `git enable|disable|status|sync` (`createGitService`,
    `apps/cli/src/commands/git/service.ts`) and `automation enable|disable|status`
    (`createAutomationService`, `apps/cli/src/commands/automation/service.ts`), each a byte-inert,
    allocation-free preview and an `--apply` that re-acquires the global lock, recomputes the
    preview hash, proves feasibility, and only then reserves IDs and persists the plan. The hidden
    scheduled runner (`AutomationRunner`, `apps/cli/src/commands/automation/runner.ts`) runs Spec 1
    §5.1's four jobs (`brain-reindex`, `brain-lint`, `doctor`, `git-sync`) and, since NEW-134
    (2026-10-01, D77), two optional ones in registry order after them: `brain-garden` (one isolated
    vendor call whose validated proposals become quarantined captures) and `brain-pulse` (an
    agent-free health report in `state/pulse.0.md`…`pulse.7.md` with a macOS notification on
    attention or failure). Optional jobs are scheduled only when named
    (`--schedule brain-garden=weekly@sun,17:00`) and removed with `--schedule <job>=off`;
    `automation enable` pins the gardener's vendor executable in `automation.brainGarden` (re-pinned
    only with `--garden-agent` or when the job is newly scheduled, so switching vendor goes with a
    schedule change). The pin is Claude only, run with `--tools ""`: Codex is refused at enable
    (`capability_unavailable`) and a Codex pin at run time is `garden_agent_unsupported`, until Codex
    offers a tool-free mode (Ruling 38). The pin is part of the automation activation hash, so editing
    `automation.brainGarden` in `config.toml` after enable makes every scheduled run
    `automation_disabled` until `automation enable` runs again (Ruling 37). Every job's status, lease and log slots, and the pulse slots, are manifest
    reservations, so an installation made before NEW-134 refuses admission
    (`reservations_incomplete`) until it is reinstalled. `import` and `ingest` are never scheduled
    (D47).
  - **Inert until enabled.** Schema-valid `git.*`/`automation.*` configuration is never authority by
    itself: operation needs the matching `LifecycleActivationRecordV1` arm and a clear closure. A
    disabled Git spawns no Git process and opens no network connection; disabled automation writes no
    plist, starts no process and writes no status.
  - **Held-lock reuse.** Apply and sync functions take an already held global lock. A scheduled
    handler runs under the lock its runner holds: `withLifecycleMutation` accepts the borrowed lock and
    checks its `dev`/`ino` against the lock path instead of taking a second `lockf`, which would report
    busy in the same process. The runner waits at most `SCHEDULED_GLOBAL_LOCK_WAIT_MS` (ten minutes)
    and otherwise exits silently (`ScheduledSilentReasonV1`); an interactive command meeting a
    scheduled holder refuses exit 6 `lifecycle_lock_busy` as before.
  - **Runtime records.** `AutomationRuntimeRecordStore` (`apps/cli/src/lifecycle/runtime-records.ts`)
    writes the per-job status (≤ `MAX_AUTOMATION_STATUS_BYTES`, 64 KiB) and ten rotated log slots
    (`AUTOMATION_LOG_SLOTS`, ≤ `MAX_AUTOMATION_LOG_BYTES`, 1 MiB each), redacted before they are
    bounded; each job runs under its `AutomationRunnerLeaseV1`, the lease uninstall drains.
- **Which Git, `ssh` and `launchctl` run: fixed-path admission (D65, D71; NEW-113's code, 2026-09-28).**
  The exact macOS build plus binary SHA-256 pin of D59 is gone; Spec 1 §4.2 and §5.3 "Amended
  2026-09-28 (D71)" and their D71 addendum are normative. What the code relies on:
  1. **One per-platform table.** `SystemExecutableRowV1` and the `posix_root_owned` predicate live in
     `packages/security/src/system-executables.ts`; the `darwin` rows are `DARWIN_SYSTEM_EXECUTABLES`
     in `packages/platform-macos/src/system-executables.ts`. That table is the platform seam:
     `admitGitExecutables` (`apps/cli/src/commands/git/runtime.ts`) and the launchd `schedulerRow`
     (`packages/platform-macos/src/launchd/distribution.ts`) read it directly, and `PlatformAdapter`
     carries no system-executable method (NEW-117 removed three that had no production caller). Four
     rows are implemented: `git` `/usr/bin/git`, `git-receive-pack` `/usr/bin/git-receive-pack` (both
     Apple shims following the `xcode-select` choice), `ssh` `/usr/bin/ssh` and `scheduler`
     `/bin/launchctl`. Linux (`/usr/bin/git`, `/usr/bin/ssh`, systemd user units) and Windows
     (`%ProgramFiles%\Git\cmd\git.exe`) are recorded in the spec as intended, not implemented; no
     contract field names a macOS build, an Xcode version or a certificate. `PATH`, `DEVELOPER_DIR`
     and `xcrun` are never consulted, and every Git child environment is an exact profile, so no
     `xcrun`-steering variable reaches the shim.
  2. **`posix_root_owned`.** The path is a regular file (a symbolic link refuses), uid `0`,
     `(mode & 0o022) == 0`, owner-execute set, neither setuid nor setgid; each ancestor (`/`, `/usr`,
     `/usr/bin` for Git and ssh; `/`, `/bin` for `launchctl`) is a uid-`0` directory with
     `(mode & 0o022) == 0`.
  3. **Floors and a probe, no ceiling.** Git `2.54.0` with `(Apple Git-<n>)`, `n >= 157`, read from
     `git --version --build-options` through the shim, which must also print `cpu: arm64`,
     `shell-path: /bin/sh`, `default-hash: sha1` and `default-ref-format: files` exactly once (other
     lines ignored, more than 32 or a non-zero exit refuses); ssh `OpenSSH_10.3p1`; macOS
     `ProductVersion >= 26.6.2`, with `ProductBuildVersion` recorded and never compared. Policies:
     `GIT_DISTRIBUTION_POLICY` (`apple-git-arm64-v2`, process table `apple-git-process-v2`) and
     `LAUNCHD_DISTRIBUTION_POLICY` (`launchctl-macos-preview-v2`, `launchctl-macos-path-v1` since D82); an old
     ID in a persisted plan or journal refuses.
  4. **Evidence per invocation, rechecked before every exec.** Admission returns
     `AdmittedSystemExecutableV1` (`dev`, `ino`, `size`, `sha256`). Git holds it in memory for one
     top-level invocation and never persists it, so a `push_pending` retry after a macOS or Xcode
     update re-admits. `GitProcessSupervisor` stays synchronous: it rechecks each admitted file
     before every real exec through the synchronous pair `inspectSystemPathSync` /
     `recheckSystemExecutableSync`, whose digest cache is keyed by the file's full identity including
     `mtimeNs`/`ctimeNs`. Launchd binds `LaunchctlIdentityV1` into the execution table through
     `processTableHash` (the template and preview carry only the `launchctl_identity` slot, so two
     admitted Macs hash equal) and `recheckLaunchdHost` compares it before every process;
     `LaunchdEffectJournalV1.launchctlIdentityHash` (above) makes a resume on a changed `launchctl`
     refuse with the manual `bootout` list. The production launchd runner spawns `/bin/launchctl`
     and nothing else (`launchctlRunner`, `apps/cli/src/lifecycle/adapters.ts`).
  5. **What still refuses.** `certification` is removed; the bootstrap contract (D82: path plus post-check)
     is enforced on every run by the post-bootstrap verification and observation, whose failure compensates and refuses
     `unsupported_launchd_distribution`. A host below a floor names the manual
     `launchctl bootout gui/<uid>/<label>` per installed label (Spec 1 residual 10). Only the
     local/file Git transport is traced: `git_remote_https` has no row and an HTTPS or SSH remote
     refuses `unsupported_git_distribution` (D59 Q4-A, D71 Q4). Accepted: the Git tree behind the
     shim is not admitted by mode (residual 13), and the shim still decides its developer directory
     (residual 14). Tests that exec the real binaries are `*.pinned-host.test.ts`, run by
     `npm run test:pinned-host` on any admitted host (refusing, never skipping, below a floor) and
     never by hosted CI; the Phase 9 gate on a disposable account (NEW-113's Task 5) was skipped
     when NEW-113 closed under D76 (2026-09-29), so the first enable on any Mac is the first real run.

## 11. Release, update and rollback (Spec 2)

**Added 2026-09-28** by NEW-110 Task 12, carrying the contracts of Spec 2
(`docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md`, amended by D72 P1–P9)
that the shipped code now implements. The spec stays normative for every literal while Task 11b
and NEW-112 depend on it; this section is what a reader of the code needs.

### 11.1 The installed release

- **Layout.** A release lives at `releases/<version>/darwin-<arch>/` with its three signed metadata
  documents retained under `state/release-metadata/`. `state/active-release.json` names the one
  active release, `state/release-trust.json` holds the trust high watermarks, and
  `state/update-rollback.json` plus `rollback/<payload-id>/` hold the one retained rollback set.
  `state/update-executor.json` names the recovery executor while an update runs. Each is written
  only by a coordinator step; nothing else mutates them.
- **Trust.** A release is admitted only through the signed chain: an offline root (the launcher's
  FD 3 handoff) delegates one release key, which signs the release index, which names each
  bundle's archive and manifest by size and SHA-256 for both `arm64` and `x64`. Delegation, index
  and accepted-release sequences are high watermarks: a lower one refuses as replay (exit 5), and
  trust never moves backwards — not on compensation, not on rollback.
- **Architecture.** The installed release's architecture selects the bundle (`arm64` is ordinal 0,
  `x64` ordinal 1 in every index entry); the bundle manifest, the release identity and the bundle
  root carry it, and a bundle, archive or manifest of the other architecture refuses.

### 11.2 `update` and `update rollback`

- **Plan-only by default.** `update` reads the home, the FD 3 trust, the signed metadata and the
  bundle, runs the target planner over one attempt-owned scratch and prints a preview; it writes
  nothing durable. `update rollback` reads only retained local evidence: no FD 3, transport,
  scratch or planner.
- **Apply.** `--apply` heals any update residue first, then revalidates under the global lock: a
  clear V2 closure, the same home, the same retained evidence, and a planner rerun whose
  transcript and candidate equal the preview's. It reserves one allocator block for every prefix
  (D72 P7(e)), composes every leaf plan and the construction plan (`apps/cli/src/update/compose.ts`),
  rechecks exact capacity, stages the construction envelope and hands off to the V2 coordinator.
- **Forward order** (§9.3): bundle, owner files, rollback payload, the transitional manifest
  (preserve, publish), trust, rollback record, active, target verifier, recovery executor switch to
  the fallback, terminal retirement of the prior rollback set, the terminal manifest (publish,
  finalize tombstones). **Rollback order** (§10.2): verify the previous bundle, the retained payload
  and the record in place, owner files inverse, the transitional manifest, the previous active
  record, the previous verifier, the executor switch, retirement of the consumed set and the
  rejected release, the terminal manifest.
- **The point of no return** is the target verifier's durable success. A failure before it
  compensates to the old release (trust stays advanced); after it every step force-forwards. A
  resumed run reports the exit class of the persisted `compensationCause` (D72 P7(b)): a verifier
  rejection is exit 5, anything else exit 1.
- **Fallback handoff.** Production binds `--apply` with no fallback until Task 11b extends the
  launcher's FD 3 document, so it refuses `update_fallback_unavailable`, exit 4, before any write
  (D72 P7(d)). Only the synthetic fixture supplies one.
- **Codex.** A Codex tree change re-registers the plugin exactly once (`codex-adapter.md` §14).

### 11.3 The D72 rules the code relies on

- **P1** — source parents are construction directories; a source executor takes a parent's identity
  only from the construction journal, never from a use-time `lstat`.
- **P2** — a lifecycle manifest postimage carries no inode; its identity comes from reopened
  construction evidence (`lifecycleIdentity: "construction_evidence"`), while Spec 1's Git and
  automation plans keep `"inline"`.
- **P3** — the four `manifest/*` steps run over two plans, transitional and terminal; the terminal
  set is the transitional set minus exactly the retired partition, or the handler refuses exit 6.
- **P4** — the three signed metadata documents are construction `plan_derived` rows with the role
  `release_metadata_after`, bound to their signed hashes.
- **P5** — an ephemeral reservation may be absent or empty; `keep` never reads or hashes it, so a
  home without `state/update-rollback.json` or `state/git-sync.json` updates.
- **P8** — admitted bookkeeping paths carry their planned identity (NEW-86).
- **P9** — rollback restores each owner file from its retained blob, reopened no-follow under
  `rollback/<payload-id>/blobs/` and bound to the retained inventory; owner and migration slots
  follow the operation.

### 11.4 Exit codes on the update surface

Spec 2 §11's mapping on top of §6: 1 for a bounded transport interruption or a failure after a prior
capacity check; 2 for a malformed request, a nonexistent release or a downgrade; 3 for managed
drift, a post-update edit blocking rollback, or a Codex registration that is not `registered`; 4
for an unsupported architecture, a launcher or protocol too old, or no fallback handoff; 5 for any
signature, checksum, origin, archive, process or verifier refusal; 6 for an incomplete or
contradictory journal, a third state, missing rollback evidence, or malformed trust, active or
manifest state. Messages carry fixed reason codes only.

### 11.5 Accepted residuals (Spec 2 §13.3, unchanged)

No first-observation freeze resistance; one root and one active release key; one previous version
only; rollback never merges; one fixed online source; the signed target planner is not OS-sandboxed;
protocol growth refuses until the launcher upgrades; publication is A16's; the `symlink` artifact
arm is validated but unreachable (held as an exact set by `tests/security/symlink-escape.test.ts`);
two V2 Foundation ref types.

### 11.6 Proof scope (D72 P7(f))

Spec 2's §12 gate is proven on the synthetic release for both architectures: install, preview and apply,
a second apply, rollback, reapply and uninstall (`tests/e2e/release-update.test.ts`); every durable
death point of apply, rollback and a verifier-rejected update recovers
(`tests/integration/update/recovery.test.ts`); the signature chain runs through the production
transport (`tests/integration/update/signature-transport.test.ts`); archives and the planner's
request/result binding for both architectures (`tests/integration/update/archive-planner.test.ts`).
The synthetic home carries the core owner only. The Git and automation leg joins with NEW-113, and
the real-release half waits for Task 11b and A16.

## 12. Instruction artifacts (A12)

**Added 2026-09-29**, carrying the contracts of the A12 design (approved D47, amended D51 and D62)
that the shipped code implements; the spec retired on 2026-09-29
(`git show 59a6be11:docs/superpowers/specs/2026-09-22-developer-os-instruction-artifacts-design.md`)
and this section is the contract. The block grammar lives in Core beside drift; each adapter
renders its own vendor tree (`claude-adapter.md` §18, `codex-adapter.md` §16) and imports neither
the other adapter nor the CLI.

### 12.1 Sources and bounds

- **Defaults** are the release's `instructions/` tree, read only through the admitted release
  (`apps/cli/src/instructions/sources.ts` — `loadInstructionDefaults`); the working tree is never
  read. The catalog is strict
  (`packages/core/src/instructions/catalog.ts` — `validateInstructionCatalog`): `schemaVersion: 1`,
  rows `{ category, id, legacyName, vendors, thinCommand }` sorted and unique, `thinCommand` only
  on a `skill`. A file no row claims, or a row with no file, refuses `instruction_catalog_invalid`,
  exit 2. `plugins/claude/` and `plugins/codex/` are rendered from the defaults alone.
- **Overrides** live under `<product-home>/instructions/<vendor>/`, in the category directories
  `rules`, `scoped-rules`, `output-styles`, `agents` and `skills`; the id is `<id>.md` or the skill
  directory name (`apps/cli/src/instructions/sources.ts` — `loadInstructionOverrides`). An override
  with a default's `(category, id)` replaces it on that vendor, a skill as a whole directory
  keeping the default's `thinCommand`; a new pair adds an artifact; both record `source: "user"`.
  An unknown category directory refuses; a category the vendor lacks (Codex `output-styles`) is
  reported `unsupported-vendor`. The product never creates, edits or deletes anything under the
  tree, it is never a manifest row, fresh `init` admits it as opaque user data, and the
  absent-manifest walk classifies it as user data
  (`packages/core/src/lifecycle/absent-manifest.ts` — `USER_DATA_HOME_ENTRIES`).
- **Bounds** (`packages/core/src/instructions/bounds.ts` — `INSTRUCTION_BOUNDS_V1`): an id matches
  `^[a-z0-9][a-z0-9-]{0,63}$`, is not prefixed `developer-os-` and names no workflow; a relative
  segment matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` at depth ≤ 4; a file is ≤ 256 KiB of UTF-8
  with no BOM, NUL or CR; a skill is ≤ 64 files and ≤ 1 MiB; a vendor after the merge is ≤ 128
  artifacts and ≤ 8 MiB; a scoped rule's `paths:` holds 1 to 32 globs of ≤ 256 bytes; rule and
  scoped-rule text may not contain a block marker. A violation refuses
  `instruction_source_invalid`, exit 2, naming path and line only. The rendered Codex block body
  is ≤ 64 KiB (`instruction_block_too_large`, exit 2). A product home whose segments are not all
  `[A-Za-z0-9._-]` cannot appear in a Claude `@` line and refuses
  `instruction_path_not_importable`, exit 2.
- **Redaction.** `tests/repository/instruction-defaults.test.ts` scans `instructions/` and
  `templates/project/` on every run. A commit that adds or changes a default also runs the same
  scanner with a private pattern file kept outside the repository, `--patterns <file>`
  (`tests/tools/scan-instruction-defaults.ts` — `scanInstructionDefaults`), and records the command
  and its zero finding count. The author of a default never opens a legacy path; the founder
  supplies legacy text through a copy outside the repository.

### 12.2 The marked block

- **Grammar** (`packages/core/src/manifest/instruction-block.ts` — `extractInstructionBlock`):
  `<!-- developer-os:begin v1 -->`, a managed-by header line naming
  `<product-home>/instructions/<vendor>/`, the body, `<!-- developer-os:end v1 -->`. It is
  well-formed when each marker occurs exactly once on its own LF-terminated line, begin before
  end; the block's bytes run from the begin line through the end line's LF. Any other count or
  order is malformed.
- **First insertion**
  (`packages/core/src/manifest/instruction-block.ts` — `insertInstructionBlock`) appends after the
  file's final LF, adding one LF first if a non-empty file lacks it; that LF is the only byte an
  install and uninstall cycle may leave. A missing file is created holding only the block.
- **Merge** (`packages/core/src/manifest/instruction-block.ts` — `decideInstructionBlockMerge`),
  base = the row's `blockHash`: malformed markers refuse `instruction_block_malformed`, exit 3;
  absent markers re-insert the proposal (reported `restored` when a base exists); a current block
  equal to the proposal writes nothing; equal to the base, it writes the proposal; anything else
  refuses `instruction_block_conflict`, exit 3, with conflict evidence: three hashes and a redacted
  two-way diff bounded at 1 MiB and 1,000 lines. The write is one `replace` of the whole file
  guarded by the whole-file hash read at plan time, so a concurrent edit anywhere refuses. Every
  exit-3 refusal carries one recovery text
  (`apps/cli/src/instructions/attach.ts` — `instructionConflictRecovery`): move the edits into
  `<product-home>/instructions/<vendor>/`, delete the whole block, re-run.

### 12.3 `init` installs and reconciles

- `init --adapters <claude,codex|claude|codex|none>`
  (`apps/cli/src/instructions/apply.ts` — `parseAdaptersFlag`; any other value
  `adapters_flag_invalid`, exit 2). A fresh `init` without the flag selects `none`, writes nothing
  into a vendor home and names the flag; a re-run without it keeps the stored `adapters.*`. A
  selected vendor whose CLI is absent, unreadable or below its floor refuses
  `adapter_unavailable`, exit 4, before any mutation; no admitted release refuses
  `packaged_release_unavailable`, exit 4; a release whose version or `releaseIdentityHash` differs
  from the installed one refuses `release_mismatch`, exit 4
  (`apps/cli/src/instructions/apply.ts` — `assertInstalledRelease`).
- The step runs after the bootstrap handoff, is not in `INIT_OWNED_CHECKS`, and its failure never
  reverts the installed home; `init` exits with its code. On an installed V2 home
  (`apps/cli/src/commands/init.ts` — `settleExistingV2`) drift in a `claude` or `codex` row is
  left to the planners below; drift in any other row still refuses.
- `apps/cli/src/instructions/apply.ts` — `applyInstructions` runs, each under its own gate entry:
  detach every deselected vendor (§12.4); attach the selection as one Foundation transaction
  (`apps/cli/src/instructions/attach.ts` — `planInstructionAttach`: every file, both blocks, any
  whole-file backup, the `adapters.*` values and the manifest rewrite); then register Codex
  (`codex-adapter.md` §16). An unchanged re-run writes and registers nothing.
- **Content targets.** An unmanaged entry refuses `instruction_target_occupied`, exit 3, and is
  never adopted; a managed file the user edited refuses `instruction_target_drifted`, exit 3; a
  deleted managed file is re-created (`restored`); a row the render no longer produces is removed
  unless edited.
- **Parents.** A missing parent of an authorized target becomes a `directory` row; the caller
  creates it `0700` before `execute()` (the executor creates no directory) and removes the ones it
  created, deepest first, if the transaction refuses. A parent that already exists is never a row.
- **Backups.** A pre-existing vendor file's whole-file backup is the content-addressed
  `backups/instruction-<owner>-<sha256>`, reused when identical, admitted by the bookkeeping shape
  (`packages/core/src/lifecycle/bookkeeping.ts` — `INSTRUCTION_BACKUP_NAME`), never restored.

### 12.4 Detach and `uninstall`

- `apps/cli/src/instructions/detach.ts` — `planInstructionDetach` removes the detached vendor's
  rows outside the product home, plus the Codex home record when Codex detaches. A drifted content
  file refuses `managed_drift`, exit 3; a vanished one drops its row. A block equal to its base is
  stripped (`replace` with the file minus the block, or `remove` when the product created the file
  and nothing remains); absent markers drop the row; malformed markers or an edited block refuse
  exit 3, an edit with conflict evidence. The same transaction sets the vendor's `adapters.*` to
  `false`. After the commit, product-created directories the plan emptied are removed deepest
  first; any others are kept and reported. Codex is unregistered before any file changes.
- `uninstall` detaches both vendors before the drained uninstall
  (`apps/cli/src/lifecycle/uninstall.ts` — `detachVendorInstructions`), which then sees only
  product-home rows; its dry run and prompt preview do not detach. A vendor's product-home rows
  (`<product-home>/claude/instructions/`, the Codex marketplace tree, `codex/registration.json`)
  stay after a deselection and leave with the drained uninstall.

### 12.5 Vendor homes and the closed authorization

- `H`, `P` and `C` are resolved once per command
  (`apps/cli/src/instructions/vendor-homes.ts` — `resolveVendorHomes`). `C` is the Codex home the
  Codex attach recorded in `<product-home>/codex/codex-home`
  (`apps/cli/src/instructions/vendor-homes.ts` — `codexHomeRecordPath`), read no-follow and
  owner-checked; before any attach it is `CODEX_HOME` when absolute, else `H/.codex`. A set
  absolute `CODEX_HOME` that differs refuses `codex_home_mismatch`, exit 3; deselecting Codex
  removes the record. `CLAUDE_CONFIG_DIR` is never followed, and `doctor`'s `instructions` check
  warns while it is set.
- `apps/cli/src/bootstrap/admission.ts` — `isVendorAuthorized` is the whole external
  authorization, exact per owner and arm, refusing `.` and `..` segments. `claude`: the subtree
  `H/.claude/skills/developer-os/` (`file`, `directory`, and `instruction` content of category
  `agent`, `skill` or `command`); `H/.claude/rules/developer-os-<id>.md` (`scoped-rule`);
  `H/.claude/output-styles/developer-os-<id>.md` (`output-style`); exactly `H/.claude/CLAUDE.md`
  (block only); the directories `H/.claude`, `H/.claude/skills`, the plugin root,
  `H/.claude/rules` and `H/.claude/output-styles`. `codex`: `C/agents/developer-os-<id>.toml`
  (`agent`), exactly `C/AGENTS.md` (block only), and the directories `C` and `C/agents`. A symlink
  at any component of a target refuses `instruction_target_symlinked`, exit 5.

### 12.6 `doctor`

- `instructions` (`apps/cli/src/commands/doctor.ts` — `inspectInstructions`) lists, per selected
  vendor, every installed catalog row, every override and the vendor's `vendor-file` block, sorted
  by `(owner, category, id)`, each `installed`, `drifted`, `missing`, `emulated` (a Codex scoped
  rule), `unsupported-vendor` (a Codex output style) or `held-back`. Any drifted row makes its
  artifact `drifted`. It fails, exit 3, on `drifted`, `missing` or `block_malformed`, and warns on
  `unsupported-vendor`, `held-back` and a set `CLAUDE_CONFIG_DIR`. Human output is one
  `<owner> <category>/<id>: <source>, <state>` line per artifact.
- `held-back` is a Claude category in
  `apps/cli/src/instructions/attach.ts` — `UNPROVEN_CLAUDE_CATEGORIES`: not installed until a real
  session proves it loads. The set has been empty since the billed row passed
  (`claude-adapter.md` §14.1).
- `codex-registration` (`apps/cli/src/commands/doctor.ts` — `checkCodexRegistration`):
  `unregistered` or `stale` fail exit 1, `cache-stale` only under `--probe`, an absent CLI warns;
  the recovery is re-running `init`. Neither check is init-owned.

### 12.7 Accepted residuals

- A default cannot be disabled, only replaced by an override.
- Codex registration is an unjournaled external effect: a crash between the attach commit and
  registration leaves an unregistered tree until the next `init`.
- The conflict diff is two-way; the base block's bytes are not retained.

## 13. Project templates: `project init` and `project check` (A14)

**Added 2026-09-29**, carrying the contracts of the A14 tooling-verbs design (D47, amended by
NEW-108) that the shipped code implements; the spec retired on 2026-09-29
(`git show 59a6be11:docs/superpowers/specs/2026-09-22-developer-os-tooling-verbs-design.md`) and
this section is the contract.

**Command surface.** A14 adds three verbs and changes no other command; none of them opens the
network or spawns a process.

| Command | Options | Positionals | Mutates | Contract |
|---|---|---|---|---|
| `import [<path>]` | `--claude-memory`, `--limit <n>`, `--dry-run`, `--json` | 0..1 | the vault quarantine only | `knowledge-pipeline.md` §3.1 |
| `project init [<dir>]` | `--dry-run`, `--json` | 0..1 after the subcommand | files in `<dir>`, create-only | §13.1 |
| `project check [<dir>]` | `--json` | 0..1 after the subcommand | nothing | §13.2 |

Dispatch lives in `apps/cli/src/main.ts`: `import` is in `COMMAND_OPTIONS` and
`COMMAND_POSITIONALS`, and `--claude-memory` with a `<path>` exits 2 at parse time; `project` is a
group whose `PROJECT_SUBCOMMANDS` admits `init` and `check`, and an unknown subcommand exits 2. The
ordinary-command bootstrap gate (`assertOrdinaryCommandAdmitted`) applies to all three, as to every
command but `init`. Output follows `emit`/`publish`: human lines through `renderPath`, one `--json`
line, every string leaf redacted. The `doctor` check `vendor-config` is `claude-adapter.md` §15.
`repo audit|bootstrap|secrets-scan` and `project worktree` are recorded refusals with no dispatch
entry (`docs/migration/instruction-inventory.md` §5).

### 13.1 `project init [<dir>] [--dry-run] [--json]`

- **Template set.** `PROJECT_TEMPLATE` (`apps/cli/src/commands/project-template.ts` —
  `PROJECT_TEMPLATE`) embeds the flat files of `templates/project/`: `AGENTS.md`, `CLAUDE.md` and
  `_Context.md`. They are static bytes with no substitution, and every file lands at the project root.
  `project-template.test.ts` pins the exact names, at most `PROJECT_TEMPLATE_MAX_FILES` (8), each at
  most `PROJECT_TEMPLATE_MAX_BYTES` (64 KiB), byte-equal to the checked-in copy and finding-free. An
  empty set refuses `project_templates_unavailable`, exit 4, before any read or write.
- **Before any write.** An uninitialized product refuses `project_not_initialized`, exit 1: the
  journals live in the product home. `<dir>` defaults to the working directory, is canonicalized and
  must be an existing directory (`project_root_not_directory`, exit 2). A root inside, containing or
  equal to the product home or the Brain refuses `project_root_overlaps_product`, exit 5.
- **Overrides (D5).** `<product-home>/templates/project/<name>` replaces the default of the same name
  as a whole file; any other name is ignored with a warning. An override is read through
  `readUntrustedText` at the 64 KiB bound. An unreadable one refuses `project_template_unreadable`
  with the reader's exit code; any redactor finding refuses `project_template_secret`, exit 5,
  because the output is a repository file that may be pushed.
- **Create-only.** If any target exists, `project_file_exists`, exit 3, lists every existing path and
  nothing is written; there is no merge and no `--force`. Otherwise one Foundation transaction, kind
  `project-init`, all `create`, with `<dir>` the owned root and the product home and the Brain
  excluded. `--dry-run` writes nothing and returns `transactionId: null`.
- **The user's files.** They get no manifest row and no drift check, and `uninstall` never removes
  them. No vendor settings file is ever written (`threat-model.md` §7).
- **Key.** Never created: `readRedactionKey`, else an ephemeral key, which only decides whether a
  finding exists.

### 13.2 `project check [<dir>] [--json]`

Read-only; it spawns nothing and needs no installed product: an unreadable configuration means no
user patterns, and an absent key means an ephemeral one. `ProjectCheckReportV1` carries
`DoctorCheck` rows from a closed set:

| Check | Status | When |
|---|---|---|
| `instruction-file` | `warn` | neither `AGENTS.md` nor `CLAUDE.md` exists |
| `instruction-size` | `warn` | an instruction file exceeds `PROJECT_INSTRUCTION_WARN_BYTES` (40,000, product-chosen) |
| `instruction-secrets` | `fail` | a redactor finding in an instruction or template file (exit 5), or a file over `PROJECT_CHECK_MAX_READ_BYTES` (1 MiB), not read past the bound (exit 1) |
| `instruction-secrets` | `warn` | a present file was not scanned: a link or a special file |
| `template-set` | `warn` | a template name is absent from `<dir>` |

A secret is reported as file, class and 1-based line: a whole-file pass, then one pass per line,
with line `null` when no single line carries the finding (a multi-line key block). The value and the
fingerprint are never printed. `doctorExitCode` picks the exit code (§6's order); warnings alone
exit 0.
