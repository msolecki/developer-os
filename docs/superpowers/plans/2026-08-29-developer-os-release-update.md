# Developer OS Release, Update, and Manifest V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved DOS-P7 Spec 2 stable launcher, signed release trust, `InstallationManifestV2`, the V1 refusal and V2 initialization (the V1 migration was withdrawn by D18), plan-first update, managed-artifact/schema upgrade, and conservative one-version rollback.

Completed tasks were removed on 2026-09-23, 2026-09-24 and 2026-09-26; see git history. What remains: Task 11b (parked, D46) and Task 26 (parked, D56). The Phase 4b and Phase 8 closes ran: full suite green on `bc17550`, whole-phase reviews, PR #15 merged (`ORDER.md`).

**Architecture:** Core owns canonical scalar/path codecs, manifest/update schemas, pure transition tables, target-plan validation, and migration-chain contracts; Security owns signatures, fixed-origin transport, bounded Zstandard/ustar admission, guarded scratch, and planner/verifier supervision; platform-macos owns launcher executable/platform admission; the launcher owns offline root trust and exact bundle selection; the adapters and Brain expose pure target planners; the CLI composes all concrete paths, owner providers, construction/source envelopes, lifecycle participants, update/rollback commands, and recovery. Tasks 12–26 consume Spec 1's lifecycle coordinator and finish Spec 2.

**Tech Stack:** TypeScript 5.9 strict ESM, Node.js 24 built-ins (`node:crypto`, `node:https`, `node:zlib`, `node:fs`), Zod 4 where existing package schemas use it, Vitest 4, existing Foundation transactions and injected filesystem/process/clock/lock ports.

**Spec:** `docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md`

## Status 2026-09-26

Tasks 10–25 are committed and their Phase 4b and Phase 8 closes ran. The apply path is completed by
`plans/2026-09-23-developer-os-spec2-closure.md` (D60), whose Tasks 9–10 are blocked on design
(NEW-110, D61). Task 26 (the lifecycle proof) and Task 11b remain parked.

## Global Constraints

- **Sequencing (D16, 2026-09-16):** Tasks 12–26 run as roadmap Phase 8, after the founder cutover (A15). **Amended 2026-09-23 by D56:** Tasks 12–25 run now, in parallel with the A15 cutover, under the D44/D47 lane (tests written, not run; `npm run lint` per commit; tests and review at phase close); Task 26 stays parked with 11b.
- Package direction remains `core ← security ← platform-macos ← cli`, with the separate `apps/launcher` depending only on Core, Security, and platform-macos. Core imports no filesystem globals, HTTP, archive extraction, process, platform, adapter, or CLI implementation.
- No command other than `developer-os update` makes an update network request. Rollback, the V1 refusal, fresh init, uninstall, config, Git, automation, Brain, adapter probes, and launcher selection make zero release-transport requests.
- `update` and `update rollback` are plan-only unless `--apply` is present. Planning may use only one bounded attempt-owned system-temporary scratch envelope and never mutates product, Brain, vendor, launcher, manifest, trust, active-release, or allocator state.
- The updater accepts only stable SemVer, fixed launcher-provided metadata locators, root/delegated Ed25519 signatures, exact delegated HTTPS origins, one permitted redirect, and the exact signed architecture bundle. It never accepts a custom origin, channel, prerelease, build metadata, arbitrary downgrade, cookie, credential, client certificate, or ambient proxy.
- Exact primary bounds are normative: delegation 64 KiB; release index 4 MiB; bundle manifest 16 MiB; archive 2 GiB; one expanded file 512 MiB; aggregate expansion 8 GiB; 200,000 bundle entries; 12 GiB scratch; 256 MiB archive streaming memory; V2 manifest 64 MiB/1,000,000 artifacts; immutable leaf plans 16 MiB; construction plan 512 MiB; construction journal 64 MiB; participant journals 1 MiB; planner request/result 256 MiB each; 1,000,000 blobs and 1 GiB blob payload per direction; 512 MiB planner RSS; 30-second idle/10-minute wall; rollback payload 1,000,000 entries/2 GiB.
- All new persisted JSON is `CanonicalJsonV1` plus one LF. Exact keys are checked recursively; array order, non-empty per-scope enumerations, counts, checked sums, hashes, and cross-object bijections are validated before authority.
- Relative and absolute path brands use the exact NFC, component, byte, control/format, alias, containment, and role restrictions in Spec 2 §2. A raw string, generic URL resolver, archive name, or caller-selected product root never becomes mutation authority.
- Redact before truncating, hashing, logging, persistence, publication, or model input. Integrity hashes are computed only after the Security secret screen and remain internal plan/precondition evidence.
- The target planner is trusted signed release code with a repository-enforced capability-absence graph, not an OS sandbox. It receives tokenized bounded state over counted pipes, no absolute product/Brain root, environment, network, filesystem, clock, randomness, native addon, worker, dynamic import, or subprocess authority.
- Every filesystem mutation follows `plan → backup → stage → validate → apply → verify → finalize`. Intent and an actual inode identity precede byte zero; recovery follows only persisted direction/cursors; third states preserve evidence as exit 6.
- Trust high watermarks never roll back. Rollback never downloads, merges, forces, overwrites a post-update edit, lowers trust, or removes a path without exact manifest plus signed/retained inventory authority.
- Tests use synthetic Ed25519 keys, release archives, homes, vaults, vendor state, and injected local transports. No test reads a live Brain, credential store, GitHub CLI config, release, vendor home, launcher installation, or founder data.
- At each code-producing task commit, tick only that task's evidence-backed steps, update A11's exact progress sentence in `docs/superpowers/ORDER.md`, stage exact paths only, run the named focused command plus `npm run check`, and obtain a fresh reviewer verdict. **Amended 2026-09-16 by D17:** an ordinary task commit runs `npm run lint` instead of `npm run check` and is pushed for CI; `npm run check` runs at checkpoint close (`SESSION.md` §5). **Amended 2026-09-19 by D32:** slow named commands (`npm run test…` scripts, whole runs of `*.v2.test.ts`, `apps/cli/src/bootstrap/executor.test.ts`, `tests/e2e`, `tests/security`, `tests/integration`) are deferred to that checkpoint `npm run check`; the task's own added or changed cases still run red then green, filtered with `-t`. Accepted findings receive a failing regression test before the smallest correction.

