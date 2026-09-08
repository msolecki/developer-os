# Spec 2 amendment for NEW-68 — proposed 2026-09-08, **not approved**

**Status: awaiting founder approval.** This document is the roadmap Phase 3 stop condition. Approved
specs are not silently rewritten, so the eight corrections below are stated here, with their
evidence, before a single line of them is folded into Spec 2
(`docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md`) or the baseline plan
(`docs/superpowers/plans/2026-08-29-developer-os-release-update.md`). On approval each item is marked
"Amended 2026-09-08" in place, this file is deleted, and baseline Task 8 may begin.

Scope is exactly NEW-68 (`BACKLOG.md:44`). Nothing else in Spec 2 changes. Citations are written with
the file basename so the repository citation gate resolves and bounds-checks every one of them.

Three of the eight require a founder decision, because they change an approved interface, an approved
number, or the accepted-residual list: **A1**, **A6** and **A8**. The other five correct
specification text against a contract Spec 1 or the shipped implementation already settled, and are
not in dispute.

A8 is not in NEW-68's row; the roadmap's Phase 8 line names it as one of NEW-68's corrections, so it
is carried here rather than lost. Where NEW-68's own text and this document disagree on a count or a
line, this document is measured and NEW-68 is stale — the differences are noted in place.

---

## A1 — `ManifestMigrationPlanV1` cannot state what it admitted · decision required

**Finding.** `2026-08-28-developer-os-release-update-design.md:942` opens `FreshV2InitPlanV1`, which
carries `admittedExternalShapeHash` at
`2026-08-28-developer-os-release-update-design.md:946` and `admittedPreexistingPaths` at
`2026-08-28-developer-os-release-update-design.md:950`.
`2026-08-28-developer-os-release-update-design.md:1164` opens `ManifestMigrationPlanV1`, which
carries neither. The shipped validator has the same asymmetry: `bootstrap.ts:1781-1783` splits
`freshKeys` from `migrationKeys`, and `bootstrap.ts:1795-1806` computes and checks the three-role
projection on the fresh arm only — and `bootstrap.ts:1811` goes further, refusing the migration arm
outright whenever an external shape is supplied at all.

**Why it matters.** The §6.1 admission rule exists so that a bootstrap which finds the product home,
`state` and the bootstrap lock already present can prove it admitted exactly those three external
inodes and nothing else. The lock is created by the attempt on both arms, but the product home and
`state` pre-exist — and on a V1 installation they always pre-exist, populated, whereas a fresh init
usually creates them. Migration is therefore the arm where an unadmitted external inode is most
likely, and it is the one arm with no digest to exclude it. §6.2's preflight
(`2026-08-28-developer-os-release-update-design.md:1103-1114`) covers the V1 manifest, its backups
and the V2-only path reservations; it says nothing about the shape of the three roots themselves.

**Proposed text.** Add both fields to `ManifestMigrationPlanV1` with semantics identical to §6.1, and
state that the bootstrap-locked second inventory must contain exactly the three projection rows
before plan publication on both arms.

The digest domain cannot be shared. `admittedExternalShapeHash` is defined at
`2026-08-28-developer-os-release-update-design.md:1027-1029` over
`developer-os/fresh-v2-external-shape/v1\0`, and the shipped function hard-codes that string at
`bootstrap.ts:677`. Every other operation-scoped name in this subsystem is already per-operation —
`fresh-v2-init` against `manifest-migration` (`bootstrap.ts:591`), `tx_fi` against `tx_mm`
(`bootstrap.ts:1618`), `fi_` against `mm_`. The amendment follows that convention: the migration arm
hashes `developer-os/v1-migration-external-shape/v1\0` over the same
`BootstrapExternalShapeProjectionV1`, and neither domain is ever accepted for the other operation.

**Shipped-code impact.** Baseline Task 8. `migrationKeys` gains both fields;
`bootstrapExternalShapeHash` takes the operation and selects the domain; the projection check runs on
both arms; `bootstrap.ts:1811` stops refusing a supplied external shape on the migration arm; and
`admitFreshRecoveryExternalShape` (`bootstrap.ts:430`, called at `bootstrap.ts:1798`) stops being a
fresh-only hook.

