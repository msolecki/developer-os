#!/usr/bin/env bash
# The repository suite: manifests, frontmatter and Bases views parse, plugin references and links resolve,
# the plugin and marketplace validate, no secrets in tracked files.
set -euo pipefail
cd "$(dirname "$0")/.."

# Tracked plus untracked-not-ignored files, null-delimited, minus deleted-but-unstaged ones.
files() {
  git ls-files -z --cached --others --exclude-standard "$@" |
    while IFS= read -r -d '' f; do if [ -e "$f" ]; then printf '%s\0' "$f"; fi; done
}
fail() { echo "$1: $2: $3" >&2; exit 1; }

files '*.json' | while IFS= read -r -d '' f; do
  jq empty "$f" || fail json "$f" "invalid JSON"
done

# Frontmatter (plugin, templates, evals, docs) must parse. Skills, agents and output styles need name (matching the folder or file) and description;
# docs/*.md need status (current, draft or deprecated), owner and a last-verified date; other files only need parseable frontmatter.
# Skill descriptions are 80-1024 characters and together at most 12000: every description loads into every session.
# Every skill has a ## Stop point and a ## Never section, except the read-only ones: *-conventions,
# brain-search, code-review, plan-status and skill-usage (they never write files, send anything or change git state).
files 'plugin/*.md' 'templates/*.md' 'evals/*.md' 'docs/*.md' | ruby -e '
  require "date"; require "yaml"
  read_only = %w[brain-search code-review plan-status skill-usage]
  total = 0
  $stdin.read.split("\0").each do |f|
    bad = ->(why) { abort "frontmatter: #{f}: #{why}" }
    want = f[%r{\Aplugin/skills/([^/]+)/SKILL\.md\z}, 1] || f[%r{\Aplugin/(?:agents|output-styles)/([^/]+)\.md\z}, 1]
    doc = f.start_with?("docs/")
    lines = File.read(f).lines(chomp: true)
    if lines[0] != "---"
      want || doc ? bad.("line 1 is not ---") : next
    end
    close = (1...lines.size).find { |i| lines[i] == "---" } or bad.("no closing ---")
    begin
      y = YAML.safe_load(lines[1...close].join("\n"), permitted_classes: [Date], aliases: true)
    rescue Psych::Exception => e
      bad.("invalid YAML: #{e.message}")
    end
    if doc
      bad.("status must be current, draft or deprecated") unless y.is_a?(Hash) && %w[current draft deprecated].include?(y["status"])
      bad.("owner is empty") if y["owner"].to_s.strip.empty?
      bad.("last-verified is not a YYYY-MM-DD date") unless y["last-verified"].is_a?(Date)
    end
    next unless want
    bad.("not a mapping") unless y.is_a?(Hash)
    %w[name description].each { |k| bad.("#{k} is empty") if y[k].to_s.strip.empty? }
    bad.("name #{y["name"].inspect} does not match #{want.inspect}") unless y["name"] == want
    next unless f.start_with?("plugin/skills/")
    n = y["description"].to_s.size
    bad.("description is #{n} characters, allowed 80-1024") unless (80..1024).cover?(n)
    total += n
    next if read_only.include?(want) || want.end_with?("-conventions")
    body = lines[close..].join("\n")
    ["## Stop point", "## Never"].each { |h| bad.("skill has no #{h} section") unless body =~ /^#{h}$/ }
  end
  abort "skills: descriptions total #{total} characters, limit 12000" if total > 12000'

# Skills ship to other machines; a local path leaks the author's layout and breaks elsewhere.
if files 'plugin/skills' | xargs -0 grep -nE '/Users/|/home/|~/www|\.claude2' >&2; then
  fail skills plugin/skills "local path (/Users/, /home/, ~/www or .claude2) above"
fi

files '*.base' 'evals/*.yaml' | while IFS= read -r -d '' f; do
  ruby -e 'require "date"; require "yaml"; YAML.safe_load($stdin.read, permitted_classes: [Date], aliases: true)' < "$f" \
    || fail yaml "$f" "invalid YAML"
done

targets=$(grep -o '\${CLAUDE_PLUGIN_ROOT}/[^"\\[:space:]]*' plugin/hooks/hooks.json | sed 's|^\${CLAUDE_PLUGIN_ROOT}/||') || true
[ -n "$targets" ] || fail hooks plugin/hooks/hooks.json "no \${CLAUDE_PLUGIN_ROOT} target"
for p in $targets; do
  [ -e "plugin/$p" ] || fail hooks plugin/hooks/hooks.json "missing target plugin/$p"
done

# SessionStart hook output is capped at 10,000 characters.
size=$(wc -c < plugin/rules/core.md | tr -d " ")
[ "$size" -le 8192 ] || fail size plugin/rules/core.md "$size bytes, limit 8192"

files 'plugin/*.md' 'docs/*.md' README.md 'templates/*.md' | ruby -e '
  $stdin.read.split("\0").each do |f|
    File.read(f).scan(/developer-os:([A-Za-z0-9_-]+)/).flatten.uniq.each do |n|
      next if ["plugin/skills/#{n}/SKILL.md", "plugin/agents/#{n}.md", "plugin/output-styles/#{n}.md"].any? { |p| File.exist?(p) }
      abort "references: #{f}: developer-os:#{n} is no skill, agent or output style"
    end
  end'

# Relative Markdown links outside fenced code and inline code; skills are checked by plugin validate.
files '*.md' ':!plugin/skills' | ruby -e '
  $stdin.read.split("\0").each do |f|
    fence = false
    File.foreach(f) do |line|
      fence = !fence if line =~ /\A\s*(```|~~~)/
      next if fence
      line.gsub(/`[^`]*`/, "").scan(/\[[^\]]*\]\(([^)\s]+)[^)]*\)/).flatten.each do |t|
        next if t =~ /\A([a-z][a-z0-9+.-]*:|#)/i
        path = t.sub(/#.*/, "")
        dest = path.start_with?("/") ? path[1..] : File.join(File.dirname(f), path)
        abort "links: #{f}: #{t} does not resolve" unless File.exist?(dest)
      end
    end
  end'

for t in tests/*.test.sh; do
  [ -e "$t" ] || continue
  sh "$t" || fail tests "$t" "exited non-zero"
done

claude plugin validate .
claude plugin validate plugin

# Scan only what git tracks (or stages), not ignored local files.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
files | rsync -a --from0 --files-from=- . "$tmp"
gitleaks dir --no-banner --redact "$tmp"
