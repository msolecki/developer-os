import { redactText } from "@developer-os/security";
import type { RedactionResult } from "@developer-os/security";
import { describe, expect, it } from "vitest";

import { buildCapture } from "../capture/build.js";
import { parseCaptureFile } from "../capture/parse.js";
import { renderCaptureFile } from "../capture/render.js";
import { CAPTURE_STATUSES } from "../schema/capture.js";
import type { CaptureEnvelopeV1, CaptureStatus } from "../schema/capture.js";
import { applyReviewDecision, REVIEW_DECISIONS } from "./decide.js";

const TEST_KEY = new Uint8Array(32).fill(7);
const redact = (text: string): RedactionResult => redactText(text, TEST_KEY);

/** Synthetic, like every fixture here: no real client, project or repository. */
const built = buildCapture({
  text: "an observation worth keeping",
  sourceAgent: "unknown",
  sourceAgentVersion: "unknown",
  captureMethod: "agent-authored",
  projectSlug: "synthetic-project",
  workingDirectoryFingerprint: "0f1e2d3c4b5a6978",
  createdAt: "2026-08-13T09:00:00.000Z",
  redact,
});

const envelope: CaptureEnvelopeV1 = built.envelope;

/**
 * Every status a capture can hold except the one a decision is legal from.
 * Derived from the frozen list rather than transcribed, so a seventh status
 * would arrive here as a refusal case rather than as an untested one — and the
 * count is asserted below, because a filter that silently emptied would leave
 * `it.each` generating no cases at all and the suite passing.
 */
const OTHER_STATUSES: readonly CaptureStatus[] = CAPTURE_STATUSES.filter(
  (status) => status !== "quarantined",
);

describe("applyReviewDecision", () => {
  it.each([
    ["quarantined", "accept", "accepted"],
    ["quarantined", "reject", "rejected"],
    ["quarantined", "edit", "quarantined"],
  ] as const)("moves %s under %s to %s", (from, decision, to) => {
    const outcome = applyReviewDecision({ ...envelope, status: from }, decision);
    expect(outcome.ok && outcome.envelope.status).toBe(to);
  });

  it.each(["accepted", "rejected", "staging", "ingested", "failed"] as const)(
    "refuses a decision against a capture already at %s",
    (from) => {
      expect(applyReviewDecision({ ...envelope, status: from }, "accept")).toEqual({
        ok: false,
        reason: "illegal-transition",
      });
    },
  );

  /**
   * The whole grid, and the count that makes it a gate: the case above pins one
   * decision against five statuses, which leaves ten pairs an implementation
   * could get wrong — `reject` from `ingested`, say — with nothing watching.
   */
  it("refuses every decision from every status but quarantined", () => {
    expect(OTHER_STATUSES).toHaveLength(5);
    expect(REVIEW_DECISIONS).toHaveLength(3);

    for (const from of OTHER_STATUSES) {
      for (const decision of REVIEW_DECISIONS) {
        expect(
          applyReviewDecision({ ...envelope, status: from }, decision),
          `${from} under ${decision}`,
        ).toStrictEqual({ ok: false, reason: "illegal-transition" });
      }
    }
  });

  /**
   * Spec §5.5: **no status means "edited"**. Design spec §13.1's list has none,
   * and adding one would put a seventh member into a frozen ordered list to
   * record something the file's own mtime already says — which is precisely why
   * `capture.edit` is a separate verb from `capture.setStatus`.
   *
   * The content change belongs to `parseCaptureFile`, which re-redacts and
   * re-hashes the body; what this function owes the edit path is to leave the
   * envelope exactly as it found it, so the assertion is the whole envelope
   * rather than its status alone.
   */
  it("changes content and not status under edit, because no status means edited", () => {
    const outcome = applyReviewDecision(envelope, "edit");

    expect(outcome.ok && outcome.envelope.status).toBe("quarantined");
    expect(outcome.ok && outcome.envelope).toStrictEqual(envelope);
  });

  /**
   * A decision changes a status and nothing else — `captureId` above all, which
   * is assigned once at capture time and never recomputed (spec §5.3, amended
   * by the founder on 2026-08-13). Without this, a decision that rebuilt the
   * envelope from its content would pass every status assertion above and still
   * rename the file out from under itself.
   */
  it.each(["accept", "reject"] as const)(
    "keeps every other field under %s, because a decision moves a status and nothing else",
    (decision) => {
      const outcome = applyReviewDecision(envelope, decision);

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.envelope).toStrictEqual({
        ...envelope,
        status: decision === "accept" ? "accepted" : "rejected",
      });
      expect(outcome.envelope.captureId).toBe(envelope.captureId);
    },
  );

  /**
   * Spec §5.5: **`rejected` is terminal for automation and not for the user.**
   * Nothing transitions out of it automatically; a user may edit the file's
   * status by hand, and the review path re-validates what they wrote rather
   * than remembering what the product last decided. The hand edit is made
   * through the file, not through the envelope, because the file is where a
   * user makes it and `parseCaptureFile` is the gate it has to pass.
   */
  it("accepts a rejected capture a user has hand-edited back to quarantined", () => {
    const rejected = renderCaptureFile({ ...envelope, status: "rejected" });
    const reopened = rejected.replace("status: rejected\n", "status: quarantined\n");
    expect(reopened, "the hand edit must actually change the file").not.toBe(rejected);

    const parsed = parseCaptureFile(built.fileName, reopened, redact);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.status).toBe("quarantined");
    const outcome = applyReviewDecision(parsed.envelope, "accept");
    expect(outcome.ok && outcome.envelope.status).toBe("accepted");
  });
});
