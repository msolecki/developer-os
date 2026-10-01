import { describe, expect, it } from "vitest";

import { computePulse, parsePulseHeader, renderPulseReport } from "./pulse-verdict.js";
import type { PulseInputV1 } from "./pulse-verdict.js";

const base: PulseInputV1 = {
  now: new Date("2026-10-05T08:00:00Z"),
  doctorFailing: 0,
  lintErrors: 0,
  quarantined: [],
  accepted: [],
  notes: 200,
  edges: 400,
  isolated: 3,
  gaps: 1,
  indexGeneratedAt: "2026-10-04T17:00:00Z",
  gardenLast: ["success"],
};

describe("computePulse", () => {
  it("is healthy on a quiet week", () => {
    expect(computePulse(base, null).header.verdict).toBe("healthy");
  });
  it("fails on a doctor failure", () => {
    expect(computePulse({ ...base, doctorFailing: 1 }, null).header.verdict).toBe("failure");
  });
  it("fails on lint errors", () => {
    expect(computePulse({ ...base, lintErrors: 2 }, null).header.verdict).toBe("failure");
  });
  it("fails after two gardener failures in a row", () => {
    expect(computePulse({ ...base, gardenLast: ["failed", "failed"] }, null).header.verdict).toBe("failure");
    expect(computePulse({ ...base, gardenLast: ["failed", "success"] }, null).header.verdict).toBe("attention");
  });
  it("needs attention when a capture waited more than 14 days", () => {
    expect(computePulse({ ...base, quarantined: [{ createdAt: "2026-09-20T07:59:00Z" }] }, null).header.verdict).toBe("attention");
    expect(computePulse({ ...base, quarantined: [{ createdAt: "2026-09-21T08:01:00Z" }] }, null).header.verdict).toBe("healthy");
  });
  it("needs attention when accepted captures wait more than 14 days for ingest", () => {
    expect(computePulse({ ...base, accepted: [{ createdAt: "2026-09-20T07:59:00Z" }] }, null).header.verdict).toBe("attention");
  });
  it("needs attention when isolated grew two reports in a row", () => {
    const prev = { date: "2026-09-28", verdict: "healthy", isolated: 2, isolatedGrew: true } as const;
    expect(computePulse(base, prev).header.verdict).toBe("attention");
    expect(computePulse(base, { ...prev, isolatedGrew: false }).header).toMatchObject({ verdict: "healthy", isolatedGrew: true });
  });
  it("needs attention when the gardener skipped for a full queue", () => {
    expect(computePulse({ ...base, gardenLast: ["skipped_review_queue_full"] }, null).header.verdict).toBe("attention");
  });
  it("needs attention when the index is older than 8 days, and on an empty vault reports without a trend", () => {
    expect(computePulse({ ...base, indexGeneratedAt: "2026-09-26T07:59:00Z" }, null).header.verdict).toBe("attention");
    expect(() => computePulse({ ...base, notes: 0, edges: 0, isolated: 0, indexGeneratedAt: null }, null)).not.toThrow();
  });
  it("round-trips the header line", () => {
    const { header, reasons } = computePulse(base, null);
    expect(parsePulseHeader(renderPulseReport(header, reasons, base))).toEqual(header);
  });
  it("parses nothing from an empty or foreign first line", () => {
    expect(parsePulseHeader("")).toBeNull();
    expect(parsePulseHeader("<!-- pulse {\"date\":1} -->\n")).toBeNull();
  });
});
