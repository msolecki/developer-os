import { createHash } from "node:crypto";

import { screenControlCharacters } from "@developer-os/security";
import type { RedactionResult } from "@developer-os/security";

import type {
  CaptureEnvelopeV1,
  CaptureRedactionFinding,
} from "../schema/capture.js";
import { renderCaptureFile } from "./render.js";

/**
 * Every field the envelope cannot derive from the text, because each one needs
 * something this package must not touch: an environment (`sourceAgent`), a
 * process (`sourceAgentVersion`), a working directory (`projectSlug`,
 * `workingDirectoryFingerprint`), a clock (`createdAt`), and a key (`redact`).
 *
 * `redact` is a callback rather than a key for the reason design spec §3.5
 * gives: the key is a secret at rest that the CLI loads at its own point of
 * use, and `packages/brain` has no filesystem access anywhere in it. A package
 * that cannot read a key cannot leak one.
 */
export interface CaptureBuildRequest {
  readonly text: string;
  readonly sourceAgent: string;
  readonly sourceAgentVersion: string;
  readonly captureMethod: "agent-authored" | "manual";
  readonly projectSlug: string;
  readonly workingDirectoryFingerprint: string;
  readonly createdAt: string;
  readonly redact: (text: string) => RedactionResult;
}

export interface CaptureBuildResult {
  readonly envelope: CaptureEnvelopeV1;
  /** `${captureId}.md`, which is the deduplication key: spec §5.2. */
  readonly fileName: string;
  /** Frontmatter and body, ready for an `O_EXCL` create. */
  readonly contents: string;
}

/**
 * The id is the first 16 hex characters of the hash — 64 bits, which is the
 * width `workingDirectoryFingerprint` and a redaction fingerprint already use.
 */
const CAPTURE_ID_LENGTH = 16;

/**
 * CR and CRLF both fold to LF *before* anything else looks at the text, so one
 * observation typed on two platforms is one capture rather than two. Doing it
 * here rather than leaving `\r` to the control screen matters: the screen turns
 * a control into a space, so a CRLF file would otherwise hash as
 * `line one \nline two` and never collide with the same text typed on macOS.
 */
const LINE_ENDINGS = /\r\n?/gu;

/**
 * `\n` and `\t` are what a Markdown body is made of and are kept; every other
 * `\p{Cc}` becomes a space rather than being deleted, because deleting one
 * silently joins the words on either side into a word nobody wrote. This is
 * `packages/security/src/screen.ts`'s policy, applied to a body rather than to
 * a one-line message — which is why that function cannot be reused here: it
 * also collapses whitespace and trims, and a Markdown body loses its paragraphs
 * and its lists to that.
 */
const STRUCTURAL_CONTROLS = /(?![\n\t])\p{Cc}/gu;

/**
 * Format characters are deleted rather than spaced, because they were invisible
 * to begin with: a soft hyphen inside `co<SHY>op` is a hint about where the word
 * may break, and replacing it with a space splits a word that was never split.
 * The one that matters is U+202E RIGHT-TO-LEFT OVERRIDE, which reorders the
 * remainder of a printed line (Trojan Source, CVE-2021-42574) — and this text is
 * printed, by `review`, in a terminal.
 *
 * **U+200D ZERO WIDTH JOINER is exempt, and this is the third screen that must
 * hold that.** `packages/security/src/screen.ts` and `apps/cli/src/context.ts`'s
 * `renderPath` are the other two. A joiner is part of a grapheme cluster rather
 * than an attack on one — deleting it turns a family emoji into three separate
 * people — and it can neither reorder, hide, nor truncate a line, which is what
 * the rest of the class is here for. The two existing layers held opposite
 * policies for one review round and the output was worse than either alone; a
 * third layer that disagrees would do it again.
 */
const INVISIBLE_FORMAT = /(?!\u{200D})\p{Cf}/gu;

/**
 * NFC **after** the screen, not before. Deleting a format character can bring
 * two characters into composition range that were not adjacent before — `e`,
 * a zero-width non-joiner, and a combining acute compose to `é` only once the
 * joiner is gone — so normalizing first leaves a stored form that is not NFC,
 * and the hash then depends on the order two steps ran in rather than on the
 * text. `redactText` normalizes at its own top for its own offset arithmetic;
 * this is the normalization the *stored* form is guaranteed by.
 *
 * **Trimming stops at one leading newline, plus whatever trailing whitespace
 * there is — not a full `String#trim()`.** `String#trim()` strips leading
 * whitespace from the *first line only*, which is fine for a one-line scalar
 * and wrong for a Markdown body: a body opening with an indented code block or
 * a nested list item is a paragraph followed by an orphaned indented block
 * once line one's own indentation is gone, which is Markdown that renders
 * wrong and reads wrong (Task 8 review, I-1). Trimming is still required —
 * not cosmetic — because `renderCaptureFile` emits `content` after a blank
 * line and ends it with a newline, so the body `parseCaptureFile` recovers is
 * exactly `\n${content}\n`; without stripping that wrapper the round trip
 * would grow a leading blank line on every review. Stripping *one* leading
 * newline is exactly enough to undo that wrapper and no more: it cannot touch
 * the indentation the finding is about, because indentation is spaces and
 * tabs, never the newline this strips. `trimEnd()` handles the trailing `\n`
 * the same wrapper adds, and a real capture has no trailing whitespace worth
 * preserving.
 */
