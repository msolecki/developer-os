import { describe, expect, it } from "vitest";

import type { CaptureEnvelopeV1 } from "../schema/capture.js";
import { renderCaptureFile } from "./render.js";

/**
 * Built by hand rather than through `buildCapture`, because rendering is what
 * is under test: an envelope this file could not produce is exactly the one a
 * renderer must survive. The id is all digits on purpose — see the quoting
 * case below.
 */
const envelope: CaptureEnvelopeV1 = {
  schemaVersion: 1,
  captureId: "0123456789012345",
  sourceAgent: "unknown",
  sourceAgentVersion: "unknown",
  captureMethod: "agent-authored",
  sourceSessionId: null,
  projectSlug: "synthetic-project",
  workingDirectoryFingerprint: "0f1e2d3c4b5a6978",
  createdAt: "2026-08-13T09:00:00.000Z",
  content: "an observation worth keeping",
  deduplicationHash: `0123456789012345${"0".repeat(48)}`,
  status: "quarantined",
  redaction: [],
};

/**
 * The same block `parseCaptureFile` reads, applied here so the render tests
 * assert against the *frontmatter* rather than against the whole file — a
 * substring assertion over the file cannot tell a key above the fence from a
 * line of body below it, which is the confusion these tests exist to catch.
 */
const BLOCK = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/u;

function split(text: string): { frontmatter: string; body: string } {
  const match = BLOCK.exec(text);
  if (match === null) throw new Error("the rendered file has no frontmatter block");
  return { frontmatter: match[1] ?? "", body: match[2] ?? "" };
}

describe("renderCaptureFile", () => {
  it("puts the envelope in frontmatter and the content in the body", () => {
    const { frontmatter, body } = split(renderCaptureFile(envelope));

    expect(frontmatter).not.toContain("an observation worth keeping");
    expect(body).toBe("an observation worth keeping\n");
  });

  it("writes the fields in the envelope's own declaration order", () => {
    const { frontmatter } = split(renderCaptureFile(envelope));
    const keys = frontmatter
      .split("\n")
      .map((line) => /^([A-Za-z]+):/u.exec(line)?.[1])
      .filter((key): key is string => key !== undefined);

    expect(keys).toEqual([
      "schemaVersion",
      "captureId",
      "sourceAgent",
      "sourceAgentVersion",
      "captureMethod",
      "sourceSessionId",
      "projectSlug",
      "workingDirectoryFingerprint",
      "createdAt",
      "deduplicationHash",
      "status",
      "redaction",
    ]);
  });

  it("quotes an all-digit id, so YAML cannot read the filename back as a number", () => {
    /**
     * A capture id is 16 hex characters, and one in 16^16 of them is all
     * digits. Emitted bare, YAML 1.2's core schema resolves `0123456789012345`
     * as an integer — and the parse-side comparison against the filename then
     * fails on a file nothing is wrong with. `yaml`'s own stringifier quotes
     * any scalar that would not round-trip; this pins that it is doing so.
     */
    expect(renderCaptureFile(envelope)).toContain('captureId: "0123456789012345"');
  });

  it("renders an empty finding list as an empty list, not as an absent key", () => {
    expect(renderCaptureFile(envelope)).toContain("redaction: []");
  });

  it("renders a finding as class and fingerprint, and nothing else", () => {
    const { frontmatter } = split(
      renderCaptureFile({
        ...envelope,
        redaction: [{ class: "provider-token", fingerprint: "abcdef0123456789" }],
      }),
    );

    expect(frontmatter).toContain("- class: provider-token");
    expect(frontmatter).toContain("fingerprint: abcdef0123456789");
    expect(frontmatter).not.toMatch(/line|column|offset|location|value/u);
  });

  it("ends the file with exactly one newline", () => {
    const rendered = renderCaptureFile(envelope);

    expect(rendered.endsWith("\n")).toBe(true);
    expect(rendered.endsWith("\n\n")).toBe(false);
  });

  it("keeps a body that opens with a horizontal rule inside the body", () => {
    const { frontmatter, body } = split(
      renderCaptureFile({ ...envelope, content: "---\nnot frontmatter\n---" }),
    );

    expect(frontmatter).toContain("status: quarantined");
    expect(body).toBe("---\nnot frontmatter\n---\n");
  });

  it("cannot be made to close its own fence from inside a value", () => {
    /**
     * `buildCapture` and `parseCaptureFile` both screen the scalars they carry,
     * so a multi-line `projectSlug` should never reach here — but the renderer
     * is a seam a later caller can hand anything to, and a value that closes
     * the block early would push every key below it into the body, where
     * nothing validates it. The library indents a block scalar, which is what
     * makes this safe; the assertion is that no frontmatter line is a bare
     * fence.
     */
    const { frontmatter } = split(
      renderCaptureFile({
        ...envelope,
        projectSlug: "acme\n---\nstatus: accepted",
      }),
    );

    expect(frontmatter.split("\n")).not.toContain("---");
    expect(frontmatter).toContain("status: quarantined");
  });
});
