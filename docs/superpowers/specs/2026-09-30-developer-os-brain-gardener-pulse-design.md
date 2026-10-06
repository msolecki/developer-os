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
| D77 | An unattended agent call is allowed only to produce proposals for quarantine. `import` and `ingest` stay manual (D47 unchanged). This supersedes, for `brain-garden` only, the opt-in surfaces spec's "no scheduled job can spend vendor credits" (`specs/2026-08-21-developer-os-opt-in-surfaces-design.md` §1 and the registry's literal `maySpawnVendor: false`). | Automating `ingest`. |
| Q5 | `automation enable` pins the gardener's vendor executable as an absolute path in config; every run re-admits it with the trust check `ingest` uses. | Adding a `PATH` to the launchd plist (a same-uid process can reorder it, the NEW-121 risk). |

## 3. Components

**Amended after the final review and security audit (2026-10-01, Rulings 37–39):** the scheduled
gardener runs Claude only (`--tools ""`); a Codex pin is refused at `automation enable` and at run
time (`garden_agent_unsupported`) because Codex has no tool-free mode and its read-only sandbox can
still read the whole disk. The pin is bound to the activation: `lifecycleConfigHash` covers
`automation.brainGarden`, so editing config.toml after `enable` disables the job until `enable` runs
again. The pulse reads the index's `generatedAt` for freshness instead of the last `ingest` and
`reindex` times listed in §3.2, and a refused gardener run counts toward attention/failure like a
failed one.

### 3.1 Two new scheduled jobs

`SCHEDULED_JOB_IDS` (`packages/core/src/config/lifecycle.ts`) gains `brain-garden` and `brain-pulse`
after `git-sync`. They reuse the existing label scheme (`com.developer-os.<id>`), argv
(`automation run <id> --scheduled --product-home … --generation …`), runner lease, status record and
ten log slots. They are **optional**, which the registry has no notion of today; the changes this
forces, all in scope:

- **Schedule schema.** `automationConfigSchema` (`packages/core/src/config/loader.ts`) accepts the
  mandatory three in registry order, then `git-sync` if and only if Git is eligible, then any subset of
  `brain-garden`, `brain-pulse` in registry order. `reconcileAutomationSchedules`
  (`packages/platform-macos/src/launchd/schedule.ts`) requires a schedule for every mandatory and
  eligible job as today, and keeps an optional job only when a `--schedule` names it or the prior
  config held it; `automation enable` without it leaves it off.
- **Counts.** The hard "more than four jobs" refusals (`launchd/observe.ts`, `launchd/plan.ts`) and the
  `ClosedLaunchdBaseLabelV1` union (`launchd/types.ts`) grow to six.
- **Reservations.** Each job's `state/automation-<id>.status.json`, `state/.automation-<id>.lock` and
  `logs/automation-<id>.0..9.json` are manifest-owned rows (`apps/cli/src/lifecycle/admission.ts`
  `LIFECYCLE_RESERVATION_ROWS`; `apps/cli/src/bootstrap/executor.ts` `runtimeReservationPaths`, which
  must iterate `SCHEDULED_JOB_IDS` instead of its hard-coded list). **Consequence:** an installation made
  before this change fails lifecycle admission (`reservations_incomplete`) until it is reinstalled.
  That is the existing reinstall path (founder cutover step 15), not a new migration.
- **Hash.** `lifecycleConfigHash("automation", …)` covers `schedules`, so enabling or disabling an
  optional job re-hashes the arm; `automation enable` already rewrites the activation record.
- **Vendor flag.** `LaunchdJobDefinitionV1.maySpawnVendor` changes from the literal `false` to
  `boolean`; it is `true` for `brain-garden` only (D77). The runner refuses to invoke a vendor from any
  job whose definition says `false`.

Both jobs are off by default and enabled only by an explicit schedule:

```sh
developer-os automation enable --schedule brain-garden=weekly@sun,17:00 --schedule brain-pulse=weekly@mon,08:00
```

`automation status` lists both, with each job's last outcome and, for `brain-pulse`, the last verdict.

