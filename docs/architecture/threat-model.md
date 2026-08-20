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
| A capture stays inside the vault | **holds since 2026-08-15**, with a check-then-use window left open | closed: `BACKLOG.md` §1 NEW-14; the window is **NEW-20** |
| A secret removed from a vault file is gone from the machine | **holds since 2026-08-17** — the pre-edit copy is pruned at both terminal phases | closed: `ORDER.md`, Foundation request 2 |
| An agent invocation is bounded in turns | **partial** — bounded under Claude, no such field under Codex | `codex-adapter.md` §11.3 |

**The first row changed on 2026-08-15 and this table is the corrected one.** The relocated-quarantine
escape it used to record as absent was closed by the fix round after DOS-P6 Task 19's review: all
three commands that touch quarantine now anchor on the configured content root through one shared
`resolveContainedRoot` (§5.2). What remains is narrower and is registered rather than closed —
`resolveContainedRoot` proves the root once and the declared path is followed again afterwards, so a
won race can still redirect a capture (**NEW-20**, theoretical, not a regression).

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
| **Capture text** | agent-authored from a session an attacker may have influenced; may contain secrets the author never meant to send | `apps/cli/src/commands/capture.ts:334` |
| **Vault content** | user data, hand-edited, and may contain secrets the user wrote into their own notes | `packages/brain/src/schema/note.ts`, via `BrainService` |
| **Model output** | a proposal chosen by a model that has just read untrusted capture text | `packages/brain/src/ingest/proposal.ts:199` |
| **The vendor CLI's stdout** | a third-party binary's output, streamed, and parsed into an object callers will spread | `packages/security/src/cli.ts:240` |
| **Configuration** | a TOML file the user edits by hand | `apps/cli/src/commands/doctor.ts:216` (`readConfigFile`), then `packages/core/src/config/loader.ts:187-211` |
| **The installation manifest** | a JSON file on disk that decides ownership, and therefore deletion | `packages/core/src/manifest/store.ts:246` |
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
| Raw text is never persisted, hashed, logged or sent to a model | `redactAndNormalize` redacts, then normalizes, then hashes, in one function that cannot be reordered from outside (`packages/brain/src/capture/build.ts:167-181`); `buildCapture` calls it before anything else exists (`:202-207`) | `tests/security/sentinel.test.ts` — `keeps the sentinel out of the capture file`, `the model input`, `the staging directory`, `every validator report`, `the canonical note` |
| The pre-redaction bound measures and nothing else | `resolveText` takes a byte length and refuses; the text is not logged, hashed or echoed into any refusal (`apps/cli/src/commands/capture.ts:328-365`) | the same suite's per-artifact sweep |
| The capture id derives from redacted content, so two texts differing only by a secret are one capture | `captureId` is the first 16 hex of the hash over the redacted, normalized content (`packages/brain/src/capture/build.ts:207`) | `tests/security/sentinel.test.ts` — `keeps the sentinel out of the deduplication hash` **(§8: no watched failure)** |
| A fingerprint identifies a secret without carrying it | HMAC-SHA256 under the install's key, truncated to 16 hex (`packages/security/src/redaction.ts:277-282`); the key must be at least 32 bytes or `redactText` throws (`:311-313`) | `packages/security/src/redaction.test.ts` |
| A pathological PEM marker cannot make redaction superlinear | the PEM body is bounded at 8,000 characters, chosen by measurement rather than for being finite (`packages/security/src/redaction.ts:284-304`) | `packages/security/src/redaction.test.ts` |
| Quarantine is created private | `mkdir` with mode `0o700` (`apps/cli/src/commands/capture.ts:551`) | — |

**The sentinel suite asserts per artifact, never in total** — the rule is stated at
`tests/security/sentinel.test.ts:26-30` and enforced by `it.each(ARTIFACTS)` at `:229`, over the
nine-name array at `:52-62`. A single assertion over a concatenation of all nine would pass while
eight were empty, which is the shape of gate this repository has shipped and regretted twice. The
ninth name is `"the backup directory"`, added on 2026-08-17 with its own floor rather than appended
to staging's, because a shared floor is that same defect one level down.

**A capture is deliberately not a managed artifact** (`apps/cli/src/commands/capture.ts:530-534`).
Recording it in `installation-manifest.json` would report every legitimate Obsidian edit as drift.
The cost is that `validateChangePlan`'s ownership check does not stand behind a capture write;
`resolveCapturePath` stands there instead, which is a narrower constraint rather than the same one
— and §5.2 is what that narrowness costs.

### 5.2 The capture file's own containment

| Boundary | Mechanism | Evidence |
|---|---|---|
| A capture *file* that is a symlink is never followed | `captureFileNames` filters `entry.isFile()`, which `readdir(withFileTypes)` reports false for a link, so the file is skipped at selection before any path is resolved | `tests/security/symlink-escape.test.ts` — `never follows a symlink standing where a capture file should be` |
| The quarantine directory resolves inside the configured content root | `resolveContainedRoot` canonicalizes both and refuses at exit 5 before anything is read, once per run, in **all three** commands that touch quarantine — `capture`, `review` and `ingest` (`apps/cli/src/context.ts:263-305`) | `tests/security/symlink-escape.test.ts` — `is refused at exit 5, and neither the capture nor the vault is touched`, and `is refused at exit 5, and no observation is written at the destination` |
| A capture path resolves inside quarantine | `resolveCapturePath` canonicalizes the target and compares it against **that proven root** | the first of those |

**This section recorded an absent boundary until 2026-08-15.** `resolveCapturePath` compared the
canonicalized quarantine root and the canonicalized target **against each other and never against
the content root**, so replacing `content/_raw/quarantine` with a symbolic link to a directory
outside the vault held at the new location exactly as it did at the old one: `ingest` completed and
rewrote the capture file outside the vault, and `review.ts` carried the identical construction. The
writable-path guard did not catch it either — `ProtectedPathPolicy` is a protected-*name* policy and
returns early for any path outside the user's home directory
(`packages/security/src/protected-paths.ts:118-127`), so a relocation to a sibling of the home
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
(`packages/core/src/plans/validate.ts:200-205`), and `containsPath` cannot stand in for that test: it
is same-or-descendant (`packages/core/src/manifest/store.ts:111-114`), so a quarantine pointing at
the content root passes containment. It also keeps `CaptureResultV1.path` — printed, and published in
`--json` — the path the user wrote rather than the one their filesystem resolves it to.

