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
| Repository-level | §1 | **eleven rows.** Four were decided 2026-08-17 and are being implemented as Track R **R2** — NEW-15, NEW-22, NEW-16, NEW-11. Four belong to somebody else — NEW-21 (the founder's, blocks A10), NEW-20 and NEW-13 (deliberately not fixed), NEW-7 (needs a machine with Obsidian). Three came from the review that closed NEW-12 on 2026-08-17 — its two successors and NEW-23, the unchecked `path:line` citations |
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

**Eleven rows, and they are not all the same kind of open.** **Four were waiting on a decision, got one
on 2026-08-17, and are being implemented** as `ORDER.md` Track R entry **R2** — **NEW-15**,
**NEW-22**, **NEW-16** and **NEW-11**. They stay here until R2 closes them, because a row leaves this
section when its fix is committed, not when its question is answered. Four are somebody else's:
**NEW-21** the founder's, **NEW-20** and **NEW-13** registered as deliberately-not-fixed, and
**NEW-7** waiting on a machine with Obsidian.

**Three are new, and all three were found by the review that closed NEW-12 rather than by the work
itself** — its successor, its coverage residual, and **NEW-23**. That is the ordinary yield of a
fresh-context review and the reason the gate exists: closing a defect moved a trap one field over,
made one branch unreachable, and the fix for a stale line citation broke twelve more. None was
visible to the author.

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

### NEW-22 — a vault whose `content` is a symlink cannot be indexed at all

- **Status:** open, found 2026-08-15 by R1's fix wave, which went looking for a regression it had
  introduced and found a pre-existing refusal instead · **Owner:** DOS-P7 by default · **Size:** S ·
  **Not a security defect — a usability one, and the guard it names is deliberate**
- `discoverNotes` canonicalizes the content directory and calls `refuseEscapingLink` on it
  **unconditionally, before any per-entry walk** (`packages/brain/src/discovery/discover.ts:132-144`
  and `:230-242`). That refuses **any** content root reached through a symbolic link — not only one
  that escapes the vault. `BrainService.reindex()` reaches it through `buildIndex()` →
  `discoverNotes()`, so **`brain reindex` and `ingest`'s third transaction both fail on such a vault**,
  with `Vault entry resolves outside the vault: content`.
- **The scenario this makes impossible is an ordinary one:** a user with an existing Obsidian vault
  who points `brainPath` at a new directory and symlinks `content` at the vault they already have.
  Nothing in the product tells them this is unsupported; they get a refusal naming a path they
  deliberately created.
- **The guard's own reason is good and is not in dispute**: its docblock records that a symlinked
  `content` would let another vault's notes be indexed as this vault's own, and the sibling clause
  skips a link even when it resolves inside, because a link and its target are one file and indexing
  both produces a duplicate finding naming two paths only one of which is real.
- **So this is a design question, not a bug to fix quietly:** is a symlinked content root supported,
  refused with a message that says so, or supported with the duplicate problem solved another way?
  Whoever answers it should read `refuseEscapingLink`'s docblock first — the cheap-looking fix
  reopens exactly what it was written for.
- **How it was found, which is the useful part.** R1 narrowed `writeIndexArtifacts`'s containment
  anchor from the brain root to the content root, on a review finding that the wider anchor "breaks a
  real layout". Driving that layout showed it was **already** broken one layer up, and had been since
  `discover.ts` was written. The narrowing was still right — it removed a redundant refusal raised at
  the wrong layer with the wrong exit code — but it rescued no working configuration, and the review
  finding's "regression" framing was wrong. Recorded so the next reader does not repeat the trace.

### NEW-20 — `capture` proves its quarantine root, then follows the path again

- **Status:** open, found 2026-08-15 by the fourth independent review of DOS-P6 Task 19 · **Owner:**
  whoever next touches `apps/cli/src/commands/capture.ts` — DOS-P7 by default · **Size:** XS ·
  **Security** · **Theoretical: it needs a won race, and it is not a regression**
- **The window.** `resolveQuarantineRoot` proves the quarantine directory resolves inside the content
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
- Cross-referenced from `docs/architecture/threat-model.md` §5.2, where the boundary is described.

### NEW-11 — the invisible-title rule stops at the title

- **Status:** open, found 2026-08-11 by the review that closed NEW-10 · **Owner:** the next task
  touching `packages/brain/src/indexes/render.ts` or `packages/brain/src/lint/lint.ts` — DOS-P6 by
  default · **Size:** S
- NEW-10 gave `title` a predicate that means *at least one visible character*. **Two neighbours
  did not get it**, and both surface the way NEW-10 did — a rendered row that says nothing:
  - **`tags`** is validated as a string array and nothing more, so `tags: [""]` and
    `tags: ["\u200B"]` both pass. The tag cloud then renders `-  (3)` — two spaces, a count
    attached to no label — and the folder table's "Top tags" cell gets an empty entry between
    commas.
  - **`summary`** is type-and-length only. `summary: "\u3164"` renders `- [Title](<path>) — ㅤ`,
    a dangling em-dash. Cosmetic, unlike the tag case.
- **The `duplicates` key has the older, narrower definition.** `lint.ts` keys on the *screened*
  title, and the screen deletes `\p{Cf}` only — so `Deploy keys` and `Deploy\u3164keys` produce
  different keys and no duplicate is reported, while `catalog.md` shows two rows a human reads as
  identical. That is precisely the failure NEW-6 was opened for, one character class over.
- **It is two fixes, not one, and the reviewer's correction is worth carrying.** `tags` and
  `summary` want the *boolean* NEW-10 already wrote — move `isBlank` out of `note.ts` to
  `packages/security` when that second call site appears, rather than copying it, which is the rule
  that module's own header states. The duplicates key wants something `isBlank` cannot give: a
  **perceptual grouping key**, a third function returning a string with invisibles removed and
  marks untouched. Anyone who starts by reaching for `isBlank` there has started wrong.
- **Do not fix either by widening the display screen.** `screenControlCharacters` must not delete
  non-spacing marks: it would corrupt every accented and every Indic title it touches.
- **A cheap interim exists for the half that is user-visible.** A `frontmatter`-class lint finding
  for a blank tag needs no renderer change and no new module, and it does not prejudge the policy
  question the full fix has to answer — whether an invisible tag is an error, a warning, or
  silently dropped at index time.

### NEW-15 — nothing that executes a discovered binary pays the check its type demands

- **Status:** open, found 2026-08-14 while writing `docs/architecture/threat-model.md`, verified
  independently by that task's review. **Attempted 2026-08-15 as R1 Task 4 and deliberately not
  shipped** — a working guard was built, tested and then withdrawn, because the obvious policy
  refuses this product's own vendors. What is now owed is a **founder decision**, not an
  implementation; see "What the attempt settled" below · **Owner:** the founder for the policy, then
  DOS-P7 for the code · **Size:** S · **Security**
- `packages/platform-macos/src/types.ts:13-18` states the contract in its own words: **whoever
  executes a discovered binary owes an owner and mode check first.** `discoverExecutable` finds a
  name on `PATH` and returns a path; it does not vouch for it.
- **DOS-P6 is the first executor and pays nothing.** `selectVendor` returns
  `discovery.executablePath` (`apps/cli/src/commands/ingest.ts:454-463`) and the run spawns it
  through `invokeVendor` (`:1425`, `:658`); no `stat`, no uid comparison and no mode comparison exists anywhere on that path — the
  only `lstat` in the file is on a note path and the only mode is a `mkdir`.
- **Widened 2026-08-15 by Task 17: `capture` is now a second executor on the same terms, and it is
  the product's most-run command.** While `AGENT_DETECTION_ROWS` was empty this path was dormant;
  the Claude row made it live. `discoverSourceAgent` (`apps/cli/src/commands/capture.ts`) spawns the
  PATH-resolved `claude` — first `/usr/bin/which claude`, then `<resolved> --version` — whenever
  `CLAUDECODE` is exactly `1`, the value the row records; `matchObservedAgent` compares the observed
  value against the row's, so `CLAUDECODE=true` does not trigger it. And
  `MacOsPlatformAdapter.discoverExecutable` resolves through `process.env.PATH` — again with no
  `stat`, no uid and no mode check. **`CLAUDECODE` is trivially settable**, so any wrapper, direnv
  file or CI step that exports it and prepends a directory it controls gets its own `claude`
  executed by every `developer-os capture`. This is the same defect, not a new one; what changed is
  that it moved from an occasional command onto the common one.
- **What it is not:** privilege escalation. The binary runs as the user either way, and a user who
  can write their own `PATH` can already run anything. **What it is:** the product hands that binary
  the user's captured observations and read access to the whole vault, on the strength of a name
  match. A world-writable directory earlier on `PATH` is the ordinary way this goes wrong. Under
  `capture` the exposure is narrower than under `ingest` — a `--version` probe is handed no
  observation and no vault path — but it is still an unchecked execution the type says is owed one.
- The nearest existing record is `claude-adapter.md` §9 residual 10, which notes the execution and
  **not** the check — which is why this row exists rather than a pointer to it.

**What the attempt settled, 2026-08-15.** R1 Task 4 built the guard — `assertTrustedExecutable`,
walking the executable and every ancestor to `/`, refusing a component owned by neither the current
uid nor root, refusing `(mode & 0o022) !== 0`, and refusing a symbolic link anywhere in the chain
rather than following it. Six unit cases, watched red then green; both call sites wired with the
behaviours each command's contract already demands (`capture` swallows the refusal and records
`unknown` per spec §5.4, `ingest` refuses outside the `catch` that would otherwise hide it). **It was
withdrawn before commit and the row stayed open**, for one reason and one class of reason.

