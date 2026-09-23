# Developer OS Hooks (A13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Completed tasks were removed on 2026-09-23; see git history.

**Open work:** Task 1 (rest) and Task 2 and Task 18 are **founder stop points**: they touch the live
machine, spend model credits, or need manual Codex trust. The agent does not run them. Task 15 is the
one remaining code task and is blocked on Task 1's Codex observations. Task 19 closes the phase.

**Order:** Task 2 runs any time. Task 15 waits for Task 1's Codex rows. Task 18 waits for Task 15.
Task 19 runs last.

**Spec:** `docs/superpowers/specs/2026-09-22-developer-os-hooks-design.md` (A13, approved D47), with
the G1–G10 amendment block (`f3605a7`, `f473a91`).

**Roadmap:** Phase 6 of `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`.
Gate: every supported hook is observed firing on Claude, and on Codex after manual trust.
`session_start_injection` and `plugin_hooks` resolve to `yes` wherever a hook was observed firing.

---

## Founder decisions applied

- **D47 (2026-09-22).** The spec is approved with Q1-A, Q2-A, Q3-A and Q4-A, and the A12 Q1 override
  applies. There is no production release. The product runs from a local, unsigned build. Wherever
  the spec says "launcher", read "the entrypoint A12's local-build install places on disk".
- **D47 lane.** The D44 lane applies to Phases 5–7. Implementers **write** tests but do **not** run
  vitest. The only per-task gate is `npm run lint` (`tsc -b`, `eslint`, repository check, about 11 s).
  Every "run the test" step reads **"deferred to phase close (D47)"**. Fresh-context review and the
  full suite run once, at Task 19. Commits are held locally and never pushed. At close the founder
  pushes one branch and opens one PR.
- **Q1-A.** `command`, `path` and `commit` **fail closed**: a malformed payload, an oversized
  payload, an internal error, or argv refused for one of these kinds all return `block`. `stop`,
  `format`, `prompt`, `edit` and `inject` **fail open**: they return `allow` and write one stderr
  line. `guard` skips the ordinary-command gate. `brain status --inject` keeps it.
- **Q2-A.** `external-hooks` covers Claude only. It reports `event → count` and never a command
  string. On Codex it reports `codex=unknown`. `codex-adapter.md` §2.3 stays unamended.
- **Q3-A.** Firing records live under `<product-home>/state/hooks/`, with the Spec 1 amendments Task 3
  writes and Tasks 7 and 11 implement.
- **Q4-A.** If Task 1 does not observe a skills-directory plugin's `hooks/hooks.json` firing on
  Claude, **stop and ask the founder**. Claude hooks become `unsupported`, and the Codex half
  proceeds alone. Nothing writes `~/.claude/settings.json`, ever.

## Global Constraints

- **Lane (D47).** Per commit, run `npm run lint` and nothing else. Do not run `npx vitest`, any
  `npm run test…` script, or `npm run check`. Tick a test-running step "deferred to phase close
  (D47)". Tests are still **written** in the task that owns the behaviour, red-first in intent.
- **No push, no merge.** Hold every commit locally. The orchestrator alone integrates, and the founder
  pushes once at close.
- **Staging.** Stage exact paths only, never `git add -A`, `git add .` or a wildcard. Confirm with
  `git diff --cached --name-only` before committing.
- **`docs/superpowers/` is globally gitignored.** New files there need `git add -f`, and `git add` of
  those paths exits 1 even for tracked files. Put the `git add -f` on its own line, and never chain it
  with `&&` into `git commit`. Only the orchestrator edits `docs/superpowers/`.
- **Founder stop points.** No agent step starts a real `claude` or `codex` session, runs
  `claude plugin validate` or `codex plugin add` against the real home, reads or writes
  `~/.claude/settings.json` on the live machine, or grants Codex trust. Tasks 1, 2 and 18 are the
  founder's.
- **Transcript gate.** `tests/repository/transcript-path.test.ts` scans `apps/`, `packages/`,
  `tests/` and `workflows/` for the transcript-path field name. No source file, test or fixture this
  plan adds may contain that name as a literal. A test that needs the name builds it at runtime with
  `["transcript", "path"].join("_")`. Recorded fixtures have the key **removed** before check-in.
