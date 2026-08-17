import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_PROPOSED_NOTE_CHARS,
  MAX_PROPOSED_NOTES,
  MAX_PROPOSED_PATH_CHARS,
} from "@developer-os/brain";
import { structuredResultVerbs } from "@developer-os/workflow-schema";
import { describe, expect, it } from "vitest";

import {
  OUTPUT_SCHEMAS,
  outputSchemaFileName,
  outputSchemaPath,
} from "./output-schemas.js";

/**
 * `../../../../` holds for both `src/commands/` and the compiled
 * `dist/commands/`, which sit at the same depth below the repository root —
 * the same resolution `brain-template.test.ts` uses for `templates/brain`.
 */
const SCHEMA_ROOT = fileURLToPath(
  new URL("../../../../templates/schemas", import.meta.url),
);

describe("the embedded output schemas", () => {
  it("matches templates/schemas byte for byte", async () => {
    /**
     * The embedded copy is what ships; `templates/schemas/` is what a human
     * reads and reviews. Nothing but this test stops them diverging, and a
     * divergence is invisible — `init` would keep installing the old schema
     * while every reviewer read the new one. `brain-template.test.ts` makes
     * the same argument for the vault skeleton, for the same reason:
     * `templates/` sits outside `apps/cli` and a published package would not
     * carry it.
     */
    const onDisk = (await readdir(SCHEMA_ROOT)).sort();
    expect(onDisk.length).toBeGreaterThan(0);
    expect(OUTPUT_SCHEMAS.map((schema) => outputSchemaFileName(schema.verb)).sort()).toEqual(
      onDisk,
    );

    for (const schema of OUTPUT_SCHEMAS) {
      const text = await readFile(
        join(SCHEMA_ROOT, outputSchemaFileName(schema.verb)),
        "utf8",
      );
      expect(schema.content, schema.verb).toBe(text);
    }
  });

  it("ships exactly one schema per structured-result verb", () => {
    /**
     * The set is derived from `EFFECT_VOCABULARY`, never listed here. A verb
     * that gains `capability: structured_result` and no schema file would
     * point `--output-schema` at a path nothing wrote — which `codex-adapter.md`
     * §11.13 records as surfacing the vendor CLI's own non-zero exit, and
     * being diagnosed as the wrong failure entirely.
     */
    const verbs = structuredResultVerbs();
    expect(verbs.length).toBeGreaterThan(0);
    expect(OUTPUT_SCHEMAS.map((schema) => schema.verb)).toStrictEqual([...verbs]);
  });

  it("keeps the verb's dotted name in the filename it installs", () => {
    /**
     * `ingest.stage.schema.json`, not `ingest-stage.schema.json`. The filename
     * *is* the verb: whoever wires the invocation has a verb and needs the
     * path, and a normalization step between the two is a place for the two
     * halves to disagree.
     */
    expect(outputSchemaFileName("ingest.stage")).toBe("ingest.stage.schema.json");
    expect(outputSchemaPath("/product/home", "ingest.stage")).toBe(
      join("/product/home", "schemas", "ingest.stage.schema.json"),
    );
  });

  it("declares a dialect and a closed object, because a model fills it in", () => {
    expect(OUTPUT_SCHEMAS.length).toBeGreaterThan(0);
    for (const schema of OUTPUT_SCHEMAS) {
      const parsed = JSON.parse(schema.content) as Record<string, unknown>;
      expect(parsed["$schema"], schema.verb).toEqual(expect.any(String));
      expect(parsed["type"], schema.verb).toBe("object");
      /**
       * An open object is a schema that permits the one thing this file
       * exists to constrain — a proposal carrying a field nobody validates.
       * The parser refuses an unknown key regardless; the schema saying so
       * is what stops the model producing one in the first place.
       */
      expect(parsed["additionalProperties"], schema.verb).toBe(false);
    }
  });

  it("bounds the proposal at the same numbers the parser enforces", () => {
    /**
     * The schema is what the model is shown; `parseIngestProposal` is what
     * refuses it. Two numbers that disagree means the model is invited to
     * produce a proposal Developer OS then rejects, and the refusal reads as a
     * model failure rather than as the drift it is. Read out of the shipped
     * bytes rather than out of `templates/`, because the shipped bytes are
     * what a vendor CLI is pointed at.
     */
    const ingest = OUTPUT_SCHEMAS.find((schema) => schema.verb === "ingest.stage");
    expect(ingest).toBeDefined();
    if (ingest === undefined) return;

    const parsed = JSON.parse(ingest.content) as {
      properties: {
        notes: {
          maxItems: number;
          items: { properties: { contents: { maxLength: number }; path: { maxLength: number } } };
        };
      };
    };
    expect(parsed.properties.notes.maxItems).toBe(MAX_PROPOSED_NOTES);
    expect(parsed.properties.notes.items.properties.contents.maxLength).toBe(
      MAX_PROPOSED_NOTE_CHARS,
    );
    expect(parsed.properties.notes.items.properties.path.maxLength).toBe(
      MAX_PROPOSED_PATH_CHARS,
    );
  });

  it("names no machine, person or address", () => {
    /**
     * Same rule as the fixtures and the Brain template. The JSON Schema
     * dialect identifier is the one URL allowed, because it is the value the
     * `$schema` keyword is defined to take and nothing fetches it.
     */
    const text = OUTPUT_SCHEMAS.map((schema) => schema.content).join("\n");
    expect(text).not.toMatch(/\/Users\/|\/home\/[a-z]/u);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/u);
    for (const url of text.match(/https?:\/\/\S+/gu) ?? []) {
      expect(url).toContain("json-schema.org");
    }
  });
});
