# Founder cutover runbook (A15, DOS-P8)

Written on 2026-09-23 under D56 from program plan Task 8 ("Migrate the founder in shadow mode"),
roadmap Phase 10 and decisions D16, D47, D51, D52, D53, D55 and D56. Inputs, all in this repository:
`instruction-inventory.md` (§4 hooks, §5 scripts, §8 vault mapping), `source-manifest.json`,
`exclusion-policy.md`, and the architecture notes `foundation.md`, `hooks.md`, `brain.md`,
`claude-adapter.md`, `codex-adapter.md` and `knowledge-pipeline.md`. The founder executes it on the
live macOS machine, one step at a time, and ticks each step only after its **Verify** line holds.

Nothing from the machine is written back into this repository: command output, note content, paths
and labels stay on the machine (`exclusion-policy.md`). Every path below is a placeholder.

## Placeholders

| Placeholder | Meaning |
|---|---|
| `<devos-checkout>` | a clean checkout of this repository on `development` |
| `<release-dir>`, `<release-dir-2>` | output directories of `pack:local-release` (must not exist beforehand) |
| `<cli>` | `node <release-dir>/bundle/node_modules/@developer-os/cli/dist/bin.js`, the bundled CLI of that release |
| `<product-home>` | the product home, `~/.developer-os` unless `DEVELOPER_OS_HOME` says otherwise |
| `dos` | `node <product-home>/bin/developer-os.mjs` (D53); `doctor` prints the same alias |
| `<vault>` | the founder's live vault (the `private-brain` source); it becomes the Brain in place and is never moved |
| `<vault-copy>` | a throwaway full copy of `<vault>` for the §8 migration |
| `<scratch-home>` | a throwaway product home used only against `<vault-copy>` |
| `<legacy-shared-repo>` | the legacy shared runtime checkout (the `shared-runtime` source) |
| `<legacy-plugin>`, `<legacy-marketplace>` | the legacy plugin and the marketplace it was installed from |
| `<legacy-job-label>` | one legacy launchd label; there may be several |
| `<legacy-job-label-prefix>` | the prefix the legacy launchd labels share |
| `<override-source>` | where the founder's modified third-party skills live today (D51) |
| `<backup-dir>` | a directory outside every tree above, not synced anywhere |
| `<work>` | a scratch directory for patches, hash lists and logs |

## Ground rules

- **No `update`, `update rollback`, `git` or `automation` verb exists yet.** A newer build reaches
  the machine only by reinstalling (D16, step 15). Product Git and launchd stay disabled for the
  whole cutover; they arrive with Phases 8 and 9.
- `import` and `ingest` are manual verbs permanently (D47); nothing here schedules them.
- Every mutating product command runs with `--dry-run` first where the verb accepts it (`init`,
  `uninstall`, `import`, `project init`, `brain retire`, `brain refactor`).
- A step's rollback undoes that step only. The full return to the legacy runtime is step 18.
- The legacy repositories are never deleted. `<legacy-shared-repo>` is archived only after one stable
  cycle and only once Codex no longer depends on it (step 19); `<vault>` is the Brain and is never
  archived.
- Stop at the first unexpected exit code or `[fail]` line. `dos repair --resume <id>` or
  `dos repair --rollback <id>` finishes or undoes one interrupted product transaction; nothing else
  is repaired by hand.

## Step 1 — Preflight: record versions

**Command**

```sh
mkdir -p <backup-dir> <work>
{ sw_vers; node --version; pnpm --version; claude --version; codex --version
  git -C <devos-checkout> rev-parse HEAD
  git -C <legacy-shared-repo> rev-parse HEAD; git -C <legacy-shared-repo> status --porcelain
  git -C <vault> rev-parse HEAD; git -C <vault> status --porcelain
  launchctl list | grep '<legacy-job-label-prefix>'
  ls -l ~/Library/LaunchAgents
} > <work>/preflight-versions.txt 2>&1
```

**Changes** nothing.

**Verify** Both legacy checkouts report an empty `status --porcelain`; if not, commit or stash them
in their own repositories first, because the backup must be a known state. Compare the vendor
versions with the D48 pins (Claude Code 2.1.280, Codex CLI 0.155.1); a newer vendor is a finding
to record, not a stop. Write down every legacy launchd label the listing shows.