- **Payload allow-list.** Decoders read fields by explicit path with `Object.hasOwn`. They never
  iterate, spread, `Object.keys`, `Object.entries` or `JSON.stringify` a payload object.
- **stdout.** In hook mode, stdout carries only a `context` payload. Usage text, diagnostics and
  warnings go to stderr.
- **Bounds.** Payload ≤ 1,048,576 bytes, UTF-8 (fatal decode), no NUL. A reason is ≤ 2,048 UTF-8
  bytes and quotes at most 200 bytes of matched input. Injected context is ≤ 16,384 bytes.
  `skill-rules.json` is ≤ 65,536 bytes, with ≤ 200 rules and ≤ 20 keywords per rule. Child caps are
  `tsc` 120,000 ms and formatter 30,000 ms. There are ≤ 16 firing records of ≤ 512 bytes each.
- **Recursion.** Every child a hook spawns gets `env: { DEVELOPER_OS_HOOK_ACTIVE: "1" }` and nothing
  else. Every hook verb returns `allow` immediately when `env.DEVELOPER_OS_HOOK_ACTIVE === "1"`.
- **No vendor spawn.** Nothing reachable from `apps/cli/src/hooks/entry.ts` may import an
  `@developer-os/adapter-*` package, because both package doors re-export `invoke.ts`. Task 5's
  isolation test enforces this.
- **No vendor-config write.** No code writes `~/.claude/settings.json` or any Codex config file.
  `external-hooks` reads `settings.json` no-follow, ≤ 1 MiB, and fails soft to `unknown`.
- **Package direction.** `core ← security ← platform-macos ← cli`. Adapters import core, security and
  workflow-schema. The CLI's hook runtime imports core and security only.
- **Exact export lists.** `packages/core/src/index.test.ts`, `packages/security/src/index.test.ts`
  and both adapters' `index.test.ts` pin their export lists. A task that adds an export updates the
  list in the same commit. The integrator unions concurrent additions and keeps each list's existing
  order rule.
- **Capability parity.** `apps/cli/src/adapter-capability-parity.test.ts` requires the two
  `NOT_USED` lists to change in one commit (Task 12).
- **Citations gate.** `tests/repository/citations.test.ts` checks `path:line` citations in tracked
  documents. Cite by symbol outside fenced blocks.
- **Comments.** Add no code comment unless it records a non-obvious platform fact, a dated past bug,
  or a rejected alternative. Keep existing comments, except for the two no-hooks docblocks in the
  adapters' `plugin.ts`, which Tasks 6 and 15 rewrite to state the new truth.
- **Fixtures.** Synthetic only: temporary homes, injected runners, clocks and filesystems. Every
  enumerating test asserts that its expected set is non-empty before asserting over it.

---

### Task 1 (rest): Observation spike · founder stop point

**Partial.** Already landed: the observation checklist in `docs/architecture/hooks.md` §1 (`83442c7`),
the unbilled answers and two Claude fixtures, `SessionStart` and `UserPromptSubmit` (`e14a04a`).
Q4-A does not trigger: plugin `hooks.json` fired on Claude. Every row that needs a model turn or Codex
trust is still `founder-deferred`, and no Codex fixture exists.

**Files:**
- Create: `tests/fixtures/hooks/claude/{PreToolUse-Bash,PreToolUse-Edit,PreToolUse-Write,PostToolUse-Edit,Stop}.json`
- Create: `tests/fixtures/hooks/codex/<event>.json` for each Codex event that fires
- Modify: `docs/architecture/hooks.md` (§1 answer slots)

**Interfaces:**
- Consumes: nothing.
- Produces: every `founder-deferred` slot in `docs/architecture/hooks.md` §1 filled with an observed
  answer or `unsupported (<reason>)`; the scrubbed fixtures.

- [ ] **Step 2: FOUNDER runs the observations** in disposable homes and records each payload
  verbatim to a scratch location outside the repository.
  **Status:** Partial: the agent ran the unbilled rows; the billed and Codex-trust rows are owed by the founder.

