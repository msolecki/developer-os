import { lstat, readlink, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
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

export async function canonicalizePlannedPath(path: string): Promise<string> {
  if (path.includes("\0")) {
    refuse("Path contains a NUL byte");
  }
  if (!isAbsolute(path)) {
    refuse("Planned path must be absolute");
  }

  let existingAncestor = resolve(path);
  const unresolvedSegments: string[] = [];
  let symlinkHops = 0;

  for (;;) {
    try {
      const canonicalAncestor = await realpath(existingAncestor);
      return join(canonicalAncestor, ...unresolvedSegments);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }

      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) {
        refuse("No existing ancestor could be resolved");
      }

      // A dangling symlink is missing to realpath but present to lstat; a write through it lands at its target.
      const linkTarget = await danglingLinkTarget(existingAncestor);
      if (linkTarget !== undefined) {
        symlinkHops += 1;
        if (symlinkHops > MAX_SYMLINK_HOPS) {
          refuse("Too many symbolic links");
        }
        existingAncestor = resolve(await realpath(parent), linkTarget);
        continue;
      }

      unresolvedSegments.unshift(basename(existingAncestor));
      existingAncestor = parent;
    }
  }
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
