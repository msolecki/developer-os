# Knowledge Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `capture`, `review` and `ingest` as commands that run, so the three shipped skills that name them stop naming nothing, and a synthetic observation travels from an agent's own words to a canonical note that `brain search` returns in the next invocation — under secrets, prompt injection, malformed model output and process interruption.

**Architecture:** Three CLI verbs over one data type. `capture` redacts first, then normalizes, hashes, and writes one Markdown file into `content/_raw/quarantine/` through Foundation's `TransactionExecutor`. `review` moves that file's status and brings a hand edit back under the product's guarantees by re-redacting it. `ingest` sends the *redacted* envelope body to a vendor agent invoked with **zero declared write scopes**, receives a structured proposal, runs nine deterministic validators over it, and — if every one passes — writes staging itself and applies one transaction, then reindexes. This is the first subsystem in the program that executes a workflow verb; every subsystem before it emitted, validated or rendered.

**Tech Stack:** TypeScript strict, zod 4.4.3, Vitest, pnpm workspaces, Node 24.16.0.

**Design of record:** `docs/superpowers/specs/2026-07-21-developer-os-knowledge-pipeline-design.md`, **approved by the founder 2026-08-13**. Where this plan and that spec disagree, the spec wins. Its **§10 is normative for vendor surfaces — do not depend on a surface §10 does not carry.**

**Read before touching this subsystem, in this order:** `docs/architecture/codex-adapter.md`, `docs/architecture/claude-adapter.md`, `docs/architecture/brain.md`. DOS-P6 is the first subsystem that consumes *both* adapters, and the two notes are written for exactly that reader. `codex-adapter.md` §11 and `claude-adapter.md` §9 name thirteen residuals this plan discharges.

## Global Constraints

Every task's requirements implicitly include this section. Each line is the spec's or the repository's, with the section that carries it.

- **Redact before truncating, hashing, logging, persisting, or sending to a model.** Absolute (spec §5.1, design spec §13.2). The raw text exists only in memory: it is never written, never logged, never hashed and never reaches a model.
- **`transcript_path` is never opened, on any code path** (spec §2.3). `tests/repository/transcript-path.test.ts` enforces it and this plan does not weaken it.
- **No hooks ship. `developer-os run claude|codex` is never built. Nothing automatic captures anything** (spec §3.1). A capture happens because an agent or a person ran a command.
- **The model is invoked with zero declared write scopes** (spec §3.3). Developer OS writes staging; the agent returns a proposal and nothing else.
- **No capture is ever deleted** — not on reject, not on ingest, not on uninstall (spec §2.5).
- **Nothing reaches a network** except the vendor's own agent CLI, through `packages/security`'s runner, during ingest (spec §2.7).
- **Every filesystem mutation follows** `plan → backup → stage → validate → apply → verify → finalize`, through `TransactionExecutor`. A capture is not a special case that may append directly (spec §5.1).
- **A validator refusal leaves the capture `accepted` and retryable, never `ingested`.** `failed` describes a capture whose *own* envelope is unreadable and nothing else (spec §5.5).
- **`CAPTURE_STATUSES` is frozen, in order, and gains no seventh member** (spec §5.5). `packages/brain/src/schema/capture.ts` already pins it.
- **`CaptureEnvelopeV1` is frozen.** This subsystem fills it in; it does not redesign it (spec §5.3). Widening `CaptureRedactionFinding` to carry a location is a decision, not a gap to fill in passing — that docblock says so.
- **The redaction key is never logged, never in `--json`, never in `installation-manifest.json`, never backed up, never staged by Git** (spec §8.4).
- **Fixtures are synthetic.** No real vault, no real client name, no real repository, no copied third-party content.
- **A gate that can pass by scanning nothing is not a gate.** Every check that sweeps a set asserts the set is non-empty, **per scope**, not in total.
- **Sorting is by code point; normalization precedes de-duplication** (inherited from DOS-P3).
- **Dependency direction is one-way:** `core` ← `security` ← `workflow-schema` ← each adapter. Neither adapter may import the other.
- **A package is entered only through its `index.ts`**, never a module inside it.
- **No absolute machine path in any artifact checked into this repository.** This repository is public.
- **Exact-path staging.** Never `git add -A`. Before every commit: `npm run check`. Show failures only.
- **Every task gets a fresh-context review by an agent that is not its author**, with the constraints, the exact file list, and instructions to review only. After it returns, run `git status --short` and `git diff` yourself to prove it did not touch the tree.

## Five decisions this plan takes before the tasks that depend on them

Each is recorded with its cost. Four of the five are registered in `BACKLOG.md` §8 and were **ratified by the founder on 2026-08-13**, together with the two more that Tasks 12 and 15 raised — an approved document is not silently rewritten. Decision 3 is not registered and says why.

