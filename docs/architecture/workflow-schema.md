# The workflow compiler

`packages/workflow-schema`, delivered by DOS-P3 on 2026-08-10. One description of a workflow,
rendered to any vendor, so nobody maintains a second copy.

**Design of record:** `docs/superpowers/specs/2026-07-21-developer-os-workflow-compiler-design.md`,
approved 2026-08-10. Where this note and that spec disagree, the spec wins. This document
replaces the implementation plan, which was deleted when its last step closed; git history is
the archive.

## 1. What it is

A workflow is YAML, validated by zod into `WorkflowContractV1`. Every step that touches the
world names a verb from a **closed** vocabulary, and each verb carries a read/write footprint.
The compiler unions those footprints and requires the result to *equal* the declared scopes.

| File | Responsibility |
|---|---|
| `src/parse.ts` | the YAML safety layer: one document, no tag, no anchor, no alias, pinned options. Returns `unknown` |
| `src/contract.ts` | `WorkflowContractV1` and its strict schema |
| `src/vocabulary.ts` | the closed verb table and each verb's effect footprint |
| `src/derive.ts` | scope derivation and the equality rule |
| `src/validate.ts` | `WorkflowValidationResult`, the finding shape, and the redaction seam |
| `src/overlay.ts` | `WorkflowOverlayV1` and the presentation-only merge |
| `src/load.ts` | file text → parse → validate, without ever throwing |
| `src/drift.ts` | `WorkflowRenderer`, `RenderedArtifact`, source markers, the drift check |
| `src/skill.ts` | the vendor-neutral skill body: source marker, `shared` preamble, refusals, steps, recovery, and the screen seam every adapter shares (added 2026-08-12 — see §2.2) |
| `src/index.ts` | the package's only public door, and the one file that decides what a consumer can reach — see §4 for why `workflowContractSchema` is not on it |
| `packages/security/src/screen.ts` | the one display screen, **moved** here from `packages/brain/src/redact.ts` in DOS-P3, because two peer subsystems needed it and neither may depend on the other |
| `workflows/<id>/workflow.yaml` | the six canonical workflows |
| `tests/fixtures/workflows/**` | seven synthetic negative fixtures |
| `tests/contracts/workflows/*.test.ts` | the contract cases shared with two future adapters |

## 2. What it cannot do, on purpose

1. **It emits and never executes.** No handler for any verb lives here. Scope enforcement is
   entirely compile-time: this package decides what a workflow is *allowed* to touch and never
   observes what it touches.
2. **It ships no vendor renderer.** *Amended 2026-08-12, when the skill body moved here.*
   `WorkflowRenderer` is still an interface, and every vendor artifact — the frontmatter fields,
   the artifact path, the plugin manifest — still belongs to `adapter-claude` and `adapter-codex`,
   which consume an already-validated contract. What this package now renders is
   `renderSkillBody` in `src/skill.ts`: the half of a skill that comes from one contract and is
   byte-identical for every vendor, because Codex's required frontmatter turned out to be exactly
   Claude's and a second renderer written the obvious way would have been a copy of the first.
   The package is still testable with neither agent installed, because nothing it renders names
   one.
3. **It makes no network request** and imports no networking module.
4. **`scheduled` is not a v1 trigger.** It is refused with an error naming DOS-P7, which adds
   the value in the same change that makes launchd fire it. A trigger that validates and never
   fires is a passing check about a false property.
5. **Pre-release and build metadata are not valid workflow versions.** `MAJOR.MINOR.PATCH` only,
   no leading zeros. An overlay pins `id@version` exactly, and comparing `1.2.3-rc.1` against
   `1.2.3` there would mean nothing. This narrows the spec's bare word "semver" and is recorded
   here because the spec wins by default.

## 3. The equality rule, and why over-declaring is an error

`compareScopes` requires the declared and derived scope sets to be **equal**, not compatible.

Under-declaring is obviously wrong. Over-declaring is wrong for a subtler reason: a workflow
claiming write access it never exercises is a lie the adapter would faithfully grant, and it is
how a scope grows without anyone deciding to grow it. Requiring equality also turns the check
into arithmetic on two sets rather than a judgement about intent — the strictness *is* the
mechanism.

Two properties the sets depend on:

