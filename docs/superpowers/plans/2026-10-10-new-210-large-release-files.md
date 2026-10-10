# NEW-210 Large Release Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real Homebrew keg, whose bundled Node is about 122 MB, can run `uninstall` and any number of `update`s.

**Architecture:**
- **Update retirement** retains no bytes. Its 64 MiB "document" fallback was misused as a read bound for a hash-only leaf, so the bound becomes `MAXIMUM_BUNDLE_FILE_BYTES`.
- **Uninstall** moves each removable product-home file larger than 16 MiB aside through Spec 1 §2.4's `K` arm, the same move-aside mechanism the redaction key already uses. It does so by identity-checked, no-replace rename into `staging/lifecycle/<coordinator>/payloads/<ordinal>`. The arm deletes the files after `M(commit_absence)`; compensation renames them back, keeping the same inode.
- Files of 16 MiB or less keep today's `F(uninstall_artifacts)` path.

**Tech Stack:** TypeScript strict, vitest, pnpm workspace.

**Spec:** Spec 2 (`docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md`), new block K9. Spec 1 (`docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md`): §2.4 `K`, the 16 MiB content-leaf rule at ~1830, and §6 step 3. The amendment text is in Task 6.

**Founder decision:** 2026-10-10, option B (payload store) for uninstall. The design review found that update retirement needs only the bound fix (Task 1).

## Global Constraints

- Every product file operation goes through the guarded port (`packages/core/src/lifecycle/guarded-fs.ts`): no-follow, identity reopen, no-replace rename, owner-held `0700` parents.
- No large file is held in memory. Hashing streams through `hashRegular`, and the size bound is `MAXIMUM_BUNDLE_FILE_BYTES` (`packages/core/src/update/release.ts`).
- Do not touch `TransactionExecutor` backups; the executor is shared by ingest, reindex and review.
- Do not raise the fixture's `RUNTIME_PADDING`. Large fixtures are sparse (`fs.truncate`).
- Exact-path staging. `docs/superpowers` needs `git add -f`.
- Run each `*.v2.test.ts` file alone, once per task, at the end.

## Review Focus

1. A crash while some payloads have been moved aside must resume forward or restore every one of them; none may be stranded.
2. Compensation must restore the original inode, so mode and extended attributes survive.
3. Planless recovery must never delete `payloads` (it is not a derived staging child).
4. `uninstall --dry-run` on a real keg must not read 122 MB into memory.
5. The second consecutive `update --apply` on a keg with a file larger than 64 MiB must succeed.

| Wave | Tasks |
|---|---|
| 1 | 1 (S), 2 (M), 3 (S) |
| 2 | 4 (M), after 2 and 3 |
| 3 | 5 (M), after 4 |
| 4 | 6 (S) docs; 7 (S, VM), after 1–5 |

### Task 1: Retirement read bound (S)

**Files:**
- Modify: `apps/cli/src/update/retirement-participant.ts` ~80-84
- Modify: `apps/cli/src/update/retirement-resolve.ts` ~57 (delete the `ponytail:` line)
- Modify: `packages/core/src/update/rollback.ts` ~772 (the comment on `RollbackPayloadLeafV1.bytes`)
- Test: `apps/cli/src/update/retirement-participant.test.ts`

**Steps:**
- [ ] Write a failing test: a `bin/node` leaf that is a 65 MiB sparse file with `bytes: null` and its real `sha256`. `retire` throws `update_retirement_leaf` today.
- [ ] Change the fallback from `MAXIMUM_ROLLBACK_DOCUMENT_BYTES` to `MAXIMUM_BUNDLE_FILE_BYTES`. Refuse `update_retirement_leaf` when a file leaf has both `bytes` and `sha256` null. Reword the comment to "null: size not carried; bounded by `MAXIMUM_BUNDLE_FILE_BYTES`, content bound by `sha256`".
- [ ] Add a test: a 512 MiB + 1 sparse leaf refuses on size before any read.
- [ ] Add a test: a file leaf with null `bytes` and null `sha256` refuses.

### Task 2: Payload module and `K` plan codec v2 (M)

**Files:**
- Create: `apps/cli/src/lifecycle/uninstall-payloads.ts` and its `.test.ts`
- Modify: `apps/cli/src/lifecycle/redaction-key.ts`. The `RedactionKeyStatePlanV1` codec goes to `schemaVersion: 2` and adds `payloads`; v1 decodes as `payloads: []`.

**Interfaces:**
```ts
export interface UninstallPayloadV1 { readonly sourcePath: CanonicalAbsolutePathV1; readonly payloadPath: CanonicalAbsolutePathV1; readonly mode: 384 | 448; readonly size: number; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1; readonly sha256: string }
export function uninstallPayloadPath(productHome: string, coordinatorId: string, ordinal: number): CanonicalAbsolutePathV1;
export function observePayloads(fs, uid, payloads): Promise<"before" | "staged" | "deleted">;
export function stagePayloads(fs, uid, coordinatorStaging, payloads, boundary?): Promise<void>;
export function restorePayloads(fs, uid, payloads): Promise<void>;
export function deletePayloads(fs, uid, payloads, boundary?): Promise<void>;
```