**1. Five canonical workflows change version, not two.**

Spec §12 names two: `workflows/capture/workflow.yaml` drops `session_end` and `workflows/shared/workflow.yaml` drops `session_start`, both to `2.0.0`. Three more change by the same rule:

- §6.5 adds a `reindex` step to `ingest` and widens its declared write scopes;
- §7.3 adds `brain.readNote` to `brain-search` and widens its declared read scopes;
- §5.6 makes `capture.edit` the verb `workflow-schema.md` §7 records the **`review`** workflow as advertising and lacking — its `decision` input offers `edit` while its only mutating verb is `capture.setStatus`. A verb nothing declares closes nothing, so `review` gains the step. Its declared scopes are unchanged, because `capture.edit` derives the same `content/_raw/quarantine/**` pair — which is why this one is easy to miss.

A step list and a scope set are the contract; `extends` pins `id@version` exactly, so a changed contract under an unchanged version is a workflow that means two different things at one name.

**All five go to `2.0.0`.** The cost is that every rendered skill regenerates in both vendor trees — which was already true, because all five non-shared workflows extend `shared` and `shared` itself changes. Nothing else pins these versions today.

**2. The globs resolve at the handler boundary; the contract keeps canonical names.**

Spec §7.1 makes `EFFECT_VOCABULARY`'s hardcoded `content/` and `_indexes` due here, because this subsystem is the first thing that resolves one against a real filesystem. Two readings were available.

*Rejected:* templating the globs inside the YAML contract, so `scopes.read` reads something like `$brain.contentRoot/_raw/quarantine/**`. That invents a substitution syntax in the workflow schema, needs a validator for it, changes what six workflows say rather than four, and puts a configuration value inside a document whose whole purpose is to be comparable across installs.

*Taken:* `EFFECT_VOCABULARY` keeps canonical vault-relative names, and a new exported `resolveScopeGlob(glob, config)` rewrites the leading `content/` segment to `config.contentRoot` and the `_indexes` segment to `config.indexesDir`. **Every handler and adapter resolves through it before touching a path**; the compiler's declared-versus-derived arithmetic is untouched, so the equality rule stays the checked arithmetic it was designed to be.

The cost, stated plainly: a user whose `contentRoot` is not `content` reads a skill whose declared scopes name `content/**` while the handler enforces their own root. That is a display gap in a document about the *shape* of a workflow, not an enforcement gap — the enforcement is Task 12's write-scope check, which resolves. **Amends `specs/…-workflow-compiler-design.md` §6** with the resolution function rather than with template syntax, which is a narrower amendment than spec §12 anticipated and is registered as such.

**3. `sourceAgent` records `"unknown"` until Task 17 observes a row. This is not an amendment and gets no §8 row.**

Spec §10.3 is normative and already requires it: **until a vendor's row is observed, that vendor is not in the table and detection records `"unknown"`.** Task 8 therefore ships the detection function with an empty table, and Task 17 — the one task that runs a real vendor binary — adds one row per vendor with what was observed and when.

It is recorded here as an ordering consequence rather than as a decision, because the cost must not be discovered later: **every capture written between Task 8 and Task 17 records `sourceAgent: "unknown"` and `sourceAgentVersion: "unknown"`.** Those captures are correct and are never rewritten. A guessed row is exactly the undocumented capability assumption design spec §20 names as a release blocker.

> **Fully discharged 2026-08-20.** Task 17 added Claude's row on 2026-08-15 and could not observe Codex's; NEW-21 added Codex's five days later. The paragraph above should be read as "between Task 8 and 2026-08-15" for Claude and "between Task 8 and 2026-08-20" for Codex. Captures written inside a Codex session in that window record `"unknown"`, are correct, and are never rewritten.

**It gets no `BACKLOG.md` §8 row on purpose.** §8 is the index a reader consults to learn whether the approved document in front of them is still current; a row that changes nothing costs that table its signal.

**4. The program plan's Task 6 hook box cannot be ticked as written, and is rewritten rather than ticked.**

Program plan Task 6's third box says "Restore `hooks/hooks.json` for both adapters in one change — hook bodies, a mechanism that can express an executable bit, and a test that observes a hook firing." Spec §3.1 **declines** hooks, and corrects the stated blocker: a `"type": "command"` handler names a command string, so no executable bit was ever needed — what hooks lacked was content to capture, which a `session_end` hook cannot supply without `transcript_path`.