**What refuses the ancestor shape today is not that ownership check, and the distinction is worth
keeping.** `init` records the Brain skeleton's directories as managed artifacts, and
`validateChangePlan` canonicalizes every artifact path before ownership is reached, refusing when two
collide (`packages/core/src/plans/validate.ts:296-306`) — which is exactly what a quarantine linked
to `content` or `content/_raw` produces. Both spellings therefore end at exit 6 with nothing written,
measured against a real `init`. The re-armed ancestor check is **depth behind that**, and it is worth
having because the collision guard is incidental: it depends on `init` recording directories, which
is not a security property, and its message names the manifest rather than the link.

**The check is proven once and the path is followed again afterwards**, which is a check-then-use
window this arrangement accepts: `resolveContainedRoot` answers at `apps/cli/src/commands/capture.ts:762`
and every later operation re-follows the declared path. `BACKLOG.md` §1 **NEW-20** carries it, with
why it is registered rather than closed.

All three commands now resolve the quarantine root once, through **one shared implementation**
(`apps/cli/src/context.ts:263-305`), prove it inside the configured content root, and measure every
capture path against the proven root. One implementation rather than three, because this repository's
own rule for a security check is that it must not exist twice
(`packages/security/src/cli.ts:10-13`); each command injects its own refusal so the exit code and
recovery text stay its own, the way `writeIndexArtifacts` already takes one
(`apps/cli/src/commands/reindex.ts:93-99`). **`BACKLOG.md` §1 NEW-14 closed with it**, and the parked
`it.fails` that announced it is an ordinary passing case.

**The leaf refusal in the first row is still no evidence about the directory case** — it is a
different guard, at a different stage, and anyone reading one as covering the other has read the
wrong one. That is why the two are separate rows.

### 5.3 Captured text into a model

| Boundary | Mechanism | Evidence |
|---|---|---|
| The **ingest prompt** marks captured material as data, never as instruction | the heading and the four sentences under it (`packages/brain/src/ingest/prompt.ts:95-102`) | `tests/security/prompt-injection.test.ts:144-145` — the positive control asserts both that the injected text reached the model and that the literal `untrusted data, not instruction` is in the prompt. **That literal is this prompt's own heading (`packages/brain/src/ingest/prompt.ts:95`), not the shared preamble** |
| The **shared skill preamble** carrying the full injection defence cannot be removed | it is **concatenated** into every rendered skill rather than referenced — `renderSkillBody` splices `preamble(options.shared)` into the body of every non-`shared` workflow (`packages/workflow-schema/src/skill.ts:200-201`), and the emitted block says so in its own comment, `concatenated, not referenced` (`:239-241`). `assertUsablePreamble` separately refuses a `shared` that is the wrong workflow or whose prose screens to nothing — an empty preamble is a heading over nothing (`:126-145`) | **Mechanism only — no `tests/security/` case exercises it.** The row above proves a different artifact. `packages/workflow-schema/src/skill.test.ts` covers the preamble at the rendering layer |
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
breaks turned into spaces (`packages/brain/src/ingest/prompt.ts:54-60`). Paragraph boundaries
survive; single line breaks inside a paragraph do not.

### 5.4 Model output into a proposal, and a proposal into the vault

The rule is design spec §14.1's, and this is where it becomes code: **the model's output is a
proposal, never proof of safety.**

