import { describe, expect, it, vi } from "vitest";

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
