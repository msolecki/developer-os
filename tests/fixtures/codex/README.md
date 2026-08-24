# Observed `codex exec --json` output

Every recording of what the vendor's event stream actually looks like. Every other JSONL case in
`packages/adapter-codex/src/invoke.test.ts` is synthetic and says so — though since 2026-08-20 the
synthetic ones are built from the shape these show rather than from a guess.

| File | What it is | Captured |
|---|---|---|
| `observed-exec-stream.jsonl` | a turn that **failed** on an exhausted usage limit | DOS-P6 Task 17, 2026-08-15 |
| `observed-exec-schema-refusal.jsonl` | the vendor refusing this product's own shipped output schema | `BACKLOG.md` §1 NEW-21, 2026-08-20 |
| `observed-exec-success-stream.jsonl` | a turn that **succeeded** under `-s read-only`, with one shell command and one response | NEW-21, 2026-08-20 |
| `observed-exec-workspace-write-stream.jsonl` | the same, under `-s workspace-write --add-dir` | NEW-21, 2026-08-20 |
| `observed-exec-last-message-stream.jsonl` + `observed-exec-last-message.txt` | a turn run with `--output-last-message`, and the file it wrote | NEW-21, 2026-08-20 |

All ran against `codex-cli 0.147.0` on macOS.

**Every one of them is read by a test, and the word is *read* rather than *cited*.** A recording only
named in a comment is a claim nobody checks — a fresh-context review found that
`observed-exec-schema-refusal.jsonl` could be deleted with the whole suite green while a docblock went
on citing it. So: the two sandbox streams are compared shape-for-shape, so "identical under both
sandbox modes" is not a memory of a terminal; the last-message file is asserted equal to what the
stream's `agent_message` carries; and the refusal stream is loaded by the schema gate itself, which
asserts the vendor's error names `('properties', 'schemaVersion')`.

**The invocation** reproduced the production **argv** by hand, flag for flag —
`packages/adapter-codex/src/invoke.ts` builds it:

```
codex exec --json --output-schema <templates/schemas/ingest.stage.schema.json> \
     -s read-only --skip-git-repo-check -C <working root> <prompt>
```

with stdin closed, which production does through `child.stdin.end(request.stdin)`.

**The argv and the closed stdin are what match production. What differs is the environment.**
Production hands the child `env: {}`; these were shell runs and the child inherited one. (The working
directory is *not* a difference: production passes `cwd()`, which is the CLI process's own inherited
directory.) So the recordings are evidence about the **vendor's output protocol** and about nothing
concerning the child environment — do not read them as showing what a production child is handed.

**One deliberate difference in the 2026-08-20 runs, and it is the point of them.** Every
`CLAUDE*`, `CODEX*` and `ANTHROPIC*` variable was stripped from the parent before the run, so any
such variable a child of `codex exec` reports is one the vendor set rather than one leaking in from
the session that ran the experiment. That is what makes the `AGENT_DETECTION_ROWS` observation in
`observed-exec-success-stream.jsonl` admissible, and it is the same discipline the Claude row was
re-taken under on 2026-08-15.

## What the successful turn settled

**The response is not the last line.** The terminal event is `turn.completed`, a **usage record**.
The response is the line before it: an `item.completed` whose `item.type` is `agent_message`, whose
`text` holds the schema-constrained JSON **as a string**. The rule that shipped until 2026-08-20 —
"the last line that parses to a non-null object" — returned the usage record, and
`parseStructuredPayload` returned it as `ok: true`. That is the question knowledge-pipeline spec §10.2 put to a real run
and that the failed turn of 2026-08-15 could not answer.

**Two `item.completed` events, and only one of them is the answer.** The first is a
`command_execution` carrying the shell transcript. It has no `text` field, so a rule that reads
`item.text` skips it whether or not it also tests `item.type` — which is why this fixture is *not*
what pins the `item.type` test, and why `invoke.test.ts` carries a synthetic case with a non-response
item that *does* carry `text`. Stated because the first version of this paragraph claimed the fixture
pinned it, and a fresh-context review showed the guard could be deleted with the whole suite green.