| Boundary | Mechanism | Evidence |
|---|---|---|
| Output is structured and validated, never best-effort parsed | `parseStructuredPayload` refuses a top-level `__proto__` before returning a value callers will spread, and refuses unparseable output as `malformed-output` (`packages/security/src/cli.ts:240-259`) — **only the top level is walked**, and a caller merging a nested field owes its own guard | `packages/security/src/cli.test.ts` |
| A proposal cannot smuggle a prototype through Zod | `carriesReservedKey` checks the prototype *and* the own `__proto__` key before the schema runs, because Zod strips `__proto__` ahead of its own strictness check (`packages/brain/src/ingest/proposal.ts:97-108`) | `packages/brain/src/ingest/proposal.test.ts` |
| A proposal is bounded | at most 32 notes (`packages/brain/src/ingest/proposal.ts:65,215`); path length, extension, separator and control characters refused as string properties (`:129-136`) | `packages/brain/src/ingest/proposal.test.ts` |
| Model output cannot widen write scope | nine validators run on every call, all of them, with every finding returned (`packages/brain/src/ingest/validate.ts:24-43`). `writeScope` consults the workflow's declared scopes as an **upper bound** (`:583-601`), subtracts private folders, the indexes directory and dot-segments from the written path (`:509-522`, `:603-618`), checks containment on the **canonicalized destination, not the written path** (`:620-639`), subtracts the private folders from that destination too (`:641-668`), and folds the same subtraction over the destination's own segments at every depth (`:670-694`) — the twin `generatedOutputConsistency` already had, and without which a proposal spelled `_RAW/quarantine/…` lands in the real quarantine on any case-insensitive volume | `tests/security/symlink-escape.test.ts` — `refuses at exit 5, leaves the capture accepted, and writes nothing at the destination`; `tests/security/prompt-injection.test.ts` — `writes nothing at the destination a traversal would resolve to`, `writes nothing under the raw folder, whatever case the proposal spells it in` |
| A secret in the proposal never reaches the vault | `secretScan` runs the redaction pass over the path, the contents *and* the provenance id, and reports **class names and the file, never the value, never the redacted text, never the fingerprint** (`packages/brain/src/ingest/validate.ts:466-495`) | `tests/security/sentinel.test.ts` — `keeps the sentinel out of every validator report` |
| A proposal cannot overwrite the user's own note | mutations are `create`, never `replace`; an existing path is refused before the transaction (`apps/cli/src/commands/ingest.ts:951-958`) | `tests/security/malformed-manifest.test.ts` — `refuses to replace a note a forged manifest claims to own` |
| A failure's machine-readable payload carries nothing unredacted, and nothing a caller chose | `CliError.data` is typed `RedactedPayload`, a `unique symbol` brand whose sole producer is `redactPayload` — which takes the redactor and performs the walk rather than asserting, so obtaining the type means having redacted. `failure` accepts a payload only by registry identity, and `publish` rebuilds any arm it did not produce (`packages/core/src/result.ts:632`, `:802`, `:984`). `ingest` populates it through `reportFields`, which publishes every field byte-exact — the rule stated two rows down, *paths are byte-exact everywhere and screened at the terminal instead*. Screening the ids and note paths here was tried and reverted: the screen collapses whitespace, so it renamed ordinary files (`cap  two` → `cap two`, `DEV/two  spaces.md` → `DEV/two spaces.md`) while the success arm published the same values raw, making `data` the only rendering of four that was wrong. What byte-exactness leaves open is that `JSON.stringify` escapes `\p{Cc}` and not `\p{Cf}`, so an override in a *filename* reaches a consumer here as it already does through `error.message` — NEW-38, which the screen never closed | `packages/core/src/result.test.ts` — every guard that *can* be pinned is revert-verified, meaning deleting it reddens a named case; the handful that cannot be pinned are labelled at the source as equivalents, unreachable, unobservable, or redundant with a sibling, so a survivor without a label is a finding and a label that is wrong is a worse one — five have been caught and corrected, each having excused a live guard from review. `apps/cli/src/commands/ingest.test.ts` — `publishes a capture id byte-exact, as the success arm does` and `names a refused path byte-exact, against the file on disk`; `tests/security/sentinel.test.ts` plants its sentinel in a note *path* as well as a body, which is what covers `error.paths` |
| The same payload is **not** byte-exact about paths, and that is registered rather than fixed | `redactPayload` runs every string leaf through `redactText`, which returns NFC — so a path published on `data` is renormalized where `error.paths` beside it is not, and the user's own `[redaction] patterns` are applied to product-chosen key names. Both are open (`BACKLOG.md` NEW-36); a numeric leaf is outside the redactor's reach by type (NEW-37). **`error.paths` is not redacted at all** — `message`, `data` and `recovery` are, and that field is not, so a secret in a model-chosen note path publishes raw beside the same string redacted twice on the same document (NEW-39). Redacting it is blocked on NEW-36: the `high-entropy` class fires on a sixteen-hex capture id, so blanket redaction publishes `[REDACTED:high-entropy].md` for every quarantine path. The **message** beside it is not screened at all: `selectCaptures` embeds a raw quarantine filename in an English warning, `reportLines` appends it, and `JSON.stringify` escapes `\p{Cc}` but not `\p{Cf}` — so a bidi override in a filename reaches a `--json` consumer through `error.message` even on the run whose `data` is clean (NEW-38). And a third, undated by a row because it is a designed bound rather than a defect: a payload large enough to reach `MAX_NODES` is published **truncated** — an array entry or an added key spelled `"[truncated]"` — while still declaring `schemaVersion: 1`, which unreadable captures can reach because `--limit` does not bound them | registered, not defended — the row exists so the boundary is not read as tighter than it is |
| A model-chosen path cannot repaint a terminal or a `--json` consumer — but a **filename** still can, through `error.message` (NEW-38) | findings are rendered through `screenAndCap` at the one seam where a path stops being data and becomes a message, including the `--json` channel, because `JSON.stringify` escapes `\p{Cc}` but not `\p{Cf}` (`apps/cli/src/commands/ingest.ts:797-815`) | `apps/cli/src/commands/ingest.test.ts` |
| A failure leaves the capture retryable and never `ingested` | any validator finding exits without touching status (`apps/cli/src/commands/ingest.ts:819-845`); five transaction kinds isolate each phase (`:271-277`) | `tests/security/interruption.test.ts` — `an interruption at every forward phase`, all seven phases × the capture write and each of the four forward ingest kinds, plus the derived coverage case |

**The defence is in depth, and the evidence shows it.** When Task 15 reverted only the proposal
parser's traversal rule, the injection suite stayed **green** — the write-scope validator caught it.
Reddening it needed the parser rule *and* the validator's unsafe-path branch *and* the declared-glob
check removed together. That is the strongest single statement in this document about the model-output
seam, and it is a measurement rather than a claim.

**`validateChangePlan` is deliberately absent from the note write too**
(`apps/cli/src/commands/ingest.ts:914-921`), for the same reason it is absent from a capture write: a
note is the user's own content. The write-scope validator stands in its place, which is narrower than
ownership and is the constraint that matters for a path a model chose.

### 5.5 The vendor CLI as a subprocess

The vendor CLI is the only outbound process this product makes, and the only place any model runs.

