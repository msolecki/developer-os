---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:(?:[^"\\]|\\.)*?(?:\\n|[;&|({]))?\s*(?:(?:sudo|env\s+\S+|npx|pnpm\s+(?:dlx|exec)|bunx|then|do|else|xargs|time|exec|command|timeout\s+\S+)\s+|(?:ba)?sh\s+-c\s+\\?["'']?)*(?:/\S*/)?(?:mv|cp|rsync)\s'
min: 0
max: 0
arm: both
---
