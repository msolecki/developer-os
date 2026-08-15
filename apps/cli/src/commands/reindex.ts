import { join } from "node:path";

import { foldPath, hashBytes, validateChangePlan } from "@developer-os/core";
import type {
  DeveloperOsConfigV1,
  InstallationManifestV1,
  ManagedArtifactV1,
  PlannedFileMutation,
} from "@developer-os/core";
import { resolveBrainConfig } from "@developer-os/brain";
import type {
  BrainServiceDependencies,
  DirectoryEntry,
} from "@developer-os/brain";

import { resolveContainedRoot } from "../context.js";
import type { CliContext } from "../context.js";

/**
 * Writing Brain's four generated index artifacts, for the two commands that do
 * it: `developer-os brain reindex` and the third transaction of
 * `developer-os ingest`.
 *
 * **It exists because this logic must not exist twice.** It was `brain.ts`'s
 * private `stageArtifacts`/`recordArtifacts`/`dependenciesFor`, and `ingest`
 * arrived needing the identical sequence; the copy that briefly lived there was
 * the manifest-reconciliation code whose own docblock below enumerates three
 * ordinary sequences that permanently wedged the command. Two copies of a
 * recovery path drift, and a drifted copy is a wedge neither command's tests can
 * see. Every reason recorded here was moved from `brain.ts` rather than
 * paraphrased, and this is now the only place any of it lives.
 *
 * What the callers keep is what genuinely differs: their transaction kind and
 * their own refusal class.
 */

const EMPTY_MANIFEST: InstallationManifestV1 = {
  schemaVersion: 1,
  productVersion: "0.0.0",
  installedAt: "1970-01-01T00:00:00.000Z",
  artifacts: [],
};

/**
 * Notes are read through the protected-path policy, not through the raw
 * filesystem. They are user files in a user-writable tree, and `readText` is
 * the channel that opens with `O_NOFOLLOW` and re-checks `dev`/`ino` after
 * open — the same guard configuration gets.
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
    assertReadable: async (path: string): Promise<void> => {
      await context.guards.manifest.assertReadable(path);
    },
    now: context.now,
  };
}

export interface IndexWriteRequest {
  readonly vaultRoot: string;
  /**
   * Vault-relative — `content` under a default configuration, which is
   * `brainConfig.contentRoot`. This, not `vaultRoot`, is what
   * `writeIndexArtifacts` anchors its containment check on: `vaultRoot` is the
   * brain root, and a user whose `brainPath` names a directory whose `content`
   * is a symlink to an existing vault elsewhere — an external volume, a
   * pre-existing Obsidian vault — has that layout refused as if it were an
   * escape, while `capture`, `ingest`'s quarantine step, `review`, `brain
   * lint` and `brain search` all keep working because they anchor on the
   * content root already. Anchoring here on the content root instead closes
   * NEW-19 identically — a relocated `_indexes` still resolves outside the
   * canonical content root — without that asymmetry.
   */
  readonly contentRoot: string;
  /**
   * Vault-relative — `content/_indexes` under a default configuration, which is
   * `join(brainConfig.contentRoot, brainConfig.indexesDir)`.
   */
  readonly indexesDir: string;
  /** `BrainArtifacts.files`: vault-relative path to bytes, as text. */
  readonly files: Readonly<Record<string, string>>;
  /**
   * The transaction kind, which is the caller's and not this module's.
   * `brain reindex` journals `brain-reindex`; ingest's third transaction
   * journals `ingest-reindex`, because that is what makes its four-transaction
   * ladder visible in the journals `repair` and `status` read. One shared kind
   * would erase a distinction those commands report on.
   */
  readonly kind: string;
  /**
   * How this caller reports a validated plan that lost its staged content —
   * an internal invariant failure, not a security refusal, and never to be
   * confused with `refuseIndexEscape` below. Injected because each command
   * raises its own refusal class carrying its own exit code and recovery
   * text, and a shared module inventing a third would throw both commands an
   * error neither one's catch clause recognises.
   */
  readonly refuse: (message: string, paths: readonly string[]) => Error;
  /**
   * How this caller reports the index directory resolving outside the
   * content root (NEW-19) — a containment escape, which both callers must
   * raise as their own `EXIT_CODES.securityRefusal` refusal class carrying
   * recovery text, in the style their quarantine call sites already use
   * (`ingest.ts`, `review.ts`, `capture.ts`). This used to be conflated with
   * `refuse` above, which both callers construct at
   * `EXIT_CODES.operationalFailure` with no recovery text — reporting the
   * same class of escape the three quarantine call sites raise at exit 5 as
   * an ordinary operational failure at exit 1 instead — a class `doctor`'s
   * `EXIT_PRECEDENCE` ranks below a security refusal.
   */
  readonly refuseIndexEscape: (
    message: string,
    paths: readonly string[],
  ) => Error;
}

