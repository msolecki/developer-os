import { describe, expect, it } from "vitest";

import * as captureModule from "./capture.js";
import { CAPTURE_STATUSES } from "./capture.js";

describe("CaptureEnvelopeV1", () => {
  it("declares the six statuses in the lifecycle's own order", () => {
    /**
     * Order is contract, not presentation: it is the sequence a capture moves
     * through. Pinning the array stops a seventh status appearing quietly and
     * stops an existing one being reordered.
     */
    expect(CAPTURE_STATUSES).toEqual([
      "quarantined",
      "accepted",
      "rejected",
      "staging",
      "ingested",
      "failed",
    ]);
  });

  it("freezes the list rather than handing out a mutable one", () => {
    expect(Object.isFrozen(CAPTURE_STATUSES)).toBe(true);
    expect(() => (CAPTURE_STATUSES as CaptureStatusArray).push("archived")).toThrow();
  });

  it("exports a type and a constant, and no behaviour", () => {
    /**
     * The plan is explicit that DOS-P6 owns the lifecycle and this package
     * "never constructs, transitions, or persists one". Types vanish at
     * runtime, so the only way to hold that line mechanically is to assert the
     * module's runtime surface — a constructor or a transition helper added
     * here fails this, which is the moment to ask whether it belongs in DOS-P6.
     */
    expect(Object.keys(captureModule)).toEqual(["CAPTURE_STATUSES"]);
  });
});

type CaptureStatusArray = string[];
