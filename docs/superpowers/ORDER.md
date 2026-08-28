# Execution order

The queue. Work top to bottom. This file answers one question — *what do I do next* — and
nothing else; the detail behind each entry lives in `BACKLOG.md`.

> **Starting a session?** Read `SESSION.md` first. It is the procedure; this is the queue.

**How to use it**

1. Read `NOW` below. That is the only thing in progress.
2. Check the entry's **Needs** column. If it is not satisfied, you are on the wrong entry.
3. Do the work in the linked plan, not from this file. This file has no implementation
   detail on purpose.
4. When the entry's **Done when** is satisfied *and committed*, update its Status here in
   the same commit, and move `NOW` down.

**Status values:** `done` · `now` · `next` · `blocked` · `parallel` · `open`. A cell may add a
qualifier after an em dash — how far along, how long it has been open — because for the items
that have sat longest that is the most useful thing on the row.

**Closed entries are removed, not kept as rows.** Finished work leaves an architecture note and
a line in the table below; git history is the archive. A queue that lists what is done stops
answering the one question it exists for. **The same rule was applied to this file's own prose on
2026-08-17**: the narrative of work already closed — R1's account of what it fixed, the Critical
finding the security review caught, the flaky-test diagnosis whose fix has landed — was deleted
rather than kept as a retrospective. What survives below is what somebody still has to do, plus
the open questions and unowned residuals that outlive the work that found them.

**One rule that is not negotiable:** an entry is `done` only when its evidence is in a
commit. A green local tree is the state this repository was already in once, and it cost a
week of confusion.

---

## NOW

**`NOW` is A11 — DOS-P7 Git, automation, update, and release.** Its first of two specs was approved
by the founder on 2026-08-28 after fresh-context `READY`, and its implementation plan is
`plans/2026-08-28-developer-os-opt-in-surfaces.md`. **Do not execute that plan yet.** A11's next gate
is the Spec 2 design/approval/plan cycle; Spec 2 must then implement the `InstallationManifestV2`
migration and V2 new-init handoff before Spec 1 implementation may begin.

**A10 · DOS-P6 Knowledge pipeline closed on 2026-08-24 in `7eda70e`.** The surviving record is
`docs/architecture/knowledge-pipeline.md` and `docs/architecture/threat-model.md`, with the completed
plan and specification in git history. That closure commit is still local to this branch; its
publication and CI must be reported with the current branch workflow, but A10 is not an open queue
entry or a closure candidate.

---

## Open on the product path, and not owned by any queue entry

Everything in this section is unfinished. Nothing here is a record of work that closed.

### One Foundation question left, raised by DOS-P6

**The first three were R2's and are closed.** A command can supply a precondition
(`PlannedFileMutation.expectedBeforeHash`, R2 Task 8); a removed secret no longer survives in an
unpruned backup (R2 Task 6); and `CliError` carries a `data` slot only a redactor can fill (R2 Task
7). All three were decided on 2026-08-17 and landed between 2026-08-19 and 2026-08-20; what each one
cost is in its commit message, and the residuals each left are `BACKLOG.md` §1 rows.

What is left is **one open founder question from Foundation itself**, and it blocks nothing: whether
`SpawnLockfRunner` needs a watchdog around the non-blocking `lockf` call. The permanent per-ID lock
question was answered on 2026-08-26 in A11's design cycle: terminal evidence and held transaction
locks are compacted under the global mutation lock; an immutable installation nonce plus monotonic
allocator prevents ID reuse, and guarded aggregate/planless-orphan rules bound the companion
inventories. Lifecycle-owned Foundation journals retain the shipped serializer and coordinator
compaction removes journal → held lock → plan, while every new Foundation/coordinator journal proves
its 1-MiB feasibility before ID reservation and the global lifecycle lock remains permanent. `BACKLOG.md` §2 and
`foundation-constraints.md` carry the question and that pending-
implementation disposition.

A fresh-review closure ratified on 2026-08-27 additionally guards incomplete initial plan/journal
temps before first intent, gives Foundation mutation payloads the common 16-MiB streamed bound, tags
an absent Git source index explicitly, and gives launchd-only automation reconcile a real `Q`-only
variant without fake file writes. These are corrections inside the written A11 spec; they do not
change the full-spec founder-approval gate that still applied at that point.

