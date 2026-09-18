import { describe, expect, it } from "vitest";

import { parseLowerHexSha256 } from "../update/scalars.js";
import {
  LIFECYCLE_LEDGER_BOUNDS,
  UINT64_MAX,
  allocatedCounterOf,
  formatAllocatedLifecycleId,
  parseAllocatedFoundationMutationIndex,
  parseAllocatedLifecycleId,
  parseEffectiveUid,
  parseFoundationTransactionId,
  parseLegacyFoundationMutationIndex,
  parseLifecycleCoordinatorId,
  parseManifestParticipantId,
} from "./ids.js";
import type { LifecycleIdPrefixV1 } from "./ids.js";

const NONCE = parseLowerHexSha256("a".repeat(64));
const OTHER_NONCE = parseLowerHexSha256("b".repeat(64));
const LEGACY_UUID = "123e4567-e89b-42d3-a456-426614174000";

/**
 * A total record over the prefix union, so the table cannot drift from it: a new arm
 * fails to compile as a missing property, a removed arm as an excess one.
 */
const ID_BY_PREFIX: Record<LifecycleIdPrefixV1, string> = {
  tx: `tx_${NONCE}_1`,
  lc: `lc_${NONCE}_1`,
  ge: `ge_${NONCE}_1`,
  le: `le_${NONCE}_1`,
  mf: `mf_${NONCE}_1`,
};

const PREFIXES = Object.keys(ID_BY_PREFIX) as readonly LifecycleIdPrefixV1[];

describe("the allocated lifecycle ID grammar", () => {
  it("formats and parses the allocated grammar and binds it to the installation nonce", () => {
    const id = formatAllocatedLifecycleId("lc", NONCE, 7n);
    expect(id).toBe(`lc_${NONCE}_7`);
    expect(parseLifecycleCoordinatorId(id, NONCE)).toBe(id);
    expect(() => parseLifecycleCoordinatorId(id, OTHER_NONCE)).toThrow();
    expect(allocatedCounterOf(id)).toBe(7n);
  });

  it("reads the counter off Spec 2's nominal brands without a cast", () => {
    expect(allocatedCounterOf(parseLifecycleCoordinatorId(`lc_${NONCE}_9`, NONCE))).toBe(9n);
    expect(allocatedCounterOf(parseManifestParticipantId(`mf_${NONCE}_9`, NONCE))).toBe(9n);
    expect(() => allocatedCounterOf(`lc_${NONCE}_01`)).toThrow();
  });

  it("parses an allocated ID without binding it when no nonce is supplied", () => {
    const id = formatAllocatedLifecycleId("ge", OTHER_NONCE, 0n);
    expect(parseAllocatedLifecycleId("ge", id, null)).toBe(id);
  });

  it.each([0n, 1n, UINT64_MAX])("formats counter %s", (counter) => {
    const id = formatAllocatedLifecycleId("tx", NONCE, counter);
    expect(id).toBe(`tx_${NONCE}_${counter.toString(10)}`);
    expect(allocatedCounterOf(parseAllocatedLifecycleId("tx", id, NONCE))).toBe(counter);
  });

  it.each([-1n, UINT64_MAX + 1n])("refuses to format counter %s", (counter) => {
    expect(() => formatAllocatedLifecycleId("tx", NONCE, counter)).toThrow();
  });

  it.each(["01", "-1", "18446744073709551616", "7a", "", "1 "])("refuses counter text %j", (counter) => {
    expect(() => parseAllocatedLifecycleId("lc", `lc_${NONCE}_${counter}`, NONCE)).toThrow();
  });

  it("refuses every other prefix's ID under each prefix", () => {
    expect(PREFIXES.length).toBeGreaterThan(0);
    for (const prefix of PREFIXES) {
      expect(parseAllocatedLifecycleId(prefix, ID_BY_PREFIX[prefix], NONCE)).toBe(ID_BY_PREFIX[prefix]);
      for (const other of PREFIXES) {
        if (other === prefix) continue;
        expect(() => parseAllocatedLifecycleId(prefix, ID_BY_PREFIX[other], NONCE)).toThrow();
      }
    }
  });

  it.each([
    ["uppercase hex", "A".repeat(64)],
    ["63 hex", "a".repeat(63)],
    ["65 hex", "a".repeat(65)],
    ["empty", ""],
  ])("refuses a nonce that is %s", (_label, nonce) => {
    expect(() => parseAllocatedLifecycleId("lc", `lc_${nonce}_1`, null)).toThrow();
  });

  it("refuses to format under a nonce that is not 64 lowercase hex bytes", () => {
    expect(() => formatAllocatedLifecycleId("lc", "A".repeat(64) as typeof NONCE, 1n)).toThrow();
  });

  it("refuses a value that is not a string", () => {
    expect(() => parseAllocatedLifecycleId("lc", 1, NONCE)).toThrow();
  });
});

