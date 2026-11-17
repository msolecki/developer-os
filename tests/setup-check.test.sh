#!/bin/sh
# Tests plugin/skills/setup-check/check.py with a fake PATH (stub tools) and a fake config directory.
# Run from the repository root: sh tests/setup-check.test.sh
script="$(pwd)/plugin/skills/setup-check/check.py"
py=$(command -v python3) || exit 1
tmp=$(mktemp -d) || exit 1
trap 'chmod -R u+rwx "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
failed=0
bin=$tmp/bin
cfg=$tmp/config

# stub NAME BODY: an executable sh script on the fake PATH; only shell builtins, the PATH holds nothing else.
stub() { printf '#!/bin/sh\n%s\n' "$2" > "$bin/$1"; chmod +x "$bin/$1"; }
tools() {
  rm -rf "$bin"; mkdir -p "$bin"
  stub python3 'echo "Python 3.11.4"'
  stub rg 'echo "ripgrep 14.1.0"'
  stub jq 'echo "jq-1.7.1"'
  stub gh 'if [ "$1" = auth ]; then echo "Logged in to github.com"; exit 0; fi; echo "gh version 2.60.0 (2030-01-01)"'
  stub git 'echo "git version 2.39.5 (Apple Git-154)"'
  stub claude 'echo "2.1.319 (Claude Code)"'
}
# run [ENV=VALUE...]: runs the script with only the fake PATH, home and config directory; sets $out and $code.
run() {
  out=$(env -i PATH="$bin" HOME="$tmp/home" CLAUDE_CONFIG_DIR="$cfg" "$@" "$py" -I "$script" 2>/dev/null)
  code=$?
}
check() {
  if [ "$2" = "$3" ]; then echo "ok   setup-check: $1"; else echo "FAIL setup-check: $1: expected $3, got $2" >&2; failed=1; fi
}
# line NAME: the output line of one check.
line() { printf '%s\n' "$out" | grep -e "^[a-z]* $1: "; }
status() { line "$1" | cut -d' ' -f1; }
count() { printf '%s\n' "$out" | grep -c -e "^$1 "; }

mkdir -p "$cfg" "$tmp/home" "$tmp/vault" "$tmp/other-vault" "$tmp/project/.claude"
printf 'Brain vault: %s\n' "$tmp/vault" > "$cfg/CLAUDE.md"
printf '{"autoMemoryEnabled": false}\n' > "$cfg/settings.json"
tools

run
check "exits 0" "$code" 0
check "nine checks, one line each" "$(printf '%s\n' "$out" | grep -c .)" 9
check "every check ok on a complete machine" "$(count ok)" 9
check "python3 line names the version" "$(line python3)" "ok python3: 3.11.4"
check "git with a vendor suffix is ok" "$(line git)" "ok git: 2.39.5"
check "vault from the user-level CLAUDE.md" "$(line vault)" "ok vault: $tmp/vault (Brain vault: line in CLAUDE.md)"
check "gh auth ok" "$(status 'gh auth')" ok
check "claude version" "$(line claude)" "ok claude: 2.1.319"

rm "$bin/rg"
run
check "missing rg exits 0" "$code" 0
check "missing rg is one missing line" "$(count missing)" 1
check "and it names rg" "$(status rg)" missing
check "the rest stays ok" "$(count ok)" 8
tools

stub git 'echo "git version 2.9.0"'
run
check "git 2.9.0 is older than 2.38" "$(status git)" warn
stub git 'echo "git version 2.38.0"'
run
check "git 2.38.0 is ok" "$(status git)" ok
stub python3 'echo "Python 3.7.9"'
run
check "python3 3.7 is too old" "$(status python3)" warn
rm "$bin/python3"
run
check "no python3 on PATH is missing" "$(status python3)" missing
tools

stub gh 'if [ "$1" = auth ]; then echo "You are not logged into any GitHub hosts" >&2; exit 1; fi; echo "gh version 2.60.0 (2030-01-01)"'
run
check "gh without a login warns" "$(status 'gh auth')" warn
check "gh itself is still ok" "$(status gh)" ok
rm "$bin/gh"
run
check "missing gh" "$(status gh)" missing
check "missing gh has no auth line" "$(line 'gh auth')" ""
rm "$bin/claude" "$bin/jq"
run
check "missing claude" "$(status claude)" missing
check "missing jq" "$(status jq)" missing
check "three missing lines" "$(count missing)" 3
stub jq 'exit 3'
run
check "a tool that fails to run is missing" "$(status jq)" missing
tools

# D5: only the user level names the vault. A project CLAUDE.md, project settings and the option's
# environment variable are ignored.
rm "$cfg/CLAUDE.md"
printf 'Brain vault: %s\n' "$tmp/other-vault" > "$tmp/project/CLAUDE.md"
printf '{"pluginConfigs":{"developer-os@developer-os":{"options":{"brain_vault":"%s"}}},"autoMemoryEnabled":false}\n' "$tmp/other-vault" > "$tmp/project/.claude/settings.json"
cd "$tmp/project" && run CLAUDE_PLUGIN_OPTION_BRAIN_VAULT="$tmp/other-vault" && cd - >/dev/null
check "a vault only in project files is not configured" "$(line vault)" "warn vault: not configured"
check "the project vault path is never printed" "$(printf '%s\n' "$out" | grep -c other-vault)" 0

