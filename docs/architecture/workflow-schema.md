# The workflow compiler

`packages/workflow-schema`, delivered by DOS-P3 on 2026-08-10. One description of a workflow,
rendered to any vendor, so nobody maintains a second copy.

This note absorbed the surviving design record on 2026-08-24, when the completed subsystem spec
was deleted. The implementation plan was deleted when its last step closed; git history is the
archive for both.

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
   `1.2.3` there would mean nothing. This deliberately narrows the original design's bare word
   "semver".

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

## 5. The remaining unimplemented verb

The vocabulary has fifteen verbs. DOS-P6 implemented the capture and ingest commands; only
`agent.prompt` has no step executor. It raises an `info` finding naming the adapters, and the exact
list is pinned by a test so that closing it forces a return to this table.

| Verb | Owed by |
|---|---|
| `agent.prompt` | the adapters, DOS-P4 and DOS-P5 |

`ingest.stage` writes into the transaction staging directory and therefore contributes **nothing**
to a derived write scope: staging is outside the vault and is governed by Foundation's transaction
model. Two mechanisms guarding one directory would mean neither is the authority. `ingest.apply`
carries both the staging flag and a real vault write — different axes, not an exclusive mode.

## 6. What DOS-P4 and DOS-P5 inherit

- **The completed design's byte-identity requirement is met in full.**
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

## 7. Workflow gaps after DOS-P6

The four workflow gaps recorded here on 2026-08-10 are closed. DOS-P6 added `capture.edit` to
`review` (`workflows/review/workflow.yaml:41`), reindexed after `ingest`
(`workflows/ingest/workflow.yaml:41`), made `brain-search` read selected notes
(`workflows/brain-search/workflow.yaml:43`), and aligned `doctor` with its report-only contract.
DOS-P4 and DOS-P5 also made the shared preamble part of every rendered skill body
(`packages/workflow-schema/src/skill.ts:201`). These are historical outcomes, not open work.

Two genuine gaps remain:

1. **`agent.prompt` has no step executor.** It is the sole item in §5 and is owned by the adapters
   (`packages/workflow-schema/src/vocabulary.ts:119`).
2. **A declared trigger is not validated against an observable host capability.** DOS-P6 removed
   the unfireable `session_start` and `session_end` declarations and both shipped contracts are
   manual-only, so no current workflow exercises this gap. Reintroducing a non-manual trigger must
   add the host-capability validation and a firing test in the same change.

The manual-only change was a contract change, not an amendment: `shared` and `capture` moved to
`2.0.0`. `docs/architecture/knowledge-pipeline.md` §2 records the decision and its costs.

## 8. Known residuals

1. **CLOSED by DOS-P6: vocabulary globs keep canonical `content/` and `_indexes` names and resolve
   them at the handler boundary.**
   `BrainConfigV1.contentRoot` and `indexesDir` are settings; every glob in the table is a
   canonical literal. `resolveScopeGlob(glob, config)` rewrites the leading segments before a
   handler touches the filesystem, while declared-versus-derived arithmetic remains over the
   canonical names. Templating inside the YAML was rejected because it would add substitution
   syntax to the portable contract.
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

## 10. Normative parser and contract

### 10.1 Parser

Canonical workflows are vendor-neutral YAML data. The parser uses YAML 1.2, `parseAllDocuments`,
`uniqueKeys: true` and silent logging with errors read from the document. It refuses a second
document, every explicit tag, every anchor and every alias before conversion, converts with
`maxAliasCount: 100`, and turns library throws into a bounded `malformed` refusal. Unknown fields
are rejected by strict schemas at every level.

### 10.2 `WorkflowContractV1`

| Field | Normative shape |
|---|---|
| `schemaVersion` | literal `1` |
| `id` | directory-matching slug, `^[a-z][a-z0-9-]*$` |
| `version` | `MAJOR.MINOR.PATCH`, no leading zero, pre-release or build metadata |
| `description` | non-empty string |
| `triggers` | non-empty ordered array from `manual`, `session_start`, `session_end`; `scheduled` remains refused until DOS-P7 makes it fire |
| `inputs`, `output` | slug-keyed records of strict `{ type, required, description }`; type is `string`, `integer`, `boolean` or `path` |
| `capabilities` | ordered array from `structured_result`, `non_interactive_run`, `session_start_injection`, `session_end_capture`, `file_write`; `file_write` is reserved and currently named by no verb footprint |
| `scopes` | strict `{ read: string[], write: string[] }`, declared and equal to derived footprints |
| `refusals` | ordered strict refusal records, §10.4 |
| `steps` | non-empty ordered array of unique-id steps, §10.3 |
| `validators` | ordered non-empty strings |
| `recovery` | strict non-empty `{ leaves, resume }` strings; `resume` remains inert data here |

Author-ordered arrays are never resorted. Compiler-derived sets sort by code point after NFC
normalization. The workflow id must equal its containing directory, and duplicate step ids are
errors because overlays key by them.

### 10.3 Steps and effect vocabulary

A step has a slug `id` and exactly one of non-empty `do` or non-empty `prose`; `with` is legal only
with `do`. Effect steps name the closed table in `src/vocabulary.ts`; prose is inert. Anything that
touches the filesystem, network, a process or vault must be a verb. The compiler unions verb
footprints and requires exact equality with declared read/write scopes, rejecting both under- and
over-declaration. Only `agent.prompt` remains unimplemented; configured vault roots resolve at the
handler boundary rather than by templating canonical workflow YAML.

### 10.4 Refusals and exit codes

`when` is closed to `capability-missing`, `index-missing`, `vault-missing`, `input-invalid` and
`scope-violation`. `exit` is one of Foundation's failure codes 1–6, never success 0, and a missing
capability uses code 4. Every required capability must have a declarative refusal; messages are
non-empty and pass through the shared bounded display screen.

### 10.5 Validation output and public boundary

Validation is total over `unknown` and returns every finding it can establish, each with file,
optional step id, rule and `error`, `warn` or `info` severity. A finding never echoes source
content. Consumers enter through `validateWorkflow` and the package public index;
`workflowContractSchema` is intentionally not exported because raw zod parsing can strip hostile
prototype keys before strictness observes them.

## 11. Former spec section map

Source comments predating the completed-spec cleanup use the former section numbers. They now
resolve here:

| Former design section | Current authority |
|---|---|
| §1 | §1 |
| §2 | §2 |
| §3 | §10.1 |
| §4 | §10.2 |
| §5 | §10.3 |
| §6 | §3, §5 and §10.3 |
| §7 | §10.4 |
| §8 | §4 |
| §9 | §1, §6 and §8 |
| §10 | §1 and §7 |
| §11 | §8, §9 and §10.5 |
| §12 | §2, §9 and §10.1 |
| §13 | §6, §8 and §9 |
| §14 | §1, §4, §6, §8 and §10.5 |
| §15 | §2, §7 and §8 |
