# Brain Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@developer-os/brain` so `developer-os` can initialize, validate, index, and search an Obsidian-compatible vault with no agent adapter present.

**Architecture:** A new workspace package with six directories behind one facade (`BrainService`). It depends on `@developer-os/core` and `@developer-os/security` and on nothing else in the repository. Every function receives its clock, filesystem, and directory reader as arguments, because the determinism gate is only testable if the directory reader can be replaced with a hostile one. The CLI gains a `brain` command group; `brain reindex` is the only mutation and runs through Foundation's existing `TransactionExecutor`.

**Tech Stack:** TypeScript 5.9.3 strict, Node ≥24.16.0, pnpm 11.3.0, vitest 4.1.8, zod 4.4.3, project references (`tsc -b`).

**Spec:** `docs/superpowers/specs/2026-07-21-developer-os-brain-engine-design.md`. Read its §15 first — it amends four documents approved before it existed. Section references below (§4, §6.3, and so on) point into that spec.

## Global Constraints

- **The repository is self-contained.** No task opens the founder's legacy runtime; `SESSION.md` names the exact paths and `npm run lint` fails on any reference to them outside the allowlist, over tracked *and* untracked files — this plan included. A missing legacy fact is a gap in `docs/migration/baseline-capabilities.json` and is fixed there.
- **Fixtures are synthetic.** No founder name, client name, repository name, or copied third-party text in any fixture or template.
- **Never `git add -A`.** Stage the exact paths listed in each task's commit step.
- **Never commit without `npm run lint && npm test`.** Each task's final step runs `npm run check`.
- **Reviewer ≠ author.** Every task gets a fresh-context review before its commit is considered closed.
- **Every filesystem mutation goes through `TransactionExecutor`.** `packages/brain` performs no direct write to a user's vault; it returns bytes and the CLI stages them.
- **One dependency is approved and no other is.** `yaml@2.8.1`, settled by the founder on 2026-08-04 and installed by Task 2. Any *further* dependency needs the founder's approval before `pnpm add` runs. The version family is itself a contract, not a convenience — spec §4.4.
- **Exact values, copied verbatim from the spec:** `summary` maximum 400 characters; default `topicFolders` `["PROJECTS", "TOOLS", "DEV", "INFRA", "QA"]`; default `contentRoot` `"content"`; default `indexesDir` `"_indexes"`; default `retrieval.maxCandidates` `10`; default `staleness.reviewAfterDays` `180`; scoring weights title 4, alias 3, tag 3, summary 2, body 1; the `emerging`/`established`/`deprecated` stage enum; the `knowledge-note`/`compiled-note`/`project-note`/`reference-note` type enum.

## File Structure

| Path | Responsibility |
|---|---|
| `packages/brain/src/schema/config.ts` | brain config defaults and resolution |
| `packages/brain/src/schema/note.ts` | `NoteFrontmatterV1`, parse, render, reserved vocabulary |
| `packages/brain/src/schema/capture.ts` | `CaptureEnvelopeV1` type only |
| `packages/brain/src/discovery/` | folder policy, deny-by-default enumeration |
| `packages/brain/src/indexes/build.ts` | `index.json` and `graph.json` construction |
| `packages/brain/src/indexes/serialize.ts` | canonical ordering and JSON serialization |
| `packages/brain/src/indexes/render.ts` | `vault-map.md` and `catalog.md` |
| `packages/brain/src/lint/` | six lint classes, canonical-form drift |
| `packages/brain/src/retrieval/` | funnel and integer scorer |
| `packages/brain/src/migrations/` | `BrainMigration`, empty registry, adoption report |
| `packages/brain/src/service.ts` | `BrainService` facade — the only module the CLI imports |
| `apps/cli/src/commands/brain.ts` | the `brain` command group |
| `templates/brain/` | synthetic vault skeleton |
| `tests/fixtures/brain/legacy-shape/` | committed synthetic vault |

### Shared test helpers

Five helpers are used by more than one task. Each is created by the task that first needs it and imported unchanged afterwards — do not write a second copy.

| Helper | Created in | Signature |
|---|---|---|
| `fixtureRequest(now: string): IndexBuildRequest` | Task 4, `packages/brain/src/indexes/testing.ts` | builds a request over `tests/fixtures/brain/legacy-shape/` with `node:fs/promises`, a `DirectoryReader` wrapping `readdir(path, { withFileTypes: true })`, `assertReadable` a no-op, and `now: () => now` |
| `reversedFixtureRequest(now: string): IndexBuildRequest` | Task 4, same file | identical, except the reader reverses every result array |
| `writtenArtifacts(build: IndexBuildResult): Record<string, string>` | Task 6, `packages/brain/src/lint/testing.ts` | serializes and renders a build into the four vault-relative artifact paths, exactly as `BrainService.reindex` will |
| `lintRequestFor(files: Record<string, string>, now: string): LintRequest` | Task 6, same file | a `LintRequest` reading artifacts from that in-memory map instead of disk |
| `indexFixture(): IndexDocumentV1` | Task 7, `packages/brain/src/retrieval/testing.ts` | `(await buildIndex(fixtureRequest(FROZEN))).index`, memoized |

**One placement decision differs from spec §2.** `BrainConfigV1`'s *type and zod schema* live in `packages/core/src/config/types.ts`, not in `packages/brain/src/schema/`. `DeveloperOsConfigV1` must reference the type, and `core` importing from `brain` while `brain` imports from `core` is a cycle. `packages/core` owns configuration per `docs/architecture/foundation.md` §1; `packages/brain` owns the defaults and resolution and re-exports the type. Recorded here rather than silently done.

---

### Tasks 1 and 2 — closed, and removed from this plan

**Task 1 — package scaffold and the optional `[brain]` config section.** Shipped 2026-08-07,
commit `4cd7224`.

**Task 2 — note schema: strict parse, reserved vocabulary, byte-identical rewrite.** Shipped
2026-08-08, commit `9f82901`, as 51 test cases after two review rounds.

Their steps and draft code blocks are gone rather than kept as ticked boxes: this plan holds
only unfinished work, and 826 lines of pre-review draft that the shipped code had already
superseded were the single largest source of stale instruction in it. Recover them from
`git show 9f82901:docs/superpowers/plans/2026-07-21-developer-os-brain-engine.md` if the
reasoning is ever needed.

**Nothing durable was lost, because none of it lived only there.** Where each thing lives now:

| What | Where it is now |
|---|---|
| the four `brainSchema` guards review added — the `__proto__`/`constructor`/`prototype` alias-key rejection, the 3650-day staleness ceiling, and the two alias refinements | `packages/core/src/config/loader.ts`, each with its reasoning at the code |
| why `BrainConfigV1` lives in `core` and not here | the placement note above, `BACKLOG.md` §3 fact 3, spec §2 and §3 |
| why `serializeConfig` emits the section on presence rather than on difference | spec §3, marked as shipped |
| the parser contract — YAML 1.2 core schema, alias bound, duplicate-key error, and the tests that pin them | spec §4.4 and the header comment in `packages/brain/src/schema/note.ts` |
| why `parseAllDocuments` and a silenced `logLevel`, and why the header slice makes the round trip hold by construction | comments at those exact lines in `note.ts` |
| `yaml` is quadratic in mapping size, so Task 3 must bound the bytes handed to `parseNote` | Task 3's Interfaces block below, and `BACKLOG.md` §3 fact 1 |
| the unterminated-frontmatter heuristic and the `YAMLParseError` line/column carry | Task 6's step list below, where they are to be built |

Two obligations these tasks created and did not close are open items, not history:
**NEW-1** (`packages/brain` is outside the network-capability scan) and **NEW-2** (`uniqueKeys`
is an unpinned library default), both in `BACKLOG.md` §1, both hooked from Task 10 Step 6.

---

### Task 3: Discovery — deny-by-default enumeration and the committed fixture

**Status: SHIPPED 2026-08-08, commit `4b59220`.** Three deviations from the draft below, all
recorded in that commit message: the `TOOLS/` fixture note is `rowlease.md` rather than a real
product; `DiscoveryResult` carries a third field `symlinkedFolders`; and `compareRawBytes` is
exported because `compareCanonical` folds to NFC and so cannot break its own ties — Task 4
re-sorts by `path` and meets the same pair. The draft code blocks below are superseded by the
shipped module and are kept only until Task 10 compresses this section.

**Files:**
- Create: `packages/brain/src/discovery/index.ts`, `packages/brain/src/discovery/discover.ts`, `packages/brain/src/discovery/discover.test.ts`
- Create: `tests/fixtures/brain/legacy-shape/` (see Step 6)
- Modify: `packages/brain/src/index.ts`

**Interfaces:**
- Consumes: `BrainConfigV1` (Task 1); `containsPath` from `@developer-os/core`.
- **Carried from Task 2's review:** `yaml` parsing is quadratic in mapping size — measured at 14 ms for 1,000 frontmatter keys, 1.2 s for 16,000, and no completion inside two minutes for a 700 KB block, while the fence regex over the same input stays under 3 ms. Discovery walks arbitrary user files, so bound the bytes handed to `parseNote` and report an oversized frontmatter as a finding rather than hanging the CLI.
- Produces: `DirectoryEntry`, `DirectoryReader`, `DiscoveredNote`, `DiscoveryResult`, `PRIVATE_FOLDERS`, `discoverNotes(request: DiscoveryRequest): Promise<DiscoveryResult>`, `DiscoveryRequest`.

