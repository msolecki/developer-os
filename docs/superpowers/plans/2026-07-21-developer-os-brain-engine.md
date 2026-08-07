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
- **One dependency is approved and no other is.** `yaml@2.8.1`, settled 2026-08-04 (Task 2, Step 1). Any *further* dependency needs the founder's approval before `pnpm add` runs.
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

Three helpers are used by more than one task. Each is created by the task that first needs it and imported unchanged afterwards — do not write a second copy.

| Helper | Created in | Signature |
|---|---|---|
| `fixtureRequest(now: string): IndexBuildRequest` | Task 4, `packages/brain/src/indexes/testing.ts` | builds a request over `tests/fixtures/brain/legacy-shape/` with `node:fs/promises`, a `DirectoryReader` wrapping `readdir(path, { withFileTypes: true })`, `assertReadable` a no-op, and `now: () => now` |
| `reversedFixtureRequest(now: string): IndexBuildRequest` | Task 4, same file | identical, except the reader reverses every result array |
| `writtenArtifacts(build: IndexBuildResult): Record<string, string>` | Task 6, `packages/brain/src/lint/testing.ts` | serializes and renders a build into the four vault-relative artifact paths, exactly as `BrainService.reindex` will |
| `lintRequestFor(files: Record<string, string>, now: string): LintRequest` | Task 6, same file | a `LintRequest` reading artifacts from that in-memory map instead of disk |
| `indexFixture(): IndexDocumentV1` | Task 7, `packages/brain/src/retrieval/testing.ts` | `(await buildIndex(fixtureRequest(FROZEN))).index`, memoized |

**One placement decision differs from spec §2.** `BrainConfigV1`'s *type and zod schema* live in `packages/core/src/config/types.ts`, not in `packages/brain/src/schema/`. `DeveloperOsConfigV1` must reference the type, and `core` importing from `brain` while `brain` imports from `core` is a cycle. `packages/core` owns configuration per `docs/architecture/foundation.md` §1; `packages/brain` owns the defaults and resolution and re-exports the type. Recorded here rather than silently done.

---

### Task 1: Package scaffold and the optional `[brain]` config section

**Files:**
- Create: `packages/brain/package.json`, `packages/brain/tsconfig.json`, `packages/brain/vitest.config.ts`, `packages/brain/src/index.ts`
- Create: `packages/brain/src/schema/config.ts`, `packages/brain/src/schema/config.test.ts`
- Modify: `packages/core/src/config/types.ts`, `packages/core/src/config/loader.ts`, `packages/core/src/config/index.ts`, `packages/core/src/config/config.test.ts`
- Modify: `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`

**Interfaces:**
- Consumes: `DeveloperOsConfigV1`, `loadConfig`, `serializeConfig` from `@developer-os/core`.
- Produces: `BrainConfigV1` (from `@developer-os/core`), and `DEFAULT_BRAIN_CONFIG`, `resolveBrainConfig(config: DeveloperOsConfigV1): BrainConfigV1` from `@developer-os/brain`.

- [x] **Step 1: Write the failing test for backward-compatible config loading**

Append to `packages/core/src/config/config.test.ts`:

```typescript
const CONFIG_WITHOUT_BRAIN = [
  'schemaVersion = 1',
  'brainPath = "/Users/example/DeveloperBrain"',
  'telemetry = false',
  '[adapters]',
  'claude = true',
  'codex = false',
  '[git]',
  'enabled = false',
  '[automation]',
  'enabled = false',
].join("\n");

describe("brain configuration section", () => {
  it("loads a configuration written before the section existed", () => {
    const config = loadConfig(CONFIG_WITHOUT_BRAIN);
    expect(config.brain).toBeUndefined();
  });

  it("loads an explicit section", () => {
    const config = loadConfig(
      [
        CONFIG_WITHOUT_BRAIN,
        '[brain]',
        'schemaVersion = 1',
        'contentRoot = "content"',
        'topicFolders = ["DEV"]',
        'indexesDir = "_indexes"',
        '[brain.topicAliases]',
        'PROJEKTY = "PROJECTS"',
        '[brain.retrieval]',
        'maxCandidates = 25',
        '[brain.staleness]',
        'reviewAfterDays = 90',
      ].join("\n"),
    );

    expect(config.brain?.topicAliases).toEqual({ PROJEKTY: "PROJECTS" });
    expect(config.brain?.retrieval.maxCandidates).toBe(25);
  });

  it("refuses a topic folder that is a path rather than a segment", () => {
    expect(() =>
      loadConfig(
        [
          CONFIG_WITHOUT_BRAIN,
          '[brain]',
          'schemaVersion = 1',
          'contentRoot = "content"',
          'topicFolders = ["../escape"]',
          'indexesDir = "_indexes"',
          '[brain.topicAliases]',
          '[brain.retrieval]',
          'maxCandidates = 10',
          '[brain.staleness]',
          'reviewAfterDays = 180',
        ].join("\n"),
      ),
    ).toThrow();
  });

  it("round-trips a configuration that has no brain section", () => {
    expect(serializeConfig(loadConfig(CONFIG_WITHOUT_BRAIN))).toBe(
      serializeConfig(loadConfig(CONFIG_WITHOUT_BRAIN)),
    );
    expect(serializeConfig(loadConfig(CONFIG_WITHOUT_BRAIN))).not.toContain("brain]");
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/core/src/config/config.test.ts`
Expected: FAIL. The first case fails because `.strict()` rejects nothing yet but `config.brain` is not a declared property, so TypeScript errors first with "Property 'brain' does not exist on type 'DeveloperOsConfigV1'".

