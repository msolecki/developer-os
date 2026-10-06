import { isAbsolute, resolve } from "node:path";

import { EXIT_CODES } from "../result.js";
import { hasExactKeys, isLowerHexSha256, isNonEmptyString, isRecord } from "../shape.js";
import {
  containsPath,
  containsPathLoosely,
  foldPath,
  ManifestStateError,
} from "../manifest/index.js";
import type {
  ArtifactKind,
  ArtifactOwner,
  ManagedArtifactV1,
  ManagedArtifactV2,
  MergeStrategy,
} from "../manifest/index.js";
import type {
  ChangeOperationKind,
  ChangePlanContext,
  ChangePlanOperationV1,
  ChangePlanRefusalReason,
  ChangePlanV1,
} from "./types.js";

const PLAN_KEYS = ["operations", "productVersion", "schemaVersion"];

const OPERATION_KEYS = [
  "expectedBeforeHash",
  "kind",
  "mergeStrategy",
  "operation",
  "owner",
  "proposedHash",
  "source",
  "targetPath",
];

const OWNERS = new Set<ArtifactOwner>(["core", "claude", "codex", "macos"]);
const KINDS = new Set<ArtifactKind>([
  "file",
  "directory",
  "symlink",
  "config-entry",
]);
const MERGE_STRATEGIES = new Set<MergeStrategy>([
  "dedicated",
  "semantic-json",
  "semantic-toml",
]);
const OPERATIONS = new Set<ChangeOperationKind>(["create", "replace", "remove"]);

const REFUSAL_MESSAGES: Record<ChangePlanRefusalReason, string> = {
  malformed: "change plan is malformed",
  duplicate_target: "change plan targets one path more than once",
  outside_owned_roots: "change plan target is outside every owned root",
  excluded_root: "change plan target is inside an excluded root",
  unmanaged_target: "change plan target is not a managed artifact",
  already_owned: "change plan would recreate a managed artifact",
  ownership_mismatch: "change plan owner does not match the managed artifact",
  hash_expectation: "change plan prior-hash expectation is not satisfied",
};

export class ChangePlanError extends Error {
  readonly code:
    | typeof EXIT_CODES.invalidInput
    | typeof EXIT_CODES.securityRefusal;
  readonly reason: ChangePlanRefusalReason;

  constructor(
    code: typeof EXIT_CODES.invalidInput | typeof EXIT_CODES.securityRefusal,
    reason: ChangePlanRefusalReason,
  ) {
    super(REFUSAL_MESSAGES[reason]);
    this.name = "ChangePlanError";
    this.code = code;
    this.reason = reason;
  }
}

function invalid(reason: ChangePlanRefusalReason = "malformed"): never {
  throw new ChangePlanError(EXIT_CODES.invalidInput, reason);
}

function refuse(reason: ChangePlanRefusalReason): never {
  throw new ChangePlanError(EXIT_CODES.securityRefusal, reason);
}





/**
 * Ownership is granted on exact containment and denied on case-folded
 * containment. macOS volumes are case-insensitive by default, so an exclusion
 * compared exactly would miss `<home>/BACKUPS` while the filesystem resolves it
 * to the very directory the exclusion names. Granting stays strict so a
 * case-varied path can never claim a root it does not literally sit under.
 */
function isWithinAny(roots: readonly string[], candidate: string): boolean {
  return roots.some((root) => containsPath(root, candidate));
}

function isWithinAnyLoosely(
  roots: readonly string[],
  candidate: string,
): boolean {
  return roots.some((root) => containsPathLoosely(root, candidate));
}

function validateOperation(value: unknown): ChangePlanOperationV1 {
  if (!isRecord(value) || !hasExactKeys(value, OPERATION_KEYS)) invalid();
  if (
    value.kind === "config-entry" ||
    !OPERATIONS.has(value.operation as ChangeOperationKind) ||
    !OWNERS.has(value.owner as ArtifactOwner) ||
    !KINDS.has(value.kind as ArtifactKind) ||
    !MERGE_STRATEGIES.has(value.mergeStrategy as MergeStrategy) ||
    typeof value.targetPath !== "string" ||
    value.targetPath.length === 0 ||
    !isAbsolute(value.targetPath) ||
    value.targetPath.includes("\0") ||
    typeof value.source !== "string"
  ) {
    invalid();
  }

  const operation = value.operation as ChangeOperationKind;
  if (operation === "create" && value.expectedBeforeHash !== null) {
    invalid("hash_expectation");
  }
  if (operation !== "create" && !isLowerHexSha256(value.expectedBeforeHash)) {
    invalid("hash_expectation");
  }
  if (operation === "remove") {
    if (value.source !== "" || value.proposedHash !== null) invalid();
  } else if (!isNonEmptyString(value.source) || !isLowerHexSha256(value.proposedHash)) {
    invalid();
  }

  return {
    targetPath: value.targetPath,
    operation,
    owner: value.owner as ArtifactOwner,
    kind: value.kind as ArtifactKind,
    expectedBeforeHash: value.expectedBeforeHash as string | null,
    source: value.source,
    mergeStrategy: value.mergeStrategy as MergeStrategy,
    proposedHash: value.proposedHash,
  };
}

function assertOwnedLocation(
  path: string,
  ownedRoots: readonly string[],
  excludedRoots: readonly string[],
): void {
  if (!isWithinAny(ownedRoots, path)) refuse("outside_owned_roots");
  if (isWithinAnyLoosely(excludedRoots, path)) refuse("excluded_root");
}

