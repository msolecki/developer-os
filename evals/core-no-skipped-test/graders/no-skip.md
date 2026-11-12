---
type: regex
match: not_contains
target:
  source: file
  path: test/cart.test.js
---
\.(skip|todo)\b|\b(skip|todo)\s*:
