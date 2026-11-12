#!/usr/bin/env python3
"""PreToolUse guard for Bash, Edit, Write and MultiEdit.

Answers "ask" (never "deny") before a dependency install, update or removal with a package argument
(npm, pnpm, yarn, bun; in command position also the PKG table, pip to gem, `python -m pip install`, and `npx -y`),
a force push (--force, -f, a +refspec or remote.<name>.push=+; a --force-with-lease alone passes),
`git commit -n`, or any --no-verify, HUSKY=0, LEFTHOOK=0, SKIP= or core.hooksPath in any form, and before a
command that destroys uncommitted or untracked work: `rm` with both a recursive and a force flag,
`git reset --hard`, `git clean -f` (not a dry run), `git checkout -f`, `git switch --discard-changes`,
`git worktree remove --force`, `git rm -f`, `git stash drop`/`clear`, `find -delete`, and `git checkout` or `git restore` of `.`, `:/` or `*` (an unstage-only restore passes),
each in command position (starts), so a mention such as `grep -rn "rm -rf"` passes. Branch
deletion (`git push --delete`, `git push origin :branch`) and `git stash push -f` pass. It also asks before an
infrastructure, data or deploy destroy from the closed INFRA list (`terraform destroy`, `prisma migrate reset`,
`kubectl delete`, `vercel --prod`, ...), in command position or after a runner such as `npx`. Fail-open: anything it cannot parse produces no output and exit 0, so the normal permission
flow applies.

Five more classes, each in command position, so a mention in `grep` or `echo` passes (classes(), drops_data(),
runs_download()): a cloud delete (`aws <service> delete-*`/`terminate-*`, `aws s3 rm --recursive`, `aws s3 rb`,
`gcloud ... delete`, `az ... delete`; an aws dry run passes); a database drop (`psql`, `mysql`, `mariadb` or
`sqlite3` in a line that holds `DROP` or `TRUNCATE` as a word, `redis-cli FLUSHALL`/`FLUSHDB`); a Docker cleanup
(`docker system prune`, `docker volume rm`/`prune`); a publish, merge or remote delete (`npm`/`pnpm`/`yarn publish`,
`cargo publish`, `twine upload`, `gem push`, `gh repo delete`, `gh release create`/`delete`, `gh pr merge`; a
`--dry-run` of npm, pnpm, yarn or cargo passes; `git push --mirror` is a force push); and a downloaded script run
unread (`curl`/`wget` piped into a shell, or inside `$(...)`/`<(...)` handed to a shell or `eval`).

An Edit, Write or MultiEdit asks when its `file_path` is a secret or the agent's own user-level config: a `.env`,
`.envrc`, `.env.*` or `.envrc.*` file (not `.example`, `.sample`, `.template`, `.dist`), anything under `~/.ssh`, `~/.aws`,
`~/.gnupg`, `~/.kube` or `~/.config/gh`, `~/.npmrc`, `~/.pypirc`, `~/.git-credentials`, `~/.docker/config.json`,
`~/.claude.json`, `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.claude/CLAUDE.md`,
or anything under `~/.claude/hooks`, `rules`, `agents`, `skills`, `commands`, `plugins` or `output-styles`; the same files under
`$CLAUDE_CONFIG_DIR` when it is set. A change to a test file (TEST_PATH) asks when it adds skip or focus
markers (SKIP_MARK, see skips_added()), and so does `rm`/`git rm` of one or `mv` of one to
`.bak`, `.disabled` or `.skip`. When the hook input's `cwd` is inside a linked git worktree, an Edit, Write or
MultiEdit also asks before a `file_path` in another worktree of the same repository, the main checkout or a
sibling (other_worktree()); a session in the main checkout is never asked for it.

A project can add questions, never remove one: `.claude/developer-os-guard.json` at the project root (the git
top level above `cwd`) holds `{"ask": [{"command": ["make", "deploy"]}, {"path": "infra/prod/**"}]}`, literal
command word prefixes and path globs only (project_rules()). A hit asks with one fixed reason, so no text of the
repository reaches the model; a file that is malformed in any way adds nothing. Editing that file asks too.

Every ask is appended to `${CLAUDE_PLUGIN_DATA}/guard/asks.jsonl` (log()): time, reason key, rule name and tool,
never the command or the path. The ask is printed first; a log that cannot be written changes nothing.

Inside the read-only agents (code-reviewer, database-reviewer, dependency-upgrader, infra-reviewer,
performance-engineer, security-auditor; `agent_type` is `developer-os:<name>`) a Bash call also asks when it writes: a
file-changing binary (unless every path it writes is in a temp directory; `patch` always) or `sed -i` in command
position, a git command in command position that changes state or writes an output file, `gh pr checkout`, a formatter or test run that rewrites files
(`--write`, `--fix`, `--update-snapshots`, `-u` next to a test runner), or a redirect to anything but
`/dev/null`, the standard streams or a temp directory. A redirect inside quotes (`awk '$1>3'`,
`grep "<a>" f`, `python3 -c "print(1>2)"`) is not one, unless the shell runs the quoted text
(`sh -c "..."`, `eval "..."`, `"$(...)"`). `chmod`, `chown` and `chgrp` write too.

A `git commit` that passes every check gets no decision, only a one-line `additionalContext` reminding the
agent to run the project's fast check first; the rule loaded at session start fades in a long session.

Quotes are stripped before matching, so `sh -c "pnpm add zod"` asks, and so does a mention such as
`echo "pnpm add zod"`: install, push and hook-bypass words count anywhere, except in a quoted commit
message (`-m "..."`, or `-m "$(cat <<'EOF' ... EOF\\n)"`, see messages()). An extra prompt costs one click; a missed install rewrites the lockfile.
"""
import json
import os
import re
import subprocess
import sys
import time

