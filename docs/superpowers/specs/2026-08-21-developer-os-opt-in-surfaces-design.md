# Developer OS — Opt-in Surfaces Design

**Status: written 2026-08-21, awaiting the founder's approval.** For `ORDER.md` entry A11, program
plan Task 7, DOS-P7 — **the first of the two documents that entry now needs.** Its implementation
plan is owed after approval and not before; code comes after that plan, which is a Global Constraint
of the program plan rather than a preference. **Approving this document is the founder's and is not
delegable** — an agent that judges its own spec ready has removed the only gate in the program a
machine cannot check.

**This document is half of DOS-P7, and the split is itself a decision the founder took on
2026-08-21.** The program plan and `BACKLOG.md` §3 both describe DOS-P7 as one spec covering four
areas: Git, scheduled automation, update and release, and schema migration. Read against their
dependencies those are two clusters and not four — **configuration mutability gates both opt-ins**,
because nothing can record an opt-in it cannot persist, and **update gates migration**, because a
schema change is staged by the update path that carries it. Between the clusters there is almost
nothing: Git sync and checksum verification share only the manifest. The second document,
covering release metadata, dry-run update, managed-artifact upgrade, schema migration and rollback,
is owed separately. **The program plan amendment is registered in `BACKLOG.md` §8.**

**Three decisions were taken with the founder before this was written**, each with the alternatives
that were rejected, in §3. They are the load-bearing ones: what happens to `config.toml`'s hash, how
much of a Git repository this product owns, and what a scheduled job is allowed to do.

---

## 1. What this subsystem is

Three surfaces the user turns on, and until they do, **nothing happens at all**: configuration that
can be changed after `init`, Git synchronisation of the vault, and scheduled local jobs.

It exists because Foundation shipped a product that cannot be reconfigured. `config.toml` is a
hash-tracked managed artifact and no command edits it, so changing `git.enabled` today means
hand-editing a file that then drifts the manifest and makes `init`, `doctor` and `uninstall` all
refuse. **A lifecycle that ships opt-in commands without a way to record the opt-in ships a dead
end**, which is Foundation residual 9 and this document's first section of substance.

## 2. What it does not do, on purpose

- **Nothing here reaches a model.** No verb in this document invokes a vendor CLI, and §3.3 makes
  that structural for scheduled jobs rather than a rule someone has to remember.
- **Nothing here captures.** Knowledge-pipeline architecture note §2 records the decision that capture content is
  agent-authored and that nothing automatic captures anything; the founder accepted the cost. A
  scheduler does not reopen it.
- **Nothing here rewrites history.** §3.2 is the whole of the Git surface, and conflict resolution,
  rebase, merge and force-push are outside it.
- **Nothing here updates the product.** Release metadata, checksums, dry-run update, managed-artifact
  upgrade and schema migration are the second document's.
- **Nothing here handles a credential.** §4.5.

## 3. The decisions this spec makes

### 3.1 The manifest stops hashing `config.toml`, and validation replaces the hash

**Decided with the founder 2026-08-21.** The manifest keeps owning the path — it is still a managed
artifact, still installed by `init`, still removed by `uninstall` — but its recorded digest is
dropped. Drift for that one path becomes **absent or unreadable**, never *content changed*.

**The reason is that the hash was measuring the wrong property, which is why this is the root of
residual 9 rather than a symptom of it.** Every key in `config.toml` is a user choice: `brainPath`,
which adapters are enabled, the two opt-in flags, the `[brain]` settings, the `[redaction]` patterns.
The product ships no content in that file — `init` generates it from the user's own answers. A
content hash over a file whose purpose is to change reports every intended edit as tampering, and
the only way to keep it truthful was to forbid the edits.

**What replaces it is stronger where it matters.** `configSchema` is `.strict()` and runs on **every
load**, not when `doctor` happens to run:

- an unknown or misspelled key fails the load rather than being silently dropped;
- `telemetry: z.literal(false)` and `schemaVersion: z.literal(1)` become **loader-enforced
  invariants** — a file claiming telemetry is on does not load at all, which a hash checked
  occasionally could only report after the fact;
- `brainPath` remains `absolutePathSchema` and remains subject to every containment rule that already
  governs it.

**Rejected: a transactional `config set` that recomputes the digest in the same transaction.** It is
consistent with every other mutation in this product and keeps drift detection total, and it was
rejected because it makes the product the only legal editor of the user's own preferences: a hand
edit stays fatal, and the refusal has to teach a verb. The verb ships anyway (§4.2) — as
convenience, not as the only door.

**Rejected: splitting the file** into a hashed product half and an unhashed user half. Cleanest
ownership on paper, and it needs a migration for every existing installation — which is the second
document's machinery, so this document would depend on the one that comes after it.

