# Developer OS Bootstrap Performance and First Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `init` and the bootstrap evidence suite fast enough to fit CI, settle the one functional bootstrap failure now standing on `development`, unify the three copies of the admission predicate, and push the accumulated commits with every CI job green.

**Architecture:** One evidence inspection per `init`, computed once and passed down, replaces eight independent inspections that each re-walk the filesystem. Inventory walks are grouped rather than repeated per plan and per root set. Retention postimage projection stops re-walking the same directory tree from ten call sites. Uninstall excludes maximal retention roots instead of every retained path and reads a V2 manifest through the V2-aware store. One `admission.ts` owns the canonicalizer and the owner-admission predicate, and it keeps the difference between a live request's confinement and a historical manifest's rather than erasing it.

**Tech Stack:** TypeScript 5.9 strict ESM, Node.js 24 built-ins, Vitest 4, macOS 15+, GitHub Actions on `macos-15`.

**Spec:** `docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md` §6 as amended 2026-09-04, `docs/architecture/foundation.md` and `docs/architecture/foundation-constraints.md`. Scope: roadmap Phase 2 (`docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`), `BACKLOG.md` NEW-53, NEW-52, NEW-51, NEW-59, NEW-29.

---

## What this plan was written against, and one correction it makes to the roadmap

Roadmap Phase 2 says the executor test failure "is the surface of `95c2d7e`". **That attribution is wrong and was disproven by direct reproduction on 2026-09-05.** Reverting only `apps/cli/src/bootstrap/executor.ts` to `95c2d7e~1` (byte-identical to `c5022a7`, verified with `diff`) and re-running the single case reproduces the failure identically. The gating that actually decides it lives in `apps/cli/src/commands/init.ts` and dates to `edc00bb` (2026-08-30). Task 1 owns settling it; do not scope work around the roadmap's claim. The roadmap and `ORDER.md` are corrected in the same change that registers this plan.

Every measurement below was taken on 2026-09-05 against `27a4033`. Re-measure rather than trusting them if the tree has moved.

## Global Constraints

- **Never run `apps/cli/src/bootstrap/executor.test.ts` in full.** Its second phase alone took 10010 s on 2026-09-05. Run a single case with `-t "<exact name>"`, which takes 50-110 s.
- Every filesystem mutation follows `plan → backup → stage → validate → apply → verify → finalize`.
- Every enumerating gate asserts a non-empty set per scope.
- Redact before truncating, hashing, logging, persistence, publication, or model input.
- A test pins the approved contract, not current behaviour. If a test goes green because its assertion was edited, that is a finding to justify, not a task completed.
- Every test written here is observed failing for its stated reason before its implementation step.
- Stage exact task-owned paths. Never `git add -A`, `git add .`, or a wildcard. `docs/superpowers/**` is git-ignored by a global rule and needs `git add -f`.
- Reviewer and author are different agents.
- **A performance task is not done until it is measured.** Every optimisation step below names a before number and requires an after number from the same command on the same machine. A refactor with no measurement is not an optimisation.
- **The push is a founder stop.** Task 10 stops and asks; do not push to any remote without explicit approval.

## File and Responsibility Map

| Area | Files | Responsibility |
|---|---|---|
| Resume admission | `apps/cli/src/commands/init.ts:780-900`, `apps/cli/src/bootstrap/report.ts:745-776,955-970` | Whether a rolled-back bootstrap admits a new intent (Task 1) |
| CI coverage | `.github/workflows/check.yml` | A job for every `check` step, including `test:vendor-ingest` (Task 2) |
| Evidence inspection | `apps/cli/src/bootstrap/executor.ts:626,670,1110,1177,1320,2898,2995`, `apps/cli/src/commands/init.ts:818` | One inspection per `init`, passed down (Task 3) |
| Retention projection | `apps/cli/src/bootstrap/retention.ts:258-338`, `apps/cli/src/bootstrap/report.ts` | Stop re-walking the same tree (Task 4) |
| Inventory grouping | `apps/cli/src/bootstrap/report.ts:783-786,981-1005` | One walk per root set, not three per plan (Task 5) |
| Row lookup | `apps/cli/src/bootstrap/report.ts:809-811` | A map, not a linear scan per location (Task 5) |
| Uninstall | `apps/cli/src/commands/uninstall.ts:534-585,637` | Maximal roots; V2-aware manifest read (Tasks 6, 7) |
| Shared admission | `apps/cli/src/bootstrap/admission.ts` (new), `apps/cli/src/bootstrap/executor.ts:2237-2263`, `apps/cli/src/bootstrap/report.ts:157,503-521`, `apps/cli/src/commands/uninstall.ts:550-560` | One canonicalizer, one predicate, differences preserved (Task 8) |
| Measurement | `docs/architecture/foundation.md` | The recorded before/after numbers (Task 9) |