REASONS = {
    "cloud": "This deletes cloud resources that git cannot bring back; list them first (describe, ls), name one resource, or use the tool's dry run (--dryrun, --dry-run).",
    "data": "This drops or empties database data; take a backup first, or run it against a named scratch database.",
    "containers": "This removes Docker volumes or unused data of every project on this machine; list first (docker volume ls, docker system df) and name one volume.",
    "publish": "This publishes, merges or deletes on a registry or remote, where it cannot be taken back; use --dry-run where the tool has one, or leave the step to the user.",
    "remote-code": "This runs a downloaded script that nobody has read; download it to a file, read it, then run it.",
    "worktree": "This writes into another worktree of this repository (the main checkout or a sibling); write inside your own worktree.",
    "rules": "This file holds the project's guard rules; change it only on your request.",
    "project": "This project asks before this command or path.",
    "slow": "This command is too long for the guard to check in time; read it before running it.",
    "install": "Dependency install, update or removal rewrites dependencies and the lockfile.",
    "push": "Force push can overwrite others' commits; use --force-with-lease alone.",
    "destroy": "This deletes files or discards uncommitted work that git cannot bring back.",
    "protected": "This file holds secrets or your user-level agent config; edit it only on your request.",
    "readonly": "This agent is read-only, and this command writes files or changes git state.",
    "noverify": "This skips the repository's git hooks (--no-verify, commit -n, HUSKY=0, LEFTHOOK=0, SKIP=, core.hooksPath).",
    "infra": "This destroys infrastructure or data, or deploys to production; git cannot bring it back.",
    "tests": "This skips, focuses or removes a test; do not delete or skip tests to make a build pass.",
}
INSTALL = {"i", "in", "ins", "inst", "insta", "instal", "install", "isnt", "isnta", "isntal", "isntall", "it", "add", "a",
           "update", "up", "upgrade", "remove", "rm", "uninstall", "un"}
COMMIT = "Before this commit, run the project's fast check (lint, types, tests of the changed area) if you have not."
READ_ONLY = {"code-reviewer", "database-reviewer", "dependency-upgrader", "infra-reviewer", "performance-engineer",
             "security-auditor"}
GIT_WRITE = {"add", "am", "apply", "checkout", "cherry-pick", "clean", "clone", "commit", "gc", "init", "merge",
             "mv", "prune", "pull", "push", "rebase", "reset", "restore", "revert", "rm", "sparse-checkout",
             "switch", "update-ref"}
WRITE_BIN = {"tee", "rm", "mv", "cp", "install", "ln", "truncate", "touch", "mkdir", "dd", "unlink", "rmdir", "patch",
             "chmod", "chown", "chgrp"}
# A word after one of these (and its options) is a command name, as is the first word of a segment.
PRECMD = {"builtin", "sudo", "doas", "xargs", "command", "nohup", "time", "timeout", "nice", "ionice", "stdbuf", "exec", "env",
          "eval", "watch", "setsid", "flock", "strace", "unshare", "chroot", "busybox", "parallel", "-exec", "-execdir"}
# PRECMD words whose first non-option word is a value, not the command (`timeout 5 rm`, `flock /tmp/l rm`).
POSITIONAL = {"timeout", "flock", "chroot"}
# Shell keywords that start a command; a keyword only in command position (`grep -rn do rm` is no command).
KEYWORDS = {"if", "then", "else", "elif", "while", "until", "do", "!"}
# A shell (or `su`) before `-c` or a cluster with c (`-lc`, `-cl`): the next word is the script it runs.
SHELL = r"(^|/)((ba|z|da|k)?sh|su)$"
# Options of a PRECMD word that take a value: the word after one is not the command.
PRE_VALUE = {"sudo": {"-u", "-g", "-h", "-p", "-C", "-D", "-U", "-r", "-t"}, "doas": {"-u", "-C"},
             "xargs": {"-n", "-I", "-P", "-L", "-d", "-s", "-E", "-a"}, "env": {"-u", "-C", "-S"},
             "timeout": {"-s", "-k", "--signal", "--kill-after"}, "nice": {"-n", "--adjustment"},
             "stdbuf": {"-i", "-o", "-e"}, "ionice": {"-c", "-n", "-p"}, "watch": {"-n", "--interval"},
             "strace": {"-o", "-e", "-p", "-s", "-u"}, "exec": {"-a"}, "flock": {"-w", "-E"}}
# Flags that make a formatter, linter or test runner rewrite files (`prettier --write`, `eslint --fix`).
FIX_FLAGS = {"--write", "--fix", "--update-snapshots", "--updateSnapshot"}
TEST_RUNNERS = {"test", "jest", "vitest", "playwright"}
# A view reads `$TMPDIR` as `TMPDIR`. ponytail: a relative directory literally named TMPDIR also counts as temp.
TEMP = ("/tmp/", "/private/tmp/", "/var/folders/", "TMPDIR/")
WHOLE_TREE = (".", "./", ":/", "*")
PM_VALUE = {"--filter", "-F", "--prefix", "--dir", "-C"}
# `git fetch` options whose value is the next word, so it is neither the remote nor a refspec.
FETCH_VALUE = {"--depth", "--deepen", "--shallow-since", "--shallow-exclude", "-j", "--jobs", "--negotiation-tip",
               "--server-option", "-o", "--upload-pack", "--refmap", "--recurse-submodules-default", "--filter"}


