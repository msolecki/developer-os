# Developer OS Replacement Task 6 Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the uncommitted replacement Task 6 tree into an accepted, committed Task 7 checkpoint by recording the two founder rulings of 2026-09-04 in Spec 2, implementing them, and making `npm run check` green.

**Architecture:** Two Spec 2 amendments are written first (§6.1 global-lock admission after a crash, §6.4 forward-participant content is never a retention row, §6.1 `admittedPreexistingPaths`). Core owns one derivation of the retention table with explicit bookkeeping instead of a flag on rows; the CLI evidence builder consumes that derivation instead of re-deriving it. Gate blockers that are independent of the rulings (NUL bytes, stale citations, CI `suite` job) are fixed in their own task so a reviewer can reject one task without rejecting the others.

**Tech Stack:** TypeScript 5.9 strict ESM, Node.js 24 built-ins, Vitest 4, existing canonical JSON and Foundation transactions, macOS 15+ CI.

**Spec:** `docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md` §6.1, §6.4, amended by Task 1 of this plan. Parent plan: `docs/superpowers/plans/2026-08-31-developer-os-retained-bootstrap-evidence.md` Task 6.

## Global Constraints

- Founder rulings of 2026-09-04, recorded in Task 1 before any code changes:
  1. **§6.4:** the mutation content of a forward Foundation participant that the journal cursor has reached is never a retention row, for every `terminalOutcome`. Its `.bin.sha256` sidecar and the participant's initial journal remain `foundation_bootstrap` rows. A compensation participant's row is its own `stagedPath`. No `installedTarget` flag survives.
  2. **§6.1:** under the held bootstrap lock, an existing regular, zero-byte, single-link, owner-owned `0600` file at the exact planned `.lifecycle.lock` path whose creation evidence for `createdPaths[0]` is absent is admitted as attempt-created with lost evidence; resume records its identity as that ordinal's creation evidence. Any other state at that path remains exit 6.
  3. **§6.1:** `FreshV2InitPlanV1.admittedPreexistingPaths` is part of the persisted plan grammar: at most 4096 canonical absolute paths, strictly ascending in UTF-8 byte order, every one equal to or below the product home (the plan first said §6.3; the interface block is under §6.1, corrected 2026-09-04).
- Every commit in this plan is part of the single replacement Task 6 checkpoint (founder decision 2B). Each task still commits separately so fresh review can reject one task.
- Bootstrap init, compensation, recovery, retention, retry, doctor and uninstall never call `unlink`, `rm` or `rmdir` for bootstrap envelope or evidence paths.
- Every test written here must be observed failing for the stated reason before its implementation step.
- Stage only listed paths; never `git add -A`, `git add .` or a wildcard.
- Reviewer and author are different agents. `npm run check` runs before every review request.
- Citations in documents name a tracked file with its directory; a file added by this plan is cited with a line number only after the task that tracks it.

## File and Responsibility Map

| Area | Files | Responsibility |
|---|---|---|
| Spec amendments | `docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md` | §6.1, §6.4 dated amendments |
| Governance | `docs/superpowers/BACKLOG.md`, `docs/superpowers/ORDER.md`, this plan | NEW-52/55/56/57 rows, `NOW`, counts |
| Global-lock recovery | `apps/cli/src/bootstrap/executor.ts:2791-2905` | `createPlannedPath` global-lock branch |
| Core retention table | `packages/core/src/manifest/bootstrap-retention.ts:1000-1250` | `foundationAuthorities`, `authorities` |
| CLI evidence builder | `apps/cli/src/bootstrap/report.ts` (untracked until Task 4) | `buildBootstrapRetentionEvidence` consuming Core locations |
| Gate blockers | `apps/cli/src/commands/testing.ts:690-698`, the root `package.json` (scripts `test:bootstrap` and `test:suite`), the `suite` job of `.github/workflows/check.yml` (lines 125–135) | NUL bytes, `test:suite` scope, `suite` job build |
| Hardening | `apps/cli/src/commands/init.ts:814-825`, `packages/core/src/manifest/bootstrap.ts:1757-1771`, `apps/cli/src/bootstrap/executor.ts:1921-1927` | resumable detection, `boundedPaths`, product-home filter |

---

### Task 1: Record the founder rulings in Spec 2 and the governance documents

**Files:**
- Modify: `docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md:3-4` (status line), `:1047-1049` (§6.1), `:1601-1603` (§6.4), §6.1 `admittedPreexistingPaths` plan grammar (in `FreshV2InitPlanV1`, beside `admittedExternalShapeHash`)
- Modify: `docs/superpowers/BACKLOG.md:26-33` (row count, NEW-57, NEW-56, NEW-55)
- Modify: `docs/superpowers/ORDER.md` (`NOW` items 7–8, Count)
- Modify: `docs/superpowers/plans/2026-08-31-developer-os-retained-bootstrap-evidence.md:851` (Task 6 note pointing here)
- Stage with this task, already written on 2026-09-04: `docs/superpowers/SESSION.md`, `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`, `docs/migration/instruction-inventory.md`, `docs/architecture/claude-adapter.md` §13, `docs/architecture/codex-adapter.md` §14

**Interfaces:**
- Consumes: the rulings in Global Constraints.
- Produces: the amended §6.1/§6.4 text every later task argues from; BACKLOG rows NEW-55 (closed pending commit), NEW-57 (rule recorded), NEW-56 (residuals), and this plan registered.

- [ ] **Step 1: Amend the spec status line**

Replace the first sentence of the bold status at `:3-4` with:

```markdown
**Status: 2026-08-29 baseline approved; the 2026-08-31 §6 retained-bootstrap-evidence correction
and durable slot-identity addendum were approved after complete written-specification review; the
2026-09-04 §6.1 global-lock admission rule, §6.1 `admittedPreexistingPaths` grammar and §6.4
forward-content rule were approved by the founder in conversation and are marked "Amended
2026-09-04" in place.**
```

