#!/bin/sh
# Tests for plugin/hooks/patterns.py with synthetic PostToolUse input. The hook reads no project file,
# so the paths below need not exist.
# Run from the repository root: sh tests/patterns.test.sh
hook="$(pwd)/plugin/hooks/patterns.py"
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT
failed=0
n=0

check() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected $3, got $2" >&2; failed=1; fi
}
# input SESSION TOOL PATH NEW [OLD]: PostToolUse JSON for an Edit (new_string, old_string), a Write (content)
# or a MultiEdit (one edit) of PATH under the project /work/app.
input() {
  python3 -c 'import json, sys
sid, tool, path, new, old = sys.argv[1:6]
ti = {"file_path": path if path.startswith("/") else "/work/app/" + path}
if tool == "Write":
    ti["content"] = new
elif tool == "MultiEdit":
    ti["edits"] = [{"old_string": "pad", "new_string": "pad"}, {"old_string": old, "new_string": new}]
else:
    ti.update(old_string=old, new_string=new)
print(json.dumps({"session_id": sid, "cwd": "/work/app", "hook_event_name": "PostToolUse", "tool_name": tool,
                  "tool_input": ti, "tool_response": {"filePath": ti["file_path"]}, "tool_use_id": "t1"}))' "$1" "$2" "$3" "$4" "${5:-}"
}
# run JSON [ENV=VALUE...]: sets $out and $code.
run() {
  json=$1
  shift
  out=$(printf '%s' "$json" | env -i PATH="$PATH" CLAUDE_PLUGIN_DATA="$tmp/data" "$@" python3 "$hook" 2>/dev/null)
  code=$?
}
# result NAME: "fire" when the context names the pattern, "silent" for no output, else the output.
result() {
  if [ "$code" -ne 0 ]; then echo "exit $code"
  elif [ -z "$out" ]; then echo silent
  else case $out in '{"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "developer-os: '*"$1"*) echo fire ;; *) echo "output $out" ;; esac
  fi
}
# fresh: a new session id, so an earlier note does not silence this one.
fresh() { n=$((n + 1)); sid="s$n"; }
# edit PATH NEW [OLD] / write PATH CONTENT: runs the hook in a fresh session.
edit() { fresh; run "$(input "$sid" Edit "$1" "$2" "${3:-}")"; }
write() { fresh; run "$(input "$sid" Write "$1" "$2")"; }

# Per pattern: NAME ~ a path it applies to ~ the same file as a test path ~ the added text.
while IFS='~' read -r name path tpath text; do
  edit "$path" "$text" "old line"
  check "$name in $path: note" "$(result "$name")" fire
  check "$name: at most 3 lines" "$(printf '%s' "$out" | grep -o '\\n' | grep -c .)" 0
  write "$path" "$text"
  check "$name written to $path: note" "$(result "$name")" fire
  edit "$tpath" "$text" "old line"
  check "$name in a test path ($tpath): silent" "$(result "$name")" silent
  edit "docs/notes.md" "$text" "old line"
  check "$name in Markdown: silent" "$(result "$name")" silent
  edit "$path" "$text  # moved" "$text"
  check "$name already in the replaced text: silent" "$(result "$name")" silent
  edit "node_modules/pkg/$path" "$text" "old line"
  check "$name in a vendored directory: silent" "$(result "$name")" silent