- [x] **Step 1: Write the failing tests**

`packages/brain/src/discovery/discover.test.ts`. Use an in-memory reader so the hostile-order case in Task 4 can reuse it:

```typescript
import { describe, expect, it } from "vitest";

import { DEFAULT_BRAIN_CONFIG } from "../schema/config.js";
import { discoverNotes } from "./discover.js";
import type { DirectoryEntry, DirectoryReader } from "./discover.js";

function readerFor(tree: Record<string, readonly string[]>, reverse = false): DirectoryReader {
  return {
    async readDir(path: string): Promise<readonly DirectoryEntry[]> {
      const names = tree[path] ?? [];
      const entries = names.map((name) => ({
        name: name.endsWith("/") ? name.slice(0, -1) : name,
        isDirectory: name.endsWith("/"),
        isFile: !name.endsWith("/"),
        isSymbolicLink: false,
      }));
      return reverse ? [...entries].reverse() : entries;
    },
  };
}

const VAULT = "/vault";
const TREE: Record<string, readonly string[]> = {
  "/vault": ["content/", ".obsidian/"],
  "/vault/content": ["DEV/", "PROJECTS/", "_raw/", "_indexes/", "templates/", "Scratch/"],
  "/vault/content/DEV": ["caching.md", "notes.txt"],
  "/vault/content/PROJECTS": ["alpha.md"],
  "/vault/content/_raw": ["secret.md"],
  "/vault/content/_indexes": ["index.json"],
  "/vault/content/templates": ["note.md"],
  "/vault/content/Scratch": ["draft.md"],
  "/vault/.obsidian": ["app.json"],
};

const request = {
  vaultRoot: VAULT,
  config: DEFAULT_BRAIN_CONFIG,
  assertReadable: async (): Promise<void> => {},
};

describe("discoverNotes", () => {
  it("returns only Markdown under configured topic folders", async () => {
    const result = await discoverNotes({ ...request, reader: readerFor(TREE) });
    expect(result.notes.map((note) => note.vaultPath)).toEqual([
      "content/DEV/caching.md",
      "content/PROJECTS/alpha.md",
    ]);
  });

  it("never scans a private folder or an Obsidian internal", async () => {
    const result = await discoverNotes({ ...request, reader: readerFor(TREE) });
    const paths = result.notes.map((note) => note.vaultPath).join(" ");
    expect(paths).not.toContain("_raw");
    expect(paths).not.toContain("_indexes");
    expect(paths).not.toContain("templates");
    expect(paths).not.toContain(".obsidian");
  });

  it("reports an unconfigured folder instead of indexing it", async () => {
    const result = await discoverNotes({ ...request, reader: readerFor(TREE) });
    expect(result.unclassifiedFolders).toEqual(["content/Scratch"]);
  });

  it("produces identical output under a reversed directory reader", async () => {
    const forward = await discoverNotes({ ...request, reader: readerFor(TREE) });
    const reverse = await discoverNotes({ ...request, reader: readerFor(TREE, true) });
    expect(reverse).toEqual(forward);
  });

  it("resolves a topic alias without renaming anything", async () => {
    const tree = {
      "/vault": ["content/"],
      "/vault/content": ["PROJEKTY/"],
      "/vault/content/PROJEKTY": ["alpha.md"],
    };
    const result = await discoverNotes({
      ...request,
      config: { ...DEFAULT_BRAIN_CONFIG, topicAliases: { PROJEKTY: "PROJECTS" } },
      reader: readerFor(tree),
    });
    expect(result.notes).toEqual([
      {
        vaultPath: "content/PROJEKTY/alpha.md",
        absolutePath: "/vault/content/PROJEKTY/alpha.md",
        topicFolder: "PROJECTS",
      },
    ]);
    expect(result.unclassifiedFolders).toEqual([]);
  });

  it("normalizes a decomposed filename to NFC", async () => {
    const decomposed = "zaźółć.md";
    const result = await discoverNotes({
      ...request,
      reader: readerFor({
        "/vault": ["content/"],
        "/vault/content": ["DEV/"],
        "/vault/content/DEV": [decomposed],
      }),
    });
    expect(result.notes[0]?.vaultPath).toBe(`content/DEV/${decomposed.normalize("NFC")}`);
    expect(result.notes[0]?.vaultPath.normalize("NFC")).toBe(result.notes[0]?.vaultPath);
  });
});
```

- [x] **Step 2: Run and confirm they fail**

Run: `npx vitest run packages/brain/src/discovery`
Expected: FAIL, "Cannot find module './discover.js'".

- [x] **Step 3: Implement**

`packages/brain/src/discovery/discover.ts`:

```typescript
import { join } from "node:path";

import { containsPath } from "@developer-os/core";
import type { BrainConfigV1 } from "@developer-os/core";
import { canonicalizePlannedPath, SecurityRefusalError } from "@developer-os/security";

export interface DirectoryEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
}

export interface DirectoryReader {
  readDir(path: string): Promise<readonly DirectoryEntry[]>;
}

export interface DiscoveredNote {
  readonly vaultPath: string;
  readonly absolutePath: string;
  readonly topicFolder: string;
}

export interface DiscoveryResult {
  readonly notes: readonly DiscoveredNote[];
  readonly unclassifiedFolders: readonly string[];
}

export interface DiscoveryRequest {
  readonly vaultRoot: string;
  readonly config: BrainConfigV1;
  readonly reader: DirectoryReader;
  readonly assertReadable: (path: string) => Promise<void>;
  readonly canonicalize?: (path: string) => Promise<string>;
}

export const PRIVATE_FOLDERS: readonly string[] = [
  "_raw",
  "_outputs",
  "_graveyard",
  "templates",
];

export function compareCanonical(a: string, b: string): number {
  const left = Buffer.from(a.normalize("NFC"), "utf8");
  const right = Buffer.from(b.normalize("NFC"), "utf8");
  return Buffer.compare(left, right);
}

function resolveTopic(name: string, config: BrainConfigV1): string | null {
  const aliased = Object.hasOwn(config.topicAliases, name)
    ? config.topicAliases[name]
    : name;
  if (aliased === undefined) return null;
  return config.topicFolders.includes(aliased) ? aliased : null;
}
```

`_indexes` is deliberately absent from `PRIVATE_FOLDERS`: it is excluded by `config.indexesDir`, which a user may rename, and duplicating it in a constant would make a renamed index directory scannable as notes.

```typescript
async function walk(
  directory: string,
  vaultPrefix: string,
  topicFolder: string,
  request: DiscoveryRequest,
  notes: DiscoveredNote[],
): Promise<void> {
  const entries = await request.reader.readDir(directory);

  for (const entry of entries) {
    const name = entry.name.normalize("NFC");
    if (name.startsWith(".")) continue;

    const absolutePath = join(directory, entry.name);
    const vaultPath = `${vaultPrefix}/${name}`;

    if (entry.isSymbolicLink) {
      const canonicalize = request.canonicalize ?? canonicalizePlannedPath;
      const target = await canonicalize(absolutePath);
      const root = await canonicalize(request.vaultRoot);
      if (!containsPath(root, target)) {
        throw new SecurityRefusalError(
          `Vault entry resolves outside the vault: ${vaultPath}`,
        );
      }
      continue;
    }

    if (entry.isDirectory) {
      await walk(absolutePath, vaultPath, topicFolder, request, notes);
      continue;
    }

    if (!entry.isFile || !name.endsWith(".md")) continue;

    await request.assertReadable(absolutePath);
    notes.push({ vaultPath, absolutePath, topicFolder });
  }
}

export async function discoverNotes(
  request: DiscoveryRequest,
): Promise<DiscoveryResult> {
  const { config } = request;
  const contentDir = join(request.vaultRoot, config.contentRoot);
  const notes: DiscoveredNote[] = [];
  const unclassified: string[] = [];

  const entries = await request.reader.readDir(contentDir);

  for (const entry of entries) {
    const name = entry.name.normalize("NFC");
    if (!entry.isDirectory || name.startsWith(".")) continue;
    if (name === config.indexesDir) continue;
    if (PRIVATE_FOLDERS.includes(name)) continue;

    const topicFolder = resolveTopic(name, config);
    if (topicFolder === null) {
      unclassified.push(`${config.contentRoot}/${name}`);
      continue;
    }

    await walk(
      join(contentDir, entry.name),
      `${config.contentRoot}/${name}`,
      topicFolder,
      request,
      notes,
    );
  }

  return {
    notes: [...notes].sort((a, b) => compareCanonical(a.vaultPath, b.vaultPath)),
    unclassifiedFolders: [...unclassified].sort(compareCanonical),
  };
}
```

Symlinks are refused rather than followed even when they resolve inside the vault, because a link and its target would otherwise be indexed as two notes with one content hash — a duplicate finding nobody can act on.

