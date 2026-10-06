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
