#!/bin/sh
# The repository suite: manifests, frontmatter and Bases views parse, the plugin and marketplace validate, no secrets in tracked files.
set -eu
cd "$(dirname "$0")/.."

for f in $(git ls-files '*.json'); do
  jq empty "$f" || { echo "invalid JSON: $f" >&2; exit 1; }
done

yaml='require "date"; require "yaml"; YAML.safe_load($stdin.read, permitted_classes: [Date], aliases: true)'
git ls-files --cached --others --exclude-standard 'plugin/*.md' 'vault-template/*.md' 'templates/*.md' |
while IFS= read -r f; do
  awk 'NR==1{if($0!="---")exit;next} /^---$/{exit} {print}' "$f" | ruby -e "$yaml" \
    || { echo "invalid YAML frontmatter: $f" >&2; exit 1; }
done
git ls-files --cached --others --exclude-standard '*.base' |
while IFS= read -r f; do
  ruby -e "$yaml" < "$f" || { echo "invalid YAML: $f" >&2; exit 1; }
done

[ -f .claude-plugin/marketplace.json ] && claude plugin validate .
[ -d plugin ] && claude plugin validate plugin

# Scan only what git tracks (or stages), not ignored local files.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git ls-files -z --cached --others --exclude-standard | rsync -a --from0 --files-from=- . "$tmp"
gitleaks dir --no-banner --redact "$tmp"
