#!/bin/sh
# Installs the developer-os skills and core rules for Codex. Run it by hand; the plugin never runs it.
#
# Usage: scripts/install-codex.sh [--dry-run] [--uninstall] [--project <dir>] [--vault <path>]
#
# - Rules: replaces only the block between the developer-os-core markers in ~/.codex/AGENTS.md
#   (or <dir>/AGENTS.md with --project) with plugin/rules/core.md and the Brain vault line. Text
#   outside the markers is kept; a changed file is backed up first; an unchanged file is not touched.
#   --project changes only which AGENTS.md is written; skills always go to the skills directory.
#   The Codex directory is ${CODEX_HOME:-~/.codex}. A changed project AGENTS.md leaves its backup in
#   the project; the installer prints its path.
# - Skills: writes a Codex copy of every skill to ${CODEX_SKILLS_DIR:-~/.agents/skills}/<name>:
#   frontmatter reduced to name and a short description (first sentence and the quoted trigger
#   phrases, or the "Use when" sentence if there are none), so all descriptions fit Codex's
#   8000-character skill list; Claude-only references rewritten. Each copy carries a
#   .developer-os-codex marker; a directory without it is never touched. A marked copy whose skill
#   is gone from the plugin is removed. --project --uninstall leaves the skills in place. A description must be one plain line.
# - Hooks, agents and output styles have no Codex equivalent and are not installed.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd -P)
plugin="$root/plugin"
skills_dir=${CODEX_SKILLS_DIR:-$HOME/.agents/skills}
agents_md="${CODEX_HOME:-$HOME/.codex}/AGENTS.md"
project=0
marker=.developer-os-codex
start='<!-- developer-os-core START -->'
end='<!-- developer-os-core END -->'
budget=8000
dry=0 uninstall=0 vault=

