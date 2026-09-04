# Legacy instruction, hook, and tooling inventory

Frozen on 2026-09-04 from the founder's legacy runtime (`shared-runtime` and `private-brain` in
`source-manifest.json`). This is the scope statement for `ORDER.md` entries A12 (instruction
artifacts), A13 (hooks), A14 (tooling verbs) and A12b (Brain workflows); before this file existed,
the numbers "38 artifacts", "13 hooks" and "nine scripts" in `BACKLOG.md` were not enumerated
anywhere in this repository. Names are artifact identifiers only; no artifact content, machine path,
or client reference is reproduced here. The founder decided on 2026-09-04 that every item below
becomes part of Developer OS as a public, redacted default, with personal overrides living in the
product home as user data; no parallel private repository survives the cutover.

Status column: **shipped** (works in the product today), **partial** (an equivalent with a narrower
scope or different mechanism), **planned** (an `ORDER.md` entry owns it), **declined** (ratified
product decision, with the owning note), **refused** (out of product scope, recorded here so the
absence is a decision).

## 1. Global rules — 8 files (A12)

| Artifact | Legacy mechanism | Product target | Status |
|---|---|---|---|
| `rules/communication.md` | `@import` from the user's global `CLAUDE.md` | managed `instruction` artifact; one product-owned import block in the user's global `CLAUDE.md`; concatenated into `~/.codex/AGENTS.md` for Codex | planned A12 |
| `rules/workflow.md` | same | same; client references redacted before publication | planned A12 |
| `rules/security.md` | same | same | planned A12 |
| `knowledge/stack-preferences.md` | same | same | planned A12 |
| `rules-lazy/typescript.md` | path-scoped rule (`paths:` frontmatter) symlinked into `~/.claude/rules/` | copied managed file in `~/.claude/rules/`; Codex has no path-scoped rules → emulated inside `AGENTS.md` with an "applies to paths" header, reported as `unsupported-vendor: emulated` | planned A12 |
| `rules-lazy/nextjs.md` | same | same | planned A12 |
| `rules-lazy/error-handling.md` | same (not linked on the legacy machine) | same | planned A12 |
| `rules-lazy/monitoring.md` | same (not linked on the legacy machine) | same | planned A12 |

## 2. Output styles — 4 files (A12)

`architect`, `debug`, `direct-objective`, `tdd-enforcer`. Claude Code: managed files in
`~/.claude/output-styles/`. Codex has no output styles → `unsupported-vendor`.

## 3. Plugin `solkova-core` — 32 artifacts (A12)

