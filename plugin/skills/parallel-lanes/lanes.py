"""Starts, watches and resumes the lanes of the parallel-lanes skill, driven by <run-dir>/lanes.json.

Usage: python3 -I lanes.py launch|status|conflicts <run-dir>
       python3 -I lanes.py resume <run-dir> <lane>

lanes.json: {"root": "/abs/repo", "base": "<commit>", "max_turns": 200, "manifests": ["package.json"],
             "lanes": [{"name": "api-retry", "budget_usd": 5, "fast_check": "pnpm lint",
                        "allow": ["Bash(pnpm test:*)"], "drop_deny": [".claude/**"]}]}
A lane runs `claude -p` in <root>/.worktrees/<name> on branch lanes/<name>, in its own session, so it outlives the
caller. Logs and reports are data: status prints them cut to one line and never acts on them.
"""
import json
import os
import re
import subprocess
import sys
import time

USAGE = "usage: lanes.py launch|status|conflicts <run-dir> | resume <run-dir> <lane>"
TOOLS = ["Read", "Edit", "Write", "Glob", "Grep",
         "Bash(git status:*)", "Bash(git diff:*)", "Bash(git add:*)", "Bash(git commit:*)"]
# What the allowed fast check and `git commit` run; a lane must not rewrite it and then run it unprompted.
DENY = ["Makefile", ".husky/**", ".githooks/**", ".claude/**"]
FINAL = ("DONE", "REVIEW", "BLOCKED")
START = 'p=${1}; shift; claude -p "$@" < "$p"; echo "EXIT=$?"'
CONTINUE = 'echo "Continue the task; your final report is not written yet." | claude -p "$@"; echo "EXIT=$?"'
WARN = "⚠"


def fail(*lines):
    for line in lines:
        print(line, file=sys.stderr)
    sys.exit(1)


def git(cwd, *args):
    """Returns (exit code, stdout); (-1, "") when git cannot run there."""
    try:
        p = subprocess.run(("git", "-C", cwd) + args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                           universal_newlines=True)
    except OSError:
        return -1, ""
    return p.returncode, p.stdout


def number(value):
    # json.load accepts Infinity and NaN: an infinite budget would lift the cap the user approved.
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and abs(value) < 1e9


def strings(value):
    return isinstance(value, list) and all(isinstance(x, str) and x and not x.startswith("-") for x in value)


def validate(cfg):
    """Returns the reasons lanes.json cannot be launched; an empty list when it can."""
    if not isinstance(cfg, dict):
        return ["lanes.json: not an object"]
    errors = ["lanes.json: unknown key %s" % k for k in sorted(set(cfg) - {"root", "base", "max_turns", "manifests", "lanes"})]
    root = cfg.get("root")
    if not (isinstance(root, str) and os.path.isabs(root) and os.path.isdir(root)):
        errors.append("lanes.json: root is not an absolute path to a directory")
    if not (isinstance(cfg.get("base"), str) and re.fullmatch(r"[0-9a-f]{40,64}", cfg["base"])):
        errors.append("lanes.json: base is not a full commit id (git rev-parse <base>)")
    if not (number(cfg.get("max_turns")) and int(cfg["max_turns"]) == cfg["max_turns"] and cfg["max_turns"] > 0):
        errors.append("lanes.json: max_turns is not a positive whole number")
    if not strings(cfg.get("manifests")):
        errors.append("lanes.json: manifests is not a list of paths (the package manifest; [] when there is none)")
    lanes = cfg.get("lanes")
    if not (isinstance(lanes, list) and lanes):
        return errors + ["lanes.json: lanes is not a list with at least one lane"]
    seen = set()
    for lane in lanes:
        name = lane.get("name") if isinstance(lane, dict) else None
        if not (isinstance(name, str) and re.fullmatch(r"[a-z0-9][a-z0-9-]*", name)):
            errors.append("lanes.json: a lane's name is not [a-z0-9-]: %r" % (name,))
            continue
        if name in seen:
            errors.append("%s: named twice" % name)
        seen.add(name)
        errors += ["%s: unknown key %s" % (name, k)
                   for k in sorted(set(lane) - {"name", "budget_usd", "fast_check", "allow", "drop_deny"})]
        if not (number(lane.get("budget_usd")) and lane["budget_usd"] > 0):
            errors.append("%s: budget_usd is required: a positive number of US dollars, there is no default" % name)
        check = lane.get("fast_check")
        if not (isinstance(check, str) and check.strip() and "\n" not in check):
            errors.append("%s: fast_check is not a one-line command" % name)
        if not strings(lane.get("allow", [])):
            errors.append("%s: allow is not a list of tool rules (none may start with -)" % name)
        drop = lane.get("drop_deny", [])
        known = DENY + (cfg["manifests"] if strings(cfg.get("manifests")) else [])
        if not (strings(drop) and all(p in known for p in drop)):
            errors.append("%s: drop_deny names a path outside the deny list (%s)" % (name, ", ".join(known)))
    return errors