- **The rules as stated refuse this product's own vendors, on the founder's own machine.**
  `command -v claude` and `command -v codex` both resolve to `~/.local/bin/…` and **both are
  symbolic links**, so the no-symlink rule refuses both outright. `/opt/homebrew/bin` is
  `drwxrwxr-x` — **group-writable** — so the mode rule refuses every Homebrew-installed binary,
  which is the ordinary way these CLIs arrive. Shipped as specified, `capture` would record
  `sourceAgent: "unknown"` forever and `ingest` would exit 5 on every run.
- **The test harness collision is real but secondary.** `tests/helpers/temp-home.ts` sandboxes under
  `/tmp` on purpose — its docblock records that `os.tmpdir()` paths are long and high-entropy enough
  that the product's own redactor rewrites them, after which discovery reports nothing — and `/tmp`
  resolves to `/private/tmp`, mode `41777`. The one e2e case that spawns the real binary therefore
  went red on a correct refusal.
- **One loosening was considered and rejected on its merits**, and the argument is worth keeping: a
  **sticky bit does not make a world-writable directory safe here.** It stops another user deleting
  or renaming a file they do not own; it does not stop them **creating** one under a name nothing
  owns yet. So exempting sticky world-writable ancestors would wave through exactly the planted
  binary this row exists to refuse.