**What this gives up, stated here rather than discovered later.** The manifest no longer detects a
third party editing `config.toml`. It never *prevented* one — a hash detects, it does not guard — but
the detection is gone, and the sharpest case is `[redaction] patterns`: somebody who can write that
file can weaken redaction, and the next `ingest` will not say so. **Registered as a residual in §7,
not closed here**, because closing it means deciding whether a user's own configuration file is a
security boundary, and that is a larger question than this document's scope.

### 3.2 The product owns a repository's existence and staging, never its history

**Decided with the founder 2026-08-21.** On an explicit enable, and only then, the product may
`git init` a vault that is not yet a repository and may add the remote the user named. From then on
it stages named paths, commits, and pushes one branch it created.

**It never rebases, force-pushes, merges, or resolves a conflict**, and it never touches a branch it
did not create. Where an automatic tool would resolve, this one refuses and says what it found (§4.4).

**Rejected: adopt-only**, requiring the vault to be a repository with a remote already configured.
Smallest surface and nothing to undo, and it contradicts `BACKLOG.md` §3's "Git initialization"
requirement while pushing setup onto the user.

**Rejected: full ownership including history.** It is the only shape in which an unattended job can
always succeed, and that is exactly its cost: the product would rewrite history over the founder's
notes, which is the data-loss surface the Task 7 checkpoint exists to exclude.

### 3.3 A scheduled job may never invoke a vendor CLI

**Decided with the founder 2026-08-21.** The schedulable set is a **closed enum** — `brain reindex`,
`brain lint`, `doctor`, `git sync` — and a verb outside it is refused **at plan time**, when the job
is created, rather than at run time in a log nobody reads.

**No scheduled job may spawn a vendor binary.** An unattended run therefore cannot spend the
founder's credits, which is the property that makes a scheduler safe to leave installed. The only
network destination any scheduled job has is the one remote named when Git was enabled.

**Rejected: local verbs only**, with no network at all. It makes the no-network gate trivially true
and removes most of the reason to have a scheduler.

**Rejected: any verb under a spend cap.** Most capable, and it reopens knowledge-pipeline §3.1's
decision that nothing automatic reaches a model — a decision the founder took knowing what it cost.

## 4. The surfaces

### 4.1 Verb summary

| Verb | Effect | Network |
|---|---|---|
| `config get [key]` | reads the loaded configuration | none |
| `config set <key> <value>` | writes `config.toml` transactionally | none |
| `git enable --remote <url>` | initialises or adopts, records `GitSyncConfigV1` | none |
| `git disable` | stops syncing; leaves the repository alone | none |
| `git sync` | stage, commit, push | the named remote |
| `git status` | what the last sync did, and what would be staged | none |
| `automation enable` | shows a `LaunchdPlan`, then installs it | none |
| `automation disable` | removes the plist | none |
| `automation status` | which jobs exist and when each last ran | none |

### 4.2 `config set`

Mutates through the standard `plan → backup → stage → validate → apply → verify → finalize` path, so
a failed write leaves the previous file. **Validation is the schema, run before apply** — a `set`
that would produce a file the loader rejects fails without writing.

**Keys are dotted paths into the schema** — `git.enabled`, `brain.contentRoot` — and a key the schema
does not declare is refused before anything is written, by the same `.strict()` parse that governs a
hand edit. `config get` with no key prints the whole loaded configuration; `[redaction] patterns` is
printed as a count rather than as values, because the point of that table is that its contents are
sensitive.

It is convenience rather than the only door: a hand edit is legal under §3.1, and `config set` exists
so that scripted and scheduled use has something that cannot half-write.

### 4.3 `git enable`

Records `GitSyncConfigV1`: the remote, the branch, and the content root the staging list derives
from. **Initialises only what is absent** — an existing repository is adopted, an existing remote of
the same name is a refusal rather than a silent overwrite.

**The branch is named by the user at enable time and defaults to the repository's current branch** when
one exists, so adopting a repository does not rename anything. In a repository the product initialised
there is no current branch to adopt, and the default is `main` — recorded in `GitSyncConfigV1` either
way, because §3.2's "a branch it did not create" refusal needs a stored answer to compare against and
cannot re-derive one later.

**`git disable` clears the enable flag and keeps `GitSyncConfigV1`.** Re-enabling therefore does not
re-ask, and — more to the point — the recorded branch survives a disable, so a repository the product
created cannot be adopted back under a different branch by accident.

### 4.4 `git sync`, and everything it refuses

The sequence is: derive the staging list from the content root, stage those **named paths only**,
commit, push.

**Never `git add -A`, never `git add .`, never a wildcard** — the standing repository rule, applied
to the product's own behaviour rather than only to its authors.