- **Sorting is by code point**, which is UTF-8 byte order. Not `localeCompare`, which varies with
  ICU, and not the default `<`, which compares UTF-16 code units and puts every code point at or
  above U+10000 *below* U+E000–U+FFFF — deterministic inside Node, wrong the moment a renderer in
  another language orders the same set.
- **Normalization happens before de-duplication**, and on both sides of every comparison. The
  reverse order made the function a bag rather than a set: two spellings of the same accented
  name survived de-duplication and only then became identical.

## 4. The overlay's four fields, and what that costs

A vendor overlay has exactly `extends`, `steps`, `lifecycle`, `notes`. There is **no** field for
a scope, a refusal, a capability, or an effect verb. The guarantee that an overlay can never
weaken a canonical refusal or widen a write scope is therefore the *absence of a field* rather
than a merge rule that has to be correct — an overlay setting `scopes` fails as an unknown key.

The price, accepted: an overlay may only replace the prose of a step that already exists and is
already prose. A genuine per-vendor structural difference costs a schema version bump, which is
a visible cost rather than a subset check that fails open.

`validateWorkflow` is the only door into this package for the same reason. `workflowContractSchema`
is deliberately not exported: `zod@4.4.3` strips a `__proto__` key *before* its own strictness
check, so the raw schema accepts a workflow carrying one and silently drops it. The refusal lives
in `validateWorkflow`, which makes the guarantee structural rather than a rule everyone has to
remember.

## 5. The seven unimplemented verbs

The vocabulary has fourteen verbs. Seven have no handler yet; each raises an `info` finding
naming the subsystem that owes it, and the exact list is pinned by a test so that closing one
forces a return to this table.

| Verb | Owed by |
|---|---|
| `capture.write`, `capture.list`, `capture.setStatus` | DOS-P6 |
| `ingest.stage`, `ingest.validate`, `ingest.apply` | DOS-P6 |
| `agent.prompt` | the adapters, DOS-P4 and DOS-P5 |

`ingest.stage` writes into the transaction staging directory and therefore contributes **nothing**
to a derived write scope: staging is outside the vault and is governed by Foundation's transaction
model. Two mechanisms guarding one directory would mean neither is the authority. `ingest.apply`
carries both the staging flag and a real vault write — different axes, not an exclusive mode.

## 6. What DOS-P4 and DOS-P5 inherit

- **Spec §13's byte-identity requirement is met further than it was, and still not in full.**
  *Amended 2026-08-12, when the skill body moved here.* §13 asks that six workflows "render
  byte-identically twice, and once under a reversed directory reader". This package proved the
  narrower thing it could prove while it rendered nothing: the *inputs* a renderer is handed are
  byte-identical across two loads and under a reversed directory reader, and the drift check is
  deterministic against a stub. It now also proves that the skill **body** those inputs become is
  byte-identical across two renders, and it is one function rather than one per vendor, so two
  trees cannot differ in it at all. **The byte-identity of a whole vendor artifact — body plus
  that vendor's frontmatter, path and manifest — is still owed by DOS-P4 and DOS-P5**, each
  against its own generated tree. It is recorded here so it cannot be lost with the plan.
  **Amended 2026-08-12: both halves are paid.** DOS-P4's is proved over the six real workflows and
  the real Claude renderer (`claude-adapter.md` §6). DOS-P5's is proved the same way over the Codex
  renderer, and against `npm run render:claude` staying byte-identical after the shared-body move
  (`codex-adapter.md` §6). Neither note edited this paragraph directly, so it is corrected here.
- **`recovery.resume` is a command string that nothing in this package executes.** Whichever
  adapter first surfaces it must treat it as data to display, never as a command to run.
- **The first `.claude/` question.** DOS-P4 settles whether small conveniences under `.claude/`
  are publication artifacts needing an approval-and-hash cycle.

## 7. Where the six workflows say less than the product spec does

Ruled by the founder on 2026-08-10: recorded rather than closed, because each needs a handler
or a renderer that does not exist yet, and a contract written against a missing handler is a
promise rather than a specification. Every one of these is a gap in what the YAML *says* — none
is a defect in the compiler.

