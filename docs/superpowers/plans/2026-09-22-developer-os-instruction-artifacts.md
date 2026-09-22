# Developer OS Managed Instruction Artifacts (A12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Tasks:** 29. Tasks 1 and 4 give the local build a working V2 `init` install source (D47, A12 Q1
option A, local only). Task 2 is the spec's vendor-observation precondition (§10.1). Task 3 scaffolds
the default-content gates. Tasks 5–21 are the A12 code. Tasks 22–26 are the founder-in-the-loop default content. Task 27 regenerates the checked-in
plugin trees from the finished defaults, Task 28 carries the architecture-note amendments, and
Task 29 closes the phase.

**Goal:** Install, drift-check, reconcile and uninstall every instruction artifact in
`docs/migration/instruction-inventory.md` §1–§3, §6 and §7's six research/diagram skills (44 gate
artifacts) on both vendors from a local unsigned build, with `doctor` naming each artifact as
`default` or `user`.

**Architecture:** Core gains the `instruction` manifest arms, the `marked-block` strategy, a pure
block grammar with its three-way merge table, the catalog/bounds schemas and an unsigned-local arm of
the release trust state. Each adapter gains a pure `renderInstructionTree` and V2-typed install and
uninstall proposals. The CLI admits an explicitly named local package directory as the release
(`init --local-release <dir>`), loads defaults from that admitted release and overrides from
`<P>/instructions/<vendor>/`, and runs one gated Foundation transaction per attach or detach through
`withLifecycleMutation`, followed by the unjournaled Codex registration step.

**Tech Stack:** TypeScript 5.9 strict ESM, Node.js ≥24.16 <25 built-ins, Vitest 4.1, the shipped
Foundation `TransactionExecutor`, `withLifecycleMutation` (`apps/cli/src/lifecycle/mutation-gate.ts`),
`AdmittedPackagedReleaseV1` (`apps/cli/src/update/packaged-release.ts`), the security runner
(`NodeProcessRunner`, argv arrays only).

**Spec:** `docs/superpowers/specs/2026-09-22-developer-os-instruction-artifacts-design.md`, approved
2026-09-22 (D47) with every recommended answer except Q1: Q1 = local unsigned build only
(`trust: "unsigned-local"`, explicit flag, `doctor` warns, `update` refuses, no release or signing
path); Q2 = re-running `init` reconciles; Q3 = the six §7 skills are in (44 artifacts). Wherever the
spec names "the launcher" or "a packaged release" as the install source, read "the local build".

**Roadmap:** Phase 5 of `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`.
Gate: all inventoried artifacts install, drift-check and uninstall on both vendors; `doctor` names
each as `default` or `user`. Backlog rows owned: A12, NEW-60, NEW-61, NEW-65.

---

## Founder decisions applied

- **D47 (2026-09-22).** Spec approved as above. The D44 lane applies to Phases 5–7: **per task,
  implementers write the tests but do not run vitest; the per-task gate is `npm run lint`** (it is
  `tsc -b`, `eslint` and the repository check, ~11 s — the build/typecheck step `security.md`'s
  fail-closed rule keeps). Every "run the test" step below reads "deferred to phase close (D47)".
  Fresh-context review, `npm run check`, every deferred suite, and the single push as one PR happen
  at Task 29.
- **D46 (2026-09-22).** Release signing keys are dropped. `LAUNCHER_OFFLINE_RELEASE_ROOTS` stays
  `[]`; release plan Task 11b stays parked; nothing here compiles a key or wires the FD 3 handoff.
- **D16.** Until Phase 8 a new build reaches the machine only by reinstalling; an override change
  reaches it by re-running `init` (Q2 option A).

## Global Constraints

- **Lane (D47).** Per task: write the tests the steps name, implement, run `npm run lint`, commit
  with exact-path staging. **Do not run `vitest`, `npm test`, `npm run test:*`, `npm run check`,
  `tests/integration`, `tests/e2e` or `tests/security`.** A step that says "Run … Expected: FAIL/PASS"
  is recorded as "deferred to phase close (D47)" and its command is kept verbatim for Task 29. A red
  `npm run lint` stops the task.
- **No push.** Commits are held locally in the task's worktree; the orchestrator cherry-picks them
  onto `development` and pushes once, at Task 29, as one branch and one PR (`development` has a
  mandatory `pull_request` rule; a bare push is refused, `GH013`).
- **Worktrees (D33).** One fresh implementer per task, in `../developer-os.worktrees/<task>` on
  branch `task/a12-<n>` from the current `development`. Implementers never edit `docs/superpowers/`,
  never push, never merge.
- **Founder stop points.** Any command that spends model credits, reaches a model or the network,
  needs a vendor login, or reads or writes the live `~/.claude`, `~/.codex`, `~/.developer-os` or a
  real Brain is **not an agent step**. It is marked **FOUNDER STOP** below and the task halts there
  and reports. Vendor CLIs may be run by an agent only with `HOME`, `CODEX_HOME` and
  `XDG_CONFIG_HOME` pointing into a fresh `mktemp -d` directory and `CLAUDE_CONFIG_DIR` unset.
- **Clean room (spec §3.3, `docs/migration/exclusion-policy.md`).** No agent reads the legacy shared-rules directory,
  the legacy vault, `~/.claude`, any frozen-source environment path (prefix in `tests/repository/self-containment.ts`) or the legacy runtime. The founder supplies
  each legacy artifact's text through an owner-controlled process. This repository is public.
- **Production reachability (D47 Q1).** `createProductionContext` keeps
  `bootstrap: { state: "unavailable_until_packaged_handoff" }` as its default. The bootstrap becomes
  `available` **only** when `init --local-release <dir>` names a package directory that
  `admitUnsignedLocalPackagedRelease` admits — never by fallback, never for another command. The
  installed bundle is **not launchable** in local mode (its `bin/developer-os` is a refusal stub); the
  founder runs the checkout's CLI (`node apps/cli/dist/bin.js …`). The launcher gains no admission
  arm; it only refuses an `unsigned-local` trust state (Task 1).
- **Package direction.** `core ← security ← platform-macos ← cli`; adapters import `core` and
  `workflow-schema`, never each other; Core imports no adapter and no CLI module. The block grammar
  lives in Core; rendering lives in the adapters.
- **Canonical bytes.** Every new persisted record (`codex-registration-v1`, the unsigned-local
  metadata documents) is exactly `encodeCanonicalJson(value)` and is read back with
  `decodeCanonicalJson`; never append a second LF.
- **Exit codes (spec §8, `EXIT_CODES` in `packages/core/src/result.ts`).**
  `instruction_source_invalid` 2 · `instruction_block_too_large` 2 · `instruction_catalog_invalid` 2 ·
  `instruction_path_not_importable` 2 · `instruction_target_occupied` 3 ·
  `instruction_block_conflict` 3 · `instruction_block_malformed` 3 · `adapter_unavailable` 4 ·
  `release_mismatch` 4 · `packaged_release_unavailable` 4 · `release_unsigned_local` 4 (Task 1) ·
  `instruction_target_symlinked` 5 · existing path guards 5 · `codex_registration_failed` 1. Every
  refusal writes nothing, names paths only, and never echoes file content outside the redacted diff.
- **Bounds (`InstructionBoundsV1`, spec §2.3, verbatim).** id `^[a-z0-9][a-z0-9-]{0,63}$`, not
  prefixed `developer-os-`, not equal to any workflow id under `workflows/`; relative segment
  `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`, depth ≤ 4; one file ≤ 256 KiB, UTF-8 without BOM or NUL, LF
  line endings; one artifact ≤ 64 files and ≤ 1 MiB; ≤ 128 artifacts and ≤ 8 MiB per vendor after
  override merge; `paths:` 1–32 globs, each ≤ 256 bytes; Codex block ≤ 64 KiB (lowered to Task 2's
  measured limit if smaller); `P` in a Claude `@` line absolute with every segment
  `^[A-Za-z0-9._-]+$`. Override files: opened no-follow, regular files and directories only, `nlink`
  1, owned by the effective uid.
- **Block grammar (spec §5.1, verbatim).**
  `<!-- developer-os:begin v1 -->` · `<!-- Managed by developer-os. Edits inside this block are refused; change <P>/instructions/<vendor>/ instead. -->` · content · `<!-- developer-os:end v1 -->`,
  each marker exactly once on its own LF-terminated line, begin before end.
- **Vendor homes.** `H` = the user home; `C` = `CODEX_HOME` from the CLI environment when absolute,
  else `H/.codex`, resolved once per command; `CLAUDE_CONFIG_DIR` is never followed (`doctor` warns).
- **Staging.** Stage exact paths only; never `git add -A`, `git add .`, or a wildcard. Confirm with
  `git diff --cached --name-only` before committing.
- **Citations gate.** `tests/repository/citations.test.ts` checks every `path:line` citation in
  tracked documents. Cite by symbol unless the line exists and stays in range.
- **Comments.** Add no code comment unless it records a non-obvious platform fact, a dated past bug,
  or a rejected alternative someone would otherwise restore.
- **Fixtures.** Synthetic only: temporary homes, `createCommandFixture(name, { bootstrapAvailable:
  true, instructions: … })`, injected runners. Every enumerating test asserts its expected set is
  non-empty first.
- **Slow files.** A test that performs a real fresh V2 `init` goes in a `*.v2.test.ts` file
  (`test:lifecycle`, CI job `lifecycle-v2`). Each such new file is listed in its task's **Files** and
  in Task 29's measurement list; `timeout-minutes` is recomputed once at Task 29, not per task.

## Verified at plan writing (base `13eb18e`)

```text
Inside a fence so the citations gate ignores it; line numbers drift, so each task re-locates by symbol.
apps/cli/src/context.ts            790  bootstrap: { state: "unavailable_until_packaged_handoff" }
apps/cli/src/context.ts            68   PRODUCT_VERSION = "0.0.0"  (every local rebuild has the same version)
apps/cli/src/commands/testing.ts   415  createSyntheticPackagedRelease (fixture-only release layout)
apps/cli/src/update/packaged-release.ts  admitRootVerifiedPackagedRelease / inspectPackagedRelease / sealed WeakMap
apps/cli/src/bootstrap/executor.ts 2158 trustValue → state/release-trust.json (schema id release-trust-state-v1)
packages/core/src/update/release.ts 457 validateReleaseTrustState (exact key set; read by apps/launcher/src/selection.ts)
apps/cli/src/commands/init.ts      300  settleExistingV2 (asserts no drift, writes nothing)
apps/cli/src/commands/doctor.ts    415  detectManagedDrift is V1-only; inspectDrift (V2) has no CLI caller
```

