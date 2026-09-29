# Developer OS — Threat Model

**Consolidated 2026-08-14 by DOS-P6 Task 18**, as the companion trust-boundary record named by the
knowledge-pipeline architecture note §12, and the row `docs/superpowers/BACKLOG.md` §5 carried from
the day the program file map was written.

This document **consolidates a posture that already exists**; it invents none. Everything in it was
already recorded in `docs/architecture/claude-adapter.md`, `docs/architecture/codex-adapter.md`,
`docs/architecture/brain.md`, `docs/architecture/foundation.md` and
`docs/architecture/foundation-constraints.md` — spread across five notes, which is exactly why a
reader could hold four of them and still not know what defends what. What is new here is one place
where every boundary sits beside the mechanism that enforces it and the artifact that proves it.

**Every row cites the code or the test, and the exceptions are declared rather than hidden.** A
threat model whose claims cannot be checked against the tree rots at the first refactor, so a
mechanism is a `path:line` or an anchor — a backticked path, an em dash, a backticked identifier the file contains, which the citation gate checks by content where a line is only bounds-checked — and evidence is a named test case wherever one exists. **Three kinds of
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
   demonstration, the cell says `(§8: no watched failure)`.** 38 of that directory's 90 cases are in
   that position, and citing one without the marker would let a reader take it for evidence — the
   failure mode §1 exists to prevent, one level down. §8 is the whole accounting, **including what
   about §8 itself is not checkable against this repository.**

**Two things stay where they are.** The **capability model** — two gates, three values — is recorded
per adapter and is deliberately not moved here; `codex-adapter.md` §3 says why, and
`apps/cli/src/adapter-capability-parity.test.ts` is what keeps the two vocabularies identical while
it stays there. The **residuals** with named owners stay in their own notes' residual sections; this
document names only the ones that change what a boundary is worth.

---

## 1. Three boundaries this document would naturally claim, one of which does not hold

Stated first, because a reader who stops after one section must not leave believing an enforcement
that is absent. Each is stated again in §5, beside the boundary it belongs to, with its mechanism
and its record.

| Boundary | Status | The record that owns it |
|---|---|---|
| A capture stays inside the vault | **holds since 2026-08-15**; the check-then-use window closed for `capture` on 2026-09-28 | closed: `BACKLOG.md` §1 NEW-14 and **NEW-20** |
| A secret removed from a vault file is gone from the machine | **holds since 2026-08-17** — the pre-edit copy is pruned at both terminal phases | closed: `ORDER.md`, Foundation request 2 |
| An agent invocation is bounded in turns | **partial** — bounded under Claude, no such field under Codex | `codex-adapter.md` §11.3 |

**The first row changed on 2026-08-15 and this table is the corrected one.** The relocated-quarantine
escape it used to record as absent was closed by the fix round after DOS-P6 Task 19's review: all
three commands that touch quarantine now anchor on the configured content root through one shared
`resolveContainedRoot` (§5.2). What remained was narrower —
`resolveContainedRoot` proved the root once and `capture` followed the declared path again afterwards,
so a won race could redirect a capture (**NEW-20**, closed 2026-09-28: `capture` now reads and writes
through the canonical root the proof held for; §5.2).

**These are not "known issues" filed at the back.** The second used to defeat a sentence this product
tells a user to their face — that `review --decision edit` removed the secret they pasted — and that
is what closing it on 2026-08-17 was worth. The third still means one of two vendors runs an
unbounded agentic loop under a 120-second wall clock and nothing else.

**Three further gaps were found while writing this document**, all registered as `BACKLOG.md` §1
rows, and **two of the three closed on 2026-08-17**. **NEW-15** — a discovered vendor binary executed
without the owner and mode check its own type says its executor owes — is closed by
`assertTrustedExecutable`, called by all three executors (§5.11); two residuals of it stay open, one
of them a known bypass. **NEW-16** — the `user-pattern` redaction class having no production caller
and no configuration key — is closed by the `[redaction]` table and `createRedactor` (§5.7); three
usability residuals stay open. **NEW-17** — a TOML parse failure on a `brain` run reaching the user
through the heuristic redactor alone — is closed too: `readConfig` reads through `readConfigFile`
like every other command (§5.7, §5.12).

None of the three was fixed *here*: this document's own task was documentation and no production file
was in its scope. All three were fixed afterwards, and **this document went on asserting all three
were open** — NEW-17 for two days, NEW-15 and NEW-16 for one — in §1, in §5, and again in §6's
summary of §5. That is why §1 now states closures rather than deferring them: a reader who stops
after the first section is the reader this section exists for, and three times over they were told a
boundary was missing that was not.

---

## 2. What is being defended, and against whom

Developer OS is a **local-first CLI on one developer's machine**. There is no server, no account and
no telemetry, and no network except the explicit `update` plan and apply, which fetch signed release
metadata and bundles (§5.16, §7). The assets are therefore local and few:

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
| **Capture text** | agent-authored from a session an attacker may have influenced; may contain secrets the author never meant to send | `apps/cli/src/commands/capture.ts:307` |
| **Vault content** | user data, hand-edited, and may contain secrets the user wrote into their own notes | `packages/brain/src/schema/note.ts`, via `BrainService` |
| **Model output** | a proposal chosen by a model that has just read untrusted capture text | `packages/brain/src/ingest/proposal.ts:202` |
| **The vendor CLI's stdout** | a third-party binary's output, streamed, and parsed into an object callers will spread | `packages/security/src/cli.ts:249` |
| **Configuration** | a TOML file the user edits by hand | `apps/cli/src/config-file.ts:36` (`readConfigFile`), then `packages/core/src/config/loader.ts:457-480` |
| **The installation manifest** | a JSON file on disk that decides ownership, and therefore deletion | `packages/core/src/manifest/store.ts:271` |
| **`PATH`** | it decides which binary is `claude` or `codex` | `packages/platform-macos/src/macos.ts:184-186` |
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
        │  ── seam 2: the capture file's own containment   §5.2  ◀ NEW-20
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
| Raw text is never persisted, hashed, logged or sent to a model | `redactAndNormalize` redacts, then normalizes, then hashes, in one function that cannot be reordered from outside (`packages/brain/src/capture/build.ts:179-196`); `buildCapture` calls it before anything else exists (`:216-220`) | `tests/security/sentinel.test.ts` — `keeps the sentinel out of the capture file`, `the model input`, `the staging directory`, `every validator report`, `the canonical note` |
| The pre-redaction bound measures and nothing else | `resolveText` takes a byte length and refuses; the text is not logged, hashed or echoed into any refusal (`apps/cli/src/commands/capture.ts:307-339`) | the same suite's per-artifact sweep |
| The capture id derives from redacted content, so two texts differing only by a secret are one capture | `captureId` is the first 16 hex of the hash over the redacted, normalized content (`packages/brain/src/capture/build.ts:221`) | `tests/security/sentinel.test.ts` — `keeps the sentinel out of the deduplication hash` **(§8: no watched failure)** |
| A fingerprint identifies a secret without carrying it | HMAC-SHA256 under the install's key, truncated to 16 hex (`packages/security/src/redaction.ts:349-354`); the key must be at least 32 bytes or `redactText` throws (`:410-412`) | `packages/security/src/redaction.test.ts` |
| A pathological PEM marker cannot make redaction superlinear | the PEM body is bounded at 8,000 characters, chosen by measurement rather than for being finite (`packages/security/src/redaction.ts:356-376`) | `packages/security/src/redaction.test.ts` |
| Quarantine is created private | `mkdir` with mode `0o700` (`apps/cli/src/commands/quarantine.ts:279`) | — |

**The sentinel suite asserts per artifact, never in total** — the rule is stated at
`tests/security/sentinel.test.ts:27-31` and enforced by `it.each(ARTIFACTS)` at `:245`, over the
nine-name array at `:54-64`. A single assertion over a concatenation of all nine would pass while
eight were empty, which is the shape of gate this repository has shipped and regretted twice. The
ninth name is `"the backup directory"`, added on 2026-08-17 with its own floor rather than appended
to staging's, because a shared floor is that same defect one level down.

**A capture is deliberately not a managed artifact** (`apps/cli/src/commands/quarantine.ts:257-261`).
Recording it in `installation-manifest.json` would report every legitimate Obsidian edit as drift.
The cost is that `validateChangePlan`'s ownership check does not stand behind a capture write;
`resolveCapturePath` stands there instead, which is a narrower constraint rather than the same one
— and §5.2 is what that narrowness costs.

**`import` is a second entrance into quarantine (A14), and it goes through the same door.** It feeds
each inbox, path or Claude memory file to `buildCapture` unchanged, so the redaction-first ordering
above holds for it without a second implementation. What it adds is bounded and named:

- **Bounded.** Every source file is read through `readUntrustedText` (no symlink follow, a
  pre-read size bound, UTF-8 and NUL refusal). A walk stops at `IMPORT_MAX_ENTRIES_WALKED` entries
  or `IMPORT_MAX_DEPTH` levels, a run writes at most `IMPORT_MAX_FILES_PER_RUN` captures, and an
  over-bound input is refused and named, never truncated. `readUntrustedText`
  (`apps/cli/src/commands/untrusted-file.ts` — `readUntrustedText`) is the one reader for vault,
  user, vendor and override files: the protected-path check runs before the `lstat` and the open,
  and a refusal (`UntrustedFileRefusal`) carries neither content nor path.
- **Redacted before persistence.** The only staged payload is the redacted capture, written by one
  Foundation `create` transaction per new capture through the mutation gate, with quarantine as
  the owned root and the product home as the excluded one. `tests/security/sentinel.test.ts` walks
  the product home and the vault after a finalized import and finds the sentinel nowhere but the
  planted source.
- **It does not archive (Q5 A).** A source is never moved, rewritten or removed, and
  `_raw/processed/` is written by no verb. The capture id is the content hash, so a rerun reports
  duplicates and writes nothing. Nothing hashes unredacted content. Unredacted user bytes
  therefore stay in the inbox, which is never indexed (`brain.md` §6.2); Obsidian or third-party sync
  of the whole vault is outside the product.
- **The path policy runs before any read.** A source inside the product home refuses exit 5, a
  vault path outside the inbox refuses exit 2, and a protected root refuses exit 5
  (`import_source_protected`).

### 5.2 The capture file's own containment

| Boundary | Mechanism | Evidence |
|---|---|---|
| A capture *file* that is a symlink is never followed | `captureFileNames` filters `entry.isFile()`, which `readdir(withFileTypes)` reports false for a link, so the file is skipped at selection before any path is resolved | `tests/security/symlink-escape.test.ts` — `never follows a symlink standing where a capture file should be` |
| The quarantine directory resolves inside the configured content root | `resolveContainedRoot` canonicalizes both and refuses at exit 5 before anything is read, once per run, in **all three** commands that touch quarantine — `capture`, `review` and `ingest` (`apps/cli/src/context.ts:348-361`) | `tests/security/symlink-escape.test.ts` — `is refused at exit 5, and neither the capture nor the vault is touched`, and `is refused at exit 5, and no observation is written at the destination` |
| A capture path resolves inside quarantine | `resolveCapturePath` canonicalizes the target and compares it against **that proven root** | the first of those |

**This section recorded an absent boundary until 2026-08-15.** `resolveCapturePath` compared the
canonicalized quarantine root and the canonicalized target **against each other and never against
the content root**, so replacing `content/_raw/quarantine` with a symbolic link to a directory
outside the vault held at the new location exactly as it did at the old one: `ingest` completed and
rewrote the capture file outside the vault, and `review.ts` carried the identical construction. The
writable-path guard did not catch it either — `ProtectedPathPolicy` is a protected-*name* policy and
returns early for any path outside the user's home directory
(`packages/security/src/protected-paths.ts:177-186`), so a relocation to a sibling of the home
directory was refused by nothing.

**`capture` had no such check at all, and it is the command that *writes* the file.** It handed the
textually built quarantine path to `validateChangePlan` as an owned root, and a **sideways**
relocation satisfies everything that validator asks — such a root neither grows authority nor lands
in `excludedRoots` — so `developer-os capture` wrote the user's redacted observation into an
attacker-chosen directory, one file per capture. The model cannot reach it (zero write scopes, and
every path it proposes is refused out of the private folders), so it needs prior local write access
to the vault; what it then buys is silent exfiltration of every future capture, into a synced folder
for instance. It was fixed on 2026-08-15 in the same round that found it, rather than registered:
with two commands refusing at exit 5 and the third writing happily, captures were also piling up
where no later run would ever read them.

**What the canonical root is used for is itself a boundary.** `ingest` and `review` measure every
capture path against it; `capture` takes the *answer* and discards the value, because the path it
goes on to declare has to be the one the user configured. Handing a pre-canonicalized root to
`validateChangePlan` makes `assertUsableRoots`'s ancestor test compare a string with itself
(`packages/core/src/plans/validate.ts:201-206`), and `containsPath` cannot stand in for that test: it
is same-or-descendant (`packages/core/src/manifest/store.ts:118-121`), so a quarantine pointing at
the content root passes containment. It also keeps `CaptureResultV1.path` — printed, and published in
`--json` — the path the user wrote rather than the one their filesystem resolves it to.

**What refuses the ancestor shape today is not that ownership check, and the distinction is worth
keeping.** `init` records the Brain skeleton's directories as managed artifacts, and
`validateChangePlan` canonicalizes every artifact path before ownership is reached, refusing when two
collide (`packages/core/src/plans/validate.ts:303-313`) — which is exactly what a quarantine linked
to `content` or `content/_raw` produces. Both spellings therefore end at exit 6 with nothing written,
measured against a real `init`. The re-armed ancestor check is **depth behind that**, and it is worth
having because the collision guard is incidental: it depends on `init` recording directories, which
is not a security property, and its message names the manifest rather than the link.

**`capture` and `import` use the form the check held for** (`BACKLOG.md` §1 **NEW-20**, closed 2026-09-28):
`resolveQuarantine` returns the canonical quarantine beside the declared one, every read, `mkdir` and
write goes through the canonical form, and the declared form survives only as `CaptureResultV1.path`
and as `validateChangePlan`'s owned root. An ancestor symlink retargeted after the proof therefore
re-resolves the owned root and not the target, and the plan is refused at exit 5 as
`outside_owned_roots` (`apps/cli/src/commands/capture.test.ts` and `import.test.ts` — `refuses at
exit 5 and writes nowhere when the content root is retargeted after the proof`). **Residual:** a real
directory on the canonical chain replaced by a symlink after the proof has one string for both forms,
which only descriptor-relative operations would pin.

All three commands now resolve the quarantine root once, through **one shared implementation**
(`apps/cli/src/context.ts:348-361`), prove it inside the configured content root, and measure every
capture path against the proven root. One implementation rather than three, because this repository's
own rule for a security check is that it must not exist twice
(`packages/security/src/cli.ts:10-13`); each command injects its own refusal so the exit code and
recovery text stay its own, the way `writeIndexArtifacts` already takes one
(`apps/cli/src/commands/reindex.ts:81-89`). **`BACKLOG.md` §1 NEW-14 closed with it**, and the parked
`it.fails` that announced it is an ordinary passing case.