Gardener vendor (Q5): two config keys outside `automation.lifecycle`, so they do not enter the lifecycle
hash: `automation.brainGarden.agent` (`claude` | `codex`) and `automation.brainGarden.executable` (an
absolute path). `automation enable --schedule brain-garden=…` resolves the agent (the flag
`--garden-agent`, else the first installed one, as `ingest` chooses) through the interactive shell's
`PATH`, runs the same trust check `ingest` uses, and writes both keys. A scheduled run never searches
`PATH`: it re-admits the pinned path with that trust check and ends `handler_refused
(garden_executable_untrusted)` or `(garden_executable_missing)` otherwise.

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

Output: eight manifest-reserved slots `<product-home>/state/pulse.0.md` … `pulse.7.md`, rotated like the
automation log slots (`planLogRotation`: slot n+1 ← slot n, slot 0 ← the new report), written in one
transaction; each report starts with a machine-readable header line holding its date and counts, and
the trend compares with slot 1, so no other store is needed. The verdict and the report path appear in
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
4. **One isolated agent call** with the pinned executable (§3.1), through the same vendor invocation `ingest` uses
   (`packages/adapter-claude/src/invoke.ts`, `packages/adapter-codex/src/invoke.ts`): no shell, no write
   tools, the product-owned isolated environment. The agent returns one JSON document:
   `{"proposals":[{"kind":"hub"|"related","target":"<content-relative path>","note":"<full note text>"}]}`.
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

**Amended during implementation (2026-10-01; rulings in the plan's ledger, carried into
`threat-model.md` §5.17):** provenance (`author: agent`, `reviewed: null`, `stage: emerging`) applies
to hubs only — a `related` proposal keeps the note's header except `updated` and may set `reviewed`
to null; the `## Related` section is
exactly 2–5 `- [[target]]` lines; hub bodies are plain prose, headings, lists and wikilinks (no code,
HTML, entities, escapes or URLs); agent links resolve only by vault-relative path or unique file name;
a hub's file name is unique across indexed notes, pending captures and the run; the prompt offers only
`hub` and `related`; captures are bound to the validated bytes (`target_changed`). The rules below are
the original design and are narrowed by this paragraph where they differ.

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
  compiled-note`; `sources` names only notes from the context bundle (`sources_outside_bundle`); at least 3 wikilinks to them
  (`hub_too_thin`).
- `related`: the target is one of the selected isolated notes (`target_not_selected`). The proposal
  equals the note's current bytes except a `## Related` section (added at the end, or replacing an
  existing one) holding 2–5 wikilinks, and the `updated` field (`related_changes_body`). The capture is
  a replacing capture bound to the note's current bytes, as `brain-enhance` captures are, so an edit in
  between makes `ingest` refuse it.

**Amended 2026-10-06 (D87, NEW-185):** the `fix` kind is removed. No target selection ever chose a
`fix` target and the prompt never offered one, so its validator was unreachable code on the security
path. The parser, the `garden.proposals` schema enum and the validator accept only `hub` and
`related`; a response naming `fix` is `agent_output_invalid`. A lint finding with a key is repaired by
the person or by `brain-enhance`.

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
gains a section for this surface and D77, and its "automation is closed" row is rewritten: exhaustive
dispatch and generation-bound argv stay, `maySpawnVendor` is `true` for `brain-garden` only, and the
runner refuses a vendor call from any other job. The opt-in surfaces spec's "no scheduled job can spend
vendor credits" is annotated as superseded for that one job by D77. The pinned executable (Q5) keeps the
launchd environment out of the trust decision.

Inputs the pulse and gardener need that no API exposes today: the capture envelope's `createdAt`
(`ReviewedCaptureV1` has none, and `review`'s `listByStatus` is private) — a small exported reader of
quarantined envelopes is in scope.

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
green and after the founder enables automation (D76); the reinstall is required, not optional, because
the new reservation rows make older installs fail admission (§3.1). Changing `workflows/brain-garden`
re-renders `plugins/{claude,codex}/skills/developer-os-brain-garden/SKILL.md` (`npm run render:claude`,
`render:codex`), and the byte-exact generated-plugin tests re-pin; `automation.brainGarden.*` raises the
readable config key count pinned in `packages/core/src/config/keys.test.ts`. Until then the founder's Cowork gardener and pulse
bridge the gap; they are disabled once the product jobs run.

## 9. Out of scope

Automatic `ingest` or `import`; structural changes (`refactor`, `retire`); more than one agent call per
run; a report inside the vault; any non-macOS scheduler.
