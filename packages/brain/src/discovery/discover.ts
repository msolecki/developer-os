import { join } from "node:path";

import { containsPath } from "@developer-os/core";
import type { BrainConfigV1 } from "@developer-os/core";
import { canonicalizePlannedPath, SecurityRefusalError } from "@developer-os/security";

export interface DirectoryEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
}

export interface DirectoryReader {
  readDir(path: string): Promise<readonly DirectoryEntry[]>;
}

export interface DiscoveredNote {
  readonly vaultPath: string;
  readonly absolutePath: string;
  readonly topicFolder: string;
}

export interface DiscoveryResult {
  readonly notes: readonly DiscoveredNote[];
  readonly unclassifiedFolders: readonly string[];
  /**
   * Topic folders that are symlinks, and are therefore not descended into.
   * Reported rather than dropped because nothing downstream can recover them:
   * they reach neither `notes` nor `unclassifiedFolders`, and lint sees only
   * the build result, so a user whose `PROJECTS/` is a link would watch it
   * vanish from the catalog with nothing to grep for.
   */
  readonly symlinkedFolders: readonly string[];
}

export interface DiscoveryRequest {
  /**
   * Absolute. The content root is canonicalized on every call, and
   * `canonicalizePlannedPath` refuses a relative path outright — so a
   * repo-relative root fails closed rather than resolving against `cwd`.
   */
  readonly vaultRoot: string;
  readonly config: BrainConfigV1;
  readonly reader: DirectoryReader;
  readonly assertReadable: (path: string) => Promise<void>;
  readonly canonicalize?: (path: string) => Promise<string>;
}

/**
 * `_indexes` is deliberately absent: it is excluded by `config.indexesDir`,
 * which a user may rename. Duplicating it here would make a renamed index
 * directory scannable as notes while the stale constant still guarded a
 * directory that no longer exists.
 *
 * Frozen, because `readonly` is erased at runtime and this is a security
 * boundary: one `(PRIVATE_FOLDERS as string[]).pop()` anywhere in the process
 * would silently re-admit quarantined captures to the index.
 */
export const PRIVATE_FOLDERS: readonly string[] = Object.freeze([
  "_raw",
  "_outputs",
  "_graveyard",
  "templates",
]);

/**
 * Byte order over the NFC form, not `localeCompare`. Collation is locale- and
 * ICU-version-dependent, and the determinism gate says two machines must agree
 * on the index — including two machines with different locales.
 */
export function compareCanonical(a: string, b: string): number {
  const left = Buffer.from(a.normalize("NFC"), "utf8");
  const right = Buffer.from(b.normalize("NFC"), "utf8");
  return Buffer.compare(left, right);
}

/**
 * The tie-break for `compareCanonical`, and deliberately *not* normalizing.
 * Two names differing only in normalization are equal under `compareCanonical`
 * by design, so it cannot separate them — a tie-break built on it returns 0
 * again and leaves the order to the reader.
 */
export function compareRawBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Excluded at *every* depth, per spec §5 — not only directly under
 * `contentRoot`. Applying it at one level only means `content/DEV/_raw/` is
 * enumerated, opened and indexed, which is exactly the quarantined-capture leak
 * deny-by-default exists to prevent.
 *
 * The folder-name half does not apply to regular files. `indexesDir` is a
 * user-supplied segment and `pathSegmentSchema` permits `notes.md`, so matching
 * it against files would silently drop every note of that name at every depth.
 * A *symlink* named `_raw` is still excluded by name rather than falling to the
 * link branch, so a user whose excluded folder is a link to somewhere outside
 * the vault keeps working instead of losing the whole reindex to a refusal over
 * a directory that is never read. The dot-prefix half stays unconditional —
 * spec §5 excludes any segment beginning with `.`, file or not.
 */
function isExcludedSegment(
  name: string,
  isRegularFile: boolean,
  config: BrainConfigV1,
): boolean {
  if (name.startsWith(".")) return true;
  if (isRegularFile) return false;
  return name === config.indexesDir || PRIVATE_FOLDERS.includes(name);
}

function resolveTopic(name: string, config: BrainConfigV1): string | null {
  /**
   * `Object.hasOwn` rather than a plain lookup. `topicAliases` is user data, so
   * a folder whose name is also an inherited property would otherwise resolve
   * through the prototype chain to a mapping the user never wrote.
   */
  const aliased = Object.hasOwn(config.topicAliases, name)
    ? config.topicAliases[name]
    : name;
  if (aliased === undefined) return null;
  return config.topicFolders.includes(aliased) ? aliased : null;
}

/**
 * Spec §5: every path is resolved through Foundation's canonicalization, so a
 * link out of the vault is refused rather than followed. Returns nothing —
 * clearing an in-vault link does not make it followable, and every caller
 * skips the entry either way.
 */
async function refuseEscapingLink(
  absolutePath: string,
  vaultPath: string,
  vaultRootCanonical: string,
  canonicalize: (path: string) => Promise<string>,
): Promise<void> {
  const target = await canonicalize(absolutePath);
  if (!containsPath(vaultRootCanonical, target)) {
    throw new SecurityRefusalError(
      `Vault entry resolves outside the vault: ${vaultPath}`,
    );
  }
}