- [x] **Step 3: Add the type**

In `packages/core/src/config/types.ts`, above `DeveloperOsConfigV1`:

```typescript
export interface BrainConfigV1 {
  readonly schemaVersion: 1;
  readonly contentRoot: string;
  readonly topicFolders: readonly string[];
  readonly topicAliases: Readonly<Record<string, string>>;
  readonly indexesDir: string;
  readonly retrieval: { readonly maxCandidates: number };
  readonly staleness: { readonly reviewAfterDays: number };
}
```

and add one member to `DeveloperOsConfigV1`, after `automation`:

```typescript
  readonly brain?: BrainConfigV1;
```

`exactOptionalPropertyTypes` is on, so `brain?:` means the key may be absent — never present-and-`undefined`. That distinction is what keeps `serializeConfig` from emitting an empty table.

- [x] **Step 4: Add the schema and serialization**

In `packages/core/src/config/loader.ts`, above `configSchema`:

```typescript
/**
 * A single path segment, never a path. Topic folders and the content root are
 * joined onto the vault root, so accepting `../` here would let a configuration
 * file walk out of the vault before any guard sees a path.
 */
const pathSegmentSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes("\0") &&
      !value.includes("/") &&
      !value.includes("\\") &&
      value !== "." &&
      value !== "..",
    { message: "Must be a single path segment" },
  );

const brainSchema = z
  .object({
    schemaVersion: z.literal(1),
    contentRoot: pathSegmentSchema,
    topicFolders: z.array(pathSegmentSchema).min(1),
    topicAliases: z.record(pathSegmentSchema, pathSegmentSchema),
    indexesDir: pathSegmentSchema,
    retrieval: z
      .object({ maxCandidates: z.number().int().min(1).max(1000) })
      .strict(),
    staleness: z.object({ reviewAfterDays: z.number().int().min(1) }).strict(),
  })
  .strict();
```

Add `brain: brainSchema.optional(),` to `configSchema`'s object literal, after `automation`.

In `serializeConfig`, after the `automation` key and before `telemetry`:

```typescript
    ...(validated.brain === undefined ? {} : { brain: validated.brain }),
```

The spread is conditional so a configuration without the section serializes byte-identically to what Foundation writes today.

- [x] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run packages/core/src/config/config.test.ts`
Expected: PASS, all four new cases.

- [x] **Step 6: Export the type from core**

In `packages/core/src/config/index.ts` and `packages/core/src/index.ts`, add `BrainConfigV1` to the exported type list beside `DeveloperOsConfigV1`.

- [x] **Step 7: Create the package scaffold**

`packages/brain/package.json`:

```json
{
  "name": "@developer-os/brain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "@developer-os/core": "workspace:*",
    "@developer-os/security": "workspace:*"
  }
}
```

`packages/brain/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "references": [
    { "path": "../../packages/core" },
    { "path": "../../packages/security" }
  ]
}
```

`packages/brain/vitest.config.ts`: copy `packages/security/vitest.config.ts` verbatim, changing only any package-name string it contains.

Register the package in three places: add `- packages/brain` to `pnpm-workspace.yaml` under `packages:`; add `{ "path": "./packages/brain" }` to the root `tsconfig.json` `references` array **after** `./packages/security` and before `./apps/cli`, because references are built in order and the CLI will depend on it; add `"packages/brain/vitest.config.ts"` to the `projects` array in the root `vitest.config.ts`.

- [x] **Step 8: Write the failing test for config resolution**

`packages/brain/src/schema/config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { DEFAULT_BRAIN_CONFIG, resolveBrainConfig } from "./config.js";

const BASE = {
  schemaVersion: 1,
  brainPath: "/Users/example/DeveloperBrain",
  adapters: { claude: false, codex: false },
  git: { enabled: false },
  automation: { enabled: false },
  telemetry: false,
} as const;

describe("resolveBrainConfig", () => {
  it("falls back to the documented defaults", () => {
    expect(resolveBrainConfig(BASE)).toEqual(DEFAULT_BRAIN_CONFIG);
  });

  it("uses an explicit section unchanged", () => {
    const brain = { ...DEFAULT_BRAIN_CONFIG, topicFolders: ["DEV"] };
    expect(resolveBrainConfig({ ...BASE, brain })).toEqual(brain);
  });

  it("defaults to the five documented topic folders", () => {
    expect(DEFAULT_BRAIN_CONFIG.topicFolders).toEqual([
      "PROJECTS",
      "TOOLS",
      "DEV",
      "INFRA",
      "QA",
    ]);
  });
});
```

- [x] **Step 9: Run it and confirm it fails**

Run: `npx vitest run packages/brain`
Expected: FAIL, "Cannot find module './config.js'".

- [x] **Step 10: Implement**

`packages/brain/src/schema/config.ts`:

```typescript
import type { BrainConfigV1, DeveloperOsConfigV1 } from "@developer-os/core";

