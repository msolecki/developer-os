# Spec 1 amendment for NEW-67 — proposed 2026-09-17, **not approved**

**Status: awaiting founder approval.** This document is the roadmap Phase 4 stop condition. Approved
specs are not silently rewritten, so the corrections below are stated here, with their evidence,
before any of them is folded into Spec 1
(`docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md`). On approval each item is
marked "Amended 2026-09-17" in place, this file is deleted, and plan 1a may be written.

**Scope** is NEW-67 as `BACKLOG.md` states it, plus the items the Phase 3 final review attached to it:

- decision D18's Spec 1 clauses;
- the handoff-admission carries;
- the reservation-set pin test the D18 revert deleted.

This document follows the Phase 3 closing commit, which records decisions D19 and D20 and backlog
rows NEW-79–NEW-83. Citations use the file basename where it is unique, so the repository citation
gate resolves and bounds-checks each one.

**Three items were decided in conversation on 2026-09-17.** They are written out here for approval of
the text, not of the choice:

- **A2:** retention replaces unlink/rmdir on the pre-product bootstrap paths only.
- **A3:** absent-manifest key deletion drops its coordinator envelope.
- **A12:** uninstall leaves the global lock and the bookkeeping directories in place, and fresh `init`
  reuses them. This was revised the same day from "uninstall unlinks the lock last" after review
  showed that that final step is unjournaled. How `init` admits them (by shape) and whether they are
  manifest rows still need approval.

**Five items need a decision:**

- **A4:** the automation status file name.
- **A6:** the three collision codes.
- **A7:** the admission contract.
- **A8:** counting-seam fixtures.
- **A10:** the `launchctl` row.

**A9 adds a gate.** The rest correct text against decisions already taken (D18, D19) or against code
Spec 2 already shipped.

---

## A1 — Spec 1 still requires the withdrawn V1→V2 migration (D18)

**Finding.** D18 withdrew the V1→V2 manifest migration from Spec 2. Spec 1 still makes it a
precondition, a creator and a gate:

- **Header:** `2026-08-21-developer-os-opt-in-surfaces-design.md:5-6`,
  `2026-08-21-developer-os-opt-in-surfaces-design.md:12-16` and
  `2026-08-21-developer-os-opt-in-surfaces-design.md:51-54`.
- **§2.1 migration gate and V1 mapping:** `2026-08-21-developer-os-opt-in-surfaces-design.md:86-92`,
  `2026-08-21-developer-os-opt-in-surfaces-design.md:104-107`,
  `2026-08-21-developer-os-opt-in-surfaces-design.md:109-117` and
  `2026-08-21-developer-os-opt-in-surfaces-design.md:122-134`.
- **Migration named as a creator:** `2026-08-21-developer-os-opt-in-surfaces-design.md:172-183`,
  `2026-08-21-developer-os-opt-in-surfaces-design.md:288-297` and
  `2026-08-21-developer-os-opt-in-surfaces-design.md:2153`.
- **Migration named as a restore class:** `2026-08-21-developer-os-opt-in-surfaces-design.md:310-318`
  and `2026-08-21-developer-os-opt-in-surfaces-design.md:4059-4061`.
- **§7 gate** "V2 migration preserves ownership":
  `2026-08-21-developer-os-opt-in-surfaces-design.md:4241`.
- **§8:** `2026-08-21-developer-os-opt-in-surfaces-design.md:4293`,
  `2026-08-21-developer-os-opt-in-surfaces-design.md:4312-4313` and
  `2026-08-21-developer-os-opt-in-surfaces-design.md:4332-4334`.
- **Plan:** `2026-08-28-developer-os-opt-in-surfaces.md:15-16` forbids execution until the migration
  exists.

Two neighbouring clauses were written for the migration arm and also contradict what shipped for new
init:

- "no existing directory is adopted" (`2026-08-21-developer-os-opt-in-surfaces-design.md:174-175`)
  is contradicted by Spec 2 §6.1's `admittedPreexistingPaths`
  (`2026-08-28-developer-os-release-update-design.md:991-994`) and by the reusable directories the
  shipped executor admits (`apps/cli/src/bootstrap/executor.ts:1123-1137`).
- Spec 2 admits a surviving global lock during resume
  (`2026-08-28-developer-os-release-update-design.md:1113-1126`).

**Why it matters.** Phase 4's precondition can never be met as written, and `SESSION.md` makes an
impossible plan step a stop condition.

**Proposed text.**

- **Header.** The dependency becomes the V2 new-init handoff alone
  (`2026-08-28-developer-os-release-update-design.md:1789-1800`).
- **§2.1 opens:** "Every V2 manifest is created by Spec 2's fresh `init`. `config`, `git` and
  `automation` refuse a V1 manifest (`manifest_v1_not_migratable`) before any mutation. `uninstall`
  over a V1 manifest runs the unchanged Foundation uninstall, with D20's recovery guidance."
  - Production `init` writes V1 manifests until roadmap Phase 4b, so V1 homes keep their only way out.
  - §2.3's global-lock requirement for Brain, config and manifest mutators
    (`2026-08-21-developer-os-opt-in-surfaces-design.md:649-651`) applies to V2 homes only. A V1 home
    never has `state/.lifecycle.lock`. Over a V1 manifest, Foundation commands (`capture`, `ingest`,
    `reindex` and the rest) keep their current path without it, as the shipped contract requires
    (`docs/architecture/foundation.md:450-453`).
