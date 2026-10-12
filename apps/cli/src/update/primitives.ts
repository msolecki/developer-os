import { createHash } from "node:crypto";

import {
  parseCanonicalAbsolutePathText,
  parseUtcTimestamp,
  type CanonicalAbsolutePathV1,
  type LowerHexSha256,
  type UtcTimestampV1,
} from "@developer-os/core";

export function sha256Hex(bytes: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

export function parentPath(path: CanonicalAbsolutePathV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(path.slice(0, path.lastIndexOf("/")));
}

/** A journal timestamp never moves backwards, whatever the wall clock says. */
export function stampAfter(now: () => Date, floor: UtcTimestampV1): UtcTimestampV1 {
  const stamp = parseUtcTimestamp(now().toISOString());
  return stamp > floor ? stamp : floor;
}
