# Spec 2 closure plan: `update --apply` / `update rollback --apply`

Written 2026-09-23 from a fresh-context analysis of the blockers reported by the Spec 2 Task 24 and
Task 25 implementers. Founder decisions F1–F4 were answered with option A (**D60** in the roadmap);
the Spec 2 design carries them as "Amended 2026-09-23 (D60)", F4 as accepted residual 10 in §13.3.
Lane: D56 (tests written, not run; `npm run lint` per commit; tests and review at phase close).

**Amendment to the analysis:** Task 25 (`c8802e1`) has landed with ports mirroring Task 24; closure
Task 10 below therefore binds rollback's production ports and closes Task 25's reported blockers
(production `composeRollback`, `retirementLeaves`/`retireLeaf` for
`consumed_rollback_and_rejected_release`, `bundle/verify_previous` and `verify_retained`
participants, state-postimage identities for compensation, V2 closure residue `update_rollback`,
and Task 20's empty plan-only `externalEffects`).

## Status 2026-09-24

Closure Tasks 1–8 committed (`404a59e` `8a837d5` `632b4b6`, `32b7477`, `2f8120b`, `bb5a2fd`,
`d32a167`, `3388508` `73b29c1`, `4bf3912`), tests written and not run (D56). They closed blockers
(a)–(e), the `oe`/`rb` allocator prefixes, the duplicate journal-path helper and the verifier and
Codex process ports; their bodies, the blocker verdicts and F1–F4 were deleted on 2026-09-24 (git
history holds them). Their tests and review are owed at the Phase 8 close, listed in
`plans/2026-08-29-developer-os-release-update.md` ("Phase 8 close"). **Tasks 9 and 10 are blocked on
design (BACKLOG NEW-110)** and parked by the founder's order of work (D16: update follows the
cutover; D61: Spec 2 apply parked).

### Blocked 2026-09-23 — closure Task 9 found

1. `BundleSourceStagingPlanV1` / `RollbackPayloadSourceStagingPlanV1` require `sourceParentDev/Ino`
   of `update/source/{bundle,rollback}` (`bundle-participant.ts:105,412`, `rollback.ts`), but those
   plans are hashed into the construction plan before any directory exists, and construction never
   lists `update/source/*` (`packages/core/src/update/construction.ts:827,915`); tests `mkdir` by hand.
2. `validateManifestBytesState` requires non-null `after.dev/ino` equal to the payload identity for
   lifecycle envelopes (`manifest-state.ts:383`) and a transitional `before` identity (`:380`) —
   both unknowable before execution. The analysis above wrongly said the manifest avoids the cycle.
3. No CLI participant handles the V2 `manifest/*` steps (`preserve_before`, `publish_transitional`,
   `publish_terminal`, `finalize_tombstones`); `ManifestStateParticipant.apply` fuses preserve and
   publish; the transitional versus terminal manifest content is unspecified.
4. `guarded_signed_metadata` needs a file with a known path and dev/ino, but `planUpdate` discards
   the delegation, index and bundle-manifest bytes (`planning.ts:585,625`) and scratch keeps none.
5. `PersistedManagedPathStateV1` has no ephemeral state and `keep` requires `before` ≠ `absent`
   (`participants.ts:318`), so a real home's absent ephemeral reservation cannot be planned.
6. Nothing outside tests builds `OwnerExternalEffectProcessPolicyV1` for the Codex refresh.

Minor: `allocate()` needs the block size (`allocate(prefixes)` via `reserveIds`); no
`UpdateFallbackHandoffV1` source outside `init --local-release`; leaf-plan hashes mix plain SHA-256
(owner/state/migration) and the `update-leaf/<kind>` domain (bundle/rollback) against spec :3990;
F3's exit mapping and `readHome` → `inspectClosureV2` are one-line fixes.

## Scope

- **What "end to end" can mean today.** Only the synthetic Task 26 fixture, not the founder's machine. Two things block the real path no matter how (a)–(e) are fixed, and they belong to Task 11b/A16:
  - `LAUNCHER_OFFLINE_RELEASE_ROOTS = []` (`apps/launcher/src/main.ts:60`, D46).
  - No production target planner or verifier binary exists. `bin/planner` and `bin/verifier` appear only in `apps/cli/src/update/testing.ts:136-137`.
- **The actual missing half of Task 24.** Production never binds `CliUpdateContext.apply`, and `apps/cli/src/update/context.ts:147-152` says so. Blockers (a)–(e) are why nobody could write the `compose` port. The top-level task below is therefore "bind the production `UpdateApplyPortsV1`", and everything else feeds it.

## Closure tasks (open)

Under the D56 lane, each **Test** is written and run red→green filtered with `-t`. The full suite runs at the checkpoint.

Order: Task 9, then Task 10, once NEW-110's design is decided.

9. **`compose` and the production apply binding** (L). Depends on Tasks 1, 2, 3, 5, 6, 7 and 8.
   - **Where:** new `apps/cli/src/update/compose.ts` and `apps/cli/src/update/apply-ports.ts`; `apps/cli/src/update/context.ts:147-152` binds `apply`.
   - **How:**
     - From `MaterializedUpdateV1` plus the allocated IDs, build every leaf plan: owner and migration (with V2 refs), four state plans, bundle source and publication, rollback source and state, verifier, retirement, and execution.
     - Then build `buildConstructionPlan`, `buildUpdateCoordinatorPlan`, the outer bytes, and the exact capacity.
     - Wire `UpdateStepDispatcher` handlers, `UpdateCoordinatorJournalStore`, the executor record, and the global lock.
     - Result mapping follows F3.
   - **Test:**
     - An `apply.test.ts` death point at every outer and nested cursor over the real ports and the synthetic fixture.
     - The re-run under the lock is byte-identical to the preview.
     - A rejected verifier → the old active release and trust retained.
     - A concurrent edit → the correct refusal.
     - The Task 24 matrix, carried here from the release plan's deleted Task 24 body (an automatic
       rollback maps to the F3/D60 error envelope, not a success outcome): every under-lock recheck, candidate request/input/result/preview equality, post-allocation overflow gap-only refusal, construction/source handoff, exact step order, owner/effect/migration/rollback payload/transitional manifest/trust/record/active/verifier, point of no return, fallback routing, old rollback retirement, terminal manifest/tombstone, nested/top-level compaction, trust retained after compensation, concurrent edit/third-state refusal, and scratch lifecycle.

10. **Task 25, `update rollback --apply`** (L). Depends on Task 9.
    - **Where:** `apps/cli/src/update/rollback-apply.ts` and `commands/update/index.ts`, as in the plan.
    - **How:**
      - Local-only rollback over the same `compose`, using the inverse slots and the `consumed_rollback_and_rejected_release` retirement.
      - A rejection from the previous release's verifier compensates back to the rejected current release.
    - **Test:** the Task 25 matrix, carried here from the release plan's deleted Task 25 body:
      post-update edits refuse exit 3 before allocation; every rollback apply death point recovers
      without network to the expected active release. Cover record/payload/inverse/manifest/bundle/metadata exact evidence, zero network/planner, sufficient inverse capacity, verify-previous bundle, retained payload then record adjacency, reverse migrations/effects/owners, transitional manifest, previous active, previous verifier point of no return, fallback routing, consumed payload/record/rejected bundle retirement, terminal manifest/tombstone, compensation to rejected current before verifier success, and unchanged trust high watermarks.