- **Kept in §2.1:**
  - the `ManagedArtifactV2` arm table and drift names;
  - the V2 validator invariant (`2026-08-21-developer-os-opt-in-surfaces-design.md:136-140`);
  - the `ephemeral` rules;
  - the new-init sentences at `2026-08-21-developer-os-opt-in-surfaces-design.md:117-120`: the
    activation path's first creation, and the absent-leaf preconditions.
- **Deleted:** the V1 mapping, the backup-verification paragraph and the `config-entry` migration
  sentence.
- **Wording.**
  - "migration/new init" becomes "new init".
  - "every migratable `existedBefore: true`" becomes "every `existedBefore: true`".
  - "no existing directory is adopted" becomes "no directory is adopted beyond what Spec 2 §6.1
    admits".
- **§7.** The migration gate becomes "V2 new init registers ownership". Nonce, allocator and
  reservations are registered by a fresh `init`, and the bookkeeping set of A12 exists after it. A
  pre-existing leaf at a reserved path refuses unless Spec 2 §6.1 admits it. A V1 manifest reaches no
  Spec 1 mutation.
- **§8.** §8.1's owner becomes the Spec 2 Core manifest package. §8.2 step 3 records the handoff
  admission as complete. §8.3 residual 4 names roadmap Phase 4b's production handoff as the remaining
  dependency.

**Test.** After the amendment, `migrat` in Spec 1 and its plan matches only:

- Brain schema migrations;
- "never migrates or repairs V1";
- "no source implementation migration"
  (`2026-08-21-developer-os-opt-in-surfaces-design.md:458`);
- "two-repository migrate" (`2026-08-21-developer-os-opt-in-surfaces-design.md:545`).

**Plan impact.** The global constraints replace the migration precondition with the handoff admission
tests in `apps/cli/src/bootstrap/report.test.ts`.

---

## A2 — Retention replaces unlink and rmdir on the pre-product bootstrap paths · decided 2026-09-17

**Finding.** Spec 2 §6.4 forbids "unlink, recursive delete, or `rmdir` in bootstrap compensation,
recovery, retention, uninstall, or retry"
(`2026-08-28-developer-os-release-update-design.md:1738-1739`). Spec 1 prescribes them on the paths it
shares with bootstrap:

- §2.3's cleanup unlinks the exact bootstrap lock inode and removes attempt-created empty directories
  (`2026-08-21-developer-os-opt-in-surfaces-design.md:621-641`);
- `key_absent` does the same (`2026-08-21-developer-os-opt-in-surfaces-design.md:4164-4168`);
- key-present terminal compaction removes allocator, nonce, journal and plan, then lock and
  directories (`2026-08-21-developer-os-opt-in-surfaces-design.md:4207-4216`).

**Why only these paths.** §2.4's post-handoff terminal compaction
(`2026-08-21-developer-os-opt-in-surfaces-design.md:713-734`) keeps each journal root under 10,000
leaves while scheduled jobs write a status and log transaction at every cadence. An hourly `git-sync`
alone starts about 8,760 coordinators a year, so a retention-only ledger would make automation
recovery-required. Spec 2's rule is scoped to bootstrap, and `BACKLOG.md` A11 already says post-handoff
compaction follows Spec 1.

**Proposed text.**

- **§2.3 keeps, because Spec 2 relies on it:**
  - the `LifecycleBootstrapLockV1` definition;
  - the pre-lock and post-lock inventories;
  - reuse of an exact leftover bootstrap leaf;
  - preservation of the empty skeleton;
  - the bootstrap → global lock order
    (`2026-08-21-developer-os-opt-in-surfaces-design.md:643-646`).

  Spec 2 uses "Spec 1's transient `LifecycleBootstrapLockV1`"
  (`2026-08-28-developer-os-release-update-design.md:978-981`) and preserves the pre-plan skeleton
  "under Spec 1's bootstrap rule" (`2026-08-28-developer-os-release-update-design.md:1567-1571`).
- **§2.3's unlink and rmdir cleanup** is replaced by: the exact bootstrap leaf is never unlinked, and
  no directory is removed. The residue §2.3 already admits after a crash becomes the ordinary terminal
  residue: product home absent, empty, holding only an empty guarded `state`, or `state` also holding
  the exact bootstrap leaf.
- **The `createdByAttempt` fields.** No Spec 1 authority derives from the three fields. Spec 2 never
  serializes them (`2026-08-28-developer-os-release-update-design.md:1567-1569`), and no code reads
  them, so plan 1a removes them from the type (`packages/core/src/manifest/bootstrap.ts:80-82`).
  Removing them means amending, in the same change:
  - Spec 1's grammar (`2026-08-21-developer-os-opt-in-surfaces-design.md:216-227`);
  - the §2.3 paragraph that explains them
    (`2026-08-21-developer-os-opt-in-surfaces-design.md:633-641`);
  - the §7 exact-set gate that lists the type
    (`2026-08-21-developer-os-opt-in-surfaces-design.md:4234`).
- **§2.4's compaction by deletion** is unchanged; one sentence states why, citing the ledger bound
  above. Its closure must admit retained bootstrap evidence, which is A13.
