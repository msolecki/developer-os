---
type: regex
flags: m
target:
  source: file
  path: TODO.md
---
^- \[ \] [A-Z][A-Z0-9]*-\d+ · P[0-3] · [^\n]*\n(?:  [^\n]*\n)*?  - Check: 