- [x] **Step 4: Run and confirm the tests pass**

Run: `npx vitest run packages/brain/src/discovery`
Expected: PASS, all six cases.

- [x] **Step 5: Add the barrel export**

`packages/brain/src/discovery/index.ts` re-exports every name from `./discover.js`. Add the same names to `packages/brain/src/index.ts`.

- [x] **Step 6: Build the committed synthetic fixture**

Create `tests/fixtures/brain/legacy-shape/` with exactly this tree. Every word is invented; it encodes only the shape recorded in `docs/migration/baseline-capabilities.json` (Obsidian Markdown, a vault map, a catalog, a graph, index-first retrieval).

```text
tests/fixtures/brain/legacy-shape/
├── .obsidian/app.json                 {}
└── content/
    ├── DEV/caching.md                 knowledge-note, tags [dev, caching], links to DEV/testing
    ├── DEV/testing.md                 knowledge-note, tags [dev, testing]
    ├── PROJECTS/orchard.md            project-note, tags [project, orchard]
    ├── TOOLS/rowlease.md              reference-note, tags [tools]
    ├── INFRA/backups.md               compiled-note, tags [infra]
    ├── _raw/inbox/unprocessed.md      must never appear in any index
    ├── _outputs/report.md             must never appear in any index
    ├── _graveyard/retired.md          must never appear in any index
    ├── templates/note.md              must never appear in any index
    └── _indexes/.gitkeep
```

Each of the five canonical notes carries the full required key set from spec §4.2. `content/DEV/caching.md`:

```markdown
---
schemaVersion: 1
title: Cache invalidation on write
type: knowledge-note
created: 2026-01-05
updated: 2026-02-11
tags: [dev, caching]
aliases: [cache busting]
summary: Invalidate the cache when a value is written, never when it is read.
stage: established
author: human
reviewed: 2026-02-11
occurrences: 4
---

Writing through the cache keeps readers correct without a second round trip.
See [[DEV/testing]] for the cases that pin this.
```

Give `PROJECTS/orchard.md` `author: agent` and `reviewed: null` with `occurrences: 3`, so the provenance and staleness lint classes in Task 6 have a real subject. Give `INFRA/backups.md` a `created` date older than 400 days so the staleness threshold is exercised.

Add `tests/fixtures/brain/README.md` stating, in one paragraph, that the fixture is wholly invented, is never generated from or compared against a real vault, and is extended in place when the product needs a shape it does not yet encode.

- [x] **Step 7: Run the gates**

Run: `npm run check`
Expected: PASS. The self-containment lint reads untracked files too, so a fixture accidentally naming a real path fails here rather than in review.

- [x] **Step 8: Commit**

```bash
git add packages/brain/src/discovery/ packages/brain/src/index.ts tests/fixtures/brain/
git commit -m "feat: find notes by permission, not by absence of exclusion"
```

---

### Task 4: Index and graph construction

**Status: SHIPPED 2026-08-09, commit `5e3cff7`.** Deviations, all in that commit message:
link resolution is five tiers plus a case-folded fallback rather than four (spec §7 carries
the amendment, `BACKLOG.md` §8 registers it); `IndexBuildResult` gains `ambiguousLinks`,
`symlinkedFolders` and `sources` on `IndexedNote`; `parseIssues` carries issues from notes
that *parsed*, which is where `unknown-key` lives; the quadratic-`yaml` bound that Task 3's
Interfaces block assigned to discovery landed here instead, as `MAX_FRONTMATTER_CHARS`,
because discovery reads no files. The draft code blocks below are superseded by the shipped
modules and are kept only until Task 10 compresses this section.

**Files:**
- Create: `packages/brain/src/indexes/build.ts`, `packages/brain/src/indexes/serialize.ts`, `packages/brain/src/indexes/tokenize.ts`, `packages/brain/src/indexes/index.ts`
- Create: `packages/brain/src/indexes/build.test.ts`, `packages/brain/src/indexes/serialize.test.ts`
- Modify: `packages/brain/src/index.ts`

**Interfaces:**
- Consumes: `discoverNotes`, `DirectoryReader`, `compareCanonical` (Task 3); `parseNote` (Task 2); `hashBytes` from `@developer-os/core`.
- Produces: `IndexedTerm`, `IndexedNote`, `IndexedFolder`, `IndexedTag`, `IndexDocumentV1`, `GraphNode`, `GraphEdge`, `GraphDocumentV1`, `IndexBuildResult`, `buildIndex(request: IndexBuildRequest): Promise<IndexBuildResult>`, `IndexBuildRequest`, `serializeIndex(document: IndexDocumentV1): string`, `serializeGraph(document: GraphDocumentV1): string`, `tokenize(text: string): readonly string[]`.

- [x] **Step 1: Write the failing determinism tests**

`packages/brain/src/indexes/build.test.ts` — the two assertions that carry the gate:

```typescript
import { describe, expect, it } from "vitest";

import { buildIndex } from "./build.js";
import { serializeGraph, serializeIndex } from "./serialize.js";
import { fixtureRequest, reversedFixtureRequest } from "./testing.js";

const FROZEN = "2026-08-04T00:00:00.000Z";

describe("buildIndex determinism", () => {
  it("produces identical bytes on a second build with a frozen clock", async () => {
    const first = await buildIndex(fixtureRequest(FROZEN));
    const second = await buildIndex(fixtureRequest(FROZEN));
    expect(serializeIndex(second.index)).toBe(serializeIndex(first.index));
    expect(serializeGraph(second.graph)).toBe(serializeGraph(first.graph));
  });

  it("produces identical bytes under a reversed directory reader", async () => {
    const forward = await buildIndex(fixtureRequest(FROZEN));
    const reversed = await buildIndex(reversedFixtureRequest(FROZEN));
    expect(serializeIndex(reversed.index)).toBe(serializeIndex(forward.index));
    expect(serializeGraph(reversed.graph)).toBe(serializeGraph(forward.graph));
  });

  it("excludes every private folder from the index", async () => {
    const result = await buildIndex(fixtureRequest(FROZEN));
    const paths = result.index.notes.map((note) => note.path);
    expect(paths).toEqual([
      "content/DEV/caching.md",
      "content/DEV/testing.md",
      "content/INFRA/backups.md",
      "content/PROJECTS/orchard.md",
      "content/TOOLS/rowlease.md",
    ]);
  });

  it("records an unresolved link as a finding and never as an edge", async () => {
    const result = await buildIndex(fixtureRequest(FROZEN));
    for (const edge of result.graph.edges) {
      expect(result.index.notes.some((note) => note.path === edge.target)).toBe(true);
    }
  });

  it("uses only the injected clock for generatedAt", async () => {
    const result = await buildIndex(fixtureRequest(FROZEN));
    expect(result.index.generatedAt).toBe(FROZEN);
    expect(result.graph.generatedAt).toBe(FROZEN);
  });
});
```

`packages/brain/src/indexes/testing.ts` builds an `IndexBuildRequest` over `tests/fixtures/brain/legacy-shape/` using `node:fs/promises` for reads and a `DirectoryReader` that wraps `readdir(path, { withFileTypes: true })`, with a `reversed` variant that reverses each result array. Keep it in `src/` rather than a test folder so the reversed reader is available to Task 6 too.

- [x] **Step 2: Run and confirm they fail**

Run: `npx vitest run packages/brain/src/indexes`
Expected: FAIL, "Cannot find module './build.js'".

- [x] **Step 3: Implement tokenization**

`packages/brain/src/indexes/tokenize.ts`:

```typescript
const SEPARATOR = /[^\p{L}\p{N}]+/u;

export function tokenize(text: string): readonly string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .split(SEPARATOR)
    .filter((token) => token.length > 0);
}
```

No stemming, by decision — spec §8 states it as a non-goal rather than half-solving it.

- [x] **Step 4: Implement the build**

`packages/brain/src/indexes/build.ts`. The types first:

```typescript
export interface IndexedTerm {
  readonly term: string;
  readonly count: number;
}

export interface IndexedNote {
  readonly path: string;
  readonly title: string;
  readonly type: NoteType;
  readonly topicFolder: string;
  readonly tags: readonly string[];
  readonly aliases: readonly string[];
  readonly summary: string;
  readonly stage: NoteStage;
  readonly author: NoteAuthor;
  readonly reviewed: string | null;
  readonly occurrences: number;
  readonly created: string;
  readonly updated: string | null;
  readonly contentHash: string;
  readonly terms: readonly IndexedTerm[];
}

export interface IndexedFolder {
  readonly name: string;
  readonly noteCount: number;
  readonly types: readonly { readonly type: NoteType; readonly count: number }[];
  readonly topTags: readonly string[];
}

export interface IndexedTag {
  readonly tag: string;
  readonly count: number;
  readonly paths: readonly string[];
}

export interface IndexDocumentV1 {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly contentRoot: string;
  readonly notes: readonly IndexedNote[];
  readonly folders: readonly IndexedFolder[];
  readonly tags: readonly IndexedTag[];
}

export interface GraphNode {
  readonly path: string;
  readonly title: string;
  readonly topicFolder: string;
}

export interface GraphEdge {
  readonly source: string;
  readonly target: string;
  readonly text: string;
}

export interface GraphDocumentV1 {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export interface UnresolvedLink {
  readonly source: string;
  readonly text: string;
}

export interface NoteIssues {
  readonly path: string;
  readonly issues: readonly NoteParseIssue[];
}

export interface IndexBuildResult {
  readonly index: IndexDocumentV1;
  readonly graph: GraphDocumentV1;
  readonly unresolvedLinks: readonly UnresolvedLink[];
  readonly parseIssues: readonly NoteIssues[];
  readonly unclassifiedFolders: readonly string[];
}

export interface IndexBuildRequest {
  readonly vaultRoot: string;
  readonly config: BrainConfigV1;
  readonly reader: DirectoryReader;
  readonly readFile: (path: string) => Promise<string>;
  readonly assertReadable: (path: string) => Promise<void>;
  readonly now: () => string;
}
```