/**
 * The two-step shape `init` uses: validate ownership, then execute. The index
 * directory is the only root this command may write to, and the product home is
 * excluded as the other ownership universe — a symlink inside one resolving
 * into the other is what the exclusion refuses.
 *
 * `ownedIndexRoot` is `writeIndexArtifacts`'s already-proven root, not rebuilt
 * here: whether the index directory exists yet is an ordering decision that
 * belongs to the caller, not to this function — and not, either way, something
 * canonicalization needs settled first. `canonicalizePlannedPath` walks up to
 * the nearest existing ancestor (`packages/security/src/paths.ts:53-73`), so it
 * resolves a not-yet-created path exactly as well as an existing one.
 */
async function stageArtifacts(
  context: CliContext,
  request: IndexWriteRequest,
  ownedIndexRoot: string,
): Promise<{
  readonly mutations: readonly PlannedFileMutation[];
  readonly artifacts: readonly ManagedArtifactV1[];
}> {
  const { files, vaultRoot } = request;
  const encoder = new TextEncoder();
  const verifiedAt = context.now().toISOString();

  const planned = await Promise.all(
    Object.entries(files).map(async ([vaultPath, text]) => {
      /**
       * Canonical, once, and everything downstream keys off it.
       *
       * `recordArtifacts` stores `canonicalTargetPath`, so a reconciliation
       * that looked up the *declared* path missed every record whenever an
       * ancestor of the vault is a symlink — `/tmp`, `~/Dropbox`, `/Volumes`,
       * or a hand-set `brainPath`. It then adopted a second entry for the same
       * file, and `validateManifest` accepted it because it dedupes on the
       * literal string while `validateChangePlan` dedupes on the canonical one.
       * The corrupt manifest reached disk, and from then on both `reindex` and
       * `init` threw `ManifestStateError` with no way out but `uninstall`.
       */
      const targetPath = await context.guards.canonicalize(
        join(vaultRoot, vaultPath),
      );
      let onDisk: string | null = null;
      try {
        onDisk = hashBytes(
          encoder.encode(await context.guards.readText(targetPath)),
        );
      } catch {
        onDisk = null;
      }
      return {
        vaultPath,
        targetPath,
        content: encoder.encode(text),
        onDisk,
      };
    }),
  );

  /**
   * Reconcile the manifest with the disk *before* planning anything.
   *
   * `validateChangePlan` decides ownership from the manifest and
   * `TransactionExecutor` decides feasibility from the disk, and reindex is the
   * one command where those two routinely disagree through no fault of the
   * user. Three ordinary sequences produced a permanently wedged command:
   * deleting `_indexes/` to start fresh left the manifest claiming files that
   * are gone, so every later run planned a `replace` the executor refused; a
   * crash between the transaction and the recording left files nobody owned, so
   * every later run planned a `create` the executor refused; and
   * `uninstall` → `init` → `reindex` produced the second of those, because
   * uninstall deletes the manifest and deliberately preserves the vault.
   *
   * Both reconciliations move the manifest *towards* what is on disk, so a
   * crash part-way through leaves it more accurate than it was, not less.
   */
  const existing = (await context.manifests.readOptional()) ?? {
    ...EMPTY_MANIFEST,
    productVersion: context.productVersion,
    installedAt: verifiedAt,
  };
  const recorded = new Map(
    existing.artifacts.map((artifact) => [foldPath(artifact.path), artifact]),
  );

  const adopted: ManagedArtifactV1[] = [];
  const forgotten = new Set<string>();
  for (const entry of planned) {
    const key = foldPath(entry.targetPath);
    const managed = recorded.get(key);
    if (entry.onDisk !== null && managed === undefined) {
      adopted.push({
        owner: "core",
        path: entry.targetPath,
        kind: "file",
        productVersion: context.productVersion,
        /**
         * `false`, and that is the honest value rather than a convenient one.
         * The manifest ties `existedBefore` to a backup it can restore — the
         * validator refuses `true` without a `backupRelativePath` — and
         * adoption takes no backup, because these four files are generated and
         * there is no prior version worth restoring. `uninstall` preserves them
         * by location regardless of what this says.
         */
        existedBefore: false,
        beforeHash: null,
        backupRelativePath: null,
        installedHash: entry.onDisk,
        source: entry.vaultPath,
        mergeStrategy: "dedicated",
        verifiedAt,
      });
    }
    if (entry.onDisk === null && managed !== undefined) forgotten.add(key);
  }

  /**
   * Reconciled in memory and never written here. `validateChangePlan` takes the
   * manifest as an argument, so adoption only has to exist for the length of
   * this call — and a staging step that persisted it would leave adopted vault
   * artifacts recorded in a real installation's manifest even when the plan was
   * then refused. `recordArtifacts` writes the real state after the transaction
   * succeeds, and because it replaces every entry for the paths it wrote, the
   * forgotten ones are dropped there too.
   */
  const manifest: InstallationManifestV1 = {
    ...existing,
    artifacts: [
      ...existing.artifacts.filter(
        (artifact) => !forgotten.has(foldPath(artifact.path)),
      ),
      ...adopted,
    ],
  };
  const owned = new Map(
    manifest.artifacts.map((artifact) => [foldPath(artifact.path), artifact]),
  );

  const operations = planned.map((entry) => {
    const managed = owned.get(foldPath(entry.targetPath));
    return {
      ...entry,
      /**
       * From the disk, because the executor checks the disk. The manifest now
       * agrees with it after the reconciliation above, so the two cannot part
       * company here.
       */
      operation: entry.onDisk === null ? ("create" as const) : ("replace" as const),
      owner: "core" as const,
      kind: "file" as const,
      /**
       * The manifest's hash, which is what `validateChangePlan` compares
       * against — itself. That check is therefore not what stops a hand-edited
       * artifact being overwritten, and nothing here is: these four files are
       * generated, regenerating them is the whole point of the command, and
       * `brain lint`'s `index-drift` class is where a user is told they had
       * diverged.
       */
      expectedBeforeHash: managed?.installedHash ?? null,
      mergeStrategy: "dedicated" as const,
      proposedHash: hashBytes(entry.content),
    };
  });

  const validated = await validateChangePlan(
    {
      schemaVersion: 1,
      productVersion: context.productVersion,
      /** The plan carries hashes; the bytes travel separately to the executor. */
      operations: operations.map((operation) => ({
        targetPath: operation.targetPath,
        operation: operation.operation,
        owner: operation.owner,
        kind: operation.kind,
        expectedBeforeHash: operation.expectedBeforeHash,
        source: operation.vaultPath,
        mergeStrategy: operation.mergeStrategy,
        proposedHash: operation.proposedHash,
      })),
    },
    {
      manifest,
      /**
       * Narrower than it needs to be today, deliberately. Every path either
       * caller plans is inside the index directory by construction, so widening
       * this root to the whole vault changes no observable behaviour and no test
       * can tell the difference. It is here to constrain the *next* thing that
       * writes through this function.
       *
       * `ownedIndexRoot` rather than `join(vaultRoot, indexesDir)`: the root is
       * now *proven* to resolve inside the content root (NEW-19) instead of
       * merely constructed, and this is the value `resolveContainedRoot`
       * returned — building the join a second time here would be a second
       * spelling of one path that could disagree with the proven one.
       */
      ownedRoots: [ownedIndexRoot],
      excludedRoots: [context.paths.home],
      canonicalize: context.guards.canonicalize,
    },
  );

  const contentByPath = new Map(
    operations.map((operation) => [operation.targetPath, operation]),
  );

  const mutations: PlannedFileMutation[] = [];
  const artifacts: ManagedArtifactV1[] = [];

  for (const operation of validated.operations) {
    const staged = contentByPath.get(operation.targetPath);
    if (staged === undefined) {
      throw request.refuse("the validated change plan lost its staged content", [
        operation.canonicalTargetPath,
      ]);
    }
    mutations.push({
      targetPath: operation.canonicalTargetPath,
      operation: operation.operation === "remove" ? "replace" : operation.operation,
      content: staged.content,
    });
    artifacts.push({
      owner: "core",
      path: operation.canonicalTargetPath,
      kind: "file",
      productVersion: context.productVersion,
      /** As above: no backup is taken for a generated artifact. */
      existedBefore: false,
      beforeHash: null,
      backupRelativePath: null,
      installedHash: operation.proposedHash ?? hashBytes(staged.content),
      source: operation.source,
      mergeStrategy: "dedicated",
      verifiedAt,
    });
  }

  return { mutations, artifacts };
}

