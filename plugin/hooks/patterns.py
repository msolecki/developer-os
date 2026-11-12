#!/usr/bin/env python3
"""PostToolUse hook (Edit, Write, MultiEdit): when an edit adds a known risky construct, tells the agent
once, in one line, what it is and the safer form. A rule loaded at session start does not fire at the
moment the construct is written; this note arrives next to the tool result.

It scans only the text the edit adds (`new_string`, `content`, each MultiEdit `new_string`) against a
closed table keyed by file extension, and reads no file. A construct that the replaced text
(`old_string`) already held as often is not new, so it stays silent; a Write carries no old text, so
every construct in its content counts. Test paths, Markdown and vendored directories are skipped.

Output is `additionalContext` only, at most 3 lines, once per pattern and file in a session. It gives no
decision and blocks nothing: the edit has already happened, and the construct may be what the user
wants. `DEVELOPER_OS_PATTERNS=off` turns it off.

Fails open: every unexpected state exits 0 with no output.
"""
import hashlib
import json
import os
import re
import sys
import time

MAX_INPUT = 4 << 20   # bytes of hook input; a larger edit is not scanned
MAX_TEXT = 256 << 10  # characters of added or replaced text scanned
MAX_STATE = 1 << 20
MAX_LINES = 3

PY = ("py",)
JS = ("js", "jsx", "mjs", "cjs", "ts", "tsx")
WEB = JS + ("html", "vue", "svelte")
SH = ("sh", "bash", "zsh")
YAML = ("yml", "yaml")

# (name shown, extensions, pattern, what it does, safer form). The order is the order of the lines.
RULES = (
    ("eval(", PY + JS, r"(?<![\w.])eval\(", "runs a string as code",
     "parse the data (json.loads, ast.literal_eval, JSON.parse) or call a named function"),
    ("exec(", PY + JS, r"(?<![\w.])exec\(", "runs a string as code or as a shell line",
     "call the function directly, or run the program with an argument list (subprocess.run([...]), execFile)"),
    ("pickle.load", PY, r"\bpickle\.loads?\(", "runs code stored in the data it reads",
     "use json for data from outside the process"),
    ("yaml.load(", PY, r"\byaml\.load\((?![^)]{0,200}Safe)", "builds arbitrary objects from the document without a safe loader",
     "yaml.safe_load(...) or Loader=yaml.SafeLoader"),
    ("verify=False", PY, r"\bverify\s*=\s*False\b", "turns TLS certificate checks off",
     "keep verification on and pass the CA bundle path for a private CA"),
    ("shell=True", PY, r"\bshell\s*=\s*True\b", "hands the command to a shell, so input can inject commands",
     "pass an argument list without a shell, or quote every value with shlex.quote"),
    (".innerHTML =", WEB, r"\.innerHTML\s*\+?=(?!=)", "parses a string as HTML, so input can inject script",
     "textContent, or sanitize the HTML first"),
    ("dangerouslySetInnerHTML", JS, r"\bdangerouslySetInnerHTML\b", "renders a string as HTML, so input can inject script",
     "render the text as children, or sanitize the HTML first"),
    # A workflow line that is not a `key: value` pair other than `run:`, so `if:` and the safer `env:` form stay silent.
    ("${{ github.event.", YAML, r"(?m)^(?![ \t]*(?:-[ \t]+)?(?!run:)[A-Za-z_][\w.-]*:(?:[ \t]|$))[^\n]*\$\{\{[ \t]*github\.event\.",
     "pastes event text into a run: script, so a title or branch name can inject commands",
     "pass it through env: and read \"$VAR\" in the script"),
    ("curl | sh", SH, r"\b(?:curl|wget)\b[^\n|]*\|[ \t]*(?:sudo[ \t]+)?(?:ba|z|da|k)?sh\b", "runs a download without a look at it",
     "download to a file, check a pinned version or checksum, then run it"),
)
RULES = tuple((name, exts, re.compile(pattern), risk, safer) for name, exts, pattern, risk, safer in RULES)

MARKDOWN = ("md", "mdx", "markdown")
VENDORED = re.compile(r"(^|/)(node_modules|vendor|third_party|bower_components|site-packages|\.venv|venv)/")
# The test paths of hooks/guard.py.
TEST_PATH = re.compile(r"(^|/)(tests?|__tests__)(/|$)|\.(test|spec)\.[^/]+$|(^|/)test_[^/]*\.py$|_test\.go$")
WORKFLOW = re.compile(r"(^|/)\.github/workflows/[^/]+$")


