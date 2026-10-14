# Assumptions, constraints and decisions

The premises Developer OS is built on, the constraints it must respect, the decisions that shaped
it, and the limitations it accepts. The full decision log is
[superpowers/DECISIONS.md](../superpowers/DECISIONS.md) (D1 onward); this page is the curated subset
a user, contributor or reviewer needs to understand the product. Where this page and an architecture
note disagree, the note wins.

## 1. Assumptions

| # | Assumption | Consequence if it fails |
|---|---|---|
| AS-1 | The user runs macOS on Apple Silicon or Intel and has Homebrew. | Other platforms are refused with exit 4; `PlatformAdapter.inspect()` is the gate. |
| AS-2 | The user already has Claude Code (≥ 2.1.280), Codex (≥ 0.155.1), or both, installed and authenticated. | `init --adapters` refuses that vendor with `adapter_unavailable`, exit 4. `ingest` and the Brain workflows cannot run without one. |
| AS-3 | One person uses one product home. The machine account is the security principal. | A process running as the same user is outside the security boundary (`SECURITY.md`, [threat-model.md](../architecture/threat-model.md)). There are no multi-user or team features. |
| AS-4 | The user wants knowledge kept local and reviewed by a human before it becomes canonical. | The pipeline deliberately has a manual `review` step; nothing schedules `import` or `ingest`. |
| AS-5 | The vault is ordinary Markdown that the user may also edit in Obsidian or any editor. | Indexes are regenerated, captures may be edited in place, and every write checks that the file did not change since it was read. |
| AS-6 | Vendor CLIs change their surfaces between versions. | Capabilities are detected per installed version, floors are pinned, and observed behaviour is recorded in [vendor-invocation.md](../architecture/vendor-invocation.md) and the [compatibility matrix](../releases/compatibility-matrix.md). |
| AS-7 | Every input the product did not author is hostile: session text, repository files, inbox files, model output, existing configuration, paths, symlinks, plugin metadata. | Redaction before persistence, deterministic validators after every model call, guarded filesystem access, shell-free process execution. |
| AS-8 | The user's own Git authentication is set up when Git sync is enabled. | The product never stores or prompts for a credential; a push that cannot authenticate fails and keeps the local commit. |

## 2. Constraints

### 2.1 Product constraints

- **No product network access.** No module of `apps/` or `packages/` may reach the network; the lint
  gate (`tests/repository/check.ts` — `inspectReleaseAuthoritySurfaces`) and the e2e capability scan
  enforce it.
- **No telemetry, no cloud service, no accounts.**
- **No separate model API.** AI work goes through the installed vendor CLI only.
- **No vendor settings files are written.** The product never writes `~/.claude/settings.json` or the
  Codex `config.toml`; it installs plugins, rule files and one marked block per shared instruction
  file.
- **No credential storage.** Protected paths are refused before they are read.
- **The vault is never modified by `init`** when it already exists, and never deleted by `uninstall`.

### 2.2 Engineering constraints

- TypeScript in `strict` mode, pnpm workspaces, Vitest, Node `>=24.16.0 <25`.
- Every managed write goes through `plan → backup → stage → validate → apply → verify → finalize`.
- Shell code is limited to thin launch adapters; processes are spawned with an argument array, never
  through a shell string.
- Filesystem identities use 64-bit `bigint` stats (D31); the lint gate refuses the lossy spelling.
- Every enumerating gate asserts a non-empty set per scope, so a gate cannot pass vacuously.

### 2.3 Publication and legal constraints

- The repository is public. No private vault content, client name, credential or machine-specific
  absolute path may enter it ([migration/exclusion-policy.md](../migration/exclusion-policy.md)).
- The product was rebuilt clean-room from its own design plus frozen, redacted inputs in
  `docs/migration/`; no build, test or review step reads a legacy repository, and the lint gate
  enforces the boundary.
- Third-party-derived skills are not vendored; they are documented as recommended upstream installs
  (D51).
- License: MIT, approved by the founder with counsel (L1, D103).

## 3. Product decisions

