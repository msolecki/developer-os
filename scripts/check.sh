#!/usr/bin/env bash
# The repository suite: manifests, frontmatter and Bases views parse, plugin references and links resolve,
# the plugin and marketplace validate, no secrets in tracked files.
set -euo pipefail
cd "$(dirname "$0")/.."
# The ruby stages read UTF-8 files; under LC_ALL=C they would default to ASCII and die.
export RUBYOPT=-Eutf-8

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
# Skills also carry the portable Agent Skills fields license and compatibility, and a name matching ^[a-z0-9-]{1,64}$.
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
    # claude plugin eval ends frontmatter at the first line containing --- anywhere, not only a bare --- line.
    if f.start_with?("evals/") && (i = (1...close).find { |j| lines[j].include?("---") })
      bad.("line #{i + 1} inside the frontmatter contains ---")
    end
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
    bad.("name must match ^[a-z0-9-]{1,64}$") unless want.match?(/\A[a-z0-9-]{1,64}\z/)
    %w[license compatibility].each { |k| bad.("#{k} is empty") if y[k].to_s.strip.empty? }
    n = y["description"].to_s.size
    bad.("description is #{n} characters, allowed 80-1024") unless (80..1024).cover?(n)
    total += n
    next if read_only.include?(want) || want.end_with?("-conventions")
    body = lines[close..].join("\n")
    ["## Stop point", "## Never"].each { |h| bad.("skill has no #{h} section") unless body =~ /^#{h}$/ }
  end
  abort "skills: descriptions total #{total} characters, limit 12000" if total > 12000'

# The brain skills share one "Locate the vault" paragraph (the first after that heading); it must stay identical.
para() { awk '/^## 1\. Locate the vault$/ { f = 1; next } f && NF { p = 1; print; next } p { exit }' "$1"; }
for s in brain-capture brain-compile brain-garden brain-review; do
  if ! para plugin/skills/brain-search/SKILL.md | diff -u - <(para "plugin/skills/$s/SKILL.md") >&2; then
    fail vault "plugin/skills/$s/SKILL.md" "\"Locate the vault\" paragraph differs from brain-search's above"
  fi
done
[ -n "$(para plugin/skills/brain-search/SKILL.md)" ] || fail vault plugin/skills/brain-search/SKILL.md "no \"## 1. Locate the vault\" paragraph"

# The plugin ships to other machines; a local path leaks the author's layout and breaks elsewhere.
if git grep --untracked -nE '/Users/|/home/|~/www|\.claude2' -- plugin site >&2; then
  fail paths plugin "local path (/Users/, /home/, ~/www or .claude2) above"
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

# Every agent ends its report contract with the four final statuses that orchestrating skills read.
for f in plugin/agents/*.md; do
  grep -q '^## Final status$' "$f" || fail agents "$f" "no ## Final status section"
  for s in DONE REVIEW BLOCKED CONTINUING; do
    grep -q "^- \`$s\`" "$f" || fail agents "$f" "final status $s missing"
  done
done

# The public surface (skill, agent and output-style names, hook events and scripts) is listed in plugin/SURFACE.txt,
# so a rename or removal is a deliberate change recorded in the changelog.
surface() {
  for f in plugin/skills/*/SKILL.md; do f=${f#plugin/skills/}; echo "skill ${f%/SKILL.md}"; done
  for f in plugin/agents/*.md; do f=${f##*/}; echo "agent ${f%.md}"; done
  for f in plugin/output-styles/*.md; do f=${f##*/}; echo "output-style ${f%.md}"; done
  jq -r '.hooks | keys[] | "hook " + .' plugin/hooks/hooks.json
  for f in plugin/hooks/*.sh; do echo "hook-script ${f##*/}"; done
}
if ! surface | LC_ALL=C sort | diff -u plugin/SURFACE.txt - >&2; then
  fail surface plugin/SURFACE.txt "differs from the plugin above; update SURFACE.txt and CHANGELOG.md"
fi

# A name removed from SURFACE.txt in the uncommitted diff must not survive in what ships as a bare word
# (the prefixed form fails in References), so a rename cannot leave the rules or a skill pointing at a missing skill.
# In a pull request (GITHUB_BASE_REF) the diff starts at the merge base, so a committed rename is caught too.
base=HEAD
[ -z "${GITHUB_BASE_REF:-}" ] || base=$(git merge-base "origin/$GITHUB_BASE_REF" HEAD 2>/dev/null) ||
  { echo "warning: no merge base with origin/$GITHUB_BASE_REF; Stale names checks only the uncommitted diff" >&2; base=HEAD; }
