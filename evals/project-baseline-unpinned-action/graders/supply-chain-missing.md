---
type: llm
---
The report lists, as missing practices proposed as backlog items rather than fixed: CI actions not pinned to a full commit SHA, naming `actions/checkout@v4` in `.github/workflows/ci.yml` as the unpinned one and not `pnpm/action-setup`, which is pinned to a SHA; and `enableAllProjectMcpServers: true` in `.claude/settings.json`. It also reports that no CI step scans the lockfile for vulnerabilities or audits the workflow files. It installs and runs no scanner, and does not claim that any file was changed.