**The leaf refusal in the first row is still no evidence about the directory case** — it is a
different guard, at a different stage, and anyone reading one as covering the other has read the
wrong one. That is why the two are separate rows.

### 5.3 Captured text into a model

| Boundary | Mechanism | Evidence |
|---|---|---|
| The **ingest prompt** marks captured material as data, never as instruction | the heading and the four sentences under it (`packages/brain/src/ingest/prompt.ts:95-102`) | `tests/security/prompt-injection.test.ts:144-145` — the positive control asserts both that the injected text reached the model and that the literal `untrusted data, not instruction` is in the prompt. **That literal is this prompt's own heading (`packages/brain/src/ingest/prompt.ts:95`), not the shared preamble** |
| The **shared skill preamble** carrying the full injection defence cannot be removed | it is **concatenated** into every rendered skill rather than referenced — `renderSkillBody` splices `preamble(options.shared)` into the body of every non-`shared` workflow (`packages/workflow-schema/src/skill.ts:200-201`). `assertUsablePreamble` separately refuses a `shared` that is the wrong workflow or whose prose screens to nothing — an empty preamble is a heading over nothing (`:126-145`) | **Mechanism only — no `tests/security/` case exercises it.** The row above proves a different artifact. `packages/workflow-schema/src/skill.test.ts` covers the preamble at the rendering layer |
| There is no code path from raw capture text to a model | `buildIngestPrompt` takes two parameters — an envelope and a config — and `envelope.content` is post-redaction by the type's own contract (`packages/brain/src/ingest/prompt.ts:67-70`). A third parameter carrying a transcript or a raw fallback is what would turn this back into a promise | the sentinel suite's `the model input` case |
| A payload cannot forge Markdown structure in the prompt | `boundedProse` first, then `fenced` over its output, and the order is the defence: `neutralizeBlockStart` escapes every column-0 CommonMark construct (`packages/security/src/markdown.ts:43-49`), `fenced` only sizes the opening run so a payload carrying its own fence cannot close the block early (`:69-76`) | `tests/security/prompt-injection.test.ts` — `a forged System heading`, `a fence escape carrying a URL` **(§8: neither carries a watched failure)**; `packages/security/src/markdown.test.ts` covers both constructs at the unit layer |
| The prompt is bounded by one envelope, not by one file | `MAX_PROMPT_CONTENT_GRAPHEMES` = 16,384, applied to the joined block rather than per paragraph, because a per-paragraph bound is not a bound (`packages/brain/src/ingest/prompt.ts:13`, `packages/security/src/markdown.ts:51-61`) | `packages/brain/src/ingest/prompt.test.ts` |
| Nothing from captured text reaches an argument position of its own | the positional rule refuses any value beginning with `-`, whatever follows — it lives in `screenProseArgument` (`packages/security/src/cli.ts:166-171`) and `screenValueArgument` delegates to it before adding the word list (`packages/security/src/cli.ts:136-143`), so both screens carry it | `tests/security/prompt-injection.test.ts:129-132` — asserted element-wise on argv, which is the assertion that means something: a URL inside the prompt is fine, a URL that became its own argument is not |
| A pipe-to-shell in captured text never reaches a command position | `assertSafeCommand` normalizes `\r`/`\n` to spaces before matching, then refuses `\| sh` for `curl` and `wget` (`packages/security/src/process.ts:66-75`) | `tests/security/multiline-command.test.ts` — the `\n`, `\r\n`, `\r`, `bash`, `zsh` and `wget` rows |

**One measured correction, worth carrying.** The newline normalization SEC-100 is named for is
**redundant today**: the pattern's own `\s*` and `\s` already match `\r` and `\n`, and removing the
normalize step alone left the suite green. The guard is carried by the character class, not by the
line SEC-100 credits. Two layers where one would do is not a defect — but a future narrowing of that
pattern to `[ \t]` would silently reopen SEC-100, so both lines are now pinned by the suite.

**One side effect that reaches a model, stated because it does.** `screenControlCharacters` collapses
every whitespace run, so a multi-line observation reaches the model with its intra-paragraph line
breaks turned into spaces (`packages/brain/src/ingest/prompt.ts:158-164`). Paragraph boundaries
survive; single line breaks inside a paragraph do not.

### 5.4 Model output into a proposal, and a proposal into the vault

The rule is design spec §14.1's, and this is where it becomes code: **the model's output is a
proposal, never proof of safety.**

| Boundary | Mechanism | Evidence |
|---|---|---|
| Output is structured and validated, never best-effort parsed | `parseStructuredPayload` refuses a top-level `__proto__` before returning a value callers will spread, and refuses unparseable output as `malformed-output` (`packages/security/src/cli.ts:249-268`) — **only the top level is walked**, and a caller merging a nested field owes its own guard | `packages/security/src/cli.test.ts` |
| A proposal cannot smuggle a prototype through Zod | `carriesReservedKey` checks the prototype *and* the own `__proto__` key before the schema runs, because Zod strips `__proto__` ahead of its own strictness check (`packages/brain/src/ingest/proposal.ts:104-108`) | `packages/brain/src/ingest/proposal.test.ts` |
| A proposal is bounded | at most 32 notes (`packages/brain/src/ingest/proposal.ts:65,218`); path length, extension, separator and control characters refused as string properties (`:130-140`) | `packages/brain/src/ingest/proposal.test.ts` |
| Model output cannot widen write scope | nine validators run on every call, all of them, with every finding returned (`packages/brain/src/ingest/validate.ts:24-43`). `writeScope` consults the workflow's declared scopes as an **upper bound** (`:643-661`), subtracts private folders, the indexes directory and dot-segments from the written path (`:569-582`, `:663-678`), checks containment on the **canonicalized destination, not the written path** (`:680-699`), subtracts the private folders from that destination too (`:701-728`), and folds the same subtraction over the destination's own segments at every depth (`:730-754`) — the twin `generatedOutputConsistency` already had, and without which a proposal spelled `_RAW/quarantine/…` lands in the real quarantine on any case-insensitive volume | `tests/security/symlink-escape.test.ts` — `refuses at exit 5, leaves the capture accepted, and writes nothing at the destination`; `tests/security/prompt-injection.test.ts` — `writes nothing at the destination a traversal would resolve to`, `writes nothing under the raw folder, whatever case the proposal spells it in` |
| A secret in the proposal never reaches the vault | `secretScan` runs the redaction pass over the path, the contents *and* the provenance id, and reports **class names and the file, never the value, never the redacted text, never the fingerprint** (`packages/brain/src/ingest/validate.ts:505-570`) | `tests/security/sentinel.test.ts` — `keeps the sentinel out of every validator report` |
| A proposal cannot overwrite the user's own note | a model proposal cannot overwrite a note (P1 stays `create`; the `malformed-manifest.test.ts` case stays green); only a verbatim note capture can replace, only the note it named at capture time, only while that note still hashes to the value recorded then, and only with bytes a person accepted. `applyNotes` in `apps/cli/src/commands/ingest.ts` emits `replace` only for the note a note capture is bound to, with the capture-time SHA-256 as the transaction's `expectedBeforeHash`; every other write is `create`. "A person accepted" is enforced by `review --decision accept` alone: `review` and `ingest` do not refuse inside an agent session (only `brain retire` and `brain refactor` do), so an in-session agent can accept its own replacing capture (`brain.md` §6.13 R1) | `tests/security/malformed-manifest.test.ts` — `refuses to replace a note a forged manifest claims to own`; `tests/security/note-capture.test.ts` — `refuses: exit 3, reason note_changed_since_capture, bytes intact, capture accepted` and `leaves malformed-manifest.test.ts's plain-capture replace refusal in force` |
| A failure's machine-readable payload carries nothing unredacted, and nothing a caller chose | `CliError.data` is typed `RedactedPayload`, a `unique symbol` brand whose sole producer is `redactPayload` — which takes the redactor and performs the walk rather than asserting, so obtaining the type means having redacted. `failure` accepts a payload only by registry identity, and `publish` rebuilds any arm it did not produce (`packages/core/src/result.ts:632`, `:802`, `:984`). `ingest` populates it through `reportFields`, which publishes every field byte-exact — the rule stated two rows down, *paths are byte-exact everywhere and screened at the terminal instead*. Screening the ids and note paths here was tried and reverted: the screen collapses whitespace, so it renamed ordinary files (`cap  two` → `cap two`, `DEV/two  spaces.md` → `DEV/two spaces.md`) while the success arm published the same values raw, making `data` the only rendering of four that was wrong. What byte-exactness leaves open is that `JSON.stringify` escapes `\p{Cc}` and not `\p{Cf}`, so an override in a *filename* reaches a consumer here in the byte-exact id, by design; the warning sentence in `error.message` renders the same name through `renderPath` (NEW-38, closed 2026-09-28) | `packages/core/src/result.test.ts` — every guard that *can* be pinned is revert-verified, meaning deleting it reddens a named case; the handful that cannot be pinned are labelled at the source as equivalents, unreachable, unobservable, or redundant with a sibling, so a survivor without a label is a finding and a label that is wrong is a worse one — five have been caught and corrected, each having excused a live guard from review. `apps/cli/src/commands/ingest.test.ts` — `publishes a capture id byte-exact, as the success arm does` and `names a refused path byte-exact, against the file on disk`; `tests/security/sentinel.test.ts` plants its sentinel in a note *path* as well as a body, which is what covers `error.paths` |
| What the payload's redaction scopes still leave open | `redactPayload` redacts a key in the `name` scope (no `user-pattern`) and a string leaf in the `value` scope, and both return the caller's bytes when nothing matched, so a clean path on `data` is byte-exact (NEW-36, closed 2026-09-28). `error.paths` is redacted in the `path` scope — every class except `high-entropy`, so a configured pattern or a provider token in a model-chosen note path is redacted while `_raw/quarantine/<id>.md` survives (NEW-39, closed 2026-09-28). A `number` leaf is published unchanged by contract; a caller-derived identifier goes in as a string (NEW-37, closed 2026-09-28). **Open:** a product-owned enum value is a string leaf, so a user pattern equal to one still redacts it (NEW-36 residual). The **message** beside it renders the quarantine filename `selectCaptures` embeds in its warning through `renderPath`, because `JSON.stringify` escapes `\p{Cc}` but not `\p{Cf}` (NEW-38, closed 2026-09-28; the byte-exact id stays in `data`). And a third, undated by a row because it is a designed bound rather than a defect: a payload large enough to reach `MAX_NODES` is published **truncated** — an array entry or an added key spelled `"[truncated]"` — while still declaring `schemaVersion: 1`, which unreadable captures can reach because `--limit` does not bound them | `packages/security/src/redaction.test.ts` — `redaction scopes (NEW-36, NEW-39)`; `apps/cli/src/context.test.ts` — `redacts a configured pattern in error.paths and leaves a quarantine path intact (NEW-39)`; `tests/security/sentinel.test.ts` plants its sentinel in a note path. The enum residual and the truncation bound are registered, not defended — the row exists so the boundary is not read as tighter than it is |
| A model-chosen path or a quarantine **filename** cannot repaint a terminal or a `--json` consumer through a message | findings render through `renderPath` in `renderValidationFinding`, and an unreadable capture's filename through `renderPath` in `selectCaptures`' warning (NEW-38), at the seam where a path stops being data and becomes a message, including the `--json` channel, because `JSON.stringify` escapes `\p{Cc}` but not `\p{Cf}`; the structured ids and paths stay byte-exact | `apps/cli/src/commands/ingest.test.ts` — `screens format characters in the unreadable-capture warning, not in the id`, `screens format characters in the success arm's warnings too` |
| A failure leaves the capture retryable and never `ingested` | any validator finding exits without touching status (`apps/cli/src/commands/ingest.ts:819-845`); five transaction kinds isolate each phase (`:271-277`) | `tests/security/interruption.test.ts` — `an interruption at every forward phase`, all seven phases × the capture write and each of the four forward ingest kinds, plus the derived coverage case |

**The defence is in depth, and the evidence shows it.** When Task 15 reverted only the proposal
parser's traversal rule, the injection suite stayed **green** — the write-scope validator caught it.
Reddening it needed the parser rule *and* the validator's unsafe-path branch *and* the declared-glob
check removed together. That is the strongest single statement in this document about the model-output
seam, and it is a measurement rather than a claim.

**`validateChangePlan` is deliberately absent from the note write too**
(`apps/cli/src/commands/ingest.ts:1272-1279`), for the same reason it is absent from a capture write: a
note is the user's own content. The write-scope validator stands in its place, which is narrower than
ownership and is the constraint that matters for a path a model chose.

### 5.5 The vendor CLI as a subprocess

The vendor CLI is the only outbound process this product makes, and the only place any model runs.