`terms` is an array of `{ term, count }` sorted by term, not a `Record`. An object's key order is an implementation detail of whatever built it; an explicitly sorted array cannot drift.

The build itself: discover, read and parse each note in `vaultPath` order, hash the raw bytes with `hashBytes`, tokenize the body, resolve `[[wikilinks]]`, then roll up folders and tags. Wikilink resolution matches, in order: an exact `vaultPath`; a `<topicFolder>/<name>` suffix with `.md` appended; an exact title; an exact alias. Ambiguous matches resolve to the lowest path under `compareCanonical` and emit no finding, because the duplicate-title lint class already covers the underlying problem.

```typescript
const WIKILINK = /\[\[([^\]|#]+)(?:[^\]]*)\]\]/gu;

export function extractLinks(body: string): readonly string[] {
  return [...body.matchAll(WIKILINK)]
    .map((match) => (match[1] ?? "").trim())
    .filter((text) => text.length > 0);
}
```

Every array in both documents is sorted with `compareCanonical` before it is returned: `notes` by `path`, `tags` by `tag`, each tag's `paths` by path, `folders` by the configured `topicFolders` order then name, `topTags` by count descending then tag, `nodes` by `path`, `edges` by `source` then `target` then `text`, and `terms` by `term`.

- [x] **Step 5: Implement canonical serialization**

`packages/brain/src/indexes/serialize.ts`:

```typescript
export function serializeIndex(document: IndexDocumentV1): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function serializeGraph(document: GraphDocumentV1): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
```

`JSON.stringify` emits object keys in insertion order, and every object above is built from a literal with a fixed key order, so this is deterministic without a custom stringifier. The one place that would not have held is `terms`, which Step 4 made an array for exactly this reason.

Add a test in `serialize.test.ts` asserting the output ends with exactly one `\n`, contains no `\r`, and that re-serializing a `JSON.parse` of the output reproduces it byte for byte.

- [x] **Step 6: Run and confirm the tests pass**

Run: `npx vitest run packages/brain/src/indexes`
Expected: PASS. If only the reversed-reader case fails, an unsorted array reached the output — find it by diffing the two serialized strings rather than by inspection.

- [x] **Step 7: Run the gates and commit**

Run: `npm run check`

```bash
git add packages/brain/src/indexes/ packages/brain/src/index.ts
git commit -m "feat: build an index that two machines agree on"
```

---

### Task 5: Rendered Markdown views

**Status: SHIPPED 2026-08-09, commit `6f23e2d`.** Additions beyond the draft, all in that
commit message: two golden-artifact tests holding the full bytes of both views (the property
tests let four content-destroying mutants pass); `schemaVersion` in the Markdown frontmatter;
a `## Notes with no folder section` fallback so an orphaned note cannot vanish from the
catalog; and escaping that covers backtick, brackets, angle bracket and a leading block
marker, because `note.ts` validates tags and summaries for type and length only. The tag line
is a list item so it cannot begin with untrusted bytes.

**Files:**
- Create: `packages/brain/src/indexes/render.ts`, `packages/brain/src/indexes/render.test.ts`
- Modify: `packages/brain/src/indexes/index.ts`, `packages/brain/src/index.ts`

**Interfaces:**
- Consumes: `IndexBuildResult`, `IndexDocumentV1` (Task 4).
- Produces: `renderVaultMap(index: IndexDocumentV1): string`, `renderCatalog(index: IndexDocumentV1): string`.

- [x] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";

import { buildIndex } from "./build.js";
import { renderCatalog, renderVaultMap } from "./render.js";
import { fixtureRequest, reversedFixtureRequest } from "./testing.js";

const FROZEN = "2026-08-04T00:00:00.000Z";

describe("rendered views", () => {
  it("carries generatedAt in frontmatter exactly once", async () => {
    const { index } = await buildIndex(fixtureRequest(FROZEN));
    for (const text of [renderVaultMap(index), renderCatalog(index)]) {
      expect(text.match(/^generatedAt: /gmu)).toHaveLength(1);
      expect(text).toContain(`generatedAt: ${FROZEN}`);
    }
  });

  it("is byte-identical under a reversed directory reader", async () => {
    const forward = await buildIndex(fixtureRequest(FROZEN));
    const reversed = await buildIndex(reversedFixtureRequest(FROZEN));
    expect(renderVaultMap(reversed.index)).toBe(renderVaultMap(forward.index));
    expect(renderCatalog(reversed.index)).toBe(renderCatalog(forward.index));
  });

  it("orders recent changes by frontmatter dates, never by mtime", async () => {
    const { index } = await buildIndex(fixtureRequest(FROZEN));
    const map = renderVaultMap(index);
    const caching = map.indexOf("Cache invalidation on write");
    expect(caching).toBeGreaterThan(-1);
  });

  it("names no private folder", async () => {
    const { index } = await buildIndex(fixtureRequest(FROZEN));
    for (const text of [renderVaultMap(index), renderCatalog(index)]) {
      expect(text).not.toContain("_raw");
      expect(text).not.toContain("_graveyard");
    }
  });
});
```

- [x] **Step 2: Run and confirm they fail**

Run: `npx vitest run packages/brain/src/indexes/render.test.ts`
Expected: FAIL, "Cannot find module './render.js'".

- [x] **Step 3: Implement**

Both renderers emit YAML frontmatter with `generatedAt` and nothing else time-derived, then Markdown built only from `IndexDocumentV1`. `renderVaultMap` writes a folder table (folder, notes, types, top tags), a tag line, and a "recent changes" list of at most fifteen notes ordered by `updated ?? created` descending then path ascending. `renderCatalog` writes one `##` section per folder in the index's folder order, each listing `- [title](path) — summary`.

Escape every interpolated value for Markdown table cells by replacing `|` with `\|` and collapsing any `\r?\n` to a space. A note titled `a | b` would otherwise add a phantom column and silently corrupt the table.

Both functions end their output with exactly one `\n`.

- [x] **Step 4: Run, gate, and commit**

Run: `npx vitest run packages/brain/src/indexes` then `npm run check`

```bash
git add packages/brain/src/indexes/render.ts packages/brain/src/indexes/render.test.ts \
  packages/brain/src/indexes/index.ts packages/brain/src/index.ts
git commit -m "feat: render a map a human can read from an index a machine can trust"
```

---

### Task 6: Lint

**Status: SHIPPED 2026-08-09, commit `a80856c`.** Deviations, all in that commit message: the
`collision` fixture is built in memory because a case-insensitive volume cannot hold it and a
committed one would mean different things on macOS and Linux CI; the unterminated-fence
heuristic gained a length gate so it does not fire on ordinary Obsidian property names; source
validation is an allowlist *plus* a shape test; every interpolated value is bounded by
`renderValue`. The second carried finding — `YAMLParseError`'s line and column — is **not**
closed here and is `BACKLOG.md` §1 NEW-3, hooked from Task 8's opening and Task 10 Step 6.

**Files:**
- Create: `packages/brain/src/lint/lint.ts`, `packages/brain/src/lint/drift.ts`, `packages/brain/src/lint/index.ts`, `packages/brain/src/lint/lint.test.ts`
- Create: `tests/fixtures/brain/malformed/` (eight one-concern fixtures)
- Modify: `packages/brain/src/index.ts`

**Interfaces:**
- Consumes: `IndexBuildResult`, `buildIndex` (Task 4); `renderCatalog`, `renderVaultMap` (Task 5); `NoteParseIssue` (Task 2).
- Produces: `LintClass`, `LintSeverity`, `LintFinding`, `LintResult`, `lintVault(request: LintRequest): Promise<LintResult>`, `LintRequest`, `canonicalizeArtifact(text: string): string`.

- [x] **Step 1: Write the failing tests**

One case per row of spec §7's table, each against its own fixture, plus the drift case that matters most:

