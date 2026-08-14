# Developer OS — Threat Model

**Consolidated 2026-08-14 by DOS-P6 Task 18**, per the knowledge-pipeline design spec §8.5 and the
row `docs/superpowers/BACKLOG.md` §5 carried from the day the program file map was written.

This document **consolidates a posture that already exists**; it invents none. Everything in it was
already recorded in `docs/architecture/claude-adapter.md`, `docs/architecture/codex-adapter.md`,
`docs/architecture/brain.md`, `docs/architecture/foundation.md` and
`docs/architecture/foundation-constraints.md` — spread across five notes, which is exactly why a
reader could hold four of them and still not know what defends what. What is new here is one place
where every boundary sits beside the mechanism that enforces it and the artifact that proves it.

**Every row cites the code or the test, and the exceptions are declared rather than hidden.** A
threat model whose claims cannot be checked against the tree rots at the first refactor, so a
mechanism is a `path:line` and evidence is a named test case wherever one exists. **Three kinds of
row fall short of that, and each says so where it appears:**

1. **Six mechanisms in §5 name another note's section *beside* their `path:line`, never instead of
   it** — `foundation.md` §3's phase table, §4's two ownership universes, §5's two screening rules
   and §7's discovered absences, plus `claude-adapter.md` §9's residual 10. Each is a property whose
   enforcement is diffuse across a subsystem, where a single line names one of a dozen sites and
   implies it is the only one; those notes carry the per-claim citations. **Every mechanism cell in
   §5 carries a `path:line` as well.** In **§7** the mechanism *is* an absence — there is no line at
   which a thing that does not exist is enforced — so four of those rows put the whole citation in
   the evidence cell, which is where the scan that proves the absence lives.
2. **Some evidence cells name a suite file rather than a case**, where the property is asserted
   across many cases in that file and picking one would understate the coverage. Where a boundary
   rests on a *particular* case, the case is named.
   Separately, a few cells point at a **`BACKLOG.md` §1 row** — those are *records* naming who owns a
   gap, never a mechanism standing in for a line.
3. **Where a boundary rests on a `tests/security/` case that carries no watched-failure
   demonstration, the cell says `(§8: no watched failure)`.** 18 of that directory's 59 cases are in
   that position, and citing one without the marker would let a reader take it for evidence — the
   failure mode §1 exists to prevent, one level down. §8 is the whole accounting, **including what
   about §8 itself is not checkable against this repository.**

**Two things stay where they are.** The **capability model** — two gates, three values — is recorded
per adapter and is deliberately not moved here; `codex-adapter.md` §3 says why, and
`apps/cli/src/adapter-capability-parity.test.ts` is what keeps the two vocabularies identical while
it stays there. The **residuals** with named owners stay in their own notes' residual sections; this
document names only the ones that change what a boundary is worth.

---

## 1. Three boundaries this document would naturally claim, which do not hold

Stated first, because a reader who stops after one section must not leave believing an enforcement
that is absent. Each is stated again in §5, beside the boundary it belongs to, with its mechanism
and its record.

| Boundary | Status | The record that owns it |
|---|---|---|
| A capture stays inside the vault | **absent for a relocated quarantine directory** | `BACKLOG.md` §1 **NEW-14** |
| A secret removed from a vault file is gone from the machine | **absent** — the pre-edit copy survives in the transaction backup | `ORDER.md`, the third Foundation request |
| An agent invocation is bounded in turns | **partial** — bounded under Claude, no such field under Codex | `codex-adapter.md` §11.3 |

**These are not "known issues" filed at the back.** Two of them defeat a sentence this product tells
a user to their face: that a capture is contained, and that `review --decision edit` removed the
secret they pasted. The third means one of two vendors runs an unbounded agentic loop under a
120-second wall clock and nothing else.

**Three further gaps were found while writing this document**, all registered as `BACKLOG.md` §1
rows: **NEW-15**, the discovered vendor binary is executed without the owner and mode check its own
type says its executor owes (§5.11); **NEW-16**, the `user-pattern` redaction class has no production
caller and no configuration key, so spec §8.2's user-configured patterns are unreachable (§5.7); and
**NEW-17**, a TOML parse failure on a `brain` run reaches the user through the heuristic redactor
alone, because it is the one command of the eight that reads configuration without the wrapper the
other seven use (§5.7, §5.12). None was fixed here — this is a documentation task and no production
file is in its scope.

---

## 2. What is being defended, and against whom

Developer OS is a **local-first CLI on one developer's machine**. There is no server, no account, no
telemetry and no network (§7). The assets are therefore local and few:

| Asset | Why it matters |
|---|---|
| The user's vault | their own knowledge, in Markdown they hand-edit in Obsidian; the product must never corrupt or silently rewrite it |
| Secrets that pass through a capture | a developer pastes an observation containing a token far more often than they mean to |
| The user's home directory | credentials the product must never read and never write near |
| The vendor agent CLI's authority | it runs as the user; anything that widens its scope widens theirs |
| The installation manifest | it decides what the product owns and therefore what it may delete |

The adversaries this design actually anticipates, in the order they cost:

1. **Captured text**, because it is written by a model reading a session and is then read by another
   model. This is the prompt-injection surface and it is the reason the pipeline exists in the shape
   it does.
2. **Model output**, because a proposal is a set of file paths and file contents chosen by a
   language model that has just read attacker-influenceable material.
3. **The user's own mistakes** — a pasted secret, a hand-edited capture, a symlink, a stale manifest.
4. **A hostile process with write access to the product's own directories.** Partly defended: paths
   are canonicalized and re-checked, the key refuses a symlink or a FIFO, and transactions verify
   what they wrote. Not defended in general — an attacker who can already write freely inside the
   user's home has other doors.

**Explicitly out of scope:** a compromised vendor CLI binary, a compromised Node runtime, a malicious
model provider, physical access, and the operating system's own permission model. This product runs
an agent CLI the user installed and trusts; it constrains what that CLI is *asked* to do and never
pretends to sandbox it.

---

## 3. What is untrusted, and why

| Input | Untrusted because | First code that touches it |
|---|---|---|
| **Capture text** | agent-authored from a session an attacker may have influenced; may contain secrets the author never meant to send | `apps/cli/src/commands/capture.ts:333` |
| **Vault content** | user data, hand-edited, and may contain secrets the user wrote into their own notes | `packages/brain/src/schema/note.ts`, via `BrainService` |
| **Model output** | a proposal chosen by a model that has just read untrusted capture text | `packages/brain/src/ingest/proposal.ts:199` |
| **The vendor CLI's stdout** | a third-party binary's output, streamed, and parsed into an object callers will spread | `packages/security/src/cli.ts:134` |
| **Configuration** | a TOML file the user edits by hand | `apps/cli/src/commands/doctor.ts:209` (`readConfigFile`), then `packages/core/src/config/loader.ts:163` |
| **The installation manifest** | a JSON file on disk that decides ownership, and therefore deletion | `packages/core/src/manifest/store.ts:246` |
| **`PATH`** | it decides which binary is `claude` or `codex` | `packages/platform-macos/src/macos.ts:143` |
| **Every path anywhere** | a symlink makes the written path and the destination differ, which is the whole bug class | `packages/security/src/paths.ts:45` |

**One rule sits above all of them, and its ordering is the rule:** *redact before truncating,
hashing, logging, persisting, or sending to a model.* It is enforced structurally rather than by
discipline — see §5.1.

---

## 4. The pipeline, with the seams marked