---

### Task 1: Settle whether a rolled-back bootstrap admits a new intent

This task changes no performance code. It answers a contract question that is currently failing a test on `development`, and everything else in this plan is easier to review once the tree is green for a known reason.

**Files:**
- Read: `apps/cli/src/commands/init.ts:780-900`, `apps/cli/src/bootstrap/report.ts:617-800,955-970`, `apps/cli/src/bootstrap/executor.test.ts:555-620`
- Read: `docs/architecture/foundation.md`, `docs/architecture/foundation-constraints.md`, `docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md` §6 and its 2026-09-04 amendments
- Modify: whichever of `apps/cli/src/commands/init.ts` or `apps/cli/src/bootstrap/executor.test.ts` the answer requires

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a green `executor.test.ts` case, or a recorded founder question. Later tasks assume the tree is green apart from the load-sensitive timeouts Task 9 addresses.

**The observed facts.** The case "retains post-Foundation rollback targets and artifacts without invoking deletion authority" sets `bootstrapFailureAfter: "after_foundation"` and `bootstrapInterruptAfter: "after_rolled_back"`, runs `init` once so the journal reaches `phase: "rolled_back"`, then resumes in a fresh process and asserts the resume fails with `recoveryRequired` and performs the rolled-back-to-retained tombstone rename. The resume now returns `ok: true`. Traced on 2026-09-05: the resumed call never reaches the executor. `runInit` computes `resumableBootstrap = evidence.active !== null` (`init.ts:824`) and only consults `evidence.blocksNewIntent` inside `if (resumableBootstrap || (fresh && bootstrapAvailable))` (`init.ts:832`). On the resume, `evidence.active` is `null` and `evidence.blocksNewIntent` is `true`, but `fresh` is `false`, so the branch is skipped, `blocksNewIntent` is never read, and execution falls through to the V1 path and returns success.

- [ ] **Step 1: Establish which contract is authoritative, from the documents**

Read Spec 2 §6 and its 2026-09-04 amendments, `foundation.md` and `foundation-constraints.md` end to end — not by grep. The prior investigation found the policy sentence "a rolled-back envelope is not active; Spec 2 lets a later `init` start a new ID beside it" as a docblock at `report.ts:963-964`, dated to amendment D1, but could not find language in the spec or the architecture notes saying whether a state that is **persisted as `rolled_back` but derivable as `retained`** counts as not-active for admission. Write down, quoting each document, what it does and does not settle.

- [ ] **Step 2: Decide, and record the decision before touching code**

Exactly one of these is true, and your report must say which and why:

1. **The code is wrong.** `blocksNewIntent` is computed correctly and simply never consulted on this path. A user whose Foundation participant failed mid-`init` gets a second `init` that reports success while the V2 retention and tombstone machinery never runs. Fix: consult `blocksNewIntent` regardless of `fresh` and `resumableBootstrap`, so an evidence report that blocks a new intent blocks it.
2. **The test is stale.** Amendment D1 replaced the contract and a later `init` may start a new ID beside a rolled-back one. Then the case's own assertions about the tombstone rename (`executor.test.ts:610-616`) are also stale, because the new contract never renames — the whole case must be rewritten to pin the new behaviour, not have one assertion flipped.
3. **The documents do not settle it.** Stop and ask the founder. This is a spec question, and a spec is not rewritten silently.