Spec §12 does not list the program plan among the six documents it amends. **That is a gap in the spec, found while writing this plan**, and it is recorded here rather than routed around: the box is rewritten in Task 19 to state the decline with a cross-reference to spec §3.1, and `BACKLOG.md` §8 carries the row. The box is not ticked, because nothing shipped for it.

**5. The redaction key is removed by `uninstall`, which is an exception to a gate this plan does not own.**

`BACKLOG.md` §7's DOS-P7 gate reads "uninstall removes only manifest-owned artifacts", and spec §8.4 requires `uninstall` to remove a key that spec §3.5 deliberately keeps out of the manifest. Both cannot hold, so the plan takes the exception explicitly rather than letting Task 1 grant itself one in a step.

*Rejected:* making the key a manifest artifact with a hash-exempt flag. That keeps the gate arithmetically intact and defeats the reason the key is out of the manifest — it would be named in `installation-manifest.json`, and therefore reachable by any diagnostic that enumerates it.

*Taken:* `uninstall` removes exactly one named non-manifest path, asserted by a test that also asserts the removal list is otherwise manifest-derived. **Leaving a secret behind after the product is gone is worse than losing fingerprint comparability** (spec §8.4). Registered in `BACKLOG.md` §8 against `BACKLOG.md` §7's own gate, so DOS-P7 inherits the exception as a known one rather than reading its gate as violated.

## Tasks 1 to 16 and 18 — closed, and not described here

**Seventeen tasks landed 2026-08-13/14/15**, each implemented and reviewed by a different agent under
`superpowers:subagent-driven-development`. **Their step lists are deleted rather than kept as ticked
boxes**, on the same rule the program plan applies to its own closed tasks: a closed task carrying a
checklist is a document inviting the next session to redo it, and git history is the archive. Two of
them also carried instructions that are now actively wrong — the `OPTION_NAMES` list Tasks 10, 13 and
14 were each told to update no longer exists, being derived from `Object.keys(OPTIONS)` since Task 14.

What survives them, and what a later reader should open instead:

| Task | What it shipped | Where it now lives |
|---|---|---|
| 1 | the persistent `0600` redaction key, split into a read-only load at the composition root and a create-capable load at each point of use | `apps/cli/src/context.ts`, `init.ts`; `knowledge-pipeline.md` |
| 2 | four redaction classes plus literal, non-backtracking user patterns | `packages/security/src/redaction.ts` |
| 3 | `not-used` replaces `wrapper-required`; six capability keys per adapter | `packages/core/src/capabilities/`, both adapters' `capabilities.ts` |
| 4 | branded plugin-root and marketplace-root artifact arrays; `maxTurns` refused with its owner named | `packages/adapter-codex/src/compose.ts`, `packages/core/src/agent-prompt/` |
| 5 | a handler command per verb, and `capture.edit` | `packages/workflow-schema/src/vocabulary.ts`, `skill.ts` |
| 6 | `resolveScopeGlob(glob, config)` at the handler boundary | `packages/workflow-schema/src/vocabulary.ts`; decision 2 above |
| 7 | five contracts at `2.0.0`, both plugin trees regenerated and drift-gated | `workflows/*/workflow.yaml`, `plugins/claude/**`, `plugins/codex/**` |
| 8 | the capture envelope, its transitions, and the empty `AGENT_DETECTION_ROWS` | `packages/brain/src/capture/` |
| 9 | `developer-os capture` | `apps/cli/src/commands/capture.ts` |
| 10 | `developer-os review`, and the re-redacting edit path | `apps/cli/src/commands/review.ts`, `packages/brain/src/review/` |
| 11 | the per-verb output schemas, and a model call with zero declared write scopes | `templates/schemas/`, `packages/brain/src/ingest/` |
| 12 | the nine validators — `VALIDATOR_IDS` | `packages/brain/src/ingest/validate.ts` |
| 13 | `developer-os ingest`: apply, reindex, and the status ladder, as **four** transactions per capture | `apps/cli/src/commands/ingest.ts`; `knowledge-pipeline.md` §5 |
| 14 | `doctor --probe`, the two-gate model's first production caller | `apps/cli/src/commands/doctor.ts` |
| 15 | `tests/security/` — nine suites, 90 cases, of which 38 carry no watched-failure demonstration | `tests/security/`; the split is `BACKLOG.md` §5 and `threat-model.md` §8 |
| 16 | `tests/e2e/knowledge-lifecycle/` against the compiled binary | `tests/e2e/knowledge-lifecycle/` |
| 18 | the consolidated threat model, which found four defects nobody had looked for | `docs/architecture/threat-model.md`; `BACKLOG.md` §1 NEW-15 to NEW-18 |

