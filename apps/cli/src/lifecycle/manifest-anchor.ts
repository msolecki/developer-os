/**
 * D54: the durable manifest anchor. After every committed gated transaction that writes the
 * installation manifest, the mutation gate records the resulting manifest hash here, so the
 * bootstrap evidence classifier can tell a manifest the product moved from a hand edit after
 * recovery has compacted the journals that could otherwise prove the chain.
 *
 * The anchor also carries `bootstrapManifestHash`: the manifest hash the unbroken chain of
 * gated writes started from, which is the finalized bootstrap plan's `manifest.after.hash`
 * when nothing else touched the manifest in between. `init` settles a superseded plan only
 * when that value is the plan's own, so an anchor left behind by an earlier installation can
 * never settle a later one (D54 review, finding 1).
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

export interface ManifestAnchorV1 {
  readonly manifestHash: string;
  readonly bootstrapManifestHash: string;
}

export function manifestAnchorPath(productHome: string): string {
  return join(productHome, MANIFEST_ANCHOR_RELATIVE_PATH);
}

export function encodeManifestAnchor(anchor: ManifestAnchorV1): Uint8Array {
  return encoder.encode(encodeCanonicalJson({
    schemaVersion: 1,
    manifestHash: anchor.manifestHash,
    bootstrapManifestHash: anchor.bootstrapManifestHash,
  }));
}

/** The anchor, or `null` for anything but the exact canonical encoding. */
export function decodeManifestAnchor(bytes: Uint8Array): ManifestAnchorV1 | null {
  if (bytes.byteLength !== MANIFEST_ANCHOR_BYTES) return null;
  try {
    const value = decodeCanonicalJson(bytes, MANIFEST_ANCHOR_BYTES) as Record<string, unknown> | null;
    const manifestHash = value?.manifestHash;
    const bootstrapManifestHash = value?.bootstrapManifestHash;
    if (typeof manifestHash !== "string" || !LOWER_HEX_SHA256.test(manifestHash)) return null;
    if (typeof bootstrapManifestHash !== "string" || !LOWER_HEX_SHA256.test(bootstrapManifestHash)) return null;
    const anchor = { manifestHash, bootstrapManifestHash };
    const expected = encodeManifestAnchor(anchor);
    return expected.every((byte, index) => bytes[index] === byte) ? anchor : null;
  } catch {
    return null;
  }
}

/**
 * The one shape rule for the anchor and its temp: a single-link `0600` regular file owned by
 * the effective user and no longer than the exact encoding. The gate and `init` both use it.
 */
export function isOwnedManifestAnchorShape(
  entry: { readonly ownerUid: number; readonly mode: number; readonly nlink: number },
  size: bigint,
  effectiveUid: number,
): boolean {
  return entry.ownerUid === effectiveUid && entry.mode === 0o600 && entry.nlink === 1 &&
    size <= BigInt(MANIFEST_ANCHOR_BYTES);
}

function ownedControlFile(entry: LifecycleGuardedEntryV1 | null, effectiveUid: number): boolean {
  return entry !== null && entry.kind === "regular_file" &&
    isOwnedManifestAnchorShape(entry, BigInt(entry.size), effectiveUid);
}

/**
 * `absent`, the exact anchor, or `malformed` for a file of admitted shape whose bytes are not
 * the exact encoding (an interrupted first write, or an edit). A file of any other shape
 * refuses `manifest_anchor_shape`.
 */
export type ManifestAnchorReadV1 =
  | { readonly kind: "absent" }
  | ({ readonly kind: "anchored" } & ManifestAnchorV1)
  | { readonly kind: "malformed" };

export async function readManifestAnchor(
  fs: LifecycleGuardedFileSystemV1,
  productHome: string,
  effectiveUid: number,
): Promise<ManifestAnchorReadV1> {
  const entry = await fs.lstat(parseCanonicalAbsolutePathText(manifestAnchorPath(productHome)));
  if (entry === null) return { kind: "absent" };
  if (!ownedControlFile(entry, effectiveUid)) refuse("manifest_anchor_shape", entry.path);
  const anchor = decodeManifestAnchor(await fs.readRegular(entry, MANIFEST_ANCHOR_BYTES));
  return anchor === null ? { kind: "malformed" } : { kind: "anchored", ...anchor };
}

/**
 * Removes the anchor, when the installation it describes is gone (its manifest was removed)
 * or a fresh bootstrap starts a new one. A file of any shape but the owned control file
 * refuses rather than being removed.
 */
export async function removeManifestAnchor(
  fs: LifecycleGuardedFileSystemV1,
  productHome: string,
  effectiveUid: number,
): Promise<void> {
  const entry = await fs.lstat(parseCanonicalAbsolutePathText(manifestAnchorPath(productHome)));
  if (entry === null) return;
  if (!ownedControlFile(entry, effectiveUid)) refuse("manifest_anchor_shape", entry.path);
  await fs.unlinkExact(entry);
}

/**
 * D54 review, finding 1: once uninstall leaves no manifest the anchor describes no installation.
 * The caller holds the global lock; a failure is reported (finding 3), never a failed uninstall.
 */
export async function removeManifestAnchorOrWarn(
  fs: LifecycleGuardedFileSystemV1,
  productHome: string,
  effectiveUid: number,
  stderr: (text: string) => void,
): Promise<void> {
  try {
    await removeManifestAnchor(fs, productHome, effectiveUid);
  } catch (error) {
    if (isCodeDefect(error)) throw error;
    stderr(MANIFEST_ANCHOR_WARNING);
  }
}

/**
 * D54 review, finding 3: the anchor is evidence for a later `init`, never part of a committed
 * transaction, so a failure to record, derive or remove it is reported on `stderr` and the
 * command's result stands. The anchor is then absent or stale, which `init` reads as "not
 * proven" (exit 6) until a later committed manifest write refreshes it.
 */
export const MANIFEST_ANCHOR_WARNING =
  "warning: the manifest anchor could not be updated; a re-run init may refuse until the next committed manifest write (see developer-os doctor)";

/** NEW-82: a defect in this code is not a fact about the anchor, so it is never downgraded. */
export function isCodeDefect(error: unknown): boolean {
  return error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError;
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
 * shape rule admits and the decoder rejects, which the next write replaces. A malformed file of
 * the owned shape is replaced the same way; any other shape refuses and is left for `doctor`.
 */
export async function writeManifestAnchor(
  fs: LifecycleGuardedFileSystemV1,
  productHome: string,
  stateDirectory: string,
  effectiveUid: number,
  anchor: ManifestAnchorV1,
): Promise<void> {
  if (!LOWER_HEX_SHA256.test(anchor.manifestHash) || !LOWER_HEX_SHA256.test(anchor.bootstrapManifestHash)) {
    throw new Error("the manifest anchor takes lowercase SHA-256 hashes");
  }
  const bytes = encodeManifestAnchor(anchor);
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
