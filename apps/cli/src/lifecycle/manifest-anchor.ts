/**
 * D54: the durable manifest anchor. After every committed gated transaction that writes the
 * installation manifest, the mutation gate records the resulting manifest hash here, so the
 * bootstrap evidence classifier can tell a manifest the product moved from a hand edit after
 * recovery has compacted the journals that could otherwise prove the chain.
 */
import { join } from "node:path";

import {
  MANIFEST_ANCHOR_BYTES,
  MANIFEST_ANCHOR_RELATIVE_PATH,
  decodeCanonicalJson,
  encodeCanonicalJson,
  parseCanonicalAbsolutePathText,
  LifecycleRecoveryRequiredError,
} from "@developer-os/core";
import type {
  LifecycleGuardedEntryV1,
  LifecycleGuardedFileSystemV1,
} from "@developer-os/core";

const encoder = new TextEncoder();
const LOWER_HEX_SHA256 = /^[0-9a-f]{64}$/u;
function refuse(reason: string, path: string): never {
  throw new LifecycleRecoveryRequiredError(reason, [path]);
}

const TEMP_LEAF = ".manifest-anchor.json.tmp";

export function manifestAnchorPath(productHome: string): string {
  return join(productHome, MANIFEST_ANCHOR_RELATIVE_PATH);
}

export function encodeManifestAnchor(manifestHash: string): Uint8Array {
  return encoder.encode(encodeCanonicalJson({ schemaVersion: 1, manifestHash }));
}

/** The anchored hash, or `null` for anything but the exact canonical encoding. */
export function decodeManifestAnchor(bytes: Uint8Array): string | null {
  if (bytes.byteLength !== MANIFEST_ANCHOR_BYTES) return null;
  try {
    const value = decodeCanonicalJson(bytes, MANIFEST_ANCHOR_BYTES) as Record<string, unknown> | null;
    const hash = value?.manifestHash;
    if (typeof hash !== "string" || !LOWER_HEX_SHA256.test(hash)) return null;
    const expected = encodeManifestAnchor(hash);
    return expected.every((byte, index) => bytes[index] === byte) ? hash : null;
  } catch {
    return null;
  }
}

function ownedControlFile(entry: LifecycleGuardedEntryV1 | null, effectiveUid: number): boolean {
  return entry !== null && entry.kind === "regular_file" && entry.ownerUid === effectiveUid &&
    entry.mode === 0o600 && entry.nlink === 1 && BigInt(entry.size) <= BigInt(MANIFEST_ANCHOR_BYTES);
}

/**
 * `absent`, the exact anchored hash, or `malformed` for a file of admitted shape whose bytes
 * are not the exact encoding (an interrupted first write, or an edit).
 */
export type ManifestAnchorReadV1 =
  | { readonly kind: "absent" }
  | { readonly kind: "anchored"; readonly manifestHash: string }
  | { readonly kind: "malformed" };

export async function readManifestAnchor(
  fs: LifecycleGuardedFileSystemV1,
  productHome: string,
  effectiveUid: number,
): Promise<ManifestAnchorReadV1> {
  const entry = await fs.lstat(parseCanonicalAbsolutePathText(manifestAnchorPath(productHome)));
  if (entry === null) return { kind: "absent" };
  if (!ownedControlFile(entry, effectiveUid)) refuse("manifest_anchor_shape", entry.path);
  const manifestHash = decodeManifestAnchor(await fs.readRegular(entry, MANIFEST_ANCHOR_BYTES));
  return manifestHash === null ? { kind: "malformed" } : { kind: "anchored", manifestHash };
}

/**
 * Removes a temp an interrupted write left behind. The caller holds the global lock, so no
 * other writer can own it.
 * ponytail: the temp is not in the bookkeeping set, so a crash between its create and rename
 * followed by an uninstall leaves residue the absent-manifest walk refuses; admit the temp by
 * shape there if that window ever matters.
 */
export async function cleanManifestAnchorTemp(
  fs: LifecycleGuardedFileSystemV1,
  stateDirectory: string,
  effectiveUid: number,
): Promise<void> {
  const temp = await fs.lstat(parseCanonicalAbsolutePathText(join(stateDirectory, TEMP_LEAF)));
  if (temp === null) return;
  if (!ownedControlFile(temp, effectiveUid)) refuse("manifest_anchor_temp_shape", temp.path);
  await fs.unlinkExact(temp);
}

/**
 * Atomic replace through a same-directory temp. The very first anchor has nothing to rename
 * over, so it is one `O_EXCL` create-write-fsync; an interruption there leaves a short file the
 * shape rule admits and the decoder rejects, which the next write replaces.
 */
export async function writeManifestAnchor(
  fs: LifecycleGuardedFileSystemV1,
  productHome: string,
  stateDirectory: string,
  effectiveUid: number,
  manifestHash: string,
): Promise<void> {
  if (!LOWER_HEX_SHA256.test(manifestHash)) throw new Error("the manifest anchor takes a lowercase SHA-256");
  const bytes = encodeManifestAnchor(manifestHash);
  const path = parseCanonicalAbsolutePathText(manifestAnchorPath(productHome));
  const state = await fs.lstat(parseCanonicalAbsolutePathText(stateDirectory));
  if (state === null) refuse("lifecycle_guarded_parent", stateDirectory);
  await cleanManifestAnchorTemp(fs, stateDirectory, effectiveUid);
  const existing = await fs.lstat(path);
  if (existing === null) {
    await fs.writeExclusive(path, bytes);
  } else {
    if (!ownedControlFile(existing, effectiveUid)) refuse("manifest_anchor_shape", path);
    const temp = await fs.writeExclusive(parseCanonicalAbsolutePathText(join(stateDirectory, TEMP_LEAF)), bytes);
    await fs.renameOver(temp, existing);
  }
  await fs.syncDirectory(state);
}
