---
name: project-init
description: Adopt developer-os in a repository in one pass — detect the stack, pick the skills that apply, run project-baseline, docs-sync and instruction-review, audit the code against each applicable conventions skill, then give one report and one approval; for a code audit alone, audit-to-backlog. Use when starting with developer-os in a repository, for example "init developer-os here", "check the whole project", "set the repo up for developer-os".
license: MIT
compatibility: "Claude Code"
---

# Project init

An orchestrator: it runs other skills up to their reports, reads the project's own conventions, adds a conventions audit, and merges everything into one numbered list. Read-only until the user approves. Each skill it runs keeps its own steps and its own `## Never` rules.

## 1. Context

- Detect the stack from the manifests and config on disk: the lockfile-selected package manager, the language manifests (`package.json` and `tsconfig.json`, `pyproject.toml`, `go.mod`, `composer.json`), `next.config.*`, the test runner and test files, CI workflows, infrastructure code (CDK, Terraform, serverless config), API routes or handlers, a database and its migrations, a UI.
- Find the backlog paths exactly as `developer-os:project-baseline` does. When no `Backlog:` line exists and the default files are absent, the paths are a "needs your decision" item (default `TODO.md`, `TODO-done.md`, warning when `git check-ignore` matches one), and the `Backlog:` line becomes a numbered item, merged with any instruction-file diff to the same file or, when neither `AGENTS.md` nor `CLAUDE.md` exists, with the docs-sync item that creates `AGENTS.md`, so one item creates it. Read the project's `AGENTS.md`/`CLAUDE.md`, `docs/pitfalls.md` and decision records: a practice or convention the project rejected on purpose is reported as `deliberate`, never proposed.
- Read `git rev-parse --short HEAD`.

## 2. Pick the skills

| Skill | Applies when | Otherwise |
|---|---|---|
| `developer-os:project-baseline` | always | — |
| `developer-os:docs-sync` | always | — |
| `developer-os:instruction-review` | a `CLAUDE.md` or `AGENTS.md` exists | skip; docs-sync lists the missing `AGENTS.md` |
| `developer-os:typescript-conventions` | `tsconfig.json` or `*.ts` files in app code | not applicable |
| `developer-os:nextjs-conventions` | `next.config.*` or a `next` dependency | not applicable |
| `developer-os:testing-conventions` | test files exist | not applicable; baseline covers the missing tests |
| `developer-os:error-handling-conventions` | server or library code in any language: API routes or handlers, services, jobs, a CLI | not applicable |
| `developer-os:monitoring-conventions` | infrastructure code, CI workflows, alert definitions or health endpoints | not applicable |
| `developer-os:defensive-coding-conventions` | code that handles external input, authentication, money, concurrency, persistence or error paths: webhooks, event handlers, migrations, billing inputs, hook scripts | not applicable |
| `developer-os:comments-conventions` | never audited | it governs only comments an agent adds and leaves existing ones alone |
| `developer-os:deploy-checklist` | never run here | it runs the project's gates and belongs to a release; recommend it before the next deploy |

## 3. Run the process skills

Run project-baseline, then docs-sync, then instruction-review (when it applies), each up to its report and no further: do not ask their questions one by one, collect their numbered items and their "needs your decision" items. Baseline items keep the `BASE` prefix. Baseline's package-manager `outdated` probe is allowed only where it reads the registry and runs no repository code: `bundle outdated` evaluates the `Gemfile`, and any `yarn` command runs the file a `.yarnrc*` names in `yarnPath`/`yarn-path`, so ask before either. Its "Plan the upgrades with `developer-os:dependency-upgrader` first?" question becomes one numbered item.

## 4. Discover the project's conventions

Read what the repository already does before measuring it against any skill, running nothing: the linter and formatter config (`eslint.config.*`, `.prettierrc*`, `[tool.ruff]` in `pyproject.toml`, `.golangci.yml`, `phpcs.xml`, `.editorconfig`), the test config and the test layout (where tests live, how files and cases are named, which fixtures and mocks they use), and three representative modules: the most recently changed, the largest, and the one the tests import most.

Write each rule the code follows consistently (naming, module layout, error style, test style) as one line with the `file:line` it came from. A rule seen once, or contradicted elsewhere, is a question, not a rule; a habit that breaks a conventions skill (errors swallowed everywhere) is a step 5 finding, never a convention. Propose the rules as one numbered item, "create `docs/reference/conventions.md`", with the rules listed under it: the file gets the docs frontmatter (`status`, `owner`, `last-verified`) and one `## <Area>` section per area, each rule as `- <rule> (<file:line>)`. When the file exists, the item lists only the rules it lacks and the lines the code no longer follows.