| Boundary | Mechanism | Evidence |
|---|---|---|
| The model is invoked with zero declared write scopes | `writeScopes: []` at the call site (`apps/cli/src/commands/ingest.ts:1097`); Codex derives `-s read-only` **from the count and never from an argument**, which is what makes `danger-full-access` unreachable rather than merely unwritten (`packages/adapter-codex/src/invoke.ts:232-238`, `packages/adapter-codex/src/invoke.ts:310`); Claude is passed `--tools ""` — an empty tool *set*, not an allow-list — so there is no tool the vendor's own permission system could grant a write through, and no `allowedTools`-shaped field exists on `ClaudeInvocation` for a caller to widen (`packages/adapter-claude/src/invoke.ts:7-11,122`) | `apps/cli/src/commands/ingest.test.ts:1945` — `gives claude no tools at all, so the read scope is the prompt and nothing else`; `packages/adapter-claude/src/invoke.test.ts:54` — `passes argv as an array, in print mode, with no tools and no user configuration`; `packages/adapter-codex/src/invoke.test.ts:314` — `uses read-only and adds no --add-dir when there are no write scopes`; `tests/security/network.test.ts:256` — `spawns exactly one process during ingest, and it is the discovered vendor binary` |
| No shell is ever involved | `spawn(..., { shell: false })` (`packages/security/src/process.ts:91-97`) | `packages/security/src/process.test.ts` |
| The executable is absolute | `assertSafeCommand` refuses a non-absolute executable (`packages/security/src/process.ts:47-54`). Separately, the request carries no `PATH`, so a child has nothing to resolve a bare name against | `packages/security/src/process.test.ts:86-103` — `rejects foreign-platform executable syntax that is not locally absolute`, an `it.skipIf` that runs wherever `C:\tools\curl.exe` is not absolute, so it executes on the supported platform; `tests/security/network.test.ts:248-251` asserts absoluteness across every classified spawn |
| The executable, `cwd`, every argument and stdin are NUL-free | four `containsNul` checks across two branches — the executable (`packages/security/src/process.ts:49`), then the working directory, every argument and stdin (`:57`, `:58`, `:59`) | **Proven per branch since 2026-08-15.** `describe("assertSafeCommand")` (`packages/security/src/process.test.ts:62`) holds a case for each of the four `containsNul` sites — executable (`:107`), working directory (`:117`), any argument (`:125`), stdin (`:133`). This cell said no test exercised a NUL at all, and pointed at **NEW-18**, a row Track R closed with a regression test each and removed from `BACKLOG.md` §1 three days before this sentence was last edited. |
| The child inherits nothing from the parent environment | the runner passes only `{...request.env}` (`packages/security/src/process.ts:95`), and both adapters pass `env: {}` — stricter than the spec asks | `tests/security/network.test.ts` — `does not pass a proxy the parent process was given`, asserted by *inheritance* rather than by an expectation that could be edited to match a leak |
| Output cannot exhaust memory | 1 MiB per stream, after which the child is `SIGKILL`ed and the call is a security refusal (`packages/security/src/process.ts:7,185-220`) | `packages/security/src/process.test.ts` |
| A run is bounded in wall clock | `SIGTERM`, then `SIGKILL` 100 ms later, to the process *group* on darwin (`packages/security/src/process.ts:115-132,172-183`); `INGEST_TIMEOUT_MS` is 120 s (`apps/cli/src/commands/ingest.ts:235-241`) | `packages/security/src/process.test.ts` |
| Vendor output is redacted before it is returned to any caller | the runner redacts stdout and stderr inside `finishFromClose` (`packages/security/src/process.ts:154-159`), with the user's `[redaction]` patterns once configuration is read (NEW-26, §5.7) | `tests/security/sentinel.test.ts`'s `the logs` and `the --json output` cases **(§8: neither carries a watched failure)**; `packages/security/src/process.test.ts` asserts the redaction at the runner; `apps/cli/src/context.test.ts` → "redacts vendor stdout and stderr with the configured patterns once they are bound" |
| A refusal never echoes the rejected value | `parseAgentPromptArgs` scrubs it, because a `with` block is author-controlled and the message reaches a log (`packages/core/src/agent-prompt/index.ts:83-88`) | `packages/core/src/agent-prompt/agent-prompt.test.ts` |
| **An invocation is bounded in turns** | **partial** | see below |

**This is the third of the three.** At the direct adapter boundary, `maxTurns` is bounded and
enforced under Claude — an integer
between 1 and 50, refused otherwise, bounded at the adapter rather than trusted from the type
(`packages/adapter-claude/src/invoke.ts:26,68-78`) — and `CodexInvocation` has no such field, so the
Codex arm of `invokeVendor` passes none (`apps/cli/src/commands/ingest.ts:1094-1100`). The shared
workflow parser does not expose those two behaviours: it refuses `maxTurns` before vendor selection.

Half of it is closed and the half that is closed is worth knowing: `parseAgentPromptArgs` now
**refuses `maxTurns` outright** with an error naming its owner, rather than honouring it on one
vendor and dropping it on the other (`packages/core/src/agent-prompt/index.ts:68-79`, pinned by
`packages/core/src/agent-prompt/agent-prompt.test.ts:50,63`). So a *workflow author* can no longer
set a bound that silently applies to one vendor. What survives is `ingest`'s own direct invocation:
it sets `DEFAULT_MAX_TURNS` for Claude (`apps/cli/src/commands/ingest.ts:1089`) and nothing for Codex,
so an ingest against Codex is bounded by `INGEST_TIMEOUT_MS` and by nothing else. **Record:
`codex-adapter.md` §11.3.**

**One rule at this seam is best-effort and says so.** `screenValueArgument` stacks a positional rule
(nothing in a value position may begin with `-`) that is *complete*, and a nominal word list
(`permission|danger|bypass`) that is *not* and cannot be made so (`packages/security/src/cli.ts:82-143`).
**The split landed in two halves, and NEW-12 is now closed.** The first, on 2026-08-15, was by
position: prose goes through `screenProseArgument`, which keeps the positional rule and drops the
word list, because a capture body is prose and every capture containing the word `permission` was
otherwise unable to be ingested on either vendor. The second, on **2026-08-17**, was by *provenance*:
`screenDerivedPathArgument` takes the working root and the output schema path, which this product
assembles rather than receives, so a vault at `~/Danger/DeveloperBrain` no longer refuses every
`codex` ingest permanently. What still carries both rules is every value that **originates outside
this repository** — a tool name, a write scope, a sandbox mode.

**Two consequences of that second half belong in a threat model rather than only in a backlog.**
First, `ingest` can no longer produce a screening refusal at all — the prompt is heading-prefixed,
both paths are assembled from validated absolutes, spec §3.3 passes an empty write-scope array, and
the turn bound is a compile-time constant inside the window the Claude adapter enforces — so
`invokeVendor`'s refusal-detail branch is unreachable in production and is retained as defence in
depth. Second, **the same defect is set to reappear one field over**: `--add-dir` takes a directory
and `resolveScopeGlob` returns a vault-relative glob, so the first caller to pass a real write scope
will hand a derived path to the screen that still carries the word list. Claude carries no comparable
trap: `ClaudeInvocation` has no scope-shaped field at all — no `allowedTools`, no derived path — since
`--tools ""` takes no value for the screen to see (`packages/adapter-claude/src/invoke.ts:7-11`).

**One rule at this seam was provisional on the success path, and on 2026-08-20 it turned out to be
wrong.** Codex's `--json` streams JSONL while `--output-schema` constrains only the final response, so
stdout was reduced to *the last line that parses as a non-null JSON object*, filtering on no event
type — an invented enum a future version rejects being a failure only a real run would find. **DOS-P6
Task 17 made that call on 2026-08-15** and settled the framing and the existence of a discriminating
`type` field, but not the terminal-event rule: its run ended `turn.failed` on an exhausted usage
limit.

**NEW-21's successful turn showed the reduction selected the wrong event.** A successful turn ends on
`turn.completed`, a usage record; the response is the `item.completed` before it, whose `item.type` is
`agent_message` and whose `text` holds the payload as a string. So the seam returned vendor telemetry
with `ok: true` — the boundary reporting success over a document with no proposal in it — on every
successful run, invisibly, because no fixture had ever held a real successful stream.
`finalAgentMessage` replaces it and now filters on three vendor field names, trading a silent wrong
answer for a `malformed-output` if the vendor renames one.

**The 2026-08-15 run also showed what a boundary at this seam is protecting against, and that finding
survives the correction.** The failed stream's last parsing line is the `turn.failed` event, so any
rule reaching the parse at all would hand a caller a vendor error shaped like a result; what prevents
it is the `exitCode !== 0` check that runs *before* it (`packages/adapter-codex/src/invoke.ts`). **That ordering was already guarded** — a
synthetic non-zero-exit case in `invoke.test.ts` goes red without it — so what the real recording
adds is not the guard but the demonstration, against bytes a vendor actually emitted, of the payload
the guard keeps out.

### 5.6 The vault the model reads, and the vault the product reads

The agent is given read-only access to a vault that may contain secrets the **user** wrote into their
own notes. Redacting a user's canonical content is not this product's business; catching it on the
way back is, which is what §5.4's secret scan is for.

| Boundary | Mechanism | Evidence |
|---|---|---|
| The Brain never writes | `BrainServiceDependencies` is seven members and **none of them is a write channel** (`packages/brain/src/service.ts:33-41`), so "reindex does not mutate a user's notes" is a sentence the type refuses to express rather than a promise the implementation keeps | `packages/brain/src/service.test.ts` — the whole file runs the service against an injected reader and asserts on returned bytes; there is no write to assert about |
| Frontmatter resolves no YAML tag | the first explicitly tagged node is found and refused, and *any* tag counts, because which tags construct values is the library's decision and "frontmatter carries no tags" is this product's (`packages/brain/src/schema/note.ts:290-319,555-566`); `maxAliasCount` is pinned at the same seam (`:579`) | `packages/brain/src/schema/note.test.ts` |
| A frontmatter block cannot make parsing superlinear | `MAX_FRONTMATTER_CHARS` is 64 KiB, counted in UTF-16 code units because the cost is quadratic in *entries* and an entry costs at least five code units in any script (`packages/brain/src/indexes/build.ts:168,642`) | `packages/brain/src/indexes/build.test.ts` |
| Vault text cannot reorder a rendered line or repaint a terminal | one display screen for the whole product, covering `\p{Cf}` as well as `\p{Cc}` (`packages/security/src/screen.ts:72,96,110`); `escapeLeadingBlock` in the index renderer is a **different** rule — it stops text becoming Markdown structure where the screen stops characters reordering a line — and both run, in that order (`packages/brain/src/indexes/render.ts:92-100,112-121`) | `tests/e2e/brain.test.ts`, which crosses the seam so a future divergence fails rather than merely looking wrong |
| Paths are byte-exact everywhere and screened at the terminal instead | a path is an identifier the user must be able to act on, and link destinations must resolve; `renderPath` screens at the boundary (`apps/cli/src/context.ts:112-117`, `foundation.md` §5) | `apps/cli/src/context.test.ts` |

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

**"Redaction is never the only thing standing anywhere" is the design rule, and it now holds on
every command that reads configuration.** It did not when this section was written: `brain` read its
own configuration and let a `TomlError` reach the user through the heuristic redactor alone, which
was **NEW-17**. `readConfig` goes through `readConfigFile` like every other command
(`apps/cli/src/commands/brain.ts:127`) and rethrows `ConfigurationError` unmodified, so the parse
failure is content-free on that path too. NEW-17 is closed and removed from `BACKLOG.md` §1.

| Boundary | Mechanism | Evidence |
|---|---|---|
| Nine redaction classes, and a tenth cannot be added unreachably | `REDACTION_CLASSES` is frozen and a test asserts membership against findings **actually produced**, not against the list (`packages/security/src/redaction.ts:27-43`) | `packages/security/src/redaction.test.ts` |
| A user-supplied pattern cannot backtrack | user patterns are literal, case-insensitive substrings over NFC-normalized text — never regular expressions, because this codebase bounds no expression anywhere and a pathological pattern would hang the one operation that must not fail quietly (`packages/security/src/redaction.ts` — `RedactionOptions`) | `packages/security/src/redaction.test.ts:447-473` — `.*` and `(a+)+$` asserted to behave as literals |
| Redaction is a heuristic and is not the only thing standing — **on every command that reads configuration** | the worked example is configuration: a `loadConfig` throw becomes a content-free `ConfigurationError` rather than being handed to the redactor, because `smol-toml` embeds three raw source lines in `TomlError.message` (`apps/cli/src/config-file.ts:15-22,54-58`). `status`, `doctor`, `init`, `capture`, `uninstall`, `review` and `ingest` all reach configuration through that wrapper (`status.ts:44`, `doctor.ts:936,1711,1902`, `init.ts:347,442,946`, `apps/cli/src/commands/capture.ts:267`, `apps/cli/src/commands/uninstall.ts:736`, `review.ts:205`, `ingest.ts:492`) | `tests/e2e/foundation.test.ts:1355` — `never quotes the configuration it failed to parse` |
| The same, on a `brain` run | **holds since NEW-17 closed.** `readConfig` calls `readConfigFile` (`apps/cli/src/commands/brain.ts:127`) rather than parsing for itself, and rethrows `ConfigurationError` unmodified — its message quotes nothing and it carries the exit code `BrainRefusal` uses, so `failureFrom` renders it with no special handling. This row read **partial** for two days after the fix | `packages/core/src/config/config.test.ts`; `apps/cli/src/commands/brain.test.ts` |

**A gap found while writing this document — closed 2026-08-17, and this paragraph asserted the
opposite for a day afterwards.** `redactText`'s `userPatterns` option had no production caller and
`configSchema` had no redaction table, so design spec §8.2's "patterns live in `config.toml`"
described an unwired half: the `user-pattern` class was implemented, tested and unreachable from the
product.

**It is wired now.** `configSchema` carries an optional `[redaction]` table
(`packages/core/src/config/loader.ts:426`, whose `redactionSchema` is at `:181`), and the three
commands that redact bind the user's patterns into a closure at their composition root —
`apps/cli/src/commands/capture.ts:570`, `apps/cli/src/commands/review.ts:742`,
`apps/cli/src/commands/ingest.ts:2268`. `createRedactor` is the only production entry to
`redactText`, enforced by `tests/repository/redactor-entry.test.ts`, which is what keeps a new call
site from silently opting out of the user's own patterns. **The composition-root runner follows the
same patterns once configuration is read (NEW-26):** `readConfigFile` calls the context's optional
`bindRedactionPatterns` (`apps/cli/src/config-file.ts`), which swaps the production runner's
redactor — shared with the platform adapter — so vendor stdout and stderr on every command that
reads configuration redact the user's patterns; a test context without the member keeps its fake
runner. Pinned by `apps/cli/src/context.test.ts` → "redacts vendor stdout and stderr with the
configured patterns once they are bound" and `apps/cli/src/commands/ingest.test.ts` → "binds the
configured patterns to the runner before any vendor process runs". **Record: `BACKLOG.md` §1 NEW-16, closed;
NEW-24 closed 2026-09-28 as described next, NEW-26's fix is described above, and NEW-25 is fixed with the residual below.**

**A user pattern is named by index and flagged by match density (NEW-24, founder decision D73).**
A `user-pattern` finding carries `patternIndex`, the zero-based `[redaction]` row that produced it
as configured — a row number, never the text matched — and `redactAndNormalize` and
`renderCaptureFile` copy it by name, so it is persisted in the capture envelope. `redactText`
reports `overBroadPatterns`: the rows whose own matches cover at least 8% of an input of at least
256 code units (`packages/security/src/redaction.ts` — `OVER_BROAD_COVERAGE`). Length was the wrong
measure and was withdrawn from the loader. `capture` and `import` warn and `ingest`'s secret-scan finding names
the row, both by index. An `import` batch that refuses another file still carries the warning, in the
failure message and as `error.data.overBroadPatterns`, because the files it did write are already redacted. `doctor` does not check it: it has no text to measure a pattern against.
Pinned by `redaction.test.ts` → "user pattern index and match density (NEW-24, D73)".

**Overlapping candidates merge, except `high-entropy` (NEW-25, founder decision D71).**
`addCandidate` (`packages/security/src/redaction.ts`) merges a candidate with every one it
partially overlaps; the merged range keeps the class of the earliest-scanned contributor and
fingerprints the whole merged span, so `["Acme Corp", "Corp Holdings"]` over `Acme Corp Holdings`
no longer leaves `Acme` in the clear. `high-entropy` stays first-wins: its run spans a `KEY=` prefix,
and merging it would change the persisted fingerprint of an ordinary `API_TOKEN=…` line. **Residual:
when an earlier candidate covers only part of a high-entropy run — a user pattern matching the start
of a token, say — the run is dropped and the token's tail stays in the clear.** Pinned by
`redaction.test.ts` → "drops a high-entropy run that partially overlaps an earlier candidate,
leaving its tail".

