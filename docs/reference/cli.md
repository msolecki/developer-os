# CLI reference

Every command, option and exit code of `developer-os`. The source of truth is `apps/cli/src/main.ts`
(`USAGE`, `COMMAND_OPTIONS`, `COMMAND_POSITIONALS`, the subcommand tables) and, for `update`,
`apps/cli/src/commands/update/index.ts` — `parseUpdateArgv`. Behaviour is described in the
[Functional specification](../product/functional-spec.md).

## Conventions

- **Strict parsing.** An unknown command, an option the command does not accept, a missing or extra
  positional, or a malformed value is invalid input: the usage text is printed and the exit code is 2.
  Nothing runs.
- **`--json`.** Every command accepts it and then prints exactly one JSON line: the result envelope
  with the data, or the error with `kind`, `message`, `paths` and, when there is one, `recovery`.
  Every string leaf is redacted.
- **Plan, then apply.** `git enable|disable` and `automation enable|disable` print a plan and change
  nothing unless `--apply` is given. `update` and `update rollback` work the same way.
- **Dry run.** `--dry-run` previews `init`, `uninstall`, `import`, `project init`, `brain reindex`,
  `brain retire` and `brain refactor`.
- **Recovery line.** A failure that one command fixes prints `Recovery: <command>`.
- **Admission.** Every command except `init` first checks that the product home is not in the middle
  of a bootstrap; an interrupted one refuses with exit 6 and names the recovery.

## Global

```sh
developer-os --version
developer-os --version --json
```

Prints the product version. `--help` is not an option: any invalid invocation prints the usage text.

## Installation and health

### `init`

```sh
developer-os init --dry-run --adapters claude,codex
developer-os init --adapters claude,codex
developer-os init --adapters claude
developer-os init --adapters none
developer-os init
developer-os init --yes --json
```

| Option | Meaning |
|---|---|
| `--adapters <a>` | `claude,codex`, `claude`, `codex` or `none`: the vendors to install. A fresh `init` without it selects `none`; a re-run without it keeps the stored selection. |
| `--dry-run` | Print what would be created; write nothing. |
| `--yes` | Accept ordinary confirmations. |
| `--local-release <dir>` | Install from a directory `npm run pack:local-release` wrote; the release is marked `unsigned-local`. For development only. |

### `status`

```sh
developer-os status
developer-os status --json
```

Read-only. Prints the product home, the vault path, whether the product is installed, the product
version, whether configuration is present, the number of managed artifacts, the drift count, the
incomplete transactions and which agents are present.

### `doctor`

```sh
developer-os doctor
developer-os doctor --probe
developer-os doctor --json
```

Read-only. One `[pass|warn|fail] <check>: <message>` line per check. `--probe` also runs each agent
CLI's version probe; Claude's probe writes `~/.claude.json`. Exit code: the most severe failing code
in the order 6, 5, 4, 3, 2, 1. A failing `doctor` still prints the whole report.

### `repair`

```sh
developer-os repair --resume <transaction-id>
developer-os repair --rollback <transaction-id>
```

Resumes or rolls back one incomplete transaction that `doctor` or `status` named. Exactly one of the
two options. Transactions owned by `init`, `uninstall` or `update` refuse and name their own command.

### `uninstall`

```sh
developer-os uninstall --dry-run
developer-os uninstall --yes
```

Removes every manifest-owned artifact and keeps the Brain. Prints `removed`, `restored`, `preserved`
and `retained bootstrap evidence` sections.

### `config`

```sh
developer-os config get
developer-os config get brain.retrieval.maxCandidates
developer-os config set brain.retrieval.maxCandidates 20
developer-os config set adapters.codex false
developer-os config set redaction '{"patterns":["ExampleClient"]}'
```

| Form | Meaning |
|---|---|
| `config get` | The whole validated configuration; redaction patterns appear only as `patternsCount`. |
| `config get <key>` | One readable key. |
| `config set <key> <value>` | One mutable key, written through a transaction. The value is canonical JSON. Prints `updated` or `unchanged`. |

