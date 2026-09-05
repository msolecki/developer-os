import { constants, type BigIntStats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { BootstrapRetentionPostimageV1, CanonicalAbsolutePathV1, UInt64DecimalV1 } from "@developer-os/core";

import type { BootstrapExecutor } from "./executor.js";
import type {
  BootstrapEvidenceAdmissionV1,
  BootstrapEvidenceGuardedEntryV1,
  BootstrapEvidenceGuardedReaderV1,
  BootstrapEvidenceInspectionRequestV1,
} from "./report.js";
import {
  admitBootstrapEvidencePlan,
  selectBootstrapEvidenceJournal,
} from "./report.js";
import { projectBootstrapRetentionPostimage } from "./retention.js";
import type { PackagedReleaseSourceV1 } from "../update/packaged-release.js";

const INITIAL_NAMESPACE = /^(?:fresh-v2-init\.fi_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:plan|journal\.[01])\.json|\.fresh-v2-init\.fi_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\..+|\.developer-os-retained\.(?:fi|mm)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[0-9]{10}\.tombstone|\.lifecycle-bootstrap\.lock)$/u;
const FRESH_STAGING_ID = /^fi_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function currentUid(): bigint {
  const value = process.getuid?.();
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("bootstrap evidence reader cannot establish the current uid");
  }
  return BigInt(value);
}

function mode(stats: BigIntStats): number {
  return Number(stats.mode & 0o777n);
}

function sameIdentity(left: Pick<BigIntStats, "dev" | "ino">, right: Pick<BigIntStats, "dev" | "ino">): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    ((error as { readonly code?: unknown }).code === "ENOENT" ||
      (error as { readonly code?: unknown }).code === "ENOTDIR");
}

function entry(path: string, stats: BigIntStats): BootstrapEvidenceGuardedEntryV1 {
  const kind = stats.isFile() && !stats.isSymbolicLink()
    ? "regular_file"
    : stats.isDirectory() && !stats.isSymbolicLink()
      ? "directory"
      : null;
  if (kind === null || stats.uid !== currentUid()) {
    throw new Error("bootstrap evidence namespace changed shape");
  }
  return {
    path: path as CanonicalAbsolutePathV1,
    kind,
    ownerUid: Number(stats.uid),
    mode: mode(stats),
    nlink: Number(stats.nlink),
    bytes: stats.size.toString() as UInt64DecimalV1,
    dev: stats.dev.toString() as UInt64DecimalV1,
    ino: stats.ino.toString() as UInt64DecimalV1,
  };
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

/** Descriptor- and identity-bound reader used only by the evidence inspector. */
export class NodeBootstrapEvidenceGuardedReader implements BootstrapEvidenceGuardedReaderV1 {
  async inventoryExactNamespaces(
    roots: readonly CanonicalAbsolutePathV1[],
  ): Promise<readonly BootstrapEvidenceGuardedEntryV1[]> {
    const found = new Map<string, BootstrapEvidenceGuardedEntryV1>();
    for (const root of [...new Set(roots)].sort(compareUtf8)) {
      let stats: BigIntStats;
      try {
        stats = await nodeFs.lstat(root, { bigint: true });
      } catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }
      if (stats.isFile() && !stats.isSymbolicLink()) {
        found.set(root, entry(root, stats));
        continue;
      }
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error("bootstrap evidence root changed shape");
      }
      if (INITIAL_NAMESPACE.test(basename(root))) {
        await this.inventoryTree(root, stats, found);
      } else {
        await this.inventoryDirectNamespaces(root, stats, found);
      }
    }
    return [...found.values()].sort((left, right) => compareUtf8(left.path, right.path));
  }

  async readRegularFile(
    expected: BootstrapEvidenceGuardedEntryV1,
    maximumBytes: number,
  ): Promise<Uint8Array> {
    if (
      expected.kind !== "regular_file" ||
      !Number.isSafeInteger(maximumBytes) || maximumBytes < 0 ||
      BigInt(expected.bytes) > BigInt(maximumBytes)
    ) {
      throw new Error("bootstrap evidence read exceeds its admitted bound");
    }
    const before = await nodeFs.lstat(expected.path, { bigint: true });
    const handle = await nodeFs.open(
      expected.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const opened = await handle.stat({ bigint: true });
      if (!this.matches(expected, before) || !this.matches(expected, opened)) {
        throw new Error("bootstrap evidence file changed identity before read");
      }
      const bytes = await handle.readFile();
      const descriptorAfter = await handle.stat({ bigint: true });
      const linkedAfter = await nodeFs.lstat(expected.path, { bigint: true });
      if (
        bytes.byteLength !== Number(opened.size) ||
        !this.matches(expected, descriptorAfter) ||
        !this.matches(expected, linkedAfter)
      ) {
        throw new Error("bootstrap evidence file changed during read");
      }
      return bytes;
    } finally {
      await handle.close();
    }
  }

  private matches(expected: BootstrapEvidenceGuardedEntryV1, stats: BigIntStats): boolean {
    return stats.isFile() && !stats.isSymbolicLink() &&
      stats.uid === BigInt(expected.ownerUid) && mode(stats) === expected.mode &&
      stats.nlink === BigInt(expected.nlink) && stats.size.toString() === expected.bytes &&
      stats.dev.toString() === expected.dev && stats.ino.toString() === expected.ino;
  }

  private async inventoryDirectNamespaces(
    root: string,
    expected: BigIntStats,
    found: Map<string, BootstrapEvidenceGuardedEntryV1>,
  ): Promise<void> {
    const handle = await nodeFs.open(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const opened = await handle.stat({ bigint: true });
      const isFreshStagingRoot = basename(root) === "fresh-v2-init" && basename(dirname(root)) === "staging";
      const names = (await nodeFs.readdir(root)).filter((name) =>
        isFreshStagingRoot ? FRESH_STAGING_ID.test(name) : INITIAL_NAMESPACE.test(name)
      ).sort(compareUtf8);
      if (!sameIdentity(opened, expected)) throw new Error("bootstrap evidence root changed identity");
      for (const name of names) {
        const path = join(root, name);
        const stats = await nodeFs.lstat(path, { bigint: true });
        if (stats.isDirectory() && !stats.isSymbolicLink()) {
          await this.inventoryTree(path, stats, found);
        } else {
          found.set(path, entry(path, stats));
        }
      }
      const linkedAfter = await nodeFs.lstat(root, { bigint: true });
      const descriptorAfter = await handle.stat({ bigint: true });
      const namesAfter = (await nodeFs.readdir(root)).filter((name) =>
        isFreshStagingRoot ? FRESH_STAGING_ID.test(name) : INITIAL_NAMESPACE.test(name)
      ).sort(compareUtf8);
      if (
        !sameIdentity(linkedAfter, expected) || !sameIdentity(descriptorAfter, expected) ||
        names.length !== namesAfter.length || names.some((name, index) => name !== namesAfter[index])
      ) throw new Error("bootstrap evidence root changed during inventory");
    } finally {
      await handle.close();
    }
  }

  private async inventoryTree(
    root: string,
    expected: BigIntStats,
    found: Map<string, BootstrapEvidenceGuardedEntryV1>,
  ): Promise<void> {
    found.set(root, entry(root, expected));
    const handle = await nodeFs.open(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const opened = await handle.stat({ bigint: true });
      const names = (await nodeFs.readdir(root)).sort(compareUtf8);
      if (!sameIdentity(opened, expected)) throw new Error("bootstrap evidence tree changed identity");
      for (const name of names) {
        const path = join(root, name);
        const stats = await nodeFs.lstat(path, { bigint: true });
        if (stats.isDirectory() && !stats.isSymbolicLink()) {
          await this.inventoryTree(path, stats, found);
        } else {
          found.set(path, entry(path, stats));
        }
      }
      const linkedAfter = await nodeFs.lstat(root, { bigint: true });
      const descriptorAfter = await handle.stat({ bigint: true });
      const namesAfter = (await nodeFs.readdir(root)).sort(compareUtf8);
      if (
        !sameIdentity(linkedAfter, expected) || !sameIdentity(descriptorAfter, expected) ||
        names.length !== namesAfter.length || names.some((name, index) => name !== namesAfter[index])
      ) throw new Error("bootstrap evidence tree changed during inventory");
    } finally {
      await handle.close();
    }
  }
}