**Do not pick option 2 because it is the smaller edit.** The repository's rule is that a test pins the contract; a red test may be describing the correct one.

- [ ] **Step 3: If option 1, write the failing test first**

The existing case already fails for the right reason, so it is the regression test. Additionally add, in `apps/cli/src/commands/init.test.ts`, a focused case that a `blocksNewIntent` evidence report refuses a non-fresh, non-resumable `init`, using that file's existing fixture helpers. Run it, record the failure verbatim.

- [ ] **Step 4: If option 1, make `blocksNewIntent` load-bearing**

In `apps/cli/src/commands/init.ts`, move the `evidence.blocksNewIntent` check out of the `if (resumableBootstrap || (fresh && bootstrapAvailable))` branch so it is consulted on every path that could start work. Say in one comment why `active === null` and `blocksNewIntent === true` are not contradictory — that is a genuinely non-obvious fact about this report's shape and a reader cannot recover it from the code.

- [ ] **Step 5: Verify**

Run: `npx vitest run --root apps/cli src/bootstrap/executor.test.ts -t "retains post-Foundation rollback targets and artifacts without invoking deletion authority"`

Expected: PASS. Then run `npx vitest run --root apps/cli src/commands/init.test.ts` and confirm nothing else regressed. Record both.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/init.ts apps/cli/src/commands/init.test.ts
git commit -m "fix(init): refuse a new intent when the evidence report blocks one"
```

Use the paths your chosen option actually touched.

---

### Task 2: Give every `check` step a CI job

**Files:**
- Modify: `.github/workflows/check.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: a CI configuration whose jobs cover every step of `npm run check`. Task 10's push depends on it.

`check.yml` has four jobs: `lint`, `bootstrap-executor`, `suite`, `e2e`. `package.json`'s `check` runs five things: `lint`, `test` (bootstrap plus suite), `test:e2e`, `test:vendor-ingest`, then the build and `git diff --check`. `test:vendor-ingest` was added on 2026-09-05 and `test:suite` excludes the file it runs, so **`tests/integration/ingest/no-user-hooks.test.ts` currently runs in no CI job at all** — the test that proves the ingest invocation loads no user hooks.

- [ ] **Step 1: Add the missing job**

Add a fifth job modelled on `e2e`: checkout, setup-node 24, `pnpm install --frozen-lockfile`, `pnpm build`, then `npm run test:vendor-ingest`. It needs the build for the same reason `suite` and `e2e` do. Give it a timeout with headroom over the measured 30 s local runtime; the vendor binary may be absent on the runner, in which case the test's own `skipIf` handles it.

- [ ] **Step 2: Say in the workflow what happens when the vendor is absent**

The test skips when `claude` is not installed, so on a runner without it this job passes while proving nothing. Write one comment saying so, and say where the guarantee actually comes from — the local `check` gate on a machine that has the vendor. A green job that asserts nothing, undocumented, is worse than no job.

- [ ] **Step 3: Reconcile the rest of the file against `package.json`**

Compare every script `check.yml` invokes against `package.json` and report any other drift. The `suite` job already builds first; confirm that is still true.

- [ ] **Step 4: Verify the YAML parses and the job graph is what you intended**

Run: `node -e "const y=require('yaml');const d=y.parse(require('fs').readFileSync('.github/workflows/check.yml','utf8'));console.log(Object.keys(d.jobs))"`

