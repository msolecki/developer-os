# Brain gardener and pulse: scheduled Brain upkeep (NEW-134)

Status: design approved by the founder in conversation on 2026-09-30 (questions 1–4 and design
sections 1–3). Decision D77 is recorded in `plans/2026-09-04-developer-os-completion-roadmap.md`.
Backlog row: NEW-134.

## 1. Why

A Brain that only grows by `ingest` fragments. On the founder vault on 2026-09-30, 149 of 185 notes had
no link in either direction and the whole graph held 86 edges; project notes linked almost none of the
lessons learned in their projects. Connecting it took 25 hand-dispatched hub and link proposals. The
founder kept the Brain healthy with two personal Claude Desktop (Cowork) scheduled tasks, a weekly
gardener and a weekly health pulse. Other users have neither, and local Cowork tasks are deprecated
(no new ones from 2026-10-06). The product already ships the pieces: the `brain-garden` workflow,
`doctor`, `brain lint`, `review`, the isolated vendor invocation `ingest` uses, and the launchd job
registry behind `developer-os automation`.

Success: a user enables both jobs with one `automation enable`, the gardener proposes hubs and links
every week into quarantine, the pulse tells them when the Brain or its review queue needs a human, and
nothing reaches the vault without the user's `review` and `ingest`.

## 2. Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| Q1 | The product schedules both jobs through `developer-os automation` (launchd). | Ship manual workflows and document user-owned scheduling; defer scheduling to a later phase. |
| Q2 | The agent only proposes; the product validates every proposal and writes the captures itself. | The agent runs the workflow with a tool allow-list limited to `developer-os capture`. |
| Q3 | One agent call per gardener run, returning up to 8 proposals. | One call per proposal. |
| Q4 | The pulse writes a report under the product home, shows its verdict in `automation status`, and raises a macOS notification only on UWAGA/AWARIA (in code: `attention`/`failure`). | A note in the vault; a log line only. |
| D77 | An unattended agent call is allowed only to produce proposals for quarantine. `import` and `ingest` stay manual (D47 unchanged). | Automating `ingest`. |

## 3. Components

### 3.1 Two new scheduled jobs

`SCHEDULED_JOB_IDS` (`packages/core`) gains `brain-garden` and `brain-pulse`; the launchd registry
(`packages/platform-macos/src/launchd/registry.ts`) gains one job definition each, with the same label
scheme, argv shape, lease and log rotation as the existing four jobs (`brain-reindex`, `brain-lint`,
`doctor`, `git-sync`). Both are disabled by default and enabled only by an explicit schedule:

```sh
developer-os automation enable --schedule brain-garden=weekly@sun,17:00 --schedule brain-pulse=weekly@mon,08:00
```

`automation status` lists both, with each job's last outcome. The gardener's vendor comes from a new
config key `automation.brainGarden.agent` (`claude` | `codex`); when absent, it is chosen the way
`ingest --agent` chooses (the first installed one).

### 3.2 `brain-pulse` (no agent)

Inputs, all read-only: `doctor --json`; `brain lint --json`; `review --json` for `quarantined` and
`accepted` captures with the age of the oldest; `_indexes/index.json` and `_indexes/graph.json` for
note, edge, `isolated` and `gap` counts; the last gardener run outcome; the last `ingest` and `reindex`
times.

Verdict:

- **failure** (AWARIA): a `[fail]` doctor check, any lint `error`, or two consecutive gardener runs
  ending `failed(*)`.
- **attention** (UWAGA): the oldest quarantined capture is older than 14 days; an accepted capture has
  waited more than 14 days for `ingest`; `isolated` grew two reports in a row; the gardener skipped
  because the review queue held 20 or more captures; the index is older than 8 days.
- **healthy** (ZDROWE): otherwise.

Output: `<product-home>/state/pulse/<YYYY-MM-DD>.md`, keeping the last 8 reports; the trend compares
with the previous report, so no other store is needed. The verdict and the report path appear in
`automation status`. On `attention` or `failure`, one macOS notification is raised through
`osascript -e 'display notification …'`, spawned through the existing `ProcessRunner` with a fixed
argv; the notification text carries the verdict and the report path only, never vault content.

### 3.3 `brain-garden` (one isolated agent call)

The existing workflow `workflows/brain-garden/workflow.yaml` keeps its manual behavior and gains the
`scheduled` trigger (§3.5). A scheduled run is executed by the product, not by an agent session:

1. **Gate.** Skip with `skipped(<reason>)` and no agent call when: automation is not enabled; `doctor`
   reports a `[fail]`; `brain lint` reports an `error`; 20 or more captures are quarantined; the
   lifecycle lock is held (`skipped(lock_held)`, no retry until the next slot).
2. **Target selection** (deterministic, product code): up to 2 `gap` findings whose tag has at least 4
   notes and no `compiled-note` on it, largest first; up to 5 `isolated` notes, oldest `created` first.
   A note that a quarantined capture already names is not a target.
3. **Context bundle.** For each target, the frontmatter and body of its notes and the titles and paths
   of candidate link targets (notes sharing a tag or title token), capped at 256 KiB in total (targets that do not fit are dropped, last-selected first); vault
   text is delimited as untrusted data, as `ingest`'s prompt does.
