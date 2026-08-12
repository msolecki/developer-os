import { describe, expect, it } from "vitest";
import { CAPABILITY_STATES, PROBE_OBSERVATIONS } from "./index.js";

/**
 * The vocabulary lives here because two adapters share it and neither may
 * import the other (Codex spec §1). DOS-P6 consumes both, and two vocabularies
 * would make its own contract a translation layer.
 */
describe("the shared capability vocabulary", () => {
  it("has exactly three states, in the order the model reads them", () => {
    expect([...CAPABILITY_STATES]).toEqual(["yes", "wrapper-required", "unknown"]);
  });

  it("keeps what a probe saw distinct from what we report", () => {
    expect([...PROBE_OBSERVATIONS]).toEqual(["observed", "absent", "unavailable"]);
    for (const observation of PROBE_OBSERVATIONS) {
      expect(CAPABILITY_STATES).not.toContain(observation);
    }
  });
});
