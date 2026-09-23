# Developer OS Managed Instruction Artifacts (A12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Completed tasks were removed on 2026-09-23; see git history.

**Remaining:** Task 2 Step 3 (billed row), Task 21 Step 4 (real-vendor tests), Tasks 22–26 Steps 3–4
(scan and content review), and Task 29 (phase close). Tasks 1, 3–20, 27 and 28 are committed on
`development` under the D47 lane (lint only); their tests and review are owed at Task 29.

**Goal:** Install, drift-check, reconcile and uninstall every instruction artifact in
`docs/migration/instruction-inventory.md` on both vendors from a local unsigned build, with `doctor`
naming each artifact as `default` or `user`.

**Spec:** `docs/superpowers/specs/2026-09-22-developer-os-instruction-artifacts-design.md`, approved
2026-09-22 (D47). Q1 = local unsigned build only (`trust: "unsigned-local"`).

**Roadmap:** Phase 5 of `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`.
Gate: all inventoried artifacts install, drift-check and uninstall on both vendors; `doctor` names
each as `default` or `user`. Backlog rows owned: A12, NEW-60, NEW-61, NEW-65.

---

## Constraints the open work depends on

- **Lane (D47).** Per task: `npm run lint` (it is `tsc -b`, `eslint` and the repository check), then
  commit with exact-path staging. Agents do not run `vitest`, `npm test`, `npm run test:*`,
  `npm run check`, `tests/integration`, `tests/e2e` or `tests/security`; every deferred suite, the
  fresh-context review and the single push as one PR happen at Task 29. A red `npm run lint` stops
  the task.
- **No push.** Commits are held locally; the orchestrator pushes once, at Task 29, as one branch and
  one PR (`development` has a mandatory `pull_request` rule; a bare push is refused, `GH013`).
- **D46.** Release signing keys are dropped; `LAUNCHER_OFFLINE_RELEASE_ROOTS` stays `[]`; nothing
  here compiles a key or wires the FD 3 handoff.
- **Founder stop points.** Any command that spends model credits, reaches a model or the network,
  needs a vendor login, or reads or writes the live `~/.claude`, `~/.codex`, `~/.developer-os` or a
  real Brain is **not an agent step**. It is marked **FOUNDER STOP** and the task halts there and
  reports. Vendor CLIs may be run by an agent only with `HOME`, `CODEX_HOME` and `XDG_CONFIG_HOME`
  pointing into a fresh `mktemp -d` directory and `CLAUDE_CONFIG_DIR` unset.
- **Clean room (spec §3.3, `docs/migration/exclusion-policy.md`).** No agent reads the legacy
  shared-rules directory, the legacy vault, `~/.claude`, any frozen-source environment path (prefix
  in `tests/repository/self-containment.ts`) or the legacy runtime. This repository is public.
- **Staging.** Stage exact paths only; never `git add -A`, `git add .`, or a wildcard. Confirm with
  `git diff --cached --name-only` before committing. Files under `docs/superpowers/` need `git add -f`.
- **Citations gate.** `tests/repository/citations.test.ts` checks every `path:line` citation in
  tracked documents. Cite by symbol unless the line exists and stays in range.
- **Manifest rewrite stop.** `apps/cli/src/lifecycle/manifest-rewrite.v2.test.ts` pins that an
  ordinary gated transaction may replace `paths.manifestFile` (spec §6.1). If it fails at phase
  close, **stop the phase**: the attach/detach/init/uninstall paths must not be rerouted through the
  lifecycle coordinator's `M(...)` arms without a founder decision.
