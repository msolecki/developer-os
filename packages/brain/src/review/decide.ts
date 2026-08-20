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
 * The status `edit` maps back to. It was named for being the one status every decision was
 * legal from, which stopped being true when `reject` gained its `accepted` row — the name is
 * kept because `DECIDED.edit` reads correctly with it, and `LEGAL_FROM` is now the authority
 * on where a decision may be taken.
 */
const REVIEWABLE: CaptureStatus = "quarantined";

/**
 * **Which statuses each decision may be taken from.** `reject` has two rows and the other
 * two have one, decided by the founder on 2026-08-17 and landed on 2026-08-20: a user who accepts a capture and then
 * changes their mind — or whose capture refuses ingest deterministically — previously had
 * only a hand edit of the file's frontmatter, which is what both of `ingest`'s recovery
 * strings told them to do. A product recommending a hand edit of its own data is the gap this
 * row closes — **for the ingest-failure half**. The change-of-mind half still needs an id the
 * user already holds, because `review`'s listing shows `quarantined` only; that is NEW-41.

 *
 * **`accept` and `edit` deliberately do not gain the second row.** Re-accepting an accepted
 * capture is not a transition: the table's job is to move a capture between states, and
 * `accepted → accepted` has no row to add. An earlier version of this paragraph called it a
 * no-op whose success message would lie — both halves false, since every decision re-redacts
 * and rewrites the file, and `Reviewed <id>, now accepted.` is true of an accepted capture.
 * And `edit` maps to
 * `quarantined` — it is a content transition whose *status* result is the reviewable one — so
 * `edit` from `accepted` would silently withdraw an approval as a side effect of changing the
 * text. The verb's name says nothing about un-approving, and a user who wants that has
 * `reject`. An earlier version of this paragraph said `edit` would "re-open content in a
 * status `ingest` polls", which is backwards: `ingest` polls `accepted`, not `quarantined`,
 * so the move would take the capture *out* of the queue rather than leave it there.
 *
 * **Rejection is the only direction that is safe from `accepted`**, verified rather than
 * assumed: `ingest` selects `accepted` only, and no later phase *selects* `rejected` at all,
 * so a rejected capture orphans nothing. `capture` does read it — see the cost below — but
 * only to report a duplicate.
 *
 * A capture at `accepted` can never have notes on disk **by any transition `ingest` takes**:
 * it rolls back to `accepted` only when nothing was applied. The qualifier is load-bearing,
 * because the product still tells a user to hand-edit a partly-applied capture to `accepted`
 * after removing its notes — and a user who removes nothing creates the exception.
 *
 * **What it costs the user, since nothing transitions out.** `capture` treats a duplicate as
 * already captured and exits 0 naming the rejected capture, because the id is the content
 * hash — so rejecting is irreversible through the product *and* blocks re-capturing that
 * content. That is the cost `quarantined → rejected` always carried; this row does not change
 * it, it makes it reachable from a status a user is more likely to be in.
 *
 * **`CAPTURE_STATUSES` gains no member.** This adds a row to a transition table, not a
 * seventh status. Amends spec §5.5's table; `BACKLOG.md` §8 carries the row.
 */
const LEGAL_FROM: Readonly<Record<ReviewDecision, readonly CaptureStatus[]>> =
  Object.freeze({
    accept: Object.freeze<readonly CaptureStatus[]>(["quarantined"]),
    reject: Object.freeze<readonly CaptureStatus[]>(["quarantined", "accepted"]),
    edit: Object.freeze<readonly CaptureStatus[]>(["quarantined"]),
  });

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
  if (!LEGAL_FROM[decision].includes(envelope.status)) {
    return { ok: false, reason: "illegal-transition" };
  }
  return { ok: true, envelope: { ...envelope, status: DECIDED[decision] } };
}

/**
 * The decisions legal from a status, in `REVIEW_DECISIONS` order. Exported so a caller
 * refusing an illegal transition can say what *is* available from where the capture actually
 * is, rather than telling the user to hand-edit their own data back into a status the product
 * can act on — which is the advice this table was widened to stop giving.
 */
export function decisionsFrom(
  status: CaptureStatus,
): readonly ReviewDecision[] {
  return REVIEW_DECISIONS.filter((decision) =>
    LEGAL_FROM[decision].includes(status),
  );
}
