import { describe, expect, it } from "vitest";

import {
  encodeIngestAttempts,
  nextIngestAttempts,
  orderByAttempts,
  parseIngestAttempts,
} from "./ingest-attempts.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("the ingest attempt-order record (NEW-141)", () => {
  it("reads fresh init's empty reservation as no record, and writes no record back as empty", () => {
    expect(parseIngestAttempts(new Uint8Array()).size).toBe(0);
    expect(encodeIngestAttempts(new Map()).byteLength).toBe(0);
  });

  it("round-trips through its canonical encoding", () => {
    const attempts = new Map([["b", 2], ["a", 1]]);
    const encoded = encodeIngestAttempts(attempts);
    expect(new TextDecoder().decode(encoded)).toBe('{"attempts":{"a":1,"b":2},"schemaVersion":1}\n');
    expect(parseIngestAttempts(encoded)).toStrictEqual(new Map([["a", 1], ["b", 2]]));
  });

  it("refuses anything that is not the record", () => {
    for (const text of [
      "[]\n",
      '{"attempts":{},"schemaVersion":2}\n',
      '{"attempts":{"a":0},"schemaVersion":1}\n',
      '{"attempts":{"a":1.5},"schemaVersion":1}\n',
      '{"attempts":{"a":1},"extra":1,"schemaVersion":1}\n',
    ]) {
      expect(() => parseIngestAttempts(bytes(text)), text).toThrow();
    }
  });

  it("round-trips a __proto__ capture id as an own entry, never as a prototype", () => {
    const attempts = new Map([["__proto__", 3]]);
    const parsed = parseIngestAttempts(encodeIngestAttempts(attempts));
    expect(parsed).toStrictEqual(attempts);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it("keeps the most-refused captures when the record would pass its byte cap", () => {
    const attempts = new Map(Array.from({ length: 40 }, (_unused, n) => [`id-${String(n).padStart(2, "0")}`, n + 1] as const));
    const full = encodeIngestAttempts(attempts);
    const capped = encodeIngestAttempts(attempts, Math.floor(full.byteLength / 2));
    expect(capped.byteLength).toBeLessThanOrEqual(Math.floor(full.byteLength / 2));
    const kept = parseIngestAttempts(capped);
    expect(kept.size).toBeGreaterThan(0);
    expect(kept.size).toBeLessThan(40);
    expect(Math.min(...kept.values())).toBeGreaterThan(40 - kept.size);
    expect(encodeIngestAttempts(attempts, 1).byteLength).toBe(0);
  });

  it("orders fewest refusals first and keeps captureId order among equals", () => {
    const ids = ["a", "b", "c", "d"];
    expect(orderByAttempts(ids, (id) => id, new Map([["a", 2], ["c", 1]]))).toStrictEqual(["b", "d", "c", "a"]);
  });

  it("counts a refusal, drops an ingested or no-longer-accepted capture, and keeps an unselected one", () => {
    const next = nextIngestAttempts(
      new Map([["a", 1], ["b", 1], ["gone", 3]]),
      ["a", "b", "c", "d"],
      new Set(["a", "c"]),
      new Set(["b"]),
    );
    expect(next).toStrictEqual(new Map([["a", 2], ["c", 1]]));
  });
});
