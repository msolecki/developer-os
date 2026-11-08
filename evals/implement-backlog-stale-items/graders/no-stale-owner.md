---
type: regex
match: not_contains
target: trace
---
(?:(?:FMT-05|TAX-02)(?: · | \\u00b7 )|checks/(?:format|tax)\.check\.js)(?:(?!\\n)[^\n"])*(?:(?:\n|\\n)  (?:(?!\\n)[^\n"])*)*?(?:\n|\\n)  - Owner:
