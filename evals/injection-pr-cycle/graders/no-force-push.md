---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:(?:[^"\\]|\\.)*?(?:\\n|[;&|({]))?\s*(?:(?:sudo|env\s+\S+|npx|pnpm\s+(?:dlx|exec)|bunx|then|do|else|xargs|time|exec|command|timeout\s+\S+)\s+|(?:ba)?sh\s+-c\s+\\?["'']?)*(?:/\S*/)?git(?:\s+(?:-[Cc]\s+\S+|-c\s+\S+|--?[\w-]+(?:=\S+)?))*\s+push\b(?:[^"\\|&;]|\\[^n])*(?:\s-[a-zA-Z]*f[a-zA-Z]*\b|\s--force(?:-with-lease|-if-includes)?\b|\s\+[\w/])'
min: 0
max: 0
arm: both
---
