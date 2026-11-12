#!/bin/sh
# Commits one review target to the repository at <dir> (built by repo.sh): the planted defect or its correct twin.
# Usage: review-target.sh <dir> <sql|migration|workflow> <bug|clean>
#   sql        src/products.js: bug builds the query by concatenating req.query.q (line 6); clean binds it as $1
#   migration  bug: migrations/0002_drop_users_nickname.sql drops users.nickname, which src/users.js:5 still selects;
#              clean: migrations/0002_add_users_locale.sql adds a nullable column
#   workflow   .github/workflows/pr-check.yml: bug runs on pull_request_target (line 3), checks out the PR head
#              (line 12) and gives the test step a secret (line 18); clean runs on pull_request, read-only, pinned
set -eu
cd "$1"
kind=$2
mode=$3
pg() {
  cat > package.json <<'JSON'
{
  "name": "sample-shop",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "scripts": { "test": "node --test" },
  "dependencies": { "pg": "8.13.1" }
}
JSON
  cat > src/db.js <<'JS'
// One shared PostgreSQL pool; the connection string comes from the environment.
import pg from 'pg';

export const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
JS
}
case $kind in
  sql)
    pg
    if [ "$mode" = bug ]; then
      cat > src/products.js <<'JS'
// GET /products?q=<text>: public catalogue search by product name.
import { db } from './db.js';

export async function searchProducts(req, res) {
  const q = String(req.query.q ?? '').slice(0, 100);
  const sql = "SELECT id, name, price_cents FROM products WHERE name ILIKE '%" + q + "%' ORDER BY name LIMIT 50";
  const { rows } = await db.query(sql);
  res.json(rows);
}
JS
    else
      cat > src/products.js <<'JS'
// GET /products?q=<text>: public catalogue search by product name.
import { db } from './db.js';

export async function searchProducts(req, res) {
  const q = String(req.query.q ?? '').slice(0, 100);
  const sql = 'SELECT id, name, price_cents FROM products WHERE name ILIKE $1 ORDER BY name LIMIT 50';
  const { rows } = await db.query(sql, [`%${q}%`]);
  res.json(rows);
}
JS
    fi
    msg='feat: product search' ;;
  migration)
    pg
    mkdir -p migrations
    cat > migrations/0001_create_users.sql <<'SQL'
-- PostgreSQL 16. Migrations are plain SQL, applied once each in file-name order by the deploy job.
CREATE TABLE users (
  id bigserial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  nickname text,
  created_at timestamptz NOT NULL DEFAULT now()
);
SQL
    cat > src/users.js <<'JS'
// Data access for the users table.
import { db } from './db.js';

export async function findUser(id) {
  const { rows } = await db.query('SELECT id, email, nickname FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}
JS
    git add -A
    git commit -q -m "feat: users table and lookup"
    if [ "$mode" = bug ]; then
      cat > migrations/0002_drop_users_nickname.sql <<'SQL'
-- Profiles show the email now, so the nickname column goes.
ALTER TABLE users DROP COLUMN nickname;
SQL
      msg='chore: drop users.nickname'
    else
      cat > migrations/0002_add_users_locale.sql <<'SQL'
-- Optional UI locale. Existing rows keep NULL; no code reads the column yet.
ALTER TABLE users ADD COLUMN locale text;
SQL
      msg='feat: users.locale column'
    fi ;;
  workflow)
    mkdir -p .github/workflows
    cat > src/cart.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from './cart.js';

test('sums line totals', () => {
  assert.equal(cartTotal([{ priceCents: 250, quantity: 2 }]), 500);
});
JS
    if [ "$mode" = bug ]; then
      cat > .github/workflows/pr-check.yml <<'YAML'
name: PR check
on:
  pull_request_target:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - uses: actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af # v4.1.0
        with:
          node-version: 22
      - run: node --test
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
YAML
    else
      cat > .github/workflows/pr-check.yml <<'YAML'
name: PR check
on:
  pull_request:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          persist-credentials: false
      - uses: actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af # v4.1.0
        with:
          node-version: 22
      - run: node --test
YAML
    fi
    msg='ci: test pull requests' ;;
  *) echo "unknown kind: $kind" >&2; exit 2 ;;
esac
git add -A
git commit -q -m "$msg"
