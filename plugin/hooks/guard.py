#!/usr/bin/env python3
"""PreToolUse guard for Bash, Edit and Write.

Answers "ask" (never "deny") before a dependency install, update or removal with a package argument,
a force push (--force, -f, a +refspec or remote.<name>.push=+; a --force-with-lease alone passes),
`git commit -n`, or any --no-verify, HUSKY=0, LEFTHOOK=0, SKIP= or core.hooksPath in any form, and before a
command that destroys uncommitted or untracked work: `rm` with both a recursive and a force flag,
`git reset --hard`, `git clean -f`, and `git checkout` or `git restore` of `.`, `:/` or `*`. Branch
deletion (`git push --delete`, `git push origin :branch`) and `git stash push -f` pass. Fail-open: anything it cannot parse produces no output and exit 0, so the normal permission
flow applies.

An Edit or Write asks when its `file_path` is a secret or the agent's own user-level config: a `.env` or
`.env.*` file (not `.example`, `.sample`, `.template`, `.dist`), anything under `~/.ssh`, `~/.aws` or
`~/.gnupg`, `~/.claude/settings.json`, `~/.claude/settings.local.json`, or anything under
`~/.claude/hooks` or `~/.claude/rules`.

Inside the read-only agents (code-reviewer, database-reviewer, infra-reviewer, performance-engineer,
security-auditor; `agent_type` with or without the `developer-os:` prefix) a Bash call also asks when it
writes: `sed -i`, `tee`, `rm`, `mv`, `cp`, `truncate`, a git command that changes the tree or history, or a
`>`/`>>` redirect to anything but `/dev/null` or a temp directory.

Quotes are stripped before matching, so `sh -c "pnpm add zod"` asks, and so does a mention such as
`git commit -m "pnpm add zod"`. An extra prompt costs one click; a missed install rewrites the lockfile.
"""
import json
import os
import re
import sys

REASONS = {
    "install": "Dependency install, update or removal rewrites dependencies and the lockfile.",
    "push": "Force push can overwrite others' commits; use --force-with-lease alone.",
    "destroy": "This deletes files or discards uncommitted work that git cannot bring back.",
    "protected": "This file holds secrets or your user-level agent config; edit it only on your request.",
    "readonly": "This agent is read-only, and this command writes files or changes git state.",
    "noverify": "This skips the repository's git hooks (--no-verify, commit -n, HUSKY=0, LEFTHOOK=0, SKIP=, core.hooksPath).",
}
INSTALL = {"i", "in", "ins", "inst", "insta", "instal", "install", "isnt", "isnta", "isntal", "isntall", "it", "add", "a",
           "update", "up", "upgrade", "remove", "rm", "uninstall", "un"}
READ_ONLY = {"code-reviewer", "database-reviewer", "infra-reviewer", "performance-engineer", "security-auditor"}
GIT_WRITE = {"add", "apply", "checkout", "cherry-pick", "commit", "merge", "push", "rebase", "reset", "restore", "stash",
             "switch"}
TEMP = ("/dev/null", "/tmp/", "/private/tmp/", "/var/folders/")
PM_VALUE = {"--filter", "-F", "--prefix", "--dir", "-C"}


