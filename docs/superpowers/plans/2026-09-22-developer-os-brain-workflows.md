# Developer OS Brain Workflows (A12b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Tasks:** 16. Tasks 1–15 are implementation tasks and run in the waves below. Task 16 closes the phase.

**Goal:** Ship roadmap Phase 5b. That means five Brain workflows rendered for both vendors, note captures with verbatim ingest, the `isolated` and `gap` lint classes, and the `brain retire` and `brain refactor` verbs. Each workflow is proven end to end on a synthetic vault with a fake vendor.

**Architecture:** The spec allows three mutation paths and no others.
- **P1** is the shipped plain capture: a capture that a model then ingests.
- **P2** is a new note capture. `ingest` applies it verbatim, with no model call, as a `create`, or as a `replace` bound to the hash recorded at capture time.
- **P3** is `brain retire` and `brain refactor`, which a person runs.

`packages/brain` stays write-free. It supplies the envelope field, the lint classes, the link resolver and the refactor planners, which return bytes and mutation lists. `apps/cli` executes those through `context.executor`. The workflows are YAML contracts that the existing renderers turn into `SKILL.md` trees.

**Tech Stack:** TypeScript 5.9 strict ESM, Node.js ≥24.16 <25, `yaml`, Vitest 4.1, the existing Foundation `TransactionExecutor`, `@developer-os/workflow-schema` and the adapter renderers.

**Spec:** `docs/superpowers/specs/2026-09-22-developer-os-brain-workflows-design.md`, approved by D47 with every recommended answer (Q1-A, Q2-A, Q3-A and Q4-A). Read it beside this plan. Where the two disagree on a detail that the spec leaves open, this plan's **Plan decisions** section records the choice.

**Roadmap:** Phase 5b of `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`. The gate: each workflow is proven end to end on the synthetic vault with a fake vendor, and once with a real vendor in the compatibility matrix.

**External prerequisite (A12):** none for implementation. The spec's real-vendor gate (§7.3) loads the plugin through `claude --plugin-dir`, so it does not wait for A12's installation wiring (NEW-60 and NEW-61). A12 remains the only way the rendered skills reach a user's vendor configuration, which is a queue-order dependency (`ORDER.md` A12 before A12b) rather than a technical one. **One file-level collision with A12's parallel plan:** both plans regenerate `plugins/claude/**` and `plugins/codex/**` and move the literal counts in `tests/contracts/adapters/{claude,codex}/generated.test.ts`. Whichever plan integrates second reruns both renders and rebases those counts; see Task 8.

---

## Founder decisions applied

- **D47 (2026-09-22).** The spec is approved with every recommended answer:
  - Q1-A: note captures, bound to the hash at capture time.
  - Q2-A: map the three roadmap names to the shipped classes, and add `isolated` and `gap`.
  - Q3-A: `retire` and `refactor` apply only outside agent sessions; inside one they run as a dry run and an applied run exits 5.
  - Q4-A: `brain-report` goes to session output only.
  - The spec's own "decided here unless you say otherwise" defaults also apply: `--plugin-dir` for the vendor gate, no `--yes` on the refactor verbs, and `GAP_MIN_NOTES = 3` as a constant.
  - No production release exists. The product runs from a local, unsigned build.
- **D47 lane (Phases 5–7), which extends D44 and its 2026-09-22 amendment.**
  - Each task commit runs `npm run lint` and nothing else. That script is `tsc -b`, then `eslint`, then the repository check, so it builds and typechecks the tests too.
  - Implementers **write** tests but **do not run vitest**. Every "run the tests" step below reads "deferred to phase close (D47)" and names the command Task 16 runs.
  - Fresh-context review is deferred to one whole-phase review at close.
  - Commits are held locally, with no push. At close they go to one branch as one PR.
  - **Accepted risk:** a defect in a consumed interface surfaces only at close, against every task at once.
- **Credit-spending runs are founder stop points.** No agent runs `npm run test:vendor-brain` or any `claude -p` against a real model. Task 13 writes that test; Task 16 stops and asks the founder to run it.

## Global Constraints

- **Per-commit gate (D47).** Run `npm run lint`. It must exit 0 before the commit. Run no `vitest`, no `npm test…` script and no `npm run check` inside a task. A red lint stops that task.
- **No push.** Commit in the task worktree and stop. Only the orchestrator integrates (D33), and it pushes once, at Task 16, to one branch opened as one PR.
- **Staging.** Stage exact paths only. Never use `git add -A`, `git add .` or a wildcard. Confirm with `git diff --cached --name-only` before committing.
- **`docs/superpowers/` is globally gitignored.** Only the orchestrator edits files there. A new file there needs `git add -f` on its own line, never chained with `&&` into `git commit`, because `git add` exits 1 even for tracked files there.
- **Citations gate.** `tests/repository/citations.test.ts` checks every `path:line` citation in tracked documents. Cite a line outside a fenced block only when it exists and stays in range; otherwise name the symbol. Code comments cite symbols, not lines.
- **Comments.** Add a code comment only when it records a non-obvious platform fact, a dated past bug, or a rejected alternative someone would otherwise restore. Do not strip existing comments.
- **Package direction.** `packages/brain` depends on `core` and `security` only and never writes (spec I4). `apps/cli` executes every mutation through `context.executor` (spec I3).
- **Validators stay nine (I5).** `VALIDATOR_IDS` is not extended.
- **Effect vocabulary (I1).** Exactly one verb is added, `capture.writeNote`, and nothing else.
- **Determinism (I6).** Every planner is a pure function of vault bytes, arguments and the injected date. It orders with `compareCanonical`, then `compareRawBytes`.
- **Byte-exact paths.** Paths are stored and compared byte-exact, and screened only at the terminal (`renderPath`, `screenAndCap`).
- **Environment in tests.** In-process command tests use `createCommandFixture(label, { env })`. Its default `env` is `{}`, and no test reads `process.env`. Compiled-binary tests use `tests/helpers/run-cli.ts`, which gives the child no inherited environment. Only the §6.7 cases set an agent marker.
- **Synthetic fixtures only.** Use temporary homes and the `templates/brain` vault that `init` installs. **`templates/brain` itself is not edited** (Plan decision 1).
- **Enumerating tests** assert that their expected set is non-empty before asserting over it.

## Plan decisions

These are choices where the spec is silent or its wording conflicts with the codebase. Each is reported to the founder as a spec gap.

1. **The garden fixture is planted per test, and the template is not extended.** `templates/brain` is what `init` ships to every user, and `apps/cli/src/commands/brain-template.test.ts` pins it byte for byte. Its INFRA and PROJECTS example notes are already isolated. The e2e tests create the three-note tag after `init`, inside their own temporary vault.
2. **`capture --note` refusal codes**, which the spec does not name:
   - `capture_note_invalid` (exit 2) covers these cases: a bad path string, a note that does not parse, a note over 64 KiB, and a destination that exists but is not a canonical note.
   - `capture_note_path_refused` (exit 5) covers these cases: a destination outside a configured topic folder, one under a private folder or the indexes directory, and one reached through a symlink.
3. **`note_changed_since_capture` surfaces in a new `reason` field.** It is added to each per-capture refusal (`RefusedCaptureV1`, and the `refused[]` entries of `RunReportV1`), typed `"note_changed_since_capture" | null`. Today those entries carry only a numeric `code`. The change is additive.
4. **`IngestResultV1.agent` and `RunReportV1.agent` widen to `AgentName | null`.** They are `null` when every selected capture is a note capture, so that no vendor was resolved. The widening is additive for readers that already branch on the value.
5. **Refactor mode flags are boolean options**, and the spec's two refusals are both kept:
   - As string options, `parseArgs` would consume the note path as the flag's value.
   - Zero mode flags, or two, is a **parse** refusal (usage, `invalid_input`, exit 2), as §6.1 says.
   - Every other §6.9 input fault is `brain_refactor_input_invalid`, exit 2.
6. **The second transaction of retire and refactor is named `brain-refactor-reindex`.** It is the same kind for both verbs. The spec names only the first transaction's kind.
7. **`review` rows also gain `redactionCount`.** The human line the spec asks for prints that count, so the row has to carry it. The change is additive.
8. **`brain-garden`'s prose names `brain refactor` and `brain retire`**, and those verbs land in Task 10, after the workflows land in Task 8. Nothing is released between the two (D47), and the garden e2e test (Task 14) waits for Task 10.
9. **The real-vendor test needs an API key it is handed.** A disposable `HOME` carries no Claude credentials. The test therefore runs only when both `claude` and `DEVELOPER_OS_VENDOR_BRAIN_API_KEY` are present, and passes that key as `ANTHROPIC_API_KEY` into the isolated environment. `test:vendor-brain` is excluded from `test:suite` and is **not** added to `check`. The founder confirms this at the Task 16 stop.

10. **A note that another note cites in `sources` cannot be renamed, moved or merged.** No frontmatter is ever edited (§6.3), so a referrer's `sources` entry would stop resolving. That surfaces as a new `provenance` error, and §6.5's post-condition 2 refuses the refactor with `refactor_postcondition_failed`. The refusal is fail-closed and follows from the spec, and Task 6 pins it. It is still reported as a gap, because it goes beyond R6.

## File and Responsibility Map

| Area | Files | Responsibility |
|---|---|---|
| Lint | `packages/brain/src/lint/lint.ts` | `isolated` and `gap` classes |
| Capture envelope | `packages/brain/src/schema/capture.ts`, `packages/brain/src/capture/{build,render,parse,index}.ts`, `packages/brain/src/ingest/{proposal,index}.ts` | `CaptureEnvelopeV1.note`, the exported proposal path rule |
| Link machinery | `packages/brain/src/indexes/{build,index}.ts`, `packages/brain/src/refactor/links.ts` | offset-preserving wikilink finder, resolver, body rewriter |
| Refactor planners | `packages/brain/src/refactor/{vault,plan,merge,split,index}.ts` | pure plans, §6.5 post-conditions, §6.6 bound |
| Validators | `packages/brain/src/ingest/validate.ts` | `created` kept by a replacing note capture |
| Agent marker | `packages/brain/src/capture/agent.ts` | any-match detection (§6.7) |
| Brain door | `packages/brain/src/index.ts` | union of new exports |
| CLI capture/review | `apps/cli/src/commands/{capture,review}.ts`, `apps/cli/src/main.ts` | `capture --note`, review rows |
| CLI ingest | `apps/cli/src/commands/ingest.ts` | verbatim ingest |
| CLI refactor | `apps/cli/src/commands/{refactor,brain}.ts`, `apps/cli/src/main.ts` | `brain retire`, `brain refactor` |
| Workflows | `workflows/brain-{answer,compile,enhance,garden,report}/workflow.yaml`, `packages/workflow-schema/src/vocabulary.ts` | contracts, `capture.writeNote` |
| Rendered trees | `plugins/claude/**`, `plugins/codex/**` | regenerated by `npm run render:claude` / `render:codex` |
| Contract tests | `tests/contracts/workflows/canonical.test.ts`, `tests/contracts/adapters/{claude,codex}/generated.test.ts` | 11 workflows, §4.4 invariant, counts |
| E2E | `tests/e2e/brain-workflows/{harness,brain-answer,brain-report,brain-compile,brain-enhance,brain-garden}.test.ts` (harness is `.ts`) | §7.2 |
| Vendor gate | `tests/integration/brain-workflows/claude.test.ts`, `package.json` | §7.3, `test:vendor-brain` |
| Security | `tests/security/{note-capture,brain-refactor,interruption}.test.ts` | §7.4 |
| Canonical docs | `docs/architecture/{brain,knowledge-pipeline,threat-model,workflow-schema}.md`, `docs/migration/instruction-inventory.md`, `docs/releases/compatibility-matrix.md`, roadmap, `ORDER.md`, `BACKLOG.md` | Task 16 |

```text
Anchors verified at plan writing (base 13eb18e). Inside a fence so the citations gate ignores them;
line numbers drift, so each task re-locates by symbol.
packages/brain/src/lint/lint.ts          14   LintClass; lintBuild concatenates the class functions
packages/brain/src/indexes/build.ts      228  extractLinks; 350 buildLookups; 414 resolveLink (both private)
packages/brain/src/ingest/proposal.ts    130  pathViolation (private; Task 2 exports it)
packages/brain/src/ingest/validate.ts    186  projectionOf already overlays a replaced path (readFile prefers the virtual map)
packages/brain/src/capture/build.ts      normalizeBody replaces Cc controls with a space (not removal; spec R8 wording)
apps/cli/src/commands/ingest.ts          selectVendor runs before selectCaptures inside runIngest
apps/cli/src/commands/ingest.ts          applyNotes: exists() refusal text pinned by tests/security/malformed-manifest.test.ts
apps/cli/src/commands/ingest.ts          ingestOne: rollback runs only when applied === null and the error is not IngestPreconditionRefusal
apps/cli/src/main.ts                     BRAIN_SUBCOMMANDS { options, query }; COMMAND_POSITIONALS.brain { 1, 2 }
apps/cli/src/lifecycle/admission.ts      V2HomeAdmissionError: name derived from the reason, so failureFrom's kind is the code
tests/contracts/adapters/claude/generated.test.ts  toHaveLength(6) skills, (5) non-shared
tests/contracts/adapters/codex/generated.test.ts   toHaveLength(6) skills, (7) artifacts, (5) non-shared
```

---

## Execution waves (D33)

These waves are derived from each task's `Consumes:` line. A task starts only when every task it consumes has been integrated on the phase branch. The tasks in one wave run in parallel, each in its own worktree outside the repository (`../developer-os.worktrees/a12b-task-<n>`, branch `a12b/task-<n>`, cut from the current integration head).

| Wave | Tasks | Waits for |
|---|---|---|
| 1 | 1, 2, 3 | nothing |
| 2 | 4, 5, 6 | 4: Task 2 · 5: Task 1 · 6: Task 3 |
| 3 | 7, 8, 9 | 7: Tasks 2, 4, 5 · 8: Task 4 · 9: Task 6 |
| 4 | 10, 11, 12, 13 | 10: Tasks 6, 9 · 11: Tasks 4, 7 · 12: Tasks 1, 4, 7, 8 · 13: Tasks 4, 7, 8 |
| 5 | 14, 15 | 14: Tasks 10, 12 · 15: Task 10 |
| 6 | 16 | every task |

**Shared files.** These merge as a union. The integrator keeps each list in its existing order.

