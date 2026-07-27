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
    if (journal.phase === "finalized") return journal;
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
    if (journal.phase === "rolled_back") return journal;
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
