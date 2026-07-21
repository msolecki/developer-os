import { realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
import { EXIT_CODES } from "@developer-os/core";

export class SecurityRefusalError extends Error {
  readonly code = EXIT_CODES.securityRefusal;

  constructor(message: string) {
    super(message);
    this.name = "SecurityRefusalError";
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

export async function canonicalizePlannedPath(path: string): Promise<string> {
  if (path.includes("\0")) {
    refuse("Path contains a NUL byte");
  }
  if (!isAbsolute(path)) {
    refuse("Planned path must be absolute");
  }

  let existingAncestor = resolve(path);
  const unresolvedSegments: string[] = [];

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

/**
 * Validates the current filesystem snapshot. Task 5 transaction guards must
 * invoke it immediately before every filesystem operation.
 */
export async function resolveOwnedPath(
  root: string,
  candidate: string,
): Promise<string> {
  if (candidate.length === 0) {
    refuse("Owned path candidate must not be empty");
  }
  if (candidate.includes("\0")) {
    refuse("Owned path candidate contains a NUL byte");
  }
  if (isAbsolute(candidate) || win32.isAbsolute(candidate)) {
    refuse("Owned path candidate must be relative");
  }
  if (candidate.split(/[\\/]/u).includes("..")) {
    refuse("Owned path candidate must not traverse upward");
  }

  const canonicalRoot = await canonicalizePlannedPath(root);
  const canonicalCandidate = await canonicalizePlannedPath(
    resolve(root, candidate),
  );

  if (!isSameOrDescendant(canonicalRoot, canonicalCandidate)) {
    refuse("Owned path candidate escapes its root");
  }

  return canonicalCandidate;
}