## File and Responsibility Map

| Area | Files | Responsibility |
|---|---|---|
| Canonical/update scalars | `packages/core/src/lifecycle/canonical-json.ts`, `packages/core/src/update/{scalars,paths,release,index}.ts` | Canonical JSON, numeric/version/hash/time/path brands, release identity and pure selection schemas |
| Manifest V2/bootstrap | `packages/core/src/manifest/{v2,drift,manifest-state,bootstrap}.ts` | V1/V2 validation, V2 drift, manifest participant, fresh-init plans/state tables |
| Core update protocol | `packages/core/src/update/{preview,planner,owner,migrations,construction,participants,coordinator,rollback}.ts` | Preview/materialization, token wire schemas, owner/migration plans, construction/participant/coordinator/rollback state machines |
| Release security | `packages/security/src/update/{signatures,transport,archive,scratch,planner-process,graph,index}.ts` | Ed25519 chain, fixed HTTPS transport, zstd-ustar admission, guarded scratch, counted planner/verifier supervision, capability graph gate |
| Launcher platform | `packages/platform-macos/src/launcher/{types,admission,index}.ts` | Platform/architecture identity and guarded executable/bundle admission |
| Stable launcher | `apps/launcher/src/{handoff,selection,environment,main}.ts`, `apps/launcher/assets/` | Offline root constants, recovery/bootstrap/active/fallback routing, FD 3 trust handoff, absolute exec |
| Pure owner planners | `packages/adapter-claude/src/update/`, `packages/adapter-codex/src/update/`, `packages/brain/src/migrations/update/` | Root-free token-only desired state, Codex refresh draft, Brain migration planning |
| CLI bootstrap/update | `apps/cli/src/bootstrap/`, `apps/cli/src/update/`, `apps/cli/src/commands/update/`, existing `init`, `main`, `context` | Packaged release admission, V2 init, construction/source envelopes, participant composition, preview/apply/rollback/recovery |
| Gates | `tests/integration/update/`, `tests/e2e/release-update.test.ts`, `tests/security/`, `tests/repository/` | Synthetic full lifecycle, death injection, network/process/capability absence, exact enumerator coverage |

