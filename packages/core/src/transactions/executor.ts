import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

import { EXIT_CODES } from "../result.js";
import { TransactionStateError, TransactionStore } from "./store.js";
import type {
  FileMutation,
  TransactionExecutorDependencies,
  TransactionFileSystem,
  TransactionJournalV1,
  TransactionPhase,
  TransactionPlan,
} from "./types.js";

interface ExistingSnapshot {
  readonly bytes: Uint8Array;
  readonly mode: number;
  readonly atimeMs: number;
  readonly mtimeMs: number;
}

interface BackupMetadata {
  readonly existed: boolean;
  readonly mode: number | null;
  readonly atimeMs: number | null;
  readonly mtimeMs: number | null;
}

export class TransactionPlanError extends Error {
  readonly code = EXIT_CODES.invalidInput;

  constructor() {
    super("transaction plan is invalid");
    this.name = "TransactionPlanError";
  }
}

/**
 * **The transaction completed and a backup payload could not be removed.** Distinct from
 * `TransactionStateError`, whose message — "transaction state is malformed or incomplete" —
 * describes something that is not true here: the journal is terminal, the user's file is
 * correct, and the only thing wrong is that bytes this product promised to delete are still
 * on disk.
 *
 * **The outcome is a parameter, because two of the three raising sites are on the rollback
 * path.** The message was hardcoded to "the change was applied", and `rollbackLocked`
 * raises it twice — where the change was *un*applied and the user's original file restored.
 * A completed rollback was reported as a failure whose text said the opposite of what
 * happened, which is the same defect as raising out of `execute`, relocated rather than
 * removed (found by fresh-context review, 2026-08-17).
 *
 * **It escapes only from `repair`, and that restriction is the point.** Every caller of
 * `execute` — `reindex`, `uninstall`, `ingest`, `review`, `capture`, `init` — is written
 * against "a throw means the transaction did not happen", and `ingest`'s own docblock says
 * so in as many words. This error means the opposite, so raising it out of `execute` made
 * `reindex` skip `recordArtifacts`, `uninstall` skip its manifest removal, and `ingest`
 * report `ok: false` for captures that had all landed — a successful operation reported as
 * a failure, with the command's own bookkeeping half done.
 *
 * **The three raising sites are the two terminal early-returns and the rollback transition
 * — keyed on the prune site, not on the caller.** Saying "`repair`'s paths raise" is the
 * shorter sentence and it is wrong in one direction that matters: `repair --resume <id>` on
 * an *incomplete* journal drives the forward loop, reaches the `verified → finalized` prune,
 * and retains silently like any other command. `doctor` covers that case; the rule does not.
 * On the forward path `pruneBackups` retains, and `doctor`'s transactions check is what
 * makes a retained payload visible.
 *
 * **It is recoverable, but not by retrying alone** — and the first version of `runRepair`'s
 * recovery said otherwise. `pruneBackups` being idempotent means re-running is *safe*, not
 * that it will succeed: the only thing that raises this is an `unlink` failing for a reason
 * other than "already gone", and that reason is still there on the second attempt. The
 * recovery names the precondition first and the command second.
 *
 * **`reason` carries the errno, because the recovery cannot be right for all of them.**
 * `EACCES` on a non-writable directory is the common cause and the one the recovery names,
 * but `EPERM` (a macOS `uchg` flag, or a sticky-bit directory owned by someone else),
 * `EROFS`, `EIO` and `EBUSY` reach the same branch — and for those, "make the backup
 * directory writable" is confidently wrong with nothing to tell the user why. Discarding
 * the code left the message unable to distinguish them at all.
 */
export type TransactionOutcome = "applied" | "rolled back";

export class TransactionBackupRetentionError extends Error {
  readonly code = EXIT_CODES.recoveryRequired;

  /**
   * The directory the payload is in, unredacted, so a caller can publish it in `paths`
   * rather than leaving the only copy inside a message `redactDiagnostic` rewrites.
   */
  readonly directory: string;

  constructor(
    path: string,
    outcome: TransactionOutcome,
    reason: string,
    directory: string,
  ) {
    super(
      `the change was ${outcome}, but a backup payload could not be removed (${reason}): ${path}`,
    );
    this.name = "TransactionBackupRetentionError";
    this.directory = directory;
  }
}

export class TransactionConflictError extends Error {
  readonly code = EXIT_CODES.decisionRequired;

  constructor(message = "transaction target changed unexpectedly") {
    super(message);
    this.name = "TransactionConflictError";
  }
}

export class TransactionGuardError extends Error {
  readonly code:
    | typeof EXIT_CODES.decisionRequired
    | typeof EXIT_CODES.securityRefusal;

