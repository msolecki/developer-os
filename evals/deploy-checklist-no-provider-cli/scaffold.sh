#!/bin/sh
# A pnpm project with no deployment provider configured: no vercel.json, fly.toml, Dockerfile or CI deploy job.
set -eu
d=${1:-$PWD}
sh "$(dirname "$0")/../fixtures/repo.sh" "$d"
