#!/usr/bin/env python3
"""SessionStart hook (startup): shows the user up to three one-line notices.

- The plugin version is new or changed: the version and a link to the changelog page. Claude Code has no
  install or update hook, so a version marker in the plugin data directory stands in for one.
- Inbox notes in the vault are older than 7 days: suggest brain-review, at most once every 7 days.
- No brain-garden run in 30 days: suggest brain-garden, at most once every 30 days.

The vault path comes only from the user-level CLAUDE.md, where brain-setup writes it, never from the
project: a cloned repository must not point the hook at a directory of its choosing. It prints counts and
dates, never a vault file name, and reads a bounded prefix of each file.

Fails open: every unexpected state exits 0 with no output. Skips headless and SDK runs, like capture-nudge.
"""
import datetime
import itertools
import json
import os
import re
import stat
import sys

CHANGELOG = "https://msolecki.github.io/developer-os/docs/changelog.html"
INBOX_DAYS, INBOX_EVERY, GARDEN_DAYS = 7, 7, 30
MAX_NOTES = 1000
DATE = r"([0-9]{4}-[0-9]{2}-[0-9]{2})"


def owned_dir(path):
    st = os.lstat(path)
    return not os.path.islink(path) and st.st_uid == os.getuid()


def head(path, size):
    with open(path, "rb") as f:
        return f.read(size).decode("utf-8", "replace")


def tail(path, size):
    # A FIFO or device in the vault would block open() until the hook timeout.
    if not stat.S_ISREG(os.lstat(path).st_mode):
        raise OSError("not a regular file")
    with open(path, "rb") as f:
        f.seek(0, 2)
        f.seek(max(0, f.tell() - size))
        return f.read().decode("utf-8", "replace")


def day(text):
    try:
        return datetime.date.fromisoformat(text)
    except (TypeError, ValueError):
        return None


def marker(path):
    try:
        return head(path, 64).strip()
    except OSError:
        return ""


def vault_path():
    config = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    try:
        m = re.search(r"^Brain vault:[ \t]*(\S.*?)[ \t]*$", head(os.path.join(config, "CLAUDE.md"), 65536), re.M)
    except OSError:
        return None
    v = os.path.expanduser(m.group(1)) if m else ""
    return v if os.path.isabs(v) and os.path.isdir(v) else None


def stale_inbox(vault, cut):
    n = 0
    try:
        with os.scandir(os.path.join(vault, "_inbox")) as it:
            entries = list(itertools.islice(it, MAX_NOTES))
    except OSError:
        return 0
    for e in entries:
        try:
            if not (e.name.lower().endswith(".md") and e.is_file(follow_symlinks=False)):
                continue
            front = re.match(r"---\r?\n(.*?)^---", head(e.path, 2048), re.M | re.S)
            m = re.search(r"^created:[ \t]*[\"']?" + DATE, front.group(1), re.M) if front else None
        except OSError:
            continue
        d = day(m.group(1)) if m else None
        if d and d < cut:
            n += 1
    return n


def last_garden(vault):
    """Date of the last line of _reports/garden-log.md, which brain-garden appends with consent."""
    try:
        lines = tail(os.path.join(vault, "_reports", "garden-log.md"), 4096).strip().splitlines()
    except OSError:
        return None
    m = re.match(DATE, lines[-1]) if lines else None
    return day(m.group(1)) if m else None


def main():
    if os.environ.get("DEVELOPER_OS_NOTICES") == "off":
        return 0
    if os.environ.get("CLAUDE_CODE_ENTRYPOINT", "").startswith("sdk-"):
        return 0
    text = sys.stdin.read()
    source = re.search(r'"source"\s*:\s*"([^"]*)"', text)
    if source and source.group(1) != "startup":
        return 0

    root = os.environ.get("CLAUDE_PLUGIN_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, ".claude-plugin", "plugin.json"), encoding="utf-8") as f:
        version = str(json.load(f).get("version", ""))
    if not re.fullmatch(r"[0-9A-Za-z.+-]{1,32}", version):
        return 0

    # Without markers every notice would repeat each session, so nothing prints unless they can be written.
    base = os.environ.get("CLAUDE_PLUGIN_DATA") or "%s/developer-os-%d" % (os.environ.get("TMPDIR") or "/tmp", os.getuid())
    marker_dir = base + "/notices"
    old = os.umask(0o077)
    try:
        os.makedirs(marker_dir, exist_ok=True)
    finally:
        os.umask(old)
    if not (owned_dir(marker_dir) and owned_dir(os.path.dirname(marker_dir))):
        return 0

    today = datetime.date.today()
    notes, writes = [], {}
    vault = vault_path()

    seen = marker(marker_dir + "/version")
    if seen != version:
        writes["version"] = version
        if seen:
            notes.append("developer-os updated %s -> %s. What's new: %s" % (seen[:32], version, CHANGELOG))
        else:
            notes.append("developer-os %s is active. What's new: %s" % (version, CHANGELOG))
            notes.append("Vault upkeep does not run on its own: ask for brain-review weekly and brain-garden monthly."
                         if vault else "No vault configured yet: ask for brain-setup.")

    if vault:
        last = day(marker(marker_dir + "/inbox"))
        if not last or (today - last).days >= INBOX_EVERY:
            n = stale_inbox(vault, today - datetime.timedelta(days=INBOX_DAYS))
            if n:
                notes.append("Vault: %d inbox note%s older than %d days. Ask for brain-review."
                             % (n, "" if n == 1 else "s", INBOX_DAYS))
            # Throttle the scan itself, not only the notice: a clean inbox is not reread every session.
            writes["inbox"] = today.isoformat()

        garden = last_garden(vault)
        reminded = day(marker(marker_dir + "/garden"))
        latest = max([d for d in (garden, reminded) if d], default=None)
        if not latest:
            # No log and no earlier reminder: start the clock instead of nagging on the first run.
            writes["garden"] = today.isoformat()
        elif (today - latest).days >= GARDEN_DAYS:
            since = " (last run %s)" % garden.isoformat() if garden else ""
            notes.append("Vault: no brain-garden run in %d days%s. Ask for brain-garden." % (GARDEN_DAYS, since))
            writes["garden"] = today.isoformat()

    if notes:
        msg = "\n".join(notes)
        context = ("developer-os showed the user these notices at session start; act on one only if the user "
                   "asks:\n" + msg)
        sys.stdout.write(json.dumps({"systemMessage": msg,
                                     "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": context}}))
        sys.stdout.flush()
    # Markers last: a notice that failed to print is not throttled away.
    for name, value in writes.items():
        with open(marker_dir + "/" + name, "w", encoding="utf-8") as f:
            f.write(value + "\n")
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except Exception:
        code = 0
    sys.exit(code)
