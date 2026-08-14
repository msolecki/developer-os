import { describe, expect, it } from "vitest";

import {
  MAX_PROPOSED_NOTE_CHARS,
  MAX_PROPOSED_NOTES,
  parseIngestProposal,
} from "./proposal.js";

const NOTE = {
  path: "DEV/a.md",
  contents: "---\nschemaVersion: 1\n---\nbody",
  sourceCaptureId: "0123456789abcdef",
} as const;

/**
 * The precomposed letter (U+00E9) and the decomposed pair (U+0065 U+0301) are
 * one filename on a normalizing volume and two strings in JavaScript. Written
 * as escapes rather than as literal characters, so the byte-level distinction
 * the de-duplication test exercises cannot be folded away by an editor or by a
 * normalizing paste.
 */
const COMPOSED_PATH = "DEV/caf\u00e9.md";
const DECOMPOSED_PATH = "DEV/cafe\u0301.md";

function proposal(...notes: readonly unknown[]): unknown {
  return { schemaVersion: 1, notes };
}

describe("parseIngestProposal", () => {
  it("accepts a proposal of notes, each naming the capture it came from", () => {
    const outcome = parseIngestProposal(proposal(NOTE));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.proposal.schemaVersion).toBe(1);
    expect(outcome.proposal.notes).toStrictEqual([NOTE]);
  });

  it("accepts an empty proposal, because 'nothing here is worth a note' is an answer", () => {
    /**
     * Refusing an empty `notes` would make the honest answer indistinguishable
     * from a malformed one, and would push the model towards inventing a note
     * to satisfy the parser. The capture stays `accepted` either way.
     */
    const outcome = parseIngestProposal({ schemaVersion: 1, notes: [] });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.proposal.notes).toStrictEqual([]);
  });

  it.each([
    ["a missing sourceCaptureId", { schemaVersion: 1, notes: [{ path: "a.md", contents: "x" }] }],
    ["an empty sourceCaptureId", proposal({ ...NOTE, sourceCaptureId: "" })],
    ["an absolute path", proposal({ ...NOTE, path: "/etc/passwd" })],
    ["a traversing path", proposal({ ...NOTE, path: "DEV/../../etc/passwd.md" })],
    ["a path with a bare dot segment", proposal({ ...NOTE, path: "DEV/./a.md" })],
    ["a path with an empty segment", proposal({ ...NOTE, path: "DEV//a.md" })],
    ["a backslash-separated path", proposal({ ...NOTE, path: "DEV\\a.md" })],
    ["a path carrying a NUL", proposal({ ...NOTE, path: "DEV/a\u0000.md" })],
    ["a path carrying a bidirectional override", proposal({ ...NOTE, path: "DEV/a\u202e.md" })],
    ["a path that is not a note", proposal({ ...NOTE, path: "DEV/a.txt" })],
    ["an empty path", proposal({ ...NOTE, path: "" })],
    ["empty contents", proposal({ ...NOTE, contents: "" })],
    ["a reserved key", { schemaVersion: 1, notes: [], __proto__: { x: 1 } }],
    ["a reserved key inside a note", proposal({ ...NOTE, __proto__: { x: 1 } })],
    ["a wrong schema version", { schemaVersion: 2, notes: [] }],
    ["a string schema version", { schemaVersion: "1", notes: [] }],
    ["a missing schema version", { notes: [] }],
    ["a string where an array belongs", { schemaVersion: 1, notes: "DEV/a.md" }],
    ["an unknown top-level key", { schemaVersion: 1, notes: [], apply: true }],
    ["an unknown key inside a note", proposal({ ...NOTE, mode: "overwrite" })],
    ["a note that is not an object", proposal("DEV/a.md")],
    ["a note that is an array", proposal([])],
    ["a null note", proposal(null)],
    ["an array where the proposal belongs", [NOTE]],
    ["a bare string", "DEV/a.md"],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s", (_name, payload) => {
    expect(parseIngestProposal(payload).ok).toBe(false);
  });

  it("refuses an own __proto__ key, which is the form a model's JSON actually takes", () => {
    /**
     * The two forms are different values and only one of them arrives over the
     * wire. An object literal writing `__proto__:` **sets the prototype** and
     * creates no own property, while `JSON.parse` creates an own property and
     * leaves the prototype alone — so a screen checking only one of them
     * passes the other. `packages/core`'s `parseAgentPromptArgs` and
     * `workflow-schema`'s `validateWorkflow` both screen the own-property
     * form, because both parse text; this parser is reached from both
     * directions and screens both.
     */
    const wire = JSON.parse('{"schemaVersion":1,"notes":[],"__proto__":{"x":1}}') as unknown;
    expect(Object.prototype.hasOwnProperty.call(wire, "__proto__")).toBe(true);
    expect(parseIngestProposal(wire).ok).toBe(false);
  });

  it("refuses a payload whose prototype was replaced, own keys or not", () => {
    const seeded = Object.create({ notes: [NOTE] }) as Record<string, unknown>;
    seeded["schemaVersion"] = 1;
    expect(parseIngestProposal(seeded).ok).toBe(false);
  });

  it("is total over any unknown, including a hostile proxy", () => {
    /**
     * The signature says `unknown` and the payload comes from a model, which
     * makes this the one place in the product where hostile input is the
     * expected case rather than the edge one. A validator that aborts on one
     * hostile input cannot report on the rest.
     */
    const hostile = new Proxy({}, { get() { throw new Error("boom"); } });
    expect(parseIngestProposal(hostile).ok).toBe(false);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(parseIngestProposal(revoked.proxy).ok).toBe(false);

    const throwingGetter = {
      schemaVersion: 1,
      get notes(): never {
        throw new Error("boom");
      },
    };
    expect(parseIngestProposal(throwingGetter).ok).toBe(false);
  });

  it("refuses two notes that would write the same file, comparing on NFC", () => {
    /**
     * Normalization precedes de-duplication. Comparing raw bytes would let a
     * proposal claim to write two notes and in fact write one over the other,
     * which is a silent loss rather than a refusal. The value carried through
     * is still the raw one: paths are byte-exact in this package, and the
     * normalization exists only to answer "are these the same file".
     */
    expect(COMPOSED_PATH).not.toBe(DECOMPOSED_PATH);

    const composed = { ...NOTE, path: COMPOSED_PATH };
    const decomposed = { ...NOTE, path: DECOMPOSED_PATH };
    expect(parseIngestProposal(proposal(composed, decomposed)).ok).toBe(false);
    expect(parseIngestProposal(proposal(composed)).ok).toBe(true);
    expect(parseIngestProposal(proposal(NOTE, { ...NOTE })).ok).toBe(false);
  });

  it("carries the path through byte for byte, without normalizing it", () => {
    const outcome = parseIngestProposal(proposal({ ...NOTE, path: DECOMPOSED_PATH }));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.proposal.notes[0]?.path).toBe(DECOMPOSED_PATH);
    expect(outcome.proposal.notes[0]?.path).not.toBe(COMPOSED_PATH);
  });

  it("bounds what one capture may propose, in notes and in bytes", () => {
    /**
     * A bound because this is model output. Neither number is a policy about
     * what a good note looks like — the nine validators own that — they are
     * the point past which a proposal stops being a proposal and becomes a
     * way to make Developer OS write for as long as the model keeps talking.
     */
    const many = Array.from({ length: MAX_PROPOSED_NOTES + 1 }, (_, index) => ({
      ...NOTE,
      path: `DEV/note-${String(index)}.md`,
    }));
    expect(parseIngestProposal(proposal(...many)).ok).toBe(false);
    expect(parseIngestProposal(proposal(...many.slice(0, MAX_PROPOSED_NOTES))).ok).toBe(true);

    const oversized = { ...NOTE, contents: "x".repeat(MAX_PROPOSED_NOTE_CHARS + 1) };
    expect(parseIngestProposal(proposal(oversized)).ok).toBe(false);
    expect(
      parseIngestProposal(proposal({ ...NOTE, contents: "x".repeat(MAX_PROPOSED_NOTE_CHARS) })).ok,
    ).toBe(true);
  });

  it("returns a frozen proposal built from copied fields, never the payload itself", () => {
    /**
     * The accepted value is rebuilt field by field rather than handed back, so
     * nothing a hostile payload attached rides along into the nine validators
     * — and a getter cannot return one value to the parser and another to the
     * validator that reads it next.
     */
    const payload = proposal({ ...NOTE }) as { notes: unknown[] };
    const outcome = parseIngestProposal(payload);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.proposal).not.toBe(payload);
    expect(outcome.proposal.notes).not.toBe(payload.notes);
    expect(outcome.proposal.notes[0]).not.toBe(payload.notes[0]);
    expect(Object.isFrozen(outcome.proposal)).toBe(true);
    expect(Object.isFrozen(outcome.proposal.notes)).toBe(true);
    expect(Object.isFrozen(outcome.proposal.notes[0])).toBe(true);
  });

  it("names the refusal, so a caller can say which one it hit", () => {
    const cases = [
      [{ schemaVersion: 2, notes: [] }, "schema-version"],
      [{ schemaVersion: 1, notes: [], __proto__: { x: 1 } }, "reserved-key"],
      [{ schemaVersion: 1, notes: [], apply: true }, "unknown-key"],
      [proposal({ ...NOTE, path: "/etc/passwd" }), "unsafe-path"],
      [proposal({ path: "a.md", contents: "x" }), "missing-provenance"],
      [{ schemaVersion: 1, notes: "DEV/a.md" }, "unparseable"],
      [proposal(NOTE, { ...NOTE }), "duplicate-path"],
      [proposal({ ...NOTE, contents: "x".repeat(MAX_PROPOSED_NOTE_CHARS + 1) }), "oversized"],
    ] as const;

    for (const [payload, reason] of cases) {
      const outcome = parseIngestProposal(payload);
      expect(outcome.ok, reason).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.reason, reason).toBe(reason);
    }
  });
});
