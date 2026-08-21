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

  it("records codex for the marker NEW-21 observed a real vendor set", () => {
    /**
     * The observation, so this assertion is auditable without leaving the file:
     * `codex exec --json` on `codex-cli 0.147.0`, macOS, run 2026-08-20 with
     * **every** `CLAUDE*`, `CODEX*` and `ANTHROPIC*` variable stripped from the
     * parent environment. A shell command the model ran saw `CODEX_CI=1`,
     * `CODEX_SANDBOX=seatbelt`, `CODEX_SANDBOX_NETWORK_DISABLED=1` and
     * `CODEX_THREAD_ID=<uuid>`, identically under both sandbox modes this
     * product can emit. The recording is
     * `tests/fixtures/codex/observed-exec-success-stream.jsonl`.
     *
     * **`CODEX_THREAD_ID` is the row, on presence rather than value**, and the
     * three it was chosen over are the reason to say so: `CODEX_SANDBOX` and
     * `CODEX_SANDBOX_NETWORK_DISABLED` describe the sandbox, not the vendor —
     * absent under `danger-full-access` and platform-valued — and `CODEX_CI`
     * reads as a marker of non-interactive `exec`, which is exactly the mode
     * this run could observe and not the one a founder captures in.
     */
    expect(detectSourceAgent({ CODEX_THREAD_ID: "00000000-0000-7000-0000-000000000001" })).toBe(
      "codex",
    );
  });

  it("takes any thread id, because the row matches on presence and no value is stable", () => {
    expect(detectSourceAgent({ CODEX_THREAD_ID: "a-different-thread" })).toBe("codex");
  });

  it("names claude when both markers are present, because the table is ordered", () => {
    /**
     * **A nested session is the environment that produces this, and the answer
     * it gives is wrong half the time.** Running `codex exec` from a shell
     * inside a Claude Code session hands the Codex child an inherited
     * `CLAUDECODE=1` alongside the `CODEX_THREAD_ID` its own vendor set, and
     * `matchObservedAgent` returns the **first** matching row — so a capture
     * taken in that session records `claude`.
     *
     * **It is pinned rather than fixed, and the reason is that no order is
     * right.** Reversing the rows moves the error to the other nesting, and
     * refusing to name either vendor would record `unknown` for the ordinary
     * un-nested case that a marker leaked into. Choosing needs an observation
     * nobody has: whether either vendor's marker is *distinguishable* from an
     * inherited copy of itself. `BACKLOG.md` §1 NEW-44 carries it.
     *
     * This case exists so the behaviour is a decision on record rather than a
     * property of the array literal's order, which is what it was until
     * 2026-08-20.
     */
    expect(
      detectSourceAgent({ CLAUDECODE: "1", CODEX_THREAD_ID: "00000000-0000-7000-0000-000000000001" }),
    ).toBe("claude");
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
   * The real table drives both value branches since 2026-08-20 — Claude's row
   * matches an exact value, Codex's matches on presence — and the tie-break as
   * well, which a case in the `detectSourceAgent` block above pins against the
   * real rows rather than against these.
   * What still needs a synthetic row is the empty-string branch: `CLAUDECODE=`
   * reaches it, but nothing in the product produces that environment.
   *
   * These rows stay because they exercise the rule without claiming an
   * observation, which is the line spec §10.3 draws — a synthetic row here can
   * never be mistaken for a fact about a vendor.
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