| Group | Count | Names | Product target |
|---|---|---|---|
| Commands | 8 | `analizer`, `fix-pr`, `implementator`, `przeglad-claudemd`, `release`, `rev-eng`, `spec`, `wrap-up` | Claude: `commands/` in the product's skills-dir plugin. Codex has no commands → each becomes a skill. Every command has a duplicate skill of the same name in the legacy tree; the product ships one skill plus a thin command, not both texts. |
| Subagents | 5 | `code-reviewer`, `performance-engineer`, `qa-expert`, `research-analyst`, `security-auditor` | Claude: `agents/` in the plugin. Codex: generated `~/.codex/agents/<name>.toml` (the legacy generator was deleted on 2026-07-27; regenerate from the Markdown source). |
| Skills | 19 | `analizer`, `brain-search`, `bug-triage`, `claudeception`, `client-onboarding`, `code-review`, `deploy-checklist`, `fix-pr`, `implementator`, `nextjs-removeconsole-computed-access-survives`, `przeglad-claudemd`, `react-best-practices`, `recovering-killed-claude-workflow-results`, `release`, `rev-eng`, `spec`, `url-construction-silent-footguns`, `weekly-report`, `wrap-up` | Both vendors: skills beside the six product workflows. `brain-search` is **partial** today (the product's `developer-os-brain-search` calls the CLI instead of reading index files). `react-best-practices` is vendored third-party content with its own license file; keep the attribution. |

Vendor instruction files (2): the user's global `CLAUDE.md` import block and `~/.codex/AGENTS.md`.
The product currently writes neither (`docs/architecture/codex-adapter.md` §2 forbids
`AGENTS.override.md`; that refusal stands). Together with §1–§3 this is the "38 instruction
artifacts" of A12: 8 rules + 4 styles + 8 commands + 5 subagents + 19 skills = 44 files, of which
the 8 command/skill pairs collapse to 8, giving 36, plus the 2 vendor instruction files.

## 4. Hooks — 13 scripts (A13)

| Hook | Vendor event | Product target | Status |
|---|---|---|---|
| `knowledge-inject` | `SessionStart` / `session_start` | `developer-os brain status --inject --cwd <dir>`: vault map plus the matching project note; recursion guard through an environment variable | planned A13 (founder decision 2026-09-04 restores `session_start_injection`, which DOS-P6 had marked `not-used`) |
| `bash-danger-guard` | `PreToolUse(Bash)` / `pre_tool_use` | `developer-os guard command` over `packages/security` normalization; exit 2 plus stderr | planned A13 |
| `secret-file-guard` | `PreToolUse(Edit\|Write)` / `pre_tool_use` | `developer-os guard path` over `packages/security/src/protected-paths.ts` | planned A13 |
| `commit-guard` | `PreToolUse(Bash)` | `developer-os guard commit` | planned A13 |
| `stop-gate` | `Stop` / `stop` | `developer-os guard stop` (local `tsc` only; honours a `tsconfig.check.json` beside a package `tsconfig.json`) | planned A13 |
| `format-smart` | `PostToolUse` / `post_tool_use` | `developer-os guard format` (configured project formatter only, no network install) | planned A13 |
| `skill-activator` | `UserPromptSubmit` / `user_prompt_submit` | `developer-os guard prompt` reading a project-local `skill-rules.json` | planned A13 |
| `shared-file-warn` | `PostToolUse` | `developer-os guard edit` | planned A13 |
| `instructions-check` | `InstructionsLoaded` | absorbed by `doctor` (drift of managed instruction artifacts) | planned A13 |
| `dippy-guard` | `PreToolUse(Bash)` | third-party tool; `doctor` detects and reports it as `external` | refused |
| `md-file-guard` | `PreToolUse(Write)` | retired in the legacy runtime on 2026-07-27 | refused |
| `knowledge-capture` | `SessionEnd` | requires `transcript_path`; replaced by agent-authored `developer-os capture` | declined (`docs/architecture/knowledge-pipeline.md` §2) |
| `precompact-backup` | `PreCompact` | requires `transcript_path` | declined (same) |

Inline hooks configured in the legacy settings file rather than as scripts (third-party
`claudekit-hooks` runs, an audit-log appender, desktop notifications, terminal-multiplexer
notifiers) are **refused**: they are the user's own tooling, and `doctor` reports them as
`external` so their presence beside product hooks is visible.

Vendor facts that bound A13, observed on 2026-09-04 against Claude Code 2.1.260 and Codex CLI
0.151.0 (`docs/architecture/claude-adapter.md` and `codex-adapter.md` carry the dated sections):
Codex requires a per-hook trust hash in its own config file, which the product never writes, so a
product-installed Codex hook runs only after the user approves it interactively (founder decision
2026-09-04: accept manual trust; `doctor` reports `plugin_hooks=unknown` until then). Codex has no
session-end event, so `sessionEndCapture` parity is impossible on that vendor.

## 5. Automation scripts — 14 scripts plus 2 libraries (A14)

| Script | Legacy purpose | Product target | Status |
|---|---|---|---|
| `brain-weekly` | weekly launchd job: distill → ingest → reindex → lint → proposals → drift → tests → commit → push → health sentinel | the Spec 1 automation job registry: `import`, `ingest`, `brain reindex`, `brain lint`, `doctor`, `git sync` | planned A11 (Spec 1b) + A14 |
| `distill-memory` | Claude Code auto-memory files → inbox | `developer-os import --claude-memory` (content hash as cursor) | planned A14 |
| `distill-transcripts` | transcript backups → inbox | transcript-dependent | declined |
| `check-config-drift` | template ↔ live vendor settings drift report | `doctor` check `vendor-config` (structural, value-free) | planned A14 |
| `check-plugin-version` | manifest version consistency | Spec 2 release metadata | planned A11 |
| `check-templates` | project instruction-file hygiene across the user's repositories | `developer-os project check` | planned A14 |
| `worktree` | worktree plus ignored-env copy plus install | `developer-os project worktree` | planned A14 |
| `check_english` | repository language gate | repository gate, not a product verb | refused |
| `git-history-secrets` | historical secret scan across the user's repositories | `developer-os repo secrets-scan` (opt-in, reports path and line only) | planned A14 |
| `repo-audit`, `repo-audit-weekly`, `repo-bootstrap`, `lib/repo-baseline` | GitHub repository-settings baseline through `gh` | `developer-os repo audit\|bootstrap` (opt-in, requires an authenticated `gh`); the baseline itself is user data in the product home | planned A14 |
| `bootstrap`, `shared-sync` | machine bootstrap and daily sync of the legacy repository | replaced by `init` and `update` | shipped / planned A11 |
| `lib/redact` | secret redaction | `packages/security/src/redaction.ts` | shipped |

## 6. Templates — 17 files

| Template | Product target | Status |
|---|---|---|
| global instruction file (5 import lines) | A12 vendor instruction block | planned A12 |
| project instruction file, project context signpost, project settings | `developer-os project init` | planned A14 |
| global vendor settings (permissions allow/deny/ask, sandbox credential denies, environment) | not managed: the product never writes the vendor settings file; `doctor` warns when the deny list or guards from the product's reference template are absent | refused (reporting only) |
| `dev-docs` set (4) | retired planning system | refused |
| headless loop and fan-out scripts, GitHub workflow templates, feature-list template (6) | outside product scope | refused |
| Ralph pilot documents (2) | outside product scope | refused |

## 7. Brain vault workflows — 18 skills (A12b)

| Legacy skill | Product target | Status |
|---|---|---|
| `reindex` | `developer-os brain reindex` | shipped (index artifacts differ: `graph.json` and `index.json` replace `graph.md`) |
| `lint` | `developer-os brain lint` | shipped (schema differs; no per-type `schema.yml`) |
| `ingest` (inbox files, YouTube) | `developer-os ingest` from quarantine only | partial; inbox files need `developer-os import` (A14); YouTube refused |
| `qa` (`--file-back`) | workflow `brain-answer` | planned A12b |
| `compile` | workflow `brain-compile` | planned A12b |
| `enhance` | workflow `brain-enhance` | planned A12b |
| `curate`, `gaps`, lint classes for staleness | `brain lint` classes `stale`, `isolated`, `dead-link`, `duplicate`, `gap`; verb `brain retire` | planned A12b |
| `garden` | workflow `brain-garden` (proposals as captures, never direct writes) | planned A12b |
| `refactor` | verb `brain refactor --rename\|--move\|--merge\|--split` | planned A12b |
| `output` | workflow `brain-report` | planned A12b |
| `onboard` | `init` template | shipped (no interview) |
| `research`, `research-deep`, `research-add-fields`, `research-add-items`, `research-report`, `excalidraw-diagram` | skills in A12, not Brain workflows | planned A12 |

Vault-level instruction files (`AGENTS.md`, `CLAUDE.md`, `WRITING_STYLE.md`) and the vault's own
`SessionStart` hook are replaced by the concatenated workflow preamble, the A13 injection hook, and
a writing-style section in the product's note template.

## 8. Legacy vault schema, for the one-off migration (A15)

The founder's vault does not validate against the product schema
(`packages/brain/src/schema/note.ts`): measured on a copy on 2026-09-04, zero of thirty notes load,
two topic folders are unclassified, and forty-five frontmatter errors are reported. Founder decision
2026-09-04: the notes are migrated once, by hand with a throwaway script reviewed in a diff, not by
a product migrator; `BRAIN_MIGRATIONS` stays empty. The mapping the cutover runbook applies:

| Legacy | Product |
|---|---|
| `date` | `created` (and `updated` when a later review date exists) |
| `agent-created: true` | `author: agent`; otherwise `author: human` |
| `agent-reviewed: <date>` | `reviewed: <date>`; absent → `reviewed: null` |
| `confidence`, `frequency` | `occurrences` = `frequency` (minimum 1); `confidence` dropped |
| `stage: growing` | `established` when `frequency >= 3`, otherwise `emerging` |
| types `tool`, `book-note` | `reference-note` |
| types `answer-note`, `basic-note` | `knowledge-note` |
| `enableToc`, `openToc`, `source`, `repo` | dropped (`repo` returns as a tag `repo:<slug>` so project matching survives) |
| folders `PROJEKTY`, `NARZEDZIA` | `topicAliases` → `PROJECTS`, `TOOLS`; directories are not renamed |
| wikilinks to `_indexes/graph` | rewritten to the `catalog` note |

Inbox files accumulated in the legacy vault are imported through `developer-os import` (A14) into
quarantine, then reviewed and ingested in batches.
