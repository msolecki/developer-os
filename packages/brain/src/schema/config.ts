import type { BrainConfigV1, DeveloperOsConfigV1 } from "@developer-os/core";

/**
 * Frozen, and frozen one level down. `readonly` is erased at runtime, so a
 * single caller mutating `topicFolders` would corrupt the default for every
 * later call in the process.
 */
export const DEFAULT_BRAIN_CONFIG: BrainConfigV1 = Object.freeze({
  schemaVersion: 1,
  contentRoot: "content",
  topicFolders: Object.freeze(["PROJECTS", "TOOLS", "DEV", "INFRA", "QA"]),
  topicAliases: Object.freeze({}),
  indexesDir: "_indexes",
  retrieval: Object.freeze({ maxCandidates: 10 }),
  staleness: Object.freeze({ reviewAfterDays: 180 }),
});

/**
 * Frozen in place rather than copied, so the result is immutable whichever
 * branch produced it. The asymmetry is the bug worth avoiding: if only the
 * default were frozen, a consumer that mutated its result would break for
 * exactly those users who did *not* write a `[brain]` section, which is the
 * hardest possible way to find out. The section is built fresh by `loadConfig`
 * on every call, so nothing else holds a reference expecting it to stay mutable.
 */
function freezeBrainConfig(config: BrainConfigV1): BrainConfigV1 {
  Object.freeze(config.topicFolders);
  Object.freeze(config.topicAliases);
  Object.freeze(config.retrieval);
  Object.freeze(config.staleness);

  return Object.freeze(config);
}

export function resolveBrainConfig(config: DeveloperOsConfigV1): BrainConfigV1 {
  return config.brain === undefined
    ? DEFAULT_BRAIN_CONFIG
    : freezeBrainConfig(config.brain);
}