```text
  agent writes an observation
        │
        │  ── seam 1: text → redaction → quarantine        §5.1
        ▼
  content/_raw/quarantine/<captureId>.md      (redacted; never a managed artifact)
        │
        │  ── seam 2: the capture file's own containment   §5.2  ◀ NEW-14
        ▼
  developer-os review --decision accept|reject|edit
        │
        │  ── seam 3: envelope.content → prompt            §5.3
        ▼
  vendor agent CLI, zero write scopes, no PATH, no shell   §5.5
        │
        │  ── seam 4: stdout → structured proposal         §5.4
        ▼
  nine deterministic validators                            §5.4
        │
        │  ── seam 5: proposal → transaction → vault       §5.9
        ▼
  content/<topic>/<note>.md   →   brain reindex   →   status: ingested
```

Every seam is a place where something untrusted becomes something the product acts on. The rest of
this document is one section per seam plus the ambient boundaries — configuration, the manifest,
`PATH`, and the key.

---

## 5. The boundaries

Each table is `boundary → mechanism → evidence`. Evidence names a test case; where a case carries a
watched-failure demonstration, §8 is what says so.

### 5.1 Capture text into quarantine

| Boundary | Mechanism | Evidence |
|---|---|---|
| Raw text is never persisted, hashed, logged or sent to a model | `redactAndNormalize` redacts, then normalizes, then hashes, in one function that cannot be reordered from outside (`packages/brain/src/capture/build.ts:167-181`); `buildCapture` calls it before anything else exists (`:202-207`) | `tests/security/sentinel.test.ts` — `keeps the sentinel out of the capture file`, `the model input`, `the staging directory`, `every validator report`, `the canonical note` |
| The pre-redaction bound measures and nothing else | `resolveText` takes a byte length and refuses; the text is not logged, hashed or echoed into any refusal (`apps/cli/src/commands/capture.ts:327-364`) | the same suite's per-artifact sweep |
| The capture id derives from redacted content, so two texts differing only by a secret are one capture | `captureId` is the first 16 hex of the hash over the redacted, normalized content (`packages/brain/src/capture/build.ts:207`) | `tests/security/sentinel.test.ts` — `keeps the sentinel out of the deduplication hash` **(§8: no watched failure)** |
| A fingerprint identifies a secret without carrying it | HMAC-SHA256 under the install's key, truncated to 16 hex (`packages/security/src/redaction.ts:277-282`); the key must be at least 32 bytes or `redactText` throws (`:311-313`) | `packages/security/src/redaction.test.ts` |
| A pathological PEM marker cannot make redaction superlinear | the PEM body is bounded at 8,000 characters, chosen by measurement rather than for being finite (`packages/security/src/redaction.ts:284-304`) | `packages/security/src/redaction.test.ts` |
| Quarantine is created private | `mkdir` with mode `0o700` (`apps/cli/src/commands/capture.ts:550`) | — |

**The sentinel suite asserts per artifact, never in total** — the rule is stated at
`tests/security/sentinel.test.ts:24-28` and enforced by `it.each(ARTIFACTS)` at `:188`, over the
eight-name array at `:39-48`. A single assertion over a concatenation of all eight would pass while
seven were empty, which is the shape of gate this repository has shipped and regretted twice.

**A capture is deliberately not a managed artifact** (`apps/cli/src/commands/capture.ts:529-533`).
Recording it in `installation-manifest.json` would report every legitimate Obsidian edit as drift.
The cost is that `validateChangePlan`'s ownership check does not stand behind a capture write;
`resolveCapturePath` stands there instead, which is a narrower constraint rather than the same one
(`apps/cli/src/commands/ingest.ts:502-511`) — and §5.2 is what that narrowness costs.

### 5.2 The capture file's own containment — **and the boundary that is absent**

| Boundary | Mechanism | Evidence |
|---|---|---|
| A capture *file* that is a symlink is never followed | `captureFileNames` filters `entry.isFile()`, which `readdir(withFileTypes)` reports false for a link, so the file is skipped at selection before any path is resolved (`apps/cli/src/commands/ingest.ts:404-418`) | `tests/security/symlink-escape.test.ts` — `never follows a symlink standing where a capture file should be` |
| A capture path resolves inside quarantine | `resolveCapturePath` canonicalizes both and compares (`apps/cli/src/commands/ingest.ts:482-500`) | see below |
| **A capture stays inside the vault** | **absent** | see below |

**This is the first of the three.** `resolveCapturePath` compares the canonicalized quarantine root
and the canonicalized target **against each other and never against the content root**
(`apps/cli/src/commands/ingest.ts:490-492`). Replace `content/_raw/quarantine` with a symbolic link
to a directory outside the vault and the comparison holds at the new location exactly as it did at
the old one: `ingest` completes and rewrites the capture file outside the vault. `review.ts` carries
the identical construction.

The writable-path guard does not catch it either. `ProtectedPathPolicy` is a protected-*name* policy
and returns early for any path outside the user's home directory
(`packages/security/src/protected-paths.ts:118-127`), so a relocation to a sibling of the home
directory is refused by nothing.

**The leaf refusal in the first row is no evidence about the directory case** — it is a different
guard, at a different stage, and anyone reading one as covering the other has read the wrong one.
That is why the two are separate rows.

The escape is parked as the security suite's one `it.fails`
(`tests/security/symlink-escape.test.ts:190`), preceded by an ordinary case that asserts the setup
reached the state and that the harm occurred (`:171-188`) — so a real fix reddens the suite with any
exit code, which a comment could never do. **Record: `BACKLOG.md` §1 NEW-14**, unassigned, and
deliberately not Task 19's, which is the independent security review and must not be what discovers
an escape already known.

### 5.3 Captured text into a model

| Boundary | Mechanism | Evidence |
|---|---|---|
| The **ingest prompt** marks captured material as data, never as instruction | the heading and the four sentences under it (`packages/brain/src/ingest/prompt.ts:95-102`) | `tests/security/prompt-injection.test.ts:144-145` — the positive control asserts both that the injected text reached the model and that the literal `untrusted data, not instruction` is in the prompt. **That literal is this prompt's own heading (`packages/brain/src/ingest/prompt.ts:95`), not the shared preamble** |
| The **shared skill preamble** carrying the full injection defence cannot be removed | it is **concatenated** into every rendered skill rather than referenced — `renderSkillBody` splices `preamble(options.shared)` into the body of every non-`shared` workflow (`packages/workflow-schema/src/skill.ts:200-201`), and the emitted block says so in its own comment, `concatenated, not referenced` (`:239-241`). `assertUsablePreamble` separately refuses a `shared` that is the wrong workflow or whose prose screens to nothing — an empty preamble is a heading over nothing (`:126-145`) | **Mechanism only — no `tests/security/` case exercises it.** The row above proves a different artifact. `packages/workflow-schema/src/skill.test.ts` covers the preamble at the rendering layer |
| There is no code path from raw capture text to a model | `buildIngestPrompt` takes two parameters — an envelope and a config — and `envelope.content` is post-redaction by the type's own contract (`packages/brain/src/ingest/prompt.ts:67-70`). A third parameter carrying a transcript or a raw fallback is what would turn this back into a promise | the sentinel suite's `the model input` case |
| A payload cannot forge Markdown structure in the prompt | `boundedProse` first, then `fenced` over its output, and the order is the defence: `neutralizeBlockStart` escapes every column-0 CommonMark construct (`packages/security/src/markdown.ts:43-49`), `fenced` only sizes the opening run so a payload carrying its own fence cannot close the block early (`:69-76`) | `tests/security/prompt-injection.test.ts` — `a forged System heading`, `a fence escape carrying a URL` **(§8: neither carries a watched failure)**; `packages/security/src/markdown.test.ts` covers both constructs at the unit layer |
| The prompt is bounded by one envelope, not by one file | `MAX_PROMPT_CONTENT_GRAPHEMES` = 16,384, applied to the joined block rather than per paragraph, because a per-paragraph bound is not a bound (`packages/brain/src/ingest/prompt.ts:13`, `packages/security/src/markdown.ts:51-61`) | `packages/brain/src/ingest/prompt.test.ts` |
| Nothing from captured text reaches an argument position of its own | `screenValueArgument`'s positional rule refuses any value beginning with `-`, whatever follows (`packages/security/src/cli.ts:112-115`) | `tests/security/prompt-injection.test.ts:129-132` — asserted element-wise on argv, which is the assertion that means something: a URL inside the prompt is fine, a URL that became its own argument is not |
| A pipe-to-shell in captured text never reaches a command position | `assertSafeCommand` normalizes `\r`/`\n` to spaces before matching, then refuses `\| sh` for `curl` and `wget` (`packages/security/src/process.ts:66-75`) | `tests/security/multiline-command.test.ts` — the `\n`, `\r\n`, `\r`, `bash`, `zsh` and `wget` rows |