---


## Task 11b (parked) and Checkpoint B — Release and update after the cutover

### Task 11b: Replace the production bootstrap pin with the launcher's admitted, verified release

**Parked 2026-09-22 by D46, `f80f3a1`.** Release signing keys are dropped for now and the FD 3 handoff carries no packaged-release identity; A12 Tasks 1 and 4 ship the unsigned local build (`init --local-release`, D47) instead. Nothing below has started.

- [ ] **FOUNDER STOP (parked, D46):** before Task 11b can resume, the founder decides which offline root key the launcher compiles in and whether public releases reuse it.

Also owned here: the launcher stubs (NEW-111), the launcher-only FD 3 source (NEW-112) and the Phase 4b handoffs in `BACKLOG.md` §6.

**Added 2026-09-22 (Phase 4b, `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`).**
`apps/cli/src/context.ts:790` hardcodes `bootstrap: { state: "unavailable_until_packaged_handoff" }`
in `createProductionContext` — no production code path ever reaches the `"available"` arm of
`CliBootstrapContext` (`apps/cli/src/bootstrap/context.ts:263-272`), so V2 `init` cannot run outside
tests. `apps/cli/src/update/packaged-release.ts` already has the admission machinery
(`admitRootVerifiedPackagedRelease(handoff: RootVerifiedPackagedReleaseV1): Promise<PackagedReleaseSourceV1>`,
`unavailablePackagedReleaseSource()`) and it is called only from the test fixture
(`apps/cli/src/commands/testing.ts:502-504`, `createSyntheticPackagedRelease`) — this task is the
first production caller. Neither Spec 1's plan nor this plan replaces the pin; that is the gap Phase
4b's checklist named.

Before the pin is removed: correct the V1 refusal's recovery (D20, NEW-79) and harden the ordinary-command gate (NEW-81) — roadmap Phase 4b.

Routed here 2026-09-23 by the Spec 2 closure analysis: `readOfflineReleaseTrustFd`
(`packages/security/src/update/handoff.ts`) refuses any open descriptor other than 0–3. On macOS
libuv holds extra descriptors, so it can probably never pass in a real process; the synthetic fixture
does not see it, but the real path will.

**Files:**
- Modify: `apps/cli/src/bin.ts` — read the launcher's FD 3 handoff (Task 11's `readOfflineReleaseTrustFd`) when present; on success, derive a `RootVerifiedPackagedReleaseV1` from Task 10's admitted bundle (`AdmittedReleaseBundleV1`) and Task 11's verified metadata chain, and pass it into `createProductionContext`. When FD 3 is absent or closed (no launcher, direct CLI invocation), pass nothing — today's pin behavior is the fallback, not a regression.
- Modify: `apps/cli/src/context.ts` — `ProductionContextOptions` gains an optional `readonly packagedRelease?: RootVerifiedPackagedReleaseV1;`. When present, `createProductionContext` calls `admitRootVerifiedPackagedRelease` and sets `bootstrap: { state: "available", executor: new BootstrapExecutor({ paths, userHome: options.userHome, packagedRelease: admitted, transactionExecutor, lockProvider, renameNoReplace, renameSameParentNoReplace, now, uuid }), packagedRelease: admitted, inspectEvidence }` (mirror the wiring in `apps/cli/src/commands/testing.ts:618-630`, production dependencies not fixture ones). When absent, keep the current `{ state: "unavailable_until_packaged_handoff" }`.
- Create: `apps/cli/src/bin.test.ts` or extend the existing bin-level test, plus `apps/cli/src/context.test.ts` cases for both branches.

**Interfaces:**
- Consumes: Task 10's `LauncherSelectionV1`/`AdmittedReleaseBundleV1` (the launcher already admitted and root-verified the bundle before spawning the CLI), Task 11's `verifyReleaseMetadataChain`/`readOfflineReleaseTrustFd`, and the existing `admitRootVerifiedPackagedRelease`/`PackagedReleaseSourceV1` (`apps/cli/src/update/packaged-release.ts`, unmodified).
- Produces: production `init`/`repair`/`doctor` etc. see `bootstrap.state === "available"` when launched through the launcher; unchanged `"unavailable_until_packaged_handoff"` when launched directly (dev shell, tests, or a launcher `package_fallback` selection with nothing admitted).

