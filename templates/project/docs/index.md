---
status: current
owner: <name or team>
last-verified: YYYY-MM-DD
---

# <Project name> — documentation index

<!-- Start here. Each row routes a task to the one document to read first. Keep the table
     to the tasks people and agents actually do; delete rows that do not apply.
     Every doc under docs/ carries the frontmatter above: status (current, draft, or
     deprecated), owner, and last-verified (the date someone checked it against the code).
     Technical docs are in English; client-facing docs may use the client's language.
     Plans are dated and git-ignored (docs/plans/YYYY-MM-DD-task.md), not listed here. -->

| Task | Read first |
|---|---|
| Understand what works today and what is in progress | [CURRENT-STATE.md](CURRENT-STATE.md) |
| A setting or pattern looks wrong | [pitfalls.md](pitfalls.md) |
| Why something was decided | [decisions/](decisions/) |
| Deploy, roll back, or fix an incident | [runbooks/](runbooks/) |
| <Work on area X> | `<NN-area>/README.md` |

## Areas

<!-- One numbered folder per area of the system (`01-auth/`, `02-billing/`), each with a
     README.md that links its code entry points as path:line. -->