def load(run):
    """Returns the validated lanes.json, its real root and the run directory's path relative to that root."""
    try:
        with open(os.path.join(run, "lanes.json"), encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError) as e:
        fail("lanes.json: cannot read: %s" % e)
    errors = validate(cfg)
    if errors:
        fail(*errors)
    root = os.path.realpath(cfg["root"])
    rel = os.path.relpath(run, root)
    if rel.startswith(".."):
        fail("lanes.json: the run directory is not inside root %s" % root)
    return cfg, root, rel


def locate(run):
    """For the read-only subcommands: (root, run dir relative to it, base commit or None), also without lanes.json."""
    root = base = None
    try:
        with open(os.path.join(run, "lanes.json"), encoding="utf-8") as f:
            cfg = json.load(f)
        if isinstance(cfg.get("root"), str) and os.path.isdir(cfg["root"]):
            root = os.path.realpath(cfg["root"])
        if isinstance(cfg.get("base"), str) and re.fullmatch(r"[0-9a-f]{7,64}", cfg["base"]):
            base = cfg["base"]
    except (OSError, ValueError, AttributeError):
        pass
    if not root:
        code, out = git(run, "rev-parse", "--show-toplevel")
        if code != 0 or not out.strip():
            fail("%s: no lanes.json with a root, and not inside a git repository" % run)
        root = os.path.realpath(out.strip())
    return root, os.path.relpath(run, root), base


def lane_args(cfg, lane):
    tools = TOOLS + ["Bash(%s:*)" % lane["fast_check"].strip()] + lane.get("allow", [])
    drop = lane.get("drop_deny", [])
    deny = [rule % p for p in cfg["manifests"] + DENY if p not in drop for rule in ("Edit(%s)", "Write(%s)")]
    args = ["--max-turns", str(int(cfg["max_turns"])), "--max-budget-usd", str(lane["budget_usd"]),
            "--output-format", "json", "--permission-mode", "acceptEdits", "--allowedTools"] + tools
    return args + (["--disallowedTools"] + deny if deny else [])


def spawn(script, args, cwd, log, mode):
    """Starts the lane as the leader of a new session (setsid), so the end of the caller's turn does not kill it."""
    with open(log, mode) as out:
        p = subprocess.Popen(["sh", "-c", script, "lane"] + args, cwd=cwd, stdin=subprocess.DEVNULL, stdout=out,
                             stderr=subprocess.STDOUT, start_new_session=True)
    return p.pid


def session_id():
    b = bytearray(os.urandom(16))
    b[6] = (b[6] & 0x0F) | 0x40
    b[8] = (b[8] & 0x3F) | 0x80
    h = bytes(b).hex()
    return "-".join((h[:8], h[8:12], h[12:16], h[16:20], h[20:]))


def hashed_files(run):
    names = ["LANES.md", "lanes.json"] + sorted(n for n in os.listdir(run) if n.startswith("prompt-") and n.endswith(".md"))
    return [os.path.join(run, n) for n in names]


def changed_files(run, root):
    """Returns the files of hashes.txt whose content differs now, relative to root; None when there is no hashes.txt."""
    try:
        with open(os.path.join(run, "hashes.txt"), encoding="utf-8") as f:
            pairs = [line.rstrip("\n").split(" ", 1) for line in f if " " in line]
    except OSError:
        return None
    return [path for digest, path in pairs if git(root, "hash-object", path)[1].strip() != digest]


