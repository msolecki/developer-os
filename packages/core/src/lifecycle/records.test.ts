import { describe, expect, it } from "vitest";

import type { LifecycleIdAllocatorV1 } from "../manifest/bootstrap.js";
import { parseLowerHexSha256, parseUInt64Decimal, parseUtcTimestamp } from "../update/scalars.js";
import { formatAllocatedLifecycleId, parseLifecycleCoordinatorId } from "./ids.js";
import {
  encodeLifecycleIdAllocator,
  encodeUninstallingMarker,
  parseLifecycleIdAllocator,
  parseLifecycleInstallNonce,
} from "./records.js";
import type { UninstallingMarkerV1 } from "./records.js";

const encoder = new TextEncoder();
const NONCE = parseLowerHexSha256("a".repeat(64));
const OTHER_NONCE = parseLowerHexSha256("b".repeat(64));

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

function coordinator(nonce: typeof NONCE, counter: bigint) {
  return parseLifecycleCoordinatorId(formatAllocatedLifecycleId("lc", nonce, counter), nonce);
}

describe("the installation nonce file", () => {
  it("is exactly 64 lowercase hex bytes plus one LF", () => {
    expect(parseLifecycleInstallNonce(bytes(`${NONCE}\n`))).toBe(NONCE);
  });

  it.each([
    ["no LF", "a".repeat(64)],
    ["CRLF", `${"a".repeat(64)}\r\n`],
    ["two LFs", `${"a".repeat(64)}\n\n`],
    ["uppercase hex", `${"A".repeat(64)}\n`],
    ["63 hex", `${"a".repeat(63)}\n`],
    ["65 hex", `${"a".repeat(65)}\n`],
    ["a leading LF", `\n${"a".repeat(64)}`],
  ])("refuses nonce bytes with %s", (_label, text) => {
    expect(() => parseLifecycleInstallNonce(bytes(text))).toThrow();
  });
});

describe("the lifecycle ID allocator record", () => {
  const allocator: LifecycleIdAllocatorV1 = {
    schemaVersion: 1,
    installNonce: NONCE,
    nextCounter: parseUInt64Decimal("0"),
  };

  it("round-trips through canonical bytes", () => {
    const encoded = encodeLifecycleIdAllocator(allocator);
    expect(encoded).toBe(`{"installNonce":"${NONCE}","nextCounter":"0","schemaVersion":1}\n`);
    expect(parseLifecycleIdAllocator(bytes(encoded), NONCE)).toEqual(allocator);
  });

  it.each([
    ["an extra key", `{"extra":1,"installNonce":"${NONCE}","nextCounter":"0","schemaVersion":1}\n`],
    ["a numeric nextCounter", `{"installNonce":"${NONCE}","nextCounter":1,"schemaVersion":1}\n`],
    ["non-canonical key order", `{"schemaVersion":1,"installNonce":"${NONCE}","nextCounter":"0"}\n`],
    ["a missing key", `{"installNonce":"${NONCE}","schemaVersion":1}\n`],
    ["schemaVersion 2", `{"installNonce":"${NONCE}","nextCounter":"0","schemaVersion":2}\n`],
    ["a leading-zero counter", `{"installNonce":"${NONCE}","nextCounter":"01","schemaVersion":1}\n`],
  ])("refuses allocator bytes with %s", (_label, text) => {
    expect(() => parseLifecycleIdAllocator(bytes(text), NONCE)).toThrow();
  });

  it("refuses 1,025 bytes before it parses them", () => {
    const oversized = bytes(`${" ".repeat(1024)}\n`);
    expect(oversized.byteLength).toBe(1025);
    expect(() => parseLifecycleIdAllocator(oversized, NONCE)).toThrow();
  });

  it("refuses an installNonce unequal to the file nonce", () => {
    const encoded = encodeLifecycleIdAllocator(allocator);
    expect(() => parseLifecycleIdAllocator(bytes(encoded), OTHER_NONCE)).toThrow();
  });
});

describe("the uninstalling marker", () => {
  const marker: UninstallingMarkerV1 = {
    schemaVersion: 1,
    coordinatorId: coordinator(NONCE, 5n),
    createdAt: parseUtcTimestamp("2026-09-17T12:00:00.000Z"),
  };

  it("encodes canonical bytes", () => {
    const encoded = encodeUninstallingMarker(marker);
    expect(encoded).toBe(
      `{"coordinatorId":"lc_${NONCE}_5","createdAt":"2026-09-17T12:00:00.000Z","schemaVersion":1}\n`,
    );
  });
});
