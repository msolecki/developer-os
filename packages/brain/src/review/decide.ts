import type { CaptureEnvelopeV1, CaptureStatus } from "../schema/capture.js";

/**
 * What a human decides about one quarantined capture, spec §5.6. Three words
 * and no fourth: `edit` is the one that re-reads the file, and it is a *content*
 * transition rather than a status transition — which is why it appears here
 * beside two that move a status.
 */
export type ReviewDecision = "accept" | "reject" | "edit";

export type ReviewOutcome =
  | { readonly ok: true; readonly envelope: CaptureEnvelopeV1 }
  | { readonly ok: false; readonly reason: "illegal-transition" };

/**
 * In the order spec §5.6 lists them. Exported so a caller reporting what it
 * would have accepted — `developer-os review`'s refusal message — names the
 * three words from the one place they are defined, rather than from a fourth
 * copy that can drift.
 */
export const REVIEW_DECISIONS: readonly ReviewDecision[] = Object.freeze([
  "accept",
  "reject",
  "edit",
]);

export function isReviewDecision(value: string): value is ReviewDecision {
  return (REVIEW_DECISIONS as readonly string[]).includes(value);
}

/**
 * The one status a decision is legal from. Spec §5.5's table has no other row
 * whose "By" column is `review`: `accepted → staging` and `staging → ingested`
 * belong to `ingest`, and `rejected` is terminal for automation.
 */
const REVIEWABLE: CaptureStatus = "quarantined";

/**
 * Spec §5.5's transition table, as a table. `edit` maps to the status it came
 * from rather than to a new one, because **no status means "edited"**: design
 * spec §13.1's list has six members, `CAPTURE_STATUSES` is frozen in that order,
 * and recording an edit would mean adding a seventh to say what the file's own
 * mtime already says.
 */
const DECIDED: Readonly<Record<ReviewDecision, CaptureStatus>> = Object.freeze({
  accept: "accepted",
  reject: "rejected",
  edit: REVIEWABLE,
});

/**
 * Applies one review decision to one envelope, or refuses.
 *
 * **A status and nothing else.** The envelope is returned with its `status`
 * replaced and every other field carried through untouched — `captureId` above
 * all, which is assigned once at capture time and never recomputed (spec §5.3,
 * amended by the founder on 2026-08-13). Under recomputation every
 * content-changing edit would refuse, and the secret a user pasted into the
 * vault would stay there, which is the one outcome the edit path exists to
 * prevent.
 *
 * The content transition an `edit` really is happens in `parseCaptureFile`,
 * which re-redacts the body and recomputes `deduplicationHash` and `redaction`
 * on the way in. This function sees the result of that and decides only whether
 * the capture was in a state a human may still decide on.
 *
 * **A refusal is retryable and never `failed`.** `illegal-transition` says the
 * capture already holds a status this decision cannot move — it says nothing
 * about the capture being broken, and nothing is written.
 */
export function applyReviewDecision(
  envelope: CaptureEnvelopeV1,
  decision: ReviewDecision,
): ReviewOutcome {
  if (envelope.status !== REVIEWABLE) {
    return { ok: false, reason: "illegal-transition" };
  }
  return { ok: true, envelope: { ...envelope, status: DECIDED[decision] } };
}
