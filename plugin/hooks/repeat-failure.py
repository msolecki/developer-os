#!/usr/bin/env python3
"""PostToolUseFailure hook: on the third failure of the same tool call in a session, tells the agent to
stop retrying it unchanged and diagnose the cause. A model that keeps calling the same failing tool is
the commonest runaway loop; a rule loaded at session start does not fire at the moment it happens.

The same call means the same tool name and input (for Bash, the command alone) from the same agent. A
failure more than 10 minutes after the previous one of that call starts the count again, so a test run
that is red now and then during the work (test-first) is not a loop. It fires once per run of failures,
at the third, and gives no decision: the call has already failed.

Fails open: every unexpected state exits 0 with no output.
"""
import hashlib
import json
import os
import re
import sys
import time

LIMIT = 3
WINDOW = 600  # seconds between failures that still count as one run


def owned_dir(path):
    st = os.lstat(path)
    return not os.path.islink(path) and st.st_uid == os.getuid()


def main():
    if os.environ.get("DEVELOPER_OS_REPEAT_FAILURE") == "off":
        return 0
    data = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace"))
    if not isinstance(data, dict) or data.get("is_interrupt") is True:
        return 0
    sid = data.get("session_id")
    tool = data.get("tool_name")
    args = data.get("tool_input")
    if not (isinstance(sid, str) and re.fullmatch(r"[A-Za-z0-9_-]+", sid) and isinstance(tool, str)
            and isinstance(args, dict)):
        return 0
    if tool == "Bash":
        args = args.get("command")  # the description changes between otherwise identical retries
    key = json.dumps([data.get("agent_id") or "", tool, args], sort_keys=True)
    key = hashlib.sha256(key.encode("utf-8", "replace")).hexdigest()[:16]

    # Same per-user base as capture-nudge, so a shared root-owned /tmp cannot host the state.
    base = os.environ.get("CLAUDE_PLUGIN_DATA") or "%s/developer-os-%d" % (os.environ.get("TMPDIR") or "/tmp", os.getuid())
    state_dir = base + "/repeat-failure"
    old = os.umask(0o077)
    try:
        os.makedirs(state_dir, exist_ok=True)
    finally:
        os.umask(old)
    if not (owned_dir(state_dir) and owned_dir(os.path.dirname(state_dir))):
        return 0
    path = state_dir + "/" + sid
    if os.path.islink(path):
        return 0
    # A corrupt file (a writer killed by the timeout) restarts the counts instead of disabling the hook.
    # Parallel failures can lose an increment or fire twice; both are harmless, so there is no lock.
    counts = {}
    try:
        with open(path, encoding="utf-8") as f:
            counts = json.load(f)
    except (OSError, ValueError):
        pass
    if not isinstance(counts, dict):
        counts = {}
    now = time.time()
    prev = counts.get(key)
    # [count, time of the last failure]; anything else (an old or corrupt entry) starts a new run.
    fresh = (isinstance(prev, list) and len(prev) == 2 and isinstance(prev[0], int) and prev[0] > 0
             and isinstance(prev[1], (int, float)) and now - prev[1] <= WINDOW)
    n = prev[0] + 1 if fresh else 1
    counts[key] = [n, now]
    # Written to a temp file and renamed, so a reader never sees a half-written file.
    tmp = "%s.%d.tmp" % (path, os.getpid())
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(counts, f)
    os.replace(tmp, path)

    for entry in os.scandir(state_dir):
        try:
            if entry.is_file(follow_symlinks=False) and now - entry.stat(follow_symlinks=False).st_mtime >= 8 * 86400:
                os.remove(entry.path)
        except OSError:
            pass

    if n != LIMIT:
        return 0
    msg = ("developer-os: this exact %s call has now failed %d times in this session. Do not run it again "
           "unchanged: read the error, find the cause, then change the approach or ask the user." % (tool, n))
    sys.stdout.write(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUseFailure", "additionalContext": msg}}))
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except Exception:
        code = 0
    sys.exit(code)
