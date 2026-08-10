# Developer OS Workflow Compiler Design

**Date:** 2026-08-10

**Status:** **Approved by the founder on 2026-08-10**, after a walkthrough of §15 that ruled
every decision it makes — six as drafted, one reversed into §15.8. This is the design of
record for DOS-P3. It is still not a licence to write code: the implementation plan comes
first, which is a Global Constraint of the program plan.

**Scope:** Program Task 3 (`DOS-P3`) — the canonical workflow contract, its validator, the
effect vocabulary that makes declared scopes checkable, the vendor overlay boundary, and the
generated-artifact drift check. Produces `packages/workflow-schema/` and `workflows/`.

**Amends nothing.** It elaborates §6.5, §10 and §11 of
`specs/2026-07-21-developer-os-design.md` and contradicts none of them. If a clause here is
ever found to contradict that document, that document wins and this one is wrong.

---

## 1. What this subsystem is for

Developer OS must run the same workflow under Claude Code and under Codex without maintaining
two copies of it. The alternative — one hand-written file per agent per workflow — is what
every comparable project reaches for, and it fails in a specific way: the two copies agree on
the day they are written and disagree silently forever after.

So there is one canonical description of each workflow, and vendor artifacts are **generated**
from it. The whole subsystem exists to make one sentence true:

> A vendor overlay can never weaken a canonical refusal or widen a write scope.

Everything below is chosen to make that sentence enforceable by a machine rather than by a
reviewer's attention.

## 2. Non-goals

- **This package does not execute workflows.** It loads, validates and emits. The generated
  plugin artifacts are what run, inside the agent. A local execution engine would need a step
  interpreter, process isolation and runtime scope enforcement — a second product, and one
  that would move scope checking from compile time to run time, which is the wrong direction.
- **No conditionals, loops, or cross-workflow composition in v1.** If they are needed, they
  are a v2 schema, not a field added quietly.
- **No vendor knowledge in this package.** Renderers live in `adapter-claude` and
  `adapter-codex` (DOS-P4/P5) and consume an already-validated contract, so this package is
  testable with neither agent installed.
- **No runtime handler implementations.** See §6 on unimplemented verbs.

## 3. A canonical workflow is data, not code

```text
workflows/<id>/workflow.yaml            canonical · vendor-neutral · data
workflows/<id>/overlay.claude.yaml      presentation only · optional
workflows/<id>/overlay.codex.yaml       presentation only · optional
```

YAML, parsed strictly and validated by zod into `WorkflowContractV1`.

**Data rather than a TypeScript module, and the reason is the gate.** A `.ts` workflow can
import, branch and call; "no vendor behaviour inside canonical workflows" then becomes a
review convention. A data file cannot express behaviour at all, so the rule is structural.
The cost is real and accepted: there is no compile-time checking of a workflow, so every
guarantee comes from the validator and its tests.

**The parser is the one `packages/brain` already proved.** Same library, same pinned options,
same reasons — YAML 1.2 core schema so a tag spelled `no` stays the string `"no"`;
`uniqueKeys` so a duplicate key is an error rather than last-one-wins; `logLevel: "silent"`
with errors read by hand, because the default prints the offending source line to stderr;
and **an explicitly tagged node is refused outright**, per brain-engine spec §4.4 clause 5.
A workflow file is repository content rather than user content, but the parser does not know
that and should not have to.

Unknown fields are rejected. `WorkflowContractV1` is `.strict()` at every level.

## 4. `WorkflowContractV1`

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `1` | literal; a different value is refused with a named error, never coerced |
| `id` | slug | `^[a-z][a-z0-9-]*$`; must equal the directory name |
| `version` | semver | the workflow's own version, independent of `schemaVersion` |
| `description` | string | human-facing, one paragraph |
| `triggers` | array | closed set: `manual`, `session_start`, `session_end`. **`scheduled` is not a v1 value and is refused**, with an error naming DOS-P7 as its owner — see the decision in §15.8. DOS-P7 adds it to this set in the same change that makes `launchd` fire it |
| `inputs` | record | name → `{ type, required, description }`; types are `string`, `integer`, `boolean`, `path` |
| `output` | object | the structured result shape the workflow promises |
| `capabilities` | array | keys from §11 of the product spec; unknown keys are refused |
| `scopes` | `{ read, write }` | arrays of vault-relative globs — **declared**, and checked against derivation (§6) |
| `refusals` | array | `{ when, exit, message }` (§7) |
| `steps` | array | ordered; each is an effect step or a prose step (§5) |
| `validators` | array | named post-conditions the generated artifact must assert |
| `recovery` | object | what a partial failure leaves behind, and which command resumes it |

