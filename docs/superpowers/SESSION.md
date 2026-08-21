# Session protocol

How to continue Developer OS in a fresh session, without the previous session's context.

**The prompt. Paste this and nothing else:**

```
Continue Developer OS. Read docs/superpowers/SESSION.md and follow it exactly.
```

It works every time because it carries no state. Everything needed to resume is in
`ORDER.md`, the plan it points to, and `git`. If resuming ever requires remembering
something that is not in one of those three, that is a bug in the documents — fix it in the
same session.

---

## 1. Orient. Never skip, never abbreviate

Run all of these before deciding anything:

```bash
git status --short
git log --oneline -5
gh pr list                 # is something already waiting on the founder?
```

Read, in this order:

1. `docs/superpowers/ORDER.md` — find the row marked `now`. That is the entry.
2. The plan linked in that row. Read the whole task, not just the next unchecked step.
3. `docs/superpowers/BACKLOG.md` §7 — the gates every commit must pass.
4. The architecture note for any subsystem you are about to touch — `docs/architecture/`.
   `brain.md` before Brain code, `foundation.md` before the CLI, transactions or the
   manifest. These outlive the plans that produced them and they are the reason those plans
   could be deleted.

**An open pull request means the entry may be blocked on a human, not on you.** A spec
awaiting approval is the normal case: check before starting anything, because writing a
second thing on top of an unapproved first is how two documents start disagreeing.

Do not read the plans you are not working on. Do not reconstruct history from git log
beyond checking that the tree is where `ORDER.md` says it is.

## 2. Verify `NOW` is actually now

`ORDER.md` can be stale if a previous session ended badly. Check the current entry's
**Done when** against reality before starting:

- If it is **already satisfied and committed** → update the row to `done`, move `NOW` to the
  next entry, commit that bookkeeping alone, and start the new entry.
- If the tree is **dirty in a way the entry does not explain** → stop. Report what is
  uncommitted and ask. Do not start new work on top of someone else's unfinished work, and
  do not commit changes you did not make.
- If it is **partially done** → continue from the first unchecked step, after confirming the
  checked ones have real evidence.

## 3. Pick the skill before touching anything

`ORDER.md` entries come in three shapes. The shape decides the skill:

| Entry shape | Skill to invoke first |
|---|---|
| Execute an existing plan — any entry whose **P** gate is already closed | `superpowers:subagent-driven-development`, or `superpowers:executing-plans` for a plan whose tasks are too coupled to hand out one at a time |
| Write a spec — any entry whose **S** gate is still open | `superpowers:brainstorming`, then write the spec |
| Write an implementation plan — the **P** gate | `superpowers:writing-plans` |
| Any code step inside a plan | `superpowers:test-driven-development` |
| Something is broken and you do not know why | `superpowers:systematic-debugging` |

Announce which one you are using and why. If a plan step and a skill disagree on procedure,
the plan wins — it was approved for this repository.

**Prefer the subagent loop for plan execution, and it is not a preference about speed.** The gates
require a fresh-context review per code-producing task, and that loop is what produces one: a
different agent implements and reviews each task, and a task is not done until its reviewer says
so. Across DOS-P4 and DOS-P5 those reviews caught, among others, a capability reported `yes` over
an artifact that did not exist, a `doctor` run printing two contradictory statements about one
binary, author prose able to forge a heading inside the prompt-injection defence, and a test that
scanned its own source and could never have passed. A self-review would have caught none of them —
it shares the author's assumptions, which is the whole reason the rule says reviewer ≠ author.

## 4. Do the work

One `ORDER.md` entry per session. Not two. Finish it completely, including review and
commit, then stop.

Inside the entry, follow the plan step by step:

- Steps that say "write failing tests" mean the tests must actually fail first, for the
  stated reason. A test that passes on first run has not pinned anything.
- A test pins the **contract**, not current behavior. If a test starts passing only after
  you changed the test, prove you did not just encode a bug.
