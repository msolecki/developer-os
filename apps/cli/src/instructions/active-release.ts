import { join } from "node:path";

import {
  decodeCanonicalJson,
  EXIT_CODES,
  hashBytes,
  isPackageChannelTrust,
  PACKAGE_CHANNEL_LAYOUT,
  PACKAGE_CHANNEL_SOURCE_TABLE,
  validateActiveReleaseRecord,
  validateBundleManifest,
  validateReleaseTrustState,
} from "@developer-os/core";

import { createCanonicalPathEvidence } from "../bootstrap/admission.js";
import type { CliContext } from "../context.js";
import { readNoFollow, stableNodePath } from "./apply.js";
import { InstructionRefusal } from "./attach.js";
import type { ReleaseTreeV1 } from "./sources.js";

const MAX_RECORD_BYTES = 16 * 1024;
const MAX_BUNDLE_MANIFEST_BYTES = 16 * 1024 * 1024;
const RENDERED = /^(?:instructions|workflows)\//u;

export interface ActiveReleaseTreeV1 extends ReleaseTreeV1 {
  readonly version: string;
  readonly architecture: "arm64" | "x64";
  readonly runtimeEntrypoint: string;
}

function invalid(path: string, cause?: unknown): never {
  if (cause instanceof InstructionRefusal && cause.reason === "active_release_tree_invalid") throw cause;
  throw new InstructionRefusal({ reason: "active_release_tree_invalid", code: EXIT_CODES.recoveryRequired, paths: [path], recovery: "developer-os doctor", ...(cause === undefined ? {} : { cause }) });
}

/** Every failure under `path` (a validator's, an `ELOOP` from a symlink) refuses exit 6, the original kept as `cause`. */
async function guarded<T>(path: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    return invalid(path, error);
  }
}

/**
 * K8/C2: the render source of an installed `package-channel` home is its active bundle under
 * `releases/<version>/<platform>-<architecture>`, never the keg, bound to the active record through
 * the retained bundle manifest's hash. `null`, the caller's old path, for a home with no active
 * record or another trust (an `unsigned-local` home's retained manifest is not a bundle manifest).
 */
export async function readActiveReleaseTree(context: CliContext): Promise<ActiveReleaseTreeV1 | null> {
  const activePath = join(context.paths.stateDir, "active-release.json");
  return guarded(activePath, () => readTree(context, activePath));
}

async function readTree(context: CliContext, activePath: string): Promise<ActiveReleaseTreeV1 | null> {
  const trustBytes = await readNoFollow(join(context.paths.stateDir, "release-trust.json"));
  const activeBytes = await readNoFollow(activePath);
  if (trustBytes === null || activeBytes === null) return null;
  if (!isPackageChannelTrust(validateReleaseTrustState(decodeCanonicalJson(trustBytes, MAX_RECORD_BYTES)))) return null;
  const active = validateActiveReleaseRecord(decodeCanonicalJson(activeBytes, MAX_RECORD_BYTES), createCanonicalPathEvidence());
  const manifestPath = join(context.paths.stateDir, "release-metadata", "bundles", `${active.bundleManifestHash}.json`);
  const manifestBytes = await readNoFollow(manifestPath);
  if (manifestBytes === null || hashBytes(manifestBytes) !== active.bundleManifestHash) invalid(manifestPath);
  const manifest = validateBundleManifest(decodeCanonicalJson(manifestBytes, MAX_BUNDLE_MANIFEST_BYTES));
  if (manifest.version !== active.version || manifest.architecture !== active.architecture) invalid(manifestPath);
  const entries = new Map<string, { readonly bytes: string; readonly sha256: string }>(
    manifest.entries.flatMap((entry) => (entry.kind === "file" ? [[`${active.bundleRoot}/${entry.path}`, entry] as const] : [])),
  );
  return {
    version: active.version,
    architecture: active.architecture,
    runtimeEntrypoint: manifest.runtimeEntrypoint,
    bundleRoot: active.bundleRoot,
    files: [...entries.keys()].filter((path) => RENDERED.test(path.slice(active.bundleRoot.length + 1))).map((relativePath) => ({ relativePath })),
    readFile: (path) => guarded(path, async () => {
      const entry = entries.get(path);
      const bytes = entry === undefined ? null : await readNoFollow(path);
      if (entry === undefined || bytes === null || String(bytes.byteLength) !== entry.bytes || hashBytes(bytes) !== entry.sha256) invalid(path);
      return bytes;
    }),
  };
}

/** C3: a dead Node under the keg's `opt` link is restored by the package, which `init` cannot do. */
export const HOOK_OPT_NODE_RECOVERY = "brew install developer-os";

/**
 * C3 (2026-10-08): a `package-channel` home's hooks name Node through the K2 table's fixed `opt`
 * link, so no release swap or retirement changes or breaks a hook; never `PATH`, never `realpath`.
 * An `unsigned-local` home has no keg and never updates: it keeps the Node that ran `init`.
 */
export async function hookNodePath(context: CliContext, tree: ActiveReleaseTreeV1 | null): Promise<string> {
  if (tree === null) return stableNodePath(process.execPath);
  const entry = (context.packageChannelTable ?? PACKAGE_CHANNEL_SOURCE_TABLE)[tree.architecture];
  return `${entry.opt}/${entry.fallback}/${PACKAGE_CHANNEL_LAYOUT.bundleRoot}/${tree.runtimeEntrypoint}`;
}