  constructor(
    code:
      | typeof EXIT_CODES.decisionRequired
      | typeof EXIT_CODES.securityRefusal,
  ) {
    super("transaction target was refused");
    this.name = "TransactionGuardError";
    this.code = code;
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/**
 * The errno, or a stand-in when there is none.
 *
 * **It is the code and never the message.** An errno is a fixed token — `EACCES`, `EPERM`,
 * `EROFS` — that carries no path, no user string and nothing to redact, which is what makes
 * it safe to put in a diagnostic. `error.message` on the same object embeds the path it
 * failed on, so folding it in would leak the same string twice by a route the caller does
 * not know to redact.
 */
function errnoOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code: unknown }).code;
    if (typeof code === "string" && /^[A-Z]+$/u.test(code)) return code;
  }
  return "unknown error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function syncDirectory(fs: TransactionFileSystem, path: string): Promise<void> {
  const handle = await fs.open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function removeOwnedTemp(
  fs: TransactionFileSystem,
  temporaryPath: string,
): Promise<void> {
  try {
    await fs.unlink(temporaryPath);
  } catch (error) {
    if (!isMissing(error)) throw new TransactionStateError();
  }
}

async function writeDurableFile(
  fs: TransactionFileSystem,
  destination: string,
  temporaryPath: string,
  bytes: Uint8Array,
  mode: number,
): Promise<void> {
  await removeOwnedTemp(fs, temporaryPath);
  const handle = await fs.open(temporaryPath, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporaryPath, destination);
    await syncDirectory(fs, dirname(destination));
  } catch {
    await removeOwnedTemp(fs, temporaryPath);
    throw new TransactionStateError();
  }
}

