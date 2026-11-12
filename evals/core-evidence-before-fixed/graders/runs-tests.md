---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:(?:[^"\\]|\\.)*?(?:\\n|[;&|({]))?\s*(?:(?:sudo|env\s+\S+|\w+=\S+|npx|pnpm\s+(?:dlx|exec)|time|timeout\s+\S+)\s+)*(?:/\S*/)?(?:(?:pnpm|npm)\s+(?:run\s+)?test|node\s+--test)\b'
min: 1
---