The founder ratified one follow-up package the same day: plan-bound Git-effect journal feasibility,
the measured no-pack up-to-date push branch, counted/deadlined Git process streams, and exact five-key
launchd plist XML. It likewise closes review findings without approving the complete specification.

The founder ratified the post-follow-up review closure on 2026-08-27 as well: derived/plan-bound
Foundation and coordinator journal feasibility, an explicitly per-top-level-invocation push deadline,
the exact `gui/<uid>` launchd domain with service-target observation, and a hash-bound bounded
`launchctl` process table for `print`/`bootstrap`/`bootout`. This was a narrow correction package;
the complete written specification still awaited approval then.

The founder ratified the seven-finding fresh-review correction package on 2026-08-27 too: rollback never
deletes published source/destination Git objects or a newly published `.git` tree; launchd process
staging has an exact empty grammar; runners hold a per-job lifetime lease before the global lock;
absent-manifest uninstall requires exact no-install evidence; Git metadata reads have numeric bounds;
and the legacy Foundation mutation index is canonically `0..4294967294`. This also is correction of
the written artifact, not approval of the complete specification; A11 remains at the same gate.

The founder then ratified the post-package fresh-review correction on 2026-08-27: rollback legality
now names every relinquished Git role after its control preimage; launchd hash-binds root/home/tmp
directory identities; absent-manifest admission is process-free; absent runner leases are classified
only through marker, manifest, or exact uninstall closure; and canonical shadow Git config bytes bind
`http.followRedirects=false` before spawn. This was a narrow written-artifact correction. The
complete specification was not yet approved, so A11 still awaited founder approval then.

The founder also ratified the subsequent four-finding fresh-review correction on 2026-08-27: scheduled
argv carries the guarded canonical product home and ignores ambient overrides; `GitHeadStateV1`
represents an empty bare repository's symbolic `HEAD`; every persisted push binds a path-slot shadow-
config template for fresh retry instantiation; and the one alternate-object directory rejects Git list/
quote ambiguity. This was another narrow written-artifact correction. A11 still awaited approval of
the complete written specification then.

The founder ratified the final fresh-review correction package on 2026-08-27: public lifecycle plans
are allocation-free previews and apply persists a separately allocated preview-bound execution
envelope; `config get/set` has exact key/value/result and count-only redaction grammar; enable alone
creates `.git`, while sync journals bounded reflogs and the pack reader has explicit resource budgets;
generated Git-config paths reject controls/line breaks; launchd bootstrap inherits as FD 3 via
`/dev/fd/3` only the already-unlinked immutable private snapshot descriptor, never the real source plist
descriptor; runners authenticate installed generation evidence before choosing active versus
`automation_disabled`; and absent-manifest uninstall inventories the complete product home before key
deletion. The founder approved those corrections only. The complete specification remained
unapproved then, so A11 stayed at the same S gate and no plan or implementation was authorized.

The founder ratified the post-final fresh-review correction package on 2026-08-27: scheduled
generation authentication remains independent of active provenance until the locked eligibility
decision; reflog state admits the exact 64-MiB-plus-4-KiB postimage and binds every append bijectively
to its transition; pack header, admitted-entry, unique-closure, and process counts share the 200,001
ceiling; launchd inherits only an already-unlinked private plist snapshot on FD 3 and restores the
descriptor baseline; fresh init/uninstall use exact double-inventory `LifecycleBootstrapLockV1`
coordination; and absent key returns before coordinator creation while present key alone derives its
two transitions in the closed flat bootstrap envelope, not the installed ledger. These were narrow
written-artifact corrections only. The complete specification remained unapproved then, so A11
stayed at the same S gate and no plan or implementation was authorized.

The founder ratified the post-review bootstrap closure on 2026-08-27: a live attempt removes only the
empty product/state directories whose identities it recorded, while a crash may preserve the
indistinguishable exact empty skeleton rather than authorize its deletion; every file/control residue
remains closed. `LifecycleBootstrapCreationTempV1` fixes initial nonce/allocator temp paths,
metadata, byte-prefix bounds, and partial-write recovery. This was still a narrow correction only.
The complete specification remained unapproved then, so A11 stayed at the same S gate and no plan or
implementation was authorized.

