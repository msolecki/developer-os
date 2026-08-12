import { Buffer } from "node:buffer";
import { posix } from "node:path";
import { hashBytes } from "@developer-os/core";
import type {
  ChangePlanOperationV1,
  ManagedArtifactV1,
} from "@developer-os/core";
import type { RenderedArtifact } from "@developer-os/workflow-schema";
import { MARKETPLACE_NAME } from "./marketplace.js";
import { CODEX_ROOT_SEGMENT, PLUGIN_NAME } from "./plugin.js";

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
  /**
   * Which side of `operations` `registration` belongs on. Spec §4.1: the
   * plugin cannot be added from a marketplace that has no files at the path
   * it names, so install registers *after* the tree is written. Spec §4.2:
   * uninstall reverses that, unregistering *before* the tree is deleted,
   * because a marketplace registered against a directory already removed is
   * worse than leaving both in place. `CodexInstallProposal` is one type for
   * both directions with nothing else distinguishing them, so an apply-phase
   * caller had to infer the order from which function it called — this field
   * makes the ordering data the caller reads instead of prose it must
   * remember, and get it backwards on uninstall by inference and you leave a
   * dangling registration behind.
   */
  readonly registrationPhase: "after-operations" | "before-operations";
}

/**
 * Founder decision, 2026-08-12: `tree` is resolved against the **marketplace
 * root**, `<home>/codex` — the same directory `codex plugin marketplace add`
 * registers (see `installRegistration` below). A plugin-tree artifact's path
 * therefore carries the `plugins/developer-os/...` prefix relative to this
 * root, and a marketplace-descriptor artifact's path is
 * `.agents/plugins/marketplace.json` — Task 13's `renderCodexInstallTree`
 * emits both in one list, every path relative to this same root, and this
 * function is what that list is fed into.
 *
 * The plugin-tree root (`<home>/codex/plugins/developer-os`, what
 * `buildPluginTree` itself uses) is a **descendant** of this root, which is
 * exactly why an unprefixed reading is dangerous rather than merely wrong: a
 * plugin-tree-relative path fed here as-is — `buildPluginTree`'s raw output,
 * with no `plugins/developer-os/` prefix — does not escape and containment
 * still passes, it just under-nests one level too shallow, landing at
 * `<home>/codex/.codex-plugin/...` instead of
 * `<home>/codex/plugins/developer-os/.codex-plugin/...`. A caller must join
 * `PLUGIN_TREE_PREFIX` (`plugin.ts`) onto each `buildPluginTree` artifact's
 * path before handing the tree here — the failure mode without it is silent
 * under-nesting, not a refusal.
 */
function marketplaceRoot(context: InstallContext): string {
  return posix.join(context.home, CODEX_ROOT_SEGMENT);
}

/**
 * Shared by both `resolveWithin` (install: joins a relative artifact path
 * onto `root` first) and `proposeCodexUninstall` (uninstall: called directly
 * on an already-absolute manifest path). Normalizing before the prefix check
 * matters on the uninstall side: a manifest path of `<root>/../evil` starts
 * with `${root}/` as a raw string, but normalizes to a directory *outside*
 * `root` — the same class of escape `resolveWithin` refuses here.
 */
function containedWithin(root: string, candidate: string): string | undefined {
  const resolved = posix.normalize(candidate);
  return resolved.startsWith(`${root}/`) ? resolved : undefined;
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
    throw new Error(`artifact path escapes the marketplace root: ${relative}`);
  }
  const resolved = containedWithin(root, posix.join(root, relative));
  if (resolved === undefined) {
    throw new Error(`artifact path escapes the marketplace root: ${relative}`);
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
  const root = marketplaceRoot(context);
  return {
    schemaVersion: 1,
    productVersion: context.productVersion,
    registrationPhase: "after-operations",
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
  const root = marketplaceRoot(context);
  // Two checks, both closing the same gap the install side already refuses
  // via `resolveWithin`: `owner !== "codex"` refuses a foreign-owned artifact
  // parked under our root (copied verbatim from the manifest entry, so
  // `validateChangePlan` cannot catch it — it compares the operation against
  // that same entry); `containedWithin` refuses a manifest path that passes a
  // raw string-prefix test but normalizes outside `root`.
  const owned = [...managed.values()]
    .flatMap((artifact) => {
      if (artifact.owner !== "codex") {
        return [];
      }
      const targetPath = containedWithin(root, artifact.path);
      return targetPath === undefined ? [] : [{ artifact, targetPath }];
    })
    .sort((left, right) => (left.targetPath < right.targetPath ? -1 : 1));

  if (owned.length === 0) {
    throw new Error("refusing to propose an empty uninstall plan");
  }

  return {
    schemaVersion: 1,
    productVersion: context.productVersion,
    registrationPhase: "before-operations",
    operations: owned.map(({ artifact, targetPath }) => ({
      targetPath,
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