| Boundary | Mechanism | Evidence |
|---|---|---|
| The model is invoked with zero declared write scopes | `writeScopes: []` at the call site (`apps/cli/src/commands/ingest.ts:742`); Codex derives `-s read-only` **from the count and never from an argument**, which is what makes `danger-full-access` unreachable rather than merely unwritten (`packages/adapter-codex/src/invoke.ts:196-200`, `packages/adapter-codex/src/invoke.ts:264`); Claude is passed `["Read","Grep","Glob"]` with no write tool, so the vendor's own permission system enforces it before the model runs (`apps/cli/src/commands/ingest.ts:210-226`) | `apps/cli/src/commands/ingest.test.ts:1421` — `gives claude no write tool in --allowedTools`; `packages/adapter-codex/src/invoke.test.ts:284` — `uses read-only and adds no --add-dir when there are no write scopes`; `tests/security/network.test.ts` — `spawns exactly one process during ingest, and it is the discovered vendor binary` |
| No shell is ever involved | `spawn(..., { shell: false })` (`packages/security/src/process.ts:87-93`) | `packages/security/src/process.test.ts` |
| The executable is absolute | `assertSafeCommand` refuses a non-absolute executable (`packages/security/src/process.ts:47-54`). Separately, the request carries no `PATH`, so a child has nothing to resolve a bare name against | `packages/security/src/process.test.ts:80-97` — `rejects foreign-platform executable syntax that is not locally absolute`, an `it.skipIf` that runs wherever `C:\tools\curl.exe` is not absolute, so it executes on the supported platform; `tests/security/network.test.ts:176-179` asserts absoluteness across every classified spawn |
| The executable, `cwd`, every argument and stdin are NUL-free | four `containsNul` checks across two branches — the executable (`packages/security/src/process.ts:48`), then the working directory, every argument and stdin (`:56`, `:57`, `:58`) | **Proven per branch since 2026-08-15.** `describe("assertSafeCommand")` (`packages/security/src/process.test.ts:62`) holds a case for each of the four `containsNul` sites — executable (`:101`), working directory (`:111`), any argument (`:119`), stdin (`:127`). This cell said no test exercised a NUL at all, and pointed at **NEW-18**, a row Track R closed with a regression test each and removed from `BACKLOG.md` §1 three days before this sentence was last edited. Stated rather than papered over: all four checks exist and none is proven |
| The child inherits nothing from the parent environment | the runner passes only `{...request.env}` (`packages/security/src/process.ts:91`), and both adapters pass `env: {}` — stricter than the spec asks | `tests/security/network.test.ts` — `does not pass a proxy the parent process was given`, asserted by *inheritance* rather than by an expectation that could be edited to match a leak |
| Output cannot exhaust memory | 1 MiB per stream, after which the child is `SIGKILL`ed and the call is a security refusal (`packages/security/src/process.ts:6,195-216`) | `packages/security/src/process.test.ts` |
| A run is bounded in wall clock | `SIGTERM`, then `SIGKILL` 100 ms later, to the process *group* on darwin (`packages/security/src/process.ts:111-128,168-179`); `INGEST_TIMEOUT_MS` is 120 s (`apps/cli/src/commands/ingest.ts:236-242`) | `packages/security/src/process.test.ts` |
| Vendor output is redacted before it is returned to any caller | the runner redacts stdout and stderr inside `finishFromClose` (`packages/security/src/process.ts:149-156`) | `tests/security/sentinel.test.ts`'s `the logs` and `the --json output` cases **(§8: neither carries a watched failure)**; `packages/security/src/process.test.ts` asserts the redaction at the runner |
| A refusal never echoes the rejected value | `parseAgentPromptArgs` scrubs it, because a `with` block is author-controlled and the message reaches a log (`packages/adapter-codex/src/invoke.ts:96-100`) | `packages/core/src/agent-prompt/agent-prompt.test.ts` |
| **An invocation is bounded in turns** | **partial** | see below |

**This is the third of the three.** `maxTurns` is bounded and enforced under Claude — an integer
between 1 and 50, refused otherwise, bounded at the adapter rather than trusted from the type
(`packages/adapter-claude/src/invoke.ts:41,79-89`) — and `CodexInvocation` has no such field, so the
Codex arm of `invokeVendor` passes none (`apps/cli/src/commands/ingest.ts:737-747`). **One shared
schema, two behaviours, one of them silent.**

Half of it is closed and the half that is closed is worth knowing: `parseAgentPromptArgs` now
**refuses `maxTurns` outright** with an error naming its owner, rather than honouring it on one
vendor and dropping it on the other (`packages/core/src/agent-prompt/index.ts:68-79`, pinned by
`packages/core/src/agent-prompt/agent-prompt.test.ts:50,63`). So a *workflow author* can no longer
set a bound that silently applies to one vendor. What survives is `ingest`'s own direct invocation:
it sets `DEFAULT_MAX_TURNS` for Claude (`apps/cli/src/commands/ingest.ts:731`) and nothing for Codex,
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
will hand a derived path to the screen that still carries the word list. Claude's `allowedTools` carries the same trap; its exact
spelling is an inference from vendor syntax rather than a documented form.

**One rule at this seam is provisional on the success path.** Codex's `--json` streams JSONL while
`--output-schema` constrains only the final response, so stdout is reduced to *the last line that
parses as a non-null JSON object* (`packages/adapter-codex/src/invoke.ts:120-193`). No event type is
filtered on, because an invented enum a future version rejects is a failure only a real run would
find. **DOS-P6 Task 17 made that call on 2026-08-15** and settled the framing — one JSON object per
line — and the existence of a discriminating `type` field, but **not** the terminal-event rule
itself: the run ended `turn.failed` on an exhausted usage limit, so no run reached a model response.
It still ships unverified and says so at the seam; nothing here should be read as having verified it.
Owner of the remainder: `BACKLOG.md` §1 **NEW-21**.

**That run also showed what a boundary at this seam is protecting against.** The observed stream's
last parsing line is the `turn.failed` event, so the reduction rule alone would hand a caller a
vendor error shaped like a result; what prevents it is the `exitCode !== 0` check that runs *before*
the reduction (`packages/adapter-codex/src/invoke.ts`). **That ordering was already guarded** — a
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
| Frontmatter resolves no YAML tag | the first explicitly tagged node is found and refused, and *any* tag counts, because which tags construct values is the library's decision and "frontmatter carries no tags" is this product's (`packages/brain/src/schema/note.ts:300-314,600`); `maxAliasCount` is pinned at the same seam (`:616`) | `packages/brain/src/schema/note.test.ts` |
| A frontmatter block cannot make parsing superlinear | `MAX_FRONTMATTER_CHARS` is 64 KiB, counted in UTF-16 code units because the cost is quadratic in *entries* and an entry costs at least five code units in any script (`packages/brain/src/indexes/build.ts:168,558`) | `packages/brain/src/indexes/build.test.ts` |
| Vault text cannot reorder a rendered line or repaint a terminal | one display screen for the whole product, covering `\p{Cf}` as well as `\p{Cc}` (`packages/security/src/screen.ts:72,96,110`); `escapeLeadingBlock` in the index renderer is a **different** rule — it stops text becoming Markdown structure where the screen stops characters reordering a line — and both run, in that order (`packages/brain/src/indexes/render.ts:112-121`) | `tests/e2e/brain.test.ts`, which crosses the seam so a future divergence fails rather than merely looking wrong |
| Paths are byte-exact everywhere and screened at the terminal instead | a path is an identifier the user must be able to act on, and link destinations must resolve; `renderPath` screens at the boundary (`apps/cli/src/context.ts:103`, `foundation.md` §5) | `apps/cli/src/context.test.ts` |

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
(`apps/cli/src/commands/brain.ts:117`) and rethrows `ConfigurationError` unmodified, so the parse
failure is content-free on that path too. NEW-17 is closed and removed from `BACKLOG.md` §1.