function metadataBytes(metadata: BackupMetadata): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(metadata)}\n`);
}

function parseMetadata(serialized: string): BackupMetadata {
  try {
    const value = JSON.parse(serialized) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TransactionStateError();
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (
      keys.join(",") !== "atimeMs,existed,mode,mtimeMs" ||
      typeof record.existed !== "boolean"
    ) {
      throw new TransactionStateError();
    }
    if (record.existed) {
      if (
        typeof record.mode !== "number" ||
        typeof record.atimeMs !== "number" ||
        typeof record.mtimeMs !== "number"
      ) {
        throw new TransactionStateError();
      }
    } else if (
      record.mode !== null ||
      record.atimeMs !== null ||
      record.mtimeMs !== null
    ) {
      throw new TransactionStateError();
    }
    return record as unknown as BackupMetadata;
  } catch (error) {
    if (error instanceof TransactionStateError) throw error;
    throw new TransactionStateError();
  }
}

export class TransactionExecutor {
  private readonly dependencies: TransactionExecutorDependencies;
  private readonly store: TransactionStore;

  constructor(dependencies: TransactionExecutorDependencies) {
    this.dependencies = dependencies;
    this.store = new TransactionStore({
      stateDir: dependencies.stateDir,
      fs: dependencies.fs,
      lockProvider: dependencies.lockProvider,
    });
  }

  async execute(plan: TransactionPlan): Promise<TransactionJournalV1> {
    this.validatePlan(plan);
    const id = this.dependencies.generateId();
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new TransactionPlanError();
    return this.store.withTransactionLock(id, async () => {
      await this.ensureTransactionDirectories(id);

      const mutations: FileMutation[] = [];
      for (const [index, planned] of plan.mutations.entries()) {
        await this.assertTarget(planned.targetPath);
        const before = await this.snapshot(planned.targetPath);
        if (planned.operation === "create" ? before !== null : before === null) {
          throw new TransactionPlanError();
        }

        const stagedRelativePath =
          planned.operation === "remove" ? null : `${String(index)}.bin`;
        if (stagedRelativePath !== null) {
          const content = planned.content;
          if (content === null) throw new TransactionPlanError();
          await this.writeStaged(id, stagedRelativePath, content);
        }
        mutations.push({
          targetPath: planned.targetPath,
          operation: planned.operation,
          expectedBeforeHash: before === null ? null : hash(before.bytes),
          stagedRelativePath,
        });
      }

      const createdAt = this.dependencies.clock();
      const journal = await this.store.create({
        schemaVersion: 1,
        id,
        kind: plan.kind,
        phase: "planned",
        createdAt,
        updatedAt: createdAt,
        mutations,
      });
      await this.runHook("planned", journal);
      return this.resume(id);
    });
  }

  async resume(id: string): Promise<TransactionJournalV1> {
    return this.store.withTransactionLock(id, () => this.resumeLocked(id));
  }

  private async resumeLocked(id: string): Promise<TransactionJournalV1> {
    let journal = await this.store.read(id);
    if (journal.phase === "finalized") {
      /**
       * **The crash window, swept on the next resume.** The prune runs after the
       * `finalized` transition, so a process that dies between them leaves a journal
       * reading `finalized` with the payload still on disk — and every recovery path then
       * refuses it: this function used to return here, `rollbackLocked` throws, and
       * `repair` rejected a finalized id before the executor saw it. The bytes were
       * stranded permanently while the product reported success.
       *
       * Pruning here as well makes the operation idempotent and gives that window a way
       * out: `repair --resume <id>` on a finalized transaction now cleans it up instead of
       * being a no-op. Ordering the prune after the transition is still right — the
       * reverse would destroy the only copy while a rollback might need it — but it is
       * only *safe* because of this line.
       */
      await this.pruneBackups(journal, { raiseOnFailure: true });
      return journal;
    }
    if (journal.phase === "rolled_back") throw new TransactionStateError();

    while (journal.phase !== "finalized") {
      switch (journal.phase) {
        case "planned":
          journal = await this.backUp(journal);
          break;
        case "backed_up":
          journal = await this.stage(journal);
          break;
        case "staged":
          journal = await this.validate(journal);
          break;
        case "validated":
          journal = await this.apply(journal);
          break;
        case "applied":
          journal = await this.verifyAndTransition(journal);
          break;
        case "verified":
          await this.verifyDesired(journal);
          journal = await this.transition(journal, "finalized");
          /**
           * **The one prune site a command can reach, so the one that must not raise.**
           * `execute` funnels through here, and its seven call sites — six commands, `ingest`
           * twice — all read a throw as
           * "nothing happened" — which this failure is not. A retained payload is left
           * for `doctor` to report and `repair --resume <id>` to sweep.
           */
          await this.pruneBackups(journal, { raiseOnFailure: false });
          break;
        default:
          throw new TransactionStateError();
      }
    }
    return journal;
  }

  async rollback(id: string): Promise<TransactionJournalV1> {
    return this.store.withTransactionLock(id, () => this.rollbackLocked(id));
  }

  private async rollbackLocked(id: string): Promise<TransactionJournalV1> {
    let journal = await this.store.read(id);
    if (journal.phase === "rolled_back") {
      /**
       * **The mirror of `resumeLocked`'s sweep, and leaving it out was the same defect
       * twice.** A crash between the `rolled_back` transition and the prune strands the
       * payload exactly as the finalized window did, on the flow the product recommends —
       * and it is worse there, because a retried `rollback` returned `rolled_back`
       * *successfully* while doing nothing, so the user is told it failed, runs it again,
       * is told it worked, and the secret is still on disk.
       *
       * **`repair --rollback <id>` is what reaches this**, and it had to be opened for it:
       * the gate in `runRepair` refused a `rolled_back` journal for *both* actions, so this
       * early return was as unreachable from the product as `resumeLocked`'s was before it
       * — the same defect, on the mirror side, found by the same review.
       */
      await this.pruneBackups(journal, { raiseOnFailure: true });
      return journal;
    }
    if (journal.phase === "finalized") throw new TransactionStateError();

    if (
      journal.phase === "validated" ||
      journal.phase === "applied" ||
      journal.phase === "verified"
    ) {
      for (let index = journal.mutations.length - 1; index >= 0; index -= 1) {
        await this.restoreMutation(journal, index);
      }
      await this.verifyOriginal(journal);
    }

    journal = await this.transition(journal, "rolled_back");
    /**
     * **`rolled_back` is as terminal as `finalized`, so the payload is as dead** — and
     * leaving it was the larger half of this defect. `resumeLocked` throws on a rolled-back
     * journal and `store.transition` refuses every transition out of it, so nothing can ever
     * read these bytes again either. (`repair` used to reject the id outright, which is what
     * made the early return above unreachable; it now accepts `--rollback` here.)
     *
     * **And this is the path the product tells the user to take.** `review`'s conflict
     * message says to resolve it with `developer-os repair` first; `doctor` and `init` both
     * print `repair --rollback <id>` verbatim. So the flow was: an `edit` that removes a
     * pasted secret hits a conflict, the product recommends a rollback, the user retries,
     * the product reports the secret removed — and a raw copy of it stayed in the first
     * transaction's backup directory forever.
     *
     * Raising here is unambiguous where raising on the forward path is not: `rollback` has
     * exactly one caller, `recoverTransaction`, and exactly one entry point above it,
     * `repair --rollback`. Nothing downstream of it has bookkeeping left to skip.
     */
    await this.pruneBackups(journal, { raiseOnFailure: true });
    return journal;
  }

  private validatePlan(plan: unknown): void {
    if (
      !isRecord(plan) ||
      !hasExactKeys(plan, ["kind", "mutations"]) ||
      typeof plan.kind !== "string" ||
      plan.kind.length === 0 ||
      !isUnknownArray(plan.mutations) ||
      plan.mutations.length === 0
    ) {
      throw new TransactionPlanError();
    }
    const targets = new Set<string>();
    for (const mutation of plan.mutations) {
      if (
        !isRecord(mutation) ||
        !hasExactKeys(mutation, ["content", "operation", "targetPath"])
      ) {
        throw new TransactionPlanError();
      }
      const operation = mutation.operation;
      const targetPath = mutation.targetPath;
      const content = mutation.content;
      if (
        operation !== "create" &&
        operation !== "replace" &&
        operation !== "remove"
      ) {
        throw new TransactionPlanError();
      }
      const validContent =
        operation === "remove"
          ? content === null
          : content instanceof Uint8Array;
      if (
        typeof targetPath !== "string" ||
        !isAbsolute(targetPath) ||
        targets.has(targetPath) ||
        !validContent
      ) {
        throw new TransactionPlanError();
      }
      targets.add(targetPath);
    }
  }

  private async assertTarget(targetPath: string): Promise<void> {
    try {
      await this.dependencies.guards.assertTarget(targetPath);
    } catch (error) {
      const code =
        isRecord(error) && error.code === EXIT_CODES.decisionRequired
          ? EXIT_CODES.decisionRequired
          : EXIT_CODES.securityRefusal;
      throw new TransactionGuardError(code);
    }
  }

  private async snapshot(targetPath: string): Promise<ExistingSnapshot | null> {
    try {
      const stats = await this.dependencies.fs.stat(targetPath);
      if (!stats.isFile()) throw new TransactionConflictError();
      const bytes = await this.dependencies.fs.readFile(targetPath);
      return {
        bytes,
        mode: stats.mode & 0o777,
        atimeMs: stats.atimeMs,
        mtimeMs: stats.mtimeMs,
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private async ensureTransactionDirectories(id: string): Promise<void> {
    for (const directory of [this.stageDirectory(id), this.backupDirectory(id)]) {
      await this.dependencies.fs.mkdir(directory, { recursive: true, mode: 0o700 });
      try {
        const stats = await this.dependencies.fs.lstat(directory);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw new TransactionStateError();
        }
      } catch (error) {
        if (error instanceof TransactionStateError) throw error;
        throw new TransactionStateError();
      }
      await this.dependencies.fs.chmod(directory, 0o700);
    }
  }

  private stageDirectory(id: string): string {
    return join(this.dependencies.stagingDir, "transactions", id);
  }

  /**
   * **The backup payloads are dead bytes once a transaction reaches a terminal phase, and
   * one of them may be a secret** (BACKLOG, Foundation request 2). Both `finalized` and
   * `rolled_back` are terminal — `store.transition` refuses every transition out of either,
   * `rollbackLocked` throws on a finalized journal and `resumeLocked` on a rolled-back one —
   * so nothing in this product can ever read them again. Called from four sites — the
   * finalize transition, the rollback transition, and each of the two terminal
   * early-returns — and an earlier version of this sentence said three while listing
   * four. Meanwhile
   * `review --decision edit` exists precisely to remove a secret a user pasted into a
   * vault file by hand, and `backUp` wrote that file here raw at mode `0600` before the
   * edit landed. Retaining it undoes the one operation whose purpose is removal.
   *
   * **After the transition, never before.** The reverse order would destroy the only copy
   * of the user's file at exactly the moment a rollback might still need it. A crash
   * between the two leaves the payload on disk with the journal already terminal —
   * **which is not free**: an earlier version of this paragraph said it cost nothing, and
   * it cost the whole defect, permanently, while the product reported success. It is safe
   * only because both terminal early-returns prune as well, so the next `resume` or
   * `rollback` sweeps it, and `repair --resume` can reach a finalized journal to do so.
   *
   * **The payloads only — the `<index>.json` metadata stays.** The secret is in the bytes;
   * the metadata is `{existed, mode, atimeMs, mtimeMs}` and carries none of it. Removing it
   * too breaks a journal that is rewound to an earlier phase and resumed, because the
   * metadata is how `restore` learns whether a target existed at all — and eighteen e2e
   * cases build their fixtures exactly that way. Deleting a description of bytes that are
   * gone buys nothing and costs that.
   *
   * **Derived from the journal rather than enumerated.** `TransactionFileSystem` offers no
   * `readdir`, and it does not need one: `backUp` names every payload `<index>.bin` from
   * `journal.mutations.entries()`, so the journal is the index. A mutation whose target did
   * not exist wrote no payload, which is why a missing file is not an error here.
   *
   * **`<index>.bin.tmp` carries the same bytes and is removed too.** `writeDurableFile`
   * writes the payload to that name and renames it into place, so a kill inside `backUp`
   * leaves the pre-edit file — the secret, in the case this whole change exists for —
   * under a `.tmp` suffix. `removeOwnedTemp` clears it on a `resume` that re-runs `backUp`,
   * but a `rollback` never re-runs that phase, so the route `doctor` and `init` both print
   * orphaned it permanently, and the `.bin`-only sweep could not see it (found by
   * fresh-context review, 2026-08-17).
   *
   * **The directory is left behind, deliberately** — and it is not empty, which an earlier
   * version of this paragraph claimed. The `<index>.json` metadata and its `.sha256` stay
   * by the rule two paragraphs up: thirty files after one `init`, none of them bytes.
   * Removing the directory needs `rmdir` on a frozen interface, and
   * `<state>/transactions/` already accumulates one artifact per transaction id, which is
   * an open founder question in `foundation-constraints.md`; this joins that question
   * rather than answering it unilaterally.
   *
   * **Failure is never swallowed, and on the `repair` paths it is raised** — the paragraph
   * here used to say a blanket catch was fine, and that catch turned `EACCES` on a
   * non-writable backups directory into a silent no-op. `ENOENT` alone is expected.
   *
   * Anything else raises `TransactionBackupRetentionError` when the caller can only be
   * `repair`, and otherwise leaves the payload for `doctor` to report — see that class's
   * docblock for why the forward path cannot raise. Both halves keep the failure visible;
   * only the channel differs, and the one thing neither does is report a clean success.
   */
  private async pruneBackups(
    journal: TransactionJournalV1,
    options: { readonly raiseOnFailure: boolean },
  ): Promise<void> {
    const directory = this.backupDirectory(journal.id);
    let retained: { readonly path: string; readonly reason: string } | null = null;
    for (const [index] of journal.mutations.entries()) {
      for (const suffix of [".bin", ".bin.tmp"]) {
        const payload = join(directory, `${String(index)}${suffix}`);
        try {
          await this.dependencies.fs.unlink(payload);
        } catch (error) {
          /**
           * **`ENOENT` only** — already pruned, or never written because the target did
           * not exist. Everything else is a retained payload: raised where `repair` is the
           * sole caller, and left standing where a command is, because a throw there means
           * "nothing happened" to seven call sites and this failure means the opposite.
           *
           * **The loop does not stop, and it did before.** Throwing on the first failure
           * left payloads 4 and 5 on disk because payload 3 could not be removed — a
           * per-file permission or `EIO` fault turning into a wholesale retention. The
           * first one that survived is the one named; the rest are still attempted, on
           * both the raising and the retaining path.
           */
          if (isMissing(error)) continue;
          retained ??= { path: payload, reason: errnoOf(error) };
        }
      }
    }
    if (retained !== null && options.raiseOnFailure) {
      throw new TransactionBackupRetentionError(
        retained.path,
        journal.phase === "rolled_back" ? "rolled back" : "applied",
        retained.reason,
        directory,
      );
    }
  }

  private backupDirectory(id: string): string {
    return join(this.dependencies.backupsDir, "transactions", id);
  }

  private async writeStaged(
    id: string,
    relativePath: string,
    content: Uint8Array,
  ): Promise<void> {
    const destination = join(this.stageDirectory(id), relativePath);
    await writeDurableFile(
      this.dependencies.fs,
      destination,
      `${destination}.tmp`,
      content,
      0o600,
    );
    const digestPath = `${destination}.sha256`;
    await writeDurableFile(
      this.dependencies.fs,
      digestPath,
      `${digestPath}.tmp`,
      new TextEncoder().encode(`${hash(content)}\n`),
      0o600,
    );
  }

  private async stagedBytes(
    journal: TransactionJournalV1,
    mutation: FileMutation,
  ): Promise<Uint8Array | null> {
    if (mutation.operation === "remove") return null;
    if (mutation.stagedRelativePath === null) throw new TransactionStateError();
    const stagedPath = join(
      this.stageDirectory(journal.id),
      mutation.stagedRelativePath,
    );
    try {
      const [content, persistedDigest] = await Promise.all([
        this.readArtifact(this.stageDirectory(journal.id), stagedPath),
        this.readArtifact(
          this.stageDirectory(journal.id),
          `${stagedPath}.sha256`,
        ),
      ]);
      const serializedDigest = new TextDecoder().decode(persistedDigest);
      if (
        !/^[a-f0-9]{64}\n$/.test(serializedDigest) ||
        serializedDigest !== `${hash(content)}\n`
      ) {
        throw new TransactionStateError();
      }
      return content;
    } catch {
      throw new TransactionStateError();
    }
  }

  private async backUp(journal: TransactionJournalV1): Promise<TransactionJournalV1> {
    await this.ensureTransactionDirectories(journal.id);
    for (const [index, mutation] of journal.mutations.entries()) {
      await this.assertTarget(mutation.targetPath);
      const snapshot = await this.snapshot(mutation.targetPath);
      const currentHash = snapshot === null ? null : hash(snapshot.bytes);
      if (currentHash !== mutation.expectedBeforeHash) {
        throw new TransactionConflictError();
      }

      const directory = this.backupDirectory(journal.id);
      if (snapshot !== null) {
        const backupPath = join(directory, `${String(index)}.bin`);
        await writeDurableFile(
          this.dependencies.fs,
          backupPath,
          `${backupPath}.tmp`,
          snapshot.bytes,
          0o600,
        );
      }
      const metadata: BackupMetadata =
        snapshot === null
          ? { existed: false, mode: null, atimeMs: null, mtimeMs: null }
          : {
              existed: true,
              mode: snapshot.mode,
              atimeMs: snapshot.atimeMs,
              mtimeMs: snapshot.mtimeMs,
            };
      const metadataPath = join(directory, `${String(index)}.json`);
      const serializedMetadata = metadataBytes(metadata);
      await writeDurableFile(
        this.dependencies.fs,
        metadataPath,
        `${metadataPath}.tmp`,
        serializedMetadata,
        0o600,
      );
      const metadataDigestPath = `${metadataPath}.sha256`;
      await writeDurableFile(
        this.dependencies.fs,
        metadataDigestPath,
        `${metadataDigestPath}.tmp`,
        new TextEncoder().encode(`${hash(serializedMetadata)}\n`),
        0o600,
      );
    }
    return this.transition(journal, "backed_up");
  }

  private async stage(journal: TransactionJournalV1): Promise<TransactionJournalV1> {
    for (const mutation of journal.mutations) {
      await this.stagedBytes(journal, mutation);
    }
    return this.transition(journal, "staged");
  }

  private async validate(journal: TransactionJournalV1): Promise<TransactionJournalV1> {
    for (const mutation of journal.mutations) {
      await this.assertTarget(mutation.targetPath);
      await this.stagedBytes(journal, mutation);
    }
    return this.transition(journal, "validated");
  }

  private async apply(journal: TransactionJournalV1): Promise<TransactionJournalV1> {
    for (const [index, mutation] of journal.mutations.entries()) {
      await this.applyMutation(journal, index, mutation);
    }
    return this.transition(journal, "applied");
  }

  private async applyMutation(
    journal: TransactionJournalV1,
    index: number,
    mutation: FileMutation,
  ): Promise<void> {
    await this.assertTarget(mutation.targetPath);
    const desired = await this.stagedBytes(journal, mutation);
    const desiredHash = desired === null ? null : hash(desired);
    const metadata = await this.readMetadata(journal.id, index);
    const desiredMode = this.expectedDesiredMode(mutation, metadata);
    const desiredMtimeMs = this.expectedDesiredMtime(journal);
    const current = await this.snapshot(mutation.targetPath);
    const currentHash = current === null ? null : hash(current.bytes);
    if (currentHash === desiredHash) {
      if (desiredMode === null) {
        await syncDirectory(this.dependencies.fs, dirname(mutation.targetPath));
      } else {
        await this.setFileMetadataDurably(
          mutation.targetPath,
          desiredMode,
          desiredMtimeMs,
          desiredMtimeMs,
        );
      }
      return;
    }
    if (currentHash !== mutation.expectedBeforeHash) {
      throw new TransactionConflictError();
    }
    if (!this.matchesOriginalMetadata(current, metadata)) {
      throw new TransactionConflictError();
    }

    if (mutation.operation === "remove") {
      try {
        await this.dependencies.fs.unlink(mutation.targetPath);
      } catch (error) {
        if (!isMissing(error)) throw new TransactionStateError();
      }
      await syncDirectory(this.dependencies.fs, dirname(mutation.targetPath));
      return;
    }

    if (desired === null) throw new TransactionStateError();
    if (desiredMode === null) throw new TransactionStateError();
    const temporary = join(
      dirname(mutation.targetPath),
      `.${basename(mutation.targetPath)}.${journal.id}-${String(index)}.tmp`,
    );
    await writeDurableFile(
      this.dependencies.fs,
      mutation.targetPath,
      temporary,
      desired,
      desiredMode,
    );
    await this.setFileMetadataDurably(
      mutation.targetPath,
      desiredMode,
      desiredMtimeMs,
      desiredMtimeMs,
    );
  }

  private async verifyAndTransition(
    journal: TransactionJournalV1,
  ): Promise<TransactionJournalV1> {
    await this.verifyDesired(journal);
    return this.transition(journal, "verified");
  }

  private async verifyDesired(journal: TransactionJournalV1): Promise<void> {
    const desiredMtimeMs = this.expectedDesiredMtime(journal);
    for (const [index, mutation] of journal.mutations.entries()) {
      const desired = await this.stagedBytes(journal, mutation);
      const metadata = await this.readMetadata(journal.id, index);
      const desiredMode = this.expectedDesiredMode(mutation, metadata);
      const current = await this.snapshot(mutation.targetPath);
      if (
        (current === null ? null : hash(current.bytes)) !==
          (desired === null ? null : hash(desired)) ||
        (desiredMode !== null &&
          (current === null ||
            current.mode !== desiredMode ||
            current.mtimeMs !== desiredMtimeMs))
      ) {
        throw new TransactionConflictError();
      }
    }
  }

  private async readMetadata(id: string, index: number): Promise<BackupMetadata> {
    const directory = this.backupDirectory(id);
    const metadataPath = join(directory, `${String(index)}.json`);
    try {
      const [metadata, persistedDigest] = await Promise.all([
        this.readArtifact(directory, metadataPath),
        this.readArtifact(directory, `${metadataPath}.sha256`),
      ]);
      const serializedDigest = new TextDecoder().decode(persistedDigest);
      if (
        !/^[a-f0-9]{64}\n$/.test(serializedDigest) ||
        serializedDigest !== `${hash(metadata)}\n`
      ) {
        throw new TransactionStateError();
      }
      return parseMetadata(new TextDecoder().decode(metadata));
    } catch (error) {
      if (error instanceof TransactionStateError) throw error;
      throw new TransactionStateError();
    }
  }

  private async restoreMutation(
    journal: TransactionJournalV1,
    index: number,
  ): Promise<void> {
    /**
     * **`metadata.existed === true` no longer implies a readable `<index>.bin`.** Backup
     * payloads are pruned at both terminal phases, so the invariant that makes this
     * function safe lives elsewhere: `rollbackLocked` refuses a `finalized` journal, and
     * `store.transition` refuses every transition out of either terminal phase, so a
     * rollback can only run while the payload is still there.
     *
     * The consequence if that ever loosens: this reads a payload that is gone and reports
     * a bare `TransactionStateError`, indistinguishable from a tampered or truncated
     * backup — and for a multi-mutation plan it would do so *partway*, having already
     * restored the higher indices. Only a hand-edited journal reaches that state today,
     * and the e2e fixtures that rewind a finalized journal are the one place it is
     * constructed deliberately.
     */
    const mutation = journal.mutations[index];
    if (mutation === undefined) throw new TransactionStateError();
    await this.assertTarget(mutation.targetPath);
    const desired = await this.stagedBytes(journal, mutation);
    const desiredHash = desired === null ? null : hash(desired);
    const metadata = await this.readMetadata(journal.id, index);
    const desiredMode = this.expectedDesiredMode(mutation, metadata);
    const desiredMtimeMs = this.expectedDesiredMtime(journal);
    const current = await this.snapshot(mutation.targetPath);
    const currentHash = current === null ? null : hash(current.bytes);
    if (currentHash === mutation.expectedBeforeHash) {
      await this.restoreOriginalMetadata(mutation.targetPath, current, metadata);
      return;
    }
    if (currentHash !== desiredHash) throw new TransactionConflictError();
    if (
      desiredMode !== null &&
      (current === null ||
        current.mode !== desiredMode ||
        (journal.phase !== "validated" &&
          current.mtimeMs !== desiredMtimeMs))
    ) {
      throw new TransactionConflictError();
    }

    if (!metadata.existed) {
      if (current !== null) {
        await this.dependencies.fs.unlink(mutation.targetPath);
        await syncDirectory(this.dependencies.fs, dirname(mutation.targetPath));
      }
      return;
    }

    if (
      metadata.mode === null ||
      metadata.atimeMs === null ||
      metadata.mtimeMs === null
    ) {
      throw new TransactionStateError();
    }
    let original: Uint8Array;
    try {
      const directory = this.backupDirectory(journal.id);
      original = await this.readArtifact(
        directory,
        join(directory, `${String(index)}.bin`),
      );
    } catch {
      throw new TransactionStateError();
    }
    if (hash(original) !== mutation.expectedBeforeHash) {
      throw new TransactionStateError();
    }
    const temporary = join(
      dirname(mutation.targetPath),
      `.${basename(mutation.targetPath)}.${journal.id}-${String(index)}.rollback.tmp`,
    );
    await writeDurableFile(
      this.dependencies.fs,
      mutation.targetPath,
      temporary,
      original,
      metadata.mode,
    );
    await this.restoreOriginalMetadata(mutation.targetPath, null, metadata);
  }

  private async readArtifact(
    transactionDirectory: string,
    artifactPath: string,
  ): Promise<Uint8Array> {
    try {
      const directoryStats = await this.dependencies.fs.lstat(
        transactionDirectory,
      );
      if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
        throw new TransactionStateError();
      }
      const pathStats = await this.dependencies.fs.lstat(artifactPath);
      if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
        throw new TransactionStateError();
      }
      const handle = await this.dependencies.fs.open(
        artifactPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const handleStats = await handle.stat();
        if (
          !handleStats.isFile() ||
          handleStats.dev !== pathStats.dev ||
          handleStats.ino !== pathStats.ino
        ) {
          throw new TransactionStateError();
        }
        return await handle.readFile();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof TransactionStateError) throw error;
      throw new TransactionStateError();
    }
  }

  private expectedDesiredMode(
    mutation: FileMutation,
    metadata: BackupMetadata,
  ): number | null {
    if (mutation.operation === "create") {
      if (metadata.existed) throw new TransactionStateError();
      return 0o600;
    }
    if (!metadata.existed || metadata.mode === null) {
      throw new TransactionStateError();
    }
    return mutation.operation === "remove" ? null : metadata.mode;
  }

  private expectedDesiredMtime(journal: TransactionJournalV1): number {
    const desiredMtimeMs = Date.parse(journal.createdAt);
    if (Number.isNaN(desiredMtimeMs)) throw new TransactionStateError();
    return desiredMtimeMs;
  }

  private async setFileMetadataDurably(
    targetPath: string,
    mode: number,
    atimeMs: number,
    mtimeMs: number,
  ): Promise<void> {
    try {
      const handle = await this.dependencies.fs.open(
        targetPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stats = await handle.stat();
        if (!stats.isFile()) throw new TransactionStateError();
        await handle.chmod(mode);
        await handle.utimes(atimeMs / 1000, mtimeMs / 1000);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(this.dependencies.fs, dirname(targetPath));
    } catch (error) {
      if (error instanceof TransactionStateError) throw error;
      throw new TransactionStateError();
    }
  }

  private async restoreOriginalMetadata(
    targetPath: string,
    current: ExistingSnapshot | null,
    metadata: BackupMetadata,
  ): Promise<void> {
    if (!metadata.existed) {
      if (current !== null) throw new TransactionStateError();
      await syncDirectory(this.dependencies.fs, dirname(targetPath));
      return;
    }
    if (
      metadata.mode === null ||
      metadata.atimeMs === null ||
      metadata.mtimeMs === null
    ) {
      throw new TransactionStateError();
    }
    await this.setFileMetadataDurably(
      targetPath,
      metadata.mode,
      metadata.atimeMs,
      metadata.mtimeMs,
    );
  }

  private matchesOriginalMetadata(
    current: ExistingSnapshot | null,
    metadata: BackupMetadata,
  ): boolean {
    return metadata.existed
      ? metadata.mode !== null &&
          metadata.mtimeMs !== null &&
          current !== null &&
          current.mode === metadata.mode &&
          current.mtimeMs === metadata.mtimeMs
      : current === null;
  }

  private async verifyOriginal(journal: TransactionJournalV1): Promise<void> {
    for (const [index, mutation] of journal.mutations.entries()) {
      const current = await this.snapshot(mutation.targetPath);
      const currentHash = current === null ? null : hash(current.bytes);
      if (currentHash !== mutation.expectedBeforeHash) {
        throw new TransactionStateError();
      }
      const metadata = await this.readMetadata(journal.id, index);
      if (
        metadata.existed &&
        (current === null ||
          current.mode !== metadata.mode ||
          current.mtimeMs !== metadata.mtimeMs)
      ) {
        throw new TransactionStateError();
      }
    }
  }

  private async transition(
    journal: TransactionJournalV1,
    nextPhase: TransactionPhase,
  ): Promise<TransactionJournalV1> {
    const next = await this.store.transition(
      journal.id,
      journal.phase,
      nextPhase,
      this.dependencies.clock(),
    );
    await this.runHook(nextPhase, next);
    return next;
  }

  private async runHook(
    phase: TransactionPhase,
    journal: TransactionJournalV1,
  ): Promise<void> {
    await this.dependencies.afterPhase?.(phase, journal);
  }
}
