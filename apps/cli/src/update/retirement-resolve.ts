import {
  encodeCanonicalJson,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonValue,
  type InstallationManifestV2,
  type LowerHexSha256,
  type ManagedArtifactV2,
  type RetirementInventoryRefV1,
  type RetirementLeafV1,
} from "@developer-os/core";

import { refuseBundle, sha256Hex } from "./bundle-source.js";
import type { UpdateRetirementParticipantDependenciesV1 } from "./retirement-participant.js";

const METADATA_STORES = ["bundles", "delegations", "indexes"] as const;
const encoder = new TextEncoder();

function contentHashOf(artifact: ManagedArtifactV2 | undefined): LowerHexSha256 | null {
  if (artifact?.kind !== "file") return null;
  const { verification } = artifact;
  return verification.mode === "content" ? verification.installedHash : null;
}

function childSegments(root: string, parent: string): readonly string[] | null {
  return root.startsWith(`${parent}/`) ? root.slice(parent.length + 1).split("/") : null;
}

/**
 * Binds the ref's root and inventory hash to the transitional manifest by kind: a bundle to its
 * retained signed bundle manifest, a payload to its `inventory.json` row, a metadata file to its
 * hash-derived path and content hash, and the record to its ephemeral reservation.
 */
function checkRef(productHome: CanonicalAbsolutePathV1, artifacts: ReadonlyMap<string, ManagedArtifactV2>, entry: RetirementInventoryRefV1): void {
  const { root, inventoryHash } = entry;
  const bound = artifacts.has(root) && ((): boolean => {
    switch (entry.kind) {
      case "bundle":
        return childSegments(root, `${productHome}/releases`)?.length === 2 && contentHashOf(artifacts.get(`${productHome}/state/release-metadata/bundles/${inventoryHash}.json`)) === inventoryHash;
      case "rollback_payload":
        return childSegments(root, `${productHome}/rollback`)?.length === 1 && contentHashOf(artifacts.get(`${root}/inventory.json`)) === inventoryHash;
      case "metadata":
        return METADATA_STORES.some((store) => root === `${productHome}/state/release-metadata/${store}/${inventoryHash}.json`) && contentHashOf(artifacts.get(root)) === inventoryHash;
      case "rollback_record": {
        const record = artifacts.get(root);
        return root === `${productHome}/state/update-rollback.json` && record?.kind === "file" && record.verification.mode === "ephemeral";
      }
    }
  })();
  if (!bound) refuseBundle("update_retirement_inventory", root);
}

function leafOf(artifact: ManagedArtifactV2, entry: RetirementInventoryRefV1): RetirementLeafV1 {
  if (artifact.kind === "directory") return { path: artifact.path, kind: "directory", bytes: null, sha256: null };
  if (entry.kind === "rollback_record" && artifact.path === entry.root) return { path: artifact.path, kind: "file", bytes: null, sha256: entry.inventoryHash };
  const hash = contentHashOf(artifact);
  if (hash === null) return refuseBundle("update_retirement_leaf", artifact.path);
  // ponytail: the manifest carries no size, so a file leaf is bounded by the 64-MiB document cap; bundle files above it refuse until the leaf carries its signed size.
  return { path: artifact.path, kind: "file", bytes: null, sha256: hash };
}

/** Separator below every path byte and terminator just above it: unsigned UTF-8 order per component, each directory after its children. */
function removalKey(path: string): Buffer {
  return Buffer.from(`${path.replaceAll("/", "\u0000")}\u0001`, "utf8");
}

/**
 * The production `resolve` port of `UpdateRetirementParticipant` for both retirement sets. Every
 * leaf is a row of the transitional manifest the plan is hash-bound to, which stays the authority
 * while retirement removes the files, so a resume at any `retirementNext` resolves the same list.
 */
export function retirementResolvePort(productHome: CanonicalAbsolutePathV1, manifest: InstallationManifestV2): UpdateRetirementParticipantDependenciesV1["resolve"] {
  const manifestHash = sha256Hex(encoder.encode(encodeCanonicalJson(manifest as unknown as CanonicalJsonValue)));
  const artifacts = new Map<string, ManagedArtifactV2>(manifest.artifacts.map((artifact) => [artifact.path, artifact]));
  const resolveLeaves: UpdateRetirementParticipantDependenciesV1["resolve"] = (entry, plan) => new Promise((resolve) => {
    if (plan.transitionalManifestHash !== manifestHash) refuseBundle("update_retirement_manifest", productHome);
    checkRef(productHome, artifacts, entry);
    const leaves = manifest.artifacts
      .filter((artifact) => artifact.path === entry.root || artifact.path.startsWith(`${entry.root}/`))
      .map((artifact) => ({ leaf: leafOf(artifact, entry), key: removalKey(artifact.path) }));
    resolve(leaves.sort((left, right) => Buffer.compare(left.key, right.key)).map(({ leaf }) => leaf));
  });
  return resolveLeaves;
}