```typescript
it("reports no drift after a clean reindex even when the clock has moved", async () => {
  const built = await buildIndex(fixtureRequest("2026-08-04T00:00:00.000Z"));
  const written = writtenArtifacts(built);
  const result = await lintVault(lintRequestFor(written, "2026-09-01T12:34:56.000Z"));
  expect(result.findings.filter((f) => f.class === "index-drift")).toEqual([]);
});

it("reports drift when a written artifact differs in anything but generatedAt", async () => {
  const built = await buildIndex(fixtureRequest("2026-08-04T00:00:00.000Z"));
  const written = { ...writtenArtifacts(built) };
  written["content/_indexes/index.json"] = written["content/_indexes/index.json"].replace(
    "Cache invalidation on write",
    "Cache invalidation on read",
  );
  const result = await lintVault(lintRequestFor(written, "2026-09-01T12:34:56.000Z"));
  expect(result.findings).toContainEqual(
    expect.objectContaining({ class: "index-drift", severity: "error" }),
  );
});

it("reports a case-insensitive path collision as an error", async () => {
  const result = await lintVault(lintRequestForFixture("collision"));
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      class: "duplicates",
      severity: "error",
      path: "content/DEV/Caching.md",
    }),
  );
  expect(result.findings).toContainEqual(
    expect.objectContaining({ class: "duplicates", path: "content/DEV/caching.md" }),
  );
});

it("reports an agent-authored note with no review at warn", async () => {
  const result = await lintVault(lintRequestForFixture("legacy-shape"));
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      class: "provenance",
      severity: "warn",
      path: "content/PROJECTS/orchard.md",
      key: "reviewed",
    }),
  );
});

it("reports an unresolved wikilink as an error naming the source", async () => {
  const result = await lintVault(lintRequestForFixture("broken-link"));
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      class: "links",
      severity: "error",
      path: "content/DEV/caching.md",
      message: expect.stringContaining("DEV/absent"),
    }),
  );
});

it("reports a link into an excluded folder as an error", async () => {
  const result = await lintVault(lintRequestForFixture("link-into-raw"));
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      class: "links",
      severity: "error",
      message: expect.stringContaining("_raw"),
    }),
  );
});

it("reports a duplicate title within one topic folder at warn", async () => {
  const result = await lintVault(lintRequestForFixture("duplicate-title"));
  const found = result.findings.filter(
    (finding) => finding.class === "duplicates" && finding.severity === "warn",
  );
  expect(found.map((finding) => finding.path).sort()).toEqual([
    "content/DEV/one.md",
    "content/DEV/two.md",
  ]);
});

it("reports an identical content hash at warn", async () => {
  const result = await lintVault(lintRequestForFixture("duplicate-content"));
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      class: "duplicates",
      severity: "warn",
      message: expect.stringContaining("identical content"),
    }),
  );
});

it("reports a review older than the threshold at warn", async () => {
  const result = await lintVault(lintRequestForFixture("legacy-shape"));
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      class: "staleness",
      severity: "warn",
      path: "content/INFRA/backups.md",
    }),
  );
});

it("reports an unclassified folder at warn", async () => {
  const result = await lintVault(lintRequestForFixture("unclassified-folder"));
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      class: "frontmatter",
      severity: "warn",
      path: "content/Scratch",
      message: expect.stringContaining("not a configured topic folder"),
    }),
  );
});

it("counts an error only when one is present", async () => {
  const clean = await lintVault(lintRequestForFixture("legacy-shape"));
  expect(clean.errorCount).toBe(0);
  expect(clean.warnCount).toBeGreaterThan(0);

  const broken = await lintVault(lintRequestForFixture("broken-link"));
  expect(broken.errorCount).toBeGreaterThan(0);
});
```

`lintRequestForFixture(name)` is a thin wrapper over `lintRequestFor` that points at `tests/fixtures/brain/<name>/` and reindexes it first, so each malformed fixture is compared against its own freshly built artifacts rather than against `legacy-shape`'s.

- [x] **Step 2: Run and confirm they fail**

Run: `npx vitest run packages/brain/src/lint`
Expected: FAIL, "Cannot find module './lint.js'".

- [x] **Step 3: Implement canonical-form drift**

`packages/brain/src/lint/drift.ts`:

```typescript
export const GENERATED_AT_SENTINEL = "1970-01-01T00:00:00.000Z";

const JSON_GENERATED_AT = /^(\s*"generatedAt":\s*)"[^"]*"/mu;
const MARKDOWN_GENERATED_AT = /^(generatedAt:\s*)\S+$/mu;

/**
 * Drift compares canonical form, not bytes. `generatedAt` moves on every build,
 * so a byte comparison would report drift one second after a clean reindex and
 * never stop — and a permanently-red check is one people learn to ignore.
 * Everything else is still compared byte for byte, which is why this replaces
 * the value textually instead of parsing and re-serializing: re-serializing
 * would mask a formatting difference that is real drift.
 */
export function canonicalizeArtifact(text: string): string {
  return text
    .replace(JSON_GENERATED_AT, `$1"${GENERATED_AT_SENTINEL}"`)
    .replace(MARKDOWN_GENERATED_AT, `$1${GENERATED_AT_SENTINEL}`);
}
```

Add a test asserting `canonicalizeArtifact` replaces exactly one occurrence per artifact, so a note body containing the literal text `generatedAt:` cannot be rewritten.

- [x] **Step 4: Implement the six classes**

The types, in `packages/brain/src/lint/lint.ts`:

```typescript
export type LintClass =
  | "frontmatter"
  | "provenance"
  | "links"
  | "duplicates"
  | "staleness"
  | "index-drift";

export type LintSeverity = "error" | "warn" | "info";

export interface LintFinding {
  readonly class: LintClass;
  readonly severity: LintSeverity;
  readonly path: string;
  readonly key: string | null;
  readonly message: string;
}

export interface LintResult {
  readonly findings: readonly LintFinding[];
  readonly errorCount: number;
  readonly warnCount: number;
  readonly infoCount: number;
}

export interface LintRequest {
  readonly build: IndexBuildRequest;
  readonly readArtifact: (vaultPath: string) => Promise<string | null>;
  readonly today: string;
}
```

`readArtifact` returns `null` for a missing artifact rather than throwing, because "the index has never been built" is an `index-drift` finding with recovery text, not a crash. `today` is a `YYYY-MM-DD` string taken from the injected clock — the staleness class is the only one that needs the current date, and passing it explicitly keeps `lintVault` a pure function of its arguments.

**Two findings carried here from Task 2's review. The first shipped; the second did not —
it is `BACKLOG.md` §1 NEW-3, because it needs a new field on `NoteParseIssue` and
`LintFinding`, which is a decision about an interface Tasks 7–10 consume:**

1. **An unterminated frontmatter block silently swallows body prose.** A note whose opening
   fence is never closed will have the *next* `---` in the body treated as the closing fence,
   so everything above it parses as frontmatter and the indexed body loses its first paragraph.
   The round trip still holds and the only signal today is an `info`. A YAML mapping key
   containing whitespace is a sign of this, and real reserved keys never contain any — so
   `frontmatter` reports an unknown key that contains whitespace **and is longer than 24
   characters** at `warn`. The length gate is not decoration: Obsidian's Properties UI accepts
   arbitrary property names, so `Due date` is a stock note, and a class that fires on ordinary
   Obsidian output is a class users learn to ignore. It is a heuristic,
   which is why it lives here and not in the parser.
2. **A `YAMLParseError` carries line and column that the parser discards.** `parseNote` maps
   every YAML failure to one `malformed` issue with `key: null`, so a duplicate `tags:` — which
   Obsidian users do hit — reports nothing about where. Carry `err.linePos` onto the issue.
   Read `err.linePos` and `err.pos` **only** — never `err.message`, and never `err.source`. Both embed the offending source verbatim (`"Map keys must be unique at line 2, column 1:\n\ntitle: a\ntitle: b"`), which is exactly the note content the redaction rule exists for.

`lintVault` runs `buildIndex`, then evaluates each class against the build result and the four artifacts read from disk. Findings carry `{ class, severity, path, key, message }` and are returned sorted by path, then class, then message, so the output is as deterministic as the index. `LintResult` also carries `errorCount`, `warnCount`, and `infoCount`.

Case-collision detection folds each path with `toLowerCase()` and groups; any group of more than one is an `error` reported against every member. Content-hash duplicates group on `contentHash`. Title duplicates group on `title.trim().toLowerCase()` within one `topicFolder`.

- [x] **Step 5: Run, gate, and commit**

Run: `npx vitest run packages/brain/src/lint` then `npm run check`

```bash
git add packages/brain/src/lint/ packages/brain/src/index.ts tests/fixtures/brain/malformed/
git commit -m "feat: fail a vault loudly and per path"
```

---

### Task 7: Retrieval

**Status: SHIPPED 2026-08-09, commit `83e9ba1`.** Deviations, all in that commit message:
query tokens are deduplicated; `title` and `summary` are character-screened and the title
capped, while `path` is deliberately left byte-exact because spec §14 gates on a match
resolving at it; the dead `tokens.includes(type)` branch is deleted and its premise enforced
by a test.

**Two things Task 9 inherits.** It must pass a match's `path` through `renderPath` before
printing — retrieval cannot screen it without breaking the §14 gate. And spec §8 needs one
amendment covering `considered`/`selected`, `--limit`, and the fact that a multi-word query
is an OR over its tokens rather than the literal whole-query reading §8 currently implies;
all three live in the same paragraph, so they are one edit, not three.

