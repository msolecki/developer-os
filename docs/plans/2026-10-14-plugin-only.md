# Plugin-only developer-os

**Goal:** replace the CLI product (~125k LOC TS, Homebrew, bundled Node, launchd, hooks) with a
Markdown-only plugin: skills, agents, rules, a vault template and a written "how I work: brain +
code" workflow. Installed through the Claude Code plugin marketplace; Codex best-effort.

## Decisions (2026-10-14, user)

- The CLI is removed, not archived as a product. A git tag keeps the history reachable.
- Capture flow: the agent writes to the vault inbox (`status: inbox`); the user reviews in Obsidian
  through a Bases view. No quarantine/review/ingest commands.
- Claude Code first. Codex gets the same `skills/` directory through a manifest or an install script,
  best-effort.
- Release 0.1.0 (Homebrew) is held. The first public release is the plugin.
- `docs/superpowers/` leaves git, stays on disk (already globally gitignored).
- `client-onboarding` is removed from the payload.
- README stays; a separate HTML sales page comes later.
- No custom Obsidian plugin now: Bases, Properties and Templates cover review, status and creation.

## Steps

### 0. Stop the parallel release work · S
- **What:** no session merges to `main` or touches the tap until this plan lands.
- **How:** stop the other session working in this checkout; restore `docs/superpowers/` to disk
  (`git restore --worktree docs/superpowers`), keep it untracked.
- **Test:** `git status` clean apart from the intended change; `ls docs/superpowers` shows the files.

### 1. Retire the installed CLI on the founder machine · S
- **What:** no launchd job, hook or `@import` points at `~/.developer-os` anymore.
- **Where:** `~/Library/LaunchAgents/com.developer-os.*`, `~/.claude/skills/developer-os/`,
  `~/.claude/CLAUDE.md` imports, `~/.codex` plugin entry.
- **How:** `developer-os automation disable --apply`, then `developer-os uninstall`; repoint the global
  `CLAUDE.md` imports to the new plugin rules (step 4) or a local copy.
- **Test:** `launchctl list | grep developer-os` empty; a new Claude session starts without the vault
  map injection and still loads the rules.

### 2. Archive and delete · M
- **What:** tag `archive/cli-v0` at the last CLI commit; delete `apps/`, `packages/`, `tests/`,
  `workflows/`, `templates/schemas/`, TS/pnpm/vitest/eslint tooling, `.github/workflows/release.yml`,
  `docs/architecture/`, `docs/migration/`, `docs/releases/`, `docs/reference/`, CLI tutorials.
- **How:** worktree branch `plugin-only`; `git rm -r`; `git rm -r --cached docs/superpowers`.
- **Test:** `git ls-files | wc -l` drops from ~1040 to under ~80; tag pushed and resolvable.

### 3. Plugin layout · M
- **What:** one plugin, one `skills/` directory shared by both vendors.
- **Where:**
  - `.claude-plugin/marketplace.json` (repo is its own marketplace)
  - `plugin/.claude-plugin/plugin.json` (name, version 0.1.0, description, author, homepage)
  - `plugin/.codex-plugin/plugin.json` → same `skills/`
  - `plugin/skills/`, `plugin/agents/`, `plugin/output-styles/`, `plugin/rules/core.md`
  - `plugin/hooks/hooks.json`: one `SessionStart` hook, `cat "${CLAUDE_PLUGIN_ROOT}/rules/core.md"`,
    no Node.
- **How:** move content from `instructions/`; drop the generated `plugins/claude` and `plugins/codex`
  copies; scoped rules (typescript, nextjs, testing, …) become skills with "use when editing …"
  descriptions.
- **Test:** `claude plugin validate .` passes; `claude --plugin-dir plugin` lists every skill.

### 4. Brain skills rewritten without the CLI · M
- **What:** `brain-search` (rg over the vault, frontmatter-aware), `brain-capture` (write to
  `_inbox/` with `status: inbox`, secret-redaction rule), `brain-review` (summarize the inbox, never
  promote without the user), `brain-garden` (stale/broken-link/duplicate report, proposals only),
  `brain-compile`. Vault path comes from one line in the user's `CLAUDE.md`/`AGENTS.md`.
- **Removed:** ingest, doctor, shared, report, reindex.
- **Test:** on a synthetic vault: capture → note appears in `_inbox/` → shows in `Inbox.base` →
  status changed in Obsidian → `brain-search` finds it.

### 5. Vault template and workflow doc · M
- **What:** `vault-template/` with topic folders, `_inbox/`, `Inbox.base`, `Stale.base`, a note
  template, example notes; `docs/workflow.md`: when to capture, how brain links to project plans,
  folder conventions, daily loop.
- **Test:** open the template in Obsidian; both Bases views render with the example notes.

### 6. Payload cleanup · S
- **What:** remove `client-onboarding`; rename `przeglad-claudemd` → `instruction-review`; move
  `nextjs-removeconsole-…`, `recovering-killed-claude-workflow-results`, `url-construction-silent-footguns`
  into the personal vault (or a private plugin); drop the founder-only clause from the communication rule.
- **Test:** `rg -i 'founder|solkova|przeglad' plugin/` returns nothing.

### 7. Validation, docs, release · S
- **What:** `scripts/check.sh` (`claude plugin validate .`, JSON parse of manifests, gitleaks)
  declared in `CONTRIBUTING.md` as the repository suite; one CI job running it. README install:
  `/plugin marketplace add msolecki/developer-os` + `/plugin install developer-os@developer-os`.
  CHANGELOG restarted. Tap: remove the formula or archive `homebrew-developer-os`.
- **Test:** `scripts/check.sh` green locally and in CI; fresh install from GitHub on a clean profile.

## Open questions

- Codex: plugin manifest vs `install-codex.sh` symlinks — decide in step 3 after testing.
- Tap: delete the formula or archive the whole tap repo (step 7).

## Next action

Step 0: stop the other session in this checkout.
