import { describe, expect, it } from "vitest";

import {
  decodeTenDigitOrdinal,
  encodeTenDigitOrdinal,
  parseLowerHexSha256,
  parseLowercaseKebabId,
  parsePositiveUInt32,
  parseSafeReasonCode,
  parseSchemaMigrationId,
  parseStableSemver,
  parseUInt64Decimal,
  parseUtcTimestamp,
} from "./scalars.js";

describe("stable update scalars", () => {
  it.each(["0.0.0", "4294967295.4294967295.4294967295"])(
    "catches a StableSemver parser that refuses an admitted boundary %s",
    (value) => {
      expect(parseStableSemver(value)).toBe(value);
    },
  );

  it.each(["4294967296.0.0", "01.0.0", "1.0.0-rc.1", "1.0.0+build"])(
    "catches a StableSemver parser that accepts a nonstable or overflowing component %s",
    (value) => {
      expect(() => parseStableSemver(value)).toThrow();
    },
  );

  it.each(["0", "18446744073709551615"])(
    "catches a UInt64 parser that refuses admitted canonical decimal %s",
    (value) => {
      expect(parseUInt64Decimal(value)).toBe(value);
    },
  );

  it.each(["00", "01", "+1", "18446744073709551616"])(
    "catches a UInt64 parser that accepts a noncanonical or overflowing decimal %s",
    (value) => {
      expect(() => parseUInt64Decimal(value)).toThrow();
    },
  );

  it.each([1, 4_294_967_295])(
    "catches a PositiveUInt32 parser that refuses admitted boundary %s",
    (value) => {
      expect(parsePositiveUInt32(value)).toBe(value);
    },
  );

  it.each([0, 4_294_967_296, 1.5])(
    "catches a PositiveUInt32 parser that accepts zero, overflow, or fractions %s",
    (value) => {
      expect(() => parsePositiveUInt32(value)).toThrow();
    },
  );

  it.each(["0000000000", "0000999999"])("round-trips canonical ordinal %s", (value) => {
    expect(encodeTenDigitOrdinal(decodeTenDigitOrdinal(value))).toBe(value);
  });

  it.each(["0", "1", "00000000000", "+000000001", "00000000١٠"])(
    "catches an ordinal decoder that accepts noncanonical spelling %s",
    (value) => {
      expect(() => decodeTenDigitOrdinal(value)).toThrow();
    },
  );

  it("catches scalar parsers that accept uppercase hash, invalid calendar time, or invalid IDs", () => {
    expect(parseLowerHexSha256("a".repeat(64))).toBe("a".repeat(64));
    expect(() => parseLowerHexSha256("A".repeat(64))).toThrow();
    expect(parseUtcTimestamp("2026-08-29T12:34:56.789Z")).toBe("2026-08-29T12:34:56.789Z");
    expect(() => parseUtcTimestamp("2026-02-29T12:34:56.789Z")).toThrow();
    expect(parseLowercaseKebabId("a9-z0")).toBe("a9-z0");
    expect(() => parseLowercaseKebabId("a--z")).toThrow();
    expect(parseSafeReasonCode("plan_refused_2")).toBe("plan_refused_2");
    expect(() => parseSafeReasonCode("Plan-refused")).toThrow();
    expect(parseSchemaMigrationId("migration_schema-v2")).toBe("migration_schema-v2");
    expect(() => parseSchemaMigrationId("migration_schema_v2")).toThrow();
  });
});
