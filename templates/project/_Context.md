# <Project name> — context

<!-- A project navigation INDEX. It tells the agent what to read first and what to ignore
     before touching code. Keep it at 25 lines or fewer: it is a signpost, not
     documentation. Do not repeat the instruction files (AGENTS.md, CLAUDE.md). Keep only
     "where to look," hard boundaries, and current state. -->

**Purpose:** <One or two sentences: what it does, for whom, stack, domain, and UI language when relevant.>

**Read first:**
- The instruction file (<exact section, for example Key Business Rules>)
- <path to the core, glossary, or key module>

**Ignore:** <dependency directories, build output, backups, and unrelated deployment directories; include a reason when non-obvious>

**Hard rules:** <invariants whose violation breaks the project, such as server-side pricing,
a platform-free core, or the validation command required before a commit. Mark deliberate
deferrals as "X is a deliberate DEFER, not a missing feature.">

**State as of <YYYY-MM-DD>:** <active, maintenance, or frozen; last real work; open items>

<!-- FRESHNESS RULE: update "State as of" after every material session. A stale signpost
     is worse than no signpost. -->