Expected: five job names printed. Do not trigger a workflow run; Task 10 owns the push.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/check.yml
git commit -m "ci: run the vendor-ingest isolation test in its own job"
```

---

### Task 3: One evidence inspection per `init`, passed down

**Files:**
- Modify: `apps/cli/src/bootstrap/executor.ts:626,670,1110,1177,1320,2898,2995`
- Modify: `apps/cli/src/commands/init.ts:818`
- Test: `apps/cli/src/bootstrap/executor.test.ts` (one new case; never run the file in full)

**Interfaces:**
- Consumes: Task 1's green tree.
- Produces: an inspection result threaded through the executor rather than re-derived. Later tasks measure against this.

`inspectBootstrapEvidenceAdmission` is called eight times during one `init` — seven inside the executor and once from `init.ts:818` before the executor is entered — and each call re-walks the filesystem from scratch. Nothing is passed from one call to the next.

- [ ] **Step 1: Write the failing test that counts inspections**

Add a case asserting that one `init` performs exactly one evidence inspection. Count it by injecting a counting wrapper around the reader the inspection uses, following how that file's existing fixture injects dependencies — read `executor.test.ts`'s fixture construction before writing this, and use its mechanism rather than a new one. The assertion is a number, so state the expected number and let the test print the actual.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --root apps/cli src/bootstrap/executor.test.ts -t "<your case name>"`

Expected: FAIL, reporting eight (or whatever the current tree gives). Record the number verbatim; it is this task's before measurement.

- [ ] **Step 3: Thread the inspection**

Compute the inspection once at the earliest point that needs it and pass the result down to the seven call sites. Where a call site needs a *fresh* view because the filesystem has changed since — the `evidenceAfterLock` site at `:1320` is the obvious candidate — keep that one and say in a comment why it cannot reuse the earlier value. **Do not collapse a call site whose whole purpose is to observe a change.** Your report must name each of the eight sites and say whether it now reuses or re-inspects, with the reason.

- [ ] **Step 4: Verify the count and that nothing regressed**

Run the counting case, then run three representative cases from `executor.test.ts` by name, chosen to cover a fresh init, a resume and a rollback. Record all four results and the wall time of each.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/bootstrap/executor.ts apps/cli/src/commands/init.ts apps/cli/src/bootstrap/executor.test.ts
git commit -m "perf(bootstrap): inspect evidence once per init and pass it down"
```

---

### Task 4: Stop re-projecting the same retained directory tree

**Files:**
- Modify: `apps/cli/src/bootstrap/retention.ts:258-338`
- Modify: `apps/cli/src/bootstrap/report.ts` at the projection call sites (359, 363-364, 378-379, 423, 435, 440, 542, 568, 822)
- Test: `apps/cli/src/bootstrap/report.test.ts`

**Interfaces:**
- Consumes: Task 3's threaded inspection.
- Produces: a projection that is computed once per distinct path per inspection.

`projectBootstrapRetentionPostimage` walks a retained directory tree twice per call, deliberately, comparing the two reads to detect a change under it. That double read is a correctness property and **must survive**. What must not survive is calling it ten times for the same path during one inspection, including once per location inside a loop at `report.ts:822`.

- [ ] **Step 1: Write the failing test**

Add a case asserting that one `inspectBootstrapEvidenceAdmission` over a fixture with one retained directory projects that directory exactly twice — the anti-TOCTOU pair — and not more. Count with a wrapper around the tree walk, the same injection style as Task 3.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --root apps/cli src/bootstrap/report.test.ts -t "<your case name>"`

Expected: FAIL with a count well above two. Record it.

- [ ] **Step 3: Memoize per inspection, not globally**

Cache the projection keyed by canonical path, for the lifetime of one inspection only. A cache that outlives an inspection would return a stale postimage after the tree changed, which is the exact failure the double read exists to catch — say that in one comment. Do not weaken or remove the double read.

- [ ] **Step 4: Verify**

Run the new case and the whole of `report.test.ts`. Record the file's wall time before and after; the before number on 2026-09-05 was 109.4 s for a single case in that file.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/bootstrap/retention.ts apps/cli/src/bootstrap/report.ts apps/cli/src/bootstrap/report.test.ts
git commit -m "perf(bootstrap): project each retained tree once per inspection"
```

---

### Task 5: Group the inventory walks and replace the per-location linear scan

**Files:**
- Modify: `apps/cli/src/bootstrap/report.ts:783-786` (the two per-plan walks), `:981-1005` (the initial walk), `:809-811` (the linear scan)
- Test: `apps/cli/src/bootstrap/report.test.ts`

**Interfaces:**
- Consumes: Task 4's memoized projection.
- Produces: one inventory per distinct root set per inspection, and `O(1)` row lookup.

One `inspectBootstrapEvidenceAdmission` performs three directory-tree walks in the common one-plan case: one over `request.initialRoots` at `:984`, then `roots` and `rowParents` per plan at `:783-786`. Several of these re-descend overlapping roots. Separately, `:809-811` scans the `retained` array linearly for every location, twice.

- [ ] **Step 1: Write the failing tests**

Two cases. The first asserts the number of inventory walks for a one-plan fixture, counted by wrapping the reader. The second asserts the row lookup does not scan: build a fixture with many retained rows and assert the lookup is by key, by counting comparisons through the same injection style. If counting comparisons is not practical in this codebase, assert the observable instead — the wall time of a large-fixture inspection against a stated bound — and say in the docblock that the bound is a proxy and why a direct count was not available.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --root apps/cli src/bootstrap/report.test.ts -t "<your case names>"`

Record both failures verbatim.

- [ ] **Step 3: Group the walks and index the rows**

Union the root sets and walk once, then serve each consumer from the single inventory. Build a `Map` keyed by canonical path for the retained rows and look up by key. Keep the walks separate where the roots genuinely differ and a union would widen what is inspected — if that is the case anywhere, say so and leave it, because widening an inspection's scope to save a walk is a security change wearing a performance costume.

- [ ] **Step 4: Verify**

Run both new cases and the whole `report.test.ts`. Record the file's wall time.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/bootstrap/report.ts apps/cli/src/bootstrap/report.test.ts
git commit -m "perf(bootstrap): walk each root set once and index retained rows"
```

---

### Task 6: Uninstall excludes maximal retention roots

**Files:**
- Modify: `apps/cli/src/commands/uninstall.ts:637`
- Modify: `apps/cli/src/bootstrap/report.ts:1111` only if the maximal roots are not already available
- Test: `apps/cli/src/commands/uninstall.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 3-5.
- Produces: `excludedRoots` carrying retention roots rather than every retained path.

`uninstall.ts:637` passes `[paths.brain, ...evidence.retainedPaths]`, and `retainedPaths` is every individual file and directory discovered, not the retained subtrees' roots. `isRemovableAt` (`uninstall.ts:134-144`) already prefix-matches with `containsPathLoosely`, so the roots alone cover every descendant, and the per-file list adds an `O(retained-file-count)` term to every removability check.

- [ ] **Step 1: Write the failing test**

Add a case with a retained tree of many files asserting that `excludedRoots` contains the retention roots and not every descendant, and — this is the part that matters — that a file deep inside a retained tree is still refused removal. The second assertion is what keeps this a behaviour-preserving change rather than a hole.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --root apps/cli src/commands/uninstall.test.ts -t "<your case name>"`

Expected: FAIL on the first assertion, since every descendant is currently present.

- [ ] **Step 3: Pass the roots**

Use the maximal retention roots — `deriveBootstrapRetentionLocations`'s `sourcePath` and `tombstonePath` — instead of the expanded path list.

- [ ] **Step 4: Verify**

Run the whole of `uninstall.test.ts`. Two of its cases were timing out under full-suite load on 2026-09-05; run them individually by name as well and record their times.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/uninstall.ts apps/cli/src/commands/uninstall.test.ts
git commit -m "perf(uninstall): exclude retention roots rather than every retained path"
```

---

### Task 7: Uninstall reads a V2 manifest through the V2-aware store (NEW-59)

**Files:**
- Modify: `apps/cli/src/commands/uninstall.ts:534-585`
- Test: `apps/cli/src/commands/uninstall.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `readUninstallManifest` returning a real V2 manifest instead of a lexically degraded V1 one.

`readUninstallManifest` calls `context.manifests.readOptional()` with no admission context, which rejects every `schemaVersion === 2` manifest and falls into a catch that re-reads the bytes itself and validates them with an identity `admitOwnerPath`, degrading the manifest to V1 with zeroed hashes for `ephemeral` and `directory` artifacts.

- [ ] **Step 1: Write the failing test**

Add a case that writes a V2 manifest and asserts uninstall reports its artifacts with their real hashes rather than zeros, and that the lexical fallback was not taken — assert on the outcome, not on an internal flag, unless the file already exposes one.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --root apps/cli src/commands/uninstall.test.ts -t "<your case name>"`