/**
 * Records what was written, because ownership lives in the manifest: a second
 * reindex is a `replace`, and `validateChangePlan` refuses to replace an
 * artifact nobody owns. Recording them is also safe for `uninstall`, which
 * partitions artifacts by *location* before it plans anything and preserves
 * everything under the Brain path whatever the manifest says.
 */
async function recordArtifacts(
  context: CliContext,
  artifacts: readonly ManagedArtifactV1[],
): Promise<void> {
  const manifest = (await context.manifests.readOptional()) ?? {
    ...EMPTY_MANIFEST,
    productVersion: context.productVersion,
    installedAt: context.now().toISOString(),
  };

  const written = new Set(artifacts.map((artifact) => foldPath(artifact.path)));
  await context.manifests.write({
    ...manifest,
    artifacts: [
      ...manifest.artifacts.filter(
        (artifact) => !written.has(foldPath(artifact.path)),
      ),
      ...artifacts,
    ],
  });
}

/**
 * The whole write: make the directory, validate ownership, execute, record.
 * Returns the transaction id, which is the only part of the outcome either
 * caller reports.
 *
 * `BrainService.reindex()` produces the bytes and **cannot write** — the absence
 * of a write channel on that class is the design — so both callers hand their
 * bytes here rather than to a filesystem.
 */