export const DEFAULT_BRAIN_CONFIG: BrainConfigV1 = {
  schemaVersion: 1,
  contentRoot: "content",
  topicFolders: ["PROJECTS", "TOOLS", "DEV", "INFRA", "QA"],
  topicAliases: {},
  indexesDir: "_indexes",
  retrieval: { maxCandidates: 10 },
  staleness: { reviewAfterDays: 180 },
};

export function resolveBrainConfig(config: DeveloperOsConfigV1): BrainConfigV1 {
  return config.brain ?? DEFAULT_BRAIN_CONFIG;
}
```

`packages/brain/src/index.ts`:

```typescript
export { DEFAULT_BRAIN_CONFIG, resolveBrainConfig } from "./schema/config.js";
export type { BrainConfigV1 } from "@developer-os/core";
```

- [x] **Step 11: Run the gates**

Run: `npm run check`
Expected: PASS. If `tsc -b` reports the new package is not referenced, the root `tsconfig.json` edit in Step 7 was missed.

- [x] **Step 12: Commit**

```bash
git add packages/brain/package.json packages/brain/tsconfig.json \
  packages/brain/vitest.config.ts packages/brain/src/index.ts \
  packages/brain/src/schema/config.ts packages/brain/src/schema/config.test.ts \
  packages/core/src/config/types.ts packages/core/src/config/loader.ts \
  packages/core/src/config/index.ts packages/core/src/config/config.test.ts \
  packages/core/src/index.ts pnpm-workspace.yaml tsconfig.json vitest.config.ts
git commit -m "feat: give the Brain a package and an optional config section"
```

---

### Task 2: Note schema — parse, reserved vocabulary, byte-identical rewrite

**Files:**
- Create: `packages/brain/src/schema/note.ts`, `packages/brain/src/schema/note.test.ts`
- Modify: `packages/brain/src/index.ts`, `packages/brain/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `NoteType`, `NoteStage`, `NoteAuthor`, `NoteFrontmatterV1`, `NoteParseIssue`, `ParsedNote`, `NoteParseResult`, `RESERVED_KEYS`, `parseNote(source: string): NoteParseResult`, `renderNote(note: ParsedNote): string`.

- [ ] **Step 1: Confirm the approved dependency**

**Settled on 2026-08-04: the founder approved the `yaml` package.** No further approval is needed for this task; do not re-ask.

Pin `yaml@2.8.1` exactly, as `smol-toml` and `zod` are pinned. It is used for reading only — `renderNote` never re-serializes through it (Step 5), so its output formatting is not part of any contract this repository has to keep.

Two properties the rest of this task depends on. It defaults to the **YAML 1.2 core schema**, so a tag spelled `no` parses as the string `"no"` rather than `false` — under a YAML 1.1 parser that would silently corrupt a user's tag list. And it throws `YAMLParseError` on malformed input rather than returning a partial object, which is why Step 5's `catch` can map any failure to a single `malformed` issue.

- [ ] **Step 2: Write the failing tests**

`packages/brain/src/schema/note.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { parseNote, renderNote } from "./note.js";

const VALID = [
  "---",
  "schemaVersion: 1",
  "title: Widget cache invalidation",
  "type: knowledge-note",
  "created: 2026-08-04",
  "tags: [dev, caching]",
  "summary: Invalidate on write, not on read.",
  "stage: emerging",
  "author: agent",
  "reviewed: null",
  "---",
  "",
  "Body text with a [[DEV/other]] link.",
  "",
].join("\n");

describe("parseNote", () => {
  it("accepts a note carrying every required key", () => {
    const result = parseNote(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.frontmatter.title).toBe("Widget cache invalidation");
    expect(result.note.frontmatter.reviewed).toBeNull();
    expect(result.note.frontmatter.tags).toEqual(["dev", "caching"]);
  });

  it("reports a missing required key as an error naming that key", () => {
    const result = parseNote(VALID.replace("stage: emerging\n", ""));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key: "stage", code: "missing", severity: "error" }),
    );
  });

  it("distinguishes an absent reviewed key from an explicit null", () => {
    const result = parseNote(VALID.replace("reviewed: null\n", ""));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key: "reviewed", code: "missing" }),
    );
  });

  it("rejects a value outside an enum", () => {
    const result = parseNote(VALID.replace("stage: emerging", "stage: ripe"));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key: "stage", code: "enum" }),
    );
  });

  it("rejects a malformed date", () => {
    const result = parseNote(VALID.replace("created: 2026-08-04", "created: 04/08/2026"));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key: "created", code: "date" }),
    );
  });

  it("rejects a summary over 400 characters", () => {
    const long = "x".repeat(401);
    const result = parseNote(VALID.replace("Invalidate on write, not on read.", long));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key: "summary", code: "length" }),
    );
  });

  it("reports an unknown key at info and still parses", () => {
    const result = parseNote(VALID.replace("---\n\nBody", "cssclasses: [wide]\n---\n\nBody"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.unknownKeys).toEqual(["cssclasses"]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key: "cssclasses", code: "unknown-key", severity: "info" }),
    );
  });

  it("reports a file with no frontmatter as malformed", () => {
    expect(parseNote("# Just a heading\n").ok).toBe(false);
  });
});

describe("renderNote", () => {
  it("rewrites an unchanged note byte-identically", () => {
    const result = parseNote(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(renderNote(result.note)).toBe(VALID);
  });

  it("preserves unknown keys, key order, and comments byte-identically", () => {
    const source = [
      "---",
      "# a comment nobody should lose",
      "title: Widget cache invalidation",
      "cssclasses: [wide]",
      "schemaVersion: 1",
      "type: knowledge-note",
      "created: 2026-08-04",
      "tags: []",
      "summary: Short.",
      "stage: emerging",
      "author: human",
      "reviewed: 2026-08-04",
      "---",
      "",
      "Body.",
      "",
    ].join("\n");

    const result = parseNote(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(renderNote(result.note)).toBe(source);
  });
});
```

