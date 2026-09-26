# Compatibility matrix

One row per real-vendor run of a workflow. Phase 5b (A12b) created this file with its header row;
DOS-P8 owns the rest of the matrix. A row is added only from a run that actually happened.

| Workflow | Version | Vendor | Vendor version | Date | Commit | Result | Command |
|---|---|---|---|---|---|---|---|
| brain-answer | 1.0.0 | claude | 2.1.283 | 2026-09-26 | `c319af9` | pass | `claude --plugin-dir <checkout>/plugins/claude -p Use the developer-os-brain-answer skill. question: what do the brain commands do? file-back: true --output-format stream-json --verbose --allowedTools Read Bash(developer-os:*)` |
| brain-report | 1.0.0 | claude | 2.1.283 | 2026-09-26 | `c319af9` | pass | `claude --plugin-dir <checkout>/plugins/claude -p Use the developer-os-brain-report skill. subject: tools. file-back: true --output-format stream-json --verbose --allowedTools Read Bash(developer-os:*)` |
| brain-compile | 1.0.0 | claude | 2.1.283 | 2026-09-26 | `c319af9` | pass | `claude --plugin-dir <checkout>/plugins/claude -p Use the developer-os-brain-compile skill. topic: dev --output-format stream-json --verbose --allowedTools Read Bash(developer-os:*)` |
| brain-enhance | 1.0.0 | claude | 2.1.283 | 2026-09-26 | `c319af9` | pass | `claude --plugin-dir <checkout>/plugins/claude -p Use the developer-os-brain-enhance skill. note: DEV/example-knowledge-note.md --output-format stream-json --verbose --allowedTools Read Bash(developer-os:*)` |
| brain-garden | 1.0.0 | claude | 2.1.283 | 2026-09-26 | `c319af9` | pass | `claude --plugin-dir <checkout>/plugins/claude -p Use the developer-os-brain-garden skill. limit: 1 --output-format stream-json --verbose --allowedTools Read Bash(developer-os:*)` |