It refuses, naming what it found rather than what it wanted:

| Found | Why it refuses |
|---|---|
| the vault is not a repository | Git was never enabled, or the repository was removed underneath it |
| a dirty index it did not stage | committing it would commit a change the user was composing |
| mid-rebase or mid-merge | any commit here participates in a history operation the product does not own |
| detached HEAD | there is no branch to push |
| HEAD is a branch the product did not create | §3.2 |
| the remote rejects the push | including auth, non-fast-forward, and unreachable |

**The sync record is written only after `push` exits 0.** That is how "push failure never records a
successful sync" becomes structural: there is no ordering in which a failed push and a recorded
success coexist, rather than a rule that a later edit could quietly break.

### 4.5 Credentials

**The product never handles one.** It spawns `git` and lets the user's existing configuration —
agent, helper, or key — do whatever it does. An authentication failure is a refusal with the
vendor's own message, never a prompt, never a stored token, and never a value that reaches a log.

The `git` binary is resolved and then passed through `assertTrustedExecutable`, like every other
executable this product spawns.

### 4.6 `automation enable`

Produces a `LaunchdPlan` and **shows it before applying**: the label, the schedule, the log paths and
the exact argv of every job. Applying installs the plist; `disable` removes it.

**The schedules are a closed set for the same reason the verbs are** — `hourly`, `daily` at a named
local hour, and `weekly` at a named day and hour. A cron expression is refused: it is a second
scheduling language inside a document whose whole subject is that an unattended job should be legible
before it is installed, and `launchd`'s own calendar interval expresses these three exactly. Each
schedulable verb carries a default — `brain reindex` and `brain lint` daily, `doctor` weekly,
`git sync` hourly — and every one of them is overridable at enable time.

**Disabled means not installed**, not installed-and-inert. A plist that exists but does nothing is a
job somebody will find later and wonder about.

### 4.7 Lock ownership

Each job takes the same transaction lock the interactive command would. **A job that cannot take the
lock exits 0 having done nothing, and logs why.** A scheduled sync that skipped because the founder
was mid-`ingest` is not a failure, and reporting it as one trains the reader to ignore the log.

Job logs are written to a product-owned path and are redacted on the way out, on the same terms as
every other published string.

## 5. Gates

| Gate | Evidence |
|---|---|
| a Git-disabled install performs no Git process or network call | the existing `tests/security/network.test.ts` suite, extended with the disabled case |
| an automation-disabled install writes no plist and schedules nothing | an injected filesystem observes no write |
| enabling either feature shows and persists an exact plan | the shown plan and the stored config are asserted equal |
| push failure never records a successful sync | a bare remote configured to reject; the sync record is absent afterwards |
| a scheduled job cannot invoke a vendor CLI | the schedulable enum is asserted closed, and the argv of every planned job is asserted against it |
| `uninstall` leaves the repository alone | the vault's `.git` survives, with its history |

**Git is tested against temporary repositories and bare remotes, with no real credential anywhere.**
`launchd` is tested through an injected filesystem and runner. Neither suite touches a real machine,
per the standing rule that live-machine changes are the founder's.

## 6. Produced interfaces

| Interface | Where |
|---|---|
| `GitSyncConfigV1` | `packages/core/src/config/` |
| `AutomationConfigV1` | `packages/core/src/config/` |
| `LaunchdPlan` | `packages/platform-macos/src/launchd/` |
| `SyncRecordV1` | `apps/cli/src/commands/git/` |
| `config`, `git`, `automation` verbs | `apps/cli/src/commands/` |

`UpdatePlan` and `SchemaMigrationPlan`, which `BACKLOG.md` §3 lists against DOS-P7, belong to the
second document.

## 7. Residuals this document leaves open

1. **`config.toml` is no longer tamper-detected**, and `[redaction] patterns` is the sharp edge:
   somebody who can write that file can weaken redaction silently. §3.1 states the trade; closing it
   means deciding whether a user's own configuration file is a security boundary, which is wider than
   this document. **Owner: the founder**, as a question rather than a task.
2. **The schedulable enum is a policy, and policies drift.** Nothing structurally prevents a later
   verb being added to it that does spawn a vendor. The gate in §5 asserts the enum's contents, which
   is a test rather than a type. **Owner: the implementation plan**, which should consider whether the
   spawn ban can be a property of the verb rather than of a list.
3. **A `git sync` that refuses on a dirty index has no recovery verb.** The user is told what was
   found and left to resolve it with `git` directly, which is correct for this product's ownership
   boundary and is still a dead end for somebody who does not use Git by hand. **Owner: DOS-P9**, as
   a documentation question at release.
