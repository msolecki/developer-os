# Configuration and file layout

Where Developer OS keeps its state, which settings exist, and which environment variables it reads.
The schema is `packages/core/src/config/types.ts` — `DeveloperOsConfigV1`; validation is
`packages/core/src/config/loader.ts`; the key lists are `packages/core/src/config/keys.ts` —
`CONFIG_READABLE_KEYS`, `CONFIG_MUTABLE_KEYS`.

## 1. Environment variables

| Variable | Read by | Meaning |
|---|---|---|
| `HOME` | launcher, CLI | Required; must be a canonical absolute path. |
| `DEVELOPER_OS_HOME` | launcher, CLI | Product home. Default `~/.developer-os`. |
| `DEVELOPER_OS_BRAIN` | launcher, CLI | Brain vault. Default: the configured `brainPath`, else `~/DeveloperBrain`. |
| `CODEX_HOME` | launcher, CLI | Codex home, when not the default `~/.codex`. |
| `CLAUDE_CONFIG_DIR` | launcher, CLI | Passed on when set; commands that would read the Claude home (for example `import --claude-memory`) refuse rather than follow it. |
| `DEVELOPER_OS_VENDOR_SEARCH_PATH` | CLI | Set by the launcher from the caller's `PATH` (at most 32 KiB) and used only to discover the agent CLIs. |

The launcher passes the CLI a closed environment: the variables above and nothing else. Every path
override must be a non-empty canonical absolute path, or the launcher refuses with exit 2. The
product home and the vault must be disjoint after symlink resolution: neither may contain the other,
and they may not be the same directory.

## 2. `config.toml`

Location: `<product-home>/config.toml`. It is a managed artifact: a hand edit is drift, so change it
with `developer-os config set`. Unknown keys are refused.

| Key | Type | Default | Mutable with `config set` | Meaning |
|---|---|---|---|---|
| `schemaVersion` | `1` | `1` | no | Configuration schema version. |
| `brainPath` | absolute path | resolved at `init` | yes | The Brain vault. |
| `adapters.claude` | boolean | from `init --adapters` | yes | Claude Code selected. |
| `adapters.codex` | boolean | from `init --adapters` | yes | Codex selected. |
| `brain` | table | built-in defaults | yes | The whole vault section; optional. |
| `brain.schemaVersion` | `1` | `1` | no | |
| `brain.contentRoot` | path segment | `content` | yes | Folder under the vault that holds notes. |
| `brain.topicFolders` | array of segments, 1–256, unique | `["PROJECTS", "TOOLS", "DEV", "INFRA", "QA"]` | yes | Folders whose notes are canonical. |
| `brain.topicAliases` | table, ≤ 256 entries | `{}` | yes | Alternative folder names mapped to a topic folder (for example a legacy name in another language). |
| `brain.indexesDir` | path segment | `_indexes` | yes | Folder under the content root for generated indexes. |
| `brain.retrieval.maxCandidates` | integer 1–1000 | `10` | yes | Default search limit. |
| `brain.staleness.reviewAfterDays` | integer 1–3650 | `180` | yes | Age after which `brain lint` reports a note as stale. |
| `git.enabled` | boolean | `false` | no — `git enable` / `git disable` | Git sync enabled. |
| `git.lifecycle` | record | absent | no | Repository, branch, remote and scope, written by `git enable --apply`. |
| `automation.enabled` | boolean | `false` | no — `automation enable` / `automation disable` | Scheduled jobs enabled. |
| `automation.lifecycle` | record | absent | no | One `schedules` entry per job: `job` and `schedule` (`cadence` `hourly`, `daily` or `weekly`, with `minute`, `hour`, `day`). |
| `automation.brainGarden.agent` | `claude` \| `codex` | absent | no | The vendor `brain-garden` pins. |
| `automation.brainGarden.executable` | absolute path | absent | no | That vendor's executable, pinned at enable time. |
| `redaction.patterns` | array of ≤ 64 strings, each ≤ 200 characters and not blank | absent | yes | Literal substrings to redact everywhere, for example a client name. Matching is case-insensitive but not accent-insensitive; patterns are never regular expressions. `config get` shows only their count. |
| `telemetry` | `false` | `false` | no | Fixed. There is no telemetry. |

Path-shaped `brain` members are single segments joined onto the vault root, so a configuration file
cannot walk out of the vault.

A hand edit of `automation.brainGarden` breaks the hash that binds it to the installed jobs and stops
the gardener until `automation enable … --apply` runs again.

## 3. Product home

Default `~/.developer-os`, mode `0700`.