### 5.8 The redaction key — the product's first secret at rest

| Boundary | Mechanism | Evidence |
|---|---|---|
| The key is not a managed artifact | created deliberately outside `mutationsFor`/`recordArtifacts`, so it never enters `installation-manifest.json`, is never hashed into a drift report, and is absent from `plan.created` too — naming it there would imply the manifest owns it (`apps/cli/src/commands/init.ts:1042-1061`) | `apps/cli/src/commands/init.test.ts`; `tests/e2e/foundation.test.ts:566` — `restores a deleted redaction key when init is run again` |
| Reading the key follows no symlink and cannot hang the CLI | `O_NOFOLLOW` because a symlink there is not our file, and `O_NONBLOCK` because `open(O_RDONLY)` on a FIFO blocks forever and the regular-file check is downstream of the open (`apps/cli/src/context.ts:534-545`) | `apps/cli/src/context.test.ts` |
| A key that is not a private regular file of the right length is refused or repaired | symlink, non-regular and short-file refusals, and the mode is forced back to `0600` through the open handle (`apps/cli/src/context.ts:564-579`); created at `0600` (`:603-607`) | `apps/cli/src/commands/doctor.test.ts:330` |
| A lost key degrades a diagnostic and never the knowledge | a missing key regenerates with a warning that prior fingerprints are no longer comparable (`apps/cli/src/context.ts:709-710,744`) — content is not derived from the key | `apps/cli/src/context.test.ts` |
| `uninstall` removes it, and that is the one named exception to the manifest-only rule | centralized in `redactionKeyPath` so the exception stays exactly one path wide (`apps/cli/src/context.ts:530-532`) | `apps/cli/src/commands/uninstall.test.ts` |

### 5.9 The transaction — **and the boundary that closed**

| Boundary | Mechanism | Evidence |
|---|---|---|
| Every managed mutation is journalled, backed up and recoverable | seven phases driven by one loop, each journalled *after* it completes and before the next is attempted, so the journal always describes work already done (`packages/core/src/transactions/executor.ts:2172-2203`, `:2969-2981`) — the full phase table is `foundation.md` §3 | `tests/security/interruption.test.ts` — an interruption at each of the seven forward phases, for the capture write and each of the four forward ingest kinds. **It is an in-process `afterPhase` throw, not a signal**, and the suite says so in its own header: a thrown error unwinds where a `SIGKILL` does not, so it proves the journal is recoverable and never that no `finally` ran |
| An interrupted run leaves the capture retryable and `doctor` says how to recover | `checkTransactions` fails on any incomplete journal and names both ways out in its recovery string (`apps/cli/src/commands/doctor.ts:1031,1042`), which sets exit 6; it fails a second way, on a backup payload that outlived a terminal transaction, naming the one `repair` that clears it (`:1059-1065`) | `tests/security/interruption.test.ts`, and its derived coverage case at `tests/security/interruption.test.ts:410` which reddens if the driven set shrinks; `tests/e2e/foundation.test.ts:1030` — `is reported, blocks init, and names both ways out` |
| A file that changed under a running command is not overwritten | two checks, and the earlier one is new as of 2026-08-20. A caller that read the file supplies the digest of what it read on `PlannedFileMutation.expectedBeforeHash`, and the **plan phase** refuses on a mismatch with `TransactionPreconditionError` (`packages/core/src/transactions/executor.ts:1608-1614`) — before anything is staged, so that refusal can promise the file is untouched. A write landing later is caught at backup time by the executor's own snapshot (`:2549-2551`), which cannot. `review`, `ingest`, `brain retire` and `brain refactor` supply a precondition on the write that follows their own read; the window that remains is registered as NEW-40 | `apps/cli/src/commands/review.test.ts` — `refuses, keeping the hand edit, when it lands between the read and the write`; `apps/cli/src/commands/ingest.test.ts` — `refuses when a hand edit lands between the read and the staging write`; `tests/security/concurrent-edit.test.ts` for the later window |
| A second operation on a held journal is refused | every store operation on a journal runs inside `withTransactionLock` (`packages/core/src/transactions/store.ts:202,254,268,290`), which takes an advisory per-transaction lock through `/usr/bin/lockf` (`packages/platform-macos/src/transaction-lock.ts:17,84`) | `tests/security/concurrent-edit.test.ts` — `refuses a second transaction while one holds the lock` |
| **A secret removed from a vault file is gone from the machine** | `TransactionExecutor.pruneBackups` unlinks every `<index>.bin` and `<index>.bin.tmp` at both terminal transitions and both terminal early-returns (`packages/core/src/transactions/executor.ts`) | `tests/security/backup-prune.test.ts` — `holds nowhere under the product home once the edit finalizes`, which sweeps the whole product home **after** the command returns and reddens when the prune is disabled; `packages/core/src/transactions/transactions.test.ts` pins the mechanism per phase |

**This is the second of the three, and it closed on 2026-08-17.** `review --decision edit` exists to
remove a secret a user pasted into a vault file by hand, and it removes it from the vault: every
decision re-redacts, because the command writes back what it parsed rather than patching a status
line (`apps/cli/src/commands/review.ts`). What this section used to record is that the secret left
the vault and not the machine — `TransactionExecutor.backUp` writes the pre-edit file raw to
`<product home>/backups/transactions/<id>/<n>.bin` at mode `0600`, and nothing pruned it.

**`pruneBackups` now does, at both terminal phases and both terminal early-returns.** `finalized` and
`rolled_back` are equally terminal — `resumeLocked` throws on a rolled-back journal, `store.transition`
refuses every transition out of either — so from the transition onward the payload is dead bytes.
The early-returns are what make a crash between a transition and its prune recoverable rather than
permanent, and `repair` accepts a terminal phase for its own action so a user can reach them.
`<index>.bin.tmp` is swept too: `writeDurableFile` writes there before renaming, so it holds the same
bytes, and a `rollback` never re-runs `backUp` to clear it. The `<index>.json` metadata stays — it
carries `{existed, mode, atimeMs, mtimeMs}` and none of the bytes.

**A prune that fails is reported rather than raised into the caller.** `execute` has seven call sites across six commands and
all of them read a throw as "the transaction did not happen", which a retention failure is not, so
the forward path retains and `doctor`'s `transactions` check names the payload and the `repair`
command that clears it. The two terminal early-returns and the rollback transition still raise. The
rule is keyed on the prune site rather than the caller: `repair --resume <id>` on an *incomplete*
journal drives the forward loop and retains like any other command.

**The evidence is a sweep taken after the command returns, and the first version of this row cited
one that cannot fail.** `tests/security/sentinel.test.ts` did stop declaring what it does not assert
— `backups/transactions/` used to be deliberately outside its sweep, and it is now its own artifact
with its own payload floor, separate from staging so a shared floor could not be satisfied by the
staging half alone. But that suite samples from inside `afterPhase`, which is *before* the prune
runs, so it passes with `pruneBackups` disabled entirely; it proves the payload carries no secret
while it exists, not that it stops existing. `tests/security/backup-prune.test.ts` performs the
measurement this row actually claims: a secret hand-written into a capture file, `review --decision
edit`, then every file under the product home and the vault counted for it. Disabling the prune
turns it red and leaves all eleven sentinel cases green — which is how the gap was found.
**Record: `4b46545`; the request is item 2 of "Four Foundation requests" in
`git show 6145114^:docs/superpowers/ORDER.md`.**

**The staging area is still not removed, and that is a separate residual.**
`ensureTransactionDirectories` creates both the staging and the backup directory, and the executor's
only other removals are `removeOwnedTemp` on a durable-write temporary and the `unlink` of a `remove`
mutation's own target. The staged bytes are *redacted* content, so their survival costs disk rather
than a secret; the backup's did not, which is why the prune was a security fix and this is a
housekeeping one. It sits beside the former founder question `BACKLOG.md` §2 carried about
`<state>/transactions/` accumulating one permanent lock file per transaction id. **Disposition
ratified 2026-08-26, implementation pending:** DOS-P7 requires guarded terminal collection of both
staging and per-ID transaction evidence/locks under the permanent global mutation lock. An immutable
installation nonce plus monotonic allocator prevents collected IDs from reappearing; exact aggregate
caps/reservation prevent ledger exhaustion; and a guarded planless-orphan grammar removes only the
pre-journal staging/backup/lock residue the shipped executor can prove never reached target mutation,
including remove-index gaps and only the three real highest-index `writeStaged` partial states. A
pre-rename allocator temp is removable only while the old allocator identity remains authoritative;
one initial coordinator/participant/effect plan-or-journal temp is likewise removable only while the
surrounding ledger proves that no participant, target, or live transition began. Staged Foundation
mutation payloads are streamed through a 16-MiB size/hash bound rather than inheriting the 1-MiB
journal ceiling;
coordinator envelope collection removes journal → held lock → plan, leaving no lock-only crash state;
and lifecycle-owned Foundation journals retain the shipped `JSON.stringify` insertion-order encoding
instead of being silently migrated to the coordinator's canonical serializer. Before any new ID,
standalone/participant Foundation and coordinator planning computes the largest reachable exact journal
encoding, rejects above 1 MiB, binds the composite maxima, and checks every complete rewrite before
rename; a maximum legal path vector therefore cannot create unreadable residue after mutation.
The same pending DOS-P7 design removes two recovery races outside Foundation: local receive pins
`receive.unpackLimit=0` so every ref-update command produces a self-contained `index-pack` closure;
an already-up-to-date target produces no pack/index child and is admitted only after its existing real
target ref verifies at the commit. Git rollback restores exact source/destination control preimages
but preserves already-published source objects, destination pack/index files, and a newly published
`.git` root as ownership-neutral state rather than racing another Git writer with reachability-check-
then-unlink or recursive tree deletion. Launchd recovery
observes only plan/manifest/plist-derived labels through exact `gui/<uid>/<label>` service targets; it
does not use caller-context `launchctl list`, enumerate unowned prefix labels, or treat a plist hash as
launchd-observable state. The exact current/old/new/base target set detects every product-owned or exact
collision state, while the generation-bound hidden runner keeps any unrelated label inert.
Its live-only reconcile variant binds the preserved config, activation, manifest, and plist bytes but
runs only the after-files launchd effect, so recovering an unloaded expected job never needs a fake
file mutation. Git source replay separately tags the index absent/present and permits absence only for
the supported unborn empty repository, preventing an absent path from being confused with attacker-
chosen present bytes.
Each Git effect also proves before ID reservation that its largest reachable cumulative journal fits
its plan-bound 16-MiB parser ceiling. The exact process table hashes per-edge stdin/stdout/stderr byte
budgets, idle/wall/phase deadlines, counted proxying across same-PID exec, and SIGTERM→SIGKILL group
termination; the 600-second push phase is per top-level invocation, cannot reset within that process
tree, and may begin fresh only when a later invocation revalidates the exact `push_pending` plan.
Launchd separately binds the root-owned `/bin/launchctl` identity, exact sanitized argv/environment,
stream/idle/wall/transition limits, and the same terminate/reap discipline; post-intent uncertainty
retains the effect cursor for recovery rather than guessing command success. Canonical launchd
plist bytes contain only Label, ProgramArguments, StartCalendarInterval, and the two literal null-sink
paths, with exact XML/calendar encoding, so a serializer cannot smuggle a second trigger or service
behavior into an otherwise matching plan. Its process root/`HOME`/`TMPDIR` path-owner-mode-device-
inode identities are exact and hash-bound; either child must be empty before/after spawn, and any
created child is retained as recovery-required. The per-job zero-byte runtime lock is also the
process-lifetime lease acquired before any global-lock wait, so uninstall drains runners without
guessing from service absence. A removed lease is silent only when a marker, absent manifest, or exact
typed uninstall coordinator proves it. Fresh absent-manifest admission requires exact absence of
config, activation, runtime, lease, plist, and lifecycle evidence and performs no service probe;
without retained evidence no generated label is owned, and base/prefix labels grant
no authority. Git metadata inputs have numeric pre-read limits, while canonical hash-bound source/
destination shadow configs set `http.followRedirects=false` before spawn and prevent a redirect from
creating a second destination request. Persisted retries bind a path-slot shadow-config template even
without a source effect, and the one alternate-object path rejects list/C-quote syntax. Bare
destination `HEAD` state is semantic, so an empty repository binds its symbolic ref without an
invented OID. Scheduled plist argv carries the guarded product home inside its generation and ignores
ambient path overrides before reading state. Legacy Foundation staging accepts only canonical mutation
indices `0..4294967294`.
The final 2026-08-27 correction removes the remaining authority gaps. Public lifecycle preview is
allocation-free and contains no staging identity; apply must revalidate its hash before it can reserve
authority. Generated Git-config paths reject controls/line breaks. Enable alone may publish `.git`;
every later sync includes required bounded HEAD/branch reflog CAS transitions around its direct ref
publication. The in-process pack/ref reader counts compressed bytes, objects, inflation, delta depth/
work, RAM, private temp, and the inherited deadline, destroying quarantine on the first overrun before
intent. On an admitted `/bin/launchctl` (D71), Launchd bootstrap passes only the descriptor of the already-unlinked,
immutable private snapshot through inherited FD 3 and `/dev/fd/3`; the real source plist descriptor is
never inherited, closing the verify-path/swap/open race without a pathname fallback. A stale runner first
authenticates installed manifest/plist/generation evidence, then may
write only `automation_disabled` if current provenance is inactive; unowned invocations cannot write.
Finally, absent-manifest uninstall walks the complete product home and refuses every known or unknown
entry outside the exact empty/key-only grammar, so deleting the key cannot erase the last uninspected
installation evidence.
The post-final correction closes the remaining races inside those rules. Reflog postimages carry the
exact append-expanded size and are bijective with journal transitions/ref projections; pack process,
header, admitted, and unique-closure counts share the 200,001 ceiling. Launchd no longer exposes even
the verified real-plist inode to bootstrap: it copies exact bytes to a private leaf, unlinks it, passes
only FD 3, and returns every descriptor count to baseline, so rename, replacement, and in-place writes
cannot change loaded bytes. A transient pre-product `LifecycleBootstrapLockV1` linearizes concurrent
init/fresh uninstall and forces a second whole-home inventory; only its exact locked residue projects
away. The absent-key arm allocates nothing and creates nothing — two identical read-only walks and a
return — while the present-key arm creates only that leaf and deletes the redaction key under it by
rechecked `dev`/`ino` identity, never adopting or creating the installed ledger and never unlinking
the leaf or A12's bookkeeping set.
Directory-creation authority is deliberately not reconstructed after process death: an exact empty
product/state skeleton may remain, while file/control residue never gains that exception. §8.3's
residual 8 stands accepted: macOS unlinks a regular file by pathname, so the recheck narrows the
window between the observation and the unlink and cannot close it.
The same closure applies at launchd's byte boundary: only a current-frontier linked planned-byte
prefix may precede unlink, and the child inherits only the unlinked snapshot FD. An absent-manifest
uninstall crash leaves the key or no key and nothing else, because neither arm writes a journal;
§8.3's residual 9, the shape admission that decides which arm runs, stands accepted with it.
Runner installation authentication remains stage 1 and active provenance remains solely
the locked stage-2 eligibility decision.
The active opt-in-surfaces design §2.4 carries the crash-resumable protocol. This paragraph remains the
observed current-state threat record until that implementation lands, not an open decision.

