import { lstatSync, realpathSync } from "node:fs";
import type { Stats } from "node:fs";
import { basename, dirname, join } from "node:path";

import { parseInstructionId } from "@developer-os/core";
import type {
  ArtifactOwner,
  CanonicalAbsolutePathV1,
  CanonicalPathEvidenceV1,
  InstructionCategoryV1,
  ManifestAdmissionContextV1,
  OwnerPathArmV1,
} from "@developer-os/core";
import { LAUNCHD_JOBS } from "@developer-os/platform-macos";

import { claudeInstructionPaths, codexInstructionPaths } from "../instructions/vendor-homes.js";
import type { VendorHomesV1 } from "../instructions/vendor-homes.js";

/**
 * Resolves every ancestor of `path` that currently exists on disk against the
 * real filesystem, following any symlink found among them, and leaves the
 * final path component — and any ancestor that does not exist yet — exactly
 * as given. Mirrors `ManifestGuards.assertReadable`
 * (`packages/core/src/manifest/types.ts:144`): canonicalizing ancestors closes
 * the hole a leaf-only guard cannot, and preserving the leaf keeps a
 * subsequent identity check on it meaningful.
 *
 * The not-yet-exists tolerance is not optional polish: `BootstrapExecutor`
 * calls this on the manifest it is *about to* write, naming paths one plan
 * ordinal away from existing (`expectedBefore: "absent"` throughout
 * `executor.ts`'s plan construction). A canonicalizer that required existence
 * would throw on every fresh init before a single file was created.
 *
 * `node:path.resolve` is lexical — it never touches the filesystem — so on an
 * already-absolute, already-normalized string it always returns that same
 * string. The three predecessors this module replaces each used it as their
 * `reopenCanonicalAbsolutePath`, which meant `admitCanonicalAbsolutePath`'s
 * `reopenCanonicalAbsolutePath(value) !== value` refusal
 * (`packages/core/src/update/paths.ts:96`) could never fire: a symlinked
 * ancestor was never distinguishable from a plain one. That is the defect
 * NEW-51 exists to end.
 */
function canonicalizeExistingAncestors(path: string): string {
  if (path === "/") return "/";
  const parent = canonicalizeExistingAncestors(dirname(path));
  const candidate = join(parent, basename(path));
  let stats: Stats;
  try {
    stats = lstatSync(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate;
    throw error;
  }
  return stats.isSymbolicLink() ? realpathSync(candidate) : candidate;
}

function reopenCanonicalAbsolutePath(path: string): string {
  return join(canonicalizeExistingAncestors(dirname(path)), basename(path));
}

function containsCanonicalPath(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

/**
 * Folded-alias detection (NFC/case aliasing) is not implemented by any of the
 * three predecessors this module replaces, and NEW-51 is scoped to the
 * confinement predicate silently admitting everything — not to this gap.
 * Carried forward unchanged rather than fixed as a side effect of this task.
 */
function hasFoldedAlias(): boolean {
  return false;
}

export function createCanonicalPathEvidence(): CanonicalPathEvidenceV1 {
  return { reopenCanonicalAbsolutePath, containsCanonicalPath, hasFoldedAlias };
}

const OUTSIDE_AUTHORITY_SUFFIX = "/outside-authority";

export type OwnerPathConfinementV1 =
  | { readonly kind: "confined"; readonly roots: readonly CanonicalAbsolutePathV1[]; readonly vendors: VendorHomesV1 | null }
  | { readonly kind: "unconfined"; readonly reason: string };

function isContent(arm: OwnerPathArmV1, categories: readonly InstructionCategoryV1[]): boolean {
  return arm.kind === "instruction" && arm.mode === "content" && categories.includes(arm.category);
}

function isBlock(arm: OwnerPathArmV1): boolean {
  return arm.kind === "instruction" && arm.mode === "block" && arm.category === "vendor-file";
}

/** `<dir>/developer-os-<id><extension>` with `<id>` a valid `InstructionIdV1`. */
function isPrefixedLeaf(dir: string, extension: string, path: string): boolean {
  if (dirname(path) !== dir) return false;
  const leaf = basename(path);
  if (!leaf.startsWith("developer-os-") || !leaf.endsWith(extension)) return false;
  try {
    parseInstructionId(leaf.slice("developer-os-".length, -extension.length));
    return true;
  } catch {
    return false;
  }
}

/** `foundation.md` §12.5's closed table: exact, owner-bound and arm-bound. Nothing here is a general root. */
function isVendorAuthorized(vendors: VendorHomesV1, owner: ArtifactOwner, path: string, arm: OwnerPathArmV1): boolean {
  if (path.split("/").slice(1).some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  if (owner === "claude") {
    const claude = claudeInstructionPaths(vendors);
    if (path.startsWith(`${claude.pluginRoot}/`)) {
      return arm.kind === "file" || arm.kind === "directory" || isContent(arm, ["agent", "skill", "command"]);
    }
    if (isPrefixedLeaf(claude.rulesDir, ".md", path)) return isContent(arm, ["scoped-rule"]);
    if (isPrefixedLeaf(claude.outputStylesDir, ".md", path)) return isContent(arm, ["output-style"]);
    if (path === claude.instructionFile) return isBlock(arm);
    return arm.kind === "directory"
      && [dirname(claude.rulesDir), dirname(claude.pluginRoot), claude.pluginRoot, claude.rulesDir, claude.outputStylesDir].includes(path);
  }
  if (owner === "codex") {
    const codex = codexInstructionPaths(vendors);
    if (isPrefixedLeaf(codex.agentsDir, ".toml", path)) return isContent(arm, ["agent"]);
    if (path === codex.instructionFile) return isBlock(arm);
    return arm.kind === "directory" && (path === vendors.codexHome || path === codex.agentsDir);
  }
  // §6: the closed external-file authorization for one installed automation plist, and nothing else.
  if (owner === "macos") {
    return arm.kind === "file" && LAUNCHD_JOBS.some((job) => path === join(vendors.userHome, "Library", "LaunchAgents", job.plistFileName));
  }
  return false;
}

/**
 * There is exactly one factory. A call site with no live root to confine
 * against must pass `{ kind: "unconfined", reason }` — there is no default
 * arm and no zero-argument call that would silently produce that behavior.
 * `reason` is not read by the predicate; it exists so an unconfined call site
 * cannot compile without a written justification, and readers see it right at
 * the call rather than trusting an absent argument.
 *
 * `vendors` adds `foundation.md` §12.5's closed vendor authorization on top of `roots`;
 * `null` confines to `roots` alone.
 *
 * A refused path is rewritten to a value that is guaranteed to differ from
 * its input, never thrown here: `ManifestAdmissionContextV1.admitOwnerPath`'s
 * contract is a value comparison (`packages/core/src/manifest/v2.ts:31`), and
 * the caller — `validateManifestV2` — is what turns that mismatch into a
 * thrown refusal.
 */
export function createOwnerPathAdmission(
  confinement: OwnerPathConfinementV1,
): ManifestAdmissionContextV1["admitOwnerPath"] {
  if (confinement.kind === "unconfined") {
    return (_owner: ArtifactOwner, path: CanonicalAbsolutePathV1) => path;
  }
  const { roots, vendors } = confinement;
  return (owner: ArtifactOwner, path: CanonicalAbsolutePathV1, arm: OwnerPathArmV1) =>
    roots.some((root) => path === root || path.startsWith(`${root}/`))
      || (vendors !== null && isVendorAuthorized(vendors, owner, path, arm))
      ? path
      : (`${path}${OUTSIDE_AUTHORITY_SUFFIX}` as CanonicalAbsolutePathV1);
}