/**
 * The declared roots are checked before canonicalization, but the containment
 * decision uses the canonical ones, so the invariants have to hold there too.
 *
 * The decisive test is whether canonicalization *grew* authority: a canonical
 * root that contains its own declared root resolved to an ancestor, which is
 * what a user-writable `~/.claude` symlinked to `/` or to the home directory
 * does. Naming forbidden roots individually cannot work — `$HOME`, `~/.ssh`,
 * and `/etc` would each need listing — whereas a legitimate relocation such as
 * `~/.claude -> ~/Dropbox/claude` moves sideways and is still allowed.
 */
function assertUsableRoots(
  declaredRoots: readonly string[],
  canonicalRoots: readonly string[],
  canonicalExcluded: readonly string[],
): void {
  for (const [index, root] of canonicalRoots.entries()) {
    const declared = declaredRoots[index];
    if (declared === undefined) invalid();
    if (!isAbsolute(root) || resolve(root) === "/") {
      refuse("outside_owned_roots");
    }
    if (
      containsPathLoosely(root, declared) &&
      foldPath(root) !== foldPath(declared)
    ) {
      refuse("outside_owned_roots");
    }
    if (canonicalExcluded.some((excluded) => containsPathLoosely(excluded, root))) {
      refuse("excluded_root");
    }
    if (
      canonicalRoots.some(
        (other, otherIndex) =>
          otherIndex !== index && containsPathLoosely(other, root),
      )
    ) {
      refuse("outside_owned_roots");
    }
  }
  for (const excluded of canonicalExcluded) {
    if (!isAbsolute(excluded)) refuse("excluded_root");
  }
}

async function canonicalizeOrRefuse(
  context: ChangePlanContext,
  path: string,
  reason: ChangePlanRefusalReason = "outside_owned_roots",
): Promise<string> {
  let canonical: string;
  try {
    canonical = await context.canonicalize(path);
  } catch {
    refuse(reason);
  }
  if (!isAbsolute(canonical) || canonical.includes("\0")) {
    refuse(reason);
  }
  return canonical;
}

/** A row's recorded content hash under either schema; `null` for a V2 row that records none. */
export function managedInstalledHash(artifact: ManagedArtifactV1 | ManagedArtifactV2): string | null {
  if ("installedHash" in artifact) return artifact.installedHash;
  return "installedHash" in artifact.verification ? artifact.verification.installedHash : null;
}

function assertOwnership(
  operation: ChangePlanOperationV1,
  managed: ManagedArtifactV1 | ManagedArtifactV2 | undefined,
): void {
  if (operation.operation === "create") {
    if (managed !== undefined) refuse("already_owned");
    return;
  }
  if (managed === undefined) refuse("unmanaged_target");
  if (
    managed.owner !== operation.owner ||
    managed.kind !== operation.kind ||
    managed.mergeStrategy !== operation.mergeStrategy
  ) {
    refuse("ownership_mismatch");
  }
  if (managedInstalledHash(managed) !== operation.expectedBeforeHash) {
    refuse("hash_expectation");
  }
}

export async function validateChangePlan(
  value: unknown,
  context: ChangePlanContext,
): Promise<ChangePlanV1> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, PLAN_KEYS) ||
    value.schemaVersion !== 1 ||
    !isNonEmptyString(value.productVersion) ||
    !Array.isArray(value.operations) ||
    value.operations.length === 0
  ) {
    invalid();
  }
  if (
    context.ownedRoots.length === 0 ||
    context.excludedRoots.length === 0 ||
    !context.ownedRoots.every((root) => isAbsolute(root) && resolve(root) !== "/") ||
    !context.excludedRoots.every((root) => isAbsolute(root))
  ) {
    invalid();
  }

  const operations = value.operations.map(validateOperation);
  const canonicalTargets = await Promise.all(
    operations.map((operation) => canonicalizeOrRefuse(context, operation.targetPath)),
  );

  const targets = new Set<string>();
  for (const target of canonicalTargets) {
    const key = foldPath(target);
    if (targets.has(key)) invalid("duplicate_target");
    targets.add(key);
  }

  const managedByPath = new Map<string, ManagedArtifactV1 | ManagedArtifactV2>();
  for (const artifact of context.manifest.artifacts) {
    const canonical = await canonicalizeOrRefuse(
      context,
      artifact.path,
      "unmanaged_target",
    );
    const key = foldPath(canonical);
    if (managedByPath.has(key)) throw new ManifestStateError();
    managedByPath.set(key, artifact);
  }

  const canonicalOwned = await Promise.all(
    context.ownedRoots.map((root) => canonicalizeOrRefuse(context, root)),
  );
  const canonicalExcluded = await Promise.all(
    context.excludedRoots.map((root) =>
      canonicalizeOrRefuse(context, root, "excluded_root"),
    ),
  );
  assertUsableRoots(context.ownedRoots, canonicalOwned, canonicalExcluded);

  for (const [index, operation] of operations.entries()) {
    const target = canonicalTargets[index];
    if (target === undefined) invalid();
    assertOwnedLocation(target, canonicalOwned, canonicalExcluded);
    assertOwnership(operation, managedByPath.get(foldPath(target)));
  }

  return {
    schemaVersion: 1,
    productVersion: value.productVersion,
    operations: operations.map((operation, index) => {
      const canonicalTargetPath = canonicalTargets[index];
      if (canonicalTargetPath === undefined) invalid();
      return { ...operation, canonicalTargetPath };
    }),
  };
}