**Task 19 Step 4's architecture note is written** — `docs/architecture/knowledge-pipeline.md`, twelve
sections — and it, not this file, is what a later reader needs. This plan is retained only for the
three steps still unticked below, and is deleted by Step 5.

---

### Task 17: One real run per vendor

**Complexity:** M · **Requires the founder, and costs money**

Spec §10.2 is explicit about why this task exists and what it costs. **The JSONL terminal-event rule ships provisional and unverified** (`codex-adapter.md` §7, §11.2): `codex exec --json` streams events as JSONL while `--output-schema` constrains only the final response, so `finalJsonlLine` reduces stdout to the last line that parses as a non-null JSON object — the best available rule, not a verified one. Settling it needs a real `codex exec` call, which invokes a model on the founder's credentials. **The founder declined that spend for DOS-P5 on 2026-08-12 and accepted it for this subsystem on 2026-08-13**, because ingest *is* a real model call and the central path cannot be exercised without one.

**Stop and ask before starting this task.** It spends the founder's credits and runs a vendor binary against a real installation.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-21-developer-os-codex-adapter-design.md` §14.1 — a dated in-place amendment
- Modify: `packages/adapter-codex/src/invoke.ts` — the `finalJsonlLine` docblock
- Modify: `packages/brain/src/capture/agent.ts` and `agent.test.ts` — the observed detection rows
- Modify: `docs/superpowers/specs/2026-07-21-developer-os-knowledge-pipeline-design.md` §10.3 — one row per vendor
- Create: `tests/fixtures/codex/observed-exec-stream.jsonl` — the captured stdout, redacted

> **What it actually touched, recorded 2026-08-15 because the list above was short by eleven files.**
> Adding a detection row is not a local change: it makes `capture`'s probe path live, so every
> docblock and test that had pinned "the table is empty" became false in the same commit. Beyond the
> five above — `packages/adapter-codex/src/invoke.test.ts` (the fixture-backed cases),
> `apps/cli/src/commands/capture.ts` and `capture.test.ts` (two docblocks and two cases whose
> `CLAUDECODE` stand-in stopped meaning "matches nothing"), `tests/security/network.test.ts`,
> `tests/e2e/knowledge-lifecycle/lifecycle.test.ts`, `tests/fixtures/codex/README.md`,
> `docs/architecture/knowledge-pipeline.md`, `codex-adapter.md`, `threat-model.md`, and
> `docs/superpowers/BACKLOG.md` §0, §1 and §8, and this plan itself. **Whoever finishes this task via NEW-21 should expect
> the same fan-out** for the Codex row.

