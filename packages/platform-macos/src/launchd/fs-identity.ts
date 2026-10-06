import type { BigIntStats } from "node:fs";

import { LAUNCHD_PROCESS_STAGING_CHILDREN, LifecycleRecoveryRequiredError } from "@developer-os/core";

import type { LaunchdFileSystemV1 } from "./bootstrap.js";
import type { LaunchdProcessDirectoryIdentityV1, SupportedLaunchdProcessTableV1 } from "./process-table.js";

const PRIVATE_DIRECTORY_MODE = 0o700;

/** `gui/<uid>`: the one launchd domain shape every reader admits (MACOS-4: one pattern, not five). */
export const LAUNCHD_GUI_DOMAIN_PATTERN = /^gui\/(0|[1-9][0-9]{0,9})$/u;

export function sameIdentity(stats: BigIntStats, identity: { readonly dev: string; readonly ino: string }): boolean {
  return stats.dev.toString(10) === identity.dev && stats.ino.toString(10) === identity.ino;
}

function recovery(reason: string, path: string): never {
  throw new LifecycleRecoveryRequiredError(reason, [path]);
}

/** The directory's entries, with its identity proven both before and after the listing. */
async function admitDirectory(fs: LaunchdFileSystemV1, identity: LaunchdProcessDirectoryIdentityV1): Promise<readonly string[]> {
  const matches = (stats: BigIntStats): boolean =>
    stats.isDirectory() &&
    stats.uid === BigInt(identity.ownerUid) &&
    (stats.mode & 0o7777n) === BigInt(PRIVATE_DIRECTORY_MODE) &&
    sameIdentity(stats, identity);
  if (!matches(await fs.lstat(identity.path, { bigint: true }))) recovery("launchd_process_staging_changed", identity.path);
  const entries = [...(await fs.readdir(identity.path))].sort();
  if (!matches(await fs.lstat(identity.path, { bigint: true }))) recovery("launchd_process_staging_changed", identity.path);
  return entries;
}

/** Before and after every launchctl process: the exact two-child root and both children entry-empty. */
export async function admitProcessStaging(fs: LaunchdFileSystemV1, table: SupportedLaunchdProcessTableV1): Promise<void> {
  const { root, home, tmp } = table.staging;
  const children = await admitDirectory(fs, root);
  if (children.length !== LAUNCHD_PROCESS_STAGING_CHILDREN.length || LAUNCHD_PROCESS_STAGING_CHILDREN.some((child, index) => children[index] !== child)) {
    recovery("launchd_process_staging_changed", root.path);
  }
  if ((await admitDirectory(fs, home)).length !== 0) recovery("launchd_process_staging_not_empty", home.path);
  if ((await admitDirectory(fs, tmp)).length !== 0) recovery("launchd_process_staging_not_empty", tmp.path);
}