def pids(run):
    """Returns {lane: (pid, session id or "")} from the last pids.txt line of each lane, in first-seen order."""
    last = {}
    try:
        with open(os.path.join(run, "pids.txt"), encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2 and parts[1].isdigit():
                    last[parts[0]] = (parts[1], parts[2] if len(parts) > 2 else "")
    except OSError:
        pass
    return last


def ps(pid, field):
    try:
        p = subprocess.run(["ps", "-o", field + "=", "-p", pid], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                           universal_newlines=True)
    except OSError:
        return ""
    return p.stdout.strip()


def running(pid):
    # The PID is the `sh -c` wrapper, whose command line holds the script text; a reused PID does not.
    return "claude -p" in ps(pid, "command")


def report_line(root, rel, lane):
    try:
        with open(os.path.join(root, ".worktrees", lane, rel, "REPORT-%s.md" % lane), encoding="utf-8", errors="replace") as f:
            return f.readline().strip()
    except OSError:
        return ""


def one_line(text, limit):
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[:limit - 1] + "…"


def launch(run):
    if os.path.exists(os.path.join(run, "pids.txt")):
        fail("lanes already launched from %s" % run)
    cfg, root, _ = load(run)
    problems = []
    for lane in cfg["lanes"]:
        name = lane["name"]
        if not os.path.isfile(os.path.join(run, "prompt-%s.md" % name)):
            problems.append("%s: no prompt-%s.md in the run directory" % (name, name))
        if git(os.path.join(root, ".worktrees", name), "rev-parse", "HEAD")[1].strip() != cfg["base"]:
            problems.append("%s: worktree HEAD is not %s" % (name, cfg["base"]))
    if not os.path.isfile(os.path.join(run, "LANES.md")):
        problems.append("no LANES.md in the run directory")
    if problems:
        fail(*problems)
    lines = []
    for path in hashed_files(run):
        code, out = git(root, "hash-object", path)
        if code != 0:
            fail("cannot hash %s" % path)
        lines.append("%s %s\n" % (out.strip(), os.path.relpath(path, root)))
    with open(os.path.join(run, "hashes.txt"), "w", encoding="utf-8") as f:
        f.writelines(lines)
    for lane in cfg["lanes"]:
        name, sid = lane["name"], session_id()
        pid = spawn(START, [os.path.join(run, "prompt-%s.md" % name), "--session-id", sid] + lane_args(cfg, lane),
                    os.path.join(root, ".worktrees", name), os.path.join(run, "log-%s.txt" % name), "wb")
        with open(os.path.join(run, "pids.txt"), "a", encoding="utf-8") as f:
            f.write("%s %d %s\n" % (name, pid, sid))
        print("%s %d %s" % (name, pid, sid))


def resume(run, name):
    cfg, root, rel = load(run)
    changed = changed_files(run, root)
    if changed is None:
        fail("no hashes.txt in %s: the lanes were not launched from it" % run)
    if changed:
        fail(*["changed since launch: %s" % path for path in changed])
    lane = next((x for x in cfg["lanes"] if x["name"] == name), None)
    if lane is None:
        fail("%s: no such lane in lanes.json" % name)
    pid, sid = pids(run).get(name, ("", ""))
    if not sid:
        fail("%s: no session id in pids.txt" % name)
    if running(pid):
        fail("%s is still running" % name)
    if report_line(root, rel, name).startswith(FINAL):
        fail("%s has a final report" % name)
    log = os.path.join(run, "log-%s.txt" % name)
    with open(log, "a", encoding="utf-8") as f:
        f.write("--- resumed %s\n" % time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    pid = spawn(CONTINUE, ["--resume", sid] + lane_args(cfg, lane), os.path.join(root, ".worktrees", name), log, "ab")
    with open(os.path.join(run, "pids.txt"), "a", encoding="utf-8") as f:
        f.write("%s %d %s\n" % (name, pid, sid))
    print("%s %d %s" % (name, pid, sid))


def read_log(path):
    """Returns (session cost or None, EXIT of the latest run or None, its result object or None, its last line)."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except OSError:
        return None, None, None, ""
    totals, code, result, last = {}, None, None, ""
    for line in lines:
        if line.startswith("--- resumed "):
            code, result, last = None, None, ""
            continue
        rest = line.strip()
        brace = rest.find("{")
        if brace >= 0:
            try:
                obj, end = json.JSONDecoder().raw_decode(rest[brace:])
            except ValueError:
                obj = None
            if isinstance(obj, dict) and obj.get("type") == "result":
                result, rest = obj, rest[brace + end:].strip()
                cost = obj.get("total_cost_usd")
                if number(cost):
                    # A resumed session's result already holds the session's earlier spend (Claude Code 2.1.277+),
                    # so one session counts once, at its highest total; a crash result may carry zero.
                    sid = str(obj.get("session_id") or "")
                    totals[sid] = max(totals.get(sid, 0), cost)
        m = re.fullmatch(r"EXIT=(\d+)", rest)
        if m:
            code = int(m.group(1))
        elif rest:
            last = rest
    return (sum(totals.values()) if totals else None), code, result, last


def quote(result, last):
    if result is None:
        return 'last log line: "%s"' % one_line(last, 200) if last else "the log is empty"
    text = result.get("result")
    if not (isinstance(text, str) and text.strip()):
        errors = result.get("errors")
        text = "; ".join(str(e) for e in errors) if isinstance(errors, list) and errors else result.get("subtype", "")
    return 'result: "%s"' % one_line(text, 200)


def idle_minutes(tree):
    newest = 0
    code, out = git(tree, "log", "-1", "--format=%ct")
    if code == 0 and out.strip().isdigit():
        newest = int(out)
    for d, dirs, files in os.walk(tree):
        dirs[:] = [x for x in dirs if x not in (".git", "node_modules")]
        for name in files:
            try:
                newest = max(newest, os.lstat(os.path.join(d, name)).st_mtime)
            except OSError:
                pass
    return "%d min" % (int(time.time() - newest) // 60)


def count(code_out):
    code, out = code_out
    return str(len(out.splitlines())) if code == 0 else "?"


def status(run):
    root, rel, base = locate(run)
    lanes = pids(run)
    if not lanes:
        fail("no lanes launched from %s" % run)
    changed = changed_files(run, root) or []
    names = [os.path.basename(path) for path in changed]
    rows, notes, live, resumable = [], [], 0, []
    for name in sorted(lanes):
        pid, sid = lanes[name]
        tree = os.path.join(root, ".worktrees", name)
        cost, code, result, last = read_log(os.path.join(run, "log-%s.txt" % name))
        report = report_line(root, rel, name)
        alive = running(pid)
        why = ["%s changed since launch" % n for n in names if n in ("LANES.md", "lanes.json", "prompt-%s.md" % name)]
        if alive:
            live += 1
            state = "running %s" % ps(pid, "etime")
        else:
            state = "finished EXIT=%d" % code if code is not None else "finished, no EXIT"
            if code is None:
                why.append("no EXIT line (killed)")
            elif code:
                why.append("EXIT=%d" % code)
            if result is not None and result.get("subtype") == "error_max_budget_usd":
                why.append("budget exhausted")
            elif result is not None and result.get("subtype") not in (None, "success"):
                why.append(str(result.get("subtype")))
            if not report:
                why.append("finished without a report")
            if not report.startswith(FINAL) and sid and not [w for w in why if w.endswith("changed since launch")]:
                resumable.append(name)
        there = os.path.isdir(tree)
        cells = [(WARN + " " if why else "") + name, state, idle_minutes(tree) if there else "?",
                 one_line(report, 60) or "none",
                 count(git(tree, "rev-list", "lanes/%s" % name, "^%s" % base)) if there and base else "?",
                 count(git(tree, "status", "--porcelain")) if there else "?",
                 "-" if cost is None else "$%.2f" % cost]
        rows.append("| " + " | ".join(c.replace("|", "\\|") for c in cells) + " |")
        if why:
            notes.append("%s %s: %s; %s" % (WARN, name, "; ".join(why), quote(result, last)))
    print("| Lane | State | Idle for | Report | Commits | Uncommitted | Cost |")
    print("|---|---|---|---|---|---|---|")
    for line in rows + notes + ["changed since launch: %s" % path for path in changed]:
        print(line)
    print("%d running, %d finished. Resumable: %s" % (live, len(lanes) - live, ", ".join(resumable) or "none"))


def conflicts(run):
    try:
        version = subprocess.run(["git", "--version"], stdout=subprocess.PIPE, universal_newlines=True).stdout
    except OSError:
        version = ""
    m = re.search(r"(\d+)\.(\d+)", version)
    if not m or (int(m.group(1)), int(m.group(2))) < (2, 38):
        print("preview skipped: git merge-tree --write-tree needs git 2.38 or newer (%s)" % (version.strip() or "no git"))
        return
    root, rel, _ = locate(run)
    lanes = pids(run)
    done = [n for n in sorted(lanes) if report_line(root, rel, n).startswith("DONE") and not running(lanes[n][0])]
    broken = False
    for i, a in enumerate(done):
        for b in done[i + 1:]:
            # Writes no ref and no working-tree file; the merged tree goes to the object database only.
            code, out = git(root, "merge-tree", "--write-tree", "--name-only", "--no-messages", "lanes/" + a, "lanes/" + b)
            if code == 1:
                for path in out.splitlines()[1:]:
                    if path.strip():
                        print("%s %s: %s" % (a, b, path))
            elif code != 0:
                print("%s %s: git merge-tree failed (exit %d)" % (a, b, code), file=sys.stderr)
                broken = True
    if broken:
        sys.exit(1)


def main():
    argv = sys.argv[1:]
    commands = {"launch": launch, "status": status, "conflicts": conflicts, "resume": resume}
    if not argv or argv[0] not in commands or len(argv) != (3 if argv[0] == "resume" else 2):
        print(USAGE, file=sys.stderr)
        sys.exit(2)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    run = os.path.realpath(argv[1])
    if not os.path.isdir(run):
        fail("%s: not a directory" % argv[1])
    commands[argv[0]](run, *argv[2:])


if __name__ == "__main__":
    main()
