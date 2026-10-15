# Vault template

The `brain-setup` skill does steps 1, 3 and 4 for you. By hand:

1. Copy this folder as your Obsidian vault, or merge its folders into an existing vault.
   **Merging into an existing vault: do not overwrite your own `.obsidian/` folder**; it holds your
   settings, plugins and themes. Instead, add the three entries from this template's
   `.obsidian/types.json` (`created` and `updated` as `date`, `tags` as `tags`) to your own
   `.obsidian/types.json`, or set those property types in Obsidian's properties panel. Without them,
   `_views/Stale.base` may not compare `updated` as a date.
   If you sync the vault with git, append the lines of this template's `.gitignore` that your own
   `.gitignore` lacks; do not overwrite it. They keep Obsidian's UI state (open tabs, graph view,
   trash) out of commits.
2. In Obsidian, Settings, Core plugins: enable **Bases** and **Templates**. Set the Templates folder to `templates`.
3. Add one line to `~/.claude/CLAUDE.md` (and to `~/.codex/AGENTS.md` if you use Codex):
   `Brain vault: <absolute path to this vault>`
4. Let Claude Code reach the vault: add its path to `permissions.additionalDirectories` in `~/.claude/settings.json`.
5. Open `_views/Inbox.base` to review what agents captured. The full workflow is in
   [docs/workflow.md](https://github.com/msolecki/developer-os/blob/main/docs/workflow.md).
6. Move the example notes to `_archive/` (or delete them) when you no longer need them.