**One measured correction, worth carrying.** The newline normalization SEC-100 is named for is
**redundant today**: the pattern's own `\s*` and `\s` already match `\r` and `\n`, and removing the
normalize step alone left the suite green. The guard is carried by the character class, not by the
line SEC-100 credits. Two layers where one would do is not a defect — but a future narrowing of that
pattern to `[ \t]` would silently reopen SEC-100, so both lines are now pinned by the suite.

**One side effect that reaches a model, stated because it does.** `screenControlCharacters` collapses
every whitespace run, so a multi-line observation reaches the model with its intra-paragraph line
breaks turned into spaces (`packages/brain/src/ingest/prompt.ts:54-60`). Paragraph boundaries
survive; single line breaks inside a paragraph do not.

### 5.4 Model output into a proposal, and a proposal into the vault

The rule is design spec §14.1's, and this is where it becomes code: **the model's output is a
proposal, never proof of safety.**

| Boundary | Mechanism | Evidence |
|---|---|---|
| Output is structured and validated, never best-effort parsed | `parseStructuredPayload` refuses a top-level `__proto__` before returning a value callers will spread, and refuses unparseable output as `malformed-output` (`packages/security/src/cli.ts:134-153`) — **only the top level is walked**, and a caller merging a nested field owes its own guard | `packages/security/src/cli.test.ts` |
| A proposal cannot smuggle a prototype through Zod | `carriesReservedKey` checks the prototype *and* the own `__proto__` key before the schema runs, because Zod strips `__proto__` ahead of its own strictness check (`packages/brain/src/ingest/proposal.ts:97-108`) | `packages/brain/src/ingest/proposal.test.ts` |
| A proposal is bounded | at most 32 notes (`packages/brain/src/ingest/proposal.ts:65,215`); path length, extension, separator and control characters refused as string properties (`:129-136`) | `packages/brain/src/ingest/proposal.test.ts` |
| Model output cannot widen write scope | nine validators run on every call, all of them, with every finding returned (`packages/brain/src/ingest/validate.ts:24-43`). `writeScope` consults the workflow's declared scopes as an **upper bound** (`:553-565`), subtracts private folders, the indexes directory and dot-segments (`:509-522`, `:573-582`), and then checks containment on the **canonicalized destination, not the written path** (`:589-601`) | `tests/security/symlink-escape.test.ts` — `refuses at exit 5, leaves the capture accepted, and writes nothing at the destination`; `tests/security/prompt-injection.test.ts` — `writes nothing at the destination a traversal would resolve to` |
| A secret in the proposal never reaches the vault | `secretScan` runs the redaction pass over the path, the contents *and* the provenance id, and reports **class names and the file, never the value, never the redacted text, never the fingerprint** (`packages/brain/src/ingest/validate.ts:466-495`) | `tests/security/sentinel.test.ts` — `keeps the sentinel out of every validator report` |
| A proposal cannot overwrite the user's own note | mutations are `create`, never `replace`; an existing path is refused before the transaction (`apps/cli/src/commands/ingest.ts:697-704`) | `tests/security/malformed-manifest.test.ts` — `refuses to replace a note a forged manifest claims to own` |
| A model-chosen path cannot repaint a terminal or a `--json` consumer | findings are rendered through `screenAndCap` at the one seam where a path stops being data and becomes a message, including the `--json` channel, because `JSON.stringify` escapes `\p{Cc}` but not `\p{Cf}` (`apps/cli/src/commands/ingest.ts:634-655`) | `apps/cli/src/commands/ingest.test.ts` |
| A failure leaves the capture retryable and never `ingested` | any validator finding exits without touching status (`apps/cli/src/commands/ingest.ts:657-683`); five transaction kinds isolate each phase (`:232-236`) | `tests/security/interruption.test.ts` — `an interruption at every forward phase`, all seven phases × both writes, plus the derived coverage case (`:215`) |

**The defence is in depth, and the evidence shows it.** When Task 15 reverted only the proposal
parser's traversal rule, the injection suite stayed **green** — the write-scope validator caught it.
Reddening it needed the parser rule *and* the validator's unsafe-path branch *and* the declared-glob
check removed together. That is the strongest single statement in this document about the model-output
seam, and it is a measurement rather than a claim.

**`validateChangePlan` is deliberately absent from the note write too**
(`apps/cli/src/commands/ingest.ts:706-713`), for the same reason it is absent from a capture write: a
note is the user's own content. The write-scope validator stands in its place, which is narrower than
ownership and is the constraint that matters for a path a model chose.

### 5.5 The vendor CLI as a subprocess

The vendor CLI is the only outbound process this product makes, and the only place any model runs.