- **Under A3** the only Spec 1 bootstrap-lock user left is `key_present`.

---

## A3 — Absent-manifest uninstall without a coordinator envelope · decided 2026-09-17

**Finding.** `uninstall/absent_manifest/key_present` deletes one secret-opaque file. To make that
recoverable, Spec 1 mints a recovery-only nonce/allocator epoch, reserves an ID, publishes a flat plan
and journal, stages the key to an ID-bound tombstone and then compacts all of it
(`2026-08-21-developer-os-opt-in-surfaces-design.md:4116-4216`).

Under A2 that compaction is illegal. Retaining the envelope would leave `state` holding a nonce, an
allocator, a plan and a journal, which Spec 2's fresh `init` refuses as unbound entries
(`apps/cli/src/bootstrap/executor.ts:1267-1277`).

The fresh shapes also refuse retained bootstrap evidence: "every other known or unknown file or
directory" (`2026-08-21-developer-os-opt-in-surfaces-design.md:4101-4114`). Spec 2, however, says
uninstall succeeds when retained evidence is the only residue and never deletes it
(`2026-08-28-developer-os-release-update-design.md:1775-1778`). Every home that ever ran V2 `init`
keeps that evidence.

The shipped uninstall already deletes an orphaned key when the manifest is absent, naming a failed
`init` as the case (`apps/cli/src/commands/uninstall.ts:767-784`). Spec 1 as written would turn that
into a refusal.

**Why the envelope is not needed.** The authority to delete the key is the complete key-only
inventory, not the journal. A force-forward deletion of one file has two crash states, key present and
key absent, and both are observable.

**Proposed text.** Replace `2026-08-21-developer-os-opt-in-surfaces-design.md:4116-4216` and rewrite
`2026-08-21-developer-os-opt-in-surfaces-design.md:4091-4114`:

- **Admitted shapes** are the four fresh shapes, each optionally with the exact bootstrap leaf and
  with inert retained bootstrap evidence projected away.
  - "Inert" is exactly as Spec 2's evidence inspection classifies it: terminal, or `unverified` under
    `2026-08-28-developer-os-release-update-design.md:1753-1758`.
  - Active or ambiguous residue refuses as exit 6.
  - The projection also removes the ancestor directories that exist only to hold that evidence (for
    example `staging/` holding a retained staging tombstone), as shipped `init` does through
    `retainedChildNames` (`apps/cli/src/bootstrap/executor.ts:237-244`).
  - A bootstrap leaf counts as attributable to an envelope only when its device and inode equal that
    envelope's persisted `PersistedBootstrapLockIdentityV1`
    (`packages/core/src/manifest/bootstrap.ts:85-93`). A2 makes a later leaf permanent, and a later
    leaf is a different inode. This settles the lock clause of NEW-83 by identity binding. The code
    still filters the leaf by name alone (`apps/cli/src/bootstrap/report.ts:1150-1151`); plan 1a
    changes that.
  - The projection also leaves A12's bookkeeping set in place, admitted by exact shape. That includes
    the lock a rolled-back first `init` leaves: Spec 2 never retains it
    (`2026-08-28-developer-os-release-update-design.md:1149-1152`), and today's uninstall already
    tolerates it (`apps/cli/src/commands/uninstall.ts:767-784`).
- **`key_absent`** performs two consecutive complete read-only walks that must be identical, and
  returns. It creates no bootstrap leaf, directory, ID or file. Under A2 a created path could never be
  removed, and two identical walks give the snapshot a single walk cannot.
- **`key_present`**
  1. creates or guarded-opens the exact bootstrap leaf in the existing `state`, and acquires it;
  2. repeats the complete inventory, which must reproduce the admitted shape after projecting away
     only that leaf;
  3. guarded-opens `state/redaction.key` without following links and without reading bytes, records
     `SecretOpaqueFileStateV1`, and rechecks the path identity;
  4. unlinks the key, syncs `state`, verifies absence, and releases the lock, leaving the leaf.

  A crash leaves the key present, and the next run repeats the operation, or absent, and the next run
  is `key_absent`. A changed identity or any other child refuses and preserves everything.
- **Deleted or rewritten with it:**
  - `LifecycleBootstrapCreationTempV1`
    (`2026-08-21-developer-os-opt-in-surfaces-design.md:231-254`, and in §7 and §8.1 at
    `2026-08-21-developer-os-opt-in-surfaces-design.md:4234` and
    `2026-08-21-developer-os-opt-in-surfaces-design.md:4295`);
  - the flat-placement exception (`2026-08-21-developer-os-opt-in-surfaces-design.md:704-711`);
  - the `key_absent` coordinator note (`2026-08-21-developer-os-opt-in-surfaces-design.md:1535-1538`);
  - the variant derivation (`2026-08-21-developer-os-opt-in-surfaces-design.md:1564-1568` and
    `2026-08-21-developer-os-opt-in-surfaces-design.md:1591-1594`);
  - the coordinator rows (`2026-08-21-developer-os-opt-in-surfaces-design.md:1533` and
    `2026-08-21-developer-os-opt-in-surfaces-design.md:1552`);
  - the bootstrap-lock ID-allocation exception
    (`2026-08-21-developer-os-opt-in-surfaces-design.md:1706-1709`);
  - the absent-manifest `K` sentence (`2026-08-21-developer-os-opt-in-surfaces-design.md:1980-1981`);
  - the §7 absent-manifest gate's flat-envelope, creation-temp, unlink-while-held and
    allocator→nonce→journal→plan clauses (`2026-08-21-developer-os-opt-in-surfaces-design.md:4276`).

  The gate instead proves:
  - the two identical walks;
  - projection of retained evidence;
  - no unlink or rmdir except the key.

  `SecretOpaqueFileStateV1` and the present-manifest `K(stage)`/`K(delete)` arms are unchanged.