**Files:**
- Create: `packages/brain/src/retrieval/search.ts`, `packages/brain/src/retrieval/index.ts`, `packages/brain/src/retrieval/search.test.ts`
- Modify: `packages/brain/src/index.ts`

**Interfaces:**
- Consumes: `IndexDocumentV1`, `IndexedNote` (Task 4); `tokenize` (Task 4).
- Produces: `RetrievalQuery`, `RetrievalMatch`, `RetrievalResult`, `search(index: IndexDocumentV1, query: RetrievalQuery): RetrievalResult`, `FIELD_WEIGHTS`.

- [x] **Step 1: Write the failing tests**

```typescript
let index: IndexDocumentV1;
beforeAll(async () => {
  index = await indexFixture();
});

describe("search", () => {
  it("returns matches carrying a resolvable path", () => {
    const result = search(index, { text: "caching", maxCandidates: 10 });
    expect(result.kind).toBe("results");
    if (result.kind !== "results") return;
    for (const match of result.matches) {
      expect(index.notes.some((note) => note.path === match.path)).toBe(true);
    }
  });

  it("returns no-candidates rather than falling back to full text", () => {
    const result = search(index, { text: "zzzznotpresent", maxCandidates: 10 });
    expect(result.kind).toBe("no-candidates");
    if (result.kind !== "no-candidates") return;
    expect(result.tried).toEqual(["tag", "type", "folder", "title", "alias"]);
  });

  it("weights a title hit above a body hit", () => {
    const result = search(index, { text: "caching", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches[0]?.path).toBe("content/DEV/caching.md");
  });

  it("breaks ties by path so ordering is total", () => {
    const tied: IndexDocumentV1 = {
      ...index,
      notes: [
        { ...index.notes[0]!, path: "content/DEV/b.md", title: "tie", aliases: [], tags: ["tie"], summary: "", terms: [] },
        { ...index.notes[0]!, path: "content/DEV/a.md", title: "tie", aliases: [], tags: ["tie"], summary: "", terms: [] },
      ],
    };
    const result = search(tied, { text: "tie", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches.map((match) => match.path)).toEqual([
      "content/DEV/a.md",
      "content/DEV/b.md",
    ]);
    expect(result.matches[0]?.score).toBe(result.matches[1]?.score);
  });

  it("truncates at maxCandidates and says so", () => {
    const result = search(index, { text: "dev", maxCandidates: 1 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("never reads stage or reviewed when scoring", () => {
    const promoted = { ...index, notes: index.notes.map((n) => ({ ...n, stage: "established" as const })) };
    const a = search(index, { text: "caching", maxCandidates: 10 });
    const b = search(promoted, { text: "caching", maxCandidates: 10 });
    if (a.kind !== "results" || b.kind !== "results") throw new Error("expected results");
    expect(b.matches.map((m) => m.path)).toEqual(a.matches.map((m) => m.path));
  });

  it("returns stage and reviewed on every match", () => {
    const result = search(index, { text: "caching", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    for (const match of result.matches) {
      expect(["emerging", "established", "deprecated"]).toContain(match.stage);
      expect(match.reviewed === null || /^\d{4}-\d{2}-\d{2}$/u.test(match.reviewed)).toBe(true);
    }
  });

  it("intersects explicit filters with the funnel", () => {
    const unfiltered = search(index, { text: "dev", maxCandidates: 10 });
    const filtered = search(index, {
      text: "dev",
      filters: { folders: ["INFRA"] },
      maxCandidates: 10,
    });
    if (unfiltered.kind !== "results") throw new Error("expected results");
    expect(unfiltered.matches.length).toBeGreaterThan(0);
    if (filtered.kind === "results") {
      for (const match of filtered.matches) {
        expect(match.path.startsWith("content/INFRA/")).toBe(true);
      }
    } else {
      expect(filtered.tried).toEqual(FUNNEL_STAGES);
    }
  });
});
```

- [x] **Step 2: Run and confirm they fail**

Run: `npx vitest run packages/brain/src/retrieval`
Expected: FAIL, "Cannot find module './search.js'".

- [x] **Step 3: Implement**

```typescript
export const FIELD_WEIGHTS = {
  title: 4,
  alias: 3,
  tag: 3,
  summary: 2,
  body: 1,
} as const;

export const FUNNEL_STAGES: readonly string[] = ["tag", "type", "folder", "title", "alias"];
```

Stage 1 keeps a note when any query token equals a tag, equals the type, equals the topic folder, or is a substring of the lowercased title or of any alias — then intersects with `filters` when present. Stage 2 sums, per query token: `FIELD_WEIGHTS.title` per occurrence in the tokenized title, `alias` per alias occurrence, `tag` per exact tag match, `summary` per tokenized-summary occurrence, and `body` times the note's `terms` count for that token. Every value is an integer, so no float ever enters an ordering comparison.

Sort by score descending, then `compareCanonical(path)` ascending. Truncate to `maxCandidates` and set `truncated` when the pre-truncation length was greater.

An empty stage 1 returns `{ kind: "no-candidates", tried: FUNNEL_STAGES }` and does not score anything.

- [x] **Step 4: Run, gate, and commit**

Run: `npx vitest run packages/brain/src/retrieval` then `npm run check`

```bash
git add packages/brain/src/retrieval/ packages/brain/src/index.ts
git commit -m "feat: retrieve through the funnel and say when nothing is reachable"
```

---

### Task 8: Public surface — capture type, migrations, adoption, and the facade

**Status: SHIPPED 2026-08-10, commit `d5dc429`.** Deviations, all in that commit message:
`BrainService.search` returns a `BrainSearchOutcome`, which adds an `index-unavailable`
variant to spec §8's two rather than throwing for an expected vault state; `renderArtifacts`
and `lintBuild` were extracted first, closing the two refactors an earlier review assigned
here; adoption is an allow-list rather than a subtraction list.

**Task 9 inherits three things from this task**, on top of the two Task 7 left it:
`BrainService.search` also **throws** `RangeError` for a `maxCandidates` that is not a
positive integer — a caller bug, not a variant — so `--limit` needs validation *and* a
`try`/`catch`; `BrainIndexUnavailable.reason` is `"missing" | "unreadable"` and the two
deserve different recovery text; and `readArtifact` reports an unreadable artifact as a
missing one, so a permission error surfaces as "run reindex".

**`NoteParseIssue` and `LintFinding` both carry `readonly line: number | null`** as of
2026-08-09, which closed `BACKLOG.md` §1 NEW-3 before this task could freeze the shape without
it. Nothing further is owed here.

**Files:**
- Create: `packages/brain/src/schema/capture.ts`, `packages/brain/src/schema/capture.test.ts`
- Create: `packages/brain/src/migrations/index.ts`, `packages/brain/src/migrations/migrations.test.ts`
- Create: `packages/brain/src/service.ts`, `packages/brain/src/service.test.ts`
- Modify: `packages/brain/src/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 through 7.
- Produces: `CaptureStatus`, `CaptureEnvelopeV1`, `CAPTURE_STATUSES`, `BrainMigration`, `BRAIN_MIGRATIONS`, `BrainStatusReportV1`, `BrainService`, `BrainServiceDependencies`, `BrainArtifacts`.

- [x] **Step 1: Define the capture envelope as a type only**

`packages/brain/src/schema/capture.ts` declares `CaptureEnvelopeV1` with exactly the fields in design spec §13.1 and the six statuses `quarantined`, `accepted`, `rejected`, `staging`, `ingested`, `failed`. Nothing in this package constructs, transitions, or persists one — `DOS-P6` owns the lifecycle. Add a single test asserting `CAPTURE_STATUSES` has those six members in that order, so a later task cannot quietly add a seventh.

- [x] **Step 2: Define migrations as an empty registry**

```typescript
/**
 * What a migration is allowed to see: the resolved configuration and the notes
 * discovery found, never the filesystem. A migration that could read arbitrary
 * paths could not be reviewed by reading its own code.
 */
export interface VaultSnapshot {
  readonly vaultRoot: string;
  readonly config: BrainConfigV1;
  readonly notes: readonly IndexedNote[];
}

export interface BrainMigration {
  readonly from: number;
  readonly to: number;
  readonly describe: () => string;
  readonly plan: (snapshot: VaultSnapshot) => ChangePlanV1;
}

/**
 * Deliberately empty. There is no prior schema version to migrate from, and an
 * untested migration path is worse than an absent one.
 */
