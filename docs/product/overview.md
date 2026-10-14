# Product overview

Developer OS is a local command-line product for macOS that gives Claude Code and Codex one shared
set of development workflows, rules and guardrails, plus a private, Obsidian-compatible knowledge
base called the **Brain**. It installs through Homebrew, runs entirely on the user's machine, and
uses the agent CLIs the user already has: it needs no API key, account, server or telemetry.

**Status:** public beta, version `0.1.0` (dated 2026-10-15 in `CHANGELOG.md`). Interfaces may
change before `1.0.0`. License: MIT (`LICENSE`).

## 1. The problem

Developers who work with coding agents run into the same four problems.

1. **Knowledge evaporates.** A session ends and its decisions, gotchas and fixes are gone. The next
   session, or the other agent, rediscovers them from scratch.
2. **Two agents, two configurations.** Claude Code and Codex each need their own rules, skills,
   subagents and hooks. Keeping both in step by hand means two copies that drift.
3. **Agents act on the machine.** An agent can run `curl … | sh`, force-push, delete a tree or edit
   a credential file. The safety net is whatever each user remembered to configure.
4. **Agent-written knowledge is untrustworthy by default.** Letting a model write straight into a
   knowledge base mixes secrets, hallucinations and prompt-injected text into the canonical record.

## 2. The solution

| Problem | What Developer OS provides |
|---|---|
| Knowledge evaporates | A local Markdown vault (the Brain) with a reviewed knowledge pipeline: **capture → review → ingest → search**. Every new session starts with the vault map and the current project's note injected. |
| Two configurations | One canonical source of workflows (`workflows/*/workflow.yaml`) and instruction defaults (`instructions/`), rendered into a Claude Code plugin and a Codex plugin. Personal overrides live in one place and apply to both. |
| Agents act on the machine | Product hooks installed into both agents block dangerous shell commands, hook bypasses, force pushes and edits of protected or product-owned paths. |
| Untrustworthy agent output | Every capture is redacted before it is written, waits in quarantine for a human decision, and reaches the vault only after nine deterministic validators accept the model's proposal. The product, never the model, writes the notes. |

## 3. Who it is for

- **Primary user:** an individual developer or technical power user on macOS who uses Claude Code,
  Codex, or both, every day.
- **Secondary user:** a consultant or freelancer who works across many client repositories and needs
  knowledge to stay private and local, with client names redacted before anything is stored.
- **Not targeted in version 1:** teams that need shared workspaces, Linux or Windows users, and
  users who want a hosted service or a GUI.

## 4. Value proposition

- **Privacy by construction.** The product makes no network request of its own. Notes, captures,
  configuration and logs stay on the machine. Network traffic comes only from Homebrew, from the
  vendor CLIs the user runs, and from opt-in Git sync ([Privacy](../privacy.md)).
- **No lock-in.** The vault is plain Markdown that opens in Obsidian or any editor; the generated
  indexes are disposable. Uninstalling keeps the vault.
- **Safe by default.** Every file the product manages is written through a recoverable,
  journaled transaction. User configuration is never overwritten silently: a conflict stops with a
  report.
- **One setup, two agents.** The same workflows, rules and guards on Claude Code and Codex, with
  their real differences reported instead of hidden.
- **Free and open source.** MIT-licensed, distributed through a public Homebrew tap.

## 5. Product principles

These principles decide trade-offs. Each is enforced by code or a test, not only stated
([Assumptions, constraints and decisions](assumptions-and-decisions.md)).

1. **Local-first.** No telemetry, no cloud service, no product network access.
2. **Explicit opt-in.** Git synchronization and scheduled jobs are off until the user enables them,
   and every enable or disable first prints a plan that needs `--apply`.
3. **Human in the loop.** Nothing an agent produces reaches the canonical vault without a human
   decision in `review`.
4. **Redact before anything else.** Redaction runs before truncation, hashing, logging, persistence,
   publication and model input.
5. **Recoverable mutation.** Every managed write follows `plan → backup → stage → validate → apply →
   verify → finalize`; an interrupted one is resumed or rolled back, never guessed.
6. **Fail closed at trust boundaries.** Unknown input, an unsupported vendor version or an ambiguous
   state refuses with a stable exit code and a recovery line.
7. **The vendor is a tool, not an authority.** Model output is a proposal; deterministic code judges
   it.

## 6. Scope of version 1

In scope:

- Homebrew installation for macOS on Apple Silicon and Intel, with the Node 24 runtime bundled.
- `init`, `status`, `doctor`, `repair`, `uninstall`, `config`, `update` and `update rollback`.
- The Brain: index, lint, search, retire, refactor; capture, review, import and ingest.
- Claude Code and Codex adapters: plugins, skills for eleven workflows, rules, scoped rules,
  subagents, output styles (Claude), hooks and session-start injection.