> **Ran 2026-08-15, and half discharged.** The founder had accepted the spend for this subsystem in
> principle on 2026-08-13 and authorised this specific run on 2026-08-15. One real
> `codex exec` was made against `codex-cli 0.147.0` with the production argv byte for byte and stdin
> closed; **the account's usage limit was exhausted**, so it ended `turn.failed` and no run reached a
> model response. There is no API-key fallback configured and no local OSS provider, so `--oss` was not
> an alternative. The founder chose, that day, to **land what was observed and defer the rest** rather
> than wait for the account's usage limit to reset.
>
> **Steps 1 and 2 are done for what a failed turn can show, and say so.** §14.1 carries a dated
> amendment; `tests/fixtures/codex/observed-exec-stream.jsonl` is the recording and its `README.md`
> states the two redactions. Settled: `--json` is JSONL, one JSON object per line; **`type` is a
> discriminating field** on every line; and the vocabulary this package's synthetic tests had guessed
> (`session.created`, `item.completed`, `turn.completed`) is **wrong** — the real one is
> `thread.started`, `turn.started`, `error`, `turn.failed`. **Not settled, and the rule was not
> promoted:** whether a *successful* turn's terminal event is the final response. No event-type filter
> was written either, because §14.1 requires a narrowing to be proven against a stream where the old
> and new rules agree, and a failed turn has no final response for them to agree about.
>
> **Two findings nobody asked this task for**, both pinned by tests: `codex exec` **reads stdin when
> stdin is not a TTY** and blocks, so the production call returns with a result rather than after its
> timeout only because `NodeProcessRunner` closes the pipe — the first attempt at this observation
> hung on it; and the
> failed stream's last parsing line is `turn.failed`, so `finalJsonlLine` alone would return a vendor
> error as a payload, and the `exitCode !== 0` check that precedes it is what prevents that. **That
> ordering was already guarded** by a synthetic non-zero-exit case; what the recording adds is the
> first demonstration of the payload it keeps out.
>
> **Step 3 added one row, not two.** Claude's is `CLAUDECODE=1`, observed on Claude Code 2.1.233 with
> every `CLAUDE*`/`CODEX*`/`ANTHROPIC*` variable stripped from the parent — the first attempt
> inherited them, could not tell a vendor's marker from a leaked one, and was discarded. **Codex's row
> is absent rather than guessed**, per decision 3 and spec §10.3, because no shell command ever ran.
>
> **What remained was `BACKLOG.md` §1 NEW-21, and it closed on 2026-08-20.** The usage limit had
> reset. Five invocations were made with the production argv, producing four distinct observations —
> the schema refusal, one per sandbox branch `invokeCodex` emits, and one testing
> `--output-last-message` — and **this task closed by falsifying two shipped things rather than by
> confirming one.** All four recordings are committed; spec §14.1 tabulates which claim each carries.
>
> **First, the terminal-event rule was wrong, not merely unverified.** A successful turn ends on
> `turn.completed`, a usage record; the response is the `item.completed` before it, whose `item.type`
> is `agent_message` and whose `text` holds the payload as a string. `finalJsonlLine` returned the
> usage record and `parseStructuredPayload` returned *that* with `ok: true` — the boundary reporting
> success over a document with no proposal in it, on every successful Codex run, invisibly.
> `finalAgentMessage` replaces it. The founder chose the in-stream filter over
> `--output-last-message`, which was tested and works and was declined for the vendor-written temp
> file it would add.
>
> **Second, and outside anything this task was scoped to ask: the vendor refuses this product's own
> shipped output schema.** `--output-schema` at `templates/schemas/ingest.stage.schema.json` answered
> HTTP 400 before any turn began — `schemaVersion` carried a bare `const` with no `type` keyword. So
> **`ingest` could never have returned a proposal on Codex**, and every gate had been green over it,
> because nothing in this repository had ever handed that file to the binary. Both copies of the
> schema now carry `"type": "integer"`, and `output-schemas.test.ts` walks every property of every
> shipped schema for a `type` keyword.
>
> **Third, the vocabulary reading of 2026-08-15 was itself too strong** — `item.completed` and
> `turn.completed` are real; only `session.created` is not. A failed turn was never a stream in which
> the other two could have appeared.
>
> **Step 3's row is `CODEX_THREAD_ID`, on presence**, chosen over three others a child of `codex exec`
> also sees: `CODEX_SANDBOX` and `CODEX_SANDBOX_NETWORK_DISABLED` describe the sandbox rather than the
> vendor, and `CODEX_CI` reads as a marker of the non-interactive mode. Spec §10.3 carries the table.
>
> **The fan-out was the predicted size, and one third of it was found by review rather than by a
> test.** This repository has **three** fake Codex vendors, all speaking a dialect no vendor speaks
> since 2026-08-17, when they were written — four days, against the eight the rule itself stood. Two
> of them — `ingest.test.ts` and the e2e lifecycle — went red the moment the
> parser was corrected. The third, `tests/security/helpers.ts`, stayed green, because no security
> fixture has ever installed Codex alone and its branch has therefore never executed; it was corrected
> by hand and the gap registered as NEW-43. Four new fixture files and one `.txt`, all **read** by
> tests rather than only named by them, and their `README.md`.
>
> **What it leaves is `BACKLOG.md` §1 NEW-42 through NEW-47.** The work's own residual is NEW-42: every
> observation of either vendor is of the non-interactive form, and the TUI — where a founder actually
> captures — has never been observed. The other **five** came from two fresh-context reviews of this
> diff: NEW-43 above, NEW-44 (two correct detection rows mis-attribute a nested session, and no row
> order fixes it), NEW-45 (the replacement rule's "last agent message wins" is an inference, since
> every recording holds exactly one), NEW-46 (the trust check named as mitigation for the widened spawn
> trigger does not stop a same-uid `PATH` attack), and NEW-47 (whether a model-run command can write
> raw bytes into the stream this product parses, which decides NEW-45's tie-break and settles from
> vendor source without spending anything).

- [x] **Step 1: Capture raw stdout from one real `codex exec` run** — *a failed turn 2026-08-15, three successful runs 2026-08-20*

The obligation is precise (spec §10.2): record **whether the final response really is the last parsing line**, and **whether it carries a discriminating field worth filtering on**. Redact the captured stream before it is written to a fixture — it is model output on the founder's account, and this repository is public.

- [x] **Step 2: Amend the Codex spec §14.1 with the observed shape, dated** — *amended twice; the rule was never promoted and was **replaced** on 2026-08-20*

**Do not quietly promote the rule to verified.** If the observation contradicts the rule, that is the finding, and `finalJsonlLine` changes in the same commit with a regression fixture. If it confirms it, say so with the date and the version observed, and correct the docblock that currently calls itself provisional.

