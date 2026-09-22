#!/usr/bin/env node
/**
 * The stable launcher's composition root. It resolves platform identity and
 * the product home, admits a launcher candidate, constructs the shell-free
 * process request `selection.ts` produces, writes the FD 3 offline-trust
 * handoff when one is configured, and execs it.
 *
 * `ponytail:` the bootstrap-closure reader is not wired for real here — a
 * real reader (walking the plan/journal/retention envelope) is Task 9's
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
import { spawn } from "node:child_process";

import {
  admitLauncherPlatformIdentity,
  type LauncherGuardedReaderV1,
} from "@developer-os/platform-macos";
import { resolveRuntimePaths } from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  LifecycleGuardedEntryV1,
  LowerHexSha256,
  OfflineReleaseTrustV1,
  OfflineRootKeyV1,
  UInt64DecimalV1,
} from "@developer-os/core";

import { buildLauncherEnvironment } from "./environment.js";
import {
  compileLauncherOfflineReleaseTrust,
  createLauncherRetainedDocumentVerifier,
  writeOfflineReleaseTrustHandoff,
} from "./handoff.js";
import { buildLauncherProcessRequest, selectLauncherCandidate, type LauncherProcessRequestV1 } from "./selection.js";

const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

/**
 * ponytail: the founder has not yet decided the production offline root key
 * or its permitted metadata-redirect origins (that decision, and wiring
 * real compiled constants here, is Task 11b's territory) — both empty
 * rather than guessed or hardcoded in the meantime. Empty roots alone
 * already makes `compileLauncherOfflineReleaseTrust` return `null`: no FD 3
 * pipe is opened and `verifyRetainedDocument` refuses every retained
 * document it is asked to check, which only ever routes a present active
 * release into recovery (never past `LauncherBundleAdmission`'s guarded
 * checks) — the same safe-widening invariant the bootstrap-closure stub
 * above documents.
 */
const LAUNCHER_OFFLINE_RELEASE_ROOTS: readonly OfflineRootKeyV1[] = [];
const LAUNCHER_METADATA_REDIRECT_ORIGINS: OfflineReleaseTrustV1["metadataRedirectOrigins"] = [];

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

/**
 * Execs the admitted release with a real anonymous pipe at FD 3 when trust
 * is configured, or without one otherwise — Task 11b's documented "absent"
 * fallback. `execFileSync` cannot hand a child a real pipe descriptor, so
 * this uses `spawn`'s extra `stdio` slot: the launcher writes the rendered
 * trust bytes into its own write end and ends the stream (closing it)
 * before the child is expected to have read past EOF, then waits for the
 * child's own exit and mirrors it exactly as this process's exit.
 */
async function execAdmittedRelease(request: LauncherProcessRequestV1, trust: OfflineReleaseTrustV1 | null): Promise<void> {
  const child = spawn(request.executable, [...request.argv], {
    env: { ...request.env },
    stdio: trust === null ? ["inherit", "inherit", "inherit"] : ["inherit", "inherit", "inherit", "pipe"],
  });

  // Listeners attach immediately, before the FD 3 write below is ever
  // awaited: an `error` event with no listener throws and crashes this
  // process, and a child that exits early while the write is still pending
  // (a full pipe buffer with nothing draining it) must still be observable
  // rather than leaving the write's `await` stuck forever.
  const exit = new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolve({ code, signal });
      });
    },
  );

  if (trust !== null) {
    const pipe = child.stdio[3];
    if (pipe === null) {
      throw new Error("developer-os-launcher: failed to open the offline-trust pipe");
    }
    await writeOfflineReleaseTrustHandoff(pipe as NodeJS.WritableStream, trust);
  }

  const outcome = await exit;
  process.exitCode = outcome.code ?? (outcome.signal === null ? 1 : 128);
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
    verifyRetainedDocument: createLauncherRetainedDocumentVerifier(LAUNCHER_OFFLINE_RELEASE_ROOTS),
  });

  const trust = compileLauncherOfflineReleaseTrust({
    acceptedRoots: LAUNCHER_OFFLINE_RELEASE_ROOTS,
    metadataRedirectOrigins: LAUNCHER_METADATA_REDIRECT_ORIGINS,
  });
  const request = buildLauncherProcessRequest(selection, env, process.argv.slice(2), trust !== null);

  await execAdmittedRelease(request, trust);
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
