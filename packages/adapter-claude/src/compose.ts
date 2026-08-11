import type {
  RenderedArtifact,
  WorkflowContractV1,
} from "@developer-os/workflow-schema";
import { buildPluginTree } from "./plugin.js";
import { ClaudeRenderer, SHARED_WORKFLOW_ID } from "./render.js";

/**
 * The whole composition, in one function both the drift check and any future
 * `workflow render` command call.
 *
 * It takes already-validated contracts and touches no filesystem. That is the
 * boundary spec §2 draws — this package consumes what `validateWorkflow`
 * produced and never re-reads or re-validates it — and it is what lets the
 * contract test read `workflows/` from disk while the package stays testable
 * with nothing installed and nothing on disk.
 *
 * Ordering is not taken from the caller. `buildPluginTree` sorts by code point,
 * so a directory reader that yields the six workflows in any order produces the
 * same bytes — which is the byte-identity property spec §7.3 owes DOS-P3.
 */
export function renderClaudePlugin(
  contracts: readonly WorkflowContractV1[],
): readonly RenderedArtifact[] {
  const shared = contracts.find(
    (contract) => contract.id === SHARED_WORKFLOW_ID,
  );
  if (shared === undefined) {
    // Every other artifact concatenates this one's preamble (spec §7.1).
    // Rendering without it would produce five artifacts silently missing the
    // prompt-injection defence, which is the failure the empty-preamble check
    // in `ClaudeRenderer` exists to prevent — caught here too, because a
    // missing workflow and an empty one are different mistakes.
    throw new Error(
      `no \`${SHARED_WORKFLOW_ID}\` workflow was supplied; every other artifact concatenates its preamble`,
    );
  }

  const renderer = new ClaudeRenderer({ shared });
  const skills = contracts.flatMap((contract) => [
    ...renderer.render(contract, null),
  ]);
  return buildPluginTree(skills);
}