- **Plan.**
  - Task 3 drops the creation temp (`2026-08-28-developer-os-opt-in-surfaces.md:234`).
  - Task 4's `inspectAbsentManifestBootstrap` loses its epoch and ID path
    (`2026-08-28-developer-os-opt-in-surfaces.md:378`).
  - Task 23 drops the "two-step coordinator" and its tests
    (`2026-08-28-developer-os-opt-in-surfaces.md:1770` and
    `2026-08-28-developer-os-opt-in-surfaces.md:1795`), and keeps the orphaned-key-after-failed-`init`
    case working.

**Residual, recorded rather than hidden.** Node has no descriptor-relative unlink, so a same-uid
process can swap the key path between the identity recheck and `unlink`. The worst outcome is removal
of a planted regular file at a product-reserved path in the product's own `state`. The approved
design's tombstone unlink had the same window. §8.3 records it.

---

## A4 — Reservation ownership across both specs, and the status file name · name decision required

**Finding.**

- **Missing Spec 2 state files.** Spec 1's closed table
  (`2026-08-21-developer-os-opt-in-surfaces-design.md:142-155`) omits the four state files Spec 2
  reserves: `state/active-release.json`, `state/release-trust.json`, `state/update-rollback.json` and
  `state/update-executor.json` (`2026-08-28-developer-os-release-update-design.md:280-283`).
- **Missing D19 roots.** It also omits the retained-metadata and rollback roots
  (`2026-08-28-developer-os-release-update-design.md:273-285`).
- **No stated owners for shared rows.** Neither spec states who creates, mutates and removes the rows
  both use.
- **Status file name.** Spec 1 names it `state/automation-<job>.status.json`
  (`2026-08-21-developer-os-opt-in-surfaces-design.md:152`). The shipped fresh `init` reserves
  `state/automation-<job>.json` (`apps/cli/src/bootstrap/executor.ts:1558`), and nothing else pins
  that name.

**Proposed text.** §2.1 states that the V2 reservation set is Spec 2 §3.2
(`2026-08-28-developer-os-release-update-design.md:266-288`) plus Spec 1's table, as D19 fixes them,
with one owner table for the shared rows:

| Path | Created by | Mutated by | Removed by |
|---|---|---|---|
| `state/lifecycle-install-nonce` | Spec 2 new init | never | Spec 1 uninstall |
| `state/lifecycle-id-allocator.json` | Spec 2 new init | Spec 1 §2.4 allocation | Spec 1 uninstall |
| A12's bookkeeping set: lock, journal roots, companion inventories and their parents | Spec 2 new init, or their first writer | Spec 1 §2.4 children only | never; not manifest rows; the next fresh `init` admits them by shape (A12) |
| Spec 2 §3.2 rows | Spec 2 | Spec 2 update/rollback | Spec 1 uninstall, through the manifest |

**Plan impact.** Plan 1a's first test is the exact-set pin over a fresh plan's `createdPaths` and
launchability paths. It is restored from `git show df3e947 -- apps/cli/src/bootstrap/executor.test.ts`
and updated for D19 and this table.

**The decision: the status file name.** Either spelling costs one code line plus the restored test.

- **Recommended: the code follows Spec 1's `automation-<job>.status.json`,** and Spec 1 is unchanged
  on this point. This is what D19 did when an approved spec and unreleased code disagreed.
- **The alternative** amends Spec 1 to the shipped name.

---

## A5 — Types Spec 2 shipped are imported; their strict validators are still produced

**Finding.** Plan Task 3 produces types Spec 2 Tasks 1–7 already shipped
(`2026-08-28-developer-os-opt-in-surfaces.md:234`):

| Spec 1 name | Shipped in |
|---|---|
| `CanonicalJsonV1` with encoder/decoder; `CanonicalJsonValueV1` | `packages/core/src/lifecycle/canonical-json.ts` (the value type as `CanonicalJsonValue`) |
| `CanonicalAbsolutePathV1` | `packages/core/src/update/paths.ts` |
| `UtcTimestampV1`, `SafeReasonCodeV1`, `LowerHexSha256`, `UInt64DecimalV1` | `packages/core/src/update/scalars.ts` |
| `LifecycleInstallNonceV1`, `LifecycleIdAllocatorV1`, `LifecycleBootstrapLockV1` | `packages/core/src/manifest/bootstrap.ts` |
| `LifecycleCoordinatorIdV1` | `packages/core/src/manifest/manifest-state.ts` |

§8.1 already marks `ManagedArtifactV2`, `InstallationManifestV2` and `ManifestStatePlanV1` as consumed
(`2026-08-21-developer-os-opt-in-surfaces-design.md:4293`); the first two are declared in
`packages/core/src/manifest/types.ts:68-75`.

Several rows shipped as types only:

