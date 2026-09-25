import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CanonicalAbsolutePathV1, UInt64DecimalV1 } from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import { createNodeLauncherReader } from "./reader.js";

describe("createNodeLauncherReader", () => {
  let directory: string | null = null;
  afterEach(async () => {
    if (directory !== null) await rm(directory, { recursive: true, force: true });
    directory = null;
  });

  it("refuses to read or hash a file whose inode is not the admitted entry's", async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), "developer-os-reader-")));
    const path = join(directory, "record.json") as CanonicalAbsolutePathV1;
    await writeFile(path, "{}\n", { mode: 0o600 });
    const reader = createNodeLauncherReader(process.getuid?.() ?? -1);
    const entry = await reader.lstat(path);
    if (entry === null) throw new Error("fixture file must exist");
    const forged = { ...entry, ino: (BigInt(entry.ino) + 1n).toString(10) as UInt64DecimalV1 };

    await expect(reader.readRegular(forged, 1024)).rejects.toMatchObject({ reason: "lifecycle_guarded_identity" });
    await expect(reader.hashRegular(forged, 1024n)).rejects.toMatchObject({ reason: "lifecycle_guarded_identity" });
  });
});
