import { compareCodePoints } from "@developer-os/workflow-schema";
import type { RenderedArtifact } from "@developer-os/workflow-schema";

export const PLUGIN_NAME = "developer-os";

/**
 * Claude architecture former §4: `~/.claude/skills/developer-os/`, discovered in place. Segments
 * rather than a joined absolute path, so the caller resolves them against a
 * real home and no machine path is ever written into this repository.
 */
export const PLUGIN_INSTALL_SEGMENTS: readonly string[] = [
  ".claude",
  "skills",
  PLUGIN_NAME,
];

// Ordering comes from the compiler, which owns the determinism contract.
// The duplicate that lived here is gone — `claude-adapter.md` §9.5.

/**
 * Claude architecture former §14.1: the manifest is optional and `name` is its only required field,
 * and Claude Code ignores unrecognized top-level fields at load.
 *
 * Minimal on purpose. `displayName` requires 2.1.143, `defaultEnabled` requires
 * 2.1.154 and an object `metadata` requires 2.1.222; depending on none of them
 * is what keeps the supported floor at `CLAUDE_MINIMUM_VERSION` (Claude architecture former §5.2).
 */
function manifest(): RenderedArtifact {
  return {
    path: ".claude-plugin/plugin.json",
    contents: `${JSON.stringify({ name: PLUGIN_NAME }, null, 2)}\n`,
  };
}

/**
 * **`hooks/hooks.json` is deliberately not emitted.** The first version named
 * three commands under a `bin/` directory that did not exist; removing those
 * dangling claims was ratified on 2026-08-12 and DOS-P6 later declined the two
 * capture hooks. `BACKLOG.md` §8 carries the decision for both adapters.
 *
 * The first version emitted hooks whose commands were
 * `${CLAUDE_PLUGIN_ROOT}/bin/session-start` and two siblings. A fresh-context
 * review pointed out that **no task in this plan creates `bin/`**, so the
 * plugin declared three hooks whose commands did not exist — and
 * `claude plugin validate` checks schema, not existence, so `plugin_hooks`
 * could still report `yes` over a dangling path.
 *
 * An executable bit is not the blocker: a `type: "command"` handler may name
 * the installed `developer-os` binary directly. The two capture events remain
 * declined because neither can supply faithful agent-authored observation text
 * without reading the vendor transcript field, which this product refuses. DOS-P11 may
 * reintroduce only the eleven non-capture hooks from the legacy runtime. Any
 * such change must name installed product verbs, observe the hook firing, and
 * cover drift and uninstall in the same change.
 */

/**
 * The rendered skills plus the two files that make them a plugin, in a stable
 * order. Ordering is part of the artifact contract: Claude architecture former §7.3 requires the tree
 * to be byte-identical across two renders and under a reversed directory
 * reader, and a tree whose order depends on input order cannot be.
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
   * Two artifacts on one path is one file on disk and two entries in the tree.
   * A skill's path is built from the workflow's `id`, which comes from the YAML
   * rather than from the directory it sits in, and nothing cross-checks the
   * two — so two directories declaring the same `id` silently render one file
   * while the tree claims two. The drift gate compares a count of unique paths
   * against a count of artifacts, so the inflated total would mask an extra
   * file on disk. Found by fresh-context review, 2026-08-11.
   */
  const paths = new Set(tree.map((artifact) => artifact.path));
  if (paths.size !== tree.length) {
    throw new Error(
      "refusing to build a plugin tree in which two artifacts claim one path; two workflows share an id",
    );
  }
  return tree;
}
