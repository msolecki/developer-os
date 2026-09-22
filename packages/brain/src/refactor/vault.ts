import { isAbsolute, join, relative, sep } from "node:path";

import type { DirectoryEntry } from "../discovery/index.js";
import type { IndexBuildRequest } from "../indexes/index.js";

/** `ENOENT` only: any other read failure is a real fault and must surface. */
function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

function missing(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file: ${path}`), { code: "ENOENT" });
}

/**
 * Overlays created/replaced files and hides removed ones; everything else reads
 * through `base`. Keys are compared NFC, because discovery hands `readFile` the
 * raw directory-entry name while callers build keys from NFC note paths.
 */
export function overlayBuildRequest(
  base: IndexBuildRequest,
  changes: ReadonlyMap<string /* absolute */, string | null /* null = removed */>,
): IndexBuildRequest {
  const overlay = new Map<string, string | null>();
  for (const [path, value] of changes) overlay.set(path.normalize("NFC"), value);
  const lookup = (path: string): string | null | undefined => overlay.get(path.normalize("NFC"));

  return {
    ...base,
    reader: {
      async readDir(path: string): Promise<readonly DirectoryEntry[]> {
        let existing: readonly DirectoryEntry[];
        try {
          existing = await base.reader.readDir(path);
        } catch (error: unknown) {
          // A created note may sit in a folder the vault does not have yet.
          if (!isMissing(error)) throw error;
          existing = [];
        }
        const kept = existing.filter((entry) => lookup(join(path, entry.name)) !== null);
        const names = new Set(kept.map((entry) => entry.name.normalize("NFC")));
        const added: DirectoryEntry[] = [];
        for (const [absolute, value] of overlay) {
          if (value === null) continue;
          const below = relative(path.normalize("NFC"), absolute);
          if (below === "" || below.startsWith("..") || isAbsolute(below)) continue;
          const first = below.split(sep)[0] as string;
          if (names.has(first)) continue;
          names.add(first);
          const isFile = below === first;
          added.push({ name: first, isDirectory: !isFile, isFile, isSymbolicLink: false });
        }
        return [...kept, ...added];
      },
    },
    readFile: (path: string): Promise<string> => {
      const value = lookup(path);
      if (value === null) return Promise.reject(missing(path));
      return value === undefined ? base.readFile(path) : Promise.resolve(value);
    },
    assertReadable: (path: string): Promise<void> =>
      typeof lookup(path) === "string" ? Promise.resolve() : base.assertReadable(path),
  };
}