**The decision.** Approving A1 widens an approved interface. The alternative is to record in §6.3
that migration deliberately admits its external shape through the V1 manifest authority instead and
to keep the asymmetry — but since the §6.2 preflight never observes the lock inode, that alternative
leaves a real gap rather than closing one. Recommendation: approve as written.

---

## A2 — §6.2 does not state the verification mode of the artifacts a migration adds

**Finding.** The V1 mapping at
`2026-08-28-developer-os-release-update-design.md:1143-1150` ends with "all new lifecycle/release
artifacts use `existedBefore: false` and null restore fields" and says nothing about
`verification.mode`. §3.2 (`2026-08-28-developer-os-release-update-design.md:231-248`) gives the mode
for every path Spec 2 reserves, but the three Spec 1 control paths appear in §6.2 only as collision
refusals, at `2026-08-28-developer-os-release-update-design.md:1112`.

**The answer already exists in Spec 1** and is not in dispute:

| Path | V2 artifact mode | Created by |
|---|---|---|
| `state/lifecycle-install-nonce` | regular-file `content` | Spec 2 migration / new init |
| `state/lifecycle-id-allocator.json` | regular-file `schema`, `lifecycle-id-allocator-v1` | Spec 2 migration / new init |
| `state/lifecycle-activation.json` | regular-file `content` | **Spec 1 lifecycle apply only, never migration** |

Sources: the nonce and the allocator are both fixed by
`2026-08-21-developer-os-opt-in-surfaces-design.md:155-157`, and the allocator's creator by
`2026-08-21-developer-os-opt-in-surfaces-design.md:119-120`; the activation rule is
`2026-08-21-developer-os-opt-in-surfaces-design.md:117-119`. The schema id
`lifecycle-id-allocator-v1` is Spec 2's own, from the closed set at
`2026-08-28-developer-os-release-update-design.md:680-685`.

**Proposed text.** Add that table to §6.2's mapping as a fourth bullet group; state that every other
artifact a migration adds takes the mode §3.2 already assigns to its path; and state explicitly that
migration creates the nonce and the allocator and never creates the activation record — which is what
makes `activation_path_collision`
(`2026-08-21-developer-os-opt-in-surfaces-design.md:115`) a refusal rather than an adoption.

**Shipped-code impact.** None expected. The migration mapper is baseline Task 8 and does not exist
yet; this fixes the text it will be written against.

---

## A3 — the CLI evidence layer recognises only fresh-init identifiers

**Finding.** Migration residue is invisible to the surface that is supposed to refuse over it.

- `report.ts:58-59` — `FRESH_PLAN` and `FRESH_SLOT` match `fresh-v2-init.fi_…` only.
- `report.ts:278` and `report.ts:1126-1127` pass the literal `"fresh_v2_init"` to
  `deriveBootstrapEnvelopePaths` and drop any id that does not start with `fi_` from the summary.
- `apps/cli/src/bootstrap/context.ts:21-22` — `INITIAL_NAMESPACE` admits
  `fresh-v2-init.fi_….{plan,journal.N}.json` and `FRESH_STAGING_ID` matches `fi_` only. Both admit
  `mm_` in the retained-tombstone arm alone, and they gate the inventory itself at
  `apps/cli/src/bootstrap/context.ts:158` and `apps/cli/src/bootstrap/context.ts:173`.
- `report.ts:536-545` — `idForPath` returns non-null only for fresh-v2-init names, `fresh-v2-init`
  staging ids and retained tombstones.
- Core already supports both operations: `bootstrap.ts:581-591` derives the `manifest-migration`
  prefix from its `operation` argument.

**The requirement it breaks.** `2026-08-28-developer-os-release-update-design.md:1668` — "non-retained
live residue is active or ambiguous and blocks a new bootstrap as exit 6" — and the exit table at
`2026-08-28-developer-os-release-update-design.md:4699`, which names "migration residue" under exit 6.
A `manifest-migration.mm_…` plan left by an interrupted migration is live residue the CLI does not
see. **It is worse than an unreported row:** `INITIAL_NAMESPACE` rejects the name before the
inventory, so the plan is not classified as bootstrap residue at all — it reaches the general
unexpected-child path rather than the exit-6 one the specification names for it.

