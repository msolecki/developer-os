import { describe, expect, it } from "vitest";

import { parseWorkflowYaml, WORKFLOW_PARSE_OPTIONS } from "./parse.js";

describe("parseWorkflowYaml", () => {
  it("resolves the core schema, so a Norwegian-looking key stays a string", () => {
    const parsed = parseWorkflowYaml("id: no\n");
    expect(parsed).toStrictEqual({ ok: true, value: { id: "no" } });
  });

  it("refuses a second document rather than silently dropping it", () => {
    /**
     * `parseDocument` discards everything after a `...` end marker without
     * raising, which is how a workflow's real scopes could sit in a document
     * nothing reads. Same defect the Brain parser was corrected for.
     */
    expect(parseWorkflowYaml("id: a\n...\nid: b\n")).toStrictEqual({
      ok: false,
      reason: "multiple-documents",
    });
  });

  it("refuses any explicitly tagged node, not a denylist of dangerous ones", () => {
    expect(parseWorkflowYaml("id: !!str a\n")).toStrictEqual({
      ok: false,
      reason: "explicit-tag",
    });
  });

  it("refuses a tag nested anywhere, not only one on a top-level value", () => {
    /**
     * The case above would still pass against a root-only check, so it cannot
     * be the only one. A workflow's tags would sit inside `steps`, never at the
     * top of the file.
     */
    for (const hostile of [
      "steps:\n  - !!str a\n",
      "outer:\n  inner: !!binary aGk=\n",
      "a:\n  b:\n    c:\n      - d: !!timestamp 2026-08-10\n",
    ]) {
      expect(parseWorkflowYaml(hostile), JSON.stringify(hostile)).toStrictEqual({
        ok: false,
        reason: "explicit-tag",
      });
    }
  });

  it("refuses an anchor or an alias, for the reason it refuses a tag", () => {
    /**
     * An alias makes the bytes and the parsed value disagree, which is the one
     * thing this layer exists to prevent. Refusing the whole feature also
     * closes three holes at once: `toJS` throws on an unresolved alias with the
     * anchor name in the message, an alias bomb is a resource-exhaustion
     * refusal from inside the library, and a self-referential alias produces a
     * circular value that no downstream serializer can accept.
     */
    for (const hostile of [
      "a: &anchor 1\nb: 2\n",
      "a: 1\nb: *anchor\n",
      "a: &a [*a]\n",
      "steps:\n  - &s {id: x}\n  - *s\n",
    ]) {
      expect(parseWorkflowYaml(hostile), JSON.stringify(hostile)).toStrictEqual({
        ok: false,
        reason: "anchor-or-alias",
      });
    }
  });

  it("returns a refusal rather than throwing, whatever the input", () => {
    /**
     * The signature promises a total function and `toJS` does not. An
     * unresolved alias throws a `ReferenceError` carrying the author's anchor
     * name verbatim — unscreened, uncapped, past every redaction seam — and one
     * hostile file would abort a run that was meant to report on six.
     */
    const hostile = "a: *SENTINEL\u202Ename\n";
    expect(() => parseWorkflowYaml(hostile)).not.toThrow();
    expect(JSON.stringify(parseWorkflowYaml(hostile))).not.toContain("SENTINEL");
  });

  it("refuses deeply nested input instead of exhausting the stack", () => {
    /**
     * Two kilobytes \u2014 `a: ` and a thousand brackets \u2014 overflowed the stack
     * inside `parseAllDocuments`, which is the *first* statement of this
     * function and was therefore outside the guard that was written for `toJS`.
     * Composition is recursive and so is the node walk, so the whole body has to
     * be inside it. Found by the review of this task, after the anchor refusal
     * had already made the original guarded call unreachable.
     */
    for (const deep of [
      `a: ${"[".repeat(1000)}${"]".repeat(1000)}\n`,
      `a: ${"{a: ".repeat(1000)}1${"}".repeat(1000)}\n`,
    ]) {
      expect(() => parseWorkflowYaml(deep)).not.toThrow();
      expect(parseWorkflowYaml(deep)).toStrictEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("calls zero documents malformed, never `multiple-documents`", () => {
    /**
     * Both refuse, which is right; only one of them says something true. A
     * zero-byte file told to look for its second document sends somebody
     * searching for text that is not there.
     */
    for (const empty of ["", "# just a comment\n", "   \n"]) {
      expect(parseWorkflowYaml(empty), JSON.stringify(empty)).toStrictEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("still refuses more than one document", () => {
    expect(parseWorkflowYaml("id: a\n---\nid: b\n---\nid: c\n")).toStrictEqual({
      ok: false,
      reason: "multiple-documents",
    });
  });

  it("refuses a duplicate key rather than resolving it last-one-wins", () => {
    expect(parseWorkflowYaml("id: a\nid: b\n")).toStrictEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("pins the options a behaviour cannot observe", () => {
    expect(WORKFLOW_PARSE_OPTIONS).toStrictEqual({
      logLevel: "silent",
      uniqueKeys: true,
    });
    expect(Object.isFrozen(WORKFLOW_PARSE_OPTIONS)).toBe(true);
  });
});