| Workflow | What the spec says | What the workflow says | Owner |
|---|---|---|---|
| `review` | §13.3 offers accept, edit, reject | its `decision` input advertises `edit`, and the only mutating verb is `capture.setStatus`; §13.1's status list has no "edited". Needs a `capture.edit` verb, which derives the same quarantine write scope | DOS-P6 |
| `ingest` | §13 is `transactional apply → index rebuild → retrieval` | stops at apply, so a note is ingested and `brain-search` cannot find it until somebody runs `brain reindex`. `brain.reindex` exists and is implemented; adding it widens ingest's declared scopes | DOS-P6 |
| `doctor` | §11 prints a matrix for the detected environment, and Foundation's `doctor` reports rather than repairs | refuses when no installation is found — while `shared` tells a user in exactly that state to run `developer-os doctor` | DOS-P4 |
| `brain-search` | §13.5 is `vault-map → catalog section → selected notes → sourced answer` | reads `content/_indexes/**` only and never `brain.readNote`, so it summarises from index metadata. Read-only either way, so this is completeness rather than safety | DOS-P6 |

**`shared` is extended by nothing.** Its description calls it "the common preamble and refusal
set every other workflow extends", and `WorkflowContractV1` has no composition field —
`WorkflowOverlayV1.extends` pins an overlay to its base, which is a different relation. So the
preamble carrying the entire prompt-injection defence reaches no other workflow, and its own
sentence "the scopes this workflow declares" resolves, in the only form the artifact has, to
`shared`'s empty scopes. **Delivering it to the other five is owed by DOS-P4 and DOS-P5**, whose
renderers are the thing that would inject it.

**A trigger implies no capability, and nothing checks that it can fire.** Capability
requirements are derived from step footprints only. `shared` declares `session_start` and
`capture` declares `session_end`, both with no capability and no `capability-missing` refusal —
so a workflow can name a trigger the host agent cannot fire and validate clean. That is the same
shape as the refused `scheduled` trigger: a value that passes validation while the property it
names is false. §11 also names `capture`'s fallback outright (the `developer-os run claude|codex`
wrapper), and the contract says nothing about it. **Owner: DOS-P4/P5**, which is where trigger
support becomes observable.

## 8. Known residuals

1. **Vocabulary globs hardcode `content/` and `_indexes`, which are configurable.**
   `BrainConfigV1.contentRoot` and `indexesDir` are settings; every glob in the table is a
   literal, exactly as spec §6 writes them. Nothing is wrong today, because the equality rule is
   arithmetic on the same literals on both sides, and the failure direction is safe — a vault
   with `contentRoot = "notes"` would get a grant naming a directory that does not exist, so the
   workflow fails rather than reaching further than declared. **Owner: DOS-P6.** Acceptance: the
   first time a handler or adapter resolves one of these globs against a real filesystem, the
   globs must be derived from the configuration rather than hardcoded, and spec §6 amended with
   them.
2. **The duplicate-step-id check has a bounded reporting gap.** It is a root-level zod refinement,
   and zod runs a root refinement when a child fails a *check* (a regex, a custom refinement) but
   skips it when a child fails a *type or shape* parse. So duplicate ids are reported alongside a
   bad trigger or a malformed step id, and **not** alongside a wrong `schemaVersion`, an unknown
   root key, a missing `recovery.resume`, or a non-string step id. It never fails open — the
   workflow is rejected either way — but it is a known exception to "every finding, not the
   first". **The boundary is pinned by a test** in `contract.test.ts` rather than only described
   here, because a residual that is asserted and not tested is one nobody notices moving. The fix,
   if it is ever worth making, is to move the scan into `validate.ts` beside the reserved-key
   check and delete the refinement; it must *replace* it, not sit beside it, or the finding
   doubles.
3. **One message is bounded at 512 rather than 64.** Every interpolated fragment is capped at 64
   graphemes; a zod issue's own text is only screened, with a 512-grapheme backstop on the
   assembled message, because that text is what names `DOS-P7`. A hostile field name can
   therefore put roughly 490 characters into a finding where every other interpolation allows 64.
   Bounded, but asymmetric.
4. **`warnCount` is structurally always zero.** No rule emits `warn`. It is a reserved severity;
   a zero there is not evidence of anything.
5. **`EFFECT_VOCABULARY` has a null prototype, and its declared type does not say so.** The type
   is `Record<string, EffectFootprint>`, which advertises every `Object.prototype` member, so
   `EFFECT_VOCABULARY.hasOwnProperty(verb)`, string coercion, and `toStrictEqual`/`deepStrictEqual`
   against a plain literal all type-check and then throw or fail. Use `lookupVerb`, and spread the
   table before comparing it.
