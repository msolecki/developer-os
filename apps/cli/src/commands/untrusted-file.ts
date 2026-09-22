import type { BigIntStats } from "node:fs";
import { isAbsolute } from "node:path";
import { EXIT_CODES, type ExitCode } from "@developer-os/core";
import { SecurityRefusalError } from "@developer-os/security";
import type { CliContext } from "../context.js";

type FailureExitCode = Exclude<ExitCode, typeof EXIT_CODES.success>;

export type UntrustedFileReason =
  | "protected"
  | "symlink"
  | "not_regular"
  | "not_found"
  | "too_large"
  | "not_text";

const REFUSALS: Readonly<
  Record<UntrustedFileReason, { readonly code: FailureExitCode; readonly message: string }>
> = {
  protected: {
    code: EXIT_CODES.securityRefusal,
    message: "the path is protected and was not read",
  },
  symlink: {
    code: EXIT_CODES.securityRefusal,
    message: "the path is a symbolic link and was not followed",
  },
  not_regular: {
    code: EXIT_CODES.operationalFailure,
    message: "the path is not a regular file and was not read",
  },
  not_found: {
    code: EXIT_CODES.invalidInput,
    message: "the path does not exist",
  },
  too_large: {
    code: EXIT_CODES.operationalFailure,
    message: "the file is larger than the bound and was not read past it",
  },
  not_text: {
    code: EXIT_CODES.operationalFailure,
    message: "the file is not UTF-8 text",
  },
};

/** Never carries file content or the path; callers attach the path through `paths`. */
export class UntrustedFileRefusal extends Error {
  readonly reason: UntrustedFileReason;
  readonly code: FailureExitCode;

  constructor(reason: UntrustedFileReason) {
    super(REFUSALS[reason].message);
    this.name = "UntrustedFileRefusal";
    this.reason = reason;
    this.code = REFUSALS[reason].code;
  }
}

function isMissingEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

/**
 * Spec §4.2: the only reader for user, vault, vendor and override files.
 * `path` must be absolute; a relative path is a programming error (RangeError).
 */
export async function readUntrustedText(
  context: Pick<CliContext, "fs" | "guards">,
  path: string,
  bound: number,
): Promise<string> {
  if (!isAbsolute(path)) {
    throw new RangeError("readUntrustedText needs an absolute path");
  }
  try {
    await context.guards.manifest.assertReadable(path);
  } catch (error) {
    if (error instanceof SecurityRefusalError) {
      throw new UntrustedFileRefusal("protected");
    }
    throw error;
  }

  let before: BigIntStats;
  try {
    before = await context.fs.lstat(path, { bigint: true });
  } catch (error) {
    if (isMissingEntry(error)) throw new UntrustedFileRefusal("not_found");
    throw error;
  }
  if (before.isSymbolicLink()) throw new UntrustedFileRefusal("symlink");
  if (!before.isFile()) throw new UntrustedFileRefusal("not_regular");

  return context.guards.readText(path, async (handle) => {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    ) {
      throw new UntrustedFileRefusal("not_regular");
    }
    const buffer = Buffer.alloc(bound + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        filled,
        buffer.length - filled,
        filled,
      );
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    if (filled > bound) throw new UntrustedFileRefusal("too_large");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, filled),
      );
    } catch {
      throw new UntrustedFileRefusal("not_text");
    }
    if (text.includes("\0")) throw new UntrustedFileRefusal("not_text");
    return text;
  });
}
