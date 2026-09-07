# Foundation architecture

What the Foundation layer is, what it guarantees, and — at least as importantly — what it
deliberately cannot do. Written at the close of Foundation Task 9; the evidence behind every
claim here is in `docs/releases/foundation-checkpoint.md`.

Foundation is the part of Developer OS that installs and removes *itself*. It integrates no
agent, writes no Brain note, and touches no network. Everything a user would recognise as the
product is built on top of it, by the subsystems listed in `docs/superpowers/BACKLOG.md` §3.

---

## 1. Boundaries

Four packages and one test package. The dependency direction is strictly downward; nothing
below the CLI knows a command exists.

| Package | Owns | May depend on |
|---|---|---|
| `@developer-os/core` | result and exit contracts, configuration, runtime paths, change plans, transactions, manifest and drift | nothing in this repository |
| `@developer-os/security` | canonical paths and containment, the protected-path policy, redaction, shell-free process execution | `core` |
| `@developer-os/platform-macos` | macOS facts, agent discovery, the transaction lock | `core`, `security` |
| `@developer-os/cli` | argv, output, exit status, one module per command, and the composition root | all three |
| `@developer-os/tests` | process-level evidence against the compiled binary | `core` and `security` at runtime, `cli` for types only |

Within those packages, one responsibility per path:

| Path | Responsibility |
|---|---|
| `apps/cli/src/bin.ts` | process boundary: argv, output, and exit code |
| `apps/cli/src/main.ts` | pure command dispatch returning `CliResult` |
| `apps/cli/src/io.ts` | injectable user interaction |
| `apps/cli/src/context.ts` | the composition root and the guards it supplies |
| `apps/cli/src/commands/` | one command per module |
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
`docs/architecture/brain.md` §3; every amendment to a frozen interface is indexed in
`docs/superpowers/BACKLOG.md` §8.

**A second amendment landed on 2026-08-17, on exactly the same terms.** Track R entry R2 gave
`DeveloperOsConfigV1` an optional `redaction?: { patterns }` member — a bounded list of literal
substrings, never expressions — because `threat-model.md` §5.7 and `BACKLOG.md` §1 NEW-16 record the
user-extensible redaction class that was **unreachable**: `redactText` accepted the option and no
production caller passed it, and this schema had no key a user could set.
Additive in the same three senses as `brain`: `.strict()` and `schemaVersion = 1` are unchanged, the
table is emitted only when present, and a configuration predating it loads and re-serializes
byte-identically. `BACKLOG.md` §8 carries the row, **unratified** — the founder decided to implement
NEW-16, which is not the same as ratifying the amendment it required.

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

`BACKLOG.md` §8 carries the row, **unratified** — the founder decided to implement Foundation
request 3, which is not the same as ratifying the amendment it required.

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
`BACKLOG.md` §8 carries the same-change ratification record.

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
evidence, no-replace verification/compensation, and the push-last exception are indexed in
`BACKLOG.md` §8. Git execution is additionally confined to an exact root-owned
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
inherited 600-second phase. Launchd bootstrap no longer passes the verified plist's mutable pathname:
on a separately certified pinned row it inherits only the descriptor of the already-unlinked,
immutable private snapshot as FD 3 and passes only `/dev/fd/3`; the real source plist descriptor is
never inherited and there is no fallback. A scheduled runner first authenticates manifest/plist/generation
installation evidence independently of current active provenance, then under its lease/global lock
runs an eligible handler, writes only `automation_disabled` for inactive automation, or writes only
`git_disabled` when active automation's installed sync job alone is Git-ineligible, without resolving
Brain or reaching Git/vendor/network authority in either inert branch.
Any retained or missing install/label derivation evidence remains recovery-required.
The post-final correction makes the reflog postimage bound exactly 64 MiB plus its separately bounded
4-KiB append and binds every append bijectively to its effect/ref projection; the private pack header,
admitted-entry, and closed-OID counts are equal and capped at 200,001 before a child permit. Launchd
bootstrap copies the verified planned plist into an already-unlinked private snapshot, inherits only
FD 3, and closes every source/snapshot descriptor on every path, so an in-place write to the real plist
cannot change loaded bytes. Before the permanent global lock exists, init and fresh absent-manifest
uninstall use the exact transient `LifecycleBootstrapLockV1` protocol with a second complete
inventory; key absence returns before ID/coordinator creation, while key presence alone derives the
two redaction-key transitions in a flat bootstrap-locked recovery envelope rather than creating the
installed four-root ledger. A live attempt removes only its identity-recorded empty directories; after
crash, the indistinguishable exact empty product/state skeleton is preserved, and bounded prefix-typed
creation temps make initial nonce/allocator recovery deterministic. Launchd inherits only the
already-unlinked snapshot; its sole linked creation prefix is frontier-bound and recoverable, while
the flat key-present coordinator admits one final journal plus one bounded rewrite temp. The active opt-in-surfaces design
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

