#!/usr/bin/env python3
"""Prints one line per thing developer-os needs on this machine: `<status> <name>: <detail>`, where the
status is ok, missing or warn. Run by the setup-check skill.

Checks: python3 (3.8 or later; the hooks run `python3` from PATH), rg, jq, gh and its login, git (2.38 or
later, for `git merge-tree --write-tree`), the brain vault, `autoMemoryEnabled`, and the Claude Code CLI.

The vault path is resolved as hooks/notices.py resolves it: the plugin's brain_vault option in the
user-level settings.json (pluginConfigs), else the `Brain vault:` line of the user-level CLAUDE.md. A
project file and the option's environment variable are never read (D5): a cloned repository must not
name the vault.

Read-only: it runs each tool's version command and `gh auth status`, reads two files and writes nothing.
It always exits 0; the lines carry the result.
"""
import json
import os
import re
import subprocess
import sys

PYTHON_MIN = (3, 8)
GIT_MIN = (2, 38)


def head(path, size):
    with open(path, "rb") as f:
        return f.read(size).decode("utf-8", "replace")


def run(args, timeout=5):
    """(exit code, first output line) of a command found on PATH; (None, "") when it cannot be run."""
    try:
        p = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None, ""
    lines = p.stdout.decode("utf-8", "replace").strip().splitlines()
    return p.returncode, (lines[0].strip()[:120] if lines else "")


def version(text):
    m = re.search(r"\d+(?:\.\d+)+", text)
    return m.group(0) if m else ""


def tool(name, minimum=None, why=""):
    code, first = run([name, "--version"])
    if code != 0:
        return "missing", "not found on PATH" if code is None else "`%s --version` failed" % name
    v = version(first)
    if minimum and v and tuple(int(x) for x in v.split(".")[:2]) < minimum:
        return "warn", "%s, older than %d.%d%s" % (v, minimum[0], minimum[1], why)
    return "ok", v or first or "found"


def settings(config):
    """The user-level settings.json as a dict; None when it is missing or not a JSON object."""
    try:
        data = json.loads(head(os.path.join(config, "settings.json"), 1 << 20))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def option(config):
    # As in hooks/notices.py: the brain_vault option from the user-level settings.json only;
    # CLAUDE_PLUGIN_OPTION_BRAIN_VAULT is not read, because a project's settings `env` block could set it.
    try:
        configs = json.loads(head(os.path.join(config, "settings.json"), 1 << 20)).get("pluginConfigs") or {}
        for key, entry in configs.items():
            if key.split("@")[0] == "developer-os":
                v = (entry.get("options") or {}).get("brain_vault")
                return v.strip() if isinstance(v, str) else ""
    except (OSError, ValueError, AttributeError):
        pass
    return ""


def vault(config):
    v, source = option(config), "brain_vault option in settings.json"
    if not v:
        source = "Brain vault: line in CLAUDE.md"
        try:
            m = re.search(r"^Brain vault:[ \t]*(\S.*?)[ \t]*$", head(os.path.join(config, "CLAUDE.md"), 65536), re.M)
        except OSError:
            m = None
        v = m.group(1) if m else ""
    if not v:
        return "warn", "not configured"
    v = os.path.expanduser(v)
    shown = re.sub(r"[^\x20-\x7e]", "?", v)[:200]
    if os.path.isabs(v) and os.path.isdir(v) and os.access(v, os.R_OK | os.X_OK):
        return "ok", "%s (%s)" % (shown, source)
    return "missing", "%s is not a readable directory (%s)" % (shown, source)


def auto_memory(config):
    if os.environ.get("CLAUDE_CODE_DISABLE_AUTO_MEMORY") == "1":
        return "ok", "off (CLAUDE_CODE_DISABLE_AUTO_MEMORY=1)"
    data = settings(config)
    if data is None:
        return "warn", "no valid user-level settings.json, so auto memory is on"
    if data.get("autoMemoryEnabled") is False:
        return "ok", "false"
    return "warn", "true" if data.get("autoMemoryEnabled") is True else "not set, so auto memory is on"


def main():
    config = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    out = [("python3",) + tool("python3", PYTHON_MIN, "; the hooks fail open and do nothing"),
           ("rg",) + tool("rg"),
           ("jq",) + tool("jq")]
    gh = tool("gh")
    out.append(("gh",) + gh)
    if gh[0] == "ok":
        code, first = run(["gh", "auth", "status"], timeout=10)
        out.append(("gh auth", "ok", "logged in") if code == 0 else ("gh auth", "warn", first or "not logged in"))
    out.append(("git",) + tool("git", GIT_MIN, "; a conflict preview needs `git merge-tree --write-tree`"))
    out.append(("vault",) + vault(config))
    out.append(("autoMemoryEnabled",) + auto_memory(config))
    out.append(("claude",) + tool("claude"))
    for name, status, detail in out:
        print("%s %s: %s" % (status, name, detail))
    return 0


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("warn setup-check: stopped early (%s)" % type(e).__name__)
    sys.exit(0)
