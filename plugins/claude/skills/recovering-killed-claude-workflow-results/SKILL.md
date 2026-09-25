---
name: recovering-killed-claude-workflow-results
description: 'Recover completed sub-agent results after a Claude Code Workflow (multi-agent

  orchestration) dies partway — usually "You''ve hit your session limit" or a mid-response

  connection drop. Use when: (1) a background Workflow task-notification shows many

  agents_error but agents_done > 0, (2) you need the verified findings/maps from the agents

  that DID finish without re-running everything, (3) a workflow''s final return looks empty

  and you must check what agents actually returned, (4) you want to resume filling only the

  gaps. Covers journal.jsonl vs the task output file, agentId joins, and gap-fill resume.

  '
---

# Recovering results from a Workflow killed by a session limit

## Problem

A long `Workflow` run (dozens of agents) is interrupted — session limit, or `API Error:
Connection closed mid-response`. The task-notification `<result>` is truncated and mixes
"failed" noise. You must salvage the completed agents' output (maps, findings, verdicts)
and fill only the gaps, WITHOUT re-running the whole (expensive) workflow.

## Context / Trigger Conditions

- `<task-notification>` `status=completed` but `<failures>` lists many
  `You've hit your session limit` / `StructuredOutput retry cap exceeded` / `Connection closed`.
- `<usage>` shows e.g. `agents_done: N, agents_error: M`.
- The inline `<result>` is truncated ("...truncated N chars, full result in <taskOutputFile>").
- You are tempted to re-run — don't; most of the work is recoverable.

## Solution

Two files hold everything (their paths are in the notification's `<diagnostics>` and
`<output-file>`):

1. **`<transcriptDir>/journal.jsonl`** — one `{"type":"result","agentId":...,"result":{...}}`
   line per COMPLETED agent. This is the ground truth for what each agent returned.
2. **`<taskOutputFile>` (`<taskId>.output` in the session's temporary directory)** — JSON with
   keys `summary, logs, result, workflowProgress, totalTokens`. Crucially:
   - `d['result']` is the workflow's **final return value** with post-processed / merged
     fields (e.g. `{...cluster, ...verdict}` spreads) — richer than the raw journal.
   - `d['workflowProgress']` is a list of `{agentId, label, state, ...}` — the ONLY place the
     human-readable agent `label` is joined to `agentId`.

Recovery steps:

1. **Read `d['result']` first.** If the workflow returned before dying, this has the merged
   deliverable (e.g. `confirmed[]` with titles+verdicts+fixes). Prefer it over the journal.
2. **If results are orphaned from labels** (the schema returned only `{verdict, evidence}` with
   no title), JOIN: `agentId → label` from `workflowProgress`, `agentId → result` from the journal.
3. **Files written to disk survive even when the structured return failed.** An agent that
   wrote `analysis/foo.md` then died on the StructuredOutput retry cap still left `foo.md` on
   disk with real content — even though its journal `result` is a placeholder ("test",
   "fact one"). Check the disk, don't trust the return summary alone.
4. **Compute the gap set** (which agents/clusters never completed) and run a SMALL gap-fill
   workflow: re-run only the missing analysis agents + pass the unfinished items (e.g. the
   N unverified clusters) to a fresh verify pass via the Workflow `args` global. This is
   cheaper and cleaner than `resumeFromRunId` when the dedup input changed (which invalidates
   the whole downstream cache anyway).

## Verification

- `grep -c '"type":"result"' journal.jsonl` = number of agents whose output you have.
- Categorize journal results by their keys (e.g. `mapFile` vs `verdict` vs `clusters`) to see
  which phase each belongs to.
- Reconcile against `<usage>` `agents_done` — they should roughly match.

## Example

```python
import json
d = json.load(open('<taskOutputFile>'))
res = d['result']                    # merged final return — use this
confirmed = res.get('confirmed', []) # fully merged findings with fixes, NOT orphaned
# join for orphaned journal verdicts:
labels = {a['agentId']: a['label'] for a in d['workflowProgress'] if a.get('agentId')}
for line in open('<transcriptDir>/journal.jsonl'):
    o = json.loads(line)
    if o.get('type') == 'result':
        lbl = labels.get(o['agentId'], '?')   # recover which cluster this verdict judged
```

Then feed the still-unverified items into a gap-fill:
`Workflow({ script, args: [...unverifiedClusters] })` where the script reads `const known = args`.

## Notes

- **Decision rule — resume vs gap-fill.** If the run was killed by a *transient* cause (session or
  usage limit, connection drop) and NOTHING about the script or `args` changed, just relaunch with
  `Workflow({ scriptPath, resumeFromRunId, args })` using the **identical script + args** — every
  completed agent (maps, auditors, verifiers) replays from cache instantly and ONLY the killed agents
  re-run. This has held across repeated resumes of the same run: each resume replayed every
  already-done agent from cache and re-ran only the ones that had errored, with zero lost work.
  Resume works only inside the session that started the run, after stopping the prior run
  (`TaskStop`); when the limit ended the session itself, use the gap-fill workflow instead.
  Reach for a fresh gap-fill workflow (above) ONLY when you deliberately changed post-processing or
  the dedup input (that is a cache miss that cascades downstream).
- Limits reset on a clock (the notification states the reset time); if you are already past it,
  resume immediately. If not, schedule a wake-up past the reset, then resume.
- Switching the session model before a resume makes the re-run agents inherit the new model —
  useful when one model tier is rate-limited but another is not.
- Placeholder returns ("test", "fact one", "Test summary for schema validation isolation")
  in `newAgents` mean the agent hit the StructuredOutput retry cap on its RETURN but likely
  still wrote its file. Always `wc -l` the expected output files on disk before assuming loss.
- `resumeFromRunId` replays unchanged `(prompt, opts)` from cache, but any agent whose input
  JSON changed (e.g. a dedup agent fed a now-larger issue list) is a cache MISS and cascades
  to everything downstream — so for "fill the gaps + re-verify" a fresh gap-fill workflow with
  `args` is often simpler than resume.
- Pass large recovered state (e.g. 30+ clusters, ~20KB JSON) into the gap-fill via `args` as a
  real JSON value, NOT a stringified string (a stringified list breaks `args.map`/`args.filter`).
- To prove no sub-agent mutated files it should not have: scan all workflow journals for
  `tool_use` blocks with `name in (Write, Edit)` and a `file_path` outside the allowed set.

## References

- Claude Code `Workflow` tool — journal and resume semantics (in-tool documentation).
- Derived empirically from recovering a large audit workflow killed by a session limit: the merged
  findings and the on-disk maps were recovered without re-running any completed agent.
