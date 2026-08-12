import { Buffer } from "node:buffer";
import { posix } from "node:path";
import { hashBytes } from "@developer-os/core";
import type {
  ChangePlanOperationV1,
  ManagedArtifactV1,
} from "@developer-os/core";
import type { RenderedArtifact } from "@developer-os/workflow-schema";
import { MARKETPLACE_NAME } from "./marketplace.js";
import { CODEX_ROOT_SEGMENT, PLUGIN_NAME, PLUGIN_TREE_SEGMENTS } from "./plugin.js";

export interface InstallContext {
  readonly home: string;
  readonly productVersion: string;
}

export interface CodexCliStep {
  readonly args: readonly string[];
  readonly description: string;
}

/**
 * What this module produces is a **proposal**, not a `ChangePlanV1` — see
 * `packages/adapter-claude/src/install.ts` for why. `registration` is the part
 * with no adapter-claude analogue: Claude never registers with a marketplace,
 * but Codex's own CLI is the only writer of `~/.codex/config.toml` (spec
 * §4.1), so registering and unregistering happen through `codex plugin`, not
 * through a file this adapter writes. The adapter proposes the argv; the
 * caller runs it in the apply phase, where a failure is a transaction
 * failure — this module never spawns a process (spec §2.3).
 */
export interface CodexInstallProposal {
  readonly schemaVersion: 1;
  readonly productVersion: string;
  readonly operations: readonly ChangePlanOperationV1[];
  readonly registration: readonly CodexCliStep[];
}

/**
 * `tree` is resolved **only** against the plugin-tree root — every path in it
 * is `buildPluginTree`'s own convention (`.codex-plugin/plugin.json`,
 * `skills/...`), the same convention the brief's test suite fixes with
 * `${home}/codex/plugins/developer-os` as `root`. The marketplace descriptor
 * (`renderMarketplace`, relative to `<product-home>/codex` — a *different*
 * root, per the docblock on `RenderedArtifact` and the risk Task 10 carried
 * forward) is deliberately **not** accepted here: this function has no way to
 * tell a marketplace-root artifact from a plugin-tree-root one inside a flat
 * `RenderedArtifact[]` without guessing at its path, and no test in this
 * task's brief exercises that case. Whatever composes the marketplace
 * descriptor's own create/replace/remove operation (Task 13's
 * `renderCodexInstallTree`, per the plan) must build it separately, against
 * `marketplaceRoot`, not by widening `tree` here.
 */
function pluginRoot(context: InstallContext): string {
  return posix.join(context.home, ...PLUGIN_TREE_SEGMENTS);
}

/** Relative to `<product-home>/codex` — the marketplace root `renderMarketplace` targets. */
function marketplaceRoot(context: InstallContext): string {
  return posix.join(context.home, CODEX_ROOT_SEGMENT);
}

/**
 * Checked here rather than trusted from the renderer, matching
 * `packages/adapter-claude/src/install.ts`'s `resolveWithin`: this is the
 * boundary where a relative path becomes a real filesystem write, and it is
 * worth holding even though `buildPluginTree` already refuses a non-slug id
 * upstream.
 */
function resolveWithin(root: string, relative: string): string {
  if (posix.isAbsolute(relative)) {
    throw new Error(`artifact path escapes the plugin root: ${relative}`);
  }
  const resolved = posix.normalize(posix.join(root, relative));
  if (!resolved.startsWith(`${root}/`)) {
    throw new Error(`artifact path escapes the plugin root: ${relative}`);
  }
  return resolved;
}

/**
 * The manifest's record of what this adapter already owns, keyed by target
 * path. Passed in rather than read here: `packages/core` owns the manifest.
 */
export type ManagedByPath = ReadonlyMap<string, ManagedArtifactV1>;

/**
 * Spec §4.1: registration is marketplace-add then plugin-add, in that order —
 * the plugin cannot be added from a marketplace that is not yet registered.
 */
function installRegistration(context: InstallContext): readonly CodexCliStep[] {
  return [
    {
      args: ["plugin", "marketplace", "add", MARKETPLACE_NAME, marketplaceRoot(context)],
      description: `register the ${MARKETPLACE_NAME} marketplace with Codex`,
    },
    {
      args: ["plugin", "add", `${PLUGIN_NAME}@${MARKETPLACE_NAME}`, "--json"],
      description: `install the ${PLUGIN_NAME} plugin from the ${MARKETPLACE_NAME} marketplace`,
    },
  ];
}

/**
 * Spec §4.2: uninstall reverses the install order — plugin-remove then
 * marketplace-remove — and runs *before* the tree is deleted, because a
 * marketplace registered against a directory we already removed is worse than
 * leaving both in place.
 */
function uninstallRegistration(): readonly CodexCliStep[] {
  return [
    {
      args: ["plugin", "remove", PLUGIN_NAME],
      description: `remove the ${PLUGIN_NAME} plugin from Codex`,
    },
    {
      args: ["plugin", "marketplace", "remove", MARKETPLACE_NAME],
      description: `unregister the ${MARKETPLACE_NAME} marketplace from Codex`,
    },
  ];
}

export function proposeCodexInstall(
  tree: readonly RenderedArtifact[],
  context: InstallContext,
  managed: ManagedByPath = new Map(),
): CodexInstallProposal {
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
      // already installed. `validateChangePlan` refuses a `create` over a
      // managed artifact with `already_owned`, so a second install could
      // never have run with a hardcoded `create`.
      return {
        targetPath,
        operation: existing === undefined ? ("create" as const) : ("replace" as const),
        owner: "codex" as const,
        kind: "file" as const,
        expectedBeforeHash: existing?.installedHash ?? null,
        source: artifact.path,
        // `dedicated` because this adapter owns whole files and never
        // three-way merges. Spec §4.1: the vendor's tool owns the vendor's
        // config, so nothing here touches `config.toml`.
        mergeStrategy: "dedicated" as const,
        proposedHash: hashBytes(Buffer.from(artifact.contents, "utf8")),
      };
    }),
    registration: installRegistration(context),
  };
}

/**
 * Spec §4.2: the tree is deleted file by file, one `remove` operation per
 * managed artifact, matching `proposeClaudeUninstall`. `registration` runs
 * first — see `uninstallRegistration` — so by the time these removes apply,
 * Codex no longer knows about the plugin or the marketplace pointing at it.
 */
export function proposeCodexUninstall(
  context: InstallContext,
  managed: ManagedByPath,
): CodexInstallProposal {
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
      // operation, `source === ""` and `proposedHash === null` for a
      // `remove`, and a matching managed artifact.
      expectedBeforeHash: artifact.installedHash,
      source: "",
      mergeStrategy: artifact.mergeStrategy,
      proposedHash: null,
    })),
    registration: uninstallRegistration(),
  };
}