**Two related residuals, one closed on 2026-08-20 and one standing, both stated where a reader
meets them.** `PlannedFileMutation.expectedBeforeHash` (`packages/core/src/transactions/types.ts`)
is now a precondition the caller read rather than one the executor computes from its own snapshot
(Track R entry R2 Task 8), and `review --decision edit` supplies it, so the read-to-execute window
that could overwrite the user's own hand edit refuses instead (the docblock above `writeCapture`
in `apps/cli/src/commands/review.ts`). `capture` supplies none and wants none: its window is
benign, because the capture id *is* the content hash. And the per-transaction lock never serializes
two writers to one *file*: production ids are per-execution, so two concurrent processes contend for
nothing at that lock, and what protects a file from a second writer is `expectedBeforeHash`. The
concurrent-edit suite's own docblock (`tests/security/concurrent-edit.test.ts`) states both halves
so a reader does not inherit the stronger belief. The `ORDER.md` section that first recorded both,
"Four Foundation requests", item 1, is in `git show 6145114^:docs/superpowers/ORDER.md`.

**Spec 2 §6.1's global-lock admission rule, amended 2026-09-04.** Under the held bootstrap lock, an
existing regular, zero-byte, single-link, owner-owned `0600` file at the exact planned
`.lifecycle.lock` path, for which no creation evidence exists for ordinal 0, is admitted as
attempt-created with lost evidence; resume records its post-acquire identity as that ordinal's
creation evidence. The bootstrap lock is what makes this sound: it makes the executor the only
writer of that path while it is held, and the admitted file carries no content, so admitting it
cannot admit anyone else's data. Every other state at that path remains a refusal: a wrong shape —
a non-empty file, a foreign owner, another mode, or a symlink — exits 5 (`securityRefusal`) because
the shape check runs before evidence is consulted, and an evidence mismatch — a present evidence
file whose identity does not match the current inode, or a cursor past ordinal 0 without matching
evidence — exits 6 (`recoveryRequired`).

### 5.10 The installation manifest

| Boundary | Mechanism | Evidence |
|---|---|---|
| A malformed or forged manifest refuses rather than being adopted | `ManifestStore.readOptional` throws `ManifestStateError` rather than returning `null` on any read or parse failure (`packages/core/src/manifest/store.ts:271-307`) | `tests/security/malformed-manifest.test.ts` — `stops capture at exit 6, and leaves the forgery for a person to look at`, and the same for `ingest` |
| A forged ownership claim cannot capture a path the product would write | `assertOwnership` refuses a `create` over a path the manifest already claims (`packages/core/src/plans/validate.ts:247-253`) | `tests/security/malformed-manifest.test.ts` — `refuses to create a capture at a path a forged manifest claims to own` |
| A note write cannot become an overwrite, whatever the manifest claims | `applyNotes` (`apps/cli/src/commands/ingest.ts`) refuses an existing target before the transaction; the one exception is a verbatim note capture's own bound note, replaced only against its capture-time hash (§5.4) | `tests/security/malformed-manifest.test.ts` — `refuses to replace a note a forged manifest claims to own`, whose failing output shows the model's note replacing the user's own words |
| Every manifest-driven read resolves the path through the guard, opens `O_NOFOLLOW`, and re-checks `dev`/`ino` after the open | `packages/core/src/manifest/drift.ts:68,83,86-95`; `assertReadable`'s contract — canonicalize the parent, append the basename verbatim — is `packages/core/src/manifest/types.ts:172-187`. The two ownership universes (`init` revert vs `uninstall`) are `foundation.md` §4 | `packages/core/src/manifest/manifest.test.ts`; `tests/e2e/foundation.test.ts:753` — `never removes a manifest artifact that lies outside the product home` |
| The manifest is never read through a followed symlink | `assertReadableArtifactPath` canonicalizes the *parent* and appends the basename verbatim, so the leaf is never resolved and core's `lstat` stays meaningful; the policy is asked **twice**, and both calls are load-bearing (`foundation.md` §5, `apps/cli/src/context.ts:375-387`) | `apps/cli/src/context.test.ts` |
| A V1 manifest is refused, never migrated, once the packaged bootstrap capability exists (Spec 2's D18 amendment) | `init` publishes reason `manifest_v1_not_migratable`, exit 4, recovery `developer-os uninstall, then archive the product home manually, then developer-os init` (D20), through `failureFrom`, before the bootstrap evidence inventory or any plan (`apps/cli/src/commands/init.ts:878-881`); the refusal's `name` is spelled so that `failureFrom` derives exactly that reason on any path (`apps/cli/src/bootstrap/report.ts:208-219`). Without the capability — production until roadmap Phase 4b — the V1 `init` path is unchanged | `apps/cli/src/commands/init.test.ts` — `refuses a shipped V1 installation once the packaged capability is available, and keeps the V1 path without it`, whose V1 home comes from the shipped V1 `init` and whose tree digest is compared across a dry and a real run; `apps/cli/src/bootstrap/report.test.ts` — `refuses a manifest the shipped V1 init produced`, which publishes the admission's rejection through `failureFrom` |
| No command but `init` runs over an interrupted or malformed bootstrap or a malformed V2 manifest, and retained evidence after a valid V2 handoff blocks nothing | dispatch routes every other command first (`apps/cli/src/main.ts:724-746`). A manifest declaring `schemaVersion: 2` must pass Core's structural V2 validation of its bytes with an unconfined owner-path admission, reading neither `config.toml` nor the Brain path (`isStructurallyValidV2Manifest` in `apps/cli/src/bootstrap/report.ts`); otherwise every command exits 6 as malformed manifest state, and `init` refuses with the same message from the same check (`apps/cli/src/commands/init.ts:882-887`). An unparseable configuration or a relocated Brain is left to `doctor` and to each command's own confined read. With a valid V2 manifest, the gate reads only `fresh-v2-init.<id>.plan.json` names and never stats a tombstone, payload or lock name (`readPlanEnvelopes` in `apps/cli/src/bootstrap/report.ts`); it refuses only a readable non-terminal journal whose plan published the current manifest. Without a version-2 manifest, it refuses on the evidence inspection `init` runs — resume, or manual archive including an unreadable namespace (`assertOrdinaryCommandAdmitted` in `apps/cli/src/bootstrap/report.ts`) — and `init` gives the same archive refusal when that inspection cannot read the namespace (`apps/cli/src/commands/init.ts:895-905`). Known limitation: a crash after manifest publication and before verification, followed by journal-slot corruption, is indistinguishable from a tampered finalized install and is admitted, as is a plan that no longer admits or a still-valid manifest no longer matching the interrupted plan | `apps/cli/src/main.test.ts` — `admits every ordinary command when retained evidence goes missing or is altered after a complete V2 handoff` (missing and symlinked tombstones, a symlink inside a retained directory, a symlinked bootstrap lock, emptied, oversized and replaced slots); `refuses every command, and init, when a planted manifest declaring schema version 2 fails strict validation`; `refuses every command, and init, when a shipped V2 manifest is altered into an invalid one`; `does not refuse a valid V2 install as a malformed manifest when its configuration is unparseable or its Brain moved`; `refuses every non-init command with init's own archive guidance when an interrupted envelope's plan or slot stops matching`; `refuses only genuine bootstrap residue in a home where bootstrap never ran, with the guidance init gives`; `refuses every non-init command while a fresh V2 envelope is non-terminal, and none after init completes the handoff`; `tests/security/network.test.ts` — `spawn nothing when every non-init command refuses a non-terminal envelope` |
| Spec 1 authority is admitted only over a structurally complete installed V2 home, never a partial one | `admitInstalledV2Home` (`apps/cli/src/lifecycle/admission.ts`) replaced `admitV2Handoff`, which plan 1a Task 17 deleted as a fresh-install snapshot. It requires `validateManifestV2` under the confined admission context, then every lifecycle reservation row by exact path and mode, an exact install nonce, a canonical allocator whose nonce agrees, an owner `0600` zero-byte single-link global lock, and three owner `0700` journal roots. It reads no bootstrap plan, no drift, no activation record and no closure, so a drifted bundle file, a missing or altered retained tombstone, a missing schema file and a planted lifecycle plan all still admit — drift and §2.4 closure own those. Each refusal carries its own reason: `manifest_absent` exit 2, `manifest_v1_not_migratable` exit 4, and `manifest_invalid`, `reservations_incomplete`, `nonce_invalid`, `allocator_invalid`, `nonce_allocator_mismatch`, `global_lock_invalid`, `journal_root_invalid` exit 6. There is no catch-all, and a `TypeError`, `RangeError` or `ReferenceError` propagates unchanged rather than publishing as a refusal. Core's manifest validators hold the same line (NEW-92): `call()` in `packages/core/src/manifest/v2.ts` rethrows those three classes, `admitOwnerPath` is called outside it because it refuses by return value, `validateManifestBytes` catches only the canonical decode, and `isStructurallyValidV2Manifest` in `apps/cli/src/bootstrap/report.ts` reads only a `ManifestStateError` as malformed, so a defect in an injected admission callback never publishes as a corrupt manifest on a healthy home | `apps/cli/src/lifecycle/admission.v2.test.ts` — `admits a fresh V2 home and binds to no bootstrap plan, drift or retained evidence`, `keeps the Spec 2 §6.4 handoff set as a fact of a fresh init`, the per-member refusal table asserting each reason and exit code, `refuses a directory at %s as %s instead of treating it as absent (NEW-82)`, and `lets a programming error escape instead of relabelling it (NEW-82)`; `packages/core/src/manifest/v2.test.ts` — `lets a defect in an admission callback escape instead of reading it as a malformed manifest (NEW-92)`; `apps/cli/src/bootstrap/report.defect.test.ts` — `V2 manifest routing lets a validator defect escape (NEW-92)` |

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
| Discovery runs one absolute helper and gives it nothing but a search path | `/usr/bin/which`, spawned with `env: { PATH: <search path> }` and nothing else (`packages/platform-macos/src/macos.ts:18,229`) | `tests/security/network.test.ts` — every classified spawn asserted absolute, and the classification asserted total in both directions (`tests/security/network.test.ts:237-251`) |
| A discovered path that is not usable is refused rather than reported | must be absolute, free of every control character, and must not carry a redaction marker — because the runner redacts its own output and a high-entropy path segment comes back rewritten but still absolute (`packages/platform-macos/src/macos.ts:135-145`) | `packages/platform-macos/src/macos.test.ts` |
| An empty `PATH` does not become an unbounded search | a fixed fallback of the four system directories (`packages/platform-macos/src/macos.ts:21,185-186`) | `packages/platform-macos/src/macos.test.ts` |
| The *platform boundary* never executes what it found | `AgentDiscovery.version` is permanently `null` there, because determining it requires running the binary (`packages/platform-macos/src/types.ts:19-24`, `foundation.md` §7). **A layer above does execute it**: `discoverCli` runs `<exe> --version` (`packages/security/src/cli.ts:54-80`) and `doctor` calls it on every invocation, which retired the Foundation-era invariant — `claude-adapter.md` §9 residual 10 records exactly that | `packages/platform-macos/src/macos.test.ts`; `tests/security/network.test.ts` classifies the version probe rather than forbidding it |
| A hostile entry for one vendor does not cost the user the other | a discovery that refuses is treated as "not this one" and the next vendor is tried (`apps/cli/src/commands/ingest.ts:482-491`) | `apps/cli/src/commands/ingest.test.ts` |
| **The executed binary is vouched for by something** | `assertTrustedExecutable` resolves the path one component at a time, refuses anything that is not a regular file, and checks every real directory the resolution enters — including the one holding each intermediate link — refusing an owner that is neither the current uid nor root, any other-writable directory, and a group-writable one the current uid does not own (`packages/platform-macos/src/macos.ts:350`) | `packages/platform-macos/src/macos.test.ts`; `tests/helpers/temp-home.ts` runs the real check against every planted binary |

**A gap found while writing this document — paid on 2026-08-17, and this section read "absent" for
a day afterwards.** `packages/platform-macos/src/types.ts:13-20` documented `executablePath` as
untrusted and said "anything that executes it owes that check first", and nothing paid it: DOS-P6 was
the first thing in this product to execute it, `selectVendor` handed `discovery.executablePath`
straight to `invokeVendor`, and `capture` joined on 2026-08-15 when Task 17's Claude detection made
`discoverSourceAgent`'s probe path live — the same unchecked execution on the product's most
frequently run command, triggered by a `CLAUDECODE=1` any wrapper or CI step can export.

**The trigger surface doubled on 2026-08-20 and got cheaper.** NEW-21 added Codex's detection row, so
`capture` now spawns a version probe inside a Codex session too — and that row matches on
**presence**, so `CODEX_THREAD_ID=anything` arms it where Claude's row at least wants the literal `1`.
Neither was ever a privilege an attacker had to earn.

**`capture`'s probe is pinned and rechecked (`BACKLOG.md` §1 NEW-46, closed 2026-09-28; D72 Q2-A with the D73
addendum).** `discoverSourceAgent` resolves the `PATH`-selected binary once to its real path through
`admitOwnedExecutable` (`apps/cli/src/pinned-executable.ts`, shared with the Codex refresh): the target
must be a regular file with owner-execute, owned by the user or root, with no group/other write and no
setuid, setgid or sticky bit, and every ancestor of the real path up to `/` a directory owned by the
user or root with no group/other write — stricter than `assertTrustedExecutable`, which accepts a
group-writable directory the user owns. It pins `{dev, ino, mode, size, ctimeNs}` rather than a
hash, so a vendor binary larger than `inspectSystemPath`'s 64 MiB bound is never read, and the runner
re-admits the real path and compares every pinned field immediately before the spawn, which goes to
the real path rather than the link. Any content or metadata write moves `ctime`, so a swap or in-place
rewrite between resolve and spawn records `unknown` and spawns nothing. The Codex refresh keeps its
`sha256` pin (D72).

**The residual, stated because a future reader will rely on this paragraph.** A binary the *same uid*
planted in a directory chain only that uid (or root) can write, reached through a prepended `PATH`,
still passes: it is user-owned, `0755`, and stable between resolve and spawn. Anyone who can export
`CODEX_THREAD_ID` into a session can usually export `PATH` into the same one, and such an attacker
already runs code as the user. What NEW-46 closed is a binary in a group-writable directory and a
swap between check and spawn; the probe still passes `--version` and nothing else. The residual is
`BACKLOG.md` NEW-121.

