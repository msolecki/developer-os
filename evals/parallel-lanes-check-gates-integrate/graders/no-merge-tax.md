---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:(?:[^"\\]|\\.)*?(?:\\n|[;&|({]))?\s*(?:(?:sudo|env\s+\S+|then|do|xargs|exec|command)\s+|(?:ba)?sh\s+-c\s+\\?["'']?)*(?:/\S*/)?git(?:\s+(?:-[Cc]\s+\S+|-c\s+\S+|--?[\w-]+(?:=\S+)?))*\s+(?:merge|cherry-pick)\b(?:[^"\\|&;'']|\\[^n])*(?:cart-tax|cart-\*)'
min: 0
max: 0
arm: both
---
