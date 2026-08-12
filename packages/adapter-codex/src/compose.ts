import { posix } from "node:path";
import type {
  RenderedArtifact,
  WorkflowContractV1,
} from "@developer-os/workflow-schema";
import { renderMarketplace } from "./marketplace.js";
import type { MarketplaceContext } from "./marketplace.js";
import { buildPluginTree, PLUGIN_TREE_PREFIX } from "./plugin.js";
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
): readonly RenderedArtifact[] {
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
  return buildPluginTree(skills);
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
 * root, and `context.home` is the **product** home, the same value
 * `renderMarketplace` joins the full `PLUGIN_TREE_SEGMENTS` onto to build the
 * absolute path it writes into the descriptor's own contents.
 */
export function renderCodexInstallTree(
  contracts: readonly WorkflowContractV1[],
  context: MarketplaceContext,
): readonly RenderedArtifact[] {
  const pluginTree = renderCodexPlugin(contracts);
  const rerooted = pluginTree.map((artifact) => ({
    path: posix.join(PLUGIN_TREE_PREFIX, artifact.path),
    contents: artifact.contents,
  }));
  return [...rerooted, renderMarketplace(context)];
}
