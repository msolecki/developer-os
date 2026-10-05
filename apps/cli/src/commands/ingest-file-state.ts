import { createHash } from "node:crypto";

import { isMissingEntry } from "../config-file.js";
import type { CliContext } from "../context.js";

/**
 * What `ingest` binds a vault path to across the agent call (D83 (2), BACKLOG NEW-40): the
 * file's identity and its exact bytes, never a timestamp. Its own module because a module that
 * records `dev`/`ino` must read every stat as `bigint` (`tests/repository/check.ts`).
 */

function identityOf(stat: { readonly dev: bigint; readonly ino: bigint }): string {
  return `${stat.dev.toString(10)}:${stat.ino.toString(10)}`;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `dev:ino:sha256` of a file this run has open. */
export function stateOf(
  stat: { readonly dev: bigint; readonly ino: bigint },
  bytes: Uint8Array,
): string {
  return `${identityOf(stat)}:${sha256(bytes)}`;
}

/** The identity on disk now, with the bytes the caller itself wrote rather than a second read. */
export async function boundState(context: CliContext, path: string, bytesSha256: string): Promise<string> {
  return `${identityOf(await context.fs.lstat(path, { bigint: true }))}:${bytesSha256}`;
}

/**
 * `absent`, the file's `stateOf`, or `unreadable` — a file this run cannot read is compared as
 * such rather than failing every capture that never touches it.
 */
export async function fileState(context: CliContext, path: string): Promise<string> {
  try {
    await context.fs.lstat(path, { bigint: true });
  } catch (error) {
    if (isMissingEntry(error)) return "absent";
    throw error;
  }
  let state = "unreadable";
  try {
    await context.guards.readText(path, async (handle) => {
      state = stateOf(await handle.stat({ bigint: true }), await handle.readFile());
      return "";
    });
  } catch {
    return "unreadable";
  }
  return state;
}