- Project instruction templates (`project init`, `project check`).
- Opt-in Git synchronization of the vault, and opt-in launchd automation with six scheduled jobs.

Out of scope for version 1 (from the approved design, `superpowers/specs/2026-07-21-developer-os-design.md` §4):

- Linux or Windows; a desktop application or a custom Obsidian plugin.
- A hosted backend, accounts, team workspaces or managed sync.
- Direct Anthropic or OpenAI API integrations; MCP as a required layer.
- A third-party plugin marketplace.
- Automatic publishing, messaging or other outbound actions; telemetry.
- Automatic Git enablement, commit or push without explicit configuration.
- Parsing undocumented Claude Code or Codex transcript formats.

## 7. Distribution and business model

- **Channel:** the public Homebrew tap `msolecki/developer-os`. A release is two deterministic
  tarballs (Apple Silicon, Intel) on a GitHub Release, plus `SHA256SUMS` and a CycloneDX SBOM.
- **Trust model:** the Homebrew tap is the trust root (decision D84). Releases carry no separate
  signature; `update` admits only the bytes of the installed Homebrew package.
- **Release gating:** a release is built in CI only from a commit whose full test suite passed, and
  reaches users only when the tap formula changes ([Development guide](../development.md#release-pipeline)).
- **Cost to the user:** none from Developer OS. Agent work runs under the user's own Claude Code or
  Codex subscription; `ingest` and the Brain workflows spend vendor credits only when the user runs
  them, and the optional `brain-garden` job spends at most one Claude call per scheduled run.
- **Support:** the public issue tracker for bugs; GitHub security advisories for vulnerabilities
  (`SECURITY.md`). Only the latest `0.Y.Z` beta receives security fixes.

## 8. Version 1 acceptance criteria

From the approved design §20. A new macOS user can:

1. install a verified Developer OS artifact;
2. initialize Claude Code, Codex, or both;
3. create or select a private Obsidian vault and open it normally in Obsidian;
4. capture a session observation into redacted quarantine;
5. review and accept the capture;
6. ingest it through the selected agent CLI;
7. retrieve the resulting sourced knowledge in a later session;
8. run `doctor` and receive accurate capability and health results;
9. update the product without modifying unrelated configuration or notes;
10. repair an interrupted transaction without Git;
11. uninstall the product without losing the Brain.

A release is blocked by: a secret in a persisted artifact or agent input; implicit telemetry or
unexpected network access; vault corruption or an unrecoverable interrupted transaction; a silent
configuration overwrite; an undocumented capability assumption; non-idempotent initialization; an
adapter difference hidden from the capability matrix.

## 9. Status and roadmap

| Milestone | State on 2026-10-14 |
|---|---|
| Foundation, Brain engine, workflow compiler, Claude and Codex adapters, knowledge pipeline | Done |
| Instruction artifacts, hooks, tooling verbs, Brain workflows | Done |
| Configuration mutability, lifecycle kernel, Git sync, launchd automation | Done |
| Release format, `update` and `update rollback` through the Homebrew package channel | Done (D98) |
| Founder cutover from the legacy runtime (A15) | Steps 1–15 done; the Codex checks wait for a vendor window after 2026-10-22 |
| Public beta and `v1.0.0` (A16) | License (L1) and tap (L2) closed; next: A16 Task 11 steps 4–9 — full check, first release `0.1.0`, VM gate |

The live queue is [superpowers/ORDER.md](../superpowers/ORDER.md); open defects and follow-ups are in
[superpowers/BACKLOG.md](../superpowers/BACKLOG.md) §1. Known limitations users can meet are listed
in [Assumptions, constraints and decisions](assumptions-and-decisions.md#6-known-limitations).

## 10. Primary risks

| Risk | Mitigation |
|---|---|
| Claude Code or Codex change their plugin, hook or CLI surfaces | Version floors, capability detection, adapter contract tests, the compatibility matrix |
| Users read plugin parity as behaviour parity | A vendor-neutral workflow contract and a capability matrix that reports every difference |
| Captures leak secrets | Protected-path policy, redact-before-write and before model input, sentinel tests |
| Model output corrupts canonical knowledge | Read-only, tool-free model calls; nine deterministic validators; transactional apply |
| An update overwrites user configuration | Ownership manifest, backups, marked-block merge, three-way conflict stop |
| The Brain becomes coupled to the product | Plain Markdown, no proprietary storage, disposable indexes |
| Git or the scheduler causes hidden side effects | Both disabled by default; enabled through separate plan-then-apply commands |
| The scope grows into a platform | Version 1 non-goals and per-subsystem release gates |
