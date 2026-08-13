import { describe, expect, it } from "vitest";

import {
  AGENT_DETECTION_ROWS,
  detectSourceAgent,
  matchObservedAgent,
  type AgentDetectionRow,
} from "./agent.js";

describe("detectSourceAgent", () => {
  it("records unknown for an environment no observed row matches", () => {
    expect(detectSourceAgent({ CLAUDECODE: "1" })).toBe("unknown");
    expect(detectSourceAgent({})).toBe("unknown");
  });

  it("carries no row that Task 17 has not observed", () => {
    /**
     * Deliberately the shape that *fails* the day a row is added, which is
     * correct: adding one is Task 17's job — the single task that runs a real
     * vendor binary — and it updates this test with the observation that
     * justifies the row. Spec §10.3 is normative: until a vendor's row is
     * observed, that vendor is not in the table and detection records
     * `"unknown"`. **A guessed row is worse than an absent one: it is a fact a
     * later reader will trust** (spec §5.4).
     *
     * The cost is stated rather than discovered later: every capture written
     * between this task and Task 17 records `sourceAgent: "unknown"`. Those
     * captures are correct and are never rewritten.
     */
    expect(AGENT_DETECTION_ROWS).toEqual([]);
  });
});

describe("matchObservedAgent", () => {
  /**
   * The table is empty, so the matching rule above it would be untested code
   * that first runs the day Task 17 adds a row — with nothing to say whether it
   * works. These rows are synthetic and local to this file: they exercise the
   * rule without claiming an observation, which is the line spec §10.3 draws.
   */
  const presence: AgentDetectionRow = {
    agent: "synthetic-presence",
    variable: "SYNTHETIC_AGENT",
    value: null,
    observedOn: "never — synthetic fixture",
    observedIn: "this test file",
  };
  const exact: AgentDetectionRow = {
    agent: "synthetic-exact",
    variable: "SYNTHETIC_MODE",
    value: "interactive",
    observedOn: "never — synthetic fixture",
    observedIn: "this test file",
  };

  it("matches a presence row on any non-empty value", () => {
    expect(matchObservedAgent([presence], { SYNTHETIC_AGENT: "1" })).toBe(
      "synthetic-presence",
    );
    expect(matchObservedAgent([presence], { SYNTHETIC_AGENT: "anything" })).toBe(
      "synthetic-presence",
    );
  });

  it("treats an exported-but-empty variable as absent", () => {
    /**
     * `FOO=` is what a shell leaves behind when a wrapper unsets a value by
     * assigning nothing to it, and reading it as presence would name an agent
     * on the strength of an empty string.
     */
    expect(matchObservedAgent([presence], { SYNTHETIC_AGENT: "" })).toBe("unknown");
    expect(matchObservedAgent([presence], { SYNTHETIC_AGENT: undefined })).toBe(
      "unknown",
    );
  });

  it("matches an exact row only on the value that was observed", () => {
    expect(matchObservedAgent([exact], { SYNTHETIC_MODE: "interactive" })).toBe(
      "synthetic-exact",
    );
    expect(matchObservedAgent([exact], { SYNTHETIC_MODE: "batch" })).toBe("unknown");
  });

  it("takes the first row that matches, so declaration order is the tie-break", () => {
    expect(
      matchObservedAgent([presence, exact], {
        SYNTHETIC_AGENT: "1",
        SYNTHETIC_MODE: "interactive",
      }),
    ).toBe("synthetic-presence");
  });

  it("records unknown rather than guessing when no row matches", () => {
    expect(matchObservedAgent([presence, exact], { PATH: "/usr/bin" })).toBe(
      "unknown",
    );
    expect(matchObservedAgent([], { SYNTHETIC_AGENT: "1" })).toBe("unknown");
  });
});