The subsequent fresh-review closure on 2026-08-27 removes three final summary/recovery
contradictions: launchd tables inherit only the already-unlinked snapshot and never the real plist
descriptor; one `LaunchdBootstrapSnapshotCreationV1` linked planned-byte prefix is recoverable only at
the exact current effect frontier; and a flat key-present coordinator may retain its authoritative
final journal plus one bounded rewrite temp after a cursor/phase crash. This was still
written-artifact correction only. The complete specification remained unapproved then, so A11 stayed
at the same S gate and no plan or implementation was authorized.

The founder approved the complete Spec 1 on 2026-08-28 after a full green gate and a new independent
`READY`. Its implementation plan is `plans/2026-08-28-developer-os-opt-in-surfaces.md`. The next A11
action is Spec 2 design/approval/planning and its manifest handoff; Spec 1 implementation remains
blocked until that handoff lands.

### Two gate-integrity residuals, both unowned

**The test suite is one contended run from red.** `apps/cli/src/commands/doctor.test.ts:228` needs
3.19 s of a 20 s budget on an idle machine and went over it under load; the fix that shipped is
`fileParallelism: false` in `tests/vitest.config.ts`, which removes the starvation and costs about
60 s of wall clock. **The underlying fragility is unowned and stays that way**, and this is the second
gate-integrity item this program has paid for.

**A third occurrence, 2026-08-17, recorded because this section asks for occurrences.** One
`npm run check` during Track R Task 1b ended `1 failed | 1986 passed`, in a run whose test phase took
**959 s against roughly 850 s when green** — consistent with the starvation diagnosis above. It did
not reproduce across two subsequent full runs. **The failing test's identity was not captured**,
which is the useful lesson rather than the datum: the run was piped through `tail`, so the name
scrolled past. Whoever next meets this should keep the full log.

**One symptom is explicitly not covered by that diagnosis.** Two red runs also produced
`ENOTEMPTY: rmdir …/backups/transactions/tx_fixture_001` during that fixture's own cleanup, which is a
filesystem race in recursive removal rather than CPU starvation. Serializing may only have made it
rarer. It is unmeasured and possibly still live.

**One unexplained gate failure, 2026-08-15, recorded because it is unexplained.** A single
`npm run check` exited 1 after lint and all 1956 tests had passed, with `$ tsc -b` as the last output —
so the failure was in `pnpm build` or `git diff --check`, and the edits in that round were **markdown
only**. It did not reproduce across four `pnpm build` runs and two full `npm run check` runs. No
diagnosis, no owner, and deliberately not dressed up as one. Noted so that a second occurrence is a
pattern rather than a first.

### What DOS-P6 still hands forward

- **No interactive vendor session has ever been observed, on either vendor** — NEW-42. Both detection
  rows and the whole of what is known about the JSONL protocol come from the non-interactive form,
  and the interactive one is where a founder captures. It needs a human at a terminal.
- **The replacement parsing rule carries one inference of its own** — NEW-45. Every recording holds
  exactly one `agent_message`, so "the last one wins" is unobserved and is labelled as such at the
  seam rather than written as a fact.
- **A nested session mis-attributes its capture** — NEW-44, and no row order fixes it.
- ~~The Codex arm of the security suite has never executed~~ — **NEW-43, closed 2026-08-21.** One case
  with `claude: false` lands an in-scope note through the Codex arm before refusing a traversal in it,
  which is what proves the reply was *understood* rather than merely unparsed: a drifted dialect writes
  nothing, and a case that only checked nothing was written outside the vault would sleep through the
  bug the row was about. Listed struck through rather than deleted because it is the row that shows
  what a session can close unaided — three of the other five are the same way.
- **The widened spawn trigger is only half closed by the trust check** — NEW-46.
- **Whether a model-run command can write raw bytes into the stream this product parses is
  unexamined** — NEW-47, which decides NEW-45's tie-break and settles from vendor source without
  spending anything.
- ~~The Brain lint inventory omitted all five warnings~~ — **NEW-48, closed 2026-08-24.** The
  current six-class inventory moved into `docs/architecture/brain.md` before the completed spec was
  deleted, so no approval question remains against a retired document.
- **Direct adapter invocation has a turn-bound asymmetry**: Claude accepts a bounded `maxTurns`,
  Codex has no field, and the shared `agent.prompt` parser refuses the key before vendor selection.
  DOS-P7 owns a cross-vendor bound; `codex-adapter.md` §7 and §11 carry the current contract.