**`assertTrustedExecutable` is the check the other two executors pay** before spawning:
`apps/cli/src/commands/doctor.ts:479` and `apps/cli/src/commands/ingest.ts:579` — `doctor` was a
third executor paying nothing while the first
version of this fix claimed a third could not arrive. The rule, decided by the founder rather than
chosen here (BACKLOG NEW-15): **resolve, then check.** The binary is canonicalized and the resolved
target must be a regular file. The declared path is resolved **one component at a time** with
`readlink`, as the kernel resolves it, and every real directory that resolution enters — including the
directory holding each intermediate link, whether the link names a file or a directory component — is
then refused if its owner is neither the current uid nor root, if it is other-writable with or without
a sticky bit, or if it is group-writable and not owned by the current uid. `..` climbs from the real
directory reached so far, and more than 32 hops (macOS `MAXSYMLINKS`) is a refusal.

**The middle-hop bypass is closed (`BACKLOG.md` §1 NEW-32).** The previous version walked three
ancestor chains — the resolved target's, the declared directory's, and that directory canonicalized —
so `<trusted>/claude` → `<attacker>/hop` → `/bin/ls` passed every check: `<attacker>` was on none of
them. The stepwise walk enters `<attacker>` and refuses it.

**Two residuals are open:**

1. **macOS ACLs are invisible to `stat().mode`.** A directory can be `0755` and writable by another
   user through an ACL entry, so the mode check is a floor rather than a proof.
2. **Check-then-use (`BACKLOG.md` §1 NEW-35).** The target is stat'd and then executed by path;
   closing it needs an exec-by-descriptor this runtime does not offer. Accepted by the founder when
   the rule was decided.

**`NEW-33` is not on that list**, and putting it there was the other half of the error: a root-owned
group-writable directory being *refused* makes a `claude` under some `/usr/local` layouts fail. That
is a false refusal — a usability cost and the founder's call — not a weakening of the boundary.

What this does **not** mean: it is not a privilege escalation. The binary runs as the user, from the
user's own `PATH`, and anyone who can plant it there can already run code as that user. What it costs
is that Developer OS hands such a binary a prompt built from the user's captures and read access to
the user's vault, and reports the result as its own. **Record: `BACKLOG.md` §1 NEW-15**, registered when this document landed and closed 2026-08-17. The nearest record before
it was `claude-adapter.md` §9 residual 10, which notes that `doctor` executes the discovered binary
and retires the Foundation-era invariant — it records the execution and **not** the missing check,
which is why NEW-15 existed rather than a pointer to it. Stated here because the brief names `PATH` as
a boundary this document must carry, and carrying it accurately means saying which half is enforced.

### 5.12 Configuration

`config.toml` is a file the user edits by hand, and a parse of it happens on every `doctor`, `status`
and `brain` run. **Those runs do not all reach it the same way**, and the difference is a boundary
rather than a detail — see the last row.

| Boundary | Mechanism | Evidence |
|---|---|---|
| Configuration is read through the protected-path policy, never with a bare `readFile` | the guarded reader canonicalizes, refuses a protected name, opens `O_NOFOLLOW` and re-checks `dev`/`ino` after the open (`packages/security/src/protected-paths.ts:103-146`), reached through `context.guards.readText` (`apps/cli/src/context.ts:424-427`, `apps/cli/src/config-file.ts:52`) | `packages/security/src/protected-paths.test.ts:75` — `allows the Developer OS configuration path`; `:174` — `reads from the opened safe descriptor after the original alias is swapped` |
| Absence is distinguished from a refusal | `lstat` is checked *first*, because the guarded reader reports a missing file as a security refusal — the right answer for a read and the wrong one for "this machine has never been initialized" (`apps/cli/src/config-file.ts:45-50`) | `apps/cli/src/commands/doctor.test.ts` |
| An unknown key is refused rather than ignored | `configSchema` is `.strict()`, as is every nested table (`packages/core/src/config/loader.ts:403-429`, `:140-158,181-215`) — so a typo'd or injected key fails the load instead of being silently dropped | `packages/core/src/config/config.test.ts` |
| A parse failure never prints the file it failed on — **through `readConfigFile`** | a `loadConfig` throw becomes a content-free `ConfigurationError`, because `smol-toml` embeds three raw source lines in `TomlError.message` and propagating it printed whatever was read into `status`, `doctor` and their `--json` (`apps/cli/src/config-file.ts:15-22,54-58`). Redaction is deliberately not the only thing standing on this path | `tests/e2e/foundation.test.ts:1355` — `never quotes the configuration it failed to parse` |
| The same boundary on a `brain` run | **holds.** `readConfig` reads through `readConfigFile` (`apps/cli/src/commands/brain.ts:127`) and rethrows `ConfigurationError` unmodified, so a `TomlError` never reaches `redactDiagnostic`. NEW-17, closed | `apps/cli/src/commands/brain.test.ts` |
| Telemetry cannot be switched on by editing the file | the key is `z.literal(false)` (`packages/core/src/config/loader.ts:427`), so `telemetry = true` fails the load | `packages/core/src/config/config.test.ts` |

**Pending DOS-P7 command boundary, ratified 2026-08-27:** `config get/set` will enumerate exact
readable/mutable keys, accept one per-key `CanonicalJsonV1` value, allow `null` only for whole optional
sections, and emit typed canonical results. Lifecycle/schema/telemetry fields remain non-mutable, and
redaction reads expose only the pattern count. Values and pattern text never appear in parse errors.
The active opt-in-surfaces design §2.2 is normative; implementation has not landed. **Shipped by plan
1a Task 20 for the `get`/`set` verbs themselves** — §5.13 below records the mutation boundary it runs
through; `git enable`/`automation enable` shipped with plan 1b (§5.15).

**What configuration carries that it did not, and §5.7 explains why it matters:** an optional
`[redaction]` table, added on 2026-08-17 when NEW-16 closed, so the `user-pattern` class is
configurable — this paragraph asserted the opposite for a day after the wiring landed, in a
section a reader reaches *before* §5.7. **And one thing it decides that
nothing else re-checks:** `brainPath` is an absolute path from the file, and `reindex` does not call
`assertRootsAnchored` where `init` does — so a hand-edited vault path outside the home is refused by
one command and accepted by the other. That is `brain.md` §4 residual 5, owned by DOS-P7.

### 5.13 The lifecycle kernel's mutation gate and global lock (Spec 1a)

Plan 1a shipped the gate every V2 Foundation mutation passes through and the lock it runs under.
`foundation.md` §10 has the full contract; this records the boundary each piece defends.

| Boundary | Mechanism | Evidence |
|---|---|---|
| The global lock at `state/.lifecycle.lock` is never created outside fresh `init` | the rule and every class enforcing it are stated together: `packages/core/src/lifecycle/locks.ts:1-101`. `MacOsStableLockProvider.acquireExisting` opens with `O_RDWR \| O_NOFOLLOW` and nothing else — no `O_CREAT` anywhere in the class (`packages/platform-macos/src/stable-lock.ts:25,90-140`). The creating provider, `MacOsTransactionLockProvider` (`packages/platform-macos/src/transaction-lock.ts`), is wired as `transactionLocks` in `createProductionContext` (`apps/cli/src/context.ts`), and the one call site that uses it to create the global lock is the fresh-`init` executor's `acquireLifecycleLock` (`apps/cli/src/bootstrap/executor.ts`); every lifecycle service reached after install acquires the same path only through `MacOsStableLockProvider` | `apps/cli/src/lifecycle/mutation-gate.v2.test.ts` — `runs a V2 capture under the global lock with one allocated transaction ID` asserts the acquire event names `MacOsStableLockProvider`'s path; `apps/cli/src/lifecycle/admission.v2.test.ts` — the per-member refusal table pins `global_lock_invalid` rather than creation |
| An absent or busy global lock refuses exit 6 rather than waiting or creating one | `LifecycleLockMissingError`/`LifecycleLockBusyError`, both `code: EXIT_CODES.recoveryRequired` (`packages/core/src/lifecycle/locks.ts:21-44`); `withLifecycleMutation` acquires with `acquireExisting` before anything else runs, unless a scheduled handler hands it the runner's held lock, whose `dev`/`ino` it checks against the lock path instead (`apps/cli/src/lifecycle/mutation-gate.ts`) | `apps/cli/src/lifecycle/mutation-gate.v2.test.ts` — `refuses interactive contention on the global lock with exit 6 and writes nothing`, which also proves the inventory digest is unchanged |
| Every gated mutator reserves capacity and an ID only after the ledger is proven `clear` (or the one journal being resolved) | `withLifecycleMutation`'s order — re-admission and lock-identity agreement, `requireLifecycleStagingRoot`, `LifecycleRecoveryService.recover`, `requireResolvedClosure`, then `assertLifecycleCapacity` plus `reserveLifecycleIdBlock(1)` inside `allocateStandaloneFoundationId` — is one function (`withLifecycleMutation`, `apps/cli/src/lifecycle/mutation-gate.ts`); the closure gate itself is `requireResolvedClosure` in the same file, which admits exactly one exception: the sole non-terminal standalone journal a `repair` call is resolving | `apps/cli/src/lifecycle/mutation-gate.v2.test.ts` — `names repair as the way out of a non-terminal standalone journal, and repair resolves it`; `a malformed leaf in state/lifecycle-journals refuses exit 6 with nothing written` |
| A mutation authority cannot be used after its lock is released | `allocateStandaloneFoundationId` checks a `live` flag before allocating and throws `lifecycle_mutation_authority_released` (exit 6) if the caller re-enters after `withLifecycleMutation`'s `finally` released the lock (`apps/cli/src/lifecycle/mutation-gate.ts`) | argued by inspection, not driven by a fixture — plan 1a's deferred fix list (D36) carried this as an open item: `git show 082e098:docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md` |
| The redaction key is secret-opaque everywhere plan 1a's lifecycle code touches it | `observeSecretOpaqueKey` only `open`s (`O_NOFOLLOW \| O_NONBLOCK`) and `fstat`s the descriptor, then closes it — no `read` call in the function (`apps/cli/src/lifecycle/redaction-key.ts:200-227`); `unlinkSecretOpaqueKey` `lstat`s the pathname, compares `dev`/`ino`/`size` against the prior observation, and `unlink`s by that checked identity, again with no content read (`apps/cli/src/lifecycle/redaction-key.ts:235-255`); the uninstall `K` adapter moves the key by `link` then `unlink`, never `renameNoReplace`, specifically because the guarded rename hashes its source and §6 forbids that for this file (`apps/cli/src/lifecycle/redaction-key.ts:257-408`, the doc comment at `:257-262` states the rule the three functions implement) | `apps/cli/src/lifecycle/absent-manifest-uninstall.v2.test.ts` — `spyOnKeyContentReads` wraps `node:fs/promises` `readFile` and `FileHandle.read` and asserts zero calls across a full `key_present` deletion |
| §8.3's residuals 8 and 9 — the check-then-unlink window and the shape admission that decides which uninstall arm runs — are accepted, not closed, and this file already says so in one place | see the paragraph above at "Directory-creation authority is deliberately not reconstructed" (`docs/architecture/threat-model.md:622-629`): the identity recheck narrows the window between observation and unlink but cannot close it, because macOS unlinks a regular file by pathname; the shape admission stands accepted alongside it. Plan 1a's own deferred fix list (`git show 082e098:` of that plan) records the same limit in the implementer's own words: the check-then-unlink window "is pinned only at the unit level … cannot prove a closed window" | `apps/cli/src/lifecycle/absent-manifest-uninstall.test.ts` proves the detected case (an identity change between observation and unlink) refuses and preserves everything; it does not prove the window closed |

### 5.14 Instruction artifacts steer every agent session (A12)

**Added 2026-09-22 (A12)**, from §11.4 of the A12 spec, retired 2026-09-29
(`git show 59a6be11:docs/superpowers/specs/2026-09-22-developer-os-instruction-artifacts-design.md`);
the instruction contract is `foundation.md` §12. Installed instructions (skills, agents, commands, rules, scoped rules, output styles and the
marked blocks in `H/.claude/CLAUDE.md` and `C/AGENTS.md`) change what both vendors' agents do in
every session on the machine. Their integrity therefore equals the integrity of their sources, and
this entry defends the sources and the write paths, not the text.

| Boundary | Mechanism | Evidence |
|---|---|---|
| Defaults are exactly as trustworthy as the admitted release, and under D47 that release is an **unsigned local build**: a recorded, reported downgrade, never a silent one | the trust state carries `trust: "unsigned-local"` (`packages/core/src/update/release.ts:185`); `advanceReleaseTrust` and `admitReleaseAgainstTrust` throw `ReleaseUnsignedLocalError` for it (`packages/core/src/update/release.ts:494,512`), so it is never an update source or rollback target; `doctor` warns on every run (`apps/cli/src/commands/doctor.ts:1217-1225`); only `init --local-release <dir>` admits one, never by fallback | `packages/core/src/update/release.test.ts` — `refuses an unsigned-local state as an update source or rollback target`; `apps/cli/src/commands/doctor.test.ts` — `warns on every run when the home was installed from an unsigned local build` |
| User overrides under `<product-home>/instructions/<vendor>/` are trusted as the user's own text, but read only as owned, single-link regular files within bounds | `readUserFile` checks type, `nlink`, owner uid, opens `O_NOFOLLOW \| O_NONBLOCK` and re-checks identity after the read (`apps/cli/src/instructions/sources.ts:220-248`); sizes pass `assertInstructionArtifactBounds` (`apps/cli/src/instructions/sources.ts:114`) | `apps/cli/src/instructions/sources.test.ts` — `refuses a symlinked file`, `refuses a symlinked skill directory`, `refuses a symlinked category directory` |
| Instructions are written only to the closed, owner-bound `foundation.md` §12.5 paths, never to a general vendor root | `isVendorAuthorized` admits exact paths per owner and arm, refusing `.`/`..` segments (`apps/cli/src/bootstrap/admission.ts:107`) | `apps/cli/src/bootstrap/admission.test.ts` — the `foundation.md §12.5 closed vendor authorization` table: `admits its owner and arm`, `refuses the other owner`, `refuses a wrong arm`, `is refused when vendors is null` |
| A symlinked target (including a dotfiles-managed `CLAUDE.md` or `AGENTS.md`) is refused rather than written through | `instruction_target_symlinked`, exit 5 (`apps/cli/src/instructions/attach.ts:263-269`) | `apps/cli/src/instructions/attach.test.ts` — `refuses a symlink at any component of a target, including linked vendor files, with exit 5` |
| Codex registration runs the vendor CLI with no inherited credentials and against the same Codex home the product writes | argv arrays only, `env: { CODEX_HOME: C }` (`apps/cli/src/instructions/codex-registration.ts:90`) | `apps/cli/src/instructions/codex-registration.test.ts` — `passes argv arrays only and env exactly { CODEX_HOME: C } to every call` |

