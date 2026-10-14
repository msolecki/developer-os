# Developer OS documentation

This is the map of every document in `docs/`. Start with the row for your role; each document says
what it owns and links to the canonical contract instead of restating it.

## Start here

| You want to | Read |
|---|---|
| Understand what the product is, who it is for and why it exists | [Product overview](product/overview.md) |
| Know exactly what the product does, command by command | [Functional specification](product/functional-spec.md) |
| Know the assumptions, constraints and decisions behind it | [Assumptions, constraints and decisions](product/assumptions-and-decisions.md) |
| Install, upgrade, roll back or uninstall | [Install and upgrade](install/README.md) |
| Learn the daily loop with your agent | Tutorials: [Claude only](tutorials/claude-only.md), [Codex only](tutorials/codex-only.md), [both agents](tutorials/dual-agent.md) |
| Fix a failing command | [Troubleshooting](troubleshooting/README.md) |
| Look up a command, option or exit code | [CLI reference](reference/cli.md) |
| Look up a configuration key, environment variable or on-disk path | [Configuration and file layout](reference/configuration.md) |
| Write or read notes and captures | [Brain vault format](reference/brain-format.md) |
| See what the product installs into Claude Code and Codex | [Agent integration](reference/agent-integration.md) |
| Understand how the system is built | [Architecture overview](architecture/overview.md) |
| Build, test or release the product | [Development guide](development.md) |
| Decode an identifier such as `D84`, `NEW-134` or `A16` | [Glossary](glossary.md) |
| Know what data leaves the machine | [Privacy](privacy.md) |

## Document classes

The repository keeps four kinds of documents. They age differently, so read each kind for what it is.

| Class | Where | Status |
|---|---|---|
| **Guides and references** | `README.md`, `docs/README.md`, `docs/product/`, `docs/reference/`, `docs/install/`, `docs/tutorials/`, `docs/troubleshooting/`, `docs/privacy.md`, `docs/development.md`, `docs/glossary.md`, `docs/architecture/overview.md` | Describe the current behaviour. They summarise and link; when one disagrees with an architecture note or the code, the note and the code win. |
| **Canonical architecture notes** | `docs/architecture/*.md` | The normative contract of each subsystem, with code citations. A behaviour change updates the owning note in the same commit. |
| **Dated records** | `docs/releases/foundation-checkpoint.md`, `docs/releases/compatibility-matrix.md`, `docs/migration/` | Snapshots of evidence or of a frozen input. They are not kept current on purpose, so they stay traceable. |
| **Process records** | `docs/superpowers/` | How the product is built: the work queue, the backlog, founder decisions, active specs and plans. |

## Canonical architecture notes

| Subsystem | Note |
|---|---|
| Install, uninstall, transactions, manifest, drift, lifecycle kernel, release/update/rollback, instruction artifacts, project templates | [foundation.md](architecture/foundation.md) and its verbatim task constraints [foundation-constraints.md](architecture/foundation-constraints.md) |
| The Brain engine: schema, discovery, indexes, lint, retrieval, refactor, gardener | [brain.md](architecture/brain.md) |
| Capture, review, import, ingest | [knowledge-pipeline.md](architecture/knowledge-pipeline.md) |
| Workflow contracts and their compiler | [workflow-schema.md](architecture/workflow-schema.md) |
| The Claude Code adapter | [claude-adapter.md](architecture/claude-adapter.md) |
| The Codex adapter | [codex-adapter.md](architecture/codex-adapter.md) |
| What the vendor binaries actually accept | [vendor-invocation.md](architecture/vendor-invocation.md) |
| Hooks and guards | [hooks.md](architecture/hooks.md) |
| Trust boundaries and the mechanism enforcing each | [threat-model.md](architecture/threat-model.md) |

## Dated records

| Record | Holds |
|---|---|
| [releases/foundation-checkpoint.md](releases/foundation-checkpoint.md) | Evidence that the Foundation gate passed (2026-08-01 layout) |
| [releases/compatibility-matrix.md](releases/compatibility-matrix.md) | One row per real-vendor run of a workflow |
| [migration/exclusion-policy.md](migration/exclusion-policy.md) | What may never be published, and the clean-room procedure |
| [migration/instruction-inventory.md](migration/instruction-inventory.md) | The frozen inventory of the legacy instructions, hooks and scripts the product replaced |
| [migration/founder-cutover.md](migration/founder-cutover.md) | The one-time runbook that moved the founder's machine onto the product |
| [migration/source-manifest.json](migration/source-manifest.json), [migration/baseline-capabilities.json](migration/baseline-capabilities.json) | The frozen, redacted inputs of the clean-room build |

## Process records

| Record | Holds |
|---|---|
| [superpowers/SESSION.md](superpowers/SESSION.md) | The session protocol every build session follows |
| [superpowers/ORDER.md](superpowers/ORDER.md) | The work queue; its `NOW` entry is the only product entry to advance |
| [superpowers/BACKLOG.md](superpowers/BACKLOG.md) | Open `NEW-*` rows, gates and the active contract index |
| [superpowers/DECISIONS.md](superpowers/DECISIONS.md) | Founder decisions D1 onward |
| `superpowers/specs/`, `superpowers/plans/` | Specs and plans that are still active; a finished one is deleted once its surviving contract has moved into an architecture note |

## Rules for changing documentation

- A behaviour change updates the owning architecture note and any guide or reference that states the
  changed fact, in the same commit.
- Cite code as `path — identifier`, not `path:line`: a line number drifts silently.
- State a fact once and link to it. A copied list drifts with every change.
- Describe present behaviour. History belongs to git, `CHANGELOG.md` and `DECISIONS.md`.
- Never put private vault content, a credential, a client name or a machine-specific absolute path in
  a document. `npm run lint` enforces part of this ([Development guide](development.md#repository-rules)).