export function createBootstrapEvidenceInspectionRequest(input: {
  readonly productHome: string;
  readonly stateDirectory: string;
  readonly initialRoots: readonly string[];
  readonly reader?: BootstrapEvidenceGuardedReaderV1;
  readonly projectPostimage?: (
    path: CanonicalAbsolutePathV1,
  ) => Promise<BootstrapRetentionPostimageV1 | null>;
}): BootstrapEvidenceInspectionRequestV1 {
  return {
    productHome: input.productHome as CanonicalAbsolutePathV1,
    stateDirectory: input.stateDirectory as CanonicalAbsolutePathV1,
    initialRoots: [...new Set([
      ...input.initialRoots,
      join(input.productHome, "staging", "fresh-v2-init"),
    ])].map((root) => root as CanonicalAbsolutePathV1),
    reader: input.reader ?? new NodeBootstrapEvidenceGuardedReader(),
    projectPostimage: input.projectPostimage ?? projectBootstrapRetentionPostimage,
    validatePlan: (value) => {
      const candidate = typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as { readonly id?: unknown }
        : null;
      if (typeof candidate?.id !== "string") throw new Error("bootstrap plan identity is absent");
      return admitBootstrapEvidencePlan(value, {
        productHome: input.productHome as CanonicalAbsolutePathV1,
        stateDirectory: input.stateDirectory as CanonicalAbsolutePathV1,
        expectedId: candidate.id as Parameters<typeof admitBootstrapEvidencePlan>[1]["expectedId"],
      });
    },
    validateSlots: (plan, slots) => {
      const selected = selectBootstrapEvidenceJournal(
        plan as Parameters<typeof selectBootstrapEvidenceJournal>[0],
        slots,
      );
      if (selected === null) throw new Error("bootstrap journal slots are unbound");
      return selected;
    },
  };
}

/** The only bootstrap authority projected onto the command-wide context. */
export type CliBootstrapContext =
  | {
      readonly state: "available";
      readonly executor: BootstrapExecutor;
      readonly packagedRelease: PackagedReleaseSourceV1;
      readonly inspectEvidence: () => Promise<BootstrapEvidenceAdmissionV1>;
    }
  | {
      readonly state: "unavailable_until_packaged_handoff";
    };
