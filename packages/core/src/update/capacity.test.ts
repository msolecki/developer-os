import { describe, expect, it } from "vitest";

import {
  projectUpdateCapacity,
  UPDATE_CAPACITY_COMPONENT_ORDER,
  UpdateCapacityInsufficientError,
  type UpdateCapacityComponentKindV1,
  type UpdateCapacityInputV1,
} from "./capacity.js";
import { parseUInt64Decimal } from "./scalars.js";

const u = parseUInt64Decimal;

function component(kind: UpdateCapacityComponentKindV1, bytes: string, entries: string) {
  return { kind, bytes: u(bytes), entries: u(entries) };
}

function input(overrides: Partial<UpdateCapacityInputV1> = {}): UpdateCapacityInputV1 {
  return {
    operation: "update",
    components: [component("active", "100", "10"), component("target_bundle", "200", "20"), component("journals", "0", "3")],
    reservationGranularityBytes: u("4096"),
    availableBytes: u("4396"),
    availableEntries: u("33"),
    ...overrides,
  };
}

describe("update capacity projection", () => {
  it("sums the components plus the reservation granularity and publishes an exact fit", () => {
    expect(projectUpdateCapacity(input())).toEqual({
      components: [component("active", "100", "10"), component("target_bundle", "200", "20"), component("journals", "0", "3")],
      requiredBytes: "4396",
      requiredEntries: "33",
      availableBytes: "4396",
      availableEntries: "33",
      fits: true,
    });
  });

  it("refuses the first insufficient byte or inode without publishing fits", () => {
    const firstOverBytes = input({ availableBytes: u("4395") });
    const firstOverEntries = input({ availableEntries: u("32") });
    expect(() => projectUpdateCapacity(firstOverBytes)).toThrow(UpdateCapacityInsufficientError);
    expect(() => projectUpdateCapacity(firstOverBytes)).toThrow("insufficient update capacity: bytes");
    expect(() => projectUpdateCapacity(firstOverEntries)).toThrow("insufficient update capacity: entries");
    expect(() => projectUpdateCapacity(input({ availableBytes: u("0"), availableEntries: u("0") }))).toThrow("insufficient update capacity: bytes");
  });

  it("emits components uniquely in the canonical order whatever the input order", () => {
    const reversed = input({ components: [...input().components].reverse() });
    expect(projectUpdateCapacity(reversed)).toEqual(projectUpdateCapacity(input()));
    const all = UPDATE_CAPACITY_COMPONENT_ORDER.map((kind) => component(kind, "1", "1")).reverse();
    const projected = projectUpdateCapacity(input({ components: all, availableBytes: u("100000"), availableEntries: u("100") }));
    expect(projected.components.map((entry) => entry.kind)).toEqual(UPDATE_CAPACITY_COMPONENT_ORDER);
    expect(() => projectUpdateCapacity(input({ components: [component("active", "1", "1"), component("active", "1", "1")] }))).toThrow();
  });

  it("keeps a zero-byte scope that consumes an inode and drops a scope that consumes nothing", () => {
    const projected = projectUpdateCapacity(input({ components: [component("active", "100", "10"), component("backups", "0", "0"), component("journals", "0", "3")] }));
    expect(projected.components.map((entry) => entry.kind)).toEqual(["active", "journals"]);
    expect(() => projectUpdateCapacity(input({ components: [component("backups", "0", "0")] }))).toThrow();
  });

  it("uses checked uint64 addition", () => {
    const max = "18446744073709551615";
    expect(() => projectUpdateCapacity(input({
      components: [component("active", max, "1"), component("backups", "1", "1")],
      availableBytes: u(max),
    }))).toThrow("uint64 overflow");
    expect(() => projectUpdateCapacity(input({
      components: [component("active", max, "1")],
      reservationGranularityBytes: u("1"),
      availableBytes: u(max),
    }))).toThrow("uint64 overflow");
    expect(() => projectUpdateCapacity(input({ components: [component("active", "01", "1")] }))).toThrow();
  });

  it("admits only the scopes a rollback can reach", () => {
    const rollback = input({
      operation: "rollback",
      components: [component("active", "100", "10"), component("retained_rollback", "50", "5"), component("journals", "0", "3")],
      availableBytes: u("100000"),
      availableEntries: u("100"),
    });
    expect(projectUpdateCapacity(rollback).components.map((entry) => entry.kind)).toEqual(["active", "retained_rollback", "journals"]);
    for (const kind of ["verified_scratch", "durable_bundle_source", "target_bundle", "inverse_payload"] as const) {
      expect(() => projectUpdateCapacity({ ...rollback, components: [...rollback.components, component(kind, "1", "0")] })).toThrow("unreachable scope");
      expect(projectUpdateCapacity({ ...rollback, components: [...rollback.components, component(kind, "0", "0")] }).components).toHaveLength(3);
    }
  });
});
