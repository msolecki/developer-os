import { parseCanonicalAbsolutePathText, parseUtcTimestamp } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { parentPath, sha256Hex, stampAfter } from "./primitives.js";
import { deathPoints } from "./testing.js";

describe("update primitives", () => {
  it("hashes bytes as lower-hex SHA-256", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("returns the parent of a canonical absolute path", () => {
    expect(parentPath(parseCanonicalAbsolutePathText("/a/b/c"))).toBe("/a/b");
  });

  it("never stamps earlier than the floor", () => {
    const floor = parseUtcTimestamp("2030-01-01T08:00:00.000Z");
    expect(stampAfter(() => new Date("2029-12-31T00:00:00.000Z"), floor)).toBe(floor);
    expect(stampAfter(() => new Date("2030-01-02T00:00:00.000Z"), floor)).toBe("2030-01-02T00:00:00.000Z");
  });

  it("lists every death point of a union, in declaration order, and an omitted one does not compile", () => {
    expect(deathPoints<"first" | "second">({ first: true, second: true })).toEqual(["first", "second"]);
    // @ts-expect-error -- a union member missing from the list is a build failure, not a skipped sweep.
    deathPoints<"first" | "second">({ first: true });
  });
});
