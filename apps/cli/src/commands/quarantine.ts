import { createHmac } from "node:crypto";
import { dirname, join } from "node:path";

import { hashBytes, validateChangePlan } from "@developer-os/core";
import type {
  DeveloperOsConfigV1,
  InstallationManifestV1,
  RuntimePaths,
} from "@developer-os/core";
import { parseCaptureFile, resolveBrainConfig } from "@developer-os/brain";
import type { CaptureNoteTargetV1, CaptureStatus } from "@developer-os/brain";
import type { Redactor } from "@developer-os/security";

import { resolveContainedRoot } from "../context.js";
import type { CliContext } from "../context.js";
import { readAdmittedManifest } from "./doctor.js";
import { isMissingEntry } from "../config-file.js";

/**
 * The quarantine seam `capture` and `import` share (spec §5.3, §5.4): root
 * proof, duplicate probe, guarded quarantine write and directory fingerprint.
 * Extracted from `capture` rather than copied, so the two entrances into
 * quarantine cannot drift apart.
 */

/** Vault-relative, under the configured content root. Spec §3.4. */
export const QUARANTINE_SEGMENTS = ["_raw", "quarantine"] as const;

/** The inbox `import` drains by default, beside quarantine. Spec §5.1. */
export const INBOX_SEGMENTS = ["_raw", "inbox"] as const;

/** The width every other 64-bit identifier in this subsystem already uses. */
const FINGERPRINT_LENGTH = 16;

/** The stand-in `validateChangePlan` gets when no manifest exists yet. */
export const EMPTY_MANIFEST: InstallationManifestV1 = {
  schemaVersion: 1,
  productVersion: "0.0.0",
  installedAt: "1970-01-01T00:00:00.000Z",
  artifacts: [],
};

/**
 * A fingerprint, never a path. The working directory can name a client, a
 * repository, and the user's own home; what a later reader needs is only
 * whether two captures came from the same place, which 64 bits of keyed hash
 * answers without disclosing where that place is.
 */
export function fingerprintDirectory(canonical: string, key: Uint8Array): string {
  return createHmac("sha256", key)
    .update(canonical, "utf8")
    .digest("hex")
    .slice(0, FINGERPRINT_LENGTH);
}

export interface QuarantineRoots {
  readonly contentRoot: string;
  /** The declared path: the public result and `validateChangePlan`'s owned root. */
  readonly quarantine: string;
  /** The form the containment proof held for: every read and write goes here. */
  readonly canonicalQuarantine: string;
}

/**
 * Proves the quarantine directory lies inside the configured content root, and
 * refuses through `refuse` when it does not. Each caller keeps its own refusal
 * class and recovery text.
 */
export async function resolveQuarantine(
  context: CliContext,
  config: DeveloperOsConfigV1,
  paths: RuntimePaths,
  refuse: (message: string, paths: readonly string[]) => Error,
): Promise<QuarantineRoots> {
  const contentRoot = join(paths.brain, resolveBrainConfig(config).contentRoot);
  const quarantine = join(contentRoot, ...QUARANTINE_SEGMENTS);
  /**
   * **Both forms are returned, and each has one job.** The canonical form is
   * the one the proof below held for, so every read, `mkdir` and write goes
   * through it (BACKLOG NEW-20): re-resolving the declared path afterwards
   * reopens the window in which an ancestor symlink is retargeted between the
   * proof and the write. The declared form is kept for two reasons that both
   * bite:
   *
   * - `validateChangePlan` canonicalizes the owned root it is given, and
   *   `assertUsableRoots` refuses a root that resolved to an **ancestor** of
   *   what was declared (`packages/core/src/plans/validate.ts:200-205`). That
   *   test compares the canonical form against the declared one, so handing it
   *   a path already canonicalized makes it compare a string with itself and it
   *   can never fire. `containsPath` here cannot stand in for it: it is
   *   same-or-descendant (`packages/core/src/manifest/store.ts:113`), so a
   *   quarantine pointing at the content root passes the containment question
   *   and is caught only by the ownership one.
   * - `CaptureResultV1.path` is a contract, printed and published in `--json`.
   *   On a vault reached through a symlink the canonical form names a location
   *   the user never configured.
   *
   * Handing `validateChangePlan` the declared root beside a canonical target
   * also makes a retarget in that window fail closed: the root re-resolves to
   * the new location, the target does not, and the plan is refused as
   * `outside_owned_roots`.
   */
  const canonicalQuarantine = await resolveContainedRoot(
    context,
    contentRoot,
    quarantine,
    "the quarantine directory resolves outside the content root",
    refuse,
  );
  return { contentRoot, quarantine, canonicalQuarantine };
}