| Boundary | Mechanism | Evidence |
|---|---|---|
| Nine redaction classes, and a tenth cannot be added unreachably | `REDACTION_CLASSES` is frozen and a test asserts membership against findings **actually produced**, not against the list (`packages/security/src/redaction.ts:24-40`) | `packages/security/src/redaction.test.ts` |
| A user-supplied pattern cannot backtrack | user patterns are literal, case-insensitive substrings over NFC-normalized text — never regular expressions, because this codebase bounds no expression anywhere and a pathological pattern would hang the one operation that must not fail quietly (`packages/security/src/redaction.ts:13-22`) | `packages/security/src/redaction.test.ts:448-469` — `.*` and `(a+)+$` asserted to behave as literals |
| Redaction is a heuristic and is not the only thing standing — **on every command that reads configuration** | the worked example is configuration: a `loadConfig` throw becomes a content-free `ConfigurationError` rather than being handed to the redactor, because `smol-toml` embeds three raw source lines in `TomlError.message` (`apps/cli/src/commands/doctor.ts:195-200,234-238`). `status`, `doctor`, `init`, `capture`, `uninstall`, `review` and `ingest` all reach configuration through that wrapper (`status.ts:42`, `doctor.ts:667,1015`, `init.ts:236`, `apps/cli/src/commands/capture.ts:331`, `uninstall.ts:560`, `review.ts:161`, `ingest.ts:433`) | `tests/e2e/foundation.test.ts:1277` — `never quotes the configuration it failed to parse` |
| The same, on a `brain` run | **holds since NEW-17 closed.** `readConfig` calls `readConfigFile` (`apps/cli/src/commands/brain.ts:117`) rather than parsing for itself, and rethrows `ConfigurationError` unmodified — its message quotes nothing and it carries the exit code `BrainRefusal` uses, so `failureFrom` renders it with no special handling. This row read **partial** for two days after the fix | `packages/core/src/config/config.test.ts`; `apps/cli/src/commands/brain.test.ts` |

**A gap found while writing this document — closed 2026-08-17, and this paragraph asserted the
opposite for a day afterwards.** `redactText`'s `userPatterns` option had no production caller and
`configSchema` had no redaction table, so design spec §8.2's "patterns live in `config.toml`"
described an unwired half: the `user-pattern` class was implemented, tested and unreachable from the
product.

**It is wired now.** `configSchema` carries an optional `[redaction]` table
(`packages/core/src/config/loader.ts:208`, whose `redactionSchema` is at `:151`), and the three
commands that redact bind the user's patterns into a closure at their composition root —
`apps/cli/src/commands/capture.ts:695`, `apps/cli/src/commands/review.ts:535`,
`apps/cli/src/commands/ingest.ts:1667`. `createRedactor` is the only production entry to
`redactText`, enforced by `tests/repository/redactor-entry.test.ts`, which is what keeps a new call
site from silently opting out of the user's own patterns. **Record: `BACKLOG.md` §1 NEW-16, closed;
its residuals NEW-24, NEW-25 and NEW-26 are open.**

### 5.8 The redaction key — the product's first secret at rest

| Boundary | Mechanism | Evidence |
|---|---|---|
| The key is not a managed artifact | created deliberately outside `mutationsFor`/`recordArtifacts`, so it never enters `installation-manifest.json`, is never hashed into a drift report, and is absent from `plan.created` too — naming it there would imply the manifest owns it (`apps/cli/src/commands/init.ts:711-722`) | `apps/cli/src/commands/init.test.ts`; `tests/e2e/foundation.test.ts:563` — `restores a deleted redaction key when init is run again` |
| Reading the key follows no symlink and cannot hang the CLI | `O_NOFOLLOW` because a symlink there is not our file, and `O_NONBLOCK` because `open(O_RDONLY)` on a FIFO blocks forever and the regular-file check is downstream of the open (`apps/cli/src/context.ts:468-479`) | `apps/cli/src/context.test.ts` |
| A key that is not a private regular file of the right length is refused or repaired | symlink, non-regular and short-file refusals, and the mode is forced back to `0600` through the open handle (`apps/cli/src/context.ts:492-513`); created at `0600` (`:537-541`) | `apps/cli/src/commands/doctor.test.ts:228` |
| A lost key degrades a diagnostic and never the knowledge | a missing key regenerates with a warning that prior fingerprints are no longer comparable (`apps/cli/src/context.ts:639`) — content is not derived from the key | `apps/cli/src/context.test.ts` |
| `uninstall` removes it, and that is the one named exception to the manifest-only rule | centralized in `redactionKeyPath` so the exception stays exactly one path wide (`apps/cli/src/context.ts:456-466`) | `apps/cli/src/commands/uninstall.test.ts` |

### 5.9 The transaction — **and the boundary that closed**

