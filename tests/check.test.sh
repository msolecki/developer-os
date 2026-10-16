#!/bin/sh
# Tests for scripts/check.sh: each case breaks a copy of the repository and expects the stage's message.
# Run from the repository root: sh tests/check.test.sh
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT
failed=0
r="$tmp/r"
g() { git -C "$r" -c user.name=t -c user.email=t@example.com -c core.hooksPath=/dev/null -c core.fsmonitor=false "$@"; }

# One committed copy of the working tree, without this test (check.sh would run it again); reset before each case.
mkdir "$r"
git ls-files -z --cached --others --exclude-standard | rsync -a --from0 --files-from=- . "$r" 2>/dev/null
rm -f "$r/tests/check.test.sh"
g init -q && g add -A && g commit -qm base
reset() { g checkout -q . && g clean -fdq; }

# run NAME WANT [TEXT]: runs check.sh in the copy; WANT is fail or pass, TEXT must appear in its output.
run() {
  out=$(cd "$r" && PATH="${runpath:-$PATH}" bash scripts/check.sh 2>&1) && got=pass || got=fail
  case $out in *"${3:-}"*) ;; *) got="$got without '${3:-}'" ;; esac
  if [ "$got" = "$2" ]; then echo "ok   $1"; else echo "FAIL $1: expected $2, got $got" >&2; printf '%s\n' "$out" | tail -5 >&2; failed=1; fi
  reset
}
# edit FILE SED: rewrites FILE in the copy through sed.
edit() { sed "$2" "$r/$1" > "$tmp/x" && mv "$tmp/x" "$r/$1"; }

mv "$r/plugin/skills/implement-backlog" "$r/plugin/skills/backlog-run"
edit plugin/skills/backlog-run/SKILL.md 's/^name: implement-backlog$/name: backlog-run/'
edit plugin/SURFACE.txt 's/^skill implement-backlog$/skill backlog-run/'
LC_ALL=C sort "$r/plugin/SURFACE.txt" > "$tmp/x" && mv "$tmp/x" "$r/plugin/SURFACE.txt"
run "a renamed skill leaves its old bare name" fail "implement-backlog was removed from plugin/SURFACE.txt"

edit plugin/skills/brain-garden/SKILL.md '/^Find the line `Brain vault:/s/ once / twice /'
run "a brain skill drifts from the shared vault paragraph" fail "vault: plugin/skills/brain-garden/SKILL.md"

edit evals/injection-fix-pr/graders/no-curl.md 's/^input_match: "curl"$/input_match: "curl(?!---)"/'
run "--- inside an eval grader's frontmatter" fail "frontmatter: evals/injection-fix-pr/graders/no-curl.md: line 4"

echo 'See /Users/bob/x.' >> "$r/plugin/agents/qa-expert.md"
run "a local path in an agent" fail "local path"

echo '[bad](references/none.md)' >> "$r/plugin/skills/spec/SKILL.md"
run "a broken relative link in a skill" fail "links: plugin/skills/spec/SKILL.md"

echo '[bad](#no-such-heading)' >> "$r/docs/development.md"
run "a link to a missing heading" fail "names no heading"

echo '# developer-os:nonexistent' >> "$r/plugin/hooks/guard.sh"
run "a dangling reference in a hook" fail "references: plugin/hooks/guard.sh"

perl -pi -e 's/^## \[Unreleased\]$/$&\n\nShips 99 skills./' "$r/CHANGELOG.md"
run "a stale count in the Unreleased section of CHANGELOG.md" fail "counts: CHANGELOG.md"

jq '.hook = {}' "$r/plugin/.claude-plugin/plugin.json" > "$tmp/x" && mv "$tmp/x" "$r/plugin/.claude-plugin/plugin.json"
run "a misspelled plugin.json key" fail "Unknown field 'hook'"

# A validate output whose warning line lacks the usual marker still fails through the "Found N" count.
mkdir "$tmp/bin"
printf '%s\n' '#!/bin/sh' 'case "$*" in *--strict*) printf "Found 1 warning:\n  - hook: Unknown field\n"; exit 1 ;; esac' > "$tmp/bin/claude"
chmod +x "$tmp/bin/claude"
runpath="$tmp/bin:$PATH"
run "a validate warning" fail "claude plugin validate --strict failed"
runpath=

