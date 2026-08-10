/**
 * The Brain skeleton `init` installs, embedded rather than read from disk.
 *
 * The reviewable copy is `templates/brain/` at the repository root, and
 * `brain-template.test.ts` fails if the two ever differ. Embedding is what makes
 * a shipped binary self-contained: `templates/` sits outside `apps/cli`, so a
 * published package would not carry it, and a vault skeleton that silently
 * fails to install is worse than one that cannot.
 *
 * Regenerate with the script recorded in the commit that introduced this file;
 * never hand-edit one side alone.
 */
export interface BrainTemplateFile {
  /** Vault-relative, POSIX-separated. */
  readonly path: string;
  readonly content: string;
}

/** Every directory the files live in, parents first, vault-relative. */
export const BRAIN_TEMPLATE_DIRECTORIES: readonly string[] = [
  "content",
  "content/DEV",
  "content/INFRA",
  "content/PROJECTS",
  "content/QA",
  "content/TOOLS",
  "content/_graveyard",
  "content/_indexes",
  "content/_outputs",
  "content/_raw",
  "content/_raw/inbox",
  "content/_raw/processed",
  "content/_raw/quarantine",
  "content/templates",
];

export const BRAIN_TEMPLATE: readonly BrainTemplateFile[] = [
  {
    path: "content/DEV/example-knowledge-note.md",
    content: "---\nschemaVersion: 1\ntitle: Write the note you wanted to find\ntype: knowledge-note\ncreated: 2026-08-10\nupdated: 2026-08-10\ntags: [dev, writing]\naliases: [note writing]\nsummary: A note earns its place by answering a question you will ask again.\nstage: established\nauthor: human\nreviewed: 2026-08-10\noccurrences: 1\n---\n\nA knowledge note holds something you worked out once and do not want to work out\nagain. Give it a title you would search for, not a title that describes where it\ncame from.\n\nLinks between notes are how the graph gets built. This one points at\n[[TOOLS/example-reference-note]], and `developer-os brain lint` will tell you\nif a link stops resolving.\n\nDelete these four example notes whenever you like \u2014 nothing depends on them.\n",
  },
  {
    path: "content/INFRA/example-compiled-note.md",
    content: "---\nschemaVersion: 1\ntitle: Folders decide what gets indexed\ntype: compiled-note\ncreated: 2026-08-10\nupdated: 2026-08-10\ntags: [infra]\nsummary: Only configured topic folders are indexed; everything else is ignored on purpose.\nstage: established\nauthor: human\nreviewed: 2026-08-10\noccurrences: 1\n---\n\nA compiled note gathers what several other notes agree on. This one gathers the\nfolder rules, because they are the thing people most often trip over.\n\nIndexed: the topic folders named in your configuration \u2014 by default PROJECTS,\nTOOLS, DEV, INFRA and QA \u2014 at any depth.\n\nNever indexed, at any depth: `_raw/` and its children, `_outputs/`,\n`_graveyard/`, `_indexes/`, `templates/`, and anything beginning with a dot.\nQuarantined captures live in `_raw/`, so nothing there can reach a search result\nbefore a human has looked at it.\n\nA folder that is neither a topic folder nor one of those is reported by\n`brain lint` rather than silently indexed, so adding one is a decision you make\nrather than one that happens to you.\n",
  },
  {
    path: "content/PROJECTS/example-project-note.md",
    content: "---\nschemaVersion: 1\ntitle: A project note tracks a thing with an ending\ntype: project-note\ncreated: 2026-08-10\nupdated: 2026-08-10\ntags: [project]\nsummary: Projects finish; knowledge does not. Keep them apart.\nstage: emerging\nauthor: human\nreviewed: 2026-08-10\noccurrences: 1\n---\n\nUse a project note for work that will one day be done: a migration, a launch, a\npiece of research with a question at the end of it.\n\nWhen the project ends, the durable part usually wants to become a knowledge\nnote, and the project note itself can move to `_graveyard/` \u2014 which is never\nindexed, so retired work stops turning up in search without being deleted.\n",
  },
  {
    path: "content/QA/.gitkeep",
    content: "",
  },
  {
    path: "content/TOOLS/example-reference-note.md",
    content: "---\nschemaVersion: 1\ntitle: Developer OS brain commands\ntype: reference-note\ncreated: 2026-08-10\nupdated: 2026-08-10\ntags: [tools]\naliases: [brain commands]\nsummary: reindex builds the indexes, lint checks the vault, search reads the index.\nstage: established\nauthor: human\nreviewed: 2026-08-10\noccurrences: 1\n---\n\nA reference note is something you look up rather than reason about.\n\n- `developer-os brain reindex` rebuilds the four generated files under\n  `content/_indexes/`. It is the only command that writes to this vault.\n- `developer-os brain lint` reports what is wrong and exits non-zero on errors.\n- `developer-os brain search <query>` reads the index; it never rebuilds it, so\n  reindex first if results look stale.\n- `developer-os brain status` reports what the vault looks like and changes\n  nothing.\n",
  },
  {
    path: "content/_graveyard/.gitkeep",
    content: "",
  },
  {
    path: "content/_indexes/.gitkeep",
    content: "",
  },
  {
    path: "content/_outputs/.gitkeep",
    content: "",
  },
  {
    path: "content/_raw/inbox/.gitkeep",
    content: "",
  },
  {
    path: "content/_raw/processed/.gitkeep",
    content: "",
  },
  {
    path: "content/_raw/quarantine/.gitkeep",
    content: "",
  },
  {
    path: "content/templates/note.md",
    content: "---\nschemaVersion: 1\ntitle:\ntype:\ncreated:\nupdated:\ntags: []\naliases: []\nsummary:\nstage:\nauthor:\nreviewed: null\noccurrences: 0\n---\n\nWrite the note here. Everything above the fence is the frontmatter Developer OS\nreads; everything below it is yours.\n\n`type` is one of knowledge-note, compiled-note, project-note, reference-note.\n`stage` is one of emerging, established, deprecated. `author` is human or agent.\n`reviewed` is a YYYY-MM-DD date, or null when nobody has read it yet \u2014 an agent\nwrote it and no human has checked it.\n\nThis folder is never indexed, so this file is not a note and will not appear in\nany search result.\n",
  },
];
