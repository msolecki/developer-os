# Observed `codex exec --json` output

`observed-exec-stream.jsonl` is stdout from **one real run** of `codex exec`, captured by DOS-P6
Task 17 on 2026-08-15 against `codex-cli 0.147.0` on macOS. It is the only recording in this
repository of what the vendor's event stream actually looks like; every other JSONL case in
`packages/adapter-codex/src/invoke.test.ts` is synthetic and says so.

**The invocation** reproduced the production **argv** by hand, flag for flag —
`packages/adapter-codex/src/invoke.ts` builds it:

```
codex exec --json --output-schema <templates/schemas/ingest.stage.schema.json> \
     -s read-only --skip-git-repo-check -C <working root> <prompt>
```

with stdin closed, which production does through `child.stdin.end(request.stdin)`.

**The argv and the closed stdin are what match production. What differs is the environment.**
Production hands the child `env: {}`; this was a shell run and the child inherited one. (The working
directory is *not* a difference: production passes `cwd()`, which is the CLI process's own inherited
directory.) So the recording is evidence about the **vendor's output protocol** and about nothing
concerning the child environment — do not read it as showing what a production child is handed.

**What was redacted, and it is the whole of what was changed.** Two substitutions, both to values
that identify the founder's account rather than the vendor's protocol:

- `thread_id` — a real session identifier, replaced with the synthetic
  `00000000-0000-7000-0000-000000000000`;
- the usage URL and the reset date inside both copies of the vendor's message — the top-level
  `message` on the `error` line and the nested `error.message` on the `turn.failed` line — replaced
  with `https://example.invalid/usage` and "a later date".

Every `type` value, every key name, the line count, the line order and the JSONL framing are as
observed. Nothing was reformatted.

**This is a failed turn, and that is a limitation of the fixture, not of the recording.** The
account's usage limit was exhausted, so no run reached a model response. What this stream can and
cannot support is set out in `specs/…-codex-adapter-design.md` §14.1 under the 2026-08-15
amendment; the short version is that it settles the framing and the discriminating field, and it
does **not** settle whether a successful turn's final response is the last parsing line.
