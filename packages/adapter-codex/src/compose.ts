import { posix } from "node:path";
import type { WorkflowContractV1 } from "@developer-os/workflow-schema";
import { renderMarketplace } from "./marketplace.js";
import type { MarketplaceContext } from "./marketplace.js";
import { buildPluginTree, PLUGIN_TREE_PREFIX } from "./plugin.js";
import type { MarketplaceRootArtifact, PluginRootArtifact } from "./plugin.js";
import { CodexRenderer, SHARED_WORKFLOW_ID } from "./render.js";

/**
 * The whole plugin-tree composition, in one function both the drift check and
 * any future `workflow render` command call.
 *
 * It takes already-validated contracts and touches no filesystem — the same
 * boundary the Claude adapter's `compose.ts` draws, for the same reason: this
 * package consumes what `validateWorkflow` produced and never re-reads or
 * re-validates it.
 *
 * Ordering is not taken from the caller. `buildPluginTree` sorts by code
 * point, so a directory reader that yields the six workflows in any order
 * produces the same bytes.
 *
 * Every path this returns is relative to the **plugin root**
 * (`.codex-plugin/plugin.json`, `skills/developer-os-<id>/SKILL.md`) — what
 * Task 14 checks into `plugins/codex/`. It is one level shallower than the
 * marketplace root `proposeCodexInstall` resolves against; see
 * `renderCodexInstallTree` for the function that re-roots this output onto
 * that deeper root.
 */
export function renderCodexPlugin(
  contracts: readonly WorkflowContractV1[],
): readonly PluginRootArtifact[] {
  const shared = contracts.find(
    (contract) => contract.id === SHARED_WORKFLOW_ID,
  );
  if (shared === undefined) {
    // Every other artifact concatenates this one's preamble (spec §7.1).
    // Rendering without it would produce five artifacts silently missing the
    // prompt-injection defence, which is the failure the empty-preamble check
    // in `CodexRenderer` exists to prevent — caught here too, because a
    // missing workflow and an empty one are different mistakes.
    throw new Error(
      `no \`${SHARED_WORKFLOW_ID}\` workflow was supplied; every other artifact concatenates its preamble`,
    );
  }

  const renderer = new CodexRenderer({ shared });
  const skills = contracts.flatMap((contract) => [
    ...renderer.render(contract, null),
  ]);
  // The one brand-injection point for `PluginRootArtifact`: `buildPluginTree`
  // stays root-agnostic (it only assembles and validates a tree, it does not
  // know which root it is relative to), and this function's own docblock
  // above is where the "relative to the plugin root" claim is actually made.
  // The brand carries no runtime marker, so this changes nothing at runtime —
  // only what the type checker accepts downstream, in `renderCodexInstallTree`
  // and `proposeCodexInstall`. `as unknown as` because a `unique symbol` key
  // TypeScript never sees assigned makes the two array types "not sufficiently
  // overlap" for `tsc` to allow the direct two-step cast.
  return buildPluginTree(skills) as unknown as readonly PluginRootArtifact[];
}

/**
 * `renderCodexPlugin`'s tree, re-rooted onto the **marketplace root**
 * (`<home>/codex`, founder decision 2026-08-12), plus the marketplace
 * descriptor — every path this returns is relative to that one root. This is
 * what Task 11's `proposeCodexInstall` consumes and Task 17 installs.
 *
 * The re-root is a plain path join with `PLUGIN_TREE_PREFIX` — never a
 * literal; see that constant's own doc comment in `plugin.ts` for why
 * skipping it is a silent under-nest, not a refusal.
 *
 * The descriptor comes from `renderMarketplace(context)` unmodified — its own
 * path, `MARKETPLACE_RELATIVE_PATH`, is already relative to the marketplace
 * root. `context.home` is passed through for parity with `InstallContext`
 * elsewhere in this adapter, but as of Task 17 (2026-08-12) `renderMarketplace`
 * no longer writes it into the descriptor's contents: the real CLI silently
 * drops a plugin entry whose `source.path` is absolute, so that field is now
 * the fixed, marketplace-root-relative `./${PLUGIN_TREE_PREFIX}` — see
 * `renderMarketplace`'s own doc comment for the observation.
 */
export function renderCodexInstallTree(
  contracts: readonly WorkflowContractV1[],
  context: MarketplaceContext,
): readonly MarketplaceRootArtifact[] {
  const pluginTree = renderCodexPlugin(contracts);
  // Two brand-injection points, not one — an earlier version of this task's
  // plan cast only the `.map()` output and missed the second. `.map()`
  // builds new object literals, which do not inherit `pluginTree`'s brand
  // even though every value is now marketplace-root-relative; `renderMarketplace`
  // separately returns an unbranded `RenderedArtifact` spread into the same
  // array. Casting only the first would have let the return statement widen
  // back to a plain `RenderedArtifact[]` and silently defeated the guard
  // `PluginRootArtifact`/`MarketplaceRootArtifact` exist to add. Both go
  // through `unknown` first, for the same reason as `renderCodexPlugin`'s
  // cast above: a `unique symbol` key `tsc` never sees assigned is not
  // "sufficiently overlapping" for the direct two-step form.
  const rerooted = pluginTree.map((artifact) => ({
    path: posix.join(PLUGIN_TREE_PREFIX, artifact.path),
    contents: artifact.contents,
  })) as unknown as readonly MarketplaceRootArtifact[];
  return [...rerooted, renderMarketplace(context) as unknown as MarketplaceRootArtifact];
}
