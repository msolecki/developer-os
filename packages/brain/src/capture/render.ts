import { stringify } from "yaml";

import type { CaptureEnvelopeV1 } from "../schema/capture.js";

/**
 * `lineWidth: 0` disables line folding. A folded plain scalar does round-trip
 * through this library — a fold reads back as the space it replaced — but it
 * also means a long `projectSlug` is stored as two lines that a human editing
 * the file in Obsidian will rejoin by hand, differently. The vault is a place
 * users edit, so the file says what it means on one line.
 *
 * Everything else is the library's default on purpose, and the one that
 * matters is its quoting: `yaml` quotes any scalar whose plain form would
 * resolve as another type, which is what keeps an all-digit `captureId` a
 * string on the way back in. A hand-rolled emitter is the obvious alternative
 * and it is the one that gets that wrong.
 */
const FRONTMATTER_STRINGIFY_OPTIONS = Object.freeze({ lineWidth: 0 } as const);

/**
 * The envelope as YAML frontmatter, the redacted content as the Markdown body —
 * design spec §3.4. One file, readable and editable in Obsidian without the
 * CLI, which is what makes the `edit` decision cheap and what makes the parse
 * side re-redact as hard as the capture side.
 *
 * **The mapping is built field by field rather than spread from the envelope**,
 * and both halves of that are deliberate:
 *
 * - `content` is excluded, because it is the body. Emitting it in frontmatter
 *   too would store the same text twice and give a hand edit two places to
 *   disagree.
 * - Anything the caller's object carries beyond the frozen type — a field a
 *   future `CaptureEnvelopeV1` gains, a stray property on a value that came
 *   from `JSON.parse` — is dropped rather than written. The same applies inside
 *   a finding: `CaptureRedactionFinding` is class and fingerprint only, and
 *   `packages/brain/src/schema/capture.ts` records that widening it to carry a
 *   location is a decision for the subsystem that owns the threat model. A
 *   spread would ship that widening silently, on the day someone else made it.
 */
export function renderCaptureFile(envelope: CaptureEnvelopeV1): string {
  const frontmatter = stringify(
    {
      schemaVersion: envelope.schemaVersion,
      captureId: envelope.captureId,
      sourceAgent: envelope.sourceAgent,
      sourceAgentVersion: envelope.sourceAgentVersion,
      captureMethod: envelope.captureMethod,
      sourceSessionId: envelope.sourceSessionId,
      projectSlug: envelope.projectSlug,
      workingDirectoryFingerprint: envelope.workingDirectoryFingerprint,
      createdAt: envelope.createdAt,
      deduplicationHash: envelope.deduplicationHash,
      status: envelope.status,
      redaction: envelope.redaction.map((finding) => ({
        class: finding.class,
        fingerprint: finding.fingerprint,
      })),
    },
    FRONTMATTER_STRINGIFY_OPTIONS,
  );

  return `---\n${frontmatter}---\n\n${envelope.content}\n`;
}