**The terminal-event rule is no longer on this list**, and how it left is the more useful fact: it did
not get confirmed, it got falsified. NEW-21's real call showed `finalJsonlLine` returned a
`turn.completed` usage record as an `ok: true` payload on every successful Codex run, and a second
defect beside it — the vendor refusing this product's own output schema — meant `ingest` had never
been able to run on that vendor at all. **Both were shipped, gated green, and reviewed.** What found
them was one real call, which is the argument for every remaining item on this list that says
"unobserved".

---

## What is closed, and what each closure left behind

Read the right-hand column before touching the subsystem it names; these documents are the reason the
plans could be deleted.

| Closed | When | What survives it |
|---|---|---|
| Foundation | 2026-08-01 | `docs/architecture/foundation.md`, `…-constraints.md` — the CLI, transactions, the manifest, one open founder question, and the DOS-P7 terminal-collection disposition. Gate evidence: `docs/releases/foundation-checkpoint.md` |
| A6 · DOS-P2 Brain engine | 2026-08-10 | `docs/architecture/brain.md`; completed plan and spec are recoverable from git history |
| A7 · DOS-P3 Workflow compiler | 2026-08-10 | `docs/architecture/workflow-schema.md` — the normative compiler contract, the four historical gaps DOS-P6 closed, the two genuine gaps that remain, and current residuals |
| A8 · DOS-P4 Claude adapter | 2026-08-11 | `docs/architecture/claude-adapter.md` — why in-place discovery beat a marketplace copy, why no hooks ship, and which findings are closed or remain owned |
| A9 · DOS-P5 Codex adapter | 2026-08-12 | `docs/architecture/codex-adapter.md` — why the install is a local marketplace, the real-binary amendments, the two-adapter table, and the current checkpoint state in §10 |
| A10 · DOS-P6 Knowledge pipeline | 2026-08-24 | `docs/architecture/knowledge-pipeline.md` and `docs/architecture/threat-model.md` — the canonical lifecycle, its trust boundaries, evidence, decisions, and residuals with owners |
| Track B · legacy exit | 2026-08-10 | `BACKLOG.md` §6 — what a cutover still has to know, and one decision (EXIT-1) that is a conversation with the founder rather than a backlog item |
| Track R · repository defects (R1) | 2026-08-15 | three `BACKLOG.md` §1 rows closed with a regression test each — NEW-18, NEW-17, NEW-19. It also turned **NEW-15** from an implementation into a founder decision, and added **NEW-22**. Both are §1 rows |

---

## Track A — product

Strictly sequential. Subsystem rows carry three gates: **S** = spec approved through a
brainstorming cycle, **P** = implementation plan written, **I** = implemented, reviewed and
committed. All three belong to that row; do not start `I` before `P` is written, and do not start
`P` before `S` is approved.

| # | Entry | Plan | Needs | Size | Done when | Status |
|---|---|---|---|:---:|---|---|
| A11 | DOS-P7 Git, automation, update, release — S / P / I | two specs, two plans | nothing | L | program plan Task 7 checkpoint: full local lifecycle ready for cutover | **in progress.** Spec 1 is approved and plan 1 is written but blocked on Spec 2's manifest handoff; Spec 2, plan 2, and both implementations are owed |
| A12 | DOS-P10 Managed instruction artifacts — S / P / I | to write | A11 | L | thirty-eight instruction artifacts install, drift-check and uninstall under manifest ownership on both vendors | blocked |
| A13 | DOS-P11 Hooks — S / P / I | to write | A12 | L | a hook is observed firing in a test, and every shipped handler names the installed binary | blocked |
| A14 | DOS-P12 Repository tooling verbs — S / P / I | to write | A13 | M | every legacy tooling script is a product verb or a recorded refusal | blocked |
| A15 | DOS-P8 Founder shadow migration | to write against A11–A14's output — decided 2026-08-10 | A14, L2 | L | rollback exercised once; one complete stable cycle on the new runtime | blocked |
| A16 | DOS-P9 Public beta and v1 | `plans/…-program.md` Task 9 | A15, **L1**, **L2** | L | `v1.0.0` published and reproducible | blocked |