git diff "$base" -- plugin/SURFACE.txt |
  sed -nE 's/^-(skill|agent|output-style) //p' | LC_ALL=C sort -u |
  { files 'plugin' README.md 'templates/*.md'; printf '\n'; cat; } | ruby -e '
  files, gone = $stdin.read.split("\n", 2)
  gone = gone.to_s.split - File.readlines("plugin/SURFACE.txt").map { |l| l.split[1] }
  exit if gone.empty?
  re = /(?<![\w:\/-])(#{gone.map { |n| Regexp.escape(n) }.join("|")})(?![\w-])/
  files.split("\0").each do |f|
    File.foreach(f).with_index(1) do |l, i|
      abort "stale names: #{f}:#{i}: #{$1} was removed from plugin/SURFACE.txt" if l.valid_encoding? && l =~ re
    end
  end'

# Counts written as digits in the README and docs ("28 skills", "13 eval cases") must match the disk;
# "3 cases of" and "2 hooks of" are prose, not counts.
skills=$(surface | grep -c '^skill '); agents=$(surface | grep -c '^agent ')
styles=$(surface | grep -c '^output-style '); hooks=$(jq '[.hooks[][].hooks[]] | length' plugin/hooks/hooks.json)
cases=$(find evals -mindepth 2 -maxdepth 2 -name case.yaml | wc -l | tr -d ' ')
files README.md 'docs/*.md' evals/README.md CHANGELOG.md CONTRIBUTING.md SECURITY.md 'site/*.html' | ruby -e '
  $stdin.read.split("\0").each do |f|
    File.foreach(f).with_index(1) do |l, i|
      break if f == "CHANGELOG.md" && l.start_with?("## [") && !l.start_with?("## [Unreleased]")
      break if f == "site/docs/changelog.html" && l =~ /<h2[^>]*>\[/ && l !~ /\[Unreleased\]/
      l.scan(/\b[0-9]+ (?:skills|agents|output styles|hooks|eval cases|cases)\b(?! of\b)/) { |m| puts "#{f}:#{i}:#{m}" }
    end
  end' |
  while IFS= read -r hit; do
    n=${hit##*:}; kind=${n#* }; n=${n%% *}
    case $kind in
      skills) want=$skills ;; agents) want=$agents ;; "output styles") want=$styles ;;
      hooks) want=$hooks ;; *cases) want=$cases ;;
    esac
    [ "$n" = "$want" ] || fail counts "${hit%:*}" "says $n $kind, the repository has $want"
  done

# SessionStart hook output is capped at 10,000 characters: the core rules plus the state card must fit.
size=$(wc -c < plugin/rules/core.md | tr -d " ")
[ "$size" -le 8192 ] || fail size plugin/rules/core.md "$size bytes, limit 8192"
cap=$(sed -n 's/^cap=//p' plugin/hooks/session-start.sh)
[ -n "$cap" ] && [ $((8192 + cap + 64)) -le 10000 ] || fail size plugin/hooks/session-start.sh "state card cap ${cap:-unset} leaves no room under 10000"

files 'plugin/*.md' 'plugin/*.sh' 'docs/*.md' README.md 'templates/*.md' 'evals/*' CHANGELOG.md CONTRIBUTING.md SECURITY.md | ruby -e '
  $stdin.read.split("\0").each do |f|
    File.read(f).scan(/developer-os:([A-Za-z0-9_-]+)/).flatten.uniq.each do |n|
      next if ["plugin/skills/#{n}/SKILL.md", "plugin/agents/#{n}.md", "plugin/output-styles/#{n}.md"].any? { |p| File.exist?(p) }
      abort "references: #{f}: developer-os:#{n} is no skill, agent or output style"
    end
  end'

