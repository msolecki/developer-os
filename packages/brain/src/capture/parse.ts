import { parseAllDocuments } from "yaml";

import type { RedactionResult } from "@developer-os/security";

import { CAPTURE_STATUSES } from "../schema/capture.js";
import type { CaptureEnvelopeV1, CaptureStatus } from "../schema/capture.js";
import { FRONTMATTER, FRONTMATTER_PARSE_OPTIONS } from "../schema/note.js";
import { redactAndNormalize, screenEnvelopeScalar } from "./build.js";

/**
 * `unparseable` — the file is not a capture: no frontmatter block, invalid
 * YAML, a second YAML document, a field of the wrong type, or an id that is
 * not an id. `schema-version` and `unknown-status` name the two cases a reader
 * can act on. `id-mismatch` is the frontmatter `captureId` disagreeing with the
 * file's name — a rename, or a hand-edited id field.
 *
 * There is deliberately **no refusal for a content edit**. The id is assigned
 * once at capture time and never recomputed (spec §5.3, amended by the founder
 * on 2026-08-13): under recomputation every content-changing edit would refuse,
 * and the secret a user pasted would stay in the vault file — the one outcome
 * `capture.edit` exists to prevent.
 */
export type CaptureFileRefusal =
  | "unparseable"
  | "schema-version"
  | "unknown-status"
  | "id-mismatch";

export type CaptureFileOutcome =
  | { readonly ok: true; readonly envelope: CaptureEnvelopeV1 }
  | { readonly ok: false; readonly reason: CaptureFileRefusal };

/**
 * What `buildCapture` writes: the first 16 characters of a lowercase hex
 * digest. Checked rather than assumed, because the comparison below is against
 * a filename, and a frontmatter id of arbitrary text would otherwise be legal
 * as long as someone named the file after it.
 */
const CAPTURE_ID = /^[0-9a-f]{16}$/u;

/** The library's own default, pinned so a change to it cannot quietly remove the only alias bound here. */
const MAX_ALIAS_COUNT = 100;

function refuse(reason: CaptureFileRefusal): CaptureFileOutcome {
  return { ok: false, reason };
}

