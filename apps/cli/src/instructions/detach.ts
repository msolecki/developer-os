import type { BigIntStats } from "node:fs";
import { join, relative, sep } from "node:path";

import {
  buildConflictEvidence,
  containsPath,
  encodeCanonicalJson,
  EXIT_CODES,
  extractInstructionBlock,
  hashBytes,
  serializeConfig,
  stripInstructionBlock,
} from "@developer-os/core";
import type {
  CanonicalJsonValue,
  ConflictEvidence,
  DeveloperOsConfigV1,
  DriftFileSystem,
  ExitCode,
  InstallationManifestV2,
  LowerHexSha256,
  ManagedArtifactV2,
  ManifestGuards,
  PlannedFileMutation,
} from "@developer-os/core";

import { codexHomeRecordPath } from "./vendor-homes.js";
import type { VendorHomesV1 } from "./vendor-homes.js";

type Vendor = "claude" | "codex";
type BlockRow = Extract<ManagedArtifactV2, { readonly kind: "instruction"; readonly verification: { readonly mode: "block" } }>;

/**
 * No-follow reads, injected. `readdir` is what the detach adds to the attach planner's
 * `{ lstat, readFile }`: a product-created directory is removed only when the plan empties it.
 */
export interface InstructionFileSystemV1 {
  lstat(path: string): Promise<BigIntStats | null>;
  readFile(path: string): Promise<Uint8Array | null>;
  readdir(path: string): Promise<readonly string[] | null>;
}

export interface InstructionDetachInputV1 {
  /** Vendors to detach. */
  readonly vendors: readonly Vendor[];
  readonly homes: VendorHomesV1;
  readonly manifest: InstallationManifestV2;
  readonly manifestHash: LowerHexSha256;
  /** `null` when there is no configuration to rewrite: `uninstall` over an absent or invalid `config.toml`. */
  readonly config: DeveloperOsConfigV1 | null;
  readonly configHash: LowerHexSha256;
  readonly fs: InstructionFileSystemV1;
}

export type InstructionDetachPlanV1 =
  | { readonly kind: "noop" }
  | {
    readonly kind: "transaction";
    readonly mutations: readonly PlannedFileMutation[];
    readonly manifest: InstallationManifestV2;
    readonly removed: readonly string[];
    /**
     * Emptied product-created directories, deepest first. The transaction executor writes
     * files only, so the caller removes these with an exact-empty `rmdir` after the commit.
     */
    readonly directories: readonly string[];
    /** Product-created directories holding entries this plan does not remove; kept and reported. */
    readonly preserved: readonly string[];
  };

export class InstructionRefusal extends Error {
  constructor(
    readonly reason: string,
    readonly code: ExitCode,
    readonly paths: readonly string[],
    readonly evidence: ConflictEvidence | null,
    readonly recovery: string,
  ) {
    super(`${reason}: ${paths.join(", ")}`);
    // failureFrom publishes kindOf(name), so this spelling is what yields the reason code.
    this.name = `${reason.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("")}Error`;
  }
}

const encoder = new TextEncoder();

function recoveryFor(homes: VendorHomesV1, vendor: Vendor, what: "block" | "file"): string {
  const target = what === "block" ? "delete the whole block (both markers included)" : "delete the file";
  return `move the edits into ${join(homes.productHome, "instructions", vendor)}/, ${target}, and re-run the command`;
}

function isBlockRow(artifact: ManagedArtifactV2): artifact is BlockRow {
  return artifact.kind === "instruction" && artifact.verification.mode === "block";
}