- **Invariant 3 gate.** Categories whose Claude loading only the billed row can prove (`rule`,
  `scoped-rule`, `output-style`) are held back by `UNPROVEN_CLAUDE_CATEGORIES`. Emptying it is a
  founder decision after Task 2 Step 3 passes. **The phase gate ("all inventoried artifacts
  install") cannot close until it is empty.**
- **Spec amendments** under `docs/superpowers/` are the orchestrator's, applied at Task 29.

---

### Task 2 Step 3: Billed real-agent row (spec §10.2 "real agent") · FOUNDER STOP

Unbilled rows landed in `e498614` (re-pinned by D48, `29e8c36`; findings NEW-101..103, `b1c2f68`).
Owed: this row (NEW-101).

- [ ] **FOUNDER STOP — one paid Claude session.** For every mechanism the unbilled rows could not
  prove (expected: `rule`, `scoped-rule`, `output-style` on Claude), the founder runs one Claude
  session in a disposable home proving the text reached the model, and records it in the
  compatibility matrix (`docs/architecture/claude-adapter.md`, "Observed for A12" section). Until
  that row passes, the category is not installed (invariant 3). If a §4 row's loading proof fails,
  the plan **stops for a founder decision**; it is never downgraded to `unsupported-vendor`.

### Task 21 Step 4: Real-vendor loading and isolation tests · FOUNDER STOP

The Claude, Codex and isolation assertions landed in `084f1ba` (with `7b4a6aa`; NEW-102's Codex
isolation per D52, `5afa493`).

- [ ] **FOUNDER STOP:** run
  `npx vitest run tests/integration/claude tests/integration/codex tests/integration/ingest/instruction-isolation.test.ts`.
  This includes the Claude isolation observation (NEW-103) and the Codex re-observation (NEW-102);
  both stay open until it runs. An isolation failure stops the phase (D8 outranks A12).

### Tasks 22–26 Steps 3–4: Default-content scan and content review

Landed: Task 22 `2a6900b`, review applied `e6f8877` (plus D51's scoped rules `comments`, `testing`,
`lessons-code`); Task 23 output styles `b42e524`, review applied `b661663`, agents `e67243e`;
Task 24 `c711414`; Task 25 `34d9c9e` (D51: `claudeception` and `react-best-practices` linked, not
vendored); Task 26 withdrawn by D51. The clean room applies: no agent opens a legacy path.

- [ ] **Step 3:** Run the CI scan locally as a tool (not vitest):
  `npm run build && node tests/dist/tools/scan-instruction-defaults.js` — Expected: zero findings;
  record the result (not recorded in the content commits). **FOUNDER STOP:** the founder runs the
  same command with `--patterns <private-file>` (a file outside the repository, never committed) and
  reports the finding count.
- [ ] **Step 4:** Independent content review by a fresh agent that authored none of it, over the
  diff only, for `e67243e`, `c711414` and `34d9c9e` (Task 22 and Task 23's output styles are done).
  Accepted findings are fixed with `npm run lint` and exact-path staging of the changed
  `instructions/` files.

### Task 29: Phase close · founder

Consumes every item above.

- [ ] **Step 1 (orchestrator):** apply the §11 spec amendments under `docs/superpowers/` (umbrella
  §9.1/§9.3/§9.4, Spec 1 §6, Spec 2 §6.1 and §3's `unsigned-local` trust state), each
  "Amended <date> (A12)"; `git add -f` each on its own line.
- [ ] **Step 2 (FOUNDER STOP):** run `npm run check` and every deferred suite:

  ```bash
  npx vitest run --root packages/core src/update/release.test.ts src/index.test.ts
  npx vitest run --root apps/cli src/update/packaged-release.test.ts
  npx vitest run tests/repository/instruction-defaults.test.ts tests/repository/instruction-coverage.test.ts tests/tools/scan-instruction-defaults.test.ts
  npx vitest run --root apps/cli src/update/local-release.test.ts src/main.test.ts src/commands/doctor.test.ts
  npx vitest run --root apps/cli src/commands/init-local-release.v2.test.ts
  npx vitest run --root packages/core src/manifest/instruction-block.test.ts src/index.test.ts
  npx vitest run --root packages/core src/instructions src/index.test.ts
  npx vitest run --root packages/core src/lifecycle/absent-manifest.test.ts
  npx vitest run --root apps/cli src/bootstrap/instructions-user-data.v2.test.ts
  npx vitest run --root packages/core src/manifest src/index.test.ts
  npx vitest run --root apps/cli src/lifecycle/manifest-rewrite.v2.test.ts
  npx vitest run --root apps/cli src/instructions/sources.test.ts
  npx vitest run --root apps/cli src/bootstrap/admission.test.ts src/instructions/vendor-homes.test.ts
  npx vitest run --root packages/adapter-claude
  npx vitest run --root packages/adapter-codex
  npx vitest run --root apps/cli src/instructions/codex-registration.test.ts
  npx vitest run tests/contracts/adapters tests/tools
  npx vitest run --root apps/cli src/instructions/attach.test.ts
  npx vitest run --root apps/cli src/instructions/detach.test.ts
  npx vitest run --root apps/cli src/instructions/apply.test.ts src/main.test.ts
  npx vitest run --root apps/cli src/commands/init-instructions.v2.test.ts
  npx vitest run --root apps/cli src/lifecycle/uninstall-detach.v2.test.ts
  npx vitest run --root apps/cli src/lifecycle/schema-registry.test.ts src/commands/doctor.test.ts
  npx vitest run --root apps/cli src/commands/doctor-instructions.v2.test.ts
  npx vitest run --root apps/cli src/bootstrap/executor.test.ts
  npx vitest run tests/contracts/adapters tests/repository/instruction-coverage.test.ts tests/repository/instruction-defaults.test.ts
  ```

  The last line must PASS with exhaustive coverage over the post-D51 set (33 catalog rows,
  `dfd2a3d`). Measure the new v2 files (`init-local-release`, `instructions-user-data`,
  `manifest-rewrite`, `init-instructions`, `uninstall-detach`, `doctor-instructions`) and set the
  `lifecycle-v2` CI job's `timeout-minutes` from the total.
- [ ] **Step 3 (FOUNDER STOP):** Task 21 Step 4 and Task 2 Step 3 above.
- [ ] **Step 3b (FOUNDER DECISION):** once the billed row passes, empty `UNPROVEN_CLAUDE_CATEGORIES`
  (one-line commit, `npm run lint`). The phase gate does not close before this.
- [ ] **Step 4:** one whole-phase fresh-context review by an agent that authored none of Tasks 1–28,
  over the accumulated diff; accepted findings get a failing regression test first, then the
  smallest fix; repeat until no Critical or Important finding.
- [ ] **Step 5:** close NEW-60, NEW-61, NEW-65 and A12 in `BACKLOG.md`/`ORDER.md`; tick the roadmap
  Phase 5 rows; push one branch and open one PR.
- [ ] **Step 6 (FOUNDER STOP, after merge, outside this plan):** reaching the founder's machine is
  the A15 cutover: `npm run pack:local-release -- <dir>` then
  `node apps/cli/dist/bin.js init --local-release <dir> --adapters claude,codex`.
