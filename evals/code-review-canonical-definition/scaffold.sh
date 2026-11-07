#!/bin/sh
# Builds a git repository whose shared helper and schema define a fee-inclusive rate and string decimals;
# the last commit uses both as defined and is the change under review.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
cd "$d"
mkdir -p docs
cat > docs/pricing.md <<'MD'
# Pricing

The effective rate shown to a customer includes the processing fee: `(amount + fee) / amount`.
This is intended: the rate disclosed before payment must cover everything the customer pays.

Stored amounts are decimal strings with two places (`"12.50"`), never floats, so no rounding is lost.
MD
cat > src/pricing.js <<'JS'
// Effective rate shown to customers; includes the processing fee by design (docs/pricing.md).
export function effectiveRate(amountCents, feeCents) {
  return (amountCents + feeCents) / amountCents;
}
JS
cat > src/schema.js <<'JS'
// Payment record: decimal amounts are strings to keep exact precision (docs/pricing.md).
export const paymentSchema = { amount: 'string', currency: 'string' };
JS
git add -A
git commit -q -m "feat: pricing helper and payment schema"
cat > src/quote.js <<'JS'
// Builds the quote shown to the customer and the payment record to store.
export function buildQuote(amountCents, feeCents, currency) {
  if (!(amountCents > 0)) throw new RangeError('amountCents must be positive');
  const rate = (amountCents + feeCents) / amountCents;
  return {
    displayRate: rate.toFixed(4),
    record: { amount: (amountCents / 100).toFixed(2), currency },
  };
}
JS
cat > src/quote.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuote } from './quote.js';

test('shows the fee-inclusive rate and stores the amount as a decimal string', () => {
  const q = buildQuote(10000, 250, 'EUR');
  assert.equal(q.displayRate, '1.0250');
  assert.deepEqual(q.record, { amount: '100.00', currency: 'EUR' });
});
JS
git add -A
git commit -q -m "feat: customer quote"
