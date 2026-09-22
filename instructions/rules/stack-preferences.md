# Stack preferences

- Use the package manager the repository's lockfile declares; never mix managers in one repository.
- Follow the project's existing UI, backend, and database stack; introduce a new framework or service only with an explicit decision.
- In TypeScript projects, keep `strict` mode enabled; use the project's existing test runner.

To record your own defaults (a preferred package manager, UI kit, backend, or test runner), replace this rule with an override at `~/.developer-os/instructions/<vendor>/rules/stack-preferences.md`. That file is the single source of stack preferences.

## Shared conventions

Stack-specific conventions ship as scoped rules (`typescript`, `nextjs`) and load only for matching files.