**So the open question is the policy, and it is the founder's**, because it decides whether the
product runs on an ordinary macOS install: **(a)** canonicalize and check the *resolved* target and
its ancestors — which is what the kernel actually runs at `exec` time — rather than refusing symlinks, at the
cost of a check-then-use window of the shape already registered as NEW-20; **(b)** whether
group-writable is refusable at all when the group is the user's own, given Homebrew; **(c)** whether
`tests/helpers/temp-home.ts` relocates off `/tmp`, and what replaces the redaction-threshold
reasoning that put it there.

**The code was not retained, deliberately, and that is the right trade.** What is written down above
is the whole of what the attempt bought: the policy, the two real-machine facts that defeat it, the
loosening that was rejected and why, and the test-harness collision. The guard itself was about a
hundred lines against an injected `lstat` and `currentUid`, and **whatever replaces it has to differ
in the two rules that matter**, so keeping the withdrawn version would preserve mostly the parts that
were wrong. Rebuilding it against a settled policy is a short task; deciding the policy is the long
one, and that is what this row is now.

### NEW-16 — spec §8.2's user-configured redaction patterns are unreachable

- **Status:** open, found 2026-08-14 while writing the threat model, verified independently by that
  task's review · **Owner:** DOS-P7 · **Size:** S
- `redactText`'s `userPatterns` parameter **has no production caller.** All thirteen call sites across
  `apps/` and `packages/` pass two arguments; the parameter appears only in
  `packages/security/src/redaction.test.ts` and in built type declarations.
- The other half is missing too: `configSchema` is `.strict()`
  (`packages/core/src/config/loader.ts:130-153`) and carries no redaction table, so there is no
  `config.toml` key a user could set even if a caller existed.
