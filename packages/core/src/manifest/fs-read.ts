import { constants, type BigIntStats } from "node:fs";
import type { open } from "node:fs/promises";

import { ManifestStateError } from "./store.js";

/**
 * Reads the regular file `before` described through a no-follow descriptor and
 * proves it stayed that inode at that exact size for the whole read: the
 * descriptor is re-stated after open and after the last byte, and a byte past
 * the stated size is a refusal. A missing path escapes as its raw errno so the
 * caller decides what absence means; every other refusal is ManifestStateError.
 */
export async function readStableRegularFile(
  fs: { readonly open: typeof open },
  canonical: string,
  before: BigIntStats,
  maxBytes: number,
): Promise<Uint8Array> {
  const handle = await fs.open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.size < 0n || opened.size > BigInt(maxBytes)) throw new ManifestStateError();
    const bytes = new Uint8Array(Number(opened.size));
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead < 1) throw new ManifestStateError();
      offset += result.bytesRead;
    }
    if ((await handle.read(new Uint8Array(1), 0, 1, bytes.byteLength)).bytesRead !== 0) throw new ManifestStateError();
    const after = await handle.stat({ bigint: true });
    if (!after.isFile() || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) throw new ManifestStateError();
    return bytes;
  } finally {
    await handle.close();
  }
}