4. **One isolated agent call** through the same vendor invocation `ingest` uses
   (`packages/adapter-claude/src/invoke.ts`, `packages/adapter-codex/src/invoke.ts`): no shell, no write
   tools, the product-owned isolated environment. The agent returns one JSON document:
   `{"proposals":[{"kind":"hub"|"related"|"fix","target":"<content-relative path>","note":"<full note text>"}]}`.
5. **Validation** (§4), then each accepted proposal is written through the existing `capture` write
   path (redaction, quarantine), at most 8 per run.
6. **Run outcome**: targets chosen, proposals accepted and rejected with reason codes, capture ids.
   Stored as the job's last outcome and read by the next pulse.

### 3.4 What stays manual

`review`, `ingest`, `import`, `brain refactor` and `brain retire`. The gardener never proposes a
structural change; a `duplicates` finding is listed in the run outcome as a `--dry-run` command for the
person, as the manual `brain-garden` workflow already prints it.

### 3.5 The `scheduled` trigger

`WORKFLOW_TRIGGERS` (`packages/workflow-schema/src/contract.ts`) gains `scheduled` in the same change
that makes launchd fire it, as `workflow-schema.md` §2 item 4 requires. Only `brain-garden` declares it.
`workflow-schema.md` §2 item 4 and §10.2 are updated to say which job fires it.

## 4. Proposal validation

The product rejects the whole response, writing no capture, when it is not valid JSON or does not match
the schema (`failed(agent_output_invalid)`). Otherwise each proposal is checked alone, rejected ones are
recorded with their code, and the rest are written:

Common to every kind:

- at most 8 proposals, at most one per target; extras are rejected in response order (`over_limit`,
  `duplicate_target`);
- the note parses and passes the frontmatter schema `brain lint` uses, with `author: agent`,
  `reviewed: null` and `stage: emerging` (`frontmatter_invalid`);
- every wikilink resolves, through the index's link tiers, to an existing canonical note or to a `hub`
  proposed in the same run (`link_unresolved`); no link resolves into a private folder;
- **redaction preview**: the redactor runs on the proposal before the capture; any change rejects it as
  `redaction_would_alter`, so a proposal is never quarantined in a mangled form;
- the note is at most 64 KiB (`too_large`).

Per kind:

- `hub`: the target is a new path inside a configured topic folder (aliases resolved as NEW-128 does),
  occupied by no note and no quarantined capture (`target_occupied`, `target_outside_topics`); `type:
  compiled-note`; `sources` names only notes from the context bundle; at least 3 wikilinks to them
  (`hub_too_thin`).
- `related`: the target is one of the selected isolated notes (`target_not_selected`). The proposal
  equals the note's current bytes except a `## Related` section (added at the end, or replacing an
  existing one) holding 2–5 wikilinks, and the `updated` field (`related_changes_body`). The capture is
  a replacing capture bound to the note's current bytes, as `brain-enhance` captures are, so an edit in
  between makes `ingest` refuse it.
- `fix`: the target note had a lint finding; only the frontmatter keys that finding names may change,
  and the body is byte-identical (`fix_out_of_scope`).

## 5. Errors

- Agent timeout or non-zero exit: `failed(agent_timeout)` / `failed(agent_error)`, no capture.
- Partial output never counts: validation runs only on a complete, parsed response.
- No retry inside the same week. The pulse turns one failed run into `attention` and two in a row into
  `failure`.
- A crash between captures leaves only whole captures in quarantine (the capture write path is already
  atomic per capture); the run outcome records the ids written so far.

## 6. Security

New surface: an unattended vendor-agent call over vault content. Controls: the `ingest` isolation (no
shell, no write tools, product-owned environment), the product-side validation of §4, writes only into
quarantine, opt-in and default-off, and the gates of §3.3 step 1. The worst reachable outcome is junk
proposals in quarantine, which the user rejects; the vault itself changes only through `review` and
`ingest`. Cost: at most one vendor call per week per enabled job, none when gated. `threat-model.md`
gains a section for this surface and D77.

## 7. Testing

- Unit: target selection (gap threshold, age order, already-quarantined exclusion); every §4 rule with
  one accepting and one rejecting case per reason code; the redaction preview; each pulse verdict
  threshold and the trend comparison; report rotation at 8.
- Integration with a fake agent returning fixed JSON, including hostile answers: a target outside the
  topic folders, a `related` proposal that edits the body, a link into `_raw`, 20 proposals, malformed
  JSON, a secret in a hub body. Assert exactly which captures reach quarantine.
- Automation registry: both jobs' launchd definitions, `enable`/`disable`/`status` on a disposable
  home, following the existing jobs' tests.
- Real agent: one scheduled-equivalent gardener run with Claude and one with Codex is a founder stop
  point (it costs credits), like NEW-104 and NEW-127.

## 8. Rollout

Buildable now. It reaches the founder machine only after a reinstall from a commit whose full suite is
green and after the founder enables automation (D76). Until then the founder's Cowork gardener and pulse
bridge the gap; they are disabled once the product jobs run.

## 9. Out of scope

Automatic `ingest` or `import`; structural changes (`refactor`, `retire`); more than one agent call per
run; a report inside the vault; any non-macOS scheduler.
