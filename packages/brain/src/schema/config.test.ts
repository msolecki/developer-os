import { describe, expect, it } from "vitest";

import { loadConfig, serializeConfig } from "@developer-os/core";
import type { DeveloperOsConfigV1 } from "@developer-os/core";

import { DEFAULT_BRAIN_CONFIG, resolveBrainConfig } from "./config.js";

const BASE: DeveloperOsConfigV1 = {
  schemaVersion: 1,
  brainPath: "/Users/test/DeveloperBrain",
  adapters: { claude: false, codex: false },
  git: { enabled: false },
  automation: { enabled: false },
  telemetry: false,
};

describe("resolveBrainConfig", () => {
  it("falls back to the documented defaults", () => {
    expect(resolveBrainConfig(BASE)).toStrictEqual(DEFAULT_BRAIN_CONFIG);
  });

  it("uses an explicit section unchanged", () => {
    const brain = { ...DEFAULT_BRAIN_CONFIG, topicFolders: ["DEV"] };

    expect(resolveBrainConfig({ ...BASE, brain })).toStrictEqual(brain);
  });

  /**
   * Whichever branch produced it. Freezing only the default would break a
   * mutating consumer for exactly those users who wrote no `[brain]` section.
   */
  it("returns an immutable result for an explicit section too", () => {
    const brain = { ...DEFAULT_BRAIN_CONFIG, topicFolders: ["DEV"] };
    const resolved = resolveBrainConfig({ ...BASE, brain });

    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.topicFolders)).toBe(true);
    expect(Object.isFrozen(resolved.retrieval)).toBe(true);
  });
});

describe("DEFAULT_BRAIN_CONFIG", () => {
  it("names the five documented topic folders in order", () => {
    expect(DEFAULT_BRAIN_CONFIG.topicFolders).toStrictEqual([
      "PROJECTS",
      "TOOLS",
      "DEV",
      "INFRA",
      "QA",
    ]);
  });

  it("carries the documented retrieval and staleness defaults", () => {
    expect(DEFAULT_BRAIN_CONFIG.retrieval.maxCandidates).toBe(10);
    expect(DEFAULT_BRAIN_CONFIG.staleness.reviewAfterDays).toBe(180);
  });

  it("adds no alias, so a legacy folder name is opt-in", () => {
    expect(DEFAULT_BRAIN_CONFIG.topicAliases).toStrictEqual({});
  });

  /**
   * The schema lives in `core` and these defaults live here, so nothing else
   * checks one against the other. Without this, a default of `"a/b"` or `".."`
   * would keep every test in this file green and fail at serialization time.
   */
  it("satisfies the schema in core that owns it", () => {
    const written = serializeConfig({ ...BASE, brain: DEFAULT_BRAIN_CONFIG });

    expect(loadConfig(written).brain).toStrictEqual(DEFAULT_BRAIN_CONFIG);
  });

  it("cannot be mutated by a caller", () => {
    expect(Object.isFrozen(DEFAULT_BRAIN_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_BRAIN_CONFIG.topicFolders)).toBe(true);
  });
});
