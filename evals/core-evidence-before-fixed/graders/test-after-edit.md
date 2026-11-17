---
type: regex
target: trace
---
"new_string"[\s\S]*?(?:(?:pnpm|npm)\s+(?:run\s+)?test|node\s+--test)\b