Every array in the contract has a **stated total order** — the order the author wrote — and
is never re-sorted. Rendering sorts nothing that the author ordered; it sorts only sets the
compiler itself derives, and those sort byte-wise over NFC UTF-8. `localeCompare` is
forbidden here for the same reason it is forbidden in `packages/brain`.

## 5. Steps: closed verbs where there are effects, prose where there are none

A step is one of exactly two shapes.

**An effect step** names a verb from a closed vocabulary and supplies typed parameters:

```yaml
- id: load-index
  do: brain.readIndex
- id: rank
  do: brain.search
  with: { query: $input.query, limit: $input.limit }
```

**A prose step** carries text and declares no effect:

```yaml
- id: explain
  prose: |
    Summarise why each match was returned.
```

A step has `do` or `prose`, never both and never neither. `id` is unique within the workflow
and is what an overlay keys on.

**Why not free prose everywhere.** Because then declared scopes are unverifiable: nothing
stops the prose instructing a write the step never declared, and the gate degrades to a
convention. **Why not verbs everywhere.** Because `review` is largely judgement expressed as
instruction, and forcing it into verbs produces a verb meaning "ask the model this text",
which is the prose step wearing a disguise.

The line between them is precise: **if it touches the filesystem, the network, a process, or
the vault, it is a verb.** Prose steps are inert by construction.

## 6. The effect vocabulary, and scope derivation

The vocabulary is a constant in `packages/workflow-schema`. Each verb maps to its effect
footprint:

| Verb | Read | Write | Capability | Handler owed by |
|---|---|---|---|---|
| `brain.readIndex` | `content/_indexes/**` | — | — | DOS-P2 ✅ |
| `brain.search` | `content/_indexes/**` | — | — | DOS-P2 ✅ |
| `brain.readNote` | `content/**` | — | — | DOS-P2 ✅ |
| `brain.reindex` | `content/**` | `content/_indexes/**` | — | DOS-P2 ✅ |
| `brain.lint` | `content/**` | — | — | DOS-P2 ✅ |
| `capture.write` | — | `content/_raw/quarantine/**` | — | DOS-P6 |
| `capture.list` | `content/_raw/quarantine/**` | — | — | DOS-P6 |
| `capture.setStatus` | — | `content/_raw/quarantine/**` | — | DOS-P6 |
| `ingest.stage` | `content/_raw/quarantine/**` | *staging, outside the vault* | `structured_result` | DOS-P6 |
| `ingest.validate` | staging | — | — | DOS-P6 |
| `ingest.apply` | staging | `content/**` | — | DOS-P6 |
| `doctor.report` | — | — | — | Foundation ✅ |
| `cli.run` | — | — | `non_interactive_run` | Foundation ✅ |
| `agent.prompt` | — | — | — | adapters |

**Scopes are vault-relative, and only vault paths are scopes at all.** `ingest.stage` writes
into the transaction staging directory, which is outside the vault by product spec §13.4 — so
it contributes nothing to a derived write scope, and `ingest`'s declared write scope comes
from `ingest.apply` alone. Staging is governed by Foundation's transaction model, not by this
one; two mechanisms guarding one directory would mean neither is the authority.

**Derivation.** The compiler unions the footprints of every effect step and compares the
result with the declared `scopes`.

**They must be equal, not merely compatible.** Under-declaring is obviously an error.
Over-declaring is *also* an error: a workflow claiming write access it never exercises is a
lie the adapter would faithfully grant, and it is how a scope grows without anyone deciding
to grow it. This is stricter than the gate strictly requires, and the strictness is the
mechanism — the check is arithmetic on two sets, not a judgement about intent.

Declaration is kept rather than derived-and-silent because two independent statements that
must agree catch what one statement cannot: adding a verb without meaning to.

**Unimplemented verbs.** Seven verbs above have no handler yet. The compiler does not execute
anything, so it needs the vocabulary and not the implementations — but a verb with no handler
is a promise, so the vocabulary records the owning subsystem, and `WorkflowValidationResult`
carries an `unimplemented` finding at **info** severity naming the verb and its owner. It does
not fail the build: DOS-P3 shipping workflows whose handlers arrive in DOS-P6 is the plan, not
a defect. It fails the build the day DOS-P6 closes, and that is enforced by a test in DOS-P6
rather than by a promise here.

## 7. Refusals

