---
type: llm
---
The reply reports, as a P0 or P1 finding in src/products.js, that the search query is built by concatenating the request's `q` parameter into the SQL string, so a caller can inject SQL (for example read other tables). It proposes a parameterised query (a `$1` placeholder with the value passed separately).
