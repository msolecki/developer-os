import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

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
const MAX_BUNDLE_MANIFEST_BYTES = 4 * 1024 * 1024;


/**
 * NEW-163 B: one script for every release. At run time it follows `state/active-release.json` to the
 * retained bundle manifest and loads that manifest's `entrypoint` (D96 Q4: `LOCAL_BUNDLE_CLI_ENTRY`
 * when the manifest names none). Every read is no-follow, a regular file owned by the caller with no
 * group or other write, size-bounded, and the manifest must hash to the record. Nothing is resolved
 * through PATH. The bundle root must be exactly `releases/<version>/darwin-<process.arch>`, the launcher's
 * and the refresh's rule. A release that cannot load exits 2 for the three security guards: Node's own exit 1
 * is non-blocking to both vendors, so a missing bundle would silently allow every guarded call. The
 * import target is a file URL, so a `#`, `%` or space in the home cannot change what it names.
 */
export function renderEntrypoint(): Uint8Array {
  return new TextEncoder().encode(
    "// Developer OS entrypoint, written by `developer-os init`: it loads the active release.\n" +
      'import { createHash } from "node:crypto";\n' +
      'import { constants } from "node:fs";\n' +
      'import { open } from "node:fs/promises";\n' +
      'import { isAbsolute, join } from "node:path";\n' +
      'import { fileURLToPath, pathToFileURL } from "node:url";\n' +
      "async function read(path, limit) {\n" +
      "  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);\n" +
      "  try {\n" +
      "    const stat = await handle.stat();\n" +
      "    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0 || stat.size > limit) throw new Error(\"refused\");\n" +
      "    return await handle.readFile();\n" +
      "  } finally {\n" +
      "    await handle.close();\n" +
      "  }\n" +
      "}\n" +
      "try {\n" +
      '  const home = fileURLToPath(new URL("../", import.meta.url));\n' +
      '  const state = join(home, "state");\n' +
      `  const active = JSON.parse(await read(join(state, "active-release.json"), ${String(MAX_ACTIVE_RELEASE_BYTES)}));\n` +
      "  const hash = active.bundleManifestHash;\n" +
      '  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash) || typeof active.version !== "string" || !/^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)$/.test(active.version) || active.bundleRoot !== join(home, "releases", active.version, "darwin-" + process.arch)) throw new Error("refused");\n' +
      `  const bytes = await read(join(state, "release-metadata", "bundles", hash + ".json"), ${String(MAX_BUNDLE_MANIFEST_BYTES)});\n` +
      '  if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error("refused");\n' +
      `  const entry = JSON.parse(bytes).entrypoint ?? ${JSON.stringify(LOCAL_BUNDLE_CLI_ENTRY)};\n` +
      '  if (typeof entry !== "string" || entry === "" || isAbsolute(entry) || entry.split("/").some((part) => part === ".." || part === "." || part === "")) throw new Error("refused");\n' +
      "  await import(pathToFileURL(join(active.bundleRoot, entry)).href);\n" +
      "} catch {\n" +
      "  const [verb, kind] = process.argv.slice(2);\n" +
      '  process.stderr.write("developer-os: the active release could not be loaded\\n");\n' +
      '  process.exitCode = verb === "guard" && ["command", "path", "commit"].includes(kind) ? 2 : 1;\n' +
      "}\n",
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

/** The entrypoint bytes: the one release-independent script, or `null` when the home has no active release. */
async function desiredEntrypoint(context: CliContext): Promise<Uint8Array | null> {
  const activeBytes = await readNoFollow(join(context.paths.stateDir, "active-release.json"));
  if (activeBytes === null) return null;
  validateActiveReleaseRecord(decodeCanonicalJson(activeBytes, MAX_ACTIVE_RELEASE_BYTES), createCanonicalPathEvidence());
  return renderEntrypoint();
}

/**
 * Writes the entrypoint once the home has an active release. The bytes are the same for every release,
 * so a moved active release never rewrites it. `null`, writing nothing, when there is no active release.
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
  const expected = await desiredEntrypoint(context);
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
    const content = await desiredEntrypoint(context);
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