- [ ] **Step 2: Amend §6.1**

After the paragraph ending "…and holds both descriptors through terminal retention." (`:1049`), insert:

```markdown
**Amended 2026-09-04 — admission of a global lock whose creation evidence did not survive.** A
death between creating `createdPaths[0]` and making its creation evidence durable leaves the lock
inode present with no evidence row. On resume, while the bootstrap lock is held and the journal
cursor still names ordinal 0, the process admits an existing regular file at the exact planned
path when it is owner-owned, `0600`, single-link and zero bytes and no creation-evidence file
exists for ordinal 0; it acquires that inode, records the post-acquire identity as ordinal 0's
creation evidence, and continues. The bootstrap lock is what makes this sound: the executor is the
only writer of that path while it is held, and the file carries no content. A present evidence
file whose device/inode differ from the current inode, a non-empty file, a foreign owner, another
mode, a symlink, or a cursor past ordinal 0 without matching evidence remains exit 6.
```

- [ ] **Step 3: Amend §6.4**

Replace the sentence "Installed targets, V1/V2 installation manifests, the permanent global lock, and the immutable plan/journal slots are never retention rows." (`:1601-1603`) with:

```markdown
Installed targets, V1/V2 installation manifests, the permanent global lock, and the immutable
plan/journal slots are never retention rows. **Amended 2026-09-04:** the mutation content of a
forward Foundation participant that the journal cursor has reached is never a retention row, for
every terminal outcome. After `finalized` it is the installed target; after `rolled_back` it is the
compensated target. In both cases its payload ordinal is consumed by the planned staged file that
`createdPaths` names for it, so no `payload` row is emitted for that ordinal either. The
participant's `.bin.sha256` sidecar and its initial journal remain `foundation_bootstrap` rows. A
compensation participant's content row is its own `stagedPath`. The derivation carries this as
explicit bookkeeping beside the rows, never as a flag on a row.
```

- [ ] **Step 4: Amend §6.1 plan grammar**

Inside the `FreshV2InitPlanV1` interface block in §6.1 (the block that declares `admittedExternalShapeHash`), add directly after `admittedExternalShapeHash`:

```ts
  /** Amended 2026-09-04. Names that may legally exist beside this plan: retained evidence and
   *  reusable empty directories observed before publication. At most 4096, strictly ascending
   *  in UTF-8 byte order, each equal to or below the product home. */
  readonly admittedPreexistingPaths: readonly CanonicalAbsolutePathV1[0..4096];
```

- [ ] **Step 5: Rewrite BACKLOG rows**

Replace the NEW-55 row with:

```markdown
| NEW-55 | A11 / Task 6 / implemented, uncommitted | **Closed by the founder's 2026-09-04 ruling, recorded in Spec 2 §6.4 (Amended 2026-09-04): forward-participant content is never a retention row, for every terminal outcome.** The earlier `installedTarget` reading covered `finalized` only and is replaced by `docs/superpowers/plans/2026-09-04-developer-os-task6-closure.md` Task 3. Reproduction before the fix: a successful `init` retired 14 of its own 105 manifest artifacts, including twelve files inside the user's Brain. |
```

Replace the NEW-57 row with:

```markdown
| NEW-57 | A11 / Task 6 / crash recovery | Three death points after global-lock creation (`after_global_lock_create`, `before_global_lock_parent_sync`, `after_global_lock_parent_sync`) resume to exit 6 because recovery admits an existing lock only from creation evidence that those deaths never made durable. **Ruled 2026-09-04 and recorded in Spec 2 §6.1 (Amended 2026-09-04)**; implemented by `docs/superpowers/plans/2026-09-04-developer-os-task6-closure.md` Task 2. |
```

In the NEW-56 row, delete the sentence beginning "`apps/cli/src/bootstrap/report.ts` re-implements Core's retention table" through "the class of defect that produced NEW-55." and append: "The two-derivation residual is closed by `docs/superpowers/plans/2026-09-04-developer-os-task6-closure.md` Task 3; `preserved` descendants remain open." Correct every citation in NEW-56 to a tracked path with its directory: `apps/cli/src/commands/testing.ts` (no line), and drop the untracked `report.ts`/`report.test.ts`/`tests/e2e/fresh-v2-retained-bootstrap.test.ts` line references until Task 4 tracks them.

- [ ] **Step 6: Check ORDER `NOW` items 7–8 and the Count**

Item 8 already points at this plan (written 2026-09-04). Make sure items 7 and 8 under "Open sequence inside A11" read:

```markdown
7. Completed 2026-09-04: the founder ruled Spec 2 §6.4 (forward-participant content is never a
   retention row, every outcome) and §6.1 (global-lock admission after a crash that lost its
   creation evidence). Both are recorded as dated amendments.
8. Now: execute `plans/2026-09-04-developer-os-task6-closure.md`, six tasks, which turns the
   uncommitted replacement Task 6 tree into the accepted Task 7 checkpoint. Nothing from Task 6 is
   committed outside that plan's tasks.
```

Update the Count section: "Program plan: replacement Task 6 closure plan contains 6 tasks; baseline Tasks 8–9 contain 10 unchecked steps." Keep the other counts.

- [ ] **Step 7: Point the replacement plan at this one**

At `docs/superpowers/plans/2026-08-31-developer-os-retained-bootstrap-evidence.md:851`, directly under the `### Task 6` heading, add:

```markdown
> **2026-09-04:** executed through `docs/superpowers/plans/2026-09-04-developer-os-task6-closure.md`, which records the two founder rulings the fresh review of 2026-09-04 required before this task could be accepted. Steps below remain the acceptance contract.
```

- [ ] **Step 8: Run the citation and control-byte gates on the documents**

Run: `npx vitest run --root tests repository/citations.test.ts repository/control-bytes.test.ts`