def command(raw):
    """tool_input.command, still JSON-escaped; an escaped \\"command\\" inside another value cannot match."""
    text = raw.replace("\n", " ").replace("\r", " ")
    if not re.search(r"\{.*\}", text):
        return ""
    m = re.match(r'.*"command"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
    return m.group(1) if m else ""


def view(cmd, newline, quotes_to_space=False, join_commas=False, shell_ws=False):
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
    # One pass over the JSON escape pairs, so the shell's `\rm` (JSON `\\rm`) is not read as `\r` + `m`.
    # With shell_ws, the shell's own `\n`, `\r`, `\t` (JSON `\\n`) also break or space, as `$'ls\nrm'`,
    # `printf 'ls\nrm' | sh` or `eval` would run them; the caller checks both readings.
    esc = {None: " ", "n": newline, "r": " ", "t": " "}  # None: a backslash-newline continuation
    s = re.sub(r"(\\\\\\n)|\\\\([nrt])|\\(.)", lambda m: " " if m.group(1) else (
        (esc[m.group(2)] if shell_ws else m.group(0)) if m.group(2) else esc.get(m.group(3), m.group(0))), s)
    s = re.sub("[\"']", " " if quotes_to_space else "", s)
    s = re.sub(r"[\\${}]", "", s)
    return s.replace(",", "" if join_commas else " ")


def short(x, c):
    """A short-flag cluster such as `-fdx` that contains the letter c."""
    return re.fullmatch(r"-[a-zA-Z]*%s[a-zA-Z]*" % c, x) is not None


def starts(words):
    """Indices of the words in command position: the first word of a segment, a word after a PRECMD word
    that is itself in command position (`-exec` anywhere; matched by its name, so `/usr/bin/env` counts,
    and `echo watch rm` is no command) and its options (past the value of a PRE_VALUE option:
    `sudo -u x rm`; past the first operand of a POSITIONAL word, `timeout 5 -- rm`;
    `command -v` only looks a name up), after a keyword in command position (`then rm`), after a shell's
    `-c` (`sh -c "rm -rf x"` once quotes are dropped), or after a leading `NAME=value`. A word anywhere
    else is an argument, so a mention (`grep -rn "git add"`, `-m "rm -rf"`) is not a command."""
    out, at, pre, value, shell = [], False, None, False, False
    for i, x in enumerate(words):
        here = at or i == 0
        if here:
            out.append(i)
        if value:  # an option's value, or the command when a view dropped it (`xargs -I{} rm`); either may come next
            value = False
        elif (x.rsplit("/", 1)[-1] in PRECMD and (here or x in ("-exec", "-execdir"))) or (here and x in KEYWORDS) or (
                shell and re.fullmatch(r"-[a-zA-Z]*c[a-zA-Z]*", x)):
            at, pre = True, x.rsplit("/", 1)[-1]
        elif here and pre and x.startswith("-"):
            at = not (pre == "command" and x in ("-v", "-V"))
            value, pre = x in PRE_VALUE.get(pre, ()), pre if at else None
        elif here and pre in POSITIONAL:
            pre = "-"  # the operand is taken; a `--` may still follow
        else:
            at, pre = here and re.fullmatch(r"[A-Za-z_]\w*=.*", x) is not None, None
        shell = shell or re.search(SHELL, x) is not None  # a shell word before a later `-c`
    return out


def long(x, name):
    """`x` is `name` or a prefix of it git (or GNU rm) accepts as an abbreviation (`--ha` for `--hard`)."""
    return len(x) >= 4 and name.startswith(x)


def git_subs(words, pos=None):
    """(subcommand, the words after it) for each `git` in a segment, past its global options; with pos,
    only a `git` at one of those indices."""
    for i, w in enumerate(words):
        if (pos is not None and i not in pos) or not re.search(r"(^|/)git$", w):
            continue
        j = i + 1  # by index: slicing per option is quadratic on `git -c a=b -c a=b ...`
        while j < len(words) and words[j].startswith("-"):
            j += 2 if words[j] in ("-C", "-c", "--git-dir", "--work-tree", "--namespace") else 1
        if j < len(words):
            yield words[j], words[j + 1:]


def destroys(words):
    """`git reset --hard`, a forced `git clean` that is not a dry run, `git checkout` of the whole tree or
    with `-f`, `git switch -f`/`--discard-changes`, `git restore` of the whole tree unless it only
    unstages (`--staged` without `--worktree`), `git rm -f`, `git stash drop`/`clear`, or `find ... -delete`;
    each in command position."""
    pos = starts(words)
    for sub, rest in git_subs(words, pos):
        whole = any(x in WHOLE_TREE for x in rest)
        force = any(long(x, "--force") or short(x, "f") for x in rest)
        if sub == "reset" and any(long(x, "--hard") for x in rest):
            return True
        if sub == "clean" and force and not any(long(x, "--dry-run") or short(x, "n") for x in rest):
            return True
        if sub == "checkout" and (whole or force):
            return True
        if sub == "switch" and (force or any(long(x, "--discard-changes") for x in rest)):
            return True
        if sub == "rm" and force:  # `-f` removes files with uncommitted changes
            return True
        if sub == "stash" and rest[:1] in (["drop"], ["clear"]):
            return True
        if sub == "worktree" and rest[:1] == ["remove"] and force:
            return True
        if sub == "restore" and whole:
            staged = any(x == "--staged" or short(x, "S") for x in rest)
            worktree = any(long(x, "--worktree") or short(x, "W") for x in rest)
            if worktree or not staged:
                return True
    return any(re.search(r"(^|/)find$", words[i]) for i in pos) and "-delete" in words


# Other package managers: (manager, its subcommand words); a non-dash word after them is a package.
PKG = [("pip", ("install",)), ("pip3", ("install",)), ("uv", ("add",)), ("uv", ("pip", "install")),
       ("poetry", ("add",)), ("cargo", ("add",)), ("cargo", ("install",)), ("go", ("get",)),
       ("go", ("install",)), ("composer", ("require",)), ("bundle", ("add",)), ("gem", ("install",))]
# Option values that name a requirements or constraints file, not a package.
PKG_VALUE = {"-r", "--requirement", "-c", "--constraint"}


def installs(words):
    """A PKG manager with its subcommand and a package, or `npx -y`/`--yes` with one, in command position."""
    for i in starts(words):
        name, rest = words[i].rsplit("/", 1)[-1], words[i + 1:]
        ops = [x for k, x in enumerate(rest) if not x.startswith("-") and (k == 0 or rest[k - 1] not in PKG_VALUE)]
        if name == "npx" and ops and any(x in ("-y", "--yes") for x in rest):
            return True
        if any(name == m and tuple(ops[:len(s)]) == s and len(ops) > len(s) for m, s in PKG):
            return True
        if re.fullmatch(r"python[\d.]*", name):
            # Interpreter options before -m, up to `--`. In a short-option cluster the first m, X or W decides:
            # m takes the rest as its module (`-Im pip`, `-mpip`), X and W take it as their value, or the next word.
            j, mod = 0, None
            while j < len(rest) and rest[j].startswith("-") and rest[j] != "--":
                opt = re.fullmatch(r"-[A-Za-z]*?([mXW])(\S*)", rest[j])
                if opt and opt.group(1) == "m":
                    mod = opt
                    break
                j += 2 if opt and not opt.group(2) else 1
            if mod:
                sub = ([mod.group(2)] if mod.group(2) else []) + rest[j + 1:]
                ops = [x for k, x in enumerate(sub) if not x.startswith("-") and (k == 0 or sub[k - 1] not in PKG_VALUE)]
                if ops[:1] in (["pip"], ["pip3"]) and ops[1:2] == ["install"] and len(ops) > 2:
                    return True
    return False


# (command, subcommand words in a row among its non-dash words, flags of which one must be present or None).
INFRA = [(t, s, f) for t in ("terraform", "tofu") for s, f in (
    (("destroy",), None), (("apply",), {"-auto-approve", "--auto-approve"}), (("state", "rm"), None))] + [
    ("prisma", ("migrate", "reset"), None), ("supabase", ("db", "reset"), None), ("drizzle-kit", ("push",), {"--force"}),
    ("artisan", ("migrate:fresh",), None), ("artisan", ("migrate:reset",), None), ("artisan", ("db:wipe",), None),
    ("rails", ("db:drop",), None), ("rails", ("db:reset",), None), ("dropdb", (), None),
    ("docker", ("compose", "down"), {"-v", "--volumes"}), ("docker-compose", ("down",), {"-v", "--volumes"}),
    ("kubectl", ("delete",), None), ("helm", ("uninstall",), None), ("vercel", (), {"--prod"})]
# Words that run the next word as the command (`npx prisma`, `pnpm exec prisma`, `php artisan`, `bundle exec rails`).
RUNNERS = {"npx", "bunx", "pnpx", "pnpm", "yarn", "bun", "php", "bundle", "exec", "dlx"}
# Options whose value is the next word, so it does not split a subcommand (`docker compose -f a.yml down`).
INFRA_VALUE = {"-f", "--file", "-p", "--project-name", "--project-directory", "--env-file", "--profile", "-c",
               "--context", "-H", "--host"}


def infra(words):
    """A command from INFRA in command position, also after RUNNERS."""
    for i in starts(words):
        while i < len(words) and words[i].rsplit("/", 1)[-1] in RUNNERS:
            i += 1
            while i < len(words) and words[i].startswith("-"):
                i += 1
        if i >= len(words):
            continue
        name, rest = words[i].rsplit("/", 1)[-1], words[i + 1:]
        ops = [x for k, x in enumerate(rest) if not x.startswith("-") and (k == 0 or rest[k - 1] not in INFRA_VALUE)]
        flags = {x.split("=")[0] for x in rest if x.startswith("-")}
        for cmd, sub, need in INFRA:
            n = len(sub)
            if name == cmd and any(tuple(ops[k:k + n]) == sub for k in range(len(ops) - n + 1)) and (need is None or need & flags):
                return True
    return False


# Closed table: (command, the first operand words, REASONS key, rule name for the ask log). The words are a prefix
# of the operands, past option values (CLI_VALUE), so `gh pr list --search merge` is no merge.
CLASSES = [
    ("docker", ("system", "prune"), "containers", "docker-system-prune"),
    ("docker", ("volume", "rm"), "containers", "docker-volume-rm"),
    ("docker", ("volume", "remove"), "containers", "docker-volume-rm"),
    ("docker", ("volume", "prune"), "containers", "docker-volume-prune"),
    ("npm", ("publish",), "publish", "npm-publish"), ("pnpm", ("publish",), "publish", "npm-publish"),
    ("yarn", ("publish",), "publish", "npm-publish"), ("yarn", ("npm", "publish"), "publish", "npm-publish"),
    ("cargo", ("publish",), "publish", "cargo-publish"), ("twine", ("upload",), "publish", "twine-upload"),
    ("gem", ("push",), "publish", "gem-push"), ("gh", ("repo", "delete"), "publish", "gh-repo-delete"),
    ("gh", ("release", "create"), "publish", "gh-release-create"),
    ("gh", ("release", "delete"), "publish", "gh-release-delete"), ("gh", ("pr", "merge"), "publish", "gh-pr-merge"),
    ("aws", ("s3", "rb"), "cloud", "aws-s3-rb"),
    ("npm", ("unpublish",), "publish", "npm-unpublish"), ("npm", ("deprecate",), "publish", "npm-deprecate")]
# Options whose value is the next word, per command, so the value is not read as a subcommand.
CLI_VALUE = {"docker": {"-H", "--host", "-c", "--context", "--config", "-l", "--log-level"}, "gh": {"-R", "--repo"},
             "aws": {"--profile", "--region", "--output", "--endpoint-url", "--color", "--ca-bundle", "--query",
                     "--cli-read-timeout", "--cli-connect-timeout"},
             "npm": PM_VALUE | {"--registry", "--tag", "--otp", "--access", "-w", "--workspace"},
             "pnpm": PM_VALUE | {"--registry", "--tag", "--otp", "--access"},
             "yarn": {"--cwd", "--registry", "--tag", "--otp", "--access"}}
# Commands whose dry run changes nothing, so it passes.
DRY_RUN = {"npm", "pnpm", "yarn", "cargo", "aws"}
DB_CLIENTS = {"psql", "mysql", "mariadb", "sqlite3"}
# `drop` or `truncate` as a word of its own: not `dropbox`, `drop.sql`, `--add-drop-table`.
SQL_DROP = re.compile(r"(?<![\w.-])(?:drop|truncate)(?![\w.-])", re.I)
FETCHERS = {"curl", "wget"}
RUN_SHELL = re.compile(r"(ba|z|da|k)?sh")
RUN_INTERP = re.compile(r"python[0-9.]*|perl|ruby|node|php")


def classes(words):
    """(REASONS key, rule name) for a command from CLASSES or one of the cloud and redis forms below, in command
    position; None otherwise. A dry run of a DRY_RUN command passes."""
    for i in starts(words):
        name, rest = words[i].rsplit("/", 1)[-1], words[i + 1:]
        values = CLI_VALUE.get(name, ())
        ops = [x for k, x in enumerate(rest) if not x.startswith("-") and (k == 0 or rest[k - 1] not in values)]
        flags = {x.split("=")[0] for x in rest if x.startswith("-")}
        # `--dry-run=false` is no dry run.
        dry = any(x.split("=")[0] in ("--dry-run", "--dryrun") and x.split("=")[-1].lower() not in ("false", "0", "no")
                  for x in rest)
        if name in DRY_RUN and dry:
            continue
        for cmd, sub, reason, rule in CLASSES:
            if name == cmd and tuple(ops[:len(sub)]) == sub:
                return reason, rule
        if name == "yarn" and ops[:1] == ["workspace"] and ops[2:3] == ["publish"]:
            return "publish", "npm-publish"
        if name == "aws" and ops[:2] == ["s3", "rm"] and "--recursive" in flags:
            return "cloud", "aws-s3-rm"
        if name == "aws" and ops[:2] == ["s3", "sync"] and "--delete" in flags:
            return "cloud", "aws-s3-sync-delete"
        if name == "aws" and ops[1:2] and re.match(r"(batch-)?(delete|terminate)-", ops[1]):
            return "cloud", "aws-delete"
        recursive = any(re.fullmatch(r"-[a-zA-Z]*[rR][a-zA-Z]*|--recursive", x) for x in rest)
        if name == "gsutil" and ("rb" in ops or ("rm" in ops and recursive)):
            return "cloud", "gsutil-rm"
        if name == "gcloud" and ops[:2] == ["storage", "rm"] and recursive:
            return "cloud", "gcloud-storage-rm"
        if re.fullmatch(r"python[0-9.]*", name) and rest[:3] == ["-m", "twine", "upload"]:
            return "publish", "twine-upload"
        if name == "gh" and ops[:1] == ["api"] and re.search(
                r"(?:^| )(?:-X ?|--method[ =])DELETE(?: |$)", " ".join(rest), re.I):
            return "publish", "gh-api-delete"
        if name == "gcloud" and "delete" in ops:
            return "cloud", "gcloud-delete"
        if name == "az" and any(x == "delete" or x.startswith("delete-") for x in ops):
            return "cloud", "az-delete"
        if name == "redis-cli" and any(x.upper() in ("FLUSHALL", "FLUSHDB") for x in rest):
            return "data", "redis-flush"
    return None


def drops_data(line):
    """A database client in command position anywhere in the line and `DROP` or `TRUNCATE` as a word anywhere in
    it: the statement may sit in `-c`, after a `;` inside it, or come through a pipe."""
    if not SQL_DROP.search(line):
        return False
    for seg in re.split(r"[;&|()`]", line):
        words = [w for w in re.split(r"[ \t\n]+", seg) if w]
        if any(words[i].rsplit("/", 1)[-1] in DB_CLIENTS for i in starts(words)):
            return True
    return False


def runs_download(line):
    """`curl` or `wget` in command position piped, directly or through other commands, into a shell in command
    position (`curl u | sudo bash`), or run inside `$(...)` or `<(...)` handed to a shell or `eval`
    (`sh -c "$(curl u)"`, `bash <(curl u)`). `||` is no pipe."""
    parts = re.split(r"([;&|()`])", line.replace("&&", ";").replace("||", ";").replace("|&", "|"))
    piped, before = False, []
    for k in range(0, len(parts), 2):
        words = [w for w in re.split(r"[ \t\n]+", parts[k]) if w]
        delim = parts[k - 1] if k else ""
        # `curl u | (sh)`: the bracket right after the pipe keeps the pipe.
        if delim != "|" and not (delim == "(" and not before):
            piped = False
        pos = starts(words)
        names = [words[i].rsplit("/", 1)[-1] for i in pos]
        if piped and any(RUN_SHELL.fullmatch(n) for n in names):
            return True
        # An interpreter reading its program from the pipe: no argument, or `-`. `python3 -m json.tool` reads data.
        if piped and any(RUN_INTERP.fullmatch(words[i].rsplit("/", 1)[-1]) and words[i + 1:i + 2] in ([], ["-"])
                         for i in pos):
            return True
        if any(n in FETCHERS for n in names):
            last = before[-1] if before else ""
            runner = any(RUN_SHELL.fullmatch(n) or n in ("eval", "source", ".")
                         for n in [before[i].rsplit("/", 1)[-1] for i in starts(before)])
            if delim == "(" and runner and (last.endswith("<") or last == "eval" or re.fullmatch(r"-[a-zA-Z]*c[a-zA-Z]*", last)):
                return True
            piped = True
        before = words
    return False


# A test file of the project; one under node_modules/, vendor/ or .venv/ is a dependency's.
TEST_PATH = re.compile(r"^(?!(?:.*/)?(?:node_modules|vendor|\.venv)/).*?"
                       r"(?:(^|/)(tests?|__tests__)(/|$)|\.(test|spec)\.[^/]+$|(^|/)test_[^/]*\.py$|_test\.go$)")
# A marker that skips or focuses a test (`it.skip(`, `.only(`, `@pytest.mark.skip`); `model.fit(` is none.
SKIP_MARK = re.compile(r"\b(?:it|test|describe)\.skip\(|(?<![\w.])(?:xit|xdescribe|fit|fdescribe)\(|\.only\(|"
                       r"@pytest\.mark\.(?:skip|xfail)|pytest\.skip\(|@unittest\.skip|@Disabled|@Ignore|\bt\.Skip")


def drops_tests(words):
    """`rm` or `git rm` of a test file, or `mv` of one to `.bak`, `.disabled` or `.skip`, in command position;
    a path in a temp directory is none."""
    pos = starts(words)
    for i in pos:
        name = words[i].rsplit("/", 1)[-1]
        args = [w for w in words[i + 1:] if not w.startswith("-") and not scratch(w)]
        if name == "rm" and any(TEST_PATH.search(a) for a in args):
            return True
        if name == "mv" and len(args) > 1 and re.search(r"\.(bak|disabled|skip)$", args[-1]) and any(
                TEST_PATH.search(a) for a in args[:-1]):
            return True
    return any(sub == "rm" and any(TEST_PATH.search(x) for x in rest if not x.startswith("-"))
               for sub, rest in git_subs(words, pos))


def scan_cost(line):
    """What scan() will spend on this view: each check walks a segment's words once per command-position word.
    Linear to compute, so a command built to outlast the hook timeout is caught before the scan starts."""
    total = 0
    for seg in re.split(r"[;&|()`]", line):
        words = [w for w in re.split(r"[ \t\n]+", seg) if w]
        total += len(starts(words)) * len(words)
    return total


def scan(line):
    """Word scanner: the REASONS key of the first hit (install, push, noverify, destroy, tests, infra), or a
    (key, rule name) pair for the classes(), drops_data() and runs_download() hits; None otherwise."""
    for seg in re.split(r"[;&|()`]", line):
        words = [w for w in re.split(r"[ \t\n]+", seg) if w]
        pm = sub = git = push = force = skip = False
        rm = rec = rmf = ended = False
        if destroys(words):
            return "destroy"
        if installs(words):
            return "install"
        if drops_tests(words):
            return "tests"
        if infra(words):
            return "infra"
        hit = classes(words)
        if hit:
            return hit
        pos = starts(words)
        for i, x in enumerate(words):
            if rm and x == "--":
                ended = True
            if rm and not ended and (long(x, "--recursive") or re.fullmatch(r"-[a-zA-Z]*[rR][a-zA-Z]*", x)):
                rec = True
            if rm and not ended and (long(x, "--force") or re.fullmatch(r"-[a-zA-Z]*f[a-zA-Z]*", x)):
                rmf = True
            if rm and rec and rmf:
                return "destroy"
            if i in pos and re.search(r"(^|/)rm$", x):
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
            elif push and (x in ("--force", "--mirror") or re.fullmatch(r"-[a-zA-Z]*f[a-zA-Z]*", x) or x.startswith("+")):
                force = True
        if any(sub == "commit" and any(re.fullmatch(r"-[a-zA-Z]*n[a-zA-Z]*", x) for x in rest) for sub, rest in git_subs(words)):
            return "noverify"
        if force:
            return "push"
    # Whole-line classes last, so a command the per-segment checks know keeps its own reason.
    if drops_data(line):
        return "data", "sql-drop"
    if runs_download(line):
        return "remote-code", "curl-pipe-shell"
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
    if sub == "fetch":  # a refspec after the remote that writes outside refs/remotes moves a local ref (`main:main`)
        args = [x for k, x in enumerate(rest) if not x.startswith("-") and (k == 0 or rest[k - 1] not in FETCH_VALUE)]
        dsts = [x.split(":", 1)[1] for x in args[1:] if ":" in x and "://" not in x]
        return any(d and not d.startswith("refs/remotes/") for d in dsts)
    if sub == "stash":
        return rest[:1] not in (["list"], ["show"])
    if sub == "submodule":
        return args[:1] not in ([], ["status"], ["summary"])
    if sub == "bisect":
        return args[:1] not in (["log"], ["visualize"], ["view"])
    if sub in ("diff", "log", "show", "format-patch", "archive"):  # an output file or directory outside scratch
        outs = []
        for k, x in enumerate(rest):
            name, eq, value = x.partition("=")
            if long(name, "--output") or long(name, "--output-directory") or (x.startswith("-o") and not x.startswith("--")):
                if not eq:
                    value = x[2:] if x.startswith("-o") and len(x) > 2 else (rest[k + 1] if k + 1 < len(rest) else "")
                outs.append(value or ".")
        # format-patch without an output directory writes one file per commit into the current directory.
        if sub == "format-patch" and not outs and "--stdout" not in rest:
            return True
        if not all(scratch(o) for o in outs):
            return True
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
    # `before` would be every character so far, rebuilt per quote (quadratic); keep a 64-character tail for
    # the `eval`/`-c` test and a flag for a shell word, fed from the text added since the last quote.
    # ponytail: a word longer than 64 characters (a long `-c` cluster or path) is cut; lengthen if it matters.
    out, i, tail, frag, shell, last = [], 0, "", "", False, 0
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
            # The shell runs the text after its own `-c` (not `python3 -c`) or after `eval`.
            new = "".join(out[last:])
            tail = (tail + re.sub(r"\s+", " ", new))[-64:]
            words = re.split(r"[\s;&|()`]+", frag + new)
            shell = shell or any(re.search(SHELL, w) for w in words)
            run = re.search(r"(^|\s)eval\s*$", tail) or (re.search(r"(^|\s)-[a-zA-Z]*c\s*$", tail) and shell)
            out.append(body if run else re.sub(r"[<>]", " ", body))
            frag, last = words[-1][-64:], len(out) - 1
            i = j + 1
            continue
        out.append(c)
        i += 1
    return re.sub(r"[\"\\${}]", "", "".join(out))


MESSAGE = re.compile(r"""(\s(?:-[a-zA-Z]*m|-F|--message|--file)(?:=|\s+))("(?:[^"\\]|\\.)*"|'[^']*')""")
# `-m "$(cat <<'EOF'` or `<<"EOF"`, up to the end of the delimiter line.
HEREDOC = re.compile(r"""(\s(?:-[a-zA-Z]*m|--message)(?:=|\s+))"\$\(\s*cat\s+<<(-?)\s*(['"])(\w+)\3[ \t]*\n""")


def heredocs(s):
    """`-m "$(cat <<'EOF' ... EOF\\n)"` becomes `-m x`: a quoted-delimiter heredoc is never expanded. The body
    ends at the first line that is the delimiter (`<<-` strips leading tabs), and only `)"` may follow it;
    anything else after that line is a command the shell runs, so the value stays."""
    pos = 0
    while True:
        m = HEREDOC.search(s, pos)
        if not m:
            return s
        lines, end = s[m.end():].split("\n"), None
        for k, line in enumerate(lines):
            if (line.lstrip("\t") if m.group(2) else line) == m.group(4):
                rest = "\n".join(lines[k + 1:])
                end = re.match(r'\s*\)"', rest)
                break
        if not end:
            pos = m.end()
            continue
        s = s[:m.start()] + m.group(1) + "x" + rest[end.end():]
        pos = m.start() + len(m.group(1)) + 1


def messages(cmd):
    """In a command with `commit`, each quoted value of `-m` (or a cluster ending in m), `-F`, `--message` or
    `--file` becomes `x`, so the words of a commit message are not scanned as commands; a double-quoted one
    holding `$(` or a backtick stays, since the shell runs that. The command stays JSON-escaped."""
    try:
        s = json.loads('"%s"' % cmd)
    except ValueError:
        return cmd
    if "commit" not in s:
        return cmd
    keep = lambda m: m.group(0) if m.group(2)[0] == '"' and ("$(" in m.group(2) or "`" in m.group(2)) else m.group(1) + "x"
    return json.dumps(MESSAGE.sub(keep, heredocs(s)), ensure_ascii=False)[1:-1]


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
    formatter or test run that rewrites files (FIX_FLAGS; `-u`/`--update` next to a test runner); the
    commands in command position (starts)."""
    for seg in re.split(r"[;&|()`]", line):
        words = [w for w in re.split(r"[ \t\n]+", seg) if w]
        if any(w.split("=")[0] in FIX_FLAGS for w in words) or (
                {"-u", "--update"} & set(words) and TEST_RUNNERS & {w.rsplit("/", 1)[-1] for w in words}):
            return True
        pos = starts(words)
        for i in pos:
            x = words[i]
            name = x.rsplit("/", 1)[-1]
            if name in WRITE_BIN:
                args = [w for w in words[i + 1:] if not w.startswith("-")]
                if name == "dd":
                    args = [w[3:] for w in args if w.startswith("of=")]
                elif name in ("chmod", "chown", "chgrp"):
                    args = args[1:]  # the first operand is the mode or owner
                elif name == "patch":
                    args = []  # it writes the files its diff names, not its arguments
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
                    w == "--in-place" or w.startswith("--in-place=") or re.match(r"-(?![MmI])[a-zA-Z]*i", w)
                    for w in words[i + 1:]):  # perl's -M/-m/-I take a module or path (`-MList::Util`)
                return True
        if any(git_writes(sub, rest) for sub, rest in git_subs(words, pos)):
            return True
    return False


def commits(line):
    """`git commit` in any segment: `commit` is git's subcommand, after its global options."""
    for seg in re.split(r"[;&|()`]", line):
        if any(sub == "commit" for sub, _ in git_subs([w for w in re.split(r"[ \t\n]+", seg) if w])):
            return True
    return False


def hops(path, limit=8):
    """The path and each link target it leads to in turn (`ok.txt` -> `.env` -> `secrets.txt`), at most limit."""
    out = [path]
    for _ in range(limit):
        try:
            target = os.readlink(out[-1])
        except OSError:
            break
        out.append(os.path.normpath(os.path.join(os.path.dirname(out[-1]), target)))
    return out


def protected(path):
    """"protected" for a secret file or the agent's own user-level config, "rules" for a project's guard rules
    file (RULES_FILE in any directory), None otherwise; by the path as written (`~` expanded,
    normalized), by each link it passes through, or by the path its links resolve to, compared without case (macOS volumes ignore it).
    A path Python cannot resolve (a NUL byte) counts as protected."""
    try:
        forms = lambda q: {os.path.abspath(os.path.expanduser(q)).lower(), os.path.realpath(os.path.expanduser(q)).lower()}
        paths, homes = forms(path) | {h.lower() for h in hops(os.path.abspath(os.path.expanduser(path)))}, forms("~")
        other = os.environ.get("CLAUDE_CONFIG_DIR")
        configs = forms(other) if other else set()
    except ValueError:
        return "protected"
    for p in paths:
        base = os.path.basename(p)
        if base in (".env", ".envrc") or (base.startswith((".env.", ".envrc.")) and base.rsplit(".", 1)[1] not in ("example", "sample", "template", "dist")):
            return "protected"
    files = [os.path.join(h, f) for h in homes for f in (".claude.json", ".npmrc", ".pypirc", ".git-credentials",
                                                         os.path.join(".docker", "config.json"))]
    dirs = [os.path.join(h, d) for h in homes for d in (".ssh", ".aws", ".gnupg", ".kube", os.path.join(".config", "gh"))]
    # CLAUDE_CONFIG_DIR moves the config, `.claude.json` included, to another directory (a second account).
    for claude in {os.path.join(h, ".claude") for h in homes} | configs:
        files += [os.path.join(claude, f) for f in (".claude.json", "settings.json", "settings.local.json", "claude.md")]
        dirs += [os.path.join(claude, d) for d in ("hooks", "rules", "agents", "skills", "commands", "plugins", "output-styles")]
    if any(p in files or any(p == d or p.startswith(d + os.sep) for d in dirs) for p in paths):
        return "protected"
    return "rules" if any(p.endswith(os.sep + RULES_FILE.replace("/", os.sep)) for p in paths) else None


def toplevel(cwd):
    """The nearest directory at or above cwd that holds `.git`, symlinks resolved; None when there is none or cwd
    is no absolute path of a directory."""
    if not isinstance(cwd, str) or not os.path.isabs(cwd) or not os.path.isdir(cwd):
        return None
    d = os.path.realpath(cwd)
    for _ in range(64):
        if os.path.lexists(os.path.join(d, ".git")):
            return d
        up = os.path.dirname(d)
        if up == d:
            break
        d = up
    return None


def target(cwd, path):
    """file_path as an absolute path with symlinks resolved; a relative one starts at cwd."""
    return os.path.realpath(os.path.join(cwd, os.path.expanduser(path)))


def other_worktree(cwd, path):
    """True when cwd is inside a linked worktree (its `.git` is a file) and path lies in another worktree of
    the same repository: the main checkout or a sibling. Worktrees nest (`.claude/worktrees/x` inside the main
    checkout), so the deepest listed worktree that holds the path decides. The main checkout is never checked:
    an orchestrator writes into its lanes' worktrees. One bounded `git worktree list`; any failure is no check."""
    top = toplevel(cwd)
    if not top or not os.path.isfile(os.path.join(top, ".git")):
        return False
    out = subprocess.run(["git", "-C", top, "worktree", "list", "--porcelain"], stdin=subprocess.DEVNULL,
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3).stdout.decode("utf-8", "replace")
    trees = [os.path.realpath(line[9:]) for line in out.splitlines() if line.startswith("worktree ")]
    if top not in trees:  # a submodule's `.git` is a file too
        return False
    t = target(cwd, path)
    holds = [w for w in trees if t == w or t.startswith(w + os.sep)]
    return bool(holds) and max(holds, key=len) != top


RULES_FILE = ".claude/developer-os-guard.json"
RULES_BYTES, RULES_MAX = 16 << 10, 50
# A rule is literal: a command word has no shell or pattern character, a path only the wildcards `*`, `?`, `**`.
RULE_WORD = re.compile(r"[A-Za-z0-9._:/@=+-]{1,64}")
RULE_GLOB = re.compile(r"[A-Za-z0-9._/@+*?-]{1,128}")


def project_rules(cwd):
    """(project root, command rules, path rules) from RULES_FILE at the root (toplevel(cwd), or cwd outside
    git). The file can only add questions: it must be a regular file of at most RULES_BYTES holding exactly
    `{"ask": [...]}` with at most RULES_MAX entries, each `{"command": [words]}` (1 to 8 literal words) or
    `{"path": "glob"}` (relative, no `..`, at most 8 `*`). Anything else, an `allow` key or a regex included, makes
    the whole file void: no rule is read from it."""
    none = (None, [], [])
    try:
        root = toplevel(cwd) or (os.path.realpath(cwd) if isinstance(cwd, str) and os.path.isabs(cwd) and os.path.isdir(cwd) else None)
        if not root:
            return none
        path = os.path.join(root, RULES_FILE)
        if os.path.islink(path) or not os.path.isfile(path) or os.path.getsize(path) > RULES_BYTES:
            return none
        with open(path, "rb") as f:
            data = json.loads(f.read(RULES_BYTES + 1).decode("utf-8"))
        if not isinstance(data, dict) or set(data) != {"ask"} or not isinstance(data["ask"], list) or len(data["ask"]) > RULES_MAX:
            return none
        commands, globs = [], []
        for e in data["ask"]:
            if not isinstance(e, dict) or len(e) != 1:
                return none
            c, g = e.get("command"), e.get("path")
            if isinstance(c, list) and 0 < len(c) <= 8 and all(isinstance(w, str) and RULE_WORD.fullmatch(w) for w in c):
                commands.append(c)
            elif (isinstance(g, str) and RULE_GLOB.fullmatch(g) and not g.startswith("/") and ".." not in g.split("/")
                  and g.count("*") <= 8):
                globs.append(g)
            else:
                return none
        return root, commands, globs
    except (OSError, ValueError):
        return none


def glob_match(pat, s):
    """Whole-string match of a path glob: `*` and `?` stay inside one path segment, `**` crosses `/`, and `**/`
    at the start of a segment also matches no directory (`**/a` is `a` and `x/y/a`). The positions in the
    pattern are advanced together, one step per character, so no pattern backtracks."""
    toks = re.findall(r"\*\*|[^*]|\*", pat)

    def close(states):
        todo = list(states)
        while todo:
            i = todo.pop()
            if i < len(toks) and toks[i] in ("*", "**"):
                skip = [i + 1]
                if toks[i] == "**" and toks[i + 1:i + 2] == ["/"] and (i == 0 or toks[i - 1] == "/"):
                    skip.append(i + 2)
                for j in skip:
                    if j not in states:
                        states.add(j)
                        todo.append(j)
        return states

    states = close({0})
    for ch in s:
        nxt = set()
        for i in states:
            if i >= len(toks):
                continue
            t = toks[i]
            if t == "**" or (t == "*" and ch != "/"):
                nxt.add(i)
            elif (t == "?" and ch != "/") or t == ch:
                nxt.add(i + 1)
        states = close(nxt)
        if not states:
            return False
    return len(toks) in states


def project_path(cwd, path):
    """True when file_path, relative to the project root, matches a path rule of the project."""
    root, _, globs = project_rules(cwd)
    if not globs:
        return False
    for t in {target(cwd, path), os.path.abspath(os.path.join(os.path.realpath(cwd), os.path.expanduser(path)))}:
        if t.startswith(root + os.sep) and len(t) < 4096:
            rel = t[len(root) + 1:].replace(os.sep, "/")
            if any(glob_match(g, rel) for g in globs):
                return True
    return False


def project_command(cwd, views):
    """True when a command rule of the project is a word prefix of a command in command position (the first
    word also by its base name, so `/usr/bin/make deploy` matches `["make", "deploy"]`)."""
    _, commands, _ = project_rules(cwd)
    if not commands:
        return False
    for line in views:
        for seg in re.split(r"[;&|()`]", line):
            words = [w for w in re.split(r"[ \t\n]+", seg) if w]
            for i in starts(words):
                got = words[i:i + 8]
                base = [got[0].rsplit("/", 1)[-1]] + got[1:]
                if any(got[:len(c)] == c or base[:len(c)] == c for c in commands):
                    return True
    return False


def hook_cwd(raw):
    """`cwd` of the hook input: the session's working directory when the hook runs."""
    return json.loads(raw).get("cwd")


def safe(check, *args):
    """A check that reads the disk or runs git: any failure counts as no hit (fail open)."""
    try:
        return check(*args)
    except Exception:
        return False


LOG_BYTES = 1 << 20
SCAN_SECONDS = 4  # a backstop for the cost bound: the hook timeout is 10 s
SCAN_COST = 1500000  # command-position words times words in one view: about a quarter second of scanning


def log(reason, rule, tool):
    """Append one line to the ask log: time, REASONS key, rule name and tool, never the command or the path. The
    directory is created with mode 700 and must be the user's own, with no symlink; at LOG_BYTES the file moves
    to `asks.jsonl.1`. DEVELOPER_OS_GUARD_LOG=off disables it."""
    if os.environ.get("DEVELOPER_OS_GUARD_LOG") == "off":
        return
    base = os.environ.get("CLAUDE_PLUGIN_DATA") or "%s/developer-os-%d" % (os.environ.get("TMPDIR") or "/tmp", os.getuid())
    d = base + "/guard"
    old = os.umask(0o077)
    try:
        if os.path.islink(base):  # before makedirs, which would create the directory behind the link
            return
        os.makedirs(d, exist_ok=True)
        for p in (d, base):
            if os.path.islink(p) or os.lstat(p).st_uid != os.getuid():
                return
        path = d + "/asks.jsonl"
        if os.path.lexists(path) and os.lstat(path).st_size >= LOG_BYTES:
            os.replace(path, path + ".1")
        line = json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "reason": reason, "rule": rule,
                           "tool": tool}, separators=(",", ":")) + "\n"
        # O_NOFOLLOW: no write through a planted link; O_NONBLOCK: a FIFO there fails instead of blocking.
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        try:
            os.write(fd, line.encode("utf-8"))
        finally:
            os.close(fd)
    finally:
        os.umask(old)