- **The consequence is narrow and worth stating precisely.** The four built-in redaction classes work
  and are tested; what is unreachable is the *user-extensible* class the knowledge-pipeline spec §8.2
  describes — the one a founder would use to redact a client name that no generic pattern catches.
  Nothing regressed; it was specified and never wired.

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

### NEW-12's successor — a derived path will wear a write scope's name

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

### NEW-12's other residual — `ingest` can no longer produce a screening refusal

- **Status:** open, registered 2026-08-17 · **Owner:** whoever gives `ingest` an argument a screen can
  refuse · **Size:** XS · **Coverage, not security**
- Closing NEW-12 made `invokeVendor`'s refusal-detail branch (`apps/cli/src/commands/ingest.ts:729`)
  **unreachable from every production path**, verified against all four sources the branch's own
  docblock lists: the prompt is prefixed with a Markdown heading so the dash rule cannot fire; the
  working root and output schema path are assembled from validated absolute paths and now take the
  derived screen; spec §3.3 passes an empty write-scope array; and the turn bound is
  `DEFAULT_MAX_TURNS`, a compile-time constant inside the window `invokeClaude` enforces.
- **The branch is retained as defence in depth** — NEW-12's successor above brings the user back — but
  the interpolation it performs is no longer covered end-to-end. It was covered by exactly one case,
  which asserted a refusal this product should never have produced, and that case now asserts the
  acceptance instead.
- **No fixture can reach it**, because the refusal happens before the fake runner is called and the
  harness has no injection point for a vendor outcome. Recorded rather than replaced with a test that
  would have to fake the thing it is testing.

### NEW-23 — `path:line` citations rot silently, and nothing checks them

- **Status:** open, registered 2026-08-17 after this became a review finding for the **third time in
  two rounds** · **Owner:** whoever adds the next repository check — DOS-P7 by default · **Size:** S ·
  **Documentation integrity**
- **The architecture notes hold themselves to a standard nothing enforces.**
  `knowledge-pipeline.md`'s own preamble says "every claim here points at code or at a named test
  case, `path:line`, which is the standard `threat-model.md` holds itself to." **Counted 2026-08-17
  by script rather than by estimate: 372 citations across nine documents** — 218 full `path:line`,
  117 bare continuations (`` `:1041-1054` ``, resolved against the last filename on the line), and 37
  bare basenames (`` `ingest.ts:541` ``). They are maintained by hand, and **`npm run check` is green
  with every one of them broken.**
- **They rot on any edit, not on a rewrite**, and this row exists because the repair is harder than
  the rot. Adding eleven lines to one docblock in `apps/cli/src/commands/ingest.ts` moved twelve
  citations in two documents. The session that noticed then made it **worse, twice**: it computed the
  shift arithmetically from a stale diff, so every correction was off by nine; and a typo in its own
  substitution script wrote the literal string `appsig/PLACEHOLDER` into two of `threat-model.md`'s
  security-invariant evidence cells, where `npm run check` passed over it. **A freshly-touched wrong
  citation is worse than an untouched stale one, because it looks verified.**
- **What worked, and is the method any fix must use:** map HEAD line → current line with a diff over
  file *contents*, then accept a new address only when the cited lines are byte-equal to what HEAD
  held. Arithmetic on hunk offsets is what failed, three times.
- **The method has an ordering rule and it is not optional: remap *last*, immediately before staging,
  and re-verify after any subsequent edit to a cited file.** A correct remapper run at the wrong time
  is indistinguishable from a broken one. This was the fourth consecutive failure of this class and
  the first one where the tool was right: two docblocks were edited *after* the remap, and every
  citation past those insertions was stale again on arrival. Re-running the remapper as the final
  action must propose **zero** changes; if it proposes any, a cited file was edited after the previous
  run.
