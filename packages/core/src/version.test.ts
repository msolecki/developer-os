import { describe, expect, it } from "vitest";

import { RELEASE_VERSION as fromProtocol } from "./planner-protocol.js";
import { RELEASE_VERSION } from "./version.js";

describe("RELEASE_VERSION", () => {
  it("is 0.0.0 in an unpacked build and is one value for every consumer", () => {
    expect(RELEASE_VERSION).toBe("0.0.0");
    expect(fromProtocol).toBe(RELEASE_VERSION);
  });
});