function normalizeBody(text: string): string {
  const foldedLineEndings = text.replace(LINE_ENDINGS, "\n");
  const withoutWrapperNewline = foldedLineEndings.startsWith("\n")
    ? foldedLineEndings.slice(1)
    : foldedLineEndings;

  return withoutWrapperNewline
    .replace(STRUCTURAL_CONTROLS, " ")
    .replace(INVISIBLE_FORMAT, "")
    .normalize("NFC")
    .trimEnd();
}

/**
 * A scalar that will be written into frontmatter and printed in a terminal.
 * `screenControlCharacters` collapses it to one line, which is the property
 * that matters here: a multi-line value is emitted as an indented block scalar
 * a hand edit can break, and spec §5.3 requires `projectSlug` — which is
 * human-readable by design and can therefore carry a client name — to be
 * screened like every other interpolated string in this product.
 *
 * Exported for `parse.ts`, which screens the same fields on the way back in: a
 * hand edit is how a Trojan Source character reaches a vault file, and the two
 * paths must apply one screen rather than two similar ones. Screening is
 * idempotent, which is what lets `parse(render(x))` return `x`.
 */
export function screenEnvelopeScalar(value: string): string {
  return screenControlCharacters(value);
}

export interface NormalizedCapture {
  readonly content: string;
  readonly deduplicationHash: string;
  readonly redaction: readonly CaptureRedactionFinding[];
}

/**
 * Redact, then normalize, then hash. **The order is the whole point**, and the
 * way it is enforced is that this is the only function in the package that
 * hashes capture text: it takes the raw text and the redaction callback
 * together, so there is no seam at which a caller could hash something else.
 * A reviewer checks the rule by grepping for `createHash` — one hit, three
 * lines below a `redact` call it cannot skip.
 *
 * Both the capture path and the review path go through here, which is what
 * makes spec §3.4's "the edit path redacts as hard as the capture path" a
 * property rather than a promise: two implementations of it would eventually
 * disagree, and the one that drifted would be the one reading attacker-edited
 * text.
 *
 * The findings are rebuilt as class and fingerprint rather than passed through,
 * so a widened `RedactionFinding` upstream cannot carry a secret's location
 * into a persisted envelope without someone deciding to.
 */
export function redactAndNormalize(
  text: string,
  redact: (text: string) => RedactionResult,
): NormalizedCapture {
  const redacted = redact(text);
  const content = normalizeBody(redacted.text);

  return {
    content,
    deduplicationHash: createHash("sha256").update(content, "utf8").digest("hex"),
    redaction: redacted.findings.map((finding) => ({
      class: finding.class,
      fingerprint: finding.fingerprint,
    })),
  };
}

/**
 * The capture pipeline, spec §5.1, in this order and no other:
 *
 * ```text
 * text → redact → normalize → deduplicationHash → captureId → envelope + body
 * ```
 *
 * **The raw text exists only in memory.** It is never written, never logged,
 * never hashed and never sent to a model — the hash is taken over the redacted,
 * normalized content, which is why two texts differing only by a secret produce
 * one capture id. That is a consequence rather than an accident: the observation
 * is the same observation, and nothing of the second secret survives the
 * duplicate.
 *
 * No branch here refuses anything. Empty text is a capture of empty content,
 * with a well-defined id; whether that is worth writing is the caller's
 * question, and `developer-os capture` answers it before it gets here.
 */
export function buildCapture(request: CaptureBuildRequest): CaptureBuildResult {
  const { content, deduplicationHash, redaction } = redactAndNormalize(
    request.text,
    request.redact,
  );
  const captureId = deduplicationHash.slice(0, CAPTURE_ID_LENGTH);

  const envelope: CaptureEnvelopeV1 = {
    schemaVersion: 1,
    captureId,
    sourceAgent: screenEnvelopeScalar(request.sourceAgent),
    sourceAgentVersion: screenEnvelopeScalar(request.sourceAgentVersion),
    captureMethod: screenEnvelopeScalar(request.captureMethod),
    /** Spec §5.3: `null` unless an adapter exposes one *stably*, and today neither does. */
    sourceSessionId: null,
    projectSlug: screenEnvelopeScalar(request.projectSlug),
    workingDirectoryFingerprint: screenEnvelopeScalar(
      request.workingDirectoryFingerprint,
    ),
    createdAt: screenEnvelopeScalar(request.createdAt),
    content,
    deduplicationHash,
    status: "quarantined",
    redaction,
  };

  return {
    envelope,
    fileName: `${captureId}.md`,
    contents: renderCaptureFile(envelope),
  };
}