- [ ] **Step 1: Write failing tests for both branches**

Cover: FD 3 present and verifying → `bootstrap.state === "available"` with a real `BootstrapExecutor` wired to the admitted release; FD 3 absent (closed stdin descriptor 3, the common case) → unchanged pinned behavior; FD 3 present but failing verification → the CLI refuses rather than silently falling back to "unavailable" (a downgrade-by-corruption must be loud, not silent — Global Constraint "trust high watermarks never roll back" applies here even though this is bootstrap admission, not update/rollback).

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/bin.test.ts src/context.test.ts`
Expected: FAIL — the wiring does not exist yet.

- [ ] **Step 3: Implement**

Wire `bin.ts` and `context.ts` as described in Files above. Do not touch `packaged-release.ts`'s admission logic — it is already guarded (owner-only, no-follow, identity-rechecked); this task is composition-root wiring only.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/bin.test.ts src/context.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate, commit**

Tick, update the progress sentence, run `npm run lint` (Phase 4b's D44 lane — see roadmap), then commit code and tests only.

### Task 26: Prove the complete release/update lifecycle and close DOS-P7

**Files:**
- Create: `tests/integration/update/signature-transport.test.ts`
- Create: `tests/integration/update/archive-planner.test.ts`
- Create: `tests/integration/update/recovery.test.ts`
- Create: `tests/e2e/release-update.test.ts`
- Modify: `tests/security/network.test.ts`
- Modify: `tests/security/sentinel.test.ts`
- Modify: `tests/security/symlink-escape.test.ts`
- Modify: `tests/security/interruption.test.ts`
- Modify: `tests/repository/check.ts`
- Modify: `tests/repository/check.test.ts`
- Modify: `docs/architecture/foundation.md`
- Modify: `docs/architecture/foundation-constraints.md`
- Modify: `docs/architecture/brain.md`
- Modify: `docs/architecture/claude-adapter.md`
- Modify: `docs/architecture/codex-adapter.md`
- Modify: `docs/architecture/threat-model.md`
- Modify: `docs/superpowers/BACKLOG.md`
- Modify: `docs/superpowers/plans/2026-07-21-developer-os-program.md`
- Modify: `docs/superpowers/ORDER.md`
- Delete after surviving constraints move: `docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md`
- Delete after surviving constraints move: `docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md`
- Delete after all plan evidence is checked: `docs/superpowers/plans/2026-08-29-developer-os-release-update.md`

**Interfaces:**
- Consumes: both completed DOS-P7 specifications, Spec 1 implementation checkpoint, Tasks 1–25.
- Produces: synthetic install→migration/fresh init→preview/apply→rollback/reapply→Git/automation→uninstall evidence, non-vacuous release/network/process/capability gates, canonical architecture/program state, and completed A11.

- [ ] **Step 1: Write failing end-to-end and non-vacuous gate tests**

```ts
it("runs the complete synthetic lifecycle on both architectures", async () => {
  for (const architecture of ["arm64", "x64"] as const) {
    const fixture = await createSyntheticReleaseFixture({ architecture });
    await fixture.freshInitOrMigrate();
    await fixture.previewAndApplyUpdate();
    await fixture.rollbackAndReapply();
    await fixture.enableSyncAutomationThenUninstall();
    expect(await fixture.assertBrainPreservedAndProductRemoved()).toBe(true);
  }
});