- there is no exported strict validator for the nonce, the allocator or the bootstrap lock;
- `LifecycleCoordinatorIdV1` is an unvalidated brand
  (`packages/core/src/manifest/manifest-state.ts:46`), not Spec 1's `lc_<nonce>_<counter>` grammar
  (`2026-08-21-developer-os-opt-in-surfaces-design.md:827-831`).

**Proposed text.** §8.1 adds that these types are consumed from the named modules, with §§2.1–2.2 as
the normative grammar. **Plan impact:** Task 3 imports the types and still produces their strict
validators and the allocated-ID grammar. `SafeReasonCodeV1` follows Spec 2's bounded definition.

---

## A6 — The three collision codes are migration-only · decision required

**Finding.** `activation_path_collision`, `lifecycle_nonce_path_collision` and
`lifecycle_allocator_path_collision` (`2026-08-21-developer-os-opt-in-surfaces-design.md:109-117`)
refuse a V1 artifact that claims a lifecycle control path during migration. No source file defines
them.

**Proposed text, recommended: withdraw all three with A1.** A fresh `init` cannot meet a V1 claim,
and Spec 2 §6.1 refuses unadmitted pre-existing leaves. The activation record's own absent-path
precondition stays (`2026-08-21-developer-os-opt-in-surfaces-design.md:566-570`).

**The alternative** keeps them as fresh-`init` reason codes. That needs a Spec 2 §6.1 reason table and
code for a state no admitted install reaches.

---

## A7 — Admission of an installed V2 home · decision required

**Finding.** Plan 1a would reuse Spec 2 Task 9's handoff admission before constructing any lifecycle
adapter (`2026-08-28-developer-os-opt-in-surfaces.md:1206`), and for uninstall. That admission is a
fresh-install snapshot, and four of its members break once Spec 1 runs:

1. **Empty ledgers.** It requires three empty ledgers (`docs/architecture/foundation.md:470-477`).
   Spec 1 fills them. `LifecycleJournalClosureV1` has non-clear arms
   (`2026-08-21-developer-os-opt-in-surfaces-design.md:579-586`), and a non-terminal or `compacting`
   ledger must be finished by a command running under the global lock
   (`2026-08-21-developer-os-opt-in-surfaces-design.md:714-723` and
   `2026-08-21-developer-os-opt-in-surfaces-design.md:777-780`).
2. **Activation record.** It requires the activation record to be absent. Spec 1's first lifecycle
   apply creates it (`2026-08-21-developer-os-opt-in-surfaces-design.md:566-572`).
3. **Bootstrap manifest bytes.** It binds to exactly one `finalized` bootstrap plan whose published
   manifest bytes equal the current manifest (`apps/cli/src/bootstrap/report.ts:1454-1463`). That
   first apply changes those bytes.
4. **Zero drift and retained slots.** It requires zero drift and refuses permanently after a retained
   slot is emptied or replaced.
   - Spec 1 reports provenance drift as an inert state
     (`2026-08-21-developer-os-opt-in-surfaces-design.md:593-595`).
   - Uninstall runs regardless of config drift
     (`2026-08-21-developer-os-opt-in-surfaces-design.md:4024-4027`).
   - Retained evidence is inert after handoff
     (`2026-08-28-developer-os-release-update-design.md:1741-1747`).

Used as Spec 1's gate, it would lock recovery, status, doctor and uninstall out of every crashed,
compacting or drifted install.

**Proposed text.** §2.1 gains "Admission of an installed V2 home".

- **Admission is structural only:**
  - a strictly valid V2 manifest;
  - matching nonce and allocator;
  - the exact global lock;
  - the three journal roots.
- **It does not bind to any bootstrap plan or manifest hash,** and retained bootstrap evidence never
  refuses it.
- **Closure and drift are evaluated afterwards, per operation, under §2.2 and §2.4.** Recovery,
  status, `doctor` and uninstall are admitted at every closure state and every drift. Mutations
  require what §2.2 and §2.4 already require.
- **A recovery-only arm covers an uninstall whose manifest is already moved.** From `M(preserve_before)`
  the manifest is a journal-owned tombstone (`2026-08-21-developer-os-opt-in-surfaces-design.md:4074-4080`).
  Before durable `M(commit_absence)` recovery must compensate. After it, later steps remove the manifest
  tombstone, the key tombstone, the nonce, the allocator, the journal and finally the plan. Spec 1
  requires recovery to handle every one of those states
  (`2026-08-21-developer-os-opt-in-surfaces-design.md:4080-4089` and
  `2026-08-21-developer-os-opt-in-surfaces-design.md:1839-1853`). The arm is defined by the coordinator's
  cursor.
  - **Either** exactly one valid `uninstall/present_manifest` journal whose cursor has reached
    `M(preserve_before)`, applied or completed
    (`2026-08-21-developer-os-opt-in-surfaces-design.md:1532`). Before durable `M(commit_absence)` it
    admits only that coordinator's compensation, with the manifest absent, its tombstone present, and
    the key tombstone present exactly when the key's before-state was present. From durable `M(commit_absence)` onward it admits only force-forward,
    with:
    - the manifest absent, and its tombstone present exactly while the cursor is before
      `M(finalize_tombstones)`;
    - the key tombstone present exactly while the cursor is before `K(delete)`;
    - nonce and allocator in one of the three microstates the compacting cursor allows
      (`2026-08-21-developer-os-opt-in-surfaces-design.md:1846-1848`);
    - the participant, effect and staging ledgers that §2.4 closure validates for that coordinator,
      up to its compaction cursor (`2026-08-21-developer-os-opt-in-surfaces-design.md:1820-1835`);
  - **or** the exact plan-plus-lock or plan-only `uninstall/present_manifest` envelope, with both control
    files absent, completed by the guarded orphan rule
    (`2026-08-21-developer-os-opt-in-surfaces-design.md:1849-1853`).

  In every case the global lock is present, because uninstall never removes it (A12).

