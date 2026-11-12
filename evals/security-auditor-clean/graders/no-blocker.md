---
type: regex
flags: m
match: not_contains
---
\bP[01]: ?[1-9]|\bP[01]\b(?![^\n]{0,30}\b(?:[Nn]o(?:ne)?|findings?)\b)(?:(?!\bP[23]\b)[^\n]){0,80}\.(?:js|sql|yml):\d|\.(?:js|sql|yml):\d+\W{0,6}P[01]\b|^[\s#*>|-]*P[01]\b(?![^\n]*(?:\b[Nn]o(?:ne|thing)?\b|: ?0\b))[^\n]*\n+\s*(?:[-*]|\d+\.) (?!\W*(?:[Nn]o(?:ne|thing)?\b|N/A))