- [ ] **Step 3: Run and confirm they fail**

Run: `npx vitest run packages/brain/src/schema/note.test.ts`
Expected: FAIL, "Cannot find module './note.js'".

- [ ] **Step 4: Add the dependency**

```bash
pnpm --filter @developer-os/brain add yaml@2.8.1
```

- [ ] **Step 5: Implement**

`packages/brain/src/schema/note.ts`:

```typescript
import { parse as parseYaml } from "yaml";

export type NoteType =
  | "knowledge-note"
  | "compiled-note"
  | "project-note"
  | "reference-note";
export type NoteStage = "emerging" | "established" | "deprecated";
export type NoteAuthor = "agent" | "human";

export const NOTE_TYPES: readonly NoteType[] = [
  "knowledge-note",
  "compiled-note",
  "project-note",
  "reference-note",
];
export const NOTE_STAGES: readonly NoteStage[] = [
  "emerging",
  "established",
  "deprecated",
];
export const NOTE_AUTHORS: readonly NoteAuthor[] = ["agent", "human"];

export const RESERVED_KEYS: readonly string[] = [
  "schemaVersion",
  "title",
  "type",
  "created",
  "updated",
  "tags",
  "aliases",
  "summary",
  "stage",
  "author",
  "reviewed",
  "occurrences",
  "sources",
];

export const MAX_SUMMARY_LENGTH = 400;

export interface NoteFrontmatterV1 {
  readonly schemaVersion: 1;
  readonly title: string;
  readonly type: NoteType;
  readonly created: string;
  readonly updated?: string;
  readonly tags: readonly string[];
  readonly aliases?: readonly string[];
  readonly summary: string;
  readonly stage: NoteStage;
  readonly author: NoteAuthor;
  readonly reviewed: string | null;
  readonly occurrences?: number;
  readonly sources?: readonly string[];
}

export type NoteIssueCode =
  | "missing"
  | "type"
  | "enum"
  | "date"
  | "length"
  | "unknown-key"
  | "malformed";

export interface NoteParseIssue {
  readonly key: string | null;
  readonly code: NoteIssueCode;
  readonly message: string;
  readonly severity: "error" | "info";
}

export interface ParsedNote {
  readonly frontmatter: NoteFrontmatterV1;
  readonly unknownKeys: readonly string[];
  readonly frontmatterText: string;
  readonly body: string;
}

export type NoteParseResult =
  | { readonly ok: true; readonly note: ParsedNote; readonly issues: readonly NoteParseIssue[] }
  | { readonly ok: false; readonly issues: readonly NoteParseIssue[] };

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)([\s\S]*)$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function error(key: string | null, code: NoteIssueCode, message: string): NoteParseIssue {
  return { key, code, message, severity: "error" };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}
```

The `toISOString().startsWith` re-check is not redundant: `2026-02-30` matches the regular expression and `Date` silently rolls it over to March 2nd. Without it, an impossible date parses and every downstream ordering is wrong by a day.

Then the validator. It collects issues rather than throwing on the first one, so `brain lint` can report a whole note at once:

```typescript
function validate(raw: Record<string, unknown>): {
  readonly frontmatter: NoteFrontmatterV1 | null;
  readonly issues: readonly NoteParseIssue[];
  readonly unknownKeys: readonly string[];
} {
  const issues: NoteParseIssue[] = [];
  const unknownKeys = Object.keys(raw)
    .filter((key) => !RESERVED_KEYS.includes(key))
    .sort();

  for (const key of unknownKeys) {
    issues.push({
      key,
      code: "unknown-key",
      message: `\`${key}\` is not a Developer OS key; it is preserved and ignored`,
      severity: "info",
    });
  }

  const require = (key: string): unknown => {
    if (!Object.hasOwn(raw, key)) {
      issues.push(error(key, "missing", `\`${key}\` is required`));
      return undefined;
    }
    return raw[key];
  };

  const schemaVersion = require("schemaVersion");
  if (schemaVersion !== undefined && schemaVersion !== 1) {
    issues.push(error("schemaVersion", "type", "`schemaVersion` must be the literal 1"));
  }

  const title = require("title");
  if (title !== undefined && (typeof title !== "string" || title.length === 0)) {
    issues.push(error("title", "type", "`title` must be a non-empty string"));
  }

  const type = require("type");
  if (type !== undefined && !NOTE_TYPES.includes(type as NoteType)) {
    issues.push(error("type", "enum", `\`type\` must be one of ${NOTE_TYPES.join(", ")}`));
  }

  const created = require("created");
  if (created !== undefined && !isIsoDate(created)) {
    issues.push(error("created", "date", "`created` must be a real YYYY-MM-DD date"));
  }

  if (Object.hasOwn(raw, "updated") && !isIsoDate(raw.updated)) {
    issues.push(error("updated", "date", "`updated` must be a real YYYY-MM-DD date"));
  }

  const tags = require("tags");
  if (tags !== undefined && !isStringArray(tags)) {
    issues.push(error("tags", "type", "`tags` must be an array of strings"));
  }

  if (Object.hasOwn(raw, "aliases") && !isStringArray(raw.aliases)) {
    issues.push(error("aliases", "type", "`aliases` must be an array of strings"));
  }

  const summary = require("summary");
  if (summary !== undefined) {
    if (typeof summary !== "string") {
      issues.push(error("summary", "type", "`summary` must be a string"));
    } else if (summary.length > MAX_SUMMARY_LENGTH) {
      issues.push(
        error("summary", "length", `\`summary\` must be at most ${MAX_SUMMARY_LENGTH} characters`),
      );
    }
  }

  const stage = require("stage");
  if (stage !== undefined && !NOTE_STAGES.includes(stage as NoteStage)) {
    issues.push(error("stage", "enum", `\`stage\` must be one of ${NOTE_STAGES.join(", ")}`));
  }

  const author = require("author");
  if (author !== undefined && !NOTE_AUTHORS.includes(author as NoteAuthor)) {
    issues.push(error("author", "enum", `\`author\` must be one of ${NOTE_AUTHORS.join(", ")}`));
  }

  if (!Object.hasOwn(raw, "reviewed")) {
    issues.push(error("reviewed", "missing", "`reviewed` is required; use null when unreviewed"));
  } else if (raw.reviewed !== null && !isIsoDate(raw.reviewed)) {
    issues.push(error("reviewed", "date", "`reviewed` must be null or a real YYYY-MM-DD date"));
  }

  if (Object.hasOwn(raw, "occurrences")) {
    const value = raw.occurrences;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      issues.push(error("occurrences", "type", "`occurrences` must be an integer of at least 1"));
    }
  }

  if (Object.hasOwn(raw, "sources") && !isStringArray(raw.sources)) {
    issues.push(error("sources", "type", "`sources` must be an array of strings"));
  }

  if (issues.some((issue) => issue.severity === "error")) {
    return { frontmatter: null, issues, unknownKeys };
  }

  return {
    frontmatter: {
      schemaVersion: 1,
      title: raw.title as string,
      type: raw.type as NoteType,
      created: raw.created as string,
      ...(Object.hasOwn(raw, "updated") ? { updated: raw.updated as string } : {}),
      tags: raw.tags as string[],
      ...(Object.hasOwn(raw, "aliases") ? { aliases: raw.aliases as string[] } : {}),
      summary: raw.summary as string,
      stage: raw.stage as NoteStage,
      author: raw.author as NoteAuthor,
      reviewed: raw.reviewed as string | null,
      ...(Object.hasOwn(raw, "occurrences") ? { occurrences: raw.occurrences as number } : {}),
      ...(Object.hasOwn(raw, "sources") ? { sources: raw.sources as string[] } : {}),
    },
    issues,
    unknownKeys,
  };
}

export function parseNote(source: string): NoteParseResult {
  const match = FRONTMATTER.exec(source);
  if (match === null) {
    return { ok: false, issues: [error(null, "malformed", "the note has no frontmatter block")] };
  }

  const [, frontmatterText = "", body = ""] = match;

  let raw: unknown;
  try {
    raw = parseYaml(frontmatterText) as unknown;
  } catch {
    return { ok: false, issues: [error(null, "malformed", "the frontmatter is not valid YAML")] };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: [error(null, "malformed", "the frontmatter is not a mapping")] };
  }

  const validated = validate(raw as Record<string, unknown>);
  if (validated.frontmatter === null) return { ok: false, issues: validated.issues };

  return {
    ok: true,
    note: {
      frontmatter: validated.frontmatter,
      unknownKeys: validated.unknownKeys,
      frontmatterText,
      body,
    },
    issues: validated.issues,
  };
}

/**
 * Rebuilds the file from the retained frontmatter text. Nothing is re-serialized
 * from the parsed object, which is the only way key order, comments, quoting
 * style, and unknown keys survive a read-write cycle unchanged.
 */
export function renderNote(note: ParsedNote): string {
  return `---\n${note.frontmatterText}\n---\n${note.body}`;
}
```

- [ ] **Step 6: Run and confirm the tests pass**

Run: `npx vitest run packages/brain/src/schema/note.test.ts`
Expected: PASS, all ten cases.

- [ ] **Step 7: Export and run the gates**

Add to `packages/brain/src/index.ts`:

```typescript
export {
  MAX_SUMMARY_LENGTH,
  NOTE_AUTHORS,
  NOTE_STAGES,
  NOTE_TYPES,
  parseNote,
  renderNote,
  RESERVED_KEYS,
} from "./schema/note.js";
export type {
  NoteAuthor,
  NoteFrontmatterV1,
  NoteIssueCode,
  NoteParseIssue,
  NoteParseResult,
  NoteStage,
  NoteType,
  ParsedNote,
} from "./schema/note.js";
```

Run: `npm run check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/brain/src/schema/note.ts packages/brain/src/schema/note.test.ts \
  packages/brain/src/index.ts packages/brain/package.json pnpm-lock.yaml
git commit -m "feat: parse a note strictly without owning the user's frontmatter"
```

---

### Task 3: Discovery — deny-by-default enumeration and the committed fixture

**Files:**
- Create: `packages/brain/src/discovery/index.ts`, `packages/brain/src/discovery/discover.ts`, `packages/brain/src/discovery/discover.test.ts`
- Create: `tests/fixtures/brain/legacy-shape/` (see Step 6)
- Modify: `packages/brain/src/index.ts`

**Interfaces:**
- Consumes: `BrainConfigV1` (Task 1); `containsPath` from `@developer-os/core`.
- Produces: `DirectoryEntry`, `DirectoryReader`, `DiscoveredNote`, `DiscoveryResult`, `PRIVATE_FOLDERS`, `discoverNotes(request: DiscoveryRequest): Promise<DiscoveryResult>`, `DiscoveryRequest`.

- [ ] **Step 1: Write the failing tests**

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

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run packages/brain/src/discovery`
Expected: FAIL, "Cannot find module './discover.js'".

- [ ] **Step 3: Implement**

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

- [ ] **Step 4: Run and confirm the tests pass**

Run: `npx vitest run packages/brain/src/discovery`
Expected: PASS, all six cases.

- [ ] **Step 5: Add the barrel export**

`packages/brain/src/discovery/index.ts` re-exports every name from `./discover.js`. Add the same names to `packages/brain/src/index.ts`.

- [ ] **Step 6: Build the committed synthetic fixture**

Create `tests/fixtures/brain/legacy-shape/` with exactly this tree. Every word is invented; it encodes only the shape recorded in `docs/migration/baseline-capabilities.json` (Obsidian Markdown, a vault map, a catalog, a graph, index-first retrieval).

```text
tests/fixtures/brain/legacy-shape/
├── .obsidian/app.json                 {}
└── content/
    ├── DEV/caching.md                 knowledge-note, tags [dev, caching], links to DEV/testing
    ├── DEV/testing.md                 knowledge-note, tags [dev, testing]
    ├── PROJECTS/orchard.md            project-note, tags [project, orchard]
    ├── TOOLS/ledger-cli.md            reference-note, tags [tools]
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

- [ ] **Step 7: Run the gates**

Run: `npm run check`
Expected: PASS. The self-containment lint reads untracked files too, so a fixture accidentally naming a real path fails here rather than in review.

- [ ] **Step 8: Commit**

```bash
git add packages/brain/src/discovery/ packages/brain/src/index.ts tests/fixtures/brain/
git commit -m "feat: find notes by permission, not by absence of exclusion"
```

---

### Task 4: Index and graph construction

**Files:**
- Create: `packages/brain/src/indexes/build.ts`, `packages/brain/src/indexes/serialize.ts`, `packages/brain/src/indexes/tokenize.ts`, `packages/brain/src/indexes/index.ts`
- Create: `packages/brain/src/indexes/build.test.ts`, `packages/brain/src/indexes/serialize.test.ts`
- Modify: `packages/brain/src/index.ts`

**Interfaces:**
- Consumes: `discoverNotes`, `DirectoryReader`, `compareCanonical` (Task 3); `parseNote` (Task 2); `hashBytes` from `@developer-os/core`.
- Produces: `IndexedTerm`, `IndexedNote`, `IndexedFolder`, `IndexedTag`, `IndexDocumentV1`, `GraphNode`, `GraphEdge`, `GraphDocumentV1`, `IndexBuildResult`, `buildIndex(request: IndexBuildRequest): Promise<IndexBuildResult>`, `IndexBuildRequest`, `serializeIndex(document: IndexDocumentV1): string`, `serializeGraph(document: GraphDocumentV1): string`, `tokenize(text: string): readonly string[]`.

- [ ] **Step 1: Write the failing determinism tests**

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
      "content/TOOLS/ledger-cli.md",
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

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run packages/brain/src/indexes`
Expected: FAIL, "Cannot find module './build.js'".

