#!/usr/bin/env python3
"""Stop hook: once per session, after DEVELOPER_OS_CAPTURE_NUDGE_MIN tool calls (default 30) and with no
background task still running, asks the agent to run session-retro. It never prints transcript content.

Fails open: every unexpected state exits 0, so a broken reminder never blocks a session.
Skips headless and SDK runs (claude -p sets CLAUDE_CODE_ENTRYPOINT=sdk-cli): nobody is there to answer,
and the hook input itself carries no non-interactive signal. CLAUDE_CODE_ENTRYPOINT is undocumented; if a
release drops it, a headless run gets one extra turn (stop_hook_active stops a second), not a loop.
"""
import json
import os
import re
import sys
import time

LAUNCH = re.compile(
    r'"tool_use_id":"([A-Za-z0-9_]+)","type":"tool_result","content":(?:\[\{"type":"text","text":)?'
    r'"(?:Async agent launched|Command running in background)(?:[^"\\]|\\.)*(?:output_file|written to): ([^ "\\]+)')
MONITOR = re.compile(
    r'"tool_use_id":"[A-Za-z0-9_]+","type":"tool_result","content":(?:\[\{"type":"text","text":)?"Monitor started \(task ')
MONITOR_FIELDS = re.compile(r'.*"tool_use_id":"([A-Za-z0-9_]*)","type":"tool_result".*"timestamp":"([0-9T:.Z-]*)"')


def field(text, key):
    """First string value of a top-level key; the hook input is flat JSON."""
    m = re.search(r'"%s"\s*:\s*"([^"]*)"' % key, text)
    return m.group(1) if m else ""


def owned_dir(path):
    st = os.lstat(path)
    return not os.path.islink(path) and st.st_uid == os.getuid()


def main():
    if os.environ.get("DEVELOPER_OS_CAPTURE_NUDGE") == "off":
        return 0
    if os.environ.get("CLAUDE_CODE_ENTRYPOINT", "").startswith("sdk-"):
        return 0

    text = sys.stdin.buffer.read().decode("utf-8", "replace").replace("\n", " ").replace("\r", " ")
    if re.search(r'"stop_hook_active"\s*:\s*true', text) or re.search(r'"agent_id"\s*:', text):
        return 0

    sid = field(text, "session_id")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", sid):
        return 0
    transcript = field(text, "transcript_path")
    if not os.path.isfile(transcript):
        return 0

    # Without plugin data the marker sits in a per-user directory, so its parent is ours even when TMPDIR is
    # a shared, root-owned /tmp.
    base = os.environ.get("CLAUDE_PLUGIN_DATA") or "%s/developer-os-%d" % (os.environ.get("TMPDIR") or "/tmp", os.getuid())
    marker_dir = base + "/capture-nudge"
    if os.path.exists(marker_dir + "/" + sid):
        return 0

    minimum = os.environ.get("DEVELOPER_OS_CAPTURE_NUDGE_MIN", "30")
    minimum = int(minimum) if minimum.isdigit() and minimum.isascii() else 30
    # One streaming pass: a transcript can run to hundreds of MB, and only the few launch and Monitor lines
    # are kept.
    n = 0
    finished, launches, monitors = set(), [], []
    with open(transcript, encoding="utf-8", errors="replace", newline="\n") as f:
        for line in f:
            n += line.count('"type":"tool_use"')
            finished.update(re.findall(r"<tool-use-id>([A-Za-z0-9_]+)</tool-use-id>", line))
            launches.extend(LAUNCH.findall(line))
            if MONITOR.search(line):
                monitors.append(line)
    if n < minimum:
        return 0

    # Defers, without spending the marker, while a background agent or command launched in this session has
    # no <task-notification> yet and its output file changed in the last 30 minutes: the turn ended to wait
    # for it. The mtime bound matters because a notification is not guaranteed; without it, a task that
    # vanished silently would suppress the nudge for the rest of the session.
    now = time.time()
    for task_id, out in launches:
        if task_id in finished:
            continue
        out = out[:-1] if out.endswith(".") else out
        # The path comes from tool output anyone can print: only an absolute path under the harness's
        # tasks/ directory is checked, so "/tmp" cannot defer.
        if out.startswith("/") and "/tasks/" in out[1:]:
            try:
                if now - os.stat(out).st_mtime < 1800:
                    return 0
            except OSError:
                pass

    # Also defers while a Monitor started in the last 30 minutes has no terminal notice. Event notices carry
    # only <task-id>; the terminal ones ("stream ended", "script failed") also carry <tool-use-id>, which is
    # what is matched. Expiry may leave no notice at all, so the start timestamp bounds the wait instead.
    # The bound is fixed, so a Monitor armed with a timeout over 30 minutes stops deferring after 30.
    # ISO timestamps in UTC compare as strings.
    cutoff = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now - 1800))
    for line in monitors:
        m = MONITOR_FIELDS.match(line)
        if m and m.group(2) > cutoff and m.group(1) not in finished:
            return 0

    # The marker directory must be ours and not a link, or another local user could steer the cleanup.
    old = os.umask(0o077)
    try:
        os.makedirs(marker_dir, exist_ok=True)
    finally:
        os.umask(old)
    if not (owned_dir(marker_dir) and owned_dir(os.path.dirname(marker_dir))):
        return 0
    open(marker_dir + "/" + sid, "w").close()
    for entry in os.scandir(marker_dir):
        try:
            if entry.is_file(follow_symlinks=False) and now - entry.stat(follow_symlinks=False).st_mtime >= 8 * 86400:
                os.remove(entry.path)
        except OSError:
            pass

    # additionalContext, unlike exit 2 or decision "block", continues the turn without a hook error label.
    msg = ("developer-os: this session made %d tool calls. Run the developer-os:session-retro skill: "
           "propose the wrap-up to the user and apply only what they approve. If nothing qualifies, "
           "end your turn with no output." % n)
    sys.stdout.write(json.dumps({"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": msg}}))
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except Exception:
        code = 0
    sys.exit(code)
