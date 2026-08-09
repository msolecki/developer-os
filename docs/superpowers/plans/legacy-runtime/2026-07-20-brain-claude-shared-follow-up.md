# Legacy runtime exit checklist

> **Status: 4 open items. Everything else was frozen on 2026-07-27.**
>
> **Re-verified 2026-08-08** by read-only inspection of both trees — one of the two
> sanctioned reasons to open them at all. Two items moved a long way, two did not move at
> all, and one is new. Every count below that a previous revision asserted has been replaced
> with what the trees actually hold; see "What changed on 2026-08-08" before acting on any
> number here.
>
> **Relocated 2026-07-27** from `~/claude-shared/docs/superpowers/plans/`, then rescoped
> the same day from a development backlog into an exit checklist.
> `docs/superpowers/plans/legacy-runtime/` is a publication-excluded path; nothing here
> may be copied into a public artifact. Index: `docs/superpowers/BACKLOG.md`.
>
> The full 14-step development plan this replaces is in commit `28a0ddc` if a frozen item
> ever has to be revived.

## Why this document changed

The original plan set out to *improve* `~/brain` and `~/claude-shared`: better validation,
better capture, better retrieval, a unified doctor, a proposal lifecycle. Developer OS
rebuilds every one of those as a product feature. Doing the work twice buys nothing except
a second thing to maintain and then throw away.

So the scope is now the opposite of improvement. **Nothing gets built on the legacy runtime
again.** What remains is only what cannot be inherited, deferred, or rebuilt:

1. a security obligation that exists whether or not Developer OS ever ships;
2. a data-durability obligation covering work already done and not yet committed;
3. the one-line policy fix that makes (2) possible at all.

When those three close, `~/claude-shared` and `~/brain` are frozen artifacts: they keep
running the founder's machine untouched until the Program Task 8 cutover retires them.

## Scope boundary

- **This document does not gate Developer OS development.** Foundation through Program
  Task 7 are self-contained; they consume `docs/migration/`, never a legacy checkout.
- **It does gate Program Task 8.** Cutover must not start with credentials unrotated or
  uncommitted work at risk in the trees it is about to replace.
- **Nothing here is a source-material input.** These are operations on the founder's
  machine, not material for the public repository.

## Decision and ownership rules

- **Founder-only:** credential rotation, provider-log review, approving history rewrites,
  and deciding whether unrelated local changes may be included in a commit.
- **Agent-owned:** repository analysis, patches, local tests, reports, and draft checklists.
- **Explicit approval required:** live `~/.claude` or `~/.codex` changes, history rewrites,
  deletion of recovery data outside Git, commits, and pushes.
- **Never expose values:** remediation records contain repository, path, commit, provider,
  status, and rotation evidence, but never the credential itself.

## Exit checklist

| ID | Pri | Item | Owner | Complexity | Status |
|---|:---:|---|---|:---:|---|
| EXIT-1 | P0 | Rotate historical credential candidates | **Founder** | M | open, unchanged since 2026-07-20 |
| EXIT-2 | P0 | Resolve the non-npm commit-gate contradiction | Agent + Founder | S | open, unchanged since 2026-07-20 |
| EXIT-3 | P0 | Land or durably preserve the remaining untracked entries | Agent + Founder | **S** (was L) | mostly discharged, needs EXIT-2 |
| EXIT-4 | P0 | Stop or fix the failing weekly job | Agent + Founder | S | **open, new 2026-08-08** |

## What changed on 2026-08-08

**The English migration was committed.** It is in `~/claude-shared` history as
`ef4a972 feat: english migration, codex parity, hardened automation and evals`, followed by
five more commits. That single fact removes EXIT-3's entire premise: there is no longer a
136-entry dirty tree holding reviewed, uncommitted work.

**Both repositories are in sync with their remotes and neither has a modified tracked
file.** `~/claude-shared` carries four untracked entries: three automation backup files
stamped `20260727-210611`, and `docs/ROADMAP.md`. `~/brain` carries roughly thirty untracked
entries, all of them raw captures under `content/_raw/inbox/`.

**`~/claude-shared/docs/ROADMAP.md` needs no migration.** It was already rewritten to hold
only a completed record and the standing non-goals, and it points at
`docs/superpowers/BACKLOG.md` as the backlog index and at this file as the follow-up plan.
Its three former open items are the ones frozen below as Steps 6, 9, 10 and 11. Nothing in it
is unrepresented in Developer OS documentation — commit it or discard it, but do not mine it.

**One change nobody recorded, and it matters to DOS-P5.**
`861514c chore: remove Codex parity layer; claude-shared is Claude Code only` landed after
`docs/migration/baseline-capabilities.json` froze the legacy Codex surface on 2026-07-21. The
frozen record stays the only admissible statement about what the legacy runtime did, and
there is now nothing left to observe even if someone wanted to. DOS-P5 must not plan to
compare against a live legacy Codex implementation.

