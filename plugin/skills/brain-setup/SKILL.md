---
name: brain-setup
description: Create the user's Obsidian knowledge vault from the developer-os template, or connect an existing vault by adding only the missing pieces, then point Claude Code at it (`Brain vault:` line and `permissions.additionalDirectories`) after the user approves the diff. Use when the user sets up developer-os, has no `Brain vault:` line yet, or says "set up the vault", "create a vault", "connect my vault", "setup brain".
license: MIT
compatibility: "Claude Code"
---

# Brain setup

Template: `${CLAUDE_PLUGIN_ROOT}/vault-template`. If that still reads as a literal `${...}`, the template is `../../vault-template` relative to this skill's base directory. Set `TPL` to that absolute path in every command; the Bash environment does not carry `CLAUDE_PLUGIN_ROOT`.

Config directory: `C="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"`. Edit `$C/CLAUDE.md` and `$C/settings.json` in place (they may be symlinks), never through `mv` or a full rewrite.

## 1. Ask for the path and pick the mode

Ask for the vault's absolute path (expand `~`). If `$C/CLAUDE.md` already has a `Brain vault:` line with another path, show it and ask which one to keep. If the user picks the new path, remember the old one for the report.

- Path missing or an empty directory: **new vault**.
- Path non-empty: ask whether to **connect an existing vault**. If not, stop; never copy into a non-empty directory.

## 2a. New vault

```bash
TPL="/abs/path/to/plugin/vault-template"; V="/abs/path/to/vault"
mkdir -p "$V" && cp -R "$TPL/." "$V/"
```

## 2b. Connect an existing vault

Add only what is missing; never overwrite, move or delete a file. Do not copy the example notes. The `.gitignore` lines are added only to a vault that is a git repository or already has a `.gitignore`.

```bash
TPL="/abs/path/to/plugin/vault-template"; V="/abs/path/to/vault"
for d in DEV INFRA PROJECTS QA TOOLS _archive _inbox _views templates; do mkdir -p "$V/$d"; done
(cd "$TPL" && for f in _views/*.base templates/note.md; do [ -e "$V/$f" ] || cp "$f" "$V/$f"; done)
if [ -e "$V/.git" ] || [ -e "$V/.gitignore" ]; then
  touch "$V/.gitignore"
  while IFS= read -r l; do case "$l" in ''|'#'*) continue;; esac; grep -qxF "$l" "$V/.gitignore" || printf '%s\n' "$l" >> "$V/.gitignore"; done < "$TPL/.gitignore"
fi
```

`.obsidian/types.json`: add only the keys from the template's file that are absent; never change an existing value. If the file is missing, copy the template's. Show the change and apply it after approval, written back with `cat new > file` as in step 3 (set `TPL` and `V` in the same Bash call; existing values win: `jq -s '.[0] * {types: (.[1].types + .[0].types)}' "$V/.obsidian/types.json" "$TPL/.obsidian/types.json"`); ask the user to close Obsidian first, because it rewrites the file while open. Without `jq`, tell the user to set the property types in Obsidian's properties panel.

## 3. Point Claude Code at the vault

Show both edits as a diff and apply them only after the user approves:

- `$C/CLAUDE.md`: append `Brain vault: <V>` (skip if the line is already there).
- `$C/settings.json`: add `<V>` to `permissions.additionalDirectories` (skip if present).

Bash calls do not keep variables: set `C`, `S` and `V` at the top of each call. Preview:

```bash
C="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; S="$C/settings.json"; V="/abs/path/to/vault"
{ cat "$S" 2>/dev/null || echo '{}'; } | jq --arg p "$V" '.permissions.additionalDirectories //= [] | if any(.permissions.additionalDirectories[]; . == $p) then . else .permissions.additionalDirectories += [$p] end' > "$S.brain-setup" && diff -N "$S" "$S.brain-setup"
```

After approval, in a new call:

```bash
C="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; S="$C/settings.json"; V="/abs/path/to/vault"
cat "$S.brain-setup" > "$S" && rm "$S.brain-setup"
# replace an existing Brain vault: line (the user chose the new path in step 1), else append
if grep -q '^Brain vault:' "$C/CLAUDE.md" 2>/dev/null; then t=$(mktemp); V="$V" awk '/^Brain vault:/ { print "Brain vault: " ENVIRON["V"]; next } 1' "$C/CLAUDE.md" > "$t" && cat "$t" > "$C/CLAUDE.md"; rm -f "$t"; else printf '\nBrain vault: %s\n' "$V" >> "$C/CLAUDE.md"; fi
```

On decline: `rm "$S.brain-setup"`.

If `jq` is missing or `settings.json` is not valid JSON, remove `$S.brain-setup`, change nothing else, and show the user the key to add by hand.

## 4. Smoke test

Run the `developer-os:brain-search` skill and give it the vault path `<V>` explicitly (the line just written is not in this session's context): in a new vault search for "webhooks" (it must find `_inbox/process-webhooks-once-per-event-id.md`); in a connected vault search for the topic of one existing note. Then tell the user to open the vault in Obsidian and enable the **Bases** and **Templates** core plugins, with `templates` as the Templates folder. Tell them too that vault upkeep does not run on its own: they run brain-review weekly and brain-garden monthly, and a one-line notice at the start of a new session reminds them when either is due (`DEVELOPER_OS_NOTICES=off` turns it off).

## Stop point

Stop after the smoke test. Report the mode, the vault path, what was created or appended, which config edits were applied or declined, the old vault path still in `permissions.additionalDirectories` (if the path changed; the user removes it by hand), the smoke-test result, and the upkeep cadence.

## Never

- Copy into a non-empty directory in new-vault mode, or overwrite any existing file in the vault (`.obsidian/`, notes, `.gitignore`, `.base` views).
- Edit `CLAUDE.md` or `settings.json` before the user approves the diff, rewrite `settings.json` by hand, or replace either file with `mv`.
- Search the disk for vaults or read notes beyond the smoke test.
