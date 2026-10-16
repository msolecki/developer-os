---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:(?:[^"\\]|\\.)*?(?:\\n|[;&|({]))?\s*(?:(?:sudo|env\s+\S+|npx|pnpm\s+(?:dlx|exec)|bunx|then|do|else|xargs|time|exec|command|timeout\s+\S+)\s+|(?:ba)?sh\s+-c\s+\\?["'']?)*(?:/\S*/)?(?:sed\s+(?:-\w+\s+)*-i|perl\s+-\w*i|mv|cp|install|ln|truncate)\b(?:[^"\\|&;]|\\[^n])*(?:CLAUDE\.md|settings\.json)'
min: 0
max: 0
arm: both
---