**The 2026-08-15 vocabulary reading was too strong.** It recorded that all three names this package
had guessed were wrong. Two of them are right: `item.completed` and `turn.completed` both exist.
Only `session.created` does not — the vendor calls it `thread.started`. A failed turn is not a
stream those two could ever have appeared in.

**`codex exec` reads stdin when stdin is not a TTY**, printing `Reading additional input from
stdin...` to stderr and blocking. Reproduced on every run of both dates.

## What the schema refusal settled

`observed-exec-schema-refusal.jsonl` is what `codex exec --output-schema` answered when pointed at
the shipped `templates/schemas/ingest.stage.schema.json` **as it stood on 2026-08-20**: HTTP 400,
`In context=('properties', 'schemaVersion'), schema must have a 'type' key`, refused before the model
ran. `schemaVersion` was written as a bare `const`, which is valid JSON Schema and is rejected here.

The consequence was total rather than partial — **`ingest` could never have returned a proposal on
Codex** — and it had been shipped and gated green throughout, because nothing in the repository had
ever handed this file to the vendor. Adding `"type": "integer"` was the whole fix; the rest of the
schema, including `pattern`, `maxItems` and the length bounds, was accepted unchanged.

Keep this recording rather than only the fix: the next property added without a `type` breaks the
whole verb the same way, and `apps/cli/src/commands/output-schemas.test.ts` is the gate that now
catches it.

## What was redacted, and it is the whole of what was changed

Only values that identify the founder's account, never anything about the vendor's protocol. Every
`type` value, every key name, the line count, the line order and the JSONL framing are as observed.
Nothing was reformatted.

- **`observed-exec-stream.jsonl`** — the `thread_id`, replaced with
  `00000000-0000-7000-0000-000000000000`; and the usage URL and reset date inside both copies of the
  vendor's message — the top-level `message` on the `error` line and the nested `error.message` on
  `turn.failed` — replaced with `https://example.invalid/usage` and "a later date".
- **`observed-exec-success-stream.jsonl`** — the `thread_id`, replaced with
  `00000000-0000-7000-0000-000000000001`, and the same identifier where it recurs as the value of
  `CODEX_THREAD_ID` in the shell transcript and in the response body.
- **`observed-exec-schema-refusal.jsonl`** — the `thread_id`, replaced with
  `00000000-0000-7000-0000-000000000002`. The vendor's error text carries no account identifier and
  is verbatim. **It was recorded twice**: the first copy was overwritten before it was saved, and the
  second reproduced it byte for byte apart from the thread id. Nothing was reconstructed from memory.
- **`observed-exec-workspace-write-stream.jsonl`** — the `thread_id`, replaced with
  `00000000-0000-7000-0000-000000000003`, and the same identifier where it recurs as the value of
  `CODEX_THREAD_ID`.
- **`observed-exec-last-message-stream.jsonl`** — the `thread_id`, replaced with
  `00000000-0000-7000-0000-000000000004`. **`observed-exec-last-message.txt` is unredacted**, because
  the payload it holds names nothing: a synthetic note path, a synthetic capture id and the body
  `ok`.

**One thing was deliberately not redacted, and it is worth naming.** Each `turn.completed` carries a
real `usage` object — token counts from the founder's account. It is activity rather than identity, no
claim here says it was removed, and it is what makes the fixture a recording rather than a rewrite.

**These are the one deliberate exception to `SESSION.md`'s "fixtures are synthetic" rule**, mandated
by DOS-P6 Task 17 because neither the JSONL rule nor the schema's acceptability can be settled
against an invented stream. The two defects found on 2026-08-20 are what that exception bought.

## The probe prompt is not reproduced here, and the reason is worth stating

The successful run's prompt asked the model to run one `env` pipeline and echo the matching variable
names and values back in the note body. The pipeline filtered out any name containing `key`, `token`,
`secret`, `auth`, `pass` or `cred` before the model ever saw it, so no credential could reach the
transcript, the recording or this repository by that route. A future probe of the same kind should
filter before the model reads, not after — redacting a value the model has already been shown is
redacting the wrong copy.