Record the zeroed-hash output verbatim.

- [ ] **Step 3: Call the store with an admission context**

Recognise the V2 case by `schemaVersion` and call `readOptional(context)` (`packages/core/src/manifest/store.ts:270`) with a real admission context. Keep the fallback for the genuine V1 case if one still exists; if it does not, delete it rather than leaving dead code, and say which you found.

- [ ] **Step 4: Verify**

Run the whole of `uninstall.test.ts` plus `npx vitest run --root packages/core src/manifest`.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/uninstall.ts apps/cli/src/commands/uninstall.test.ts
git commit -m "fix(uninstall): read a V2 manifest through the V2-aware store"
```

---

### Task 8: One canonicalizer and one owner-admission predicate (NEW-51)

**Files:**
- Create: `apps/cli/src/bootstrap/admission.ts`
- Modify: `apps/cli/src/bootstrap/executor.ts:2237-2263`, `apps/cli/src/bootstrap/report.ts:157,503-521`, `apps/cli/src/commands/uninstall.ts:550-560`
- Test: `apps/cli/src/bootstrap/admission.test.ts` (new)

**Interfaces:**
- Consumes: Task 7's V2-aware read.
- Produces: `admission.ts` exporting the canonicalizer and a predicate factory. The three call sites consume it.

**The trap, and it is the whole task.** The three `pathEvidence()` bodies are byte-identical and can merge. The three `admitOwnerPath` bodies are **not**: the executor's does real confinement against the live request's product home and `brainPath`; report's and uninstall's are identity functions that admit every path, because both read a manifest that may have been written by a past `init` with no single live owner in scope. Merging by majority would widen the executor's real check to identity everywhere. Inventing a live `brainPath` for the other two would assert something that may not hold for a historical manifest. **Either outcome is a security regression, and the naive merge is the likely one.**

- [ ] **Step 1: Establish what each call site can honestly confine against**

Before writing code, write down for each of the three sites: what roots are authoritative there, and where they come from. For the executor it is the live request. For report and uninstall, determine whether the manifest being read carries its own declared roots that could serve — if it does, that is the confinement; if it does not, the honest answer is that these sites cannot confine, and the design must make that explicit rather than hide it behind a shared name. Record the answer in your report before Step 2.

- [ ] **Step 2: Write the failing tests**

In `admission.test.ts`, cover at minimum: a path inside the confinement roots is admitted unchanged; a path outside is refused, not silently rewritten; the refusal is observable by the caller. Then, for whichever sites cannot confine, a test pinning that they are explicitly unconfined, with a docblock saying why. An unconfined predicate that is *named* as such is defensible; one that is unconfined by accident is the defect NEW-51 exists to end.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run --root apps/cli src/bootstrap/admission.test.ts`

Expected: FAIL, the module does not exist.

- [ ] **Step 4: Write `admission.ts` and adopt it at all three sites**

One canonicalizer over a guarded no-follow reopen; one predicate factory taking the confinement roots explicitly, so a caller that has none must say so at the call site rather than inheriting a default. Note in a comment that `node:path.resolve` is lexical and never detects a symlink, which is why the three old copies' refusal at `packages/core/src/update/paths.ts:96` could never fire — that is a non-obvious mechanical fact and the reason this task exists.

- [ ] **Step 5: Verify**

