# Developer OS Ingest Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ingest model call hermetic — no tools, no user settings, no user hooks, no MCP servers, no rules, no persisted history — and give the model the material it needs in the prompt instead of a read scope over the vault.

**Architecture:** Both adapters gain the isolation flags their installed vendor actually accepts, and Claude's tool grant is replaced by an explicit empty tool set. The vault read scope disappears: `buildIngestPrompt` grows a third parameter carrying a bounded index excerpt (title, summary, path), which the ingest command reads once per run. The process-environment allowlist is evidence-driven — a variable is admitted only where a recorded observation shows the vendor fails without it. Codex's final-answer selection and the environment allowlist are each gated on evidence this plan's first task produces.

**Tech Stack:** TypeScript 5.9 strict ESM, Node.js 24 built-ins, Vitest 4, Claude Code 2.1.260, codex-cli 0.151.0, macOS 15+.

**Spec:** `docs/superpowers/specs/2026-07-21-developer-os-design.md` §13.4, as amended by founder decision D8 in `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`. Scope: `BACKLOG.md` NEW-58 and NEW-44, roadmap Phase 1.

---

## Founder decisions required before execution

Three of roadmap Phase 1's bullets are contradicted by the installed binaries or by the shipped code. **Do not begin Task 2 until the founder has settled these.** Task 1 produces the evidence each one needs.

| # | The roadmap says | What is actually true | Decision needed |
|---|---|---|---|
| F1 | "pin `--max-turns` with a test against the real binary" | `--max-turns` does not appear anywhere in `claude --help` for 2.1.260, yet `packages/adapter-claude/src/invoke.ts:105-115` passes it on every invocation and `DEFAULT_MAX_TURNS = 5` is bounded to [1,50] by a guard. Either the flag is undocumented, or **every real Claude ingest run today fails on an unknown flag.** | Whether to drop `--max-turns` and its bound, or keep it. Task 1 Step 2 settles which case it is without a model run. |
| F2 | "Process environment allowlist (`PATH`, `HOME`, `TMPDIR`, proxy and certificate variables)" | Both adapters pass `env: {}` today, so the child gets a **completely empty** environment. `tests/security/network.test.ts:72` pins that and its docblock says the empty env "is stricter than spec §2.7 asks and this constant is where a vendor CLI that genuinely needs `HOME` would be admitted, deliberately, in one place a reviewer can see." An allowlist is therefore a **widening**, not a hardening. | Whether to widen at all, and if so on what evidence. This plan's position: admit a variable **only** where Task 1 recorded the vendor failing without it, never speculatively, and never a proxy variable — `tests/security/network.test.ts:228` exists to prove a parent's proxy does not reach the child. |
| F3 | "select the final answer from `turn.completed` `last_agent_message` with `finalAgentMessage` as fallback" | `codex app-server generate-json-schema` (static, no model run) shows the v2 protocol's `TurnCompletedNotification` carries **no** `last_agent_message`; an agent reply is a `ThreadItem` `{type: "agentMessage", text}` inside `turn.items`. But app-server is JSON-RPC, a different interface from `codex exec --json`'s JSONL stream, so this is suggestive and not conclusive. The shipped `finalAgentMessage` reads `item.completed` / `agent_message`, which the 0.147.0 fixtures do contain. | Whether Task 4 may be settled from Codex source (NEW-47), or whether it needs one paid observational run (NEW-45), which is a founder stop condition. |

## Global Constraints

- **Ingest runs with no tools.** Founder decision D8: "Ingest invokes the vendor with no tools: capture text plus a bounded index excerpt in the prompt, structured result out. Claude and Codex invocations are isolated from user settings, hooks, MCP servers, rules and history."
- **Verified against the installed binaries, 2026-09-04** — use these, do not re-derive them from memory:
  - `claude` 2.1.260: `--tools ""` exists and disables all tools. `--allowedTools` is a permission-layer **grant**, not a restriction. `--strict-mcp-config` exists and, with no `--mcp-config`, loads zero MCP servers. `--json-schema` exists. `--permission-mode` exists with six values but the help gives no per-value description. `--setting-sources` exists but the help does not say whether `""` means "load none". `--max-turns` does not appear in the help. Also present and relevant: `--restricted`, `--bare`, `--safe-mode`, `--no-session-persistence`, `--permission-prompts`.
  - `codex` 0.151.0: `--ephemeral`, `--ignore-user-config` and `--ignore-rules` exist **only on `codex exec`**, not top-level. `--ignore-rules` covers execpolicy `.rules` only, not hooks. There is **no** per-invocation flag disabling MCP servers for one `exec` call; only `--ignore-user-config`, which stops `config.toml` loading entirely.