export interface ExistingCapture {
  /**
   * Whether the file read back as a capture *of this id*. `parseCaptureFile`
   * is given the file name, and refuses a frontmatter `captureId` that does
   * not match it, so `parsed` already carries the id comparison the recovery
   * path in `runCapture` needs — it never has to re-derive one.
   */
  readonly parsed: boolean;
  readonly status: CaptureStatus;
  /** The stored envelope's note target, so a duplicate reports the file's, not this run's. */
  readonly note: CaptureNoteTargetV1 | null;
  readonly warning: string | null;
  /**
   * The file's bytes, verbatim. The recovery path in `runCapture` compares
   * them against what this run rendered, which is the one question that
   * separates "another process wrote this" from "this process wrote it and
   * then failed".
   */
  readonly contents: string;
}

/**
 * The capture already at this path, or `null` when there is none.
 *
 * **A duplicate exits 0 and names the existing capture, whatever its status**
 * (spec §5.2): re-capturing something already rejected does not resurrect it,
 * and re-capturing something already ingested writes nothing and says where it
 * went. That is why the file is parsed rather than merely counted — the status
 * is the answer the user needs.
 *
 * A file that is here and is not a capture reports `failed`, which is exactly
 * what that status means (spec §5.5): a capture whose own envelope is
 * unreadable — a truncated write, or a hand edit that broke the frontmatter.
 * That is a status like any other, so §5.2's "exit 0, whatever its status"
 * still governs; the reason travels as a warning, because a user who has a
 * broken file under this id needs to be told which file and why, and a second
 * copy of the same observation is not something this command can write.
 *
 * Read through the protected-path policy, never a bare `readFile`: this is a
 * user file in a user-writable tree, and `readText` is the channel that opens
 * with `O_NOFOLLOW` and re-checks `dev`/`ino` after open.
 */
export async function readExistingCapture(
  context: CliContext,
  target: string,
  fileName: string,
  redact: Redactor,
): Promise<ExistingCapture | null> {
  try {
    await context.fs.lstat(target);
  } catch (error) {
    if (isMissingEntry(error)) return null;
    throw error;
  }

  const text = await context.guards.readText(target);
  const outcome = parseCaptureFile(fileName, text, redact);

  return outcome.ok
    ? {
        parsed: true,
        status: outcome.envelope.status,
        note: outcome.envelope.note,
        warning: null,
        contents: text,
      }
    : {
        parsed: false,
        status: "failed",
        note: null,
        warning: `the capture already at this path could not be read (${outcome.reason})`,
        contents: text,
      };
}

/**
 * `readExistingCapture` on the recovery path, where a second failure must never
 * replace the first. A read that itself refuses — a symlink now at the target,
 * a vanished directory — answers "no capture here", which rethrows the original
 * error rather than this one.
 */
export async function readCaptureQuietly(
  context: CliContext,
  target: string,
  fileName: string,
  redact: Redactor,
): Promise<ExistingCapture | null> {
  try {
    return await readExistingCapture(context, target, fileName, redact);
  } catch {
    return null;
  }
}