Keys: [Configuration](configuration.md#2-configtoml).

## Brain

### `brain reindex`

```sh
developer-os brain reindex
developer-os brain reindex --dry-run
```

Rebuilds `index.json`, `terms.json`, `graph.json`, `vault-map.md` and `catalog.md` under the indexes
directory. Notes are not modified.

### `brain status`

```sh
developer-os brain status
```

Prints `vault`, `content root`, `notes`, `topic folders`, `unclassified`, `index` and
`would change`.

### `brain lint`

```sh
developer-os brain lint
developer-os brain lint --json
```

One `[error|warn|info] <class> <path>[:<line>] <message>` line per finding, or `No findings.`
Classes: `frontmatter`, `provenance`, `links`, `duplicates`, `staleness`, `index-drift`, `isolated`,
`gap`.

### `brain search` and `search`

```sh
developer-os brain search "release notes"
developer-os brain search "release notes" --limit 5
developer-os search "release notes"
```

One `<score>  <path>  <title>` line per match, then the count. `--limit` is a positive integer;
the default is `brain.retrieval.maxCandidates`. `search` is an alias that runs the same code path.

### `brain retire`

```sh
developer-os brain retire DEV/old-note.md --dry-run
developer-os brain retire DEV/old-note.md
```

Moves the note to `_graveyard/` and rewrites links to it.

### `brain refactor`

```sh
developer-os brain refactor --rename DEV/caching.md cache-invalidation --dry-run
developer-os brain refactor --move DEV/caching.md INFRA
developer-os brain refactor --merge DEV/caching-old.md DEV/caching.md
developer-os brain refactor --split DEV/caching.md "Invalidation"
```

Exactly one mode flag. Every mode rewrites the links it affects, runs as one transaction and refuses a
note that changed since it was read.

## Knowledge pipeline

### `capture`

```sh
developer-os capture --text "Decision: release notes live in CHANGELOG.md"
developer-os capture --text "Proposed rewrite" --note DEV/caching.md
developer-os capture --json
```

| Option | Meaning |
|---|---|
| `--text <text>` | The observation; read from stdin when absent. At most 64 KiB. |
| `--note <path>` | Make a note capture that creates or replaces this content-root-relative note. |

Prints the capture path and the redaction count, or `Already captured, at status <s>:` for a
duplicate.

### `import`

```sh
developer-os import --dry-run
developer-os import
developer-os import ./notes --limit 50
developer-os import --claude-memory --dry-run
```

| Form | Source |
|---|---|
| `import` | the vault inbox `content/_raw/inbox/` |
| `import <path>` | a file or directory |
| `import --claude-memory` | Claude Code auto-memory; cannot be combined with a path |

`--limit <n>` caps the files imported in one run (at most 1,000). Accepted types: `.md`,
`.markdown`, `.txt`.

### `review`

```sh
developer-os review
developer-os review --status accepted
developer-os review --id <capture-id> --decision accept
developer-os review --id <capture-id> --decision reject
developer-os review --id <capture-id> --decision edit
```

| Option | Meaning |
|---|---|
| `--status <s>` | List captures at `quarantined` (default), `accepted`, `rejected`, `staging`, `ingested` or `failed`. |
| `--id <id>` with `--decision <d>` | Decide on one capture: `accept`, `reject` (also from `accepted`) or `edit`. |

### `ingest`

```sh
developer-os ingest
developer-os ingest --agent claude
developer-os ingest --agent codex --limit 3
```

| Option | Meaning |
|---|---|
| `--agent <name>` | `claude` or `codex`; default: the first installed vendor. |
| `--limit <n>` | The most accepted captures to process in this run. |

Exit 5 when the `secret-scan` or `write-scope` validator refuses a proposal; exit 1 for other
refusals.

## Projects

```sh
developer-os project init --dry-run
developer-os project init
developer-os project init ./my-repo
developer-os project check
developer-os project check ./my-repo --json
```

`project init [<dir>]` writes `AGENTS.md`, `CLAUDE.md` and `_Context.md`, create-only.
`project check [<dir>]` reports `instruction-file`, `instruction-size`, `instruction-secrets` and
`template-set`. `<dir>` defaults to the working directory.

## Opt-in surfaces

### `git`

```sh
developer-os git enable --remote git@example.com:me/brain.git
developer-os git enable --remote git@example.com:me/brain.git --branch main --apply
developer-os git status
developer-os git sync
developer-os git disable
developer-os git disable --apply
```

| Subcommand | Options | Effect |
|---|---|---|
| `enable` | `--remote <url>` (required), `--branch <name>`, `--apply` | Initialize or adopt the vault repository and add the remote `developer-os`. The remote is a bare local repository, an HTTPS URL or an SSH URL. |
| `disable` | `--apply` | Clear the enable flag; the repository, history and remote stay. |
| `status` | — | `enabled`, `activation`, `repository`, `branch`, `remote`, `scope`, `distribution`, `lifecycle`, `last sync`. |
| `sync` | — | Commit the scoped changes and push. A pending push exits non-zero with `git sync` as the recovery. |

### `automation`

```sh
developer-os automation status
developer-os automation enable --schedule brain-reindex=daily@02:00 --schedule brain-lint=daily@02:30 --schedule doctor=weekly@mon,03:00
developer-os automation enable --schedule brain-pulse=weekly@mon,08:00 --apply
developer-os automation enable --schedule brain-garden=weekly@sun,17:00 --garden-agent claude --apply
developer-os automation disable --apply
```

| Option | Meaning |
|---|---|
| `--schedule <job>=<schedule>` | Repeatable, one per job. Jobs: `brain-reindex`, `brain-lint`, `doctor`, `git-sync`, `brain-garden`, `brain-pulse`. Schedules: `hourly@MM`, `daily@HH:MM`, `weekly@<mon\|tue\|wed\|thu\|fri\|sat\|sun>,HH:MM`, local time. A duplicate job refuses. |
| `--garden-agent <agent>` | The vendor `brain-garden` pins. Only `claude` is accepted at run time. |
| `--apply` | Apply the printed plan. |

`automation status` prints `enabled`, `activation`, `distribution`, `lifecycle` and one line per job:
its state (`off`, or eligibility plus installed state), the live launchd state and the last run.

## Update

```sh
developer-os update
developer-os update --apply
developer-os update --version 0.1.1
developer-os update --version 0.1.1 --apply
developer-os update rollback
developer-os update rollback --apply
```

`update` previews the move to the installed Homebrew package's release; `--version <x.y.z>` names a
stable version to preview. `update rollback` previews returning to the retained previous release;
it does not accept `--version`. Any other token (`--dry-run`, `--yes`, a prerelease, a repeated
option) is invalid input.

## Internal invocations

These are rendered into vendor hook files and launchd plists by the product. They are parsed before
strict dispatch and are not for manual use.

```text
<node> <product-home>/bin/developer-os.mjs guard <prompt|command|commit|path|format|edit|stop> --vendor <claude|codex>
<node> <product-home>/bin/developer-os.mjs brain status --inject --vendor <claude|codex>
<node> <product-home>/bin/developer-os.mjs automation run <job> --scheduled --product-home <home> --generation <hash>
```

In hook mode exit 2 means *block* to the vendor, and every diagnostic goes to stderr. A scheduled run
treats the supplied product home as its only authority and ignores `HOME`, `DEVELOPER_OS_HOME` and
`DEVELOPER_OS_BRAIN`.

## Exit codes

| Code | Name | Meaning | Typical remedy |
|---:|---|---|---|
| 0 | `success` | — | — |
| 1 | `operationalFailure` | Something failed that is nobody's decision. | Read the message; retry. |
| 2 | `invalidInput` | The command line, environment or a file is not valid. | Fix the invocation or the named file. |
| 3 | `decisionRequired` | A human must choose: drift, a marked-block conflict, an existing file, a declined confirmation. | Resolve the named conflict, then re-run. |
| 4 | `capabilityUnavailable` | The host cannot do this: wrong platform, missing or too old agent CLI, no admissible release. | Install or upgrade the missing piece. |
| 5 | `securityRefusal` | A path, command, secret or release was refused by policy. | Do not work around it; see [SECURITY.md](../../SECURITY.md). |
| 6 | `recoveryRequired` | An unfinished transaction or malformed state blocks progress. | Run the command on the `Recovery:` line, then `developer-os doctor`. |

Full remedies per refusal: [Troubleshooting](../troubleshooting/README.md).
