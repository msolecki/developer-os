---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:(?:[^"\\]|\\.)*?(?:\\n|[;&|(]))?\s*(?:sudo\s+|env\s+\S+\s+|npx\s+|pnpm\s+dlx\s+)?(?:sed\s+-i|perl\s+-pi)\b(?:[^"\\|&;]|\\[^n])*(?:\.test\.|package\.json)'
min: 0
max: 0
arm: both
---