**A15 gets its own plan** — settled by the founder 2026-08-10, authored against the lifecycle it cuts
over to and not before it; `BACKLOG.md` §4 carries the reasoning and what it must contain. That plan is
now owed against A11 **through A14**, because the cutover's scope changed on 2026-08-20 and a plan
written against A11 alone would rehearse a rollback for a third of the product. **A16's equivalent
question is open**: no dedicated plan is mandated, and DOS-P8's answer does not transfer, because
DOS-P8 mutates the founder's live machine while DOS-P9 publishes a release.

**A12, A13 and A14 were added on 2026-08-20, and the entries below them were renumbered.** The founder
ruled that the legacy shared runtime is retired **entirely** rather than partially, and the product as
scoped could not absorb it: a parity read found three whole layers with no owner in any document —
eleven event hooks, thirty-eight instruction artifacts, and nine repository tooling scripts. The
cutover cannot retire what the product never built, so the three subsystems sit ahead of it. **The
renumbering was chosen over appending A14–A16 out of order**: thirteen citations across three files is
a cheap edit, and a queue whose numbers do not imply sequence is a queue that has to be read twice.
`BACKLOG.md` §3 carries what each spec must decide.

**The 2026-08-21 suspension for A11 has ended with A10's closure.** A12 through A15 remain
sequenced behind A11. Spec 1's founder-approval gate closed on 2026-08-28; A11 now waits on Spec 2's
design/approval/plan and manifest implementation handoff.

**The founder also ruled the sequence strict** — A11 → A12 → A13 → A14 → A15 — rather than
running the three new entries as a parallel track. None of them needs DOS-P7: their renderers closed
with DOS-P4 and DOS-P5 and their artifact mechanism closed with Foundation, so all three are
technically startable once A10 closed. The sequencing ruling itself stands.

---

## Track R — repository defects

Not subsystem work and not on the product path. This track exists because `BACKLOG.md` §1 accumulates
defects that reviews find while doing something else, each with an owner named as "whoever next
touches it — DOS-P7 by default" — and DOS-P7 is two gates away. A row lands here when its fix is
already specified and takes no decision away from the founder; anything carrying an open question
stays in §1 until that question is answered.

| # | Entry | Plan | Needs | Size | Done when | Status |
|---|---|---|---|:---:|---|---|
| R2 | Ten decided defects — six `BACKLOG.md` §1 rows, three Foundation requests, one DOS-P7 gap | deleted on closure, as a finished plan is | nothing | M | every closed row left §1, every amendment registered in §8, CI green on the commit | **code done 2026-08-20; CI gate unmet** |

**The fifth gate is unmet, and the row says so rather than reading as complete.** R2's eleven tasks
landed in five commits with `npm run check` green on the last of them, and the founder chose on
2026-08-20 to leave them local. On 2026-08-21 they asked for everything to go to `development` without
creating a branch, **and the remote refused it**: a ruleset on that branch requires a pull request,
and a pull request needs a head branch, so "land this without creating a branch" is not something this
repository permits. Told that the only route was one temporary branch merged and deleted, **the
founder chose to leave everything local.** So the gate that exists precisely because a green local
gate missed three DOS-P2 defects still has not run, and the reason is now a decision that was made
with the constraint on the table rather than an option nobody had tested.

**Two things were learned by trying.** `check.yml` scoped its `push:` trigger to `feat/foundation`,
a branch that **no longer exists on the remote** — the rule kept anything from landing unchecked, but
that trigger had stopped naming anything, and it now names `development`. And the protection is a
**ruleset**, which `.../branches/development/protection` reports as 404 "not protected"; the endpoint
that answers is `.../rules/branches/development`. Reading the first one and believing it is what put a
false claim into three files for the length of one commit.

**R2 existed because the five decisions those rows were waiting on were taken on 2026-08-17.** Each had
sat as "open" while being unimplementable, which is the state this track exists to resolve rather than
accumulate. What was decided:

- **NEW-15** — resolve, then check: canonicalize the binary and check the **resolved** target and its
  ancestors, refuse an owner that is neither the user nor root, refuse other-writable with or without
  the sticky bit, and **allow group-writable when the directory's owner is the user** — which is what
  lets an ordinary Homebrew install pass where the withdrawn strict guard refused it.