- **No guessing at vendor behaviour.** Where the help text is ambiguous, probe the installed binary and record the observation. Where a probe would require a model turn, stop and ask — spending model credits is a founder stop condition.
- **No fixture is invented.** A recording comes from the installed version or it does not exist. `tests/fixtures/codex/README.md` currently records 0.147.0; anything this plan relies on must be re-recorded from 0.151.0 or explicitly marked as evidence about the older version.
- Redact before truncating, hashing, logging, persistence, publication, or model input.
- Every test written here must be observed failing for the stated reason before its implementation step.
- A test pins the contract, not current behavior. Several tests below are **inverted** because the contract changed; each such step says so and says why.
- Stage exact task-owned paths. Never `git add -A`, `git add .`, or a wildcard. `docs/superpowers/**` is git-ignored by a global rule and needs `git add -f`.
- Reviewer and author are different agents.
- **Never run `apps/cli/src/bootstrap/executor.test.ts`** — that one file takes over an hour. Background commands are terminated at ~29 minutes and the notification hides the kill, so prefer short foreground runs.
- Editing a `workflows/*/workflow.yaml` requires `npm run render:claude && npm run render:codex` from the repository root, or `tests/contracts/adapters/{claude,codex}/generated.test.ts` goes red.

## File and Responsibility Map

| Area | Files | Responsibility |
|---|---|---|
| Probe evidence | `docs/architecture/vendor-invocation.md` (new) | The recorded observations Tasks 2, 4 and 6 argue from |
| Claude invocation | `packages/adapter-claude/src/invoke.ts`, `invoke.test.ts`, `index.test.ts` | Empty tool set, isolation flags, `--max-turns` per F1 |
| Codex invocation | `packages/adapter-codex/src/invoke.ts`, `invoke.test.ts`, `index.test.ts` | `exec` isolation flags, final-answer selection per F3 |
| Codex fixtures | `tests/fixtures/codex/`, `tests/fixtures/codex/README.md` | A 0.151.0 recording, or a recorded refusal to produce one |
| Ingest command | `apps/cli/src/commands/ingest.ts:212-228,754-819`, `ingest.test.ts` | Delete the tool list, pass the index excerpt |
| Prompt | `packages/brain/src/ingest/prompt.ts`, `prompt.test.ts` | Third parameter: bounded index excerpt |
| Process environment | `packages/security/src/process.ts`, `tests/security/network.test.ts` | Allowlist, only if F2 admits one |
| Agent attribution | `packages/brain/src/capture/agent.ts`, `agent.test.ts` | Two matches resolve to `unknown` (NEW-44) |
| Negative hook harness | `tests/integration/ingest/no-user-hooks.test.ts` (new), `tests/helpers/temp-home.ts` | Prove a planted user hook never runs during ingest |

---

### Task 1: Record what the installed binaries actually do