| Decision | What was decided | Why |
|---|---|---|
| Local CLI, macOS first | Version 1 is a local CLI for macOS only. | The founder's platform and `launchd`; Linux can implement the platform interface later. |
| Independent adapters | Claude Code and Codex are separate adapters; either or both may be installed. | Users have one or both; differences are reported in a capability matrix, not hidden. |
| Capture is agent-authored (DOS-P6) | An agent writes the observation in its own words through the `capture` skill. Automatic capture from session transcripts and hooks was declined. | Undocumented transcript formats are not parsed; a stable, reviewable input is safer. |
| `import` and `ingest` stay manual (D47) | No scheduler ingests or imports. | Unattended writes into the vault would bypass review. |
| Tool-free, isolated ingest (D8) | The vendor gets capture text plus a bounded index excerpt, no tools, and an environment isolated from user settings, hooks, MCP servers, rules and history. | The model can only propose; it cannot read the disk or write anything. |
| Legacy surfaces become public defaults (D5) | Every legacy instruction artifact, hook and script became a redacted public default; personal overrides live in the product home. | One product, no parallel private repository. |
| Session-start injection returns as a hook (D6) | The vault map and project note are injected at session start. | Small, deterministic context; full retrieval stays in `brain-search`. |
| Codex hooks are trusted manually (D7) | The product never writes Codex configuration; the user approves the hooks once in Codex. | Codex's trust model belongs to the user. |
| Guards are frozen (D64) | The command guards stop accidental harmful commands, not deliberate evasion. | A line-based guard cannot stop an adversary; more rounds added false blocks. |
| Hooks run no project tool (D102) | `guard format` and `guard stop` allow and run nothing. | A cloned repository's `node_modules` is untrusted code. |
| Scheduled Brain upkeep (D77) | Optional `brain-garden` (one isolated Claude call, at most 8 proposals, into quarantine) and `brain-pulse` (no agent), both off by default. | Keep the vault healthy without letting an unattended model write canonical notes. |
| Distribution-channel trust (D84, D94) | `update` trusts the Homebrew package channel; no product signing key. | A product-owned offline root key added key-management risk for no gain over Homebrew's channel. |
| Releases come only from a green full suite (D95) | CI builds, verifies and publishes a release only from a commit whose full `check.yml` run passed; the tap formula update is a pull request in the tap repository. | The ~4 h suite is the release gate; nothing is rebuilt or published from an unverified commit. |
| Daily use before completeness (D16) | The founder moved to the product as soon as it replaced every daily surface; update, Git, launchd and release followed. | Real use finds real defects earlier. |
| No `.claude/` in this repository | The repository ships no project-level `.claude/` directory. | The repository is public and every fork would inherit it ([migration/exclusion-policy.md](../migration/exclusion-policy.md)). |

## 4. Engineering-process decisions

| Decision | What was decided |
|---|---|
| D17, D32 | Each commit runs `npm run lint` and its focused fast tests. The full `npm run check` (about 4 to 5 hours) runs at plan or phase close and on CI for every push to `development`. |
| D33 | Plan tasks run in parallel in separate worktrees when their declared inputs are integrated; one orchestrator integrates. |
| Reviewer ≠ author | Every code-producing task gets a fresh-context review by an agent that did not write it. |
| Specs are not rewritten silently | A finished spec or plan is deleted after its surviving contract moves into an architecture note; git history is the archive. |

## 5. Accepted residuals

Each architecture note keeps its own list of accepted residuals with the reason. The ones that most
affect day-to-day use:

- **Same-user processes are trusted.** A process running as the user can swap a file between a
  recheck and its use (for example the launchd plist, D82). This is outside the boundary by design.
- **Command guards are line-based.** They stop accidents, not a determined agent; crafted bypasses
  are recorded as residuals in [hooks.md](../architecture/hooks.md) §3.8.
- **Claude `NotebookEdit` is not guarded.** The file matcher is `Edit|Write|MultiEdit`, so a notebook
  edit under a protected segment is not refused (AUD-030).
- **An isolated vendor run still writes into the user's home.** Vendors resolve their home from the
  password database, so stray `~/.claude` files appear after `ingest`; supplying a product-owned
  `HOME` would lose the vendor's credentials (NEW-75).
- **Git push transfers history the product did not stage.** The product stages only its scope, but
  never rewrites history; a path committed by hand can reach the remote.
- **Search does not stem.** Tags and aliases are the mitigation.

## 6. Known limitations

Open rows in [superpowers/BACKLOG.md](../superpowers/BACKLOG.md) §1 that a user can meet:

| Row | Limitation | Workaround |
|---|---|---|
| NEW-247 | Each uninstall and re-init leaves retained bootstrap evidence and tombstones in `state/`; they accumulate and `doctor` warns once per retained run. | None needed for normal use; do not delete them by hand. |
| NEW-248 | A plan-only `git` or `automation` command exits 0, the same as an applied one. | Check `git status` or `automation status` after a scripted run; pass `--apply` to apply. |
| NEW-250 | The ingest prompt does not tell the model that `established` needs a `reviewed` date, so a capture that reads like a settled decision can be refused every run. | Reject and rephrase the capture, or write the note by hand. |
| NEW-211 | An npm-installed `codex` (a Node script) fails the version probe under the launcher's closed environment. | Install the native Codex binary. |
| NEW-104, NEW-127 | Some real-agent hook rows are observed only on a mock model (Codex) or not yet observed (some Claude rows). | — |
| `CLAUDE_CONFIG_DIR` | A non-default Claude configuration directory is not followed; `import --claude-memory` refuses `claude_config_dir_not_followed`. | Use the default `~/.claude`. |
