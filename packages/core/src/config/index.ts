export { loadConfig, serializeConfig } from "./loader.js";
export { resolveRuntimePaths } from "./paths.js";
export { isValidPathSegment, pathSegmentViolation } from "./segment.js";
export type {
  BrainConfigV1,
  DeveloperOsConfigV1,
  PathEnvironment,
  RuntimePaths,
} from "./types.js";