describe("Foundation transaction IDs", () => {
  it("admits a legacy UUID ID only through the Foundation transaction parser", () => {
    const legacy = `tx_${LEGACY_UUID}`;
    expect(parseFoundationTransactionId(legacy, NONCE)).toBe(legacy);
    expect(() => parseAllocatedLifecycleId("tx", legacy, NONCE)).toThrow();
  });

  it("admits the allocated arm and binds it to the nonce", () => {
    const allocated = formatAllocatedLifecycleId("tx", NONCE, 3n);
    expect(parseFoundationTransactionId(allocated, NONCE)).toBe(allocated);
    expect(() => parseFoundationTransactionId(allocated, OTHER_NONCE)).toThrow();
  });

  it("refuses the shipped bootstrap participant arm", () => {
    expect(() => parseFoundationTransactionId(`tx_fi_${LEGACY_UUID}_0000000000_f`, NONCE)).toThrow();
    expect(() => parseFoundationTransactionId(`tx_mm_${LEGACY_UUID}_0000000000_c`, NONCE)).toThrow();
  });

  it.each([
    ["uppercase", `tx_${LEGACY_UUID.toUpperCase()}`],
    ["version 1", "tx_123e4567-e89b-12d3-a456-426614174000"],
    ["variant 7", "tx_123e4567-e89b-42d3-7456-426614174000"],
  ])("refuses a legacy ID that is %s", (_label, value) => {
    expect(() => parseFoundationTransactionId(value, NONCE)).toThrow();
  });
});

describe("the manifest participant ID", () => {
  it("admits only the allocated mf arm", () => {
    const allocated = formatAllocatedLifecycleId("mf", NONCE, 12n);
    expect(parseManifestParticipantId(allocated, NONCE)).toBe(allocated);
  });

  it.each([`mf_fi_${LEGACY_UUID}`, `mf_mm_${LEGACY_UUID}`])("refuses the shipped arm %s", (value) => {
    expect(() => parseManifestParticipantId(value, NONCE)).toThrow();
  });
});

describe("mutation indices", () => {
  it.each(["0", "255"])("admits allocated mutation index %s", (text) => {
    expect(parseAllocatedFoundationMutationIndex(text)).toBe(Number(text));
  });

  it.each(["256", "-1", "01", "", "1.0", "4294967294"])("refuses allocated mutation index %j", (text) => {
    expect(() => parseAllocatedFoundationMutationIndex(text)).toThrow();
  });

  it.each(["0", "4294967294"])("admits legacy mutation index %s", (text) => {
    expect(parseLegacyFoundationMutationIndex(text)).toBe(Number(text));
  });

  it.each(["4294967295", "-1", "01", "+1", "1.0", "", " 1"])("refuses legacy mutation index %j", (text) => {
    expect(() => parseLegacyFoundationMutationIndex(text)).toThrow();
  });
});

describe("the effective uid", () => {
  it("admits the captured uid", () => {
    expect(parseEffectiveUid(501, 501)).toBe(501);
    expect(parseEffectiveUid(0, 0)).toBe(0);
    expect(parseEffectiveUid(4_294_967_295, 4_294_967_295)).toBe(4_294_967_295);
  });

  it.each([
    ["a different uid", 502, 501],
    ["a negative uid", -1, -1],
    ["4294967296", 4_294_967_296, 4_294_967_296],
    ["a fractional uid", 1.5, 1.5],
  ])("refuses %s", (_label, value, expected) => {
    expect(() => parseEffectiveUid(value, expected)).toThrow();
  });

  it("refuses a uid that is not a number", () => {
    expect(() => parseEffectiveUid("501", 501)).toThrow();
  });
});

describe("the ledger bounds", () => {
  it("equals the Spec 1 §2.4 literal", () => {
    const keys = Object.keys(LIFECYCLE_LEDGER_BOUNDS);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.sort()).toEqual(
      [
        "journalLeavesPerRoot",
        "foundationStagingAggregateLeaves",
        "foundationBackupAggregateLeaves",
        "lifecycleStagingAggregateLeaves",
        "lifecycleStagingPerCoordinatorLeaves",
        "foundationOverflowAggregateLeaves",
      ].sort(),
    );
    expect(LIFECYCLE_LEDGER_BOUNDS).toEqual({
      journalLeavesPerRoot: 10_000,
      foundationStagingAggregateLeaves: 100_000,
      foundationBackupAggregateLeaves: 100_000,
      lifecycleStagingAggregateLeaves: 1_000_000,
      lifecycleStagingPerCoordinatorLeaves: 1_000_000,
      foundationOverflowAggregateLeaves: 1_000_000,
    });
  });

  it("carries the unsigned 64-bit ceiling", () => {
    expect(UINT64_MAX).toBe(18_446_744_073_709_551_615n);
  });
});