export const BRAIN_MIGRATIONS: readonly BrainMigration[] = [];
```

Test: the registry is empty, and every entry (vacuously) satisfies `from < to`. The second assertion exists so the invariant is already pinned when the first migration lands.

- [x] **Step 3: Write the failing facade test**

```typescript
describe("BrainService", () => {
  it("reindex returns the four artifacts and writes nothing", async () => {
    const writes: string[] = [];
    const service = serviceFor({ onWrite: (p: string) => writes.push(p) });
    const artifacts = await service.reindex();
    expect(Object.keys(artifacts.files).sort()).toEqual([
      "content/_indexes/catalog.md",
      "content/_indexes/graph.json",
      "content/_indexes/index.json",
      "content/_indexes/vault-map.md",
    ]);
    expect(writes).toEqual([]);
  });

  it("status reports adoption findings without changing anything", async () => {
    const service = serviceFor({});
    const report = await service.status();
    expect(report.noteCount).toBe(5);
    expect(report.wouldChange).toEqual([]);
  });
});
```

`serviceFor(overrides)` builds a `BrainService` over `tests/fixtures/brain/legacy-shape/` from `fixtureRequest`'s dependencies, replacing `readFile` with one that records every path it is asked for and, when `onWrite` is supplied, asserting it is never called — the write channel does not exist on `BrainServiceDependencies` at all, which is what makes the first assertion structural rather than behavioural.

- [x] **Step 4: Implement the facade**

```typescript
export interface BrainArtifacts {
  readonly files: Readonly<Record<string, string>>;
  readonly build: IndexBuildResult;
}

export interface BrainServiceDependencies {
  readonly vaultRoot: string;
  readonly config: BrainConfigV1;
  readonly reader: DirectoryReader;
  readonly readFile: (path: string) => Promise<string>;
  readonly assertReadable: (path: string) => Promise<void>;
  readonly now: () => Date;
}

export interface BrainStatusReportV1 {
  readonly schemaVersion: 1;
  readonly vaultRoot: string;
  readonly contentRoot: string;
  readonly noteCount: number;
  readonly topicFolders: readonly string[];
  readonly unclassifiedFolders: readonly string[];
  readonly indexPresent: boolean;
  /** Adoption findings: what would have to change for this vault to validate. */
  readonly wouldChange: readonly LintFinding[];
}

export class BrainService {
  constructor(private readonly deps: BrainServiceDependencies) {}

  /** buildIndex, then serialize and render into the four vault-relative paths. */
  async reindex(): Promise<BrainArtifacts>;

  /** lintVault over a fresh build, reading the on-disk artifacts for drift. */
  async lint(): Promise<LintResult>;

  /** Read and parse index.json, then search it. Never rebuilds. */
  async search(query: RetrievalQuery): Promise<RetrievalResult>;

  /** Discovery counts plus the adoption findings, changing nothing. */
  async status(): Promise<BrainStatusReportV1>;
}
```

Method bodies are left to the implementer because each one is a two-to-four line composition of functions Tasks 4 through 7 already pinned with their own tests; the signatures above are the contract Task 9 is written against.

`reindex` **returns** bytes and writes nothing — the CLI stages them through `TransactionExecutor` in Task 9. That is what keeps the "no direct filesystem mutation of a user's notes" constraint mechanical rather than aspirational, and the test in Step 3 pins it.

`search` reads `index.json` from disk rather than rebuilding, so retrieval stays index-first; a missing or unparseable index returns a failure telling the user to run `brain reindex`.

- [x] **Step 5: Run, gate, and commit**

Run: `npx vitest run packages/brain` then `npm run check`

```bash
git add packages/brain/src/schema/capture.ts packages/brain/src/schema/capture.test.ts \
  packages/brain/src/migrations/ packages/brain/src/service.ts \
  packages/brain/src/service.test.ts packages/brain/src/index.ts
git commit -m "feat: put one facade in front of the Brain"
```

---

### Task 9: The `brain` command group

**Status: SHIPPED 2026-08-10, commit `8c9f4f6`.** The two obligations Task 7 left and the
three Task 8 left are discharged; design spec §8 carries the amendment and `BACKLOG.md` §8
registers it.

**Three deviations recorded rather than fixed, and Task 10 should decide whether any of them
belongs in the e2e suite:**

1. **`reindex` does not call `assertRootsAnchored`, and `init` does.** `brainPath` is
   validated only as an absolute path, so a hand-edited config pointing outside the home is
   refused by `init` and accepted by `reindex`. Every write still passes `assertWritable`, so
   the blast radius is four files at a non-protected absolute path for an attacker who can
   already edit the config — but the asymmetry is exactly the kind that gets rediscovered
   later as a finding.
2. **`--dry-run` validates nothing.** It returns before staging, so it cannot fail where the
   real run fails; and a real run now reconciles the manifest, which a dry run does not, so
   it is no longer "the same plan without the write".
3. **An unreadable artifact reports as a missing one.** `BrainService.readArtifact` catches
   everything, so `EACCES` on `_indexes/` tells the user to run `reindex`, which will then
   also fail.

**Two checks are defence in depth that no reachable input exercises**, and both say so at the
code rather than pretending a test covers them: the narrow `ownedRoots`, since every path
reindex plans is inside the index directory by construction; and the `assertTarget` before
`mkdir`, since discovery's own `assertReadable` refuses a protected vault first.

**Files:**
- Create: `apps/cli/src/commands/brain.ts`, `apps/cli/src/commands/brain.test.ts`
- Modify: `apps/cli/src/main.ts`, `apps/cli/src/context.ts`, `apps/cli/src/main.test.ts`, `apps/cli/package.json`, `apps/cli/tsconfig.json`

**Interfaces:**
- Consumes: `BrainService` (Task 8); `CliContext`, `CliResult`, `EXIT_CODES`, `TransactionExecutor`.
- Produces: `BrainReindexResultV1`, `BrainLintResultV1`, `BrainSearchResultV1`, `BrainStatusResultV1`, `BrainOptions`, `runBrain(context: CliContext, options: BrainOptions): Promise<CliResult<BrainResultV1>>`, where:

```typescript
export type BrainResultV1 =
  | BrainReindexResultV1
  | BrainLintResultV1
  | BrainSearchResultV1
  | BrainStatusResultV1;

export interface BrainOptions {
  readonly subcommand: "reindex" | "lint" | "search" | "status";
  readonly query: string | null;
  readonly limit: number | null;
  readonly dryRun: boolean;
}
```

Every one of the four result types carries `schemaVersion: 1` and a `subcommand` discriminant, so `--json` consumers can switch on one field. `BrainReindexResultV1` carries `written: readonly string[]` and `transactionId: string | null` — `null` under `--dry-run`, matching the convention `InitResultV1` already uses.

- [x] **Step 1: Write the failing dispatch tests**

Extend `apps/cli/src/main.test.ts`:

```typescript
it("accepts a brain subcommand", async () => {
  expect(await run(["brain", "lint"], io, factory)).toBe(EXIT_CODES.success);
});

it("accepts a search query as a second positional", async () => {
  expect(await run(["brain", "search", "caching"], io, factory)).toBe(EXIT_CODES.success);
});

it("treats developer-os search as an alias", async () => {
  expect(await run(["search", "caching"], io, factory)).toBe(EXIT_CODES.success);
});

it("refuses an unknown brain subcommand", async () => {
  expect(await run(["brain", "reticulate"], io, factory)).toBe(EXIT_CODES.invalidInput);
});

it("refuses --limit on a subcommand that does not take it", async () => {
  expect(await run(["brain", "lint", "--limit", "5"], io, factory)).toBe(EXIT_CODES.invalidInput);
});

it("refuses --dry-run on a read-only subcommand", async () => {
  expect(await run(["brain", "search", "x", "--dry-run"], io, factory)).toBe(EXIT_CODES.invalidInput);
});

it("refuses a search with no query", async () => {
  expect(await run(["brain", "search"], io, factory)).toBe(EXIT_CODES.invalidInput);
});
```

- [x] **Step 2: Run and confirm they fail**

Run: `npx vitest run apps/cli/src/main.test.ts`
Expected: FAIL — `parse` returns `null` for more than one positional, so every new case exits 2.

- [x] **Step 3: Widen dispatch without weakening it**

`parse` currently rejects `positionals.length > 1`. Replace that with a per-command positional arity, keeping strictness exactly as tight:

```typescript
const COMMAND_POSITIONALS: Readonly<Record<string, { readonly min: number; readonly max: number }>> = {
  init: { min: 0, max: 0 },
  status: { min: 0, max: 0 },
  doctor: { min: 0, max: 0 },
  repair: { min: 0, max: 0 },
  uninstall: { min: 0, max: 0 },
  brain: { min: 1, max: 2 },
  search: { min: 1, max: 1 },
};