printf 'Brain vault: %s\n' "$tmp/vault" > "$cfg/CLAUDE.md"
printf '{"pluginConfigs":{"developer-os@developer-os":{"options":{"brain_vault":"%s"}}},"autoMemoryEnabled":false}\n' "$tmp/other-vault" > "$cfg/settings.json"
run
check "the settings.json option wins over the line" "$(line vault)" "ok vault: $tmp/other-vault (brain_vault option in settings.json)"
printf '{"pluginConfigs":{"developer-os@developer-os":{"options":{"brain_vault":""}}},"autoMemoryEnabled":false}\n' > "$cfg/settings.json"
run
check "an empty option falls back to the line" "$(line vault)" "ok vault: $tmp/vault (Brain vault: line in CLAUDE.md)"

printf 'Brain vault: %s\n' "$tmp/gone" > "$cfg/CLAUDE.md"
run
check "a vault path that is no directory is missing" "$(line vault)" "missing vault: $tmp/gone is not a readable directory (Brain vault: line in CLAUDE.md)"
printf 'Brain vault: relative/vault\n' > "$cfg/CLAUDE.md"
run
check "a relative vault path is missing" "$(status vault)" missing
if [ "$(id -u)" -ne 0 ]; then
  mkdir -p "$tmp/locked" && chmod 000 "$tmp/locked"
  printf 'Brain vault: %s\n' "$tmp/locked" > "$cfg/CLAUDE.md"
  run
  check "an unreadable vault is missing" "$(status vault)" missing
fi
printf 'Brain vault: %s\n' "$tmp/vault" > "$cfg/CLAUDE.md"

printf '{"autoMemoryEnabled": true}\n' > "$cfg/settings.json"
run
check "auto memory on warns" "$(status autoMemoryEnabled)" warn
printf '{}\n' > "$cfg/settings.json"
printf '{"autoMemoryEnabled": false}\n' > "$tmp/project/.claude/settings.json"
cd "$tmp/project" && run && cd - >/dev/null
check "auto memory unset warns, project settings ignored" "$(status autoMemoryEnabled)" warn
printf 'not json' > "$cfg/settings.json"
run
check "invalid settings.json warns" "$(status autoMemoryEnabled)" warn
check "invalid settings.json still exits 0" "$code" 0
rm "$cfg/settings.json"
run
check "no settings.json warns" "$(status autoMemoryEnabled)" warn
run CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
check "the environment switch turns auto memory off without settings.json" "$(line autoMemoryEnabled)" "ok autoMemoryEnabled: off (CLAUDE_CODE_DISABLE_AUTO_MEMORY=1)"
printf '{"autoMemoryEnabled": true}\n' > "$cfg/settings.json"
run CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
check "the environment switch wins over autoMemoryEnabled: true" "$(status autoMemoryEnabled)" ok
run CLAUDE_CODE_DISABLE_AUTO_MEMORY=0
check "the switch set to 0 does not turn it off" "$(status autoMemoryEnabled)" warn

# A `gh auth status` that never answers is cut by the 10-second timeout: the check warns and the rest still prints.
# The stub spins in the shell, since the fake PATH holds no sleep.
stub gh 'if [ "$1" = auth ]; then while :; do :; done; fi; echo "gh version 2.60.0 (2030-01-01)"'
run
check "a hanging gh auth status exits 0" "$code" 0
check "a hanging gh auth status warns" "$(line 'gh auth')" "warn gh auth: not logged in"
check "the checks after it still print" "$(status claude)" ok
tools

# Without CLAUDE_CONFIG_DIR the config directory is ~/.claude.
mkdir -p "$tmp/home/.claude"
printf 'Brain vault: %s\n' "$tmp/other-vault" > "$tmp/home/.claude/CLAUDE.md"
out=$(env -i PATH="$bin" HOME="$tmp/home" "$py" -I "$script" 2>/dev/null)
check "the default config directory is ~/.claude" "$(line vault)" "ok vault: $tmp/other-vault (Brain vault: line in CLAUDE.md)"

# Read-only: the config directory holds what it held.
printf '{"autoMemoryEnabled": true}\n' > "$cfg/settings.json"
before=$(ls -A "$cfg"; cat "$cfg/settings.json" "$cfg/CLAUDE.md")
run
check "the config directory is unchanged" "$(ls -A "$cfg"; cat "$cfg/settings.json" "$cfg/CLAUDE.md")" "$before"
check "the vault is unchanged" "$(ls -A "$tmp/vault")" ""

[ "$failed" -eq 0 ] && echo "setup-check: all passed"
exit "$failed"
