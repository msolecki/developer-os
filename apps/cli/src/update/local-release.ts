import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import { encodeCanonicalJson, EXIT_CODES } from "@developer-os/core";
import type { CanonicalJsonValue } from "@developer-os/core";

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
 * The installed bundle is not launchable in local mode (D47 Q1): the launcher refuses an
 * unsigned-local trust state, so the stub says where the runnable CLI is instead.
 */
export const LOCAL_BUNDLE_BIN: ReleaseFileV1 = Object.freeze({
  relativePath: "bin/developer-os",
  bytes: encoder.encode(
    "#!/bin/sh\n" +
      "echo 'developer-os: this bundle was installed from an unsigned local build and cannot be launched; run node apps/cli/dist/bin.js from the checkout instead' >&2\n" +
      "exit 4\n",
  ),
  mode: 0o700,
});

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

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
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
  const bundleFiles = [...input.bundleFiles].sort((left, right) =>
    compareUtf8(left.relativePath, right.relativePath),
  );
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