| Boundary | Mechanism | Evidence |
|---|---|---|
| Every managed mutation is journalled, backed up and recoverable | seven phases driven by one loop, each journalled *after* it completes and before the next is attempted, so the journal always describes work already done (`packages/core/src/transactions/executor.ts:397-445`, `:1210`) — the full phase table is `foundation.md` §3 | `tests/security/interruption.test.ts` — an interruption at each of the seven forward phases, for the capture write and each of the four forward ingest kinds. **It is an in-process `afterPhase` throw, not a signal**, and the suite says so in its own header: a thrown error unwinds where a `SIGKILL` does not, so it proves the journal is recoverable and never that no `finally` ran |
| An interrupted run leaves the capture retryable and `doctor` says how to recover | `checkTransactions` fails on any incomplete journal and names both ways out in its recovery string (`apps/cli/src/commands/doctor.ts:733,744`), which sets exit 6; it fails a second way, on a backup payload that outlived a terminal transaction, naming the one `repair` that clears it (`:756-758`) | `tests/security/interruption.test.ts`, and its derived coverage case at `:335-337` which reddens if the driven set shrinks; `tests/e2e/foundation.test.ts:1027` — `is reported, blocks init, and names both ways out` |
| A file that changed under a running command is not overwritten | two checks, and the earlier one is new as of 2026-08-20. A caller that read the file supplies the digest of what it read on `PlannedFileMutation.expectedBeforeHash`, and the **plan phase** refuses on a mismatch with `TransactionPreconditionError` (`packages/core/src/transactions/executor.ts:360`) — before anything is staged, so that refusal can promise the file is untouched. A write landing later is caught at backup time by the executor's own snapshot (`:789`), which cannot. `review` and `ingest` both supply a precondition on the write that follows their own read; the window that remains is registered as NEW-40 | `apps/cli/src/commands/review.test.ts` — `refuses, keeping the hand edit, when it lands between the read and the write`; `apps/cli/src/commands/ingest.test.ts` — `refuses when a hand edit lands between the read and the staging write`; `tests/security/concurrent-edit.test.ts` for the later window |
| A second operation on a held journal is refused | every store operation on a journal runs inside `withTransactionLock` (`packages/core/src/transactions/store.ts:195,247,261,283`), which takes an advisory per-transaction lock through `/usr/bin/lockf` (`packages/platform-macos/src/transaction-lock.ts:17,84`) | `tests/security/concurrent-edit.test.ts` — `refuses a second transaction while one holds the lock` |
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
**Record: `ORDER.md`, Foundation request 2.**

**The staging area is still not removed, and that is a separate residual.**
`ensureTransactionDirectories` creates both the staging and the backup directory, and the executor's
only other removals are `removeOwnedTemp` on a durable-write temporary and the `unlink` of a `remove`
mutation's own target. The staged bytes are *redacted* content, so their survival costs disk rather
than a secret; the backup's did not, which is why the prune was a security fix and this is a
housekeeping one. It sits beside the open founder question `BACKLOG.md` §2 carries about
`<state>/transactions/` accumulating one permanent lock file per transaction id.

**Two related residuals, both open and both stated where a reader meets them.** `PlannedFileMutation`
carries no caller-supplied precondition, so the executor computes `expectedBeforeHash` from its own
snapshot and a read-to-execute window survives in both `capture` and `review --decision edit`
(`apps/cli/src/commands/capture.ts:496-528`, `apps/cli/src/commands/review.ts:317-340`) — benign for
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
| A note write cannot become an overwrite, whatever the manifest claims | `applyNotes` refuses an existing target before the transaction (`apps/cli/src/commands/ingest.ts:951-958`) | `tests/security/malformed-manifest.test.ts` — `refuses to replace a note a forged manifest claims to own`, whose failing output shows the model's note replacing the user's own words |
| Every manifest-driven read resolves the path through the guard, opens `O_NOFOLLOW`, and re-checks `dev`/`ino` after the open | `packages/core/src/manifest/drift.ts:49,64,70-71,110`; `assertReadable`'s contract — canonicalize the parent, append the basename verbatim — is `packages/core/src/manifest/types.ts:87-100`. The two ownership universes (`init` revert vs `uninstall`) are `foundation.md` §4 | `packages/core/src/manifest/manifest.test.ts`; `tests/e2e/foundation.test.ts:750` — `never removes a manifest artifact that lies outside the product home` |
| The manifest is never read through a followed symlink | `assertReadableArtifactPath` canonicalizes the *parent* and appends the basename verbatim, so the leaf is never resolved and core's `lstat` stays meaningful; the policy is asked **twice**, and both calls are load-bearing (`foundation.md` §5, `apps/cli/src/context.ts:319-331`) | `apps/cli/src/context.test.ts` |

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
| Discovery runs one absolute helper and gives it nothing but a search path | `/usr/bin/which`, spawned with `env: { PATH: <search path> }` and nothing else (`packages/platform-macos/src/macos.ts:18,229`) | `tests/security/network.test.ts` — every classified spawn asserted absolute, and the classification asserted total in both directions (`:164-179`) |
| A discovered path that is not usable is refused rather than reported | must be absolute, free of every control character, and must not carry a redaction marker — because the runner redacts its own output and a high-entropy path segment comes back rewritten but still absolute (`packages/platform-macos/src/macos.ts:86-106`) | `packages/platform-macos/src/macos.test.ts` |
| An empty `PATH` does not become an unbounded search | a fixed fallback of the four system directories (`packages/platform-macos/src/macos.ts:21,185-186`) | `packages/platform-macos/src/macos.test.ts` |
| The *platform boundary* never executes what it found | `AgentDiscovery.version` is permanently `null` there, because determining it requires running the binary (`packages/platform-macos/src/types.ts:19-24`, `foundation.md` §7). **A layer above does execute it**: `discoverCli` runs `<exe> --version` (`packages/security/src/cli.ts:54-80`) and `doctor` calls it on every invocation, which retired the Foundation-era invariant — `claude-adapter.md` §9 residual 10 records exactly that | `packages/platform-macos/src/macos.test.ts`; `tests/security/network.test.ts` classifies the version probe rather than forbidding it |
| A hostile entry for one vendor does not cost the user the other | a discovery that refuses is treated as "not this one" and the next vendor is tried (`apps/cli/src/commands/ingest.ts:482-491`) | `apps/cli/src/commands/ingest.test.ts` |
| **The executed binary is vouched for by something** | `assertTrustedExecutable` canonicalizes the path, refuses anything that is not a regular file, and walks three ancestor chains — the resolved target's, the declared directory's, and that directory canonicalized — refusing an owner that is neither the current uid nor root, any other-writable directory, and a group-writable one the current uid does not own (`packages/platform-macos/src/macos.ts:305`) | `packages/platform-macos/src/macos.test.ts`; `tests/helpers/temp-home.ts` runs the real check against every planted binary |

