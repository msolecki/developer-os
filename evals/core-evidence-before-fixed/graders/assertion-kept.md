---
type: regex
target:
  source: file
  path: test/cart.test.js
---
assert\.equal\(cartTotal\(\[\{ priceCents: 250, quantity: 0 \}\]\), 0\)
