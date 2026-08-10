import { describe, expect, it, vi } from "vitest";

import {
  FRONTMATTER_PARSE_OPTIONS,
  parseNote,
  renderNote,
} from "./note.js";

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
    expect(result.note.frontmatter.type).toBe("knowledge-note");
    expect(result.note.frontmatter.reviewed).toBeNull();
    expect(result.note.frontmatter.tags).toStrictEqual(["dev", "caching"]);
  });

  it("reports a missing required key as an error naming that key", () => {
    const result = parseNote(VALID.replace("stage: emerging\n", ""));

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        key: "stage",
        code: "missing",
        severity: "error",
      }),
    );
  });

  /**
   * An absent `reviewed` and a deliberate "nobody has reviewed this" are
   * different facts, which is why the key is required and nullable rather than
   * optional. The provenance lint class depends on telling them apart.
   */
  it("distinguishes an absent reviewed key from an explicit null", () => {
    const absent = parseNote(VALID.replace("reviewed: null\n", ""));

    expect(absent.ok).toBe(false);
    expect(absent.issues).toContainEqual(
      expect.objectContaining({ key: "reviewed", code: "missing" }),
    );

    const explicit = parseNote(VALID);

    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.note.frontmatter.reviewed).toBeNull();
  });

  it.each([
    { key: "stage", from: "stage: emerging", to: "stage: ripe" },
    { key: "type", from: "type: knowledge-note", to: "type: memo" },
    { key: "author", from: "author: agent", to: "author: robot" },
  ])("rejects a value outside the $key enum", ({ key, from, to }) => {
    const result = parseNote(VALID.replace(from, to));

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key, code: "enum" }),
    );
  });

  it.each([
    { name: "a non-ISO ordering", value: "04/08/2026" },
    { name: "a day that does not exist", value: "2026-02-30" },
    { name: "a month that does not exist", value: "2026-13-01" },
  ])("rejects $name as a created date", ({ value }) => {
    const result = parseNote(VALID.replace("created: 2026-08-04", `created: ${value}`));

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key: "created", code: "date" }),
    );
  });

  it("rejects a summary over 400 characters", () => {
    const result = parseNote(
      VALID.replace("Invalidate on write, not on read.", "x".repeat(401)),
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key: "summary", code: "length" }),
    );
  });

  it("accepts a summary of exactly 400 characters", () => {
    const result = parseNote(
      VALID.replace("Invalidate on write, not on read.", "x".repeat(400)),
    );

    expect(result.ok).toBe(true);
  });

  it.each([
    { name: "zero", value: "0" },
    { name: "a negative count", value: "-1" },
    { name: "a fraction", value: "1.5" },
    { name: "a string", value: "many" },
    { name: "a value beyond exact integer precision", value: "99999999999999999999" },
  ])("rejects occurrences that is $name", ({ value }) => {
    const result = parseNote(
      VALID.replace("reviewed: null", `reviewed: null\noccurrences: ${value}`),
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key: "occurrences", code: "type" }),
    );
  });

  it("rejects a schemaVersion that is not the literal 1", () => {
    const result = parseNote(VALID.replace("schemaVersion: 1", "schemaVersion: 2"));

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key: "schemaVersion", code: "type" }),
    );
  });

  it.each([
    { name: "empty", value: '""' },
    { name: "whitespace only", value: '"   "' },
  ])("rejects a title that is $name", ({ value }) => {
    const result = parseNote(
      VALID.replace("title: Widget cache invalidation", `title: ${value}`),
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key: "title", code: "type" }),
    );
  });

  it.each([
    { key: "updated", line: "updated: 04/08/2026", code: "date" },
    { key: "aliases", line: "aliases: not-a-list", code: "type" },
    { key: "sources", line: "sources: [1, 2]", code: "type" },
    { key: "tags", line: "tags: nope", code: "type" },
  ])("validates the optional $key key when present", ({ key, line, code }) => {
    const base =
      key === "tags" ? VALID.replace("tags: [dev, caching]", "") : VALID;
    const result = parseNote(base.replace("reviewed: null", `reviewed: null\n${line}`));

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ key, code }));
  });

  /**
   * Pins RESERVED_KEYS from the other direction. Dropping any entry from that
   * list would reclassify a real field as an unknown key, which the `satisfies`
   * constraint cannot catch.
   */
  it("treats every reserved key as reserved when all are present", () => {
    const result = parseNote(
      [
        "---",
        "schemaVersion: 1",
        "title: Everything",
        "type: compiled-note",
        "created: 2026-08-04",
        "updated: 2026-08-05",
        "tags: [a]",
        "aliases: [b]",
        "summary: All thirteen keys.",
        "stage: established",
        "author: human",
        "reviewed: 2026-08-05",
        "occurrences: 7",
        "sources: [DEV/other.md]",
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.unknownKeys).toStrictEqual([]);
    expect(result.issues).toStrictEqual([]);
    expect(result.note.frontmatter.occurrences).toBe(7);
    expect(result.note.frontmatter.sources).toStrictEqual(["DEV/other.md"]);
    expect(result.note.frontmatter.updated).toBe("2026-08-05");
    expect(result.note.frontmatter.aliases).toStrictEqual(["b"]);
  });

  /**
   * A `...` end marker starts a second YAML document inside the block.
   * `parseDocument` returns it with no error while discarding everything after
   * it, so a note could carry a second frontmatter block the validator never
   * saw — including an unsupported schemaVersion and unreported unknown keys.
   */
  it("refuses a second YAML document hidden behind an end marker", () => {
    const result = parseNote(
      VALID.replace(
        "reviewed: null",
        "reviewed: null\n...\nschemaVersion: 999\nhidden: value",
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "malformed", key: null }),
    );
  });

  /** The only resource-exhaustion bound in the parser. */
  it("refuses an alias bomb", () => {
    const lines = ["a0: &a0 x"];
    for (let index = 1; index <= 11; index += 1) {
      lines.push(`a${String(index)}: &a${String(index)} [*a${String(index - 1)}, *a${String(index - 1)}]`);
    }

    const result = parseNote(
      VALID.replace("reviewed: null", `reviewed: null\n${lines.join("\n")}`),
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "malformed" }),
    );
  });

  it("truncates a very long unknown key in the message it renders", () => {
    const key = "z".repeat(200);
    const result = parseNote(VALID.replace("reviewed: null", `reviewed: null\n${key}: 1`));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const finding = result.issues.find((candidate) => candidate.code === "unknown-key");

    expect(finding?.key).toBe(key);
    expect(finding?.message.length).toBeLessThan(150);
  });

  it("treats a block with no line between its fences as an empty mapping", () => {
    const result = parseNote("---\n---\n\nBody.\n");

    expect(result.ok).toBe(false);
    expect(result.issues.every((candidate) => candidate.code === "missing")).toBe(true);
  });

  /**
   * Pins the shape of the empty-block tolerance, which is the one decision in
   * the parser a reviewer has already proposed simplifying — and the simpler
   * form is wrong. With content and its newline optional *separately*, the lazy
   * group stops at `note: a`, the optional newline matches nothing, and `---`
   * matches the tail of the value: every key below it is silently reclassified
   * as body, unvalidated, while the byte round trip still passes and hides it.
   */
  it("does not close the block on a value that ends in three dashes", () => {
    const result = parseNote(VALID.replace("reviewed: null", "reviewed: null\nnote: a---"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.unknownKeys).toStrictEqual(["note"]);
    expect(result.note.body).toBe("\nBody text with a [[DEV/other]] link.\n");
  });

  it("sorts unknown keys deterministically", () => {
    const result = parseNote(
      VALID.replace("reviewed: null", "reviewed: null\nzeta: 1\nAlpha: 2\nbeta: 3"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.unknownKeys).toStrictEqual(["Alpha", "beta", "zeta"]);
  });

  /**
   * An empty block is an empty mapping. Reporting the keys it lacks tells the
   * user what to write; "not a mapping" tells them nothing actionable.
   */
  it("reports an empty frontmatter block as missing keys, not as malformed", () => {
    const result = parseNote("---\n\n---\n\nBody.\n");

    expect(result.ok).toBe(false);
    expect(result.issues.every((candidate) => candidate.code === "missing")).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key: "title", code: "missing" }),
    );
  });

  it("reports an unknown key at info and still parses", () => {
    const result = parseNote(
      VALID.replace("---\n\nBody", "cssclasses: [wide]\n---\n\nBody"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.unknownKeys).toStrictEqual(["cssclasses"]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        key: "cssclasses",
        code: "unknown-key",
        severity: "info",
      }),
    );
    expect(result.issues.every((issue) => issue.severity !== "error")).toBe(true);
  });

  it("collects every error rather than stopping at the first", () => {
    const result = parseNote(
      VALID.replace("stage: emerging\n", "").replace("author: agent", "author: robot"),
    );

    expect(result.ok).toBe(false);
    expect(result.issues.filter((issue) => issue.severity === "error")).toHaveLength(2);
  });

  it.each([
    { name: "no frontmatter block", source: "# Just a heading\n" },
    { name: "an unterminated block", source: "---\ntitle: x\n" },
    { name: "frontmatter that is not a mapping", source: "---\n- a\n- b\n---\n\nBody\n" },
    { name: "frontmatter that is not valid YAML", source: "---\na: [1, 2\n---\n\nBody\n" },
  ])("reports $name as malformed", ({ source }) => {
    const result = parseNote(source);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "malformed", key: null }),
    );
  });

  it.each([
    { name: "a duplicate key", line: "tags: [x]" },
    { name: "an unterminated flow sequence", line: "extra: [1, 2" },
    { name: "bad indentation", line: "  stray: 1" },
  ])("refuses $name rather than parsing it partially", ({ line }) => {
    const result = parseNote(VALID.replace("reviewed: null", `reviewed: null\n${line}`));

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "malformed", key: null }),
    );
  });

  /**
   * `yaml` logs warnings to stderr *with the offending source line*. `brain lint`
   * walks a whole vault, so that channel would print note content past every
   * redaction seam in the product. Nothing reaches stderr; the issue list is the
   * only output.
   *
   * The input is a collection-valued key, chosen deliberately. An unresolved
   * `!!tag` cannot exercise this: the only warning site in the library sits
   * inside `parse()`, which this code no longer calls, so that input would pass
   * whether or not the guard existed. `toJS`'s collection-key warning is the one
   * path that can still reach the log channel, and it echoes the key verbatim.
   */
  it("never writes note content to a log channel", async () => {
    const warnings: string[] = [];
    const onWarning = (warning: Error): void => {
      warnings.push(warning.message);
    };
    process.on("warning", onWarning);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = parseNote(
        VALID.replace("reviewed: null", "reviewed: null\n? [NOTE-CONTENT, y]\n: v"),
      );

      expect(result.ok).toBe(true);
      await new Promise((resolve) => setImmediate(resolve));

      expect(consoleWarn).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      expect(warnings.join(" ")).not.toContain("NOTE-CONTENT");
    } finally {
      process.off("warning", onWarning);
      consoleWarn.mockRestore();
      consoleError.mockRestore();
    }
  });

  /**
   * The YAML 1.2 core schema keeps this a string. Under a 1.1 parser it becomes
   * `false`, which would silently drop a tag and corrupt a user's vault.
   */
  it("keeps a tag spelled like a boolean as a string", () => {
    const result = parseNote(VALID.replace("tags: [dev, caching]", "tags: [no, on, y]"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.frontmatter.tags).toStrictEqual(["no", "on", "y"]);
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
      'summary: "Short, and quoted for no reason."',
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
    expect(result.note.unknownKeys).toStrictEqual(["cssclasses"]);
    expect(renderNote(result.note)).toBe(source);
  });

  /**
   * The suite that shipped first used LF everywhere, so a reviewer found that a
   * CRLF note parsed happily and came back three bytes shorter with mixed line
   * endings. `header + body` is now the source by construction; these cases pin
   * the delimiter shapes that construction has to survive.
   */
  it.each([
    { name: "CRLF throughout", transform: (s: string) => s.replaceAll("\n", "\r\n") },
    { name: "no trailing newline", transform: (s: string) => s.trimEnd() },
    { name: "a leading byte-order mark", transform: (s: string) => `\uFEFF${s}` },
    {
      name: "trailing spaces on both fences",
      transform: (s: string) => s.replace("---\n", "--- \n").replace("\n---\n", "\n--- \n"),
    },
    {
      name: "CRLF and a byte-order mark together",
      transform: (s: string) => `\uFEFF${s.replaceAll("\n", "\r\n")}`,
    },
  ])("round-trips a note with $name", ({ transform }) => {
    const source = transform(VALID);
    const result = parseNote(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(renderNote(result.note)).toBe(source);
    expect(result.note.frontmatter.title).toBe("Widget cache invalidation");
  });

  it("round-trips a note whose frontmatter is the whole file", () => {
    const source = VALID.slice(0, VALID.indexOf("\n---\n") + "\n---".length);
    const result = parseNote(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(renderNote(result.note)).toBe(source);
    expect(result.note.body).toBe("");
  });

  it("preserves a body containing a line that looks like a fence", () => {
    const source = [
      "---",
      "schemaVersion: 1",
      "title: Fences",
      "type: reference-note",
      "created: 2026-08-04",
      "tags: []",
      "summary: A body may contain three dashes.",
      "stage: emerging",
      "author: human",
      "reviewed: null",
      "---",
      "",
      "Above.",
      "",
      "---",
      "",
      "Below.",
      "",
    ].join("\n");

    const result = parseNote(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(renderNote(result.note)).toBe(source);
    expect(result.note.frontmatter.title).toBe("Fences");
  });
});


describe("parse failures carry a position, and nothing else from the error", () => {
  it("reports the line of a duplicate key", () => {
    /**
     * BACKLOG NEW-3. `parseNote` mapped every YAML failure to one issue with no
     * position, so a duplicate `tags:` — which Obsidian users do produce — said
     * nothing about where. Only `err.linePos` is read: `err.message` and
     * `err.source` both embed the offending input verbatim.
     */
    const result = parseNote(
      ["---", "title: a", "title: b", "---", "", "Body.", ""].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("malformed");
    /**
     * File line 3, not slice line 2. `yaml` numbers lines within the string it
     * was handed, which starts below the opening fence — and the number is
     * rendered beside a vault path, where every consumer reads it as
     * file-relative. 3 is derivable from the fixture without reading the
     * implementation, which is what makes this a contract and not a snapshot.
     */
    expect(result.issues[0]?.line).toBe(3);
  });

  it("never lets the offending source reach the message", () => {
    const secret = "unlikely-sentinel-value";
    const result = parseNote(
      ["---", `title: ${secret}`, `title: ${secret}`, "---", "", "Body.", ""].join("\n"),
    );
    expect(result.ok).toBe(false);
    for (const issue of result.issues) {
      expect(issue.message).not.toContain(secret);
      expect(JSON.stringify(issue)).not.toContain(secret);
    }
    /** The same fixed-string pin, on the error-list path. */
    expect(result.issues[0]?.message).toBe("the frontmatter is not valid YAML");
  });

  it("carries null where the failure has no position", () => {
    const result = parseNote("---\n- not a mapping\n---\n\nBody.\n");
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.line).toBeNull();
  });

  it("gives every validation issue a null position", () => {
    /** Only YAML failures have a line; a missing key is about the whole block. */
    const result = parseNote("---\ntitle: Only a title\n---\n\nBody.\n");
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(1);
    for (const issue of result.issues) expect(issue.line).toBeNull();
  });

  it("still refuses a duplicate key with uniqueKeys pinned explicitly", () => {
    /**
     * BACKLOG NEW-2. The refusal used to ride on the library's default. This is
     * the contract, not the current behaviour: a parser that resolves
     * duplicates last-one-wins is the wrong parser, not a test to loosen.
     */
    const result = parseNote(
      ["---", "schemaVersion: 1", "schemaVersion: 999", "---", "", "Body.", ""].join("\n"),
    );
    expect(result.ok).toBe(false);
  });
});

describe("the frontmatter parse options are pinned, not inherited", () => {
  it("passes uniqueKeys and a silent log level explicitly", () => {
    /**
     * Neither option is observable from behaviour — `uniqueKeys` already
     * defaults to `true` — so no functional test can fail when one is deleted.
     * That is precisely why they are pinned, and a pin nothing checks is not a
     * pin. This asserts the object the call site passes.
     */
    expect(FRONTMATTER_PARSE_OPTIONS).toEqual({
      logLevel: "silent",
      uniqueKeys: true,
    });
    expect(Object.isFrozen(FRONTMATTER_PARSE_OPTIONS)).toBe(true);
  });

  it("refuses an alias bomb without echoing the note, through the catch path", () => {
    /**
     * The other half of the redaction seam. `positionOf` is called from two
     * places and only the error-list one was covered; this reaches the `catch`,
     * where `toJS` throws on excessive alias expansion.
     */
    const sentinel = "unlikely-sentinel-value";
    const bomb = [
      "---",
      `a: &x ${sentinel}`,
      "b: &y [*x, *x, *x, *x, *x, *x, *x, *x, *x, *x]",
      "c: &z [*y, *y, *y, *y, *y, *y, *y, *y, *y, *y]",
      "d: [*z, *z, *z, *z, *z, *z, *z, *z, *z, *z]",
      "---",
      "",
      "Body.",
      "",
    ].join("\n");

    const result = parseNote(bomb);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("malformed");
    for (const issue of result.issues) {
      expect(JSON.stringify(issue)).not.toContain(sentinel);
    }
    /**
     * Pinned exactly, not merely checked for the sentinel. The error this path
     * throws today carries no note content, so a sentinel assertion cannot fail
     * when someone interpolates `err.message` here — and the next library
     * version's error may carry plenty. A fixed string fails on any addition.
     */
    expect(result.issues[0]?.message).toBe("the frontmatter is not valid YAML");
  });
});

describe("parseNote and explicitly tagged YAML", () => {
  /**
   * `yaml@2.8.1` resolves an explicitly tagged node through its known-tags
   * fallback even on the core schema. This was recorded in the backlog as a
   * clause that "costs nothing to adopt because nothing today depends on its
   * absence" — and that premise was wrong. The three below construct values.
   */
  it("refuses a tag that constructs a value the schema never validates", () => {
    const constructed: readonly [string, string][] = [
      ["!!binary aGk=", "a Buffer"],
      ["!!timestamp 2020-01-01", "a Date"],
      ["!!set { x: null }", "a constructed object"],
    ];

    for (const [value, what] of constructed) {
      const result = parseNote(VALID.replace("author: agent", `author: ${value}`));
      expect(result.ok, `${what} from ${value}`).toBe(false);
      if (result.ok) continue;
      expect(result.issues[0]?.code).toBe("malformed");
      expect(result.issues[0]?.message).toContain("explicit YAML tag");
    }
  });

  it("refuses any tag, not a denylist of the dangerous ones", () => {
    /**
     * `!!str` constructs nothing and is harmless today. It is refused anyway,
     * because an allowlist makes the rule "which tags construct values" — a
     * question the library answers and re-answers on upgrade — instead of
     * "frontmatter carries no tags", which this product decides.
     */
    for (const value of ["!!str plain", "!!seq [a]", "!vendor/private x"]) {
      const result = parseNote(VALID.replace("author: agent", `author: ${value}`));
      expect(result.ok, value).toBe(false);
    }
  });

  it("finds a tag nested inside a collection, not only at the top level", () => {
    const nested = VALID.replace("tags: [dev, caching]", "tags:\n  - dev\n  - !!binary aGk=");
    const result = parseNote(nested);
    expect(result.ok).toBe(false);
  });

  it("reports the tagged node's line, in file coordinates", () => {
    /**
     * Line 1 is the opening fence, so the first frontmatter key is line 2 and
     * `author:` — the eighth key — is line 9.
     */
    const result = parseNote(VALID.replace("author: agent", "author: !!binary aGk="));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.line).toBe(9);
  });

  it("reports the value's line when the tag sits on the line above it", () => {
    /**
     * The caveat the docstring and spec §4.4 both state, pinned so it cannot
     * drift into being untrue quietly. `yaml` gives a node's range as the
     * *value* token's offset, so a tag on its own line names the line below
     * itself. Documented rather than corrected — recovering the tag's own
     * offset needs retained source tokens, and the alternative is a backwards
     * scan that is wrong in flow collections and quoted scalars.
     *
     * `summary:` is the sixth key, so the tag sits on file line 7 and the
     * value it tags on line 8. The refusal names 8.
     */
    const split = VALID.replace(
      "summary: Invalidate on write, not on read.",
      "summary: !!str\n  Invalidate on write, not on read.",
    );
    const result = parseNote(split);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toContain("explicit YAML tag");
    expect(result.issues[0]?.line).toBe(8);
  });

  it("bounds the tag it names", () => {
    /**
     * The first version of this test used a tag containing U+202E and asserted
     * the character never reached the message. It passed without
     * `firstExplicitTag` running at all: U+202E is not a legal tag character,
     * so `yaml` refused the document one branch earlier and the assertion was
     * satisfied by a message that never held a tag. Review caught it.
     *
     * The library rejects non-ASCII and control characters in a tag and does
     * not percent-decode one, so the screen is defence in depth. **The cap is
     * the half that actually fires**, and this is the test for it: a tag is
     * author-written and has no length limit.
     */
    const long = `!vendor${"z".repeat(200)}`;
    const result = parseNote(VALID.replace("author: agent", `author: ${long} x`));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const message = result.issues[0]?.message ?? "";
    expect(message).toContain("explicit YAML tag");
    expect(message).toContain("!vendor");
    /**
     * The tag is capped at 64 graphemes and the prose around it is fixed, so
     * the whole message is bounded whatever the note does. Uncapped, this same
     * input produces roughly 320 characters.
     */
    expect(message).not.toContain("z".repeat(65));
    expect(message.length).toBeLessThan(200);
  });

  it("leaves an untagged note alone", () => {
    /** The guard must not fire on ordinary frontmatter, or it refuses every note. */
    expect(parseNote(VALID).ok).toBe(true);
  });
});

describe("a frontmatter key echoed back at its author", () => {
  it("is screened, not merely truncated", () => {
    /**
     * The unknown-key message interpolates the key. A quoted YAML key may hold
     * `\r` or U+202E, and the message travels through `lint.ts` to a terminal.
     * Truncation bounded the length and screened nothing.
     */
    const key = '"bad\u202E\rkey"';
    const result = parseNote(VALID.replace("author: agent", `${key}: 1\nauthor: agent`));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const unknown = result.issues.find((issue) => issue.code === "unknown-key");
    expect(unknown).toBeDefined();
    expect(unknown?.message).not.toContain("\u202E");
    expect(unknown?.message).not.toContain("\r");
    expect(unknown?.message).toContain("bad key");
  });
});