- [ ] **Step 3: Agent scrubs and checks in the fixtures** that the founder hands over. For each
  fixture:
  - delete the transcript-path key;
  - rewrite every absolute path to start with `/Users/synthetic/`;
  - replace prompt and command text with the synthetic strings the contract tests name
    (`echo synthetic`, `synthetic prompt`).
  **Status:** Partial: 2 of 7 Claude fixtures, 0 Codex fixtures.

  Confirm that `grep -rn "$(printf 'transcript%spath' _)" tests/fixtures/hooks` prints nothing. Fill
  every answer slot in `docs/architecture/hooks.md` §1.

```bash
git add tests/fixtures/hooks docs/architecture/hooks.md
git diff --cached --name-only
npm run lint
git commit -m "test(hooks): record scrubbed vendor hook payload fixtures"
```

### Task 2: Legacy parity check · founder stop point

**Open.** No parity list has been returned; owed by the founder.

Spec §2 parity obligation. The founder runs it outside this repository against the legacy scripts.

**Files:** none in this task. Task 3 carries the spec amendment. Any rule addition lands as an
extra fixture pair and table row in Task 8 or Task 9, or as a follow-up task after them.

**Interfaces:**
- Consumes: nothing.
- Produces: a redacted list of rule additions (D5): rule ID, verb, what it blocks, one block example
  and one near-miss example. An empty list is a valid result.

- [ ] **Step 1: FOUNDER compares §5's rule tables with `bash-danger-guard`, `secret-file-guard`,
  `commit-guard`, `stop-gate`, `format-smart`, `skill-activator` and `shared-file-warn`,** and returns
  the redacted additions list. It must also decide the residuals §11 names: `| /bin/sh`, `| sudo sh`
  and `bash <(curl …)`.
- [ ] **Step 2: Orchestrator** records the list in the spec, in the Task 3 amendment block or a second
  dated block, and adds one task per accepted rule after Task 8 or Task 9. Each added task follows
  Task 8's pattern: a table row, a block fixture and a near-miss allow fixture.

### Task 15: Codex half from the observations · M

**Committed 2026-09-23 under D57** (`4041286` observations, `4e308d2` implementation, `2e75574` and `2bec6a7` review fixes; re-review ACCEPT). Tests written, not run (D56); they run at Task 19.

Spec §3 (Codex column), §4.3, §4.4, §7.2 and §8.1 floors. Every *observe* cell is filled from
`docs/architecture/hooks.md` §1, and no Codex value is guessed. A row Task 1 recorded `unsupported`
renders nothing and is listed for founder acceptance.

**Files:**
- Create: `packages/adapter-codex/src/hooks.ts`, `packages/adapter-codex/src/hooks.test.ts`,
  `apps/cli/src/hooks/fixtures-contract.test.ts`
- Modify: `apps/cli/src/hooks/payload.ts` (`FIELD_MAPS.codex`, `HOOK_TOOL_MATCHERS.codex`),
  `apps/cli/src/hooks/outcome.ts` (`OUTCOME_MAPS.codex`), `apps/cli/src/hooks/firing-records.ts`
  (`HOOK_EVENT_OF.codex`), `packages/adapter-codex/src/plugin.ts`, `plugin.test.ts`, `index.ts`,
  `index.test.ts`, `packages/adapter-{claude,codex}/src/versions.ts` (`DOCUMENTED_FLOORS` for the two
  keys), the Codex install call site from A12, and `apps/cli/src/commands/doctor.ts`
  (`codex=not-rendered` becomes the real check)

**Interfaces:**
- Consumes: Task 1 (the observations and fixtures), Task 5, Task 6 and Task 14 Step 1
  (`renderHookCommand` and `HookCommandExecutable`, two-token form), Task 12 and Task 13. If Task 14
  did not start (Q4-A: Claude hooks unsupported), Task 15 performs Task 14 Step 1's core widening
  first, in its own commit, before Step 1 below.