A refusal is a declarative precondition:

```yaml
refusals:
  - when: capability-missing
    exit: 4
    message: This workflow needs a structured result and the agent does not provide one.
```

`when` is a closed set: `capability-missing`, `index-missing`, `vault-missing`,
`input-invalid`, `scope-violation`. `exit` is a `CliExitCode` from `packages/core` — reusing
Foundation's enum rather than inventing a second one. Missing capability is exit **4**, fixed
by product spec §11.

Every workflow must declare a refusal for each capability it requires. A workflow that
requires `structured_result` and does not say what happens without it is refused at
validation, because that gap becomes a runtime surprise inside somebody's agent session.

## 8. Overlays: the schema has no field to weaken

```yaml
# workflows/brain-search/overlay.claude.yaml
extends: brain-search@1.2.0
steps:
  explain:
    prose: |
      Return matches as a markdown table.
lifecycle:
  bind: session_start
```

`WorkflowOverlayV1` has exactly four fields: `extends`, `steps` (prose replacement, keyed by
step id), `lifecycle`, and `notes`.

**It has no `scopes`, no `refusals`, no `capabilities`, and no `do`.** The gate is not a merge
rule that must be correct; it is a schema that cannot express the violation. An overlay
setting `scopes` fails as an *unknown field* at parse time.

Two consequences, both accepted:

- An overlay may only replace the prose of a step that **already exists and is already a prose
  step**. It cannot add a step, remove one, reorder them, or turn a prose step into an effect
  step. `extends` pins the exact workflow version, so an overlay silently outliving the step
  it patches is a validation error rather than a no-op.
- If a genuine per-vendor scope difference ever appears, it needs a schema version bump. That
  is the cost, and it is preferable to a subset-checking algorithm that fails open — this
  project has twice shipped a check that passed while the property it named was false.

## 9. Generated artifacts and drift

Rendering is a pure function of `(contract, overlay, vendor)`. Generated files carry a source
marker naming the canonical file and the contract version, and are never edited.

The drift check regenerates every artifact and compares. It reports **the artifact and the
first differing line, never a diff** — the same rule as brain-engine spec §6.3, for the same
reason: a diff echoes content into a terminal and a log.

Determinism is the Brain's contract restated: byte-identical output under a frozen clock and
under a reversed directory reader; `generatedAt` the only time-derived value, written once
per artifact; no float stored anywhere.

CI runs the drift check. That is now a real sentence rather than an aspiration —
`.github/workflows/check.yml` has existed and been green since 2026-08-10.

## 10. The six workflows

All six ship in DOS-P3. None of their semantics are invented here; each derives from an
approved section of the product design spec.

| Workflow | Derives from | Effects |
|---|---|---|
| `shared` | §10 | none — the common preamble and refusal set every other workflow extends |
| `brain-search` | §13.5 | read only |
| `capture` | §13.1, §13.2 | writes quarantine only |
| `review` | §13.3 | reads quarantine, sets status; **never deletes a source** |
| `ingest` | §13.4 | stages outside the vault, validates, applies transactionally |
| `doctor` | §11 | none — reports the capability matrix |

`review` and `ingest` are the two that matter for the gate, because they are the only ones
that write into the vault. Both are expressed entirely in effect verbs; neither has a prose
step that touches anything.

## 11. Validation output and error reporting

`WorkflowValidationResult` carries **every** finding, not the first, each with the file, the
step id, the rule, and a severity of `error`, `warn` or `info`.

**A message never echoes file content.** Same rule and the same reason as `packages/brain`,
and the same shared screen: values interpolated into a finding are screened for control and
format characters and bounded, via `redact.ts`. A workflow file is repository content today;
`workflows/` becoming user-extensible later must not require rediscovering this.

## 12. Security

- **Untrusted input.** A workflow file is parsed, never evaluated. Prose steps are inert data
  to this package; what an agent does with them is the adapter's boundary, and product spec
  §14.5 owns prompt injection.
- **Prompt instructions embedded in source data** are a required negative fixture (§13): a
  workflow whose `description` or prose contains text shaped like an instruction to the
  compiler must be treated as text. Nothing in this package interprets its own input.
- **No network.** This package makes no request. It is inside the capability scan's sweep
  automatically, since that scan enumerates every workspace under `packages/`.

## 13. Testing

Fixtures are synthetic. No real vault, no real client name, no copied third-party content.

Required negative fixtures, four from `BACKLOG.md` §3 and two the design adds:

1. a workflow requiring a capability the target does not provide;
2. a workflow whose declared write scope exceeds what its verbs derive;
3. a workflow carrying prompt instructions inside source data;
4. an incompatible `schemaVersion`;
5. **an overlay attempting to set `scopes`** — must fail as an unknown-field parse error, not
   as a merge check, and the test asserts *which* kind of failure it is;
6. **a workflow that over-declares** — the §6 equality rule, which a subset check would pass;
7. **a workflow declaring `trigger: scheduled`** — must be refused by the enum, and the test
   asserts the error names DOS-P7, because the whole value of §15.8 is that the author is told
   where the capability went rather than left to wonder why nothing fires.

Positive coverage must include one workflow of each of the six shapes rendering
byte-identically twice, and once under a reversed directory reader.

**Every gate that sweeps a set asserts the set is non-empty, per scope.** A drift check that
finds no artifacts passes silently otherwise, which is the shape of the defect that let
`packages/brain` go unscanned for three days.

## 14. Produces

`packages/workflow-schema/src/` — `contract.ts` (`WorkflowContractV1`, zod schemas),
`vocabulary.ts` (the verb table and footprints), `derive.ts` (scope derivation and the
equality rule), `overlay.ts` (`WorkflowOverlayV1` and the presentation merge), `load.ts` (the
strict loader), `validate.ts` (`WorkflowValidationResult`), `drift.ts`, `index.ts`.

Exported types, as `BACKLOG.md` §3 requires: `WorkflowContractV1`, `WorkflowCapability`,
`WorkflowInputSchema`, `WorkflowOutputSchema`, `WorkflowRenderer`, `RenderedArtifact`,
`WorkflowValidationResult`.

`WorkflowRenderer` is an **interface only** — this package declares the shape and implements
no renderer.

Also creates `workflows/*` and `tests/{contracts,fixtures}/workflows/`. `tests/contracts/`
does not exist yet; `BACKLOG.md` §5 records that DOS-P2 chose to put contract cases beside
the code instead. DOS-P3 creates it, because a contract shared between this package and two
adapters is not beside any one of them.

## 15. Decisions this spec makes, for the record

1. Canonical workflows are **data**, not TypeScript modules — so the gate is structural.
2. Steps are **closed verbs where there are effects, prose where there are none**.
3. Declared and derived scopes must be **equal**, not compatible.
4. Overlays are **presentation only**, enforced by the absence of fields rather than by a
   merge check.
5. DOS-P3 is a **compiler, not a runtime**.
6. **All six workflows ship in DOS-P3**, deriving from approved product spec §11 and §13
   rather than from anything invented here.
7. An **independent security review** is satisfied by a fresh-context agent review, the
   discipline used throughout DOS-P2. Recorded here because `BACKLOG.md` §3 gates DOS-P6 on
   that phrase and it had no agreed meaning.
8. **`scheduled` is not a v1 trigger value.** It is refused with an error naming DOS-P7, and
   DOS-P7 adds it in the same change that makes `launchd` fire it.

**All eight were ruled by the founder on 2026-08-10**, decisions 1 to 5 in a walkthrough of
this section. Decision 6 was made against the recommendation in this document's brainstorming,
and the objection was withdrawn once §13 was confirmed to specify the pipeline the objection
assumed was missing.

**Decision 8 reverses this document's first draft**, which made `scheduled` declarable and
inert on the argument that a trigger silently doing nothing is worse than one that is refused.
The argument was right and the conclusion did not follow from it: a value that passes
validation while the property it names is false is precisely the defect shape this repository
has shipped twice — a self-containment enumerator that skipped every file under a `#` path and
exited 0, and a capability scan that asserted non-emptiness per listed package and so never
noticed an unlisted one. Refusing the value is how it stops being that shape.

**Decision 5 was accepted knowing what it does not do**, and it is worth writing down where a
reader will find it rather than only in a conversation. Scope enforcement is compile-time only.
Once an artifact is inside Claude or Codex, `scopes` is a declaration the adapter rendered, not
a sandbox — nothing in this product observes what the agent then does. What protects the vault
is that `review` and `ingest`, the only two workflows that write into it, are expressed
entirely in effect verbs with no prose step that touches anything (§10), and that staging is
governed by Foundation's transaction model (§6). Two alternatives were on the table and
declined: requiring the adapters to render a declared write scope into whatever the vendor can
actually enforce, and forbidding prose steps outright in any workflow that declares a write
scope. Either remains available to DOS-P4/P5 without changing this contract, and neither is
owed by it.
