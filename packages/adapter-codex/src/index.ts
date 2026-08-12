/**
 * The only door into this package. Spec §11 names `CodexAdapter` as "the
 * package's only public door"; `index.test.ts` pins the export list this file
 * produces so the surface cannot widen unnoticed.
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
export { resolveCapabilities } from "./capabilities.js";
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
  MARKETPLACE_RELATIVE_PATH,
  PLUGIN_NAME,
  PLUGIN_TREE_SEGMENTS,
} from "./plugin.js";
export { MARKETPLACE_NAME, renderMarketplace } from "./marketplace.js";
export type { MarketplaceContext } from "./marketplace.js";
export { proposeCodexInstall, proposeCodexUninstall } from "./install.js";
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

import { resolveCapabilities } from "./capabilities.js";
import { renderCodexInstallTree, renderCodexPlugin } from "./compose.js";
import { discoverCodex } from "./discover.js";
import { invokeCodex } from "./invoke.js";
import { proposeCodexInstall } from "./install.js";

/**
 * The package's only public door, bound rather than constructed. Spec §11
 * names this the interface DOS-P6 consumes instead of eleven loose functions;
 * `claude-adapter.md` §9.6 recorded that DOS-P4 shipped no equivalent façade
 * and deferred the question to "the point where a common interface has two
 * implementations" — this is that point.
 *
 * A frozen object, not a class. There is nothing to construct — every bound
 * function is already free of instance state — and a façade that held state
 * would become a second source of truth about an installation, alongside the
 * manifest `@developer-os/core` already owns.
 *
 * `renderPlugin` is `renderCodexPlugin`, not `renderCodexInstallTree` — its
 * output is plugin-root-relative, one level shallower than what
 * `proposeInstall` (`proposeCodexInstall`) resolves against. Binding those
 * two alone onto one object would let a consumer feed one into the other and
 * reproduce, one layer up, the exact silent under-nesting `compose.ts`
 * documents: containment still passes, the tree just lands a level too
 * shallow. `renderInstallTree` is the bound `renderCodexInstallTree` —
 * already re-rooted onto the marketplace root — and is the only member of
 * this object `proposeInstall` should ever be fed from.
 */
export const CodexAdapter = Object.freeze({
  vendor: "codex" as const,
  discover: discoverCodex,
  capabilities: resolveCapabilities,
  renderPlugin: renderCodexPlugin,
  renderInstallTree: renderCodexInstallTree,
  proposeInstall: proposeCodexInstall,
  invoke: invokeCodex,
});
