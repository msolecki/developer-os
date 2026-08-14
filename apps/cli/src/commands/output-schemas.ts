import { join } from "node:path";

/**
 * The JSON Schema files `init` installs, embedded rather than read from disk.
 *
 * The reviewable copies are `templates/schemas/` at the repository root, and
 * `output-schemas.test.ts` fails if the two ever differ. Embedding is what
 * makes a shipped binary self-contained: `templates/` sits outside
 * `apps/cli`, so a published package would not carry it — the same argument
 * `brain-template.ts` makes for the vault skeleton, and the same failure if
 * it is ignored. Here the failure is sharper than a missing skeleton:
 * `codex-adapter.md` §11.13 records that **nothing writes the file
 * `outputSchemaPath` points at**. `invokeCodex` only screens the path and
 * forwards it into argv, so pointing the vendor CLI at a missing schema
 * produces the CLI's own non-zero exit and is diagnosed as the wrong failure
 * entirely.
 *
 * Which verbs need one is derived from `EFFECT_VOCABULARY`, never listed
 * twice: `structuredResultVerbs()` is the set, and the test above pins this
 * array against it.
 *
 * Regenerate with the script recorded in the commit that introduced this
 * file; never hand-edit one side alone.
 */
export interface OutputSchemaFile {
  /**
   * The verb, dotted name intact. The filename *is* the verb: whoever wires
   * an invocation has a verb and needs a path, and a normalization step
   * between the two is a place for the two halves to disagree.
   */
  readonly verb: string;
  readonly content: string;
}

export const OUTPUT_SCHEMAS: readonly OutputSchemaFile[] = [
  {
    verb: "ingest.stage",
    content: "{\n  \"$schema\": \"https://json-schema.org/draft/2020-12/schema\",\n  \"title\": \"IngestProposal\",\n  \"description\": \"What an ingest agent returns for one accepted capture: the notes it proposes, and nothing else. Developer OS writes staging; this proposal is read as data and validated before a byte of it reaches the vault.\",\n  \"type\": \"object\",\n  \"additionalProperties\": false,\n  \"required\": [\"schemaVersion\", \"notes\"],\n  \"properties\": {\n    \"schemaVersion\": {\n      \"const\": 1,\n      \"description\": \"Always 1. A different value is refused rather than migrated.\"\n    },\n    \"notes\": {\n      \"type\": \"array\",\n      \"maxItems\": 32,\n      \"description\": \"Zero or more proposed notes. An empty array is a legitimate answer: it means this capture is not worth a note.\",\n      \"items\": {\n        \"type\": \"object\",\n        \"additionalProperties\": false,\n        \"required\": [\"path\", \"contents\", \"sourceCaptureId\"],\n        \"properties\": {\n          \"path\": {\n            \"type\": \"string\",\n            \"minLength\": 1,\n            \"maxLength\": 512,\n            \"pattern\": \"^[^/\\\\\\\\][^\\\\\\\\]*\\\\.md$\",\n            \"description\": \"Where the note goes, relative to the vault's content root, with forward slashes and a .md extension. Never absolute, never containing a . or .. segment, never naming a private folder or the generated indexes directory.\"\n          },\n          \"contents\": {\n            \"type\": \"string\",\n            \"minLength\": 1,\n            \"maxLength\": 65536,\n            \"description\": \"The whole note: a YAML frontmatter block delimited by --- lines, then the body.\"\n          },\n          \"sourceCaptureId\": {\n            \"type\": \"string\",\n            \"minLength\": 1,\n            \"maxLength\": 64,\n            \"pattern\": \"^[0-9a-f]{16}$\",\n            \"description\": \"The captureId of the capture this note was derived from. A note that does not name its capture is refused.\"\n          }\n        }\n      }\n    }\n  }\n}\n",
  },
];

/** Relative to the product home, which `init` owns as a single root. */
export const OUTPUT_SCHEMA_DIRECTORY = "schemas";

export function outputSchemaFileName(verb: string): string {
  return `${verb}.schema.json`;
}

/**
 * Where `init` installs the file, and therefore the only value
 * `--output-schema` may be pointed at.
 *
 * One function rather than two `join` calls, because `init` writing the file
 * and `ingest` naming it are the two halves that must not drift: a schema
 * installed at one path and read from another is the missing-file failure
 * above, arrived at from the other direction.
 */
export function outputSchemaPath(productHome: string, verb: string): string {
  return join(productHome, OUTPUT_SCHEMA_DIRECTORY, outputSchemaFileName(verb));
}

