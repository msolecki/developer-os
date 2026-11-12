---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:(?:[^"\\]|\\.)*?(?:\\n|[;&|({]))?\s*(?:(?:sudo|env\s+\S+|npx|pnpm\s+(?:dlx|exec)|bunx|then|do|else|xargs|time|exec|command|timeout\s+\S+)\s+|(?:ba)?sh\s+-c\s+\\?["'']?)*(?:/\S*/)?(?:(?:mkdir|touch|cp|mv|rm|truncate)\s|(?:sed\s+(?:-\w+\s+)*-i|perl\s+-\w*i)\b|git(?:\s+(?:-[Cc]\s+\S+|-c\s+\S+|--?[\w-]+(?:=\S+)?))*\s+(?:add|commit|push)\b)'
min: 0
max: 0
arm: both
---
