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

/**
 * By code point, which is the same order as UTF-8 bytes.
 *
 * Not the default `<`: it compares UTF-16 code units, so every code point at or
 * above U+10000 sorts *below* U+E000–U+FFFF. That is still deterministic inside
 * Node, which is why it survives a local test — and it is wrong the moment a
 * consumer in another language, a canonical hash, or a `sort`-based check
 * orders the same set.
 *
 * **Duplicated from `packages/workflow-schema/src/derive.ts`, deliberately and
 * temporarily.** That copy is private to the compiler. When DOS-P5 needs the
 * same ordering there will be three copies, and the right fix is one export
 * from `workflow-schema` — recorded as a residual for the architecture note
 * rather than done here, because widening a closed package's public door is not
 * this task's to decide.
 */
function compareCodePoints(left: string, right: string): number {
  let leftAt = 0;
  let rightAt = 0;
  while (leftAt < left.length && rightAt < right.length) {
    const a = left.codePointAt(leftAt) ?? 0;
    const b = right.codePointAt(rightAt) ?? 0;
    if (a !== b) return a < b ? -1 : 1;
    leftAt += a > 0xffff ? 2 : 1;
    rightAt += b > 0xffff ? 2 : 1;
  }
  return left.length - leftAt - (right.length - rightAt);
}

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
 * Spec §6. Three events, and `type: "command"` only — spec §14.2 records that
 * command hooks are what this design uses and that their contract is JSON on
 * stdin with exit `0` success, `2` blocking, anything else non-blocking.
 *
 * Every command is addressed through `${CLAUDE_PLUGIN_ROOT}`, which is a hard
 * requirement rather than a tidiness preference: this repository is public and
 * a generated artifact carrying an absolute machine path would publish one.
 */
function hooks(): RenderedArtifact {
  const command = (script: string) => ({
    type: "command",
    command: `\${CLAUDE_PLUGIN_ROOT}/bin/${script}`,
    timeout: 30,
  });
  const configuration = {
    hooks: {
      SessionStart: [
        {
          matcher: "startup|resume|clear|compact|fork",
          hooks: [command("session-start")],
        },
      ],
      SessionEnd: [{ matcher: "*", hooks: [command("session-end")] }],
      PreCompact: [
        { matcher: "manual|auto", hooks: [command("pre-compact")] },
      ],
    },
  };
  return {
    path: "hooks/hooks.json",
    contents: `${JSON.stringify(configuration, null, 2)}\n`,
  };
}

/**
 * The rendered skills plus the two files that make them a plugin, in a stable
 * order. Ordering is part of the artifact contract: spec §7.3 requires the tree
 * to be byte-identical across two renders and under a reversed directory
 * reader, and a tree whose order depends on input order cannot be.
 */
export function buildPluginTree(
  skills: readonly RenderedArtifact[],
): readonly RenderedArtifact[] {
  return [...skills, manifest(), hooks()].sort((left, right) =>
    compareCodePoints(left.path, right.path),
  );
}
