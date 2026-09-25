import * as nodeFs from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { decodeCanonicalJson, EXIT_CODES, hashBytes, validateActiveReleaseRecord } from "@developer-os/core";
import type {
  InstallationManifestV2,
  LowerHexSha256,
  ManagedArtifactV2,
  PlannedFileMutation,
  UtcTimestampV1,
  VaultFreeRelativePathV1,
} from "@developer-os/core";

import { createCanonicalPathEvidence } from "../bootstrap/admission.js";
import type { CliContext } from "../context.js";
import { compareManifestRows, InstructionRefusal } from "../instructions/attach.js";
import { gatedState, manifestMutation, readNoFollow } from "../instructions/apply.js";
import { withLifecycleMutation } from "../lifecycle/mutation-gate.js";
import { ENTRYPOINT_DIRECTORY, entrypointPath, LOCAL_BUNDLE_CLI_ENTRY } from "./local-release.js";

const MAX_ACTIVE_RELEASE_BYTES = 16 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;

/** A file URL, so a `#`, `%` or space in the home cannot change what the specifier names. */
export function renderEntrypoint(bundleRoot: string): Uint8Array {
  const target = pathToFileURL(join(bundleRoot, LOCAL_BUNDLE_CLI_ENTRY)).href;
  return new TextEncoder().encode(
    "// Developer OS entrypoint, written by `developer-os init`: it loads the active release.\n" +
      `import ${JSON.stringify(target)};\n`,
  );
}

function occupied(path: string): InstructionRefusal {
  return new InstructionRefusal({
    reason: "entrypoint_target_occupied",
    code: EXIT_CODES.decisionRequired,
    paths: [path],
    recovery: `move ${path} aside (an unmanaged entry is never adopted), then re-run init`,
  });
}

/** The entrypoint bytes the active release calls for; `null` when there is none or it carries no CLI. */
async function desiredEntrypoint(
  context: CliContext,
  artifacts: readonly ManagedArtifactV2[],
): Promise<Uint8Array | null> {
  const activeBytes = await readNoFollow(join(context.paths.stateDir, "active-release.json"));
  if (activeBytes === null) return null;
  const active = validateActiveReleaseRecord(
    decodeCanonicalJson(activeBytes, MAX_ACTIVE_RELEASE_BYTES),
    createCanonicalPathEvidence(),
  );
  // The installed bundle's files are manifest rows, so the CLI's presence is read from the inventory.
  const cli = join(active.bundleRoot, LOCAL_BUNDLE_CLI_ENTRY);
  return artifacts.some((artifact) => artifact.path === cli && artifact.kind === "file")
    ? renderEntrypoint(active.bundleRoot)
    : null;
}

/**
 * Writes the entrypoint for the active release (`state/active-release.json`), or rewrites it when
 * the active release moved. `null`, writing nothing, when the home has no active release or the
 * installed bundle carries no CLI (one packed before D53); `doctor` then says none is installed.
 * An entrypoint already current takes no gate entry, which would itself write bookkeeping.
 */
export async function installEntrypoint(context: CliContext): Promise<string | null> {
  const lifecycle = context.lifecycle;
  if (lifecycle === undefined) return null;
  const home = context.paths.home;
  const directory = join(home, ENTRYPOINT_DIRECTORY);
  const path = entrypointPath(home);

  const manifestBytes = await readNoFollow(context.paths.manifestFile);
  if (manifestBytes === null) return null;
  const recordedManifest = decodeCanonicalJson(manifestBytes, MAX_MANIFEST_BYTES) as unknown as InstallationManifestV2;
  const expected = await desiredEntrypoint(context, recordedManifest.artifacts);
  if (expected === null) return null;
  const onDisk = await readNoFollow(path).catch(() => null);
  if (
    onDisk !== null &&
    hashBytes(onDisk) === hashBytes(expected) &&
    recordedManifest.artifacts.some((artifact) => artifact.path === path)
  ) {
    return path;
  }

  return withLifecycleMutation(context, lifecycle, async (authority) => {
    const state = await gatedState(context, authority);
    const content = await desiredEntrypoint(context, state.manifest.artifacts);
    if (content === null) return null;
    const installedHash = hashBytes(content) as LowerHexSha256;
    const previous = state.manifest.artifacts.find((artifact) => artifact.path === path);
    const recorded = previous !== undefined && "installedHash" in previous.verification
      ? previous.verification.installedHash
      : null;
    if (previous !== undefined && (previous.owner !== "core" || previous.kind !== "file" || recorded === null)) {
      throw occupied(path);
    }

    const parent = await nodeFs.lstat(directory).catch((error: unknown) => {
      if ((error as { readonly code?: unknown }).code === "ENOENT") return null;
      throw error;
    });
    if (parent !== null && (!parent.isDirectory() || parent.isSymbolicLink())) throw occupied(directory);
    // A directory this code creates is always recorded, so one without its row is unmanaged.
    if (parent !== null && !state.manifest.artifacts.some((artifact) => artifact.path === directory && artifact.kind === "directory")) {
      throw occupied(directory);
    }
    const current = parent === null ? null : await readNoFollow(path);
    if (current === null && parent !== null) {
      const leaf = await nodeFs.lstat(path).catch(() => null);
      if (leaf !== null) throw occupied(path);
    }
    if (current !== null && recorded === null) throw occupied(path);
    if (current !== null && hashBytes(current) === installedHash) return path;
    // `init` refuses a drifted row before it gets here; this guards the file between the two reads.
    if (current !== null && hashBytes(current) !== recorded) throw occupied(path);

    const now = context.now().toISOString() as UtcTimestampV1;
    const common = {
      owner: "core" as const,
      productVersion: state.manifest.productVersion,
      existedBefore: false,
      beforeHash: null,
      backupRelativePath: null,
      mergeStrategy: "dedicated" as const,
      verifiedAt: now,
    };
    const rows: ManagedArtifactV2[] = state.manifest.artifacts.filter((artifact) => artifact !== previous);
    if (parent === null) {
      rows.push({
        ...common,
        path: directory as ManagedArtifactV2["path"],
        source: "generated/directory" as VaultFreeRelativePathV1,
        kind: "directory",
        verification: { mode: "content" },
      });
    }
    rows.push({
      ...common,
      path: path as ManagedArtifactV2["path"],
      source: "generated/entrypoint" as VaultFreeRelativePathV1,
      kind: "file",
      verification: { mode: "content", installedHash },
    });
    const manifest: InstallationManifestV2 = { ...state.manifest, artifacts: rows.sort(compareManifestRows) };
    const write: PlannedFileMutation = current === null
      ? { targetPath: path, operation: "create", content }
      : { targetPath: path, operation: "replace", content, expectedBeforeHash: hashBytes(current) };

    // The Foundation executor creates no directory; product-created ones are exactly 0700.
    if (parent === null) await nodeFs.mkdir(directory, { mode: 0o700 });
    try {
      await context.executor.execute({
        kind: "entrypoint",
        mutations: [write, manifestMutation(context, manifest, state.manifestHash)],
      });
    } catch (error) {
      // Only the directory this call created and the failed transaction left empty; a rerun refuses anything else.
      if (parent === null) await nodeFs.rmdir(directory).catch(() => undefined);
      throw error;
    }
    return path;
  });
}