def owned_dir(path):
    st = os.lstat(path)
    return not os.path.islink(path) and st.st_uid == os.getuid()


def texts(tool, args):
    """(added, replaced) text of the call; missing or malformed parts count as empty."""
    def s(v):
        return v[:MAX_TEXT] if isinstance(v, str) else ""
    if tool == "Write":
        return s(args.get("content")), ""
    if tool == "Edit":
        return s(args.get("new_string")), s(args.get("old_string"))
    edits = args.get("edits")
    edits = [e for e in edits if isinstance(e, dict)][:1000] if isinstance(edits, list) else []
    return ("\n".join(s(e.get("new_string")) for e in edits)[:MAX_TEXT],
            "\n".join(s(e.get("old_string")) for e in edits)[:MAX_TEXT])


def main():
    if os.environ.get("DEVELOPER_OS_PATTERNS") == "off":
        return 0
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        # Drained in pieces, so the writer does not get a broken pipe; the hook timeout bounds it.
        while sys.stdin.buffer.read(1 << 20):
            pass
        return 0
    data = json.loads(raw.decode("utf-8", "replace"))
    if not isinstance(data, dict):
        return 0
    sid = data.get("session_id")
    tool = data.get("tool_name")
    args = data.get("tool_input")
    if not (isinstance(sid, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", sid)
            and tool in ("Edit", "Write", "MultiEdit") and isinstance(args, dict)):
        return 0
    path = args.get("file_path")
    if not (isinstance(path, str) and path) or len(path) > 4096:
        return 0
    # Relative to the project, so a checkout under a directory named tests/ or vendor/ is not skipped whole.
    cwd = data.get("cwd")
    rel = path.replace("\\", "/")
    if isinstance(cwd, str) and cwd:
        root = cwd.replace("\\", "/").rstrip("/") + "/"
        if rel.startswith(root):
            rel = rel[len(root):]
    name = rel.rsplit("/", 1)[-1]
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext in MARKDOWN or VENDORED.search(rel) or TEST_PATH.search(rel):
        return 0
    rules = [r for r in RULES if ext in r[1] and (r[1] is not YAML or WORKFLOW.search(rel))]
    if not rules:
        return 0
    added, replaced = texts(tool, args)
    hits = [r for r in rules if len(r[2].findall(added)) > len(r[2].findall(replaced))]
    if not hits:
        return 0

    # Same per-user base as the other hooks, so a shared root-owned /tmp cannot host the state.
    base = os.environ.get("CLAUDE_PLUGIN_DATA") or "%s/developer-os-%d" % (os.environ.get("TMPDIR") or "/tmp", os.getuid())
    state_dir = base + "/patterns"
    old = os.umask(0o077)
    try:
        os.makedirs(state_dir, exist_ok=True)
    finally:
        os.umask(old)
    if not (owned_dir(state_dir) and owned_dir(os.path.dirname(state_dir))):
        return 0
    state = state_dir + "/" + sid
    if os.path.islink(state):
        return 0
    # A corrupt file (a writer killed by the timeout) forgets what was shown instead of disabling the hook.
    seen = []
    try:
        with open(state, "rb") as f:
            seen = json.loads(f.read(MAX_STATE).decode("utf-8", "replace"))
    except (OSError, ValueError):
        pass
    if not (isinstance(seen, list) and all(isinstance(k, str) for k in seen)):
        seen = []

    def key(rule):
        return hashlib.sha256((rule[0] + "\0" + path).encode("utf-8", "replace")).hexdigest()[:16]
    # Only what is shown is marked: a fourth pattern waits for the next edit of the file.
    show = [r for r in hits if key(r) not in seen][:MAX_LINES]
    if not show:
        return 0
    seen.extend(key(r) for r in show)
    # Written to a temp file and renamed, so a reader never sees a half-written file.
    tmp = "%s.%d.tmp" % (state, os.getpid())
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(seen[-5000:], f)
    os.replace(tmp, state)

    now = time.time()
    for entry in os.scandir(state_dir):
        try:
            if entry.is_file(follow_symlinks=False) and now - entry.stat(follow_symlinks=False).st_mtime >= 8 * 86400:
                os.remove(entry.path)
        except OSError:
            pass

    shown = re.sub(r"[^\w.@+-]", "?", name)[:80]
    lines = ["developer-os: %s adds `%s`, which %s. Safer: %s. Keep it only if the input is trusted."
             % (shown, r[0], r[3], r[4]) for r in show]
    sys.stdout.write(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse",
                                                        "additionalContext": "\n".join(lines)}}))
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except Exception:
        code = 0
    sys.exit(code)