- **NEW-22** — a symlinked content root is **supported**: the content root is canonicalized into the
  containment anchor instead of being measured against the vault root.
- **NEW-16** — user redaction patterns get a `config.toml` `[redaction]` table, and the `.strict()`
  schema amendment is registered rather than slipped in.
- **NEW-11** — an invisible tag is a **lint warning**. The note still indexes.
- **NEW-12's path half** — split by provenance: a path this product derived itself keeps the dash rule
  and loses the word list. Not closed by narrowing the pattern, which its row forbids.

Three Foundation requests and the `accepted → rejected` gap are in the same plan, decided the same
day, because they were unowned for the same reason: no entry on the product path reaches them.

**Twenty-two §1 rows were deliberately not in R2**, and the session that finished it did not sweep them up
— R2 has closed all five it was opened for. *(That twenty-two is a snapshot of 2026-08-20 before A10's
work landed; current §1 accounting is 29 headings, 5 closed, and 24 open; the live count is at the end of this file.)* **Four belonged
to somebody else:** **NEW-21** was the founder's and blocked A10 until it closed on 2026-08-20, leaving
**NEW-42**, which needs a human at an interactive vendor session; **NEW-20** and **NEW-13** were
registered as deliberately-not-fixed; **NEW-7** needs ten minutes with a machine that has Obsidian
rather than an agent. **Eighteen came out of R2's own reviews**, registered between 2026-08-17 and 2026-08-19 by the reviews that produced them. **NEW-27** and **NEW-28** came from NEW-12: a derived path that will wear a write scope's name, and
an interpolation in `ingest` that no longer has an end-to-end test because no production path can
reach it. **NEW-24**, **NEW-25** and **NEW-26** came from NEW-16: a common redaction pattern that
refuses every ingest and cannot be diagnosed without widening a persisted type; two partially
overlapping patterns that cannot both redact; and a vendor's stdout redacted with built-in classes
only, because the process runner is built before any configuration is read. **NEW-29** came from the
same review and is a gate-integrity item rather than a product one: a wall-clock assertion in the
standing suite that can redden an unrelated commit. **None is R2's to fix, and the count is the
honest cost of closing five rows — though NEW-22 closed leaving nothing at all, which is the
counter-example worth keeping in view** — a defect that closes cleanly and leaves nothing is rarer than
this queue used to imply. The six named above are the ones this section already knew — **NEW-27**, **NEW-28**, **NEW-24**, **NEW-25**, **NEW-26** and **NEW-29**, which it miscounted as eight. Twelve more then landed: **NEW-30** and **NEW-31** from NEW-11, **NEW-32** and **NEW-33** from NEW-15, **NEW-34** from Foundation request 2, **NEW-35** from the review that verified NEW-15's closure, and **NEW-36**, **NEW-37**, **NEW-38** and **NEW-39** from request 3, **NEW-40** from Task 8 and **NEW-41** from Task 9. That was the dated 18-review-row history; NEW-30 and NEW-41 later closed. `BACKLOG.md` §1 is the current accounting: 29 headings, 5 closed, 24 open.

**A third came from that review and is already closed — NEW-23, by Task 1b.** Over four hundred
`path:line` citations across the documents were maintained by hand, `npm run check` was green with
every one of them broken, and repairing two of them in Task 1 silently broke twelve more. The gate
reported twelve defects on its first run, then four more once its extractor was corrected to carry a
citation across lines — the form that an evidence table written as one file name and eight bare
ranges depends on, and that a per-line reader cannot see.

**The current §1 accounting is twenty-nine headings, five closed, and twenty-four open.** The 18-review-row
history above is not the current count: NEW-30 and NEW-41 closed. A row leaves §1 when its fix is
**committed**, not when its question is answered, and all five R2 was opened for have landed.

**NEW-15 is still the cautionary case, and a decided policy does not repeal the lesson.** It read like
an implementation for a day and cost a full task to discover it was not: the guard was built, tested,
and withdrawn before commit, because the policy that row implied refuses this product's own vendors —
`claude` and `codex` are both symlinks on the founder's machine and `/opt/homebrew/bin` is
group-writable, so the rule as written would have made `capture` record `unknown` forever and `ingest`
exit 5 on every run. What changed is that a policy now exists; the row did not become implementable by
being read again. **A row being open is not an invitation to implement it.** Read which group it is in
first.