- Do not skip ahead to the interesting step. The plans are ordered because later steps
  assume earlier evidence exists.

## 5. Close the loop — all five

An entry is not finished until every one of these is true. The first four happen in one
commit; the fifth happens after it, on a machine that is not yours.

1. **Gates pass.** `npm run check` — that is lint, tests, build, and `git diff --check`.
   Show failures only; a wall of passing output tells nobody anything.
2. **Fresh-context review.** Dispatch a reviewer that is not you and did not write the
   code. Give it the constraints, the exact file list, and instructions to review only —
   no edits, no commits. When it returns, run `git status --short` and `git diff` yourself
   to prove it did not touch the tree. For every accepted finding: add a regression test
   first, apply the smallest fix, rerun the gates, request another verdict.
3. **Checkboxes match evidence.** Tick a step only when its own evidence exists. Update
   the plan and the `ORDER.md` row in the same change as the work. **This has gone wrong
   three times** — once when the program plan showed 0/71 while its first task's artifacts already
   existed, so a fresh session would have tried to redo a task whose inputs are deliberately
   out of reach; again when two steps stayed unticked for four days after the documents
   they describe landed; and on 2026-08-15, when R1's plan was **written, executed and deleted in
   one session with every box still unticked**. Ticking the box is part of the work, and one plan is
   the checkbox record for any given piece of it — never two.

   **The third one is the instructive one, because it looked harmless and mostly was.** A plan that
   dies in the session that wrote it leaves no stale checkbox behind to mislead anybody: the file is
   gone, `ORDER.md` says `done`, and the evidence sits in the commit messages, which outlive any
   plan. So nothing broke. **But the ticks are not only a message to the next session — they are the
   thing that makes a task's own evidence checkable while the task is running**, and a session that
   skips them has no answer to "which steps actually have evidence" except its own memory, which is
   exactly what this file exists not to rely on. If a plan is short enough to finish in one sitting,
   tick as you go anyway; if it is long enough to survive the session, ticking is not optional.
4. **Exact-path staging.** `git add <exact paths>`. Never `git add -A`, never `git add .`,
   never a wildcard. Then `git show --stat HEAD` and confirm it contains only what you
   meant to ship.
5. **CI is green on the commit.** Push a topic branch, open a pull request, and read the
   result — `gh pr checks <n>`. The default branch requires a pull request, so this is the
   only route anything lands by. **A red run that nobody reads is worse than the no CI it
   replaced**, so do not open a pull request you are not going to watch.

   **The rule is a GitHub *ruleset*, not classic branch protection, and confusing the two cost a
   session on 2026-08-21.** `gh api repos/<owner>/<repo>/branches/development/protection` answers
   **404 Branch not protected**, which reads as "a direct push will land" and is wrong. The rule
   lives at `gh api repos/<owner>/<repo>/rules/branches/development` — `pull_request` with
   `required_approving_review_count: 0`, plus `deletion` and `non_fast_forward`. A direct push is
   rejected with "Changes must be made through a pull request". **Check the second endpoint, or just
   try the push and read the refusal**; do not conclude from the first that this step is optional.

   **A pull request needs a head branch, so "land this without creating a branch" is not a thing
   this repository can do.** Zero approvals are required, so the founder can merge their own — but
   the branch has to exist.

## 6. Report and stop

Three to five bullets: what changed, what the evidence was, what `NOW` is now. Then stop
and let the next session take the next entry. Fresh context per entry is the point, not an
accident.

---

## Hard rules

These are not style preferences. Each one exists because it was already violated once.

- **A green local tree is not evidence. A commit is, and a green CI run on that commit is
  better.** This repository spent a week with a finished, tested, entirely uncommitted
  transaction lock: everything worked locally and every other checkout was red. It then
  spent twenty days with no CI at all, during which the capability scan silently stopped
  covering a whole package and every gate stayed green.

- **This repository is public.** `github.com/msolecki/developer-os`, deliberately, since
  2026-08-10. Before writing anything into it, ask whether it should be readable by anyone —
  the self-containment lint does **not** check this and never did, because it exists to stop
  you *reading* the founder's machine, not to stop this repository *publishing* what is
  already written down. `BACKLOG.md` §0 records what that decision already exposed.
- **Never `git add -A`.** Stage named paths only.
- **Never read `~/claude-shared`, `~/brain`, or any `DEVELOPER_OS_SOURCE_*` path.** Program
  Task 0 froze everything the build needs into `docs/migration/`. A missing legacy fact is
  a gap in `docs/migration/baseline-capabilities.json` or in the design spec, and it is
  fixed there. The only exceptions are the exit checklist in `BACKLOG.md` §6 and the DOS-P8
  cutover, and neither is build work.
- **Fixtures are synthetic.** No real vault, no real client name, no real repository, no
  copied third-party content.
- **A gate that can pass by scanning nothing is not a gate.** Every check that sweeps a set —
  files, modules, directories — asserts that the set is non-empty, and asserts it *per scope*,
  because a total is satisfied by one populated scope while the rest go unread. This has
  already been violated twice: the self-containment enumerator once skipped every file in any
  checkout whose path contained `#` and still exited 0, and the network-capability scan asserts
  non-emptiness per listed package and therefore never noticed that `packages/brain` is not on
  the list (`BACKLOG.md` §1, NEW-1).
- **Redact before truncating, hashing, logging, persisting, or sending to a model.**
  Truncation and hashing do not make a secret safe.
- **Every filesystem mutation follows** `plan → backup → stage → validate → apply → verify
  → finalize`.
- **Reviewer ≠ author.** Always. A subagent's security or auth change is unauthorized until
  independently reviewed.
- **Finished plans get deleted, not archived.** When a plan's last step closes, remove the
  file in that same commit, after carrying any evidence a later step still needs into the
  document that needs it. Git history is the archive. **A spec is not a plan** — it stays
  while its subsystem is unfinished, and afterwards only while another document points at
  it as the design of record, with a status line that says so in the past tense.
- **An approved document is not silently rewritten.** When something you build changes a
  document that was approved before you started, record the change in the document you are
  writing, cross-reference it from the one it amends, and register the pair in
  `BACKLOG.md` §8. Edit an approved document in place only for its status line. Four
  amendments were recorded and never cross-referenced, and readers of the amended sections
  got the superseded contract for four days.

## Stop and ask — do not decide these yourself

- Anything in **Track L** of `ORDER.md`. L1 license approval is the founder's and no amount of
  context makes it yours. **Track B closed on 2026-08-10 and is no longer a section there** —
  what a cutover still needs to know is `BACKLOG.md` §6, and the one live rule in it is that
  EXIT-1, historical credential rotation, was **declined by the founder, not deferred**. Do not
  reopen it from a backlog; it is a conversation.
- **Any live machine change** — `~/.claude`, `~/.codex`, launchd, a real remote.
- **Approving a spec.** Every subsystem needs an approved spec before its plan, and a plan
  before code — a Global Constraint of the program plan. **Writing the spec is yours;
  approving it is the founder's.** An agent that judges its own spec ready has removed the
  only gate in the program that a machine cannot check.

- **Merging to the default branch.** Pushing a topic branch and opening a pull request is
  routine and needs no permission. Merging is where work becomes the trunk, and the
  repository rule requiring a pull request exists so a human sees it first. (Remote
  verification stopped being `blocked_by_environment` on 2026-08-10 — the remote exists, CI
  runs on it, and Track L's L2 is what remains of that item.)
- A plan step that turns out to be **wrong rather than merely hard**. Say so, propose the
  correction, and wait. Do not quietly implement a better idea; the plans were approved.

## When something does not fit

If the plan tells you to do something that is impossible, unsafe, or already done
differently, that is information, not an obstacle to route around. Write down what you
found, what you did instead or why you stopped, and put it in the report. A plan that
disagrees with reality is a document to fix, not a rule to break silently.
