# Vault template

1. Copy this folder as your Obsidian vault, or merge its folders into an existing vault.
2. In Obsidian, Settings, Core plugins: enable **Bases** and **Templates**. Set the Templates folder to `templates`.
3. Add one line to `~/.claude/CLAUDE.md` (and to `~/.codex/AGENTS.md` if you use Codex):
   `Brain vault: <absolute path to this vault>`
4. Let Claude Code reach the vault: add its path to `permissions.additionalDirectories` in `~/.claude/settings.json`.
5. Open `_views/Inbox.base` to review what agents captured. The full workflow is in `docs/workflow.md`.
6. Delete the example notes when you no longer need them.