**Five proposals await review, not two.** Three were written on 2026-07-27 — a second
historical-secret scan, a template-hygiene report with sixteen findings needing manual
review, and a project-instructions proposal. They stay private Brain content and are not
repository inputs; the count is recorded so it is not mistaken for two.

Preservation and classification, formerly Step 0, is **partially discharged**: Program
Task 0 captured read-only status, tracked diffs, untracked inventories, and commits for
both repositories into an owner-only backup outside either repo on 2026-07-21, and
classified 152 of 152 shared-runtime and 7 of 7 private-brain entries with none
unassigned. That covers recoverability and the *publication* boundary. It does not produce
the include/exclude manifest EXIT-3 needs for a *commit* boundary, which is why that work
sits inside EXIT-3 rather than ahead of it.

---

## EXIT-1 — Rotate historical credential candidates

- **Priority:** P0 · **Owner:** Founder; agent provides a redacted checklist only.
- **Complexity:** M · **Status:** open, pending since 2026-07-20. Re-checked 2026-08-08: the
  triage proposal's verdict is unchanged and no provider-side verdict has been recorded for
  any candidate.

**The candidate set is wider than the four below.** A second scan on 2026-07-27 reported
candidate matches across six repositories. It was produced by the *unfixed* scanner — see the
Step 7 asymmetry at the end of this file — so six is a floor, not a total, and its matches
are unverified candidates rather than findings. The four below remain the ones with a recorded
triage verdict; the rest need triage before they need rotation.

**What:** Treat four historical findings as active until the provider proves otherwise:
the Taxos AWS key, the KM Energy Monitoring AWS key, the shared VAV/Vavita Zindigi AWS
key, and historical authentication/email credentials in Przedsiębiorcze Trójmiasto.

**Where:** Provider consoles and the repositories named in the triage proposal at
`~/brain/content/_outputs/proposals/2026-07-19-historical-secret-triage.md`. This item
touches no repository at all — it is console work.

**Why it survived the freeze:** the founder's 2026-07-21 waiver removed these as
*Developer OS publication* blockers. A waiver is a scoping decision about this product; it
does not revoke a key. If any of the four is live, it is live regardless of what
Developer OS does.

**How:**

1. Revoke or rotate the credentials before considering any Git history rewrite.
2. Review provider audit logs from the first known exposure through rotation.
3. Scope replacement credentials to the minimum required permissions.
4. Verify state, memory, and environment files are ignored and blocked by repository hooks.
5. Record rotation date, provider confirmation, affected deployments, and incident verdict
   — never the values.
6. Decide history rewrite separately. A rewrite is destructive coordination work and does
   not replace rotation.

**Test:** Old credentials fail provider authentication; new credentials pass the smallest
application smoke test; provider logs are reviewed; the completion checklist in the triage
proposal is fully checked.

**Invariant:** No secret value enters Brain, logs, prompts, patches, or chat output.

## EXIT-2 — Resolve the non-npm commit-gate contradiction

- **Priority:** P0 · **Owner:** Agent proposes; Founder accepts the policy.
- **Complexity:** S · **Status:** open. Re-checked 2026-08-08: `rules/security.md` still
  carries the npm-only absolute, verbatim and unedited. This is the single smallest open item
  in the whole exit checklist and it has blocked the largest one for nineteen days.

**What:** Correct the global rule that forbids every commit without
`npm run lint && npm test`. Neither Brain nor claude-shared is an npm project, so the
literal rule makes a compliant agent commit impossible — which is one reason EXIT-3 has
been open since 2026-07-20.

**Where:** `~/claude-shared/rules/security.md` and the generated `AGENTS.md`.

**How:** Replace the npm-specific absolute with a fail-closed validation contract: run the
repository-declared validation command; when `package.json` exposes lint/test scripts, run
them; when it does not, run the documented repository-specific suite. Missing validation
metadata remains a commit blocker.

Declared suites for these two repositories:

- Brain: `python3 tests/run_tests.py`, deterministic reindex/lint, English scan, `git diff --check`.
- claude-shared: hook suite, weekly/distillation/config/language tests, plugin version
  check, shell syntax, Python compile, skill validation, generated-AGENTS check,
  `git diff --check`.

**Test:** A fixture npm repository still requires both npm commands; a fixture non-npm
repository requires its declared suite; a repository with no declared gate is refused;
generated `AGENTS.md` is idempotent.

**Invariant:** The change generalizes validation; it must not weaken npm projects. Note
that this rule file is imported into every session's global instructions, so the fix is
also the last edit that should ever be needed in `~/claude-shared/rules/`.

## EXIT-3 — Land or durably preserve the uncommitted trees