/**
 * One `create` mutation, through Foundation's `TransactionExecutor`. A capture
 * is not a special case that may append directly, which is what makes "atomic
 * quarantine writes" true rather than aspirational.
 *
 * **What this does and does not give you, because spec §5.2 asks for more than
 * a transaction-mediated create can provide.** §5.2 wants a duplicate to be an
 * `O_EXCL` create that fails. It is not one, and saying otherwise here would be
 * the more dangerous of the two mistakes:
 *
 * - `TransactionExecutor.execute` **snapshots** each target and refuses a
 *   `create` whose target exists (`executor.ts:199-204`). A snapshot is a
 *   `stat`, not an exclusive create.
 * - The transaction lock is taken on a per-execution `generateId()`
 *   (`store.ts:195-207`), so two concurrent captures hold two different locks
 *   and exclude each other from nothing.
 * - `writeDurableFile` ends in an unconditional `rename` (`executor.ts:113-135`),
 *   which replaces rather than refuses.
 *
 * A genuine `O_EXCL` create of the final target is not available from here: it
 * would make the target exist, which the executor's own `create` precondition
 * then refuses, and writing through that handle instead would bypass the
 * transaction model outright. A separate lock file in the vault is the second
 * mechanism the plan warned against, and lock lifecycle is Foundation's design
 * rather than this command's.
 *
 * **What is left is a narrow window, and it is tolerable here for a reason
 * specific to captures — but it is not free, and what it costs is worth saying
 * exactly.** The plan-time snapshot and the apply-time re-check (which raises
 * `TransactionConflictError` on any hash change) leave a window in which two
 * processes can both decide the target is absent.
 *
 * `captureId` is the first 16 hex of `sha256` over the *redacted, normalized
 * content* and nothing else (`build.ts:176,209`), so two captures can only ever
 * collide when their **observations** are byte-identical: the losing write
 * replaces a file holding the same text. That much is idempotent — no
 * observation is lost and no vault state is corrupted.
 *
 * **The provenance is not.** The id hashes content alone, so the two runs need
 * not agree on anything else: the same text captured from two working
 * directories, or under two agents, is one id. The loser forfeits its
 * `createdAt`, `projectSlug`, `workingDirectoryFingerprint`, `sourceAgent` and
 * `sourceAgentVersion` to the winner's, and nothing records that a second run
 * happened. That is the accepted cost, and it is bounded to metadata about a
 * duplicate observation.
 *
 * The same window would be unacceptable for `review` or `ingest`, which write
 * *different* content to a shared path, and it is acceptable for this one.
 *
 * `readExistingCapture` is how a duplicate is *reported* at exit 0, and
 * `runCapture` re-reads it if this call fails, so the loser of a race still
 * reports the duplicate rather than an error nobody can act on.
 *
 * **Nothing is recorded in `installation-manifest.json`.** A capture is the
 * user's own content, editable in Obsidian by design (spec §3.4) — recording it
 * as a managed artifact would report every legitimate edit as drift, and would
 * make the next capture of the same text a refused `create` over an artifact
 * the product claims to own.
 */
export async function writeQuarantineCapture(
  context: CliContext,
  paths: RuntimePaths,
  quarantine: string,
  target: string,
  contents: string,
  kind: "capture" | "import",
): Promise<string> {
  /**
   * The transaction stages beside its target, so the directory has to exist
   * first — the same reason `init` and `brain reindex` create theirs before
   * executing. It is normally there from `init`'s template; this is the path
   * that matters when a user deleted it. Guarded first, because the vault root
   * comes from a config-supplied `brainPath`. The target's own directory, not
   * `quarantine`: a caller holding the canonical target must not have it
   * re-resolved through the declared root here.
   */
  const directory = dirname(target);
  await context.guards.transaction.assertTarget(directory);
  await context.fs.mkdir(directory, { recursive: true, mode: 0o700 });

  const content = new TextEncoder().encode(contents);
  const manifest = (await readAdmittedManifest(context, paths)) ?? EMPTY_MANIFEST;
  const validated = await validateChangePlan(
    {
      schemaVersion: 1,
      productVersion: context.productVersion,
      operations: [
        {
          targetPath: target,
          operation: "create",
          owner: "core",
          kind: "file",
          expectedBeforeHash: null,
          source: kind,
          mergeStrategy: "dedicated",
          proposedHash: hashBytes(content),
        },
      ],
    },
    {
      /**
       * Quarantine alone, with the product home excluded as the other
       * ownership universe: a symlink inside one resolving into the other is
       * what the exclusion refuses.
       */
      manifest,
      ownedRoots: [quarantine],
      excludedRoots: [paths.home],
      canonicalize: context.guards.canonicalize,
    },
  );

  const operation = validated.operations[0];
  if (operation === undefined) {
    throw new Error("the validated change plan lost its only operation");
  }

  const journal = await context.executor.execute({
    kind,
    mutations: [
      {
        targetPath: operation.canonicalTargetPath,
        operation: "create",
        content,
      },
    ],
  });
  return journal.id;
}