If the observation shows a discriminating field, filtering on it is a **narrowing** and needs the fixture to prove the old rule and the new one agree on this stream. Record what was given up, as the existing docblock does about pretty-printed JSON.

- [x] **Step 3: Observe one agent-detection row per vendor** — *both rows landed; Claude's 2026-08-15, Codex's 2026-08-20*

Read **decision 3**. Run each vendor and record what its environment actually contains, then add one row per vendor to `AGENT_DETECTION_ROWS` and to spec §10.3, each with what was observed and when. Update the Task 8 test that asserts the table is empty — with the observation in the commit message, so the change from "empty" carries its justification.

> **Landed as one row, not two, on 2026-08-15**, so read "one row per vendor" above as the intent rather than the outcome: Codex's environment was never observed, because its run ended `turn.failed` before any shell command could report one. Per decision 3 and spec §10.3 the row is **absent rather than guessed**, and a test asserts its absence so that a later guess goes red rather than through.

**Anything unrecognised still records `"unknown"`.**

- [x] **Step 4: Run the gate and commit** — *`npm run check` exit 0 at every review round; committed `5c56892`, CI green on it. The commit's own message is the record of the six-round security review, which `ORDER.md` points at rather than repeating*

```bash
npm run check
git add packages/adapter-codex/src/invoke.ts packages/brain/src/capture \
        tests/fixtures/codex docs/superpowers/specs
git commit -m "fix(codex): settle the JSONL terminal-event rule against a real binary"
```

---

### Task 19: Independent security review, and closing DOS-P6

**Complexity:** M

**Required before the checkpoint**, per `BACKLOG.md` §3's gate. This is the gate the two adapters' reviews caught real defects at, and this subsystem has a larger blast radius than either.

- [x] **Step 1: Dispatch the independent security review**

> **Run 2026-08-14/15.** One Critical, two Important and five Minor; every accepted finding fixed
> with a regression test watched fail first, across four fix rounds and four independent verdicts —
> commits `455ae1d`, `2ae7de0`, `1886d5f`, `b49d33a`, `7ae7d15`, `d6bb382`, `4d693bf`. The final
> verdict is **ready for the checkpoint**. Two findings are registered rather than fixed —
> `BACKLOG.md` §1 **NEW-19** and **NEW-20** — and the obligation to record every finding and its
> disposition in the closing commit message belongs to Step 6, not here.

A reviewing agent that **is not the author of any task in this plan**, given: the constraints in this plan's Global Constraints, the exact file list of everything Tasks 1–18 touched, spec §8 and §9, and instructions to **review only — no edits, no commits.** When it returns, run `git status --short` and `git diff` yourself to prove it did not touch the tree.

For every accepted finding: add a regression test first, apply the smallest fix, rerun the gates, request another verdict. Record the findings and their disposition in the closing commit's message — a review whose findings are not written down is a review nobody can audit.

- [x] **Step 2: Verify the checkpoint against the program plan**

> **Verified 2026-08-15 against the tree, not against the table below.** All five criteria hold. The
> verified table, with the suite opened for each, now lives under Task 6's **Test** heading in
> `plans/2026-07-21-developer-os-program.md`, so it survives this file.
>
> **Two corrections to the table below.** The interruption suite drives **35 interruptions across
> five forward transaction kinds**, not fourteen — Task 19's review found it reached two of five and
> it was extended — and collection reports **36 cases** for that file, the thirty-five plus the case
> that measures which of them ran. And the first criterion's evidence is **partly** demonstrated:
> `tests/security/` holds 90 cases of which **38 carry no watched-failure demonstration**, three of
> them in the sentinel suite (`the logs`, `the --json output`, `the deduplication hash`). The
> criterion holds; the strength behind three of its nine artifacts is assertion rather than
> demonstration. `BACKLOG.md` §5 and `threat-model.md` §8 own that split.
>
> **Two stale statements were found and corrected while verifying**, both in Task 18's output:
> `threat-model.md` §1 still listed the relocated-quarantine escape as an unenforced boundary after
> Task 19's own review closed it, and §8's derivation said "the collection above, 83" against 85
> everywhere else in the same paragraph.

Program plan Task 6's five test criteria, each with its evidence named:

| Criterion | Evidence |
|---|---|
| the same secret sentinel is absent from capture, logs, hashes, model input, staging, reports and canonical notes | `tests/security/sentinel.test.ts`, eight per-artifact cases |
| every interruption point returns either the pre-transaction state or a deterministic recoverable state | `tests/security/interruption.test.ts`, fourteen cases |
| duplicate replay is idempotent | Task 9's duplicate cases, plus the end-to-end run |
| model output cannot widen write scope or bypass canonical validators | `tests/security/symlink-escape.test.ts` and Task 12's write-scope cases |
| failure leaves the capture retryable and never marks it ingested | Task 13's status-ladder cases and the interruption suite |

