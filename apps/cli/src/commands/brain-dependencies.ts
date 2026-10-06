import type { DeveloperOsConfigV1 } from "@developer-os/core";
import { resolveBrainConfig } from "@developer-os/brain";
import type { BrainServiceDependencies, DirectoryEntry } from "@developer-os/brain";

import type { CliContext } from "../context.js";

/**
 * Notes are read through the protected-path policy, not through the raw
 * filesystem. They are user files in a user-writable tree, and `readText` is
 * the channel that opens with `O_NOFOLLOW` and re-checks `dev`/`ino` after
 * open — the same guard configuration gets.
 *
 * Its own module so the hook runtime (`hooks/inject.ts`) reaches it without
 * loading `reindex.ts` → `doctor.ts` and, through them, both adapter packages.
 */
export function dependenciesFor(
  context: CliContext,
  vaultRoot: string,
  config: DeveloperOsConfigV1,
): BrainServiceDependencies {
  return {
    vaultRoot,
    config: resolveBrainConfig(config),
    reader: {
      readDir: async (path: string): Promise<readonly DirectoryEntry[]> => {
        const entries = await context.fs.readdir(path, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
          isSymbolicLink: entry.isSymbolicLink(),
        }));
      },
    },
    readFile: (path: string) => context.guards.readText(path),
    readCanonicalFile: (path: string) => context.guards.readText(path, undefined, { requireCanonical: true }),
    assertReadable: async (path: string): Promise<void> => {
      await context.guards.manifest.assertReadable(path);
    },
    now: context.now,
  };
}
