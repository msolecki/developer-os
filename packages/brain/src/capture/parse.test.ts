import { createHash } from "node:crypto";

import { redactText, type RedactionResult } from "@developer-os/security";
import { describe, expect, it } from "vitest";

import type { CaptureEnvelopeV1 } from "../schema/capture.js";
import { buildCapture, type CaptureBuildRequest } from "./build.js";
import { parseCaptureFile, type CaptureFileOutcome } from "./parse.js";

const TEST_KEY = new Uint8Array(32).fill(7);
const redact = (text: string): RedactionResult => redactText(text, TEST_KEY);

const request: CaptureBuildRequest = {
  text: "an observation worth keeping",
  sourceAgent: "unknown",
  sourceAgentVersion: "unknown",
  captureMethod: "agent-authored",
  projectSlug: "synthetic-project",
  workingDirectoryFingerprint: "0f1e2d3c4b5a6978",
  createdAt: "2026-08-13T09:00:00.000Z",
  redact,
};

const built = buildCapture(request);

function providerToken(character: string): string {
  return `ghp_${character.repeat(36)}`;
}

/**
 * Throws rather than returning, so a refusal fails the test *with the reason it
 * refused* instead of collapsing into `undefined` three assertions later.
 */
function accepted(outcome: CaptureFileOutcome): CaptureEnvelopeV1 {
  if (!outcome.ok) {
    throw new Error(`expected an accepted capture, refused with: ${outcome.reason}`);
  }
  return outcome.envelope;
}

const SAMPLE_ID = "0f1e2d3c4b5a6978";
const BASE_FRONTMATTER: readonly string[] = [
  "schemaVersion: 1",
  `captureId: ${SAMPLE_ID}`,
  "sourceAgent: unknown",
  "sourceAgentVersion: unknown",
  "captureMethod: agent-authored",
  "sourceSessionId: null",
  "projectSlug: synthetic-project",
  "workingDirectoryFingerprint: 0f1e2d3c4b5a6978",
  "createdAt: 2026-08-13T09:00:00.000Z",
  `deduplicationHash: ${SAMPLE_ID}${"0".repeat(48)}`,
  "status: quarantined",
  "redaction: []",
];

/**
 * A file whose frontmatter carries `mutation` — replacing the line with the
 * same key when there is one, appending it when there is not. The filename
 * these rows are parsed under is deliberately **not** `${SAMPLE_ID}.md`, which
 * is what makes the table pin refusal precedence rather than merely refusal:
 * every row would be a legal `id-mismatch` if the structural checks did not
 * come first.
 */
function fileFrom(lines: readonly string[]): string {
  return `---\n${lines.join("\n")}\n---\n\nan observation worth keeping\n`;
}

const BASE_FILE = fileFrom(BASE_FRONTMATTER);

function fileWith(mutation: string): string {
  const key = mutation.split(":")[0] ?? "";
  const matches = (line: string): boolean => line.startsWith(`${key}:`);

  return fileFrom(
    BASE_FRONTMATTER.some(matches)
      ? BASE_FRONTMATTER.map((line) => (matches(line) ? mutation : line))
      : [...BASE_FRONTMATTER, mutation],
  );
}

