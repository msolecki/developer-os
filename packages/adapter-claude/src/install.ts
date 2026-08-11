import { Buffer } from "node:buffer";
import { posix } from "node:path";
import { hashBytes } from "@developer-os/core";
import type { ChangePlanOperationV1 } from "@developer-os/core";
import type { RenderedArtifact } from "@developer-os/workflow-schema";
import { PLUGIN_INSTALL_SEGMENTS } from "./plugin.js";

export interface InstallContext {
  readonly home: string;
  readonly productVersion: string;
}

/**
 * What this module produces is a **proposal**, not a `ChangePlanV1`.
 *
 * `ChangePlanV1.operations` is `ValidatedChangePlanOperationV1[]`, and the only
 * thing that produces those is `validateChangePlan`, which resolves ownership
 * and canonicalises every target. An adapter that constructed a `ChangePlanV1`
 * directly would be asserting a validation it never performed. So the adapter
 * proposes and the caller validates, which is the shape Foundation designed.
 */
export interface ClaudeInstallProposal {
  readonly schemaVersion: 1;
  readonly productVersion: string;
  readonly operations: readonly ChangePlanOperationV1[];
}

function pluginRoot(context: InstallContext): string {
  return posix.join(context.home, ...PLUGIN_INSTALL_SEGMENTS);
}

/**
 * Checked here rather than trusted from the renderer.
 *
 * The renderer refuses a non-slug id, so today these paths are safe by the time
 * they arrive. This is the boundary where a relative path becomes a real
 * filesystem write, and spec §10 says the plugin directory is the only path
 * this adapter writes — a guarantee worth holding at both ends, because the
 * renderer is not the only thing that could ever produce a `RenderedArtifact`.
 */
function resolveWithin(root: string, relative: string): string {
  if (posix.isAbsolute(relative)) {
    throw new Error(`artifact path escapes the plugin root: ${relative}`);
  }
  const resolved = posix.normalize(posix.join(root, relative));
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new Error(`artifact path escapes the plugin root: ${relative}`);
  }
  return resolved;
}

export function proposeClaudeInstall(
  tree: readonly RenderedArtifact[],
  context: InstallContext,
): ClaudeInstallProposal {
  // A plan with no operations applies cleanly and changes nothing, which is
  // indistinguishable from success. `validateChangePlan` refuses an empty
  // operation list too; refusing here names the cause.
  if (tree.length === 0) {
    throw new Error("refusing to propose an empty install plan");
  }
  const root = pluginRoot(context);
  return {
    schemaVersion: 1,
    productVersion: context.productVersion,
    operations: tree.map((artifact) => ({
      targetPath: resolveWithin(root, artifact.path),
      operation: "create" as const,
      owner: "claude" as const,
      kind: "file" as const,
      expectedBeforeHash: null,
      source: artifact.path,
      // `dedicated` because this adapter merges no foreign file. Spec §4.3
      // dissolved the semantic config merge rather than answering it: the
      // install shape writes only into a directory Developer OS owns wholly.
      mergeStrategy: "dedicated" as const,
      proposedHash: hashBytes(Buffer.from(artifact.contents, "utf8")),
    })),
  };
}

/**
 * Spec §4.2: there is no uninstall step, because nothing was installed from a
 * marketplace. Removing the directory is the whole operation, and Foundation
 * refuses if any file under it has drifted — a drifted file is a user edit, and
 * Foundation never overwrites one.
 */
export function proposeClaudeUninstall(
  context: InstallContext,
): ClaudeInstallProposal {
  return {
    schemaVersion: 1,
    productVersion: context.productVersion,
    operations: [
      {
        targetPath: pluginRoot(context),
        operation: "remove",
        owner: "claude",
        kind: "directory",
        expectedBeforeHash: null,
        source: "plugins/claude",
        mergeStrategy: "dedicated",
        proposedHash: null,
      },
    ],
  };
}