6. **`steps[].with` is outside the scope guarantee, and that is the largest hole in it.** It is
   `z.record(z.string(), z.unknown())` — arbitrary keys, unvalidated values — and it contributes
   nothing to a derived footprint. The equality rule is over the *verb*, not its arguments, so a
   step reading `do: cli.run` with `with: {command: "rm -rf /"}` validates clean: `cli.run`
   declares an empty footprint while its `with` decides what it actually touches. Whichever
   adapter first executes a verb owns validating that verb's arguments; **this package cannot**,
   because it does not know what any handler does with them.
7. **Contract fields are never screened; only findings are.** `screenAndCap` guards every field
   of a `WorkflowFinding` — including `file`, on both the validation path and the parse-refusal
   path, which is a distinction worth stating because `load.ts` shipped without it for a day and
   nothing but a review noticed. `description`, `validators`, `steps[].prose`, `refusals[].message` and
   `recovery.resume` pass through as written, because they are the payload a renderer emits, not
   a message this package prints. `recovery.resume` is the one to watch: it is a *command string*
   that nothing executes today, and the moment a surface prints it as "run this to recover", an
   author-controlled shell line has reached a terminal. **Owner: DOS-P4/P5.**

   **Amended 2026-08-12, when the skill body moved into this package (`src/skill.ts`).** That
   changed the premise above for four of the five fields: `id`, `refusals[].message`,
   `steps[].prose` and `recovery.resume` are now screened at the render seam — `renderSkillBody`'s
   `screen` (and, for prose, `boundedProse`) — because rendering the body is now this package's
   job, not only the adapters'. `description` is the one field that still passes through here
   unscreened: `renderSkillBody` never puts it in the body, only each vendor's frontmatter does,
   so each adapter still screens its own copy, bounded by this package's exported
   `SKILL_FIELD_CAP` so two vendor trees truncate a long one at the same place. `validators` is
   likewise unrendered by `renderSkillBody` and stays whichever future surface's problem first
   displays it. **Owner: DOS-P4/P5, narrowed to `description` and `validators`; the other three
   fields are discharged.**
8. **"Nothing interprets the input" is proved for validation and unproved for rendering.** The
   `prompt-injection` fixture shows an injected instruction surviving validation as inert data.
   The determinism stub renders only a source marker and step ids, so no test shows what happens
   when free text reaches a real vendor artifact an agent reads as instructions. Scope the claim
   that way rather than generally.

   **Amended 2026-08-12.** `src/skill.test.ts` now covers this for the vendor-neutral body: 38
   cases render hostile free text — forged Markdown headings, fence runs that would swallow the
   recovery warning, an RTL override, oversized prose and preamble — through `renderSkillBody`
   into the actual joined artifact and assert what a reader would see, plus overlay cases covering
   a mismatched `extends`, a hostile `extends`, and an overlay on `shared`. The claim is proved for
   the body that is byte-identical across vendors; a vendor's own frontmatter (`description`) is
   each adapter's to prove, and `packages/adapter-claude/src/render.test.ts` covers Claude's.
9. **Over-declaring a capability is not an error, though over-declaring a scope is.**
   `validate.ts` checks only that a required capability is declared, never that a declared one is
   required — so §6's equality argument has no counterpart for capabilities. None of the six
   over-declares today. `file_write` is in `WORKFLOW_CAPABILITIES`, is named by no verb footprint,
   and is therefore unreachable by `capability-undeclared`.

## 9. The invariant worth defending

**A lookup table is not a lookup unless it cannot inherit.** Four separate modules in this package
shipped `table[key] !== undefined` over a plain object literal, and in every one of them a verb, a
trigger, a step id or an artifact path named `toString`, `constructor`, `valueOf` or `__proto__`
resolved to a `Function`, passed the guard, and crashed the validator one line later — while the
declared type said that value could not exist. Twice the crash was *hiding a missing refusal*: the
hostile name never reached the unknown-verb branch at all.

Three of the four were found by review rather than by any test, in three separate rounds. The
defences are now structural: a null prototype on the vocabulary, a `Map` for the retired-trigger
table and for the overlay's patches, a `ReadonlyMap` parameter on the drift check, and a single
`lookupVerb` accessor that every consumer goes through. `validateWorkflow` is total for any
`unknown` input — a cycle, twenty thousand levels of nesting, and a throwing getter all return a
finding — because a validator that aborts on the first hostile file cannot report on the other
five, which is the whole contract `load.ts` is built on.