/**
 * Deduplicated because the entries are already NFC-folded: two sibling
 * directories differing only in normalization produce one vault path twice, and
 * one directory must not raise two identical findings.
 */
function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareCanonical);
}

interface WalkContext {
  readonly request: DiscoveryRequest;
  readonly vaultRootCanonical: string;
  readonly canonicalize: (path: string) => Promise<string>;
}

async function walk(
  directory: string,
  vaultPrefix: string,
  topicFolder: string,
  context: WalkContext,
  notes: DiscoveredNote[],
): Promise<void> {
  const { request } = context;
  const entries = await request.reader.readDir(directory);

  for (const entry of entries) {
    const name = entry.name.normalize("NFC");
    if (isExcludedSegment(name, entry.isFile, request.config)) continue;

    /**
     * The absolute path keeps `entry.name` verbatim while the vault path is
     * normalized. A macOS volume may store the decomposed form, and a composed
     * path built from it does not open.
     */
    const absolutePath = join(directory, entry.name);
    const vaultPath = `${vaultPrefix}/${name}`;

    if (entry.isSymbolicLink) {
      await refuseEscapingLink(
        absolutePath,
        vaultPath,
        context.vaultRootCanonical,
        context.canonicalize,
      );
      /**
       * Skipped even when it resolves inside. A link and its target are one
       * file: indexed as two notes they carry one content hash, and the
       * duplicate finding that produces names two paths the user cannot
       * reconcile because only one of them is real.
       */
      continue;
    }

    if (entry.isDirectory) {
      await walk(absolutePath, vaultPath, topicFolder, context, notes);
      continue;
    }

    if (!entry.isFile || !name.endsWith(".md")) continue;

    await request.assertReadable(absolutePath);
    notes.push({ vaultPath, absolutePath, topicFolder });
  }
}

/**
 * Deny by default. A folder is scanned because it is a configured topic folder,
 * never because it failed to match an exclusion — the inverse would index a
 * folder the user added after this code was written.
 */
export async function discoverNotes(
  request: DiscoveryRequest,
): Promise<DiscoveryResult> {
  const { config } = request;
  const canonicalize = request.canonicalize ?? canonicalizePlannedPath;
  /**
   * Normalized before it is interpolated. Every directory-entry name is folded
   * to NFC, so leaving the configured root raw would emit vault paths that are
   * not in NFC and make two machines whose config files differ only in
   * normalization disagree on the index bytes.
   */
  const contentRoot = config.contentRoot.normalize("NFC");
  const contentDir = join(request.vaultRoot, config.contentRoot);

  const vaultRootCanonical = await canonicalize(request.vaultRoot);
  /**
   * The content root is resolved before anything under it is read. A symlinked
   * `content` is not reported by `readdir` at all — the walk starts inside it —
   * so without this check a link to another vault would be enumerated in full
   * and every note under it indexed as though it were the user's own.
   */
  await refuseEscapingLink(
    contentDir,
    contentRoot,
    vaultRootCanonical,
    canonicalize,
  );

  const context: WalkContext = { request, vaultRootCanonical, canonicalize };
  const notes: DiscoveredNote[] = [];
  const unclassified: string[] = [];
  const symlinked: string[] = [];

  const entries = await request.reader.readDir(contentDir);

  for (const entry of entries) {
    const name = entry.name.normalize("NFC");
    if (isExcludedSegment(name, entry.isFile, config)) continue;

    const absolutePath = join(contentDir, entry.name);
    const vaultPath = `${contentRoot}/${name}`;

    if (entry.isSymbolicLink) {
      await refuseEscapingLink(
        absolutePath,
        vaultPath,
        vaultRootCanonical,
        canonicalize,
      );
      symlinked.push(vaultPath);
      continue;
    }

    if (!entry.isDirectory) continue;

    const topicFolder = resolveTopic(name, config);
    if (topicFolder === null) {
      unclassified.push(vaultPath);
      continue;
    }

    await walk(absolutePath, vaultPath, topicFolder, context, notes);
  }

  /**
   * Sorted on the way out rather than relying on the reader. `readdir` order is
   * filesystem-dependent, and the determinism gate is only meaningful if a
   * hostile ordering produces identical bytes.
   *
   * The raw-byte tie-break on `absolutePath` is what makes the order *total*.
   * Two files whose names differ only in Unicode normalization share one NFC
   * `vaultPath`, so comparing vault paths alone returns 0 and leaves their
   * order to the reader — the one input that would make the reversed-reader
   * gate pass by luck. The tie-break must compare unnormalized bytes:
   * `compareCanonical` folds to NFC first, so using it here would return 0 a
   * second time and fix nothing. Such a pair is a genuine identity collision
   * and Task 6's `duplicates` class is where a user gets told about it; this
   * only guarantees that both machines report it in the same order.
   */
  return {
    notes: [...notes].sort(
      (a, b) =>
        compareCanonical(a.vaultPath, b.vaultPath) ||
        compareRawBytes(a.absolutePath, b.absolutePath),
    ),
    unclassifiedFolders: sortedUnique(unclassified),
    symlinkedFolders: sortedUnique(symlinked),
  };
}