**Files:**
- Create: `docs/architecture/vendor-invocation.md`
- Read only: the installed `claude` and `codex` binaries

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/architecture/vendor-invocation.md`, the recorded-observation table every later task cites instead of re-deriving vendor behaviour. Each row: flag, exact command run, verbatim output, date, vendor version.

This task spends **no model credits**. Every probe below either prints help, rejects a flag, or fails fast. If any probe would start a model turn, do not run it — record it as unresolved and say so.

- [x] **Step 1: Create the document with its rules**

Write `docs/architecture/vendor-invocation.md` with a preamble stating: this file records observations of specific vendor versions, each row carries the exact command and its verbatim output, a row is void when the vendor version changes, and nothing here may be inferred — only observed. Then an empty table per vendor with columns: observation · command · verbatim output · vendor version · date.

- [x] **Step 2: Settle F1 — does `claude` accept `--max-turns`?**

Run, and record all three:

```bash
claude --help 2>&1 | grep -c -- "--max-turns"
claude --max-turns 5 --help 2>&1 | head -20
claude --tools "" --help 2>&1 | head -20
```

The second command is the discriminator: a CLI that rejects unknown flags errors before reaching `--help`. Record which happened, verbatim. **If `claude` rejects `--max-turns`, that is a live defect** — `packages/adapter-claude/src/invoke.ts` passes it on every invocation, so every real ingest run fails. Say so in the row, and stop to report it before continuing; it changes F1 from a preference into a bug.

- [x] **Step 3: Settle the `--setting-sources ""` ambiguity**

Run:

```bash
claude --setting-sources "" --help 2>&1 | head -20
claude --setting-sources none --help 2>&1 | head -20
```

Record whether an empty value is accepted, rejected, or silently ignored. If neither probe distinguishes "accepted" from "ignored", record that the semantics are **unresolved without a model run** and mark `--setting-sources` as not-yet-usable rather than guessing.

- [x] **Step 4: Record `--permission-mode`'s values and pick the most restrictive**

Run `claude --help 2>&1 | grep -A5 -- "--permission-mode"` and record the six values verbatim. Then state which is most restrictive **and the evidence for that claim**. If the help gives no ordering and no probe distinguishes them, record it as unresolved and prefer `--tools ""` plus `--strict-mcp-config`, which are unambiguous, over a permission mode chosen by guess.

- [x] **Step 5: Record the codex exec flags**

Run `codex exec --help` and record verbatim the entries for `--ephemeral`, `--ignore-user-config`, `--ignore-rules`, `--json`, `--output-schema`, `-s`/`--sandbox`, `--skip-git-repo-check`, `-C`. Note explicitly that no flag disables MCP servers for one call.

- [x] **Step 6: Settle F2 — does either vendor need any environment variable?**

Both adapters pass `env: {}` today. Determine whether that is survivable by running each binary with an empty environment and a command that cannot start a model turn:

```bash
env -i /absolute/path/to/claude --help >/dev/null 2>&1; echo "claude --help under env -i: $?"
env -i /absolute/path/to/codex --help >/dev/null 2>&1; echo "codex --help under env -i: $?"
```

Use the absolute paths that `which claude` and `which codex` report. Record both exit codes verbatim. A zero exit is evidence the binary starts with no environment at all; a non-zero exit is evidence a variable is needed, and the error text names which. **Record only what you observed.** Do not extrapolate from `--help` succeeding to a real run succeeding — say in the row that `--help` is weaker evidence than a real invocation, and that the stronger evidence needs a model run the founder has not authorised.

- [x] **Step 7: Commit**

```bash
git add docs/architecture/vendor-invocation.md
git commit -m "docs: record what the installed vendor binaries accept"
```

- [x] **Step 8: Report the three founder decisions**

Stop here and report F1, F2 and F3 with the evidence Steps 2–6 produced. Do not begin Task 2 until the founder has settled them. If F1 turned out to be a live defect, say so first.

---

### Task 2: Give Claude no tools and no user configuration

**Files:**
- Modify: `packages/adapter-claude/src/invoke.ts:11-26` (`ClaudeInvocation`), `:105-115` (argv), `:79-89` (the `maxTurns` guard, per F1)
- Modify: `packages/adapter-claude/src/invoke.test.ts` — the tool-grant cases. This row carried their
  pre-change line numbers until 2026-09-05, when executing the task deleted those lines and the
  citation gate refused the now out-of-range reference.
- Modify: `packages/adapter-claude/src/index.test.ts:37` (pins the exact export list)

**Interfaces:**
- Consumes: `docs/architecture/vendor-invocation.md` from Task 1; `ProcessRunner` from `@developer-os/security`; `screenProseArgument`, `screenValueArgument`.
- Produces: `ClaudeInvocation` **without** `allowedTools`. If F1 removed the turn bound, also without `maxTurns`, and `DEFAULT_MAX_TURNS` is deleted from the package's exports — `apps/cli/src/commands/ingest.ts:19` imports it and Task 5 removes that import.

- [ ] **Step 1: Invert the tool-grant test**

`packages/adapter-claude/src/invoke.test.ts:55` currently asserts the exact argv including `--allowedTools Read "Bash(git log *)"`. Replace that case with one asserting the new argv. Write the expected argv from Task 1's recorded flags, not from this plan's memory. The shape:

```ts
it("passes argv as an array, in print mode, with no tools and no user configuration", async () => {
  const seen = recordArgv();
  await invokeClaude(installation, invocation(), { runner: seen.runner });
  expect(seen.args()).toEqual([
    "-p", "the prompt",
    "--output-format", "json",
    "--tools", "",
    "--strict-mcp-config",
    // plus whatever Task 1 recorded as accepted and unambiguous
  ]);
});
```

Delete `:78` (`"omits allowedTools entirely when the list is empty"`) — it pinned the behaviour that made "no tools" and "vendor defaults" the same argv, which is the defect. Delete `:178`, `:192`, `:282` and `:293`, which screen entries of a list that no longer exists.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root packages/adapter-claude src/invoke.test.ts`

