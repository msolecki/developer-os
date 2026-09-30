import type { IndexedNote } from "../indexes/index.js";
import type { LintFinding } from "../lint/index.js";

/** An indexed note with every field defaulted; `path` is vault-relative (`content/...`). */
export function note(path: string, overrides: Partial<IndexedNote> = {}): IndexedNote {
  const base = path.split("/").pop()?.replace(/\.md$/u, "") ?? path;
  return {
    path,
    title: base.charAt(0).toUpperCase() + base.slice(1),
    type: "knowledge-note",
    topicFolder: path.split("/")[1] ?? "DEV",
    tags: [],
    aliases: [],
    summary: `Summary of ${base}.`,
    stage: "emerging",
    author: "agent",
    reviewed: null,
    occurrences: 1,
    created: "2026-01-01",
    updated: null,
    sources: [],
    contentHash: "0".repeat(64),
    terms: [],
    ...overrides,
  };
}

/** The `gap` finding `lint.ts` emits for `tag`, with its message verbatim. */
export function gap(tag: string, count = 4, path = "content/DEV/a.md"): LintFinding {
  return {
    class: "gap",
    severity: "info",
    path,
    key: "tags",
    message: `${String(count)} notes share the tag ${tag} and no compiled note covers it`,
    line: null,
  };
}

export function isolated(path: string): LintFinding {
  return {
    class: "isolated",
    severity: "info",
    path,
    key: null,
    message: "no link to or from this note",
    line: null,
  };
}
