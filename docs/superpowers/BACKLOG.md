# Developer OS — Outstanding Work Backlog

> **Starting a session? `SESSION.md`. Looking for what to do next? `ORDER.md`.**
> Three files, one job each: `SESSION.md` is the procedure, `ORDER.md` is the queue, and
> this one is the reference — what each outstanding document must contain and why it
> exists.

Single index of everything that still has to be done, for this product and for the
founder's legacy runtime. Consolidated on 2026-07-27 from the founder's two legacy
repositories; neither of those holds plans, specs, or open roadmap items any more.

**Reconciled against the code and against both legacy trees on 2026-08-08.** Finished work
was removed rather than ticked: what stays is what somebody still has to do, plus the
constraints and lessons that outlive the work that produced them. Two findings from that
pass are open items — §1 — and the legacy checklist gained one and shed most of another, §6.
Anything deleted is in git history; where a deletion carried something durable, the
replacement text says where it went.

**Rules for this file**

- Order lives in `ORDER.md` and detail lives here. When they disagree about sequence,
  `ORDER.md` wins; when they disagree about content, this file wins. Never copy a
  requirement into `ORDER.md` — link to the section instead.
- Every new plan or spec is registered here in the same change that creates it, and gets a
  row in `ORDER.md` in that same change.
- Status values: `done`, `in progress`, `open`, `blocked`, `decision required`.
- A step is `done` only when its own evidence exists. A passing local tree is not
  evidence; a commit is.
- **`plans/` holds only unfinished work.** When a plan's last step is done, delete the file
  in the same commit that closes it, after carrying any evidence a later step still needs
  into the document that needs it. Git history is the archive — do not keep a `completed/`
  or `archive/` directory.
- **A spec outlives its plan.** While a subsystem is unfinished its spec is the reference
  for review and drift checks. After it ships, the spec is retained only while another
  document still points at it as the design of record — §3's table is the current list, plus
  the kernel-lock spec in §8 — and its status line must then say so, in the past tense.
  **One spec is exempt because the rule's unit does not fit it.** The product design spec
  specifies eight subsystems at once, so no single status line could be truthful: Foundation
  and DOS-P2 through DOS-P5 have shipped, DOS-P6 through DOS-P9 are unbuilt. It carries per-section
  markers instead — §8, §9.1 and §9.3 each say what actually shipped — which is finer
  granularity than this rule asks for. Do not give it a global past-tense status line, and do
  not treat it as a deletion candidate while any subsystem it specifies is unbuilt.
- **Every plan this program has finished is deleted, and all of them are in git history.** The
  four subsystem plans are in §3's table with their recovery commits; the other three are the
  brain/claude-shared English migration (`28a0ddc`), the kernel transaction lock (`cf70342^`) and
  Foundation (`c4f883f^`). A deleting commit does not contain the file it deleted, which is what
  the `^` suffixes mean; a commit written without one is already the last that *contains* the
  plan. Stripped in part rather than deleted: the program plan's Tasks 0–1 and the Brain plan's
  Tasks 1–2, both recoverable at `9f82901`, which is the commit that added the superseding notes
  rather than one that removed anything.
- `docs/superpowers/plans/legacy-runtime/` is publication-excluded and, since 2026-08-10,
  **empty** — its one document closed and was deleted. The exclusion stands for anything
  written there again.

---

## 0. Status at a glance

Open work only. Program Tasks 0 to 5 are closed and are not rows here.

