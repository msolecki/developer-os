/**
 * Review: the decision one human makes about one quarantined capture.
 *
 * A pure transition table over `CaptureEnvelopeV1`, with the same property the
 * capture directory holds — **nothing here touches a filesystem, an
 * environment, a process, a clock or a key.** Reading the file, re-redacting it
 * and writing it back through a transaction all belong to the CLI; what belongs
 * here is which decisions are legal from which status, which is spec §5.5 and
 * is worth exactly one implementation.
 */
export {
  applyReviewDecision,
  decisionsFrom,
  isReviewDecision,
  REVIEW_DECISIONS,
} from "./decide.js";
export type { ReviewDecision, ReviewOutcome } from "./decide.js";