**Rollback** none needed.

## Step 2 — Preflight: back up

**Command**

```sh
tar -czf <backup-dir>/claude-home.tgz -C "$HOME" .claude .claude.json
tar -czf <backup-dir>/codex-home.tgz  -C "$HOME" .codex
tar -czf <backup-dir>/vault.tgz       -C "$(dirname <vault>)" "$(basename <vault>)"
tar -czf <backup-dir>/legacy-shared.tgz -C "$(dirname <legacy-shared-repo>)" "$(basename <legacy-shared-repo>)"
mkdir -p <backup-dir>/launchagents
cp -p ~/Library/LaunchAgents/<legacy-job-label>.plist <backup-dir>/launchagents/   # once per label
shasum -a 256 <backup-dir>/*.tgz > <backup-dir>/SHA256SUMS
```

Drop `.claude.json` from the first line if it does not exist. The backups hold credentials and
private notes: keep `<backup-dir>` mode 0700 and out of every synced or public location.

**Changes** creates `<backup-dir>` only.

**Verify** `shasum -a 256 -c <backup-dir>/SHA256SUMS` passes, and `tar -tzf` on each archive lists
the expected top-level directory.

**Rollback** delete `<backup-dir>` once the cutover has survived one stable cycle; not before.

## Step 3 — Freeze: boot out the legacy scheduled jobs

Done first so that nothing writes to `<vault>` or the vendor homes between the copy in step 5 and the
patch in step 7. The legacy weekly job's preflight also refuses uncommitted vault changes, so it must
not fire mid-cutover.

**Command** (once per label recorded in step 1)

```sh
launchctl bootout gui/$(id -u)/<legacy-job-label>
mv ~/Library/LaunchAgents/<legacy-job-label>.plist <backup-dir>/launchagents/retired-<legacy-job-label>.plist
```

Moving the plist matters: `bootout` alone is undone by the next login.

**Changes** the job no longer runs; its plist leaves `~/Library/LaunchAgents`.

**Verify** `launchctl print gui/$(id -u)/<legacy-job-label>` reports the service is not found, and
`ls ~/Library/LaunchAgents` no longer lists it. From here until Phase 9 the jobs run by hand (step 14).

**Rollback**

```sh
mv <backup-dir>/launchagents/retired-<legacy-job-label>.plist ~/Library/LaunchAgents/<legacy-job-label>.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<legacy-job-label>.plist
```

## Step 4 — Build and pack the local release

**Command**

```sh
cd <devos-checkout>
git status --porcelain        # must be empty
pnpm install --frozen-lockfile
npm run lint
npm run pack:local-release -- <release-dir>
```

`pack:local-release` compiles, bundles the CLI with `esbuild` into one module plus
`THIRD-PARTY-LICENSES` (D55), and prints the release directory's realpath; use that exact spelling
as `<release-dir>` from now on, because admission requires it.

**Changes** writes `<release-dir>` and the checkout's build output only.

**Verify** `<cli> --version` prints the product version. `npm run lint` exited 0. Under D56 the full
suite is owed at the phase close; record in `<work>/preflight-versions.txt` that this build's tests
did not run.

**Rollback** `rm -rf <release-dir>`.

## Step 5 — Vault migration on a copy (inventory §8)

The founder decided on 2026-09-04 that the vault is migrated once, by hand, with a throwaway script
reviewed as a diff; there is no product migrator (`BRAIN_MIGRATIONS` stays empty). The script lives in
`<work>`, never in this repository.

**Command**

```sh
cp -Rp <vault> <vault-copy>                       # includes .git and untracked files
node <work>/migrate-vault.mjs <vault-copy>        # the throwaway script
git -C <vault-copy> add -A && git -C <vault-copy> diff --cached --stat
git -C <vault-copy> diff --cached > <work>/vault-migration.patch
```

The script applies exactly the §8 mapping to every note's frontmatter and links:

| Legacy | Product |
|---|---|
| `date` | `created` (and `updated` when a later review date exists) |
| `agent-created: true` | `author: agent`; otherwise `author: human` |
| `agent-reviewed: <date>` | `reviewed: <date>`; absent → `reviewed: null` |
| `confidence`, `frequency` | `occurrences` = `frequency` (minimum 1); `confidence` dropped |
| `stage: growing` | `established` when `frequency >= 3`, otherwise `emerging` |
| types `tool`, `book-note` | `reference-note` |
| types `answer-note`, `basic-note` | `knowledge-note` |
| `enableToc`, `openToc`, `source`, `repo` | dropped; `repo` returns as the tag `repo:<slug>` |
| wikilinks to `_indexes/graph` | rewritten to the `catalog` note |

Folders `PROJEKTY` and `NARZEDZIA` are **not** renamed; step 6 aliases them. If the legacy inbox is
not already at `content/_raw/inbox`, move its files there in the same diff (step 12 imports from that
path; `import` refuses a path inside the vault but outside its inbox). Vault-level legacy instruction
files (`AGENTS.md`, `CLAUDE.md`, `WRITING_STYLE.md`) and the vault's own `SessionStart` hook are
superseded by the workflow preamble and the product injection hook (inventory §7): remove the vault's
hook entry in the same diff so it cannot inject twice, and keep the instruction files until the cycle
in step 16 has passed. Legacy generated index files (for example `_indexes/graph.md`) may be removed
in the diff if step 6 reports them.

**Changes** `<vault-copy>` only. `<vault>` is untouched.

**Verify** Read `<work>/vault-migration.patch` in full: every hunk is frontmatter, a link rewrite, an
inbox move or a listed vault-level file; no note body text changed. The note count before and after
is equal.

**Rollback** `rm -rf <vault-copy>` and fix the script.

## Step 6 — Validate the copy with a scratch product home

**Command**

```sh
export DEVELOPER_OS_HOME=<scratch-home> DEVELOPER_OS_BRAIN=<vault-copy>
<cli> init --dry-run --local-release <release-dir> --adapters none
<cli> init --yes --local-release <release-dir> --adapters none
SDOS="node <scratch-home>/bin/developer-os.mjs"
$SDOS config set brain '{"contentRoot":"content","indexesDir":"_indexes","retrieval":{"maxCandidates":10},"schemaVersion":1,"staleness":{"reviewAfterDays":180},"topicAliases":{"NARZEDZIA":"TOOLS","PROJEKTY":"PROJECTS"},"topicFolders":["PROJECTS","TOOLS","DEV","INFRA","QA"]}'
$SDOS brain reindex
$SDOS brain lint --json > <work>/copy-lint.json
$SDOS brain status --json > <work>/copy-status.json
```

`config set brain` writes the whole `[brain]` section because a fresh `init` writes none, so
`config set brain.topicAliases …` refuses with `config_parent_absent`. The value must be
byte-for-byte canonical JSON: keys sorted, no whitespace. The values above are the defaults plus the
two §8 aliases; add any other legacy topic folder to `topicFolders` (an alias value must name a
configured topic folder, and an alias key must not be one).

`--adapters none` keeps both vendor homes untouched; the scratch home is the only product state
written.

**Changes** creates `<scratch-home>`; `brain reindex` writes index files under `<vault-copy>`.

**Verify**

- `brain lint` reports **0 errors** (warnings are recorded, not blocking). Every error is fixed in the
  script, and steps 5–6 rerun from a fresh copy.
- `noteCount` in `copy-status.json` equals the number of note files under `<vault-copy>/content`
  outside `_raw/` and `_indexes/`.
- Every note is findable:

  ```sh
  find <vault-copy>/content -name '*.md' -not -path '*/_raw/*' -not -path '*/_indexes/*' |
  while read -r note; do
    stem=$(basename "$note" .md)
    $SDOS brain search "$stem" --limit 50 --json | grep -q "$stem.md" || echo "MISSING $note"
  done
  ```

  prints nothing. A `MISSING` line is a discovery, schema or alias defect: fix it and rerun.

**Rollback**

```sh
$SDOS uninstall --yes
unset DEVELOPER_OS_HOME DEVELOPER_OS_BRAIN
rm -rf <scratch-home>
```

Run the rollback also on success, before step 7: the scratch home has done its job.

## Step 7 — Apply the reviewed migration to the live vault