The Spec 2 handoff set (`2026-08-28-developer-os-release-update-design.md:1789-1800`) stays the
condition a fresh `init` must reach, not the condition every later command re-proves.

**Uninstall dispatch order** is fixed: A7's recovery-only arm, then A3's absent-manifest shapes.

**Why a decision.** It changes which contract plan 1a composes. The alternative keeps the strict
handoff check and adds per-operation exemptions to it, which recreates this list as special cases.

**Code impact.** Plan 1a replaces `admitV2Handoff` (`apps/cli/src/bootstrap/report.ts:1510-1523`) as
Spec 1's gate, with the NEW-82 items.

---

## A8 — Ceiling gates may use a counting seam · decision required

**Finding.** Two §7 gates require physical ceilings:

- "terminal collection stays bounded" compacts to "the exact 10,000/100,000/1,000,000 ceilings"
  (`2026-08-21-developer-os-opt-in-surfaces-design.md:4237`);
- the absent-manifest walk is proven "at every 1,000,000-entry/128-component/4096-byte boundary"
  (`2026-08-21-developer-os-opt-in-surfaces-design.md:4276`).

A million-entry fixture per boundary case has not been measured on this repository's CI runners,
which were measured at ~1.9x the development laptop (`docs/architecture/foundation.md:902-906`). The blob and
object ceilings are already arithmetic-admitted
(`2026-08-21-developer-os-opt-in-surfaces-design.md:4251`) and belong to Spec 1b.

**Proposed text, recommended.** Such a gate may prove its exact maximum and first-over case through
the production counting path over an injected enumerator, provided that:

- the counting path is the one production uses; and
- one small physical fixture proves the injected and the real enumerator agree.

**The alternative** keeps physical million-entry fixtures and measures their CI cost first.

---

## A9 — Uninstall followed by `init` is a gate

**Finding.** No §7 gate proves that what uninstall leaves is admitted by the next `init`. The V1
equivalent of this path was found broken only by a probe in Phase 3's final review (D20). As first
drafted, this amendment would also have broken it for V2; A12 exists because of that.

**Proposed text.** §7 gains "uninstall then init round-trips". On a synthetic home each sequence
succeeds without manual action, and retained bootstrap evidence stays inert:

1. V2 `init` → present-manifest uninstall → `init`;
2. V2 `init` → uninstall → uninstall again → `init`;
3. absent-manifest key deletion → `init`;
4. `key_absent` → `init`;
5. present-manifest uninstall killed at `M(preserve_before)` before and after its cursor advance,
   `M(commit_absence)`, `K(delete)`, `M(finalize_tombstones)`, each control-file microstate,
   plan-plus-lock and plan-only → uninstall → `init` (A7's recovery-only arm);
6. V2 `init` rolled back → uninstall → `init`;
7. two complete install/uninstall cycles → `init`, with every cycle after the first admitting the
   bookkeeping set by shape;
8. fresh V2 `init` → `config set` and `git enable` preview, with closure `clear` beside retained
   evidence (A13).

---

## A10 — The pinned `launchctl` row no longer matches the development machine · decision required

**Finding.** Both launchd process tables pin macOS 26.5.2 build `25F84` and one `/bin/launchctl` hash
(`2026-08-21-developer-os-opt-in-surfaces-design.md:3494-3524`). Any other row is
`unsupported_launchd_distribution` (`2026-08-21-developer-os-opt-in-surfaces-design.md:3720`), and
certification is per exact build (`2026-08-21-developer-os-opt-in-surfaces-design.md:3729-3734`). The
development machine reports 26.6.2 build 25G83. The Git distribution row carries the same risk by
design (`2026-08-21-developer-os-opt-in-surfaces-design.md:4339-4343`).

**Proposed text, recommended: none in this amendment.**

- Launchd and Git are Spec 1b (D9), and roadmap Phase 9 already requires a freshly measured row with a
  re-pinning rule.
- Measuring needs the live machine and a certification run, which is a founder stop.
- A new Phase 9 backlog row carries it.

**The alternative** re-measures now, four phases early, and the row would likely drift again.

---

## A11 — A dated change table replaces the seven correction narratives

**Finding.** The status header carries seven successive correction packages as prose
(`2026-08-21-developer-os-opt-in-surfaces-design.md:18-54`). A reader cannot tell which clause each
package changed.

**Proposed text.** One table: date, approval, package, sections changed. It has one row per package,
the 2026-08-28 complete-spec approval, and this amendment. Editorial only.

---

## A12 — Uninstall leaves the bookkeeping set; fresh `init` admits it by shape · decided 2026-09-17; admission rule and ownership need approval

**Finding.**

- **Spec 1 never unlinks the global lock:**
  `2026-08-21-developer-os-opt-in-surfaces-design.md:656-659`,
  `2026-08-21-developer-os-opt-in-surfaces-design.md:1856-1858`,
  `2026-08-21-developer-os-opt-in-surfaces-design.md:4225-4226` and the §7 gate at
  `2026-08-21-developer-os-opt-in-surfaces-design.md:4237`.
- **Spec 2 calls it permanent** once `init`'s point of no return is durable
  (`2026-08-28-developer-os-release-update-design.md:1149-1152`).
- **Shipped fresh `init` refuses what a lock-keeping uninstall leaves:**
  - it reuses a leftover lock only when a `rolled_back` envelope's creation evidence owns it
    (`apps/cli/src/bootstrap/report.ts:651-673`, `apps/cli/src/bootstrap/executor.ts:1210-1235`);
  - it counts an envelope as inert only when every file its plan created is absent by path, the lock
    included (`apps/cli/src/bootstrap/report.ts:719-737`), so a remaining lock blocks the next `init`
    (`apps/cli/src/bootstrap/report.ts:1134-1136`);
  - it refuses an empty reusable directory with no retained evidence below it
    (`apps/cli/src/bootstrap/executor.ts:1144-1158`).
- **Creation evidence cannot bind every bookkeeping path.**
  - Fresh `init` creates a fixed directory list (`apps/cli/src/bootstrap/executor.ts:1815-1828`).
  - `staging/lifecycle` is first created by a Spec 1 coordinator, and `backups/transactions` by a
    Foundation backup (`packages/core/src/transactions/executor.ts:1740-1742`), so neither has
    evidence.
  - A reused lock gets the same identity recorded by every later envelope, so identities repeat across
    cycles.
- **Manifest ownership changes between cycles.**
  - First-cycle `init` writes the lock as an `ephemeral` row
    (`apps/cli/src/bootstrap/executor.ts:2184-2190`), and the journal roots and `state/transactions`
    as `content` directory rows (`apps/cli/src/bootstrap/executor.ts:2151-2166`).
  - §6 step 3 would remove those rows when empty
    (`2026-08-21-developer-os-opt-in-surfaces-design.md:4059-4062`), although §2.4 closure requires all
    four roots (`2026-08-21-developer-os-opt-in-surfaces-design.md:694-698`).
  - A later cycle drops reused directories from its created paths
    (`apps/cli/src/bootstrap/executor.ts:1833-1835`).

**How this item got here.** The first draft had uninstall unlink the lock last. That final step is
unjournaled, and four review rounds kept finding crash states it left. The second draft bound leftover
paths to creation evidence. Review showed that the evidence does not exist for two paths and repeats
across cycles. Shape admission replaces both, the same way shipped `init` already admits a leftover
bootstrap leaf (`apps/cli/src/bootstrap/executor.ts:1217-1226`).

**Proposed text.**

- **The bookkeeping set is closed:**
  - `state/.lifecycle.lock`;
  - the three journal roots;
  - `state/transactions`, `staging/lifecycle`, `staging/transactions` and `backups/transactions`;
  - their parents `staging` and `backups`.
- **Uninstall never removes the bookkeeping set.** The documented post-uninstall residue is:
  - that set, with every directory compaction has emptied;
  - inert retained evidence;
  - the bootstrap leaf.
- **Admission by shape.** Where no manifest exists, fresh `init` (Spec 2 §6.1) and absent-manifest
  uninstall (A3) admit each bookkeeping path by its exact shape:
  - the lock as an owner-only `0600` zero-byte single-link regular file;
  - each directory as an owner-only `0700` directory whose only entries are other bookkeeping paths,
    inert retained evidence, or ancestor directories of that evidence (such as
    `staging/fresh-v2-init`).

  Shape grants no authority. The directories hold nothing, and whether the lock is live is decided by
  acquiring it. A held lock is busy, and the command refuses.
- **Recommended: the bookkeeping set is never a manifest row, in any cycle.**
  - §2.1's "records exactly three product-owned `content` directories"
    (`2026-08-21-developer-os-opt-in-surfaces-design.md:172-176`) becomes: new `init` creates the
    journal roots as bookkeeping, and §2.4 closure, not the manifest, requires them.
  - §2.1's "rather than a manifest artifact" (`2026-08-21-developer-os-opt-in-surfaces-design.md:168-170`)
    then stays true.
  - Shipped `init` stops writing those rows.
  - **The alternative** records them as rows in every cycle, reuse included, and makes step 3 skip
    them. That needs the same executor change plus a reuse arm in manifest generation.
- **Acquirers** open `state/.lifecycle.lock` without `O_CREAT`; only Spec 2's fresh `init` creates it.
  On a V2 home an absent path refuses. A V1 home never has the lock, and its Foundation commands do
  not take it (A1).
  - `config`, `git` and `automation` over a home without a manifest take the lock, find no manifest,
    and refuse.
  - Foundation commands over such a home are routed by the ordinary-command gate
    (`docs/architecture/foundation.md:427-441`) and never create the lock.
- **Spec 2 changes this requires,** written as a companion amendment for the same approval:
  1. §6.1 `admittedPreexistingPaths` covers the bookkeeping set, the lock file included. Its grammar
     today covers retained evidence and reusable empty directories
     (`2026-08-28-developer-os-release-update-design.md:991-994`).
  2. A pre-existing lock enters the plan through `admittedPreexistingPaths` instead of
     `createdPaths[0]`. A planned global lock admits only `expectedBefore: "absent"`
     (`packages/core/src/manifest/bootstrap.ts:232-239`), and each created-path transition proves the
     target absent (`2026-08-28-developer-os-release-update-design.md:1583-1585`). Spec 2's
     "`createdPaths[0]` is the exact permanent global-lock transition"
     (`2026-08-28-developer-os-release-update-design.md:1109-1111`) and the plan validator's matching
     check (`packages/core/src/manifest/bootstrap.ts:1826-1828`) become conditional on the lock being
     absent.
  3. §6.4 says the bookkeeping set is never a live target attributable to an envelope. That covers
     `rolled_back` inertness (`2026-08-28-developer-os-release-update-design.md:1749-1751`) and
     `unverified` (`2026-08-28-developer-os-release-update-design.md:1753-1758`).
  4. §6.1 names `staging` and `backups` explicitly, which retires NEW-69's `backups` exemption.
- **Code, in plan 1a**, in the task that makes A9's round trips pass:
  - executor admission by shape, replacing the rolled-back-only identity path;
  - manifest generation without bookkeeping rows;
  - the inertness check (`apps/cli/src/bootstrap/report.ts:719-737`) ignoring the bookkeeping set;
  - the updated pin test (A4).

**Residual, recorded in §8.3.** Shape admission accepts a planted empty directory or zero-byte file at
a bookkeeping path. Neither grants anything a same-uid process could not already do.

---

## A13 — Journal closure must admit retained bootstrap evidence

**Finding.** Every finalized fresh `init` leaves retained evidence inside Spec 1's ledger roots. Spec 1's
closure refuses it, so no Spec 1 mutation could ever run on a real V2 install.

- **Where the evidence lands.** The bootstrap Foundation participant's initial journal lives at
  `state/transactions/<tx_fi_…>.json` (`apps/cli/src/bootstrap/executor.ts:1748-1752`). Retention moves
  it, in the same parent, to `.developer-os-retained.<bootstrap-id>.<ordinal>.tombstone`
  (`2026-08-28-developer-os-release-update-design.md:1672-1673`), and nothing ever deletes it
  (`2026-08-28-developer-os-release-update-design.md:1777-1778`).
- **Why closure refuses it.**
  - The Foundation root admits only `<journal.id>.json` and `.<valid-id>.lock`; every other name is
    malformed (`2026-08-21-developer-os-opt-in-surfaces-design.md:769-770` and
    `2026-08-21-developer-os-opt-in-surfaces-design.md:782-784`).
  - An unknown-name leaf makes closure `lifecycle_recovery_required` globally
    (`2026-08-21-developer-os-opt-in-surfaces-design.md:1786-1788`).
  - Bootstrap participant IDs `tx_fi_…` and `tx_mm_…` (`packages/core/src/manifest/bootstrap.ts:283-285`)
    match neither Spec 1 ID grammar (`2026-08-21-developer-os-opt-in-surfaces-design.md:829-830`).
- **Contradiction.** Spec 2's handoff promises "a clear lifecycle journal closure plus a terminal or
  inert retained bootstrap envelope" (`2026-08-28-developer-os-release-update-design.md:1789-1800`).
  Shipped admission checks only three journal roots and `rollback`
  (`apps/cli/src/bootstrap/report.ts:1499-1502`), so it never noticed.

**Proposed text.** §2.4 closure and the companion-inventory rules
(`2026-08-21-developer-os-opt-in-surfaces-design.md:736-745`) project away:

- `.developer-os-retained.<bootstrap-id>.<ordinal>.tombstone` leaves bound to an inert retained
  envelope;
- bootstrap `tx_fi_…` or `tx_mm_…` staging ID directories that hold only such tombstones.

They are never ledger leaves or compaction targets. They count toward the 10,000-leaf and companion
caps. Spec 2's aggregate bound of 256 bootstrap IDs keeps them far below those caps.

**Gate.** A9 gains sequence 8: fresh V2 `init` → `config set` and `git enable` preview succeed, with
closure `clear` beside retained evidence.

---

## Approval

On approval, in one commit:

1. apply A1–A13 in place, each marked "Amended 2026-09-17";
2. record A2, A3 and A12 as roadmap founder decisions, and apply A12's companion Spec 2 amendment
   (§6.1 and §6.4), dated;
3. rewrite roadmap Phase 4's first bullet, which still says "retention replaces every
   unlink/rmdir/plan-last clause in §§2.3, 2.4, 6" and "the three collision codes exist";
4. add the Phase 9 `launchctl` row (A10);
5. close or narrow NEW-67, and narrow NEW-83 to what A3 does not settle;
6. delete this file.

Plan 1a is then written against the amended text: Spec 1 plan Tasks 1–7, 21 and 23, with Task 2
after Task 4.

## Review record

A fresh agent that did not write this document reviewed it in six rounds on 2026-09-17. The findings
reshaped A3, A7 and A12 and added A13. The sixth round's two Important findings (H1, now A13; H2, now
in A1 and A12) were applied without a seventh round. A reviewer of the approved text should start
there.
