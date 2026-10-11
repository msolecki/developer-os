import { parseCanonicalAbsolutePathText, parseUtcTimestamp } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { parentPath, sha256Hex, stampAfter } from "./primitives.js";

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
});