Expected: `citations.test.ts` FAILS only on the two known NUL bytes in `apps/cli/src/commands/testing.ts` (control-bytes) and on no document citation; if any citation from this task is reported, fix the citation, not the gate.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md docs/superpowers/BACKLOG.md docs/superpowers/ORDER.md docs/superpowers/SESSION.md docs/superpowers/plans/2026-08-31-developer-os-retained-bootstrap-evidence.md docs/superpowers/plans/2026-09-04-developer-os-task6-closure.md docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md docs/migration/instruction-inventory.md docs/architecture/claude-adapter.md docs/architecture/codex-adapter.md
git commit -m "docs: record the 2026-09-04 rulings, the legacy inventory, and the completion roadmap"
```

---

### Task 2: Admit a global lock whose creation evidence was lost (NEW-57)

**Files:**
- Modify: `apps/cli/src/bootstrap/executor.ts:2841-2867` (existing-lock branch of `createPlannedPath`)
- Test: `apps/cli/src/bootstrap/executor.test.ts`

**Interfaces:**
- Consumes: `createPlannedPath(plan, planned, scope, ordinal)` at `apps/cli/src/bootstrap/executor.ts:2791`; `acquireLifecycleLock(path)`; `deriveBootstrapCreationEvidencePaths(productHome, "fresh_v2_init", plan.id, scope, ordinal, uuid)` from `@developer-os/core`; `lstatOptional`, `mode`, `uid` helpers already in the file; the fixture API `createCommandFixture(name, { bootstrapAvailable: true, bootstrapInterruptAfter })`, `runInit`, `fixture.disableBootstrapInterrupt()`, `fixture.rebuildContext()` from `apps/cli/src/commands/testing.ts`.
- Produces: no new exports. Behaviour: resume after the three death points completes `init`.

- [ ] **Step 1: Write the failing resume tests**

Add to `apps/cli/src/bootstrap/executor.test.ts`, inside the existing `describe` that owns the death-point cases:

```ts
it.each([
  "after_global_lock_create",
  "before_global_lock_parent_sync",
  "after_global_lock_parent_sync",
] as const)("resumes after a death at %s by admitting the evidence-less global lock", async (deathPoint) => {
  const fixture = await createCommandFixture(`executor-lock-${deathPoint}`, {
    bootstrapAvailable: true,
    bootstrapInterruptAfter: deathPoint,
  });
  await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  const interrupted = await runInit(fixture.context, ACCEPTED);
  expect(interrupted.ok).toBe(false);
  const bootstrap = fixture.context.bootstrap;
  if (bootstrap?.state !== "available") throw new Error("bootstrap fixture is unavailable");
  await bootstrap.executor.close();
  fixture.disableBootstrapInterrupt();

  const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

  if (!resumed.ok) throw new Error(resumed.error.message);
  expect(await fixture.bootstrapEvidenceIdentities()).toHaveLength(1);
}, 600_000);

it("refuses a non-empty file at the global-lock path when its creation evidence is absent", async () => {
  const fixture = await createCommandFixture("executor-lock-nonempty", {
    bootstrapAvailable: true,
    bootstrapInterruptAfter: "after_global_lock_create",
  });
  await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
  const bootstrap = fixture.context.bootstrap;
  if (bootstrap?.state !== "available") throw new Error("bootstrap fixture is unavailable");
  await bootstrap.executor.close();
  fixture.disableBootstrapInterrupt();
  await nodeFs.writeFile(join(fixture.paths.stateDir, ".lifecycle.lock"), "x", { mode: 0o600 });

  const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

  expect(resumed.ok).toBe(false);
  if (resumed.ok) return;
  expect(resumed.code).toBe(EXIT_CODES.recoveryRequired);
}, 600_000);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root apps/cli src/bootstrap/executor.test.ts -t "evidence-less global lock"`

Expected: the three resume cases FAIL with `existing global lock escaped admitted rolled-back evidence`; the non-empty case FAILS because the current code refuses with `securityRefusal` (exit 5) at "global lock recovery found a changed inode" before reaching the evidence check — record the observed code; the implementation below keeps that refusal and the test must be adjusted to `EXIT_CODES.securityRefusal` if that is what the fixture observes (a non-empty file fails the shape check first).

- [ ] **Step 3: Implement the admission branch**

In `createPlannedPath`, replace the block that begins `const retained = this.#heldLocks.get(plan.id);` inside `else if (planned.kind === "global_lock")` (`apps/cli/src/bootstrap/executor.ts:2848-2867`) with:

```ts
      const retained = this.#heldLocks.get(plan.id);
      if (retained?.global === null || retained?.global === undefined) {
        if (retained?.bootstrap === null || retained?.bootstrap === undefined) {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "global lock recovery requires the held bootstrap lock");
        }
        const evidencePath = deriveBootstrapCreationEvidencePaths(
          this.#dependencies.paths.home, "fresh_v2_init", plan.id, scope, ordinal,
          "00000000-0000-4000-8000-000000000000",
        ).evidence;
        const evidenceStats = await lstatOptional(evidencePath);
        if (evidenceStats === null) {
          // Spec 2 §6.1 (Amended 2026-09-04): shape already verified above, evidence never
          // became durable, bootstrap lock held — admit and let the caller record evidence.
          const global = await this.acquireLifecycleLock(planned.path);
          if (global.dev !== String(stats.dev) || global.ino !== String(stats.ino)) {
            await global.handle.release().catch(() => undefined);
            throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "global lock changed during recovery acquisition");
          }
          this.#heldLocks.set(plan.id, { bootstrap: retained.bootstrap, global });
          this.trace("lock:global");
        } else {
          const evidenceAdmission = await this.inspectEvidence();
          const reusable = evidenceAdmission.reusableGlobalLock;
          if (
            reusable === null || reusable.path !== planned.path ||
            reusable.dev !== String(stats.dev) || reusable.ino !== String(stats.ino)
          ) {
            throw new FreshBootstrapError(
              EXIT_CODES.recoveryRequired,
              "existing global lock escaped admitted rolled-back evidence",
            );
          }
          const global = await this.acquireLifecycleLock(planned.path);
          if (global.dev !== String(stats.dev) || global.ino !== String(stats.ino)) {
            await global.handle.release().catch(() => undefined);
            throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "global lock changed during recovery acquisition");
          }
          this.#heldLocks.set(plan.id, { bootstrap: retained.bootstrap, global });
          this.trace("lock:global");
        }
      } else if (retained.global.dev !== String(stats.dev) || retained.global.ino !== String(stats.ino)) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "held global lock changed during recovery");
      }
```