while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) dry=1 ;;
    --uninstall) uninstall=1 ;;
    --project) [ $# -ge 2 ] || { echo "--project needs a directory" >&2; exit 2; }; agents_md="$2/AGENTS.md"; project=1; shift ;;
    --vault) [ $# -ge 2 ] || { echo "--vault needs a path" >&2; exit 2; }; vault=$2; shift ;;
    -h | --help) sed -n '/^set -eu$/q;2,$p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$uninstall" -eq 0 ]; then
  # short() reads one plain line; a folded, quoted or continued description would be mangled.
  bad=$(awk 'FNR == 1 { fm = ($0 == "---"); d = 0; next }
    fm && $0 == "---" { fm = 0 }
    fm && d && /^[[:space:]]/ { print FILENAME; fm = 0 }
    fm { d = 0 }
    fm && /^description:/ { d = 1; if ($0 !~ /^description: [^>|"'"'"'[:space:]]/) { print FILENAME; fm = 0 } }' "$plugin"/skills/*/SKILL.md)
  if [ -n "$bad" ]; then
    echo "error: the Codex copy needs a one-line plain description in: $bad (use \`description: text\` on a single line, no \`>\`, \`|\`, quotes or continuation). Nothing was changed." >&2
    exit 1
  fi
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
say() { if [ "$dry" -eq 1 ]; then printf 'would %s\n' "$*"; else printf '%s\n' "$*"; fi; }

# --- AGENTS.md block ---------------------------------------------------------------------------

if [ -L "$agents_md" ]; then
  echo "error: $agents_md is a symlink; the installer writes only regular files. Nothing was changed." >&2
  exit 1
fi
if [ -f "$agents_md" ]; then
  ns=$(grep -cxF "$start" "$agents_md" || true)
  ne=$(grep -cxF "$end" "$agents_md" || true)
  ls_=$(grep -nxF "$start" "$agents_md" | head -n 1 | cut -d: -f1)
  le=$(grep -nxF "$end" "$agents_md" | head -n 1 | cut -d: -f1)
  if [ "$ns" -gt 1 ] || [ "$ne" -gt 1 ] || [ "$ns" -ne "$ne" ] || { [ "$ns" -eq 1 ] && [ "$ls_" -gt "$le" ]; }; then
    echo "error: $agents_md has unbalanced developer-os-core markers; fix them by hand. Nothing was changed." >&2
    exit 1
  fi
fi

# An explicit --vault always goes into the block. Otherwise the line comes from the block, then CLAUDE.md, unless AGENTS.md already has one outside the block.
outside=$( [ -f "$agents_md" ] && awk -v s="$start" -v e="$end" '$0==s{b=1} !b{print} $0==e{b=0}' "$agents_md" || true)
if [ -z "$vault" ] && ! printf '%s\n' "$outside" | grep -q '^Brain vault:'; then
  vault=$( [ -f "$agents_md" ] && awk -v s="$start" -v e="$end" '$0==s{b=1} b && sub(/^Brain vault:[[:space:]]*/, "") {print; exit} $0==e{b=0}' "$agents_md" || true)
  claude_vault=$(sed -n 's/^Brain vault:[[:space:]]*//p' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/CLAUDE.md" 2>/dev/null | head -n 1)
  [ -z "$vault" ] || [ -z "$claude_vault" ] || [ "$vault" = "$claude_vault" ] ||
    echo "warning: keeping Brain vault $vault; CLAUDE.md says $claude_vault (pass --vault to change it)" >&2
  [ -n "$vault" ] || vault=$claude_vault
fi

{
  if [ "$uninstall" -eq 0 ]; then
    echo "$start"
    cat "$plugin/rules/core.md"
    [ -n "$vault" ] && printf '\nBrain vault: %s\n' "$vault"
    echo "$end"
  fi
} > "$tmp/block"

if [ -f "$agents_md" ] && grep -qxF "$start" "$agents_md"; then
  # On uninstall, the blank line the install put before the block goes with it.
  awk -v s="$start" -v e="$end" -v f="$tmp/block" -v un="$uninstall" '
    held { if (!(un && $0 == s)) print ""; held = 0 }
    $0 == s { while ((getline l < f) > 0) print l; skip = 1; next }
    $0 == e { skip = 0; next }
    skip { next }
    $0 == "" { held = 1; next }
    { print }
    END { if (held) print "" }' "$agents_md" > "$tmp/agents"
elif [ "$uninstall" -eq 0 ]; then
  { if [ -s "$agents_md" ]; then cat "$agents_md"; echo; fi; cat "$tmp/block"; } > "$tmp/agents"
else
  cp "$agents_md" "$tmp/agents" 2>/dev/null || : > "$tmp/agents"
fi

if [ -f "$agents_md" ] && cmp -s "$tmp/agents" "$agents_md"; then
  echo "AGENTS.md: unchanged ($agents_md)"
elif [ "$uninstall" -eq 1 ] && [ ! -f "$agents_md" ]; then
  echo "AGENTS.md: nothing to remove"
else
  say "write $agents_md"
  if [ "$dry" -eq 0 ]; then
    mkdir -p "$(dirname "$agents_md")"
    if [ -f "$agents_md" ]; then
      bak="$agents_md.bak-$(date +%Y%m%d%H%M%S)"
      cp "$agents_md" "$bak"
      [ "$project" -eq 0 ] || echo "backup: $bak (inside the project; delete it or git-ignore it)"
    fi
    cat "$tmp/agents" > "$agents_md"
  fi
fi

# --- Skills ------------------------------------------------------------------------------------

ours() { [ -f "$1/$marker" ] || { [ -L "$1" ] && case $(readlink "$1") in "$plugin"/skills/*) true ;; *) false ;; esac; }; }

if [ "$uninstall" -eq 1 ] && [ "$project" -eq 1 ]; then
  echo "skills: kept; other projects use them (run --uninstall without --project to remove them)"
  exit 0
fi

installed=0 updated=0 unchanged=0 skipped=0 removed=0 total=0
for src in "$plugin"/skills/*/; do
  name=$(basename "$src")
  dest="$skills_dir/$name"
  if [ "$uninstall" -eq 1 ]; then
    if [ -e "$dest" ] || [ -L "$dest" ]; then
      if ours "$dest"; then say "remove $dest"; [ "$dry" -eq 1 ] || rm -rf "$dest"; removed=$((removed + 1)); fi
    fi
    continue
  fi

  # Codex copy: short description, Claude-only references rewritten.
  mkdir -p "$tmp/skill/$name"
  DEVOS_PLUGIN="$plugin" awk -v name="$name" '
    BEGIN { p = ENVIRON["DEVOS_PLUGIN"] }
    function short(d,   first, i, j, rest, q, out) {
      i = index(d, ". "); first = i ? substr(d, 1, i) : d
      # Trigger phrases follow "Use when/before/..."; a quoted span before it is a name, not a trigger.
      j = index(d, " Use "); rest = j ? substr(d, j) : d; q = ""
      while (match(rest, /"[^"]+"/)) { q = q (q == "" ? "" : ", ") substr(rest, RSTART, RLENGTH); rest = substr(rest, RSTART + RLENGTH) }
      i = index(d, "Use when ")
      out = q != "" ? first " Use for " q "." : i > length(first) ? first " " substr(d, i) : first
      gsub(/'"'"'/, "'"'"''"'"'", out)
      return "'"'"'" out "'"'"'"
    }
    NR == 1 && $0 == "---" { fm = 1; print; print "name: " name; next }
    fm && $0 == "---" {
      fm = 0; print; print ""
      print "> Codex copy of the developer-os skill, written by scripts/install-codex.sh. Where it dispatches a subagent or a developer-os agent, do that work yourself, step by step, or with a Codex subagent."
      next
    }
    fm { if (sub(/^description: /, "")) print "description: " short($0); next }
    # index/substr, not gsub: the clone path goes in verbatim, & and backslashes included.
    { while ((i = index($0, "${CLAUDE_PLUGIN_ROOT}")) > 0) $0 = substr($0, 1, i - 1) p substr($0, i + 21)
      gsub(/CLAUDE_PLUGIN_ROOT/, "plugin root"); gsub(/`developer-os:/, "`"); print }
  ' "$src/SKILL.md" > "$tmp/skill/$name/SKILL.md"
  printf 'developer-os Codex copy of %s\n' "$plugin/skills/$name" > "$tmp/skill/$name/$marker"
  d=$(sed -n "s/^description: '\(.*\)'$/\1/p" "$tmp/skill/$name/SKILL.md")
  total=$((total + $(printf '%s' "$d" | wc -c)))

  if [ -e "$dest" ] || [ -L "$dest" ]; then
    if ! ours "$dest"; then
      echo "skip $dest: exists and was not installed by this script" >&2
      skipped=$((skipped + 1)); continue
    fi
    if [ ! -L "$dest" ] && diff -r "$tmp/skill/$name" "$dest" >/dev/null 2>&1; then
      unchanged=$((unchanged + 1)); continue
    fi
    say "update $dest"; updated=$((updated + 1))
  else
    say "install $dest"; installed=$((installed + 1))
  fi
  if [ "$dry" -eq 0 ]; then
    mkdir -p "$skills_dir"
    rm -rf "$dest"
    cp -R "$tmp/skill/$name" "$dest"
  fi
done

# Copies of skills the plugin no longer has (renamed or removed).
for m in "$skills_dir"/*/"$marker"; do
  [ -f "$m" ] || continue
  dest=${m%/*}
  [ ! -L "$dest" ] || continue
  [ ! -d "$plugin/skills/${dest##*/}" ] || continue
  # Only a copy made from this checkout with no added files: a renamed copy, one with extra files, or
  # another checkout's copy stays. An edited SKILL.md is not detected and is removed with the copy.
  if [ "$(cat "$m")" != "developer-os Codex copy of $plugin/skills/${dest##*/}" ] ||
    [ -n "$(ls -A "$dest" | grep -vxF -e SKILL.md -e "$marker")" ]; then
    echo "warning: kept $dest: not an untouched copy from this checkout" >&2; continue
  fi
  say "remove $dest"; [ "$dry" -eq 1 ] || rm -rf "$dest"; removed=$((removed + 1))
done

if [ "$uninstall" -eq 1 ]; then
  echo "skills: removed $removed"
else
  echo "skills: installed $installed, updated $updated, unchanged $unchanged, skipped $skipped, removed $removed"
  echo "descriptions: $total bytes, Codex budget $budget characters"
  [ "$total" -le "$budget" ] || echo "warning: descriptions exceed the budget; raise skills.max_context_tokens in Codex" >&2
fi