Run: `npx vitest run --root apps/cli src/bootstrap/admission.test.ts src/commands/uninstall.test.ts`, then three named cases from `executor.test.ts` covering fresh init, resume and rollback. Record each.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/bootstrap/admission.ts apps/cli/src/bootstrap/admission.test.ts apps/cli/src/bootstrap/executor.ts apps/cli/src/bootstrap/report.ts apps/cli/src/commands/uninstall.ts
git commit -m "refactor(bootstrap): one canonicalizer and one owner-admission predicate"
```

---

### Task 9: Measure, and settle the load-sensitive timeouts

**Files:**
- Modify: `docs/architecture/foundation.md` (the recorded numbers)
- Modify: test timeouts only where a measurement justifies it

**Interfaces:**
- Consumes: Tasks 3-8.
- Produces: the before/after numbers roadmap Phase 2's targets are judged against.

The targets are the retained-init e2e case under 60 s and the executor test file under 10 minutes. On 2026-09-05 the file's second phase alone was 10010 s and a single `report.test.ts` case was 109 s.

- [ ] **Step 1: Measure the file**

Run `npm run test:bootstrap` detached, with output to a file, and record the wall time. This is the one place the full file is run; budget hours and do not run it in the foreground.

- [ ] **Step 2: Measure the suite**

Run `npm run test:suite` detached and record the wall time, the pass/fail counts, and every remaining failure by name. On 2026-09-05 it was roughly 54 minutes over 135 files and 4570 cases, with eight retained-evidence cases timing out at 300 s under parallelism while each passed standalone in 95-115 s.

- [ ] **Step 3: Decide about the timeouts, with the measurement in hand**

If Tasks 3-8 brought those cases well under the timeout, change nothing. If they did not, the choice is between raising the timeout and reducing the parallelism for that file, and it is a real choice: a raised timeout hides a slow test, and reduced parallelism costs wall time on every run. Whichever you choose, record the measurement that justifies it. **Do not raise a timeout without a number.** NEW-29 owns this row; say whether it closes.

- [ ] **Step 4: Record the numbers where they will be found**

Put the before and after in `docs/architecture/foundation.md`, next to whatever that note already says about bootstrap cost, with the date and the command. A number in a commit message is lost; a number in the architecture note is the next person's baseline.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/foundation.md
git commit -m "docs(foundation): record the measured bootstrap cost before and after"
```

---

### Task 10: The first push

**Files:**
- No source changes. This task runs commands and stops for the founder.

**Interfaces:**
- Consumes: green gates from Tasks 1-9.
- Produces: CI green on `development`, or a recorded reason it is not.

`development` held 99 unpushed commits on 2026-09-05 and CI has not run since 2026-08-28. `gh` is authenticated with `repo` and `workflow` scopes. The `baseline` ruleset on `development` carries only `deletion` and `non_fast_forward`, so nothing gates a direct push — which is exactly why this is done deliberately.

- [ ] **Step 1: Run the full gate one more time, detached**

Run `npm run check` detached and record its wall time and result. Every job in `check.yml` mirrors a step of it, so a red gate here is a red CI run you have not paid for yet.

- [ ] **Step 2: Stop and ask the founder**

Report the gate result, the commit count, and the five CI jobs that will run. **Pushing is a founder stop condition; do not push without explicit approval.** Ask specifically whether to push a probe branch first or `development` directly.

- [ ] **Step 3: On approval, push the probe branch and watch every job**

Push to a probe branch, then `gh run watch`. Record each job's result and duration. The `bootstrap-executor` job has a 180-minute timeout and was measured at roughly two hours before this plan's work; compare against Task 9's number.

- [ ] **Step 4: On green, push `development`**

Then confirm CI is green on the exact commit. Do not merge anything; the founder owns merging.

- [ ] **Step 5: Close the rows and advance**

Remove NEW-52, NEW-53, NEW-51, NEW-59 and, if Task 9 settled it, NEW-29 from `BACKLOG.md`, or rewrite each to its unclosed residual. Tick roadmap Phase 2. Set `ORDER.md` `NOW` to roadmap Phase 3 and fix every count in both files. Delete this plan with `git rm` once its surviving constraints are in `docs/architecture/foundation.md`.

- [ ] **Step 6: Run the document gates and commit**

Run: `npx vitest run --root tests repository/citations.test.ts repository/control-bytes.test.ts && npm run lint`

```bash
git add -f docs/superpowers/BACKLOG.md docs/superpowers/ORDER.md docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md
git commit -m "docs: close bootstrap performance and advance to Phase 3"
```