const BRAIN_SUBCOMMANDS: Readonly<Record<string, { readonly options: readonly OptionName[]; readonly query: boolean }>> = {
  reindex: { options: ["dry-run", "json"], query: false },
  lint: { options: ["json"], query: false },
  search: { options: ["json", "limit"], query: true },
  status: { options: ["json"], query: false },
};
```

Add `limit: { type: "string" }` to `OPTIONS` and to `OPTION_NAMES`. Validate the subcommand with `Object.hasOwn` for the same reason the existing code does — a prototype member name would otherwise pass the lookup. Reject a subcommand requiring a query when the second positional is absent, and reject a second positional when it does not. Normalize `developer-os search <query>` into the same `Invocation` the `brain search` path produces, so exactly one code path runs.

- [x] **Step 4: Implement the command**

`apps/cli/src/commands/brain.ts` constructs a `BrainService` from the context, dispatches on the subcommand, and returns a version-stamped `schemaVersion: 1` result per subcommand. `reindex` stages its four files through `context.executor.execute({ kind: "brain-reindex", mutations })`, using `validateChangePlan` with the vault's index directory as the owned root and every other vault directory excluded — the same two-step shape `init` uses at `apps/cli/src/commands/init.ts:308`. `--dry-run` returns the planned paths and executes nothing.

`lint` maps `errorCount > 0` to `EXIT_CODES.operationalFailure` and otherwise `success`, carrying warnings through `CliResult.warnings`. `search` on a missing index returns `EXIT_CODES.invalidInput` with recovery text naming `developer-os brain reindex`. `--limit` parses as a positive integer, and anything else is `EXIT_CODES.invalidInput`.

Add the human renderers to `main.ts` beside the existing ones, and pass every rendered path through `renderPath` — vault paths come from a user-writable directory and reach a terminal.

Add `@developer-os/brain` to `apps/cli/package.json` dependencies and a `{ "path": "../../packages/brain" }` reference to `apps/cli/tsconfig.json`. Extend the `USAGE` block with the four subcommands and `--limit`.

- [x] **Step 5: Run, gate, and commit**

Run: `npx vitest run apps/cli` then `npm run check`

```bash
git add apps/cli/src/commands/brain.ts apps/cli/src/commands/brain.test.ts \
  apps/cli/src/main.ts apps/cli/src/main.test.ts apps/cli/src/context.ts \
  apps/cli/package.json apps/cli/tsconfig.json pnpm-lock.yaml
git commit -m "feat: expose the Brain through one command group"
```

---

### Task 10: Template, `init` integration, and end-to-end evidence

**Files:**
- Create: `templates/brain/` (skeleton and four example notes)
- Modify: `apps/cli/src/commands/init.ts`, `apps/cli/src/commands/init.test.ts`
- Create: `tests/e2e/brain.test.ts`
- Modify: `docs/superpowers/BACKLOG.md`, `docs/superpowers/ORDER.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no new types; `init` gains template artifacts in its `InitResultV1.created` list.

- [ ] **Step 1: Build the template**

`templates/brain/` mirrors design spec §12's layout: `content/{PROJECTS,TOOLS,DEV,INFRA,QA}/.gitkeep`, `content/{_raw/{quarantine,inbox,processed},_indexes,_outputs,_graveyard,templates}/.gitkeep`, `content/templates/note.md` holding the frontmatter skeleton from spec §4.2 with empty values, and four invented example notes — one per `type` — with at least one wikilink between two of them so a fresh install has a non-empty graph. No founder, client, or repository name appears anywhere.

- [ ] **Step 2: Write the failing `init` tests**

```typescript
it("installs the template into a vault it creates", async () => {
  const result = await runInit(contextWithNoVault, { dryRun: false, assumeYes: true });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.created.some((p) => p.endsWith("content/templates/note.md"))).toBe(true);
});

it("leaves an existing vault untouched", async () => {
  const result = await runInit(contextWithExistingVault, { dryRun: false, assumeYes: true });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.created.filter((p) => p.includes("/content/"))).toEqual([]);
});

it("rolls the template back when post-install verification fails", async () => {
  const context = contextWithNoVault({ failVerification: true });
  const result = await runInit(context, { dryRun: false, assumeYes: true });
  expect(result.ok).toBe(false);
  await expect(stat(join(context.paths.brain, "content/templates/note.md"))).rejects.toThrow();
});
```

`contextWithNoVault(overrides)` and `contextWithExistingVault(overrides)` extend the existing `init.test.ts` context builders — do not write new ones. The second seeds the Brain path with a directory and one unrelated file before `runInit`, which is what makes "leaves an existing vault untouched" a real assertion rather than a tautology.

- [ ] **Step 3: Implement**

In `init.ts`'s `buildPlan`, when — and only when — the Brain did not already exist, append the template files to `plan.brainFiles`. They are already validated as a second ownership universe and already covered by `init`'s revert, so no new transaction or ownership code is needed. Confirm that by reading `docs/architecture/foundation.md` §4 before changing anything.

- [ ] **Step 4: Write the end-to-end suite**

`tests/e2e/brain.test.ts`, against the compiled binary under a temporary HOME, following the shape of `tests/e2e/foundation.test.ts`:

```text
init creates a vault carrying the template
brain status reports the template's notes
brain reindex writes exactly four artifacts
brain reindex --dry-run writes nothing
brain lint exits 0 on the freshly installed template
brain lint exits 1 after a note is corrupted by hand
brain lint reports index-drift after an artifact is edited by hand
brain search returns a match whose path exists on disk
brain search for an absent term exits 0 and reports no candidates
developer-os search is identical to brain search
brain reindex is idempotent: a second run leaves the four artifacts byte-identical
uninstall preserves every vault artifact
```

The last two are the ones worth the most: idempotence is the gate restated at process level, and the `uninstall` case pins that Brain artifacts are refused by location regardless of what the manifest records.

- [ ] **Step 5: Run every gate**

Run: `npm run check` then `pnpm test:e2e`
Expected: PASS. Report failures only.

- [ ] **Step 6: Close the bookkeeping**

In `BACKLOG.md` §3, mark DOS-P2 implemented and delete the per-task "Remaining" list; in §5, mark `packages/brain/`, `templates/brain/`, `tests/contracts/brain/`, `tests/fixtures/brain/`, and `tests/integration/brain/` created. In `ORDER.md`, set A6's status to `done`, remove its row, and move `NOW` to A7.

Then check three things off before deleting this file, because deleting it is what makes them unrecoverable:

- **`BACKLOG.md` §3 already carries the five facts that must outlive this plan** — the quadratic-`yaml` byte bound, the invented-frontmatter caveat, the `BrainConfigV1` placement, the never-refresh-the-fixture rule, and the YAML 1.2 core-schema requirement. Confirm each is still accurate as shipped and correct it there rather than restating it somewhere new. The fifth one's durable homes are **not** §3, which collapses when this subsystem closes: it lives in design spec §4.4 and at the import site in `packages/brain/src/schema/note.ts`. Verify both are still there before deleting anything.
- **`BACKLOG.md` §1 NEW-1 must be closed by this subsystem**: `packages/brain` is not in the network-capability scan's package list in `tests/e2e/foundation.test.ts`, which makes brain-engine spec §16's "no network" clause an unchecked assertion. Add the package to that list here if no earlier task did, and delete the NEW-1 entry.
- **`BACKLOG.md` §1 NEW-4 must be settled or explicitly deferred**: whether the parser
  contract forbids resolving application tags. NEW-2 and NEW-3, which this step used to
  backstop, both closed on 2026-08-09; NEW-4 is what they left behind.
- **`BACKLOG.md` §8's "Still owed" table has exactly two rows, and this plan owns both** — the `brain` CLI command group (Task 9) and `init` installing the template (Task 10). Move each to the Discharged table as it lands. Task 9 has no bookkeeping step of its own, so if it closes before this one, discharge its row there rather than leaving it for here.

Per `SESSION.md`, delete this plan file in the same commit that closes its last step, carrying anything else a later task still needs into `docs/architecture/`.

- [ ] **Step 7: Commit**

```bash
git add templates/brain/ apps/cli/src/commands/init.ts apps/cli/src/commands/init.test.ts \
  tests/e2e/brain.test.ts tests/e2e/foundation.test.ts \
  docs/superpowers/BACKLOG.md docs/superpowers/ORDER.md \
  docs/superpowers/specs/2026-07-21-developer-os-brain-engine-design.md
git rm docs/superpowers/plans/2026-07-21-developer-os-brain-engine.md
git commit -m "feat: ship a Brain a new install can use on day one"
```

---

## Self-review against the spec

| Spec section | Task |
|---|---|
| §1 scope, §16 non-goals | 8 (capture type only), enforced by 8 Step 4 and 9 |
| §2 package boundaries | 1, and the `BrainConfigV1` placement note above |
| §3 configuration | 1 |
| §4 note contract | 2 |
| §5 folder policy | 3 |
| §6.1–6.2 determinism | 4 |
| §6.3 canonical-form drift | 6 |
| §6.4 graph | 4 |
| §7 lint | 6 |
| §8 retrieval | 7 |
| §9 migration and adoption | 8 |
| §10 template | 10 |
| §11 CLI | 9 |
| §12 produced interfaces | 1, 2, 4, 6, 7, 8 |
| §13 testing | every task, plus 10 for e2e |
| §14 gate | 10 Step 5 |
| §15 deviations | 1 (config), 9 (CLI), 10 (init), File Structure note (`discovery/`) |

Rows naming Tasks 1 and 2 are satisfied and closed; the spec section is where to check them, not this plan.

**The one thing a reviewer should check first**, because it is where the remaining plan is most likely to be wrong: that `canonicalizeArtifact` replaces exactly one occurrence per artifact rather than every occurrence of a string a note body could also contain (Task 6 Step 3). The Task 1 half of this warning — that `serializeConfig` emits a byte-identical file for a config with no `[brain]` section — was checked when Task 1 shipped and is pinned by a round-trip test in `packages/core/src/config/config.test.ts`.