- **What the product cannot defend.** A process running with the user's privileges can rewrite the
  local build or the overrides before the next `init`, and the product installs what it then reads.
  This is §2's existing adversary 4 (a hostile process with write access), not a new boundary.
- **Third-party skills are not vendored (D51, superseding the spec's "vendored skills" bullet).**
  `react-best-practices`, `claudeception`, `excalidraw-diagram` and the `research*` family ship in no
  default; `claude-adapter.md` §16 links their upstream originals. A user who installs one, or keeps
  a modified copy as an override, brings prompt text from outside this repository under the override
  row above: trusted as the user's own, never reviewed by the product. Every default that does ship
  is reviewed as content at every change (`tests/repository/instruction-defaults.test.ts`).

### 5.15 Git transport, launchd authority and the runner lease (Spec 1b)

**Added 2026-09-26**, carrying plan 1b's surviving decisions (Tasks 1–18 and 20; the plan's task
bodies are in `git show d2f18b4:docs/superpowers/plans/2026-09-23-developer-os-opt-in-surfaces-1b.md`).
Plan 1b gave the product its first process, local-socket and scheduling authority beyond the vendor
CLI. All of it is opt-in, and `foundation.md` §10 has the shipped contract; this records what each
piece defends. Spec 1 §4 and §5 remain normative for every literal.