function within(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function vendorRoot(homes: VendorHomesV1, vendor: Vendor): string {
  return vendor === "claude" ? join(homes.userHome, ".claude") : homes.codexHome;
}

/** `foundation.md` §12.5: a symlink at any component from the vendor root down refuses, exit 5. */
async function refuseSymlinkedComponents(fs: InstructionFileSystemV1, root: string, path: string): Promise<void> {
  const components = !containsPath(root, path)
    ? [path]
    : relative(root, path).split(sep).filter((segment) => segment !== "").reduce((all, segment) => [...all, join(all.at(-1) ?? root, segment)], [root]);
  for (const component of components) {
    const stats = await fs.lstat(component);
    if (stats === null) return;
    if (stats.isSymbolicLink()) {
      throw new InstructionRefusal(
        "instruction_target_symlinked",
        EXIT_CODES.securityRefusal,
        [component],
        null,
        "replace the symlink with a regular file or directory holding the same content, and re-run the command",
      );
    }
  }
}

// The block arm of buildConflictEvidence reads nothing; these only satisfy its request type.
const unusedFs = {} as DriftFileSystem;
const unusedGuards: ManifestGuards = { assertReadable: () => Promise.reject(new Error("unused")) };

async function blockConflictEvidence(row: BlockRow, fileBytes: Uint8Array): Promise<ConflictEvidence> {
  return buildConflictEvidence({
    // Detach proposes no block, so the diff shows the user's edit against removal.
    block: { artifact: row, fileBytes, proposedBlock: new Uint8Array(0) },
    fs: unusedFs,
    guards: unusedGuards,
    // Identity here: failureFrom redacts `data`, where the caller publishes the evidence.
    redactDiagnostic: (text) => text,
  });
}

function depth(path: string): number {
  return path.split(sep).length;
}

export async function planInstructionDetach(input: InstructionDetachInputV1): Promise<InstructionDetachPlanV1> {
  const { homes, fs } = input;
  const vendors = new Set<string>(input.vendors);
  // The recorded Codex home leaves with the Codex rows, so a later attach may choose another.
  const record = vendors.has("codex") ? codexHomeRecordPath(homes.productHome) : null;
  const rows = input.manifest.artifacts.filter(
    (artifact) => vendors.has(artifact.owner) && (!within(homes.productHome, artifact.path) || artifact.path === record),
  );

  const mutations: PlannedFileMutation[] = [];
  const removed: string[] = [];
  const gone = new Set<string>();
  const drifted = (vendor: Vendor, path: string): InstructionRefusal =>
    new InstructionRefusal("managed_drift", EXIT_CODES.decisionRequired, [path], null, recoveryFor(homes, vendor, "file"));

  for (const row of rows) {
    if (row.kind === "directory") continue;
    const vendor = row.owner as Vendor;
    await refuseSymlinkedComponents(fs, vendorRoot(homes, vendor), row.path);
    const stats = await fs.lstat(row.path);
    if (stats !== null && !stats.isFile()) throw drifted(vendor, row.path);
    const bytes = stats === null ? null : await fs.readFile(row.path);

    if (isBlockRow(row)) {
      const current = bytes === null ? { kind: "absent" as const } : extractInstructionBlock(bytes);
      if (bytes === null || current.kind === "absent") {
        removed.push(row.path);
        continue;
      }
      if (current.kind === "malformed") {
        throw new InstructionRefusal("instruction_block_malformed", EXIT_CODES.decisionRequired, [row.path], null, recoveryFor(homes, vendor, "block"));
      }
      if (hashBytes(current.block) !== row.verification.blockHash) {
        throw new InstructionRefusal(
          "instruction_block_conflict",
          EXIT_CODES.decisionRequired,
          [row.path],
          await blockConflictEvidence(row, bytes),
          recoveryFor(homes, vendor, "block"),
        );
      }
      // Stripped, never restored: the whole-file backup stays in backups/ as evidence only.
      const remainder = stripInstructionBlock(bytes);
      const expectedBeforeHash = hashBytes(bytes);
      if (!row.existedBefore && remainder.byteLength === 0) {
        mutations.push({ targetPath: row.path, operation: "remove", content: null, expectedBeforeHash });
        gone.add(row.path);
      } else {
        mutations.push({ targetPath: row.path, operation: "replace", content: remainder, expectedBeforeHash });
      }
      removed.push(row.path);
      continue;
    }

    if (!("installedHash" in row.verification)) {
      throw new Error(`instruction detach cannot remove a ${row.kind} row verified by ${row.verification.mode}: ${row.path}`);
    }
    if (bytes === null) {
      // A remove of a vanished target fails at transaction plan time with no paths; drop the row.
      gone.add(row.path);
      removed.push(row.path);
      continue;
    }
    const actual = hashBytes(bytes);
    if (actual !== row.verification.installedHash) throw drifted(vendor, row.path);
    mutations.push({ targetPath: row.path, operation: "remove", content: null, expectedBeforeHash: actual });
    gone.add(row.path);
    removed.push(row.path);
  }

  const directories: string[] = [];
  const preserved: string[] = [];
  const directoryRows = rows
    .filter((row) => row.kind === "directory")
    .sort((left, right) => depth(right.path) - depth(left.path));
  for (const row of directoryRows) {
    const vendor = row.owner as Vendor;
    await refuseSymlinkedComponents(fs, vendorRoot(homes, vendor), row.path);
    const stats = await fs.lstat(row.path);
    if (stats === null) {
      gone.add(row.path);
      removed.push(row.path);
      continue;
    }
    if (!stats.isDirectory()) throw drifted(vendor, row.path);
    const names = (await fs.readdir(row.path)) ?? [];
    if (names.every((name) => gone.has(join(row.path, name)))) {
      directories.push(row.path);
      gone.add(row.path);
      removed.push(row.path);
    } else {
      preserved.push(row.path);
    }
  }

  const config = input.config;
  const adaptersChanged = config !== null && input.vendors.some((vendor) => config.adapters[vendor]);
  if (rows.length === 0 && !adaptersChanged) return { kind: "noop" };

  if (adaptersChanged) {
    const adapters = { ...config.adapters };
    for (const vendor of input.vendors) adapters[vendor] = false;
    mutations.push({
      targetPath: join(homes.productHome, "config.toml"),
      operation: "replace",
      content: encoder.encode(serializeConfig({ ...config, adapters })),
      expectedBeforeHash: input.configHash,
    });
  }

  const dropped = new Set(rows);
  const manifest: InstallationManifestV2 = {
    ...input.manifest,
    artifacts: input.manifest.artifacts.filter((artifact) => !dropped.has(artifact)),
  };
  if (rows.length > 0) {
    mutations.push({
      targetPath: join(homes.productHome, "installation-manifest.json"),
      operation: "replace",
      content: encoder.encode(encodeCanonicalJson(manifest as unknown as CanonicalJsonValue)),
      expectedBeforeHash: input.manifestHash,
    });
  }

  return { kind: "transaction", mutations, manifest, removed, directories, preserved };
}
