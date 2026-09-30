/**
 * The capture envelope, as a **type and nothing else**.
 *
 * DOS-P6 owns the lifecycle: this package never constructs, transitions,
 * persists or reads one. The type lives here so the shape is frozen once, by
 * the subsystem that owns the vault's schema, rather than being invented a
 * second time by the pipeline that fills it in.
 *
 * Fields are design spec §13.1, verbatim in meaning if not in spelling.
 */
export type CaptureStatus =
  | "quarantined"
  | "accepted"
  | "rejected"
  | "staging"
  | "ingested"
  | "failed";

/**
 * In declaration order, and the order is part of the contract — it is the
 * lifecycle's own sequence, and a test pins it so a seventh status cannot be
 * added quietly or an existing one moved.
 */
export const CAPTURE_STATUSES: readonly CaptureStatus[] = Object.freeze([
  "quarantined",
  "accepted",
  "rejected",
  "staging",
  "ingested",
  "failed",
]);

/**
 * Class and fingerprint only. Never the value, never enough of it to
 * reconstruct one — the envelope is persisted and logged, and redaction happens
 * before both.
 *
 * The design spec disagrees with itself here and this takes the narrower half:
 * §13.1 says the envelope carries "classes and fingerprints only", while §13.2
 * says a finding records "class, source path or field, location where safe, and
 * a non-reversible fingerprint". The point of freezing the shape in this
 * package is that DOS-P6 does not get to invent it a second time, so the
 * disagreement is recorded rather than silently resolved: widening this to
 * carry a location is a decision for the subsystem whose threat model owns
 * untrusted input, not a gap to fill in passing.
 *
 * **One widening was decided, and it is not a location** (founder decision D73, NEW-24): a
 * `user-pattern` finding carries `patternIndex`, the zero-based row of the `[redaction]`
 * table that produced it. It names the user's own configuration, never the text matched.
 */
export interface CaptureRedactionFinding {
  readonly class: string;
  readonly fingerprint: string;
  readonly patternIndex?: number;
}

/** The note a note capture replaces or creates, recorded at capture time. */
export interface CaptureNoteTargetV1 {
  /** Content-root-relative, POSIX, byte-exact; passes `isUnsafeProposedNotePath` as `false`. */
  readonly path: string;
  /** SHA-256 lowercase hex of the destination's bytes at capture time; `null` when it did not exist. */
  readonly beforeSha256: string | null;
}

export interface CaptureEnvelopeV1 {
  readonly schemaVersion: 1;
  readonly captureId: string;
  readonly sourceAgent: string;
  /** The version detected at capture time, not the one configured. */
  readonly sourceAgentVersion: string;
  readonly captureMethod: string;
  /** `null` unless the adapter exposes a session identity *stably*. */
  readonly sourceSessionId: string | null;
  readonly projectSlug: string;
  readonly workingDirectoryFingerprint: string;
  readonly createdAt: string;
  /** Redacted and normalized. The raw text never reaches this field. */
  readonly content: string;
  /** Computed **after** redaction, so it cannot fingerprint a secret. */
  readonly deduplicationHash: string;
  readonly status: CaptureStatus;
  readonly redaction: readonly CaptureRedactionFinding[];
  /** `null` for a plain capture; preserved, never recomputed, like `captureId`. */
  readonly note: CaptureNoteTargetV1 | null;
}
