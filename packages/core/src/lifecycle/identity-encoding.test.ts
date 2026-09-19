import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCanonicalAbsolutePathText } from "../update/paths.js";
import { parseUInt64Decimal } from "../update/scalars.js";
import {
  createNodeLifecycleGuardedFileSystem,
  sameLifecycleGuardedIdentity,
  type LifecycleGuardedEntryV1,
} from "./guarded-fs.js";
import { createLinkUnlinkRenameNoReplace } from "./testing.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await nodeFs.rm(root, { recursive: true, force: true });
  }
});

function entryAt(ino: bigint): LifecycleGuardedEntryV1 {
  return {
    path: parseCanonicalAbsolutePathText("/tmp"),
    kind: "directory",
    ownerUid: 0,
    mode: 0o700,
    nlink: 2,
    size: parseUInt64Decimal("0"),
    dev: parseUInt64Decimal("1"),
    ino: parseUInt64Decimal(ino.toString(10)),
  };
}

describe("the one filesystem-identity encoding", () => {
  it("records a real path's identity as the exact BigInt rendering", async () => {
    const created = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-identity-"));
    roots.push(created);
    await nodeFs.chmod(created, 0o700);
    const root = parseCanonicalAbsolutePathText(created);
    const fs = createNodeLifecycleGuardedFileSystem({
      renameNoReplace: createLinkUnlinkRenameNoReplace().publish,
      effectiveUid: process.getuid?.() ?? 0,
    });
    const exact = await nodeFs.lstat(root, { bigint: true });

    expect(await fs.lstat(root)).toMatchObject({
      dev: exact.dev.toString(10),
      ino: exact.ino.toString(10),
    });
  });

  /**
   * `/tmp` measured 1152921500312571551 on 2026-09-18. The spacing between
   * representable JavaScript numbers there is 128, so this inode and the next
   * one both render 1152921500312571500 through a number — one recorded
   * identity for two files. The rendering keeps them apart, which is why every
   * recorded identity is read from `{ bigint: true }` stats.
   */
  it("distinguishes two adjacent inodes at the measured APFS magnitude, which a number cannot", () => {
    const measured = 1152921500312571551n;

    expect(sameLifecycleGuardedIdentity(entryAt(measured), entryAt(measured + 1n))).toBe(false);
    expect(String(Number(measured))).toBe(String(Number(measured + 1n)));
  });
});