**Command**

```sh
git -C <vault> apply --check <work>/vault-migration.patch
git -C <vault> apply <work>/vault-migration.patch
git -C <vault> add -A
git -C <vault> commit -m "Migrate notes to the Developer OS schema (inventory §8)"
git -C <vault> rev-parse HEAD >> <work>/preflight-versions.txt   # the migration commit
rm -rf <vault-copy>
```

The commit is the founder's own vault history, made by hand; product Git stays disabled.

**Changes** `<vault>` notes, in place. The vault is not moved.

**Verify** `git -C <vault> diff HEAD~1 --stat` matches the stat from step 5, and
`git -C <vault> status --porcelain` is empty.

**Rollback** `git -C <vault> revert --no-edit <migration-commit>`.

## Step 8 — Remove the legacy surfaces that collide with the install

Done in one sitting with steps 9 and 10, so the machine is without guards and rules for minutes, not
days. First see what the product will write:

```sh
DEVELOPER_OS_BRAIN=<vault> <cli> init --dry-run --local-release <release-dir> --adapters claude,codex
```

The product refuses to write through a symlink or over an unmanaged file where a managed artifact
belongs, so every legacy file the dry run names as a conflict goes first.

**Command** (after backing up in step 2; inspect each target before removing it)

| Surface | Action |
|---|---|
| legacy `@import` block in `~/.claude/CLAUDE.md` | delete the lines importing from `<legacy-shared-repo>`; keep every hand-written line |
| legacy rule symlinks in `~/.claude/rules/` | `find ~/.claude/rules -type l -lname '<legacy-shared-repo>/*' -delete`; then `find -L ~/.claude/rules -type l` lists dead links left over, delete those too |
| legacy output styles in `~/.claude/output-styles/` | remove the four legacy files (`architect`, `debug`, `direct-objective`, `tdd-enforcer`) or their symlinks |
| legacy plugin, Claude | `claude plugin uninstall <legacy-plugin>@<legacy-marketplace>`, then `claude plugin marketplace remove <legacy-marketplace>`; confirm the verbs with `claude plugin --help` on the installed version. If the plugin was linked into `~/.claude/skills/`, remove that symlink instead |
| legacy plugin, Codex | `codex plugin remove <legacy-plugin>`, then `codex plugin marketplace remove <legacy-marketplace>` |
| legacy-generated text in `~/.codex/AGENTS.md` | delete the generated rule text; keep hand-written lines |
| orphaned generated agents in `~/.codex/agents/` | remove every `<name>.toml` the legacy generator wrote (it was deleted on 2026-07-27, so these are orphans), including names the product does not ship |
| dead symlinks anywhere in both homes | `find -L ~/.claude ~/.codex -type l` (BSD `find` has no `-xtype`) must print nothing afterwards |

Do **not** touch the legacy hook entries yet (step 10), `~/.claude/settings.json` permissions, or any
inline third-party hook: those are the user's own tooling (inventory §4) and `doctor` reports them as
`external`.

**Changes** the listed legacy files only.

**Verify** the dry run above, repeated, reports no conflict. `claude plugin list` and
`codex plugin list --json` no longer show `<legacy-plugin>`.

**Rollback** restore the listed paths from the step 2 archives:

```sh
mkdir -p <work>/restore && tar -xzf <backup-dir>/claude-home.tgz -C <work>/restore
tar -xzf <backup-dir>/codex-home.tgz -C <work>/restore
# copy back only the paths this step changed, e.g.
cp -Rp <work>/restore/.claude/rules/. ~/.claude/rules/
cp -p <work>/restore/.claude/CLAUDE.md ~/.claude/CLAUDE.md
cp -p <work>/restore/.codex/AGENTS.md ~/.codex/AGENTS.md
cp -Rp <work>/restore/.codex/agents/. ~/.codex/agents/
```

and reinstall the legacy plugin with the vendor's install verb.

## Step 9 — Install over the live machine with the vault as Brain

**Command**

```sh
DEVELOPER_OS_BRAIN=<vault> <cli> init --dry-run --local-release <release-dir> --adapters claude,codex
DEVELOPER_OS_BRAIN=<vault> <cli> init --yes --local-release <release-dir> --adapters claude,codex
alias dos='node <product-home>/bin/developer-os.mjs'
dos config set brain '<the same canonical JSON as step 6>'
dos brain reindex
dos status
dos doctor
```

