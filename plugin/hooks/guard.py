#!/usr/bin/env python3
"""PreToolUse guard for Bash, Edit and Write.

Answers "ask" (never "deny") before a dependency install, update or removal with a package argument,
a force push (--force, -f, a +refspec or remote.<name>.push=+; a --force-with-lease alone passes),
`git commit -n`, or any --no-verify, HUSKY=0, LEFTHOOK=0, SKIP= or core.hooksPath in any form, and before a
command that destroys uncommitted or untracked work: `rm` with both a recursive and a force flag,
`git reset --hard`, `git clean -f` (not a dry run), `git checkout -f`, `git switch --discard-changes`,
`git worktree remove --force`, `git stash drop`/`clear`, `find -delete`, and `git checkout` or `git restore` of `.`, `:/` or `*` (an unstage-only restore passes). Branch
deletion (`git push --delete`, `git push origin :branch`) and `git stash push -f` pass. Fail-open: anything it cannot parse produces no output and exit 0, so the normal permission
flow applies.

An Edit or Write asks when its `file_path` is a secret or the agent's own user-level config: a `.env` or
`.env.*` file (not `.example`, `.sample`, `.template`, `.dist`), anything under `~/.ssh`, `~/.aws` or
`~/.gnupg`, `~/.claude.json`, `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.claude/CLAUDE.md`,
or anything under `~/.claude/hooks`, `rules`, `agents`, `skills` or `commands`.

Inside the read-only agents (code-reviewer, database-reviewer, infra-reviewer, performance-engineer,
security-auditor; `agent_type` is `developer-os:<name>`) a Bash call also asks when it writes: a
file-changing binary (unless every path it writes is in a temp directory) or `sed -i` in command
position, a git command that changes state, `gh pr checkout`, a formatter or test run that rewrites files
(`--write`, `--fix`, `--update-snapshots`, `-u` next to a test runner), or a redirect to anything but
`/dev/null`, the standard streams or a temp directory. A redirect inside quotes (`awk '$1>3'`,
`grep "<a>" f`) is not one, unless the shell runs the quoted text (`sh -c "..."`, `"$(...)"`).

A `git commit` that passes every check gets no decision, only a one-line `additionalContext` reminding the
agent to run the project's fast check first; the rule loaded at session start fades in a long session.

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
COMMIT = "Before this commit, run the project's fast check (lint, types, tests of the changed area) if you have not."
READ_ONLY = {"code-reviewer", "database-reviewer", "infra-reviewer", "performance-engineer", "security-auditor"}
GIT_WRITE = {"add", "am", "apply", "checkout", "cherry-pick", "clean", "commit", "merge", "mv", "pull", "push", "rebase",
             "reset", "restore", "revert", "rm", "switch", "update-ref"}
WRITE_BIN = {"tee", "rm", "mv", "cp", "install", "ln", "truncate", "touch", "mkdir", "dd"}
# A word after one of these (and its options) is a command name, as is the first word of a segment.
PRECMD = {"sudo", "xargs", "command", "nohup", "time", "exec", "env", "-exec", "-execdir"}
# Options of a PRECMD word that take a value: the word after one is not the command.
PRE_VALUE = {"sudo": {"-u", "-g", "-h", "-p", "-C", "-D", "-U", "-r", "-t"},
             "xargs": {"-n", "-I", "-P", "-L", "-d", "-s", "-E", "-a"}, "env": {"-u", "-C", "-S"}}
# Flags that make a formatter, linter or test runner rewrite files (`prettier --write`, `eslint --fix`).
FIX_FLAGS = {"--write", "--fix", "--update-snapshots", "--updateSnapshot"}
TEST_RUNNERS = {"test", "jest", "vitest", "playwright"}
# A view reads `$TMPDIR` as `TMPDIR`. ponytail: a relative directory literally named TMPDIR also counts as temp.
TEMP = ("/tmp/", "/private/tmp/", "/var/folders/", "TMPDIR/")
WHOLE_TREE = (".", "./", ":/", "*")
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


def short(x, c):
    """A short-flag cluster such as `-fdx` that contains the letter c."""
    return re.fullmatch(r"-[a-zA-Z]*%s[a-zA-Z]*" % c, x) is not None


def git_subs(words):
    """(subcommand, the words after it) for each `git` in a segment, past its global options."""
    for i, w in enumerate(words):
        if not re.search(r"(^|/)git$", w):
            continue
        rest = words[i + 1:]
        while rest and rest[0].startswith("-"):
            takes = rest[0] in ("-C", "-c", "--git-dir", "--work-tree", "--namespace")
            rest = rest[2:] if takes else rest[1:]
        if rest:
            yield rest[0], rest[1:]


def destroys(words):
    """`git reset --hard`, a forced `git clean` that is not a dry run, `git checkout` of the whole tree or
    with `-f`, `git switch -f`/`--discard-changes`, `git restore` of the whole tree unless it only
    unstages (`--staged` without `--worktree`), `git stash drop`/`clear`, or `find ... -delete`."""
    for sub, rest in git_subs(words):
        whole = any(x in WHOLE_TREE for x in rest)
        force = any(x == "--force" or short(x, "f") for x in rest)
        if sub == "reset" and "--hard" in rest:
            return True
        if sub == "clean" and force and not any(x == "--dry-run" or short(x, "n") for x in rest):
            return True
        if sub == "checkout" and (whole or force):
            return True
        if sub == "switch" and (force or "--discard-changes" in rest):
            return True
        if sub == "stash" and rest[:1] in (["drop"], ["clear"]):
            return True
        if sub == "worktree" and rest[:1] == ["remove"] and force:
            return True
        if sub == "restore" and whole:
            staged = any(x == "--staged" or short(x, "S") for x in rest)
            worktree = any(x == "--worktree" or short(x, "W") for x in rest)
            if worktree or not staged:
                return True
    return any(re.search(r"(^|/)find$", w) for w in words) and "-delete" in words


def scan(line):
    """Word scanner: install, push, noverify or destroy for the first hit, None otherwise."""
    for seg in re.split(r"[;&|()`]", line):
        words = [w for w in re.split(r"[ \t\n]+", seg) if w]
        pm = sub = git = push = commit = force = skip = False
        rm = rec = rmf = ended = False
        if destroys(words):
            return "destroy"
        for i, x in enumerate(words):
            if rm and x == "--":
                ended = True
            if rm and not ended and (x == "--recursive" or re.fullmatch(r"-[a-zA-Z]*[rR][a-zA-Z]*", x)):
                rec = True
            if rm and not ended and (x == "--force" or re.fullmatch(r"-[a-zA-Z]*f[a-zA-Z]*", x)):
                rmf = True
            if rm and rec and rmf:
                return "destroy"
            if re.search(r"(^|/)rm$", x):
                rm = True
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
    """True inside one of this plugin's read-only agents (`developer-os:<name>`); the main session has no
    agent_type."""
    m = re.search(r'"agent_type"\s*:\s*"developer-os:([^"]*)"', raw)
    return bool(m) and m.group(1) in READ_ONLY


def git_writes(sub, rest):
    """A git subcommand that changes the tree, the index, refs or config; listing forms pass."""
    if sub == "apply" and "--apply" not in rest and any(x in ("--check", "--stat", "--numstat", "--summary") for x in rest):
        return False
    if sub in GIT_WRITE:
        return True
    args = [x for x in rest if not x.startswith("-")]
    if sub == "stash":
        return rest[:1] not in (["list"], ["show"])
    if sub == "worktree":
        return rest[:1] in (["add"], ["remove"], ["move"], ["prune"], ["repair"])
    if sub == "remote":
        return rest[:1] in (["add"], ["remove"], ["rm"], ["rename"], ["set-url"], ["set-head"], ["set-branches"], ["prune"])
    if sub == "notes":
        return rest[:1] not in ([], ["list"], ["show"])
    if sub in ("branch", "tag"):
        changes = {"-d", "-D", "-m", "-M", "-c", "-C", "-f", "-a", "-s", "--delete", "--move", "--copy", "--force"}
        lists = {"-l", "--list", "-a", "-r", "--all", "--remotes", "--contains", "--no-contains", "--merged",
                 "--no-merged", "--points-at", "-n", "-v", "-vv", "--show-current", "--sort"}
        flags = [x.split("=")[0] for x in rest if x.startswith("-")]
        return any(f in changes for f in flags if not (sub == "branch" and f == "-a")) or (
            bool(args) and not any(f in lists for f in flags))
    if sub == "config":
        reads = ("--get", "--get-all", "--get-regexp", "--list", "-l", "--show-origin")
        edits = ("--unset", "--unset-all", "--add", "--replace-all", "--rename-section", "--remove-section", "--edit", "-e")
        return not any(x in reads for x in rest) and (len(args) >= 2 or any(x in edits for x in rest))
    return False


def unquoted(cmd):
    """The command, JSON-unescaped, with each single-quoted string replaced by `q`, `<` and `>` blanked in
    each double-quoted one unless it follows `-c` or `eval`, and then quotes, `$` and braces dropped.
    Backslashes are tracked as the shell does. None when the quotes do not balance, when a double-quoted
    string holds `$(...)` or a backtick (its own quotes nest), or when text may be fed to a shell (`<<<`,
    `| sh`): the caller then checks every view."""
    try:
        s = json.loads('"%s"' % cmd)
    except ValueError:
        return None
    if re.search(r"<<<|\|\s*(\S*/)?(ba|z|da|k)?sh(\s|$)", s):
        return None
    out, i = [], 0
    while i < len(s):
        c = s[i]
        if c == "\\":
            out.append(s[i:i + 2])
            i += 2
            continue
        if c == "'":
            j = s.find("'", i + 1)
            if j < 0:
                return None
            out.append("q")
            i = j + 1
            continue
        if c == '"':
            j = i + 1
            while j < len(s) and s[j] != '"':
                j += 2 if s[j] == "\\" else 1
            if j >= len(s):
                return None
            body = s[i + 1:j]
            if "$(" in body or "`" in body:
                return None
            # The shell runs the text after `-c` or `eval`.
            run = re.search(r"(^|\s)(-[a-zA-Z]*c|eval)\s*$", "".join(out))
            out.append(body if run else re.sub(r"[<>]", " ", body))
            i = j + 1
            continue
        out.append(c)
        i += 1
    return re.sub(r"[\"\\${}]", "", "".join(out))


def scratch(path):
    """/dev/null, a standard stream, or a path inside a temp directory, after normalizing."""
    t = os.path.normpath(path)
    return t in ("/dev/null", "/dev/stdout", "/dev/stderr") or t.startswith("/dev/fd/") or (t + "/").startswith(TEMP)


def redirects(line):
    """A redirect (`>`, `>>`, `>|`, `&>`, `>&file`) into a file that is not scratch. `=>` and `->` are not
    redirects."""
    for m in re.finditer(r"(?<![<=-])>[>|]?\s*(&?)([^\s;&|()<>]*)", line):
        target = m.group(2)
        if not target or (m.group(1) and (target.isdigit() or target == "-")):
            continue
        if not scratch(target):
            return True
    return False


def writes(line):
    """A write-shaped command in any segment: a file-changing binary that writes outside scratch or
    `sed -i`/`perl -i` in command position, a git subcommand that changes state, `gh pr checkout`, or a
    formatter or test run that rewrites files (FIX_FLAGS; `-u`/`--update` next to a test runner).
    Command position is the first word of a segment, a word after a PRECMD word and its options (past
    the value of a PRE_VALUE option: `sudo -u x rm`; `command -v` only looks a name up), or one after a
    leading `NAME=value`."""
    for seg in re.split(r"[;&|()`]", line):
        words = [w for w in re.split(r"[ \t\n]+", seg) if w]
        if any(w.split("=")[0] in FIX_FLAGS for w in words) or (
                {"-u", "--update"} & set(words) and TEST_RUNNERS & {w.rsplit("/", 1)[-1] for w in words}):
            return True
        at, pre, value = False, None, False
        for i, x in enumerate(words):
            if value:  # an option's value; the command comes next
                value = False
                continue
            here = at or i == 0
            if x in PRECMD:
                at, pre = True, x
            elif here and pre and x.startswith("-"):
                at = not (pre == "command" and x in ("-v", "-V"))
                value, pre = x in PRE_VALUE.get(pre, ()), pre if at else None
            else:
                at, pre = here and re.fullmatch(r"[A-Za-z_]\w*=.*", x) is not None, None
            if not here:
                continue
            name = x.rsplit("/", 1)[-1]
            if name in WRITE_BIN:
                args = [w for w in words[i + 1:] if not w.startswith("-")]
                if name == "dd":
                    args = [w[3:] for w in args if w.startswith("of=")]
                elif name in ("cp", "mv", "install", "ln"):
                    # `-t dir` names the destination before the sources: ask rather than parse it.
                    if any(w.startswith("--target-directory") or short(w, "t") for w in words[i + 1:]):
                        return True
                    args = args[-1:]
                if not args or not all(scratch(a) for a in args):
                    return True
            if name == "gh" and words[i + 1:i + 3] == ["pr", "checkout"]:
                return True
            if name in ("sed", "perl") and any(
                    w == "--in-place" or w.startswith("--in-place=") or re.match(r"-[a-zA-Z]*i", w) for w in words[i + 1:]):
                return True
        if any(git_writes(sub, rest) for sub, rest in git_subs(words)):
            return True
    return False


def commits(line):
    """`git commit` in any segment: `commit` is git's subcommand, after its global options."""
    for seg in re.split(r"[;&|()`]", line):
        if any(sub == "commit" for sub, _ in git_subs([w for w in re.split(r"[ \t\n]+", seg) if w])):
            return True
    return False


