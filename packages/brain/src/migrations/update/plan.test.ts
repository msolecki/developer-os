import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseSchemaMigrationId,
  parseVaultRelativePathText,
  type BrainConfigV1,
  type SchemaMigrationProviderV1,
  type UpdatePlannerRequestV1,
} from "@developer-os/core";

import { PRIVATE_FOLDERS } from "../../discovery/discover.js";
import {
  BRAIN_MIGRATION_PRIVATE_FOLDERS,
  BRAIN_UPDATE_MIGRATIONS,
  brainMigrationSubjects,
  isBrainMigrationPath,
  planBrainSchemaMigrations,
} from "./plan.js";

const encoder = new TextEncoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);
const sha = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");
const v = parsePositiveUInt32;

const config: BrainConfigV1 = {
  schemaVersion: 1,
  contentRoot: "content",
  topicFolders: ["DEV", "PROJECTS"],
  topicAliases: { PROJEKTY: "PROJECTS" },
  indexesDir: "_indexes",
  retrieval: { maxCandidates: 20 },
  staleness: { reviewAfterDays: 90 },
};

const noteA = bytes("# A\n\nsynthetic note\n");
const noteB = bytes("# B\n\nsynthetic note\n");
const rawNote = bytes("# Raw capture\n");

function snapshot(brain: BrainConfigV1 | null, paths: readonly string[], contents: readonly Uint8Array[]): Pick<UpdatePlannerRequestV1, "config" | "brain"> {
  const entries = paths.map((path, ordinal) => {
    const content = contents[ordinal] as Uint8Array;
    const hash = parseLowerHexSha256(sha(content));
    return { path: parseVaultRelativePathText(path), mode: 384 as const, bytes: content.byteLength, sha256: hash, blob: { stream: "input" as const, ordinal, bytes: content.byteLength, sha256: hash } };
  });
  return {
    config: { schemaVersion: 1, brainRoot: "brain_root", adapters: { claude: false, codex: false }, git: { enabled: false }, automation: { enabled: false }, brain, redactionPatternsCount: 0, telemetry: false },
    brain: { schemaVersion: 1, root: "brain_root", folderPolicyVersion: v(1), entries, aggregateBytes: contents.reduce((total, content) => total + content.byteLength, 0) },
  };
}

const paths = ["content/DEV/a.md", "content/PROJEKTY/b.md", "content/DEV/_raw/c.md"];
const contents = [noteA, noteB, rawNote];

function step(from: number, to: number, plan: SchemaMigrationProviderV1["plan"]): SchemaMigrationProviderV1 {
  return { id: parseSchemaMigrationId(`migration_notes-v${String(to)}`), domain: "brain", fromVersion: v(from), toVersion: v(to), plan };
}

const appendLine: SchemaMigrationProviderV1["plan"] = (subjects) =>
  subjects.map((subject) => ({ path: subject.path, content: new Uint8Array([...subject.content, ...bytes("migrated\n")]) }));

describe("isBrainMigrationPath", () => {
  it.each([
    ["content/DEV/a.md", true],
    ["content/DEV/nested/deeper/a.md", true],
    ["content/PROJEKTY/b.md", true],
    ["content/PROJECTS/b.md", true],
    ["content/UNCLASSIFIED/a.md", false],
    ["content/a.md", false],
    ["other/DEV/a.md", false],
    ["content/DEV/a.txt", false],
    ["content/DEV/.obsidian/a.md", false],
    ["content/DEV/.hidden.md", false],
    ["content/DEV/_indexes/a.md", false],
    ["content/DEV/_raw/a.md", false],
    ["content/DEV/_outputs/a.md", false],
    ["content/DEV/_graveyard/a.md", false],
    ["content/DEV/templates/a.md", false],
    ["_indexes/catalog.md", false],
  ])("%s → %s", (path, admitted) => {
    expect(isBrainMigrationPath(path, config)).toBe(admitted);
  });

  it("keeps the private-folder list equal to discovery's", () => {
    expect(BRAIN_MIGRATION_PRIVATE_FOLDERS).toEqual(PRIVATE_FOLDERS);
    expect(Object.isFrozen(BRAIN_MIGRATION_PRIVATE_FOLDERS)).toBe(true);
  });
});