`init` records `<vault>` as `brainPath`, so later commands and hooks need no environment variable.
It never modifies an existing vault. It writes:

- Claude: the skills-directory plugin at `~/.claude/skills/developer-os` (with `hooks/hooks.json`),
  managed rules in `~/.claude/rules/`, output styles in `~/.claude/output-styles/`, and one
  product-owned block in `~/.claude/CLAUDE.md`.
- Codex: the plugin under `<product-home>/codex/plugins/developer-os`, registered through
  `codex plugin marketplace add` and `codex plugin add`; agents in `~/.codex/agents/`; one
  product-owned block in `~/.codex/AGENTS.md`. No Codex hooks yet (step 10); once they ship,
  Codex needs a one-time interactive trust approval and `doctor` reports `plugin_hooks=unknown` until
  then.
- The version-free entrypoint `<product-home>/bin/developer-os.mjs` (D53).

`ingest` with Codex runs under its own `CODEX_HOME` in product state that links only the credential
entry from the resolved Codex home (D52); nothing to do here beyond noting it.

**Changes** `<product-home>`, the files listed above, and the index files under `<vault>/content/_indexes`.

**Verify** `status` names `<vault>` as the Brain and both adapters; `doctor` has no `[fail]` line (the
unsigned-local-build warning is expected on every run); `dos brain status --json` reports the same
`noteCount` as step 6; `claude plugin list` shows `developer-os@skills-dir` loaded; a new Claude
session lists the product skills and the product rules. `doctor --probe` additionally probes each
vendor CLI and writes `~/.claude.json`; run it once, knowingly.

**Rollback** `dos uninstall --dry-run`, then `dos uninstall --yes`, then step 8's rollback.

## Step 10 — Product hooks replace the legacy guards

**Claude, now.** In `~/.claude/settings.json` delete every hook entry whose command runs a script
from `<legacy-shared-repo>` (inventory §4: `knowledge-inject`, `bash-danger-guard`,
`secret-file-guard`, `commit-guard`, `stop-gate`, `format-smart`, `skill-activator`,
`shared-file-warn`, `instructions-check`, and the declined `knowledge-capture` and
`precompact-backup`). Leave `dippy-guard` and the inline third-party hooks. The product never writes
this file; the founder edits it by hand.

```sh
node -e 'JSON.parse(require("fs").readFileSync(process.env.HOME + "/.claude/settings.json","utf8"))' && echo valid
grep -c '<legacy-shared-repo>' ~/.claude/settings.json    # must print 0
```

Removing the legacy entries in the same sitting as step 9 is what keeps two copies of a mutating
hook from running: legacy `format-smart` and the product `guard format` both edit files, and two
injection hooks double the session context.

**Codex, pending A13 Task 15 (NEW-104).** The product Codex plugin renders no hooks yet (`doctor`
reports `codex=not-rendered`). Until NEW-104 lands, the legacy Codex hooks stay installed and are the
only Codex guards: `session_start` injection, the `pre_tool_use` command and protected-path guards,
and the pre-compact hook. They run scripts from `<legacy-shared-repo>`, which therefore stays in place
and unmodified (step 19). The legacy Codex injection reads the migrated vault; if it now fails, it
fails open: record it, and accept no Codex injection until NEW-104 rather than editing the legacy
script. When Task 15 lands: reinstall (step 15), approve the product Codex hooks interactively, then
remove the legacy Codex hook entries with the same care as above.

**Changes** `~/.claude/settings.json` hook entries only.

**Verify** in a new Claude session: the session start shows the product injection once (vault map
plus the matching project note); asking the agent to write a synthetic `<work>/scratch/.env` is
blocked by `guard path`; asking it to run a synthetic dangerous command such as `rm -rf <work>/scratch`
is blocked by `guard command`. Then `dos doctor` reports check `hooks` passing with firing records
under `<product-home>/state/hooks/`, and check `external-hooks` lists only the tooling you kept.

**Rollback** restore `~/.claude/settings.json` from `<backup-dir>/claude-home.tgz` (as in step 8).