- Produces: `CODEX_HOOK_ROWS`, `renderCodexHooks(executable: HookCommandExecutable)` (in the manifest
  shape Task 1 observed) and `withCodexHooks(tree, executable: HookCommandExecutable)`, plus the Codex field, matcher, outcome and
  event maps.

- [ ] **Step 1: Write the tests.**
  - **`fixtures-contract.test.ts`:** for every file under `tests/fixtures/hooks/<vendor>/`, and every
    verb whose row is supported on that vendor, run `runHookMode` with the fixture bytes and assert
    the exact exit, stdout and stderr bytes for the fixture's expected outcome. Assert that the
    fixture set is non-empty per vendor. Then run each fixture through a patched variant with the
    transcript key added at runtime, and assert that the decoded payload is identical.
  - **Codex render:** it is byte-exact to §4.1; two renders are identical; the checked-in tree stays
    hook-free. Replace `plugin.test.ts`'s `ships no hooks file, no AGENTS.md, and no absolute path`
    with the install-tree-only assertion, mirroring Task 6.
  - **Patch grammar (only if Task 1 observed a patch body):** header lines only; at most 64 headers;
    each names one relative path with no `..`; any other line refuses. `path` blocks and
    `format`/`edit` allow.
  - `CODEX_UNTRUSTED_HOOK_MESSAGE` appears for an installed Codex hook with no record.
- [ ] **Step 2: Run the tests.** Deferred to phase close (D47).
- [ ] **Step 3: Implement** exactly the observed values:
  - fill the four Codex maps;
  - add `CODEX_HOOK_ROWS`;
  - render the manifest `"hooks"`, inline or as a file per question 7;
  - set the `DOCUMENTED_FLOORS` for `plugin_hooks` and `session_start_injection` on both vendors to
    the observed versions from question 10;
  - pass `withCodexHooks` at A12's Codex install call site;
  - make `init` and `doctor` print the fixed manual trust step, and make uninstall print the fixed
    trust-residue line (§7.2).

  Hook-manifest changes reach Codex only after `codex plugin add` runs again. Confirm that A12's
  re-registration covers the hook manifest (NEW-61), and add a test at its seam.
- [ ] **Step 4: Gate.** `npm run lint` must pass.
- [ ] **Step 5: Commit.** Stage the exact paths. Then:

```bash
git diff --cached --name-only
git commit -m "feat(adapter-codex): render observed Codex hooks and decode Codex payloads"
```

### Task 18: Real-agent matrix · founder stop point

**Open.** Founder real-agent matrix; not run.

Spec §10.2 and the roadmap gate.

**Files:** the founder's evidence notes in `docs/architecture/hooks.md` §4. The agent transcribes
them.

**Interfaces:**
- Consumes: Tasks 14, 15 and 16, on a disposable local-build install.
- Produces: one row per supported §3 row per vendor, each with an observed **effect** and a firing
  record present afterwards.

- [ ] **Step 1: FOUNDER, Claude, disposable `HOME`, real session.** Observe each of these:
  - a planted `curl … |` ⏎ `sh` is **not executed**;
  - a `.env` write is **refused**;
  - a `git push --force` is refused;
  - a type error **prevents stop**, and the second stop is allowed by the loop flag;
  - the formatter **changed the file**;
  - the project-note title **appears in the first turn**;
  - a matching skill rule **appears in context**;
  - a shared-file symlink edit **yields the advisory**.

  `doctor` then reports `plugin_hooks=yes` and `session_start_injection=yes`.
- [ ] **Step 2: FOUNDER, Codex.** Before manual trust, the hooks are observed **not** firing. After
  manual trust, the same effects as Step 1 are observed for each supported row.
- [ ] **Step 3: FOUNDER, isolated `ingest` on each vendor** with the product hooks installed: no
  firing record appears and no injected content appears (§6.3). **If either vendor fails, Phase 6
  stops** until the adapter's argv is amended.
- [ ] **Step 4: Agent transcribes** the founder's results into `docs/architecture/hooks.md` §4, and
  lists any `unsupported (<reason>)` row for founder acceptance. Commit that file alone.