Expected: the new argv case FAILS on the array comparison, showing the old argv with `--allowedTools`. Record the diff.

- [ ] **Step 3: Rebuild the argv**

In `packages/adapter-claude/src/invoke.ts`, remove `allowedTools` from `ClaudeInvocation` and its docblock claim that it is "where a compile-time scope becomes a runtime restriction" — that claim is false and is the defect's origin. Build the argv from Task 1's recorded flags. Apply F1's decision to `--max-turns` and its guard at `:79-89`.

Keep every pre-spawn screen that survives: the absolute-executable check at `:70-72` and `screenProseArgument(invocation.prompt, "prompt")` at `:94-97`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --root packages/adapter-claude src/invoke.test.ts src/index.test.ts`

Expected: PASS, including the failure-identity cases at `:93-139` and the `__proto__` refusal at `:266`, which this task does not touch.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude/src/invoke.ts packages/adapter-claude/src/invoke.test.ts packages/adapter-claude/src/index.test.ts
git commit -m "fix(adapter-claude): invoke with no tools and no user configuration"
```

---

### Task 3: Isolate the Codex invocation

**Files:**
- Modify: `packages/adapter-codex/src/invoke.ts:265-277` (argv)
- Modify: `packages/adapter-codex/src/invoke.test.ts:290,311,321`
- Modify: `tests/fixtures/codex/README.md`

**Interfaces:**
- Consumes: Task 1's recorded `codex exec` flags.
- Produces: an argv carrying `--ephemeral --ignore-user-config --ignore-rules` in addition to what it carries today. `CodexInvocation` is unchanged.

- [ ] **Step 1: Extend the argv test**

`packages/adapter-codex/src/invoke.test.ts:290` asserts the full argv in order. Add the three isolation flags to the expected array, positioned as Task 1 recorded them being accepted. Keep `:311` (`"uses read-only and adds no --add-dir when there are no write scopes"`) and `:321` (`"hands the runner the host cwd, no stdin, no environment, and the invocation's own timeout"`) — both still hold and `:321` is what keeps the empty environment honest until F2 is settled.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --root packages/adapter-codex src/invoke.test.ts -t "full Codex architecture"`

Expected: FAIL on the array comparison, missing the three flags.

- [ ] **Step 3: Add the flags**

In `packages/adapter-codex/src/invoke.ts:265-277`, add `--ephemeral`, `--ignore-user-config` and `--ignore-rules` to the argv. Leave `-s` derived from `writeScopes.length` — the docblock at `:202-208` explains that deriving it from the count rather than an argument is what makes `danger-full-access` unreachable by argument, and that property must survive.

Write one line beside the flags recording what `--ignore-user-config` costs: it stops `config.toml` loading entirely, which is also the only way to keep the user's MCP servers out, because 0.151.0 has no per-invocation MCP flag. That is a non-obvious mechanical fact about the vendor and a reader cannot recover it from the code.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run --root packages/adapter-codex src/invoke.test.ts`

Expected: PASS.

- [ ] **Step 5: Correct the fixture README's version claim**

