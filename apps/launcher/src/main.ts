#!/usr/bin/env node
/**
 * The stable launcher's composition root. It resolves platform identity and
 * the product home, admits a launcher candidate, and constructs the
 * shell-free process request `selection.ts` produces — then execs it.
 *
 * `ponytail:` the FD 3 offline-trust pipe and the bootstrap-closure reader
 * are not wired for real here. Task 11 owns the FD 3 handoff
 * (`readOfflineReleaseTrustFd`/`renderOfflineReleaseTrustPipe`) and modifies
 * this file to write it; a real bootstrap-closure reader is Task 9's
 * territory, reused rather than reimplemented once its read-only reader is
 * exposed to this package. Until then this always reports `handoff_complete`,
 * which is safe (it only ever *widens* which candidate can route to normal
 * active/fallback selection, never past `LauncherBundleAdmission`'s guarded
 * checks) but not yet the full §6 recovery routing.
 */
import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { createHash } from "node:crypto";
import { arch, platform as nodePlatform } from "node:os";
import { execFileSync } from "node:child_process";

import {
  admitLauncherPlatformIdentity,
  type LauncherGuardedReaderV1,
} from "@developer-os/platform-macos";
import { resolveRuntimePaths } from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  LifecycleGuardedEntryV1,
  LowerHexSha256,
  UInt64DecimalV1,
} from "@developer-os/core";

import { buildLauncherEnvironment } from "./environment.js";
import { buildLauncherProcessRequest, selectLauncherCandidate } from "./selection.js";

const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

/**
 * A read-only guarded reader over the real filesystem: no-follow opens,
 * exact 64-bit stats. It implements only `LauncherGuardedReaderV1` — the
 * four read methods `selectLauncherCandidate` calls — deliberately narrower
 * than `packages/core`'s full `LifecycleGuardedFileSystemV1`, which also
 * carries a mutation surface (`writeExclusive`, `renameNoReplace`, ...) this
 * read-only admission has no use for and should not need to wire.
 */
function createNodeLauncherReader(): LauncherGuardedReaderV1 {
  function toEntry(path: CanonicalAbsolutePathV1, stats: BigIntStats): LifecycleGuardedEntryV1 {
    const kind = stats.isSymbolicLink()
      ? "symlink"
      : stats.isDirectory()
        ? "directory"
        : stats.isFile()
          ? "regular_file"
          : "other";
    return {
      path,
      kind,
      ownerUid: Number(stats.uid),
      mode: Number(stats.mode & 0o777n),
      nlink: Number(stats.nlink),
      size: stats.size.toString(10) as UInt64DecimalV1,
      dev: stats.dev.toString(10) as UInt64DecimalV1,
      ino: stats.ino.toString(10) as UInt64DecimalV1,
    };
  }

  return {
    async lstat(path) {
      try {
        return toEntry(path, await nodeFs.lstat(path, { bigint: true }));
      } catch (error) {
        if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
          return null;
        }
        throw error;
      }
    },
    async readRegular(entry, maximumBytes) {
      const handle = await nodeFs.open(entry.path, READ_FLAGS);
      try {
        const bytes = new Uint8Array(await handle.readFile());
        if (bytes.byteLength > maximumBytes) throw new Error(`file exceeds the admitted bound: ${entry.path}`);
        return bytes;
      } finally {
        await handle.close();
      }
    },
    async hashRegular(entry, maximumBytes) {
      const handle = await nodeFs.open(entry.path, READ_FLAGS);
      try {
        const digest = createHash("sha256");
        let total = 0n;
        const chunk = Buffer.allocUnsafe(1_048_576);
        for (;;) {
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
          if (bytesRead === 0) break;
          total += BigInt(bytesRead);
          if (total > maximumBytes) throw new Error(`file exceeds the admitted bound: ${entry.path}`);
          digest.update(chunk.subarray(0, bytesRead));
        }
        return digest.digest("hex") as LowerHexSha256;
      } finally {
        await handle.close();
      }
    },
    async *names(directory) {
      const handle = await nodeFs.open(directory.path, DIRECTORY_FLAGS);
      try {
        const opened = await nodeFs.opendir(directory.path);
        try {
          for await (const child of opened) yield child.name;
        } finally {
          await opened.close().catch(() => undefined);
        }
      } finally {
        await handle.close();
      }
    },
  };
}

async function main(): Promise<void> {
  const platform = admitLauncherPlatformIdentity({ platform: nodePlatform(), architecture: arch() });

  const home = process.env.HOME;
  if (home === undefined || home.length === 0) {
    process.stderr.write("developer-os-launcher: HOME is not set\n");
    process.exitCode = 2;
    return;
  }
  // Spec 2 §3.1: "resolves the product home from the same guarded
  // default/DEVELOPER_OS_HOME grammar as the CLI, without resolving a
  // Brain" — `.brain` is discarded on purpose.
  const productHome = resolveRuntimePaths({
    HOME: home,
    ...(process.env.DEVELOPER_OS_HOME === undefined ? {} : { DEVELOPER_OS_HOME: process.env.DEVELOPER_OS_HOME }),
  }).home as CanonicalAbsolutePathV1;

  const env = buildLauncherEnvironment({
    home,
    productHome,
    brainOverride: process.env.DEVELOPER_OS_BRAIN ?? null,
  });

  const fs = createNodeLauncherReader();
  const effectiveUid = process.getuid?.() ?? -1;

  // ponytail: the package-manager-owned fallback location is Homebrew formula
  // work (Spec 2 §2, A16) and not yet wired; resolved relative to this
  // launcher's own install directory as a placeholder.
  const launcherRoot = new URL("../fallback", import.meta.url).pathname as CanonicalAbsolutePathV1;

  const selection = await selectLauncherCandidate({
    productHome,
    platform,
    effectiveUid,
    fs,
    packagedFallback: {
      bundleRoot: `${launcherRoot}/bundle` as CanonicalAbsolutePathV1,
      manifestPath: `${launcherRoot}/bundle-manifest.json` as CanonicalAbsolutePathV1,
    },
    // ponytail: always reports the terminal state until Task 9's read-only
    // bootstrap-closure reader is exposed to this package; see the module
    // docblock above.
    bootstrapClosure: { kind: "handoff_complete" },
    // ponytail: Task 11 owns real Ed25519 verification; nothing here can
    // check a signature, so this stub refuses nothing on its own.
    verifyRetainedDocument: () => undefined,
  });

  const request = buildLauncherProcessRequest(selection, env, process.argv.slice(2));

  // ponytail: fd 3 is reserved but not yet opened/written — Task 11 owns the
  // offline-trust pipe handoff. Until then this execs without it, which the
  // CLI's own FD 3 admission (Task 11) will refuse rather than silently trust.
  execFileSync(request.executable, request.argv, {
    env: { ...request.env },
    stdio: "inherit",
  });
}

function exitCodeOf(error: unknown): number {
  if (typeof error !== "object" || error === null || !("code" in error)) return 1;
  const code = (error as { readonly code: unknown }).code;
  return typeof code === "number" ? code : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`developer-os-launcher: ${error instanceof Error ? error.message : "failed"}\n`);
  process.exitCode = exitCodeOf(error);
});