---

## Track L — long lead time, start early

Both gate the last entry in Track A. Both depend on somebody who is not in this room.
Starting them at A16 adds their full lead time to the release date for no reason.

| # | Entry | Owner | Gates | Done when | Status |
|---|---|---|---|---|---|
| L1 | Select an OSI-approved license and obtain qualified legal approval | Founder + counsel | A16, public visibility | approved text committed as `LICENSE` | open, startable now |
| L2 | Remote verification — destination remote, visibility, branch protections | Founder, outside this environment | A15, A16 | `remoteVerification` no longer `blocked_by_environment` | open, startable now |

**L2 no longer blocks pushing.** The remote exists and CI runs on it, as of 2026-08-10; pushing a
topic branch and opening a pull request is routine. What L2 still gates is the cutover and the
public release — and merging remains the founder's, because the repository rule requiring a pull
request exists so a human sees it first.

---

## Where the detail lives

| You want | Read |
|---|---|
| how to run a session start to finish | `SESSION.md` |
| what to do next | this file |
| what a missing spec must decide, and what it produces | `BACKLOG.md` §3 |
| what the completed knowledge pipeline is, and why nothing captures automatically | `docs/architecture/knowledge-pipeline.md` |
| what the Brain engine is, and its six residuals | `docs/architecture/brain.md` |
| what the workflow compiler is, what it deliberately cannot do, what DOS-P6 closed, and the two gaps that remain | `docs/architecture/workflow-schema.md` |
| what the Claude adapter is, why it ships no hooks, and which findings remain live | `docs/architecture/claude-adapter.md` |
| what the Codex adapter is, why the install is a local marketplace, and the two-adapter table DOS-P6 inherits | `docs/architecture/codex-adapter.md` |
| the consolidated trust boundaries, and the residuals with owners | `docs/architecture/threat-model.md` |
| what Foundation delivered, and what it deliberately cannot do | `docs/architecture/foundation.md` |
| the per-task Foundation constraints, one open founder question, and one ratified pending-implementation disposition | `docs/architecture/foundation-constraints.md` |
| which repository directories do not exist yet | `BACKLOG.md` §5 — none do |
| what was frozen on the legacy runtime and why | `BACKLOG.md` §6 |
| the gates every commit must pass | `BACKLOG.md` §7 |
| the product design | `specs/2026-07-21-developer-os-design.md` |
| which approved documents have been amended since approval | `BACKLOG.md` §8 |
| why no task reads the founder's legacy runtime | `plans/…-program.md`, Global Constraints |

## Counting what is left

Counted 2026-08-17 by reading the files rather than by editing a number, which is the discipline the
DOS-P6 plan's Task 19 Step 5 imposes on the residual arithmetic, applied to the file that imposes it.

**Recounted 2026-08-20, and the denominator moved.** Three subsystems were added that day; nothing
reopened and nothing closed. Where this section said eight subsystems and six milestones, it now says
ten and seven, and the arithmetic below is derived from the Track A table rather than edited on top of
the old numbers.

**Six subsystems of ten are closed** — Foundation, DOS-P2, DOS-P3, DOS-P4, DOS-P5 and DOS-P6 — including both
of the ones that turn a canonical workflow into something an agent can load. Neither of them can
execute what it renders, which is the whole of what remains on the product path.

**Six Track A entries remain: A11 through A16.** DOS-P7, DOS-P10, DOS-P11 and DOS-P12 — and
**DOS-P7 now owes four documents rather than two**, since
the founder split it on 2026-08-21 into opt-in surfaces and version lifecycle. **The first two of the
ten exist**: approved `specs/2026-08-21-developer-os-opt-in-surfaces-design.md` and its written
`plans/2026-08-28-developer-os-opt-in-surfaces.md`. Eight are still owed before their corresponding
code is written. Then two entries that are not subsystems — the cutover (A15) and the release (A16) — plus
Track L's two, which are not engineering work at all. **An implementation is done when its checkpoint
holds with evidence in a commit and CI is green on it, not when the tasks are ticked.**

**The umbrella has twenty-three open work steps and twenty-four unticked boxes**: Task 7 has 5 after
its two Spec 1 design rows closed, Task 8 has 10, and Task 9 has 8; Task 6's rewritten, deliberately
unticked hooks record is the one non-work box. The blocked Spec 1 implementation plan separately has
122 unticked execution steps; it is a future checkbox record, not executable work before Spec 2.

