import { lstat, readlink, realpath } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  sep,
} from "node:path";
import { EXIT_CODES } from "@developer-os/core";

export class SecurityRefusalError extends Error {
  readonly code = EXIT_CODES.securityRefusal;
  readonly detail: string | undefined;

  constructor(message: string, options?: ErrorOptions & { readonly detail?: string | undefined }) {
    super(message, options);
    this.name = "SecurityRefusalError";
    this.detail = options?.detail;
  }
}

function refuse(message: string): never {
  throw new SecurityRefusalError(message);
}

function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }

  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

function isSameOrDescendant(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (pathFromParent !== ".." &&
      !pathFromParent.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromParent))
  );
}

const MAX_SYMLINK_HOPS = 40;

async function danglingLinkTarget(path: string): Promise<string | undefined> {
  try {
    return (await lstat(path)).isSymbolicLink() ? await readlink(path) : undefined;
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Walks the path one component at a time, as the kernel does: an existing prefix is realpath-ed
 * before the `..` after it applies (AUD-002 review), and a dangling symlink, missing to realpath
 * but present to lstat, is replaced by its target's components, because a write through it lands
 * there. Below the first missing component the rest is appended lexically.
 */
export async function canonicalizePlannedPath(path: string): Promise<string> {
  if (path.includes("\0")) {
    refuse("Path contains a NUL byte");
  }
  if (!isAbsolute(path)) {
    refuse("Planned path must be absolute");
  }

  const pending = path.split("/");
  let current = "/";
  let symlinkHops = 0;

  for (let component = pending.shift(); component !== undefined; component = pending.shift()) {
    if (component === "" || component === ".") {
      continue;
    }
    if (component === "..") {
      current = dirname(current);
      continue;
    }
    const candidate = join(current, component);
    try {
      current = await realpath(candidate);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      const linkTarget = await danglingLinkTarget(candidate);
      if (linkTarget === undefined) {
        current = candidate;
        continue;
      }
      symlinkHops += 1;
      if (symlinkHops > MAX_SYMLINK_HOPS) {
        refuse("Too many symbolic links");
      }
      pending.unshift(...linkTarget.split("/"));
      if (isAbsolute(linkTarget)) {
        current = "/";
      }
    }
  }
  return current;
}

export async function assertDisjointPaths(
  paths: readonly string[],
): Promise<void> {
  const canonicalPaths = await Promise.all(paths.map(canonicalizePlannedPath));

  for (let leftIndex = 0; leftIndex < canonicalPaths.length; leftIndex += 1) {
    const left = canonicalPaths[leftIndex];
    if (left === undefined) {
      continue;
    }

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < canonicalPaths.length;
      rightIndex += 1
    ) {
      const right = canonicalPaths[rightIndex];
      if (right === undefined) {
        continue;
      }

      if (
        isSameOrDescendant(left, right) ||
        isSameOrDescendant(right, left)
      ) {
        refuse("Owned paths must be disjoint");
      }
    }
  }
}
