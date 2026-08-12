import { compareCodePoints } from "@developer-os/workflow-schema";
import type { RenderedArtifact } from "@developer-os/workflow-schema";

export const PLUGIN_NAME = "developer-os";

/** Everything this adapter owns lives under one directory of the product home. */
export const CODEX_ROOT_SEGMENT = "codex";

/** Spec §4: `<product-home>/codex/plugins/developer-os`. */
export const PLUGIN_TREE_SEGMENTS: readonly string[] = [
  CODEX_ROOT_SEGMENT,
  "plugins",
  PLUGIN_NAME,
];

/** Spec §4: relative to `<product-home>/codex`, which is the marketplace root. */
export const MARKETPLACE_RELATIVE_PATH = ".agents/plugins/marketplace.json";

/**
 * `PLUGIN_TREE_SEGMENTS` with the leading `CODEX_ROOT_SEGMENT` dropped —
 * i.e. `plugins/developer-os`, relative to the **marketplace root**
 * (`<product-home>/codex`), not the product home. `buildPluginTree`'s own
 * output (`.codex-plugin/plugin.json`, `skills/...`) is relative to the
 * plugin root, one level deeper than the marketplace root
 * `proposeCodexInstall` resolves against — a caller must join this prefix
 * onto each `buildPluginTree` artifact's path before handing the tree to
 * `proposeCodexInstall`. Skip that join and the artifact still resolves:
 * the plugin root is a descendant of the marketplace root, so containment
 * still passes — it just lands one level too shallow. That is silent
 * under-nesting, not a refusal, which is why this is computed from
 * `PLUGIN_TREE_SEGMENTS` rather than typed again as a string literal
 * wherever it is needed.
 */
export const PLUGIN_TREE_PREFIX = PLUGIN_TREE_SEGMENTS.slice(1).join("/");

/**
 * This repository has not cut an independent release for any package — every
 * `package.json` in the workspace, including this adapter's own, is pinned at
 * `0.0.0`. The manifest's `version` tracks that convention rather than
 * inventing a second numbering scheme with nothing to keep it in sync.
 */
export const PLUGIN_VERSION = "0.0.0";

/**
 * Scoped to what this plugin actually is — the Codex half of Developer OS —
 * rather than restating the root package description verbatim, which also
 * names Claude Code and would be misleading shipped inside a Codex-only tree.
 */
export const PLUGIN_DESCRIPTION =
  "Local-first Developer OS workflows for Codex, rendered from the shared workflow contract.";

/**
 * Spec §14.4: a plugin manifest is `<plugin>/.codex-plugin/plugin.json`. The
 * vendor documents `author`, `homepage`, `repository`, `license`, `keywords`,
 * `apps`, `mcpServers` and an `interface` object beyond what we emit here;
 * every one of those is a field that could differ between versions and break
 * an install for no benefit this adapter needs. `skills` is the relative
 * string `"skills"`, resolved by Codex against the plugin root — never an
 * absolute path, which would tie the tree to the machine that generated it.
 */
function manifest(): RenderedArtifact {
  return {
    path: ".codex-plugin/plugin.json",
    contents: `${JSON.stringify(
      {
        name: PLUGIN_NAME,
        version: PLUGIN_VERSION,
        description: PLUGIN_DESCRIPTION,
        skills: "skills",
      },
      null,
      2,
    )}\n`,
  };
}

/**
 * No `hooks/hooks.json` — see the Claude adapter's `plugin.ts` for the
 * full record. The decision is ratified for both adapters in one change:
 * neither ships a hook whose command names an executable this pipeline can
 * produce, since `RenderedArtifact` is `{ path, contents }` with no mode and
 * `ManagedArtifactV1` has `kind: "file"` and no mode either. DOS-P6 restores
 * hooks for both adapters together, once there is a command to name.
 */

/**
 * The rendered skills plus the manifest that makes them a plugin, in a stable
 * order. Ordering is part of the artifact contract: a directory reader that
 * yields the workflows in any order must still produce byte-identical output,
 * which is what Task 15 tests by reversing the reader.
 */
export function buildPluginTree(
  skills: readonly RenderedArtifact[],
): readonly RenderedArtifact[] {
  if (skills.length === 0) {
    throw new Error("refusing to build a plugin tree with no skills");
  }
  const tree = [...skills, manifest()].sort((left, right) =>
    compareCodePoints(left.path, right.path),
  );
  /**
   * Two artifacts on one path is one file on disk and two entries in the
   * tree. A skill's path is built from the workflow's `id`, which comes from
   * the YAML rather than the directory it sits in, and nothing cross-checks
   * the two — so two workflows declaring the same `id` would silently render
   * one file while the tree claimed two.
   */
  const paths = new Set(tree.map((artifact) => artifact.path));
  if (paths.size !== tree.length) {
    throw new Error(
      "refusing to build a plugin tree in which two artifacts claim one path; two workflows share an id",
    );
  }
  return tree;
}