`deriveBootstrapCreationEvidencePaths` is already imported by `apps/cli/src/bootstrap/report.ts`; add the same import to `executor.ts` if it is not already present. The evidence record written after this branch (the `const evidence: CreatedPathEvidenceV1 = {…}` block at `:2898`) is unchanged: it carries the admitted inode's `dev`/`ino`, which is exactly "records the post-acquire identity as ordinal 0's creation evidence".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --root apps/cli src/bootstrap/executor.test.ts -t "global lock"`

Expected: PASS, including every pre-existing global-lock case in the file.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/bootstrap/executor.ts apps/cli/src/bootstrap/executor.test.ts
git commit -m "fix(cli): admit an evidence-less global lock under the held bootstrap lock"
```

---

### Task 3: One retention-table derivation with the §6.4 forward-content rule

**Files:**
- Modify: `packages/core/src/manifest/bootstrap-retention.ts:1000-1250` (`Authority`, `foundationAuthorities`, `authorities`)
- Modify: `packages/core/src/manifest/bootstrap-retention.test.ts:1250-1275` (fixture no longer models `installedTarget`), `:1885-1912` (regression test), plus one new contract test
- Modify: `apps/cli/src/bootstrap/report.ts` (`buildBootstrapRetentionEvidence`: rows from Core locations)
- Test: `apps/cli/src/bootstrap/report.test.ts`, `apps/cli/src/commands/init.test.ts:612-660`

**Interfaces:**
- Consumes: `deriveBootstrapRetentionLocations(plan, terminalValue)` at `packages/core/src/manifest/bootstrap-retention.ts:1244` returning rows with `role`, `sourcePath`, `tombstonePath`, `collapsesDescendants`; `deriveBootstrapRetentionTable(plan, evidence)` at `:1856`.
- Produces: an internal `FoundationAuthorityBookkeeping` shape in Core: `{ readonly rows: readonly Authority[]; readonly consumedPayloadOrdinals: ReadonlySet<number>; readonly consumedPaths: ReadonlySet<string> }`. The `Authority` interface loses `installedTarget`. `buildBootstrapRetentionEvidence` in the CLI emits exactly one `rows` entry per Core location, in Core order.

- [ ] **Step 1: Write the failing Core contract test**

Add to `packages/core/src/manifest/bootstrap-retention.test.ts`, next to the test at `:1885`:

```ts
it.each(["finalized", "rolled_back"] as const)(
  "never emits a forward participant's content path or any installed target as a row when %s",
  (terminalOutcome) => {
    const evidence = admittedEvidence();
    const terminal = { ...evidence.terminalJournal, terminalOutcome };
    const forwardTargets = new Set(plan.foundationParticipants
      .filter((participant) => participant.role.kind === "forward")
      .flatMap((participant) => participant.mutations.map((mutation) => mutation.targetPath)));
    const installed = new Set(plan.manifest.after.state === "present"
      ? [plan.manifest.manifestPath] : []);

    const locations = deriveBootstrapRetentionLocations(plan, terminal);

    for (const location of locations) {
      expect(forwardTargets.has(location.sourcePath)).toBe(false);
      expect(installed.has(location.sourcePath)).toBe(false);
    }
    expect(locations.some((location) => location.role === "foundation_bootstrap" &&
      location.sourcePath.endsWith(".sha256"))).toBe(true);
  },
);
```

`plan` and `admittedEvidence` are the fixture already used by the test at `:1885`; `deriveBootstrapRetentionLocations` is exported from the module under test (`:1244`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root packages/core src/manifest/bootstrap-retention.test.ts -t "never emits a forward participant"`

Expected: the `rolled_back` case FAILS (a forward target is emitted as `foundation_bootstrap`); the `finalized` case passes because of the `installedTarget` filter that Step 3 removes.

- [ ] **Step 3: Replace the flag with explicit bookkeeping in Core**

In `bootstrap-retention.ts`:

1. Delete the `installedTarget?: true;` member and its docblock from `Authority` (`:1008-1015`).
2. Change `foundationAuthorities` to return bookkeeping beside rows:

```ts
interface FoundationAuthorityBookkeeping {
  readonly rows: readonly Authority[];
  readonly consumedPayloadOrdinals: ReadonlySet<number>;
  readonly consumedPaths: ReadonlySet<string>;
}

function foundationAuthorities(
  plan: BootstrapRetainedExecutionPlanV1,
  journal: BootstrapJournalRecordV1,
): FoundationAuthorityBookkeeping {
  const rows: Authority[] = [];
  const consumedPayloadOrdinals = new Set<number>();
  const consumedPaths = new Set<string>();
  const ordinals = forwardFoundationOrdinals(plan);
  for (const participant of plan.foundationParticipants) {
    const ordinal = foundationOrdinal(participant, ordinals);
    if (
      ordinal >= journal.nextFoundationParticipant ||
      (journal.terminalOutcome === "finalized" && participant.role.kind !== "forward")
    ) continue;
    const initial = participant.initialJournal.staged;
    rows.push({
      role: "foundation_bootstrap",
      sourcePath: participant.initialJournal.finalPath,
      payloadOrdinal: initial.ordinal,
      foundationOrdinal: ordinal,
      foundationKind: participant.role.kind,
      foundationJournal: true,
      bytes: initial.bytes,
      hash: initial.hash,
      mode: initial.mode,
    });
    consumedPayloadOrdinals.add(initial.ordinal);
    for (const mutation of participant.mutations) {
      if (mutation.stagedPath === null || mutation.content == null || mutation.digest == null) continue;
      consumedPayloadOrdinals.add(mutation.content.ordinal);
      consumedPayloadOrdinals.add(mutation.digest.ordinal);
      consumedPaths.add(mutation.targetPath);
      consumedPaths.add(mutation.stagedPath);
      // Spec 2 §6.4 (Amended 2026-09-04): forward content is never a row, any outcome.
      if (participant.role.kind === "compensation") {
        rows.push({
          role: "foundation_bootstrap",
          sourcePath: mutation.stagedPath,
          payloadOrdinal: mutation.content.ordinal,
          payloadPostimage: true,
          foundationOrdinal: ordinal,
          foundationKind: participant.role.kind,
          bytes: mutation.content.bytes,
          hash: mutation.content.hash,
          mode: mutation.content.mode,
        });
      }
      rows.push({
        role: "foundation_bootstrap",
        sourcePath: `${mutation.stagedPath}.sha256` as CanonicalAbsolutePathV1,
        payloadOrdinal: mutation.digest.ordinal,
        payloadPostimage: true,
        foundationOrdinal: ordinal,
        foundationKind: participant.role.kind,
        bytes: mutation.digest.bytes,
        hash: mutation.digest.hash,
        mode: mutation.digest.mode,
      });
    }
  }
  return { rows, consumedPayloadOrdinals, consumedPaths };
}
```

Keep whatever the current loop pushes for the sidecar row (`:1078-1090`) byte-for-byte if it differs from the sketch above; the sketch shows shape, the existing sidecar push is the source of truth for field values.

3. In `authorities` (`:1149-1160`) replace the four derived collections with the bookkeeping:

```ts
  const foundation = foundationAuthorities(plan, journal);
  const retainedFoundation = foundation.rows;
  const retainedFoundationPaths = foundation.consumedPaths;
  const retainedFoundationPayloads = foundation.consumedPayloadOrdinals;
  const foundationByPayload = new Map(retainedFoundation.map((authority) => [authority.payloadOrdinal as number, authority]));
```

and change the payload loop guard from `if (foundationByPayload.has(ordinal)) continue;` to `if (foundationByPayload.has(ordinal) || retainedFoundationPayloads.has(ordinal)) continue;`. Replace `result.push(...retainedFoundation.filter((authority) => authority.installedTarget !== true));` (`:1219`) with `result.push(...retainedFoundation);`.

4. In the test fixture at `:1250-1275`, remove every `installedTarget` field and drop the forward `mutation.targetPath` artifact from `foundationArtifacts` (keep the initial journal and the `.sha256` sidecar). Update the docblock of the test at `:1885` to cite "Spec 2 §6.4 (Amended 2026-09-04)".

- [ ] **Step 4: Run Core tests**

Run: `npx vitest run --root packages/core src/manifest/bootstrap-retention.test.ts src/manifest/bootstrap.test.ts`

Expected: PASS, including both cases of the contract test.

- [ ] **Step 5: Write the failing CLI single-derivation test**

Add to `apps/cli/src/bootstrap/report.test.ts`:

```ts
it("emits exactly the rows Core derives, in Core order", async () => {
  const fixture = await createCommandFixture("bootstrap-report-single-derivation", {
    bootstrapAvailable: true,
  });
  await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
  const report = await inspectBootstrapEvidence(requestFor(fixture));
  const id = report.ids[0];
  if (id === undefined) throw new Error("fixture retained no envelope");
  const admission = await inspectBootstrapEvidenceAdmission(requestFor(fixture));
  const envelope = admission.retainedEnvelopes.find((candidate) => candidate.plan.id === id.id);
  if (envelope === undefined) throw new Error("admission lost the envelope");

  const expected = deriveBootstrapRetentionLocations(envelope.plan, envelope.terminalJournal)
    .map((location) => [location.role, location.sourcePath]);
  const actual = envelope.evidence.rows.map((row) => [row.role, row.sourcePath]);

  expect(actual).toEqual(expected);
}, 300_000);
```

If `BootstrapEvidenceAdmissionV1` does not expose retained envelopes with their `plan`, `terminalJournal` and `evidence`, add a read-only `retainedEnvelopes` array to it in `report.ts` carrying exactly those three fields for every verified envelope; the field is test-facing and content-free.

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run --root apps/cli src/bootstrap/report.test.ts -t "Core order"`

Expected: FAIL — the CLI's own selection loop emits Foundation rows before payload rows and includes the forward content path on `rolled_back`, so the arrays differ.

- [ ] **Step 7: Make the CLI consume Core locations**

In `buildBootstrapRetentionEvidence` (`apps/cli/src/bootstrap/report.ts`), keep the `physicalPath`, `retentionRow`, `payloadEvidence`, `createdPathEvidence`, `interrupted` and `foundationEvidence` (journal read) sections. Delete the row-selection code from `const foundationPayloadOrdinals = new Set<number>();` through `await add("bootstrap_lock", plan.bootstrapIdentity.path);` and replace it with:

```ts
  const rows: BootstrapRetentionEvidenceProjectionV1["rows"][number][] = [];
  for (const location of locations) {
    rows.push(await retentionRow(location.role, location.sourcePath));
  }
```

The Foundation journal read loop keeps its participant filter but no longer calls `add(...)`; it only fills `foundationEvidence`. Remove the now-unused `consumerReached` and `manifestOrdinal` bindings. `directoryRows`/`maximalRoots` stay as they are.

- [ ] **Step 8: Run CLI and e2e tests**

Run: `npx vitest run --root apps/cli src/bootstrap/report.test.ts src/commands/init.test.ts src/commands/doctor.test.ts src/commands/uninstall.test.ts`

Expected: PASS, including `init.test.ts` "leaves every artifact its manifest names present after a V2 bootstrap init" and the idempotent re-init case.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/manifest/bootstrap-retention.ts packages/core/src/manifest/bootstrap-retention.test.ts apps/cli/src/bootstrap/report.ts apps/cli/src/bootstrap/report.test.ts
git commit -m "fix(core): derive the retention table once and never retain forward content"
```

