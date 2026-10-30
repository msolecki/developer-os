---
status: current
owner: <name or team>
last-verified: YYYY-MM-DD
---

# After-edit check hook

A `PostToolUse` hook that lints each file the agent edits and shows it only the failures, so a broken
edit is reported in the same turn instead of at the next test run. Optional; one per project, because
the lint command is the project's own.

## Install

1. Save the script as `.claude/hooks/after-edit.sh` and keep only the lines for this project's stack:

   ```sh
   #!/bin/sh
   # PostToolUse on Edit|Write: lint the edited file; exit 2 shows the failures to the agent.
   f=$(jq -r '.tool_input.file_path // empty') || exit 0
   case "$f" in
     *.ts|*.tsx|*.js|*.jsx) out=$(npx --no-install eslint --quiet "$f" 2>&1) ;;
     *.py) out=$(ruff check --quiet "$f" 2>&1) ;;
     *.sh) out=$(shellcheck "$f" 2>&1) ;;
     *) exit 0 ;;
   esac
   rc=$?
   [ "$rc" -eq 0 ] && exit 0
   printf '%s\n' "$out" | head -n 40 >&2
   [ "$(printf '%s\n' "$out" | wc -l)" -gt 40 ] && echo "(cut at 40 lines; run the linter on $f for the rest)" >&2
   exit 2
   ```

2. Add the hook to `.claude/settings.json` (merge into an existing `hooks` key):

   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "Edit|Write",
           "hooks": [
             { "type": "command", "command": "sh \"$CLAUDE_PROJECT_DIR/.claude/hooks/after-edit.sh\"", "timeout": 60 }
           ]
         }
       ]
     }
   }
   ```

3. Commit both files, so every checkout gets the hook.

## Check it

Edit a file so that it breaks a lint rule: the session shows the linter's message after the edit.
Fix it: the next edit shows nothing.

## Keep it fast

- Lint the one file, never the whole project; a whole-project type check belongs to the fast check
  before a commit.
- A missing linter (`npx --no-install` fails) prints its error after every edit of that file type; remove that stack's line rather
  than installing the tool from the hook.