A convention the project already documents (that file, `AGENTS.md`, a decision record) wins over a skill rule in step 5: report the difference as `deliberate`.

## 5. Audit the conventions

Load each applicable conventions skill and probe the repository for each of its rules; `developer-os:error-handling-conventions` and `developer-os:testing-conventions` keep per-language examples and probes in `references/<lang>.md` beside their `SKILL.md`. Use a mechanical probe where one exists and record it as the evidence, for example:

| Skill | Probe |
|---|---|
| typescript | `"strict": true` in `tsconfig.json`; a configured import alias, and `rg -n "from ['\"](\.\./){3,}"` for deep relative imports |
| nextjs | route handlers and Server Actions that read input without a schema parse; `'use client'` files with no state or event handler |
| error-handling, TypeScript | empty `catch {}` with no comment inside it; `throw new Error(` inside a `catch` without `cause`; `.stack` or raw errors in API responses; more than one error-response shape |
| testing, TypeScript | date fixtures without an offset or `Z`; `vi.mock`/`jest.mock` factories that do not spread the original module; raised `retries` or timeouts in test config |
| error-handling and testing, Python | a bare `except:` or an `except` whose body is `pass`; `raise` inside `except` without `from`; `traceback.format_exc()` in a response; naive `datetime(...)` fixtures; `MagicMock()` standing in for a whole module; `--reruns` or `flaky` markers |
| error-handling and testing, Go | `_ =` discarding an error; an empty `if err != nil {}`; `fmt.Errorf` with `%v` where the cause is needed; `err.Error()` written to a response; `time.Now()` or `time.Sleep` in `*_test.go` |
| error-handling and testing, PHP | an empty `catch (...) {}` or the `@` operator; `throw new` inside `catch` without the previous exception; `getTraceAsString()` in a response; `new DateTime('...')` fixtures without an offset; `sleep()` in tests |
| monitoring | a `/health` handler that queries the database; paging alerts without a runbook link |
| defensive-coding | webhook or event handlers with several side effects and no per-effect try/catch; hook scripts that grep a command without joining its lines |

A rule that needs judgment (function size, composition) is sampled, not swept: report only concrete `file:line` cases, at most five per rule, with the total count when it is higher. Unsure counts as a question, not a finding. Verify findings as in `developer-os:audit-to-backlog` Verify blocking findings; leave refuted ones out and list them under Disputed. Rate each finding on the `developer-os:code-review` scale and draft it as a backlog item in the audit-to-backlog format under the ID prefix `CONV`, continuing the numbering in both backlog files and deduplicated against them and the baseline items. A `Check` is a command that fails while the violation is there.

## 6. Report and ask

```
Project init — <repo> at <short sha>
Stack: TypeScript, Next.js 15, Vitest, GitHub Actions, Postgres (Prisma)
Applies: project-baseline, docs-sync, instruction-review, typescript, nextjs, testing, error-handling, defensive-coding
Not applicable: monitoring-conventions (no infrastructure code)   Not run: deploy-checklist (run it before the next release)
Baseline: missing 4   Docs: missing 3, drift 5   Instructions: 2 proposals   Conventions: 6 findings
Needs your decision: test runner — package.json has both jest and vitest

1. [baseline] BASE-01 · P2 · Secret scanning in CI
2. [docs] drift — AGENTS.md:24 says `npm run test:e2e`; package.json has no such script
3. [instructions] AGENTS.md: replace line 22 "Use pnpm." with "Use pnpm (pnpm-lock.yaml)."
4. [conventions] CONV-01 · P2 · Empty catch in src/webhooks/deliver.ts:40
5. [conventions] create docs/reference/conventions.md — 6 observed rules (naming: src/cart/total.ts:3; tests: src/cart/total.test.ts:1; …)
...
Apply which? A: all (recommended)  B: list numbers  C: none
```

## Stop point

Stop after the report and the question. After approval, apply exactly the approved items the way the owning skill applies them: backlog items as project-baseline merges them (`Session N:` lines for the `BASE` and `CONV` items, grouped as audit-to-backlog groups them), doc edits as docs-sync applies them, `docs/reference/conventions.md` with the approved rules and today's `last-verified`, the instruction diff as instruction-review applies it. Show `git diff --stat` and stop; fixing the findings is `developer-os:implement-backlog`'s job, and the user commits.

## Never

- Write, create, or delete any file before the user approves the numbered items.
- Change application code, tests, configuration or existing comments; findings only become backlog items.
- Run the project's scripts, tests or builds, or an `outdated` probe that runs repository code without a yes, install dependencies, or run deploy-checklist.
- Pick a default for a "needs your decision" item, or propose something the project rejected on purpose.
- Commit, push, or open a pull request.
