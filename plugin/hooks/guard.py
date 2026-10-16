#!/usr/bin/env python3
"""PreToolUse guard for Bash.

Answers "ask" (never "deny") before a dependency install with a package argument, a force push
(--force, -f or a +refspec; a --force-with-lease alone passes), `git commit -n`, or any --no-verify,
HUSKY=0 or core.hooksPath in any form. Branch deletion (`git push --delete`, `git push origin :branch`)
passes. Fail-open: anything it cannot parse produces no output and exit 0, so the normal permission
flow applies.

Quotes are stripped before matching, so `sh -c "pnpm add zod"` asks, and so does a mention such as
`git commit -m "pnpm add zod"`. An extra prompt costs one click; a missed install rewrites the lockfile.
"""
import json
import re
import sys

REASONS = {
    "install": "Dependency install rewrites dependencies and the lockfile.",
    "push": "Force push can overwrite others' commits; use --force-with-lease alone.",
    "noverify": "This skips the repository's git hooks (--no-verify, commit -n, HUSKY=0, core.hooksPath).",
}
INSTALL = {"i", "in", "ins", "inst", "insta", "instal", "install", "isnt", "isnta", "isntal", "isntall", "it", "add"}
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
    expansion such as `{-f,}` shows the words it expands to; join_commas drops commas, so `-{,f}` reads `-f`."""
    s = re.sub(r"\\\\\\n", " ", cmd)
    s = re.sub(r"\\n", newline, s)
    s = re.sub(r"\\[rt]", " ", s)
    s = re.sub("[\"']", " " if quotes_to_space else "", s)
    s = re.sub(r"[\\${}]", "", s)
    return s.replace(",", "" if join_commas else " ")


def scan(line):
    """Word scanner: install, push or noverify for the first hit, None otherwise."""
    for seg in re.split(r"[;&|()`]", line):
        words = [w for w in re.split(r"[ \t\n]+", seg) if w]
        pm = sub = git = push = commit = force = skip = False
        for x in words:
            if re.fullmatch(r"--no-veri(f|fy)?", x) or x == "HUSKY=0" or re.search(r"core\.hookspath(=|$)", x.lower()):
                return "noverify"
            if re.search(r"(^|/)git$", x):
                git = True
            if skip:
                skip = False
                continue
            if pm and x in PM_VALUE:
                skip = True
                continue
            if sub and not x.startswith("-"):
                return "install"
            if pm and x in INSTALL:
                sub = True
            if re.search(r"(^|/)(npm|pnpm|yarn|bun)$", x):
                pm = True
            if git and x == "push":
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


def main():
    cmd = command(sys.stdin.buffer.read().decode("utf-8", "replace"))
    if not cmd:
        return
    # Each way runs with a newline as `;` and as a space: five views, and a hit in any asks.
    # Quotes are not tracked: an extra ask is the price.
    views = [view(cmd, ";"), view(cmd, " "), view(cmd, ";", True), view(cmd, " ", True), view(cmd, " ", join_commas=True)]
    for v in views:
        hit = scan(v)
        if hit:
            print(json.dumps({"hookSpecificOutput": {
                "hookEventName": "PreToolUse", "permissionDecision": "ask", "permissionDecisionReason": REASONS[hit]}},
                separators=(",", ":")))
            return


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
