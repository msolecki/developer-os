# Brain fixtures

Every fixture under this directory is **wholly invented**. No note, title, tag, folder
name, person, client, **product, tool**, or repository here corresponds to anything real,
and no fixture describes the real behaviour of one. That clause is spelled out because it
is the one that was already broken once: a note about a real open-source CLI, accurately
describing its actual semantics, passed every other reading of this rule. No fixture is
ever generated from, compared against, diffed with, or refreshed from an actual vault —
including the founder's. `docs/migration/baseline-capabilities.json` froze the vault's
*capabilities* (Obsidian-compatible Markdown, a vault map, a catalog, a graph, index-first
retrieval), and that is the only thing these trees encode; the frontmatter schema they
carry is a design decision from
`docs/superpowers/specs/2026-07-21-developer-os-brain-engine-design.md` §4.2, not a shape
recovered from anywhere. When the product needs a shape a fixture does not yet cover,
**extend the fixture in place and say so in the commit** — do not open a real vault to
find out what it should look like.

`legacy-shape/` is the healthy vault: five canonical notes across five topic folders, one
resolving wikilink, and one file inside each excluded folder. The excluded files all carry
the sentence `EXCLUDED-FROM-EVERY-INDEX`, so a test can assert absence by content rather
than by path — a path assertion passes against an indexer that reads the file and merely
renames it.

One of those excluded files, `content/DEV/_raw/nested.md`, is deliberately **not** directly
under `content/`. Spec §5 excludes the private folder names at any depth, and an indexer
that applies the rule only to `content/`'s immediate children passes every other fixture in
this tree while quietly indexing quarantined captures. That file is the one that fails it.