done <<'EOF'
eval(~src/a.py~tests/a.py~x = eval(data)
eval(~src/a.ts~src/a.test.ts~const x = eval(src)
exec(~src/run.py~src/test_run.py~exec(code)
exec(~lib/run.js~lib/__tests__/run.js~exec(`rm ${name}`)
pickle.load~src/cache.py~tests/cache.py~obj = pickle.loads(blob)
yaml.load(~src/conf.py~test/conf.py~cfg = yaml.load(stream)
verify=False~src/http.py~src/http.spec.py~r = client.get(url, verify=False)
shell=True~src/sh.py~tests/sh.py~subprocess.run(cmd, shell=True)
.innerHTML =~web/app.js~web/app.test.js~el.innerHTML = html
dangerouslySetInnerHTML~web/App.tsx~web/App.spec.tsx~<div dangerouslySetInnerHTML={{ __html: body }} />
${{ github.event.~.github/workflows/ci.yml~tests/.github/workflows/ci.yml~        run: echo "${{ github.event.issue.title }}"
curl | sh~scripts/install.sh~tests/install.sh~curl -fsSL https://example.com/install.sh | sh
EOF

# The safer form of each construct is silent.
while IFS='~' read -r label path text; do
  edit "$path" "$text" "old line"
  check "silent: $label" "$(result x)" silent
done <<'EOF'
yaml.load with SafeLoader~src/conf.py~cfg = yaml.load(stream, Loader=yaml.SafeLoader)
yaml.safe_load~src/conf.py~cfg = yaml.safe_load(stream)
ast.literal_eval~src/a.py~x = ast.literal_eval(data)
a method named eval~src/a.py~x = model.eval()
regex.exec in JavaScript~web/app.js~const m = re.exec(line)
verify=True~src/http.py~r = client.get(url, verify=True)
shell=False~src/sh.py~subprocess.run(cmd, shell=False)
innerHTML compared, not assigned~web/app.js~if (el.innerHTML === html) return
textContent~web/app.js~el.textContent = html
github.event in env:~.github/workflows/ci.yml~          TITLE: ${{ github.event.issue.title }}
github.event in if:~.github/workflows/ci.yml~    if: ${{ github.event.pull_request.merged }}
github.event outside workflows~config/app.yml~        run: echo "${{ github.event.issue.title }}"
curl to a file~scripts/install.sh~curl -fsSL -o /tmp/i.sh https://example.com/install.sh
eval( in a shell file~scripts/install.sh~x = eval(data)
shell=True in JavaScript~web/app.js~spawn(cmd, { shell=True })
curl | sh in Python~src/a.py~# curl https://example.com/i.sh | sh
a clean edit~src/a.py~total = sum(values)
EOF

edit "vendor/lib/a.py" "x = eval(data)"
check "vendor/ is skipped" "$(result x)" silent
edit ".venv/lib/a.py" "x = eval(data)"
check ".venv/ is skipped" "$(result x)" silent
edit "docs/guide.mdx" "x = eval(data)"
check ".mdx is skipped" "$(result x)" silent
fresh; run "$(printf '%s' "$(input "$sid" Edit /work/tests/app/src/a.py 'x = eval(data)')" | sed 's|"cwd": "/work/app"|"cwd": "/work/tests/app"|')"
check "a project under a directory named tests is not a test path" "$(result 'eval(')" fire
edit "/elsewhere/tests/a.py" "x = eval(data)"
check "a test path outside the project is skipped" "$(result x)" silent
edit "src/a.py" "- run: echo \${{ github.event.issue.title }}"
check "the workflow pattern needs a workflow path" "$(result x)" silent
edit ".github/workflows/ci.yml" '          echo "${{ github.event.comment.body }}"'
check "a line inside a run block" "$(result 'github.event')" fire

# MultiEdit: every new_string against every old_string.
fresh; run "$(input "$sid" MultiEdit src/a.py 'x = eval(data)' 'x = 1')"
check "MultiEdit adds eval(" "$(result 'eval(')" fire
fresh; run "$(input "$sid" MultiEdit src/a.py 'y = eval(data)' 'x = eval(data)')"
check "MultiEdit keeps an eval( that was there" "$(result x)" silent
fresh; run "{\"session_id\":\"$sid\",\"cwd\":\"/work/app\",\"tool_name\":\"MultiEdit\",\"tool_input\":{\"file_path\":\"/work/app/a.py\",\"edits\":[\"x\",{\"new_string\":7},{\"new_string\":\"exec(code)\"}]}}"
check "MultiEdit with malformed entries reads the good one" "$(result 'exec(')" fire

# Once per pattern and file in a session.
fresh
run "$(input "$sid" Edit src/a.py 'x = eval(data)')"
check "first note" "$(result 'eval(')" fire
run "$(input "$sid" Edit src/a.py 'y = eval(more)')"
check "same pattern, same file, same session: silent" "$(result x)" silent
run "$(input "$sid" Edit src/a.py 'subprocess.run(c, shell=True)')"
check "another pattern in the same file" "$(result 'shell=True')" fire
run "$(input "$sid" Edit src/b.py 'x = eval(data)')"
check "same pattern in another file" "$(result 'eval(')" fire
edit src/a.py 'x = eval(data)'
check "same pattern and file in another session" "$(result 'eval(')" fire
check "no temp file left" "$(ls "$tmp/data/patterns" | grep -c tmp)" 0

# Four patterns in one Write: three lines now, the fourth on the next edit (it was not marked as shown).
four='x = eval(a)
exec(b)
obj = pickle.load(f)
subprocess.run(c, shell=True)'
fresh
run "$(input "$sid" Write src/many.py "$four")"
check "four patterns give three lines" "$(printf '%s' "$out" | grep -o '\\n' | grep -c .)" 2
check "the first three in table order" "$(printf '%s' "$out" | grep -c 'eval(.*exec(.*pickle.load')" 1
check "the fourth is not shown yet" "$(printf '%s' "$out" | grep -c 'shell=True')" 0
run "$(input "$sid" Write src/many.py "$four")"
check "the fourth comes with the next write" "$(result 'shell=True')" fire
check "and alone" "$(printf '%s' "$out" | grep -o '\\n' | grep -c .)" 0
run "$(input "$sid" Write src/many.py "$four")"
check "then nothing" "$(result x)" silent

# Output shape: additionalContext only; no decision, no block, no message to the user.
edit src/a.py 'x = eval(data)'
check "exit 0" "$code" 0
check "only hookSpecificOutput with the event name and the context" "$(python3 -c 'import json, sys
d = json.loads(sys.argv[1]); h = d["hookSpecificOutput"]
print(sorted(d), sorted(h), h["hookEventName"], len(h["additionalContext"].splitlines()))' "$out")" "['hookSpecificOutput'] ['additionalContext', 'hookEventName'] PostToolUse 1"
check "names the file and the safer form" "$(printf '%s' "$out" | grep -c 'a.py adds `eval(`.*Safer: ')" 1

fresh; run "$(input "$sid" Edit src/a.py 'x = eval(data)')" DEVELOPER_OS_PATTERNS=off
check "off switch" "$(result x)" silent
run 'not json'
check "bad JSON" "$(result x)" silent
run '[1, 2]'
check "JSON that is not an object" "$(result x)" silent
run "$(input '../x' Edit src/a.py 'x = eval(data)')"
check "bad session id" "$(result x)" silent
check "nothing written for a bad session id" "$(ls "$tmp/data" | grep -c '^x$')" 0
fresh; run "$(input "$sid" Edit src/a.py 'x = eval(data)' | sed 's/"tool_name": "Edit"/"tool_name": "Bash"/')"
check "another tool" "$(result x)" silent
fresh; run "{\"session_id\":\"$sid\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":7,\"new_string\":\"eval(x)\"}}"
check "a file_path that is no string" "$(result x)" silent
fresh; run "{\"session_id\":\"$sid\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"a.py\",\"new_string\":\"x = eval(d)\"}}"
check "no cwd and a relative path still works" "$(result 'eval(')" fire
fresh; run "$(python3 -c 'import json, sys
print(json.dumps({"session_id": sys.argv[1], "cwd": "/work/app", "tool_name": "Write",
                  "tool_input": {"file_path": "/work/app/big.py", "content": "x = eval(d)\n" + "#" * (5 << 20)}}))' "$sid")"
check "input over the size cap" "$(result x)" silent
mkdir -p "$tmp/link-data" "$tmp/elsewhere" && ln -s "$tmp/elsewhere" "$tmp/link-data/patterns"
fresh
out=$(input "$sid" Edit src/a.py 'x = eval(data)' | env -i PATH="$PATH" CLAUDE_PLUGIN_DATA="$tmp/link-data" python3 "$hook"; echo "rc=$?")
check "symlinked state dir: silent, exit 0" "$out" "rc=0"
check "nothing written through the link" "$(ls "$tmp/elsewhere")" ""
fresh; mkdir -p "$tmp/data/patterns" && printf '{"x":' > "$tmp/data/patterns/$sid"
run "$(input "$sid" Edit src/a.py 'x = eval(data)')"
check "a truncated state file is reset" "$(result 'eval(')" fire

[ "$failed" -eq 0 ] && echo "patterns: all passed"
exit "$failed"