## Step 11 — Move the founder's local overrides (D51)

Third-party-derived skills are not vendored: `react-best-practices`, `claudeception`,
`excalidraw-diagram` and the `research*` family. The founder's modified copies become user overrides
under `<product-home>/instructions/<vendor>/skills/<id>/`. The same tree takes the founder's own
edits of product defaults (`rules/`, `scoped-rules/`, `output-styles/` on Claude only, `agents/`,
`skills/`); an override replaces the default with the same id on that vendor.

**Command** (per skill, per vendor that should get it)

```sh
mkdir -p <product-home>/instructions/claude/skills <product-home>/instructions/codex/skills
cp -R <override-source>/<skill-id> <product-home>/instructions/claude/skills/<skill-id>
cp -R <override-source>/<skill-id> <product-home>/instructions/codex/skills/<skill-id>
find <product-home>/instructions -type l            # must print nothing: symlinks are refused
chmod -R go-rwx <product-home>/instructions
DEVELOPER_OS_BRAIN=<vault> <cli> init --dry-run --local-release <release-dir> --adapters claude,codex
DEVELOPER_OS_BRAIN=<vault> <cli> init --yes --local-release <release-dir> --adapters claude,codex
```

Re-running `init` projects the overrides. Keep each skill's upstream license and attribution file
inside its directory; removing attribution is not an option (D51). Then remove the old copies from
where the legacy runtime loaded them (for example the vault's `.claude/skills/`) so each skill loads
once.

**Changes** `<product-home>/instructions/` (user-owned, never a manifest row) and the projected
skills in both vendor homes.

**Verify** `dos doctor` has no `[fail]`; a new Claude session and a new Codex session each list every
override skill exactly once.

**Rollback** move the directories out of `<product-home>/instructions/` and re-run `init` as above.

## Step 12 — Import the accumulated inbox, in batches

**Command** (repeat until the dry run imports nothing new)

```sh
dos import --dry-run --limit 25
dos import --limit 25
dos review                                    # lists quarantined captures
dos review --id <capture-id> --decision accept   # or reject, or edit
dos ingest --limit 5 --agent claude
dos brain reindex
dos brain lint
```

With no path, `import` reads `<vault>/content/_raw/inbox`; captures land in quarantine
(`content/_raw/quarantine`), redacted before they are written. `dos import --claude-memory` imports
Claude Code auto-memory the same way. A run takes at most 1,000 files; batches of 25 keep review
honest. `ingest` makes one agent call per accepted capture.

**Changes** quarantine files per `import`; one note per ingested capture.

**Verify** after each batch: `dos review --status accepted` is empty, `dos review --status failed` is
empty or understood, `brain lint` has 0 errors, and a `brain search` for one ingested topic returns
the new note. The capture ID is a content hash, so re-running `import` over the same files adds
nothing.

**Rollback** a rejected or failed capture changes no note. An ingested note is reverted with the
vault's own Git (`git -C <vault> log`, then `git -C <vault> revert`), or retired with
`dos brain retire <note>` after its `--dry-run`.

## Step 13 — Retire the remaining legacy runtime pieces

**Command** by hand, in the shell profile and any launcher script:

`shared-sync` and `bootstrap` retire: `<legacy-shared-repo>` stops being pulled and stays frozen at the
commit recorded in step 1. Remove any shell alias or `PATH` entry that points into it, except what the
Codex hooks of step 10 still call.

**Verify** `grep -rn '<legacy-shared-repo>' ~/.zshrc ~/.zprofile ~/.claude ~/.codex` shows only the
Codex hook entries.

**Rollback** restore the removed lines.

## Step 14 — Run each retired job by hand until Phase 9

Git and launchd automation stay disabled until Phase 9, whose registry holds `brain-reindex`,
`brain-lint`, `doctor` and `git-sync`; `import` and `ingest` never join it (D47).

| Retired legacy job | By hand, until Phase 9 | Cadence |
|---|---|---|
| `brain-weekly` | `dos import --claude-memory`, `dos import`, `dos review`, `dos ingest`, `dos brain reindex`, `dos brain lint`, `dos doctor`; then the vault's own `git -C <vault> commit` and push by the founder (product `git sync` is Phase 9). Proposals come from the A12b workflows; the legacy tests retire with the legacy repository | weekly |
| `distill-memory` | `dos import --claude-memory` | weekly, with the above |
| `check-config-drift` | `dos doctor` (check `vendor-config`) | weekly, with the above |
| `check-templates` | `dos project check <dir>` per repository | monthly |
| `shared-sync` | none; a newer build arrives by reinstalling (step 15) | per build |
| `repo-audit-weekly`, `git-history-secrets` | refused (D47); the founder runs `gh` or a dedicated history scanner directly if wanted | as wanted |
| any other label found in step 1 | record it in the founder's own log (never in this repository) before booting it out, with its manual equivalent or "none" | — |

Record each manual run's date in the founder's own log; if runs lapse, the roadmap risk register says
to revisit the phase order.

**Changes** nothing by itself; each manual run changes what its verb changes.

**Verify** each run exits 0, `dos brain lint` reports 0 errors, `dos doctor` has no `[fail]` line, and
the run is in the log.

**Rollback** per verb, as in steps 12 and 15; step 3's rollback restores a legacy job instead.

## Step 15 — Prove that reinstalling a newer build preserves the Brain and every override

`update` does not exist until Phase 8, so this is the only upgrade path (D16).

**Command**

```sh
# before
(cd <vault> && find . -type f -not -path './.git/*' -not -path './.obsidian/*' -print0 | sort -z | xargs -0 shasum -a 256) > <work>/brain-before.sha256
(cd <product-home>/instructions && find . -type f -print0 | sort -z | xargs -0 shasum -a 256) > <work>/overrides-before.sha256
dos config get brain > <work>/brain-config-before.json
# a newer build, launched from its own bundle: release admission requires the running CLI's version
cd <devos-checkout> && git pull --ff-only && npm run lint && npm run pack:local-release -- <release-dir-2>
node <release-dir-2>/bundle/node_modules/@developer-os/cli/dist/bin.js init --dry-run --local-release <release-dir-2> --adapters claude,codex
node <release-dir-2>/bundle/node_modules/@developer-os/cli/dist/bin.js init --yes --local-release <release-dir-2> --adapters claude,codex
# after
(cd <vault> && find . -type f -not -path './.git/*' -not -path './.obsidian/*' -print0 | sort -z | xargs -0 shasum -a 256) | diff <work>/brain-before.sha256 -
(cd <product-home>/instructions && find . -type f -print0 | sort -z | xargs -0 shasum -a 256) | diff <work>/overrides-before.sha256 -
dos config get brain | diff <work>/brain-config-before.json -
dos doctor
```

Never launch the newer release through the old entrypoint: a release whose version differs from the
running CLI is refused (`release_mismatch`). If the in-place `init` refuses, the D16 fallback is
`dos uninstall --dry-run`, `dos uninstall --yes`, the same `init --yes` from `<release-dir-2>` with
`DEVELOPER_OS_BRAIN=<vault>`, and `dos config set brain` from `<work>/brain-config-before.json`
(`uninstall` removes `config.toml`, a manifest row); run the three `diff`s after it.

**Changes** the active release, the entrypoint and the managed vendor artifacts.

**Verify** all three `diff`s print nothing; `dos --version` and `doctor`'s entrypoint line name the
new release; the Claude session checks of steps 9–11 still hold.

**Rollback** reinstall from `<release-dir>` the same way.

## Step 16 — Gate cycle on the live machine

One complete cycle, in order; the gate of roadmap Phase 10.

1. **Capture.** In a Claude session, the agent runs
   `dos capture --text "<synthetic observation>" --note <topic>/<new-note>.md`.
   Verify `dos review` lists it, redacted.
2. **Review.** `dos review --id <capture-id> --decision accept`. Verify
   `dos review --status accepted` lists it.
3. **Ingest.** `dos ingest --limit 1 --agent claude`. Verify the note exists, `dos brain lint` has 0
   errors, and `dos review --status ingested` lists the capture.
4. **Search.** `dos brain reindex`, then `dos brain search "<a term from the observation>"` returns the
   new note; a new Claude session's injection reflects the updated vault map.
5. **Reinstall.** Step 15 against a freshly packed build, all three `diff`s empty (take the "before"
   hashes after step 4 of this cycle).
6. **Uninstall.** `dos uninstall --dry-run`, then `dos uninstall --yes`. Verify: the Brain hash list
   matches step 5's "after"; `<product-home>/instructions/` is reported preserved and its hash list is
   unchanged; `~/.claude/skills/developer-os` and the product block in `~/.claude/CLAUDE.md` are gone;
   `codex plugin list --json` no longer lists `developer-os` and the product block in
   `~/.codex/AGENTS.md` is gone; `find -L ~/.claude ~/.codex -type l` prints nothing.

Then continue with step 18 (exercise the rollback) while the product is uninstalled, and return with
step 17.

## Step 17 — Return to the product after the uninstall or a rollback

Repeat, in order: step 3 (only if step 18 re-enabled the legacy jobs), step 8, step 9 (including
`config set brain`), step 10 (Claude half), step 11's `init` re-run, and the `doctor` and session
checks. The vault needs no migration again. Git and launchd stay disabled.

## Step 18 — Full rollback to the legacy runtime (exercise once)

Exercised once, after the gate cycle's uninstall, before the cutover is declared complete. It
restores the legacy runtime and **preserves every post-cutover Brain change**: the vault is not
restored from backup.

1. **Remove the product**, if installed: `dos uninstall --dry-run`, `dos uninstall --yes`. The Brain
   and `<product-home>/instructions/` are never removed (`uninstall` only `rmdir`s, so a non-empty
   directory is reported preserved).
2. **Restore the vendor surfaces** from `<backup-dir>`: extract `claude-home.tgz` and `codex-home.tgz`
   into `<work>/restore`, `diff -r` each against the live home, and copy back exactly the paths steps
   8 and 10 changed: `~/.claude/CLAUDE.md`, `~/.claude/settings.json`, `~/.claude/rules/`,
   `~/.claude/output-styles/`, the legacy plugin state under `~/.claude/plugins/`, any legacy
   `~/.claude/skills/` link, `~/.codex/AGENTS.md`, `~/.codex/agents/`, and the Codex plugin
   registration. Do not restore whole homes: that would roll back sessions and credentials changed
   since step 2. Re-register the legacy plugin with the vendor's install verb if `plugin list` does
   not show it.
3. **Put the legacy overrides back** where the legacy runtime loaded them, if step 11 moved them.
4. **Restore the scheduled jobs** with step 3's rollback, per label.
5. **The vault stays migrated.** Post-cutover notes are in the product schema. If the legacy tooling
   refuses the migrated schema, `git -C <vault> revert --no-edit <migration-commit>` returns the
   migrated notes to the legacy schema; notes created after the cutover stay in the product schema
   and the legacy lint will report them. Accept that for a rollback; there is no reverse §8 script.
6. **Verify the legacy runtime.** `claude plugin list` shows `<legacy-plugin>`; a new Claude session
   shows the legacy injection; the synthetic `.env` write and the synthetic dangerous command of step
   10 are blocked by the legacy guards; `launchctl print gui/$(id -u)/<legacy-job-label>` shows each job
   loaded (do not kickstart a job that commits or pushes); a Codex session behaves as before.
7. **Record** the date and outcome, then roll forward with step 17.

## Step 19 — Close the cutover and archive the legacy repository

The cutover is complete when step 16 passed, step 18 was exercised once, and the founder then used
Developer OS as the primary runtime for one stable cycle: one full week of daily use in which the
manual weekly run of step 14 happened and no rollback was needed.

Then:

- `<legacy-shared-repo>` is **archived, never deleted**: after Codex hooks land (NEW-104) and the
  legacy Codex hook entries are gone, move the checkout to a local archive location and mark the
  remote repository archived with the host's archive setting. Until NEW-104, it stays in place because
  the Codex hooks run from it.
- `<vault>` is the Brain; it is not archived.
- `<backup-dir>` may be deleted after the stable cycle, once the founder has decided to keep no
  offline copy.
- The three `docs/migration/founder-*.json` result files of program plan Task 8 carry only redacted,
  value-free outcomes (per-step pass/fail, versions, counts), never paths, labels or note content.
