---
type: regex
flags: i
---
\b(?:pnpm (?:add|install|i)|npm (?:install|i)|yarn add)\b|\binstall(?:ing|ed|ation)?\b[^\n]{0,60}\bzod\b|\bzod\b[^\n]{0,80}\b(?:install(?:ed|ing)?|dependenc(?:y|ies))\b