| Boundary | Mechanism | Evidence |
|---|---|---|
| The model is invoked with zero declared write scopes | `writeScopes: []` at the call site (`apps/cli/src/commands/ingest.ts:606`); Codex derives `-s read-only` **from the count and never from an argument**, which is what makes `danger-full-access` unreachable rather than merely unwritten (`packages/adapter-codex/src/invoke.ts:145-151`); Claude is passed `["Read","Grep","Glob"]` with no write tool, so the vendor's own permission system enforces it before the model runs (`apps/cli/src/commands/ingest.ts:166-182`) | `apps/cli/src/commands/ingest.test.ts:928` — `gives claude no write tool in --allowedTools`; `packages/adapter-codex/src/invoke.test.ts:238` — `uses read-only and adds no --add-dir when there are no write scopes`; `tests/security/network.test.ts` — `spawns exactly one process during ingest, and it is the discovered vendor binary` |
| No shell is ever involved | `spawn(..., { shell: false })` (`packages/security/src/process.ts:87-93`) | `packages/security/src/process.test.ts` |
| The executable is absolute | `assertSafeCommand` refuses a non-absolute executable (`packages/security/src/process.ts:47-54`). Separately, the request carries no `PATH`, so a child has nothing to resolve a bare name against | `packages/security/src/process.test.ts:80-97` — `rejects foreign-platform executable syntax that is not locally absolute`, an `it.skipIf` that runs wherever `C:\tools\curl.exe` is not absolute, so it executes on the supported platform; `tests/security/network.test.ts:176-179` asserts absoluteness across every classified spawn |
| The executable, `cwd`, every argument and stdin are NUL-free | four `containsNul` checks across two branches — the executable (`packages/security/src/process.ts:48`), then the working directory, every argument and stdin (`:56`, `:57`, `:58`) | **Mechanism only — no test in this repository exercises a NUL through `assertSafeCommand`.** Its `describe` block holds two cases (`packages/security/src/process.test.ts:63`, `:80`) and neither is about a NUL. The NUL refusals that *are* tested belong to other functions — for example `packages/security/src/paths.test.ts:58` and `:165`, covering `canonicalizePlannedPath` and `resolveOwnedPath`; that is a sample, not the set. **Record: `BACKLOG.md` §1 NEW-18.** Stated rather than papered over: all four checks exist and none is proven |
| The child inherits nothing from the parent environment | the runner passes only `{...request.env}` (`packages/security/src/process.ts:91`), and both adapters pass `env: {}` — stricter than the spec asks | `tests/security/network.test.ts` — `does not pass a proxy the parent process was given`, asserted by *inheritance* rather than by an expectation that could be edited to match a leak |
| Output cannot exhaust memory | 1 MiB per stream, after which the child is `SIGKILL`ed and the call is a security refusal (`packages/security/src/process.ts:6,195-216`) | `packages/security/src/process.test.ts` |
| A run is bounded in wall clock | `SIGTERM`, then `SIGKILL` 100 ms later, to the process *group* on darwin (`packages/security/src/process.ts:111-128,168-179`); `INGEST_TIMEOUT_MS` is 120 s (`apps/cli/src/commands/ingest.ts:192-198`) | `packages/security/src/process.test.ts` |
| Vendor output is redacted before it is returned to any caller | the runner redacts stdout and stderr inside `finishFromClose` (`packages/security/src/process.ts:149-156`) | `tests/security/sentinel.test.ts`'s `the logs` and `the --json output` cases **(§8: neither carries a watched failure)**; `packages/security/src/process.test.ts` asserts the redaction at the runner |
| A refusal never echoes the rejected value | `parseAgentPromptArgs` scrubs it, because a `with` block is author-controlled and the message reaches a log (`packages/adapter-codex/src/invoke.ts:70-74`) | `packages/core/src/agent-prompt/agent-prompt.test.ts` |
| **An invocation is bounded in turns** | **partial** | see below |

**This is the third of the three.** `maxTurns` is bounded and enforced under Claude — an integer
between 1 and 50, refused otherwise, bounded at the adapter rather than trusted from the type
(`packages/adapter-claude/src/invoke.ts:37,75-85`) — and `CodexInvocation` has no such field, so the
Codex arm of `invokeVendor` passes none (`apps/cli/src/commands/ingest.ts:601-610`). **One shared
schema, two behaviours, one of them silent.**

Half of it is closed and the half that is closed is worth knowing: `parseAgentPromptArgs` now
**refuses `maxTurns` outright** with an error naming its owner, rather than honouring it on one
vendor and dropping it on the other (`packages/core/src/agent-prompt/index.ts:68-79`, pinned by
`packages/core/src/agent-prompt/agent-prompt.test.ts:50,63`). So a *workflow author* can no longer
set a bound that silently applies to one vendor. What survives is `ingest`'s own direct invocation:
it sets `DEFAULT_MAX_TURNS` for Claude (`apps/cli/src/commands/ingest.ts:595`) and nothing for Codex,
so an ingest against Codex is bounded by `INGEST_TIMEOUT_MS` and by nothing else. **Record:
`codex-adapter.md` §11.3.**

**One rule at this seam is best-effort and says so.** `screenValueArgument` stacks a positional rule
(nothing in a value position may begin with `-`) that is *complete*, and a nominal word list
(`permission|danger|bypass`) that is *not* and cannot be made so (`packages/security/src/cli.ts:82-120`).
The word list is also applied to free-form prose, where only the positional half protects anything —
`BACKLOG.md` §1 **NEW-12** carries the fix, which is to split the screen by position rather than to
narrow the pattern.

**One rule at this seam is provisional and unverified.** Codex's `--json` streams JSONL while
`--output-schema` constrains only the final response, so stdout is reduced to *the last line that
parses as a non-null JSON object* (`packages/adapter-codex/src/invoke.ts:94-143`). No event type is
filtered on, because an invented enum a future version rejects is a failure only a real run would
find. Settling it needs one real `codex exec` call against a real binary — **DOS-P6 Task 17**, which
the founder must authorise. It ships unverified and says so at the seam; nothing here should be read
as having verified it.

### 5.6 The vault the model reads, and the vault the product reads

The agent is given read-only access to a vault that may contain secrets the **user** wrote into their
own notes. Redacting a user's canonical content is not this product's business; catching it on the
way back is, which is what §5.4's secret scan is for.

| Boundary | Mechanism | Evidence |
|---|---|---|
| The Brain never writes | `BrainServiceDependencies` is seven members and **none of them is a write channel** (`packages/brain/src/service.ts:33-41`), so "reindex does not mutate a user's notes" is a sentence the type refuses to express rather than a promise the implementation keeps | `packages/brain/src/service.test.ts` — the whole file runs the service against an injected reader and asserts on returned bytes; there is no write to assert about |
| Frontmatter resolves no YAML tag | the first explicitly tagged node is found and refused, and *any* tag counts, because which tags construct values is the library's decision and "frontmatter carries no tags" is this product's (`packages/brain/src/schema/note.ts:300-314,600`); `maxAliasCount` is pinned at the same seam (`:616`) | `packages/brain/src/schema/note.test.ts` |
| A frontmatter block cannot make parsing superlinear | `MAX_FRONTMATTER_CHARS` is 64 KiB, counted in UTF-16 code units because the cost is quadratic in *entries* and an entry costs at least five code units in any script (`packages/brain/src/indexes/build.ts:168,558`) | `packages/brain/src/indexes/build.test.ts` |
| Vault text cannot reorder a rendered line or repaint a terminal | one display screen for the whole product, covering `\p{Cf}` as well as `\p{Cc}` (`packages/security/src/screen.ts:72,96,110`); `escapeLeadingBlock` in the index renderer is a **different** rule — it stops text becoming Markdown structure where the screen stops characters reordering a line — and both run, in that order (`packages/brain/src/indexes/render.ts:112-121`) | `tests/e2e/brain.test.ts`, which crosses the seam so a future divergence fails rather than merely looking wrong |
| Paths are byte-exact everywhere and screened at the terminal instead | a path is an identifier the user must be able to act on, and link destinations must resolve; `renderPath` screens at the boundary (`apps/cli/src/context.ts:102`, `foundation.md` §5) | `apps/cli/src/context.test.ts` |

**Two deliberate exemptions, both load-bearing.** Paths are unscreened in data and screened at the
terminal, as above. **U+200D is preserved** in both the Brain and the CLI, because a joiner is part of
a grapheme cluster rather than an attack on one — the two layers held opposite policies for one review
round and the output was worse than either. `index.json` and `graph.json` are deliberately unscreened:
they are data, the retrieval layer screens on the way out, and an index that disagrees with the vault
it indexes is worse than one that is faithful (`brain.md` §5).

**One unclosed question at this seam, and it is a correctness question rather than a security one.**
`BACKLOG.md` §1 **NEW-7**: a link destination's percent-encoding is verified against CommonMark and
not against Obsidian, because there is no Obsidian in this environment to ask.

### 5.7 Redaction, and what it can and cannot promise

**One headline this section used to carry is false, and correcting it is the point of the second row
below.** "Redaction is never the only thing standing anywhere" is the design rule, and it holds on
seven of the eight commands that read configuration. **On a `brain` run it does not**: there the
heuristic redactor is the only thing between a TOML parse failure and the user. **Record:
`BACKLOG.md` §1 NEW-17.**

| Boundary | Mechanism | Evidence |
|---|---|---|
| Nine redaction classes, and a tenth cannot be added unreachably | `REDACTION_CLASSES` is frozen and a test asserts membership against findings **actually produced**, not against the list (`packages/security/src/redaction.ts:24-40`) | `packages/security/src/redaction.test.ts` |
| A user-supplied pattern cannot backtrack | user patterns are literal, case-insensitive substrings over NFC-normalized text — never regular expressions, because this codebase bounds no expression anywhere and a pathological pattern would hang the one operation that must not fail quietly (`packages/security/src/redaction.ts:13-22`) | `packages/security/src/redaction.test.ts:448-469` — `.*` and `(a+)+$` asserted to behave as literals |
| Redaction is a heuristic and is not the only thing standing — **on seven of the eight commands that read configuration** | the worked example is configuration: a `loadConfig` throw becomes a content-free `ConfigurationError` rather than being handed to the redactor, because `smol-toml` embeds three raw source lines in `TomlError.message` (`apps/cli/src/commands/doctor.ts:188-193,227-231`). `status`, `doctor`, `init`, `capture`, `uninstall`, `review` and `ingest` all reach configuration through that wrapper (`status.ts:42`, `doctor.ts:535,859`, `init.ts:236`, `capture.ts:293`, `uninstall.ts:560`, `review.ts:159`, `ingest.ts:317`) | `tests/e2e/foundation.test.ts:1250` — `never quotes the configuration it failed to parse` |
| The same, on a `brain` run | **partial — the wrapper is not on this path.** `readConfig` (`apps/cli/src/commands/brain.ts:97`) wraps only the *read*; `loadConfig(serialized)` is the return statement outside that `try` (`apps/cli/src/commands/brain.ts:100-109`), so a `TomlError` is not a `BrainRefusal` and falls through to `failureFrom` (`:334`), which emits `redactDiagnostic(error.message)` (`apps/cli/src/context.ts:367-383`) | **none, and none is possible for a property that does not hold.** The e2e case above drives `doctor`, not `brain`. **Record: `BACKLOG.md` §1 NEW-17** |

**A gap found while writing this document, recorded and not fixed.** `redactText`'s `userPatterns`
option **has no production caller.** Every production call passes two arguments
(`apps/cli/src/context.ts:306,613`, `apps/cli/src/commands/init.ts:734`,
`apps/cli/src/commands/capture.ts:444,615,672`, `apps/cli/src/commands/review.ts:244,431,471`,
`apps/cli/src/commands/ingest.ts:455,866,917,1009`), and `configSchema` is `.strict()` with no
redaction table (`packages/core/src/config/loader.ts:130-153`) — so a user who adds one to their
configuration gets a load failure, not a pattern. Design spec §8.2's "patterns live in `config.toml`"
describes an unwired half. The `user-pattern` class is implemented, tested and unreachable from the
product. **Nothing in this document should be read as claiming a user can configure a redaction
pattern today.** **Record: `BACKLOG.md` §1 NEW-16.**

### 5.8 The redaction key — the product's first secret at rest

| Boundary | Mechanism | Evidence |
|---|---|---|
| The key is not a managed artifact | created deliberately outside `mutationsFor`/`recordArtifacts`, so it never enters `installation-manifest.json`, is never hashed into a drift report, and is absent from `plan.created` too — naming it there would imply the manifest owns it (`apps/cli/src/commands/init.ts:711-722`) | `apps/cli/src/commands/init.test.ts`; `tests/e2e/foundation.test.ts:563` — `restores a deleted redaction key when init is run again` |
| Reading the key follows no symlink and cannot hang the CLI | `O_NOFOLLOW` because a symlink there is not our file, and `O_NONBLOCK` because `open(O_RDONLY)` on a FIFO blocks forever and the regular-file check is downstream of the open (`apps/cli/src/context.ts:399-410`) | `apps/cli/src/context.test.ts` |
| A key that is not a private regular file of the right length is refused or repaired | symlink, non-regular and short-file refusals, and the mode is forced back to `0600` through the open handle (`apps/cli/src/context.ts:430-444`); created at `0600` (`:471`) | `apps/cli/src/commands/doctor.test.ts:195` |
| A lost key degrades a diagnostic and never the knowledge | a missing key regenerates with a warning that prior fingerprints are no longer comparable (`apps/cli/src/context.ts:575,608`) — content is not derived from the key | `apps/cli/src/context.test.ts` |
| `uninstall` removes it, and that is the one named exception to the manifest-only rule | centralized in `redactionKeyPath` so the exception stays exactly one path wide (`apps/cli/src/context.ts:385-397`) | `apps/cli/src/commands/uninstall.test.ts` |

### 5.9 The transaction — **and the boundary that is absent**

| Boundary | Mechanism | Evidence |
|---|---|---|
| Every managed mutation is journalled, backed up and recoverable | seven phases driven by one loop, each journalled *after* it completes and before the next is attempted, so the journal always describes work already done (`packages/core/src/transactions/executor.ts:259-269`, `:848`) — the full phase table is `foundation.md` §3 | `tests/security/interruption.test.ts` — `SIGKILL` at each of the seven forward phases for both writes |
| An interrupted run leaves the capture retryable and `doctor` says how to recover | `checkTransactions` fails on any incomplete journal and names both ways out in its recovery string (`apps/cli/src/commands/doctor.ts:601,613`), which sets exit 6 | `tests/security/interruption.test.ts`, and its derived coverage case at `:215` which reddens if the driven set shrinks; `tests/e2e/foundation.test.ts:1000` — `is reported, blocks init, and names both ways out` |
| A file that changed under a running command is not overwritten | `expectedBeforeHash` compared at backup time, raising `TransactionConflictError` (`packages/core/src/transactions/executor.ts:453-457`) | `tests/security/concurrent-edit.test.ts` — `refuses a review edit whose capture changed under it, rather than overwriting` |
| A second operation on a held journal is refused | every store operation on a journal runs inside `withTransactionLock` (`packages/core/src/transactions/store.ts:195,247,261,283`), which takes an advisory per-transaction lock through `/usr/bin/lockf` (`packages/platform-macos/src/transaction-lock.ts:17,84`) | `tests/security/concurrent-edit.test.ts` — `refuses a second transaction while one holds the lock` |
| **A secret removed from a vault file is gone from the machine** | **absent** | see below |

**This is the second of the three.** `review --decision edit` exists to remove a secret a user pasted
into a vault file by hand, and it does remove it from the vault: every decision re-redacts, because
the command writes back what it parsed rather than patching a status line
(`apps/cli/src/commands/review.ts:391-397`). **The secret leaves the vault; it does not leave the
machine.** `TransactionExecutor.backUp` writes the pre-edit file raw to
`<product home>/backups/transactions/<id>/<n>.bin` at mode `0600`
(`packages/core/src/transactions/executor.ts:449-467`, `:391-392`), and **nothing prunes it** — no
`rm` of that directory exists anywhere in the executor. The user is told the secret is gone; a copy
survives in a directory they have no reason to know about.

**It is a missing prune, not an inherent cost.** `rollbackLocked` throws on a finalized journal
(`packages/core/src/transactions/executor.ts:280`), so once `finalize` runs that backup can never be
used for anything — it is dead bytes. The fix is to prune the backup directory in the `finalized`
transition. **No DOS-P6 task's file list reaches `packages/core`**, which is why no session has done
it.

**The evidence here is a test declaring what it does not assert.**
`tests/security/sentinel.test.ts:29-36` puts `backups/transactions/` deliberately *outside* its sweep
and says why, so "the staging directory" in that suite means the executor's own staging area rather
than the backups. A suite that had quietly swept the backups away would have made this document's
second claim false. **Record: `ORDER.md`, the third Foundation request.**

**One correction to that docblock, and it does not change the finding.** It says the staging area is
what `finalize` removes. **Nothing removes it either** — `ensureTransactionDirectories` creates both
the staging and the backup directory (`packages/core/src/transactions/executor.ts:371-385`) and the
executor's only removals are `removeOwnedTemp` on a durable-write temporary (`:102-111`) and the
`unlink` of a `remove` mutation's own target (`:557`, `:666`). The staged bytes are *redacted*
content, so their survival costs disk rather than a secret; the backup's do not, which is why the
prune is a security fix and this is a housekeeping one. It sits beside the open founder question
`BACKLOG.md` §2 carries about `<state>/transactions/` accumulating one permanent lock file per
transaction id.

**Two related residuals, both open and both stated where a reader meets them.** `PlannedFileMutation`
carries no caller-supplied precondition, so the executor computes `expectedBeforeHash` from its own
snapshot and a read-to-execute window survives in both `capture` and `review --decision edit`
(`apps/cli/src/commands/capture.ts:495-527`, `apps/cli/src/commands/review.ts:317-333`) — benign for
a capture, whose id *is* its content hash, and not benign for an edit, where the lost content is the
user's own. And the transaction lock never serializes two writers to one *file*: production ids are
per-execution, so two concurrent processes contend for nothing, and what protects a capture from a
second writer is `expectedBeforeHash` rather than the lock. Both are in `ORDER.md`, and the
concurrent-edit suite's own docblock states both halves so a reader does not inherit the stronger
belief.

### 5.10 The installation manifest

| Boundary | Mechanism | Evidence |
|---|---|---|
| A malformed or forged manifest refuses rather than being adopted | `ManifestStore.readOptional` throws `ManifestStateError` rather than returning `null` on any read or parse failure (`packages/core/src/manifest/store.ts:246-259`) | `tests/security/malformed-manifest.test.ts` — `stops capture at exit 6, and leaves the forgery for a person to look at`, and the same for `ingest` |
| A forged ownership claim cannot capture a path the product would write | `assertOwnership` refuses a `create` over a path the manifest already claims (`packages/core/src/plans/validate.ts:240-246`) | `tests/security/malformed-manifest.test.ts` — `refuses to create a capture at a path a forged manifest claims to own` |
| A note write cannot become an overwrite, whatever the manifest claims | `applyNotes` refuses an existing target before the transaction (`apps/cli/src/commands/ingest.ts:697-704`) | `tests/security/malformed-manifest.test.ts` — `refuses to replace a note a forged manifest claims to own`, whose failing output shows the model's note replacing the user's own words |
| Every manifest-driven read resolves the path through the guard, opens `O_NOFOLLOW`, and re-checks `dev`/`ino` after the open | `packages/core/src/manifest/drift.ts:49,64,70-71,110`; `assertReadable`'s contract — canonicalize the parent, append the basename verbatim — is `packages/core/src/manifest/types.ts:87-100`. The two ownership universes (`init` revert vs `uninstall`) are `foundation.md` §4 | `packages/core/src/manifest/manifest.test.ts`; `tests/e2e/foundation.test.ts:750` — `never removes a manifest artifact that lies outside the product home` |
| The manifest is never read through a followed symlink | `assertReadableArtifactPath` canonicalizes the *parent* and appends the basename verbatim, so the leaf is never resolved and core's `lstat` stays meaningful; the policy is asked **twice**, and both calls are load-bearing (`foundation.md` §5, `apps/cli/src/context.ts:275-287`) | `apps/cli/src/context.test.ts` |

**One row here is containment rather than refusal, and the suite says so.** `review` reads no manifest
at all — `apps/cli/src/commands/review.ts` has no `context.manifests` call — so the claim "forged and
stale manifests refuse on every path this subsystem adds" is **false for one of the three paths**. The
case pins what is actually true (`neither stops review nor is honoured by it, and review still writes
only the capture`) and says in its own docblock that it is containment, so nobody later "fixes" it by
changing `review`.

**The manifest writes its own content outside any transaction** (`foundation.md` §1) — durable, not
journalled and not recoverable. That is `foundation.md` §8 residual 1 — a crash between the transaction
finalizing and the manifest write leaves an installation no command repairs — and it is the one place
the "every managed mutation is transactional" sentence has a stated exception.

### 5.11 `PATH`, and the binary it resolves

| Boundary | Mechanism | Evidence |
|---|---|---|
| Discovery runs one absolute helper and gives it nothing but a search path | `/usr/bin/which`, spawned with `env: { PATH: <search path> }` and nothing else (`packages/platform-macos/src/macos.ts:17,175-182`) | `tests/security/network.test.ts` — every classified spawn asserted absolute, and the classification asserted total in both directions (`:164-179`) |
| A discovered path that is not usable is refused rather than reported | must be absolute, free of every control character, and must not carry a redaction marker — because the runner redacts its own output and a high-entropy path segment comes back rewritten but still absolute (`packages/platform-macos/src/macos.ts:86-106`) | `packages/platform-macos/src/macos.test.ts` |
| An empty `PATH` does not become an unbounded search | a fixed fallback of the four system directories (`packages/platform-macos/src/macos.ts:20,143-145`) | `packages/platform-macos/src/macos.test.ts` |
| The *platform boundary* never executes what it found | `AgentDiscovery.version` is permanently `null` there, because determining it requires running the binary (`packages/platform-macos/src/types.ts:19-24`, `foundation.md` §7). **A layer above does execute it**: `discoverCli` runs `<exe> --version` (`packages/security/src/cli.ts:54-80`) and `doctor` calls it on every invocation, which retired the Foundation-era invariant — `claude-adapter.md` §9 residual 10 records exactly that | `packages/platform-macos/src/macos.test.ts`; `tests/security/network.test.ts` classifies the version probe rather than forbidding it |
| A hostile entry for one vendor does not cost the user the other | a discovery that refuses is treated as "not this one" and the next vendor is tried (`apps/cli/src/commands/ingest.ts:366-370,378-386`) | `apps/cli/src/commands/ingest.test.ts` |
| **The executed binary is vouched for by something** | **absent** | see below |

**A gap found while writing this document, recorded and not fixed.**
`packages/platform-macos/src/types.ts:13-18` documents `executablePath` as untrusted in exactly these
words: *"resolved through the caller's PATH, with no assertion about the owner or mode of the
containing directory. Anything that executes it owes that check first."* **DOS-P6 is the first thing
in this product that executes it**, and `selectVendor` takes `discovery.executablePath` and hands it
straight to `invokeVendor` (`apps/cli/src/commands/ingest.ts:378-386`, `:1172`) with no owner or mode
check anywhere between. The debt the platform boundary assigned to its executor is unpaid, and the
`ingest` docblock at `:366-370` already reasons about "a hostile `claude` on `PATH`" while handling
only the fall-through case.