edit plugin/skills/spec/SKILL.md '/^## Never$/d'
run "an action skill without ## Never" fail "plugin/skills/spec/SKILL.md: skill has no ## Never section"

edit plugin/skills/spec/SKILL.md 's/^description: .*/description: Too short./'
run "a skill description under 80 characters" fail "description is 10 characters, allowed 80-1024"

edit docs/development.md '/^last-verified:/d'
run "a doc without last-verified" fail "docs/development.md: last-verified is not a YYYY-MM-DD date"

printf '\nx: [\n' >> "$r/plugin/vault-template/_views/Inbox.base"
run "an invalid .base file" fail "yaml: plugin/vault-template/_views/Inbox.base"

edit plugin/hooks/hooks.json 's|/hooks/guard.sh|/hooks/gone.sh|'
run "a hook target that does not exist" fail "missing target plugin/hooks/gone.sh"

edit plugin/agents/qa-expert.md '/^## Final status$/d'
run "an agent without ## Final status" fail "agents: plugin/agents/qa-expert.md: no ## Final status section"

printf '%100s\n' x >> "$r/plugin/rules/core.md"
run "core.md over 8192 bytes" fail "size: plugin/rules/core.md"

edit plugin/hooks/session-start.sh 's/^cap=.*/cap=2000/'
run "a state-card cap that overflows 10000" fail "state card cap 2000 leaves no room"

echo 'See /Users/bob/x.' > "$r/plugin/notes.txt"
run "a local path in an untracked plugin file" fail "local path"

# rehash SOURCE PAGE: rewrites PAGE's dos-source hash for SOURCE, as a maintainer does after refreshing the page.
rehash() {
  h=$(sed '/^last-verified: /d' "$r/$1" | shasum -a 256 | cut -c1-12)
  edit "$2" "s|content=\"$1@[0-9a-f]*\"|content=\"$1@$h\"|"
}

echo 'A new term.' >> "$r/docs/glossary.md"
run "a doc changed without its site page" fail "site: site/docs/glossary.html: docs/glossary.md changed since the page was written"

edit docs/glossary.md 's/^last-verified: .*/last-verified: 2030-01-01/'
run "a re-verified doc keeps its site page current" pass

rm "$r/site/skills/spec.html"
run "a skill without a site page" fail "site: site/skills/spec.html: missing"

edit site/docs/glossary.html 's|"../skills/index.html">Skills</a>|"../skills/nope.html">Skills</a>|'
run "a site link to a missing page" fail "site: site/docs/glossary.html: ../skills/nope.html does not resolve inside site/"

edit site/docs/glossary.html 's|"../docs/index.html">Docs</a>|"../docs/index.html#nope">Docs</a>|'
run "a site link to a missing id" fail "names no id in site/docs/index.html"

edit site/docs/glossary.html 's|"../docs/index.html">Docs</a>|"../../README.md">Docs</a>|'
run "a site link that leaves site/" fail "../../README.md does not resolve inside site/"

grep '<meta name="dos-source"' "$r/site/docs/pitfalls.html" > "$tmp/m"
edit site/docs/glossary.html "/<meta name=\"dos-source\"/r $tmp/m"
run "a page naming another page's source" fail "site: site/docs/glossary.html: names docs/pitfalls.md, which belongs to site/docs/pitfalls.html"

edit site/index.html 's|<h2>The skill library.</h2>|<h2>The 99 skills.</h2>|'
run "a wrong count on the site" fail "says 99 skills"

printf '\n## [0.0.1]\n\nShips 99 skills.\n' >> "$r/CHANGELOG.md"
cat >> "$r/docs/development.md" <<'EOF'

Only 3 cases of failure.

## Café naïve résumé

## Setup

## See [the guide](development.md) now

[a](#café-naïve-résumé) [b](#setup-1) [c](#see-the-guide-now)
EOF
rehash CHANGELOG.md site/docs/changelog.html
rehash docs/development.md site/docs/development.html
run "a count in a released CHANGELOG section, 'N cases of' prose, diacritic, repeated and linked headings pass" pass

jq '.plugins[0].version = "9.9.9"' "$r/.claude-plugin/marketplace.json" > "$tmp/x" && mv "$tmp/x" "$r/.claude-plugin/marketplace.json"
run "marketplace and plugin versions differ" fail 'Entry declares version "9.9.9"'

[ "$failed" -eq 0 ] && echo "check: all passed"
exit "$failed"