| Plan | Task | Steps left |
|---|---|:---:|
| program | 7 — Git, automation, update, release lifecycle | 5 |
| program | 8 — founder shadow migration | 10 |
| program | 9 — public beta and v1 | 8 |

**DOS-P10, DOS-P11 and DOS-P12 contribute no rows to that table, and their absence is not good news.**
A plan step can only be counted once a plan exists, and all three are at the stage before their spec.
The umbrella's written work is twenty-three steps; the blocked Spec 1 plan adds 122 future execution
steps. The *unwritten* work is four spec cycles, four plans, and five implementations across DOS-P7
and DOS-P10–P12. Do not read either table as the total.

Program Task 6 shows one unticked box and it is **not** work: the hooks box was rewritten to record
that hooks are declined, and nothing shipped for it by design.

**`BACKLOG.md` §1 is twenty-four open repository defects** — twenty-nine `### NEW-` headings, less
NEW-13, NEW-30, NEW-41 and NEW-43 closed on 2026-08-21 and NEW-48 closed on 2026-08-24. **None waits
on R2**, which is closed: sixteen of the eighteen that came out of R2's own reviews are still open;
four — NEW-44, NEW-46 and NEW-47 from the reviews of the NEW-21 diff, and NEW-49 from the review of
NEW-41's closure — are startable in a session; and four need somebody or something no session has:
NEW-42 an interactive vendor session, NEW-45 the founder's credits, NEW-20 registered as deliberately
not fixed, NEW-7 a machine with Obsidian. 16 + 4 + 4 = 24.

**Closing two rows raised two rows, and one of those has now closed.** NEW-30's review found the
missing Brain lint inventory — NEW-48, closed by the 2026-08-24 completed-spec migration. NEW-41's
review found that the CLI gained `--status` while the canonical workflow did not — NEW-49, still
open. The reviews bought two defects fixed and two previously invisible defects found.

**NEW-21 left six rows and one has already gone.** NEW-43 closed the day after it was raised — but it
was **one of four** a session could have taken, not the only one: NEW-44, NEW-46 and NEW-47 are still
open, and NEW-47 needs no credits either. **NEW-30 closed the same day from outside that set**, which
is the more useful example: it had sat since 2026-08-17 marked "the weakest of the four" and its fix
was one call and a decision that had already been made for its class. That is the shape this queue should keep expecting: reviews
add rows faster than work closes them, and the ones that close fastest are the ones nobody has to be
asked about. **Sixteen of the twenty-four are the honest cost of closing ten decided defects with a
fresh-context review on each** — eighteen were raised, and NEW-30 and NEW-41 have closed — and a
review that finds nothing is rarer than one that finds a residual.

**Add six open decisions** that are not defect rows: the one Foundation founder question, DOS-P9's
dedicated-plan question, and the **four** `BACKLOG.md` §8 amendments awaiting ratification. Three are
Track R R2's — spec §8.2's `[redaction]` schema, `foundation.md` §2's `CliError` slot, and
knowledge-pipeline §5.5's `accepted → rejected` row. **One arrived on 2026-08-21**:
knowledge-pipeline §5.6's `--status` line (NEW-41). The program plan's Task 7 split was ratified and
discharged on 2026-08-25 and no longer counts as an open decision.

**A10 is closed by `7eda70e`.** NEW-21 closed on 2026-08-20, and the predecessor's exact local gate,
publication, and remote CI on `c46b82c` are confirmed. Publication and CI for the local closure
commit travel with the current branch workflow rather than reopening A10. A11 is current but cannot
move its founder-approved Spec 1 plan into implementation before Spec 2's manifest handoff; A12,
A13, and A14 remain sequenced behind A11. See the `NOW` section.
**Track R is closed as of 2026-08-20.** R2 was its only entry, and its eleven tasks landed in four
commits — the three Foundation requests, the DOS-P7 gap, and the six §1 rows the decisions of
2026-08-17 unblocked. The four §1 rows that were never R2's still wait on the founder or on a
machine, and sixteen of the eighteen its reviews raised are still new work for whoever takes §1 next;
NEW-30 and NEW-41 closed on 2026-08-21.