- `packages/brain/src/index.ts` takes new exports from Tasks 2, 3, 6, 9 and 10. The integrator takes the union and reruns `npm run lint`.
- `packages/brain/src/refactor/index.ts` is created by Task 3 and extended by Tasks 6 and 9. Same rule.
- `apps/cli/src/main.ts` and `apps/cli/src/main.test.ts` are edited by Task 4 (wave 2) and Task 10 (wave 4). The waves are different, so there is no concurrent edit.
- `packages/brain/src/ingest/validate.test.ts`: Task 5 only.
- `package.json`: Task 13 only.

---

### Task 1: Lint classes `isolated` and `gap` · S

**Done 2026-09-22, `85cd3b9`** (D47 lane: lint only, tests and review owed at phase close).

Spec §5. This task maps the three roadmap names to shipped classes and adds two new ones. Both new classes have severity `info`, so `brain lint`'s exit code does not change.

**Files:**
- Modify: `packages/brain/src/lint/lint.ts`
- Test: `packages/brain/src/lint/lint.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export type LintClass =
  | "frontmatter" | "provenance" | "links" | "duplicates" | "staleness" | "index-drift"
  | "isolated" | "gap";
// module-private in lint.ts (spec: a constant, not configuration)
const GAP_MIN_NOTES = 3;
```

- [x] **Step 1: Write the failing tests**

Add a `describe("isolated")` and a `describe("gap")` to `lint.test.ts`. Build vaults with the file's existing in-memory helpers (`lint/testing.ts`), the way the `staleness` cases do:

```ts
describe("isolated", () => {
  it("flags a note that is neither source nor target of any edge, self-edges excluded", async () => {
    const result = await lintNotes({
      "DEV/a.md": note({ title: "A", body: "[[DEV/b]]" }),
      "DEV/b.md": note({ title: "B" }),
      "DEV/c.md": note({ title: "C", body: "[[DEV/c]]" }), // self-link only
    });
    const found = of(result, "isolated");
    expect(found.length).toBeGreaterThan(0);
    expect(found).toStrictEqual([
      { class: "isolated", severity: "info", path: "content/DEV/c.md", key: null,
        message: "no link to or from this note", line: null },
    ]);
  });
});

describe("gap", () => {
  it("flags a tag on three notes when none of them is a compiled-note, at the lowest path", async () => {
    const result = await lintNotes({
      "DEV/z.md": note({ title: "Z", tags: ["timers"] }),
      "DEV/a.md": note({ title: "A", tags: ["timers"] }),
      "DEV/m.md": note({ title: "M", tags: ["timers"] }),
    });
    expect(of(result, "gap")).toStrictEqual([
      { class: "gap", severity: "info", path: "content/DEV/a.md", key: "tags",
        message: "3 notes share the tag timers and no compiled note covers it", line: null },
    ]);
  });

  it("is silent at two notes, and silent when one of three is a compiled-note", async () => {
    const two = await lintNotes({
      "DEV/a.md": note({ title: "A", tags: ["t"] }), "DEV/b.md": note({ title: "B", tags: ["t"] }),
    });
    expect(of(two, "gap")).toStrictEqual([]);
    const covered = await lintNotes({
      "DEV/a.md": note({ title: "A", tags: ["t"] }), "DEV/b.md": note({ title: "B", tags: ["t"] }),
      "INFRA/c.md": note({ title: "C", tags: ["t"], type: "compiled-note" }),
    });
    expect(of(covered, "gap")).toStrictEqual([]);
  });
});
```

`lintNotes`, `note` and `of` stand for whatever this file's helpers are called. Reuse them, and add a thin wrapper only if nothing fits.

Also cover these cases:
- A tag carrying a control character or a 200-character tag is screened and capped in the message by `renderValue`.
- Neither class raises `errorCount` or `warnCount`.
- Findings stay sorted by the existing `lintBuild` comparator.
- Determinism: the findings are identical under a reversed directory reader.

- [ ] **Step 2: Run the tests and verify they fail** — deferred to phase close (D47)

This run is deferred to phase close (D47). Task 16 runs `npx vitest run --root packages/brain src/lint/lint.test.ts`, where it must pass. There is no red run per task.

- [x] **Step 3: Implement**

In `lint.ts`:
1. Widen `LintClass`.
2. Add `isolatedFindings(build)`. It collects every `source` and `target` of `build.graph.edges` where `source !== target`, then emits one finding for each `build.index.notes` entry whose `path` is in neither set.
3. Add `gapFindings(build)`. For each `build.index.tags` entry whose `paths.length >= GAP_MIN_NOTES`, when no path in it belongs to an `IndexedNote` whose `type` is `"compiled-note"`, it emits a finding at the lowest path (`[...paths].sort((a, b) => compareCanonical(a, b) || compareRawBytes(a, b))[0]`). The key is `"tags"` and the message is `` `${String(paths.length)} notes share the tag ${renderValue(tag)} and no compiled note covers it` ``.
4. Spread both functions into `lintBuild`'s findings array, before `driftFindings`. Import `compareRawBytes` from `../discovery/index.js`.

- [ ] **Step 4: Run the tests** — deferred to phase close (D47)

This run is deferred to phase close (D47).

- [x] **Step 5: Gate and commit**

```bash
npm run lint
git add packages/brain/src/lint/lint.ts packages/brain/src/lint/lint.test.ts
git diff --cached --name-only
git commit -m "feat(brain): add isolated and gap lint classes"
```

### Task 2: `CaptureEnvelopeV1.note` and the exported proposal path rule · S

**Done 2026-09-22, `838d435`** (D47 lane: lint only, tests and review owed at phase close).

Spec §3.2. This task adds the note field to the envelope. Rendering and parsing change only when the field is non-null, and the deduplication hash stays content-only (R3).

