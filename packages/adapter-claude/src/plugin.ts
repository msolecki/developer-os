import { compareCodePoints } from "@developer-os/workflow-schema";
import type { RenderedArtifact } from "@developer-os/workflow-schema";

export const PLUGIN_NAME = "developer-os";

/**
 * Spec §4: `~/.claude/skills/developer-os/`, discovered in place. Segments
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
 * Spec §14.1: the manifest is optional and `name` is its only required field,
 * and Claude Code ignores unrecognized top-level fields at load.
 *
 * Minimal on purpose. `displayName` requires 2.1.143, `defaultEnabled` requires
 * 2.1.154 and an object `metadata` requires 2.1.222; depending on none of them
 * is what keeps the supported floor at `CLAUDE_MINIMUM_VERSION` (spec §5.2).
 */
function manifest(): RenderedArtifact {
  return {
    path: ".claude-plugin/plugin.json",
    contents: `${JSON.stringify({ name: PLUGIN_NAME }, null, 2)}\n`,
  };
}

/**
 * **`hooks/hooks.json` is deliberately not emitted, and this is the record of
 * why.** Amends spec §6, which declares three events. **Ratified by the founder
 * on 2026-08-12**, and the ratified decision covers *both* adapters: neither
 * this one nor Codex ships `hooks/hooks.json`, so the two are in one state
 * rather than two coincidences. `BACKLOG.md` §8 carries the row.
 *
 * The first version emitted hooks whose commands were
 * `${CLAUDE_PLUGIN_ROOT}/bin/session-start` and two siblings. A fresh-context
 * review pointed out that **no task in this plan creates `bin/`**, so the
 * plugin declared three hooks whose commands did not exist — and
 * `claude plugin validate` checks schema, not existence, so `plugin_hooks`
 * could still report `yes` over a dangling path.
 *
 * The obvious repair — emit the three scripts — does not work, for a reason
 * that only appears once you try it. A `type: "command"` hook needs an
 * executable file, and **nothing in this pipeline can express an executable
 * bit**: `RenderedArtifact` is `{ path, contents }`, and `ManagedArtifactV1`
 * has `kind: "file"` and no mode. A non-executable script fails exactly as a
 * missing one does.
 *
 * So the honest state is: this adapter ships skills, and capture and injection
 * go through the wrapper — which is what the capability model already reports,
 * because `session_end_capture`, `session_start_injection` and
 * `pre_compact_backup` are `wrapper-required` until a hook is *observed firing*
 * (spec §6.1) and none ever could be. Nothing regresses; a claim that was
 * always false stops being made.
 *
 * **What restoring it needs**, together, in one change: the hook bodies (whose
 * behaviour is DOS-P6's capture contract), a way to mark a generated artifact
 * executable, and a test that observes a hook actually firing. Owner: DOS-P6.
 */

/**
 * The rendered skills plus the two files that make them a plugin, in a stable
 * order. Ordering is part of the artifact contract: spec §7.3 requires the tree
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