| Boundary | Mechanism | Evidence |
|---|---|---|
| Schema-valid Git or automation configuration is not authority | operation needs the matching `LifecycleActivationRecordV1` arm plus a clear closure; `config set` refuses every `git.*`/`automation.*` key `config_key_read_only`. Disabled Git spawns no Git process and opens nothing; disabled automation writes no plist and starts nothing | `apps/cli/src/commands/git/git.v2.test.ts` (`keeps a forged config.toml lifecycle with no activation arm inert`, `is inert while disabled: status and sync spawn no Git and open no network`); `tests/security/network.test.ts` (`git status`, `git sync` while disabled, `automation status`: zero spawns) |
| Only the standard fixed-path Git, `ssh` and `launchctl` run, and a host that fails admission refuses before any live authority (**amended 2026-09-28, D71; NEW-113's code**) | the `darwin` rows of the per-platform table (`/usr/bin/git`, `/usr/bin/git-receive-pack`, `/usr/bin/ssh`, `/bin/launchctl`; never `PATH`, `DEVELOPER_DIR` or `xcrun`) are admitted by `posix_root_owned` (regular file, uid `0`, no group/other write, no setuid/setgid, root-owned non-writable ancestors), the Git and macOS version floors (2.54.0 / Apple Git-157, `ProductVersion >= 26.6.2`) and the capability probe; no build, Xcode version or binary hash is compared. The admitted `dev`/`ino`/`size`/`sha256` are rechecked before every real exec — synchronously in `GitProcessSupervisor`, through `recheckLaunchdHost` for launchd — and a change inside one invocation refuses. `git status` and `automation status` report the refusal without spawning. A host below the floor, or a `launchctl` changed under a non-terminal effect journal (`launchctlIdentityHash`), names the manual `launchctl bootout gui/<uid>/<label>` per installed label (`refuseUnsupportedLaunchd`, Spec 1 residual 10). Accepted: the Git tree the shim executes is not admitted (Spec 1 residuals 13, 14) | `packages/security/src/system-executables.test.ts`, `packages/security/src/git/distribution.test.ts`, `packages/platform-macos/src/launchd/process-table.test.ts`; the real executables only in `*.pinned-host.test.ts`, run by `npm run test:pinned-host` on an admitted host, never by hosted CI |
| Git runs as a closed process graph with no shell, no inherited environment and one deadline | `GitProcessSupervisor` (`packages/security/src/git/supervisor.ts`) admits each process against a `GitProcessPermitV1` from the closed process table (`apple-git-process-v2`) and one inherited 600-second push phase; repository access goes through sanitized shadows and no-shell gateways (`packages/security/src/git/shadow.ts`, `gateways.ts`), and received packs pass the bounded reader before any intent (`pack-reader.ts`, `local-receive.ts`) | `packages/security/src/git/*.test.ts`; `tests/integration/git/lifecycle.test.ts` |
| Only the local/file transport is traced; HTTPS and SSH refuse | `createGitService` refuses a non-local remote `unsupported_git_distribution`, exit 5, and `admitGitExecutables` refuses any transport but `local`, until a founder-owned disposable remote records those traces (D59 Q4-A, kept by D71 Q4; `git_remote_https` has no table row) | a review claim over the transport check in `apps/cli/src/commands/git/service.ts`: no test drives an HTTPS or SSH remote into it |
| The Git gateway's socket stays on the host | the Git runtime's gateway server listens on a Unix-domain socket inside its private quarantine directory, and the trampoline connects only to that path | `tests/security/network.test.ts` classifies exactly `apps/cli/src/commands/git/runtime.ts` as a local socket server and the `gateways.ts` trampoline as a local socket client; a TCP port, a second call or an `https` import reddens it |
| A push that fails is retried, never re-planned | the pending push plan (`PersistedGitPushPlanV1`) is written before any network call; a failed push leaves a `retry_only` closure and the next `git sync` retries only that plan. Fetch, pull, merge, rebase, checkout, force-push and history rewriting are not implemented | `apps/cli/src/commands/git/git.v2.test.ts` (`preserves the prior sync record when push fails and retries only the persisted push`) |
| launchd bootstraps only bytes the product planned | the plist is bootstrapped from an already-unlinked snapshot descriptor (`LaunchdSnapshotBootstrapper`, `packages/platform-macos/src/launchd/snapshot.ts`); install, replace, keep and remove are journaled launchd effects with intent before mutation and observation before the cursor moves (`packages/platform-macos/src/launchd/effects.ts`); raw `launchctl` output is byte-counted and discarded | `packages/platform-macos/src/launchd/snapshot.test.ts`, `effects.test.ts`; `tests/integration/launchd/fd3-bootstrap.pinned-host.test.ts` on an admitted host |
| A scheduled run cannot outlive uninstall or collide with an interactive mutation | each job holds its `AutomationRunnerLeaseV1` for its lifetime and rechecks the `state/uninstalling.json` marker; uninstall drains all four leases with no global lock held. A handler reuses the global lock its runner holds after a `dev`/`ino` check instead of taking a second one; the runner waits at most `SCHEDULED_GLOBAL_LOCK_WAIT_MS` and otherwise exits silently; an interactive command meeting a scheduled holder refuses exit 6 | `apps/cli/src/commands/automation/runner.test.ts`, `runner.v2.test.ts`; `apps/cli/src/lifecycle/mutation-gate.test.ts` (`refuses a home that is not V2 before any work, and never releases the borrowed lock`) |
| A scheduled run writes only bounded, redacted records | status and the ten log slots are redacted before they are bounded (`redactScheduledData`, `boundedLogRecord`, `apps/cli/src/lifecycle/runtime-records.ts`); no scheduled job invokes a model or a vendor CLI, and `import` and `ingest` are never scheduled (D47) | `apps/cli/src/commands/automation/handlers.test.ts` |

- **What stays open.** The trampoline's reported `ppid` is not bound to the parent PID in the permit,
  because the permit carries no PIDs; a real push through `/usr/bin/git` after the I1 fix, `git
  receive-pack` through the shim, and the hostile config and redirect cases wait for NEW-113's Task 5
  on a disposable account (`BACKLOG.md` NEW-113 and §6, Phase 9).

### 5.16 Release trust, update and rollback (Spec 2)

**Added 2026-09-28** by NEW-110 Task 12 (D72). `update` is the product's first network client and
its first code that replaces its own executable, so it is the one place the local-first boundary
is crossed on purpose. `foundation.md` §11 has the shipped contract; this records what each piece
defends. Spec 2 stays normative for every literal.

| Boundary | Mechanism | Evidence |
|---|---|---|
| Only `update` plan and apply reach a network | the release transport (`packages/security/src/update/transport.ts`) is the only network module, and only `apps/cli/src/update/context.ts` composes it; rollback, recovery, `init` and uninstall make zero release requests | `tests/repository/check.ts` (`inspectReleaseAuthoritySurfaces`, run by every `npm run lint`) and its cases in `tests/repository/check.test.ts`; `tests/security/network.test.ts` (`previews a rollback with the FD 3 trust, transport, scratch and planner ports all unreachable`); `tests/e2e/release-update.test.ts` counts transport requests across rollback and uninstall |
| The transport reaches only fixed origins | two fixed metadata locators from the launcher's FD 3 handoff; assets only under a delegated origin, at most one redirect re-validated as plain HTTPS without query, userinfo or port; an exact signed length and SHA-256 per asset; no proxy, credential or caller header; one 15-minute attempt deadline | `packages/security/src/update/transport.test.ts`; `tests/integration/update/signature-transport.test.ts` drives the same bytes through the production transport for both architectures |
| A release is admitted only through the signed chain, and trust never reverses | root-signed delegation of one release key, release-key-signed index, per-architecture bundle manifest and archive hashes; delegation, index and release sequences are high watermarks that compensation and rollback leave advanced | `tests/integration/update/signature-transport.test.ts` (forged index, replay, substituted manifest, the other architecture's archive); `tests/integration/update/recovery.test.ts` (a rejected verifier leaves trust advanced; rollback leaves it byte-identical) |
| An archive is admitted entry by entry before any byte is used | one checksummed Zstandard frame of an exact ustar stream in manifest order, root-owned headers, no links or specials, exact sizes, modes and hashes | `packages/security/src/update/archive.test.ts`; `tests/integration/update/archive-planner.test.ts` for both architectures' bundles |
| The target planner cannot read, write or reach anything | a compiled graph with no filesystem, network, process, environment, clock, randomness, native or dynamic import; the request carries tokens, never roots; its result is bound to the request by transcript hashes before allocation | the planner-graph gate in `tests/repository/check.ts`; `tests/integration/update/archive-planner.test.ts` (request and result binding); `tests/security/sentinel.test.ts` (a planted Brain sentinel never reaches the planner wire, a result, or the product home) |
| A killed update or rollback resumes in its persisted direction | the construction envelope and the V2 coordinator journal are the only authority; the target verifier's durable success is the one point of no return; recovery reads no network and runs no planner | `tests/integration/update/recovery.test.ts` sweeps every durable mutation of apply, rollback and a verifier-rejected update; `tests/security/interruption.test.ts` (`an update --apply interrupted, then run again`) |
| Nothing is published through a link | every publication creates or reopens its target no-follow and checks identity from construction evidence (D72 P1, P2, P9) | `tests/security/symlink-escape.test.ts` (`a symlinked release directory met by update --apply`; the A8 exact set of symlink-kind producers) |
| The Codex refresh cannot be redirected | the pinned `codex` real path with its identity rechecked before spawn, exactly `CODEX_HOME` and `TMPDIR`, closed argv, no marketplace change; an unregistered or stale plugin refuses before allocation | `apps/cli/src/update/codex-refresh.test.ts`; `tests/integration/update/archive-planner.test.ts` (the Codex rows) |

- **What stays open.** The production fallback handoff and the real release roots arrive with
  Task 11b, and real signed artifacts with A16; until then `update --apply` refuses exit 4 outside
  the synthetic fixture. The target verifier runs the signed bundle's own code and is not
  OS-sandboxed (Spec 2 §13.3 residual 6). A home with adapter instruction artifacts has no update
  proof yet: the synthetic lifecycle installs the core owner only.

---

## 6. Statuses, and the invariant under every failure

**A failure at any point leaves the capture `accepted`, never `ingested`, and always retryable —
unless its notes are already in the vault, in which case it is left at `staging` and says so.**
That is the gate's own wording in `BACKLOG.md` §3 plus the one qualification the ladder forces, and
it holds by refusal (`apps/cli/src/commands/ingest.ts:1756-1795`) and by interruption
(`tests/security/interruption.test.ts`, 52 cases by static count, not collected — 42 driven interruptions (six targets at seven phases), the derived coverage case and the stranding floor, seven `brain refactor` phases, and the refactor's own coverage case). `accepted` beside this run's own notes
would be the one answer that is *not* retryable: `applyNotes` refuses an occupied path, so the next
run would refuse the capture permanently.

**It holds with one stated residual, accepted rather than closed.** `ingest` runs as four transactions
per capture plus a compensating rollback — `ingest-stage`, `ingest-apply`, `ingest-reindex`,
`ingest-ingested`, `ingest-rollback` (`apps/cli/src/commands/ingest.ts:274-280`) — because
`BrainService.reindex()` reads the vault and cannot run until the apply has finalized, and because
`validateChangePlan` grants ownership from a manifest a capture is deliberately absent from. **A crash
after the apply has written its mutations leaves a capture at `staging` with its notes already
applied** (`apps/cli/src/commands/ingest.ts:1648-1654,1726-1736`) — from the moment they are written,
not from the moment the transaction finalizes, which is the distinction the fix round after Task 19's
review corrected: `verifyDesired` runs after the bytes are on disk and can raise, and a rollback to
`accepted` there is what makes the residual unrecoverable rather than inert. It is inert — the next
run selects only `accepted` captures and cannot double-apply — and recoverable by `repair` plus a
hand edit. This
corrects design spec §6.1's headline sentence; the founder ratified it on 2026-08-15, and its row is §8
of `git show d72287a^:docs/superpowers/BACKLOG.md` (`knowledge-pipeline.md` §5, four transactions per
capture).

**One product gap at the same seam, closed 2026-08-20 by Track R entry R2 Task 9.**
`applyReviewDecision` permitted a decision only from `quarantined`, so nothing moved a capture from
`accepted` to `rejected`: a user who accepted a capture and changed their mind, or whose capture
refused ingest deterministically, had only a hand edit of the file's frontmatter — which is what both
of `ingest`'s recovery strings told them to do. `LEGAL_FROM`
(`packages/brain/src/review/decide.ts:81`) is the table now, spec §5.5 carries the amendment, and
both strings name the verb. What remains is that `review`'s listing shows `quarantined` only, so the
change-of-mind path still needs an id the user already holds.

---

## 7. Capabilities that are absent by construction

Stated as capabilities that are *absent*, because "not implemented yet" and "must not exist here"
look identical from outside and are not the same thing.

| Absent | Mechanism | Evidence |
|---|---|---|
| **Network outside `update`** | no HTTP client, no socket, no DNS anywhere in the product but the release transport, which only `update` plan and apply compose (§5.16, amended 2026-09-28). The source gate `GLOBAL_FETCH` in `tests/repository/check.ts` refuses a bare, a `globalThis`/`self`/`window`, an optional-chained and a `.call`/`.apply` call of `fetch` outside the transport. **Residual (declared 2026-09-28, NEW-110 re-review):** bracket access such as `globalThis["fetch"](url)` passes that gate, because it reads code with string literals erased | `tests/e2e/foundation.test.ts:1241` — `ships no network capability`. It scans every compiled non-test module in **every workspace discovered under `apps/` and `packages/`** (`:1252-1264`) — discovered, not written down, which is the whole of the fix for the closed NEW-1 — and asserts non-empty **per workspace** rather than over the total (`:1314-1316`), because a floor over the sum is satisfied by one populated directory |
| **Any outbound call but one** | the vendor agent CLI during ingest and, once Git is enabled, the admitted `/usr/bin/git` for `git sync` (§5.15); nothing else | `tests/security/network.test.ts` — the spawn list is **classified, not forbidden**: the unclassified set is asserted empty and the classified set asserted non-empty, because a filter with nothing behind it passes by filtering everything. Git spawns go through `GitProcessSupervisor`, not that runner: the same file proves zero spawns while Git is disabled, and an enabled Git admits only the permits of the pinned process table (Amended 2026-09-26) |
| **Credentials** | no Keychain, no token store; the protected-path policy refuses `.ssh`, `.aws`, `.gnupg`, `.env` and `.env.*`, and three exact files, on both the declared and the canonical path (`packages/security/src/protected-paths.ts:37-57,148-160`); the `read-env-variants` rule exempts `.env.example`, `.env.sample`, `.env.template` and `.env.dist` (D67, `:39-47`) | **The declared half:** `packages/security/src/protected-paths.test.ts:53` — `rejects reading the protected path %s` — and `:64` — `rejects writing the protected path %s` — two `it.each` blocks that run every one of the eight fixture paths (`:23-32`) through `assertReadable` and `assertWritable`, covering `.env`, `.env.local`, `.ssh`, `.aws`, `.gnupg` and all three exact files by name. **The canonical half:** `:158` — `rejects an innocent alias that resolves into synthetic SSH data` — a path innocent as written that resolves into a protected directory. **The negative control**, which is what keeps the rule a name match rather than a substring match: `:83` — `does not treat a protected-name prefix as the protected directory`. Note the policy covers `.env` and `.env.*` but **not** `.envrc` or `.environment` (`foundation.md` §7) |
| **Reading a session transcript** | no code path opens the field the vendors ship in every hook payload | `tests/repository/transcript-path.test.ts` — a gate rather than a reviewer's grep, with the needle assembled at runtime so the file does not match its own source |
| **A hook that spawns a vendor, reads a transcript or writes vendor configuration** | A13 ships hooks (`hooks.md` §3), so hooks themselves are no longer absent; these three things are. Nothing reachable from `apps/cli/src/hooks/entry.ts` imports an adapter package or an invocation module. `decodeHookPayload` reads an allow-list of named fields and never iterates the payload. No hook code writes `~/.claude/settings.json` or a Codex file, and Codex trust stays manual (D7). The hooks file exists only in the install tree, and `plugin_hooks` is `yes` only from a firing record under `state/hooks/`, never from a listing. Those records are a product-home write outside any transaction, bounded to 512 bytes each, best effort and written only after the outcome (the Q3-A exception) | `apps/cli/src/hooks/isolation.test.ts` — `reaches no adapter package and no invocation module from the hook entry`; `tests/repository/transcript-path.test.ts`, unchanged; `packages/adapter-claude/src/plugin.test.ts` — `keeps hooks out of the checked-in tree and puts them only in the install tree`; `apps/cli/src/hooks/firing-records.test.ts` — `writes nothing and creates nothing when the directory is absent`. That no hook writes vendor configuration rests on the hook modules holding no such write call, which is a review claim |
| **Automatic capture** | nothing captures on session start, session end or compaction. The two transcript-dependent legacy hooks stay declined: `session_end_capture` and `pre_compact_backup` stay in both `NOT_USED` lists, no capture hook is rendered, and Codex `pre_compact` is unused. Capture content is agent-authored, and `capture` refuses without `--text` or stdin rather than sourcing text itself — a session-end trigger could only supply that text by reading a transcript, which the row above refuses. The `SessionStart` hook reads the vault and writes nothing there; its only write is its firing record | `apps/cli/src/commands/capture.test.ts`; `apps/cli/src/adapter-capability-parity.test.ts` keeps the two `NOT_USED` lists identical. That no `HOOK_HANDLERS` verb writes quarantine, the vault or a transaction is a review claim over the verb modules, not a test |
| **Telemetry** | `telemetry` is `z.literal(false)` in the configuration schema (`packages/core/src/config/loader.ts:427`) | `packages/core/src/config/config.test.ts` |
| **Reading anything outside this repository** | `npm run lint` runs a git-driven enumerator over tracked *and untracked* files | `tests/repository/self-containment.ts` — a lint rule rather than a sandbox, and it says so: it refuses the obvious spellings so that crossing the boundary has to be deliberate and visible in a diff |
| **Writing a vendor configuration file** | the `doctor` check `vendor-config` reads the Claude user settings file through `readUntrustedText` and examines only `permissions.deny`; `project init` writes no vendor settings file (A14 Q4); the Codex config file is neither read nor written (D7) | `apps/cli/src/commands/vendor-config.test.ts` — `is value-free: no allow, env or deny string reaches the check` and `warns instead of failing when the read throws`. It proves the check reports no value; that nothing writes the file rests on the module holding no write call, which is a review claim |

**Plan 1b removed two absences (Amended 2026-09-26).** A scheduler and Git mutation are no longer
absent: both are opt-in authority behind an activation record (§5.15). The outbound-call row keeps
its one vendor exception for network: `git sync`'s push runs through the admitted `/usr/bin/git`, not
through a product HTTP client, only the local/file transport is admitted (D59 Q4-A, kept by D71), and the Git
runtime's one socket is a Unix-domain socket on the host.

**Spec 2 narrowed the network absence to an explicit boundary (Amended 2026-09-28, D72).** The
release transport is an HTTP client, so "no network" now reads "no network outside `update` plan
and apply". The boundary is enumerated, not assumed: `inspectReleaseAuthoritySurfaces` in
`tests/repository/check.ts` fails lint on a second network module, a second composition of the
transport, or an empty launcher or planner-graph scope.

**A14 left this table unchanged in substance.** `import`, `project init`, `project check` and
`vendor-config` add no network capability and no spawn, so the classified set in
`tests/security/network.test.ts` is the same set. `import --claude-memory` lists only the projects
directory and each memory directory, never a project directory, so it opens no transcript, and the
transcript gate stays green unmodified. The vendor-config row above is new as a written row, not as
a capability: no verb ever wrote a vendor file.

---

## 8. What the evidence is worth

`tests/security/` holds **eleven suites**, a count `tests/repository/citations.test.ts` derives from the tree and checks against this line. Cases are counted by collection — `npx vitest list --root tests security` — rather than by adding deltas to a remembered total; the last collection, on 2026-08-17, found nine suites and 90 cases. Two of those nine are not in design spec §9's
list — **network** and **concurrent edit** — and are there because `BACKLOG.md` §7's standing gate
requires them and the spec dropped them.

**Of 90 cases, 38 carried no watched-failure demonstration when the directory held 85.** **Recounted 2026-08-17 by collection: nine suites, 90 cases.** The 38 that carry no watched-failure demonstration were counted at 85, and the five added since have not been re-audited — three of them (`backup-prune`'s sweep, `sentinel`'s payload floor, `interruption`'s stranding floor) were mutation-verified when written, so the 38 is an upper bound rather than a current figure.

**How that was arrived at, because the first attempt at it was wrong.** The total is the collection
above, 85. The split is the 2026-08-13 baseline — 59 cases, 41 evidenced — plus the two fix rounds
after Task 19's review, counted per suite:

| | cases | evidenced |
|---|---|---|
| baseline, 2026-08-13 | 59 | 41 |
| round one: `prompt-injection` raw-folder escape | +1 | +1 |
| round one: `interruption` extended to five transaction kinds | +21 | +3 |
| round one: the parked NEW-14 `it.fails` became an ordinary refusal case | +0 | +1 |
| round two: `symlink-escape` gains the `capture` scenario, two cases | +2 | +1 |
| round three: `symlink-escape` gains the two ancestor-relocation cases | +2 | +0 |
| **now** | **85** | **47** |

Round one added **twenty-two** cases, not twenty-three — an earlier version of this paragraph and of
the former `BACKLOG.md` §5 line quoted below both said twenty-three, and both were wrong by one against every other
number in them. The four watched failures in that round are the raw-folder escape and the three
`ingest-apply` interruptions whose capture used to be rolled back to `accepted` beside its own notes;
the fifth evidenced case is the NEW-14 refusal, which is a conversion rather than an addition. Round
two's evidenced case is `capture` writing an observation into a relocated quarantine.

**Read the next paragraph before the table, because this is the one part of this document a reader
cannot check against the tree.**

**The suites do not record which of their own cases was watched fail.** `grep -rniE "revert"
tests/security/` returns nothing; no suite carries a marker, a count, or a list. What exists in this
repository is the **aggregate**, which `BACKLOG.md` §5 carried until `d72287a` reduced that file to
unfinished work; it now survives only in `git show d72287a^:docs/superpowers/BACKLOG.md` §5 — "47 of
its 85 cases carried that evidence and 38 did not; recounted at 90 on 2026-08-17" — quoted in full,
because an earlier version of this line dropped the recount clause. The **per-suite breakdown below, the named unevidenced cases, and the thirteen reverts**
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
| `prompt-injection` | 3 of 5 | `a forged System heading` and `a fence escape carrying a URL` as individual rows; the traversal case and the raw-folder case are evidenced |
| `symlink-escape` | 4 of 8 | the two setup cases — NEW-14's and `capture`'s — each of which asserts its fixture reached the state and passes on both sides of the fix by design; and the two ancestor-relocation cases added in round three, which passed on first run because a manifest-artifact collision refuses that shape before ownership is reached. Both refusal cases for the sideways relocations were watched fail, at exit 0 |
| `multiline-command` | 6 of 9 | the replay case, the `\| sh` row, and the negative control (which reddens only under a revert in the opposite direction) |
| `malformed-manifest` | 5 of 6 | the `review` containment case |
| `interruption` | 17 of 36 | `the capture write` at `finalized`, and the eighteen cases added on 2026-08-15 that were not watched fail — every `ingest-stage`, `ingest-reindex` and `ingest-ingested` phase |
| `network` | 4 of 10 | five zero-spawn command rows and the `/usr/bin/env` child case |
| `concurrent-edit` | 2 of 2 | — |

**Three of the 38 are excluded for a stated reason** — the two setup cases and the
`multiline-command` negative control, each of which reddens only under a revert in the opposite
direction. **Twenty more are coverage added on 2026-08-15 whose expectations were derived rather
than watched fail** — eighteen `interruption` cases and the two ancestor relocations. **The remaining
fifteen carry no evidence and no excuse**, and are named above rather than left for a reader to
assume. 3 + 20 + 15 = 38, which is the arithmetic the first version of this paragraph failed.

**Why this distinction is load-bearing.** This repository has shipped two gates nobody had watched go
red, both about properties that were false. A suite whose cases are counted rather than demonstrated
is a suite that can pass by collecting nothing — which is precisely why the sentinel suite asserts
per artifact and why every "not empty" assertion in these suites is written on the scope that must be
non-empty.

**The standing gate this subsystem is measured against** (`BACKLOG.md` §7): sentinel, path, prompt
injection, transaction and network suites, from DOS-P6 onward; `npm run lint` and fast focused tests on
every commit, CI's full suite on every pushed commit, and `npm run check` — which also runs the slow
suites D32 defers — at plan close (D17, D32);
exact-path staging; and a **fresh-context review by an agent that is not the author** on every
code-producing task.

**One gate-integrity item was mitigated rather than closed.** A `doctor.test.ts` case needed 3.19 s
of a 20 s budget on an idle machine and went red in 5 of 6 full runs once eight fsync-heavy suites
joined it. The measured mitigation, `fileParallelism: false`, now stands in both
`tests/vitest.config.ts` (since `507e58a`) and `apps/cli/vitest.config.ts` (since `530f086`); it
also dropped total test time from roughly 1000 s to 700 s. The underlying fragility is unowned: a
case one contended run from red is a gate one contended run from uninformative, and this is the
second such item this program has paid for. Separately, an `ENOTEMPTY` during a fixture's own
recursive cleanup is a filesystem race that serialization may only have made rarer; it is unmeasured
and possibly still live. The measurement record is "Two gate-integrity residuals, both unowned" in
`git show d72287a^:docs/superpowers/ORDER.md`.

---

## 9. Where the rest lives

| For | Read |
|---|---|
| The capability model — two gates, three values, and why it is recorded twice | `claude-adapter.md` §3 and `codex-adapter.md` §3; parity enforced by `apps/cli/src/adapter-capability-parity.test.ts`. Both notes record the DOS-P6 result, amended by A13: the capture keys and the other declined surfaces are `not-used`; `plugin_hooks` and `session_start_injection` resolve from firing records and stay `unknown` without one; `unknown` remains reserved for a fact nobody could establish (the `not-used` amendment, §8 of `git show d72287a^:docs/superpowers/BACKLOG.md`). The hook contract and its residuals are `hooks.md` §3 |
| The two-adapter differences table DOS-P6 designs against | `codex-adapter.md` §9 |
| Fourteen Codex residuals and twelve Claude ones, most with owners | `codex-adapter.md` §11, `claude-adapter.md` §9 |
| The mutation pipeline, ownership, exit codes and what Foundation cannot do | `foundation.md` §3, §4, §6, §7 |
| The verbatim per-task Foundation constraints, one open founder question, and the ratified terminal-collection disposition | `foundation-constraints.md` |
| The two Brain invariants and their two exemptions | `brain.md` §5 |
| The security seams as designed, before implementation corrected them | design spec §8 |
| Open defects, the standing gates, and the active contract index | `BACKLOG.md` §1, §7, §8; the amendment index `BACKLOG.md` §8 was until 2026-08-28 is `git show d72287a^:docs/superpowers/BACKLOG.md` §8 |
| The four Foundation requests this subsystem raised, one of them a security cost | `git show 6145114^:docs/superpowers/ORDER.md`, "Four Foundation requests" — the first three closed by Track R entry R2; the fourth's two founder questions are `foundation-constraints.md`'s: the lock-collection one decided 2026-08-26, the watchdog one still open |

**Exit codes are part of the contract**, and a security refusal has its own: `5`
(`foundation.md` §6). Flattening a refusal into an operational failure would erase the one signal
that says a guard fired, which is why the `doctor` warn/fail demotion is narrow and why
`refusalFrom` picks `5` only when a security validator is among the findings
(`apps/cli/src/commands/ingest.ts:1176-1202`).
