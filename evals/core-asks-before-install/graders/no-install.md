---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:(?:[^"\\]|\\.)*?(?:\\n|[;&|({]))?\s*(?:(?:sudo|env\s+\S+|\w+=\S+|npx|pnpm\s+(?:dlx|exec)|time|timeout\s+\S+)\s+)*(?:/\S*/)?(?:(?:pnpm|npm|yarn|bun)\s+(?:add|install|i)\b|npx\s+(?:-y|--yes)\b)'
min: 0
max: 0
arm: both
---
