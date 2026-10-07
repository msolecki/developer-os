import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  encodeCanonicalJson,
  EXIT_CODES,
  PACKAGE_CHANNEL_DELEGATION_BYTES,
  PACKAGE_CHANNEL_LAYOUT,
  sortUtf8,
  validateBundleManifest,
  validateReleaseIndex,
} from "@developer-os/core";
import type { CanonicalJsonValue, ReleaseBundleManifestV1 } from "@developer-os/core";

import { BRAIN_TEMPLATE } from "../commands/brain-template.js";
import { OUTPUT_SCHEMAS, outputSchemaFileName } from "../commands/output-schemas.js";
import { UNSIGNED_LOCAL_LAYOUT } from "./packaged-release.js";

export interface ReleaseFileV1 {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
  readonly mode: 0o600 | 0o700;
}

export class LocalReleaseError extends Error {
  constructor(readonly code: typeof EXIT_CODES.invalidInput, message: string) {
    super(message);
    this.name = "LocalReleaseError";
  }
}

const encoder = new TextEncoder();

/** templates/schemas/* and templates/brain/** — the files bootstrap requires, shared with the fixture. */
export function releaseTemplateFiles(): readonly ReleaseFileV1[] {
  return [
    ...OUTPUT_SCHEMAS.map((schema) => ({
      relativePath: `templates/schemas/${outputSchemaFileName(schema.verb)}`,
      bytes: encoder.encode(schema.content),
      mode: 0o600 as const,
    })),
    ...BRAIN_TEMPLATE.map((file) => ({
      relativePath: `templates/brain/${file.path}`,
      bytes: encoder.encode(file.content),
      mode: 0o600 as const,
    })),
  ];
}

/**
 * D53: the CLI's entry inside a launchable bundle, relative to the bundle root. The packer puts
 * it there and `init` points `<product-home>/bin/developer-os.mjs` at it.
 */
export const LOCAL_BUNDLE_CLI_ENTRY = "node_modules/@developer-os/cli/dist/bin.js";

/**
 * D53: the one version-free file the founder and every hook run, `node <product-home>/bin/developer-os.mjs`
 * (`update/entrypoint.ts` writes it). A product-owned manifest row like any other: written through
 * the Foundation transaction, so it is `0600`, the only mode that executor creates, and `node`
 * never needs the execute bit; drift-checked by `doctor`; removed by `uninstall`'s ordinary drain.
 * Its `bin/` parent is a `directory` row created `0700`, as the instruction planner creates its
 * parents. With no manifest, `bin/` is residue like every other manifest-owned path, so the
 * absent-manifest admission deliberately has no rule for it.
 */
export const ENTRYPOINT_DIRECTORY = "bin";

export function entrypointPath(productHome: string): string {
  return join(productHome, ENTRYPOINT_DIRECTORY, "developer-os.mjs");
}

function refuse(message: string): never {
  throw new LocalReleaseError(EXIT_CODES.invalidInput, message);
}

function assertRelative(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    refuse("local release file path is not a canonical relative path");
  }
}

function document(value: CanonicalJsonValue): Uint8Array {
  return encoder.encode(encodeCanonicalJson(value));
}

/**
 * Writes the unsigned-local package contract `admitUnsignedLocalPackagedRelease` admits.
 * The architecture is not recorded: admission derives it from `process.arch`.
 */
export async function writeUnsignedLocalRelease(input: {
  readonly outDir: string;
  readonly version: string;
  readonly bundleFiles: readonly ReleaseFileV1[];
}): Promise<string> {
  const bundleFiles = sortUtf8(input.bundleFiles, (file) => file.relativePath);
  for (const [position, file] of bundleFiles.entries()) {
    assertRelative(file.relativePath);
    if (bundleFiles[position - 1]?.relativePath === file.relativePath) {
      refuse("local release lists one bundle file twice");
    }
  }

  const manifest = document({
    files: bundleFiles.map((file) => ({
      bytes: file.bytes.byteLength,
      path: file.relativePath,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
    })),
    schemaVersion: 1,
    trust: "unsigned-local",
  });
  const files: readonly ReleaseFileV1[] = [
    { relativePath: UNSIGNED_LOCAL_LAYOUT.delegation, bytes: document({ schemaVersion: 1, trust: "unsigned-local" }), mode: 0o600 },
    {
      relativePath: UNSIGNED_LOCAL_LAYOUT.releaseIndex,
      bytes: document({ releaseSequence: "1", schemaVersion: 1, trust: "unsigned-local", version: input.version }),
      mode: 0o600,
    },
    { relativePath: UNSIGNED_LOCAL_LAYOUT.bundleManifest, bytes: manifest, mode: 0o600 },
    ...bundleFiles.map((file) => ({ ...file, relativePath: `${UNSIGNED_LOCAL_LAYOUT.bundleRoot}/${file.relativePath}` })),
    ...releaseTemplateFiles(),
  ];

  try {
    await nodeFs.mkdir(input.outDir, { mode: 0o700 });
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === "EEXIST") {
      refuse("the local release output directory already exists");
    }
    throw error;
  }
  const root = await nodeFs.realpath(input.outDir);
  // Admission requires exact modes, so none is left to the umask.
  await nodeFs.chmod(root, 0o700);
  const created = new Set<string>();
  for (const file of files) {
    const path = join(root, file.relativePath);
    const parents: string[] = [];
    for (let parent = dirname(path); parent !== root && !created.has(parent); parent = dirname(parent)) {
      parents.unshift(parent);
    }
    for (const parent of parents) {
      await nodeFs.mkdir(parent, { mode: 0o700 });
      await nodeFs.chmod(parent, 0o700);
      created.add(parent);
    }
    await nodeFs.writeFile(path, file.bytes, { mode: file.mode, flag: "wx" });
    await nodeFs.chmod(path, file.mode);
  }
  return root;
}

