import { describe, expect, it } from "vitest";

import {
  AGENT_DETECTION_ROWS,
  detectSourceAgent,
  matchObservedAgent,
  type AgentDetectionRow,
} from "./agent.js";

describe("detectSourceAgent", () => {
  it("records unknown for an environment no observed row matches", () => {
    /**
     * This case used `CLAUDECODE` as its stand-in for "matches nothing" while
     * the table was empty. Task 17 observed that exact variable, so the example
     * moved rather than the contract: an environment carrying no observed
     * marker still records `"unknown"`, and an empty one always did.
     */
    expect(detectSourceAgent({ SOME_OTHER_AGENT: "1" })).toBe("unknown");
    expect(detectSourceAgent({})).toBe("unknown");
  });

  it("records claude for the marker Task 17 observed a real vendor set", () => {
    /**
     * The observation, so this assertion is auditable without leaving the file:
     * `claude -p --output-format json` on Claude Code 2.1.233, macOS, run on
     * 2026-08-15 with **every** `CLAUDE*`, `CODEX*` and `ANTHROPIC*` variable
     * stripped from the parent environment. A child process it spawned still
     * saw `CLAUDECODE=1`, which is what makes this the vendor's own marker
     * rather than one leaking in from the session that ran the experiment —
     * the first attempt inherited them and could not tell the two apart.
     */
    expect(detectSourceAgent({ CLAUDECODE: "1" })).toBe("claude");
  });

  it("still records unknown for codex, whose row Task 17 could not observe", () => {
    /**
     * Spec §10.3 is normative: until a vendor's row is observed, that vendor is
     * not in the table and detection records `"unknown"`. Codex's row needs one
     * successful `codex exec` completion, and on 2026-08-15 the account's usage
     * limit was exhausted — so the row is **absent, not guessed**. **A guessed
     * row is worse than an absent one: it is a fact a later reader will trust**
     * (spec §5.4).
     *
     * The cost is stated rather than discovered later: every capture written
     * inside a Codex session until that row lands records
     * `sourceAgent: "unknown"`. Those captures are correct and are never
     * rewritten.
     */
    expect(AGENT_DETECTION_ROWS.some((row) => row.agent === "codex")).toBe(false);
  });

  it("carries no row without the observation that justifies it", () => {
    for (const row of AGENT_DETECTION_ROWS) {
      expect(row.observedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(row.observedIn.length).toBeGreaterThan(0);
    }
    expect(AGENT_DETECTION_ROWS.length).toBeGreaterThan(0);
  });
});

describe("matchObservedAgent", () => {
  /**
   * The real table carries one vendor's row and it is an exact-value one, so it
   * exercises a single branch of the matching rule. The presence-only
   * (`value: null`) branch and the tie-break are code that would first run the
   * day someone adds a row of that shape; the empty-string branch needs no new
   * row — `CLAUDECODE=` reaches it today — but nothing in the product produces
   * that environment, so only these rows exercise it either way. They are
   * synthetic and local to this file: they exercise the rule without claiming
   * an observation, which is the line spec §10.3 draws.
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