- [x] **Step 3: Tick the program plan's boxes, and rewrite the one that cannot be ticked**

> **Done 2026-08-15.** Nine of the ten boxes are ticked, each naming the task that discharges it. The
> hooks box is **rewritten and left unticked**, stating the decline with its cross-reference to spec
> §3.1 and to `docs/architecture/knowledge-pipeline.md` §2 — nothing shipped for it. The write-contract
> box is ticked **with the clause** that spec §3.3 grants zero write scopes rather than a staging-only
> one, and the security-review box records the run, the finding counts, the seven commits, the final
> verdict, `NEW-19` and `NEW-20`, and that Tasks 1–18 were its scope. One stale sentence in the closed-
> tasks preamble — the one saying the lifecycle capabilities report `wrapper-required` and
> `plugin_hooks` reports `unknown` — was corrected in place rather than left to contradict the box.

Which task discharges which box, so this is not a judgement handed to whoever runs it:

| Program plan Task 6 box | Discharged by |
|---|---|
| approve capture fields, transitions, retention, redaction classes | the spec, approved 2026-08-13; Tasks 2 and 8 implement it |
| ship the `capture`, `ingest` and `review` verbs both vendor trees name | Tasks 5, 9, 10, 13 |
| restore `hooks/hooks.json` for both adapters | **rewritten, not ticked** — see below |
| atomic quarantine writes and post-redaction deduplication | Tasks 8, 9 |
| accept/edit/reject review without automatic deletion | Task 10 |
| invoke agents with source material as untrusted data and a staging-only write contract | Task 11 — **satisfied by something stronger than the box asks.** Spec §3.3 rejects the staging-only reading (the literal reading of design spec §13.4) and grants the agent **zero** write scopes, so the vendor's own sandbox enforces it before the model runs. Tick it with that clause, not silently |
| validate schema, provenance, links, duplicates, confidence, secrets, indexes, generated artifacts, write scope | Task 12 |
| per-file backup, atomic replacement, journal, resume, rollback, **concurrent-edit refusal** | Tasks 9, 10 and 13 use the executor; the interruption and concurrent-edit suites in Task 15 are its evidence |
| sentinel, prompt injection, symlink escape, multiline command, malformed manifest, interruption tests | Task 15 |
| independent security review before the checkpoint | Task 19 Step 1 |

**No task extends `packages/core/src/transactions/`**, which Task 6's file list names. That is correct rather than an omission: Foundation shipped the machinery, and what Task 6 owes is its *hardening against the capture and ingest paths*, which is exercise, not extension. If a task finds the executor genuinely lacking something, that is a Foundation change and it stops to say so.

Read **decision 4** for the third box. It is **rewritten to record the decline**, with a cross-reference to spec §3.1 and to `docs/architecture/knowledge-pipeline.md`. It is not ticked; nothing shipped for it.

- [x] **Step 4: Write the architecture note that replaces this plan**

> **Written 2026-08-15**, twelve sections, every citation re-derived mechanically against the tree
> before the commit. Beyond the list below it carries three things this plan could not have known:
> **§5, the four transactions** — spec §6.1's "one capture, one agent call, one transaction" is false,
> with the two independent reasons no two of them merge and the accepted `staging`-with-notes residual;
> **§9, what the independent security review caught** — the containment check that ran on the raw path
> string while its neighbour ran on the resolved one, and the escalation in which one document
> satisfies both the note parser and the capture parser; and **§10, the residuals with owners**,
> including `NEW-14` through `NEW-20`, the four Foundation requests `ORDER.md` carries, and the
> obligation that a Task 17 diff needs its own security pass, because the review covered Tasks 1–18.

`docs/architecture/knowledge-pipeline.md`, carrying what a later reader needs after this file is gone:

- why capture content is agent-authored, and what that cost;
- the status ladder and why `failed` is not what a refusal produces;
- the nine validators and where each is enforced;
- the redaction key's handling, including the deliberate uninstall exception Task 1 records;
- the resolution rule decision 2 took, and the display gap it leaves;
- **the residuals this subsystem leaves, each with an owner** — including anything spec §13 left open that is still open, and any finding from Step 1 that was accepted as a residual rather than fixed.

- [x] **Step 5: Close the documents, in one commit** — *landed 2026-08-21; what it could not do is below*