def skips_added(tool, inp, path):
    """More skip or focus markers after the call than before: Edit's `new_string` over its `old_string`, the
    `edits` of a MultiEdit summed, a Write's `content` over the first MiB of the regular file on disk (empty when
    there is none; a FIFO would block the read)."""
    count = lambda s: len(SKIP_MARK.findall(s)) if isinstance(s, str) else 0
    if tool == "Write":
        old, new, cap = "", inp.get("content"), 1 << 20
        if os.path.isfile(path):
            try:
                with open(path, encoding="utf-8", errors="replace") as f:
                    old = f.read(cap + 1)  # a bounded prefix keeps a huge file under the hook timeout
            except OSError:
                pass
        if len(old) > cap and isinstance(new, str):
            # ponytail: a file over the cap compares equal prefixes, so a marker added past the first MiB is missed
            old, new = old[:cap], new[:cap]
        return count(new) > count(old)
    edits = inp.get("edits") if tool == "MultiEdit" else [inp]
    pairs = [e for e in edits if isinstance(e, dict)] if isinstance(edits, list) else []
    return sum(count(e.get("new_string")) - count(e.get("old_string")) for e in pairs) > 0


def ask(reason, rule=None, tool="Bash"):
    """Print the ask, then log it: the decision is out before the log is touched, so a log failure changes nothing."""
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "ask", "permissionDecisionReason": REASONS[reason]}},
        separators=(",", ":")))
    sys.stdout.flush()
    safe(log, reason, rule or reason, tool)