The manifest remains Foundation's durable direct-write exception, not a managed artifact and not a
nested file transaction. DOS-P7 adds `ManifestStatePlanV1`, whose before/after arms are exact
`present { bytes, hash }` or `absent`, plus exact sibling tombstones and present-inode identity. A
present preimage is atomically moved no-replace to its journal-owned tombstone and verified before an
exact present postimage is no-replace-published or committed absence is durably recorded. Rollback uses
only no-replace moves, and every concurrent third state is preserved rather than overwritten or
unlinked. The composite journal retains its bytes, tombstones, and backups until the manifest postimage
and all participants are terminal, so recovery can finish or restore around every move, publication,
or absence-commit boundary. The active opt-in-surfaces design §2.4 owns ordering and failure semantics;
`BACKLOG.md` §8 carries the same-change ratification record.

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
  for `BACKLOG.md` NEW-1: it used to be a hard-coded array of four directories, so
  `packages/brain` was added on 2026-08-07 and scanned by nothing while this paragraph
  claimed otherwise. The non-empty assertion is made per workspace rather than over the
  total, because a floor over the sum is satisfied by one populated directory while every
  other goes unread — which is how the gap stayed invisible. No module count is stated here
  any more: a number in prose that no test pins is the same defect in a different shape.
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
seven-phase transactional pipeline (section 3) against a real filesystem, so their cost is
fsync-bound, not CPU-bound.

| Measurement | Before | After |
|---|---|---|
| The plan's e2e target — `fresh V2 retained bootstrap lifecycle` in `tests/e2e/fresh-v2-retained-bootstrap.test.ts`, run with `npx vitest run tests/e2e/fresh-v2-retained-bootstrap.test.ts` | 299.5 s against its 600000 ms timeout (2026-09-04, recorded in `BACKLOG.md` NEW-53) | **141.00 s** (2026-09-06, 03:55:12→03:57:34, quiet machine, load average 2.5) |
| `npm run test:bootstrap`, whole script | ~169 minutes (2026-09-05; phase 2 alone measured 10010 s) | **127.5 minutes** (2026-09-06, 00:08:48→02:16:19) |
| `test:bootstrap` phase 1 — an internal proxy, **not** the plan's e2e target above; it is the single named case "publishes a complete V2 handoff and permanently retains its exact plan and two slots" inside `executor.test.ts`, run separately so its evidence is on record before phase 2 starts | ~118-127 s (2026-09-05) | 97.89 s (2026-09-06) |
| `npm run test:suite` | 54 minutes, 135 files, 4570 cases (2026-09-05); 41 minutes recorded at the prior program checkpoint | **35.4 minutes** (2026-09-06, 03:07:29→03:42:51), 133 files and 4583 tests passed |
| Eight retained-evidence cases timing out under full-suite parallelism | 300 s each (2026-09-05, `npm run test:suite` at load average 47 from several concurrent test runs) | **gone — they do not appear at all** (2026-09-06, `npm run test:suite` on a quiet machine, load average 2.4 at start) |
| Three uninstall cases previously timing out | 300 s each | 112.11 s, 117.25 s, 119.60 s (measured during Task 6, `npx vitest run apps/cli/src/commands/uninstall.test.ts`) |
| Evidence inspections per fresh `init` | 6 | **3**, counted by a test rather than estimated |
| Retention tree projections per inspection | 6 | **2** (the surviving anti-TOCTOU pair) |
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
