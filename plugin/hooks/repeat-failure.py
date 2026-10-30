#!/usr/bin/env python3
"""PostToolUseFailure hook: on the third failure of the same tool call in a session, tells the agent to
stop retrying it unchanged and diagnose the cause. A model that keeps calling the same failing tool is
the commonest runaway loop; a rule loaded at session start does not fire at the moment it happens.

The same call means the same tool name and input (for Bash, the command alone) from the same agent. It
fires once per call, at the third failure, and gives no decision: the call has already failed.

Fails open: every unexpected state exits 0 with no output.
"""
import hashlib
import json
import os
import re
import sys
import time

LIMIT = 3


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
    counts = {}
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            counts = json.load(f)
    n = counts.get(key, 0) + 1
    counts[key] = n
    with open(path, "w", encoding="utf-8") as f:
        json.dump(counts, f)

    now = time.time()
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