def main():
    raw = sys.stdin.buffer.read().decode("utf-8", "replace")
    tool = re.search(r'"tool_name"\s*:\s*"(Edit|Write|MultiEdit)"', raw)
    if tool:
        data = json.loads(raw)
        inp, cwd, name = data.get("tool_input", {}), data.get("cwd"), tool.group(1)
        path = inp.get("file_path")
        if not isinstance(path, str):
            return
        kind = protected(path)
        if kind:
            ask(kind, kind, name)
        elif TEST_PATH.search(path) and skips_added(name, inp, path):
            ask("tests", "tests", name)
        elif safe(other_worktree, cwd, path):
            ask("worktree", "worktree", name)
        elif safe(project_path, cwd, path):
            ask("project", "project-path", name)
        return
    cmd = command(raw)
    if not cmd:
        return
    cmd = messages(cmd)
    # Each way runs with a newline as `;` and as a space, and the shell's own `\n` as a break: seven views,
    # and a hit in any asks.
    # Quotes are not tracked: an extra ask is the price.
    views = [view(cmd, ";"), view(cmd, " "), view(cmd, ";", True), view(cmd, " ", True), view(cmd, " ", join_commas=True),
             view(cmd, ";", shell_ws=True), view(cmd, ";", True, shell_ws=True)]
    began = time.monotonic()
    for v in views:
        # The scan is quadratic in command-position words; past the hook timeout Claude Code would run the
        # command unchecked, so a command that cannot be checked in time asks instead.
        if time.monotonic() - began > SCAN_SECONDS or scan_cost(v) > SCAN_COST:
            ask("slow")
            return
        hit = scan(v)
        if hit:
            ask(*(hit if isinstance(hit, tuple) else (hit, hit)))
            return
    # A redirect inside quotes is a program's text (`awk '$1>3'`); unbalanced quotes check every view.
    u = unquoted(cmd)
    redirect = redirects(u) if u is not None else any(redirects(v) for v in views)
    if read_only(raw) and (redirect or any(writes(v) for v in views)):
        ask("readonly")
    elif safe(project_command, safe(hook_cwd, raw), views):
        ask("project", "project-command")
    elif any(commits(v) for v in views):
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": COMMIT}},
                         separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