**Proposed text.** State in §6.3 that every bootstrap evidence, admission and namespace surface is
parametric over the operation set `{ fresh_v2_init, v1_to_v2 }`; that `manifest-migration.mm_…` plan,
journal, staging and payload names are recognised exactly as their `fresh-v2-init.fi_…`
counterparts; and that an unrecognised name inside the bootstrap namespace is exit 6 rather than an
unreported entry.

**Shipped-code impact.** Baseline Task 9, and it needs a failing test first: an interrupted migration
envelope must make `init` exit 6 and must appear in the evidence report. Today it does neither.

---

## A4 — §5.3 contradicts §6.3 on the immutable plan's byte bound

**Finding.** `2026-08-28-developer-os-release-update-design.md:846` reads "Thus the immutable plan
remains below 16 MiB even when a manifest approaches its 64-MiB payload bound."
`2026-08-28-developer-os-release-update-design.md:1455` reads "The plan is canonical and at most
256 MiB", and both bootstrap plans declare `maximumPlanBytes: Integer[1..268_435_456]`, at
`2026-08-28-developer-os-release-update-design.md:959` and
`2026-08-28-developer-os-release-update-design.md:1176`.

In §6.3's vocabulary "the immutable plan" is the bootstrap plan, so the two sentences contradict.
§5.3 is in fact describing `ManifestStatePlanV1`, whose own `maximumPlanBytes` is
`Integer[1..16_777_216]` at `2026-08-28-developer-os-release-update-design.md:792`, and which is
embedded in each bootstrap plan as `manifest`.

**The implementation already resolves it correctly:** `manifest-state.ts:28` is 16 MiB,
`bootstrap.ts:38` and `apps/cli/src/bootstrap/executor.ts:90` are 256 MiB, and
`apps/cli/src/bootstrap/executor.ts:1936` sets the embedded manifest plan to 16 MiB.

**Proposed text.** Reword `2026-08-28-developer-os-release-update-design.md:846` to "Thus the
manifest participant's own plan stays below its 16 MiB bound even when a manifest approaches its
64-MiB payload bound." No number changes.

---

## A5 — `SafeReasonCodeV1`'s only stated bound is 42 bytes wider than the shipped one

**Finding.** The type appears twenty-one times in Spec 2 — twenty in type position, plus the prose
sentence at `2026-08-28-developer-os-release-update-design.md:3859` — and is the `id` of fourteen
interfaces, nine plan and five journal. NEW-68's row calls that "used fourteen times"; fourteen is
the count of `id` sites, not of uses.

**NEW-68 states the defect as "never defined", and that is true but not the useful half.**
`SafeReasonCodeV1` is one of a class: `LowerHexSha256` (210 uses), `UInt64DecimalV1` (173),
`CanonicalAbsolutePathV1` (68), `UtcTimestampV1`, `EffectiveUidV1`, `StableSemverV1` and
`CanonicalJsonV1` are all used in Spec 2 and defined in neither specification. The scalar block at
`2026-08-28-developer-os-release-update-design.md:99-131` says so itself: it scopes itself to "the
internal path brands used below". These brands are imported from shipped core, and that is a
deliberate arrangement rather than an omission.

**What makes this one a defect is the bound.** The only constraint Spec 2 places on it is at
`2026-08-28-developer-os-release-update-design.md:3860-3861` — "a single ASCII path segment of at
most 106 bytes with no slash/dot segment or percent decoding". The shipped parser is far narrower:
`scalars.ts:74-80` allows `1..64` UTF-8 bytes matching `^[a-z][a-z0-9_]*$`. An implementer working
from Spec 2 alone would build a parser accepting uppercase, hyphens, digits in first position and
106-byte values, all of which the shipped one refuses — and this type is a plan `id` that becomes a
path segment, so the gap is a validation gap, not a cosmetic one.

**The implementation's definition, for the record:** `scalars.ts:74-80` — `1..64` UTF-8 bytes
matching `^[a-z][a-z0-9_]*$`.

**Proposed text.** Add to the scalar block, alongside a sentence recording that the remaining shared
brands come from core rather than from either specification:

> `SafeReasonCodeV1` is `1..64` ASCII bytes matching `[a-z][a-z0-9_]*`. It is the plan-id arm for
> every leaf kind with no allocated or derived identifier of its own, and it is never parsed to
> narrow a wider concrete ID. Its bound lies inside the 106-byte path-segment limit, so a derived
> plan path is safe by construction.

---

## A6 — the two "exact maximum succeeds" gates are unreachable · decision required

**Finding.** `2026-08-28-developer-os-release-update-design.md:4107-4113` derives an aggregate
retirement maximum of 1,200,012 leaves and requires that "exact maximum succeeds and the first extra
leaf refuses before intent". `2026-08-28-developer-os-release-update-design.md:4733` requires that
"both retirement sets cover exact full-tree maximum/first-over". Neither state can be constructed,
because the cardinality bound and the byte bound disagree.

**The arithmetic.** `RollbackPayloadInventoryV1`
(`2026-08-28-developer-os-release-update-design.md:4603`) admits `0..1_000_000`
`RollbackPayloadEntryV1` at `2026-08-28-developer-os-release-update-design.md:4608`, and
`2026-08-28-developer-os-release-update-design.md:4627-4628` bounds the inventory file at 64 MiB. The
smallest possible canonical entry is 153 bytes:

```
{"bytes":0,"ordinal":0,"path":"blobs/0000000000.bin","role":"owner_preimage","sha256":"<64 hex>"}
      9         11                29                             23                    75
  147 bytes of members + 4 separators + 2 braces = 153, plus one array comma = 154
```

Every field sits at its floor: ordinal `0`, `bytes: 0`, the shortest of the four roles, and the
derived `blobs/<ten-digit-ordinal>.bin` path. 1,000,000 × 154 = 154,000,000 bytes, which is
**146.9 MiB against a 64 MiB cap**. The reachable maximum is about **435,771** entries, and lower in
practice, since contiguous ordinals above 99,999 cost more digits.

The same class applies to `BundlePublicationPlanV1` and `BundleSourceStagingPlanV1`, at
`2026-08-28-developer-os-release-update-design.md:2932` and
`2026-08-28-developer-os-release-update-design.md:2947`, which embed
`ReleaseBundleEntryV1[1..200_000]` in a 16 MiB plan. A 200,000-entry bundle of directories encodes to
8.20 MiB and fits; the same count of files needs 24.03 MiB and does not — 126 bytes per entry, not
124, because `ReleaseBundleEntryV1.bytes` is `UInt64DecimalV1`
(`2026-08-28-developer-os-release-update-design.md:549`), a decimal **string**, so it encodes as
`"0"` rather than `0`. The bound is reachable only for a bundle shape no real release has.

**The specification already states the resolving rule, one section away**, at
`2026-08-28-developer-os-release-update-design.md:3864`: "Cardinality types are additionally
constrained by that byte cap; the first leaf that would make a plan exceed it refuses before
allocation."

**Proposed text — recommended.** Extend that clause explicitly to the retirement, rollback-inventory
and bundle plans, and restate both gates as: *the exact maximum admissible under **both** the
cardinality bound and the byte bound succeeds, and the first row over **either** bound refuses before
intent.* Record the derived byte-feasible maxima as illustrative rather than normative, so they need
not be re-derived every time an entry gains a field. No declared number changes, and the gates become
testable as written.

**Alternative A.** Lower each cardinality cap to its byte-feasible value. This changes approved
interfaces, and every derived value moves again the next time an entry shape changes.

**Alternative B.** Raise the byte caps — 64 MiB to 256 MiB for the payload inventory, 16 MiB to
32 MiB for the two bundle plans. This raises the 256 MiB streaming budget stated at
`2026-08-28-developer-os-release-update-design.md:566-571` and buys nothing the recommendation does
not.

---

## A7 — baseline plan Task 9 still orders a deletion §6.4 forbids