- `docs/superpowers/ORDER.md`: A10 → `done`, `NOW` moves to A11, the closed table gains a DOS-P6 row naming `knowledge-pipeline.md` and `threat-model.md`.
- `docs/superpowers/BACKLOG.md`: §3's DOS-P6 entry is removed; §5's two rows leave; §8's **six pending rows** — this plan's decisions 1, 2, 4 and 5, plus the two Tasks 12 and 15 raised — carry their outcome rather than their question, and the spec's own six move from ratified to discharged as each task lands; §1's NEW-13 closes against Task 4.
- **The residual arithmetic is restated from the notes, not copied from the old sentences.** `ORDER.md` and `BACKLOG.md` §3 both say "thirteen of twenty-four" residuals are DOS-P6's; `codex-adapter.md` §11 now has fourteen numbered residuals with eight naming DOS-P6, and `claude-adapter.md` §9 has twelve with four reachable. Count them against the notes as they stand and correct whichever sentence is wrong — this predates the plan, and Task 19 is where a stale count stops being carried forward.
- The spec's status line moves to the past tense and names `knowledge-pipeline.md` as what points at it, per `SESSION.md`'s rule that a spec stays only while another document names it as the design of record.
- **This plan is deleted in the same commit**, after every piece of evidence a later step needs has been carried into the document that needs it. Git history is the archive.

> **What Step 5 did, and the three things in its own list it could not.** It discharged all six
> `BACKLOG.md` §8 rows of 2026-08-13 — and **four of the six had never been cross-referenced into the
> documents they amend**, eight days after ratification, so a reader of design spec §13.4 or §17.5, of
> workflow-compiler §6, or of `BACKLOG.md` §7's own DOS-P7 uninstall gate was getting the superseded
> contract. Writing those four cross-references was most of the step. It also closed §1's **NEW-13**
> against Task 4's brands, which had read `Status: open` for nine days while the code refused the
> misuse at compile time.
>
> **Three items on this step's list presume the subsystem is closed, and it is not.** `ORDER.md`'s A10
> row cannot read `done`, `NOW` cannot move to A11, the closed table cannot gain a DOS-P6 row, and
> `BACKLOG.md` §3's DOS-P6 entry and the spec's past-tense status line cannot follow — because Step 6
> is unticked and the checkpoint names CI green on the commit as one of its three conditions. **This
> plan is therefore not deleted either**, which is the rule working rather than failing: a plan is
> deleted when its last step closes.
>
> **The founder chose on 2026-08-21 to keep the commits local**, as they had for Track R the day
> before. `ORDER.md`'s `NOW` section records A10 as work done with the CI gate unmet, in the same form
> R2's row uses, rather than rounding it up.
>
> **Publication and the exact local gate are now present, but the CI evidence is not.** On 2026-08-24
> the clean local `development`, `origin/development` and `origin/HEAD` all resolved to `c46b82c`.
> A fresh `npm run check` on that commit exited 0: 123/123 test files, 2,335 tests passed, one skipped,
> followed by `tsc -b` and `git diff --check`. The matching remote-tracking ref proves publication,
> not the check result. The founder directed the continuing session not to push, so the checkbox
> stays open rather than inventing that verdict or a second CI run on a closure commit.

- [ ] **Step 6: Run the gate, commit the green tree and observe remote CI** — *the only thing left in DOS-P6; local gate, exact-path commit and publication are present at `c46b82c`; remote CI is unobserved, and the founder directed no push from the continuing session*

```bash
npm run check
git add apps/cli/src/commands/ingest.ts \
        apps/cli/src/commands/ingest.test.ts \
        package.json \
        packages/platform-macos/src/macos.test.ts \
        tests/helpers/temp-home.ts \
        tests/integration/temp-home.test.ts \
        tests/security/interruption.test.ts \
        docs/superpowers/ORDER.md \
        docs/superpowers/BACKLOG.md \
        docs/superpowers/plans/2026-07-21-developer-os-knowledge-pipeline.md
git commit -m "fix: preserve ingest recovery and the local gate"
git push origin development
# Observe the CI run on the pushed commit; do not infer green from the push exit.
```

The command block records the step's required sequence; do not repeat its push. Publication is already
present at `origin/development`. The next evidence is the CI result on `c46b82c`, not another remote
mutation from this session.

After that run is green, close A10 in the canonical documents in one exact-path commit and observe
CI on that closure commit too. Until both runs exist, this box stays unticked and this plan stays.

**A red run that nobody reads is worse than the no CI it replaced.** Watch it.

---

## Checkpoint

**The complete local knowledge lifecycle is production-candidate for synthetic data** — program plan Task 6.

It is met when all five criteria in Task 19 Step 2 hold with their evidence in a commit, the independent security review has returned and its findings are dispositioned, and CI is green on that commit. Not before: a green local tree is the state this repository was already in once, and it cost a week of confusion.
