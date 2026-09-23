# Developer OS Opt-in Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved DOS-P7 Spec 1 configuration, Git synchronization, scheduled automation, lifecycle coordination, and uninstall behavior without hidden process, network, filesystem, or credential authority.

**Architecture:** Core owns strict shared schema machinery, generic injected lifecycle contracts, allocation-free planning, lifecycle coordination, Git planning, and recovery state machines; Security owns the closed Git process graph and bounded subprocess/pack boundary; the macOS package owns launchd serialization, observation, and effects behind injected dependencies; the CLI is the downstream composition root that creates the exact public composite schemas, verbs, runtime records, and uninstall orchestration. The four public plan/apply operations emit allocation-free previews and revalidate them under the global lock; `git sync` and uninstall instead finish private allocation-free planning with `previewHash: null`. Every mutable path then executes through one persisted immutable `LifecycleExecutionPlanV1` whose Foundation, Git, launchd, manifest, and secret-opaque participants recover from persisted intent.

**Tech Stack:** TypeScript 5.x in strict ESM mode, Node.js built-ins, Zod 4, smol-toml, Vitest 4, existing Developer OS Foundation transactions, injected filesystem/process/clock/lock adapters.

**Spec:** `docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md`

**Superseded for execution, 2026-09-17.** Spec 1 was amended by the founder-approved NEW-67 amendment
(its change record and "Amended 2026-09-17" markers). Some constraints and task texts below predate it and
contradict it: the V1→V2 migration precondition, `LifecycleBootstrapCreationTempV1`, the absent-manifest
recovery epoch and key-present coordinator, and unlink/rmdir cleanup of the bootstrap lock and its
directories. The remaining tasks are the source for plan 1b (Git, launchd, automation), to be written
against the amended Spec 1; Task 24 is carved out to post-A16 hardening (D42, NEW-100). Do not execute
the tasks below as written.

Completed tasks were removed on 2026-09-23; see git history. Tasks 1–7, 21 and 23 landed via plan 1a
(`43c6876..082e098`); references to them below name those landed contracts.

## Global Constraints