Note: this is the first commit that tracks `apps/cli/src/bootstrap/report.ts` and `report.test.ts`. From here on documents may cite them with line numbers.

---

### Task 4: Clear the gate blockers that do not depend on the rulings

**Files:**
- Modify: `apps/cli/src/commands/testing.ts:695,697`
- Modify: the root `package.json` (`test:suite` script)
- Modify: the `suite` job of `.github/workflows/check.yml` (lines 125–135)
- Modify: `docs/superpowers/BACKLOG.md` (NEW-52 row)
- Add to git: `tests/e2e/fresh-v2-retained-bootstrap.test.ts`

**Interfaces:**
- Consumes: `tests/repository/control-bytes.test.ts:33` (forbidden byte class), `tests/repository/citations.test.ts` (tracked-file rule).
- Produces: a `test:suite` script that excludes `e2e/**`; a `suite` CI job that builds before testing.

- [ ] **Step 1: Run the control-byte gate to observe the failure**

Run: `npx vitest run --root tests repository/control-bytes.test.ts`

Expected: FAIL naming `apps/cli/src/commands/testing.ts` lines 695 and 697.

- [ ] **Step 2: Replace the literal NUL separators**

In `inventoryDigest` (`apps/cli/src/commands/testing.ts:690-698`) change both template literals so the separator is the escape sequence, not the byte:

```ts
    if (!entry.isFile()) return `${relative}\0${entry.isDirectory() ? "dir" : "other"}`;
    const digest = createHash("sha256").update(await nodeFs.readFile(absolute)).digest("hex");
    return `${relative}\0${digest}`;
```

- [ ] **Step 3: Run the gate to verify it passes**

Run: `npx vitest run --root tests repository/control-bytes.test.ts`

Expected: PASS.

- [ ] **Step 4: Scope `test:suite` and make the CI `suite` job self-sufficient**

In the root `package.json` change the `test:suite` script to:

```json
    "test:suite": "vitest run --exclude 'src/bootstrap/executor.test.ts' --exclude 'e2e/**'",
```

In `.github/workflows/check.yml`, in the `suite` job, insert before `- name: Suite`:

```yaml
      - name: Build
        # tests/security and tests/repository import the compiled CLI from dist.
        run: pnpm --pm-on-fail=ignore build
```

and change the job comment to: `# Every test file except the executor file and tests/e2e, which the jobs above and below own.`

- [ ] **Step 5: Verify the suite selection**

Run: `npx vitest list --exclude 'src/bootstrap/executor.test.ts' --exclude 'e2e/**' --filesOnly | grep -c -E 'e2e/|executor.test.ts'`

Expected: `0`.

- [ ] **Step 6: Track the e2e test and rewrite NEW-52**

Replace the NEW-52 row in `docs/superpowers/BACKLOG.md` with:

```markdown
| NEW-52 | test gate / CI budget | `npm test` is `test:bootstrap` (the executor file, two invocations) plus `test:suite` (every other non-e2e file); `check.yml` runs lint, bootstrap-executor, suite and e2e as four jobs with 20/75/40/40 minute bounds, and `suite` builds `dist` before running. Open: the executor file still needs roughly 200 s per test; NEW-53 owns the `init` cost that drives it. Restore a single `vitest run` only when the whole suite fits one 30-minute job. |
```

- [ ] **Step 7: Run the citation gate**

Run: `npx vitest run --root tests repository/citations.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/commands/testing.ts package.json .github/workflows/check.yml docs/superpowers/BACKLOG.md tests/e2e/fresh-v2-retained-bootstrap.test.ts
git commit -m "fix(gates): remove NUL separators, scope test:suite, build before the CI suite job"
```

---

### Task 5: Close the review residuals in the Task 6 tree

**Files:**
- Modify: `apps/cli/src/commands/init.ts:814-825`
- Modify: `packages/core/src/manifest/bootstrap.ts:1757-1771`, `packages/core/src/manifest/bootstrap.test.ts`
- Modify: `apps/cli/src/bootstrap/executor.ts:1921-1927`
- Modify: `apps/cli/src/bootstrap/report.ts` (`confinedToRetainedNamespace`, two `inventoryExactNamespaces` calls)
- Modify: `apps/cli/src/bootstrap/report.test.ts`, `apps/cli/src/commands/doctor.test.ts:144`, `apps/cli/src/main.test.ts:158,165`, `tests/e2e/fresh-v2-retained-bootstrap.test.ts` (the doctor assertion near its top)
- Test: `apps/cli/src/commands/init.test.ts`

**Interfaces:**
- Consumes: `inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({ productHome, stateDirectory, initialRoots }))` as used at `apps/cli/src/commands/doctor.ts:1058-1064`; `validateBootstrapPlan(value, context)`; `retainedTombstones(root)` and `firstRegularFile(paths)` helpers already in `report.test.ts`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing init-refusal test**

Add to `apps/cli/src/commands/init.test.ts`:

```ts
it("refuses with capabilityUnavailable when a persisted V2 plan exists and the bootstrap capability is absent", async () => {
  const seeded = await createCommandFixture("init-v2-plan-no-capability-seed", { bootstrapAvailable: true });
  await nodeFs.mkdir(seeded.paths.brain, { recursive: true, mode: 0o700 });
  expect((await runInit(seeded.context, ACCEPTED)).ok).toBe(true);

  const fixture = await createCommandFixture("init-v2-plan-no-capability", { root: seeded.root });

  const result = await runInit(fixture.context, ACCEPTED);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.code).toBe(EXIT_CODES.capabilityUnavailable);
}, 600_000);
```