# Relative Markdown links outside fenced code and inline code, each relative to its own file; a #fragment
# into a Markdown file must match a GitHub heading slug there (link text only, any script, -1/-2 for repeats).
files '*.md' | ruby -e '
  slugs = Hash.new do |h, f|
    fence = false; seen = Hash.new(0)
    h[f] = File.foreach(f).map do |l|
      fence = !fence if l =~ /\A\s*(```|~~~)/
      next if fence || l !~ /\A#+\s+(.*?)\s*\z/
      s = $1.gsub(/\[(.*?)\]\(.*?\)/, "\\1").downcase.gsub(/[^\p{L}\p{N}\p{M}_\s-]/u, "").tr(" ", "-")
      n = (seen[s] += 1) - 1
      n.zero? ? s : "#{s}-#{n}"
    end.compact
  end
  $stdin.read.split("\0").each do |f|
    fence = false
    File.foreach(f) do |line|
      fence = !fence if line =~ /\A\s*(```|~~~)/
      next if fence
      line.gsub(/`[^`]*`/, "").scan(/\[[^\]]*\]\(([^)\s]+)[^)]*\)/).flatten.each do |t|
        next if t =~ /\A[a-z][a-z0-9+.-]*:/i
        path, frag = t.split("#", 2)
        dest = path.empty? ? f : path.start_with?("/") ? path[1..] : File.join(File.dirname(f), path)
        abort "links: #{f}: #{t} does not resolve" unless File.exist?(dest)
        next unless frag && dest.end_with?(".md") && File.file?(dest)
        abort "links: #{f}: #{t} names no heading in #{dest}" unless slugs[dest].include?(frag)
      end
    end
  end'

# The site restates the docs: every doc, root document and skill has a page under site/ that names its
# source and that source's hash (sha256, first 12 hex digits, with any "last-verified:" line removed, so a
# re-verification alone changes nothing), and every relative href or src in site/ resolves, with a #fragment
# naming an id in the target page. A stale page fails here; the message names the page to refresh.
files 'site/*.html' 'site/*.js' | ruby -rdigest -e '
  sha = ->(f) { Digest::SHA256.hexdigest(File.read(f).gsub(/^last-verified: .*\n/, ""))[0, 12] }
  want = {}
  Dir.glob("docs/**/*.md").reject { |f| f.start_with?("docs/plans/") }.each { |f| want[f] = "site/#{f.sub(/\.md\z/, ".html")}" }
  %w[README CHANGELOG CONTRIBUTING SECURITY].each { |n| want["#{n}.md"] = "site/docs/#{n.downcase}.html" }
  Dir.glob("plugin/skills/*/SKILL.md").each { |f| want[f] = "site/skills/#{File.basename(File.dirname(f))}.html" }
  Dir.glob("plugin/agents/*.md").each { |f| want[f] = "site/agents.html" }
  Dir.glob("plugin/output-styles/*.md").each { |f| want[f] = "site/output-styles.html" }
  ids = Hash.new { |h, f| h[f] = File.read(f).scan(/\sid="([^"]+)"/).flatten }
  named = {}
  errs = []
  $stdin.read.split("\0").each do |p|
    s = File.read(p)
    if p.end_with?(".js")
      targets = s.scan(/\[\x27([^\x27]+\.html)\x27,/).flatten.map { |t| "../#{t}" }
      base = "site/assets"
    else
      s.scan(/<meta name="dos-source" content="([^"@]+)@([^"]*)">/) do |src, h|
        (errs << "site: #{p}: dos-source #{src} does not exist"; next) unless File.file?(src)
        (named[src] ||= []) << p
        (errs << "site: #{p}: #{src} changed since the page was written (page #{h}, source #{sha[src]}); update the page, then its dos-source hash"; next) unless h == sha[src]
      end
      targets = s.gsub(/<pre[\s>].*?<\/pre>/m, "").scan(/\s(?:href|src)="([^"]+)"/).flatten
      base = File.dirname(p)
    end
    targets.each do |t|
      next if t =~ /\A(?:[a-z][a-z0-9+.-]*:|\/\/)/i
      path, frag = t.split("#", 2)
      dest = path.empty? ? p : File.expand_path(path, base).delete_prefix("#{Dir.pwd}/")
      dest = File.join(dest, "index.html") if File.directory?(dest)
      # Exact case too: macOS resolves a wrong-case name that the Linux host serving the site does not.
      found = dest.start_with?("site/") && File.file?(dest) && Dir.children(File.dirname(dest)).include?(File.basename(dest))
      (errs << "site: #{p}: #{t} does not resolve inside site/"; next) unless found
      next unless frag && !frag.empty? && dest.end_with?(".html")
      (errs << "site: #{p}: #{t} names no id in #{dest}"; next) unless ids[dest].include?(frag)
    end
  end
  want.each do |src, p|
    pages = named[src] || []
    errs << "site: #{p}: missing, or has no dos-source meta for #{src}" unless pages.include?(p)
    (pages - [p]).each { |o| errs << "site: #{o}: names #{src}, which belongs to #{p}" }
  end
  abort errs.uniq.join("\n") unless errs.empty?'

# tests/check.test.sh runs the whole check about twenty times (about 40 s), so it runs only in CI or with CI=1.
for t in tests/*.test.sh; do
  [ -e "$t" ] || continue
  [ "$t" != tests/check.test.sh ] || [ -n "${CI:-}" ] || continue
  sh "$t" || fail tests "$t" "exited non-zero"
done

# --strict fails on unknown or misspelled manifest keys and on any warning: a missing version, or a marketplace
# entry whose version differs from plugin.json.
for d in . plugin; do
  out=$(claude plugin validate "$d" --strict 2>&1) || { echo "$out" >&2; fail validate "$d" "claude plugin validate --strict failed above"; }
done

# Scan only what git tracks (or stages), not ignored local files.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
files | rsync -a --from0 --files-from=- . "$tmp"
gitleaks dir --no-banner --redact "$tmp"