export async function writeIndexArtifacts(
  context: CliContext,
  request: IndexWriteRequest,
): Promise<string> {
  /**
   * The transaction stages into a temporary file beside its target, so the
   * directory has to exist first — the same reason `init` creates directories
   * before it executes. It is normally there from `init`'s template; this is
   * the path that matters when a user deleted it to start fresh.
   *
   * Not recorded as a managed artifact: `uninstall` preserves anything under
   * the vault by location, so recording a directory it will never remove buys
   * nothing and puts a user-visible folder into the drift report.
   */
  const indexDirectory = join(request.vaultRoot, request.indexesDir);
  /**
   * Through the same guard `init` applies before every directory it creates.
   * The path comes from a config-supplied `brainPath`, and `assertWritable` is
   * what refuses one that lands under `~/.ssh`, `~/.aws` or a `.env` segment.
   *
   * Defence in depth, and unreachable today: discovery's own `assertReadable`
   * refuses a protected vault before this line runs, so no test can show this
   * check firing. Kept because that ordering is a property of the current call
   * path, not a guarantee.
   */
  await context.guards.transaction.assertTarget(indexDirectory);
  await context.fs.mkdir(indexDirectory, { recursive: true, mode: 0o700 });

  /**
   * Proven rather than constructed (NEW-19): a `content/_indexes` replaced by a
   * symbolic link built `ownedRoots` from the same textual join
   * `resolveQuarantineRoot` used to, so a sideways relocation carried its own
   * containment check along with it and `validateChangePlan` never saw it move.
   * `resolveContainedRoot` canonicalizes both sides and asks whether the result
   * still resolves inside the content root, which a relocation cannot satisfy
   * by construction.
   *
   * Anchored on the content root, not `vaultRoot`. `vaultRoot` is the brain
   * root, and anchoring there refused a real, non-hostile layout: a
   * `brainPath` whose `content` is a symlink to an existing vault elsewhere —
   * an external volume, a pre-existing Obsidian vault — resolves the index
   * directory outside `vaultRoot` by construction even though nothing here is
   * an attack. `capture`, `ingest`'s quarantine step, `review`, `brain lint`
   * and `brain search` already anchor on the content root and canonicalize
   * both sides, so this brings `reindex` in line with them rather than making
   * it the one command that treats that layout as an escape.
   *
   * Placed after `mkdir`, matching where `init` creates a directory before
   * validating it — not because canonicalization needs the directory to exist.
   * `canonicalizePlannedPath` walks up to the nearest existing ancestor
   * (`packages/security/src/paths.ts:53-73`), so this check would resolve
   * exactly as correctly if it ran before `mkdir`.
   */
  const contentRoot = join(request.vaultRoot, request.contentRoot);
  const ownedIndexRoot = await resolveContainedRoot(
    context,
    contentRoot,
    indexDirectory,
    "the index directory resolves outside the content root",
    request.refuseIndexEscape,
  );

  const staged = await stageArtifacts(context, request, ownedIndexRoot);
  const journal = await context.executor.execute({
    kind: request.kind,
    mutations: staged.mutations,
  });
  await recordArtifacts(context, staged.artifacts);
  return journal.id;
}
