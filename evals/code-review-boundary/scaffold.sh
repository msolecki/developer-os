#!/bin/sh
# The last commit changes an API handler's response shape and leaves its client on the old shape.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
cd "$d"
cat > src/orders-api.js <<'JS'
const orders = [{ id: 1, totalCents: 500 }];
// GET /orders
export function listOrders() {
  return orders;
}
JS
cat > src/orders-client.js <<'JS'
import { listOrders } from './orders-api.js';
// Renders one line per order.
export function orderLines() {
  const orders = listOrders();
  return orders.map((o) => `#${o.id}: ${o.totalCents}`);
}
JS
git add -A && git commit -q -m "feat: orders list"
cat > src/orders-api.js <<'JS'
const orders = [{ id: 1, totalCents: 500 }];
// GET /orders, wrapped for pagination metadata.
export function listOrders() {
  return { data: orders, nextCursor: null };
}
JS
git add -A && git commit -q -m "feat: paginate the orders response"
