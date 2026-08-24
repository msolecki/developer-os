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
 * Excluded at *every* depth, per Brain architecture former §5 — not only directly under
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
 * Brain architecture former §5 excludes any segment beginning with `.`, file or not.
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
 * Brain architecture former §5: every path is resolved through Foundation's canonicalization, so a
 * link out of the vault is refused rather than followed. Returns nothing —
 * clearing an in-vault link does not make it followable, and every caller
 * skips the entry either way.
 *
 * **Two roots, because the content root is no longer required to sit inside the vault
 * root** (BACKLOG NEW-22). A user may symlink `content` at an Obsidian vault they already
 * have; after that the vault root holds the configuration and the indexes while every
 * note lives under the content root, and neither contains the other. An entry is refused
 * when it escapes **both**, which keeps accepting the in-vault link to a sibling such as
 * `_indexes` that worked before.
 *
 * **What the union does not weaken, stated precisely because the obvious claim is wrong.**
 * It would be tempting to say this preserves "another vault's notes cannot be indexed as
 * this vault's own" — it does not, and that guarantee is *deliberately spent* for the
 * content root, which is the whole of NEW-22. For **entries** the guarantee never came
 * from containment at all: every caller skips a symbolic link whether the check passed or
 * not, so the check only chooses refuse-versus-skip. **Widening the roots therefore cannot
 * cause anything to be indexed that was not indexed before** — it converts a hard refusal
 * into a silent skip, and nothing more.
 *
 * **One shape makes this vacuous and is worth knowing:** the union is only as tight as its
 * loosest member, so the guard weakens as the content root sits higher in the tree,
 * whatever it sits above — a `content` symlinked at `/` makes every path contained and
 * the check refuses nothing for the rest of the run. Nothing is indexed through it, for
 * the reason above, so the consequence is a
 * disabled refusal rather than a leak. Refusing a content root that contains the vault
 * root would close it; no test covers it today.
 */
async function refuseEscapingLink(
  absolutePath: string,
  vaultPath: string,
  permittedRoots: readonly string[],
  canonicalize: (path: string) => Promise<string>,
): Promise<void> {
  const target = await canonicalize(absolutePath);
  if (!permittedRoots.some((root) => containsPath(root, target))) {
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
  readonly permittedRoots: readonly string[];
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
        context.permittedRoots,
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
   * **The content root is canonicalized into an anchor rather than measured against one**
   * (BACKLOG NEW-22). It used to be passed to `refuseEscapingLink` like any entry, which
   * refused **every** content root reached through a link and not only one that escapes —
   * so a user who symlinked `content` at an existing Obsidian vault could not run
   * `brain reindex` or `ingest` at all, and the refusal named a path they had
   * deliberately created.
   *
   * **Resolving it before any read is the half of the old check that survives**, and the
   * honest statement of it is narrow: a symlinked `content` is never reported by
   * `readdir` — the walk starts inside it — so without resolving first, nothing below
   * would ever learn where the root points. It is **not** that another vault is no longer
   * enumerated: it is enumerated in full and indexed as this vault's own, which is the
   * decision. What resolving buys is that every symbolic link *beneath* it can be
   * measured against a root that is known. Regular files and directories are asked no
   * containment question at all — `refuseEscapingLink`'s own docblock says which entries
   * are checked and what that does and does not guarantee.
   *
   * **The walk still reads the declared path, and that is deliberate — the plan said to
   * walk the canonical one and it was wrong.** Canonicalizing the *anchor* is what NEW-22
   * needs; canonicalizing every path the walk touches changes what `reader.readDir` and
   * `assertReadable` receive for **every** vault, symlinked or not, because on macOS a
   * `/var/…` root realpaths to `/private/var/…`.
   *
   * **The cost is not the artifact — `absolutePath` is never serialized.** It lives on the
   * internal parsed entry as the raw-byte tie-break for ordering, and `IndexedNote`, which
   * is what `serializeIndex` writes, does not carry it. The cost is the **identity**: a
   * note's `absolutePath` is `vaultRoot` joined with its `vaultPath`, up to normalization,
   * and the ingest gate relies on it — `validateProposal` keys its virtual overlay on
   * `join(vaultRoot, contentRoot, note.path)` and looks entries up by discovery's
   * `absolutePath`. Walk the canonical path and every proposed note misses its own overlay
   * entry, so the gate validates against the wrong bytes. `capture` settled the same
   * principle one command over, reporting the configured path rather than the one a
   * symlinked content root resolves to.
   *
   * Reading the declared path follows the link exactly as before; only the containment
   * question is asked against the resolved root.
   */
  const contentRootCanonical = await canonicalize(contentDir);

  /**
   * Both roots, because neither **need** contain the other — not because neither does.
   * A `content` symlinked *inside* the brain, which `capture`'s own suite builds, leaves
   * the content root strictly within the vault root and the union collapses to one; the
   * relocated-vault case is the one where they are disjoint. An entry is refused only
   * when it escapes both, and the compatibility that preserves is the in-vault link to a
   * sibling such as `_indexes`, which was accepted-and-skipped before this change and
   * still is.
   */
  const permittedRoots = [contentRootCanonical, vaultRootCanonical];

  const context: WalkContext = { request, permittedRoots, canonicalize };
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
        permittedRoots,
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
