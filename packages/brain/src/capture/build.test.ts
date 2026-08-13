import { createHash } from "node:crypto";

import { redactText, type RedactionResult } from "@developer-os/security";
import { describe, expect, it } from "vitest";

import { buildCapture, type CaptureBuildRequest } from "./build.js";

/**
 * Deterministic and synthetic. The fingerprint is an HMAC of the secret under
 * this key, so a fixed key is what makes a finding assertable without any real
 * material entering the repository — and injecting `redact` rather than a key
 * is what keeps this package free of one.
 */
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

/** Assembled rather than written out: no scanner has a real token to find. */
function providerToken(character: string): string {
  return `ghp_${character.repeat(36)}`;
}

/**
 * Every invisible character this file exercises is named by its code point and
 * constructed, never typed — `tests/repository/control-bytes.test.ts` fails the
 * build on a literal control or format character in any tracked text file, and
 * it exists because this repository shipped two that no diff ever showed. The
 * rule that gate states is that the *source* must be reviewable;
 * `String.fromCodePoint(0x202e)` is as reviewable as an escape and cannot be
 * turned back into a byte by a copy-paste.
 */
const NUL = String.fromCodePoint(0x00);
const ESCAPE = String.fromCodePoint(0x1b);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d);
const COMBINING_ACUTE = String.fromCodePoint(0x0301);
const FAMILY = `\u{1F468}${ZERO_WIDTH_JOINER}\u{1F469}${ZERO_WIDTH_JOINER}\u{1F467}`;

describe("buildCapture", () => {
  it("redacts before hashing, so the hash cannot fingerprint a secret", () => {
    const secret = providerToken("a");
    const built = buildCapture({ ...request, text: `token ${secret}` });

    expect(built.envelope.content).not.toContain(secret);
    expect(built.contents).not.toContain(secret);
    expect(built.envelope.deduplicationHash).toBe(
      createHash("sha256").update(built.envelope.content).digest("hex"),
    );
  });

  it("derives the id from the hash, so the filename is the deduplication key", () => {
    const built = buildCapture(request);

    expect(built.envelope.captureId).toBe(
      built.envelope.deduplicationHash.slice(0, 16),
    );
    expect(built.fileName).toBe(`${built.envelope.captureId}.md`);
  });

  it("gives two texts differing only by a secret the same id, because both redact to one text", () => {
    const first = providerToken("a");
    const second = providerToken("b");
    const a = buildCapture({ ...request, text: `token ${first}` });
    const b = buildCapture({ ...request, text: `token ${second}` });

    expect(a.envelope.captureId).toBe(b.envelope.captureId);

    /**
     * This is the case to look hardest at. Two different secrets producing one
     * capture id is a *consequence* of hashing after redaction, and it is
     * correct — the observation is the same observation — but it means the
     * second capture is a duplicate whose file is never written, so the fact
     * that a second secret was ever pasted is absorbed.
     *
     * What makes that acceptable is that **nothing of the second secret
     * survives**, and that is asserted here rather than left implied: the two
     * artifacts are identical apart from a fingerprint, and no fragment of
     * either secret appears in one.
     */
    expect(b.contents).not.toContain(second);
    expect(b.contents).not.toContain("ghp_");
    expect(b.contents).not.toContain("b".repeat(8));
    expect(JSON.stringify(b.envelope)).not.toContain(second);
    expect({ ...b.envelope, redaction: [] }).toEqual({
      ...a.envelope,
      redaction: [],
    });
    /**
     * The one thing that differs is the HMAC fingerprint, which is
     * non-reversible and lives only in the run that produced it.
     */
    expect(b.envelope.redaction[0]?.fingerprint).not.toBe(
      a.envelope.redaction[0]?.fingerprint,
    );
  });

  it("normalizes to NFC and screens control and format characters", () => {
    const built = buildCapture({
      ...request,
      text: `café${RIGHT_TO_LEFT_OVERRIDE}reversed`,
    });

    expect(built.envelope.content).toContain("café");
    expect(built.envelope.content).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  });

  it("composes a decomposed form, so two spellings of one word are one capture", () => {
    const decomposed = buildCapture({ ...request, text: `cafe${COMBINING_ACUTE}` });
    const composed = buildCapture({ ...request, text: "café" });

    expect(decomposed.envelope.content).toBe("café");
    expect(decomposed.envelope.captureId).toBe(composed.envelope.captureId);
  });

  it("keeps a joined emoji whole, because U+200D is part of a cluster rather than an attack on one", () => {
    /**
     * The third screen to carry this exemption. `packages/brain/src/redact.ts`
     * and `apps/cli/src/context.ts`'s `renderPath` are the other two, and all
     * three must agree: a ZERO WIDTH JOINER is `\p{Cf}`, so a screen that
     * deletes the class wholesale turns a family into three strangers. The
     * assertion above — that content carries no `\p{Cf}` at all — holds for
     * *that* input and is not a rule about every input; this is the exception,
     * written out so a later reader does not "fix" one by breaking the other.
     */
    const built = buildCapture({ ...request, text: `a family ${FAMILY} in a note` });

    expect(built.envelope.content).toContain(FAMILY);
    expect(built.contents).toContain(FAMILY);
  });

  it("keeps the Markdown body's own line structure", () => {
    const built = buildCapture({
      ...request,
      text: "# heading\n\n- one\n- two\n",
    });

    expect(built.envelope.content).toBe("# heading\n\n- one\n- two");
  });

  it("folds CRLF to LF, so one observation typed on two platforms is one capture", () => {
    const windows = buildCapture({ ...request, text: "one\r\ntwo" });
    const unix = buildCapture({ ...request, text: "one\ntwo" });

    expect(windows.envelope.content).toBe("one\ntwo");
    expect(windows.envelope.captureId).toBe(unix.envelope.captureId);
  });

  it("replaces a structural control with a space rather than deleting it", () => {
    /**
     * `screen.ts`'s policy and its reason: deleting a control silently joins
     * the words on either side into one, which changes what the text says. A
     * format character is deleted instead, because it was invisible to begin
     * with.
     */
    const built = buildCapture({ ...request, text: `one${NUL}two` });

    expect(built.envelope.content).toBe("one two");
  });

  it("screens the scalars it carries into frontmatter, because a slug can hold an escape sequence", () => {
    const built = buildCapture({
      ...request,
      projectSlug: `acme${ESCAPE}[31m corp`,
      sourceAgentVersion: "1.0\n2.0",
    });

    expect(built.envelope.projectSlug).toBe("acme [31m corp");
    expect(built.envelope.sourceAgentVersion).toBe("1.0 2.0");
  });

  it("starts every capture quarantined, at schema version 1", () => {
    const built = buildCapture(request);

    expect(built.envelope.status).toBe("quarantined");
    expect(built.envelope.schemaVersion).toBe(1);
  });

  it("carries the request's own provenance through unchanged", () => {
    const built = buildCapture(request);

    expect(built.envelope.sourceAgent).toBe("unknown");
    expect(built.envelope.sourceAgentVersion).toBe("unknown");
    expect(built.envelope.captureMethod).toBe("agent-authored");
    expect(built.envelope.projectSlug).toBe("synthetic-project");
    expect(built.envelope.workingDirectoryFingerprint).toBe("0f1e2d3c4b5a6978");
    expect(built.envelope.createdAt).toBe("2026-08-13T09:00:00.000Z");
  });

  it("records no session id, because neither adapter exposes one stably", () => {
    expect(buildCapture(request).envelope.sourceSessionId).toBeNull();
  });

  it("records one finding per redaction, class and fingerprint only", () => {
    const built = buildCapture({ ...request, text: providerToken("a") });
    const [finding] = built.envelope.redaction;

    expect(built.envelope.redaction).toHaveLength(1);
    expect(finding?.class).toBe("provider-token");
    expect(finding?.fingerprint).toMatch(/^[0-9a-f]{16}$/u);
    /**
     * The brief writes this as `toEqual` against an object with an
     * `expect.stringMatching` fingerprint, which this repository's lint refuses
     * — the matcher is typed `any`. Spelled out, it also pins the *shape*
     * harder than the original did: `CaptureRedactionFinding` is class and
     * fingerprint and nothing else, and `schema/capture.ts` records that
     * widening it to carry a location is a decision for the subsystem whose
     * threat model owns untrusted input. A finding that grew a third key would
     * fail here.
     */
    expect(Object.keys(finding ?? {})).toEqual(["class", "fingerprint"]);
  });

  it("records nothing when nothing was redacted", () => {
    expect(buildCapture(request).envelope.redaction).toEqual([]);
  });

  it("renders the file it names", () => {
    const built = buildCapture(request);

    expect(built.fileName).toBe(`${built.envelope.captureId}.md`);
    expect(built.contents).toContain(`captureId: ${built.envelope.captureId}`);
    expect(built.contents.endsWith("an observation worth keeping\n")).toBe(true);
  });
});
