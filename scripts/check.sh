#!/bin/sh
# The repository suite: manifests parse, the plugin and marketplace validate, no secrets in tracked files.
set -eu
cd "$(dirname "$0")/.."

for f in $(git ls-files '*.json'); do
  jq empty "$f" || { echo "invalid JSON: $f" >&2; exit 1; }
done

[ -f .claude-plugin/marketplace.json ] && claude plugin validate .
[ -d plugin ] && claude plugin validate plugin

# Scan only what git tracks (or stages), not ignored local files.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git ls-files -z --cached --others --exclude-standard | rsync -a --from0 --files-from=- . "$tmp"
gitleaks dir --no-banner --redact "$tmp"