def protected(path):
    """A secret file or the agent's own user-level config, after expanding `~` and resolving links,
    compared without case (macOS volumes ignore it)."""
    p = os.path.realpath(os.path.expanduser(path)).lower()
    home = os.path.realpath(os.path.expanduser("~")).lower()
    base = os.path.basename(p)
    if base == ".env" or (base.startswith(".env.") and base.rsplit(".", 1)[1] not in ("example", "sample", "template", "dist")):
        return True
    claude = os.path.join(home, ".claude")
    if p in (os.path.join(home, ".claude.json"), os.path.join(claude, "settings.json"), os.path.join(claude, "settings.local.json"),
             os.path.join(claude, "claude.md")):
        return True
    dirs = [os.path.join(home, d) for d in (".ssh", ".aws", ".gnupg")] + [
        os.path.join(claude, d) for d in ("hooks", "rules", "agents", "skills", "commands")]
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
    # A redirect inside quotes is a program's text (`awk '$1>3'`); unbalanced quotes check every view.
    u = unquoted(cmd)
    redirect = redirects(u) if u is not None else any(redirects(v) for v in views)
    if read_only(raw) and (redirect or any(writes(v) for v in views)):
        ask("readonly")
    elif any(commits(v) for v in views):
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": COMMIT}},
                         separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