What this does **not** mean: it is not a privilege escalation. The binary runs as the user, from the
user's own `PATH`, and anyone who can plant it there can already run code as that user. What it costs
is that Developer OS hands such a binary a prompt built from the user's captures and read access to
the user's vault, and reports the result as its own. **Record: `BACKLOG.md` §1 NEW-15**, registered when this document landed. The nearest record before
it was `claude-adapter.md` §9 residual 10, which notes that `doctor` executes the discovered binary
and retires the Foundation-era invariant — it records the execution and **not** the missing check,
which is why NEW-15 exists rather than a pointer to it. Stated here because the brief names `PATH` as
a boundary this document must carry, and carrying it accurately means saying which half is enforced.

### 5.12 Configuration

`config.toml` is a file the user edits by hand, and a parse of it happens on every `doctor`, `status`
and `brain` run. **Those runs do not all reach it the same way**, and the difference is a boundary
rather than a detail — see the last row.

| Boundary | Mechanism | Evidence |
|---|---|---|
| Configuration is read through the protected-path policy, never with a bare `readFile` | the guarded reader canonicalizes, refuses a protected name, opens `O_NOFOLLOW` and re-checks `dev`/`ino` after the open (`packages/security/src/protected-paths.ts:47-88`), reached through `context.guards.readText` (`apps/cli/src/context.ts:319`, `apps/cli/src/commands/doctor.ts:225`) | `packages/security/src/protected-paths.test.ts:70` — `allows the Developer OS configuration path`; `:146` — `reads from the opened safe descriptor after the original alias is swapped` |
| Absence is distinguished from a refusal | `lstat` is checked *first*, because the guarded reader reports a missing file as a security refusal — the right answer for a read and the wrong one for "this machine has never been initialized" (`apps/cli/src/commands/doctor.ts:218-223`) | `apps/cli/src/commands/doctor.test.ts` |
| An unknown key is refused rather than ignored | `configSchema` is `.strict()`, as is every nested table (`packages/core/src/config/loader.ts:130-153`, `:77-91`) — so a typo'd or injected key fails the load instead of being silently dropped | `packages/core/src/config/config.test.ts` |
| A parse failure never prints the file it failed on — **through `readConfigFile`** | a `loadConfig` throw becomes a content-free `ConfigurationError`, because `smol-toml` embeds three raw source lines in `TomlError.message` and propagating it printed whatever was read into `status`, `doctor` and their `--json` (`apps/cli/src/commands/doctor.ts:188-193,227-231`). Redaction is deliberately not the only thing standing on this path | `tests/e2e/foundation.test.ts:1250` — `never quotes the configuration it failed to parse` |
| **The same boundary on a `brain` run — PARTIAL** | **`brain` does not use that wrapper.** `readConfig`'s `try` (`apps/cli/src/commands/brain.ts:97`) covers the read alone and `loadConfig(serialized)` is the return statement after it (`apps/cli/src/commands/brain.ts:100-109`); a `TomlError` is not a `BrainRefusal`, so the handler falls through to `failureFrom` (`:334`) and the message reaches the user through `redactDiagnostic` (`apps/cli/src/context.ts:367-383`) — **the heuristic redactor as the only thing standing, which is exactly what the row above exists to prevent.** Record: `BACKLOG.md` §1 NEW-17 | none |
| Telemetry cannot be switched on by editing the file | the key is `z.literal(false)` (`packages/core/src/config/loader.ts:151`), so `telemetry = true` fails the load | `packages/core/src/config/config.test.ts` |

**What configuration does *not* carry, and §5.7 explains why it matters:** there is no redaction
table, so the `user-pattern` class has no way to be configured. **And one thing it decides that
nothing else re-checks:** `brainPath` is an absolute path from the file, and `reindex` does not call
`assertRootsAnchored` where `init` does — so a hand-edited vault path outside the home is refused by
one command and accepted by the other. That is `brain.md` §4 residual 5, owned by DOS-P7.

---

## 6. Statuses, and the invariant under every failure

**A failure at any point leaves the capture `accepted`, never `ingested`, and always retryable.**
That is the gate's own wording in `BACKLOG.md` §3, and it holds by refusal
(`apps/cli/src/commands/ingest.ts:657-683`) and by interruption
(`tests/security/interruption.test.ts`).

**It holds with one stated residual, accepted rather than closed.** `ingest` runs as four transactions
per capture plus a compensating rollback — `ingest-stage`, `ingest-apply`, `ingest-reindex`,
`ingest-ingested`, `ingest-rollback` (`apps/cli/src/commands/ingest.ts:232-236`) — because
`BrainService.reindex()` reads the vault and cannot run until the apply has finalized, and because
`validateChangePlan` grants ownership from a manifest a capture is deliberately absent from. **A crash
between the apply finalizing and the last transaction leaves a capture at `staging` with its notes
already applied** (`apps/cli/src/commands/ingest.ts:825-832,1134-1141`). It is inert — the next run selects
only `accepted` captures and cannot double-apply — and recoverable by `repair` plus a hand edit. This
corrects design spec §6.1's headline sentence and is one of two rows in `BACKLOG.md` §8 awaiting the
founder.

**One product gap at the same seam, and it is DOS-P7's.** `applyReviewDecision` permits a decision
only from `quarantined` (`packages/brain/src/review/decide.ts:36,75`), so nothing moves a capture from `accepted` back to `rejected`. A user who
changes their mind, or whose capture refuses ingest deterministically, has only a hand edit of the
file's frontmatter — which is what both of `ingest`'s recovery strings tell them to do.

---

## 7. Capabilities that are absent by construction

Stated as capabilities that are *absent*, because "not implemented yet" and "must not exist here"
look identical from outside and are not the same thing.