**Finding.** `2026-08-29-developer-os-release-update.md:179`, Task 9 Step 3, contains
"…force-forward after V2 publication; compact journal then plan last." Two more clauses in the same
task carry the same superseded vocabulary:
`2026-08-29-developer-os-release-update.md:149` ("migration resume/compensation/**compaction**") and
`2026-08-29-developer-os-release-update.md:169`, which orders tests over "plan/journal
**temp**/final … verification/**compaction**" — a journal temp path is exactly what §6.4 removed.

`2026-08-28-developer-os-release-update-design.md:1543-1547` supersedes "every deletion,
guarded-cleanup, journal-temp, and plan-last-compaction rule in §6.1 and §6.3", renames
`compactionNext` to `retentionNext` and terminal `compacting` to `retaining` then `retained`.
`2026-08-28-developer-os-release-update-design.md:1470-1471` requires that "`retained` requires that
table complete while both journal slots and the immutable plan remain durable", and
`2026-08-28-developer-os-release-update-design.md:4724` requires proof that bootstrap recovery
"invoke[s] no unlink/rmdir".

**Proposed text.** Replace the Step 3 clause with: "…force-forward after V2 publication; then
advance the derived retention table to `retained`, with the immutable plan and both journal slots
durable throughout." Rewrite `:149` to "migration resume/compensation/retention" and `:169` to
"plan/journal final and both slots, … verification/retention", so no step still orders a temp path or
a compaction the specification deleted.

This is a plan-text correction only. §6.4 was approved on 2026-08-31 and the plan sentence predates
it.

---

## A8 — the `symlink` artifact arm is unreachable in v1 · decision required

**Finding.** Roadmap Phase 8 names this as one of NEW-68's corrections; the row at `BACKLOG.md:44`
omits it, so it is carried here rather than lost.

`ManagedArtifactV2` has a `symlink` arm at
`2026-08-28-developer-os-release-update-design.md:657-663`, and nothing in Spec 2 can produce one:

- `2026-08-28-developer-os-release-update-design.md:693-695` — symlink `content` "is legal only for
  product-created links after a safe link-specific transaction operation exists; this specification
  creates none";
- `2026-08-28-developer-os-release-update-design.md:1110` and
  `2026-08-28-developer-os-release-update-design.md:1137` — migration refuses a V1 symlink artifact
  and excludes symlink rows from the migratable subset;
- `2026-08-28-developer-os-release-update-design.md:4131-4132` — "directories and symlinks are legal
  only as byte-identical `keep` rows in v1; their create, replace, or remove operations refuse before
  allocation";
- `2026-08-28-developer-os-release-update-design.md:4160` — "symlink mutations are incompatible as
  stated above".

A `keep` row can only preserve a row that was created earlier, and no arm creates one. The union arm
is therefore dead, along with its drift row at
`2026-08-28-developer-os-release-update-design.md:723`, the planner draft arm at
`2026-08-28-developer-os-release-update-design.md:2193-2198`, and the two `symlink` state arms at
`2026-08-28-developer-os-release-update-design.md:2099` and
`2026-08-28-developer-os-release-update-design.md:3013`.

**Proposed text — recommended.** Keep the arm and record it as an explicit accepted residual in
§13.3, alongside the eight already there: *the `symlink` artifact arm is validated but unreachable in
v1; no Spec 2 path creates, migrates or mutates a link, and the arm exists so a later link-capable
transaction operation does not require a manifest schema bump.* Add one exact-set test asserting that
no Spec 2 path produces a symlink artifact. That converts dead code into a checked invariant, which
is the outcome the repository's own gate discipline asks for.

**Alternative.** Delete the arm from v1. It removes real dead code, but the edit reaches the V2
validator, the drift table, the planner draft union and both state arms, and it would have to be
reversed the first time links ship. Recommendation: keep and document.

---

## What approval unblocks

Baseline Task 8 (`2026-08-29-developer-os-release-update.md:69-131`) and Task 9
(`2026-08-29-developer-os-release-update.md:133-198`) — roadmap Phase 3, ten unchecked steps. The
Phase 3 gate is unchanged: `apps/cli/src/context.ts:765` no longer pins
`bootstrap: { state: "unavailable_until_packaged_handoff" }`, and a fresh `init` runs the V2 path in
production.

NEW-68 also names defects that reach into Phase 8, Tasks 10–26: the undefined `SafeReasonCodeV1`,
the impossible gates, and — in the roadmap's Phase 8 line rather than in the row itself — the
unreachable `symlink` arm. Those are A5, A6 and A8 here, so NEW-68 closes completely on approval
rather than being carried into Phase 8.