describe("brainMigrationSubjects", () => {
  it("admits only deny-by-default snapshot members, with their input bytes", () => {
    expect(brainMigrationSubjects(snapshot(config, paths, contents), contents)).toEqual([
      { path: { domain: "brain", path: "content/DEV/a.md" }, content: noteA },
      { path: { domain: "brain", path: "content/PROJEKTY/b.md" }, content: noteB },
    ]);
  });

  it("offers nothing when no Brain is configured", () => {
    expect(brainMigrationSubjects(snapshot(null, paths, contents), contents)).toEqual([]);
  });

  it("refuses an entry whose input blob is absent or has another length", () => {
    expect(() => brainMigrationSubjects(snapshot(config, paths, contents), [noteA])).toThrow(/input blob/);
    expect(() => brainMigrationSubjects(snapshot(config, paths, contents), [noteA, noteA.slice(1), rawNote])).toThrow(/input blob/);
  });
});

describe("planBrainSchemaMigrations", () => {
  it("ships an empty frozen registry", () => {
    expect(BRAIN_UPDATE_MIGRATIONS).toEqual([]);
    expect(Object.isFrozen(BRAIN_UPDATE_MIGRATIONS)).toBe(true);
  });

  it("plans nothing when the Brain is already at the target version", () => {
    expect(planBrainSchemaMigrations({ request: snapshot(config, paths, contents), inputBlobs: contents, targetVersion: v(1), firstOutputOrdinal: 0 })).toEqual({ drafts: [], outputBlobs: [] });
  });

  it("refuses a target that needs a step the empty registry lacks", () => {
    expect(() => planBrainSchemaMigrations({ request: snapshot(config, paths, contents), inputBlobs: contents, targetVersion: v(2), firstOutputOrdinal: 0 })).toThrow(/incompatible/);
  });

  it("plans a single step over policy members only, continuing the shared output ordinals", () => {
    const planned = planBrainSchemaMigrations({ request: snapshot(config, paths, contents), inputBlobs: contents, targetVersion: v(2), firstOutputOrdinal: 3, providers: [step(1, 2, appendLine)] });
    expect(planned.drafts).toHaveLength(1);
    const draft = planned.drafts[0];
    expect(draft?.mutations.map((mutation) => mutation.path)).toEqual([
      { domain: "brain", path: "content/DEV/a.md" },
      { domain: "brain", path: "content/PROJEKTY/b.md" },
    ]);
    expect(draft?.mutations.map((mutation) => [mutation.afterBlob.ordinal, mutation.inverseBlob.ordinal])).toEqual([[3, 4], [5, 6]]);
    expect(planned.outputBlobs[1]).toEqual(noteA);
    expect(planned.outputBlobs[3]).toEqual(noteB);
  });

  it("chains multiple steps, each from its predecessor's after bytes", () => {
    const planned = planBrainSchemaMigrations({ request: snapshot(config, paths, contents), inputBlobs: contents, targetVersion: v(3), firstOutputOrdinal: 0, providers: [step(1, 2, appendLine), step(2, 3, appendLine)] });
    expect(planned.drafts.map((draft) => [draft.fromVersion, draft.toVersion])).toEqual([[1, 2], [2, 3]]);
    const firstAfter = planned.outputBlobs[0] as Uint8Array;
    expect(planned.drafts[1]?.mutations[0]?.beforeHash).toBe(sha(firstAfter));
  });

  it("refuses a provider that writes outside the admitted snapshot", () => {
    const escape: SchemaMigrationProviderV1["plan"] = () => [{ path: { domain: "brain", path: parseVaultRelativePathText("content/DEV/_raw/c.md") }, content: bytes("leak\n") }];
    expect(() => planBrainSchemaMigrations({ request: snapshot(config, paths, contents), inputBlobs: contents, targetVersion: v(2), firstOutputOrdinal: 0, providers: [step(1, 2, escape)] })).toThrow(/not a current brain subject/);
  });

  it("plans nothing for an unconfigured Brain", () => {
    expect(planBrainSchemaMigrations({ request: snapshot(null, paths, contents), inputBlobs: contents, targetVersion: v(2), firstOutputOrdinal: 0 })).toEqual({ drafts: [], outputBlobs: [] });
  });

  it("never emits a root, a private note, or a raw capture's bytes", () => {
    const planned = planBrainSchemaMigrations({ request: snapshot(config, paths, contents), inputBlobs: contents, targetVersion: v(2), firstOutputOrdinal: 0, providers: [step(1, 2, appendLine)] });
    expect(JSON.stringify(planned.drafts)).not.toMatch(/^\/|"\/|_raw/);
    expect(planned.outputBlobs).not.toContainEqual(rawNote);
  });
});