- **Two holes in byte-equality, both of which fired here.** First, **a citation whose cited content
  was itself rewritten has no byte-equal target anywhere**, so the tool cannot remap it — and a tool
  that silently keeps the old value in that case reports success while leaving a stale citation. It
  must be a hard error the operator resolves by hand. Second, **byte-equality proves nothing when the cited
  content is not unique in the file** — and this applies to *every* method here, the forward-unpaired
  verifier included, because it is byte-equality too.
  **The property is uniqueness, and a length heuristic is the wrong proxy for it.** A first line of
  `]);` matches any `]);` in the file, which is how one wrong citation survived three repair rounds —
  but the live case that matters is a 23-character line of ordinary code, `redactText(value, key),`,
  which occurs twice in `ingest.ts` and is cited at *both* sites in one comma list. Swap the two and
  every check here still passes: the content resolves in HEAD, and the HEAD document cited both
  locations. A "punctuation-only or under fifteen characters" rule returns false on it.
  **So count occurrences of the cited content in HEAD and treat more than one as ambiguous**, to be
  disambiguated by position — prefer the candidate nearest the content-anchored mapping — or escalated
  to a human. Length and punctuation are an additional signal, never the test.
- **The scope is every changed file, not every changed *source* file.** Test files are cited as
  evidence too — a test name is the evidence for most of `threat-model.md`'s rows — and three repair
  rounds swept only `src/`, leaving a citation pointing at the *opposite* assertion in a neighbouring
  case.
- **Why this is worse than ordinary staleness.** The evidence column is the mechanism by which a
  reader verifies a trust boundary. A citation that lands mid-docblock does not look wrong — it looks
  like a claim the reader failed to understand, so the failure mode is a reader who doubts themselves
  and moves on.
- **The fix is a repository check**, in the shape `tests/repository/` already uses: extract every
  citation, refuse one whose file does not exist or whose range is out of bounds, and assert the
  extracted set is non-empty **per document** — `SESSION.md`'s rule that a gate which can pass by
  scanning nothing is not a gate.
- **Two forms make it harder than it looks, and neither is optional.** A **bare continuation** carries
  no filename and must be resolved against the last path named on its line; there are 117 of them, and
  the first repair pass missed the form entirely. A **bare basename** is worse, and the ambiguity is
  measured rather than assumed: of **19 distinct bare basenames cited, 8 resolve to more than one
  file** — a basename of `types.ts` has **five** candidates across `core` and `platform-macos`,
  `validate.ts` has three, and `invoke.ts` has two, `adapter-claude` against `adapter-codex`, so
  guessing wrong points a reader at the *other vendor's* adapter. The check either rejects those or
  needs a resolution rule, and deciding that rule is most of the work.
- **The obvious specimen is the misleading one.** An earlier draft of this row illustrated the
  ambiguity with a basename of `ingest.ts` — which resolves to **exactly one** file in this
  repository. An implementer testing the stated example first would find it unique and conclude the
  resolution rule is easy. Same defect class as the "known wrong" list below: a correct conclusion
  resting on an unverified example.
- **A third hole, and the one most likely to defeat a naive implementation.** A verifier that pairs
  each HEAD citation with its current counterpart **cannot see a citation whose group changed size** —
  one split into two, a new row added, a stale one already fixed by hand. It has no twin to compare
  against and the natural implementation skips it silently. The trap is that **the act of improving a
  document is what disables its verification**, so the tool is weakest exactly where the editing was
  heaviest. Both surviving errors of the 2026-08-17 repair sat in such groups. The fix is to verify
  **forward and unpaired**: for each citation in the *current* document, locate its cited content in
  HEAD and require the HEAD document to have cited that location. Unpairable is a hard error, like
  unmappable — and a legitimate semantic re-citation will trip it, which is correct: a human should
  confirm that a citation was moved on purpose.
- **The row specifies a gate that will extract the row.** NEW-23's own prose contains specimen
  citations written as illustrations of a *form*, not as evidence, and any extractor picks them up.
  One of them is even in bounds, so it fails silently rather than loudly. The gate needs a stated
  exemption — a fenced block, an escape, or an explicit marker — decided before it ships, or its first
  run trips on its own specification.
- **Bounds-checking is what is affordable, and it is not sufficient.** Whether the cited lines *mean*
  what the sentence claims is not machine-checkable. `threat-model.md` cited
  `packages/adapter-codex/src/invoke.ts` for the `-s read-only` derivation while pointing at
  `finalJsonlLine`'s docblock — wrong function, right file, in bounds. A bounds check passes that
  forever. Whoever ships the gate should say so in the test, or a green run will be read as "the
  evidence is sound".
