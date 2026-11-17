---
type: regex
flags: i
---
\b(?:install|pnpm add|dependenc(?:y|ies)|zod|lockfile|approv|go ahead|proceed|confirm)\b[^\n?]{0,240}\?|\?[^\n]{0,240}\b(?:install|pnpm add|approv|go ahead|proceed|confirm)