`tests/fixtures/codex/README.md` says every recording ran against `codex-cli 0.147.0`. The installed version is 0.151.0. Add a dated line stating that the recordings are evidence about 0.147.0's output protocol only, and that Task 4 owns whether they still describe 0.151.0. Do not delete the recordings.

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-codex/src/invoke.ts packages/adapter-codex/src/invoke.test.ts tests/fixtures/codex/README.md
git commit -m "fix(adapter-codex): run exec ephemeral, ignoring user config and rules"
```

---

### Task 4: Settle the Codex final-answer selection (F3, NEW-47)

**Files:**
- Modify: `packages/adapter-codex/src/invoke.ts:120-200` (`finalAgentMessage`), only if the evidence supports it
- Modify: `tests/fixtures/codex/`, only if a 0.151.0 recording is authorised

**Interfaces:**
- Consumes: F3's founder decision.
- Produces: either a changed selection rule with recorded evidence, or a recorded refusal to change it.

- [ ] **Step 1: Read the Codex source for the exec event schema**

This is NEW-47. Locate the installed Codex distribution (`which codex`, then follow the install root) and find where `exec --json` emits its event stream. Determine, from source rather than inference: the exact event `type` values, whether `turn.completed` exists in that stream, and whether it carries a final-message field.

Record everything in `docs/architecture/vendor-invocation.md` with file paths into the Codex distribution.

- [ ] **Step 2: Decide from what you found**

Three outcomes, and only these:

1. **Source shows `turn.completed` carries a final message.** Change `finalAgentMessage` to prefer it, keeping the existing `item.completed`/`agent_message` scan as the fallback. Add a test using a hand-built stream in the recorded shape, and say in its docblock that it is constructed from source, not observed.
2. **Source shows it does not.** Leave `finalAgentMessage` as it is. Delete the roadmap's claim that a deterministic replacement exists, and rewrite `BACKLOG.md` NEW-58's sentence about it. Record the source evidence.
3. **Source cannot settle it.** Stop and ask the founder for one paid observational run (NEW-45). Do not run it yourself; spending model credits is a founder stop condition. Leave the code unchanged and say so.

- [ ] **Step 3: Address the last-wins tie-break either way**

The docblock at `:154-170` labels the last-wins rule an unobserved inference and cites NEW-45. Whatever Step 2 concludes, make that docblock state the current evidence accurately — either it is now settled, or it is still an inference and NEW-45 still owns it.

- [ ] **Step 4: Run the codex suite**

Run: `npx vitest run --root packages/adapter-codex src/invoke.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-codex/src/invoke.ts packages/adapter-codex/src/invoke.test.ts docs/architecture/vendor-invocation.md
git commit -m "fix(adapter-codex): settle the final-answer selection against Codex source"
```

If Step 2 reached outcome 3, commit only the recorded evidence and the corrected docblock, with the message `docs: record what Codex source does and does not settle about exec events`.

---

### Task 5: Replace the vault read scope with a bounded index excerpt

**Files:**
- Modify: `packages/brain/src/ingest/prompt.ts:13-16` (caps), `:18-27` (`IngestPromptOptions`), `:36-42` (the two-parameter docblock), `:67-112` (assembly)
- Modify: `packages/brain/src/ingest/prompt.test.ts:68,89,111,128,188`
- Modify: `apps/cli/src/commands/ingest.ts:19` (import), `:212-228` (delete `CLAUDE_READ_ONLY_TOOLS`), `:754-819` (`invokeVendor`), `:1291-1297` (the call site)
- Modify: `apps/cli/src/commands/ingest.test.ts:1654,1672,1694,1799,1878`

**Interfaces:**
- Consumes: `IndexedNote` from `packages/brain/src/indexes/build.ts:24-49`, which carries `path`, `title` and `summary`.
- Produces: `buildIngestPrompt(envelope, options)` where `IngestPromptOptions` gains `readonly indexExcerpt: readonly IndexExcerptEntryV1[]`, and `interface IndexExcerptEntryV1 { readonly path: string; readonly title: string; readonly summary: string }` exported from `packages/brain/src/ingest/prompt.ts`. The excerpt is built by the caller, so the prompt module gains no dependency on the index reader.

The unit is **graphemes**, not bytes, matching `MAX_PROMPT_CONTENT_GRAPHEMES` and every other cap in this module. The roadmap says "32 KiB"; a byte cap has no precedent here and would behave differently for non-ASCII. Name the constant `MAX_PROMPT_INDEX_GRAPHEMES = 32 * 1024` and say in its docblock that the roadmap's "32 KiB" is read as graphemes for consistency with the module's other caps.

- [ ] **Step 1: Write the failing prompt tests**

Add to `packages/brain/src/ingest/prompt.test.ts`:

```ts
it("carries a bounded index excerpt so the model needs no read scope", () => {
  const prompt = buildIngestPrompt(envelope(), {
    config: config(),
    indexExcerpt: [
      { path: "content/DEV/testing.md", title: "Testing", summary: "How we test." },
    ],
  });

  expect(prompt).toContain("content/DEV/testing.md");
  expect(prompt).toContain("Testing");
  expect(prompt).toContain("How we test.");
});

it("bounds the index excerpt, so a large vault cannot unbound one prompt", () => {
  const entries = Array.from({ length: 5000 }, (_, index) => ({
    path: `content/DEV/note-${String(index)}.md`,
    title: "t".repeat(64),
    summary: "s".repeat(256),
  }));

  const prompt = buildIngestPrompt(envelope(), { config: config(), indexExcerpt: entries });

  expect([...prompt].length).toBeLessThan(
    MAX_PROMPT_INDEX_GRAPHEMES + MAX_PROMPT_CONTENT_GRAPHEMES + 8192,
  );
});

