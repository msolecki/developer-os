import { lstatSync, realpathSync } from "node:fs";
import type { Stats } from "node:fs";
import { basename, dirname, join } from "node:path";

import type {
  ArtifactOwner,
  CanonicalAbsolutePathV1,
  CanonicalPathEvidenceV1,
  ManifestAdmissionContextV1,
} from "@developer-os/core";

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
  | { readonly kind: "confined"; readonly roots: readonly CanonicalAbsolutePathV1[] }
  | { readonly kind: "unconfined"; readonly reason: string };

/**
 * There is exactly one factory. A call site with no live root to confine
 * against must pass `{ kind: "unconfined", reason }` — there is no default
 * arm and no zero-argument call that would silently produce that behavior.
 * `reason` is not read by the predicate; it exists so an unconfined call site
 * cannot compile without a written justification, and readers see it right at
 * the call rather than trusting an absent argument.
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
  const { roots } = confinement;
  return (_owner: ArtifactOwner, path: CanonicalAbsolutePathV1) =>
    roots.some((root) => path === root || path.startsWith(`${root}/`))
      ? path
      : (`${path}${OUTSIDE_AUTHORITY_SUFFIX}` as CanonicalAbsolutePathV1);
}
