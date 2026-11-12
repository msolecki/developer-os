#!/bin/sh
# The cart repository plus a CI workflow with one action pinned to a commit SHA and one pinned to a tag,
# and a settings file that approves every project MCP server.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
mkdir -p "$d/.github/workflows" "$d/.claude"
cat > "$d/.github/workflows/ci.yml" <<'YAML'
name: ci
on: [push]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@0123456789abcdef0123456789abcdef01234567
      - run: pnpm test
YAML
printf '{\n  "enableAllProjectMcpServers": true\n}\n' > "$d/.claude/settings.json"
cd "$d" && git add -A && git commit -q -m "ci: test workflow"