it("enumerates every release authority scope non-empty", () => {
  const report = inspectReleaseAuthoritySurfaces(repositoryRoot);
  expect(report.networkEntrypoints.length).toBeGreaterThan(0);
  expect(report.launcherEntrypoints.length).toBeGreaterThan(0);
  expect(report.plannerGraphs.every(graph => graph.modules.length > 0)).toBe(true);
});
```

Map every Spec 2 §12 row and every unchanged Spec 1 §7 row to named evidence. Include V1 and fresh V2 start, both architectures, metadata replay/signature/origin/archive corpus, identical preview, no-apply mutation, apply/rollback death at every outer and nested cursor, owner completeness, migration chain, capacity exact/first-over, post-update edit refusal, rollback consumption/reapply, launcher active/fallback/bootstrap/executor routes, no credentials/private diagnostics, full uninstall preservation, and per-scope non-empty enumerators.

**Spec 2 amendment of 2026-09-08 (A6, A8) — this task owns both closure gates.**

- Every "exact maximum/first-over" row means the exact maximum admissible under **both** the cardinality and byte bounds and the first row over **either**. The retirement rows in particular: the 1,200,012 aggregate counts 1,000,000 inventory entries, which no 64-MiB inventory can hold, so the feasible maximum is derived by the test rather than declared.
- Add the exact-set test asserting that **no** path in Spec 2 produces a `symlink` managed artifact. The arm is retained as accepted residual 9 so a later link-capable transaction operation needs no manifest schema bump; this test is what keeps it a checked invariant rather than dead code.

- [ ] **Step 2: Run the focused integration/security/repository gates and verify uncovered rows fail**

Run: `npx vitest run --root tests integration/update/signature-transport.test.ts integration/update/archive-planner.test.ts integration/update/recovery.test.ts e2e/release-update.test.ts security/network.test.ts security/sentinel.test.ts security/symlink-escape.test.ts security/interruption.test.ts repository/check.test.ts`

Expected: FAIL until every new surface is registered and both specifications' complete gate matrices are met.

- [ ] **Step 3: Close evidence gaps and move surviving contracts into canonical documents**

Update repository enumerators with exact non-empty assertions and no raw founder inputs. Move the stable launcher/release trust/manifest V2/bootstrap/update/planner/rollback contracts and accepted residuals into their owning architecture notes; update the threat model's former no-network rule to the exact explicit-update-only boundary; record Spec 1 lifecycle contracts as implemented; update program Task 7 and remove only completed A11/BACKLOG rows. Do not claim A12 or later work complete.

- [ ] **Step 4: Run focused gates and the full repository gate**

Run: `npx vitest run --root tests integration/update/signature-transport.test.ts integration/update/archive-planner.test.ts integration/update/recovery.test.ts e2e/release-update.test.ts security/network.test.ts security/sentinel.test.ts security/symlink-escape.test.ts security/interruption.test.ts repository/check.test.ts`

Run: `npm run check`

Expected: PASS for lint, all package/integration/E2E tests, build, generated-artifact drift, and `git diff --check`.

- [ ] **Step 5: Obtain independent final review and correct every accepted finding**

Dispatch a fresh reviewer who authored none of Tasks 1–26 with the two approved specifications, both implementation plans, exact changed-file list, and review-only/no-commit instructions. For each accepted finding, add a focused failing regression test first, apply the smallest correction, rerun its focused suite and `npm run check`, then request another verdict. Continue until the reviewer returns `READY`.

- [ ] **Step 6: Delete completed specs/plan only after inbound references and surviving contracts are closed**

Search all tracked files for both spec paths and this plan path. Replace surviving inbound references with the exact canonical architecture/program section that absorbed the contract. Confirm no unfinished checkbox or A11 row depends on the documents, then delete both completed specs and this completed plan. Git history is the archive.

- [ ] **Step 7: Commit the verified DOS-P7 checkpoint**

Stage every exact changed path by name; never use `git add -A`, `git add .`, or a wildcard. Inspect `git diff --cached --name-status` and the staged diff, then commit with:

```bash
git add tests/integration/update/signature-transport.test.ts tests/integration/update/archive-planner.test.ts tests/integration/update/recovery.test.ts tests/e2e/release-update.test.ts tests/security/network.test.ts tests/security/sentinel.test.ts tests/security/symlink-escape.test.ts tests/security/interruption.test.ts tests/repository/check.ts tests/repository/check.test.ts docs/architecture/foundation.md docs/architecture/foundation-constraints.md docs/architecture/brain.md docs/architecture/claude-adapter.md docs/architecture/codex-adapter.md docs/architecture/threat-model.md docs/superpowers/BACKLOG.md docs/superpowers/plans/2026-07-21-developer-os-program.md docs/superpowers/ORDER.md docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md docs/superpowers/plans/2026-08-29-developer-os-release-update.md
git commit -m "feat: complete release and update lifecycle"
```

Confirm CI is green on the exact commit before merge. Do not merge; the founder owns merging. Report the completed A11 evidence and the new `NOW` action, A12.
