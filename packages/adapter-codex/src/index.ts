/**
 * The only door into this package; `index.test.ts` pins the export list this
 * file produces so the surface cannot widen unnoticed.
 *
 * `workflow-schema`'s `index.ts` records why a package with a validation or
 * safety guarantee exports the guarded function and not the raw schema behind
 * it: a guarantee is better as a shape nothing can get around than as a rule
 * everyone has to remember. `parseAgentPromptArgs`, `compareCodePoints`,
 * `screenValueArgument` and `compareVersions` are each one package's guard —
 * `@developer-os/core`, `@developer-os/workflow-schema` and
 * `@developer-os/security` — and re-exporting any of them here would hand
 * consumers two import paths for one rule. `SHARED_WORKFLOW_ID` is the one
 * re-export that is deliberate: it is a string, not a guard, and a consumer
 * that imports it here cannot get anything wrong with it.
 *
 * This package imports nothing from the Claude adapter's package: the two
 * adapters are peers under `workflow-schema`, never dependents of one
 * another. `index.test.ts` asserts that across every file in this package,
 * not just this one.
 */
export { discoverCodex } from "./discover.js";
export type { CodexInstallation } from "./discover.js";
export { CODEX_CAPABILITY_KEYS, CODEX_MINIMUM_VERSION } from "./versions.js";
export type { CodexCapabilityKey } from "./versions.js";
export { probeCodex } from "./probe.js";
export type { CodexProbeDependencies, CodexProbeResult } from "./probe.js";
/**
 * `CODEX_NOT_USED_KEYS` is exported for one consumer:
 * `apps/cli/src/adapter-capability-parity.test.ts`, the only place both
 * adapters are legally visible at once (Codex architecture former §1 forbids either importing the
 * other, so neither package can assert parity about itself).
 */
export { CODEX_NOT_USED_KEYS, resolveCapabilities } from "./capabilities.js";
export type {
  CapabilityState,
  CodexCapabilities,
  ProbeObservation,
} from "./capabilities.js";
export { renderCodexInstallTree, renderCodexPlugin } from "./compose.js";
export { CodexRenderer, SHARED_WORKFLOW_ID } from "./render.js";
export type { CodexRendererDependencies } from "./render.js";
export {
  buildPluginTree,
  CODEX_ROOT_SEGMENT,
  MARKETPLACE_RELATIVE_PATH,
  PLUGIN_NAME,
  PLUGIN_TREE_PREFIX,
  PLUGIN_TREE_SEGMENTS,
} from "./plugin.js";
export type { MarketplaceRootArtifact, PluginRootArtifact } from "./plugin.js";
export { MARKETPLACE_NAME, renderMarketplace } from "./marketplace.js";
export {
  CODEX_HOOK_ROWS,
  CODEX_HOOK_TRUST_RESIDUE,
  CODEX_HOOK_TRUST_STEP,
  CODEX_HOOKS_PATH,
  renderCodexHooks,
  withCodexHooks,
} from "./hooks.js";
export type { CodexHookEvent, CodexHookRow } from "./hooks.js";
export type { MarketplaceContext } from "./marketplace.js";
export { renderAgentToml } from "./agent-toml.js";
export {
  InstructionBlockTooLargeError,
  renderCodexVendorTree,
  renderInstructionTree,
} from "./instructions.js";
export type {
  CodexInstructionRenderV1,
  InstructionSourceSetV1Like,
  InstructionSourceV1Like,
} from "./instructions.js";
export { proposeCodexInstall } from "./install.js";
export type {
  CodexCliStep,
  CodexInstallProposal,
  InstallContext,
  ManagedByPath,
} from "./install.js";
export { invocationFromAgentPrompt, invokeCodex } from "./invoke.js";
export type {
  CodexInvocation,
  CodexRunResult,
  InvocationContext,
  InvokeDependencies,
} from "./invoke.js";
export {
  codexOwnerUpdateProvider,
} from "./update/plan.js";