- **Priority:** P0 · **Owner:** Agent prepares; Founder approves boundaries.
- **Complexity:** **S** (was L) · **Status:** mostly discharged, blocked by EXIT-2.

**What is left is small, and it is not what this item was written for.** The 136-entry dirty
tree and the reviewed-but-uncommitted English migration are gone: the migration was committed
as `ef4a972`, and as of 2026-08-08 both repositories are in sync with their remotes with no
modified tracked file. What remains:

- **`~/claude-shared`: four untracked entries.** Three automation backup files stamped
  `20260727-210611` — build residue from the change that broke the weekly job, so read
  EXIT-4 before deleting them, since they may be the only copy of the working version. And
  `docs/ROADMAP.md`, whose content is fully represented in `docs/superpowers/BACKLOG.md`
  already. Commit or discard; either closes this half.
- **`~/brain`: roughly thirty untracked raw captures** under `content/_raw/inbox/`. This is
  user data awaiting ingest, not uncommitted work of value, and it is only accumulating
  because EXIT-4 is open. Drain it by fixing the pipeline, not by committing an inbox.

Confirm both counts before acting rather than assuming these numbers either — that
instruction is why the previous revision's numbers were caught.

**EXIT-2 still gates this**, for the original reason: a compliant agent cannot commit in
either repository while the commit gate reads as npm-only.

**Where:** `~/claude-shared` and `~/brain`.

**How:**

1. Produce the include/exclude path manifest that Program Task 0 did not (it drew a
   publication boundary, not a commit boundary). Never use `git add -A`.
2. Review security-sensitive hook and automation diffs separately from prose-only
   translation changes.
3. Sample at least one compacted source archive per project plus every archive linked to a
   security finding, and confirm the canonical target retains the durable lesson.
4. Review every deliberate deletion category and confirm Git is an acceptable recovery
   layer. If secret-history rewriting is approved under EXIT-1, do not promise that raw
   captures remain recoverable from rewritten history.
5. Stage only manifest paths, run the declared suite from EXIT-2 against the exact staged
   tree, and create separate per-repository commits.
6. Push only after explicit approval and a clean remote-divergence check.

**Test:** Staged diff matches the manifest; excluded paths remain unstaged and unchanged;
the declared validation suite passes against the staged content; a fresh clone can load
Claude instructions, Codex instructions, plugin metadata, Brain indexes, and source links.

**Invariant:** Each repository is usable after its commit; no partial cross-repository
contract is pushed without a documented compatibility order.

**Baseline to reproduce before staging — now a *post*-commit check, not a pre-commit one.**
The English migration this describes was completed and independently reviewed on 2026-07-20
and has since been committed as `ef4a972`. Its final evidence is still the regression
baseline, and it is still worth reproducing — but the question it answers has changed from
"is this dirty tree safe to commit" to "did the commits that landed actually preserve it".
Nobody has verified the second question. The `1.6.0` plugin base version in particular
predates two later commits that retired a hook and removed the Codex parity layer, so treat a
mismatch there as expected drift to explain rather than as regression to fix:

- Brain suite passes, including source-archive target resolution.
- Brain index: `notes=25`, `edges=67`, `incoming_targets=20`, `tags=66`, `dated=25`, no dead links.
- Claude hook suite: `PASS=39`, `FAIL=0`.
- Weekly automation: 15 cases; distillation: 5 cases; config drift: 2 tests.
- Language guard: 4 unit tests, plus a full scan of both repositories reporting `OK`.
- Plugin manifests: base version `1.6.0` consistent across Claude, marketplace, and the
  Codex build.
- All 19 plugin skill packages validate; shell syntax, Python compilation, JSON parsing,
  generated-`AGENTS.md` idempotence, and both `git diff --check` runs pass.

Two constraints carried from that plan: the reported live/template configuration drift is
never applied automatically, and no live Claude or Codex configuration was overwritten
while producing this baseline.

## EXIT-4 — Stop or fix the failing weekly job

- **Priority:** P0 · **Owner:** Agent diagnoses; Founder decides whether to fix or disable.
- **Complexity:** S · **Status:** open, found 2026-08-08.

**What:** The `brain-weekly` job has not succeeded since 2026-07-27T21:00:19+02:00 — eleven
days at the time of writing. Two commits went in afterwards that were plainly attempts at
this (`1308db1` retrying `git pull` and repository discovery, `6826b12` waiting for the
network before the shared-sync pull) and the job still fails. The three untracked
`.bak.20260727-210611` files in `~/claude-shared/automation/` are from the change that broke
it and may be the only copy of the last working version, which is why EXIT-3 must not delete
them first.

**Why it is a P0 exit item rather than someone's Tuesday.** Three reasons, in order:

1. **It falsifies this plan's own definition of done**, which requires that no change be
   planned, *scheduled*, or in progress on either repository. A `launchd` job firing weekly
   and failing weekly is all three.
