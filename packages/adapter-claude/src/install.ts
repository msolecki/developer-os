import { Buffer } from "node:buffer";
import { posix } from "node:path";
import { hashBytes } from "@developer-os/core";
import type {
  ChangePlanOperationV1,
  ManagedArtifactV1,
} from "@developer-os/core";
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
  // The root itself is not a file target. `""`, `"."` and `"sub/.."` all
  // normalize to it, and the result was a `create` with `kind: "file"` aimed at
  // the plugin *directory* — which the validator accepts and the executor then
  // fails on, late and obscurely.
  if (!resolved.startsWith(`${root}/`)) {
    throw new Error(`artifact path escapes the plugin root: ${relative}`);
  }
  return resolved;
}

/**
 * The manifest's record of what this adapter already owns, keyed by target
 * path. Passed in rather than read here: `packages/core` owns the manifest, and
 * an adapter that read it would be a second reader of a file with one owner.
 */
export type ManagedByPath = ReadonlyMap<string, ManagedArtifactV1>;

export function proposeClaudeInstall(
  tree: readonly RenderedArtifact[],
  context: InstallContext,
  managed: ManagedByPath = new Map(),
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
    operations: tree.map((artifact) => {
      const targetPath = resolveWithin(root, artifact.path);
      const existing = managed.get(targetPath);
      // `create` for a target nobody owns, `replace` for one this adapter
      // already installed. Hardcoding `create` made `update` unrepresentable:
      // `validateChangePlan` refuses a `create` over a managed artifact with
      // `already_owned`, so a second install could never have run.
      return {
        targetPath,
        operation: existing === undefined ? ("create" as const) : ("replace" as const),
        owner: "claude" as const,
        kind: "file" as const,
        expectedBeforeHash: existing?.installedHash ?? null,
        source: artifact.path,
        // `dedicated` because this adapter merges no foreign file. Spec §4.3
        // dissolved the semantic config merge rather than answering it: the
        // install shape writes only into a directory Developer OS owns wholly.
        mergeStrategy: "dedicated" as const,
        proposedHash: hashBytes(Buffer.from(artifact.contents, "utf8")),
      };
    }),
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
  managed: ManagedByPath,
): ClaudeInstallProposal {
  const root = pluginRoot(context);
  const owned = [...managed.values()]
    .filter((artifact) => artifact.path.startsWith(`${root}/`))
    .sort((left, right) => (left.path < right.path ? -1 : 1));

  if (owned.length === 0) {
    throw new Error("refusing to propose an empty uninstall plan");
  }

  return {
    schemaVersion: 1,
    productVersion: context.productVersion,
    operations: owned.map((artifact) => ({
      targetPath: artifact.path,
      operation: "remove" as const,
      owner: artifact.owner,
      kind: artifact.kind,
      // `validateChangePlan` requires a real prior hash for any non-`create`
      // operation, `source === ""` and `proposedHash === null` for a `remove`,
      // and a matching managed artifact. The first version of this function
      // violated all three at once and could never have been applied — and the
      // test that guarded it asserted field values instead of calling the
      // validator, so it stayed green. Found by fresh-context review.
      expectedBeforeHash: artifact.installedHash,
      source: "",
      mergeStrategy: artifact.mergeStrategy,
      proposedHash: null,
    })),
  };
}