If `createCommandFixture` has no `root` option, add one to `CommandFixtureOptions` in `apps/cli/src/commands/testing.ts` that reuses an existing fixture root instead of creating a fresh temporary home; it is test scaffolding only.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --root apps/cli src/commands/init.test.ts -t "capability is absent"`

Expected: FAIL — `init` proceeds into the V1 path (or refuses for a different reason) instead of exit 4.

- [ ] **Step 3: Detect a resumable envelope independently of the capability**

Replace `init.ts:814-817` with:

```ts
    const bootstrap = context.bootstrap;
    const bootstrapAvailable = bootstrap?.state === "available";
    const evidence = bootstrapAvailable
      ? await bootstrap.inspectEvidence()
      : await inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({
          productHome: context.paths.home,
          stateDirectory: context.paths.stateDir,
          initialRoots: [context.paths.home, context.paths.stateDir, context.userHome],
        }));
    const resumableBootstrap = evidence.active !== null;
    if (resumableBootstrap && !bootstrapAvailable) {
```

Import `inspectBootstrapEvidenceAdmission` and `createBootstrapEvidenceInspectionRequest` from `../bootstrap/report.js` exactly as `doctor.ts` does. Delete the now-redundant inner `if (bootstrap?.state !== "available")` at `:825-830` only if TypeScript no longer needs it to narrow `bootstrap`; otherwise leave it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --root apps/cli src/commands/init.test.ts -t "capability is absent"`

Expected: PASS.

- [ ] **Step 5: Write the failing `boundedPaths` tests**

Add to `packages/core/src/manifest/bootstrap.test.ts`, using the fixture that `validatorAdmittedPlanFixture()` or the file's existing plan builder provides for `validateBootstrapPlan`:

```ts
describe("admittedPreexistingPaths", () => {
  const admitted = () => validatorAdmittedPlanFixture();
  it.each([
    ["a path outside the product home", ["/elsewhere/.developer-os-retained.x.0000000000.tombstone"]],
    ["descending order", ["/product/state/b", "/product/state/a"]],
    ["a duplicate", ["/product/state/a", "/product/state/a"]],
    ["more than 4096 entries", Array.from({ length: 4097 }, (_, index) => `/product/state/${String(index).padStart(5, "0")}`)],
  ])("refuses %s", (_, paths) => {
    const { plan, context } = admitted();
    expect(() => validateBootstrapPlan({ ...plan, admittedPreexistingPaths: paths }, context)).toThrow();
  });
  it("admits an ascending confined list", () => {
    const { plan, context } = admitted();
    expect(() => validateBootstrapPlan(
      { ...plan, admittedPreexistingPaths: ["/product/state/a", "/product/state/b"] },
      context,
    )).not.toThrow();
  });
});
```

Adjust `/product` to whatever product home the fixture's `context.productHome` carries.

- [ ] **Step 6: Run them to verify the current state**

Run: `npx vitest run --root packages/core src/manifest/bootstrap.test.ts -t "admittedPreexistingPaths"`

Expected: all five PASS already (the validator exists); this step exists so the negative cases are observed running. If any fails, that is a validator defect to fix in `boundedPaths` before continuing.

- [ ] **Step 7: Confine the executor's list to the product home**

At `apps/cli/src/bootstrap/executor.ts:1921-1927` filter before sorting:

```ts
      admittedPreexistingPaths: [...new Set<string>([
        ...input.retainedPaths,
        ...input.preexistingDirectories.keys(),
      ])]
        .filter((path) => path === paths.home || path.startsWith(`${paths.home}/`))
        .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
        .map((path) => path as CanonicalAbsolutePathV1),
```

Add to `apps/cli/src/commands/init.test.ts` a case that seeds `~/.developer-os-retained.fi_00000000-0000-4000-8000-000000000000.0000000000.tombstone` (an empty `0600` file directly in `fixture.paths.userHome`) before a fresh `init` and asserts `init` succeeds. Run it first to see it fail with a plan-grammar refusal, then after the filter to see it pass.

- [ ] **Step 8: Use the computed confinement and guard the inventory reads**

In `report.ts`, in the call to `classifyBootstrapEvidence`, change `confinedToRetainedNamespace: true,` to `confinedToRetainedNamespace: confinedUnboundEntries,`. In `exactV2Handoff` move `const rows = await request.reader.inventoryExactNamespaces([manifestPath]);` and the `file` lookup inside the existing `try`; in `exactRestoredBase` wrap `const manifestRows = await request.reader.inventoryExactNamespaces([plan.manifest.manifestPath]);` in `try { … } catch { return false; }`.

Add to `report.test.ts`:

```ts
it("classifies an envelope with a foreign file in its namespace as unverified instead of throwing", async () => {
  const fixture = await createCommandFixture("bootstrap-report-foreign-entry", { bootstrapAvailable: true });
  await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
  const tombstones = await retainedTombstones(fixture.root);
  const first = tombstones[0];
  if (first === undefined) throw new Error("fixture retained nothing");
  await nodeFs.writeFile(join(dirname(first), "stray-not-retained.txt"), RETAINED_SECRET, { mode: 0o600 });

  const report = await inspectBootstrapEvidence(requestFor(fixture));

  expect(report.ids[0]?.status).toBe("unverified");
  expect(JSON.stringify(report)).not.toContain(RETAINED_SECRET);
}, 300_000);
```

Run it before the change (expected: status is `verified` because the literal `true` masks the stray entry, so the first assertion FAILS) and after (PASS).

- [ ] **Step 9: Make the secret-nondisclosure assertions able to fail**

In each of the five secret assertions — the first `report.test.ts` case (`expect(JSON.stringify(report)).not.toContain(RETAINED_SECRET)` in "reports %s evidence without contents"), `apps/cli/src/commands/doctor.test.ts:144`, `apps/cli/src/main.test.ts:158,165` and the doctor assertion in `tests/e2e/fresh-v2-retained-bootstrap.test.ts` — write `RETAINED_SECRET` (or the literal `"synthetic retained secret"`) into one retained regular-file tombstone **before** the call whose output is asserted, using the pattern the "altered" case in `report.test.ts` already uses:

```ts
  const tombstones = await retainedTombstones(fixture.root);
  const target = await firstRegularFile(tombstones);
  if (target === null) throw new Error("fixture retained no regular-file tombstone");
  await nodeFs.writeFile(target, "synthetic retained secret", { mode: 0o600 });
```

Export `retainedTombstones` and `firstRegularFile` from `apps/cli/src/commands/testing.ts` if they live only in `report.test.ts`, so the other three files import them. Where the tree is expected `verified` afterwards, assert `altered` instead — the point is that the report is content-free, not that the tree is pristine.

- [ ] **Step 10: Prove each assertion can fail**

Temporarily change `JSON.stringify(report)` to `JSON.stringify(report) + "synthetic retained secret"` in one of the five tests, run that test, observe FAIL, revert. Record the observation in the commit message.

- [ ] **Step 11: Run the focused suites**

Run: `npx vitest run --root packages/core src/manifest/bootstrap.test.ts && npx vitest run --root apps/cli src/bootstrap/report.test.ts src/commands/init.test.ts src/commands/doctor.test.ts src/main.test.ts && npx vitest run --root tests e2e/fresh-v2-retained-bootstrap.test.ts`

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add apps/cli/src/commands/init.ts apps/cli/src/commands/init.test.ts apps/cli/src/commands/testing.ts packages/core/src/manifest/bootstrap.test.ts apps/cli/src/bootstrap/executor.ts apps/cli/src/bootstrap/report.ts apps/cli/src/bootstrap/report.test.ts apps/cli/src/commands/doctor.test.ts apps/cli/src/main.test.ts tests/e2e/fresh-v2-retained-bootstrap.test.ts
git commit -m "fix(cli): refuse without the bootstrap capability, confine admitted paths, make evidence gates falsifiable"
```

---

### Task 6: Full gate, fresh review, canonical documents, checkpoint

**Files:**
- Modify: `docs/architecture/foundation.md`, `docs/architecture/threat-model.md`
- Modify: `docs/superpowers/plans/2026-08-31-developer-os-retained-bootstrap-evidence.md` (Task 6 checkboxes), `docs/superpowers/plans/2026-08-29-developer-os-release-update.md` (Task 7 supersession note → accepted)
- Modify: `docs/superpowers/ORDER.md`, `docs/superpowers/BACKLOG.md`
- Delete: `docs/superpowers/plans/2026-09-04-developer-os-task6-closure.md` (this plan, once its constraints live in the spec and architecture notes)

**Interfaces:**
- Consumes: green Tasks 1–5.
- Produces: the accepted Task 7 checkpoint; `ORDER.md` `NOW` = baseline Spec 2 Task 8.

- [ ] **Step 1: Run the full gate**

Run: `npm run check`

Expected: PASS. If it exceeds 40 minutes locally, that is NEW-53 and does not block this task, but record the wall time in the commit message.

- [ ] **Step 2: Request fresh-context review**

Dispatch a reviewer that authored none of Tasks 1–5 with: Spec 2 §6.1/§6.4 as amended, this plan, and `git diff a3ad015..HEAD`. The verdict must explicitly confirm: no bootstrap unlink/rmdir; forward content never a row in either outcome; global-lock admission only under the held bootstrap lock with absent evidence and exact shape; one derivation of the table; every gate in Task 5 observed failing before passing. For every accepted finding add a failing regression first, fix, rerun `npm run check`, and re-request the verdict until `READY`.

- [ ] **Step 3: Move surviving facts into the architecture notes**

In `docs/architecture/foundation.md` §5 (doctor) add the three checks `redaction-key`, `claude-capabilities`, `codex-capabilities` and the `bootstrap-evidence:<id>` rows to the check list, and replace the sentence at `:594` claiming `init` writes no canonical note with: "`init` installs the synthetic Brain template (four example notes, one note template, seven `.gitkeep` files) only when it creates the vault; an existing vault is never modified." In `docs/architecture/threat-model.md` add one paragraph under the bootstrap section stating the §6.1 admission rule and why the bootstrap lock makes it sound, citing the spec, not a line number.

- [ ] **Step 4: Close the governance rows**

In the replacement plan tick Task 6 Steps 1–6 with a one-line evidence pointer each (commit hashes from Tasks 1–5). In the baseline plan change Task 7's note from "Do not execute or accept" to "Superseded and accepted through the 2026-08-31 replacement plan on <date>". In `BACKLOG.md` remove NEW-55 and NEW-57, rewrite NEW-56 to its remaining residuals only (`preserved` descendants; `active.length > 1` unexercised), and set the numbered-row count. In `ORDER.md` set `NOW` to baseline Spec 2 Task 8, item 8 to "Completed <date>", and the Count section to "baseline Tasks 8–9 contain 10 unchecked steps".

- [ ] **Step 5: Delete this plan**

Its constraints now live in Spec 2 (amended) and the architecture notes; git history is the archive.

```bash
git rm docs/superpowers/plans/2026-09-04-developer-os-task6-closure.md
```

- [ ] **Step 6: Run the document gates and commit the checkpoint**

Run: `npx vitest run --root tests repository/citations.test.ts repository/control-bytes.test.ts && npm run lint`

Expected: PASS.

```bash
git add docs/architecture/foundation.md docs/architecture/threat-model.md docs/superpowers/plans/2026-08-31-developer-os-retained-bootstrap-evidence.md docs/superpowers/plans/2026-08-29-developer-os-release-update.md docs/superpowers/ORDER.md docs/superpowers/BACKLOG.md
git commit -m "docs: accept the retained-bootstrap Task 7 checkpoint"
```

After this commit, baseline Spec 2 Task 8 is the next action. Do not begin it in the same session.
