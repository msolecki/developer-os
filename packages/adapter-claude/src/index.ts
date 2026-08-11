/**
 * The only door into this package.
 *
 * `workflow-schema`'s `index.ts` records why a package with a validation or
 * safety guarantee exports the guarded function and not the raw schema behind
 * it: a guarantee is better as a shape nothing can get around than as a rule
 * everyone has to remember.
 *
 * `parseAgentPromptArgs` is deliberately **not** re-exported. It lives in
 * `packages/core` because DOS-P4 and DOS-P5 both execute `agent.prompt` (spec
 * §8.1, as amended on 2026-08-11), and a package that re-exports another
 * package's guard hands consumers two import paths for one guarantee.
 */
export { discoverClaude, resolveExecutable } from "./discover.js";
export type {
  ClaudeInstallation,
  DiscoverDependencies,
  ResolveDependencies,
} from "./discover.js";
export { CLAUDE_CAPABILITY_KEYS, CLAUDE_MINIMUM_VERSION } from "./versions.js";
export type { ClaudeCapabilityKey } from "./versions.js";
export { probeClaude } from "./probe.js";
export type { ProbeDependencies } from "./probe.js";
export { resolveCapabilities } from "./capabilities.js";
export type {
  CapabilityState,
  ClaudeCapabilities,
  ProbeObservation,
} from "./capabilities.js";
export { ClaudeRenderer, SHARED_WORKFLOW_ID } from "./render.js";
export type { ClaudeRendererDependencies } from "./render.js";
export {
  buildPluginTree,
  PLUGIN_INSTALL_SEGMENTS,
  PLUGIN_NAME,
} from "./plugin.js";
export { proposeClaudeInstall, proposeClaudeUninstall } from "./install.js";
export type {
  ClaudeInstallProposal,
  InstallContext,
  ManagedByPath,
} from "./install.js";
export { invokeClaude } from "./invoke.js";
export type {
  ClaudeInvocation,
  ClaudeRunResult,
  InvokeDependencies,
} from "./invoke.js";
