---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.py"
  - "**/*.sh"
---
# Comments — last resort only

- Write no comment by default. Clear names, small functions and precise types are the documentation. Before writing one, rename the thing or extract a function; that removes the need almost every time. This applies to tests too — a well-named test needs no narration above it.
- Never restate what the next line does, never repeat the function name in a header, never explain the change itself: that belongs in the commit message or the PR description, not in the file.
- A comment earns its place only when the reader cannot recover it from the code at all: a past bug with its date/ticket, a directive (`eslint-disable`, `@ts-expect-error`, `biome-ignore`), or a genuinely non-obvious mechanical fact about a library or platform. One line, not a paragraph.
- Explaining WHY in prose is not a licence to comment. Reserve it for a rejected alternative someone would otherwise "fix" back. If the explanation needs more than a line, it belongs in the project's `CLAUDE.md`/`AGENTS.md` or `docs/`, not next to the code.
- A deploy-ordering or migration-ordering constraint written in `CLAUDE.md`, `AGENTS.md` or `docs/` carries its reason at the read site. "Run X before Y" without the why gets skipped under time pressure, and a why that lives in another file is not discoverable: list the exact migrations that must run before the deploy, and say why.
- When you change code, update or delete the comment attached to it in the same edit. Leave a project's existing comments alone unless asked — they are often load-bearing; this rule governs only the comments you add.
