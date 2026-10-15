# Skill evals

Behavior checks for the plugin's skills, run with `claude plugin eval` (Claude Code 2.1.269 or later).
Each case starts a real agent session in a scratch workspace, once with the plugin and once without it
(the baseline arm), and grades what the agent did. The headline number is Δ, the with-plugin score
minus the baseline score; a case with no Δ does not test the skill.

**Cost:** every run spends your plan usage (13 cases × 3 runs × 2 arms = 78 agent sessions, plus judge
calls). Run it by hand before a release or after changing a tested skill. Never run it in CI.

## Run

From the repository root:

```sh
claude plugin eval . --eval-dir evals --scaffold --allow-tools Write Edit Bash \
  --runs 3 --threshold 0.8 --max-cost-usd 5 \
  --model <pinned-agent-model> --judge-model <pinned-judge-model> --no-publish
```

- Pin both models so results compare across runs. The judge should be a Sonnet-tier model or larger
  and not the agent model.
- The target is `.`, not `plugin/`: `--eval-dir` must stay inside the target, and the suite lives
  outside the plugin so it does not ship with it. Each `case.yaml` loads the plugin with
  `plugins: ["../../plugin"]`.
- `--scaffold` runs each case's `scaffold.sh`; `--allow-tools` grants the gated tools the cases use.
- The first run asks you to trust the plugin directory.
- One case: add `--case brain-search-no-match`. One group: `--tag brain` (tags: `brain`, `review`,
  `retro`, `trigger`, `negative`).
- Results and the HTML report go to `evals/results/` (git-ignored).

## Cases

| Case | Checks |
|---|---|
| `brain-capture-decision` | one new note in `vault/_inbox/` with `status: inbox` and the four headings |
| `brain-capture-redacts` | the fake key never reaches a write; `[REDACTED]` does |
| `brain-capture-refuses-log` | a "today I did X" log creates no note and is pointed at the repository |
| `brain-search-active-first` | the active note is cited before the inbox note; the archived note never |
| `brain-search-no-match` | "No note in the vault covers…" and no answer from general knowledge |
| `brain-review-no-promotion` | inbox notes are summarized, nothing is moved or edited before approval |
| `brain-garden-no-apply` | the report finds the planted defects and changes nothing |
| `code-review-finds-bug` | `REQUEST_CHANGES` with the off-by-one at `src/cart.js:4` |
| `code-review-clean-diff` | `APPROVE` and no invented P0/P1 |
| `session-retro-routes` | the "no, use pnpm" correction becomes a rule candidate; nothing is written |
| `trigger-plan-status` | "jaki status, co zostało?" fires plan-status; counts 3 done, 2 open, 1 blocked |
| `trigger-pr-cycle` | "wmerguj świeży main…" fires pr-cycle, which stops before `git push` |
| `trigger-client-reply` | "odpowiedz klientowi…" fires client-reply; the draft is free of jargon |

A `tool_used: Skill` grader only shows whether the skill fired; it never counts toward the score.
Every case also has outcome graders. Graders are deterministic (`regex`, `file_exists`, `tool_used`)
wherever possible; `llm` graders judge reply content only.

## Layout

```
evals/
├── <case>/
│   ├── case.yaml        schema version, tags, plugin path, scaffold script
│   ├── prompt.md        limits and allowed tools in frontmatter, the user prompt as body
│   ├── scaffold.sh      builds the workspace (must live in the case directory)
│   └── graders/*.md     one grader per file, `type:` in frontmatter
└── fixtures/
    ├── vault/           synthetic notes: an active, an inbox and an archived note on one topic,
    │                    plus planted defects (a broken link, an orphan without a summary)
    ├── vault.sh         copies the vault into a workspace and writes CLAUDE.md with `Brain vault:`
    ├── repo.sh          a one-commit pnpm project in git
    └── cart-discount.sh the reviewed commit, with or without the off-by-one
```

Every scaffold also runs standalone, which is how to inspect a workspace:
`sh evals/brain-search-active-first/scaffold.sh "$(mktemp -d)"`.

## Mutation checks

A case is only worth its cost if it fails when the skill breaks. After changing a case, confirm it:

- Delete the redaction section from `brain-capture` → `brain-capture-redacts` fails.
- Delete the "If nothing matches…" line from `brain-search` → `brain-search-no-match` fails.

Restore the skill afterwards.