- **Adoption will go red, but not on the list this row first carried.** An earlier draft named four
  "known wrong" citations from memory, and the accounting was loose in both directions: **two were
  fully correct**, one had **no citation on it at all**, and the fourth contained a genuinely wrong
  citation the draft did not name. Not one of the four was right as stated — a caution that belongs in
  the row about the row. Verified by resolution on 2026-08-17: of the 229 spans in the four main documents,
  **all now resolve in bounds**, and the genuinely wrong one found was
  `tests/security/network.test.ts:176-179`, which begins on a closing brace. Whoever adopts the check
  runs it first and fixes what it actually reports. **In bounds is not the same as correct** — see the
  bullet above on the wrong-function-in-bounds case; a clean bounds sweep says nothing about whether
  the cited lines support the sentence.
- **A cheaper alternative was considered and is worse:** citing symbols rather than lines
  (`cli.ts` `screenValueArgument`) never rots, but it is a repository-wide prose migration of ~370
  sites and it loses the ability to point at a *range* of reasoning inside one function, which is what
  many of these citations are doing.

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

- **`tests/security/` holds eight suites, not the six spec §9 names** — sentinel, prompt injection,
  symlink escape, multiline command, malformed manifest and interruption from §9, plus **network** and
  **concurrent edit**, the two §7's standing gate requires and §9 dropped. Every suite was watched
  fail before it was believed, and thirteen reverts are recorded with the line each disabled. **47 of
  its 85 cases carry that evidence and 38 do not** — the total counted by collection
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

**Two rows were raised by DOS-P6 during implementation rather than planning**, which is why neither is
in a table above. **Both were ratified by the founder on 2026-08-15**, in the session that ran Task 17;
they were the last unratified rows in this section, and there are now none. Each leaves the table when
DOS-P6 Task 19 Step 5 lands, per the rule that a row leaves when the amended document carries the
cross-reference.

| Amended | Outcome, **ratified 2026-08-15** | Raised by |
|---|---|---|
| the knowledge-pipeline spec §6.1, "one capture, one agent call, **one transaction**" | the last third is false and cannot be made true. The ladder performs four mutations and **the executor's lock is per-execution**, so it ships as **four transactions per capture** — `ingest-stage` (the capture file, `accepted → staging`), `ingest-apply` (the proposed notes), `ingest-reindex` (the index artifacts), `ingest-ingested` (the capture file, `staging → ingested`) — plus a compensating `ingest-rollback` on failure. Two independent reasons no two of them merge: `BrainService.reindex()` **reads the vault**, so it cannot run until the apply has finalized; and `validateChangePlan` grants ownership from the manifest, where the index artifacts are recorded and a capture is deliberately absent (spec §3.4 keeps a capture hand-editable in Obsidian). **The residual, accepted rather than closed:** a crash between the apply and the last transaction leaves a capture at `staging` with its notes already applied — inert, because the next run selects only `accepted` captures and cannot double-apply, and recoverable by `repair` plus a hand edit. **Cost of overturning:** there is no cheaper arrangement to overturn it to; the alternative is a Foundation change letting one execution span a read of what it just wrote. **Ratified as shipped by the founder on 2026-08-15**, four transactions and the accepted `staging`-with-notes residual together; the Foundation alternative was declined rather than deferred | DOS-P6 Task 13, plan correction 4 |
| the knowledge-pipeline spec §6.3, `confidence and lifecycle` | the spec names the validator and says "required frontmatter for the note's declared stage is absent" — **it never says which frontmatter**. Shipped rule: `established` requires `reviewed` to be a date, `deprecated` requires `updated` to be present, `emerging` requires nothing extra. It is **defensible but invented**: nothing in the tree enforced either before this task. It is grounded in a contradiction the product already flags — `lint.ts:285-294` grades an agent-authored, never-reviewed note as `provenance` at severity **warn**, so ingest turns only the narrower `established`-while-never-reviewed claim into a refusal. **The broad reading was checked and rejected**: refusing every `author: agent` + `reviewed: null` note would refuse every proposal this pipeline can produce. **Cost of overturning:** two `if`s at `validate.ts:444-461`; this validator writes no data, so nothing has to be migrated. **Ratified as shipped by the founder on 2026-08-15**: the invented rule stands as written, so the spec's silence is closed by this row rather than by a change to the code | DOS-P6 Task 12, `validate.ts` |

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
