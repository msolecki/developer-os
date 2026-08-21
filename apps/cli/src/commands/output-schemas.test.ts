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

/**
 * The three ways the 2020-12 dialect this repository declares can put a
 * subschema somewhere a naive walk will not look. Enumerated as constants so
 * the case that drives them asserts one hidden property per keyword, and so a
 * keyword added here without a case is a failing count rather than a silent
 * gap — the first version of this walk covered six of these and its own test
 * exercised exactly those six, which a fresh-context review caught on
 * 2026-08-20 by deleting the three it did not.
 */
const SUBSCHEMA_MAPS = ["$defs", "definitions", "patternProperties", "dependentSchemas"] as const;
const SUBSCHEMA_LISTS = ["allOf", "anyOf", "oneOf", "prefixItems"] as const;
const SUBSCHEMA_SINGLES = [
  "items",
  "not",
  "additionalProperties",
  "propertyNames",
  "contains",
  "if",
  "then",
  "else",
  "unevaluatedItems",
  "unevaluatedProperties",
] as const;

/**
 * Every property a JSON Schema declares, split by whether it carries a `type`
 * keyword — which the vendor requires and refuses a schema without (NEW-21,
 * 2026-08-20).
 *
 * A collector rather than a walk full of assertions, so the traversal itself can
 * be driven over a schema shape no shipped file uses yet. What it follows is the
 * three lists above plus `properties`; a tuple-form `items` is reached by the
 * array branch. It does not claim to follow every keyword any dialect has ever
 * defined — it claims to follow the ones named above, and the case that drives
 * it proves each one.
 */
function surveyTypes(
  root: unknown,
  label: string,
): { readonly checked: string[]; readonly typeless: string[] } {
  const checked: string[] = [];
  const typeless: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => { walk(entry, `${path}[${String(index)}]`); });
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    for (const [name, child] of Object.entries(record["properties"] ?? {})) {
      const where = `${path}.${name}`;
      const typed = typeof (child as Record<string, unknown>)["type"] === "string";
      (typed ? checked : typeless).push(where);
      walk(child, where);
    }
    for (const bag of SUBSCHEMA_MAPS) {
      for (const [name, child] of Object.entries(record[bag] ?? {})) {
        walk(child, `${path}.${bag}.${name}`);
      }
    }
    for (const list of SUBSCHEMA_LISTS) walk(record[list], `${path}.${list}`);
    for (const single of SUBSCHEMA_SINGLES) {
      const child = record[single];
      if (typeof child === "object" && child !== null) walk(child, `${path}.${single}`);
    }
  };
  walk(root, label);
  return { checked, typeless };
}

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

  it("gives every property a type keyword, which the vendor requires and refuses without", async () => {
    /**
     * **Observed, not inferred, and the observation is read here rather than
     * summarised.** NEW-21 ran `codex exec --output-schema` at the shipped file
     * on 2026-08-20 and the API answered HTTP 400 before the model ran.
     * `schemaVersion` was written as a bare `const`, which is valid JSON Schema
     * and is rejected here.
     *
     * The consequence was total rather than partial: **`ingest` could never
     * return a proposal on Codex**, because the request was refused before any
     * turn began. That is why this walks every property rather than asserting
     * the one field that was caught — the next property added without a type
     * breaks the whole verb the same way.
     *
     * **The recording is loaded rather than cited**, because a fixture nothing
     * reads is a claim nobody checks: a fresh-context review found that this
     * file named `observed-exec-schema-refusal.jsonl` in a comment and that
     * deleting the fixture left the suite green. Reading it ties this gate to
     * the vendor bytes that justify it, so the fixture cannot be dropped and
     * the rule cannot drift from what was actually refused.
     */
    const refusal = await readFile(
      fileURLToPath(
        new URL(
          "../../../../tests/fixtures/codex/observed-exec-schema-refusal.jsonl",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(refusal).toContain("invalid_json_schema");
    expect(refusal).toContain("('properties', 'schemaVersion')");
    expect(refusal).toContain("schema must have a 'type' key");

    for (const schema of OUTPUT_SCHEMAS) {
      const found = surveyTypes(JSON.parse(schema.content), schema.verb);
      expect(found.typeless, schema.verb).toEqual([]);
      expect(found.checked.length, schema.verb).toBeGreaterThan(0);
    }
    expect(OUTPUT_SCHEMAS.length).toBeGreaterThan(0);
  });

  it("finds a typeless property wherever a subschema can hide one", () => {
    /**
     * **The fixture and the expectation are literals, and that is the whole
     * design of this case.** An earlier version built both by iterating
     * `SUBSCHEMA_MAPS`/`LISTS`/`SINGLES` — the same constants the walk reads —
     * so deleting a keyword deleted its hiding place and its expectation
     * together and the case passed. It could not fail for the reason it exists.
     * Verified by mutation on 2026-08-20: removing any of seven keywords left
     * all eight tests green.
     *
     * Written out by hand, removing a keyword from the walk leaves a path in
     * `expected` that nothing finds, and the assertion below goes red. The
     * `keywords` check is the other direction: a keyword added to the walk
     * without a hiding place here fails on the set comparison rather than
     * quietly becoming a branch nobody has seen run.
     */
    const hidden = { type: "object", properties: { a: { const: 1 } } };
    const hostile = {
      type: "object",
      properties: { fine: { type: "string" } },
      $defs: { n: hidden },
      definitions: { n: hidden },
      patternProperties: { "^x": hidden },
      dependentSchemas: { fine: hidden },
      allOf: [hidden],
      anyOf: [hidden],
      oneOf: [hidden],
      prefixItems: [hidden],
      items: hidden,
      not: hidden,
      additionalProperties: hidden,
      propertyNames: hidden,
      contains: hidden,
      if: hidden,
      then: hidden,
      else: hidden,
      unevaluatedItems: hidden,
      unevaluatedProperties: hidden,
    };

    const found = surveyTypes(hostile, "s");
    expect(found.checked).toEqual(["s.fine"]);
    expect([...found.typeless].sort()).toEqual(
      [
        "s.$defs.n.a",
        "s.additionalProperties.a",
        "s.allOf[0].a",
        "s.anyOf[0].a",
        "s.contains.a",
        "s.definitions.n.a",
        "s.dependentSchemas.fine.a",
        "s.else.a",
        "s.if.a",
        "s.items.a",
        "s.not.a",
        "s.oneOf[0].a",
        "s.patternProperties.^x.a",
        "s.prefixItems[0].a",
        "s.propertyNames.a",
        "s.then.a",
        "s.unevaluatedItems.a",
        "s.unevaluatedProperties.a",
      ].sort(),
    );

    const keywords = [...SUBSCHEMA_MAPS, ...SUBSCHEMA_LISTS, ...SUBSCHEMA_SINGLES];
    expect([...keywords].sort()).toEqual(
      Object.keys(hostile).filter((key) => key !== "type" && key !== "properties").sort(),
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
