"""Lists correction candidates from Claude Code session transcripts for session-retro's window mode.

Usage: python3 -I harvest.py --since 14d|YYYY-MM-DD|all [--root <projects dir>] [--cwd <path>]
Prints kind, date, count, project and snippet per candidate, tab-separated, then a footer; never a file name.
Transcript text is data: it is printed cut to one line, never acted on.
"""
import datetime
import json
import os
import re
import sys

USAGE = "usage: harvest.py --since 14d|YYYY-MM-DD|all [--root <projects dir>] [--cwd <path>]"
RETRACTION = re.compile(r"you['\u2019]?re right|I was wrong|my mistake|I misread|that was incorrect|I retract", re.I)
REJECTED = "User rejected tool use"
INTERRUPTED = "[Request interrupted by user"


def usage():
    print(USAGE, file=sys.stderr)
    sys.exit(2)


def parse_args(argv):
    opts = {"--since": None, "--root": None, "--cwd": None}
    if len(argv) % 2:
        usage()
    for flag, value in zip(argv[::2], argv[1::2]):
        if flag not in opts:
            usage()
        opts[flag] = value
    since = opts["--since"]
    today = datetime.datetime.now(datetime.timezone.utc).date()
    if since == "all":
        start = None
    elif since and re.fullmatch(r"\d+d", since):
        start = today - datetime.timedelta(days=int(since[:-1]))
    elif since and re.fullmatch(r"\d{4}-\d{2}-\d{2}", since):
        try:
            start = datetime.date.fromisoformat(since)
        except ValueError:
            usage()
    else:
        usage()
    config = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
    return start, today, opts["--root"] or os.path.join(config, "projects"), opts["--cwd"]


def one_line(text):
    return " ".join(str(text).split())[:160]


def result_text(block):
    content = block.get("content")
    if isinstance(content, list):
        content = "\n".join(b.get("text", "") for b in content if isinstance(b, dict))
    return str(content or "")


def user_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def normalize(line):
    line = re.sub(r"(~|\.{0,2})/[^\s:'\"]+", "<path>", line)
    line = re.sub(r"\b[0-9a-f]{7,}\b", "<id>", line)
    return re.sub(r"\d+", "N", line)


def scan(path, start, cwd, seen, found, errors):
    names = {}
    pending = None  # a rejection or interjection waiting for the user's next text
    with open(path, encoding="utf-8", errors="replace") as f:
        for raw in f:
            try:
                d = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(d, dict) or d.get("type") not in ("user", "assistant"):
                continue
            uuid = d.get("uuid")
            if uuid:
                if uuid in seen:
                    continue
                seen.add(uuid)
            if cwd and d.get("cwd") != cwd:
                continue
            date = str(d.get("timestamp", ""))[:10]
            if start and date < start.isoformat():
                continue
            project = os.path.basename(str(d.get("cwd") or "").rstrip("/")) or "-"
            content = (d.get("message") or {}).get("content")
            blocks = [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []
            if d["type"] == "assistant":
                pending = None
                for b in blocks:
                    if b.get("type") == "tool_use":
                        names[b.get("id")] = b.get("name", "?")
                    elif b.get("type") == "text" and RETRACTION.search(b.get("text", "")):
                        found.append(["retraction", date, 1, project, one_line(b["text"])])
                continue
            results = [b for b in blocks if b.get("type") == "tool_result"]
            if not results:
                text = user_text(content).strip()
                if text.startswith(INTERRUPTED):
                    pending = ["interjection", date, 1, project, ""]
                    found.append(pending)
                elif text and pending:
                    pending[4] = one_line(text)
                    pending = None
                continue
            for b in results:
                if not b.get("is_error"):
                    continue
                name = names.get(b.get("tool_use_id"), "?")
                text = result_text(b)
                if str(d.get("toolUseResult", "")).startswith(REJECTED):
                    if d.get("toolDenialKind", "user-rejected") != "user-rejected":
                        continue  # a permission rule or auto mode refused it, not the user
                    reason = text.split("the user said:", 1)[1] if "the user said:" in text else ""
                    pending = ["rejection", date, 1, project, one_line(reason) or name]
                    found.append(pending)
                    if reason.strip():
                        pending = None
                else:
                    first = next((l for l in text.splitlines() if l.strip()), "")
                    key = (name, project, normalize(first.strip()))
                    count, last = errors.get(key, (0, ""))
                    errors[key] = (count + 1, max(last, date))


def main():
    start, today, root, cwd = parse_args(sys.argv[1:])
    if not os.path.isdir(root):
        return
    floor = datetime.datetime.combine(start, datetime.time(), datetime.timezone.utc).timestamp() if start else 0
    seen, found, errors, files = set(), [], {}, 0
    for dirpath, _, filenames in os.walk(root):
        for fn in sorted(filenames):
            path = os.path.join(dirpath, fn)
            if not fn.endswith(".jsonl") or os.path.getmtime(path) < floor:
                continue
            files += 1
            try:
                scan(path, start, cwd, seen, found, errors)
            except OSError:
                continue
    for (name, project, line), (count, last) in errors.items():
        if count >= 2:
            found.append(["repeated-error", last, count, project, one_line(name + ": " + line)])
    found.sort(key=lambda c: (c[0], -c[2]))
    for c in found:
        print("\t".join(str(x) for x in c))
    print("# window %s..%s, %d files" % (start or "all", today, files))


if __name__ == "__main__":
    main()