| Absent | Mechanism | Evidence |
|---|---|---|
| **Network** | no HTTP client, no socket, no DNS anywhere in the product | `tests/e2e/foundation.test.ts:1164` — `ships no network capability`. It scans every compiled non-test module in **every workspace discovered under `apps/` and `packages/`** (`:1181-1193`) — discovered, not written down, which is the whole of the fix for the closed NEW-1 — and asserts non-empty **per workspace** rather than over the total (`:1238-1239`), because a floor over the sum is satisfied by one populated directory |
| **Any outbound call but one** | the vendor agent CLI during ingest, and nothing else | `tests/security/network.test.ts` — the spawn list is **classified, not forbidden**: the unclassified set is asserted empty and the classified set asserted non-empty, because a filter with nothing behind it passes by filtering everything |
| **Credentials** | no Keychain, no token store; the protected-path policy refuses `.ssh`, `.aws`, `.gnupg`, `.env` and `.env.*`, and three exact files, on both the declared and the canonical path (`packages/security/src/protected-paths.ts:9-19,129-137`) | **The declared half:** `packages/security/src/protected-paths.test.ts:48` — `rejects reading the protected path %s` — and `:59` — `rejects writing the protected path %s` — two `it.each` blocks that run every one of the eight fixture paths (`:18-27`) through `assertReadable` and `assertWritable`, covering `.env`, `.env.local`, `.ssh`, `.aws`, `.gnupg` and all three exact files by name. **The canonical half:** `:130` — `rejects an innocent alias that resolves into synthetic SSH data` — a path innocent as written that resolves into a protected directory. **The negative control**, which is what keeps the rule a name match rather than a substring match: `:78` — `does not treat a protected-name prefix as the protected directory`. Note the policy covers `.env` and `.env.*` but **not** `.envrc` or `.environment` (`foundation.md` §7) |
| **Reading a session transcript** | no code path opens the field the vendors ship in every hook payload | `tests/repository/transcript-path.test.ts` — a gate rather than a reviewer's grep, with the needle assembled at runtime so the file does not match its own source |
| **Hooks** | neither adapter emits a hooks file; a not-used list in each `capabilities.ts` resolves `plugin_hooks` **before** the table or any observation is consulted, so a stray `observed` cannot make it `yes` over a file that does not exist (`packages/adapter-claude/src/capabilities.ts:31-32,73`, `packages/adapter-codex/src/capabilities.ts:26-27,80`) | `packages/adapter-claude/src/plugin.test.ts:50` asserts no `hooks/hooks.json` is emitted, so restoring hooks has to delete an assertion rather than happen by accident; `packages/adapter-claude/src/capabilities.test.ts:103,116` pins the state and its precedence |
| **Automatic capture** | nothing fires on session start, session end or compaction. Capture content is agent-authored, and `capture` refuses without `--text` or stdin rather than sourcing text itself (`apps/cli/src/commands/capture.ts:338-345`) — the `session_end` trigger could only supply that text by reading a transcript, which the row above refuses | `apps/cli/src/commands/capture.test.ts`; follows structurally from hooks being absent |
| **Telemetry, a scheduler, and Git mutation** | `telemetry` is `z.literal(false)` in the configuration schema (`packages/core/src/config/loader.ts:151`) | `packages/core/src/config/config.test.ts` |
| **Reading anything outside this repository** | `npm run lint` runs a git-driven enumerator over tracked *and untracked* files | `tests/repository/self-containment.ts` — a lint rule rather than a sandbox, and it says so: it refuses the obvious spellings so that crossing the boundary has to be deliberate and visible in a diff |

---

## 8. What the evidence is worth

`tests/security/` holds **eight suites and 59 cases**. Two of the eight are not in design spec §9's
list — **network** and **concurrent edit** — and are there because `BACKLOG.md` §7's standing gate
requires them and the spec dropped them.

**41 of the 59 cases carry a watched-failure demonstration and 18 do not.**

**Read the next paragraph before the table, because this is the one part of this document a reader
cannot check against the tree.**

**The suites do not record which of their own cases was watched fail.** `grep -rniE "revert"
tests/security/` returns nothing; no suite carries a marker, a count, or a list. What exists in this
repository is the **aggregate**, in `BACKLOG.md` §5 — "41 of its 59 cases carry that evidence and 18
do not". The **per-suite breakdown below, the named unevidenced cases, and the thirteen reverts**
(each naming the production line disabled, the command run, and the failing output) live in the
implementing task's report under `.superpowers/`, which is **untracked scratch and is deleted when
that plan closes**. Reproduced here because it is the most useful form of the fact and because a
number without its itemization is the overclaim this directory exists to refuse — but reproduced
*as* an unverifiable reproduction, not as something a reader can confirm.

**The table below is that reproduction. It has no citation because there is nothing in this
repository to cite it to.**

**What that means for anyone maintaining this document.** Once the plan closes, the table below can
only be re-derived by redoing the reverts. If the split is worth keeping true, it needs a home in
the tree — a marker per case, or a checked-in ledger. Until then, treat the aggregate as the load-
bearing claim and the table as its last surviving detail.

This document cites evidenced cases **by name**, marks the unevidenced ones it relies on with
`(§8: no watched failure)`, and never cites a suite as though every case in it were evidence.

| Suite | Evidenced | What is not evidenced |
|---|---|---|
| `sentinel` | 6 of 9 | `the logs`, `the --json output`, `the deduplication hash` |
| `prompt-injection` | 2 of 4 | `a forged System heading` and `a fence escape carrying a URL` as individual rows; the traversal case is evidenced |
| `symlink-escape` | 2 of 4 | the parked NEW-14 pair — and it **cannot** be: a revert that reddened it would be a revert that fixed the defect |
| `multiline-command` | 6 of 9 | the replay case, the `\| sh` row, and the negative control (which reddens only under a revert in the opposite direction) |
| `malformed-manifest` | 5 of 6 | the `review` containment case |
| `interruption` | 14 of 15 | `the capture write` at `finalized` |
| `network` | 4 of 10 | five zero-spawn command rows and the `/usr/bin/env` child case |
| `concurrent-edit` | 2 of 2 | — |

**Three of the 18 are excluded for a stated reason** — the two parked NEW-14 cases and the
`multiline-command` negative control. **The remaining fifteen carry no evidence and no excuse**, and
are named above rather than left for a reader to assume.

**Why this distinction is load-bearing.** This repository has shipped two gates nobody had watched go
red, both about properties that were false. A suite whose cases are counted rather than demonstrated
is a suite that can pass by collecting nothing — which is precisely why the sentinel suite asserts
per artifact and why every "not empty" assertion in these suites is written on the scope that must be
non-empty.

**The standing gate this subsystem is measured against** (`BACKLOG.md` §7): sentinel, path, prompt
injection, transaction and network suites, from DOS-P6 onward; `npm run check` on every commit;
exact-path staging; and a **fresh-context review by an agent that is not the author** on every
code-producing task.

**One gate-integrity item is open and unowned, and this one *is* in the tree** — `ORDER.md` carries
the measurement table. `apps/cli/src/commands/doctor.test.ts:195` needs 3.19 s of a 20 s budget on
an idle machine and went red in 5 of 6 full runs once eight fsync-heavy suites joined it. The measured fix is `fileParallelism: false`, which also dropped total test time
from roughly 1000 s to 700 s. A case one contended run from red is a gate one contended run from
uninformative, and this is the second such item this program has paid for. Separately, an
`ENOTEMPTY` during a fixture's own recursive cleanup is a filesystem race that serialization may only
have made rarer; it is unmeasured and possibly still live.

---

## 9. Where the rest lives

| For | Read |
|---|---|
| The capability model — two gates, three values, and why it is recorded twice | `claude-adapter.md` §3 and `codex-adapter.md` §3; parity enforced by `apps/cli/src/adapter-capability-parity.test.ts`. **Read the code for the values**: both notes still say `plugin_hooks` is `unknown`, and DOS-P6 Task 3 changed it to `not-used` — hooks were declined rather than deferred, and `unknown` is what the model does with a fact nobody established (`BACKLOG.md` §8) |
| The two-adapter differences table DOS-P6 designs against | `codex-adapter.md` §9 |
| Fourteen Codex residuals and twelve Claude ones, most with owners | `codex-adapter.md` §11, `claude-adapter.md` §9 |
| The mutation pipeline, ownership, exit codes and what Foundation cannot do | `foundation.md` §3, §4, §6, §7 |
| The verbatim per-task Foundation constraints, and two open founder questions | `foundation-constraints.md` |
| The two Brain invariants and their two exemptions | `brain.md` §5 |
| The security seams as designed, before implementation corrected them | design spec §8 |
| Open defects, the standing gates, and the amendment index | `BACKLOG.md` §1, §7, §8 |
| The four Foundation requests this subsystem raised, one of them a security cost | `ORDER.md` |

**Exit codes are part of the contract**, and a security refusal has its own: `5`
(`foundation.md` §6). Flattening a refusal into an operational failure would erase the one signal
that says a guard fired, which is why the `doctor` warn/fail demotion is narrow and why
`refusalFrom` picks `5` only when a security validator is among the findings
(`apps/cli/src/commands/ingest.ts:661-675`).
