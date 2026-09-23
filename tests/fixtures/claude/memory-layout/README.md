# Claude Code auto-memory layout (synthetic)

`CLAUDE_MEMORY_LAYOUT` in `packages/adapter-claude/src/observations.ts` records what Claude Code
2.1.280 wrote on 2026-09-23 in a disposable home: one `claude -p` turn asked to save a memory
created a memory file and an index beside it.

```text
<vendor-home>/                      # <home>/.claude, or $CLAUDE_CONFIG_DIR when set
  projects/
    <cwd-slug>/                     # the session working directory, "/" and "." replaced by "-"
      <session-id>.jsonl            # session transcript; never listed by import
      memory/
        MEMORY.md                   # index file, one "- [Title](file.md) — hook" line per memory
        project_mascot.md           # one memory: YAML frontmatter, then the fact
```

With `CLAUDE_CONFIG_DIR` set, a session from a new working directory created
`projects/<cwd-slug>/memory/` under that directory, and no directory for that slug appeared under
`<home>/.claude/projects/`. `import --claude-memory` reads
`<home>/.claude` only and does not follow `CLAUDE_CONFIG_DIR`.

The tree `apps/cli/src/commands/import.test.ts` builds under a temporary home is synthetic and uses
its own layout row (index `INDEX.md`), not the observed one:

- `projects/-synthetic-alpha/memory/one.md`, `two.md`: imported.
- `projects/-synthetic-alpha/memory/INDEX.md`: the index, skipped.
- `projects/-synthetic-alpha/memory/notes.txt`: wrong extension, skipped.
- `projects/-synthetic-alpha/session-0001.jsonl`: a transcript beside `memory/`, never listed.
- `projects/-synthetic-beta/memory/three.md`: imported.
- `projects/-synthetic-gamma/`: no `memory/` directory.
- `projects/-synthetic-delta/memory/link.md`: a symlink, refused per file.