2. **It is why the capture inbox is backing up.** Roughly thirty raw captures have
   accumulated since the last success. Every one is user data that the pipeline was supposed
   to process, and EXIT-3 cannot honestly report "no untracked work of value" while they sit
   there.
3. **A job that fails silently for eleven days is the exact failure mode Developer OS was
   built to end.** Frozen Step 5 was "replace false-green Brain validation"; this is the
   inverse — a true red nobody was told about. Whichever way it is resolved, the resolution
   is not "it will be fine after cutover": DOS-P8 must not begin against a legacy runtime
   whose last known-good pipeline run is a month old.

**How:**

1. Read the automation log and the `launchd` state to establish the actual failure, not the
   presumed one. Do not re-run the job against the live vault to find out.
2. Decide with the founder between fixing it and disabling it. Disabling is a legitimate
   answer — the pipeline is being retired — but only with the capture backlog drained or
   explicitly accepted as abandoned.
3. If it is disabled, record that here and in `docs/superpowers/BACKLOG.md` §6, because a
   disabled job is a change to the founder's machine and the cutover plan needs to know it
   happened.
4. Preserve the three `.bak` files until the outcome is settled, then commit or discard them
   as part of EXIT-3.

**Test:** Either the job records a success and the inbox count falls, or the job is disabled,
its schedule is gone, and the backlog has a recorded disposition. A silent job is not a pass.

**Invariant:** No diagnostic step writes to the vault, and no captured content is quoted into
a report.

---

## Frozen 2026-07-27

Ten items were closed as *will not do on the legacy runtime*. Each is rebuilt as a
Developer OS feature, on synthetic fixtures, under the product's own gates. The full
original text is in commit `28a0ddc`.

| Was | Item | Rebuilt as | Unfreeze only if |
|---|---|---|---|
| Step 4 | Resolve live/template configuration drift | DOS-P4 Claude adapter — semantic config merge and managed artifact paths | drift breaks the founder's live Claude before cutover |
| Step 5 | Replace false-green Brain validation | DOS-P6 knowledge pipeline — deterministic validators block persistence | a weekly false green causes actual Brain corruption |
| Step 6 | Test weekly automation against real Git | DOS-P7 lifecycle — Git against temporary repositories and bare remotes | never; the legacy pipeline is being retired |
| Step 7 | Close scanner coverage gaps | DOS-P6 security suites; scan scope reporting | EXIT-1 needs a full scan and the truncation hides candidate count |
| Step 8 | Add stable Codex learning capture | DOS-P5 Codex adapter — `wrapper-required` classification, no transcript parsing | never |
| Step 9 | Enforce the Brain schema and graph policy | DOS-P2 Brain engine — lint classes and index determinism | never |
| Step 10 | Measure retrieval quality | DOS-P2 Brain engine — index-first retrieval with bounded candidates | never |
| Step 11 | Add a unified read-only doctor | Foundation Task 8 `doctor`, extended in DOS-P7 | never |
| Step 12 | Add proposal lifecycle and observability | DOS-P6 — `ReviewDecision`, `IngestProposal`, capture lifecycle | never |
| Step 13 | Curate content and archive provenance | DOS-P2 provenance fields; Program Task 8 cutover review | never |

**The freeze is the point.** Three of these — Steps 6, 9 and 10 — were the reason the
original plan was rated at months of work. Rebuilding them once, in a tested product, on
synthetic data, is cheaper and produces something that ships.

**One asymmetry to watch.** Step 7 is frozen but EXIT-1 depends on a trustworthy secret
scan, and the known gaps are that linked worktrees are skipped and results truncate at
twenty matches without saying how many were omitted. If EXIT-1's scan is the deciding
evidence for a rotation verdict, unfreeze exactly those two fixes and nothing else.

## Definition of done

Legacy work ends when:

- every historical credential candidate has a recorded provider-side verdict — including the
  ones the 2026-07-27 scan added, which need triage before they need rotation;
- the commit gate accepts a non-npm repository with a declared suite;
- `~/claude-shared` and `~/brain` hold no uncommitted work of value, by commit or by a
  verified archive the founder accepted;
- **no scheduled job on either repository is still firing** — every one has either succeeded
  recently or been deliberately disabled with its backlog dispositioned;
- no further change is planned or in progress on either repository.

At that point both repositories are read-only history until Program Task 8 retires them.

## Next action

**EXIT-2 first, because it is one file and it unblocks EXIT-3, which is now an afternoon
rather than a project.** EXIT-4 next, because it is the only item still producing new state on
the founder's machine every week, and because EXIT-3 must not delete the `.bak` files before
it is settled. EXIT-1 runs in parallel throughout and needs no repository access at all.

None of this blocks Developer OS development, which continues from
`docs/superpowers/BACKLOG.md`.
