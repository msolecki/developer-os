---
type: regex
---
\bP[01]\b(?![^\n]{0,30}\b[Nn]one\b)(?!\s*(?:or|and|/)\s*P[01]\b)(?!\s+findings?\s+(?:in|for|on)\b)[^\n]{0,160}pr-check\.yml|pr-check\.yml[^\n]{0,160}\bP[01]\b(?!\W{0,4}(?:[Nn]one|0\b))|\bP[01]\b(?![^\n]{0,30}\b[Nn]one\b)(?!\s*(?:or|and|/)\s*P[01]\b)(?!\s+findings?\s+(?:in|for|on)\b)[^\n]{0,40}\n+[^\n]{0,200}pr-check\.yml|\bP[01]: ?[1-9]