- [ ] **Step 3: Implement tokenization**

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

- [ ] **Step 4: Implement the build**

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

- [ ] **Step 5: Implement canonical serialization**

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

- [ ] **Step 6: Run and confirm the tests pass**

Run: `npx vitest run packages/brain/src/indexes`
Expected: PASS. If only the reversed-reader case fails, an unsorted array reached the output — find it by diffing the two serialized strings rather than by inspection.

- [ ] **Step 7: Run the gates and commit**

Run: `npm run check`

```bash
git add packages/brain/src/indexes/ packages/brain/src/index.ts
git commit -m "feat: build an index that two machines agree on"
```

---

### Task 5: Rendered Markdown views

**Files:**
- Create: `packages/brain/src/indexes/render.ts`, `packages/brain/src/indexes/render.test.ts`
- Modify: `packages/brain/src/indexes/index.ts`, `packages/brain/src/index.ts`

**Interfaces:**
- Consumes: `IndexBuildResult`, `IndexDocumentV1` (Task 4).
- Produces: `renderVaultMap(index: IndexDocumentV1): string`, `renderCatalog(index: IndexDocumentV1): string`.

- [ ] **Step 1: Write the failing tests**

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

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run packages/brain/src/indexes/render.test.ts`
Expected: FAIL, "Cannot find module './render.js'".

- [ ] **Step 3: Implement**

Both renderers emit YAML frontmatter with `generatedAt` and nothing else time-derived, then Markdown built only from `IndexDocumentV1`. `renderVaultMap` writes a folder table (folder, notes, types, top tags), a tag line, and a "recent changes" list of at most fifteen notes ordered by `updated ?? created` descending then path ascending. `renderCatalog` writes one `##` section per folder in the index's folder order, each listing `- [title](path) — summary`.

Escape every interpolated value for Markdown table cells by replacing `|` with `\|` and collapsing any `\r?\n` to a space. A note titled `a | b` would otherwise add a phantom column and silently corrupt the table.

Both functions end their output with exactly one `\n`.

- [ ] **Step 4: Run, gate, and commit**

Run: `npx vitest run packages/brain/src/indexes` then `npm run check`

```bash
git add packages/brain/src/indexes/render.ts packages/brain/src/indexes/render.test.ts \
  packages/brain/src/indexes/index.ts packages/brain/src/index.ts
git commit -m "feat: render a map a human can read from an index a machine can trust"
```

---

### Task 6: Lint

**Files:**
- Create: `packages/brain/src/lint/lint.ts`, `packages/brain/src/lint/drift.ts`, `packages/brain/src/lint/index.ts`, `packages/brain/src/lint/lint.test.ts`
- Create: `tests/fixtures/brain/malformed/` (eight one-concern fixtures)
- Modify: `packages/brain/src/index.ts`

**Interfaces:**
- Consumes: `IndexBuildResult`, `buildIndex` (Task 4); `renderCatalog`, `renderVaultMap` (Task 5); `NoteParseIssue` (Task 2).
- Produces: `LintClass`, `LintSeverity`, `LintFinding`, `LintResult`, `lintVault(request: LintRequest): Promise<LintResult>`, `LintRequest`, `canonicalizeArtifact(text: string): string`.

- [ ] **Step 1: Write the failing tests**

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

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run packages/brain/src/lint`
Expected: FAIL, "Cannot find module './lint.js'".

- [ ] **Step 3: Implement canonical-form drift**

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

- [ ] **Step 4: Implement the six classes**

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

`lintVault` runs `buildIndex`, then evaluates each class against the build result and the four artifacts read from disk. Findings carry `{ class, severity, path, key, message }` and are returned sorted by path, then class, then message, so the output is as deterministic as the index. `LintResult` also carries `errorCount`, `warnCount`, and `infoCount`.

Case-collision detection folds each path with `toLowerCase()` and groups; any group of more than one is an `error` reported against every member. Content-hash duplicates group on `contentHash`. Title duplicates group on `title.trim().toLowerCase()` within one `topicFolder`.

- [ ] **Step 5: Run, gate, and commit**

Run: `npx vitest run packages/brain/src/lint` then `npm run check`

```bash
git add packages/brain/src/lint/ packages/brain/src/index.ts tests/fixtures/brain/malformed/
git commit -m "feat: fail a vault loudly and per path"
```

---

### Task 7: Retrieval

**Files:**
- Create: `packages/brain/src/retrieval/search.ts`, `packages/brain/src/retrieval/index.ts`, `packages/brain/src/retrieval/search.test.ts`
- Modify: `packages/brain/src/index.ts`

**Interfaces:**
- Consumes: `IndexDocumentV1`, `IndexedNote` (Task 4); `tokenize` (Task 4).
- Produces: `RetrievalQuery`, `RetrievalMatch`, `RetrievalResult`, `search(index: IndexDocumentV1, query: RetrievalQuery): RetrievalResult`, `FIELD_WEIGHTS`.

- [ ] **Step 1: Write the failing tests**

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

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run packages/brain/src/retrieval`
Expected: FAIL, "Cannot find module './search.js'".