describe("parseCaptureFile", () => {
  it("round-trips an envelope through the file it renders", () => {
    const parsed = parseCaptureFile(built.fileName, built.contents, redact);

    expect(parsed.ok && parsed.envelope).toEqual(built.envelope);
  });

  it("accepts a content edit and keeps the id, which is assigned once and never recomputed", () => {
    const edited = built.contents.replace("observation", "different observation");
    const parsed = parseCaptureFile(built.fileName, edited, redact);

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.envelope.captureId).toBe(built.envelope.captureId);
    expect(parsed.ok && parsed.envelope.deduplicationHash).not.toBe(
      built.envelope.deduplicationHash,
    );
  });

  it("refuses a file whose frontmatter id does not match its name, rather than renaming it", () => {
    const renamed = built.contents.replace(built.envelope.captureId, "0".repeat(16));

    expect(parseCaptureFile(built.fileName, renamed, redact)).toEqual({
      ok: false,
      reason: "id-mismatch",
    });
  });

  it("re-redacts a hand edit, so a pasted secret does not survive the review path", () => {
    const secret = providerToken("a");
    const edited = built.contents.replace("observation", secret);
    const parsed = parseCaptureFile(built.fileName, edited, redact);

    // The assertion is on the ACCEPTED envelope, not on a refusal object. A
    // refusal carries no content, so asserting `not.toContain` over one passes
    // for an implementation that never redacts — which is what this test said
    // before the id became immutable.
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.envelope.content).toContain("[REDACTED:provider-token]");
    expect(JSON.stringify(parsed)).not.toContain("ghp_");

    /**
     * The **order** rather than the two outcomes separately: the hash is over
     * the redacted content, so it can only be this value if redaction ran
     * first. Asserting a clean content alone passes for an implementation that
     * redacts at the wrong point; asserting a moved hash alone passes for one
     * that never redacts at all.
     */
    const envelope = accepted(parsed);
    expect(envelope.deduplicationHash).toBe(
      createHash("sha256").update(envelope.content, "utf8").digest("hex"),
    );
    expect(envelope.captureId).toBe(built.envelope.captureId);
    expect(envelope.deduplicationHash).not.toBe(built.envelope.deduplicationHash);
  });

  it("reports the findings of the pass it just ran, which is empty for already-redacted text", () => {
    /**
     * Not a defect, and the one behaviour here a later reader will misread.
     * `redaction` is recomputed on every parse (spec §5.3) and re-redacting
     * already-redacted content finds nothing — `[REDACTED:provider-token]`
     * matches no pattern — so a capture written with one finding reads back
     * with an empty list the first time `review` touches it. The fingerprints
     * were only ever comparable within the run that produced them; the
     * placeholder in `content` is the durable evidence. Task 19's architecture
     * note carries this, because an empty `redaction` otherwise reads as
     * "nothing was ever redacted".
     */
    const withSecret = buildCapture({ ...request, text: `token ${providerToken("a")}` });
    expect(withSecret.envelope.redaction).toHaveLength(1);

    const parsed = accepted(
      parseCaptureFile(withSecret.fileName, withSecret.contents, redact),
    );

    expect(parsed.redaction).toEqual([]);
    expect(parsed.content).toContain("[REDACTED:provider-token]");
    expect(parsed.deduplicationHash).toBe(withSecret.envelope.deduplicationHash);
  });

  it.each([
    ["schemaVersion: 2", "schema-version"],
    ["status: enthusiastic", "unknown-status"],
    ["not frontmatter at all", "unparseable"],
  ])("refuses %s with reason %s", (mutation, reason) => {
    expect(parseCaptureFile("abc.md", fileWith(mutation), redact)).toEqual({
      ok: false,
      reason,
    });
  });

  it("decides a structural refusal before it compares the id", () => {
    /**
     * The precedence the table above depends on, pinned directly rather than
     * inferred from it: a file that is *both* an unsupported schema version and
     * carries an id its name does not match refuses as `schema-version`,
     * because a file whose frontmatter cannot be trusted has no id to compare.
     */
    const file = fileWith("schemaVersion: 2").replace(SAMPLE_ID, "1".repeat(16));

    expect(parseCaptureFile("abc.md", file, redact)).toEqual({
      ok: false,
      reason: "schema-version",
    });
  });

  it("refuses a second YAML document, as the note parser does", () => {
    /**
     * A `...` end marker inside the block starts a second YAML document, which
     * `parseDocument` returns with **no error** while silently discarding
     * everything after it — so a capture could carry a second envelope that
     * nothing ever validated. `parseAllDocuments` sees both, and the count is
     * what refuses.
     *
     * **The brief's snippet for this case cannot test it, and was corrected
     * here.** It appended `\n---\nstatus: accepted\n` to the whole *file*: the
     * fence regex closes the block at the first `---` line, so that text lands
     * in the body, the file parses cleanly, and the only refusal left is the
     * one its `"abc.md"` fixture name provokes. Run as written it refused with
     * `id-mismatch` — a test that looked green-adjacent while pinning the
     * filename rather than the parser. The second document has to be *inside*
     * the block, and the file has to be named after its own id so that nothing
     * else can refuse it.
     */
    const file = fileFrom([...BASE_FRONTMATTER, "...", "status: accepted"]);

    expect(parseCaptureFile(`${SAMPLE_ID}.md`, file, redact)).toEqual({
      ok: false,
      reason: "unparseable",
    });
  });

  it("reads a body that opens with a fence as a body, not as a second block", () => {
    /**
     * The case the corrected test above displaced, kept because it is a real
     * property: text appended below the closing fence is content. It changes
     * the hash and nothing else, and the capture is still accepted.
     */
    const appended = `${built.contents}\n---\nstatus: accepted\n`;
    const parsed = accepted(parseCaptureFile(built.fileName, appended, redact));

    expect(parsed.status).toBe("quarantined");
    expect(parsed.content).toContain("---\nstatus: accepted");
    expect(parsed.deduplicationHash).not.toBe(built.envelope.deduplicationHash);
  });

  it("refuses a duplicate key rather than validating the survivor", () => {
    /**
     * `uniqueKeys` comes from `FRONTMATTER_PARSE_OPTIONS`, which this parser
     * shares with `schema/note.ts` rather than declaring a second copy of. A
     * parser that resolves duplicates last-one-wins hands the validator only
     * the surviving value: a capture carrying `status: quarantined` and later
     * `status: ingested` would validate against a value its author never wrote.
     * This test is what fails if someone writes their own options object.
     */
    const file = BASE_FILE.replace(
      "redaction: []",
      "redaction: []\nstatus: ingested",
    );

    expect(parseCaptureFile(`${SAMPLE_ID}.md`, file, redact)).toEqual({
      ok: false,
      reason: "unparseable",
    });
  });

  it("refuses an id the file could not have been named by", () => {
    /**
     * Same reason, because it is the same question. An unquoted all-digit id
     * resolves as a *number* rather than a string, which is what a hand edit
     * produces and what `renderCaptureFile`'s quoting exists to prevent; an id
     * that is not 16 hex characters cannot be a filename this product wrote.
     * Both are the id disagreeing with the name, not the file being illegible.
     */
    expect(parseCaptureFile("abc.md", fileWith("captureId: 12345"), redact)).toEqual({
      ok: false,
      reason: "id-mismatch",
    });
    expect(
      parseCaptureFile("abc.md", fileWith("captureId: NOTHEXADECIMAL"), redact),
    ).toEqual({ ok: false, reason: "id-mismatch" });
    expect(
      parseCaptureFile(
        "NOTHEXADECIMAL.md",
        fileWith("captureId: NOTHEXADECIMAL"),
        redact,
      ),
    ).toEqual({ ok: false, reason: "id-mismatch" });
  });

  it("refuses a field an explicit YAML tag constructed a value for", () => {
    /**
     * `yaml` resolves an explicitly tagged node through its known-tags fallback
     * even on the core schema: `!!timestamp` yields a `Date`, `!!binary` a
     * `Buffer`. Neither is a string, and every scalar this envelope carries is
     * checked as one — so the refusal falls out of the type checks rather than
     * needing a second visitor over the document.
     */
    expect(
      parseCaptureFile(
        `${SAMPLE_ID}.md`,
        fileWith("createdAt: !!timestamp 2026-08-13T09:00:00.000Z"),
        redact,
      ),
    ).toEqual({ ok: false, reason: "unparseable" });
  });

  it("refuses a session id that is neither null nor a string", () => {
    /**
     * `sourceSessionId` is the one field with two legal types, which is exactly
     * where a "treat anything unrecognised as null" reading hides: it would
     * turn a hand-edited `sourceSessionId: 42` into a `null` the envelope then
     * claims is the file's own value. Wrong type is wrong, not absent.
     */
    expect(
      parseCaptureFile(`${SAMPLE_ID}.md`, fileWith("sourceSessionId: 42"), redact),
    ).toEqual({ ok: false, reason: "unparseable" });
  });

  it("carries a session id through when a file has one", () => {
    expect(
      accepted(
        parseCaptureFile(
          `${SAMPLE_ID}.md`,
          fileWith("sourceSessionId: session-1"),
          redact,
        ),
      ).sourceSessionId,
    ).toBe("session-1");
  });

  it("does not let a __proto__ key smuggle a field past the checks", () => {
    /**
     * A capture file is attacker-influenced content — it is whatever was
     * captured, edited by whoever has the vault. Were `toJS` to assign
     * `__proto__` by plain assignment onto a `{}`, a mapping under that key
     * would land on the object's *prototype* and every `fields.x` read below
     * would see values no own key carries. `yaml@2.8.1` makes it an own
     * property instead; this pins that, because the day a parser swap changes
     * it, nothing else in this file would fail.
     */
    const smuggled = fileFrom([
      "__proto__:",
      "  schemaVersion: 1",
      "  status: ingested",
    ]);

    expect(parseCaptureFile(`${SAMPLE_ID}.md`, smuggled, redact)).toEqual({
      ok: false,
      reason: "schema-version",
    });
  });

  it("refuses a preserved field the file does not carry", () => {
    const missing = BASE_FILE.replace("sourceSessionId: null\n", "");

    expect(parseCaptureFile(`${SAMPLE_ID}.md`, missing, redact)).toEqual({
      ok: false,
      reason: "unparseable",
    });
  });

  it("refuses a file with no frontmatter at all", () => {
    expect(parseCaptureFile("abc.md", "just a note\n", redact)).toEqual({
      ok: false,
      reason: "unparseable",
    });
  });

  it("compares against a file name, never a path", () => {
    /**
     * The first argument is the name the file is stored under, and the id *is*
     * that name (spec §5.2). A caller that hands over a path is asking a
     * question this function cannot answer, and it refuses rather than
     * guessing at a basename — `review` passes what it read from a directory
     * listing.
     */
    expect(
      parseCaptureFile(`quarantine/${built.envelope.captureId}.md`, built.contents, redact),
    ).toEqual({ ok: false, reason: "id-mismatch" });
  });

  it("keeps a legal status the file already carries", () => {
    const reviewed = built.contents.replace(
      "status: quarantined",
      "status: accepted",
    );

    expect(accepted(parseCaptureFile(built.fileName, reviewed, redact)).status).toBe(
      "accepted",
    );
  });

  it("keeps a body that contains a horizontal rule out of the frontmatter", () => {
    /**
     * The fence regex `schema/note.ts` corrected: anchoring the newline to the
     * content group is what stops a `---` inside the block from splitting it
     * and pushing unvalidated keys into the body. Here it is the body's own
     * rule that must survive the round trip.
     */
    const withRule = buildCapture({
      ...request,
      text: "before\n\n---\n\nafter",
    });

    expect(accepted(parseCaptureFile(withRule.fileName, withRule.contents, redact))).toEqual(
      withRule.envelope,
    );
  });

  it("reads a file whose lines end in CRLF", () => {
    const windows = built.contents.replace(/\n/gu, "\r\n");

    expect(accepted(parseCaptureFile(built.fileName, windows, redact))).toEqual(
      built.envelope,
    );
  });

  it("screens a hand-edited scalar rather than trusting it", () => {
    /**
     * U+202E RIGHT-TO-LEFT OVERRIDE, which reorders the rest of a printed line
     * (Trojan Source, CVE-2021-42574) — and `review` prints this value. A hand
     * edit is exactly how one gets into a vault file, so the parse path screens
     * the scalars it reads with the screen the capture path wrote them through.
     */
    const rightToLeftOverride = String.fromCodePoint(0x202e);
    const edited = built.contents.replace(
      "projectSlug: synthetic-project",
      `projectSlug: acme${rightToLeftOverride}corp`,
    );

    expect(accepted(parseCaptureFile(built.fileName, edited, redact)).projectSlug).toBe(
      "acmecorp",
    );
  });
});
