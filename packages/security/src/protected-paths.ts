import { constants } from "node:fs";
import { open, stat, type FileHandle } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  canonicalizePlannedPath,
  SecurityRefusalError,
} from "./paths.js";

const protectedDirectoryNames = new Set([".ssh", ".aws", ".gnupg"]);

function hasProtectedEnvironmentName(segments: readonly string[]): boolean {
  return segments.some(
    (segment) => segment === ".env" || segment.startsWith(".env."),
  );
}

function hasProtectedDirectory(segments: readonly string[]): boolean {
  return segments.some((segment) => protectedDirectoryNames.has(segment));
}

function splitLexicalSegments(path: string): readonly string[] {
  return path.split(/[\\/]/u).filter((segment) => segment.length > 0);
}

async function defaultUtf8Reader(handle: FileHandle): Promise<string> {
  return handle.readFile({ encoding: "utf8" });
}

export class ProtectedPathPolicy {
  readonly #home: string;

  constructor(home: string) {
    if (home.includes("\0") || !isAbsolute(home)) {
      throw new SecurityRefusalError("Home path must be an absolute safe path");
    }
    this.#home = resolve(home);
  }

  async assertReadable(path: string): Promise<void> {
    await this.#resolveAllowed(path);
  }

  async assertWritable(path: string): Promise<void> {
    await this.#resolveAllowed(path);
  }

  async readText(
    path: string,
    reader: (handle: FileHandle) => Promise<string> = defaultUtf8Reader,
  ): Promise<string> {
    const canonicalPath = await this.#resolveAllowed(path);
    let expectedIdentity: Awaited<ReturnType<typeof stat>>;
    try {
      expectedIdentity = await stat(canonicalPath, { bigint: true });
    } catch {
      throw new SecurityRefusalError("Unable to verify readable file identity");
    }

    let handle: FileHandle;
    try {
      handle = await open(
        canonicalPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch {
      throw new SecurityRefusalError("Unable to open verified readable file");
    }

    try {
      let openedIdentity: Awaited<ReturnType<FileHandle["stat"]>>;
      try {
        openedIdentity = await handle.stat({ bigint: true });
      } catch {
        throw new SecurityRefusalError("Unable to verify opened file identity");
      }

      if (
        openedIdentity.dev !== expectedIdentity.dev ||
        openedIdentity.ino !== expectedIdentity.ino
      ) {
        throw new SecurityRefusalError("Readable file identity changed");
      }

      return await reader(handle);
    } finally {
      await handle.close();
    }
  }

  async #resolveAllowed(path: string): Promise<string> {
    const absolutePath = isAbsolute(path)
      ? resolve(path)
      : resolve(this.#home, path);

    this.#assertAllowed(absolutePath);
    const [canonicalHome, canonicalPath] = await Promise.all([
      canonicalizePlannedPath(this.#home),
      canonicalizePlannedPath(absolutePath),
    ]);
    this.#assertAllowed(canonicalPath, canonicalHome);
    return canonicalPath;
  }

  #assertAllowed(path: string, policyHome = this.#home): void {
    if (path.includes("\0")) {
      throw new SecurityRefusalError("Path contains a NUL byte");
    }

    const rawSegments = splitLexicalSegments(path);
    if (
      hasProtectedEnvironmentName(rawSegments) ||
      hasProtectedDirectory(rawSegments)
    ) {
      throw new SecurityRefusalError("Path is protected");
    }

    const absolutePath = resolve(path);
    const pathFromHome = relative(policyHome, absolutePath);
    const isWithinHome =
      pathFromHome === "" ||
      (pathFromHome !== ".." &&
        !pathFromHome.startsWith(`..${sep}`) &&
        !isAbsolute(pathFromHome));

    if (!isWithinHome) {
      return;
    }

    const protectedExactPaths = [
      resolve(policyHome, ".config/gh/hosts.yml"),
      resolve(policyHome, ".codex/auth.json"),
      resolve(policyHome, ".claude/.credentials.json"),
    ];

    if (protectedExactPaths.includes(absolutePath)) {
      throw new SecurityRefusalError("Path is protected");
    }
  }
}