- [ ] **Step 3: Implement**

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

- [ ] **Step 4: Run, gate, and commit**

Run: `npx vitest run packages/brain/src/retrieval` then `npm run check`

```bash
git add packages/brain/src/retrieval/ packages/brain/src/index.ts
git commit -m "feat: retrieve through the funnel and say when nothing is reachable"
```

---

### Task 8: Public surface — capture type, migrations, adoption, and the facade

**Files:**
- Create: `packages/brain/src/schema/capture.ts`, `packages/brain/src/schema/capture.test.ts`
- Create: `packages/brain/src/migrations/index.ts`, `packages/brain/src/migrations/migrations.test.ts`
- Create: `packages/brain/src/service.ts`, `packages/brain/src/service.test.ts`
- Modify: `packages/brain/src/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 through 7.
- Produces: `CaptureStatus`, `CaptureEnvelopeV1`, `CAPTURE_STATUSES`, `BrainMigration`, `BRAIN_MIGRATIONS`, `BrainStatusReportV1`, `BrainService`, `BrainServiceDependencies`, `BrainArtifacts`.

- [ ] **Step 1: Define the capture envelope as a type only**

`packages/brain/src/schema/capture.ts` declares `CaptureEnvelopeV1` with exactly the fields in design spec §13.1 and the six statuses `quarantined`, `accepted`, `rejected`, `staging`, `ingested`, `failed`. Nothing in this package constructs, transitions, or persists one — `DOS-P6` owns the lifecycle. Add a single test asserting `CAPTURE_STATUSES` has those six members in that order, so a later task cannot quietly add a seventh.

- [ ] **Step 2: Define migrations as an empty registry**

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

- [ ] **Step 3: Write the failing facade test**

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

- [ ] **Step 4: Implement the facade**

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

- [ ] **Step 5: Run, gate, and commit**

Run: `npx vitest run packages/brain` then `npm run check`

```bash
git add packages/brain/src/schema/capture.ts packages/brain/src/schema/capture.test.ts \
  packages/brain/src/migrations/ packages/brain/src/service.ts \
  packages/brain/src/service.test.ts packages/brain/src/index.ts
git commit -m "feat: put one facade in front of the Brain"
```

---

### Task 9: The `brain` command group

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

- [ ] **Step 1: Write the failing dispatch tests**

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

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run apps/cli/src/main.test.ts`
Expected: FAIL — `parse` returns `null` for more than one positional, so every new case exits 2.

- [ ] **Step 3: Widen dispatch without weakening it**

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

- [ ] **Step 4: Implement the command**

`apps/cli/src/commands/brain.ts` constructs a `BrainService` from the context, dispatches on the subcommand, and returns a version-stamped `schemaVersion: 1` result per subcommand. `reindex` stages its four files through `context.executor.execute({ kind: "brain-reindex", mutations })`, using `validateChangePlan` with the vault's index directory as the owned root and every other vault directory excluded — the same two-step shape `init` uses at `apps/cli/src/commands/init.ts:308`. `--dry-run` returns the planned paths and executes nothing.

`lint` maps `errorCount > 0` to `EXIT_CODES.operationalFailure` and otherwise `success`, carrying warnings through `CliResult.warnings`. `search` on a missing index returns `EXIT_CODES.invalidInput` with recovery text naming `developer-os brain reindex`. `--limit` parses as a positive integer, and anything else is `EXIT_CODES.invalidInput`.

Add the human renderers to `main.ts` beside the existing ones, and pass every rendered path through `renderPath` — vault paths come from a user-writable directory and reach a terminal.

Add `@developer-os/brain` to `apps/cli/package.json` dependencies and a `{ "path": "../../packages/brain" }` reference to `apps/cli/tsconfig.json`. Extend the `USAGE` block with the four subcommands and `--limit`.

- [ ] **Step 5: Run, gate, and commit**

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

In `BACKLOG.md` §3, mark the DOS-P2 plan written and implemented; in §5, mark `packages/brain/`, `templates/brain/`, `tests/contracts/brain/`, `tests/fixtures/brain/`, and `tests/integration/brain/` created. In `ORDER.md`, set A6's status to `done` and move `NOW` to A7. Per `SESSION.md`, delete this plan file in the same commit that closes its last step, carrying anything a later task still needs into `docs/architecture/`.

- [ ] **Step 7: Commit**

```bash
git add templates/brain/ apps/cli/src/commands/init.ts apps/cli/src/commands/init.test.ts \
  tests/e2e/brain.test.ts docs/superpowers/BACKLOG.md docs/superpowers/ORDER.md
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

**Two things a reviewer should check first**, because they are where this plan is most likely to be wrong: that `serializeConfig` really does emit a byte-identical file for a config with no `[brain]` section (Task 1 Step 4), and that `canonicalizeArtifact` replaces exactly one occurrence per artifact rather than every occurrence of a string a note body could also contain (Task 6 Step 3).