**Rules:**
- `stage`: payloads in ordinal order, then the key. For each payload: check `lstat` identity (owner, mode, `nlink` 1, size, dev, ino), require `hashRegular == sha256`, then `renameNoReplace(source, payload)` and sync both parents. The `payloads/` directory is created with `mkdirExclusive` `0700`; on resume an existing one must be an owner-held `0700` directory.
- `restore`: the key first, then payloads in reverse order. Check identity, then `renameNoReplace(payload, source)`.
- `delete`: payloads first, then the key. Check identity, then `unlinkExact`.
- `observe`, per entry:
  - source only → `before`
  - payload only → `staged`
  - neither → `deleted`
  - both, or a wrong identity → refuse `uninstall_payload_state` (exit 6), preserving everything
- `observe`, aggregate:
  - any `before` → `before`
  - else any `staged` → `staged`
  - else `deleted`
  - `before` together with `deleted` refuses
- The codec recomputes `payloadPath` from the coordinator ID and the ordinal. It requires `sourcePath` inside the product home and outside `staging/` and `state/`, unique, with 16 MiB < size ≤ `MAXIMUM_BUNDLE_FILE_BYTES`, and count ≤ `MAX_UNINSTALL_ARTIFACTS`.

**Steps:**
- [ ] Codec tests:
  - v1 decodes to `payloads: []`, and v2 round-trips;
  - each of these refuses: a wrong `payloadPath`, a source outside the home or under `staging/` or `state/`, a duplicate, a size of 16 MiB or less, and a size above the bundle bound.
- [ ] Move round trip on a 17 MiB sparse file:
  - stage then restore → byte-identical and the same dev/ino;
  - stage then delete → both paths absent.
- [ ] Every `observe` state, per entry and aggregate, including the two refusals.
- [ ] Refused and preserved:
  - a symlink source;
  - wrong owner or mode;
  - `nlink` 2;
  - a same-size content edit (hash mismatch);
  - an inode swapped at the payload path before restore or delete.
- [ ] Idempotence:
  - stage interrupted after entry 0 of 2, then stage again → all staged;
  - restore after a partial stage → all restored.

### Task 3: Core admission, compensation and compaction (S)

**Files:**
- Modify: `packages/core/src/lifecycle/coordinator.ts` ~678: `if (step.transition === "stage") await key.restore(plan);`. `restoreRedactionKey` is already a no-op without a tombstone.
- Modify: `packages/core/src/lifecycle/ledger.ts` ~879 and ~945. Add `"payloads"` to `STAGING_CHILDREN`. Under a published plan, admit exactly `payloads/<ordinal>` for ordinal < `plan.participants.redactionKey.payloads.length`, each an owner-held single-link regular file. With no plan, `payloads` refuses. Do NOT add it to `DERIVED_STAGING_CHILDREN` (`packages/core/src/lifecycle/recovery.ts:46`).
- Modify: `packages/core/src/lifecycle/coordinator-compaction.ts` ~189-200: `rmdirExactEmpty` of `payloads` before the coordinator staging directory. A non-empty `payloads` refuses and is preserved.
- Tests: `coordinator.test.ts`, `ledger.test.ts`, `coordinator-compaction.test.ts`.

**Steps:**
- [ ] A fake `K` whose `observe` returns `before` while one payload is moved. Compensation of the current `K(stage)` calls `restore`. This fails on HEAD.
- [ ] The ledger admits `payloads/0..N-1` under a plan. It refuses `payloads/N`, a symlink, `nlink` 2, and `payloads` without a plan.
- [ ] Compaction removes an empty `payloads` and refuses a non-empty one.

### Task 4: Uninstall wiring (M)

**Files:**
- Modify `apps/cli/src/lifecycle/uninstall.ts`:
  - preview split at ~1495-1508;
  - `UninstallPlanInputsV1.payloads` at ~336;
  - the `K` plan v2 at ~622;
  - `reservationFor` at ~426, where `lifecycleStaging += N === 0 ? 0 : 1 + N`;
  - `removed` at ~1747;
  - the adapter at ~1053;
  - the boundary kinds `payload_staged` and `payload_deleted` at ~196.
- Modify `apps/cli/src/commands/testing.ts`: add an optional `extraBundleFiles` to `createSyntheticPackagedRelease`. Only new tests use it.
- Test: `apps/cli/src/lifecycle/uninstall.v2.test.ts`.

**Preview rule:** a removable regular file larger than `MAX_MUTATION_BYTES` becomes a payload when all of the following hold:
- `kind` is a regular file;
- the owner is the effective uid;
- the mode is `0600` or `0700`;
- `nlink` is 1;
- the parent is an owner-held `0700` directory;
- size ≤ `MAXIMUM_BUNDLE_FILE_BYTES`;
- `dev` equals the `dev` of `staging/lifecycle`;
- the `sha256` comes from streaming `hashRegular`.