**A gap found while writing this document — paid on 2026-08-17, and this section read "absent" for
a day afterwards.** `packages/platform-macos/src/types.ts:13-18` documented `executablePath` as
untrusted and said "anything that executes it owes that check first", and nothing paid it: DOS-P6 was
the first thing in this product to execute it, `selectVendor` handed `discovery.executablePath`
straight to `invokeVendor`, and `capture` joined on 2026-08-15 when Task 17's Claude detection made
`discoverSourceAgent`'s probe path live — the same unchecked execution on the product's most
frequently run command, triggered by a `CLAUDECODE=1` any wrapper or CI step can export.

**`assertTrustedExecutable` is that check**, and all three executors call it before spawning:
`apps/cli/src/commands/capture.ts:263`, `apps/cli/src/commands/doctor.ts:439`,
`apps/cli/src/commands/ingest.ts:516` — `doctor` was a third executor paying nothing while the first
version of this fix claimed a third could not arrive. The rule, decided by the founder rather than
chosen here (BACKLOG NEW-15): **resolve, then check.** The binary is canonicalized and the resolved
target must be a regular file; every ancestor on three chains — the resolved target's, the declared
directory's, and that directory canonicalized, the third because the first two alone accepted a PATH
directory symlinked into a world-writable one — is then refused if its owner is neither the current uid nor root, if it is other-writable with or without a
sticky bit, or if it is group-writable and not owned by the current uid.

**Three residuals are open, and the first version of this paragraph named two — neither of them the
one that matters.** In order of severity:

1. **A middle symlink hop is on none of the chains (`BACKLOG.md` §1 NEW-32).** `<trusted>/claude` →
   `<attacker>/hop` → `/bin/ls` passes every check: the declared chain walks `<trusted>` upward, the
   resolved chain walks `/bin` upward, and `<attacker>` is visited by nobody. It needs no race. This
   is a **working bypass of the guard**, and the paragraph it replaces omitted it while asserting
   "neither is hidden".
2. **macOS ACLs are invisible to `stat().mode`.** A directory can be `0755` and writable by another
   user through an ACL entry, so the mode check is a floor rather than a proof.
3. **Check-then-use (`BACKLOG.md` §1 NEW-35).** The target is stat'd and then executed by path;
   closing it needs an exec-by-descriptor this runtime does not offer. Accepted by the founder when
   the rule was decided.

**`NEW-33` is not on that list**, and putting it there was the other half of the error: a root-owned
group-writable directory being *refused* makes a `claude` under some `/usr/local` layouts fail. That
is a false refusal — a usability cost and the founder's call — not a weakening of the boundary.

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
| Configuration is read through the protected-path policy, never with a bare `readFile` | the guarded reader canonicalizes, refuses a protected name, opens `O_NOFOLLOW` and re-checks `dev`/`ino` after the open (`packages/security/src/protected-paths.ts:47-88`), reached through `context.guards.readText` (`apps/cli/src/context.ts:377`, `apps/cli/src/commands/doctor.ts:232`) | `packages/security/src/protected-paths.test.ts:70` — `allows the Developer OS configuration path`; `:146` — `reads from the opened safe descriptor after the original alias is swapped` |
| Absence is distinguished from a refusal | `lstat` is checked *first*, because the guarded reader reports a missing file as a security refusal — the right answer for a read and the wrong one for "this machine has never been initialized" (`apps/cli/src/commands/doctor.ts:225-230`) | `apps/cli/src/commands/doctor.test.ts` |
| An unknown key is refused rather than ignored | `configSchema` is `.strict()`, as is every nested table (`packages/core/src/config/loader.ts:187-211`, `:77-91`) — so a typo'd or injected key fails the load instead of being silently dropped | `packages/core/src/config/config.test.ts` |
| A parse failure never prints the file it failed on — **through `readConfigFile`** | a `loadConfig` throw becomes a content-free `ConfigurationError`, because `smol-toml` embeds three raw source lines in `TomlError.message` and propagating it printed whatever was read into `status`, `doctor` and their `--json` (`apps/cli/src/commands/doctor.ts:195-200,234-238`). Redaction is deliberately not the only thing standing on this path | `tests/e2e/foundation.test.ts:1277` — `never quotes the configuration it failed to parse` |
| The same boundary on a `brain` run | **holds.** `readConfig` reads through `readConfigFile` (`apps/cli/src/commands/brain.ts:117`) and rethrows `ConfigurationError` unmodified, so a `TomlError` never reaches `redactDiagnostic`. NEW-17, closed | `apps/cli/src/commands/brain.test.ts` |
| Telemetry cannot be switched on by editing the file | the key is `z.literal(false)` (`packages/core/src/config/loader.ts:209`), so `telemetry = true` fails the load | `packages/core/src/config/config.test.ts` |

**What configuration carries that it did not, and §5.7 explains why it matters:** an optional
`[redaction]` table, added on 2026-08-17 when NEW-16 closed, so the `user-pattern` class is
configurable — this paragraph asserted the opposite for a day after the wiring landed, in a
section a reader reaches *before* §5.7. **And one thing it decides that
nothing else re-checks:** `brainPath` is an absolute path from the file, and `reindex` does not call
`assertRootsAnchored` where `init` does — so a hand-edited vault path outside the home is refused by
one command and accepted by the other. That is `brain.md` §4 residual 5, owned by DOS-P7.

---

## 6. Statuses, and the invariant under every failure

**A failure at any point leaves the capture `accepted`, never `ingested`, and always retryable —
unless its notes are already in the vault, in which case it is left at `staging` and says so.**
That is the gate's own wording in `BACKLOG.md` §3 plus the one qualification the ladder forces, and
it holds by refusal (`apps/cli/src/commands/ingest.ts:819-845`) and by interruption
(`tests/security/interruption.test.ts`, 37 cases by collection — 35 driven interruptions, the derived coverage case, and the stranding floor). `accepted` beside this run's own notes
would be the one answer that is *not* retryable: `applyNotes` refuses an occupied path, so the next
run would refuse the capture permanently.