| Path | Holds | Owner |
|---|---|---|
| `config.toml` | Configuration (§2). | product, managed |
| `installation-manifest.json` | Every managed artifact with its owner, kind, hash and verification mode. Written outside transactions by design. | product |
| `bin/developer-os.mjs` | The version-free entrypoint that hooks and launchd jobs run as `<node> bin/developer-os.mjs …`. It follows `state/active-release.json` and imports the active release only when its hashes match. | product, managed |
| `releases/<version>/darwin-<arch>/` | Installed release bundles. | product |
| `rollback/` | The retained rollback payload of the previous release. | product |
| `claude/instructions/` | Rule files the marked block in `~/.claude/CLAUDE.md` imports. | product, managed |
| `codex/` | The Codex plugin marketplace tree, `registration.json` and the recorded Codex home. | product, managed |
| `schemas/` | JSON Schemas for structured agent output (`ingest.stage`, `garden.proposals`). | product, managed |
| `instructions/<vendor>/<category>/` | **User overrides** of instruction artifacts (`rules`, `scoped-rules`, `output-styles`, `agents`, `skills`). Never created, edited or deleted by the product. | user |
| `templates/project/<name>` | **User overrides** of project templates. | user |
| `state/` | Runtime state, below. | product |
| `staging/`, `backups/` | Transaction staging and per-file backups. | product |
| `logs/` | Ten rotating log slots per scheduled job: `automation-<job>.<0-9>.json`. | product |

`state/` holds, among others:

| Path | Holds |
|---|---|
| `active-release.json` | The one active release. |
| `release-trust.json` | Trust high watermarks; they never move backwards. |
| `release-metadata/` | Retained release metadata, by hash. |
| `update-rollback.json`, `update-executor.json` | The retained rollback record and the update recovery executor. A zero-byte file is a reservation, not a marker; leave it. |
| `transactions/` | One journal per Foundation transaction. |
| `lifecycle-journals/`, `git-effect-journals/`, `launchd-effect-journals/` | Journals of the lifecycle coordinator and its external effects. |
| `lifecycle-activation.json`, `lifecycle-id-allocator.json`, `manifest-anchor.json` | Opt-in activation provenance, the ID allocator and the manifest anchor. |
| `redaction.key` | The local key that makes redaction fingerprints non-reversible. `uninstall` removes it. |
| `hooks/<vendor>.<verb>.json` | Hook firing records (at most one refresh per 24 h) read by `doctor`. |
| `automation-<job>.status.json` | The last run of each scheduled job. |
| `pulse.<0-7>.md` | The eight most recent `brain-pulse` reports. |
| `git-sync.json` | The last successful sync record. |
| `ingest-attempts.json` | Per-capture ingest attempt counts. |
| `fresh-v2-init.<id>.*.json` | Retained evidence of each fresh install. |

Do not edit or delete files under `state/` by hand: `doctor` and `repair` depend on them.

## 4. Brain vault

Default `~/DeveloperBrain`. A new vault is created from `templates/brain/`:

```text
<vault>/
├── content/
│   ├── PROJECTS/ TOOLS/ DEV/ INFRA/ QA/   canonical notes, one folder per topic
│   ├── _raw/
│   │   ├── quarantine/                    captures waiting for review
│   │   ├── inbox/                         files for `import`
│   │   └── processed/                     created by init; written by no command
│   ├── _indexes/                          generated: index.json, terms.json, graph.json, vault-map.md, catalog.md
│   ├── _outputs/                          agent-generated reports, never canonical
│   ├── _graveyard/                        retired notes
│   └── templates/                         note templates
└── .obsidian/                             Obsidian state, never read
```

Only Markdown notes under configured topic folders are canonical. Folders whose name starts with `_`,
`templates`, dot-folders and unconfigured folders are excluded from indexes, search and Git sync. An
existing vault with other folder names works through `brain.topicFolders` and `brain.topicAliases`;
the product never renames a folder. Note format: [Brain vault format](brain-format.md).

## 5. Agent homes

What `init` writes outside the product home, by vendor. Nothing else in an agent home is touched.

| Vendor | Path | Content |
|---|---|---|
| Claude Code | `~/.claude/skills/developer-os/` | The plugin: skills, subagents, commands, `hooks/hooks.json`. |
| Claude Code | `~/.claude/rules/developer-os-<id>.md` | Scoped rules. |
| Claude Code | `~/.claude/output-styles/developer-os-<id>.md` | Output styles. |
| Claude Code | `~/.claude/CLAUDE.md` | One marked block importing the rule files. |
| Codex | `<product-home>/codex/plugins/developer-os` | The plugin, registered through `codex plugin marketplace add` and `codex plugin add`. |
| Codex | `~/.codex/agents/developer-os-<id>.toml` | Subagents. |
| Codex | `~/.codex/AGENTS.md` | One marked block holding the rules. |

Details and the override rules: [Agent integration](agent-integration.md).

## 6. Scheduled jobs

| Path | Holds |
|---|---|
| `~/Library/LaunchAgents/com.developer-os.<job>.plist` | One LaunchAgent per installed job. Its label is `com.developer-os.<job>.g.<generation>`; the generation changes on every applied `automation enable`. |

Each plist runs `<node> <product-home>/bin/developer-os.mjs automation run <job> --scheduled
--product-home <home> --generation <hash>`, sends stdout and stderr to `/dev/null`, and sets no
environment. Results go to `state/automation-<job>.status.json` and `logs/`.

## 7. Project files

`project init` writes `AGENTS.md`, `CLAUDE.md` and `_Context.md` into a repository. The prompt guard
reads an optional `<project>/.developer-os/skill-rules.json`:

```json
{ "schemaVersion": 1, "rules": [{ "skill": "code-review", "keywords": ["review", "PR"] }] }
```

At most 64 KiB and 200 rules; an absent file is fine. The guard suggests at most three matching
skills per prompt.