function isStatus(value: unknown): value is CaptureStatus {
  return (
    typeof value === "string" &&
    (CAPTURE_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * A required string field, screened. `null` means the field is absent or is not
 * a string — which covers the values an explicit YAML tag constructs, since a
 * `Date` from `!!timestamp` and a `Buffer` from `!!binary` are both objects.
 * That is why this parser needs no separate tag visitor: every field it reads
 * is checked as the type it must be.
 */
function scalar(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" ? screenEnvelopeScalar(value) : null;
}

/**
 * The frontmatter block as a mapping, and the body verbatim — or `null` when
 * the file is not one this parser can read at all. Everything structural lives
 * here, so the function below is only the precedence of the four refusals.
 *
 * `parseAllDocuments` with `FRONTMATTER_PARSE_OPTIONS`, both inherited from
 * `schema/note.ts` rather than restated. The options object carries
 * `uniqueKeys` — without it a duplicate `status` resolves last-one-wins and the
 * validator only ever sees the survivor — and `logLevel: "silent"`, without
 * which the library prints warnings *with the offending source line* to stderr,
 * past every redaction seam. `parseDocument` is the trap: it returns the first
 * document with no error while silently discarding everything after a `...` end
 * marker, so a capture could carry a second frontmatter block that nothing
 * validated.
 */
function readFrontmatter(
  text: string,
): { readonly fields: Record<string, unknown>; readonly body: string } | null {
  const match = FRONTMATTER.exec(text);
  if (match === null) return null;

  const body = match[2] ?? "";
  let raw: unknown;
  try {
    const documents = parseAllDocuments(match[1] ?? "", FRONTMATTER_PARSE_OPTIONS);
    const document = documents[0];
    if (documents.length > 1 || (document?.errors.length ?? 0) > 0) return null;
    raw =
      document === undefined
        ? null
        : (document.toJS({ maxAliasCount: MAX_ALIAS_COUNT }) as unknown);
  } catch {
    return null;
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  return { fields: raw as Record<string, unknown>, body };
}

/** `undefined` for "neither of its two legal types", which is a refusal. */
function readSessionId(
  fields: Record<string, unknown>,
): string | null | undefined {
  const value = fields.sourceSessionId;
  if (value === null) return null;
  return typeof value === "string" ? screenEnvelopeScalar(value) : undefined;
}

/**
 * Reads a capture file back into an envelope, re-redacting its body on the way.
 *
 * **The file name is the first argument because the id *is* the file name**
 * (spec §5.2): the check is a comparison against it, not against a field the
 * file could carry twice. A path is not a name and refuses — the caller
 * enumerating a directory knows which of the two it holds.
 *
 * **Three fields are recomputed rather than read**: `content`,
 * `deduplicationHash` and `redaction`. A hand edit is legitimate, and it is how
 * a secret gets pasted into a vault file, so the body is re-redacted here — on
 * the review path — rather than being trusted until ingest. Everything else in
 * the envelope is preserved.
 *
 * **Refusal precedence is part of the contract.** Structural refusals are
 * decided before the id comparison, because a file whose frontmatter cannot be
 * read has no id to compare; without that ordering, every malformed file could
 * be reported as an `id-mismatch` and the reason would stop naming anything.
 */
export function parseCaptureFile(
  fileName: string,
  text: string,
  redact: (text: string) => RedactionResult,
): CaptureFileOutcome {
  const read = readFrontmatter(text);
  if (read === null) return refuse("unparseable");
  const { fields, body } = read;

  /**
   * Version first, because it decides what the rest of the keys *mean*. An
   * absent version is refused the same way an unsupported one is: a file that
   * does not say which schema it is written in is not one this product can
   * claim to understand.
   */
  if (fields.schemaVersion !== 1) return refuse("schema-version");

  const status = fields.status;
  if (!isStatus(status)) return refuse("unknown-status");

  const sourceAgent = scalar(fields, "sourceAgent");
  const sourceAgentVersion = scalar(fields, "sourceAgentVersion");
  const captureMethod = scalar(fields, "captureMethod");
  const projectSlug = scalar(fields, "projectSlug");
  const workingDirectoryFingerprint = scalar(fields, "workingDirectoryFingerprint");
  const createdAt = scalar(fields, "createdAt");
  /**
   * The one field with two legal types, and the one place a "treat anything
   * unrecognised as null" reading would hide: it would turn a hand-edited
   * `sourceSessionId: 42` into a `null` the envelope then presents as the
   * file's own value. `undefined` here means *neither* legal type — absent, or
   * present as something that is not a string — and is refused with the rest.
   *
   * `null` is a value rather than an absence: every capture written today
   * carries it explicitly, because no adapter exposes a session identity
   * stably (spec §5.3).
   */
  const sourceSessionId = readSessionId(fields);

  if (
    sourceSessionId === undefined ||
    sourceAgent === null ||
    sourceAgentVersion === null ||
    captureMethod === null ||
    projectSlug === null ||
    workingDirectoryFingerprint === null ||
    createdAt === null
  ) {
    return refuse("unparseable");
  }

  /**
   * Last, and as **one** question: is the frontmatter id the name of this file?
   * Every way of failing it is the same failure, including a `captureId` that
   * is not a 16-character hex string at all — an all-digit id written unquoted
   * by hand resolves as a *number*, and reporting that as `unparseable` would
   * name the whole file broken when the only broken thing is the id the user
   * edited. `renderCaptureFile` quotes the id precisely so a file this product
   * wrote never arrives in that state.
   */
  const captureId = fields.captureId;
  if (
    typeof captureId !== "string" ||
    !CAPTURE_ID.test(captureId) ||
    fileName !== `${captureId}.md`
  ) {
    return refuse("id-mismatch");
  }

  const { content, deduplicationHash, redaction } = redactAndNormalize(body, redact);

  return {
    ok: true,
    envelope: {
      schemaVersion: 1,
      captureId,
      sourceAgent,
      sourceAgentVersion,
      captureMethod,
      sourceSessionId,
      projectSlug,
      workingDirectoryFingerprint,
      createdAt,
      content,
      deduplicationHash,
      status,
      redaction,
    },
  };
}