### Task 19: Phase close

**Open.** Nothing below has run.

**Files:** only what the fix round touches, plus the orchestrator's `docs/superpowers/` bookkeeping.

**Interfaces:**
- Consumes: every task.
- Produces: a green `npm run check`, one fresh-context review with no Critical or Important findings
  left, and the roadmap Phase 6 gate ticked with evidence.

- [ ] **Step 1: FOUNDER, or the orchestrator on the founder's instruction,** runs the full suite
  locally: `npm run check`. That includes the `bootstrap-executor`, `lifecycle-v2` and e2e suites.
  Record the result. It must cover every test written under the D47 lane and never run:
  - Task 4 (`a3f9e46`): `packages/security/src/{shell-command,process,index}.test.ts`
  - Task 5 (`0e8cbd5`): `apps/cli/src/hooks/{argv,payload,outcome,entry,project-root,isolation}.test.ts`,
    `apps/cli/src/main.test.ts`
  - Task 6 (`3ead7b8`): `packages/core/src/hooks/contract.test.ts`, `packages/core/src/index.test.ts`,
    `packages/adapter-claude/src/{hooks,plugin,index}.test.ts`
  - Task 7 (`986faf4`): `packages/core/src/hooks/firing-records.test.ts`,
    `packages/core/src/lifecycle/absent-manifest.test.ts`,
    `apps/cli/src/lifecycle/{uninstall,absent-manifest-uninstall,mutation-gate}.v2.test.ts`
  - Task 8 (`ef00f07`, `fe1d21a`): `apps/cli/src/hooks/guards/{command,commit,path}.test.ts`
  - Task 9 (`49010f2`, `f53078b`): `apps/cli/src/hooks/guards/{stop,format,prompt,edit}.test.ts`
  - Task 10 (`ae27d01`): `apps/cli/src/hooks/inject.test.ts`, `packages/brain/src/service.test.ts`
  - Task 11 (`b49939e`): `apps/cli/src/bootstrap/executor.test.ts` (the 330-minute
    `bootstrap-executor` job)
  - Task 12 (`9a3838f`): `apps/cli/src/hooks/{firing-records,contract-parity}.test.ts`,
    `apps/cli/src/adapter-capability-parity.test.ts`,
    `apps/cli/src/commands/{claude,codex}-capabilities.test.ts`,
    `packages/adapter-{claude,codex}/src/capabilities.test.ts`
  - Task 13 (`c69031e`): `apps/cli/src/commands/doctor.test.ts`, `tests/e2e/foundation.test.ts`
  - Task 14 (`416ec8e`, `a156b0c`): `apps/cli/src/commands/init-instructions.v2.test.ts`,
    `apps/cli/src/instructions/attach.test.ts`
  - Task 15: its own tests, once it lands
  - Task 16 (`8133c92`): the timeout pin in `packages/adapter-claude/src/hooks.test.ts`, and the CI
    half of the latency measurement (G5)
  - Task 17 (`b583ac3`): `tests/repository/citations.test.ts`
- [ ] **Step 2: Fresh-context review** by an agent that authored none of Tasks 4–17, over the whole
  phase diff, with `superpowers:requesting-code-review`. It must cover these points specifically:
  - every fail-closed path really exits 2;
  - no stdout line outside a `context` outcome;
  - no payload iteration;
  - no adapter import from the hook graph;
  - no `settings.json` write;
  - `state/hooks` is removed only after the plugin trees.

  For each accepted finding, write a failing regression test first, then the smallest fix. Stage
  exact paths.
- [ ] **Step 3: Orchestrator bookkeeping.**
  - Tick Phase 6 in the roadmap with its evidence.
  - Remove A13 from `ORDER.md`'s product path, and set the "now" line to A14.
  - Move this plan's surviving constraints into `docs/architecture/hooks.md` and delete the plan,
    unless a carved-out task keeps it alive, as D42 did.
  - Put `git add -f` of each `docs/superpowers/` path on its own line.
- [ ] **Step 4: FOUNDER** pushes one branch and opens one PR (D44 and D47).