**Manifest rewrite by an ordinary gated transaction (spec §6.1, "the plan's first code task
confirms").** Read at plan writing: `ProtectedPathPolicy` (`packages/security/src/protected-paths.ts`)
has no manifest rule; `withLifecycleMutation` admits the home once before `work` and does not
re-admit after it; `packages/core/src/lifecycle/foundation-ledger.ts` does not special-case the
manifest path; `ManifestStore` already has a canonical V2 write path. Nothing found refuses a
`replace` of `paths.manifestFile` inside a gated standalone transaction. Task 8 pins this with a
`*.v2.test.ts` case; if that case fails at phase close, **stop the phase**: Tasks 16–19 must not be
rerouted through the lifecycle coordinator's `M(...)` arms without a founder decision.

## Scope decisions

1. **Local install source (Q1 A, D47).** A package directory produced by
   `npm run pack:local-release -- <out-dir>` is admitted by the CLI, not the launcher, with the same
   inventory and per-file hash sealing as `admitRootVerifiedPackagedRelease` and no signature chain.
   Its trust state is recorded as `trust: "unsigned-local"` in `state/release-trust.json`.
2. **The runtime source of the whole vendor tree is the admitted release.** Spec §6.1 step 2 renders
   the six workflow skills plus the instruction artifacts, and nothing installs either plugin today
   (NEW-60). So the package carries `workflows/**` as `bundle/workflows/` beside
   `bundle/instructions/`; Task 9 loads the workflow contracts through `release.readFile` and
   `loadWorkflow({ file, text })` (`packages/workflow-schema/src/load.ts`, which already validates
   from bytes), and Tasks 12–13 compose the full tree (plugin manifests, the six `developer-os-*`
   skills, the Codex marketplace) with `renderClaudePlugin` / `renderCodexInstallTree` plus the
   instruction render.
3. **Defaults live in `bundle/instructions/`** of the package (spec §3.1 "the release bundle carries
   `instructions/` verbatim"). Bootstrap therefore installs a hash-bound copy under the product home,
   which is what `doctor` reads the catalog from after install. The fixture's instruction tree is
   opt-in (`instructions:` option) so ordinary `*.v2.test.ts` files do not copy it.
4. **`release_mismatch`** compares the admitted release's `identity.version` with the manifest's
   `productVersion` **and** its `releaseIdentityHash` with `state/active-release.json`'s. Version
   alone never fires for a local build (`PRODUCT_VERSION` is fixed), and Q2 A says "refuses if that
   release is not the installed one".
5. **Reconcile requires `--local-release`.** Defaults are read only through
   `AdmittedPackagedReleaseV1.readFile` (§3.1), so `init` on an installed home without the flag
   refuses `packaged_release_unavailable` (exit 4) when an instruction step is needed; with nothing
   selected and nothing installed it behaves as today.
6. **Composition-root schema registry.** None exists yet (V2 drift has no CLI caller). Task 20
   creates `createManagedArtifactSchemaRegistry()` with every `ManagedArtifactSchemaIdV1`, including
   both release-trust arms and `codex-registration-v1`.
7. **Spec amendments** (§11 rows for the umbrella design, Spec 1, Spec 2, and Spec 2 §3's
   `unsigned-local` trust state) live under `docs/superpowers/` and are the orchestrator's, applied at
   Task 29. Architecture notes (`docs/architecture/*`) are Task 28's.
8. **Invariant 3 gate.** Categories whose Claude loading only the billed row can prove (expected:
   `rule`, `scoped-rule`, `output-style`) are held back by `UNPROVEN_CLAUDE_CATEGORIES` (Task 16).
   Emptying it is a founder decision recorded at Task 29 after Task 2 Step 3 passes. **The phase gate
   ("all inventoried artifacts install") cannot close until it is empty.**
9. **Transaction kinds are open strings** (`packages/core/src/transactions/types.ts` `kind: string`),
   so `"instructions"` and `"codex-registration"` need no Core change.
10. **Coverage and the L1 refusal.** The coverage set is the inventory rows minus `brain-search`
   minus rows whose inventory status is `refused`; if the founder refuses `react-best-practices`,
   44 becomes 43.

## File and Responsibility Map

| Area | Files | Responsibility |
|---|---|---|
| Unsigned-local trust | `packages/core/src/update/release.ts`, `apps/cli/src/update/packaged-release.ts`, `apps/launcher/src/selection.ts`, `apps/cli/src/bootstrap/executor.ts` (trust value only) | trust arm, admission, update/launcher refusal |
| Local build | `apps/cli/src/update/local-release.ts`, `tests/tools/pack-local-release.ts`, `package.json`, `apps/cli/src/{main,bin,context}.ts`, `apps/cli/src/commands/testing.ts` | package writer, `--local-release`, fixture reuse |
| Core manifest | `packages/core/src/manifest/{types,v2,drift,instruction-block,index}.ts` | arms, strategy, drift kind, block grammar, merge table, conflict evidence |
| Core instructions | `packages/core/src/instructions/{catalog,bounds,index}.ts` | `InstructionCatalogV1`, `InstructionBoundsV1`, id grammar |
| Core door | `packages/core/src/index.ts`, `packages/core/src/index.test.ts` | exact export list (union-merge) |
| Adapters | `packages/adapter-claude/src/{instructions,install,index}.ts`, `packages/adapter-codex/src/{instructions,agent-toml,install,index}.ts` | `renderInstructionTree`, V2 proposals |
| CLI instructions | `apps/cli/src/instructions/{vendor-homes,sources,attach,detach,codex-registration,apply}.ts` | loaders, planners, registration, the gated apply |
| CLI lifecycle | `apps/cli/src/bootstrap/admission.ts` and its six call sites, `apps/cli/src/lifecycle/{uninstall,schema-registry}.ts`, `apps/cli/src/commands/{init,uninstall,doctor}.ts` | authorization, detach-then-drain, reconcile, doctor |
| Defaults | `instructions/**`, `tests/repository/instruction-defaults.test.ts`, `tests/repository/instruction-hosts.json`, `tests/tools/scan-instruction-defaults.ts`, `tests/repository/instruction-coverage.test.ts` | content, redaction gates, coverage |
| Generated | `plugins/claude/**`, `plugins/codex/**`, `tests/tools/render-{claude,codex}.ts`, `tests/contracts/adapters/*/render-all.ts` | checked-in default render |
| Integration | `tests/integration/{claude,codex}/plugin-loads.test.ts`, `tests/integration/ingest/instruction-isolation.test.ts` | NEW-65 loading, D8 isolation |
| Notes | `docs/architecture/{claude-adapter,codex-adapter,threat-model}.md` | observations (Task 2) and amendments (Task 28) |

## Execution waves (D33)

Derived from each task's `Consumes:` line. A task starts only when every task it consumes is
integrated on `development`; the tasks of one wave run in parallel, each in its own worktree.

| Wave | Tasks | Waits for |
|---|---|---|
| 1 | 1, 2, 3 | nothing (Task 2 is the spec §10.1 precondition; Task 1 is D47's install source and Task 3 the content gates, neither encodes a vendor fact — spec §12.2 lets content start at once) |
| 2 | 4, 5, 6, 7 | 4: 1 · 5, 6: 2 · 7: 1 (shares `executor.ts`) |
| 3 | 8, 9 | 8: 5 · 9: 1, 4, 6 |
| 4 | 10, 11, 12, 13, 14 | 10: 5, 8 · 11: 8 · 12, 13: 2, 5, 6, 8 · 14: 2, 8 |
| 5 | 15, 16, 17 | 15: 12, 13 · 16: 8, 9, 10, 11, 12, 13 · 17: 8, 10, 11, 12, 13 |
| 6 | 18, 19, 20 | 18: 4, 14, 16, 17 · 19: 14, 17 · 20: 4, 6, 8, 9, 14 |
| 7 | 21, 27, 28 | 21: 15, 18 · 27: 15, 22–26 · 28: 18, 19, 20 |
| F | 22, 23, 24, 25, 26 | founder track: each waits for 3 and for the founder to supply its sources; may run alongside any wave |
| 8 | 29 | everything |

Shared files. `packages/core/src/index.ts` and the exact export list in `packages/core/src/index.test.ts`
are edited by Tasks 1, 5, 6, 8, 10: the integrator takes the union of added exports, keeps the list
in its existing order rule, and records the merge. No two tasks in one wave share any other file;
the hotspot files (`main.ts`, `context.ts`, `init.ts`, `doctor.ts`, `commands/uninstall.ts`,
`bootstrap/executor.ts`, `commands/testing.ts`) each appear at most once per wave.

---

### Task 1: Unsigned-local release trust and admission · M

Spec: D47 Q1 option A; §8 `packaged_release_unavailable`; §11 Spec 2 row (trust state
`unsigned-local`, orchestrator applies the text at Task 29).

**Files:**
- Modify: `packages/core/src/update/release.ts`, `packages/core/src/update/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`
- Test: `packages/core/src/update/release.test.ts`
- Modify: `apps/cli/src/update/packaged-release.ts`
- Test: `apps/cli/src/update/packaged-release.test.ts`
- Modify: `apps/cli/src/bootstrap/executor.ts` (the `trustValue` literal only)
- Modify: `packages/core/src/manifest/bootstrap.ts` only if its `release_trust` role validates the payload's key set (check; record the answer in the commit message)
- Modify: `apps/launcher/src/selection.ts`; Test: `apps/launcher/src/selection.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:

```ts
// packages/core/src/update/release.ts
export interface SignedReleaseTrustStateV1 { /* the current ReleaseTrustStateV1 keys, unchanged */ }
export type UnsignedLocalReleaseTrustStateV1 = SignedReleaseTrustStateV1 & { readonly trust: "unsigned-local" };
export type ReleaseTrustStateV1 = SignedReleaseTrustStateV1 | UnsignedLocalReleaseTrustStateV1;
export const UNSIGNED_LOCAL_RELEASE_KEY_ID: LowerHexSha256; // sha256("developer-os:unsigned-local-release-key:v1")
export class ReleaseUnsignedLocalError extends Error { readonly reason: "release_unsigned_local"; }
export function isUnsignedLocalTrust(state: ReleaseTrustStateV1): state is UnsignedLocalReleaseTrustStateV1;
// admitReleaseAgainstTrust(state, release, role): throws ReleaseUnsignedLocalError for roles
// "online_target" and "guarded_retained_rollback" when state is unsigned-local; advanceReleaseTrust
// throws it for any unsigned-local current state.

// apps/cli/src/update/packaged-release.ts
export type PackagedReleaseTrustV1 = "root-verified" | "unsigned-local";
export interface AdmittedPackagedReleaseV1 { /* existing fields */ readonly trust: PackagedReleaseTrustV1; }
export const UNSIGNED_LOCAL_LAYOUT: {
  readonly delegation: "metadata/release-key-delegation.json";
  readonly releaseIndex: "metadata/release-index.json";
  readonly bundleManifest: "metadata/bundle-manifest.json";
  readonly bundleRoot: "bundle";
};
export async function admitUnsignedLocalPackagedRelease(
  packageRoot: string, productVersion: string,
): Promise<PackagedReleaseSourceV1>;
```

The unsigned-local package contract (the writer is Task 4):
- `metadata/release-key-delegation.json` = canonical `{"schemaVersion":1,"trust":"unsigned-local"}`
- `metadata/release-index.json` = canonical `{"releaseSequence":"1","schemaVersion":1,"trust":"unsigned-local","version":"<v>"}`
- `metadata/bundle-manifest.json` = canonical `{"files":[{"bytes":n,"path":"<relative to bundle/>","sha256":"<hex>"},…],"schemaVersion":1,"trust":"unsigned-local"}`, sorted by UTF-8 path, listing exactly every file under `bundle/`
- Identity: `version`/`releaseSequence` from the index; `delegationSequence` and `releaseIndexSequence` `"1"`; the three document hashes are the sha256 of their bytes; `delegatedReleaseKeyId = UNSIGNED_LOCAL_RELEASE_KEY_ID`; `releaseIdentityHash = sha256("developer-os:unsigned-local-release-identity:v1\0" ‖ bundle-manifest bytes)`; `platform: "darwin"`; `architecture` = `process.arch` (`arm64`|`x64`, else refuse); both protocols `1`.

- [ ] **Step 1: Write the failing core tests**

```ts
it("admits the unsigned-local arm with exactly one extra key", () => {
  const state = { ...SIGNED_TRUST, trust: "unsigned-local" };
  expect(validateReleaseTrustState(state)).toStrictEqual(state);
  expect(() => validateReleaseTrustState({ ...state, trust: "signed" })).toThrow();
  expect(() => validateReleaseTrustState({ ...state, extra: 1 })).toThrow();
});

it("refuses an unsigned-local state as an update source or rollback target", () => {
  const state = validateReleaseTrustState({ ...SIGNED_TRUST, trust: "unsigned-local" });
  for (const role of ["online_target", "guarded_retained_rollback"] as const) {
    expect(() => admitReleaseAgainstTrust(state, RELEASE, role)).toThrow(ReleaseUnsignedLocalError);
  }
  expect(() => admitReleaseAgainstTrust(state, RELEASE, "guarded_active")).not.toThrow();
  expect(() => advanceReleaseTrust(state, ACCEPTED)).toThrow(ReleaseUnsignedLocalError);
});
```

Also: the signed arm's existing cases are unchanged; `UNSIGNED_LOCAL_RELEASE_KEY_ID` equals the
sha256 of the ASCII domain; the export list gains the four new names.

- [ ] **Step 2: Run them — deferred to phase close (D47)**

Run: `npx vitest run --root packages/core src/update/release.test.ts src/index.test.ts` · Expected: FAIL (missing exports).

- [ ] **Step 3: Implement the core arm**

`validateReleaseTrustState` accepts the signed key set, or the signed key set plus `trust` whose
only legal value is `"unsigned-local"`. `advanceReleaseTrust` and `admitReleaseAgainstTrust` call
`isUnsignedLocalTrust` first as specified above.

- [ ] **Step 4: Write the failing admission tests** (`packaged-release.test.ts`)

Build the package in a `mkdtemp` root inside the test (0700 directories, 0600 files, 0700 for
`bundle/bin/developer-os`). Cases: a valid package admits and `inspectPackagedRelease` returns
`trust: "unsigned-local"` and the derived identity above; each of these refuses with exit 5 — a
bundle file absent from the bundle manifest, a manifest row absent from `bundle/`, a changed sha256,
non-canonical document bytes, a document with an extra key, `trust` other than `"unsigned-local"`; a
version different from `productVersion` refuses exit 4 with message `release_mismatch`; a file
changed after admission refuses on `readFile` (existing sealing). `admitRootVerifiedPackagedRelease`
results report `trust: "root-verified"`.

- [ ] **Step 5: Run them — deferred to phase close (D47)**

Run: `npx vitest run --root apps/cli src/update/packaged-release.test.ts` · Expected: FAIL.

- [ ] **Step 6: Implement admission**

Reuse `inventory` and the sealed map; add `trust` to `SealedPackagedRelease` and the admitted
record; build the `RootVerifiedPackagedReleaseV1`-shaped handoff from the derived identity so
`validateSemanticBindings` runs unchanged, then check the bundle manifest against the inventory's
`bundle/` rows.

- [ ] **Step 7: Record the trust arm in bootstrap and refuse it in the launcher**

In `executor.ts`, `trustValue` gains `trust: "unsigned-local"` exactly when
`packaged.trust === "unsigned-local"`. In `apps/launcher/src/selection.ts`, after
`validateReleaseTrustState`, an unsigned-local state refuses the candidate (route to the same
refusal a missing trust root produces). Add the test to `selection.test.ts`:

```ts
it("never launches a home whose trust state is unsigned-local", async () => {
  const selection = await selectLauncherCandidate(withTrust({ ...SIGNED_TRUST, trust: "unsigned-local" }));
  expect(selection.kind).not.toBe("active");
});
```

- [ ] **Step 8: Gate and commit**

```bash
npm run lint
git add packages/core/src/update/release.ts packages/core/src/update/release.test.ts packages/core/src/update/index.ts packages/core/src/index.ts packages/core/src/index.test.ts apps/cli/src/update/packaged-release.ts apps/cli/src/update/packaged-release.test.ts apps/cli/src/bootstrap/executor.ts apps/launcher/src/selection.ts apps/launcher/src/selection.test.ts
git diff --cached --name-only
git commit -m "feat(release): admit an unsigned local build and record its trust downgrade"
```

(Add `packages/core/src/manifest/bootstrap.ts` to the `git add` line only if Step 7's check changed it.
At plan writing, `grep -rn highestDelegationSequence apps/cli/src/bootstrap packages/core/src/manifest`
finds one derivation site, `executor.ts`'s `trustValue`; the persisted plan carries the payload, and
`bootstrap.ts` checks only the `release_trust` role count. Re-run that grep; if a second site
re-derives the payload from `identity`, it must read `packaged.trust` too.)

### Task 2: Vendor observations (spec §10.1) · M

The precondition for every task that encodes a vendor fact. It writes no product code.

**Files:**
- Modify: `docs/architecture/claude-adapter.md` (new section "Observed for A12 against Claude Code 2.1.280 on <date>")
- Modify: `docs/architecture/codex-adapter.md` (new section "Observed for A12 against Codex CLI 0.155.1 on <date>")

**Interfaces:**
- Consumes: nothing.
- Produces: one table per vendor, one row per spec §4 row and per §10.1 bullet, each with the exact
  command, the isolating environment, and the output fragment that proves or disproves it. Later
  tasks copy exact values from here: **Codex agent TOML key set** (Task 13), **Codex `AGENTS.md`
  load limit** (Task 6's bound), **whether a skills-directory plugin loads `agents/` and `commands/`**
  (Task 12), **`rules/*.md` with and without `paths:`** (Task 12), **output-style discovery**
  (Task 12), **whether `plugin add` over a registered plugin refreshes the cache** (Task 14), **the
  ingest-isolation method** (Task 21).

- [ ] **Step 1: Confirm the pinned versions in an isolated home**

```bash
T=$(mktemp -d); env -u CLAUDE_CONFIG_DIR HOME="$T" CODEX_HOME="$T/.codex" XDG_CONFIG_HOME="$T/.config" claude --version
env -u CLAUDE_CONFIG_DIR HOME="$T" CODEX_HOME="$T/.codex" XDG_CONFIG_HOME="$T/.config" codex --version
```

Expected: `2.1.280` and `0.155.1`. A different version is a **FOUNDER STOP** (the adapter notes pin
these; re-pinning is a founder decision).

- [ ] **Step 2: Run the unbilled rows in the isolated home**

Hand-place a minimal tree in `$T` for each row (a rule file, a `paths:` rule, an output style, an
agent in the skills-dir plugin, a thin command, a Codex `agents/*.toml`, an `AGENTS.md` with the
§5.1 block, a skill), then run only local, unbilled commands: `claude plugin details developer-os`,
`claude plugin validate`, the `InstructionsLoaded` hook probe attached to `$T` (`claude-adapter.md`
§13), `codex debug prompt-input`, `codex plugin marketplace add|list`, `codex plugin add|list|remove
--json`. Record each command, its exit status and the proving fragment. Measure the `AGENTS.md`
size at which `prompt-input` stops including it (binary search on block size up to 64 KiB).
**FOUNDER STOP** if any command asks for a login, reaches the network or a model, or names a path
outside `$T` in its output; do not inspect the live `~/.claude` or `~/.codex` to check.

- [ ] **Step 3: FOUNDER STOP — billed real-agent row (spec §10.2 "real agent")**

For every mechanism Step 2 could not prove unbilled (expected: `rule`, `scoped-rule`,
`output-style` on Claude), the founder runs one Claude session in a disposable home proving the text
reached the model, and records it in the compatibility matrix. Until that row passes, the category
is not installed (invariant 3); Task 12 renders it but Task 16's `UNPROVEN_CLAUDE_CATEGORIES`
holds it back. Emptying that constant is a founder decision recorded at Task 29.

- [ ] **Step 4: Decide or stop**

If any §4 row's loading proof fails, the plan **stops for a founder decision**; it is never
downgraded to `unsupported-vendor`.

- [ ] **Step 5: Gate and commit**

```bash
npm run lint
git add docs/architecture/claude-adapter.md docs/architecture/codex-adapter.md
git diff --cached --name-only
git commit -m "docs(adapters): record the A12 loading observations"
```

### Task 3: Default-content gates and catalog scaffold · M

Spec §3.1 (catalog), §3.3 (gates), §10.2 "defaults are redacted", "coverage is exhaustive".

**Files:**
- Create: `instructions/catalog.json` (`{"artifacts":[],"schemaVersion":1}` plus LF — rows arrive with content)
- Create: `tests/repository/instruction-defaults.test.ts`
- Create: `tests/repository/instruction-hosts.json` (URL host allowlist, initially `[]`)
- Create: `tests/tools/scan-instruction-defaults.ts`, `tests/tools/scan-instruction-defaults.test.ts`
- Create: `tests/repository/instruction-coverage.test.ts`

**Interfaces:**
- Consumes: the product secret scanner exported by `@developer-os/security` (reuse; do not write a new one).
- Produces: `scanInstructionDefaults(root: string, extraPatterns: readonly RegExp[]): readonly { path: string; line: number; rule: string }[]` in `tests/tools/scan-instruction-defaults.ts`, CLI form `node tests/dist/tools/scan-instruction-defaults.js --patterns <file>`.

- [ ] **Step 1: Write the scanner tests**

```ts
it("reports path and line only, never the matched text", () => {
  const findings = scanFixture({ "rules/a.md": "ok\nmail me at someone@example.org\n" });
  expect(findings).toStrictEqual([{ path: "rules/a.md", line: 2, rule: "email" }]);
});
```

Rules: the security secret scanner; absolute home paths (`/Users/`, `/home/`); `~/` except
`~/.claude`, `~/.codex`, `~/.developer-os`; e-mail addresses; URLs whose host is not in
`instruction-hosts.json`; the frozen-source environment prefix (as in `tests/repository/self-containment.ts`); `docs/superpowers/plans/legacy-runtime/`. Each rule
has a positive and a negative case; an injected e-mail, home path and legacy-runtime path each fail.

- [ ] **Step 2: Write `instruction-defaults.test.ts` and `instruction-coverage.test.ts`**

`instruction-defaults.test.ts` asserts `scanInstructionDefaults("instructions", [])` is empty and
that the enumerated file set is non-empty once `catalog.json` lists a row (it lists the catalog
itself before then). `instruction-coverage.test.ts` asserts the catalog's `legacyName` set equals
the inventory §1–§3 names minus `brain-search` minus rows whose inventory status is `refused`, plus §7's six research/diagram skills, parsed from
`docs/migration/instruction-inventory.md`'s tables, and that every §6 row has a status. It is
**expected red until Tasks 22–26 land**; Task 27 is where it must be green.

- [ ] **Step 3: Run — deferred to phase close (D47)**

Run: `npx vitest run tests/repository/instruction-defaults.test.ts tests/repository/instruction-coverage.test.ts tests/tools/scan-instruction-defaults.test.ts`

- [ ] **Step 4: Implement the scanner tool** (bounded read per file, 256 KiB cap, LF split).

- [ ] **Step 5: Gate and commit**

```bash
npm run lint
git add instructions/catalog.json tests/repository/instruction-defaults.test.ts tests/repository/instruction-hosts.json tests/repository/instruction-coverage.test.ts tests/tools/scan-instruction-defaults.ts tests/tools/scan-instruction-defaults.test.ts
git diff --cached --name-only
git commit -m "test(instructions): gate default content on redaction and inventory coverage"
```

### Task 4: Local package writer and `init --local-release` · M

D47 Q1: explicit flag, never fallback; `doctor` warns.

**Files:**
- Create: `apps/cli/src/update/local-release.ts`; Test: `apps/cli/src/update/local-release.test.ts`
- Modify: `apps/cli/src/commands/testing.ts` (`createSyntheticPackagedRelease` uses `releaseTemplateFiles()`)
- Create: `tests/tools/pack-local-release.ts`; Modify: `package.json` (script `pack:local-release`)
- Modify: `apps/cli/src/main.ts` (option `local-release`, `init` only; factory request; await)
- Modify: `apps/cli/src/bin.ts`, `apps/cli/src/context.ts`
- Modify: `apps/cli/src/commands/doctor.ts` (check `release-trust`); Test: `apps/cli/src/commands/doctor.test.ts`
- Test: `apps/cli/src/main.test.ts` (parse cases)
- Create: `apps/cli/src/commands/init-local-release.v2.test.ts` (slow; Task 29 list)

**Interfaces:**
- Consumes: Task 1 `admitUnsignedLocalPackagedRelease`, `UNSIGNED_LOCAL_LAYOUT`, `isUnsignedLocalTrust`, `validateReleaseTrustState`.
- Produces:

```ts
// apps/cli/src/update/local-release.ts
export interface ReleaseFileV1 { readonly relativePath: string; readonly bytes: Uint8Array; readonly mode: 0o600 | 0o700 }
/** templates/schemas/* and templates/brain/** — the files bootstrap requires, shared with the fixture. */
export function releaseTemplateFiles(): readonly ReleaseFileV1[];
export async function writeUnsignedLocalRelease(input: {
  readonly outDir: string;               // must not exist; created 0700
  readonly version: string;              // PRODUCT_VERSION
  readonly bundleFiles: readonly ReleaseFileV1[]; // relative to bundle/
}): Promise<string>;                     // realpath of outDir
export const LOCAL_BUNDLE_BIN: ReleaseFileV1; // bundle/bin/developer-os refusal stub, 0700

// apps/cli/src/main.ts
export type CliContextFactory = (io: CliIo, request: { readonly localRelease: string | null }) => CliContext | Promise<CliContext>;

// apps/cli/src/context.ts
export interface ProductionContextOptions { /* existing */ readonly localRelease?: PackagedReleaseSourceV1 | null }
```

- [ ] **Step 1: Write the writer tests**

```ts
it("writes a package the unsigned-local admission accepts", async () => {
  const out = await writeUnsignedLocalRelease({ outDir: join(tmp, "pkg"), version: PRODUCT_VERSION,
    bundleFiles: [LOCAL_BUNDLE_BIN, { relativePath: "instructions/catalog.json", bytes: CATALOG, mode: 0o600 }] });
  const release = await inspectPackagedRelease(await admitUnsignedLocalPackagedRelease(out, PRODUCT_VERSION));
  expect(release.trust).toBe("unsigned-local");
  expect(release.files.map((f) => f.relativePath)).toContain("bundle/instructions/catalog.json");
});
it("refuses an existing output directory", async () => { /* exit-coded refusal, nothing written */ });
```

Also: two writes of the same input are byte-identical per file (determinism); `LOCAL_BUNDLE_BIN`
exits 4 with a message naming `node apps/cli/dist/bin.js`.

- [ ] **Step 2: Write the CLI tests**

`main.test.ts`: `init --local-release /x` parses and passes `{ localRelease: "/x" }` to the factory;
`--local-release` on any other command is usage failure (exit 2); a factory that rejects with the
admission's `PackagedReleaseError` emits its exit code, not a crash. `doctor.test.ts`: a home whose
`state/release-trust.json` is unsigned-local reports check `release-trust` as `warn` with message
`installed from an unsigned local build; update and rollback refuse it`; a signed or absent state
passes. `init-local-release.v2.test.ts`: pack to a temp dir with `writeUnsignedLocalRelease`, run
`run(["init", "--yes", "--local-release", dir], io, factory)` with `createProductionContext` over a
temp `HOME`; assert exit 0, a V2 manifest, `state/release-trust.json` carrying
`"trust":"unsigned-local"`; and that the same `init` without the flag on a fresh temp home still
takes the V1 path (no silent fallback).

- [ ] **Step 3: Run — deferred to phase close (D47)**

Run: `npx vitest run --root apps/cli src/update/local-release.test.ts src/main.test.ts src/commands/doctor.test.ts` and `npx vitest run --root apps/cli src/commands/init-local-release.v2.test.ts`.

- [ ] **Step 4: Implement**

- Move the fixture's schema/brain file list out of `createSyntheticPackagedRelease` into
  `releaseTemplateFiles()`; the fixture calls it (behaviour unchanged).
- `writeUnsignedLocalRelease` writes the Task 1 contract, `architecture` from `process.arch`.
- `tests/tools/pack-local-release.ts`: refuses unless run from the checkout it was built into (copy
  `assertRepositoryRoot` from `render-claude.ts`), collects `LOCAL_BUNDLE_BIN`, every file under `workflows/`
  as `bundle/workflows/…`, and every file under `instructions/` as `bundle/instructions/…`, calls the
  writer, prints the realpath.
  `package.json`: `"pack:local-release": "tsc -b && node tests/dist/tools/pack-local-release.js"`.
- `main.ts`: add `"local-release": { type: "string" }` to `OPTIONS`, allow it only in
  `COMMAND_OPTIONS.init`, pass `{ localRelease }` to the factory, `await` its result inside the
  existing `contextFailure` try.
- `bin.ts`: the factory admits the directory with `admitUnsignedLocalPackagedRelease(dir,
  PRODUCT_VERSION)` when `localRelease !== null` and passes it as `localRelease`.
- `context.ts`: when `localRelease` is a source, build `BootstrapExecutor` exactly as
  `createCommandFixture` does (same dependency names; production `MacOsRetainedRename`,
  `randomUUID`, `randomBytes(32)` nonce; no trace/interrupt/fail hooks) and set
  `bootstrap: { state: "available", … }`; otherwise leave the pin.
- `doctor.ts`: check `release-trust` reads `state/release-trust.json` bounded, decodes it with
  `decodeCanonicalJson`, validates with `validateReleaseTrustState`; not init-owned.

- [ ] **Step 5: Gate and commit**

```bash
npm run lint
git add apps/cli/src/update/local-release.ts apps/cli/src/update/local-release.test.ts apps/cli/src/commands/testing.ts tests/tools/pack-local-release.ts package.json apps/cli/src/main.ts apps/cli/src/main.test.ts apps/cli/src/bin.ts apps/cli/src/context.ts apps/cli/src/commands/doctor.ts apps/cli/src/commands/doctor.test.ts apps/cli/src/commands/init-local-release.v2.test.ts
git diff --cached --name-only
git commit -m "feat(cli): install V2 from an explicitly named unsigned local build"
```

### Task 5: Block grammar and the merge table · M

Spec §5.1, §5.2, §6.3 strip rule. Pure; no filesystem.

**Files:**
- Create: `packages/core/src/manifest/instruction-block.ts`; Test: `packages/core/src/manifest/instruction-block.test.ts`
- Modify: `packages/core/src/manifest/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: Task 2 (none of its facts change the grammar; the wave order follows spec §12.2).
- Produces:

```ts
export const INSTRUCTION_BLOCK_BEGIN = "<!-- developer-os:begin v1 -->";
export const INSTRUCTION_BLOCK_END = "<!-- developer-os:end v1 -->";
export function renderInstructionBlock(input: { readonly productHome: string; readonly vendor: "claude" | "codex"; readonly body: string }): Uint8Array;
export type InstructionBlockExtractionV1 =
  | { readonly kind: "absent" }
  | { readonly kind: "malformed" }
  | { readonly kind: "present"; readonly start: number; readonly end: number; readonly block: Uint8Array };
export function extractInstructionBlock(file: Uint8Array): InstructionBlockExtractionV1;
export function insertInstructionBlock(file: Uint8Array | null, block: Uint8Array): Uint8Array;
export function replaceInstructionBlock(file: Uint8Array, block: Uint8Array): Uint8Array; // requires "present"
export function stripInstructionBlock(file: Uint8Array): Uint8Array;                     // requires "present"
export type InstructionBlockMergeV1 =
  | { readonly action: "write"; readonly reported: "updated" | "restored" }
  | { readonly action: "none" }
  | { readonly action: "refuse"; readonly reason: "instruction_block_malformed" | "instruction_block_conflict" };
export function decideInstructionBlockMerge(input: {
  readonly baseHash: LowerHexSha256 | null;           // null: no row yet (first install)
  readonly current: InstructionBlockExtractionV1;
  readonly proposed: Uint8Array;
}): InstructionBlockMergeV1;
```

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  ["with a final LF", "user\n"], ["without a final LF", "user"], ["with CRLF user bytes", "a\r\nb\r\n"], ["empty", ""],
])("inserts and strips byte-exactly %s", (_label, text) => {
  const before = bytes(text);
  const round = stripInstructionBlock(insertInstructionBlock(before, BLOCK));
  expect(round).toStrictEqual(text.length > 0 && !text.endsWith("\n") ? bytes(`${text}\n`) : before);
});

it("keeps bytes outside a mid-file block identical on replace", () => {
  const file = concat(bytes("top\n"), BLOCK, bytes("bottom\n"));
  const next = replaceInstructionBlock(file, OTHER_BLOCK);
  expect(next).toStrictEqual(concat(bytes("top\n"), OTHER_BLOCK, bytes("bottom\n")));
});
```

Cover: every §5.2 row (current = base → write/none; = proposed → none; absent → write `restored`;
malformed → refuse; other → refuse conflict); malformed for 0/2 begin markers, 2 end markers, end
before begin, a marker not on its own line, a marker line without LF; `insertInstructionBlock(null,
b)` returns exactly `b`; the second header line names `<P>/instructions/<vendor>/` literally with
`P` substituted.

- [ ] **Step 2: Run — deferred to phase close (D47)** · `npx vitest run --root packages/core src/manifest/instruction-block.test.ts src/index.test.ts`

- [ ] **Step 3: Implement** (byte-level scan for LF-terminated marker lines; no string decode of user bytes)

- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add packages/core/src/manifest/instruction-block.ts packages/core/src/manifest/instruction-block.test.ts packages/core/src/manifest/index.ts packages/core/src/index.ts packages/core/src/index.test.ts
git diff --cached --name-only
git commit -m "feat(core): marked instruction block grammar and merge table"
```

### Task 6: Instruction catalog, ids and bounds · M

Spec §2.3, §3.1 catalog.

**Files:**
- Create: `packages/core/src/instructions/{catalog,bounds,index}.ts`; Test: `packages/core/src/instructions/catalog.test.ts`, `packages/core/src/instructions/bounds.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: Task 2's measured Codex `AGENTS.md` load limit (use `min(65_536, measured)`).
- Produces:

```ts
export type InstructionCategoryV1 = "rule" | "scoped-rule" | "output-style" | "agent" | "skill" | "command" | "vendor-file";
declare const instructionId: unique symbol;
export type InstructionIdV1 = string & { readonly [instructionId]: true };
export function parseInstructionId(value: string): InstructionIdV1;                 // grammar and prefix only; Core's manifest validator uses this
export function assertNotWorkflowId(id: InstructionIdV1, workflowIds: ReadonlySet<string>): void; // loaders (Task 9) and the catalog validator
export interface InstructionCatalogRowV1 {
  readonly category: Exclude<InstructionCategoryV1, "command" | "vendor-file">;
  readonly id: InstructionIdV1; readonly legacyName: string;
  readonly vendors: readonly ("claude" | "codex")[]; readonly thinCommand: boolean;
}
export interface InstructionCatalogV1 { readonly schemaVersion: 1; readonly artifacts: readonly InstructionCatalogRowV1[] }
export function validateInstructionCatalog(value: unknown, workflowIds: ReadonlySet<string>): InstructionCatalogV1;
export const INSTRUCTION_BOUNDS_V1: {
  readonly fileBytes: 262_144; readonly artifactFiles: 64; readonly artifactBytes: 1_048_576;
  readonly vendorArtifacts: 128; readonly vendorBytes: 8_388_608; readonly segmentDepth: 4;
  readonly scopedGlobs: 32; readonly globBytes: 256; readonly codexBlockBytes: number;
};
export class InstructionSourceInvalidError extends Error { readonly reason: "instruction_source_invalid"; readonly path: string; readonly line: number | null }
export function assertInstructionText(path: string, bytes: Uint8Array): void;        // UTF-8, no BOM/NUL, LF only, ≤ fileBytes
export function assertInstructionRelativePath(path: string): void;                  // segment grammar, depth
export function parseScopedRulePaths(path: string, text: string): readonly string[]; // `paths:` frontmatter, 1–32 globs
```

- [ ] **Step 1: Write failing tests** — first-over-limit for every bound (exact maximum admits, +1 refuses with path only): id length 64/65, `developer-os-` prefix, a workflow id (`capture`), segment 128/129 chars, depth 4/5, file 262,144/262,145 bytes, BOM, NUL, CR, 64/65 files, 1 MiB/+1, 32/33 globs, glob 256/257 bytes. Catalog: strict keys, sorted by `(category, id)`, unique, `thinCommand: true` on a non-`skill` row refuses, empty `vendors` refuses.
- [ ] **Step 2: Run — deferred to phase close (D47)** · `npx vitest run --root packages/core src/instructions src/index.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add packages/core/src/instructions/catalog.ts packages/core/src/instructions/bounds.ts packages/core/src/instructions/index.ts packages/core/src/instructions/catalog.test.ts packages/core/src/instructions/bounds.test.ts packages/core/src/index.ts packages/core/src/index.test.ts
git diff --cached --name-only
git commit -m "feat(core): instruction catalog, id grammar and source bounds"
```

### Task 7: `instructions/` is user data in the product home · S

Spec §3.2 lifecycle standing (Spec 2 §6.1 and Spec 1 §6 amendments; texts applied by the orchestrator at Task 29).

**Files:**
- Modify: `apps/cli/src/bootstrap/executor.ts` (fresh-init external-shape admission / `admittedPreexistingPaths`)
- Modify: `packages/core/src/lifecycle/absent-manifest.ts` and, if the ledger classifies there, `apps/cli/src/lifecycle/absent-manifest-uninstall.ts`
- Test: `packages/core/src/lifecycle/absent-manifest.test.ts`; Create: `apps/cli/src/bootstrap/instructions-user-data.v2.test.ts` (slow; Task 29 list)

**Interfaces:**
- Consumes: Task 1 (file overlap on `executor.ts` only).
- Produces: `USER_DATA_HOME_ENTRIES: readonly ["instructions"]` exported from `packages/core/src/lifecycle/absent-manifest.ts`.

- [ ] **Step 1: Write failing tests** — absent-manifest walk: `P/instructions/claude/rules/x.md` is classified user data (not residue), still walked with the same bounds, and a symlink inside it still refuses; `P/instructions` as a file (not a directory) refuses. v2: a fresh `init` over a home holding only `P/instructions/**` succeeds and leaves those bytes untouched; the plan's `admittedPreexistingPaths` contains exactly `P/instructions`.
- [ ] **Step 2: Run — deferred to phase close (D47)** · `npx vitest run --root packages/core src/lifecycle/absent-manifest.test.ts` and `npx vitest run --root apps/cli src/bootstrap/instructions-user-data.v2.test.ts`
- [ ] **Step 3: Implement** — admit the exact name `instructions` as an opaque user-data subtree in both places; nothing else widens.
- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add apps/cli/src/bootstrap/executor.ts packages/core/src/lifecycle/absent-manifest.ts packages/core/src/lifecycle/absent-manifest.test.ts apps/cli/src/bootstrap/instructions-user-data.v2.test.ts
git diff --cached --name-only
git commit -m "feat(lifecycle): treat the product home's instructions directory as user data"
```

(Add `apps/cli/src/lifecycle/absent-manifest-uninstall.ts` only if changed.)

### Task 8: Manifest `instruction` arms, drift, downcast and schema id · M

Spec §2.1 (all touch points in one change), §10.2 "manifest arms are exact".

**Files:**
- Modify: `packages/core/src/manifest/types.ts`, `packages/core/src/manifest/v2.ts`, `packages/core/src/manifest/drift.ts` (`inspectV2Artifact` only), `packages/core/src/manifest/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`
- Test: `packages/core/src/manifest/v2.test.ts`, `packages/core/src/manifest/v2-drift.test.ts`
- Modify: `apps/cli/src/commands/uninstall.ts` (`downcastArtifactV2` only)
- Create: `apps/cli/src/lifecycle/manifest-rewrite.v2.test.ts` (slow; Task 29 list)

**Interfaces:**
- Consumes: Task 5 `extractInstructionBlock`; Task 6 `InstructionCategoryV1`, `InstructionIdV1`.
- Produces:

```ts
export type MergeStrategy = "dedicated" | "semantic-json" | "semantic-toml" | "marked-block";
export type ManagedArtifactSchemaIdV1 = /* existing */ | "codex-registration-v1";
export type DriftKind = /* existing */ | "block_malformed";
export interface InstructionIdentityV1 { readonly category: InstructionCategoryV1; readonly id: InstructionIdV1; readonly source: "default" | "user" }
export interface InstructionBlockMemberV1 { readonly category: Exclude<InstructionCategoryV1, "vendor-file">; readonly id: InstructionIdV1; readonly source: "default" | "user"; readonly sha256: LowerHexSha256 }
// ManagedArtifactV2 gains the two arms of spec §2.1 verbatim.
export type OwnerPathArmV1 =
  | { readonly kind: "file" | "directory" | "symlink" }
  | { readonly kind: "instruction"; readonly mode: "content" | "block"; readonly category: InstructionCategoryV1 };
// ManifestAdmissionContextV1.admitOwnerPath(owner, path, arm: OwnerPathArmV1) — existing implementers ignore `arm` until Task 11.
```

- [ ] **Step 1: Write failing validator tests** — strict round trip and refusal fixtures for both arms: every key; `content` with `mergeStrategy` other than `dedicated`, `existedBefore: true`, or non-null restore fields refuses; `block` with other than `marked-block` refuses; `marked-block` on any non-block arm refuses; `members` empty, 65 entries, unsorted, duplicate refuse; a second block row for one owner refuses; owner other than `claude`/`codex` on a block row refuses; `block` with `existedBefore: true` requires both backup fields and with `false` requires both null; `codex-registration-v1` is an accepted schema id.
- [ ] **Step 2: Write failing drift tests** — `content` rows behave like `file`/`content`; `block` rows: markers absent → `missing`; edited block → `content_changed`; malformed → `block_malformed`; bytes changed outside the block → no finding.
- [ ] **Step 3: Write the manifest-rewrite case** (`manifest-rewrite.v2.test.ts`): on a fixture V2 home, inside `withLifecycleMutation`, one `context.executor.execute` replacing `paths.manifestFile` (guarded by its current hash) with a manifest adding one `instruction`/`content` row commits; the next `withLifecycleMutation` admits the home. If this fails at phase close, the phase stops (see "Verified at plan writing").
- [ ] **Step 4: Run — deferred to phase close (D47)** · `npx vitest run --root packages/core src/manifest src/index.test.ts` and `npx vitest run --root apps/cli src/lifecycle/manifest-rewrite.v2.test.ts`
- [ ] **Step 5: Implement** — arms and `restore()` rule per arm in `v2.ts`; the sort key's existing `kind`/`mode` ordering covers the new arm; `validateManifestV2` passes the arm to `admitOwnerPath`; `downcastArtifactV2` maps `content` rows to V1 `file` and throws on `block` rows (they never reach the drained uninstall, §6.3).
- [ ] **Step 6: Gate and commit**

```bash
npm run lint
git add packages/core/src/manifest/types.ts packages/core/src/manifest/v2.ts packages/core/src/manifest/drift.ts packages/core/src/manifest/index.ts packages/core/src/manifest/v2.test.ts packages/core/src/manifest/v2-drift.test.ts packages/core/src/index.ts packages/core/src/index.test.ts apps/cli/src/commands/uninstall.ts apps/cli/src/lifecycle/manifest-rewrite.v2.test.ts
git diff --cached --name-only
git commit -m "feat(core): instruction manifest arms and block drift"
```

### Task 9: Source loaders and the fixture's instruction tree · M

Spec §2.3 filesystem rules, §3.1 runtime reads, §3.2 overrides and precedence.

**Files:**
- Create: `apps/cli/src/instructions/sources.ts`; Test: `apps/cli/src/instructions/sources.test.ts`
- Modify: `apps/cli/src/commands/testing.ts` (option `instructions?: readonly ReleaseFileV1[]` on `createCommandFixture`; when set, the synthetic release also carries the repository's `workflows/**` under `bundle/workflows/` and the given files under `bundle/instructions/`; default none)

**Interfaces:**
- Consumes: Task 1 `AdmittedPackagedReleaseV1`; Task 4 `ReleaseFileV1`; Task 6 catalog, bounds, `parseInstructionId`.
- Produces:

```ts
export interface InstructionSourceFileV1 { readonly relativePath: string; readonly bytes: Uint8Array }
export interface InstructionSourceV1 {
  readonly category: Exclude<InstructionCategoryV1, "command" | "vendor-file">;
  readonly id: InstructionIdV1; readonly source: "default" | "user";
  readonly files: readonly InstructionSourceFileV1[];     // SKILL.md first for skills; one file otherwise
  readonly thinCommand: boolean; readonly vendors: readonly ("claude" | "codex")[];
}
export interface InstructionSourceSetV1 {
  readonly vendor: "claude" | "codex";
  readonly artifacts: readonly InstructionSourceV1[];     // sorted (category, id), after override merge
  readonly unsupported: readonly { readonly category: string; readonly id: string; readonly path: string }[];
}
export async function loadReleaseWorkflows(release: AdmittedPackagedReleaseV1): Promise<readonly WorkflowContractV1[]>; // bundle/workflows/*/workflow.yaml via readFile + loadWorkflow; any finding refuses instruction_catalog_invalid
export async function loadInstructionDefaults(release: AdmittedPackagedReleaseV1, workflowIds: ReadonlySet<string>): Promise<InstructionCatalogV1 & { readonly files: ReadonlyMap<string, InstructionSourceFileV1[]> }>;
export async function loadInstructionOverrides(input: { readonly productHome: string; readonly vendor: "claude" | "codex"; readonly effectiveUid: number; readonly workflowIds: ReadonlySet<string> }): Promise<readonly InstructionSourceV1[]>;
export function mergeInstructionSources(vendor: "claude" | "codex", defaults: Awaited<ReturnType<typeof loadInstructionDefaults>>, overrides: readonly InstructionSourceV1[]): InstructionSourceSetV1;
```

- [ ] **Step 1: Write failing tests** — defaults: an unlisted file under `bundle/instructions/` and a listed-but-missing file each refuse `instruction_catalog_invalid` (exit 2); every read goes through `release.readFile`. Overrides: a symlinked file, a symlinked directory, a hard-linked file (`nlink` 2), a BOM, a NUL, CRLF, an unknown category directory each refuse `instruction_source_invalid` with path (and line where applicable) and no content in the message; foreign owner is covered by injecting `effectiveUid: uid + 1`. Precedence: a same-`(category, id)` override replaces the default on that vendor only, and for a skill replaces the whole directory (a default-only extra file disappears); a new id adds; `codex/output-styles/x.md` lands in `unsupported`, not a refusal; per-vendor caps 128 artifacts/8 MiB at exact and first-over.
- [ ] **Step 2: Run — deferred to phase close (D47)** · `npx vitest run --root apps/cli src/instructions/sources.test.ts`
- [ ] **Step 3: Implement** — no-follow opens (`O_NOFOLLOW`), `lstat` every component under `P/instructions/<vendor>/`, identity check before and after read; workflow ids are the ids `loadReleaseWorkflows` returns; the workflow-collision rule of §2.3 is enforced here, not in Core's manifest validator.
- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add apps/cli/src/instructions/sources.ts apps/cli/src/instructions/sources.test.ts apps/cli/src/commands/testing.ts
git diff --cached --name-only
git commit -m "feat(cli): bounded instruction default and override loaders"
```

### Task 10: Conflict evidence block arm · S

Spec §5.3; §10.2 "conflict evidence".

**Files:**
- Modify: `packages/core/src/manifest/types.ts` (`ConflictEvidenceRequest` union), `packages/core/src/manifest/drift.ts` (`buildConflictEvidence`)
- Test: `packages/core/src/manifest/manifest.test.ts` (existing V1 cases stay), new cases in `packages/core/src/manifest/v2-drift.test.ts`

**Interfaces:**
- Consumes: Task 5 `extractInstructionBlock`; Task 8 block arm type.
- Produces: `ConflictEvidenceRequest = <existing V1 shape> | { readonly block: { readonly artifact: Extract<ManagedArtifactV2, { kind: "instruction"; verification: { mode: "block" } }>; readonly fileBytes: Uint8Array; readonly proposedBlock: Uint8Array }; readonly fs: …; readonly guards: …; readonly redactDiagnostic: (text: string) => string }`; returns the existing `ConflictEvidence` with `baselineHash = blockHash`, `baselineBackupRelativePath` = the row's backup or `null`, `currentHash` of the extracted block, `proposedHash`, and a redacted two-way diff current → proposed.

- [ ] **Step 1: Write failing tests** — all three hashes reported; the diff is redacted (an injected secret in the user's edit does not appear); the 4 MiB and 20,000-line notices and the binary notice are unchanged; the V1 arm's existing cases pass untouched.
- [ ] **Step 2: Run — deferred to phase close (D47)** · `npx vitest run --root packages/core src/manifest`
- [ ] **Step 3: Implement** by reusing the existing bounded diff body.
- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add packages/core/src/manifest/types.ts packages/core/src/manifest/drift.ts packages/core/src/manifest/manifest.test.ts packages/core/src/manifest/v2-drift.test.ts
git diff --cached --name-only
git commit -m "feat(core): conflict evidence for an edited instruction block"
```

### Task 11: Closed owner-aware path authorization · M

Spec §2.2; §10.2 "authorization is closed".

**Files:**
- Create: `apps/cli/src/instructions/vendor-homes.ts`; Test: `apps/cli/src/instructions/vendor-homes.test.ts`
- Modify: `apps/cli/src/bootstrap/admission.ts`; Test: `apps/cli/src/bootstrap/admission.test.ts`
- Modify (pass the authorization at every confined call site): `apps/cli/src/bootstrap/report.ts` (two sites), `apps/cli/src/bootstrap/executor.ts`, `apps/cli/src/lifecycle/mutation-gate.ts`, `apps/cli/src/lifecycle/uninstall.ts`, `apps/cli/src/commands/uninstall.ts`

**Interfaces:**
- Consumes: Task 8 `OwnerPathArmV1`.
- Produces:

```ts
// vendor-homes.ts
export interface VendorHomesV1 { readonly userHome: CanonicalAbsolutePathV1; readonly productHome: CanonicalAbsolutePathV1; readonly codexHome: CanonicalAbsolutePathV1 }
export function resolveVendorHomes(env: NodeJS.ProcessEnv, userHome: string, productHome: string): VendorHomesV1; // CODEX_HOME if absolute, else H/.codex
export const claudeInstructionPaths: (homes: VendorHomesV1) => { readonly pluginRoot: string; readonly rulesDir: string; readonly outputStylesDir: string; readonly instructionFile: string; readonly importDir: string };
export const codexInstructionPaths: (homes: VendorHomesV1) => { readonly agentsDir: string; readonly instructionFile: string; readonly pluginRoot: string; readonly registrationFile: string };
// admission.ts
export type OwnerPathConfinementV1 =
  | { readonly kind: "confined"; readonly roots: readonly CanonicalAbsolutePathV1[]; readonly vendors: VendorHomesV1 | null }
  | { readonly kind: "unconfined"; readonly reason: string };
```

- [ ] **Step 1: Write failing tests** — table-driven over spec §2.2: each row admits exactly its owner and arm; for each row, a neighbouring path (`developer-os-x.md.bak`, `rules/other.md`, `H/.claude/CLAUDE.md.orig`), the other owner, a wrong arm (`file` at `H/.claude/CLAUDE.md`, `block` at a `content` target), a `..` segment each refuse (value rewritten with the outside-authority suffix); `directory` rows admitted only for the listed directories; product-home and Brain rules unchanged; `vendors: null` behaves exactly as today. `resolveVendorHomes`: relative `CODEX_HOME` falls back to `H/.codex`. (Symlinked components refuse in the planners, Tasks 16–17.)
- [ ] **Step 2: Run — deferred to phase close (D47)** · `npx vitest run --root apps/cli src/bootstrap/admission.test.ts src/instructions/vendor-homes.test.ts`
- [ ] **Step 3: Implement** and pass `vendors: resolveVendorHomes(context.env, context.userHome, paths.home)` at each confined call site; the drained uninstall's removable partition and `ownedRoots: [paths.home]` stay unchanged.
- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add apps/cli/src/instructions/vendor-homes.ts apps/cli/src/instructions/vendor-homes.test.ts apps/cli/src/bootstrap/admission.ts apps/cli/src/bootstrap/admission.test.ts apps/cli/src/bootstrap/report.ts apps/cli/src/bootstrap/executor.ts apps/cli/src/lifecycle/mutation-gate.ts apps/cli/src/lifecycle/uninstall.ts apps/cli/src/commands/uninstall.ts
git diff --cached --name-only
git commit -m "feat(cli): closed owner-bound authorization for vendor instruction paths"
```

### Task 12: Claude `renderInstructionTree` and V2 proposals · M

Spec §4 (Claude column), §5.1 Claude content, §2.3 importable-path bound, §2.2 adapter fix.

**Files:**
- Create: `packages/adapter-claude/src/instructions.ts`; Test: `packages/adapter-claude/src/instructions.test.ts`
- Modify: `packages/adapter-claude/src/install.ts`, `packages/adapter-claude/src/install.test.ts`, `packages/adapter-claude/src/index.ts`, `packages/adapter-claude/src/index.test.ts`
- Modify (compile only, V1 → V2 rows): `tests/integration/claude/plugin-loads.test.ts`

**Interfaces:**
- Consumes: Task 2 facts (plugin loads `agents/` and `commands/`; rules with/without `paths:`; output-style discovery); Task 5 `renderInstructionBlock`; Task 6 types; Task 8 `ManagedArtifactV2`; Task 9's `InstructionSourceSetV1` shape (re-declared structurally in the adapter; the adapter does not import the CLI).
- Produces:

```ts
export interface ClaudeInstructionRenderV1 {
  readonly pluginFiles: readonly RenderedArtifact[];      // relative to H/.claude/skills/developer-os/: skills/<id>/…, agents/<id>.md, commands/<id>.md
  readonly homeFiles: readonly (RenderedArtifact & { readonly target: "rules" | "output-styles"; readonly category: "scoped-rule" | "output-style"; readonly id: string })[]; // developer-os-<id>.md
  readonly importFiles: readonly (RenderedArtifact & { readonly id: string })[]; // P/claude/instructions/<id>.md
  readonly block: { readonly body: string; readonly members: readonly InstructionBlockMemberV1[] };
}
export function renderInstructionTree(defaults: InstructionSourceSetV1Like, overrides: InstructionSourceSetV1Like, productHome: string): ClaudeInstructionRenderV1;
/** The whole plugin: renderClaudePlugin(workflows) (manifest + six workflow skills) merged with pluginFiles; a path collision refuses. */
export function renderClaudeVendorTree(workflows: readonly WorkflowContractV1[], render: ClaudeInstructionRenderV1): readonly RenderedArtifact[];
export function proposeClaudeInstall(tree: readonly RenderedArtifact[], context: InstallContext, managed: ReadonlyMap<string, ManagedArtifactV2>): ClaudeInstallProposal; // create/replace keyed off V2 rows
export function proposeClaudeUninstall(context: InstallContext, managed: ReadonlyMap<string, ManagedArtifactV2>): ClaudeInstallProposal; // filters owner === "claude"
```

- [ ] **Step 1: Write failing tests** — `renderClaudeVendorTree` contains `.claude-plugin/plugin.json` and the six `developer-os-*` workflow skills, and a path collision between an instruction skill and a workflow skill refuses; byte-identical across two renders and under a reversed input order; a thin command's body only invokes skill `<id>` (one text, not two); `scoped-rule` keeps its `paths:` frontmatter; output-style frontmatter `name` unchanged and nothing selects it; the block holds one `@<P>/claude/instructions/<id>.md` line per `rule`, sorted by id; a `P` with a space refuses `instruction_path_not_importable`; instruction skills are not prefixed `developer-os-`; an override replaces a whole skill directory; `proposeClaudeUninstall` ignores a `codex`-owned row under the plugin root.
- [ ] **Step 2: Run — deferred to phase close (D47)** · `npx vitest run --root packages/adapter-claude`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add packages/adapter-claude/src/instructions.ts packages/adapter-claude/src/instructions.test.ts packages/adapter-claude/src/install.ts packages/adapter-claude/src/install.test.ts packages/adapter-claude/src/index.ts packages/adapter-claude/src/index.test.ts tests/integration/claude/plugin-loads.test.ts
git diff --cached --name-only
git commit -m "feat(adapter-claude): render instruction artifacts and V2 install proposals"
```

### Task 13: Codex `renderInstructionTree`, agent TOML and V2 proposals · M

Spec §4 (Codex column), §5.1 Codex content, §2.3 block bound.

**Files:**
- Create: `packages/adapter-codex/src/instructions.ts`, `packages/adapter-codex/src/agent-toml.ts`; Test: `packages/adapter-codex/src/instructions.test.ts`, `packages/adapter-codex/src/agent-toml.test.ts`
- Modify: `packages/adapter-codex/src/install.ts`, `packages/adapter-codex/src/install.test.ts`, `packages/adapter-codex/src/index.ts`, `packages/adapter-codex/src/index.test.ts`
- Modify (compile only, V1 → V2 rows): `tests/integration/codex/plugin-loads.test.ts`

**Interfaces:**
- Consumes: Task 2 facts (agent TOML key set; `C/agents/*.toml` loading; block load limit); Tasks 5, 6, 8; Task 9 shape (structural).
- Produces:

```ts
export interface CodexInstructionRenderV1 {
  readonly pluginFiles: readonly MarketplaceRootArtifact[];   // plugins/developer-os/skills/<id>/… beside the six workflow skills
  readonly agentFiles: readonly (RenderedArtifact & { readonly id: string })[]; // C/agents/developer-os-<id>.toml
  readonly block: { readonly body: string; readonly members: readonly InstructionBlockMemberV1[] };
  readonly emulated: readonly string[];      // scoped-rule ids
  readonly unsupported: readonly string[];   // output-style ids
}
export function renderInstructionTree(defaults: InstructionSourceSetV1Like, overrides: InstructionSourceSetV1Like): CodexInstructionRenderV1;
export function renderAgentToml(markdown: string, id: string): string;  // exactly Task 2's key set
/** The whole marketplace root: renderCodexInstallTree(workflows) (marketplace, plugin manifest, six workflow skills) merged with pluginFiles; a path collision refuses. */
export function renderCodexVendorTree(workflows: readonly WorkflowContractV1[], render: CodexInstructionRenderV1): readonly MarketplaceRootArtifact[];
export function proposeCodexInstall(…, managed: ReadonlyMap<string, ManagedArtifactV2>): CodexInstallProposal;
export function proposeCodexUninstall(context: InstallContext, managed: ReadonlyMap<string, ManagedArtifactV2>): CodexInstallProposal;
```

- [ ] **Step 1: Write failing tests** — `renderCodexVendorTree` contains the marketplace file, `.codex-plugin/plugin.json` and the six workflow skills; determinism under a reversed reader; the block body is the `rule` sections then the `scoped-rule` sections, sorted by id, each `## <id>` / `## <id> — applies only to paths matching: <globs>`; a block of `codexBlockBytes + 1` refuses `instruction_block_too_large`; output styles produce nothing and appear in `unsupported`; commands collapse to their skill; agent TOML contains exactly the observed key set and round-trips through `smol-toml` parse; `AGENTS.override.md` is never a target (assert over every rendered path).
- [ ] **Step 2: Run — deferred to phase close (D47)** · `npx vitest run --root packages/adapter-codex`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add packages/adapter-codex/src/instructions.ts packages/adapter-codex/src/agent-toml.ts packages/adapter-codex/src/instructions.test.ts packages/adapter-codex/src/agent-toml.test.ts packages/adapter-codex/src/install.ts packages/adapter-codex/src/install.test.ts packages/adapter-codex/src/index.ts packages/adapter-codex/src/index.test.ts tests/integration/codex/plugin-loads.test.ts
git diff --cached --name-only
git commit -m "feat(adapter-codex): render instruction artifacts, agent TOML and V2 proposals"
```

### Task 14: Codex registration (NEW-61) · M

Spec §6.4 and its partial-state table.

**Files:**
- Create: `apps/cli/src/instructions/codex-registration.ts`; Test: `apps/cli/src/instructions/codex-registration.test.ts`

**Interfaces:**
- Consumes: Task 2 (whether `plugin add` over a registered plugin refreshes the cache; exact `--json` shapes); Task 8 schema id `codex-registration-v1`.
- Produces:

```ts
export interface CodexRegistrationRecordV1 { readonly treeHash: LowerHexSha256; readonly codexHome: CanonicalAbsolutePathV1 }
export function validateCodexRegistrationRecord(bytes: Uint8Array): CodexRegistrationRecordV1; // canonical, exact keys
export function codexPluginTreeHash(files: readonly { readonly path: string; readonly sha256: LowerHexSha256 }[]): LowerHexSha256; // domain "developer-os:codex-plugin-tree:v1\0"
export type CodexRegistrationStateV1 = "registered" | "unregistered" | "stale";
export async function inspectCodexRegistration(input: { runner: ProcessRunner; codexExecutable: string; codexHome: string; pluginRoot: string; record: CodexRegistrationRecordV1 | null; treeHash: LowerHexSha256 }): Promise<CodexRegistrationStateV1>;
export async function registerCodexPlugin(input: { runner: ProcessRunner; codexExecutable: string; codexHome: string; marketplaceRoot: string; pluginRoot: string }): Promise<void>;   // throws CodexRegistrationFailedError (exit 1)
export async function unregisterCodexPlugin(input: { runner: ProcessRunner; codexExecutable: string | null; codexHome: string }): Promise<{ readonly warning: string | null }>; // null executable → warning "codex registration not removed: codex CLI absent"
```

- [ ] **Step 1: Write failing tests with an injected runner** — the runner receives argv arrays only and `env` exactly `{ CODEX_HOME: C }`; registration order is marketplace add (only if absent) → `plugin add developer-os@developer-os --json` (always) → `plugin list --json` whose `installed[].source.path` equals the plugin root with `enabled: true`; unregister order is `plugin remove` then `marketplace remove`, each skipped when `plugin list` shows it absent; every §6.4 table state is produced by fault injection (fail at each command); a present CLI that fails unregistration throws before any caller mutation.
- [ ] **Step 2: Run — deferred to phase close (D47)** · `npx vitest run --root apps/cli src/instructions/codex-registration.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add apps/cli/src/instructions/codex-registration.ts apps/cli/src/instructions/codex-registration.test.ts
git diff --cached --name-only
git commit -m "feat(cli): Codex plugin registration with closed partial states"
```

### Task 15: Checked-in plugin trees cover the default render · S

Spec §3.1 "`npm run render:claude|render:codex`", §10.2 "render is deterministic".

**Files:**
- Modify: `tests/contracts/adapters/claude/render-all.ts`, `tests/contracts/adapters/codex/render-all.ts`, `tests/tools/render-claude.ts`, `tests/tools/render-codex.ts`, and their tests `tests/tools/render-{claude,codex}.test.ts`, `tests/contracts/adapters/{claude,codex}/generated.test.ts`

**Interfaces:**
- Consumes: Tasks 12, 13.
- Produces: `renderAllForClaude()` / `renderAllForCodex()` include the default instruction render read from the repository's `instructions/` (defaults only, no overrides). With Task 3's empty catalog the output is unchanged, so `plugins/**` does not change in this task.

- [ ] **Step 1: Write failing tests** — the generated drift test enumerates the instruction files too (non-empty assertion guarded by the catalog having rows); a reversed directory reader yields identical bytes.
- [ ] **Step 2: Run — deferred to phase close (D47)** · `npx vitest run tests/contracts/adapters tests/tools`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add tests/contracts/adapters/claude/render-all.ts tests/contracts/adapters/codex/render-all.ts tests/tools/render-claude.ts tests/tools/render-codex.ts tests/tools/render-claude.test.ts tests/tools/render-codex.test.ts tests/contracts/adapters/claude/generated.test.ts tests/contracts/adapters/codex/generated.test.ts
git diff --cached --name-only
git commit -m "test(render): generated plugin trees include the default instruction render"
```

### Task 16: Attach planner · M

Spec §6.1 steps 1–4, §5.2 (write through `expectedBeforeHash`), §2.2 missing parents, §8 target refusals.

**Files:**
- Create: `apps/cli/src/instructions/attach.ts`; Test: `apps/cli/src/instructions/attach.test.ts`

**Interfaces:**
- Consumes: Task 8 arms; Task 9 sources; Task 10 conflict evidence; Task 11 vendor paths; Tasks 12–13 renders and V2 proposals; Task 5 merge.
- Produces:

```ts
export interface InstructionAttachInputV1 {
  readonly vendors: readonly ("claude" | "codex")[];       // the selection after this run
  readonly homes: VendorHomesV1;
  readonly manifest: InstallationManifestV2; readonly manifestHash: LowerHexSha256;
  readonly config: DeveloperOsConfigV1; readonly configHash: LowerHexSha256;
  readonly sources: ReadonlyMap<"claude" | "codex", InstructionSourceSetV1>;
  readonly workflows: readonly WorkflowContractV1[];      // Task 9 loadReleaseWorkflows
  readonly productVersion: StableSemverV1; readonly now: UtcTimestampV1;
  readonly fs: { lstat(path: string): Promise<BigIntStats | null>; readFile(path: string): Promise<Uint8Array | null> }; // no-follow, injected
}
export type InstructionAttachPlanV1 =
  | { readonly kind: "noop" }                               // nothing to write (idempotence)
  | { readonly kind: "transaction"; readonly mutations: readonly FileMutation[]; readonly manifest: InstallationManifestV2; readonly report: InstructionApplyReportV1 };
export interface InstructionApplyReportV1 { readonly installed: readonly string[]; readonly restored: readonly string[]; readonly unchanged: readonly string[]; readonly emulated: readonly string[]; readonly unsupported: readonly string[] }
export class InstructionRefusal extends Error { readonly reason: string; readonly code: ExitCode; readonly paths: readonly string[]; readonly evidence: ConflictEvidence | null; readonly recovery: string }
export async function planInstructionAttach(input: InstructionAttachInputV1): Promise<InstructionAttachPlanV1>;
/** Invariant 3. Initial value below; Task 2 Step 3's billed row empties it by founder decision at Task 29. */
export const UNPROVEN_CLAUDE_CATEGORIES: ReadonlySet<InstructionCategoryV1> = new Set(["rule", "scoped-rule", "output-style"]); // minus any category Task 2 proved unbilled
```

- [ ] **Step 1: Write failing tests** (in-memory `fs`) — an unmanaged file at a `content` target refuses `instruction_target_occupied` (exit 3); a symlink at any component of a §2.2 target, including a linked `CLAUDE.md`/`AGENTS.md`, refuses `instruction_target_symlinked` (exit 5); missing parents become exact `directory` rows with `existedBefore: false`, existing parents are never rows; every §5.2 row, with the conflict refusal carrying `ConflictEvidence` and the §5.2 recovery text; the manifest rewrite is one `replace` guarded by `manifestHash`; `adapters.*` config values are written in the same mutation list; a pre-existing `CLAUDE.md` gets a block row with `existedBefore: true` and backup fields; an unchanged re-plan returns `noop`; `UNPROVEN_CLAUDE_CATEGORIES` filters those Claude categories out and reports them as held back (the tests pin both the initial value and the empty-set behaviour); the Claude plugin tree always includes the six workflow skills and `.claude-plugin/plugin.json`; the `adapters.*` config write and the config's manifest row are kept coherent exactly as `config set` keeps them (`apps/cli/src/commands/config.ts` `applyConfigValue`).
- [ ] **Step 2: Run — deferred to phase close (D47)** · `npx vitest run --root apps/cli src/instructions/attach.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add apps/cli/src/instructions/attach.ts apps/cli/src/instructions/attach.test.ts
git diff --cached --name-only
git commit -m "feat(cli): plan the instruction attach as one guarded transaction"
```

### Task 17: Detach planner · M

Spec §6.3 steps 2–3, §6.2 deselection.

**Files:**
- Create: `apps/cli/src/instructions/detach.ts`; Test: `apps/cli/src/instructions/detach.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 8, 10, 11, 12, 13.
- Produces:

```ts
export interface InstructionDetachInputV1 {
  readonly vendors: readonly ("claude" | "codex")[];   // vendors to detach
  readonly homes: VendorHomesV1;
  readonly manifest: InstallationManifestV2; readonly manifestHash: LowerHexSha256;
  readonly config: DeveloperOsConfigV1; readonly configHash: LowerHexSha256;
  readonly fs: InstructionAttachInputV1["fs"];
}
export type InstructionDetachPlanV1 =
  | { readonly kind: "noop" }
  | { readonly kind: "transaction"; readonly mutations: readonly FileMutation[]; readonly manifest: InstallationManifestV2; readonly removed: readonly string[] };
export async function planInstructionDetach(input: InstructionDetachInputV1): Promise<InstructionDetachPlanV1>;
```

- [ ] **Step 1: Write failing tests** — every `content` row and every plugin-tree `file` row outside the product home is removed; a drifted file refuses exit 3 before any mutation is returned; a block equal to base → `replace` with the block bytes stripped, and a product-created file whose remainder is empty → `remove`; markers absent → row dropped, no write; anything else → refuse exit 3 with evidence; the whole-file backup is never restored; product-created parents are removed only when the plan empties them, deepest first, and a non-empty one is preserved and reported; `adapters.<vendor>` set to `false`; the resulting manifest holds only product-home rows when both vendors detach.
- [ ] **Step 2: Run — deferred to phase close (D47)** · `npx vitest run --root apps/cli src/instructions/detach.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add apps/cli/src/instructions/detach.ts apps/cli/src/instructions/detach.test.ts
git diff --cached --name-only
git commit -m "feat(cli): plan the instruction detach; strip blocks, never restore"
```

### Task 18: `init --adapters`: fresh install and reconcile (NEW-60) · M

Spec §6.1, §6.2, Q2 A; §10.2 "init installs", "reconcile".

**Files:**
- Create: `apps/cli/src/instructions/apply.ts`; Test: `apps/cli/src/instructions/apply.test.ts`
- Modify: `apps/cli/src/commands/init.ts` (fresh path after handoff; `settleExistingV2`), `apps/cli/src/main.ts` (option `adapters` on `init`), `apps/cli/src/main.test.ts`
- Create: `apps/cli/src/commands/init-instructions.v2.test.ts` (slow; Task 29 list)

**Interfaces:**
- Consumes: Task 4 (`--local-release`, bootstrap available); Tasks 14, 16, 17.
- Produces:

```ts
export type AdapterSelectionV1 = readonly ("claude" | "codex")[];
export function parseAdaptersFlag(value: string): AdapterSelectionV1;   // "claude,codex" | "claude" | "codex" | "none"; else exit 2
export async function applyInstructions(context: CliContext, input: {
  readonly selection: AdapterSelectionV1 | null;    // null: use stored adapters.*
  readonly release: AdmittedPackagedReleaseV1 | null;
}): Promise<InstructionApplyReportV1 & { readonly registration: CodexRegistrationStateV1 | null; readonly warnings: readonly string[] }>;
export interface InitOptions { readonly dryRun: boolean; readonly assumeYes: boolean; readonly adapters: AdapterSelectionV1 | null }
```

- [ ] **Step 1: Write failing unit tests** (`apply.test.ts`, fixture without real init) — a selected vendor whose CLI is absent, unreadable or below its floor refuses `adapter_unavailable` (exit 4) before any mutation (discovery through `context.platform`); detach of deselected vendors runs first (unregister Codex, then the detach transaction), attach second; Codex registration runs only when the tree hash differs from the registration row or `plugin list` lacks the plugin, and success writes the registration row in a second small gated transaction; an unchanged re-run performs no transaction and no runner call; `release_mismatch` (exit 4) when the release's version differs from the manifest's `productVersion` or its `releaseIdentityHash` differs from `state/active-release.json`'s; no release and a needed instruction step → `packaged_release_unavailable` (exit 4).
- [ ] **Step 2: Write failing v2 cases** (`init-instructions.v2.test.ts`, one shared home, chained) — fresh `init --adapters claude,codex` on a synthetic release with `instructions:` installs the six workflow skills, the plugin manifests, every fixture catalog artifact not in `UNPROVEN_CLAUDE_CATEGORIES` (Claude) and every one on Codex, and both blocks; fresh `init` without `--adapters` writes nothing in `H/.claude` or `C` and its output names `--adapters`; a failing attach (injected occupied target) exits 3 and leaves the handoff complete (a later `doctor` sees a valid V2 home); override add, change and removal each converge in one re-run; deselecting `codex` strips its block and unregisters.
- [ ] **Step 3: Run — deferred to phase close (D47)** · `npx vitest run --root apps/cli src/instructions/apply.test.ts src/main.test.ts` and `npx vitest run --root apps/cli src/commands/init-instructions.v2.test.ts`
- [ ] **Step 4: Implement** — `applyInstructions` runs inside `withLifecycleMutation(context, lifecycle, work)`; `work` loads sources (Task 9), plans (Tasks 16/17), and calls `context.executor.execute({ kind: "instructions", mutations })`; registration and the registration-row transaction follow. In `init.ts`, the fresh path calls it after `initializeFresh` returns (not init-owned; the instruction check is not added to `INIT_OWNED_CHECKS`); `settleExistingV2` keeps its non-instruction drift refusal and resolves instruction rows through the planners instead of refusing. `init` exits with the instruction step's code.
- [ ] **Step 5: Gate and commit**

```bash
npm run lint
git add apps/cli/src/instructions/apply.ts apps/cli/src/instructions/apply.test.ts apps/cli/src/commands/init.ts apps/cli/src/main.ts apps/cli/src/main.test.ts apps/cli/src/commands/init-instructions.v2.test.ts
git diff --cached --name-only
git commit -m "feat(init): install and reconcile instruction artifacts per selected adapter"
```

### Task 19: `uninstall` detaches before the drained uninstall · M

Spec §6.3; §10.2 "uninstall".

**Files:**
- Modify: `apps/cli/src/commands/uninstall.ts`, `apps/cli/src/lifecycle/uninstall.ts`
- Create: `apps/cli/src/lifecycle/uninstall-detach.v2.test.ts` (slow; Task 29 list)

**Interfaces:**
- Consumes: Tasks 14, 17 (`planInstructionDetach`, `unregisterCodexPlugin`).
- Produces: no new exports; `uninstall` on a V2 home with vendor rows runs detach of every selected vendor through the same gated transaction path as Task 18, then the existing drained uninstall unchanged.

- [ ] **Step 1: Write failing v2 cases** — detach runs before the drained uninstall, which then sees only product-home rows (assert the coordinator plan's artifact set); every vendor row is removed; a pre-existing `CLAUDE.md` keeps post-install user edits outside the block; a product-created `AGENTS.md` whose remainder is empty is deleted; a drifted managed file or edited block refuses exit 3 before any write; Codex unregistration runs before any file mutation, and an absent CLI is a warning; `P/instructions/**` survives, and a fresh `init --local-release … --adapters claude` after `uninstall` admits it.
- [ ] **Step 2: Run — deferred to phase close (D47)** · `npx vitest run --root apps/cli src/lifecycle/uninstall-detach.v2.test.ts`
- [ ] **Step 3: Implement** — detach precedes the envelope dispatch; the removable partition and Spec 1 §2.4's grammar are untouched.
- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add apps/cli/src/commands/uninstall.ts apps/cli/src/lifecycle/uninstall.ts apps/cli/src/lifecycle/uninstall-detach.v2.test.ts
git diff --cached --name-only
git commit -m "feat(uninstall): detach vendor instruction artifacts before draining"
```

### Task 20: `doctor` names every artifact · M

Spec §7; §10.2 "doctor names every artifact"; scope decision 5.

**Files:**
- Create: `apps/cli/src/lifecycle/schema-registry.ts`; Test: `apps/cli/src/lifecycle/schema-registry.test.ts`
- Modify: `apps/cli/src/commands/doctor.ts`; Test: `apps/cli/src/commands/doctor.test.ts`
- Create: `apps/cli/src/commands/doctor-instructions.v2.test.ts` (slow; Task 29 list)

**Interfaces:**
- Consumes: Task 4 (`release-trust` check already in `doctor.ts`); Task 6; Task 8 `inspectDrift` arms; Task 9 `loadInstructionOverrides`; Task 14 `validateCodexRegistrationRecord`, `inspectCodexRegistration`.
- Produces:

```ts
export function createManagedArtifactSchemaRegistry(): ManagedArtifactSchemaRegistry; // config, allocator, active release, both trust arms, codex-registration-v1
export interface InstructionStatusV1 {
  readonly owner: "claude" | "codex"; readonly category: InstructionCategoryV1; readonly id: InstructionIdV1;
  readonly source: "default" | "user";
  readonly state: "installed" | "drifted" | "missing" | "emulated" | "unsupported-vendor";
  readonly paths: readonly string[];
}
// DoctorReportV1 gains `readonly instructions: readonly InstructionStatusV1[]` sorted by (owner, category, id).
```

- [ ] **Step 1: Write failing tests** — every catalog artifact (read from the installed, manifest-hash-verified `…/bundle/instructions/catalog.json`), every override, and the `vendor-file` block are listed once per selected vendor; nothing for an unselected vendor; block members take `source`/`state` from `members` and the block's drift; a multi-file skill with one drifted file is `drifted`; Codex output styles are `unsupported-vendor`, scoped rules `emulated`; check `instructions` fails on `drifted`, `missing` or `block_malformed` and warns on `unsupported-vendor`; check `codex-registration` reports `fail: unregistered`, `fail: stale`, and with `--probe` `fail: cache-stale`; a set `CLAUDE_CONFIG_DIR` warns; neither new id is init-owned; human output is one line per artifact `<owner> <category>/<id>: <source>, <state>`; a user override flips exactly its row to `user`.
- [ ] **Step 2: Run — deferred to phase close (D47)** · `npx vitest run --root apps/cli src/lifecycle/schema-registry.test.ts src/commands/doctor.test.ts` and `npx vitest run --root apps/cli src/commands/doctor-instructions.v2.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add apps/cli/src/lifecycle/schema-registry.ts apps/cli/src/lifecycle/schema-registry.test.ts apps/cli/src/commands/doctor.ts apps/cli/src/commands/doctor.test.ts apps/cli/src/commands/doctor-instructions.v2.test.ts
git diff --cached --name-only
git commit -m "feat(doctor): report every instruction artifact with its source and state"
```

### Task 21: Loading and isolation assertions (NEW-65, D8) · M

Spec §10.2 "loading is asserted", "ingest stays isolated". These tests run real vendor CLIs in
disposable homes; they are written here and **run by the founder at Task 29**.

**Files:**
- Modify: `tests/integration/claude/plugin-loads.test.ts`, `tests/integration/codex/plugin-loads.test.ts`
- Create: `tests/integration/ingest/instruction-isolation.test.ts`
- Modify: `package.json` only if the new isolation file must join `test:vendor-ingest`'s exclusion or inclusion list

**Interfaces:**
- Consumes: Task 15 (`renderAllFor*` with instructions), Task 18 (install through the CLI); Task 2's pinned commands and ingest-isolation method.
- Produces: none.

- [ ] **Step 1: Write the Claude assertion** — after installing the rendered tree into a temp home, `claude plugin details developer-os` lists every skill, agent and command by name (non-empty expected set first).
- [ ] **Step 2: Write the Codex assertion** — `codex debug prompt-input` contains every skill and the `AGENTS.md` block; an in-place override change is invisible before re-registration and visible after `registerCodexPlugin`.
- [ ] **Step 3: Write the isolation assertion** — with every instruction installed in a disposable home, each vendor's ingest argv yields a prompt input containing neither block marker nor any managed file's text, by Task 2's method. A failure stops the phase (D8 outranks A12).
- [ ] **Step 4: Run — deferred to phase close (D47); FOUNDER STOP** · `npx vitest run tests/integration/claude tests/integration/codex tests/integration/ingest/instruction-isolation.test.ts`
- [ ] **Step 5: Gate and commit**

```bash
npm run lint
git add tests/integration/claude/plugin-loads.test.ts tests/integration/codex/plugin-loads.test.ts tests/integration/ingest/instruction-isolation.test.ts
git diff --cached --name-only
git commit -m "test(integration): assert instruction loading and ingest isolation"
```

### Tasks 22–26: Default content, founder in the loop · M each

Spec §3.3 clean room, §9 coverage. Every one of these tasks begins with a **FOUNDER STOP**: the
founder supplies the named legacy artifacts' text through an owner-controlled process; the agent
never opens a legacy path. For each artifact the agent writes the redacted default under
`instructions/`, adds its catalog row (`legacyName` = the inventory's name, e.g.
`rules/communication.md`, `rules-lazy/typescript.md`, `knowledge/stack-preferences.md`), and moves
every user-specific preference to a neutral statement (the founder's own value belongs in the
founder's override on the founder's machine, never in the repository).

| Task | Artifacts | Categories | Extra stop |
|---|---|---|---|
| 22 | `communication`, `workflow`, `security`, `stack-preferences`; `typescript`, `nextjs`, `error-handling`, `monitoring` | 4 `rule`, 4 `scoped-rule` (`paths:` kept) | — |
| 23 | `architect`, `debug`, `direct-objective`, `tdd-enforcer`; `code-reviewer`, `performance-engineer`, `qa-expert`, `research-analyst`, `security-auditor` | 4 `output-style` (vendors `["claude"]`), 5 `agent` | — |
| 24 | `analizer`, `fix-pr`, `implementator`, `przeglad-claudemd`, `release`, `rev-eng`, `spec`, `wrap-up` | 8 `skill` with `thinCommand: true` (one text per pair) | — |
| 25 | `bug-triage`, `claudeception`, `client-onboarding`, `code-review`, `deploy-checklist`, `nextjs-removeconsole-computed-access-survives`, `react-best-practices`, `recovering-killed-claude-workflow-results`, `url-construction-silent-footguns`, `weekly-report` | 10 `skill` (`brain-search` is not rendered; the product workflow covers it) | **L1 legal stop** for `react-best-practices`: it ships only if its license permits redistribution of a modified copy under the repository's license; otherwise the founder records the refusal in the inventory and the row is omitted. `claudeception` must direct new skills to `<P>/instructions/<vendor>/skills/`. |
| 26 | `research`, `research-deep`, `research-add-fields`, `research-add-items`, `research-report`, `excalidraw-diagram` | 6 `skill` (Q3 A) | — |

**Files (each task):** `instructions/<category-dir>/<id>…` for its artifacts, and
`instructions/catalog.json` (rows for its artifacts only; the integrator merges catalog rows as a
sorted union). Task 25 adds the vendored license file inside `instructions/skills/react-best-practices/`.

**Interfaces:** Consumes Task 3 (catalog file, scan tool) and Task 6 (catalog schema). Produces
catalog rows.

- [ ] **Step 1: FOUNDER STOP** — receive the batch's source texts.
- [ ] **Step 2:** Write each redacted default and its catalog row; every file satisfies Task 6's bounds.
- [ ] **Step 3:** Run the CI scan locally as a tool (not vitest): `npm run build && node tests/dist/tools/scan-instruction-defaults.js` — Expected: zero findings. **FOUNDER STOP:** the founder runs the same command with `--patterns <private-file>` (a file outside the repository, never committed) and reports the finding count.
- [ ] **Step 4:** Independent content review by a fresh agent that authored none of it, over the diff only, before staging.
- [ ] **Step 5: Gate and commit**

```bash
npm run lint
git add instructions/catalog.json <each exact file of this batch>
git diff --cached --name-only
git commit -m "feat(instructions): redacted defaults for <batch>" -m "Founder-local scan: 0 findings (scan-instruction-defaults.js --patterns <private>)."
```

### Task 27: Regenerate the plugin trees from the finished defaults · S

**Files:** `plugins/claude/**`, `plugins/codex/**` (regenerated only).

**Interfaces:** Consumes Tasks 15 and 22–26.

- [ ] **Step 1:** `npm run render:claude && npm run render:codex`
- [ ] **Step 2:** `git status --short plugins/` lists only files under `plugins/claude/` and `plugins/codex/`.
- [ ] **Step 3: Run — deferred to phase close (D47)** · `npx vitest run tests/contracts/adapters tests/repository/instruction-coverage.test.ts tests/repository/instruction-defaults.test.ts` — Expected at close: PASS (coverage is exhaustive, 41 catalog rows + `brain-search` + 2 vendor files = 44; 43 if the founder refused `react-best-practices` under L1).
- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add <each regenerated path printed by git status --short plugins/>
git diff --cached --name-only
git commit -m "chore(plugins): regenerate vendor trees with the default instructions"
```

### Task 28: Architecture notes and the threat model · S

Spec §11 rows whose documents are outside `docs/superpowers/`.

**Files:** `docs/architecture/claude-adapter.md` (§2.2, §2.3 writes outside the plugin dir only to §2.2 rows, still no settings key, no style selected; §9.8 closed), `docs/architecture/codex-adapter.md` (§2.2 one marked block in `C/AGENTS.md`, never `AGENTS.override.md`, `durable_project_guidance` stays `not-used`; §11.9 and §11.14 closed), `docs/architecture/threat-model.md` (new §5.14 from spec §11.4, including the unsigned-local downgrade).

**Interfaces:** Consumes Tasks 18–20 (so the notes describe what shipped).

- [ ] **Step 1:** Mark each change "Amended <date> (A12)" in place.
- [ ] **Step 2: Gate and commit**

```bash
npm run lint
git add docs/architecture/claude-adapter.md docs/architecture/codex-adapter.md docs/architecture/threat-model.md
git diff --cached --name-only
git commit -m "docs(architecture): A12 amendments and threat-model entry 5.14"
```

### Task 29: Phase close · founder

**Interfaces:** Consumes every task above integrated on `development`.

- [ ] **Step 1 (orchestrator):** apply the §11 spec amendments under `docs/superpowers/` (umbrella §9.1/§9.3/§9.4, Spec 1 §6, Spec 2 §6.1 and §3's `unsigned-local` trust state), each "Amended <date> (A12)"; `git add -f` each on its own line.
- [ ] **Step 2 (FOUNDER STOP):** run `npm run check` and every deferred command recorded in Tasks 1–27, including the slow files: `apps/cli/src/commands/init-local-release.v2.test.ts`, `apps/cli/src/bootstrap/instructions-user-data.v2.test.ts`, `apps/cli/src/lifecycle/manifest-rewrite.v2.test.ts`, `apps/cli/src/commands/init-instructions.v2.test.ts`, `apps/cli/src/lifecycle/uninstall-detach.v2.test.ts`, `apps/cli/src/commands/doctor-instructions.v2.test.ts`, `apps/cli/src/bootstrap/executor.test.ts` (Tasks 1, 7, 11 edit `executor.ts`). Measure the new v2 files and set `lifecycle-v2` `timeout-minutes` from the total.
- [ ] **Step 3 (FOUNDER STOP):** the real-vendor integration tests of Task 21 and the billed real-agent row of Task 2 Step 3.
- [ ] **Step 3b (FOUNDER DECISION):** once the billed row passes, empty `UNPROVEN_CLAUDE_CATEGORIES` (one-line commit, `npm run lint`). The phase gate does not close before this.
- [ ] **Step 4:** one whole-phase fresh-context review by an agent that authored none of Tasks 1–28, over the accumulated diff; accepted findings get a failing regression test first, then the smallest fix; repeat until no Critical or Important finding.
- [ ] **Step 5:** close NEW-60, NEW-61, NEW-65 and A12 in `BACKLOG.md`/`ORDER.md`; tick the roadmap Phase 5 rows; push one branch and open one PR.
- [ ] **Step 6 (FOUNDER STOP, after merge, outside this plan):** reaching the founder's machine is the A15 cutover: `npm run pack:local-release -- <dir>` then `node apps/cli/dist/bin.js init --local-release <dir> --adapters claude,codex`.

## Spec Coverage Index

| Spec § | Tasks |
|---|---|
| 0 Q1 (D47: local unsigned) | 1, 4 |
| 0 Q2 (reconcile via `init`) | 18 |
| 0 Q3 (44 artifacts) | 26, 27 |
| 1 invariants | 11 (1), 16–17 (2), 2 + 16 (3), 12–13 (4), 3 + 22–26 (5), 21 (6) |
| 2.1 manifest arms | 8 |
| 2.2 authorization | 11 (paths), 16 (symlink refusal), 12 (Claude uninstall owner check), 20 (`CLAUDE_CONFIG_DIR` warn) |
| 2.3 bounds | 6, 9, 12 (importable `P`), 13 (block size) |
| 3.1 defaults, catalog, packaging | 3, 4 (bundle carries `instructions/`), 6, 9, 15, 27 |
| 3.2 overrides and standing | 7, 9 |
| 3.3 redaction | 3, 22–26 |
| 4 vendor projection | 2, 12, 13 |
| 5 block and merge | 5, 16, 17 |
| 5.3 conflict evidence | 10 |
| 6.1 `init` installs | 18 |
| 6.2 reconcile | 18 |
| 6.3 uninstall | 17, 19 |
| 6.4 Codex registration | 14, 18, 19 |
| 7 `doctor` | 20 (and 4 for the trust warning) |
| 8 refusals | per task, per Global Constraints |
| 9 coverage | 3, 22–27 |
| 10.1 observations | 2 |
| 10.2 gates | 8, 11, 6/9, 12/13/15, 5, 10, 18, 19, 14, 21, 20, 3, 3/27, 2 Step 3 |
| 11 amendments | 28 (architecture notes), 29 Step 1 (specs) |
| 12.3 residuals | unchanged; recorded by 28 |
