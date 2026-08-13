/**
 * Capture: construction, rendering and parsing of `CaptureEnvelopeV1`.
 *
 * Pure functions over injected dependencies. **Nothing in this directory
 * touches a filesystem, an environment, a process, a clock or a key** — the
 * property `BrainServiceDependencies` already holds for the rest of the
 * package, and the reason `redact` arrives as a callback rather than as key
 * material. The transaction that writes the file, the environment the agent is
 * detected from, and the key the redaction runs under all belong to the CLI.
 */
export { buildCapture } from "./build.js";
export type { CaptureBuildRequest, CaptureBuildResult } from "./build.js";
export { renderCaptureFile } from "./render.js";
export { parseCaptureFile } from "./parse.js";
export type { CaptureFileOutcome, CaptureFileRefusal } from "./parse.js";
export { AGENT_DETECTION_ROWS, detectSourceAgent } from "./agent.js";
export type { AgentDetectionRow } from "./agent.js";
