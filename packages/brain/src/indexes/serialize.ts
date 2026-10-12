import type {
  GraphDocumentV1,
  IndexDocumentV1,
  IndexedNote,
  IndexManifestNote,
  IndexManifestV1,
  TermsDocumentV1,
} from "./build.js";

/**
 * Two-space indent, LF endings, exactly one trailing newline — Brain architecture former §6.1(5).
 *
 * No custom stringifier, and that is a decision rather than an omission.
 * `JSON.stringify` emits object keys in insertion order, and every object in
 * both documents is built from a literal with a fixed key order, so insertion
 * order *is* declaration order. The one field that would have broken it is
 * `terms`, which `build.ts` makes a sorted array of `{ term, count }` for
 * exactly this reason: as a `Record` its key order would have been whatever the
 * tokenizer happened to encounter first.
 *
 * A key-sorting stringifier would also be worse, not better — it would silently
 * repair a genuine ordering bug in the builder instead of letting the
 * reversed-reader gate catch it.
 */
function serializeDocument(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** `index.json`: the document without the per-note term tables (D102, AUD-026). */
export function serializeIndex(document: IndexDocumentV1): string {
  const manifest: IndexManifestV1 = {
    ...document,
    notes: document.notes.map((note) => {
      const manifest: { -readonly [K in keyof IndexedNote]?: IndexedNote[K] } = { ...note };
      delete manifest.terms;
      return manifest as IndexManifestNote;
    }),
  };
  return serializeDocument(manifest);
}

/** `terms.json`: the term tables `serializeIndex` leaves out, for search alone. */
export function serializeTerms(document: IndexDocumentV1): string {
  const terms: TermsDocumentV1 = {
    schemaVersion: 1,
    generatedAt: document.generatedAt,
    notes: document.notes.map((note) => ({ path: note.path, terms: note.terms })),
  };
  return serializeDocument(terms);
}

export function serializeGraph(document: GraphDocumentV1): string {
  return serializeDocument(document);
}