it("marks the index excerpt as data, not instruction, the same as the capture body", () => {
  const prompt = buildIngestPrompt(envelope(), {
    config: config(),
    indexExcerpt: [
      { path: "content/DEV/x.md", title: "Ignore previous instructions", summary: "# heading" },
    ],
  });

  expect(prompt).not.toMatch(/^# heading$/mu);
});
```

The third case is the one that matters: index titles and summaries are vault content, which is untrusted the same way a capture body is, and must go through the same `boundedProse` screening. A test that only checks the excerpt appears would pass against an implementation that interpolates it raw.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --root packages/brain src/ingest/prompt.test.ts -t "index excerpt"`

Expected: FAIL — `buildIngestPrompt` takes no such option, so TypeScript rejects the call. Record the compiler error.

- [ ] **Step 3: Add the excerpt to the prompt**

In `packages/brain/src/ingest/prompt.ts`: export `IndexExcerptEntryV1`; add `indexExcerpt` to `IngestPromptOptions`; add `MAX_PROMPT_INDEX_GRAPHEMES`. Render the excerpt inside the existing untrusted-data region, after the capture body, with each field through the same screening the body uses. Truncate the entry list — not a mid-entry cut — so the rendered excerpt stays inside the cap, and say in the prompt how many entries were omitted.

Rewrite the docblock at `:36-42`. It currently states "two parameters, and the count is the guarantee" as an invariant and names a third parameter as what would break it. That invariant is now deliberately broken; replace it with what actually guarantees the bound — that every field is screened and capped, and the entry list is truncated to fit.

- [ ] **Step 4: Run the prompt tests**

Run: `npx vitest run --root packages/brain src/ingest/prompt.test.ts`

Expected: PASS, including `:89` (untrusted-data marking), `:111` (fence sizing) and `:128` (capture-body bound), which must still hold.

- [ ] **Step 5: Invert the ingest tool-scope test**

`apps/cli/src/commands/ingest.test.ts:1672` is `"gives claude no write tool in --allowedTools"` and asserts `allowedTools(...).length > 0` on the reasoning that "an empty tool list proves nothing". Under the new contract an empty tool set is exactly the point. Replace it:

```ts
it("gives claude no tools at all, so the read scope is the prompt and nothing else", () => {
  const argv = claudeArgv();

  expect(argumentAfter(argv, "--tools")).toBe("");
  expect(argv).not.toContain("--allowedTools");
});
```

Keep `:1654` (codex read-only sandbox, no `--add-dir`) — it still holds.

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run --root apps/cli src/commands/ingest.test.ts -t "no tools at all"`

Expected: FAIL — the argv still carries `--allowedTools`.

- [ ] **Step 7: Delete the tool list and pass the excerpt**

In `apps/cli/src/commands/ingest.ts`: delete `CLAUDE_READ_ONLY_TOOLS` and the comment at `:212-227` that defers the permission-rule spelling to "Task 17". Rewrite the `invokeVendor` docblock at `:759-785` — its claim that "the read side is each vendor's own vocabulary: Codex gets the content root as its working root, and Claude gets the tool list" is exactly what this plan ends. Read the index once per run and pass the excerpt into `buildIngestPrompt` at `:1291-1297`; do not read it per capture.

Codex still receives `-C <contentRoot>` as its working root. Note in your report whether that remains a read scope in practice, and if so, raise it — this plan removes Claude's read grant and may leave Codex's in place, which would be an asymmetry the founder should see.

- [ ] **Step 8: Run the CLI and brain suites**

Run: `npx vitest run --root apps/cli src/commands/ingest.test.ts && npx vitest run --root packages/brain src/ingest/prompt.test.ts`

Expected: PASS, including `:1694` (redacted body, never the raw observation) and `:1799` (a configured client name never reaches the prompt) — both of which now also cover the excerpt.

- [ ] **Step 9: Commit**

```bash
git add packages/brain/src/ingest/prompt.ts packages/brain/src/ingest/prompt.test.ts apps/cli/src/commands/ingest.ts apps/cli/src/commands/ingest.test.ts
git commit -m "feat(ingest): carry a bounded index excerpt instead of granting a vault read scope"
```

---

### Task 6: The process environment, per F2

**Files:**
- Modify: `packages/security/src/process.ts:87-93`, only if F2 admits a variable
- Modify: `tests/security/network.test.ts:72,199,228,267`, only if F2 admits a variable

**Interfaces:**
- Consumes: F2's founder decision and Task 1 Step 6's recorded exit codes.
- Produces: either an allowlist with recorded justification per variable, or a recorded decision to keep the empty environment.

- [ ] **Step 1: If F2 kept the empty environment, record that and stop**

Add a row to `docs/architecture/vendor-invocation.md` stating that both vendors start with no environment, that the empty environment is retained, and that `tests/security/network.test.ts:72` remains the single place a future admission would be made. Then skip to Step 4. **This is the expected outcome** unless Task 1 Step 6 recorded a non-zero exit.

- [ ] **Step 2: If F2 admitted variables, add them one at a time**

For each admitted variable, in its own commit: extend the allowlist in `packages/security/src/process.ts`, update `EXPECTED_VENDOR_ENVIRONMENT` in `tests/security/network.test.ts:72`, and add to that constant's docblock the recorded observation justifying the admission — the command, the failure, the date.

Never admit a proxy variable. `tests/security/network.test.ts:228` (`"does not pass a proxy the parent process was given"`) exists to prove a parent's proxy does not reach the child, and the roadmap's mention of proxy and certificate variables contradicts it. If the founder wants proxies admitted, that is a separate decision with its own row, not a line in this allowlist.

- [ ] **Step 3: Prove the allowlist is exhaustive**

Add to `tests/security/network.test.ts` a case that sets several variables in the parent — including one plausible secret-bearing name — and asserts the child's environment equals `EXPECTED_VENDOR_ENVIRONMENT` exactly, using `toStrictEqual`. An allowlist that is only asserted positively cannot catch a leak.

- [ ] **Step 4: Run the security suite**

Run: `npx vitest run --root tests security/network.test.ts security/multiline-command.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/security/src/process.ts tests/security/network.test.ts docs/architecture/vendor-invocation.md
git commit -m "fix(security): record the vendor child environment decision"
```

---

### Task 7: Two matching detection rows mean the agent is unknown (NEW-44)

**Files:**
- Modify: `packages/brain/src/capture/agent.ts:83-93` (`matchObservedAgent`)
- Modify: `packages/brain/src/capture/agent.test.ts:62,152`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `matchObservedAgent` returning `"unknown"` when more than one row matches. The signature is unchanged.

- [ ] **Step 1: Invert the two pinned tests**

`agent.test.ts:62` is `it("names claude when both markers are present, because the table is ordered")` with a docblock saying the behaviour is "pinned rather than fixed" and citing NEW-44. `:152` is `it("takes the first row that matches, so declaration order is the tie-break")`. Both now assert the opposite:

```ts
it("names no agent when two markers match, because a nested session is not attributable", () => {
  expect(detectSourceAgent({ CLAUDECODE: "1", CODEX_THREAD_ID: "t-1" })).toBe("unknown");
});

it("returns unknown when more than one row matches, so declaration order is not a tie-break", () => {
  expect(matchObservedAgent(syntheticRows, syntheticDoubleMatchEnv)).toBe("unknown");
});
```

Rewrite the first one's docblock: it must now say why a nested session is unattributable, and that NEW-44 is closed by this change — not that the behaviour is pinned pending a fix.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --root packages/brain src/capture/agent.test.ts`

Expected: both FAIL, receiving `"claude"` and `"synthetic-presence"`.

- [ ] **Step 3: Collect every match instead of returning the first**

Replace the early `return` in `matchObservedAgent` with a collection over all rows, returning `UNKNOWN_AGENT` when the match count is not exactly one. Keep the existing rule that an exported-but-empty variable counts as absent.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run --root packages/brain src/capture/agent.test.ts`

Expected: PASS, including the single-match cases.

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/capture/agent.ts packages/brain/src/capture/agent.test.ts
git commit -m "fix(brain): attribute a nested session to no agent rather than the first row"
```

---

### Task 8: Prove a planted user hook never runs during ingest

**Files:**
- Create: `tests/integration/ingest/no-user-hooks.test.ts`
- Read: `tests/helpers/temp-home.ts`, `tests/integration/claude/plugin-loads.test.ts:90-193`

**Interfaces:**
- Consumes: `createTempHome`, `inventory`, `addedPaths`, `removeTempHome` from `tests/helpers/temp-home.ts`; the isolation pattern at `tests/integration/claude/plugin-loads.test.ts:101-107`; the sentinel pattern at `packages/security/src/process.test.ts:137`.
- Produces: the first negative-assertion harness for hooks in this repository.

No such harness exists today. The two halves do: a temp-HOME filesystem inventory that asserts nothing was written outside an expected root, and a sentinel side effect that proves a guard ran before execution. This task composes them.

- [ ] **Step 1: Write the failing harness**

Create `tests/integration/ingest/no-user-hooks.test.ts`. It must:

1. Build a temp HOME with `createTempHome`.
2. Plant, in that HOME, a user hook configured the way the installed vendor loads hooks, whose action writes a sentinel file into the temp HOME.
3. Run one real ingest against the installed vendor, `skipIf` the binary is absent, exactly as `plugin-loads.test.ts` does.
4. Assert the sentinel file does **not** exist.
5. Assert, via `addedPaths`, that nothing was written outside the paths ingest is entitled to write.

The sentinel's absence is the whole assertion, so it must be able to fail: **before asserting absence, prove the hook mechanism works** by running the vendor once in a way that does load user hooks and asserting the sentinel *does* appear. Without that positive control the test passes against a hook that was never wired up correctly, which is the same unfalsifiable-assertion defect this repository has already had to fix once.

- [ ] **Step 2: Run it to verify the positive control fires and the negative fails**

Run: `npx vitest run --root tests integration/ingest/no-user-hooks.test.ts`

Expected, before Tasks 2 and 3 land: the positive control passes and the negative assertion FAILS, because the un-isolated invocation runs the hook. Record both. If the positive control does not fire, the hook is not wired correctly and nothing below is meaningful — fix that first.

- [ ] **Step 3: Confirm it passes on the isolated invocation**

With Tasks 2 and 3 in place, run it again.

Expected: PASS. If it still fails, the isolation flags do not do what Task 1 recorded, and that is a finding about the vendor, not about the test — report it rather than weakening the assertion.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/ingest/no-user-hooks.test.ts
git commit -m "test(integration): prove a planted user hook never runs during ingest"
```

---

### Task 9: Regenerate, close the rows, and gate

**Files:**
- Modify: `workflows/ingest/workflow.yaml`, only if Task 5 changed its declared read scope
- Modify: `plugins/claude/**`, `plugins/codex/**`, only by regeneration
- Modify: `docs/superpowers/BACKLOG.md`, `docs/superpowers/ORDER.md`, `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`
- Delete: this plan

**Interfaces:**
- Consumes: green Tasks 1–8.
- Produces: `ORDER.md` `NOW` = roadmap Phase 2.

- [ ] **Step 1: Decide whether the workflow's read scope changed**

`workflows/ingest/workflow.yaml:15-21` declares `read: [content/**, content/_raw/quarantine/**]`. Those scopes are validated against scopes *derived from the step vocabulary*, not passed to a vendor — the rendered skill trees contain no glob at all. So Task 5 probably does **not** change this file. Verify that: if the read scope is still what the step vocabulary derives, change nothing here and say so.

If it did change, run `npm run render:claude && npm run render:codex` from the repository root — the generator refuses any other working directory — and confirm `tests/contracts/adapters/{claude,codex}/generated.test.ts` are green.

- [ ] **Step 2: Run the full gate**

Run: `npm run check`

It is now `lint && test:bootstrap && test:suite && test:e2e && build && git diff --check` and takes hours. Run it detached so a background-command timeout cannot truncate it, and record the wall time.

- [ ] **Step 3: Request fresh-context review**

Dispatch a reviewer that authored none of Tasks 1–8, with `docs/architecture/vendor-invocation.md`, this plan, and the whole range's diff. The verdict must explicitly confirm: no vendor invocation loads user settings, hooks, MCP servers or rules; Claude receives an empty tool set and not a grant; the prompt's index excerpt is screened as untrusted data and bounded; the environment decision is justified by a recorded observation rather than by the roadmap's text; the hook harness's positive control was observed firing.

- [ ] **Step 4: Close the rows**

Remove NEW-58 and NEW-44 from `BACKLOG.md`, or rewrite each to its unclosed residual. Correct roadmap Phase 1's bullets against what was actually built — at minimum the `--max-turns` bullet (F1), the environment-allowlist bullet (F2) and the `last_agent_message` bullet (F3) — each with a dated note, since the roadmap is the document the founder sequences from. Tick Phase 1. Set `ORDER.md` `NOW` to Phase 2 and fix every count in both files.

- [ ] **Step 5: Delete this plan**

Its surviving constraints live in `docs/architecture/vendor-invocation.md` and the amended roadmap.

```bash
git rm docs/superpowers/plans/2026-09-04-developer-os-ingest-isolation.md
```

- [ ] **Step 6: Run the document gates and commit**

Run: `npx vitest run --root tests repository/citations.test.ts repository/control-bytes.test.ts && npm run lint`

```bash
git add -f docs/superpowers/BACKLOG.md docs/superpowers/ORDER.md docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md
git add docs/architecture/vendor-invocation.md
git commit -m "docs: close ingest isolation and advance to Phase 2"
```
