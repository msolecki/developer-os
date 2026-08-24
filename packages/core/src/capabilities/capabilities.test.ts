import { describe, expect, it } from "vitest";
import { CAPABILITY_STATES, PROBE_OBSERVATIONS } from "./index.js";

/**
 * The vocabulary lives here because two adapters share it and neither may
 * import the other (Codex architecture former §1). DOS-P6 consumes both, and two vocabularies
 * would make its own contract a translation layer.
 */
describe("the shared capability vocabulary", () => {
  it("has exactly three states, in the order the model reads them", () => {
    expect([...CAPABILITY_STATES]).toEqual(["yes", "unknown", "not-used"]);
  });

  /**
   * `wrapper-required` is **replaced**, not kept beside the new word
   * (knowledge-pipeline spec §3.2). It meant "we are not certain, and the
   * `developer-os run claude|codex` wrapper produces the same capture anyway";
   * decision 3.1 declines that wrapper, so all that survives is advice to run
   * a command that will not exist.
   */
  it("no longer names a wrapper nobody can run", () => {
    expect(CAPABILITY_STATES).not.toContain("wrapper-required");
  });

  it("keeps what a probe saw distinct from what we report", () => {
    expect([...PROBE_OBSERVATIONS]).toEqual(["observed", "absent", "unavailable"]);
    for (const observation of PROBE_OBSERVATIONS) {
      expect(CAPABILITY_STATES).not.toContain(observation);
    }
  });
});