def command(raw):
    """tool_input.command, still JSON-escaped; an escaped \\"command\\" inside another value cannot match."""
    text = raw.replace("\n", " ").replace("\r", " ")
    if not re.search(r"\{.*\}", text):
        return ""
    m = re.match(r'.*"command"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
    return m.group(1) if m else ""


def view(cmd, newline, quotes_to_space=False, join_commas=False):
    """JSON-unescape, then delete every backslash and `$`, and either delete quotes (so `np""m`, `\\git`,
    `-\\-force` and `$'-f'` read as the word the shell runs) or turn them into spaces (so a quoted value
    such as `alias.p='push -f'` keeps its words apart). Braces go and commas split words, so a brace
    expansion such as `{-f,}` shows the words it expands to; join_commas drops commas, so `-{,f}` reads `-f`.
    First `$IFS` and any `${IFS...}` become a space, `${X:-word}` its word, the positional parameters
    `$1`-`$9`, `$@` and `$*` (empty in a tool call) nothing, and `\\x66` or `\\146` inside `$'...'` its
    character, so `npm${IFS}i`, `npm$IFS$9i`, `np${X:-m}` and `$'-\\x66'` read `npm i`, `npm i`, `npm` and `-f`."""
    s = re.sub(r"\$\{IFS[^}]*\}|\$IFS", " ", cmd)
    s = re.sub(r"\$\{\w+:?[-+=?]([^}]*)\}", r"\1", s)
    s = re.sub(r"\$(?:[1-9@*]|\{[1-9@*]\})", "", s)
    s = re.sub(r"\$'[^']*'", lambda m: re.sub(r"\\\\(?:x([0-9a-fA-F]{1,2})|([0-7]{1,3}))",
               lambda e: chr(int(e.group(1), 16) if e.group(1) else int(e.group(2), 8)), m.group(0)), s)
    s = re.sub(r"\\\\\\n", " ", s)
    s = re.sub(r"\\n", newline, s)
    s = re.sub(r"\\[rt]", " ", s)
    s = re.sub("[\"']", " " if quotes_to_space else "", s)
    s = re.sub(r"[\\${}]", "", s)
    return s.replace(",", "" if join_commas else " ")


def destroys(x, reset, clean, restore, staged):
    """`git reset --hard`, `git clean` with a force flag, or a `git checkout`/`git restore` of the whole
    tree; `git restore --staged .` only unstages and passes."""
    if reset and x == "--hard":
        return True
    if clean and (x == "--force" or re.fullmatch(r"-[a-zA-Z]*f[a-zA-Z]*", x)):
        return True
    return restore and not staged and x in (".", ":/", "*", "./")


def scan(line):
    """Word scanner: install, push, noverify or destroy for the first hit, None otherwise."""
    for seg in re.split(r"[;&|()`]", line):
        words = [w for w in re.split(r"[ \t\n]+", seg) if w]
        pm = sub = git = push = commit = force = skip = False
        rm = rec = rmf = reset = clean = restore = staged = False
        for i, x in enumerate(words):
            if destroys(x, reset, clean, restore, staged):
                return "destroy"
            if rm and (x == "--recursive" or re.fullmatch(r"-[a-zA-Z]*[rR][a-zA-Z]*", x)):
                rec = True
            if rm and (x == "--force" or re.fullmatch(r"-[a-zA-Z]*f[a-zA-Z]*", x)):
                rmf = True
            if rm and rec and rmf:
                return "destroy"
            if re.search(r"(^|/)rm$", x):
                rm = True
            if git and x == "reset":
                reset = True
            elif git and x == "clean":
                clean = True
            elif git and x in ("checkout", "restore"):
                restore = True
            elif restore and x in ("--staged", "-S"):
                staged = True
            if re.fullmatch(r"--no-veri(f|fy)?", x) or x in ("HUSKY=0", "LEFTHOOK=0") or x.startswith("SKIP=") or re.search(r"core\.hookspath(=|$)", x.lower()):
                return "noverify"
            if re.search(r"(^|/)git$", x):
                git = True
            if skip:
                skip = False
                continue
            if pm and x in PM_VALUE:
                skip = True
                continue
            if sub and (not x.startswith("-") or x == "--latest"):
                return "install"
            # A word right after `run`, `exec` or `dlx` names a script or binary (`npm run up`), unless that
            # word follows a flag and may be its value (`yarn --cwd exec add zod`).
            if pm and x in INSTALL and not (i > 1 and words[i - 1] in ("run", "exec", "dlx") and not words[i - 2].startswith("-")):
                sub = True
            if re.search(r"(^|/)(npm|pnpm|yarn|bun)$", x):
                pm = True
            if git and re.match(r"remote\.[^=]*\.push=\+", x.lower()):
                force = True
            if git and x == "push" and (i == 0 or words[i - 1] != "stash"):
                push = True
            elif git and x == "commit":
                commit = True
            elif push and (x in ("--force", "--mirror") or re.fullmatch(r"-[a-zA-Z]*f[a-zA-Z]*", x) or x.startswith("+")):
                force = True
            elif commit and re.fullmatch(r"-[a-zA-Z]*n[a-zA-Z]*", x):
                return "noverify"
        if force:
            return "push"
    return None


def read_only(raw):
    """True inside one of this plugin's read-only agents; the main session has no agent_type."""
    m = re.search(r'"agent_type"\s*:\s*"([^"]*)"', raw)
    name = m.group(1) if m else ""
    return (name[len("developer-os:"):] if name.startswith("developer-os:") else name) in READ_ONLY


def writes(line):
    """A write-shaped command in any segment: a file-changing binary, a tree- or history-changing git
    subcommand, or a redirect into a file outside /dev/null and the temp directories."""
    for target in re.findall(r"(?<!<)>>?\s*([^\s;&|()<>]*)", line):
        if target and not target.startswith(TEMP):
            return True
    for seg in re.split(r"[;&|()`]", line):
        words = [w for w in re.split(r"[ \t\n]+", seg) if w]
        git = False
        for x in words:
            if re.search(r"(^|/)(tee|rm|mv|cp|truncate)$", x) or (git and x in GIT_WRITE):
                return True
            if re.search(r"(^|/)sed$", x) and any(w == "--in-place" or re.match(r"(-i|--in-place=)", w) for w in words):
                return True
            if re.search(r"(^|/)git$", x):
                git = True
    return False


def protected(path):
    """A secret file or the agent's own user-level config, after expanding `~` and normalizing."""
    p = os.path.normpath(os.path.expanduser(path))
    home = os.path.expanduser("~")
    base = os.path.basename(p)
    if base == ".env" or (base.startswith(".env.") and base.rsplit(".", 1)[1] not in ("example", "sample", "template", "dist")):
        return True
    claude = os.path.join(home, ".claude")
    if p in (os.path.join(claude, "settings.json"), os.path.join(claude, "settings.local.json")):
        return True
    dirs = [os.path.join(home, d) for d in (".ssh", ".aws", ".gnupg")] + [os.path.join(claude, d) for d in ("hooks", "rules")]
    return any(p == d or p.startswith(d + os.sep) for d in dirs)


def ask(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "ask", "permissionDecisionReason": REASONS[reason]}},
        separators=(",", ":")))


def main():
    raw = sys.stdin.buffer.read().decode("utf-8", "replace")
    if re.search(r'"tool_name"\s*:\s*"(Edit|Write)"', raw):
        path = json.loads(raw).get("tool_input", {}).get("file_path")
        if isinstance(path, str) and protected(path):
            ask("protected")
        return
    cmd = command(raw)
    if not cmd:
        return
    # Each way runs with a newline as `;` and as a space: five views, and a hit in any asks.
    # Quotes are not tracked: an extra ask is the price.
    views = [view(cmd, ";"), view(cmd, " "), view(cmd, ";", True), view(cmd, " ", True), view(cmd, " ", join_commas=True)]
    for v in views:
        hit = scan(v)
        if hit:
            ask(hit)
            return
    if read_only(raw) and any(writes(v) for v in views):
        ask("readonly")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