**Files:**
- Modify: `packages/brain/src/schema/capture.ts`, `packages/brain/src/capture/build.ts`, `packages/brain/src/capture/render.ts`, `packages/brain/src/capture/parse.ts`, `packages/brain/src/capture/index.ts`, `packages/brain/src/ingest/proposal.ts`, `packages/brain/src/ingest/index.ts`, `packages/brain/src/index.ts`
- Test: `packages/brain/src/capture/render.test.ts`, `packages/brain/src/capture/parse.test.ts`, `packages/brain/src/capture/build.test.ts`, `packages/brain/src/ingest/proposal.test.ts`
- Modify (literal `CaptureEnvelopeV1` sites gain `note: null`): `packages/brain/src/ingest/prompt.test.ts`, `apps/cli/src/commands/review.test.ts`, `tests/security/sentinel.test.ts`. Find any others with `grep -rln "deduplicationHash:" apps packages tests --include=*.ts`; `npm run lint` catches any that are missed.

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
// schema/capture.ts
export interface CaptureNoteTargetV1 {
  /** Content-root-relative, POSIX, byte-exact; passes isUnsafeProposedNotePath === false. */
  readonly path: string;
  /** SHA-256 lowercase hex of the destination's bytes at capture time; null when it did not exist. */
  readonly beforeSha256: string | null;
}
export interface CaptureEnvelopeV1 { /* …existing fields… */ readonly note: CaptureNoteTargetV1 | null; }
// capture/build.ts
export interface CaptureBuildRequest { /* …existing… */ readonly note?: CaptureNoteTargetV1; } // absent = plain capture
// ingest/proposal.ts — the renamed, exported pathViolation (same body)
export function isUnsafeProposedNotePath(path: string): boolean;
```

Export `CaptureNoteTargetV1` and `isUnsafeProposedNotePath` from `capture/index.ts` or `ingest/index.ts` respectively, and from `src/index.ts`.

- [x] **Step 1: Write the failing tests**

```ts
// render.test.ts
it("renders a plain envelope byte-identically to before the note field existed", () => {
  expect(renderCaptureFile({ ...ENVELOPE, note: null })).toBe(PRE_NOTE_FIXTURE_TEXT);
});
it("emits a note mapping after redaction only when note is non-null", () => {
  const text = renderCaptureFile({ ...ENVELOPE, note: { path: "DEV/a.md", beforeSha256: null } });
  expect(text).toContain("note:\n  path: DEV/a.md\n  beforeSha256: null\n---\n");
});
// parse.test.ts
it("round-trips a note target and preserves it rather than recomputing it", () => {
  const note = { path: "DEV/a.md", beforeSha256: "a".repeat(64) };
  const parsed = parseCaptureFile(`${ID}.md`, renderCaptureFile({ ...ENVELOPE, note }), redact);
  expect(parsed.ok && parsed.envelope.note).toStrictEqual(note);
});
it("reads an absent note key as null", () => { /* existing fixture text → envelope.note === null */ });
it.each([
  ["explicit null", "note: null"],
  ["a scalar", "note: DEV/a.md"],
  ["an extra key", "note:\n  path: DEV/a.md\n  beforeSha256: null\n  extra: 1"],
  ["a missing key", "note:\n  path: DEV/a.md"],
  ["an unsafe path", "note:\n  path: ../a.md\n  beforeSha256: null"],
  ["a non-.md path", "note:\n  path: DEV/a.txt\n  beforeSha256: null"],
  ["an uppercase hash", `note:\n  path: DEV/a.md\n  beforeSha256: ${"A".repeat(64)}`],
  ["a short hash", "note:\n  path: DEV/a.md\n  beforeSha256: abc"],
])("refuses %s as unparseable", (_label, block) => {
  expect(parseCaptureFile(`${ID}.md`, withFrontmatterLine(block), redact)).toStrictEqual({ ok: false, reason: "unparseable" });
});
// build.test.ts
it("keeps the deduplication hash content-only, so a note target does not change the id", () => {
  const plain = buildCapture(REQUEST);
  const noted = buildCapture({ ...REQUEST, note: { path: "DEV/a.md", beforeSha256: null } });
  expect(noted.envelope.captureId).toBe(plain.envelope.captureId);
  expect(noted.envelope.note).toStrictEqual({ path: "DEV/a.md", beforeSha256: null });
});
```

`PRE_NOTE_FIXTURE_TEXT` is the expected text an existing render test already pins. Reuse it rather than writing a new one. In `proposal.test.ts`, assert that `isUnsafeProposedNotePath` agrees with `parseIngestProposal`'s `unsafe-path` refusal over that file's existing path cases.

- [ ] **Step 2: Run the tests and verify they fail** — deferred to phase close (D47)

Deferred to phase close (D47). Close runs `npx vitest run --root packages/brain src/capture src/ingest/proposal.test.ts`.

- [x] **Step 3: Implement**

- `schema/capture.ts`: add the interface and the field.
- `build.ts`: set `note: request.note ?? null` in the envelope. Do not touch `redactAndNormalize` or the id.
- `render.ts`: after `redaction`, spread `...(envelope.note === null ? {} : { note: { path: envelope.note.path, beforeSha256: envelope.note.beforeSha256 } })`. List the fields one by one, as the existing comment requires.
- `parse.ts`: add `readNote(fields): CaptureNoteTargetV1 | null | undefined`, where `undefined` means refuse. The rules:
  - A missing key (`!Object.hasOwn(fields, "note")`) reads as `null`.
  - Otherwise the value must be a plain non-array object whose `Object.keys(...).sort()` equals `["beforeSha256", "path"]`.
  - `path` must be a string with `!isUnsafeProposedNotePath(path)` and `screenEnvelopeScalar(path) === path`.
  - `beforeSha256` must be `null` or match `/^[0-9a-f]{64}$/u`.
  - Refuse `unparseable` in the same `if` block as the other required scalars, which puts it before the id check.
  - Put `note` in the returned envelope.
- `proposal.ts`: rename `pathViolation` to `isUnsafeProposedNotePath`, export it, and update its one caller.

- [ ] **Step 4: Run the tests** — deferred to phase close (D47)

Deferred to phase close (D47).

- [x] **Step 5: Gate and commit**

```bash
npm run lint
git add packages/brain/src/schema/capture.ts packages/brain/src/capture/build.ts packages/brain/src/capture/render.ts packages/brain/src/capture/parse.ts packages/brain/src/capture/index.ts packages/brain/src/ingest/proposal.ts packages/brain/src/ingest/index.ts packages/brain/src/index.ts packages/brain/src/capture/render.test.ts packages/brain/src/capture/parse.test.ts packages/brain/src/capture/build.test.ts packages/brain/src/ingest/proposal.test.ts packages/brain/src/ingest/prompt.test.ts apps/cli/src/commands/review.test.ts tests/security/sentinel.test.ts
git diff --cached --name-only
git commit -m "feat(brain): add the note target to the capture envelope"
```

### Task 3: Wikilink occurrences, resolver and body rewriter · S

**Done 2026-09-22, `04e2289`** (D47 lane: lint only, tests and review owed at phase close).

Spec §6.4. This task is the link machinery every refactor mode uses. It does not change `extractLinks` or the index.

**Files:**
- Modify: `packages/brain/src/indexes/build.ts`, `packages/brain/src/indexes/index.ts`, `packages/brain/src/index.ts`
- Create: `packages/brain/src/refactor/links.ts`, `packages/brain/src/refactor/index.ts`
- Test: `packages/brain/src/refactor/links.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
// indexes/build.ts
export interface WikilinkOccurrence {
  readonly index: number;   // offset of "[[" in the body
  readonly length: number;  // through the closing "]]"
  readonly text: string;    // group 1 exactly as written (untrimmed)
  readonly tail: string;    // everything after text and before "]]": "#anchor", "|display", or ""
}
/** The occurrences extractLinks counts, with offsets into the original body. */
export function findWikilinks(body: string): readonly WikilinkOccurrence[];
/** The same tiers and lowest-path choice buildIndex uses; returns the resolved note's vault-relative path. */
export function createLinkResolver(notes: readonly IndexedNote[], contentRoot: string): (text: string) => string | null;
// refactor/links.ts
export function rewriteWikilinks(
  body: string,
  decide: (occurrence: WikilinkOccurrence) => string | null, // replacement for "[[…]]", or null to keep
): { readonly body: string; readonly rewritten: number };
export function withoutAnchor(tail: string): string; // "#h|d" → "|d"; "#h" → ""; "|d" → "|d"
```

- [x] **Step 1: Write the failing tests**

```ts
it("finds exactly the links extractLinks counts, in order", () => {
  const bodies = [
    "see [[A]] and [[DEV/b#h|shown]]",
    "```\n[[in-fence]]\n```\n[[after]]",
    "`[[inline]]` then [[real]]",
    "[[outer [[inner]]",
  ];
  expect(bodies.length).toBeGreaterThan(0);
  for (const body of bodies) {
    expect(findWikilinks(body).map((o) => o.text.trim()).filter((t) => t.length > 0)).toStrictEqual([...extractLinks(body)]);
  }
});
it("carries anchor and display in the tail and offsets that slice back to the link", () => {
  const body = "x [[DEV/b#h|shown]] y";
  const [o] = findWikilinks(body);
  expect(o).toStrictEqual({ index: 2, length: 17, text: "DEV/b", tail: "#h|shown" });
  expect(body.slice(o!.index, o!.index + o!.length)).toBe("[[DEV/b#h|shown]]");
});
it("rewrites only what decide returns and counts it", () => {
  const out = rewriteWikilinks("[[a]] [[b|d]] `[[a]]`", (o) => (o.text === "a" ? `[[z${o.tail}]]` : null));
  expect(out).toStrictEqual({ body: "[[z]] [[b|d]] `[[a]]`", rewritten: 1 });
});
it("resolves through the same tiers as the index", async () => {
  const build = await buildFromNotes({ "DEV/b.md": note({ title: "Bee", aliases: ["bee-alias"] }) });
  const resolve = createLinkResolver(build.index.notes, "content");
  for (const text of ["DEV/b", "DEV/b.md", "b", "Bee", "bee-alias", "bee"]) { // "b": the bare-basename tier strips .md
    expect(resolve(text)).toBe("content/DEV/b.md");
  }
  expect(resolve("nothing")).toBeNull();
});
it.each([["#h|d", "|d"], ["#h", ""], ["|d", "|d"], ["", ""]])("withoutAnchor(%s) is %s", (tail, expected) => {
  expect(withoutAnchor(tail)).toBe(expected);
});
```

`buildFromNotes` and `note` are the same kind of in-memory helpers `lint/testing.ts` and `indexes/testing.ts` provide. Reuse them.

- [ ] **Step 2: Run the tests and verify they fail** — deferred to phase close (D47)

Deferred to phase close (D47). Close runs `npx vitest run --root packages/brain src/refactor/links.test.ts src/indexes`.

- [x] **Step 3: Implement**

In `build.ts`:
- **`findWikilinks`** masks code without moving offsets. It replaces every character of each `FENCED_CODE` match and then each `INLINE_CODE` match with a space, keeping `\n`. It then runs `/\[\[([^\]|#[]+)([^\]]*)\]\]/gu` (the same language as `WIKILINK`) over the masked text, and drops matches whose trimmed text is empty.
  - Add a `ponytail:` comment on this. Masking matches removal except when an inline span would have joined across a removed fence. That pathological case is pinned only by the equality test above. The upgrade path is a shared tokenizer.
- **`createLinkResolver`** wraps `buildLookups` and `resolveLink` and returns `resolution?.note.path ?? null`.
- Export both, plus the type, from `indexes/index.ts` and `src/index.ts`.

In `refactor/links.ts`, implement `rewriteWikilinks` by walking the occurrences in reverse order, so offsets stay valid, and implement `withoutAnchor`. `refactor/index.ts` re-exports both.

- [ ] **Step 4: Run the tests** — deferred to phase close (D47)

Deferred to phase close (D47).

- [x] **Step 5: Gate and commit**

```bash
npm run lint
git add packages/brain/src/indexes/build.ts packages/brain/src/indexes/index.ts packages/brain/src/index.ts packages/brain/src/refactor/links.ts packages/brain/src/refactor/index.ts packages/brain/src/refactor/links.test.ts
git diff --cached --name-only
git commit -m "feat(brain): find, resolve and rewrite wikilinks with offsets"
```

### Task 4: `developer-os capture --note` and note-aware `review` rows · M

**Done 2026-09-22, `d5782fb`** (D47 lane: lint only, tests and review owed at phase close).

Spec §§3.1, 3.3. The capture writes to quarantine only. It reads the destination to prove containment and to bind the hash.

**Files:**
- Modify: `apps/cli/src/commands/capture.ts`, `apps/cli/src/commands/review.ts`, `apps/cli/src/main.ts`
- Test: `apps/cli/src/commands/capture.test.ts`, `apps/cli/src/commands/review.test.ts`, `apps/cli/src/main.test.ts`

**Interfaces:**
- Consumes: Task 2's `CaptureNoteTargetV1`, `CaptureBuildRequest.note` and `isUnsafeProposedNotePath`.
- Produces:

```ts
// capture.ts
export interface CaptureOptions { readonly text?: string; readonly note?: string } // --note <path>, content-root-relative
export interface CaptureResultV1 { /* …existing… */ readonly note: CaptureNoteTargetV1 | null }
// refusal kinds published through failureFrom (class name → kind, as V2HomeAdmissionError does):
//   capture_note_invalid       exit 2
//   capture_note_path_refused  exit 5
// review.ts
export interface ReviewedCaptureV1 {
  readonly captureId: string; readonly status: CaptureStatus;
  readonly note: { readonly path: string; readonly replaces: boolean } | null;
  readonly redactionCount: number;
}
// main.ts: OPTIONS.note = { type: "string" }; COMMAND_OPTIONS.capture = ["text", "json", "note"]
```

- [x] **Step 1: Write the failing tests**

In `capture.test.ts`, use the file's `installedFixture` (real `init`):

```ts
it("quarantines a new-note capture with beforeSha256 null and writes nothing else", async () => {
  const fixture = await installedFixture("note-create");
  const before = await inventory(fixture.paths.brain);
  const result = await fixture.run(fixture.context, { text: NEW_NOTE, note: "DEV/new-note.md" });
  expect(result.ok && result.data.note).toStrictEqual({ path: "DEV/new-note.md", beforeSha256: null });
  const added = (await inventory(fixture.paths.brain)).filter((p) => !before.includes(p));
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((p) => p.includes("/_raw/quarantine/"))).toBe(true);
});
it("binds the SHA-256 of an existing canonical note's bytes", async () => {
  const fixture = await installedFixture("note-replace");
  const target = join(fixture.paths.brain, "content", "DEV", "example-knowledge-note.md");
  const expected = createHash("sha256").update(await nodeFs.readFile(target)).digest("hex");
  const result = await fixture.run(fixture.context, { text: REVISED_EXAMPLE, note: "DEV/example-knowledge-note.md" });
  expect(result.ok && result.data.note?.beforeSha256).toBe(expected);
});
it.each([
  ["../escape.md", EXIT_CODES.invalidInput, "capture_note_invalid"],
  ["DEV/a.txt", EXIT_CODES.invalidInput, "capture_note_invalid"],
  ["_raw/x.md", EXIT_CODES.securityRefusal, "capture_note_path_refused"],
  ["_RAW/x.md", EXIT_CODES.securityRefusal, "capture_note_path_refused"],
  ["_indexes/x.md", EXIT_CODES.securityRefusal, "capture_note_path_refused"],
  ["templates/x.md", EXIT_CODES.securityRefusal, "capture_note_path_refused"],
  ["NOTATOPIC/x.md", EXIT_CODES.securityRefusal, "capture_note_path_refused"],
  ["DEV/.hidden/x.md", EXIT_CODES.securityRefusal, "capture_note_path_refused"],
])("refuses --note %s with exit %i (%s) and writes nothing", async (path, code, kind) => {
  const fixture = await installedFixture(`note-refuse-${String(code)}`);
  const before = await inventory(fixture.paths.brain);
  const result = await fixture.run(fixture.context, { text: NEW_NOTE, note: path });
  expect(result.ok).toBe(false);
  expect(!result.ok && [result.code, result.error.kind]).toStrictEqual([code, kind]);
  expect(await inventory(fixture.paths.brain)).toStrictEqual(before);
});
```

Also cover these cases:
- **Symlinks.**
  - A destination under a symlinked subdirectory of `DEV` refuses 5.
  - A symlinked destination file refuses 5.
- **Note text.**
  - Note text that does not parse refuses 2 and writes nothing.
  - Examples: no frontmatter, a missing `title`, or a duplicate key.
- **Destination that is not a note.** An existing `DEV/readme.md` that fails `parseNote`, and so is not in the index, refuses 2 with `capture_note_invalid`.
- **Size.** Normalized content longer than `MAX_PROPOSED_NOTE_CHARS - 1` refuses 2.
- **`--note` with `--text`.**
  - Works, as the step above shows.
  - With stdin, the fixture's `io` stdin is used.
- **Plain captures are unchanged.**
  - A capture without `--note` has `note: null`.
  - It renders byte-identically to the existing golden case.
- **Duplicates.** A `--note` capture whose normalized text equals an existing plain capture returns `duplicate: true` with that capture's id. It keeps that capture's envelope, which is R3 extended; see Task 16's gap report.

In `review.test.ts`, the listing row of a note capture carries `note: { path: "DEV/new-note.md", replaces: false }` and `redactionCount`. The row of a replace carries `replaces: true`. A plain row carries `note: null`. An `edit` decision on a note capture preserves `note`, which you check by reading the file back through `parseCaptureFile`.

In `main.test.ts`:
- `capture --note DEV/a.md --text x` parses.
- `capture --note` without a value is a usage refusal.
- `review` renders `  <id>  creates DEV/a.md (0 redactions)` and `  <id>  replaces DEV/a.md (2 redactions)`.
- A plain row renders `  <id>` unchanged.

**Update the existing value assertions in the same commit.** `npm run lint` cannot find them. `CaptureResultV1` gains `note` and `ReviewedCaptureV1` gains `note` and `redactionCount`, so any existing `toStrictEqual` or `toEqual` over those objects fails at close. Find them with `grep -rn "duplicate: \|captures).toStrictEqual\|captures).toEqual\|redactionCount" apps/cli/src tests --include=*.test.ts`, add `note: null` (and `redactionCount`) where a plain capture is asserted, and stage every file you change.

- [ ] **Step 2: Run the tests and verify they fail** — deferred to phase close (D47)

Deferred to phase close (D47). Close runs `npx vitest run --root apps/cli src/commands/capture.test.ts src/commands/review.test.ts src/main.test.ts`. It also runs every file changed by the assertion update, plus `npm run test:e2e`, because `tests/e2e/knowledge-lifecycle/lifecycle.test.ts` asserts capture and review results.

- [x] **Step 3: Implement**

`capture.ts`. When `options.note !== undefined`, do the following after `resolveText` and before `buildCapture`. Order matters: nothing is written until every check passes.

1. `isUnsafeProposedNotePath(options.note)` → `CaptureNoteInvalidError`, exit 2.
2. Segment checks on `options.note.split("/")`:
   - The first segment must be byte-equal to one of `resolveBrainConfig(config).topicFolders`.
   - No segment, NFC-folded and lower-cased, may equal a `PRIVATE_FOLDERS` entry or `indexesDir` lower-cased, and no segment may start with `.`.
   - A failure raises `CaptureNotePathRefusedError`, exit 5.
3. Containment. Walk from `<contentRoot>` down each existing component of the destination with `context.fs.lstat`:
   - A symbolic link anywhere is exit 5.
   - Then canonicalize the deepest existing ancestor with `context.guards.canonicalize`. It must lie inside the canonical `<contentRoot>/<topicFolder>`, else exit 5.
4. `buildCapture({ …, note: { path, beforeSha256 } })`. Parse `parseNote(built.envelope.content + "\n")`. It must be `ok` with no `error` issue, else exit 2. `(content + "\n").length` must be `<= MAX_PROPOSED_NOTE_CHARS`, else exit 2.
5. Destination.
   - If `lstat` of it throws ENOENT, `beforeSha256` is `null`.
   - Otherwise it must be a regular file.
   - It must also be a canonical note: `(await new BrainService(dependenciesFor(context, paths.brain, config)).reindex()).build.index.notes.some((n) => n.path === `${contentRoot}/${path}`)`, where `contentRoot` is `brainConfig.contentRoot`, NFC.
   - If either check fails, exit 2.
   - Otherwise `beforeSha256` is the SHA-256 hex of `await context.guards.readText(abs, (h) => h.readFile())`.
   - Build the capture after `beforeSha256` is known. Steps 4 and 5 may be swapped so that `buildCapture` runs once.

Both new error classes extend `CaptureRefusal`. Each sets `this.name` so that `kindOf` yields the kind named above: `CaptureNoteInvalidError` → `capture_note_invalid`, and `CaptureNotePathRefusedError` → `capture_note_path_refused`. `CaptureResultV1.note` is `built.envelope.note`.

`review.ts`: build each listed row with `note: envelope.note === null ? null : { path: envelope.note.path, replaces: envelope.note.beforeSha256 !== null }` and `redactionCount: envelope.redaction.length`. Decisions are unchanged. `edit` already round-trips the envelope through parse and render.

`main.ts`:
- Add the `note` option and the help line `  --note <path>    the note a capture proposes to create or replace (capture)`.
- Pass `note` into `runCapture` only when present, because of `exactOptionalPropertyTypes`.
- `renderReview` appends `` `  ${renderPath(note.path)} (${n} redactions)` `` with `creates` or `replaces` to rows whose `note` is non-null.

- [ ] **Step 4: Run the tests** — deferred to phase close (D47)

Deferred to phase close (D47).

- [x] **Step 5: Gate and commit**

```bash
npm run lint
git add apps/cli/src/commands/capture.ts apps/cli/src/commands/review.ts apps/cli/src/main.ts apps/cli/src/commands/capture.test.ts apps/cli/src/commands/review.test.ts apps/cli/src/main.test.ts
# plus, by exact path, every test file the assertion update changed
git diff --cached --name-only
git commit -m "feat(cli): capture --note binds a destination and review shows it"
```

### Task 5: Validators for a replacing note capture · S

**Done 2026-09-22, `f53a881`** (D47 lane: lint only, tests and review owed at phase close).

Spec §§3.4, 5.1. The projection already overlays a replaced path: `projectionOf`'s `readFile` prefers the virtual map, and `readDir` de-duplicates names. So `duplicate-detection` needs no code change, only a pin. `source-and-provenance` gains the `created` check.

**Files:**
- Modify: `packages/brain/src/ingest/validate.ts`
- Test: `packages/brain/src/ingest/validate.test.ts`

**Interfaces:**
- Consumes: Task 1's `LintClass` values `"isolated"` and `"gap"`, for the pin.
- Produces:

```ts
export interface IngestValidationContext {
  /* …existing… */
  /** Content-root-relative path this proposal replaces (a note capture with beforeSha256 !== null); absent otherwise. */
  readonly replaces?: string;
}
```

- [x] **Step 1: Write the failing tests**

```ts
it("passes a replacing note capture that keeps created and collides only with its own old bytes", async () => {
  const vault = vaultWith({ "DEV/a.md": noteText({ title: "A", created: "2026-01-01" }) });
  const result = await validateProposal(
    proposalOf("DEV/a.md", noteText({ title: "A", created: "2026-01-01", summary: "better" })),
    contextFor(vault, { replaces: "DEV/a.md" }),
  );
  expect(result).toStrictEqual({ ok: true, findings: [] });
});
it("refuses a replacement that changes created, under source-and-provenance", async () => {
  const vault = vaultWith({ "DEV/a.md": noteText({ title: "A", created: "2026-01-01" }) });
  const result = await validateProposal(
    proposalOf("DEV/a.md", noteText({ title: "A", created: "2026-09-22" })),
    contextFor(vault, { replaces: "DEV/a.md" }),
  );
  expect(result.findings.map((f) => f.validator)).toContain("source-and-provenance");
});
it("still refuses a title collision with another note while replacing", async () => {
  const vault = vaultWith({ "DEV/a.md": noteText({ title: "A" }), "DEV/b.md": noteText({ title: "B" }) });
  const result = await validateProposal(proposalOf("DEV/a.md", noteText({ title: "B" })), contextFor(vault, { replaces: "DEV/a.md" }));
  expect(result.findings.map((f) => f.validator)).toContain("duplicate-detection");
});
it("passes all nine when the projection carries only isolated and gap findings (spec §5.1)", async () => {
  // three notes sharing tag "t", none compiled, none linked → isolated ×3 and gap ×1 in projection lint
  const vault = vaultWith({ "DEV/a.md": noteText({ title: "A", tags: ["t"] }), "DEV/b.md": noteText({ title: "B", tags: ["t"] }) });
  const result = await validateProposal(proposalOf("DEV/c.md", noteText({ title: "C", tags: ["t"] })), contextFor(vault));
  expect(result).toStrictEqual({ ok: true, findings: [] });
});
```

`vaultWith`, `noteText`, `proposalOf` and `contextFor` stand for this file's existing fixture helpers. Extend `contextFor` with an optional `replaces`.

- [ ] **Step 2: Run the tests and verify they fail** — deferred to phase close (D47)

Deferred to phase close (D47). Close runs `npx vitest run --root packages/brain src/ingest/validate.test.ts`.

- [x] **Step 3: Implement**

In `sourceAndProvenance`, pass `context`. When `context.replaces !== undefined`, find the proposed note whose `path === context.replaces`.
- Read the current file with `context.brain.readFile(join(vaultRoot, config.contentRoot, context.replaces))` and parse both with `parseNote`.
- Refuse with the message `"a revision must keep the created date of the note it replaces"` when:
  - either file does not parse,
  - the read throws, or
  - the two `frontmatter.created` values differ.

This makes `sourceAndProvenance` async, so `await` it in `validateProposal`. Do not touch `duplicateDetection`.

- [ ] **Step 4: Run the tests** — deferred to phase close (D47)

Deferred to phase close (D47).

- [x] **Step 5: Gate and commit**

```bash
npm run lint
git add packages/brain/src/ingest/validate.ts packages/brain/src/ingest/validate.test.ts
git diff --cached --name-only
git commit -m "feat(brain): a replacing note capture must keep the note's created date"
```

### Task 6: Refactor planner core: retire, rename, move, post-conditions, bound · M

**Done 2026-09-22, `02c2be7`** (D47 lane: lint only, tests and review owed at phase close); refactor `71e0c70`.

Spec §§6.2 (steps 1–4), 6.3 (first three rows), 6.4, 6.5, 6.6. This task is pure. It reads through an `IndexBuildRequest` and returns a plan.

**Files:**
- Create: `packages/brain/src/refactor/vault.ts`, `packages/brain/src/refactor/plan.ts`
- Modify: `packages/brain/src/refactor/index.ts`, `packages/brain/src/index.ts`
- Test: `packages/brain/src/refactor/plan.test.ts`

**Interfaces:**
- Consumes: Task 3's `findWikilinks`, `createLinkResolver`, `rewriteWikilinks` and `withoutAnchor`.
- Produces:

```ts
// refactor/vault.ts
/** Overlays created/replaced files and hides removed ones; everything else reads through `base`. */
export function overlayBuildRequest(
  base: IndexBuildRequest,
  changes: ReadonlyMap<string /* absolute */, string | null /* null = removed */>,
): IndexBuildRequest;
// refactor/plan.ts
export type RefactorModeV1 = "retire" | "rename" | "move" | "merge" | "split";
export type RefactorRequestV1 =
  | { readonly mode: "retire"; readonly note: string }
  | { readonly mode: "rename"; readonly note: string; readonly newName: string }
  | { readonly mode: "move"; readonly note: string; readonly folder: string }
  | { readonly mode: "merge"; readonly source: string; readonly target: string }
  | { readonly mode: "split"; readonly note: string; readonly heading: string };
export interface RefactorMutationV1 {
  readonly operation: "create" | "replace" | "remove";
  readonly path: string;            // content-root-relative, byte-exact
  readonly content: string | null;  // null for remove
  readonly before: string | null;   // bytes read in step 1, for replace/remove; null for create
}
export interface RefactorPlanV1 {
  readonly mode: RefactorModeV1;
  readonly mutations: readonly RefactorMutationV1[]; // sorted: compareCanonical(path) || compareRawBytes(path)
  readonly rewrittenLinks: number;
}
export type RefactorRefusalCodeV1 =
  | "brain_refactor_input_invalid" | "refactor_destination_exists" | "retire_has_referrers"
  | "refactor_postcondition_failed" | "refactor_too_wide";
export class RefactorRefusal extends Error {
  // `reason`, not `code`: in this codebase `code` is the numeric ExitCode (see V2HomeAdmissionError).
  constructor(readonly reason: RefactorRefusalCodeV1, message: string, readonly paths: readonly string[]);
}
export const MAX_REFACTOR_MUTATIONS = 256;
export interface RefactorInputV1 { readonly build: IndexBuildRequest; readonly today: string /* YYYY-MM-DD */ }
export async function planRefactor(request: RefactorRequestV1, input: RefactorInputV1): Promise<RefactorPlanV1>;
/** Internal to the package, shared with Task 9's merge/split. */
export interface ModePlanV1 {
  readonly moves: ReadonlyMap<string, string>;          // old content-root path → new (retire: to _graveyard/…)
  readonly changes: readonly RefactorMutationV1[];
  readonly extraEdges: readonly (readonly [string, string])[]; // split's parent→child
  readonly rewrittenLinks: number;
}
export function rewriteReferrers(state: PreStateV1, moved: string, target: string, dropAnchor: (tail: string) => boolean): { readonly changes: readonly RefactorMutationV1[]; readonly rewritten: number };
export interface PreStateV1 { readonly build: IndexBuildResult; readonly files: ReadonlyMap<string, string>; readonly contentRoot: string; readonly input: RefactorInputV1 }
```

Until Task 9 lands, `planRefactor` refuses `merge` and `split` with `brain_refactor_input_invalid`, message `"not implemented"`.

- [x] **Step 1: Write the failing tests**

```ts
it("retires a note nobody links to or cites: remove + create under _graveyard, bytes unchanged", async () => {
  const input = memoryInput({ "PROJECTS/done.md": DONE, "DEV/other.md": OTHER });
  const plan = await planRefactor({ mode: "retire", note: "PROJECTS/done.md" }, input);
  expect(plan.mutations).toStrictEqual([
    { operation: "remove", path: "PROJECTS/done.md", content: null, before: DONE },
    { operation: "create", path: "_graveyard/PROJECTS/done.md", content: DONE, before: null },
  ]); // byte order: "P" (0x50) sorts before "_" (0x5F)
});
it("refuses retire_has_referrers when another note links to it or lists it in sources", async () => {
  for (const other of [noteText({ title: "O", body: "[[PROJECTS/done]]" }), noteText({ title: "O", sources: ["PROJECTS/done.md"] })]) {
    await expect(planRefactor({ mode: "retire", note: "PROJECTS/done.md" }, memoryInput({ "PROJECTS/done.md": DONE, "DEV/o.md": other })))
      .rejects.toMatchObject({ reason: "retire_has_referrers", paths: ["DEV/o.md"] });
  }
});
it("renames and rewrites only links that no longer resolve, keeping |display and #anchor", async () => {
  const input = memoryInput({
    "DEV/b.md": noteText({ title: "Bee" }),
    "DEV/a.md": noteText({ title: "A", body: "[[DEV/b#h|shown]] [[Bee]] `[[DEV/b]]`" }),
  });
  const plan = await planRefactor({ mode: "rename", note: "DEV/b.md", newName: "c.md" }, input);
  const a = plan.mutations.find((m) => m.path === "DEV/a.md");
  expect(a?.content).toContain("[[c#h|shown]] [[Bee]] `[[DEV/b]]`"); // title-tier and code-span untouched
  expect(plan.rewrittenLinks).toBe(1);
});
it("writes the full path when the basename would be ambiguous after the move", async () => { /* DEV/x.md and TOOLS/x.md */ });
it("refuses a destination that exists", async () => { /* rename onto DEV/c.md present → refactor_destination_exists */ });
it.each([
  ["a non-note", { mode: "rename", note: "DEV/missing.md", newName: "c.md" }],
  ["a slash in new-name", { mode: "rename", note: "DEV/b.md", newName: "x/c.md" }],
  ["an unknown folder", { mode: "move", note: "DEV/b.md", folder: "NOPE" }],
] as const)("refuses %s as brain_refactor_input_invalid", async (_l, request) => { /* … */ });
it("refuses refactor_postcondition_failed when the projection gains an error finding", async () => { /* a referrer's frontmatter sources names the moved note → provenance error appears (sources are never rewritten) */ });
it("refuses refactor_too_wide above 256 mutations before returning a plan", async () => { /* 256 referrers → 258 mutations */ });
it("plans identically under a reversed directory reader", async () => { /* same input, reversed reader → toStrictEqual */ });
```

`memoryInput(files)` builds a `RefactorInputV1` over an in-memory map, using the same pattern `validate.ts`'s `projectionOf` uses. Put it in `plan.test.ts`.

- [ ] **Step 2: Run the tests and verify they fail** — deferred to phase close (D47)

Deferred to phase close (D47). Close runs `npx vitest run --root packages/brain src/refactor`.

- [x] **Step 3: Implement**

`vault.ts`, `overlayBuildRequest`:
- `readFile` returns the overlay value, or throws ENOENT when the value is `null`, or else reads through `base`.
- `readDir` merges `base` entries with the overlay's direct children, minus removed files, the way `projectionOf` does.
- `assertReadable` passes for overlay paths.

`plan.ts`, `planRefactor`:
1. **Pre-state.** Build `buildIndex(input.build)` and a `files` map. The map records every string `readFile` returned, wrapped around `input.build.readFile`.
2. **Validate the request.** Every failure below is `brain_refactor_input_invalid`.
   - Each named note must be in `build.index.notes`. Map through `${contentRoot}/${path}`.
   - `newName` must be one segment ending `.md`, with `!isUnsafeProposedNotePath(newName)` and no `/`.
   - `folder` must be in `config.topicFolders`.
   - `merge` must not name one note twice.
3. **Mode plan (`ModePlanV1`).**
   - **retire.** First refuse referrers. A referrer is any edge where `target === P` and `source !== P`, or any note with a `sources` entry whose candidates hit `P`. The candidates are `s`, `s.md`, `${contentRoot}/s` and `${contentRoot}/s.md`, NFC, the same rule as lint's `sourceResolves`. Then emit `create _graveyard/<note>` with the unchanged bytes, and `remove <note>`.
   - **rename / move.** Emit `remove P` and `create T`. `T` is `dirname(P)/newName` or `folder/basename(P)`.
4. **Referrer rewriting (`rewriteReferrers`).** Take every note `N !== P` that has an edge to `P`. For each occurrence `o` in `N`'s body, from `parseNote`'s `body`, with the header kept byte-exact:
   - An occurrence qualifies when `resolverBefore(o.text.trim()) === P` and `resolverAfter(o.text.trim()) !== T`.
   - `resolverAfter` is built over the projected notes, that is, the notes after moves.
   - The new text is `basename(T, ".md")` when `resolverAfter` of it is `T`, else the content-root-relative `T` without `.md`.
   - Emit `replace N` with `before` taken from `files`.
5. **Destinations.** Every `create` path must not already be in `files` or be a note, else `refactor_destination_exists`. The CLI re-checks on disk.
6. **Bound.** When `mutations.length > MAX_REFACTOR_MUTATIONS`, throw `refactor_too_wide` before returning.
7. **Post-conditions (§6.5)**, on `overlayBuildRequest(input.build, changes)`:
   - (a) Every created or replaced note passes `parseNote` with no `error` issue.
   - (b) Run `lintBuild(projected, { build, readArtifact: () => Promise.resolve(null), today })`. Take the `error` findings whose class is not `index-drift` and compare them by `(class, mappedPath, key)` against the pre-state's error set, where `mappedPath` applies `moves`. Any new entry fails.
   - (c) Compare edges as a multiset of `(source, target)` pairs with self-edges dropped. The pre-state is mapped through `moves` and given `extraEdges`; it must equal the projection's multiset.
   - A failure throws `refactor_postcondition_failed`, naming the first differing finding or edge in the message.

- [ ] **Step 4: Run the tests** — deferred to phase close (D47)

Deferred to phase close (D47).

- [x] **Step 5: Gate and commit**

```bash
npm run lint
git add packages/brain/src/refactor/vault.ts packages/brain/src/refactor/plan.ts packages/brain/src/refactor/index.ts packages/brain/src/index.ts packages/brain/src/refactor/plan.test.ts
git diff --cached --name-only
git commit -m "feat(brain): plan retire, rename and move with post-conditions"
```

### Task 7: Verbatim ingest of note captures · M

**Done 2026-09-22, `e15fbdc`** (D47 lane: lint only, tests and review owed at phase close).

Spec §3.4. A note capture makes no vendor call, checks its precondition before `ingest-stage`, validates as a replacement, and applies `create` or `replace` with `expectedBeforeHash`.

**Files:**
- Modify: `apps/cli/src/commands/ingest.ts`
- Test: `apps/cli/src/commands/ingest.test.ts`

**Interfaces:**
- Consumes:
  - Task 2's `CaptureEnvelopeV1.note`.
  - Task 4's `runCapture` with `{ note }`, which the test fixtures use to create note captures.
  - Task 5's `IngestValidationContext.replaces`.
- Produces:

```ts
export interface IngestResultV1 { /* … */ readonly agent: AgentName | null }         // null: no plain capture selected
export interface RunReportV1 { /* … */ readonly agent: AgentName | null;
  readonly refused: readonly { /* …existing… */ readonly reason: "note_changed_since_capture" | null }[] }
// RefusedCaptureV1 gains the same `reason` field.
// Refusal: exit 3 (EXIT_CODES.decisionRequired), reason "note_changed_since_capture",
// recovery "developer-os review --id <id> --decision reject, then run the workflow again against the current note"
```

- [x] **Step 1: Write the failing tests**

Use `ingest.test.ts`'s existing installed fixture and fake-vendor helpers. Plant a vendor executable that exits 97, the way `installFakeExecutable`'s default does in `tests/helpers/temp-home.ts`. If the in-process fixture discovers agents through `FixtureOptions.agents` instead, register one whose runner records any spawn and fails the test.

```ts
it("applies a create note capture verbatim without resolving or invoking a vendor", async () => {
  const fixture = await installed("verbatim-create", { agents: NO_AGENTS });
  const id = await noteCapture(fixture, "DEV/new-note.md", NEW_NOTE);   // runCapture({ note }) then review accept
  const result = await runIngest(fixture.context, {});
  expect(result.ok && result.data.agent).toBeNull();
  expect(fixture.vendorProcesses).toStrictEqual([]);
  expect(await readFile(join(fixture.paths.brain, "content/DEV/new-note.md"), "utf8")).toBe(`${NEW_NOTE_NORMALIZED}\n`);
  expect(await statusOf(fixture, id)).toBe("ingested");
});
it("replaces an existing note bound to its capture-time hash", async () => { /* bytes equal reviewed content + "\n" */ });
it("refuses exit 3 note_changed_since_capture when the note changed after capture, keeps the note and leaves the capture accepted", async () => {
  const fixture = await installed("verbatim-changed", { agents: NO_AGENTS });
  const target = join(fixture.paths.brain, "content/DEV/example-knowledge-note.md");
  const id = await noteCapture(fixture, "DEV/example-knowledge-note.md", REVISED);
  await appendFile(target, "\nhand edit\n");
  const edited = await readFile(target);
  const result = await runIngest(fixture.context, {});
  expect(!result.ok && result.code).toBe(EXIT_CODES.decisionRequired);
  expect(!result.ok && JSON.stringify(result.error.data)).toContain("note_changed_since_capture");
  expect(!result.ok && result.error.recovery).toContain(`developer-os review --id ${id} --decision reject`);
  expect(await readFile(target)).toStrictEqual(edited);
  expect(await statusOf(fixture, id)).toBe("accepted");
});
it("refuses note_changed_since_capture for a create whose destination became occupied", async () => { /* … */ });
it("maps an apply-time precondition failure to the same refusal and rolls the capture back to accepted", async () => {
  // interruptKind "ingest-apply" hook, or a context.executor wrapper that edits the target just before execute()
});
it("still refuses a plain proposal that names an occupied path with the unchanged create-only message", async () => {
  // expect(message).toContain("ingest creates notes and never replaces one")
});
it("resolves a vendor when a batch mixes plain and note captures, and ingests both", async () => { /* … */ });
```

**Update the existing value assertions in the same commit.** `npm run lint` cannot find them. `RefusedCaptureV1`, `RunReportV1.refused[]` gain `reason`, and `agent` may now be `null`, so existing strict assertions over refusal reports fail at close. Find them with `grep -rn "leftAt:\|refused\|agent:" apps/cli/src tests --include=*.test.ts`, add `reason: null` where a plain refusal is asserted, and stage every file you change.

- [ ] **Step 2: Run the tests and verify they fail** — deferred to phase close (D47)

Deferred to phase close (D47). Close runs `npx vitest run --root apps/cli src/commands/ingest.test.ts`. It also runs every file changed by the assertion update, plus `tests/security/interruption.test.ts` and `tests/security/malformed-manifest.test.ts`.

- [x] **Step 3: Implement**

In `ingest.ts`:

1. **`selectCaptures`** returns `accepted: readonly { fileName: string; plain: boolean }[]`, where `plain` is `outcome.envelope.note === null`. Update `runIngest` and `ingestOne` to use it.
2. **`runIngest`.**
   - Move `selectVendor` to **after** `selectCaptures`.
   - Call it only when `selection.accepted.some((c) => c.plain)`, else `vendor = null`.
   - Call `prepareAgentWorkspace` only when `vendor?.name === "codex"` and a plain capture is selected.
   - `IngestEnvironment.vendor` becomes `Vendor | null`.
   - `result.agent` and the report's `agent` become `vendor?.name ?? null`.
   - Update `renderIngest` for `null`.
3. **New class.** `class NoteChangedSinceCaptureRefusal extends IngestRefusal`:
   - `code` is `EXIT_CODES.decisionRequired`.
   - It has `readonly reason = "note_changed_since_capture"`.
   - Its recovery is `` `developer-os review --id ${captureId} --decision reject, then run the workflow again against the current note` ``.
   - It **must not** extend `IngestPreconditionRefusal`. That class skips the rollback and would leave the capture at `staging`.
4. **`ingestOne`, when `envelope.note !== null`.**
   - (a) Right after the status check and **before** the `ingest-stage` `writeCaptureFile`, run `assertNoteUnchanged`:
     - Compute `abs = join(contentRoot, note.path)`.
     - If `beforeSha256 === null`, `lstat(abs)` must throw ENOENT.
     - Otherwise, the SHA-256 of `await context.guards.readText(abs, (h) => h.readFile())` must equal `beforeSha256`, and a missing file also fails.
     - Any failure throws `NoteChangedSinceCaptureRefusal`. `staged` is still null at this point, so the capture is untouched and remains `accepted`.
   - (b) Stage as today.
   - (c) Skip `invokeVendor`. Build `parseIngestProposal({ schemaVersion: 1, notes: [{ path: note.path, contents: `${envelope.content}\n`, sourceCaptureId: envelope.captureId }] })` and refuse as today if it is not `ok`.
   - (d) Call `validateProposal(…, { …, ...(note.beforeSha256 === null ? {} : { replaces: note.path }) })`.
   - (e) Call `applyNotes(context, contentRoot, plan.writes, noteTarget)`. The new last parameter is `noteTarget: CaptureNoteTargetV1 | null`. For a write whose `path === noteTarget.path`:
     - If `beforeSha256 !== null`, skip the `exists()` refusal and push `{ targetPath, operation: "replace", content, expectedBeforeHash: beforeSha256 }`.
     - If `beforeSha256 === null` and `exists()` is true, throw `NoteChangedSinceCaptureRefusal`. The plain-capture message stays byte-identical for plain captures.
     - Around `context.executor.execute`, for a note target only, **before** the landed-hash loop: when the error is `TransactionPreconditionError` or `TransactionPlanError`, throw `NoteChangedSinceCaptureRefusal`. `applied` then stays `null`, so the existing rollback returns the capture to `accepted`.
   - The plain path is otherwise unchanged. `vendor` is non-null whenever a plain capture reaches `invokeVendor`; assert that with a thrown `Error` rather than `!`.
5. **`reason` field.** Carry `reason` into `RefusedCaptureV1` as `error instanceof NoteChangedSinceCaptureRefusal ? error.reason : null`, and into `reportFields`.

- [ ] **Step 4: Run the tests** — deferred to phase close (D47)

Deferred to phase close (D47).

- [x] **Step 5: Gate and commit**

```bash
npm run lint
git add apps/cli/src/commands/ingest.ts apps/cli/src/commands/ingest.test.ts
# plus, by exact path, every test file the assertion update changed
git diff --cached --name-only
git commit -m "feat(cli): ingest note captures verbatim, bound to the capture-time hash"
```

### Task 8: The five workflows, `capture.writeNote`, and both rendered trees · M

**Done 2026-09-22, `f1b72c7`** (D47 lane: lint only, tests and review owed at phase close).

Spec §§3.5, 4, and Appendix A.

**Files:**
- Create: `workflows/brain-answer/workflow.yaml`, `workflows/brain-compile/workflow.yaml`, `workflows/brain-enhance/workflow.yaml`, `workflows/brain-garden/workflow.yaml`, `workflows/brain-report/workflow.yaml`
- Modify: `packages/workflow-schema/src/vocabulary.ts`, `packages/workflow-schema/src/vocabulary.test.ts`, `tests/contracts/workflows/canonical.test.ts`, `tests/contracts/adapters/claude/generated.test.ts`, `tests/contracts/adapters/codex/generated.test.ts`
- Regenerate: `plugins/claude/**`, `plugins/codex/**`

**Interfaces:**
- Consumes: Task 4, so that the rendered `developer-os capture --note` exists when the skills land (spec §9 step 4).
- Produces:
  - Skill directories `developer-os-brain-{answer,compile,enhance,garden,report}/SKILL.md` in both trees.
  - This verb:

```ts
"capture.writeNote": { read: ["content/**"], write: QUARANTINE, staging: false, capability: null,
  owner: "A12b", implemented: true, command: "developer-os capture --note" },
```

- [x] **Step 1: Write the contracts and the failing pins**

1. Copy the five YAML documents from spec Appendix A.1–A.5 verbatim. In A.2, A.3 and A.4, the capture step stays `do: capture.writeNote`, not the `capture.write` stand-in the spec used to validate.
2. Add the `capture.writeNote` row to `EFFECT_VOCABULARY`, after `capture.write`, and the matching row to the exact-table pin in `vocabulary.test.ts`: `{ read: ["content/**"], write: quarantine, ...capture, owner: "A12b", command: "developer-os capture --note" }`, adapted to that file's local helper names.
3. In `canonical.test.ts`:
   - Set `EXPECTED` to `["brain-answer", "brain-compile", "brain-enhance", "brain-garden", "brain-report", "brain-search", "capture", "doctor", "ingest", "review", "shared"]`.
   - Change `toHaveLength(6)` to `toHaveLength(11)`.
   - Rename the first case to "ships exactly the eleven canonical workflows".
   - Replace the "keeps every vault write inside capture, review and ingest" case with the §4.4 invariant below, and add the brain-* scope pin:

```ts
it("writes outside quarantine only through ingest, and expresses that in effect verbs only", async () => {
  const names = await directories();
  expect(names.length).toBe(EXPECTED.length);
  const outsideWriters: string[] = [];
  for (const name of names) {
    const contract = mustLoad(`workflows/${name}/workflow.yaml`);
    const outside = contract.scopes.write.filter((glob) => glob !== "content/_raw/quarantine/**");
    if (outside.length === 0) continue;
    outsideWriters.push(name);
    expect(contract.steps.filter((step) => step.prose !== undefined), `${name} writes outside quarantine`).toStrictEqual([]);
  }
  expect(outsideWriters).toStrictEqual(["ingest"]);
});
it("declares every brain-* workflow's writes as quarantine alone", () => {
  const brain = canonicalContracts().filter((c) => c.id.startsWith("brain-") && c.id !== "brain-search");
  expect(brain).toHaveLength(5);
  for (const c of brain) expect(c.scopes.write, c.id).toStrictEqual(["content/_raw/quarantine/**"]);
});
```

4. In the adapter generated tests, keep the counts literal, as their comment requires:
   - `claude/generated.test.ts`: `toHaveLength(6)` → `11`, and `toHaveLength(5)` → `10`.
   - `codex/generated.test.ts`: `toHaveLength(6)` → `11`, `toHaveLength(7)` → `12`, and `toHaveLength(5)` → `10`.
   - Update each comment's "six canonical workflows" to "eleven".

- [x] **Step 2: Render both trees**

```bash
npm run render:claude
npm run render:codex
git status --short plugins/
```

Expected: five new `SKILL.md` files in each tree and no other changed path.
- Open `plugins/claude/skills/developer-os-brain-enhance/SKILL.md` and confirm that the `capture` step renders `developer-os capture --note` in its `text` block.
- If A12 has already integrated and changed these trees, the renders include A12's artifacts. Rebase the literal counts on the actual rendered numbers and record both plans' contributions in the comment.

- [ ] **Step 3: Run the tests** — deferred to phase close (D47)

Deferred to phase close (D47). Close runs `npx vitest run --root packages/workflow-schema src/vocabulary.test.ts`. It then runs `npx vitest run tests/contracts/workflows tests/contracts/adapters tests/tools`. The render-drift cases live there.

- [x] **Step 4: Gate and commit**

```bash
npm run lint
git add workflows/brain-answer/workflow.yaml workflows/brain-compile/workflow.yaml workflows/brain-enhance/workflow.yaml workflows/brain-garden/workflow.yaml workflows/brain-report/workflow.yaml packages/workflow-schema/src/vocabulary.ts packages/workflow-schema/src/vocabulary.test.ts tests/contracts/workflows/canonical.test.ts tests/contracts/adapters/claude/generated.test.ts tests/contracts/adapters/codex/generated.test.ts
git add plugins/claude/skills/developer-os-brain-answer/SKILL.md plugins/claude/skills/developer-os-brain-compile/SKILL.md plugins/claude/skills/developer-os-brain-enhance/SKILL.md plugins/claude/skills/developer-os-brain-garden/SKILL.md plugins/claude/skills/developer-os-brain-report/SKILL.md
git add plugins/codex/skills/developer-os-brain-answer/SKILL.md plugins/codex/skills/developer-os-brain-compile/SKILL.md plugins/codex/skills/developer-os-brain-enhance/SKILL.md plugins/codex/skills/developer-os-brain-garden/SKILL.md plugins/codex/skills/developer-os-brain-report/SKILL.md
git diff --cached --name-only
git commit -m "feat(workflows): add the five brain workflows and capture.writeNote"
```

If `git status --short plugins/` showed any other changed file, such as a plugin manifest, stage it by its exact path too.

### Task 9: Merge and split planners · M

**Done 2026-09-22, `9eaa3e6`** (D47 lane: lint only, tests and review owed at phase close).

Spec §6.3, the `--merge` and `--split` rows. No frontmatter is edited except the split child's fresh frontmatter.

**Files:**
- Create: `packages/brain/src/refactor/merge.ts`, `packages/brain/src/refactor/split.ts`
- Modify: `packages/brain/src/refactor/plan.ts` (dispatch), `packages/brain/src/refactor/index.ts`, `packages/brain/src/index.ts`
- Test: `packages/brain/src/refactor/merge.test.ts`, `packages/brain/src/refactor/split.test.ts`

**Interfaces:**
- Consumes: Task 6's `planRefactor`, `ModePlanV1`, `PreStateV1`, `rewriteReferrers`, `RefactorRefusal` and `overlayBuildRequest`.
- Produces:

```ts
export function planMerge(state: PreStateV1, source: string, target: string): ModePlanV1;
export function planSplit(state: PreStateV1, note: string, heading: string): ModePlanV1;
export function splitSlug(heading: string): string; // NFC lower-case, runs of non-[\p{L}\p{N}] → "-", "-" trimmed
```

- [x] **Step 1: Write the failing tests**

```ts
// merge.test.ts
it("appends the source body under its title, keeps the target header byte-exact, graveyards the source and retargets links", async () => {
  const plan = await planRefactor({ mode: "merge", source: "DEV/s.md", target: "DEV/t.md" }, memoryInput({
    "DEV/s.md": noteText({ title: "Source", body: "\nS body\n\n" }),
    "DEV/t.md": T_TEXT,
    "DEV/r.md": noteText({ title: "R", body: "[[DEV/s]]" }),
  }));
  const target = plan.mutations.find((m) => m.path === "DEV/t.md");
  expect(target?.content).toBe(`${T_HEADER}${T_BODY}\n\n## Source\n\nS body\n`);
  expect(plan.mutations.map((m) => [m.operation, m.path])).toStrictEqual([
    ["replace", "DEV/r.md"], ["remove", "DEV/s.md"], ["replace", "DEV/t.md"], ["create", "_graveyard/DEV/s.md"],
  ].sort(byPath));
});
it("refuses merging a note into itself as brain_refactor_input_invalid", async () => { /* … */ });
// split.test.ts
it("moves the section to <dir>/<slug>.md with fresh frontmatter and leaves See [[slug]].", async () => {
  const plan = await planRefactor({ mode: "split", note: "DEV/p.md", heading: "Deep Dive" }, memoryInput({
    "DEV/p.md": noteText({ title: "Parent", tags: ["x"], type: "knowledge-note", body: "\n## Intro\n\ni\n\n## Deep Dive\n\nd\n\n### Sub\n\ns\n\n## Next\n\nn\n" }),
    "DEV/r.md": noteText({ title: "R", body: "[[DEV/p#Deep Dive|see]]" }),
  }, { today: "2026-09-22" }));
  const child = plan.mutations.find((m) => m.path === "DEV/deep-dive.md");
  expect(child?.content).toMatch(/^---\nschemaVersion: 1\ntitle: Deep Dive\ntype: knowledge-note\n/u);
  expect(child?.content).toContain("created: 2026-09-22");
  expect(child?.content).toContain("stage: emerging");
  expect(child?.content).toContain("reviewed: null");
  expect(child?.content).toContain("summary: Split from Parent.");
  expect(child?.content).toContain("## Deep Dive\n\nd\n\n### Sub\n\ns\n");
  expect(plan.mutations.find((m) => m.path === "DEV/p.md")?.content).toContain("See [[deep-dive]].");
  expect(plan.mutations.find((m) => m.path === "DEV/r.md")?.content).toContain("[[deep-dive|see]]");
});
it.each([["absent"], ["ambiguous: two ## Deep Dive"], ["a level-1 heading"], ["an empty slug: ## ---"], ["an occupied slug path"]])(
  "refuses %s", async () => { /* input_invalid, except occupied → refactor_destination_exists */ });
```

- [ ] **Step 2: Run the tests and verify they fail** — deferred to phase close (D47)

Deferred to phase close (D47). Close runs `npx vitest run --root packages/brain src/refactor`.

- [x] **Step 3: Implement**

- **`planMerge`**
  - Parse both notes. The target content is `renderNote({ header: target.header, body: `${target.body.trimEnd()}\n\n## ${sourceTitle}\n\n${source.body.trim()}\n` })`.
    - The spec's shape is "body gains `\n\n## <source title>\n\n<source body, trimmed>\n`".
    - The test pins the exact bytes.
    - The target's trailing whitespace is normalized to exactly that separator.
  - `moves` is `{ source → target }`.
  - `rewriteReferrers(state, source, target, () => false)` rewrites links to the source.
  - Emit `remove source` and `create _graveyard/<source>`, with the unchanged source bytes.
  - Note R6: nothing is unioned into the target's frontmatter.
- **`planSplit`**
  - Find ATX headings of levels 2–6 in the body, outside fenced code, using the same masking as Task 3. Exactly one must have text equal to `heading`, else refuse with input_invalid.
  - The section runs from that line to the line before the next heading of equal or higher level, or to the end.
  - The parent becomes `renderNote({ header, body: before + "See [[" + slug + "]].\n" + after })`, joined with single blank lines.
  - The child is fresh frontmatter, rendered with `yaml`'s `stringify(…, { lineWidth: 0 })`, followed by `---\n\n` and the section:
    - `schemaVersion`, `title`, `type` (the parent's), `created` (today), `tags` (the parent's), `summary` (capped at 400 grapheme-safe via `screenAndCap`), `stage: emerging`, `author` (the parent's), `reviewed: null`.
  - `moves` is empty.
  - `extraEdges` is `[[parent, child]]`.
  - Rewrite links `[[<note>#<heading>…]]` whose anchor equals `heading` to the child, using `withoutAnchor`. Other links to the parent stay.
- Dispatch both modes from `planRefactor`, which removes Task 6's "not implemented" refusal.

- [ ] **Step 4: Run the tests** — deferred to phase close (D47)

Deferred to phase close (D47).

- [x] **Step 5: Gate and commit**

```bash
npm run lint
git add packages/brain/src/refactor/merge.ts packages/brain/src/refactor/split.ts packages/brain/src/refactor/plan.ts packages/brain/src/refactor/index.ts packages/brain/src/index.ts packages/brain/src/refactor/merge.test.ts packages/brain/src/refactor/split.test.ts
git diff --cached --name-only
git commit -m "feat(brain): plan merge and split refactors"
```

### Task 10: `developer-os brain retire` and `brain refactor` · M

**Done 2026-09-22, `dd5ec23`** (D47 lane: lint only, tests and review owed at phase close).

Spec §§6.1, 6.2 (steps 5–7), 6.7, 6.8, 6.9.

**Files:**
- Create: `apps/cli/src/commands/refactor.ts`
- Modify: `apps/cli/src/commands/brain.ts`, `apps/cli/src/main.ts`, `packages/brain/src/capture/agent.ts`, `packages/brain/src/capture/index.ts`, `packages/brain/src/index.ts`
- Test: `apps/cli/src/commands/refactor.test.ts`, `apps/cli/src/main.test.ts`, `packages/brain/src/capture/agent.test.ts`

**Interfaces:**
- Consumes: Task 6's `planRefactor`, `RefactorRequestV1`, `RefactorPlanV1`, `RefactorRefusal` and `MAX_REFACTOR_MUTATIONS`. Task 9's `merge` and `split` support.
- Produces:

```ts
// packages/brain/src/capture/agent.ts
/** Any row matches (not matchObservedAgent's single-match rule): a nested session counts. */
export function anyAgentMarker(env: Readonly<Record<string, string | undefined>>): boolean;
// apps/cli/src/commands/refactor.ts
export interface BrainRefactorResultV1 {
  readonly schemaVersion: 1;
  readonly subcommand: "retire" | "refactor";
  readonly mode: "retire" | "rename" | "move" | "merge" | "split";
  readonly transactionId: string | null;
  readonly mutations: readonly { readonly operation: "create" | "replace" | "remove"; readonly path: string }[];
  readonly rewrittenLinks: number;
}
export interface RefactorOptions { readonly subcommand: "retire" | "refactor"; readonly request: RefactorRequestV1; readonly dryRun: boolean }
export async function runRefactor(context: CliContext, options: RefactorOptions): Promise<CliResult<BrainRefactorResultV1>>;
// transaction kinds
const KINDS = { retire: "brain-retire", refactor: "brain-refactor", reindex: "brain-refactor-reindex" } as const;
// apps/cli/src/commands/brain.ts
export type BrainSubcommand = "reindex" | "lint" | "search" | "status" | "retire" | "refactor";
export type BrainResultV1 = /* …existing arms… */ | BrainRefactorResultV1;
export interface BrainOptions { /* …existing… */ readonly refactor?: RefactorRequestV1 }
```

- [x] **Step 1: Write the failing tests**

`main.test.ts`, the parser:
```ts
it.each([
  [["brain", "retire", "DEV/a.md"], true],
  [["brain", "retire", "DEV/a.md", "--dry-run", "--json"], true],
  [["brain", "refactor", "--rename", "DEV/a.md", "b.md"], true],
  [["brain", "refactor", "--move", "DEV/a.md", "TOOLS"], true],
  [["brain", "refactor", "--merge", "DEV/a.md", "DEV/b.md", "--dry-run"], true],
  [["brain", "refactor", "--split", "DEV/a.md", "Deep Dive"], true],
  [["brain", "refactor", "DEV/a.md", "b.md"], false],                         // zero mode flags
  [["brain", "refactor", "--rename", "--move", "DEV/a.md", "b.md"], false],   // two
  [["brain", "refactor", "--rename", "DEV/a.md"], false],                     // one positional
  [["brain", "retire"], false],
  [["brain", "retire", "a", "b"], false],
  [["brain", "retire", "DEV/a.md", "--yes"], false],
  [["brain", "lint", "--rename"], false],
] as const)("parses %j → %s", async (argv, accepted) => { /* exit != usage when accepted; usage exit 2 otherwise */ });
it("admits both verbs through assertOrdinaryCommandAdmitted like every non-init command", async () => { /* bootstrap evidence inspection count increments */ });
```

`refactor.test.ts` uses `createCommandFixture` plus a real `init`, with `env: {}` unless a case sets a marker:
```ts
it("applies a rename in one brain-refactor transaction, then reindexes in brain-refactor-reindex", async () => { /* journals' kinds in order; note moved; referrer rewritten; brain lint errorCount 0 */ });
it("reports the plan and writes nothing under --dry-run, with transactionId null", async () => { /* inventory unchanged */ });
it("refuses an applied run exit 5 brain_refactor_in_agent_session when CLAUDECODE=1, and allows --dry-run", async () => {
  const fixture = await installed("agent", { env: { CLAUDECODE: "1" } });
  const applied = await runRefactor(fixture.context, { subcommand: "retire", request: RETIRE, dryRun: false });
  expect(!applied.ok && [applied.code, applied.error.kind]).toStrictEqual([EXIT_CODES.securityRefusal, "brain_refactor_in_agent_session"]);
  expect((await runRefactor(fixture.context, { subcommand: "retire", request: RETIRE, dryRun: true })).ok).toBe(true);
});
it("refuses with CODEX_THREAD_ID and with both markers set (any-match)", async () => { /* … */ });
it("refuses exit 3 note_changed_since_read when a referrer changes between plan and apply", async () => { /* executor wrapper edits the file before execute */ });
it("refuses exit 3 refactor_destination_exists for a non-note file already at the destination", async () => { /* DEV/c.md as plain text */ });
it("refuses exit 5 brain_refactor_path_refused through a symlinked topic folder", async () => { /* … */ });
it.each([["brain_refactor_input_invalid", 2], ["retire_has_referrers", 3], ["refactor_postcondition_failed", 1], ["refactor_too_wide", 1]])(
  "publishes planner refusal %s with exit %i", async () => { /* … */ });
```

`agent.test.ts` covers `anyAgentMarker` with `{}` → false, `CLAUDECODE: "1"` → true, `CLAUDECODE: "0"` → false, a non-empty `CODEX_THREAD_ID` → true, both → true, and an empty string → false.

- [ ] **Step 2: Run the tests and verify they fail** — deferred to phase close (D47)

Deferred to phase close (D47). Close runs `npx vitest run --root apps/cli src/commands/refactor.test.ts src/main.test.ts` and `npx vitest run --root packages/brain src/capture/agent.test.ts`.

- [x] **Step 3: Implement**

**`agent.ts`.** `anyAgentMarker(env)` is `AGENT_DETECTION_ROWS.some((row) => { const v = env[row.variable]; return v !== undefined && v.length > 0 && (row.value === null || row.value === v); })`.

**`refactor.ts`, `runRefactor`.** The steps run in this order:
1. **Agent-session refusal.** If `!options.dryRun && anyAgentMarker(context.env)`, refuse exit 5 `brain_refactor_in_agent_session`. The recovery text is `"run the printed command yourself in a terminal outside the agent session"`. This happens before any read.
2. **Configuration and plan.**
   - Read the configuration and assert the vault is present, using the same helpers as `brain.ts`'s `readConfig`.
   - Build `deps = dependenciesFor(context, paths.brain, config)`, from `commands/reindex.ts`.
   - Call `planRefactor(options.request, { build: <IndexBuildRequest from deps, as validate.ts's buildRequestOf does>, today: context.now().toISOString().slice(0, 10) })`.
   - Map `RefactorRefusal.reason` to its exit code:
     - `brain_refactor_input_invalid` → 2
     - `refactor_destination_exists` → 3
     - `retire_has_referrers` → 3
     - `refactor_postcondition_failed` → 1
     - `refactor_too_wide` → 1
   - For `retire_has_referrers`, the recovery names `developer-os brain refactor --merge <note> <target>`.
3. **Containment of every mutation path.** Compute `abs = join(contentRoot, m.path)`.
   - `lstat` each existing component from `<contentRoot>` down. Any symbolic link is exit 5 `brain_refactor_path_refused`.
   - Canonicalize the deepest existing ancestor. It must lie inside the canonical `<contentRoot>/<topicFolder>/` for some configured topic folder, or inside `<contentRoot>/_graveyard/` when the mode is `retire` or `merge` and the path starts `_graveyard/`. Otherwise exit 5.
   - Every `create` target must `lstat` ENOENT, else exit 3 `refactor_destination_exists`.
4. **Dry run.** Under `options.dryRun`, return the result with `transactionId: null`.
5. **Apply.**
   - For each `create`, call `context.guards.transaction.assertTarget(abs)` and then `context.fs.mkdir(dirname(abs), { recursive: true, mode: 0o700 })`.
   - Call `context.executor.execute({ kind: KINDS[subcommand], mutations })`. Each `replace` or `remove` carries `expectedBeforeHash: sha256(Buffer.from(m.before, "utf8"))`. A `create` carries `content` encoded and no hash.
   - Map `TransactionPreconditionError`, and a `TransactionPlanError` for a vanished target, to exit 3 `note_changed_since_read`, with the message "nothing was written".
   - `transactionId` is `(await context.executor.execute(plan)).id`. The call returns the `TransactionJournalV1`.
6. **Reindex.** Call `writeIndexArtifacts(context, { …, kind: KINDS.reindex, … })` exactly as `ingest.ts`'s `reindexVault` does. A failure here is exit 1, with the recovery `developer-os brain reindex`.

Error classes follow `V2HomeAdmissionError`'s pattern: `this.name` is derived from the code, so that `failureFrom`'s `kind` is the code.

**`brain.ts`.**
- Add the result arm and widen `BrainSubcommand`.
- `runBrain` delegates `"retire"` and `"refactor"` to `runRefactor(context, { subcommand, request: options.refactor, dryRun: options.dryRun })`. `options.refactor` is always set for these two subcommands.
- `renderBrain` prints `` `${verb} (${mode})${dry ? " — dry run, nothing written" : ""}` ``, then one `  <operation> <renderPath(path)>` line per mutation, then `rewrote <n> links`.

**`main.ts`.**
- Add `rename`, `move`, `merge` and `split` to `OPTIONS` as `{ type: "boolean" }`.
- Add those four names to `COMMAND_OPTIONS.brain`.
- Change `COMMAND_POSITIONALS.brain` to `{ min: 1, max: 3 }`.
- Change the shape of `BRAIN_SUBCOMMANDS` to `{ options; positionals: number }`: `reindex` 0, `lint` 0, `search` 1, `status` 0, `retire` 1 (options `dry-run`, `json`), `refactor` 2 (options `dry-run`, `json`, `rename`, `move`, `merge`, `split`).
- The parse requires `rest.length - 1 === positionals`. For `refactor`, exactly one of the four mode flags must be true, else return `null`.
- `brainOptionsFor` builds the `RefactorRequestV1`:
  - `retire` → `{ mode: "retire", note }`
  - `--rename` → `{ note, newName }`
  - `--move` → `{ note, folder }`
  - `--merge` → `{ source, target }`
  - `--split` → `{ note, heading }`
- Change the help text's `brain` line to `reindex | lint | search <query> | status | retire <note> | refactor --rename|--move|--merge|--split <a> <b>`. Add one line per flag, for example `  --rename         rename <note> to <new-name> in its folder (brain refactor)`, and similar lines for `--move`, `--merge` and `--split`. Extend `--dry-run`'s parenthetical with `brain retire, brain refactor`.

- [ ] **Step 4: Run the tests** — deferred to phase close (D47)

Deferred to phase close (D47).

- [x] **Step 5: Gate and commit**

```bash
npm run lint
git add apps/cli/src/commands/refactor.ts apps/cli/src/commands/brain.ts apps/cli/src/main.ts packages/brain/src/capture/agent.ts packages/brain/src/capture/index.ts packages/brain/src/index.ts apps/cli/src/commands/refactor.test.ts apps/cli/src/main.test.ts packages/brain/src/capture/agent.test.ts
git diff --cached --name-only
git commit -m "feat(cli): brain retire and brain refactor, refused inside agent sessions"
```

### Task 11: Security cases for note captures and verbatim ingest · S

**Done 2026-09-22, `5be3304`** (D47 lane: lint only, tests and review owed at phase close).

Spec §7.4, the capture and ingest half. These cases run against the compiled binary.

**Files:**
- Create: `tests/security/note-capture.test.ts`

**Interfaces:**
- Consumes: Task 4 (`capture --note`) and Task 7 (verbatim ingest). It uses the existing helpers `tests/security/helpers.ts` and `tests/helpers/{run-cli,temp-home}.ts`.
- Produces: nothing consumed later.

- [x] **Step 1: Write the cases**

```ts
describe("a note capture aimed outside a topic folder", () => {
  it.each([
    ["_raw/x.md", EXIT_CODES.securityRefusal, "capture_note_path_refused"],
    ["_indexes/x.md", EXIT_CODES.securityRefusal, "capture_note_path_refused"],
    ["_RAW/x.md", EXIT_CODES.securityRefusal, "capture_note_path_refused"],
    ["../x.md", EXIT_CODES.invalidInput, "capture_note_invalid"],
  ] as const)("refuses --note %s with exit %i (%s) and writes nothing", async (path, code, kind) => {
    const home = await installedHome();
    const before = await inventory(home.root);
    const run = await runJson(home, ["capture", "--note", path, "--json"], { stdin: NEW_NOTE });
    // Exact code and kind, never `not.toBe(success)`: on the base commit `--note` is an unknown
    // option (usage, exit 2, kind invalid_input), and a weak assertion would pass there (Task 16 Step 3).
    expect([run.exitCode, !run.result.ok && run.result.error.kind]).toStrictEqual([code, kind]);
    expect(addedPaths(before, await inventory(home.root)).filter((p) => !isVolatile(p))).toStrictEqual([]);
  });
  it("refuses an in-vault symlink as exit 5 capture_note_path_refused and writes nothing", async () => { /* symlink content/DEV/link → content/_raw; exact code and kind */ });
});
it("redacts the sentinel secret in the applied note and in every report", async () => {
  // capture --note with SENTINEL inside, review accept, ingest; the note on disk and every stdout/stderr lack SENTINEL
});
it("refuses a replace whose target changed after capture: exit 3, reason note_changed_since_capture, bytes intact, capture accepted", async () => { /* assert the exact exit and the reason in result.error.data */ });
it("leaves malformed-manifest.test.ts's plain-capture replace refusal in force", async () => {
  // a plain capture whose canned proposal names an existing note → message contains "ingest creates notes and never replaces one"
});
```

`installedHome`, `isVolatile` and `SENTINEL` come from `tests/security/helpers.ts` and `sentinel.test.ts`. Reuse their exports. If a helper is not exported, copy the few lines needed rather than editing the other security files.

- [ ] **Step 2: Run the cases** — deferred to phase close (D47)

Deferred to phase close (D47). Close runs `npx vitest run tests/security/note-capture.test.ts`. Spec §7.4's "watched failing first" is met at close as Task 16 Step 3 describes.

- [x] **Step 3: Gate and commit**

```bash
npm run lint
git add tests/security/note-capture.test.ts
git diff --cached --name-only
git commit -m "test(security): note captures refuse escapes and replace only unchanged notes"
```

### Task 12: E2E harness and `brain-answer`, `brain-report`, `brain-compile` · M

**Done 2026-09-22, `d3cba24`** (D47 lane: lint only, tests and review owed at phase close).

Spec §7.2. Each test plays the agent. It runs, in step order, the `developer-os` commands that the **rendered** `plugins/claude/skills/developer-os-<id>/SKILL.md` names, drives the result through review and ingest, and asserts that the workflow step added nothing outside quarantine.

**Files:**
- Create: `tests/e2e/brain-workflows/harness.ts`, `tests/e2e/brain-workflows/brain-answer.test.ts`, `tests/e2e/brain-workflows/brain-report.test.ts`, `tests/e2e/brain-workflows/brain-compile.test.ts`

**Interfaces:**
- Consumes: Task 1 (lint classes, which the report prints), Task 4, Task 7 and Task 8 (rendered skills).
- Produces, for Task 14:

```ts
// tests/e2e/brain-workflows/harness.ts
export interface SkillStep { readonly id: string; readonly verb: string | null; readonly command: string | null }
/** Parses "## Steps" of the rendered Claude skill: each "### <id>", its "Effect: `<verb>`", and the first ```text block. */
export async function skillSteps(workflowId: string): Promise<readonly SkillStep[]>;
/** createTempHome + init --yes + brain reindex; returns the content root. */
export async function installedVault(): Promise<{ readonly home: TempHome; readonly contentRoot: string }>;
/** argv for a rendered command: drops the leading "developer-os", appends extra args. */
export function argvOf(command: string, ...extra: readonly string[]): readonly string[];
/** A codex that answers with the canned proposal (lifecycle.test.ts's vendorScript, moved here). */
export async function installCannedCodex(home: TempHome, captureId: string): Promise<void>;
/** A vendor that exits 97 if executed (installFakeExecutable's default body). */
export async function installForbiddenVendor(home: TempHome, name: "claude" | "codex"): Promise<void>;
/** review --decision accept, then ingest; returns the ingest run. */
export async function acceptAndIngest(home: TempHome, captureId: string): Promise<JsonRun<IngestResultV1>>;
export function quarantineOnly(added: readonly string[], contentRoot: string): boolean;
```

- [x] **Step 1: Write the harness and three tests**

1. **`skillSteps`** reads `plugins/claude/skills/developer-os-<id>/SKILL.md` from the repository root, located by `fileURLToPath(new URL("../../../", import.meta.url))`. That is the same expression as `tests/contracts/workflows/canonical.test.ts`'s `ROOT`: vitest runs the `.ts` sources in place, so the harness at `tests/e2e/brain-workflows/` is three levels below the root. It splits on `\n### `, takes `Effect: \`(.+?)\``, and takes the first `` ```text\n(.+?)\n``` `` in the section. The format is the one `developer-os-brain-search/SKILL.md` shows. It asserts that the parsed list is non-empty.
2. **`installCannedCodex`** moves `vendorScript` out of `tests/e2e/knowledge-lifecycle/lifecycle.test.ts`. That means copying the function, with the reply framed as an `item.completed` `agent_message` exactly as that test builds it, and filling `tests/fixtures/knowledge/ingest-proposal.json`'s `__CAPTURE_ID__`. Leave `lifecycle.test.ts` unchanged.
3. The tests:

```ts
// brain-answer.test.ts
it("answers from the vault, files the answer back as one plain capture, and ingests it through the canned vendor", async () => {
  const { home, contentRoot } = await installedVault();
  const steps = await skillSteps("brain-answer");
  expect(steps.map((s) => s.verb)).toStrictEqual(["brain.readIndex", "brain.search", "brain.readNote", null, null, "capture.write"]);
  const before = await inventory(home.root);
  const search = steps.find((s) => s.verb === "brain.search");
  const ranked = await runJson<BrainSearchResultV1>(home, [...argvOf(search!.command!, "brain commands"), "--json"]);
  expect(ranked.exitCode).toBe(EXIT_CODES.success);
  const notePath = okData(ranked.result).matches[0]!.path;                 // agent reads it (brain.readNote)
  const answer = `developer-os brain commands are listed in ${notePath}.`;
  const capture = steps.find((s) => s.verb === "capture.write");
  const captured = await runJson<CaptureResultV1>(home, [...argvOf(capture!.command!), "--json"], { stdin: answer });
  expect(quarantineOnly(addedPaths(before, await inventory(home.root)), contentRoot)).toBe(true);
  await installCannedCodex(home, okData(captured.result).captureId);
  const ingested = await acceptAndIngest(home, okData(captured.result).captureId);
  expect(ingested.exitCode).toBe(EXIT_CODES.success);
  const lint = await runJson<BrainLintResultV1>(productHome, ["brain", "lint", "--json"]);
  expect(okData(lint.result).errorCount).toBe(0);
});
it("writes nothing when file-back is false", async () => { /* run only the read steps; inventory unchanged */ });
```

   - **`brain-report.test.ts`** has the same shape as `brain-answer.test.ts`, with these differences:
     - Its verb list is `["brain.readIndex", "brain.lint", "brain.search", "brain.readNote", null, null, "capture.write"]`.
     - The `brain.lint` step runs `argvOf(cmd, "--json")`.
     - The canned report text names the INFRA example note's path and states its `isolated` finding.
   - **`brain-compile.test.ts`** works as follows:
     - Its verb list is `["brain.readIndex", "brain.search", "brain.readNote", null, "capture.writeNote"]`.
     - It plants a forbidden vendor for **both** `claude` and `codex`.
     - The canned compiled note is a `compiled-note` at `INFRA/compiled-dev-tools.md`, with `sources` naming both example notes it read.
     - It runs `argvOf(cmd, "INFRA/compiled-dev-tools.md")` with the note on stdin.
     - It asserts that the capture's `note` is `{ path, beforeSha256: null }`.
     - Then it runs `acceptAndIngest`. That exits 0 with `agent: null`, the note's bytes equal the reviewed content plus `\n`, and `brain lint` has `errorCount` 0.

- [ ] **Step 2: Run the tests** — deferred to phase close (D47)

Deferred to phase close (D47). Close runs `npm run test:e2e`, after `npm run build`. Record each file's duration for the `e2e` CI budget (40 minutes).

- [x] **Step 3: Gate and commit**

```bash
npm run lint
git add tests/e2e/brain-workflows/harness.ts tests/e2e/brain-workflows/brain-answer.test.ts tests/e2e/brain-workflows/brain-report.test.ts tests/e2e/brain-workflows/brain-compile.test.ts
git diff --cached --name-only
git commit -m "test(e2e): drive brain-answer, brain-report and brain-compile from their rendered skills"
```

### Task 13: The real-vendor gate test and `npm run test:vendor-brain` · S

**Done 2026-09-22, `d2c999b`** (D47 lane: lint only, tests and review owed at phase close); the real-vendor run itself is Task 16 Step 5.

Spec §7.3. The agent writes this test and never runs it: each run spends the founder's credits.

**Files:**
- Create: `tests/integration/brain-workflows/claude.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 4, Task 7 and Task 8.
- Produces: the script `test:vendor-brain`, run by the founder at Task 16.

- [x] **Step 1: Write the test**

**Setup.**
- Run only when `/usr/bin/which claude` succeeds **and** `process.env.DEVELOPER_OS_VENDOR_BRAIN_API_KEY` is non-empty (Plan decision 9). Otherwise mark the tests `it.skip`, the way `plugin-loads.test.ts` gates on `claude`.
- Create the home with `createTempHome()` and run `init --yes`, then `brain reindex`, through `runJson`.
- Install a `developer-os` shim in `home.binDir` with `#!/bin/sh\nexec '<process.execPath>' '<repo>/apps/cli/dist/bin.js' "$@"\n`.

**The environment.** `HOME`, `DEVELOPER_OS_HOME`, `DEVELOPER_OS_BRAIN` and `TMPDIR` come from the temp home. `PATH` is `${home.binDir}:${processEnv.PATH}`, and `ANTHROPIC_API_KEY` is the key the test was handed.

**One case per workflow.**

```ts
const PROMPTS = {
  "brain-answer": "Use the developer-os-brain-answer skill. question: what do the brain commands do? file-back: true",
  "brain-report": "Use the developer-os-brain-report skill. subject: tools. file-back: true",
  "brain-compile": "Use the developer-os-brain-compile skill. topic: dev",
  "brain-enhance": "Use the developer-os-brain-enhance skill. note: DEV/example-knowledge-note.md",
  "brain-garden": "Use the developer-os-brain-garden skill. limit: 1",
} as const;
it.each(Object.entries(PROMPTS))("%s loads and drives the CLI on a real Claude", async (id, prompt) => {
  const before = await inventory(home.root);
  const { stdout } = await run(claude!, ["--plugin-dir", PLUGIN_DIR, "-p", prompt, "--output-format", "json",
    "--allowedTools", "Read", "Bash(developer-os:*)"], { env, timeout: 300_000, cwd: home.root });
  expect(stdout).toMatch(/(DEV|INFRA|PROJECTS|TOOLS)\/example-[a-z-]+\.md/u);
  const added = addedPaths(before, await inventory(home.root)).filter((p) => !p.startsWith(home.tempDir) && !p.startsWith(join(home.home, ".claude")));
  expect(added.every((p) => p.includes("/content/_raw/quarantine/"))).toBe(true);
  expect(added.length).toBeLessThanOrEqual(1); // every prompt asks for at most one capture
  record(id, stdout); // appends { workflow, version from workflow.yaml, claude --version, date, git HEAD, result, command } to $TMPDIR/brain-vendor-rows.json for the matrix
});
```

**`package.json`.**
- Add `"test:vendor-brain": "vitest run tests/integration/brain-workflows/claude.test.ts"`.
- Append `--exclude 'integration/brain-workflows/**'` to `test:suite`.
- Do **not** add `test:vendor-brain` to `check`.

- [ ] **Step 2: Run the test** — owed: founder, real vendor (Task 16 Step 5)

The agent never runs this. At Task 16 the founder runs it as a stop condition.

- [x] **Step 3: Gate and commit**

```bash
npm run lint
git add tests/integration/brain-workflows/claude.test.ts package.json
git diff --cached --name-only
git commit -m "test(integration): real-vendor gate for the five brain workflows, run by hand"
```

### Task 14: E2E `brain-enhance` and `brain-garden` · M

**Done 2026-09-22, `4db919f`** (D47 lane: lint only, tests and review owed at phase close).

Spec §7.2, the remaining two workflows.

**Files:**
- Create: `tests/e2e/brain-workflows/brain-enhance.test.ts`, `tests/e2e/brain-workflows/brain-garden.test.ts`

**Interfaces:**
- Consumes: Task 12's harness, and Task 10, because garden runs the printed `--dry-run` commands.
- Produces: nothing.

- [x] **Step 1: Write the tests**

**`brain-enhance`.**
- Expected verbs: `["brain.readNote", "brain.readIndex", null, "brain.search", "brain.readNote", null, "capture.writeNote"]`.
- Plant forbidden vendors.
- Read `content/DEV/example-knowledge-note.md`. Build the revision by keeping the header lines except that it adds `updated: 2026-09-22`, keeps `created`, adds an alias, and adds a link `[[TOOLS/example-reference-note]]` to the body.
- Run `capture --note DEV/example-knowledge-note.md` with that revision on stdin.
- Assert that `beforeSha256` is the file's SHA-256, and that the step added only quarantine files.
- Run `acceptAndIngest`: exit 0, and the note's bytes equal the reviewed content plus `\n`. Run `brain lint`: `errorCount` 0.
- Second case: edit the note after capture, then ingest. That run exits 3, `JSON.stringify(result)` contains `note_changed_since_capture`, the file bytes equal the hand edit, and the capture is still `accepted`.

**`brain-garden`.**
- Expected verbs: `["brain.lint", "brain.readIndex", "brain.readNote", null, "capture.writeNote"]`.
- After `installedVault()`, plant the three-note tag (Plan decision 1). Write `DEV/garden-{a,b,c}.md` as `knowledge-note` files with `tags: [gardening]` and valid frontmatter, then run `brain reindex`.
- Run the rendered `brain lint` with `--json`. Assert that a `gap` finding exists for `gardening`, and that `isolated` findings exist for `INFRA/example-compiled-note.md` and `PROJECTS/example-project-note.md`.
- Play `limit: 1`:
  - One note capture: a `compiled-note` at `INFRA/gardening.md` whose `sources` name the three notes.
  - Accept and ingest it. The `gap` finding for `gardening` is gone.
- Play the structural half. Run `brain retire PROJECTS/example-project-note.md --dry-run --json` and `brain refactor --merge DEV/garden-a.md DEV/garden-b.md --dry-run --json`. Both exit 0 with `transactionId: null`, and the inventory is unchanged.
- Run the same `retire` without `--dry-run`, with `env: { CLAUDECODE: "1" }`. It exits 5 with `brain_refactor_in_agent_session`, and the inventory is unchanged.

- [ ] **Step 2: Run the tests** — deferred to phase close (D47)

Deferred to phase close (D47). Close runs `npm run test:e2e`.

- [x] **Step 3: Gate and commit**

```bash
npm run lint
git add tests/e2e/brain-workflows/brain-enhance.test.ts tests/e2e/brain-workflows/brain-garden.test.ts
git diff --cached --name-only
git commit -m "test(e2e): drive brain-enhance and brain-garden from their rendered skills"
```

### Task 15: Refactor security cases and the `brain-refactor` interruption sweep · M

**Done 2026-09-22, `49f84bd`** (D47 lane: lint only, tests and review owed at phase close).

Spec §7.4, the refactor half.

**Files:**
- Create: `tests/security/brain-refactor.test.ts`
- Modify: `tests/security/interruption.test.ts`

**Interfaces:**
- Consumes: Task 10.
- Produces: nothing.

- [x] **Step 1: Write the cases**

`brain-refactor.test.ts`:
- `brain refactor --move DEV/example-knowledge-note.md TOOLS` through a topic folder that is a symlink, where `content/TOOLS` points outside the vault, exits 5 `brain_refactor_path_refused` and changes nothing.
- An applied `brain retire` with `CLAUDECODE=1` exits 5 `brain_refactor_in_agent_session` and changes nothing.
- A `--rename` onto an occupied path exits 3 `refactor_destination_exists` and changes nothing.
- Every case asserts the exact exit code and `kind`, never `not.toBe(success)`: on the base commit the verbs are unknown commands, which exit 2 (Task 16 Step 3).

`interruption.test.ts`: add a **separate** `describe("a brain refactor interrupted at every forward phase")`.
- It has its own `REFACTOR_PHASES` list, its own `droveRefactor` set, and its own coverage assertion.
- It does not touch the existing `TARGETS`, `expectedStatus` or `EXPECTED_COVERAGE`, which assume a capture.
- For each of the seven phases:
  - Install the security fixture with `interruptAfter: phase, interruptKind: "brain-refactor"`.
  - Run a `--rename` with a referrer.
  - Assert that `listIncompleteTransactions` is non-empty and `doctor` reports `repair --resume`/`--rollback` naming it, except at `finalized`, where the existing `assertDoctorReports` branch rules apply.
  - Assert that `repair --rollback <id>` restores the pre-state bytes of the moved note and the referrer, or, after `finalized`, that the post-state is complete.
- Assert that `droveRefactor` equals the seven phases.

- [ ] **Step 2: Run the cases** — deferred to phase close (D47)

Deferred to phase close (D47). Close runs `npx vitest run tests/security/brain-refactor.test.ts tests/security/interruption.test.ts`.

- [x] **Step 3: Gate and commit**

```bash
npm run lint
git add tests/security/brain-refactor.test.ts tests/security/interruption.test.ts
git diff --cached --name-only
git commit -m "test(security): refactor refuses symlinks and agent sessions, and recovers at every phase"
```

### Task 16: Phase 5b closure · M

**Open.** Nothing below has run: canonical-document amendments, `npm run check`, the red-first runs against `13eb18e`, the whole-phase review, and the founder's real-vendor gate.

The orchestrator owns this task. Only it edits `docs/superpowers/`.

**Files:**
- Modify:
  - `docs/architecture/brain.md`: §3 "six lint classes" → eight, §6.4 "without inventing a seventh class", §6.11 add exit 3.
  - `docs/architecture/knowledge-pipeline.md`: §§1, 3, 5, 7, covering P2, note captures and verbatim ingest.
  - `docs/architecture/threat-model.md`: the §5.4 row, verbatim from spec §3.6.
  - `docs/architecture/workflow-schema.md`: §1 "six canonical workflows" → eleven, §5 "fifteen" verbs → sixteen.
  - `docs/migration/instruction-inventory.md`: §7 status column per spec §1.1.
  - `docs/superpowers/specs/2026-09-22-developer-os-brain-workflows-design.md`: drifted `path:line` citations (see Step 1).
  - `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`: Phase 5b checkboxes.
  - `docs/superpowers/ORDER.md` and `docs/superpowers/BACKLOG.md`.
- Create: `docs/releases/compatibility-matrix.md`, if it is still absent.

- [ ] **Step 1: Amend canonical documents**

Apply each amendment above.

Re-locate every line citation the spec and the amended documents make into moved code, and cite the symbol where a line is unstable. Known movers: `ingest.ts:1096`, `ingest.ts:275-281`, `main.ts:531-533`, `validate.ts:401,967,980`, `lint.ts:14`, `build.ts:221-233`, `proposal.ts:129-136`, `context.ts:164`, `context.ts:263-305`.

Create `docs/releases/compatibility-matrix.md` with a header row: workflow, version, vendor, vendor version, date, commit, result, command. DOS-P8 owns the rest of the matrix.

- [ ] **Step 2: Run the full lane D47 deferred**

```bash
npm run lint
npm run check
```

`npm run check` includes `npm test`, `npm run test:e2e`, `npm run test:vendor-ingest`, the build and `git diff --check`. It is slow; detach it the way the repository's background-gate note describes. Show failures only. Record the duration of each new e2e file against the 40-minute `e2e` job.

- [ ] **Step 3: Handle §7.4's "watched failing first"**

No test ran red per task under D47. For each new `tests/security/*` case, prove it fails for the stated reason by running it once against the phase's base commit plus only the test file. Use a scratch worktree at `13eb18e` with the file copied in, then `npm run build` and `npx vitest run <file>`. Record each red reason in the PR body. If that costs more than the founder allows, stop and ask. The fallback is to record the deviation as an accepted D47 risk in the roadmap.

- [ ] **Step 4: Fresh-context whole-phase review**

Dispatch `superpowers:requesting-code-review` to an agent that authored no Phase 5b task, over `13eb18e..HEAD`. Every accepted finding gets a failing regression test first, then the fix, then `npm run lint`. Rerun only the suites the fixes touch, then `npm run check` once more. The review specifically covers:
- anything touching `capture`, `ingest` or the executor, as a security change (`security.md` SEC-105);
- `git status` and `git diff` compared with the commits.

- [ ] **Step 5: Founder stop: the real-vendor gate**

Stop. Ask the founder to confirm Plan decision 9, which covers the API key variable and the exclusion from `check`, and to run:

```bash
npm run build
DEVELOPER_OS_VENDOR_BRAIN_API_KEY=<key> npm run test:vendor-brain
```

Copy `$TMPDIR/brain-vendor-rows.json` into five rows of `docs/releases/compatibility-matrix.md`. The phase gate needs `pass` on Claude for all five. Codex is not required (spec §7.3, NEW-61).

- [ ] **Step 6: Bookkeeping, branch and PR**

1. Tick the roadmap's two Phase 5b checkboxes.
2. Remove A12b from `ORDER.md` once the gate evidence is committed.
3. Record in `BACKLOG.md` every spec gap this plan's Plan decisions resolved, plus residuals R1, R2 and R8.
4. Then run:

```bash
git add docs/architecture/brain.md docs/architecture/knowledge-pipeline.md docs/architecture/threat-model.md docs/architecture/workflow-schema.md docs/migration/instruction-inventory.md docs/releases/compatibility-matrix.md
git add -f docs/superpowers/specs/2026-09-22-developer-os-brain-workflows-design.md docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md docs/superpowers/ORDER.md docs/superpowers/BACKLOG.md docs/superpowers/plans/2026-09-22-developer-os-brain-workflows.md
git diff --cached --name-only
git commit -m "docs: close Phase 5b (A12b brain workflows)"
```

Push the phase branch once and open one PR, as plan 1a's closure did (`#14`). Never merge.

---

## Spec Coverage Index

| Spec section | Task(s) |
|---|---|
| Q1-A note captures | 2, 4, 5, 7 |
| Q2-A lint mapping, `isolated`, `gap` | 1 (mapping needs no code; documented in 16) |
| Q3-A agent-session refusal | 10, 14, 15 |
| Q4-A report to session output | 8 (`brain-report` writes only a plain capture on file-back) |
| §1.1 inventory dispositions | 16 |
| §1.2 I1 one verb | 8 |
| §1.2 I2 model never replaces | 7 (plain path unchanged), 11 |
| §1.2 I3 executor and preconditions | 7, 10 |
| §1.2 I4 brain never writes | 3, 6, 9 |
| §1.2 I5 nine validators | 5 |
| §1.2 I6 determinism | 1, 6, 9 |
| §2 three mutation paths | 7 (P1, P2), 10 (P3) |
| §3.1 `capture --note` | 4 |
| §3.2 envelope field | 2 |
| §3.3 review rows | 4 |
| §3.4 verbatim ingest | 5, 7 |
| §3.5 `capture.writeNote` | 8 |
| §3.6 amended docs | 16 |
| §4.1–4.2 five workflows | 8 |
| §4.3 rendering | 8 (installation: A12, out of scope) |
| §4.4 invariant | 8 |
| §5.1–5.3 lint | 1, 5 (ingest-ignores pin) |
| §6.1 grammar and parser | 10 |
| §6.2 algorithm | 6 (steps 1–4), 10 (steps 5–7) |
| §6.3 modes | 6 (retire, rename, move), 9 (merge, split) |
| §6.4 link rewriting | 3, 6 |
| §6.5 post-conditions | 6 |
| §6.6 bound | 6 |
| §6.7 agent sessions | 10 |
| §6.8 result | 10 |
| §6.9 refusals | 6, 10 |
| §7.1 unit and contract | 1–10 |
| §7.2 fake-vendor e2e | 12, 14 |
| §7.3 real vendor, matrix | 13, 16 (founder stop) |
| §7.4 security | 11, 15, 16 (red-first evidence) |
| §7.5 phase gate | 16 |
| §8 residuals | 16 (recorded in `BACKLOG.md`) |
| §9 sequence | wave table (Task 8 consumes Task 4 per §9 step 4) |