- Do not execute this plan until DOS-P7 Spec 2 has implemented and exported `ManagedArtifactV2`, `InstallationManifestV2`, `ManifestStatePlanV1`, its V1→V2 migration, initial lifecycle nonce/allocator creation, the three lifecycle journal-directory reservations, and every exact runtime-record/status/log/lease reservation required by Spec 1 §2.1.
- At execution start, prove the Spec 2 dependency with focused manifest migration/new-init tests; do not add mutable configuration, Git, automation, or runtime-state code against `InstallationManifestV1`.
- Public lifecycle commands are allocation-free previews unless `--apply` is present. Apply hashes and revalidates the preview before allocating an execution envelope.
- Disabled Git spawns no Git process and makes no Git network call. Disabled automation installs no plist and starts no scheduled process.
- No code in this plan invokes a model or vendor CLI, captures or ingests content on a schedule, stores/prompts for credentials, or implements fetch, pull, merge, rebase, checkout, force-push, or history rewriting.
- Foundation remains the product-managed file mutation protocol. Exact `.git` internals and live launchd state use only the specialized journaled effects in Spec 1 §2.4.
- Every filesystem mutation follows `plan → backup → stage → validate → apply → verify → finalize`; every external effect persists intent before mutation and observes post-state before advancing its cursor.
- Package direction is `core ← security ← platform-macos ← cli`; Core never imports Security, CLI, Brain, or platform code. Platform code receives filesystem, process, clock, lock, and identity dependencies.
- At each Task 1–23 commit, tick only that task's five evidence-backed steps in this plan, update A11's exact remaining-step count/progress sentence in `docs/superpowers/ORDER.md`, and stage both documents by exact path with the task's code. The plan is tracked by then, so no ignore override is needed during implementation.
- All persisted DOS-P7 JSON except unchanged Foundation journals is `CanonicalJsonV1` plus one LF, with exact-key validation at every depth. Unknown keys, over-limit input, wrong ownership/type/mode/link count, and identity changes refuse before authority.
- Redact before truncating, hashing, logging, persisting, or publishing. Fixtures are synthetic and use temporary repositories, local bare remotes, injected launchd runners, and no real credentials or live user paths.
- Exact limits from the spec are normative, including: 1-MiB Foundation/coordinator/launchd journals, 16-MiB immutable/Git-effect plans and journals, 1,000,000 aggregate lifecycle leaves, 200,001 Git objects, 512-MiB per-object inflation, 8-GiB aggregate inflation/delta work, depth 50, 10,000,000 delta instructions, 256-MiB RAM, 10-GiB temp, one inherited 600-second push phase, and the absent-manifest walk's 1,000,000-entry/128-component/4096-byte bounds.
- The only supported launchd mutation row is the approved macOS 26.5.2 build `25F84` `/bin/launchctl` identity. Bootstrap inherits only FD 3 for an already-unlinked immutable private snapshot and never inherits the real plist descriptor.
- A task is complete only after its focused tests pass, `npm run check` passes (amended 2026-09-16 by roadmap D17: `npm run lint` plus a pushed CI run per task, `npm run check` at checkpoint close; narrowed 2026-09-19 by D32: slow focused commands are deferred to that checkpoint, except the task's own cases filtered with `-t`), a fresh reviewer who did not author the task returns `READY`, accepted findings receive a failing regression test first, and the task checkbox is updated with evidence.

## File and Responsibility Map

| Area | Files | Responsibility |
|---|---|---|
| Core configuration | `packages/core/src/config/{types,loader,lifecycle,index}.ts` | Strict lifecycle config schema, canonical key/value codecs, publishable projection, activation/config hashes |
| Lifecycle kernel | `packages/core/src/lifecycle/{types,canonical-json,paths,allocator,store,coordinator,recovery,bootstrap,index}.ts` | IDs, budgets, previews/envelopes, journal feasibility, stable locks, execution/recovery/compaction, absent-install bootstrap grammar |
| Foundation bridge | `packages/core/src/transactions/{types,store,executor}.ts`, `packages/core/src/lifecycle/foundation-participant.ts` | 16-MiB streamed mutation payloads, participant intent/outcome, terminal compaction, legacy index closure |
| Git domain | `packages/core/src/git/{types,metadata,repository,scope,planner,effects,index}.ts` | Closed repository formats, guarded metadata, scope/tree/index/ref/reflog plans, and exact effects |
| Git process security | `packages/security/src/git/{types,process-table,supervisor,shadow,gateways,pack-reader,index}.ts` | Pinned distribution, exact process graph/argv/env/I/O, counted proxies, sanitized shadows, no-shell helpers, guarded SHA-1 pack/ref closure |
| Launchd platform | `packages/platform-macos/src/launchd/{types,registry,plist,process-table,observe,effects,index}.ts` | Job identity, canonical plist XML, pinned process rows, bounded observation, unlinked snapshot bootstrap, compensation |
| CLI lifecycle composition | `apps/cli/src/lifecycle/{context,recovery,runtime-records,uninstall}.ts` | Concrete paths/dependencies, startup recovery, bounded status/log records, drain and ownership partition |
| CLI commands | `apps/cli/src/commands/config.ts`, `apps/cli/src/commands/git/`, `apps/cli/src/commands/automation/`, existing `main.ts`, `uninstall.ts`, `context.ts`, `output-schemas.ts` | Public grammar, preview/apply orchestration, scheduled hidden runner, V2 handoff admission, uninstall integration |
| Integration gates | `tests/integration/git/`, `tests/integration/launchd/`, `tests/e2e/opt-in-surfaces.test.ts`, existing `tests/security/` and `tests/repository/` | Synthetic end-to-end authority/refusal/crash coverage and non-empty enumerator gates |

---

### Task 8: Close Git domain schemas and guarded metadata admission

**Files:**
- Create: `packages/core/src/git/types.ts`
- Create: `packages/core/src/git/metadata.ts`
- Create: `packages/core/src/git/index.ts`
- Create: `packages/core/src/git/types.test.ts`
- Create: `packages/core/src/git/metadata.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: lifecycle canonical types/encoders, Task 1 `GitSyncConfigV1`, injected guarded filesystem.
- Produces: `GitIndexStateV1`; `GitHeadStateV1`; `GitReflogStateV1`; `GitReflogPlanV1`; `GitSourceStateV1`; `GuardedGitPathStateV1`; `PlannedGitPathStateV1`; `GitRelinquishedDirectoryRootV1`; `GitTreeFingerprintV1`; `GitMetadataBoundsV1`; `GitPackReaderBudgetV1`; validators for branch, URL, path, index, `HEAD`, ref, reflog, repository format, and metadata snapshots.

- [ ] **Step 1: Write failing exhaustive Git schema and admission tests**

```ts
it.each(validRemoteCanonicalizations)("normalizes $input to $expected", ({ input, expected }) => {
  expect(normalizeRemoteUrl(input)).toEqual(expected);
  expect(normalizeRemoteUrl(expected.url)).toEqual(expected);
});

it("admits only plain DIRC v2 plus the supported TREE cache", async () => {
  expect(await inspectGitMetadata(fixture.plainV2())).toMatchObject({ index: { state: "present" } });
  await expect(inspectGitMetadata(fixture.splitIndex())).rejects.toThrow("unsupported_index_format");
});
```

Cover every branch/ref invalid byte/component, local/file/HTTPS/SSH/scp normalization and ambiguity, credentials/redaction matches, declared/effective URL equality, source config/candidate/index/HEAD/ref/reflog byte caps, symbolic/detached/unborn `HEAD`, absent tagged index, repository extensions, index stages/flags/extensions, owner/type/link/identity changes, and rejection before allocation/materialization/hash.

- [ ] **Step 2: Run Git schema/metadata tests and verify modules fail to resolve**

Run: `npx vitest run --root packages/core src/git/types.test.ts src/git/metadata.test.ts`

Expected: FAIL because the Git domain modules are absent.

- [ ] **Step 3: Implement exact Git validators and guarded metadata reader**

```ts
export type GitHeadStateV1 =
  {
    readonly state: "present";
    readonly bytesHash: LowerHexSha256;
    readonly semantic:
      | { readonly kind: "symbolic_ref"; readonly value: FullBranchRefV1 }
      | { readonly kind: "oid"; readonly value: LowerHexSha1 };
  };

export async function inspectGitMetadata(
  dependencies: GitMetadataDependencies,
  request: GitMetadataRequest,
): Promise<GitSourceStateV1>;
```

Read one guarded bounded leaf at a time with no-follow opens and before/after identity checks. Parse only the repository/index/config/ref/reflog forms approved in §4; return immutable semantic projections and hashes, not mutable path handles. Apply bounds before allocation, copy, full parse, or hashing.

- [ ] **Step 4: Run Git schema and metadata tests**

Run: `npx vitest run --root packages/core src/git/types.test.ts src/git/metadata.test.ts src/index.test.ts`

Expected: PASS with non-empty exact enumerations and boundary cases.

- [ ] **Step 5: Commit Task 8**

```bash
git add packages/core/src/git/types.ts packages/core/src/git/metadata.ts packages/core/src/git/index.ts packages/core/src/git/types.test.ts packages/core/src/git/metadata.test.ts packages/core/src/index.ts packages/core/src/index.test.ts
git add docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md docs/superpowers/ORDER.md
git commit -m "feat(core): close Git metadata admission"
```

### Task 9: Plan exact scoped trees, index/ref/reflog transitions, and sync cardinality

**Files:**
- Create: `packages/core/src/git/scope.ts`
- Create: `packages/core/src/git/repository.ts`
- Create: `packages/core/src/git/planner.ts`
- Create: `packages/core/src/git/scope.test.ts`
- Create: `packages/core/src/git/planner.test.ts`
- Modify: `packages/core/src/git/index.ts`

**Interfaces:**
- Consumes: Task 8 metadata states, Brain policy through an injected public scope enumerator, lifecycle preview contracts.
- Produces: `GitScopeSnapshotV1`, `GitPlanPreviewV1`, `GitEnablePlan`, `GitDisablePlan`, generic `GitSyncPlanCoreV1<TPushPlan>`, `GitSyncCardinalityV1`, internal allocation-free `GitSyncPlanningDraft`, tree/index/ref/reflog projections and exact commit bytes.

- [ ] **Step 1: Write failing scope and transition-planning tests**

```ts
it("plans only the guarded Brain scope in unsigned UTF-8 order", async () => {
  const draft = await planner.planSync(fixture.request);
  expect(draft.sync.managedPaths).toEqual(sortUnsignedUtf8(expectedManagedPaths));
  expect(draft.scopeFingerprint).toBe(expectedScopeHash);
  expect(planner.publicMethods()).toEqual([
    "assertCoreSyncFeasible", "planSync", "previewDisable", "previewEnable",
  ]);
});

it("binds every reflog append bijectively to one ref transition", () => {
  expect(() => validateGitSyncPlanCore(planWithDuplicateReflog, localPushCodec)).toThrow("reflog_bijection");
  expect(validateGitSyncPlanCore(validCorePlan, localPushCodec).reflogs).toHaveLength(validCorePlan.refTransitions.length);
});
```

Cover initialize/adopt, enable-only `.git` publication, existing unborn first sync, plain index plus TREE cache, dirty/in-progress refusal, line-break/tab/CR filenames through NUL-safe tree input, 16-MiB file and 1-GiB aggregate scope bounds, object/index/reflog/ref order, 64-MiB preimage plus 4-KiB append postimage, exact committer/date/message, 200,001/200,002 cardinality, no-change truthfulness, and allocation-free deterministic previews.

- [ ] **Step 2: Run planner tests and verify planning functions fail**

Run: `npx vitest run --root packages/core src/git/scope.test.ts src/git/planner.test.ts`

Expected: FAIL because scope/repository planners do not exist.

- [ ] **Step 3: Implement pure planning and cardinality derivation**

```ts
export class GitPlanner {
  previewEnable(request: GitEnableRequestV1): Promise<GitPlanPreviewV1>;
  previewDisable(request: GitDisableRequestV1): Promise<GitPlanPreviewV1>;
  planSync(request: GitSyncRequestV1): Promise<GitSyncPlanningDraft>;
  assertCoreSyncFeasible(draft: GitSyncPlanningDraft): GitCoreSyncFeasibility;
}
```

`git sync` has no public preview. `GitSyncPlanningDraft` contains every Core-owned allocation-free input: exact `sourcePreconditions`, guarded scope and managed paths, candidate blob/tree/commit/index/ref/reflog bytes, source/destination effect-transition drafts, destination state, persisted-push semantic inputs, no-change arm, and one shared cardinality/reservation vector. Construct it without touching real Git state and run all Core-known plan-byte, journal, staging, and aggregate feasibility calculations before ID reservation. It cannot be persisted or executed and exposes no bind-from-preview path. Task 15 combines it with the later Security shadow/process-table/permit draft into the one complete private `GitSyncExecutionDraft`, performs the aggregate feasibility proof, reserves IDs, and binds the final plans. Core's generic `GitSyncPlanCoreV1<TPushPlan>` never imports Security or CLI. Use explicit absent/present arms; every post-enable sync uses existing-repository effects.

- [ ] **Step 4: Run scope/planner tests**

Run: `npx vitest run --root packages/core src/git/scope.test.ts src/git/planner.test.ts`

Expected: PASS with exact hashes/bytes and exhaustive transition equality checks.

- [ ] **Step 5: Commit Task 9**

```bash
git add packages/core/src/git/scope.ts packages/core/src/git/repository.ts packages/core/src/git/planner.ts packages/core/src/git/scope.test.ts packages/core/src/git/planner.test.ts packages/core/src/git/index.ts
git add docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md docs/superpowers/ORDER.md
git commit -m "feat(core): plan scoped Git synchronization"
```

### Task 10: Define and validate the pinned Git process graph

**Files:**
- Create: `packages/security/src/git/types.ts`
- Create: `packages/security/src/git/process-table.ts`
- Create: `packages/security/src/git/process-table.test.ts`
- Create: `packages/security/src/git/index.ts`
- Modify: `packages/security/src/index.ts`

**Interfaces:**
- Consumes: Task 8 Git scalar/path/budget types and the exact approved Git 2.50.1 Apple Git-155 distribution row.
- Produces: `SupportedGitDistributionV1`; `SupportedGitExecutableV1`; `SupportedGitProcessTableV1`; `GitArgTokenV1`; `GitArgvGrammarV1`; `GitProcessNodeV1`; `GitProcessEdgeV1`; `GitProcessIoProfileV1`; `GitProcessPhaseBudgetV1`; `GitEnvironmentProfileV1`; `GitConfigQuotedPathV1`; `GitAlternateObjectDirectoryV1`; `GitProcessSupervisorV1`; `validateSupportedGitProcessTable`; table/transcript hash functions.

- [ ] **Step 1: Write failing canonical table and mutation tests**

```ts
it("round-trips the sole supported distribution byte-identically", () => {
  expect(validateSupportedGitProcessTable(SUPPORTED_GIT_PROCESS_TABLE)).toEqual(SUPPORTED_GIT_PROCESS_TABLE);
  expect(hashGitProcessTable(SUPPORTED_GIT_PROCESS_TABLE)).toMatch(/^[0-9a-f]{64}$/u);
});

it.each(mutatedProcessRows)("refuses $name before process authority", ({ value }) => {
  expect(() => validateSupportedGitProcessTable(value)).toThrow();
});
```

Pin the exact 11 build lines, three executable identities, six exec-path links, twelve environment maps, seven I/O profiles, four inherited phase budgets, 21 node IDs and 21 edge IDs from Spec 1. Assert non-empty/unique/ordered sets, exact literal/semantic/joined argv grammar, zero through 200,001 pack objects, and rejection of wildcards, regexes, ellipses, unknown fields, unexpanded slots, option-shaped tokens, and phase resets.

- [ ] **Step 2: Run process-table tests and verify missing table fails**

Run: `npx vitest run --root packages/security src/git/process-table.test.ts`

Expected: FAIL because the Git process table is not implemented.

- [ ] **Step 3: Implement the exact immutable process table and validator**

```ts
export const SUPPORTED_GIT_PROCESS_TABLE: SupportedGitProcessTableV1 = Object.freeze({
  schemaVersion: 1,
  id: "apple-git-155-process-v1",
  distributionId: "apple-git-155-arm64-xcode-26.6-17F113",
  environmentProfiles: SUPPORTED_GIT_ENVIRONMENT_PROFILES,
  ioProfiles: SUPPORTED_GIT_IO_PROFILES,
  phaseBudgets: Object.freeze([
    { id: "distribution_probe", wallDeadlineMs: 30_000 },
    { id: "config_candidate", wallDeadlineMs: 30_000 },
    { id: "source_build", wallDeadlineMs: 1_800_000 },
    { id: "push", wallDeadlineMs: 600_000 },
  ]),
  nodes: SUPPORTED_GIT_NODES,
  edges: SUPPORTED_GIT_EDGES,
});
```

Populate every literal identity/value from Spec 1 §4.2. Validate the static template once and validate every concrete expanded table before use; hash canonical domain-separated bytes. Do not call `spawn` in this task.

- [ ] **Step 4: Run process-table and Security index tests**

Run: `npx vitest run --root packages/security src/git/process-table.test.ts src/index.test.ts`

Expected: PASS with exact-set and one-field mutation coverage.

- [ ] **Step 5: Commit Task 10**

```bash
git add packages/security/src/git/types.ts packages/security/src/git/process-table.ts packages/security/src/git/process-table.test.ts packages/security/src/git/index.ts packages/security/src/index.ts packages/security/src/index.test.ts
git add docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md docs/superpowers/ORDER.md
git commit -m "feat(security): pin the Git process graph"
```

### Task 11: Enforce Git process permits, counted streams, and one inherited deadline

**Files:**
- Create: `packages/security/src/git/supervisor.ts`
- Create: `packages/security/src/git/supervisor.test.ts`
- Modify: `packages/security/src/git/index.ts`
- Modify: `packages/security/src/process.ts`
- Modify: `packages/security/src/process.test.ts`

**Interfaces:**
- Consumes: Task 10 concrete process table and existing `NodeProcessRunner` primitives.
- Produces: `GitExecGatewayV1`, `GitProcessSupervisor`, one-shot `GitProcessPermit`, counted stream proxies, `GitPushPhase`, exact process-group termination/reaping evidence.

- [ ] **Step 1: Write failing process-authority and deadline tests**

```ts
it("consumes a permit once and rejects wrong parent/order/argv", async () => {
  const permit = supervisor.issue(expectedNode);
  await supervisor.run(permit, expectedRequest);
  await expect(supervisor.run(permit, expectedRequest)).rejects.toThrow("permit_consumed");
  await expect(supervisor.run(supervisor.issue(expectedNode), wrongArgv)).rejects.toThrow("argv_mismatch");
});

it("does not reset the top-level 600-second phase in descendants", async () => {
  const phase = fixture.phaseAt(599_900);
  await expect(runChildAfter(phase, 101)).rejects.toThrow("phase_deadline_exceeded");
  expect(fixture.spawnCountAfterDeadline).toBe(0);
});
```

Cover same-version wrong binary, unsupported distribution, unknown child, wrong parent/order/argv/env/cwd/stdin, counted-proxy byte/hash/EOF mismatch, idle/wall/phase overrun, SIGTERM→100ms→SIGKILL of the whole group, complete reap, capture/redaction failure, and a fresh later `push_pending` invocation only after persisted-plan rechecks.

- [ ] **Step 2: Run supervisor/process tests and verify authority tests fail**

Run: `npx vitest run --root packages/security src/git/supervisor.test.ts src/process.test.ts`

Expected: FAIL because permit-bound supervision and inherited phases do not exist.

- [ ] **Step 3: Implement capability-based supervision without widening generic processes**

```ts
export class GitProcessSupervisor {
  beginPushPhase(now: number): GitPushPhase;
  issue(node: GitProcessNodeV1, phase: GitPushPhase): GitProcessPermit;
  run(permit: GitProcessPermit, request: GitConcreteProcessRequest): Promise<GitProcessEvidenceV1>;
}
```

Keep `NodeProcessRunner`'s existing public behavior. Add injected low-level spawn/clock/kill/reap hooks used only by the Git supervisor. Expand semantic slots to exact argv before issuing one-shot permits, require the current process-tree parent edge, stream through counted/hash-bound proxies, and discard raw/redacted output unless the node's typed result requires a bounded parsed field.

- [ ] **Step 4: Run Git supervisor and existing process tests**

Run: `npx vitest run --root packages/security src/git/supervisor.test.ts src/process.test.ts`

Expected: PASS with all generic process behavior unchanged.

- [ ] **Step 5: Commit Task 11**

```bash
git add packages/security/src/git/supervisor.ts packages/security/src/git/supervisor.test.ts packages/security/src/git/index.ts packages/security/src/process.ts packages/security/src/process.test.ts
git add docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md docs/superpowers/ORDER.md
git commit -m "feat(security): supervise the closed Git process graph"
```

### Task 12: Build sanitized Git shadows and no-shell helper gateways

**Files:**
- Create: `packages/security/src/git/shadow.ts`
- Create: `packages/security/src/git/gateways.ts`
- Create: `packages/security/src/git/shadow.test.ts`
- Create: `packages/security/src/git/gateways.test.ts`
- Modify: `packages/security/src/git/index.ts`

**Interfaces:**
- Consumes: Tasks 10–11 table/supervisor and Core Git plan hashes/path types.
- Produces: `SanitizedGitEnvironmentV1`; `SanitizedGitShadowConfigV1`; `SanitizedGitShadowConfigTemplateV1`; `SanitizedGitShadowConfigBytesV1`; `SanitizedGitShadowV1`; `SanitizedBareDestinationShadowV1`; `SanitizedSshBridgeV1`; `SanitizedLocalRemoteHelperV1`; fixed dispatcher/trampoline entrypoints.

- [ ] **Step 1: Write failing shadow-byte and hostile-config tests**

```ts
it("renders one domain-bound config template to exact bytes", () => {
  const concrete = instantiateShadowConfig(template, slots);
  expect(hashShadowConfig(concrete.bytes)).toBe(template.expectedConcreteHash);
  expect(concrete.bytes).toContain("http.followRedirects=false\n");
});

it.each(hostileGitConfigurations)("executes no hostile extension: $name", async ({ fixture }) => {
  await runPlannedGateway(fixture);
  expect(fixture.hostileExecutions).toEqual([]);
});
```

Cover control/line-break path refusal, quote/backslash rendering, environment exactness including `GIT_SSH_VARIANT=ssh`, `GIT_CONFIG_NOSYSTEM`, counted config entries, no ambient proxy/helper/hooks/maintenance, SSH `-G` probe absence, redirect second-request absence, local helper fixed destination shadow, no `/bin/sh`, and path-slot template re-instantiation after restart.

- [ ] **Step 2: Run shadow/gateway tests and verify missing implementations fail**

Run: `npx vitest run --root packages/security src/git/shadow.test.ts src/git/gateways.test.ts`

Expected: FAIL because sanitized shadow and helper gateway modules are absent.

- [ ] **Step 3: Implement canonical shadow rendering and fixed helper entrypoints**

```ts
export function instantiateShadowConfig(
  template: SanitizedGitShadowConfigTemplateV1,
  slots: SanitizedGitShadowSlotsV1,
): SanitizedGitShadowV1;

export function runGitGateway(
  invocation: GitGatewayInvocationV1,
  capability: GitProcessPermit,
): Promise<GitGatewayOutcomeV1>;
```

Render only the spec's fixed key order and Git C-quoting rules. The dispatcher identifies a pre-issued semantic permit, never pattern-matches arbitrary argv. SSH accepts only the normalized target and fixed system client; local receive passes only the stripped opaque token, supervisor capability, and private bare shadow. All helper processes inherit the same push phase.

- [ ] **Step 4: Run shadow/gateway tests**

Run: `npx vitest run --root packages/security src/git/shadow.test.ts src/git/gateways.test.ts`

Expected: PASS with hostile configuration and restart-template fixtures.

- [ ] **Step 5: Commit Task 12**

```bash
git add packages/security/src/git/shadow.ts packages/security/src/git/gateways.ts packages/security/src/git/shadow.test.ts packages/security/src/git/gateways.test.ts packages/security/src/git/index.ts
git add docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md docs/superpowers/ORDER.md
git commit -m "feat(security): isolate Git with sanitized shadows"
```

### Task 13: Validate private receive packs and bounded SHA-1 closure before intent

**Files:**
- Create: `packages/security/src/git/pack-reader.ts`
- Create: `packages/security/src/git/pack-reader.test.ts`
- Modify: `packages/security/src/git/index.ts`
- Create: `tests/integration/git/local-receive.test.ts`

**Interfaces:**
- Consumes: Tasks 8–12 metadata/budget/process/shadow interfaces and a private quarantine directory.
- Produces: guarded SHA-1 pack/index/object/ref parser, `GitPackClosureEvidenceV1`, exact local `receive-pack` pre-intent preparation, no-pack up-to-date arm.

- [ ] **Step 1: Write failing pack budget, closure, and helper-tree tests**

```ts
it.each(packBudgetBoundaries)("refuses first-over-limit $name", async ({ fixture, reason }) => {
  await expect(reader.validate(fixture)).rejects.toThrow(reason);
  expect(await fixture.quarantineExists()).toBe(false);
  expect(fixture.coordinatorIntentCount).toBe(0);
});

it("accepts the exact up-to-date target without pack/index children", async () => {
  const result = await receive.prepare(upToDateFixture);
  expect(result.destinationTransitions).toEqual([]);
  expect(result.processNodes).toEqual(["receive-pack"]);
});
```

Exercise zero/nonzero pack object counts, malformed/truncated/duplicate/extra/wrong-OID targets, unequal header/admitted/distinct-closure counts, 200,001/200,002 objects, first-over-limit compressed/object/aggregate/delta-depth/delta-work/instruction/RAM/temp/deadline cases, hostile receive hooks/proc-receive/maintenance, and missing required closure nodes.

- [ ] **Step 2: Run pack-reader/local-receive tests and verify missing reader fails**

Run: `npx vitest run --root packages/security src/git/pack-reader.test.ts`

Run: `npx vitest run --root tests integration/git/local-receive.test.ts`

Expected: FAIL because the guarded reader and local receive preparation are absent.

- [ ] **Step 3: Implement streaming pack/index/ref validation and private receive**

```ts
export class GuardedSha1PackReader {
  validate(request: GitPackReadRequestV1, budget: GitPackReaderBudgetV1): Promise<GitPackClosureEvidenceV1>;
}
```

Count compressed bytes before buffering, stream object inflation, cap resident memory, spill only to the private bounded temp root, track delta depth/work/instructions, and require every reachable object exactly once in the distinct closure. Local receive uses the fixed helper graph and generated `receive.unpackLimit=0`; it produces immutable destination closure evidence before coordinator intent and destroys quarantine on every refusal.

- [ ] **Step 4: Run pack-reader and local-receive tests**

Run: `npx vitest run --root packages/security src/git/pack-reader.test.ts`

Run: `npx vitest run --root tests integration/git/local-receive.test.ts`

Expected: PASS with no real destination mutation and no leaked quarantine.

- [ ] **Step 5: Commit Task 13**

```bash
git add packages/security/src/git/pack-reader.ts packages/security/src/git/pack-reader.test.ts packages/security/src/git/index.ts tests/integration/git/local-receive.test.ts
git add docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md docs/superpowers/ORDER.md
git commit -m "feat(security): validate bounded Git pack closure"
```

### Task 14: Apply and recover no-replace Git object/index/reflog/ref effects

**Files:**
- Create: `packages/core/src/git/effects.ts`
- Create: `packages/core/src/git/effects.test.ts`
- Modify: `packages/core/src/git/index.ts`

**Interfaces:**
- Consumes: Task 9 exact transitions, Task 7 participant adapter contract, injected guarded Git filesystem.
- Produces: `GitEffectPlanV1`, `GitEffectJournalV1`, `GitEffectEvidenceV1`, `GitEffectExecutor`, forward/reverse observation tables, relinquished-created-object outcomes.

- [ ] **Step 1: Write failing publication, compensation, and collision tests**

```ts
it("publishes in objects-index-reflogs-ref order", async () => {
  await executor.apply(validEffect);
  expect(fixture.publications).toEqual(["objects", "index", "reflogs", "ref"]);
});

it("restores ref before reflogs and never deletes a relinquished object", async () => {
  await executor.compensate(effectWithConcurrentRef);
  expect(fixture.compensations.slice(0, 2)).toEqual(["ref", "reflogs"]);
  expect(fixture.observation).toBe("relinquished_created_object");
  expect(await fixture.objectExists()).toBe(true);
});
```

Cover absent, identical-reusable, conflicting, mixed, and between-publication collisions for loose objects and destination pack/index pairs; late identical `EEXIST`; source `.git` publication survival; every reflog/ref CAS and third state; journal feasibility through 16 MiB; command-before-observation crashes; and terminal compaction that never unlinks published objects.

- [ ] **Step 2: Run Git effect tests and verify executor is absent**

Run: `npx vitest run --root packages/core src/git/effects.test.ts`

Expected: FAIL because `GitEffectExecutor` is not implemented.

- [ ] **Step 3: Implement table-driven Git effects and recovery**

```ts
export class GitEffectExecutor implements LifecycleParticipantAdapter {
  apply(step: LifecycleCoordinatorStepV1): Promise<LifecycleParticipantEvidenceV1>;
  observe(step: LifecycleCoordinatorStepV1): Promise<LifecycleParticipantObservationV1>;
  compensate(step: LifecycleCoordinatorStepV1): Promise<LifecycleParticipantEvidenceV1>;
  compact(step: LifecycleCoordinatorStepV1): Promise<void>;
}
```

Persist a plan-bound journal before the first destination mutation. Publish with no-replace primitives and exact identity/hash checks. Use directional preimage/live/postimage tables on recovery. Restore refs before reflogs, then index/control state; preserve created objects, packs, indexes, and `.git` roots whenever ownership was relinquished or a third state appears.

- [ ] **Step 4: Run Git effect tests**

Run: `npx vitest run --root packages/core src/git/effects.test.ts`

Expected: PASS for every forward/reverse crash row and collision arm.

- [ ] **Step 5: Commit Task 14**

```bash
git add packages/core/src/git/effects.ts packages/core/src/git/effects.test.ts packages/core/src/git/index.ts
git add docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md docs/superpowers/ORDER.md
git commit -m "feat(core): journal exact Git effects"
```

### Task 15: Orchestrate Git enable, disable, sync, and persisted push retry

**Files:**
- Create: `apps/cli/src/lifecycle/admission.ts`
- Create: `apps/cli/src/lifecycle/admission.test.ts`
- Create: `apps/cli/src/commands/git/index.ts`
- Create: `apps/cli/src/commands/git/service.ts`
- Create: `apps/cli/src/commands/git/index.test.ts`
- Create: `apps/cli/src/commands/git/service.test.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/main.test.ts`
- Modify: `apps/cli/src/commands/output-schemas.ts`
- Modify: `apps/cli/src/commands/output-schemas.test.ts`

**Interfaces:**
- Consumes: Core config/lifecycle/Git planner/effects, Security Git supervisor/shadows/pack reader, implemented Spec 2 `InstallationManifestV2` validator/store and manifest state participant, CLI context/Brain scope.
- Produces: `admitSpec1LifecycleInstallation`, strict `git enable|disable|status|sync`, `GitCommandResultV1`, exact `PersistedGitPushPlanV1`, exact `GitSyncPlanV1`, complete private `GitSyncExecutionDraft`, Security-aware Git push binder/codecs, `SyncRecordV1` lifecycle, internal Git-only instantiations/codecs for `LifecyclePlanPreviewCoreV1` and `LifecycleCoordinatorPlanCoreV1`.

- [ ] **Step 1: Write failing CLI grammar, preview/apply, and push-retry tests**

```ts
it("prints the same allocation-free enable preview twice", async () => {
  const first = await runGit(["enable", "--remote", remote], fixture);
  const second = await runGit(["enable", "--remote", remote], fixture);
  expect(first.stdout).toBe(second.stdout);
  expect(fixture.allocatedIds).toEqual([]);
  expect(fixture.stagingEntries).toEqual([]);
});

it("preserves the prior sync record when push fails", async () => {
  const result = await runGit(["sync"], rejectingRemoteFixture);
  expect(result.exitCode).not.toBe(0);
  expect(await rejectingRemoteFixture.readSyncRecord()).toEqual(previousSuccess);
  expect(await rejectingRemoteFixture.readPushPlan()).toEqual(expectedPendingPlan);
});

it("rejects an infeasible complete sync draft before reserving IDs", () => {
  const draft = completeGitSyncDraft(coreDraft, oversizedSecurityDraft);
  expect(() => assertGitSyncFeasible(draft)).toThrow("journal_too_large");
  expect(fixture.allocatorReservations).toBe(0);
});

it.each(incompleteV2Handoffs)("refuses incomplete V2 handoff $name before authority", async ({ fixture, code }) => {
  await expect(admitSpec1LifecycleInstallation(fixture)).rejects.toMatchObject({ code });
  expect(fixture.lifecycleAdapterConstructions).toBe(0);
});

it("publishes activation and manifest ownership before enabled config", async () => {
  await service.applyEnable(preview);
  expect(fixture.events).toEqual([
    "activation-record", "manifest-hash", "git-effect", "enabled-config",
  ]);
});
```

Cover the complete V2 nonce/allocator/three-ledger/runtime reservation set, owner/type/mode/link/hash/schema drift, retained V1 manifests, and nonce/allocator disagreement. Then cover exact options/positionals, preview revalidation drift, initialize/adopt refusal states, repository identity changes, scope changes producing `scope_reconcile_required` until matching `git enable --apply`, activation create/update/inactive arms with manifest hash transitions, forged/missing/drifted activation at every interrupted phase, enable-only `.git`, disable preserving repository/lifecycle identity, no-change baseline truth, local/HTTPS/SSH pushes, redirection refusal, failed push `retry_only`, no cumulative persisted clock, disabled/no-provenance zero process/network, and status without mutation.

- [ ] **Step 2: Run Git CLI/service tests and verify dispatch fails**

Run: `npx vitest run --root apps/cli src/commands/git/index.test.ts src/commands/git/service.test.ts src/main.test.ts src/commands/output-schemas.test.ts`

Expected: FAIL because Git dispatch/service/output arms are absent.

- [ ] **Step 3: Implement CLI composition and persisted retry state machine**

```ts
export interface GitService {
  previewEnable(request: GitEnableCliRequestV1): Promise<GitLifecyclePlanPreview>;
  applyEnable(preview: GitLifecyclePlanPreview): Promise<GitCommandResultV1>;
  previewDisable(): Promise<GitLifecyclePlanPreview>;
  applyDisable(preview: GitLifecyclePlanPreview): Promise<GitCommandResultV1>;
  status(): Promise<GitCommandResultV1>;
  sync(mode: "interactive" | "scheduled"): Promise<GitCommandResultV1>;
}

type GitLifecyclePlanPreview = LifecyclePlanPreviewCoreV1<
  { readonly subsystem: "git"; readonly enabledAfter: boolean; readonly lifecycle: GitSyncConfigV1 },
  GitPlanPreviewV1,
  never
>;

export type GitSyncPlanV1 = GitSyncPlanCoreV1<PersistedGitPushPlanV1>;

export function completeGitSyncDraft(
  core: GitSyncPlanningDraft,
  security: GitSecurityExecutionDraft,
): GitSyncExecutionDraft;
export function assertGitSyncFeasible(draft: GitSyncExecutionDraft): GitSyncFeasibility;
export function bindGitSyncExecution(
  draft: GitSyncExecutionDraft,
  ids: LifecycleIdReservation,
): GitSyncPlanV1;

export async function admitSpec1LifecycleInstallation(
  request: Spec1LifecycleAdmissionRequestV1,
): Promise<Spec1LifecycleInstallationV1>;
```

Use only Spec 2's exported V2 validator/store and guarded readers to require the exact handoff before constructing mutable lifecycle adapters; never migrate, repair, write, or reinterpret V1 here. Register command/subcommand-specific argv in the central parser. Define and strictly validate every `PersistedGitPushPlanV1` field from Spec 1 §4.4 here, after the Security distribution/process/shadow contracts exist, and instantiate Task 9's generic plan as the exact `GitSyncPlanV1` alias above. `completeGitSyncDraft` combines the Task 9 Core draft with exact Security environment/shadow/process-table/permit bindings and all still-unallocated ID/staging slots; that complete draft contains every `sourcePreconditions`, candidate commit/effect, process, journal, staging, destination, and persisted-push input. `assertGitSyncFeasible` runs before any ID reservation; only then may `bindGitSyncExecution` fill the allocated slots and recompute both effect hashes and the final push/Sync plans. No function binds execution from `GitPlanPreviewV1`. The internal Git-only lifecycle instantiation is structurally the exact Git arm, fixes `launchd: null`, and is not exported as the public `LifecyclePlanPreviewV1`; Task 21 composes that public alias and rewires this service after the platform leaf codecs exist. Preview performs bounded observation only and allocates nothing. Apply acquires the global lock, recomputes and hash-compares the preview, completes the execution draft, binds and persists the execution envelope through the Git leaf codecs, then invokes the coordinator only by its persisted ID. Enable/reconcile creates or updates the exact activation arm and its manifest hash before Git effects and publishes enabled config last; disable publishes the inactive arm plus manifest hash before clearing the flag. Sync finishes private allocation-free planning and the aggregate Core/Security feasibility proof before reservation and intent; the first post-allocation overflow consumes only the durable allocator gap before staging or intent. It persists its `previewHash: null` execution envelope before execution, writes the pending push plan before network, starts one fresh phase per top-level invocation, and writes `SyncRecordV1` only after exact push success or truthful no-change.

- [ ] **Step 4: Run Git CLI/service tests**

Run: `npx vitest run --root apps/cli src/commands/git/index.test.ts src/commands/git/service.test.ts src/main.test.ts src/commands/output-schemas.test.ts`

Expected: PASS with zero process/network calls in every disabled/refused pre-authority fixture.

- [ ] **Step 5: Commit Task 15**

```bash
git add apps/cli/src/lifecycle/admission.ts apps/cli/src/lifecycle/admission.test.ts apps/cli/src/commands/git/index.ts apps/cli/src/commands/git/service.ts apps/cli/src/commands/git/index.test.ts apps/cli/src/commands/git/service.test.ts apps/cli/src/main.ts apps/cli/src/main.test.ts apps/cli/src/commands/output-schemas.ts apps/cli/src/commands/output-schemas.test.ts
git add docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md docs/superpowers/ORDER.md
git commit -m "feat(cli): add opt-in Git lifecycle"
```

### Task 16: Define the closed job registry, schedules, generation, and canonical plist bytes

**Files:**
- Create: `packages/platform-macos/src/launchd/types.ts`
- Create: `packages/platform-macos/src/launchd/registry.ts`
- Create: `packages/platform-macos/src/launchd/plist.ts`
- Create: `packages/platform-macos/src/launchd/types.test.ts`
- Create: `packages/platform-macos/src/launchd/registry.test.ts`
- Create: `packages/platform-macos/src/launchd/plist.test.ts`
- Create: `packages/platform-macos/src/launchd/index.ts`
- Modify: `packages/platform-macos/src/index.ts`
- Create: `packages/platform-macos/src/index.test.ts`

**Interfaces:**
- Consumes: Core canonical types/hashes, `AutomationConfigV1`, guarded product home, effective UID.
- Produces: `LaunchdGuiDomainV1`; `LaunchdGenerationV1`; `LaunchdScheduledProductHomeV1`; `LaunchdGenerationProjectionV1`; `GeneratedLaunchdLabelV1`; `LaunchdObservedServiceTargetV1`; `LaunchdGeneratedServiceTargetV1`; `LaunchdCalendarIntervalV1`; `LaunchdPlistDictionaryV1`; `BoundedCanonicalPlistXmlV1`; `LaunchdPlanPreviewEntryV1`; `LaunchdPlanPreviewV1`; exact four-job registry, schedule parser, generation projection/label, and five-key plist encoder.

- [ ] **Step 1: Write failing registry, schedule, label, and XML fixtures**

```ts
it("enumerates exactly the four jobs in canonical order", () => {
  expect(LAUNCHD_JOBS.map((job) => job.id)).toEqual([
    "brain-reindex", "brain-lint", "doctor", "git-sync",
  ]);
});

it("serializes the exact five-key plist with one LF", () => {
  expect(encodeLaunchdPlist(plistFixture)).toBe(expectedPlistXml);
  expect(Object.keys(plistFixture)).toEqual([
    "Label", "ProgramArguments", "StartCalendarInterval", "StandardOutPath", "StandardErrorPath",
  ]);
});
```

Cover hourly/daily/weekly bounds and weekday mapping, duplicate/unknown schedules, first-enable completeness, later preserve/newly-eligible behavior, exact base labels/paths, custom product home in exact nine-argument scheduled argv, domain-separated generation hash, XML escape/order/LF/1-MiB boundary, literal `/dev/null`, ambient override exclusion, and exact-set non-emptiness.

- [ ] **Step 2: Run launchd registry/plist tests and verify modules are absent**

Run: `npx vitest run --root packages/platform-macos src/launchd/types.test.ts src/launchd/registry.test.ts src/launchd/plist.test.ts`

Expected: FAIL because the launchd modules do not exist.

- [ ] **Step 3: Implement pure registry, normalization, generation, and XML encoding**

```ts
export const LAUNCHD_JOBS: readonly LaunchdJobDefinitionV1[] = Object.freeze([
  BRAIN_REINDEX_JOB,
  BRAIN_LINT_JOB,
  DOCTOR_JOB,
  GIT_SYNC_JOB,
]);

export function buildLaunchdPlanPreview(request: LaunchdPreviewRequestV1): LaunchdPlanPreviewV1;
export function encodeLaunchdPlist(value: LaunchdPlistDictionaryV1): BoundedCanonicalPlistXmlV1;
```

Keep the job table closed and exhaustive. Parse schedule strings into tagged numeric records before planning; never retain input spellings. Derive every label, plist path, argv, and generation from the exact guarded product home/config/activation projection. The XML encoder emits only the approved dictionary/array/integer/string forms in fixed order.

- [ ] **Step 4: Run launchd registry/plist and platform index tests**

Run: `npx vitest run --root packages/platform-macos src/launchd/types.test.ts src/launchd/registry.test.ts src/launchd/plist.test.ts src/index.test.ts`

Expected: PASS for exact sets, canonical examples, and first-over-limit input.

- [ ] **Step 5: Commit Task 16**

```bash
git add packages/platform-macos/src/launchd/types.ts packages/platform-macos/src/launchd/registry.ts packages/platform-macos/src/launchd/plist.ts packages/platform-macos/src/launchd/types.test.ts packages/platform-macos/src/launchd/registry.test.ts packages/platform-macos/src/launchd/plist.test.ts packages/platform-macos/src/launchd/index.ts packages/platform-macos/src/index.ts packages/platform-macos/src/index.test.ts
git add docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md docs/superpowers/ORDER.md
git commit -m "feat(macos): define canonical launchd jobs"
```

### Task 17: Pin launchctl process rows and bounded domain/service observation

**Files:**
- Create: `packages/platform-macos/src/launchd/process-table.ts`
- Create: `packages/platform-macos/src/launchd/observe.ts`
- Create: `packages/platform-macos/src/launchd/process-table.test.ts`
- Create: `packages/platform-macos/src/launchd/observe.test.ts`
- Modify: `packages/platform-macos/src/launchd/index.ts`

**Interfaces:**
- Consumes: Task 16 targets/types, Security low-level process primitives, injected OS/executable identity and clock.
- Produces: `LaunchdProcessEnvironmentV1`; `LaunchdProcessDirectoryIdentityV1`; `LaunchdProcessIoProfileV1`; `LaunchdProcessArgvV1`; `LaunchdPreviewObservationProcessTableV1`; `SupportedLaunchdProcessTableTemplateV1`; `SupportedLaunchdProcessTableV1`; exact preview/mutation process tables; `LaunchdObserver`; domain/service probe results; live-state classifier; shared transition deadline and termination evidence.

- [ ] **Step 1: Write failing pinned-row and observation-state tests**

```ts
it("pins the approved 25F84 launchctl row", () => {
  expect(SUPPORTED_LAUNCHD_PROCESS_TABLE.id).toBe("launchctl-macos-26.5.2-25F84-fd3-v1");
  expect(SUPPORTED_LAUNCHD_PROCESS_TABLE.executable.sha256).toBe(
    "b1f2b90f349938cc4c3c9234f11cefd05545f7b4bfe9b1751ac01f1cb27d3714",
  );
});

it.each(liveObservationFixtures)("classifies $name only from queried target and exit", async ({ fixture, expected }) => {
  expect(await observer.observe(fixture.request)).toEqual(expected);
  expect(fixture.outputParserCalls).toBe(0);
  expect(fixture.outputHashCalls).toBe(0);
  expect(fixture.persistedRawOutput).toBeNull();
});
```

Cover exact OS/binary/root-owned empty-directory identity, at most 13 preview probes, domain exit 0, service exit 0/113, unloaded/exact-old/exact-new/unsuffixed collision/dual-generation/wrong-domain/truncated/over-limit/unobservable states, 4-MiB stdout/1-MiB stderr, 30-second idle/wall/shared observation deadline, 100-ms termination grace, process-group kill/reap, and zero mutation during preview.

- [ ] **Step 2: Run process-table/observation tests and verify missing rows fail**

Run: `npx vitest run --root packages/platform-macos src/launchd/process-table.test.ts src/launchd/observe.test.ts`

Expected: FAIL because the launchctl rows and observer do not exist.

- [ ] **Step 3: Implement exact process validation and typed observation**

```ts
export class LaunchdObserver {
  observe(request: LaunchdObservationRequestV1): Promise<LaunchdLiveStateV1>;
}
```

Verify the pinned OS/executable and root-owned `/private/var/empty` before each preview pass. Spawn only the two exact print argv alternatives with the exact environment and cwd. The literal queried target already identifies the candidate: byte-count stdout/stderr through the approved caps and discard them immediately without parsing, hashing, logging, or persistence. After a successful domain probe, classify each exact service target solely from exit 0 (present) or 113 (absent); every other exit, truncation/overflow, timeout, or process anomaly is unobservable/refused. Derive the typed loaded/unloaded/foreign-third-state result only from those per-target classifications and the plan-owned candidate set.

- [ ] **Step 4: Run launchd process/observation tests**

Run: `npx vitest run --root packages/platform-macos src/launchd/process-table.test.ts src/launchd/observe.test.ts`

Expected: PASS with exhaustive live-state rows.

- [ ] **Step 5: Commit Task 17**

```bash
git add packages/platform-macos/src/launchd/process-table.ts packages/platform-macos/src/launchd/observe.ts packages/platform-macos/src/launchd/process-table.test.ts packages/platform-macos/src/launchd/observe.test.ts packages/platform-macos/src/launchd/index.ts
git add docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md docs/superpowers/ORDER.md
git commit -m "feat(macos): observe launchd through pinned rows"
```

### Task 18: Bootstrap only an already-unlinked plist snapshot and restore descriptor baselines

**Files:**
- Create: `packages/platform-macos/src/launchd/snapshot.ts`
- Create: `packages/platform-macos/src/launchd/snapshot.test.ts`
- Modify: `packages/platform-macos/src/launchd/index.ts`
- Create: `tests/integration/launchd/fd3-bootstrap.test.ts`

**Interfaces:**
- Consumes: Task 17 mutation process row, guarded staging identities, plan-bound real plist identity/bytes.
- Produces: `LaunchdBootstrapPlistIdentityV1`; `LaunchdBootstrapSnapshotCreationV1`; `LaunchdBootstrapSnapshotAttemptV1`; `LaunchdSnapshotBootstrapper`; sole-child staging grammar; FD ownership/cleanup evidence.

- [ ] **Step 1: Write failing snapshot crash/race/FD tests**

```ts
it.each(snapshotFailurePoints)("recovers snapshot creation after $name", async ({ point }) => {
  const crashed = await interruptSnapshotAt(point);
  const recovered = await resumeSnapshot(crashed.fixture);
  expect(recovered.loadedBytesHash).toBe(expectedPlistHash);
  expect(await crashed.fixture.stagingChildren()).toEqual([]);
});

it("never inherits the real plist descriptor", async () => {
  await bootstrapper.bootstrap(request);
  expect(fixture.childInheritedFds).toEqual([3]);
  expect(fixture.fd3Identity).toEqual(fixture.unlinkedSnapshotIdentity);
  expect(fixture.fd3Identity).not.toEqual(fixture.realPlistIdentity);
});
```

Kill after linked create, every partial-prefix write, sync, open, immediately before/after unlink, and before spawn. Race rename/replace/in-place writes of the real plist after verification. Cover wrong frontier/preimage/path/role/effect/plan/transition/metadata, non-prefix/over-limit bytes, spawn refusal/timeout/success/reverse/recovery, child sole FD 3, parent source/snapshot close on all paths, and pre/post open-FD baseline equality.

- [ ] **Step 2: Run snapshot unit/integration tests and verify bootstrap fails**

Run: `npx vitest run --root packages/platform-macos src/launchd/snapshot.test.ts`

Run: `npx vitest run --root tests integration/launchd/fd3-bootstrap.test.ts`

Expected: FAIL because snapshot creation/recovery and certified FD3 bootstrap are absent. The integration test may execute only on the exact disposable pinned row and otherwise must report the typed unsupported-certification skip/refusal defined by the spec.

- [ ] **Step 3: Implement snapshot creation, unlink-before-spawn, and FD ownership**

```ts
export class LaunchdSnapshotBootstrapper {
  prepare(request: LaunchdSnapshotRequestV1): Promise<LaunchdBootstrapSnapshotAttemptV1>;
  bootstrap(attempt: LaunchdBootstrapSnapshotAttemptV1): Promise<LaunchdMutationEvidenceV1>;
  recover(creation: LaunchdBootstrapSnapshotCreationV1): Promise<LaunchdBootstrapSnapshotAttemptV1>;
}
```

Create exactly `staging.tmp/bootstrap-plist`, stream only the planned canonical bytes, sync/reopen/recheck, open the completed inode, unlink and sync before spawn, duplicate only that open description to child FD 3, close every real source descriptor in the parent, and execute `/bin/launchctl bootstrap gui/<uid> /dev/fd/3`. There is no pathname or linked fallback.

- [ ] **Step 4: Run snapshot tests**

Run: `npx vitest run --root packages/platform-macos src/launchd/snapshot.test.ts`

Run: `npx vitest run --root tests integration/launchd/fd3-bootstrap.test.ts`

Expected: PASS on injected fixtures; pinned certification either passes on the approved disposable host or produces its exact explicit unsupported result without fallback.

- [ ] **Step 5: Commit Task 18**

```bash
git add packages/platform-macos/src/launchd/snapshot.ts packages/platform-macos/src/launchd/snapshot.test.ts packages/platform-macos/src/launchd/index.ts tests/integration/launchd/fd3-bootstrap.test.ts
git add docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md docs/superpowers/ORDER.md
git commit -m "feat(macos): bootstrap launchd from unlinked snapshots"
```

### Task 19: Journal launchd replace/reconcile effects with command-before-observation recovery

**Files:**
- Create: `packages/platform-macos/src/launchd/effects.ts`
- Create: `packages/platform-macos/src/launchd/effects.test.ts`
- Modify: `packages/platform-macos/src/launchd/index.ts`
- Create: `tests/integration/launchd/reconcile.test.ts`

**Interfaces:**
- Consumes: Tasks 16–18 plan/observer/snapshot interfaces, Task 7 participant adapter, Foundation plist-file participant.
- Produces: `LaunchdPlanV1`, `LifecycleFileBindingV1`, `LaunchdEffectPlanV1`, `LaunchdEffectJournalV1`, `LaunchdEffectExecutor`, exact install/replace/keep/remove table and live-only reconcile `Q` transitions.

- [ ] **Step 1: Write failing exhaustive forward/reverse table tests**

```ts
it.each(launchdTransitionRows)("recovers $name at every cursor", async ({ row }) => {
  const interrupted = await interruptEachCursor(row);
  for (const state of interrupted) {
    expect(await recoverLaunchd(state.fixture)).toEqual(state.expected);
  }
});

it("unloads old generation before plist mutation and loads new after verification", async () => {
  await executor.apply(replacePlan);
  expect(fixture.events).toEqual(["bootout-old", "foundation-plist", "verify-new-plist", "snapshot-bootstrap-new"]);
});
```

Cover install/replace/keep/remove combinations, exact-old/new/absent live/file states, every command-before-observation crash, dual/collision/unobservable third states, live-only `Q` with no Foundation/manifest mutation, root/home/tmp identity and entry-empty grammar, sole current-frontier snapshot prefix exception, 30-second shared transition deadline, journal feasibility, compensation, and unknown/nonempty staging preservation.

- [ ] **Step 2: Run effect/reconcile tests and verify executor is absent**

Run: `npx vitest run --root packages/platform-macos src/launchd/effects.test.ts`

Run: `npx vitest run --root tests integration/launchd/reconcile.test.ts`

Expected: FAIL because `LaunchdEffectExecutor` and the transition table are absent.

- [ ] **Step 3: Implement table-driven launchd effects and recovery**

```ts
export class LaunchdEffectExecutor implements LifecycleParticipantAdapter {
  apply(step: LifecycleCoordinatorStepV1): Promise<LifecycleParticipantEvidenceV1>;
  observe(step: LifecycleCoordinatorStepV1): Promise<LifecycleParticipantObservationV1>;
  compensate(step: LifecycleCoordinatorStepV1): Promise<LifecycleParticipantEvidenceV1>;
  compact(step: LifecycleCoordinatorStepV1): Promise<void>;
}
```

Persist directional intent before each `bootout`/bootstrap. Observe exact domain/service state after every command before cursor advance. Couple plist file bindings to the Foundation participant; unload affected old generations before file mutation and snapshot-bootstrap only verified planned new bytes. Reconcile-only rows execute only zero or more `Q` transitions.

- [ ] **Step 4: Run launchd effect/reconcile tests**

Run: `npx vitest run --root packages/platform-macos src/launchd/effects.test.ts`

Run: `npx vitest run --root tests integration/launchd/reconcile.test.ts`

Expected: PASS for every exhaustive transition and crash cursor.

- [ ] **Step 5: Commit Task 19**

```bash
git add packages/platform-macos/src/launchd/effects.ts packages/platform-macos/src/launchd/effects.test.ts packages/platform-macos/src/launchd/index.ts tests/integration/launchd/reconcile.test.ts
git add docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md docs/superpowers/ORDER.md
git commit -m "feat(macos): journal launchd reconciliation"
```

### Task 20: Persist bounded automation runtime records and enforce lifetime leases

**Files:**
- Create: `apps/cli/src/lifecycle/runtime-records.ts`
- Create: `apps/cli/src/lifecycle/runtime-records.test.ts`
- Create: `apps/cli/src/commands/automation/runner.ts`
- Create: `apps/cli/src/commands/automation/runner.test.ts`

**Interfaces:**
- Consumes: Core lifecycle closure/config/activation, platform launchd generation, existing Brain command services, Task 15 scheduled Git sync, injected clock/redactor/lease/global lock.
- Produces: `AutomationRunnerLeaseV1`, `AutomationStatusRecordV1`, `AutomationLogRecordV1`, bounded rotating record writer, two-stage installed-generation admission, internal scheduled runner.

- [ ] **Step 1: Write failing lease/admission/inert/log tests**

```ts
it("acquires the lifetime lease before waiting for the global lock", async () => {
  await runner.run(request);
  expect(fixture.lockEvents.slice(0, 2)).toEqual(["lease-acquired", "global-wait"]);
});

it.each(["automation_disabled", "git_disabled"])("records only inert %s", async (outcome) => {
  await runner.run(fixture.forInertOutcome(outcome));
  expect(fixture.handlerCalls).toEqual([]);
  expect(fixture.brainResolutions).toEqual([]);
  expect(fixture.networkCalls).toEqual([]);
  expect(await fixture.readStatus()).toMatchObject({ outcome, startedAt: null, reasonCode: outcome });
});
```

Cover lease absent/replaced/busy, marker checks before/after lease, ten-minute global wait and final nonblocking acquire, stage-1 installed manifest/plist/generation authentication independent of active provenance, clear/retry-only/non-clear closure, post-handler recheck, unowned no-status branch, redaction-before-encoding, 1-MiB logs, ten rotations, eleventh discard, 64-KiB statuses, and terminal Foundation transaction compaction after thousands of writes.

- [ ] **Step 2: Run runtime-record/runner tests and verify missing modules fail**

Run: `npx vitest run --root apps/cli src/lifecycle/runtime-records.test.ts src/commands/automation/runner.test.ts`

Expected: FAIL because record storage and the runner do not exist.

- [ ] **Step 3: Implement bounded records and two-stage runner admission**

```ts
export class AutomationRunner {
  run(request: ScheduledRunRequestV1): Promise<ScheduledRunOutcomeV1>;
}

export class AutomationRuntimeRecordStore {
  writeStatus(record: AutomationStatusRecordV1, lease: AutomationRunnerLease): Promise<void>;
  writeLog(record: AutomationLogRecordV1, lease: AutomationRunnerLease): Promise<void>;
}
```

Parse and guard the hidden product-home/generation/job argv before normal CLI context resolution. Open only the pre-created lease path, lock it before any global wait, recheck marker/path identity, and hold through every exit. Authenticate installation evidence first; under global lock select handler versus inert outcome. Redact handler data before record construction and write records through compacted Foundation transactions while the same lease serializes the job.

- [ ] **Step 4: Run automation runner/runtime-record tests**

Run: `npx vitest run --root apps/cli src/lifecycle/runtime-records.test.ts src/commands/automation/runner.test.ts`

Expected: PASS with zero downstream authority in every inert/unowned/non-clear branch.

- [ ] **Step 5: Commit Task 20**

```bash
git add apps/cli/src/lifecycle/runtime-records.ts apps/cli/src/lifecycle/runtime-records.test.ts apps/cli/src/commands/automation/runner.ts apps/cli/src/commands/automation/runner.test.ts
git add docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md docs/superpowers/ORDER.md
git commit -m "feat(cli): add bounded scheduled runner state"
```

### Task 22: Add automation enable, disable, status, and the hidden scheduled runner grammar

**Files:**
- Create: `apps/cli/src/commands/automation/index.ts`
- Create: `apps/cli/src/commands/automation/service.ts`
- Create: `apps/cli/src/commands/automation/index.test.ts`
- Create: `apps/cli/src/commands/automation/service.test.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/main.test.ts`
- Modify: `apps/cli/src/commands/output-schemas.ts`
- Modify: `apps/cli/src/commands/output-schemas.test.ts`

**Interfaces:**
- Consumes: Tasks 16–21 launchd/runtime/coordinator composition and Core config/activation/manifest contracts.
- Produces: `AutomationCommandResultV1`, strict public `automation enable|disable|status`, exact hidden `automation run <job> --scheduled --product-home <home> --generation <generation>` dispatch.

- [ ] **Step 1: Write failing public/hidden argv and reconcile tests**

```ts
it("requires every eligible schedule on first enable", async () => {
  const result = await runAutomation(["enable", "--schedule", "brain-reindex=daily@02:00"], fixture);
  expect(result.exitCode).toBe(EXIT_CODES.invalidInput);
  expect(fixture.allocatedIds).toEqual([]);
});

it("accepts the exact nine ProgramArguments only in scheduled mode", async () => {
  const result = await runMain([
    "automation", "run", "doctor", "--scheduled", "--product-home", productHome,
    "--generation", generation,
  ], fixture);
  expect(result.exitCode).toBe(0);
  expect(fixture.contextProductHome).toBe(productHome);
});

it("publishes automation activation and manifest hash before plist effects", async () => {
  await service.applyEnable(preview);
  expect(fixture.events).toEqual([
    "activation-record", "manifest-hash", "launchd-effects", "enabled-config",
  ]);
});
```

Cover repeatable schedule parsing, duplicates/unknown/default-time absence, allocation-free deterministic previews, apply revalidation, activation create/update/inactive arms and matching manifest hash transitions, forged/missing/drifted activation at every interrupted phase, full eligible-set reconcile, later preserve/newly eligible Git, disable plist removal with runtime reservations retained, stale status, interactive hidden-option refusal, ambient home/Brain override ignorance, and all four exhaustive handlers with `maySpawnVendor: false`.

- [ ] **Step 2: Run automation CLI/service tests and verify dispatch fails**

Run: `npx vitest run --root apps/cli src/commands/automation/index.test.ts src/commands/automation/service.test.ts src/main.test.ts src/commands/output-schemas.test.ts`

Expected: FAIL because automation dispatch/service/output arms are absent.

- [ ] **Step 3: Implement public preview/apply/status and early scheduled bootstrap**

```ts
export interface AutomationService {
  previewEnable(schedules: readonly string[]): Promise<LifecyclePlanPreviewV1>;
  applyEnable(preview: LifecyclePlanPreviewV1): Promise<AutomationCommandResultV1>;
  previewDisable(): Promise<LifecyclePlanPreviewV1>;
  applyDisable(preview: LifecyclePlanPreviewV1): Promise<AutomationCommandResultV1>;
  status(): Promise<AutomationCommandResultV1>;
}
```

Parse the hidden scheduled grammar before ordinary context creation, guard the supplied product home without following its leaf, then ignore ambient home overrides. Public plan/apply uses the same preview hash/revalidation/envelope path as Git: bind and persist the validated execution envelope, then invoke the coordinator only by its persisted ID. Enable/reconcile updates the automation activation arm and its manifest hash before launchd effects and publishes enabled config last; disable removes launchd/plist effects and publishes the inactive arm before clearing the flag. Reconcile all eligible jobs through one composite coordinator; never install one selected job independently.

- [ ] **Step 4: Run automation CLI/service tests**

Run: `npx vitest run --root apps/cli src/commands/automation/index.test.ts src/commands/automation/service.test.ts src/main.test.ts src/commands/output-schemas.test.ts`

Expected: PASS with exact public and hidden grammar coverage.

- [ ] **Step 5: Commit Task 22**

```bash
git add apps/cli/src/commands/automation/index.ts apps/cli/src/commands/automation/service.ts apps/cli/src/commands/automation/index.test.ts apps/cli/src/commands/automation/service.test.ts apps/cli/src/main.ts apps/cli/src/main.test.ts apps/cli/src/commands/output-schemas.ts apps/cli/src/commands/output-schemas.test.ts
git add docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md docs/superpowers/ORDER.md
git commit -m "feat(cli): add scheduled automation lifecycle"
```

### Task 24: Prove the complete opt-in lifecycle and update canonical documentation

**Files:**
- Create: `tests/integration/git/lifecycle.test.ts`
- Create: `tests/integration/launchd/lifecycle.test.ts`
- Create: `tests/e2e/opt-in-surfaces.test.ts`
- Modify: `tests/security/network.test.ts`
- Modify: `tests/repository/check.ts`
- Modify: `tests/repository/check.test.ts`
- Modify: `docs/architecture/foundation.md`
- Modify: `docs/architecture/foundation-constraints.md`
- Modify: `docs/architecture/threat-model.md`
- Modify: `docs/superpowers/BACKLOG.md`
- Modify: `docs/superpowers/plans/2026-07-21-developer-os-program.md`
- Modify: `docs/superpowers/ORDER.md`
- Delete on checkpoint closure: `docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md`

**Interfaces:**
- Consumes: Tasks 1–23 complete behavior and every Spec 1 §7 gate.
- Produces: synthetic end-to-end evidence, non-vacuous process/network/capability gates, surviving architecture decisions, checked program/ORDER state for the Spec 1 implementation checkpoint.

- [ ] **Step 1: Write failing end-to-end and repository gate tests**

```ts
it("keeps disabled opt-in surfaces inert end to end", async () => {
  const result = await runCliInTempHome(["status"], fixture);
  expect(result.exitCode).toBe(0);
  expect(fixture.gitProcesses).toEqual([]);
  expect(fixture.launchdProcesses).toEqual([]);
  expect(fixture.networkRequests).toEqual([]);
});

it("asserts every authority enumerator is non-empty per package", async () => {
  const report = await inspectOptInAuthoritySurfaces(repositoryRoot);
  expect(report.gitEntrypoints.length).toBeGreaterThan(0);
  expect(report.launchdEntrypoints.length).toBeGreaterThan(0);
  expect(report.scheduledEntrypoints.length).toBeGreaterThan(0);
});
```

Map every row in Spec 1 §7 to at least one named test. Include full enable→sync→automation→disable→uninstall flows, interrupted lifecycle phase forgeries, push failure/retry, live launchd table injection, bounded ledger repetition, concurrent config/repository/plist edits, exact ownership preservation, and no real credential/user repository/live launchd use.

- [ ] **Step 2: Run the new integration/e2e/repository tests and verify uncovered gates fail**

Run: `npx vitest run --root tests integration/git/lifecycle.test.ts integration/launchd/lifecycle.test.ts e2e/opt-in-surfaces.test.ts security/network.test.ts repository/check.test.ts`

Expected: FAIL until every new surface is registered and the complete lifecycle meets the Spec 1 gate matrix.

- [ ] **Step 3: Close only the evidence/documentation gaps exposed by Step 2**

Update repository enumerators with exact non-empty per-scope assertions. Carry every surviving Spec 1 invariant, residual, process row, recovery rule, ownership boundary, and public interface into the owning architecture/program documents. Mark the program-plan Spec 1 implementation evidence accurately; do not mark Spec 2 or the overall DOS-P7 checkpoint complete.

- [ ] **Step 4: Run focused integration gates and the full repository gate**

Run: `npx vitest run --root tests integration/git/lifecycle.test.ts integration/launchd/lifecycle.test.ts e2e/opt-in-surfaces.test.ts security/network.test.ts repository/check.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS for lint, all test projects, build, and `git diff --check`.

- [ ] **Step 5: Obtain final fresh-context review and handle every accepted finding**

Dispatch a reviewer who did not author Tasks 1–24 with the exact changed-file list and review-only/no-commit instructions. For each accepted finding, add a focused failing regression test, apply the smallest correction, rerun focused tests and `npm run check`, then request a new verdict. Continue until the reviewer returns `READY`.

- [ ] **Step 6: Carry decisions forward and remove completed working documents only at closure**

After every Task 24 gate and fresh review is green, verify architecture/program/ORDER contain all surviving decisions and inbound references, then delete this completed implementation plan in the same closure commit. Git history is the archive. Keep Spec 1 until the unchanged Task 7 checkpoint closes with Spec 2, and keep A11 current because the overall DOS-P7 checkpoint is not closed.

- [ ] **Step 7: Commit the verified Spec 1 implementation checkpoint**

Stage every exact changed path by name; never use `git add -A`, `git add .`, or a wildcard. Verify staged diff and status, then commit:

```bash
git add tests/integration/git/lifecycle.test.ts tests/integration/launchd/lifecycle.test.ts tests/e2e/opt-in-surfaces.test.ts tests/security/network.test.ts tests/repository/check.ts tests/repository/check.test.ts docs/architecture/foundation.md docs/architecture/foundation-constraints.md docs/architecture/threat-model.md docs/superpowers/BACKLOG.md docs/superpowers/plans/2026-07-21-developer-os-program.md docs/superpowers/ORDER.md docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md
git commit -m "feat: implement opt-in Git and automation lifecycle"
```

Create a topic branch/PR as required by `docs/superpowers/SESSION.md`, read `gh pr checks <number>`, and stop after reporting the commit, CI evidence, and the next A11 action: resume the already specified, approved, planned, and partially implemented Spec 2 after its prerequisite V2 handoff, finish its remaining release/update work, then close the unchanged DOS-P7 Task 7 checkpoint. Do not merge the PR.

## Spec Coverage Index (open tasks)

| Normative spec area | Owning open tasks |
|---|---|
| §1 inert opt-in, no-vendor/no-hidden-network invariants | Tasks 15, 20, 22, 24 |
| §2.1 Manifest V2 ownership/verification handoff | Task 15 admission |
| §2.2 strict config, canonical JSON, applied provenance | Tasks 15, 22 |
| §2.3 bootstrap/global/lease lock ordering | Task 20 |
| §2.4 ledger bounds, coordinator/effect journals, recovery/compaction | Tasks 14, 19 |
| §3 public and hidden command grammar | Tasks 15, 22 |
| §4 Git repository/transport/scope/plan/effect/push lifecycle | Tasks 8–15 |
| §5 registry/schedule/launchd/runner/log lifecycle | Tasks 16–20, 22 |
| §7 complete gate matrix and non-vacuous enumerators | Every focused task plus Task 24's row-by-row integration index |