**It holds with one stated residual, accepted rather than closed.** `ingest` runs as four transactions
per capture plus a compensating rollback — `ingest-stage`, `ingest-apply`, `ingest-reindex`,
`ingest-ingested`, `ingest-rollback` (`apps/cli/src/commands/ingest.ts:275-281`) — because
`BrainService.reindex()` reads the vault and cannot run until the apply has finalized, and because
`validateChangePlan` grants ownership from a manifest a capture is deliberately absent from. **A crash
after the apply has written its mutations leaves a capture at `staging` with its notes already
applied** (`apps/cli/src/commands/ingest.ts:1040-1054,992-1003`) — from the moment they are written,
not from the moment the transaction finalizes, which is the distinction the fix round after Task 19's
review corrected: `verifyDesired` runs after the bytes are on disk and can raise, and a rollback to
`accepted` there is what makes the residual unrecoverable rather than inert. It is inert — the next
run selects only `accepted` captures and cannot double-apply — and recoverable by `repair` plus a
hand edit. This
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
| **Network** | no HTTP client, no socket, no DNS anywhere in the product | `tests/e2e/foundation.test.ts:1191` — `ships no network capability`. It scans every compiled non-test module in **every workspace discovered under `apps/` and `packages/`** (`:1208-1220`) — discovered, not written down, which is the whole of the fix for the closed NEW-1 — and asserts non-empty **per workspace** rather than over the total (`:1265-1266`), because a floor over the sum is satisfied by one populated directory |
| **Any outbound call but one** | the vendor agent CLI during ingest, and nothing else | `tests/security/network.test.ts` — the spawn list is **classified, not forbidden**: the unclassified set is asserted empty and the classified set asserted non-empty, because a filter with nothing behind it passes by filtering everything |
| **Credentials** | no Keychain, no token store; the protected-path policy refuses `.ssh`, `.aws`, `.gnupg`, `.env` and `.env.*`, and three exact files, on both the declared and the canonical path (`packages/security/src/protected-paths.ts:9-19,129-137`) | **The declared half:** `packages/security/src/protected-paths.test.ts:48` — `rejects reading the protected path %s` — and `:59` — `rejects writing the protected path %s` — two `it.each` blocks that run every one of the eight fixture paths (`:18-27`) through `assertReadable` and `assertWritable`, covering `.env`, `.env.local`, `.ssh`, `.aws`, `.gnupg` and all three exact files by name. **The canonical half:** `:130` — `rejects an innocent alias that resolves into synthetic SSH data` — a path innocent as written that resolves into a protected directory. **The negative control**, which is what keeps the rule a name match rather than a substring match: `:78` — `does not treat a protected-name prefix as the protected directory`. Note the policy covers `.env` and `.env.*` but **not** `.envrc` or `.environment` (`foundation.md` §7) |
| **Reading a session transcript** | no code path opens the field the vendors ship in every hook payload | `tests/repository/transcript-path.test.ts` — a gate rather than a reviewer's grep, with the needle assembled at runtime so the file does not match its own source |
| **Hooks** | neither adapter emits a hooks file; a not-used list in each `capabilities.ts` resolves `plugin_hooks` **before** the table or any observation is consulted, so a stray `observed` cannot make it `yes` over a file that does not exist (`packages/adapter-claude/src/capabilities.ts:31-32,73`, `packages/adapter-codex/src/capabilities.ts:26-27,80`) | `packages/adapter-claude/src/plugin.test.ts:50` asserts no `hooks/hooks.json` is emitted, so restoring hooks has to delete an assertion rather than happen by accident; `packages/adapter-claude/src/capabilities.test.ts:103,116` pins the state and its precedence |
| **Automatic capture** | nothing fires on session start, session end or compaction. Capture content is agent-authored, and `capture` refuses without `--text` or stdin rather than sourcing text itself (`apps/cli/src/commands/capture.ts:339-346`) — the `session_end` trigger could only supply that text by reading a transcript, which the row above refuses | `apps/cli/src/commands/capture.test.ts`; follows structurally from hooks being absent |
| **Telemetry, a scheduler, and Git mutation** | `telemetry` is `z.literal(false)` in the configuration schema (`packages/core/src/config/loader.ts:209`) | `packages/core/src/config/config.test.ts` |
| **Reading anything outside this repository** | `npm run lint` runs a git-driven enumerator over tracked *and untracked* files | `tests/repository/self-containment.ts` — a lint rule rather than a sandbox, and it says so: it refuses the obvious spellings so that crossing the boundary has to be deliberate and visible in a diff |

---

## 8. What the evidence is worth

`tests/security/` holds **nine suites and 90 cases**, counted by collection — `npx vitest list --root tests security` — rather than by adding deltas to a remembered total. Two of the nine are not in design spec §9's
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
the `BACKLOG.md` line below both said twenty-three, and both were wrong by one against every other
number in them. The four watched failures in that round are the raw-folder escape and the three
`ingest-apply` interruptions whose capture used to be rolled back to `accepted` beside its own notes;
the fifth evidenced case is the NEW-14 refusal, which is a conversion rather than an addition. Round
two's evidenced case is `capture` writing an observation into a relocated quarantine.

**Read the next paragraph before the table, because this is the one part of this document a reader
cannot check against the tree.**

**The suites do not record which of their own cases was watched fail.** `grep -rniE "revert"
tests/security/` returns nothing; no suite carries a marker, a count, or a list. What exists in this
repository is the **aggregate**, in `BACKLOG.md` §5 — "47 of its 85 cases carried that evidence and 38 did not; recounted at 90 on 2026-08-17" — quoted in full, because an earlier version of this line dropped the recount clause. The source reads "38
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
injection, transaction and network suites, from DOS-P6 onward; `npm run check` on every commit;
exact-path staging; and a **fresh-context review by an agent that is not the author** on every
code-producing task.

**One gate-integrity item is open and unowned, and this one *is* in the tree** — `ORDER.md` carries
the measurement table. `apps/cli/src/commands/doctor.test.ts:228` needs 3.19 s of a 20 s budget on
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
(`apps/cli/src/commands/ingest.ts:823-832`).