Otherwise the preview refuses `uninstall_artifact_too_large` (exit 6) before any ID is reserved.

**Steps:**
- [ ] Reproduce: with a 17 MiB `0700` `bin/large` bundle file, `uninstall --dry-run` exits 6 with `uninstall_artifact_too_large` on HEAD.
- [ ] Implement:
  - the dry-run lists the file as removable;
  - apply leaves exactly the bookkeeping set;
  - `removed` contains the file.
- [ ] Compensation: kill at "M(preserve_before) applied, cursor not advanced". The file comes back byte-identical with the same inode.
- [ ] Refusal before reservation: a 17 MiB file with mode `0644`, or a parent that is not `0700`, exits 6 and no ID is allocated.

### Task 5: Crash matrix (M)

**Files:**
- Modify: `apps/cli/src/lifecycle/uninstall-recovery.v2.test.ts` ~66-130, with a fixture holding one 17 MiB payload.

**Steps:**
- [ ] Add a `payloadStaged` column to `MICROSTATES` for every existing point:
  - `M(preserve_before)` → staged;
  - `M(commit_absence)` → staged;
  - `finalize_tombstones` onward → deleted.
- [ ] New kill points:
  - "K(stage) after one payload moved" resumes forward. Its compensation variant forces the second move to fail (identity swap) and restores everything.
  - "K(delete) after one payload unlinked" resumes forward.
- [ ] Doctor and status during a kill after commit still name recovery (NEW-160 test, `uninstall.v2.test.ts` ~590). Recovery reaches a clean home with no `payloads` directory.

### Task 6: Spec, threat model and BACKLOG (S)

- [x] **Spec 2, after K8. Add K9:**
  - (a) Terminal retirement retains no bytes. A file leaf with null `bytes` is hash-read up to `MAXIMUM_BUNDLE_FILE_BYTES` and must carry a `sha256`. §9.2's "document bounded by 64 MiB" reading of a null `bytes` is withdrawn for retirement.
  - (b) Uninstall removes a product-home regular file larger than 16 MiB by moving it aside through Spec 1 §2.4's `K` arm, not through `F(uninstall_artifacts)`. Planning refuses `uninstall_artifact_too_large` (exit 6) for such a file when any of these fails:
    - owner-held, mode `0600`/`0700`;
    - single link;
    - in an owner-held `0700` parent;
    - on the same device as `staging/lifecycle`;
    - at most `MAXIMUM_BUNDLE_FILE_BYTES`.

    Accepted residual: two removal mechanisms coexist.
- [x] **Spec 2 §9.2:** a one-line K9 (a) note.
- [x] **Spec 1 §2.4 `K`:** "Amended 2026-10-10 (Spec 2 K9 (b))", covering:
  - the `schemaVersion: 2` `payloads` row grammar, with exactly `staging/lifecycle/<coordinator-id>/payloads/<ordinal>`;
  - "cannot target any second path" now applies to the key only;
  - the stage, restore and delete order;
  - a moved prefix is a legal state before the cursor;
  - compaction and closure admission;
  - both paths present or a wrong identity → `lifecycle_recovery_required`.
- [x] **Spec 1 ~1830 and §6 step 3:** one-line notes. Also extend the "redaction-key deletion is secret-opaque" test row with the payload crash boundaries.
- [x] **Threat model:** the payload unlink window is the same-uid residual (Spec 1 §8.3 residual 8).
- [x] **BACKLOG:** close NEW-210 with the SHAs.

### Task 7: VM re-check (S)

On the `dos-gate` VM, with two releases built from the merged code:
- [ ] `brew install` and `init`, then `uninstall --dry-run` exits 0 and lists `releases/<v>/darwin-<arch>/bin/node`.
- [ ] Bump, `brew upgrade`, `update --apply`. Then bump, `brew upgrade` and `update --apply` again; the second update retires the init release. Both exit 0.
- [ ] `update rollback --apply` exits 0.
- [ ] `uninstall --yes` exits 0. The product home holds only the bookkeeping set, `staging/lifecycle` is empty, and `doctor` gives no transaction warning.
- [ ] `kill -9` the uninstall while `bin/node` is in `staging/lifecycle/*/payloads`. A re-run of `uninstall` recovers it.
- [ ] Peak RSS (`/usr/bin/time -l`) of `uninstall` and of the second update stays well below 122 MB above baseline.

## Unresolved (flagged by the design review)

1. The `K` participant is still named `redactionKey`; renaming it is optional churn.
2. Release directory modes on a keg-initialized home are assumed to be `0700`. If they are not, the preview refuses before reservation, and the Task 7 VM run will show it.
3. Moving the running Node binary is assumed safe on macOS, because the inode persists. Task 7 verifies this.
4. Each payload is read in full about four times: the V1 drift hash (streamed since Task 4), the preview hash, the stage hash and the hash inside `renameNoReplace`. That costs a few seconds on a 122 MB file; accepted. V2 doctor drift still reads a content row whole (`ponytail:` note in `packages/core/src/manifest/drift.ts`).
