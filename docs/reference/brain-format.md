# Brain vault format

The shape of a note, a capture and the generated indexes. The schema is
`packages/brain/src/schema/note.ts` (`NOTE_KEY_RULES`, `RESERVED_KEYS`) and
`packages/brain/src/schema/capture.ts` (`CaptureEnvelopeV1`, `CAPTURE_STATUSES`); the folder layout
is in [Configuration](configuration.md#4-brain-vault). The engine's contract is
[brain.md](../architecture/brain.md).

## 1. Notes

A note is a Markdown file under a configured topic folder, with YAML frontmatter between `---`
fences. Everything below the frontmatter is free Markdown.

```markdown
---
schemaVersion: 1
title: Write the note you wanted to find
type: knowledge-note
created: 2026-08-10
updated: 2026-08-10
tags: [dev, writing]
aliases: [note writing]
summary: A note earns its place by answering a question you will ask again.
stage: established
author: human
reviewed: 2026-08-10
occurrences: 1
---

Body. Link other notes with [[TOOLS/example-reference-note]].
```

### 1.1 Frontmatter keys

| Key | Required | Rule |
|---|---|---|
| `schemaVersion` | yes | the literal number `1` |
| `title` | yes | a string with at least one visible character; the duplicate key, so keep it unique per folder |
| `type` | yes | `knowledge-note`, `compiled-note`, `project-note` or `reference-note` |
| `created` | yes | a real `YYYY-MM-DD` date |
| `updated` | no | a real `YYYY-MM-DD` date |
| `tags` | yes | an array of strings, may be empty |
| `aliases` | no | an array of strings |
| `summary` | yes | a string of at most 400 characters |
| `stage` | yes | `emerging`, `established` or `deprecated` |
| `author` | yes | `agent` or `human` |
| `reviewed` | yes | `null` when no human has reviewed it, otherwise a real `YYYY-MM-DD` date |
| `occurrences` | no | an integer of at least 1 |
| `sources` | no | an array of strings: vault paths or absolute URIs |

Other keys are reported as `unknown-key` by lint. Frontmatter may not use YAML tags (`!!binary`,
`!!set`, any `!tag`), and keys must be unique.

### 1.2 Note types

| Type | Use |
|---|---|
| `knowledge-note` | Something worked out once: a decision, a gotcha, a technique. |
| `compiled-note` | A synthesis of several notes on one topic (a hub). `brain-compile` produces these. |
| `project-note` | One project. The note whose title or alias equals the project directory's slug is injected at session start. |
| `reference-note` | A pointer to an external tool, service or document. |

### 1.3 Lifecycle fields

- `stage: emerging` is new or unconfirmed; `established` requires a `reviewed` date;
  `deprecated` requires an `updated` date.
- A note an agent wrote has `author: agent` and `reviewed: null` until a person reads it; lint warns
  about it under `provenance`.
- `occurrences` counts how often the knowledge was met; an `emerging` note with three or more
  occurrences that was never reviewed is reported under `staleness`.

### 1.4 Links

Wikilinks (`[[path]]`) resolve by vault-relative path or by a unique file name. A link that resolves
to nothing, points outside the vault or into an excluded folder is a lint error; an ambiguous one is a
warning.

## 2. Lint classes

`developer-os brain lint` reports:

| Class | Severity | Finds |
|---|---|---|
| `frontmatter` | error | a key that breaks §1.1 |
| `provenance` | warn / error | an agent note never reviewed; invalid `sources` |
| `links` | error / warn | an unresolved, external, excluded or ambiguous link |
| `duplicates` | error / warn | identical content, or a title shared within a folder |
| `staleness` | warn | `reviewed` older than `brain.staleness.reviewAfterDays` (default 180); a long-emerging, unreviewed note |
| `index-drift` | error | a generated index that is missing or differs from a fresh build — run `developer-os brain reindex` |
| `isolated` | info | a note with no link to or from it |
| `gap` | info | three or more notes share a tag and no `compiled-note` covers it |

The optional `brain-garden` job turns `gap` and `isolated` findings into proposals for review.

## 3. Generated indexes

`developer-os brain reindex` writes into `content/_indexes/`. They are derived and disposable; the
notes are the source of truth.

| File | Holds |
|---|---|
| `index.json` | One entry per canonical note: path, title, type, tags, aliases, summary, stage, review state. |
| `terms.json` | The term table used for body matches in search. |
| `graph.json` | The link graph. |
| `vault-map.md` | A short map of the vault, injected at session start. |
| `catalog.md` | A catalog of notes by folder, for agents and humans. |

A hand edit to a note makes the indexes stale until the next reindex; lint and `brain-pulse` report
it as `index-drift`.

## 4. Captures

A capture is one Markdown file in `content/_raw/quarantine/`. The frontmatter is the envelope; the
body is the redacted observation. It can be read and edited in Obsidian; `review --decision edit`
brings an edit back under the product's checks.

| Field | Meaning |
|---|---|
| `schemaVersion` | `1` |
| `captureId` | Stable identifier, also the deduplication cursor for `import`. |
| `sourceAgent`, `sourceAgentVersion` | The agent that captured it and the version detected at capture time. |
| `captureMethod` | How it was captured (for example the CLI, or an import source). |
| `sourceSessionId` | `null` unless the vendor exposes a stable session identity. |
| `projectSlug`, `workingDirectoryFingerprint` | The project and a fingerprint of the working directory, never the path itself. |
| `createdAt` | Timestamp. |
| `deduplicationHash` | Computed after redaction, so it cannot fingerprint a secret. |
| `status` | See §5. |
| `redaction` | One entry per finding: `class`, a non-reversible `fingerprint`, and `patternIndex` for a user pattern. Never the value. |
| `note` | For a note capture: the target `path` and its `beforeSha256` at capture time (`null` when the note did not exist). |

Redaction classes: `private-key`, `env-secret`, `bearer-token`, `provider-token`, `certificate`,
`credential-store`, `service-credential`, `high-entropy`, `user-pattern`.

## 5. Capture statuses

```text
quarantined ──accept──▶ accepted ──ingest──▶ staging ──▶ ingested
     │  ▲                  │                    │
     │  └──edit            └──reject──┐         └── (a validator refusal returns it to accepted)
     └──reject──────────────────────▶ rejected
```

| Status | Meaning |
|---|---|
| `quarantined` | Waiting for a human decision. Nothing reads it as knowledge. |
| `accepted` | Approved; the next `ingest` picks it up. |
| `rejected` | Declined. The file stays; deleting it is the user's choice. |
| `staging` | An ingest is in progress or died after writing; `brain-pulse` flags it for a person. |
| `ingested` | Its notes are in the vault. |
| `failed` | The capture file's own envelope cannot be read. A validator refusal never produces it: it leaves the capture `accepted` and retryable. |

The exact transitions and the reason a refusal never produces `failed`:
[knowledge-pipeline.md](../architecture/knowledge-pipeline.md) §6.

## 6. What writes canonical notes

Only three paths change a canonical note, and each is a product transaction:

1. **Ingest of a plain capture** — the model proposes, nine validators judge, the product creates.
2. **Ingest of a note capture** — applied verbatim, as a create or as a replace bound to the target's
   bytes at capture time, with no vendor call.
3. **`brain retire` and `brain refactor`** — deterministic moves, merges, splits and link rewrites.

A user may of course edit notes directly in Obsidian; the product treats the vault as theirs.