| Area | Where | What is left |
|---|---|---|
| Program (umbrella) | 1 plan | Tasks 6–9 open, **25 unticked steps**; Tasks 0–5 closed and not rows here |
| DOS-P6 | spec approved and plan written, both 2026-08-13 | **three unticked steps** — Task 17 Step 3 (the Codex detection row, blocked on NEW-21) and Task 19 Steps 5–6 (close the documents, run the gate), which wait on it. Seventeen of nineteen tasks landed 2026-08-13/14/15 and their step lists are deleted |
| DOS-P7 | no document yet | 1 spec, 1 plan, 1 implementation |
| DOS-P8 cutover, DOS-P9 release | program plan Tasks 8–9 | every artifact; one open decision each |
| Repository-level | §1 | **twenty-two rows**, and the breakdown adds up: **none** awaits a fix from Track R **R2** — all five decided rows closed 2026-08-17; **four** belong to somebody else (NEW-21 the founder's and blocking A10, NEW-20 and NEW-13 deliberately not fixed, NEW-7 needing a machine with Obsidian); **eighteen** came out of R2's own reviews — NEW-27 and NEW-28 from closing NEW-12, NEW-24/25/26/29 from NEW-16, NEW-30 and NEW-31 from NEW-11, NEW-32, NEW-33 and NEW-35 from NEW-15, NEW-34 from Foundation request 2, and NEW-36, NEW-37, NEW-38 and NEW-39 from request 3, NEW-40 from Task 8, and NEW-41 from Task 9 |
| Repository infrastructure | §5 | **nothing** — the last row left 2026-08-14 with `docs/architecture/threat-model.md`; §5 is now what four closures left behind |
| Legacy runtime | §6 | **nothing** — closed 2026-08-10, checklist deleted; §6 is what a cutover still needs to know |
| Outside this room | `ORDER.md` Track L | license approval, remote verification |

**Foundation, DOS-P2, DOS-P3, DOS-P4 and DOS-P5 are closed.** None is a row above. What each left
behind is `docs/architecture/foundation.md`, `brain.md`, `workflow-schema.md`, `claude-adapter.md`
and `codex-adapter.md`, plus §2 here for Foundation's open questions; every one of those plans is
deleted and git history is the archive. **Both adapter notes are written for DOS-P6**, the one
subsystem that consumes both — `codex-adapter.md` §9 carries the two-adapter table, and its §11 and
`claude-adapter.md` §9 carry twenty-four residuals between them, thirteen of them DOS-P6's.
DOS-P3's note is still the one to read before touching the compiler: its §7 records four canonical workflows that say less than the product
spec does, each with an owner, and its §8 records nine residuals.

**This repository is public, deliberately, as of 2026-08-10.** It was pushed to
`github.com/msolecki/developer-os` and the founder confirmed the visibility after being shown
what §6 discloses. Two consequences worth knowing before writing anything here:

- **`docs/superpowers/plans/legacy-runtime/` was published** for the days it existed alongside
  a remote, despite its own header calling it publication-excluded. Deleting it on 2026-08-10
  does not un-publish it — git history is public too — which is why §6 now states what that
  document disclosed rather than relying on the file being gone.
- **The self-containment lint does not guard this.** It allowlists that directory by design —
  it exists to stop an agent *reading* the founder's machine, not to stop the repository
  *publishing* what was already written down. Nothing was bypassed; there was never a check
  here. If publication control is ever wanted, it is a new rule, not a fix to that one.

**Self-containment.** No Developer OS task reads the founder's legacy runtime. Program
Task 0 froze everything the build needs into `docs/migration/`, and since 2026-08-01
`npm run lint` fails on any reference to those paths outside a named allowlist — over
tracked *and* untracked files. The only remaining contact with the legacy machine is the
exit checklist in §6 and the read-only cutover in DOS-P8, both of which operate on the
founder's machine as user data, not as source material.

---

## 1. Open right now

Everything in this section is genuinely open. Nothing here is bookkeeping, and nothing closed stays
here: NEW-1 through NEW-6, NEW-8, NEW-9, NEW-10, NEW-14, NEW-17, NEW-18 and NEW-19 were removed as
they closed, between 2026-08-10 and 2026-08-15, and **NEW-12 on 2026-08-17**. What a closed item
leaves behind is a row in §8, a clause in a spec, or a test; if it left nothing, it was not worth
recording. Git history is the archive.

**Every row carries a number, including the residuals.** Three rows were briefly named
`NEW-16's residual` — all three of them — and three code sites cited that name as if it identified
one. A residual is a defect like any other and gets `NEW-24` through `NEW-28`; the row it came from
is named in its own text, which is where the lineage belongs.

**Twenty-two rows, and they are not all the same kind of open.** **None is waiting on R2 to land a fix.** NEW-11, NEW-12, NEW-15, NEW-16 and NEW-22 all closed
on 2026-08-17; what remains here is somebody else's or a residual of that work. **NEW-11 closed
2026-08-17** and left NEW-30, the fourth field with the same gap. All four
that were waiting on a decision got one on 2026-08-17; **NEW-16 closed the same day** and left three
residual rows of its own — NEW-24, NEW-25 and NEW-26. They stay here until R2 closes them, because a row leaves this
section when its fix is committed, not when its question is answered. Four are somebody else's:
**NEW-21** the founder's, **NEW-20** and **NEW-13** registered as deliberately-not-fixed, and
**NEW-7** waiting on a machine with Obsidian.

**Eighteen are new, and every one was found by a fresh-context review rather than by the work itself** —
NEW-27 and NEW-28 from the review that closed NEW-12; NEW-24, NEW-25, NEW-26 and NEW-29 from the one
that closed NEW-16; NEW-30 and NEW-31 from the one that closed NEW-11; NEW-32 and NEW-33 from the
one that closed NEW-15; NEW-34 from the round that closed Foundation request 2, NEW-35 from the review that verified NEW-15's closure, and NEW-36 to NEW-39 from the review rounds on request 3, NEW-40 from Task 8 and NEW-41 from Task 9 —
NEW-34 the only one of the eighteen that is a defect in a **gate** rather than in the product, and
NEW-35 a residual that existed all along and was filed under the wrong row. A seventeenth, NEW-23,
was found the same way and **closed the same day** by Track R Task 1b, which built the gate it asked
for.

**The security review is the one that most earns the gate**, and it is worth saying which findings
were code rather than prose: it found the trust check **accepting a symlink planted in a
world-writable directory** while refusing a real file in the same place, then — after that was fixed —
found the same hole one level in, where a symlinked *directory* hides the attacker's parent from a
lexical walk. Both were reproduced against the real filesystem before they were believed. It also
found a **third executor** the change had missed, `doctor --probe`, which spawns a subcommand that
mutates state under the user's home.

**That is the ordinary yield of the review gate, and the number is the argument for it.**
Five defects
closed cleanly would have left this section at four rows; closing them honestly left it at twenty-two.

**They are not all the same thing, and the honest split is worth more than a round number.** Two —
NEW-25 and NEW-29 — are properties that predate everything: an overlap rule that was unreachable
while nothing called the code, and a wall-clock assertion that was always going to meet a loaded
machine eventually. Two are **costs the new capability created**: NEW-24 and NEW-26 could not have existed before
there was a `[redaction]` table to misconfigure. Two are **consequences of the previous fix**, and
say so in their own tenses: NEW-27 is what *will* happen to the first real write scope, NEW-28 is
what *can no longer* happen in `ingest`. An earlier draft of this paragraph claimed four of the five
predated the work, which is both false and weaker than the truth — the argument for the gate is not
that these were lying around, it is that **every one was found before commit by an agent that wrote
none of it**. Closing a defect moved a trap one field over, made one branch unreachable, and the fix for a stale
line citation broke twelve more — none of it visible to the author.

**And wiring this feature made two latent bugs reachable rather than one.** NEW-25's overlap rule is
the one this paragraph already names. The other never reached a row: `addUserPatterns` folded the
needle whole-string while the haystack folded per character, so Unicode's Final_Sigma mapping made a
Greek company name in capitals configurable and **silently never redacted** — no error, no finding.
That disagreement predated all of this and was invisible only because no production caller passed
`userPatterns`. It was found and fixed inside the same review cycle, which is why it is a sentence
here rather than a row below.

**A row being open is not an invitation to implement it** — read which group it is in first. NEW-15 is
the cautionary case: it read like an implementation for a day, and cost a full task to discover it was
not.

### NEW-21 — one successful `codex exec` completion is still owed

- **Status:** open, created 2026-08-15 when DOS-P6 Task 17 ran and could only half discharge itself ·
  **Owner:** the founder, because it spends their credits · **Size:** S ·
  **Blocked until the account's usage limit resets**
- **What happened.** The founder accepted the spend for this subsystem in principle on 2026-08-13,
  authorised this specific run on 2026-08-15, and the run was made against
  `codex-cli 0.147.0` with the production argv byte for byte. **The account's usage limit was
  exhausted**, so every `codex exec` ended `turn.failed` and no run reached a model response. There is
  no API-key fallback configured and no local OSS provider installed, so `--oss` was not an option
  either.
- **What the failed run did settle**, and it is not nothing: `--json` really is JSONL, one JSON object
  per line; **`type` is a discriminating field** present on every line, with an observed vocabulary of
  `thread.started`, `turn.started`, `error`, `turn.failed`; and the synthetic vocabulary the adapter's
  own tests had guessed (`session.created`, `item.completed`, `turn.completed`) is **wrong**. All of it
  is recorded in `specs/…-codex-adapter-design.md` §14.1's amendment of 2026-08-15 and pinned against
  `tests/fixtures/codex/observed-exec-stream.jsonl`.
- **What is still owed, and one run closes both.** First, whether a **successful** turn's terminal
  event is the final response — the question that would let `finalJsonlLine` stop being provisional,
  and the one a failed turn cannot answer. Second, the **Codex row of `AGENT_DETECTION_ROWS`**: no
  shell command ever ran, so no environment was observed, and per knowledge-pipeline spec §10.3 the row
  is left absent rather than guessed. Until it lands, every capture taken inside a Codex session records
  `sourceAgent: "unknown"`; those captures are correct and are never rewritten.
- **A narrowing is available and was deliberately not taken.** A discriminating field now exists to
  filter on, but spec §14.1 requires a narrowing to be proven against a stream where the old rule and
  the new one agree, and a failed turn contains no final response for two rules to agree about.
- Cross-referenced from `docs/architecture/codex-adapter.md`, `docs/architecture/knowledge-pipeline.md`
  §10.3 and `docs/architecture/threat-model.md` §5.5. **It is what keeps DOS-P6's Task 19 Steps 5–6
  from closing**, because §8's Codex spec §14.1 row is discharged by Task 17 alone.
- **How to close it**, carried here because the plan that holds the instructions is deleted when
  DOS-P6 closes: rerun `codex exec --json` with the production argv (`--output-schema` at the shipped
  `ingest.stage.schema.json`, `-s read-only`, `--skip-git-repo-check`, `-C <working root>`) **with
  stdin closed**, and record whether the final response is the last parsing line and whether the
  discriminating `type` is worth filtering on. Then run each vendor and observe what a child process
  of it actually sees, with every `CLAUDE*`/`CODEX*`/`ANTHROPIC*` variable stripped from the parent —
  an inherited marker detects the session that ran the experiment, not the vendor. Amend
  `specs/…-codex-adapter-design.md` §14.1 and `…-knowledge-pipeline-design.md` §10.3 with the
  observation, dated, and **do not quietly promote the rule to verified**. A narrowing needs a stream
  where the old rule and the new one agree.
- **Expect the fan-out.** Adding the Claude row falsified prose in fourteen files, because "the table
  is empty" had become load-bearing in docblocks, tests, three architecture notes, a spec, this file
  and `ORDER.md`. The Codex row will do it again; sweep for the class rather than fixing instances.
- **The founder chose on 2026-08-15 to hold DOS-P6 open for this** rather than close the subsystem
  and carry it as a residual. `ORDER.md`'s note beside Task 19's Steps 5–6 records why that was a
  live option and why it was declined.

### NEW-20 — `capture` proves its quarantine root, then follows the path again

- **Status:** open, found 2026-08-15 by the fourth independent review of DOS-P6 Task 19 · **Owner:**
  whoever next touches `apps/cli/src/commands/capture.ts` — DOS-P7 by default · **Size:** XS ·
  **Security** · **Theoretical: it needs a won race, and it is not a regression**
- **The window.** `resolveContainedRoot` proves the quarantine directory resolves inside the content
  root (`apps/cli/src/commands/capture.ts:714`) and its canonical answer is then **discarded by
  design**: every later operation re-follows the *declared* path — `readExistingCapture` (`:742`),
  `writeCapture` (`:751`), and `validateChangePlan`, which re-canonicalizes the target and the owned
  root fresh (`apps/cli/src/commands/capture.ts:579`, `:598`). Because both are re-resolved together,
  containment between them holds wherever the link points *now*, and nothing re-asks the content-root
  question. Swapping the quarantine symlink between the check and the write redirects the capture
  outside the vault.
- **Why it is registered and not closed.** The declared path is the contract, ruled so on 2026-08-15:
  it is what `CaptureResultV1.path` prints and publishes, and it is what makes
  `assertUsableRoots`'s ancestor test comparable at all — round two's canonical root pinned this
  window by construction and cost both of those. Reversing that to close a race would trade a
  certainty for a maybe.
- **What it costs an attacker and what it buys.** Local write access to the vault *plus* a won race.
  What it buys is redirection of a capture into a directory they chose — the same primitive the
  steady-state symlink used to give for free, which is now refused deterministically. **It is not a
  regression against the pre-round-two baseline**, which used declared paths with no check at all.
- **The shape of a fix, if anyone wants it:** canonical root for `target` and `readExistingCapture`,
  declared path for `CaptureResultV1.path` alone. That keeps the contract and closes the window, at
  the cost of the two paths disagreeing inside one function.
- **A second instance of this shape landed 2026-08-17 and is registered here rather than as its own
  row.** `assertTrustedExecutable` resolves a discovered binary, walks the ancestors of **both** the
  resolved and the declared path, and then the command executes it by path — the same check-then-use
  window, for the same reason: closing it needs an exec-by-descriptor this runtime does not offer.
- **What it costs an attacker is *not* identical to this row's own window, and an earlier draft said
  it was.** This row's window sits on a path only the user can write, so winning the race
  presupposes the access the check protects. The trust check's window can sit on a directory the
  attacker owns — which is why the guard walks the declared path's directories as well, so owning
  that directory is refused outright rather than merely raced. What remains is the narrower case
  where every directory is trusted and the *file* is swapped between check and exec.
- Cross-referenced from `docs/architecture/threat-model.md` §5.2, where the boundary is described.

### NEW-31 — a stray zero-width joiner still hides a duplicate title

- **Status:** open, registered 2026-08-17 by the review that closed NEW-11 · **Owner:** whoever next
  touches `packages/brain/src/lint/lint.ts` — DOS-P7 by default. **Not `text.ts`**: the last bullet
  says closing this is a lint finding on the title rather than a change to the grouping key, so a
  trigger on the key's own file would never fire on the file the fix touches · **Size:** S · **A deliberate trade,
  recorded because the class is not complete**
- `perceptualKey` exempts **U+200D ZERO WIDTH JOINER**, and it has to. Being `Cf` and
  default-ignorable is why it *would* be removed; the reason it must not be is that without the
  carve-out a title reading `Team` plus a family emoji grouped with the same title plus three
  separate people, and Devanagari's explicit half-form grouped with the conjunct. Those are different
  glyphs, which is the whole of what a perceptual key measures.
- **U+200C ZERO WIDTH NON-JOINER is the mirror case and is already lost, one layer earlier.** It is
  semantically load-bearing in Persian and in Devanagari's explicit-virama form, and
  `screenControlCharacters` deletes it **before** `perceptualKey` ever sees it — so those pairs group
  today and did before this task. Pre-existing and not this row's to fix, recorded so the next reader
  does not conclude the row was half-researched.
- **The cost is the failure NEW-6 and NEW-11 were both opened for, scoped to one character.** Between
  Latin or Cyrillic letters a joiner joins nothing, so `Deploy<ZWJ>keys` and `Deploykeys` render
  **glyph-identically in `catalog.md`** — `screenControlCharacters` preserves the joiner by the same
  decision — and key differently, so no duplicate is reported. A stray joiner is exactly what a paste
  out of a web page leaves behind.
- **The trade is the right way round and that is why this is a row rather than a fix.** Over-grouping
  corrupts a report about genuinely distinct notes; under-grouping misses one. But the previous
  docblocks presented the class as complete, and a reader meeting `Deploy<ZWJ>keys` in a real vault
  would reopen NEW-11 from scratch.
- **Closing it means asking whether a joiner between two characters that do not join is itself the
  defect** — a lint finding on the title rather than a change to the grouping key — which is a
  different question from the one NEW-11 answered.

### NEW-30 — `aliases` is the fourth field with no visible-character rule

- **Status:** open, registered 2026-08-17 by the review that closed NEW-11 · **Owner:** whoever next
  touches `packages/brain/src/schema/note.ts` — DOS-P7 by default · **Size:** XS · **The weakest of
  the four, and registered rather than fixed for that reason**
- NEW-11 gave `tags` and `summary` the predicate `title` already had. **`aliases` is validated by
  `isStringArray` and nothing more**, exactly as those two were, so `aliases: ["\u200B"]` passes.
- **It has no rendering symptom**, which is why it was left: an alias reaches neither the tag cloud
  nor the catalog row. It reaches **link resolution** (`byAlias`), **search tokenisation**, and
  `index.json` through `IndexedNote.aliases` — so the field is consumed, not inert, and the
  consequence is an alias key nobody can type rather than a row that says nothing.
- **The remaining fields were checked and are covered**: `sources` already raises a `provenance`
  error for a blank value, `title` has the rule, and everything else is an enum, a date, an integer
  or the literal `1`. `aliases` is the last one.
- Closing it is one `isVisuallyBlank` call beside the two NEW-11 added, plus a decision about whether
  a blank alias is a warning like a blank tag or an error like a blank title.

### NEW-32 — a middle symlink hop is on none of the trust check's chains

- **Status:** open, registered 2026-08-17 by the review that closed NEW-15 · **Owner:** whoever next
  touches `packages/platform-macos/src/macos.ts` — DOS-P7 by default · **Size:** S · **Security**
- `assertTrustedExecutable` walks three chains: the resolved target's ancestors, the declared
  directory's ancestors, and the ancestors of that directory canonicalized. **A hop in the middle is
  on none of them.** `<trusted>/claude` → `<attacker>/hop` → `/bin/ls` passes: the declared chain is
  `<trusted>` upward, the resolved chain is `/bin` upward, and `<attacker>` is visited by nobody.
- **The hop can be a *directory* component, not only the last one, and this is the bullet that stops
  the fix being wrong.** A declared path whose *directory* redirects through the attacker's tree and
  then out again escapes all three chains the same way: `<r>/x` → `<attacker>/y`, and `<attacker>/y/z`
  → `<clean>/z`, so `<attacker>` is traversed by the kernel and appears on none of them. Someone
  repairing this from the file-level example alone writes a loop over the **final component's** link
  chain, ships it, and that case still passes.
- **Closing it needs stepwise resolution over every component** — `readlink` in a loop, checking the
  directory of each hop of each component — rather than a fourth canonicalization, which is why it is
  a row and not a line.
- **Severity is below the two holes that were fixed**, and honestly so: it needs the user to already
  have an install whose symlink chain passes through somewhere attacker-writable. But multi-hop
  layouts are exactly what this product's own vendors use — `~/.local/bin/claude` resolves through
  two directories — so the shape is native to the problem rather than exotic.
- **Not the same residual as NEW-20**, and an earlier draft conflated them: NEW-20 is a file swapped
  between check and exec on a path only the user can write. This is a *link* swapped at a hop nobody
  inspected.

### NEW-35 — the executable trust check is check-then-use, and was filed under the wrong row

- **Status:** open, registered 2026-08-17 by the review that verified NEW-15's closure · **Owner:**
  DOS-P7 · **Size:** L, and possibly not closable on this runtime · **Security, accepted**
- `assertTrustedExecutable` resolves the path, stats the target and every ancestor, and returns; the
  caller then spawns **by path**. Anything swapped in between is executed unchecked. Closing it needs
  exec-by-descriptor — `fexecve`, or spawning through an already-open `O_PATH` handle — which Node
  does not expose and macOS does not offer in the form this would need.
- **The founder accepted this window when the rule was decided**, so it is a registered cost rather
  than an oversight. It is registered *here* because it had no row: `macos.ts` said it was NEW-20,
  and [[NEW-32]]'s own text says in as many words that NEW-20 is a different residual — `capture`'s
  quarantine race, on a path only the user can write. The correction reached the BACKLOG and never
  reached the code, so the file was written with the wrong row already recorded elsewhere.
- **It is the weakest of the three residuals on this guard**, and the ordering matters: NEW-32 is a
  bypass that needs no race at all, and the ACL blindness means the mode check is a floor rather than
  a proof. A reader who fixes only this one has fixed the least of them.

### NEW-33 — a root-owned group-writable directory refuses the binary under it

- **Status:** open, registered 2026-08-17 · **Owner:** the founder, because it is a policy question ·
  **Size:** XS to change, unverified against a real machine
- The decided rule allows group-writable **when the directory's owner is the current uid**, which is
  what makes `/opt/homebrew/bin` pass. A directory owned by **root** and group-writable — `/usr/local`
  and `/usr/local/bin` are `drwxrwxr-x root:admin` on some Intel and legacy macOS installs — is
  refused, so a `claude` under one makes `ingest` exit 5.
- **That is the same class of false refusal that got the strict guard withdrawn**, on a machine shape
  nobody here has tested. It is also arguably correct: group `admin` means any admin user can plant a
  binary there, which is the threat.
- **Not changed unilaterally.** Whether root-owned group-writable is acceptable is the founder's call,
  on the same footing as the decision that produced the current rule.

### NEW-34 — the citation gate bounds-checks addresses it cannot content-check

- **Status:** open, registered 2026-08-17 when R2 Task 6 closed · **Owner:** DOS-P7 · **Size:** M ·
  **A gate that passes over exactly the failure it was built for**
- **What happened.** Task 6 added ~250 lines to `executor.ts` and ~125 to `doctor.ts`, and **twenty
  `path:line` citations across five documents silently came to point at unrelated code** — three of
  them the mechanism cells of security-invariant rows in `threat-model.md`, including "a file that
  changed under a running command is not overwritten", which pointed at the `expectedBeforeHash`
  compare and now pointed at a local destructuring. `npm run check` was green over every one.
- **Why the gate cannot catch it.** `tests/repository/citations.test.ts` resolves each citation and
  bounds-checks the line number. A citation that resolves and is in range passes, whatever is on the
  line. Its own docblock names this failure and prescribes remapping "immediately before staging" —
  a procedure, enforced by nothing, which this task skipped in five successive commits.
- **Content anchoring is the obvious fix and it is not obviously available.** Verifying that a
  citation still points at what it pointed at requires a baseline, and the only baseline is the
  previous commit: a check written that way is meaningful before a commit and vacuous after it. The
  alternatives are a stored digest per citation, dropping line numbers for a searchable anchor
  (`` `executor.ts` — `pruneBackups` ``), or accepting the drift and re-running a remap script as a
  release step. **Which is a design decision, not a defect fix**, which is why this is a row rather
  than a change.
- **A citation with no line number is not checked at all**, and that is the gap that matters most for
  a boundary's Evidence cell: `threat-model.md` §5.9 cites `tests/security/backup-prune.test.ts` by
  name, the extractor takes nothing from it, and the file was **untracked** while the gate stayed
  green. A commit that forgot to add it would leave the security boundary citing a file that is not
  in the repository. Checking bare filenames against `git ls-files` is cheap and closes it.
- **The extractor has a second blind spot, found the same way.** A citation written as a bare
  `` `:335-337` `` after a *different* file's path in the same sentence inherits the wrong carrier —
  a slashed path with no line number neither sets nor clears it — so the gate bounds-checks the
  wrong file. Any fix has to address both.
- **Measured, 2026-08-18, and the number is the argument.** A full audit of the two architecture
  notes found roughly **55 wrong citations out of 274** — about one in five — clustering by file with
  a uniform per-file offset, which is the signature of code growth without a remap. Twelve of them
  are one mechanical fact: `secretScan` grew 21 lines and every `validate.ts` citation after it
  points at the preceding branch, so each sub-claim describes the wrong check.
- **Three review rounds of hand repair did not converge.** Round 7 repaired ~15 citations; round 8
  found ten of those repairs off-by-one or in the wrong function, plus a **fabricated quotation**
  attributed to a file that never contained it; round 9 found two of round 8's repairs wrong in turn.
  Hand repair at this density introduces defects at roughly the rate it removes them.
- **And the remap script is not safely repeatable**, which is the finding that closes off the easy
  answer. It anchors on a baseline commit; run it once and the citations no longer match that
  baseline, so a second run re-anchors on content that has moved and shifts correct citations to
  wrong ones. Verified twice. It is a one-shot tool per baseline, not a gate.
- **The remap script this session used is the interim answer** and is not committed: it reads each
  citation's content from `HEAD`, finds the unique matching span in the working tree, and rewrites
  the address. It resolved sixteen of twenty automatically; the other four had either no unique match
  or twelve, and needed a human. **And it is not sufficient**: a byte-faithful remap lands a
  citation on syntactically identical code that supports a different claim, and it cannot see a
  citation that was already wrong before the change — a following review found seven of each kind,
  including two paragraphs asserting security boundaries that had closed.
- **The prose has the same generator, and it is the half that misleads.** NEW-15, NEW-16, NEW-17,
  NEW-18 and NEW-19 have each been asserted **open** in at least one document after closing —
  NEW-18 and NEW-19 for three days, through three review rounds explicitly hunting for that. A
  renamed symbol (`resolveQuarantineRoot` → `resolveContainedRoot`) was still named as the mechanism
  of a containment boundary in five places. These are not the residue of one bad pass; they are new
  instances each round.
- **What would actually close this, in order.** (1) Drop line numbers for searchable anchors —
  `` `executor.ts` — `pruneBackups` `` — because line-number citations at this density are not
  maintainable by review, and a name is checkable by grep at test time. (2) Derive the suite and case
  counts at test time and fail on drift, instead of restating them in seven documents. (3) Gate on
  no closed `BACKLOG` id being referenced in the present tense. (4) Stop appending correction-history
  paragraphs to the architecture notes — that layer is now the highest-defect-density prose in the
  repository and is itself where several of these false claims were introduced. A committed version would at least make the procedure runnable.

### NEW-36 — redacting a published payload renormalizes its paths and rewrites its keys

- **Status:** open, registered 2026-08-19 by the review that closed Foundation request 3 ·
  **Owner:** DOS-P7 · **Size:** M · **Two defects, one cause**
- **`redactText` returns NFC**, and `redactPayload` runs every string leaf through it — so a
  path published on `CliError.data` comes back renormalized. macOS hands back NFD, so
  `notes/café.md` in — an `e` followed by a combining acute, which is what macOS hands back — goes `notes/café.md` out, a single precomposed codepoint. The two render identically and are different bytes, which is the entire defect and is why an earlier version of this row demonstrated it with two NFC strings that were byte-identical and a `--json` consumer that opens
  `data.refused[].appliedNotes[0]` can get `ENOENT` for a file that exists. `error.paths`
  beside it was **not** redacted at all, which was worse than a divergence and is fixed:
  `failureFrom` redacts it and `recovery` now, after a review demonstrated with this
  repository's own sentinel that a secret in a model-chosen note path published raw there
  while the same string redacted in `message` and in `data`. What remains of this row is the
  NFC divergence: `data`'s copy of a path is renormalized and `error.paths` is not. `threat-model.md` states byte-exactness as a boundary.
- **Keys go through the same redactor, and the redactor carries the user's patterns.** A
  founder whose configured `[redaction] patterns` entry is a substring of `order`, `code`,
  `message`, `captureId`, `leftAt` or `appliedNotes` gets a document that still declares
  `schemaVersion: 1` and no longer matches it — measured:
  `patterns = ["captureId"]` turns the key into `[REDACTED:user-pattern]`.
  **Product-chosen enum *values* go the same way**, and this bullet understated itself by
  naming only keys: `agent`, `status` and `leftAt` carry strings the product picked, so a
  founder with a client called *Staging* has `leftAt` rewritten and the document stops
  matching its own schema for a second reason. Same cause, same fix.
- **The silent-drop half closed the same day it was registered**, and this bullet said
  otherwise for as long as it took a review to notice. `walk` rebuilt through
  `Object.fromEntries`, so two keys reducing to one redacted string collapsed and the
  earlier value was gone; it keeps both now, the second suffixed. What is left is the
  renaming, which is the part this row is actually about — `ingest` publishes `RunReportV1`
  on `data` and binds the user's patterns into the redactor that walks it, and the keys
  include `order`, `code`, `message`, `captureId` and `leftAt`.
- **Key redaction is not the mistake**; it exists because `{"Authorization: Bearer …": 1}`
  is a real shape for an attacker-influenced payload. The mistake is applying the *user's*
  substring list to keys the product chose. Closing it means a redactor that takes the class
  set to apply, which `redactText` does not offer today.
- **Both were found by reading the redactor, not by a failing test**, which is why this row
  exists rather than a fix: the change is to `packages/security`'s public shape, and
  Foundation request 3's scope was `CliError`.

### NEW-37 — a numeric leaf is outside the redactor's reach, by type

- **Status:** open, registered 2026-08-19 by the round-24 review of Foundation request 3 ·
  **Owner:** DOS-P7 · **Size:** M · **A limitation of the redactor's signature, not a bug in
  `redactPayload`**
- **What escapes.** `redactPayload` redacts every string leaf of `CliError.data`, and a
  `bigint` leaf too, because a `bigint` must be stringified to be published at all. A
  `number` leaf is published verbatim. So a founder whose `[redaction] patterns` entry is a
  numeric identifier — an account number, a client id — has it redacted wherever it appears
  as text and published wherever the product happened to carry it as a number.
- **Why it was not simply fixed there.** `redactText` is `string => string`. Applying it to
  a `number` publishes `"1"` where `RunReportV1` declares `schemaVersion: 1`, so every
  document would fail its own schema to redact a field the product chose. Redacting only
  *matching* numbers is worse: the document's type would then depend on the user's config,
  which is the same class of defect as NEW-36's key renaming.
- **Latent rather than live today.** The `number` leaves this product actually publishes are
  `code` and `schemaVersion` on `RunReportV1`, both product-chosen constants. It becomes
  live the first time a report carries a caller-derived number.
- **Closing it means a redactor that can answer about a value without changing its type** —
  the same shape NEW-36 needs, which is why the two should be taken together.

### NEW-38 — a quarantine filename reaches `--json` unscreened, through the message and the report

- **Status:** open, registered 2026-08-19 by the round-34 review of Foundation request 3 ·
  **Owner:** DOS-P7 · **Size:** S · **Pre-existing; found while proving the new field's
  boundary, and it is the boundary beside it that was overstated**
- **What escapes.** `selectCaptures` embeds the raw quarantine file name in an English warning
  (`ingest.ts:593-595`), `reportLines` appends the warnings to the failure message, and
  `failureFrom` redacts secrets but does not *screen* format characters. `JSON.stringify`
  escapes `\p{Cc}` and not `\p{Cf}` — the code's own observation — so a right-to-left override
  in a filename reaches a `--json` consumer through `error.message`. Measured on the very
  fixture that proves the payload carries the id: the message has the override and so, since
  2026-08-20, does `data.unreadable[].captureId`.
- **Widened 2026-08-20**, when the screen on that field was reverted. It had been added to
  close this row and did not: it collapses `/\s+/` and trims, so it renamed ordinary files
  while the *success* arm published the same filename raw the whole time. Byte-exactness is
  the repository's stated rule for paths; the exposure is one surface wider and one
  false remedy shorter.
- **Not introduced by Foundation request 3.** Every one of these strings already reached the
  user through the same failure message before the `data` slot existed, and `ingest.ts`'s
  `screened` docblock enumerates the exposure honestly. What the request changed is that
  `threat-model.md` now asserts a boundary next to it, which is why this is registered rather
  than left as a comment.
- **The fix is one seam, not one call site.** Screening a warning where it is *built* leaves
  the next warning unscreened; the durable answer is to screen where warnings become a
  message, which is the same argument `screened` makes for the report.


### NEW-39 — `error.paths` is the one published field the redactor never touches

- **Status:** open, registered 2026-08-20 by the round-45 review of Foundation request 3 ·
  **Owner:** DOS-P7 · **Size:** M · **Security, and blocked on NEW-36's capability**
- **The leak.** `failureFrom` redacts `message`, `data` — every leaf of it — and `recovery`,
  and passes `paths` through untouched. A note path is model-chosen, and `proposal.ts` treats
  that payload as written by someone who has just read attacker-supplied capture material. So
  one value can publish redacted in `message`, redacted in `data`, and **raw** in `paths`, on
  one document. Demonstrated by moving this repository's own sentinel from a note body into a
  note path: the `--json` invariant in `tests/security/sentinel.test.ts` goes red.
- **Why it is not simply redacted, measured.** The redactor's `high-entropy` class fires on a
  sixteen-hex capture id, so `_raw/quarantine/a1b2c3d4e5f60718.md` comes back
  `[REDACTED:high-entropy].md` — the most important path this product publishes — and every
  absolute path under a temporary directory goes the same way. Three existing tests catch it
  immediately. Blanket redaction trades a narrow leak for a broad breakage.
- **The fix is NEW-36's.** Applying the *pattern* classes to a path and not the heuristic one
  needs a redactor that takes the class set, which `redactText` does not offer. The two should
  be taken together, and this row is why NEW-36 is worth more than its own description
  suggests.
- **Recorded at three sites** so the exemption is not read as considered: `failureFrom`'s
  docblock, the sentinel suite's plant, and `threat-model.md`'s boundary row.


### NEW-40 — `ingest`'s two later writes still discard a hand edit, and one spans the agent call

- **Status:** open, registered 2026-08-20 by the round-2 review of Track R R2 Task 8 ·
  **Owner:** DOS-P7 · **Size:** S · **The residual of the precondition, stated because the
  first version of its docblock called it structurally impossible**
- **What is closed.** Each capture takes three writes. The first — the staging write — now
  supplies the digest of the bytes this run read, so a hand edit landing between that read
  and the transaction is refused rather than overwritten.
- **What is not.** The `ingested` write re-renders the *pre-agent* envelope over the whole
  file once the vendor returns, with no precondition. That gap spans the entire agent call —
  minutes, the longest read-to-write window in the product, and the one a user is most likely
  to edit inside because the command is visibly busy. Measured: an edit written from inside
  the vendor reply is silently overwritten and the run reports success.
- **The stated reason it could not be pinned was wrong.** "There is no caller read to pin" —
  but the run holds the exact bytes it wrote at staging, so `hash(renderCaptureFile({...
  envelope, status: "staging"}))` is available without re-reading anything. Whether to refuse
  there is a decision about what a user wants when their edit collides with a completed agent
  run, not a structural limit.
- **Why it was not taken in Task 8.** Refusing at that point strands work that has already
  been paid for — the notes are applied, and the capture is at `staging`. The right answer may
  be to refuse, or to detect and report rather than refuse. That is a product decision and the
  task was scoped to the mechanism.



### NEW-41 — `review`'s listing shows only `quarantined`, so half of the new transition is unreachable

- **Status:** open, registered 2026-08-20 by the round-2 review of Track R R2 Task 9 ·
  **Owner:** DOS-P7 · **Size:** S · **The half of the gap Task 9 did not close**
- **What Task 9 closed.** Spec §5.5 gained `accepted → rejected`, so a capture that `ingest`
  refuses deterministically can be rejected with a verb instead of a hand edit. That path
  works because the refusal *prints the capture id* beside the capture.
- **What it did not.** `listCaptures` filters `status !== "quarantined"` (`review.ts:255`), so
  `developer-os review` with no arguments never shows an accepted capture. The justification
  repeated in five places leads with "a user who accepts a capture and then changes their
  mind" — and that user cannot find the id through the product at all. They have the verb and
  no way to reach it.
- **Why it was not taken in Task 9.** Widening the listing is a change to what a bare `review`
  means, and the plan scoped the task to the transition. It is also not obviously a widening:
  a listing that shows accepted captures beside quarantined ones has to say which is which, and
  that is a display decision rather than a table row.
- **The measurement.** `review.ts:255` is one condition; the test that would pin it is one
  case. The cost of leaving it is that the headline reason for the transition is served only
  by the path nobody wrote it for.



### NEW-24 — a common redaction pattern refuses every ingest, undiagnosably

- **Status:** open, registered 2026-08-17 when NEW-16 closed · **Owner:** DOS-P7 · **Size:** S ·
  **Usability, and the schema deliberately does not bound it**
- **The failure.** `patterns = ["api"]` is accepted. Every proposed note whose path or body contains
  `api` raises a `user-pattern` finding in `secretScan`, `validateProposal` refuses, and **every
  ingest fails permanently**. The user has changed one line of `config.toml` and broken the pipeline.
- **A length floor cannot fix it, and one was tried.** Three characters was shipped for a few hours
  and withdrawn: it refuses `EY`, `BP`, `GE`, `3M` — registered company names, not abbreviations
  anyone can lengthen — and every two-character CJK name, which is the ordinary length there, leaving
  a user with a Chinese or Japanese client unable to configure it at all. What `" "` and `"e"` share
  is not shortness but that they match **ubiquitously**, which is a property of the text. The schema
  now refuses only a pattern with no non-whitespace character, which is what its own argument
  supported.
- **The shape of the fix is a redaction-time density check**: refuse, or warn, when a single pattern
  claims more than some fraction of a text. That measures the thing that actually goes wrong and
  never refuses a real name.
- **Half of the diagnosability is already closed.** `secretScan` now says a
  `user-pattern` match means "narrow the `[redaction]` table" rather than reporting it as a secret —
  the two have opposite remedies and shared one sentence. **The other half needs a type decision**:
  the message cannot name *which* entry matched, because `RedactionFinding` carries a class and a
  fingerprint and nothing identifying the table row. A pattern index would close it and the position
  is not a secret — but that type reaches a persisted capture envelope, so widening it is a decision
  rather than a gap to fill in passing, on the same rule that governs `CaptureRedactionFinding`.

### NEW-25 — two partially overlapping patterns cannot both redact

- **Status:** open, registered 2026-08-17 · **Owner:** whoever next touches
  `packages/security/src/redaction.ts` · **Size:** XS · **Not a regression**
- `addCandidate` is first-wins on overlap. Sorting user patterns longest-first closes **containment**
  — `["Acme", "Acme Corp"]` no longer leaves `Corp` in the clear, in either configured order — but
  two patterns that **interleave** still cannot both win: `["Acme Corp", "Corp Holdings"]` over
  `"x Acme Corp Holdings y"` leaves `Acme` in the clear.
- **Pinned by a test rather than left implicit**, so nobody reads longest-first as a guarantee it is
  not, and so the day someone changes the overlap policy the current behaviour is on record.
- Closing it means a candidate policy that can merge overlapping ranges rather than drop one, which
  is a change to every redaction class and not just this one.

### NEW-26 — the vendor's own output is redacted with built-in classes only

- **Status:** open, registered 2026-08-17 when NEW-16 closed · **Owner:** DOS-P7 · **Size:** S ·
  **A bounded gap, not a leak**
- `NodeProcessRunner` redacts a child process's stdout and stderr, and it is constructed at the
  **composition root** — before any configuration file has been read, so the user's `[redaction]`
  patterns are not available to it. The return leg from a vendor model therefore meets the four
  built-in classes and not the user's own.
- **The obvious fix is worse than the gap.** Building the runner per command would give it the
  config, and would also bypass the fake runner every command test injects, which is the seam the
  whole suite drives vendors through. Closing this properly means letting a runner's redactor be
  *replaced* after construction, which is a Foundation change.
- **What bounds it.** The direction that carries user content — the prompt — is covered:
  `parseCaptureFile` runs the config-bound redactor before `buildIngestPrompt` sees anything. The
  uncovered direction is model output, and `validateProposal`'s `secret-scan` runs the **config**
  redactor over every proposed note, so a proposal carrying a configured pattern is **refused**
  rather than written. What is genuinely uncovered is a diagnostic or a log line quoting vendor
  stdout.
- Recorded at both construction sites in `apps/cli/src/context.ts` rather than only here.

### NEW-29 — the standing suite has intermittent failures in at least three files, and they misdiagnose

- **Status:** open, observed 2026-08-17 by the independent review of R2 Task 2 · **Owner:** whoever
  next touches `packages/security/src/redaction.test.ts` — DOS-P7 by default · **Size:** XS ·
  **Gate integrity**
- **The first is a wall-clock ratio.** `packages/security/src/redaction.test.ts`'s *"adds bounded
  per-pattern overhead over a single-pattern baseline"* asserts `withPatterns < baseline * 3 + 20`
  over 512 KB. It failed once in three full-suite runs on a loaded machine and passed the other two.
- **The second is a different test and was found by widening the search.** On 2026-08-17 a review of
  R2 Task 3 ran `npm run check` four times and saw `apps/cli/src/commands/capture.test.ts`'s
  `workingDirectoryFingerprint` assertion fail once. That file passes 33/33 in isolation twice, the
  tree differed from the passing runs **only in documentation**, and the test runs in 878 ms against
  vitest's 5 s default — a 5.7x margin a plain timeout would have to eat. **Mechanism unconfirmed**:
  the message was not captured before the re-run, which is the mistake to avoid next time.
- **A third file joined the set on 2026-08-20** — the fourth recorded occurrence — found by the
  round-1 review of R2 Task 9:
  `apps/cli/src/commands/doctor.test.ts`'s *"gives each unusable redaction-key state its own
  message"* failed with `Test timed out in 20000ms` in a full `npm run check`, and passes 36/36 in
  isolation — where that single case takes ~20 s of a 36 s file, so it sits on the timeout rather
  than under it. Unlike the wall-clock ratio, this one has an obvious remedy: the case is slow
  because of what it does, and either the budget or the case should change. It is the same
  load-sensitive class and the same misdiagnosis risk, in a file neither earlier bullet names.
- **A third occurrence, 2026-08-17, during R2 Task 4** — `npm run check` ended `1 failed | 2058
  passed` and a rerun of the same tree was clean at 2059. **The name was lost again**, to the same
  mistake: the run was piped through `tail`, so the failing case scrolled past. That is two
  occurrences in one day where the mitigation below existed and was not followed, which is worth more
  than the datum — **pipe through `tee` and grep the file, never `tail` alone.**
- **So this row is a class, not an assertion**, and its mitigation below was written when it looked
  like one. Intermittents in three files with the same signature — red once in three or four full-suite runs on
  a machine loaded by the suite itself — points at parallel-worker contention rather than at either
  test's own bound.
- **The mechanism it guards is real and worth guarding**: it proves the scan did not regress to a
  per-position rescan.
- **The calibration was done properly and this row is not a criticism of it.** Its docblock records
  twenty no-load samples, **five under sixteen-way background CPU load**, and the buggy-shape floor
  for comparison. What that arm cannot capture is a *different* contention profile — vitest's own
  parallel workers with two thousand tests in flight, which is GC pressure and worker preemption
  rather than CPU saturation. **This is the second symptom of one cause**: the same docblock records
  an earlier version of this case blowing past its inherited default under parallel-worker load, and
  the author fixed that half with an explicit 2000 ms timeout. The remaining half is the ratio.
- **Until the fix lands, the mitigation is one sentence and it is free: a red run on either of these
  assertions is re-run once before anything is investigated, and only a repeated failure is a
  signal — but capture the message first.** A blind re-run is exactly what kept the second one
  invisible until a reviewer happened to run the suite four times. A regressed *shape* measured 6.32–7.99× against a 3× bound, so it fails every attempt —
  re-running cannot mask a real regression, which is what makes this safe to write down.
- **The cost is misdiagnosis, not flakiness.** A red `npm run check` on an unrelated commit sends the
  next person to the change in front of them. This repository already carries one such case
  (`ORDER.md`'s doctor-test starvation note) and has paid for it twice.
- **The shape of a fix**: assert on operation counts through an injected counter rather than on
  elapsed time, or mark the case `retry: 2` and say in its docblock that it is a smoke test for a
  shape rather than a bound. Raising the constant is the wrong move — it hides the starvation the
  same way a larger timeout did in the doctor case.
- **Not caused by the R2 work**, and the reviewer checked: the per-character folding helper was
  benchmarked at 29.3 ms against 29.9 ms inline over 512 KB, and `addUserPatterns` returns before
  the haystack is built when no patterns are configured, so a user without a `[redaction]` table
  pays nothing at all.

### NEW-13 — two artifact roots share one type, and only prose separates them

- **Status:** open, found 2026-08-12 by the fresh-context review of DOS-P5 Task 13 · **Owner:**
  DOS-P6, as the first consumer of `CodexAdapter` · **Size:** S
- `RenderedArtifact` is `{ path, contents }` for artifacts relative to **two different roots**.
  `renderCodexPlugin` returns paths relative to the plugin root — `.codex-plugin/plugin.json`,
  `skills/…` — and that is what `plugins/codex/` checks in. `proposeCodexInstall` resolves against
  the **marketplace root**, `<home>/codex`, because that is where `codex plugin marketplace add`
  points and where the descriptor lives. `renderCodexInstallTree` is the bridge that re-roots one
  into the other.
- **The two are structurally identical and semantically incompatible, and the plugin root is a
  *descendant* of the marketplace root — so the wrong one does not refuse.**
  `CodexAdapter.proposeInstall(CodexAdapter.renderPlugin(contracts), context)` type-checks, passes
  containment, installs one level too shallow at `<home>/codex/.codex-plugin/…`, and applies
  cleanly. Both members sit adjacent on the same frozen façade.
- **This exact class of mistake has already been made twice in this subsystem**, in both directions:
  the install proposal was first rooted at the plugin tree, so the descriptor was never proposed at
  all; correcting that then left `buildPluginTree`'s output under-nesting until `PLUGIN_TREE_PREFIX`
  was derived. Neither was caught by containment, because containment is not the guard here.
- **The fix is nominal, not documentary:** brand the two array shapes as distinct opaque types, so
  `proposeInstall` structurally refuses a plugin-root tree. Today the only thing between them is a
  docblock and a test asserting the two façade bindings are not the same function — which stays
  green under the misuse it describes.

### NEW-27 — a derived path will wear a write scope's name

- **Status:** open, registered 2026-08-17 by the fresh-context review that closed NEW-12 · **Owner:**
  whoever wires the first production write scope · **Size:** XS to prevent, S to rediscover ·
  **Security-adjacent**
- **NEW-12 itself is closed** — the prose half on 2026-08-15, the path half on 2026-08-17 by Track R
  entry R2, splitting `screenValueArgument` by provenance rather than narrowing its word list, which
  that row forbade. This is what the review found *while* closing it.
- **The same defect is set to reappear one field over.** `--add-dir` takes a directory, and
  `resolveScopeGlob` returns a **vault-relative** glob (`content/**` → `<contentRoot>/**`). So the
  first caller to pass a real write scope will join it onto the user's own vault root and hand
  `screenValueArgument` — which still carries the word list, correctly, because a scope's *name*
  originates outside — a value that is in fact a path this product assembled. A vault at
  `~/Danger/DeveloperBrain` refuses again, by exactly the mechanism NEW-12 closed.
- **`adapter-claude` carries the same trap**, in a different shape.
  `ClaudeInvocation.allowedTools`' own docblock records that derived read and write scopes translate
  into allowed-tool rules; it does **not** say what the resulting entry looks like. The concrete
  `Read(<path>/**)` form is an inference from the vendor's `--allowedTools` syntax, not a repository
  fact — flagged as an inference so nobody cites this row as evidence for it. Whatever the form, an
  entry carrying a derived path meets the word list the same way.
- **Nothing is wrong today and that is why this is a row rather than a fix.** No production caller
  passes a write scope — `ingest` passes `[]` under spec §3.3 — and keeping both rules on a field
  whose values are short vendor vocabulary is the right default until one exists. **Do not
  pre-emptively move write scopes to the derived screen**: today their content is a vendor's
  vocabulary, and dropping the word list before the path half arrives would weaken the value the
  screen was written for.
- **The shape of the fix, when it is needed:** screen the *scope name* and the *derived path* as two
  values rather than one, so each meets the rule that applies to it — the same split, one level down.

### NEW-28 — `ingest` can no longer produce a screening refusal

- **Status:** open, registered 2026-08-17 · **Owner:** whoever gives `ingest` an argument a screen can
  refuse · **Size:** XS · **Coverage, not security**
- Closing NEW-12 made `invokeVendor`'s refusal-detail branch (`apps/cli/src/commands/ingest.ts:786`)
  **unreachable from every production path**, verified against all four sources the branch's own
  docblock lists: the prompt is prefixed with a Markdown heading so the dash rule cannot fire; the
  working root and output schema path are assembled from validated absolute paths and now take the
  derived screen; spec §3.3 passes an empty write-scope array; and the turn bound is
  `DEFAULT_MAX_TURNS`, a compile-time constant inside the window `invokeClaude` enforces.
- **The branch is retained as defence in depth** — NEW-27 above brings the user back — but
  the interpolation it performs is no longer covered end-to-end. It was covered by exactly one case,
  which asserted a refusal this product should never have produced, and that case now asserts the
  acceptance instead.
- **No fixture can reach it**, because the refusal happens before the fake runner is called and the
  harness has no injection point for a vendor outcome. Recorded rather than replaced with a test that
  would have to fake the thing it is testing.

### NEW-7 — a link destination's percent-encoding is unverified against Obsidian

- **Status:** open, needs a machine with Obsidian · **Owner:** the founder, or DOS-P6 ·
  **Size:** XS to check, S if it fails
- `linkTarget` percent-encodes a control or format character in a vault path so that
  `catalog.md` carries no raw override while the link still resolves. CommonMark
  percent-decodes a destination and that half is checked. **Whether Obsidian's resolver does
  the same for a local vault path is not**, because this repository has no Obsidian to ask.
- Only a path containing such a character is affected, which is pathological and rare — but
  note the stakes moved when the encoding went in. Before it, a control character in a path
  produced a link that resolved and merely looked wrong; now correctness depends on the
  consumer decoding. If Obsidian does not decode, such a link is **broken** where it
  previously worked. The fallback is then to refuse the path at lint time — *not* to go back
  to emitting the raw byte, which is the defect that motivated the encoding.
- **`%` is encoded too**, which is what makes the mapping reversible, and it is why this is
  worth ten minutes with any Markdown preview rather than being left indefinitely: `%` in a
  filename is ordinary where U+202E is not, so the encoder now touches common paths.
- Recorded rather than assumed, and stated at the call site too.

### L1, L2 — outside this environment

An OSI-approved license reviewed by qualified counsel, and remote verification. Both are
recorded in `ORDER.md` Track L, both gate public release, and both depend on somebody who
is not in this room. Neither is engineering work.

---

## 2. Foundation — what it left open

**Foundation closed on 2026-08-01** and its gate evidence is not repeated here; it is in
`docs/releases/foundation-checkpoint.md`, dated. This section holds only the three things it
left behind that are still somebody's decision or somebody's work.

Read these instead of this section for anything else:

| Document | What it holds |
|---|---|
| `docs/architecture/foundation.md` | what the layer is, its boundaries, the mutation pipeline, exit codes, what it deliberately cannot do, and nine known residuals |
| `docs/architecture/foundation-constraints.md` | the verbatim per-task constraints, including **two open founder questions** under Task 5 |
| `docs/releases/foundation-checkpoint.md` | the gate evidence, dated 2026-08-01 — a historical record, not a live status page |

**The two open founder questions are still open.** Whether `SpawnLockfRunner` needs a
watchdog around the non-blocking `lockf` call, and whether `<state>/transactions/`
accumulating one permanent `0600` lock file per transaction id is intended or wants
collection. Neither blocks anything; both are decisions nobody has made.

**One thing Foundation built and nothing consumes.** `buildConflictEvidence` and its
unified-diff machinery in `packages/core/src/manifest/drift.ts` are implemented and
unit-tested, and no command calls them. That is deliberate — the first consumer is the
semantic config merge in DOS-P4/DOS-P5 — but a later reader should not mistake unused for
untested, or unused for dead.

**That sentence is amended, by the Claude adapter spec approved 2026-08-11** (§8). Its §4.3
dissolves DOS-P4's half of the merge rather than answering it: a skills-directory plugin writes no
foreign config file, so DOS-P4 has nothing to three-way merge and leaves `buildConflictEvidence`
uncalled. DOS-P5 may still need it — Codex's documented surface includes `AGENTS.md`, which is
shared in a way `~/.claude/skills/developer-os/` is not.

**Residual 9 is owed by DOS-P7**, and it is the one residual that makes a shipped feature
unusable rather than merely rough: configuration cannot be changed after `init`. Detail with
that subsystem in §3.

---

## 3. Missing specs and plans

**Two documents left, both DOS-P7's.** DOS-P6's spec was approved by the founder on 2026-08-13 and
its implementation plan was written the same day. Nothing else on the product path is missing a
document.

Each subsystem after Foundation requires an approved spec **and** an implementation plan
before any code work — this is a Global Constraint of the program plan, not a preference.
Every spec starts with a brainstorming/approval cycle, and approval is the founder's.

**The four closed subsystems are not rows here.** Each kept its spec, because an architecture note
names it as the design of record, and each deleted its plan:

| Closed | Spec retained | Named as design of record by | Plan recoverable at |
|---|---|---|---|
| DOS-P2 | `specs/…-brain-engine-design.md` | `docs/architecture/brain.md` | `81e7e7d` |
| DOS-P3 | `specs/…-workflow-compiler-design.md` | `docs/architecture/workflow-schema.md` | `a47e965` |
| DOS-P4 | `specs/…-claude-adapter-design.md` | `docs/architecture/claude-adapter.md` | `17968cb` |
| DOS-P5 | `specs/…-codex-adapter-design.md` | `docs/architecture/codex-adapter.md` | the commit that closed DOS-P5 |

**Read both adapter notes before starting DOS-P6** — between them they record why in-place discovery
beat a marketplace copy on one vendor and a local marketplace won on the other, the two-adapter
table DOS-P6 designs against, and thirteen residuals it inherits. And read §8 before trusting the
Codex spec: its §14, the section it declares normative, was amended four times on 2026-08-12 by
first contact with a real binary.

### DOS-P6 — Knowledge pipeline hardening

**Kept here only until Task 19 Step 5 removes it.** The spec's obligations — capture fields,
lifecycle transitions, retention, redaction classes, atomic quarantine writes, post-redaction
deduplication, accept/edit/reject review, the untrusted-source contract, the six required security
suites and the five gate criteria — are **discharged**, and the record of each is
`docs/architecture/knowledge-pipeline.md` and program plan Task 6's **Test** table. Do not read the
list of what the spec "must decide" back into this section; it was decided and shipped.

- **Spec:** `specs/2026-07-21-developer-os-knowledge-pipeline-design.md` — **approved by the founder
  2026-08-13.** Read its §3 first. The decision that reshapes the subsystem is 3.1: capture content is
  **agent-authored**, so no hooks ship, `developer-os run claude|codex` is never built, and **nothing
  automatic captures anything**. §12 lists the six documents it amends; §8 here carries them.
- **Plan:** `plans/2026-07-21-developer-os-knowledge-pipeline.md` — written 2026-08-13, nineteen
  tasks, seventeen landed. **Three steps are unticked** and they are the whole of what is left:
  Task 17 Step 3, and Task 19 Steps 5 and 6.
- **Program task:** 6 · **Complexity:** L · **Blocked by:** **NEW-21**, on the founder's decision of
  2026-08-15 to hold the subsystem open rather than close it carrying a residual.
- **Absorbs:** legacy follow-up Steps 5, 7, 9 and 12, frozen on the legacy runtime 2026-07-27 and
  rebuilt here instead.
- **The two residuals it hands forward**, of the thirteen it inherited from the two adapters: the
  **JSONL terminal-event rule**, still provisional on the success path until one successful
  `codex exec` completion lands (NEW-21); and **`maxTurns`**, bounded under Claude and silently
  dropped under Codex from one shared `agent.prompt` schema.


### DOS-P7 — Git, automation, update and release lifecycle

- **Spec:** `specs/2026-07-21-developer-os-lifecycle-design.md` — missing
- **Plan:** `plans/2026-07-21-developer-os-lifecycle.md` — missing
- **Program task:** 7 · **Complexity:** L · **Blocked by:** DOS-P6
- **The spec must decide:** Git initialization, existing-remote connection, scoped
  staging, commit, push and every error state; the exact `launchd` jobs, schedules, logs,
  lock ownership and opt-in boundaries; signed/checksummed release metadata; dry-run
  updates; schema-migration staging and rollback.
- **Produces:** `GitSyncConfigV1`, `AutomationConfigV1`, `LaunchdPlan`, `UpdatePlan`,
  `SchemaMigrationPlan`, verified uninstall/rollback results.
- **Gate:** a Git-disabled and automation-disabled install performs no related process or
  network call; push failure never records a successful sync; update refuses drift;
  uninstall removes only manifest-owned artifacts.
- **Absorbs:** legacy follow-up Step 6 (real-Git integration coverage), frozen on the
  legacy runtime 2026-07-27 and rebuilt here instead.
- **Must also decide how a managed artifact changes across product versions**, raised by DOS-P6
  Task 11's review on 2026-08-14 and ruled out of that task's scope. `init` plans an artifact only
  when it is absent: the config file (`init.ts:276`), the Brain skeleton (`:290`) and the vault
  (`:307`) all take the same `isFile` → `unchanged` branch, and the docblock at `:284` states the
  intent. So an installation upgraded across a version that changes the shipped bytes keeps the old
  file indefinitely, and `assertNoDrift` cannot notice, because the content still matches the hash
  the manifest recorded. **Task 11 made this concrete rather than theoretical**: the output schema
  it installs is the file a vendor CLI is pointed at with `--output-schema`, so a stale copy is a
  model refused against a bound the product no longer ships. The repository copy is protected by a
  parity test; nothing protects the installed one. The fix is an `update` operation carrying
  `expectedBeforeHash` — which the change-plan validator already supports — and it is this entry's
  because `update` is what this entry is.
- **Must also close Foundation residual 9.** Configuration cannot be changed after `init`:
  `config.toml` is a hash-tracked managed artifact and no command edits it, so changing
  `git.enabled` or `automation.enabled` today means hand-editing a file that then drifts
  the manifest and makes `init`, `doctor` and `uninstall` all refuse. A lifecycle task that
  ships opt-in commands without a way to record the opt-in ships a dead end. Detail in
  `docs/architecture/foundation-constraints.md`, "Found after Foundation closed".

---

## 4. Program tasks 8 and 9 — artifacts, and one open decision

### DOS-P8 — Founder shadow migration

- **Status:** open · **Blocked by:** DOS-P7, and by all four Track B items
- **Artifacts required (none exist):** `docs/migration/founder-cutover.md`,
  `founder-baseline-results.json`, `founder-shadow-results.json`,
  `founder-cutover-manifest.json`.
- **Decided 2026-08-10 by the founder: author a dedicated plan.** The program plan enumerates
  ten steps inline and mandates neither a spec nor a plan; the ruling is that this task gets a
  plan regardless, because it is the only one that mutates the founder's live machine and its
  rollback must be rehearsed before cutover is declared complete. **Written against A11's
  output, not before it** — a cutover plan authored ahead of the lifecycle it cuts over to
  would specify commands that do not exist. No spec is required; the program verification
  matrix and the hard invariants below are the contract it plans against.
- **Hard invariants:** the founder's vault is not moved; legacy recovery data is not
  deleted; two copies of a mutating hook are never enabled at once; legacy hooks and jobs
  are disabled only after new evidence passes, and are never deleted.

### DOS-P9 — Public beta and v1

- **Status:** blocked · **Blocked by:** DOS-P8
- **Artifacts required (none exist):** `README.md`, `SECURITY.md`, `CONTRIBUTING.md`,
  `CHANGELOG.md`, approved `LICENSE`, `docs/install/`, `docs/tutorials/`,
  `docs/troubleshooting/`, `docs/privacy.md`,
  `.github/workflows/{ci,release}.yml`, Homebrew formula source, macOS Apple Silicon and
  Intel packaging configuration. `docs/releases/` already exists — this task adds release
  notes to it rather than creating it.
- **Owes the pre-publication secret re-scan** recorded as a gate in §7. The repository now
  carries legacy machine detail it did not carry when Program Task 0 produced its evidence,
  so Task 0's clean result does not transfer.
- **Decision required, and it is no longer "the same as DOS-P8".** No dedicated plan is
  mandated here either, but DOS-P8's version of this question was settled on 2026-08-10 in
  favour of writing one, on a reason that does not apply to DOS-P9: DOS-P8 mutates the
  founder's live machine and DOS-P9 publishes a release. The program verification matrix is
  probably sufficient here; confirm before starting rather than inheriting DOS-P8's answer.
- **Two external blockers that are not engineering work:** L1 license and L2 remote
  verification, both in `ORDER.md` Track L.

---

## 5. Missing repository infrastructure

Named in the program file map and still missing. A row leaves this section when the directory
exists, because the section's job is to stop something being discovered late — the tree is the
inventory of what was built, and the architecture notes say what is in it.

**Nothing the file map names is missing, so there is no table.** The last two rows left on
2026-08-14: `tests/security/`, then `docs/architecture/threat-model.md`. Four rows left something
durable behind as they closed:

- **The capability model stays recorded per adapter and was not moved into the threat model** —
  `claude-adapter.md` §3 and `codex-adapter.md` §3, twice on purpose, which is where it belongs while
  the two vocabularies are asserted identical and `apps/cli/src/adapter-capability-parity.test.ts` is
  what keeps that true. `docs/architecture/threat-model.md` §9 points at both rather than restating
  either; a third copy is how three descriptions of one model come to disagree.

- **`tests/security/` holds nine suites, not the six spec §9 names** — sentinel, prompt injection,
  symlink escape, multiline command, malformed manifest and interruption from §9, plus **network** and
  **concurrent edit**, the two §7's standing gate requires and §9 dropped. Every suite was watched
  fail before it was believed, and thirteen reverts are recorded with the line each disabled. **47 of
  its 85 cases carried that evidence and 38 did not; recounted at 90 on 2026-08-17** — the total counted by collection
  (`npx vitest list --root tests security`), the split derived per suite in
  `docs/architecture/threat-model.md` §8. The three fix rounds after Task 19's review added
  twenty-six cases between them, five of which were watched fail, and converted one parked
  `it.fails` into a sixth. That split is recorded **here and nowhere else** —
  a correction to an earlier version of this sentence, which claimed the suites say it about
  themselves. They do not: `grep -rniE "revert" tests/security/` returns nothing, and the per-case
  itemization lived only in a scratch report that does not survive this plan. Anyone tightening the
  count has to re-derive it from the suites. The one case parked `it.fails` over NEW-14 is an
  ordinary passing case since 2026-08-15: the escape it announced was closed by Task 19's review,
  and the suite went red the day it changed exactly as the parking intended.

- **`tests/contracts/` holds only DOS-P3's cases.** DOS-P2 put its contract cases beside the code
  they pin instead, which is why that directory looks thinner than the file map implies.
- **`.github/workflows/` was owed by nobody, and that was the finding.** The program file map never
  named it, so no subsystem owed it and this repository ran without CI for twenty days. Created and
  verified green on 2026-08-10.

**`tests/repository/` gained a second rule on 2026-08-10.** Beside the self-containment
enumerator there is now `control-bytes.test.ts`, which fails the build on a literal control
character in any tracked or untracked text file. It exists because this repository shipped two
— a NUL used as a map-key separator, and a ZERO WIDTH JOINER holding a comment's syntax
together — both invisible in every diff that carried them, both found by accident. It found
the second one within a minute of being written.

**Two directories exist that the program file map never named:** `tests/helpers/` (the
temporary HOME, the hash inventory, the process runner) and `tests/repository/` (the
self-containment rule, its allowlist, and the git-driven enumerator that `npm run lint`
runs). Both are Foundation output and both are now rows in
`docs/architecture/foundation.md` §1 — `tests/repository/` was added there on 2026-08-08,
having previously been documented only in `docs/releases/foundation-checkpoint.md` and in its
own source. Recorded here because §5 is read as the complete inventory of what does and does
not exist, and a map with a gap invites a second copy.

---

## 6. Legacy runtime — closed 2026-08-10

**The exit checklist is discharged and its plan is deleted**, per the rule that `plans/` holds
only unfinished work; recover it at `72f9c58` if the reasoning is ever needed. Nothing is
planned, scheduled, or in progress on `~/claude-shared` or `~/brain`. Both are frozen artifacts
running the founder's machine until the DOS-P8 cutover retires them, and **Track B no longer
gates A12.**

This section is no longer a worklist. It is what a cutover still has to know.

### What was decided, and must not be reopened by accident

**EXIT-1 — historical credential rotation — was declined by the founder on 2026-08-10.** Not
done, not deferred; decided against, in the same conversation that established this repository
is public and that this section therefore describes the unrotated candidate set to anyone who
reads it. Four things bound that decision:

- **No credential value is written anywhere in this repository.** What is public is the
  *status* of the candidates, not the candidates.
- **The obligation does not expire.** The original reasoning — that this is the one item whose
  consequence exists whether or not this product ever ships — was weighed and set aside, not
  shown to be wrong.
- **Nothing downstream depends on it.** It gated no sequence, and A12 never needed it.
- **Reopening it is a conversation with the founder**, never a task picked up from a backlog.

**The candidate set is a floor, not a total.** A 2026-07-19 triage recorded four rotation
candidates; a second scan on 2026-07-27 reported matches across six repositories; no
provider-side verdict was ever recorded for any of them. That second scan was produced by a
scanner with two known gaps — linked worktrees are skipped, and results truncate at twenty
matches without reporting how many were omitted. If a scan is ever the deciding evidence for a
rotation verdict, fix exactly those two gaps first. The founder's 2026-07-21 waiver scoped
*this product's* release gate; a waiver does not revoke a key.

### What changed on the founder's machine, and why a cutover cares

- **The global commit gate is no longer npm-only** (EXIT-2). It is a fail-closed ladder:
  `package.json` scripts, else the repository's documented suite, else the commit is blocked.
  Missing validation metadata stays a blocker. DOS-P8 inherits a machine where a compliant
  agent can commit in a non-npm repository, which was impossible for nineteen days.
- **The English guard stopped counting quoted material as prose** (also EXIT-2, and the reason
  it took a day rather than an afternoon). The corrected commit gate immediately blocked its own
  commit: the declared suite was failing on 173 findings, every one a raw capture in the
  language it was captured in — and *no automation ran the check*, so the red was invisible
  while the weekly job reported green. `content/_raw/**` is now out of scope, and a fenced
  block, an inline code span and a price in `zł` are verbatim contexts rather than prose. Six
  tests pin it, four of them negative.
- **Both trees are clean** (EXIT-3). Three `.bak.20260727-210611` files were deleted after being
  proved byte-identical to `ef4a972`; `docs/ROADMAP.md` was committed as the tombstone it had
  become. What remains untracked in the vault is one day of new captures awaiting the next
  scheduled run — user data, not work at risk.
- **The weekly job was not broken** (EXIT-4). It was recorded as failing on 2026-08-08 and the
  very next scheduled run, 2026-08-09, succeeded: hooks `PASS=49 FAIL=0`, plugin version
  consistent, 52 files committed and pushed, the entire capture backlog drained. The two fix
  commits that preceded the report had worked and nobody had waited for a Sunday to find out.
  **The lesson is the one this product exists for**: a job that reports only into a log nobody
  reads is indistinguishable from a job that is broken, in both directions.

**A live constraint DOS-P8 must not break.** The weekly job's preflight refuses pre-existing
changes under `content`, `AGENTS.md` or `README.md`. Any cutover step that edits the vault and
leaves the edit uncommitted will abort the next run — which is precisely how the 2026-08-02
failure in that log happened.

### The ten frozen items

Frozen 2026-07-27 as *will not do there*, each rebuilt as a Developer OS feature on synthetic
fixtures. The per-subsystem mapping is in §3, on the subsystem that absorbs each one — DOS-P5
takes Step 8, DOS-P6 takes Steps 5, 7, 9 and 12, DOS-P7 takes Step 6 — rather than duplicated
here, because two copies of a mapping is how they come to disagree. Full original text in
`28a0ddc`.

### Still on the machine, and not this repository's business

Several agent-written proposals await the founder's review inside the vault. They are private
Brain content, they are not repository inputs, and their paths are deliberately not recorded
here now that this repository is public.

## 7. Standing gates

Copied here so they are visible without opening the program plan.

| Gate | Evidence | Blocks |
|---|---|---|
| Repository validation | `npm run check` (`lint && test && build && git diff --check`), where `lint` is `tsc -b`, `eslint`, and the self-containment enumerator | every commit |
| Fresh-context review | a reviewing agent that is not the author, per code-producing task | every commit |
| Exact-path staging | never `git add -A`; stage only task-owned paths | every commit |
| Generated artifacts | clean regeneration diff | adapter commits, release |
| Security suites | sentinel, path, prompt injection, transaction, network | DOS-P6 onward |
| Publication secret re-scan | candidate-only scan over the whole tree, including the publication-excluded legacy paths this repository has carried since 2026-07-27 | public visibility |
| Agent compatibility | disposable real-agent matrix | DOS-P8, release |
| Migration | shadow comparison plus an exercised rollback | public beta |
| License | OSI-approved text reviewed by qualified counsel | public visibility |
| Packaging | checksums, SBOM, clean-account install | `v1.0.0` |

**One measurement for whoever runs the publication secret re-scan, taken 2026-08-15.** DOS-P6 Task 17
added `tests/fixtures/codex/observed-exec-stream.jsonl` — a **redacted recording of real vendor
output**, and the one deliberate exception to `SESSION.md`'s "fixtures are synthetic" rule, mandated
by that task because the JSONL rule cannot be settled against an invented stream. The product's own
`redactText` was run over the change as a candidate-only scan, and the result is worth carrying:

- **Over the 687 added lines: zero candidates**, the fixture included.
- **Over the whole text of the same files: 25 candidates**, every one in pre-existing prose and every
  one a false positive — `high-entropy` on commit SHAs and hex identifiers, plus `certificate` and
  four `service-credential` hits inside the knowledge-pipeline plan, which quotes redaction-class
  examples as documentation.

**So the gate must be run per-diff, or against a triaged baseline.** A whole-tree scan of this
repository's documentation returns a false-positive set large enough that a reader would either
triage it every release or learn to skim it, and skimming a secret scan is how a real hit gets
waved through. There is no scanner in the tree yet; this is the note that says what one will meet.

---

## 8. Amendments to approved documents

An approved document is not silently rewritten. When a later approved document changes an
earlier one, the change is recorded in the amending document and cross-referenced from the
amended one; only code and status lines are edited in place. This section is the index — read
it before trusting any approved document, because it is the only place that says whether the
one in front of you is still current.

**The knowledge-pipeline spec's six were ratified on 2026-08-13**, in the same conversation that
approved the spec. They are listed below with their outcome rather than their question, and each is
discharged by the DOS-P6 task named beside it — a row leaves this table when the amended document
carries the cross-reference, not when the decision is taken.

| Amended | Outcome, ratified 2026-08-13 | Discharged by |
|---|---|---|
| product design spec §11 | there is neither a lifecycle hook nor a `developer-os run claude\|codex` wrapper. `CapabilityState` **replaces** `wrapper-required` with `not-used`, and six of the nine keys resolve to it | DOS-P6 Task 3 |
| product design spec §14.3 | "user-configured patterns" narrowed to literal case-insensitive substrings — a user-supplied regex over capture text is a ReDoS surface and this codebase bounds no expression anywhere | DOS-P6 Task 2 |
| `specs/…-claude-adapter-design.md` §6.1 | hooks **declined**, not deferred; the three lifecycle keys report `not-used` | DOS-P6 Task 3 |
| `specs/…-codex-adapter-design.md` §5.3 | the same, in one decision covering both adapters. **This supersedes the ratified amendment below**, which deferred hooks to DOS-P6 rather than closing them | DOS-P6 Task 3 |
| `specs/…-codex-adapter-design.md` §14.1 | the JSONL terminal-event rule promoted from provisional to observed, dated, with the shape seen — ingest forces the real `codex exec` call that DOS-P5 could not justify. **Partly discharged 2026-08-15:** the run was made and §14.1 carries the dated amendment, but the account's usage limit was exhausted, so it settles the JSONL framing and the discriminating `type` field and **not** the terminal-event rule. The row stays until one successful `codex exec` completion lands — `BACKLOG.md` §1 **NEW-21** | DOS-P6 Task 17 |
| `specs/…-workflow-compiler-design.md` §6 | scope globs stop being literals, which `workflow-schema.md` §8.1 made due at the first handler that resolves one. **Narrowed by the plan** — see the ratified row below | DOS-P6 Task 6 |

**Six were ratified by the founder on 2026-08-13**, in the same session that approved the spec and
received the plan. Every one is the implementation plan's rather than the spec's: they ride on
`plans/2026-07-21-developer-os-knowledge-pipeline.md`, whose "Five decisions this plan takes"
section is the authoritative statement for the first four, and Tasks 12 and 15 for the last two.
Each amends an approved document, which is why they are here rather than only in the plan. **A row
leaves this table when the amended document carries the cross-reference**, not when the decision was
taken — so all six stay until the task named beside them lands.

**Two rows exist because a fresh-context review found them missing on 2026-08-13**, before this plan
was committed: the narrowing of design spec §13.4's "staged result", and the narrowing of §17.5's
security cases to spec §9's six suites. Both were decisions the plan was taking silently, and both
were put to the founder with the other four.

| Amended | Outcome, ratified 2026-08-13 | Discharged by |
|---|---|---|
| the knowledge-pipeline spec §12 | **five** canonical workflows go to `2.0.0`, not two. `ingest` gains a step and widens its write scopes, `brain-search` gains one and widens its read scopes, and `review` gains the `capture.edit` step its `decision` input already advertises — with its scopes unchanged, which is what makes it easy to miss. A step list and a scope set are the contract, and `extends` pins `id@version` exactly | 7 |
| `specs/…-workflow-compiler-design.md` §6, again | the globs resolve at the **handler boundary** through `resolveScopeGlob(glob, config)`; the contract keeps canonical names. Templating them inside the YAML was rejected: it invents a substitution syntax in the workflow schema and puts a configuration value in the one document meant to be comparable across installs. Leaves a display gap — a skill shows `content/**` while the handler enforces the user's own root | 6 |
| **program plan Task 6**, third box | "Restore `hooks/hooks.json` for both adapters in one change" cannot be ticked — spec §3.1 declines hooks and corrects the stated blocker: a `"type": "command"` handler needs no executable bit, and what hooks lacked was content to capture. **Spec §12 omits the program plan from its amendment list; that gap was found while writing the plan.** The box is rewritten to record the decline, not ticked | 19 |
| **§7 of this file**, the DOS-P7 gate "uninstall removes only manifest-owned artifacts" | one named exception: the redaction key, which spec §3.5 keeps out of the manifest and spec §8.4 requires `uninstall` to remove. Making it a hash-exempt manifest artifact was rejected — it would put the key's path in a file every enumerating diagnostic reads. The exception is one path wide and asserted by test | 1 |
| product design spec §13.4, "the staged result" | the `deterministic reindex` validator runs over an **in-memory projection** of vault plus proposal, not over a staging directory. §13.4 and the knowledge-pipeline spec's own §6.3 preamble contradict each other — nothing is staged at the point the preamble names — and staging first would make every file in staging attacker-influenced content the validators must re-read as hostile | 12 |
| product design spec §17.5, and the knowledge-pipeline spec §9 | §9 narrows §17.5's security cases to six suites and drops two the standing gate in §7 of this file still requires from DOS-P6 onward: a **network** suite, and **concurrent user edits**. The plan ships eight suites rather than six and registers the narrowing rather than inheriting it. **Shipped 2026-08-14 as `tests/security/`** — `sentinel`, `prompt-injection`, `symlink-escape`, `multiline-command`, `malformed-manifest` and `interruption` from §9, plus `network` and `concurrent-edit`, the two §9 dropped and §7 still requires | 15 |

**Three rows were raised by Track R entry R2, on 2026-08-17, 2026-08-19 and 2026-08-20, and all
three are unratified.** They are the only unratified rows in this section, and they are also the place where
§8's two rules pull against each other: the eviction rule says a row leaves when the amended document carries the cross-reference, and
`foundation.md` §2 carries it in the same commit that adds the row. **Ratification wins** — a row
whose amendment nobody has approved is exactly what this index exists to surface, so it stays until
the founder rules on it, cross-reference or not. A founder decision to *implement* NEW-16, or Foundation request 3, is not the
same as ratifying the amendment implementing it required, and conflating the two is how an approved
document gets rewritten silently.

**The second row was found missing by a fresh-context review**, not by the work: Task 7 amended
`CliError` and registered nothing, and `foundation.md` §2's own instruction — "every amendment to a
frozen interface is indexed in `BACKLOG.md` §8" — is a sentence in the document being amended, which
is precisely the kind of rule that goes unread by whoever is editing past it.

| Amended | Outcome, **awaiting ratification** | Raised by |
|---|---|---|
| `docs/architecture/foundation.md` §2, the frozen `configSchema` | an **optional** `[redaction]` table with a bounded list of literal `patterns`. Additive on the same terms as the `brain` section that preceded it: `configSchema` stays `.strict()`, `schemaVersion` stays `1`, `serializeConfig` emits the table only when the key is present, and `exactOptionalPropertyTypes` keeps absent distinguishable from present-and-undefined — so a configuration written before it still loads and still serializes byte-identically. **Without it spec §8.2's user-extensible redaction class is unreachable**: `redactText` took the option and no production caller passed it, because there was no key a user could set | R2 Task 2, `BACKLOG.md` §1 **NEW-16** |
| `docs/architecture/foundation.md` §2, the frozen `CliError` | an **optional** `data?: RedactedPayload` member, so a partly-succeeded run can report machine-readably what moved. Additive on the same terms as the two config amendments: absent when unset, so every `--json` document a command emitted before it is byte-identical, and no existing caller changes because nothing populates a field that does not exist yet. It creates a new **publishing** surface, which the other two did not — the failure arm is serialized into `--json` — so `failureFrom` redacts every string leaf including keys, and the slot is typed `RedactedPayload`, a `unique symbol` brand whose only producer is `redactPayload`, which takes the redactor and performs the walk rather than asserting. Every *shape* that writes the field another way is a compile error, `failure` rebuilds the arm it publishes from five named fields — `kind`, `message` and `recovery` coerced to strings, `paths` copied and frozen, `data` accepted only by identity — the arm is branded so a hand-built one is a compile error, and `publish` — which decides the body and the exit status in one place, because they were decided separately and disagreed — rebuilds any failure arm `failure` did not return — the last of the three being what actually closes the class, since a phantom brand survives `Object.assign`, spread, `Proxy` and `structuredClone` while the runtime guarantees it stood for do not. What remains, verified by running each candidate against the built module, is exactly two things: a redactor that does not redact, and a producer call outside the composition root. `Object.defineProperty` and `Object.assign` before the call are **not** among them, and they are closed by two different mechanisms rather than one: the copying forms yield a value the payload registry does not hold, so `failure` drops the field, while in-place `Object.assign(payload, …)` returns the payload itself and is refused by the deep freeze. Three earlier versions of this sentence were wrong, the last of them by crediting the registry with both. The brand replaced a repository sweep that tried to enumerate the syntax instead and was falsified in five review rounds. The sweep survives with a different job: its load-bearing rule is that `redactPayload` is called only at the composition root, and beside it it detects over thirty spellings, split between casts onto the brand and ways of reaching the producer under another name; the exact split is left to the test file, because two reviews counting it disagreed and three documents repeating a number is how that drifts. The enumeration no longer carries the guarantee, so falsifying one more spelling costs a row on a list rather than the property. Three commands wanted it: `ingest`, `brain lint`, and `doctor` (recorded in `releases/foundation-checkpoint.md`) | Track R R2 Task 7, 2026-08-19 |
| knowledge-pipeline spec §5.5, the transition table | a row for **`accepted → rejected`**, taken by `review --decision reject`. The table had one row per decision, all from `quarantined`, so a user who accepted a capture and then changed their mind had no verb — the only way to stop `ingest` retrying it was to hand-edit the frontmatter back to `quarantined`, which is what both of `ingest`'s recovery strings told them to do. A product that recommends a hand edit of its own data has a gap where a verb should be, and that same hand edit is what `failed` exists to describe going wrong. **`accept` and `edit` deliberately did not gain the equivalent row**: re-accepting is not a transition — `accepted → accepted` is not a row this table can hold — and `edit` maps to `quarantined`, so running it from `accepted` would silently withdraw an approval as a side effect of changing the text — the verb's name says nothing about un-approving, and a user who wants that has `reject`. Rejection is the only safe direction from `accepted`, because `rejected` is terminal for automation and no later phase reads it. **`CAPTURE_STATUSES` gains no member** — a row in a transition table, not a seventh status. Both retired recovery strings now name the verb, and `review`'s own refusal names the decisions legal from wherever the capture actually is rather than telling the user to edit their frontmatter | Track R R2 Task 9, 2026-08-20 |

**Two rows were raised by DOS-P6 during implementation rather than planning**, which is why neither is
in a table above. **Both were ratified by the founder on 2026-08-15**, in the session that ran Task 17;
they were the last unratified rows this subsystem raised — **R2 has since added two, above**. Each leaves the table when
DOS-P6 Task 19 Step 5 lands, per the rule that a row leaves when the amended document carries the
cross-reference.

| Amended | Outcome, **ratified 2026-08-15** | Raised by |
|---|---|---|
| the knowledge-pipeline spec §6.1, "one capture, one agent call, **one transaction**" | the last third is false and cannot be made true. The ladder performs four mutations and **the executor's lock is per-execution**, so it ships as **four transactions per capture** — `ingest-stage` (the capture file, `accepted → staging`), `ingest-apply` (the proposed notes), `ingest-reindex` (the index artifacts), `ingest-ingested` (the capture file, `staging → ingested`) — plus a compensating `ingest-rollback` on failure. Two independent reasons no two of them merge: `BrainService.reindex()` **reads the vault**, so it cannot run until the apply has finalized; and `validateChangePlan` grants ownership from the manifest, where the index artifacts are recorded and a capture is deliberately absent (spec §3.4 keeps a capture hand-editable in Obsidian). **The residual, accepted rather than closed:** a crash between the apply and the last transaction leaves a capture at `staging` with its notes already applied — inert, because the next run selects only `accepted` captures and cannot double-apply, and recoverable by `repair` plus a hand edit. **Cost of overturning:** there is no cheaper arrangement to overturn it to; the alternative is a Foundation change letting one execution span a read of what it just wrote. **Ratified as shipped by the founder on 2026-08-15**, four transactions and the accepted `staging`-with-notes residual together; the Foundation alternative was declined rather than deferred | DOS-P6 Task 13, plan correction 4 |
| the knowledge-pipeline spec §6.3, `confidence and lifecycle` | the spec names the validator and says "required frontmatter for the note's declared stage is absent" — **it never says which frontmatter**. Shipped rule: `established` requires `reviewed` to be a date, `deprecated` requires `updated` to be present, `emerging` requires nothing extra. It is **defensible but invented**: nothing in the tree enforced either before this task. It is grounded in a contradiction the product already flags — `lint.ts:285-294` grades an agent-authored, never-reviewed note as `provenance` at severity **warn**, so ingest turns only the narrower `established`-while-never-reviewed claim into a refusal. **The broad reading was checked and rejected**: refusing every `author: agent` + `reviewed: null` note would refuse every proposal this pipeline can produce. **Cost of overturning:** two `if`s at `packages/brain/src/ingest/validate.ts:444-461`; this validator writes no data, so nothing has to be migrated. **Ratified as shipped by the founder on 2026-08-15**: the invented rule stands as written, so the spec's silence is closed by this row rather than by a change to the code | DOS-P6 Task 12, `validate.ts` |

**One row is the founder correcting the spec after a pre-flight scan**, and it is the most
consequential amendment DOS-P6 has taken:

| Amended | By | What changed |
|---|---|---|
| `specs/…-knowledge-pipeline-design.md` §5.3 and §5.6 | an adversarial pre-flight scan of Tasks 3–19, **settled by the founder 2026-08-13** | **`captureId` becomes immutable** — assigned once at capture time, never recomputed. As written, §5.3 recomputed it on every hand edit and §5.6 refused on a mismatch; since the id is `H(redacted content)`, *any* content-changing edit changed it, so **every** edit refused and the pasted secret stayed in the vault file. The verb decision 1 bumped `review` to `2.0.0` for could never do the one thing it exists for, and Task 8's parse-level assertion would have looked clean because a refusal object carries no content. Now `deduplicationHash` tracks content, `edit` re-redacts and rewrites in place, and the mismatch refusal keeps the job it was really for: a renamed file or a hand-edited id field. **Cost accepted:** two captures whose text converges after an edit can both exist |

**One row is the plan correcting itself**, which is the shape the DOS-P5 note below warns to expect:

| Amended | By | What changed |
|---|---|---|
| `plans/…-knowledge-pipeline.md` Task 1, Step 3 | the fresh-context review of Task 1's first implementation, **settled by the founder 2026-08-13** | the instruction "`createProductionContext` replaces `randomBytes(…)` with `loadOrCreateRedactionKey(paths.stateDir)`" was **wrong, not merely awkward**. Context is built before dispatch for every command, so a create-if-missing load there made `doctor`, `status` and both `--dry-run` commands write a new secret — against Foundation's "`doctor` reports rather than repairs", which that plan's own Global Constraints carry. Three consequences followed: `uninstall` removed the key and the next command put it back permanently, because `runUninstall` early-returns on an absent manifest; a symlinked or truncated key failed **every** command including the diagnostic that would have reported it; and a FIFO at that path hung the CLI forever, since `open(O_RDONLY)` blocks before the file-type guard runs. **The load splits in two** — a read-only, never-create, never-throw `readRedactionKey` at the composition root, and the create-capable `loadOrCreateRedactionKey` at each command's own point of use |

**Two approved architecture notes are corrected by this work, and the correction is the spec's
rather than the plan's**, recorded here because §8 is where a reader of either note learns its
status:

| Amended | By | What changed |
|---|---|---|
| `docs/architecture/claude-adapter.md` §5 and `docs/architecture/codex-adapter.md` §5 | the knowledge-pipeline spec §3.1, approved 2026-08-13 | both state that restoring hooks needs "the hook bodies, a mechanism for marking a generated artifact executable, and a test that observes a hook firing". **The middle requirement was never needed** — a `"type": "command"` handler names a command string, so nothing executable ships. What hooks lacked was content to capture. Hooks are now **declined**, not owed |
| `docs/architecture/workflow-schema.md` §7 and §8.1 | the same spec, and this plan's decision 2 | three of §7's four recorded gaps close here — the `review` workflow's missing `capture.edit`, `ingest` stopping at apply, and `brain-search` never reading a note. §8.1's glob residual is discharged in the narrower `resolveScopeGlob` form rather than by templating the contract |

**Two canonical workflows change by the spec's own decision, and that is a contract change rather
than an amendment:** `workflows/capture/workflow.yaml` drops `session_end` and
`workflows/shared/workflow.yaml` drops `session_start` — both name triggers nothing can fire.
**Three more change by the plan's**, which is the first ratified row above: `ingest`, `brain-search`
and `review`. All five go to `2.0.0`.

**Every amendment raised through DOS-P5 was ratified** by the founder on or before 2026-08-12, and
every row in the table below carries its outcome rather than its question.

**One thing that is deliberately *not* a row here**, because §8 is amendments to approved
documents and this was the reverse. DOS-P3's first draft invented `session_start_hook` and
`session_end_hook` for what product spec §11 already called `session_start_injection` and
`session_end_capture`; the **code** was corrected to match the spec on 2026-08-10, so §11 is
current and untouched. Recorded here only so the next reader does not go looking for an
amendment that would say otherwise.

**Rows amending a deleted plan are removed once that plan is gone**, since a document nobody can
open cannot mislead anyone; where such an amendment settled something about the *product* rather
than about the plan, it lives in the architecture note that replaced the plan. **Two of DOS-P5's
four amendments were its plan disagreeing with itself**, both found by the task under way — the
shape to expect from a plan of nineteen tasks is a contradiction between an early task's mandated
test code and a later task's prose about what consumes it. Worth knowing while writing the next
two plans.

**Discharged rows are removed, not kept as a table.** Every amendment raised through DOS-P5 was
ratified on or before 2026-08-12 and every one of them is now carried, dated and in place, by the
document it amends — which is the definition of discharged this section uses. Keeping a second copy
here made §8 read as a list of outstanding work when it held none, so the twenty-nine discharged rows
were deleted on 2026-08-17 and git history is the archive. **Two facts from that table are load-bearing
and are kept here rather than in it:**

- **`specs/…-kernel-transaction-lock-design.md` is the one spec retained after its subsystem shipped**,
  because `foundation-constraints.md` points at it as the design of record for
  `packages/platform-macos/src/transaction-lock.ts`. Delete it only when nothing points at it.
- **`buildConflictEvidence` has no consumer in either adapter.** DOS-P4 §4.3 dissolved its half and
  DOS-P5 §4.3 the other, by delegating the config write to `codex plugin add`. It was built for a
  design both adapters declined. Whether it is retained, taken up by DOS-P7, or deleted belongs to the
  first subsystem with a real three-way merge; §2 above carries the note.

---

## Appendix — outstanding outside this repository

Not Developer OS work; recorded so it is not lost. `dev/active/` and `.claude/plans/` were
deprecated on 2026-07-18 in favour of `docs/superpowers/plans/`, to be migrated
opportunistically.

**As of 2026-08-08, 25 files remain on the deprecated paths across seven repositories**
(down from 28 on 2026-07-27). One repository completed its migration in the interval and
one gained a `docs/superpowers/` tree without moving its plans yet; the user-level
directory grew.

Do not maintain the per-repository table that used to sit here. It went stale within days,
it named absolute machine paths in a repository that is meant to become public, and it
cannot be right for longer than the next session — recompute it when the migration is
actually the work in hand, rather than reading a frozen count.

The founder's two legacy repositories are not on this list: both were confirmed clean of
`.claude/plans/`, `dev/active/`, and `docs/superpowers/` on 2026-07-27, and the 2026-08-08
re-verification found no change.
