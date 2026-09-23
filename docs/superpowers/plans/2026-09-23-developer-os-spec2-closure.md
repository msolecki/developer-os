# Spec 2 closure plan: `update --apply` / `update rollback --apply`

Written 2026-09-23 from a fresh-context analysis of the blockers reported by the Spec 2 Task 24 and
Task 25 implementers. Founder decisions F1–F4 below were answered with option A (**D60**). Lane:
D56 (tests written, not run; `npm run lint` per commit; tests and review at phase close).

**Amendment to the analysis:** Task 25 (`c8802e1`) has landed with ports mirroring Task 24; closure
Task 10 below therefore binds rollback's production ports and closes Task 25's reported blockers
(production `composeRollback`, `retirementLeaves`/`retireLeaf` for
`consumed_rollback_and_rejected_release`, `bundle/verify_previous` and `verify_retained`
participants, state-postimage identities for compensation, V2 closure residue `update_rollback`,
and Task 20's empty plan-only `externalEffects`).

## Scope

- **What "end to end" can mean today.** Only the synthetic Task 26 fixture, not the founder's machine. Two things block the real path no matter how (a)–(e) are fixed, and they belong to Task 11b/A16:
  - `LAUNCHER_OFFLINE_RELEASE_ROOTS = []` (`apps/launcher/src/main.ts:60`, D46).
  - No production target planner or verifier binary exists. `bin/planner` and `bin/verifier` appear only in `apps/cli/src/update/testing.ts:136-137`.
- **The actual missing half of Task 24.** Production never binds `CliUpdateContext.apply`, and `apps/cli/src/update/context.ts:147-152` says so. Blockers (a)–(e) are why nobody could write the `compose` port. The top-level task below is therefore "bind the production `UpdateApplyPortsV1`", and everything else feeds it.
- **Task 25 is not started.** `update rollback --apply` still returns `unavailable` (`apps/cli/src/commands/update/index.ts`), and every blocker below also blocks rollback.

## Blocker verdicts

| # | Verdict | Evidence |
|---|---|---|
| **a** | **(1) Code gap. The spec has one omission (F1).** | The executor's lifecycle bridge hardcodes the V1 paths. `validateLifecycleFoundationBridgeInput` (`packages/core/src/transactions/executor.ts:620-650`) requires `staging/lifecycle/<lc>/foundation/<tx>/journal.json` and a mutation `stagedPath === staging/transactions/<tx>/<i>.bin`. V2 update refs use a different initial-journal path: `participants/foundation/<tx>/initial-journal.json` (spec:964, `paths.ts:237`). Their mutation `stagedPath` is the update payload path (`migrations.ts:420`, `construction.ts:722`). Do **not** add V2 slots to `FOUNDATION_PARTICIPANT_SLOTS` (`lifecycle/types.ts:43`): spec:925-926 forbids V1 plans from accepting V2 refs, and the V2 slots already live in `FoundationParticipantSlotV2` (`bootstrap.ts:264`). The fix is a third executor arm modelled on the bootstrap one (`executor.ts:374`, `:1358`). The precedent is §6.3 spec:1517-1523: bootstrap publishes the content and `.bin.sha256` to the standard `<tx>/<i>.bin` path, then publishes the journal. §5.3 (spec:943-947) says nothing equivalent for update refs. |
| **b** | **(1) Code gap.** | The classifier and the observation type exist (`lifecycle/recovery.ts:312-366`), but nothing produces the observation. `inspectLifecycleLedger` (`ledger.ts:1530`) is V1-only. Its staging scan refuses any child outside `["foundation","git","launchd-process"]` (`ledger.ts:822`, `:885-888`). So any V2 residue makes the V1 result non-clear, and every update residue reads as `recovery_required`. The V2 inspector must split the V2 envelopes out *before* the V1 scan. Required behaviour: spec §9.2:4517-4534 and 4553-4571. Spec 1 commands must refuse a non-clear V2 state (spec:4554-4555), so the mutation gate also needs this. |
| **c** | **(1) Code gap.** | The spec defines the type (spec:3390-3406) and the flattening and bounds rules (spec:4237-4247, 4548). Core has no codec for it; `coordinator.ts:526` only parses the reference. |
| **d** | **(2) Real spec contradiction.** | `CanonicalStateFileStateV1.present` requires `dev`/`ino` (spec:3229-3235). But spec:900, 4252 and 4402 say identity comes *only* from construction evidence ("not invented pre-write inodes"). Spec:3773-3778 also writes leaf plans before payloads, so the plan cannot contain the payload's inode. The code compares these fields (`state-participant.ts:394`, `bundle-participant.ts:181-192`). The manifest state already avoids the problem: the spec's `ManifestBytesStateV1` (spec:775-785) has no dev/ino, and the code made them nullable (`manifest-state.ts:84-85`). |
| **e** | **Split: (1) code gap, (2) spec omission.** | (1) `refuseParticipant("update_verifier_rejected")` throws `LifecycleRecoveryRequiredError` (`state-participant.ts:35-37`, `:426`). `#forwardOnce` rethrows that (`coordinator.ts:1229`), so the result is exit 6. §9.4 (spec:4697-4699) requires the inverse plan instead. The coordinator's default arm (`refuseLifecycleRecovery("update_step_not_applied")`, `coordinator.ts:~1270`) has the same bug for every participant. So does a Foundation transaction that rolled back cleanly on precondition drift. There is no "rejected" observation (`participants.ts:72-74`). (2) §7.3 (spec:2167-2179) is a success-only union, and §11 (spec:4825-4834) gives no exit code for an update that rolled back automatically. |

## Handoff items

**Must close for the synthetic end-to-end run:**
- The production apply ports and `compose` (Task 8).
- **Add `oe` and `rb` allocator prefixes.** The spec says `OwnerExternalEffectIdV1 = AllocatedLifecycleIdV1<"oe">` (spec:846) and `RollbackPayloadIdV1 = AllocatedLifecycleIdV1<"rb">` (spec:4724). But `LifecycleIdPrefixV1`/`PREFIXES` is only `tx|lc|ge|le|mf` (`ids.ts:5`, `:51`). Today these IDs are local brands (`construction.ts:29`, `preview.ts:44`), so only tests can create them.
- **No production verifier process port exists.** Security has only `TargetPlannerSupervisor` (`planner-process.ts:123`), and nothing implements `TargetVerifierPortV1`. The production `run`/`observe` for the Codex refresh are also unbound (`external-effect.ts:52-63`).

**Not blocking (hygiene or a separate owner):**
- **Duplicate `updateParticipantJournalPath`** (`bundle-participant.ts:390` vs `participants.ts:940`): both produce the same string, so delete one (size S).
- **Two V2 ref types**: `UpdateFoundationParticipantRefV2` (`migrations.ts:59`) vs `FoundationParticipantRefV2` (`bootstrap.ts:274`), where the spec has one union (spec:861). Unifying them touches bootstrap admission, which is shipped and security-sensitive. That needs a decision (F4).
- **The other "local" types** `ImmutableUpdatePlanRefV1` and `UpdateLeafPlanKindV1` each have exactly one definition (`construction.ts:31`, `:44`). Only their home module is odd; leave them.
- **"Update schema in `output-schemas.ts`"**: `OUTPUT_SCHEMAS` is the agent-output registry (only `ingest.stage`), not CLI results. Commit 25755c9 did not touch it either. Nothing to do beyond a plan note.
- **`readOfflineReleaseTrustFd` fd set** (`handoff.ts:57-60`): it refuses any fd other than 0–3. On macOS libuv holds extra fds, so this can probably never pass in a real process. It does not affect the fixture, but it will block the real path; route it to 11b.
- **Brain planner export** (`planBrainSchemaMigrations` is not re-exported from `packages/brain/src/index.ts:73`) and **`PLANNER_ENTRYPOINTS`** (`tests/repository/check.ts:236`): both belong to the release packer (A16), not to apply.

## Closure tasks

Under the D56 lane, each **Test** is written and run red→green filtered with `-t`. The full suite runs at the checkpoint.

**Group 1: can run in parallel; the files don't overlap**

1. **Allocator prefixes `oe` and `rb`** (S)
   - **Where:** `packages/core/src/lifecycle/ids.ts`, `update/construction.ts:29`, `update/preview.ts:44`, and the `resolveAllocator` inputs in `lifecycle/ledger.ts`.
   - **How:** add `oe` and `rb` to `LifecycleIdPrefixV1`/`PREFIXES`. Retype both IDs as `AllocatedLifecycleIdV1<...>`. The retained `rb_` ID from the rollback record counts as a surviving allocated ID.
   - **Test:** round-trip `ids.test.ts`, check that a wrong-prefix or wrong-nonce ID is refused, and that the allocator never reissues an `rb` counter still held by a retained record.

2. **Retirement codec and handler (c)** (M)
   - **Where:** new `packages/core/src/update/retirement.ts` plus its `index.ts` export; new `apps/cli/src/update/retirement-participant.ts`.
   - **How:**
     - Core: validate, bytes, and `updateLeafPlanHash("terminal_retirement")`, plus a pure flattener ordered by kind, root, then unsigned UTF-8 path.
     - `maximumLeaves` is recomputed and must satisfy *both* bounds (the 2026-09-08 amendment).
     - The CLI handler implements `UpdateRetirementHandlerV1` with guarded unlink per leaf; an already-absent leaf is idempotent only at the cursor.
   - **Test:** exact keys and order, 0..16 entries, both `set` arms, the exact maximum and the first case over either bound, resume at every `retirementNext`, and a third state → exit 6.

3. **Semantic rejection error, code part of (e)** (M)
   - **Where:** `packages/core/src/update/participants.ts` (new `UpdateStepRejectedError` with a `reason`), `apps/cli/src/update/state-participant.ts:422-428`, `owner-participant.ts`, `migration-participant.ts`, and `core/update/coordinator.ts` (the default and verifier arms).
   - **How:**
     - A verifier with non-zero exit or a digest mismatch throws the rejection error. `update_verifier_policy` stays exit 6.
     - A Foundation transaction that rolled itself back before active publication also becomes a rejection.
     - The coordinator compensates on the rejection and keeps `causeOf` working through the `reason` field.
   - **Test:**
     - A rejected verifier → compensation → `{kind:"rolled_back", cause:"update_verifier_rejected"}`, the old active release restored, trust not reversed.
     - A policy breach → exit 6.
     - A precondition drift before active publication → compensation.

4. **Remove the duplicate journal-path helper** (S): delete `bundle-participant.ts:390` and import from `participants.ts`. **Test:** the existing path cases.

**Group 2: can run in parallel with each other; needs Task 1**

5. **Update Foundation executor arm and port (a)** (L)
   - **Where:** `packages/core/src/transactions/executor.ts` (new `admitUpdateFoundationInitialJournal` and `executeUpdateFoundationParticipant`), `core/update/migrations.ts` and `owner.ts` (ref construction), `core/update/construction.ts` (a sidecar payload row), and new `apps/cli/src/update/foundation-port.ts` implementing `UpdateFoundationPortV1`.
   - **How:** mirror bootstrap:
     - The ref's `stagedPath` becomes the standard `staging/transactions/<tx>/<i>.bin`.
     - `content` carries the `UpdatePayloadRefV1`, and `.bin.sha256` is its own construction row.
     - At the Foundation cursor, rename the payload and sidecar there no-replace, using identities from construction evidence. Sync and reopen, publish the initial journal to `state/transactions/<tx>.json`, then resume the unchanged state machine.
     - Construction compaction must accept "consumed by publication" for these rows.
     - The ref `planHash` values change; nothing has shipped, so that is fine.
   - **Test:**
     - A death point after each content, sidecar, and journal publish.
     - Adoption only with the recorded identity, and a third state → exit 6.
     - `observe` returns all four states.
     - Rollback and compaction work.
     - V1 refs are refused by the new arm and V2 refs by the V1 bridge.

6. **V2 closure inspector (b)** (L)
   - **Where:** new `packages/core/src/lifecycle/ledger-v2.ts`, `ledger.ts` (an exclusion input for V2 coordinator IDs, their staging subtrees, and their Foundation tx IDs), `apps/cli/src/lifecycle/context.ts:213`, `lifecycle/mutation-gate.ts`, and the `closure` port in `apps/cli/src/update/apply.ts`.
   - **How:**
     - Read plans with `readLifecycleExecutionPlanV2` under the 16-MiB cap and split them by `schemaVersion`.
     - Run the V1 scan over the V1 set only.
     - Scan the V2 staging grammar: the four construction frontiers from spec:4556-4569 and the set of legal children from F1.
     - Read `state/update-executor.json`, build `LifecycleClosureV2ObservationV1`, and classify it.
   - **Test:**
     - Every arm (`update_recovery` forward and compensating, the four construction frontiers, `executor_cleanup`).
     - Mixed V1/V2, two V2 coordinators, or an unknown child → `recovery_required`.
     - V1 residue gives the same results as today.
     - A Spec 1 command is refused under `update_recovery`.
     - A terminal V2 coordinator compacts, then the closure is clear.

**Group 3: in sequence, after F2/F3**

7. **State-plan identity (d)** (M)
   - **Where:** `core/update/participants.ts:683-776`, `core/update/bundle-participant.ts:181-192`, `apps/cli/src/update/state-participant.ts:380-394`, `bundle-publication.ts`.
   - **How:** implement the F2 decision. Under the recommended option A, `after` has no dev/ino and its identity is the reopened construction evidence of the `after.payload` row.
   - **Test:** plan bytes are stable before the payload exists; a moved inode ≠ the evidence → exit 6; bundle metadata `[3]` works the same way.

8. **Verifier and Codex process ports** (M)
   - **Where:** `packages/security/src/update/verifier-process.ts` (reusing the `TargetPlannerSupervisor` limits), plus the production `run`/`observe` for `external-effect.ts`.
   - **How:** the fixed read-only process table, the bounds from `TargetVerificationPlanV1`, and output echoing the three digests.
   - **Test:** idle and wall timeouts, the count and byte limits, a non-zero exit → rejection (from Task 3), and a capability-graph check.

9. **`compose` and the production apply binding** (L). Depends on Tasks 1, 2, 3, 5, 6, 7 and 8.
   - **Where:** new `apps/cli/src/update/compose.ts` and `apps/cli/src/update/apply-ports.ts`; `context.ts:147-152` binds `apply`.
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

10. **Task 25, `update rollback --apply`** (L). Depends on Task 9.
    - **Where:** `apps/cli/src/update/rollback-apply.ts` and `commands/update/index.ts`, as in the plan.
    - **How:**
      - Local-only rollback over the same `compose`, using the inverse slots and the `consumed_rollback_and_rejected_release` retirement.
      - A rejection from the previous release's verifier compensates back to the rejected current release.
    - **Test:** the Task 25 matrix from the plan.

## Founder decisions

**F1. Foundation publication for update refs, and the set of legal staging children.**
- §5.3 does not say how the executor receives `update_expected` content.
- Separately, spec:4142-4146 says "no other child is legal" and lists only `update-construction.*` and `update/{construction,plans,initial-journals,journals,evidence,source}`. That list leaves out paths the spec itself derives: `participants/foundation` (spec:964), `participants/manifest` (spec:897), `update/payloads` (spec:4250) and `update/recovery-executor` (spec:4194).
- Spec:957 also says the initial journal "contains" `planHash`. The V1 journal's exact key set (`transactions/store.ts:35-43`) cannot hold it, and bootstrap already ignores that clause.

Options:
- **A (recommended):** add one paragraph to §5.3: "Lifecycle refs follow §6.3's publication rule: `stagedPath` is the standard `<tx>/<ordinal>.bin`, `content`/`digest` are `update_expected` construction rows, and they are published no-replace at the Foundation cursor before the initial journal." Extend the legal-children list at spec:4144 with `participants/{foundation,manifest}`, `update/payloads` and `update/recovery-executor`. Change "containing that hash" at spec:957 to "whose planned journal bytes are hashed".
- **B:** move the §5.3 paths under `update/` (`update/participants/...`) so the list stays as it is. This means re-deriving paths in `paths.ts` and changing construction tests.
- **C:** give the executor a second staging root. This breaks the "unchanged TransactionExecutor" rule from Spec 1; reject it.

**F2. (d) `CanonicalStateFileStateV1` postimage identity.**
- **A (recommended):** `after.present` carries no `dev`/`ino`; identity comes from the reopened construction evidence of `after.payload`. `before` keeps them. This makes state plans follow the pattern the spec already uses for the manifest (spec:775-785).
  - Amended type, spec:3229: split it into `CanonicalStatePreimageV1` (with dev/ino, `payload: null`) and `CanonicalStatePostimageV1` (`payload: StatePayloadRefV1`, no dev/ino).
  - Amended text, spec:4233: "…and its device/inode only from the matching construction evidence."
- **B:** make `dev`/`ino` nullable on both sides, as the manifest code does today. Smaller change, weaker type.
- **C:** reorder construction so payloads are written before the plans. This contradicts spec:3773-3778 and does not solve bundle `metadata[3]` (spec:3049). Reject it.

**F3. (e) How to report an automatic rollback.**
- **A (recommended):** §7.3 stays a success-only union. An automatic rollback is the error envelope the code already produces (`commands/update/index.ts:74-80`, `update_rolled_back_automatically`), with the exit code taken from the cause: **5** for `update_verifier_rejected` (a signed verifier disagreeing with the written postimages), **1** for other operational causes. Recovery text: "version X is still active".
  - Amended §11 exit-5 row: "…, target-verifier rejection (the update was rolled back automatically)".
  - New sentence in §9.4: "A compensated apply exits with the class of its cause; trust stays advanced."
- **B:** add `{outcome:"rolled_back_automatically", active, cause}` to §7.3 and return exit 0. This hides a failed update from scripts; not recommended.
- **C:** always exit 1. Simple, but it loses the security class.

**F4. The two V2 ref types (not blocking).**
- **A (recommended):** record the split as an accepted residual in §13.3. Bootstrap admission has shipped and is security-sensitive.
- **B:** unify them into the one union from spec:861 after Task 26. Size M; it re-tests bootstrap.

## Order at a glance

- **Now, in parallel:** Tasks 1–4.
- **Then, in parallel:** Tasks 5 and 6 (on F1-A unless the founder chooses otherwise).
- **After F2/F3:** Task 7, then Task 8 (can run in parallel with 5–7), then Tasks 9 → 10.

Worktrees: one per task in Groups 1 and 2, under `../developer-os.worktrees/`. The orchestrator integrates.