/**
 * D84 K2: writes the keg a Homebrew formula would install under `libexec/fallback`. Homebrew
 * modes: directories `0755`, a file `0755` when its manifest mode is `0700`, else `0644`.
 * The bundle files must equal the manifest's file entries exactly.
 */
export async function writePackageChannelRelease(input: {
  readonly outDir: string;
  readonly index: CanonicalJsonValue;
  readonly manifest: ReleaseBundleManifestV1;
  readonly bundleFiles: readonly ReleaseFileV1[];
}): Promise<string> {
  validateReleaseIndex(input.index);
  const manifest = validateBundleManifest(input.manifest);
  const bundleFiles = sortUtf8(input.bundleFiles, (file) => file.relativePath);
  const entries = manifest.entries.filter((entry) => entry.kind === "file");
  if (
    bundleFiles.length !== entries.length ||
    bundleFiles.some((file, position) => {
      const entry = entries[position];
      return (
        entry === undefined ||
        file.relativePath !== entry.path ||
        String(file.bytes.byteLength) !== entry.bytes ||
        createHash("sha256").update(file.bytes).digest("hex") !== entry.sha256 ||
        (file.mode === 0o700) !== (entry.mode === 448)
      );
    })
  ) {
    refuse("package-channel bundle files do not equal the bundle manifest entries");
  }
  const layout = PACKAGE_CHANNEL_LAYOUT;
  const files: readonly ReleaseFileV1[] = [
    { relativePath: layout.delegation, bytes: PACKAGE_CHANNEL_DELEGATION_BYTES, mode: 0o600 },
    { relativePath: layout.releaseIndex, bytes: document(input.index), mode: 0o600 },
    { relativePath: layout.bundleManifest, bytes: document(manifest as unknown as CanonicalJsonValue), mode: 0o600 },
    ...bundleFiles.map((file) => ({ ...file, relativePath: `${layout.bundleRoot}/${file.relativePath}` })),
    ...releaseTemplateFiles(),
  ];
  for (const file of files) assertRelative(file.relativePath);

  try {
    await nodeFs.mkdir(input.outDir, { mode: 0o755 });
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === "EEXIST") {
      refuse("the package-channel release output directory already exists");
    }
    throw error;
  }
  const root = await nodeFs.realpath(input.outDir);
  await nodeFs.chmod(root, 0o755);
  const created = new Set<string>();
  // The manifest lists directories too, including empty ones; parents sort before children.
  await nodeFs.mkdir(join(root, layout.bundleRoot), { mode: 0o755 });
  await nodeFs.chmod(join(root, layout.bundleRoot), 0o755);
  created.add(join(root, layout.bundleRoot));
  for (const entry of manifest.entries) {
    if (entry.kind !== "directory") continue;
    const path = join(root, layout.bundleRoot, entry.path);
    await nodeFs.mkdir(path, { mode: 0o755 });
    await nodeFs.chmod(path, 0o755);
    created.add(path);
  }
  for (const file of files) {
    const path = join(root, file.relativePath);
    const parents: string[] = [];
    for (let parent = dirname(path); parent !== root && !created.has(parent); parent = dirname(parent)) {
      parents.unshift(parent);
    }
    for (const parent of parents) {
      await nodeFs.mkdir(parent, { mode: 0o755 });
      await nodeFs.chmod(parent, 0o755);
      created.add(parent);
    }
    const mode = file.mode === 0o700 ? 0o755 : 0o644;
    await nodeFs.writeFile(path, file.bytes, { mode, flag: "wx" });
    await nodeFs.chmod(path, mode);
  }
  return root;
}
