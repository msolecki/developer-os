import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";

import { EXIT_CODES } from "../result.js";
import type {
  FileMutation,
  TransactionJournalV1,
  TransactionLockHandle,
  TransactionLockProvider,
  TransactionPhase,
  TransactionStoreDependencies,
} from "./types.js";

const PHASES = new Set<TransactionPhase>([
  "planned",
  "backed_up",
  "staged",
  "validated",
  "applied",
  "verified",
  "finalized",
  "rolled_back",
]);

const FORWARD_PHASE: Partial<Record<TransactionPhase, TransactionPhase>> = {
  planned: "backed_up",
  backed_up: "staged",
  staged: "validated",
  validated: "applied",
  applied: "verified",
  verified: "finalized",
};

const JOURNAL_KEYS = [
  "createdAt",
  "id",
  "kind",
  "mutations",
  "phase",
  "schemaVersion",
  "updatedAt",
];
const MUTATION_KEYS = [
  "expectedBeforeHash",
  "operation",
  "stagedRelativePath",
  "targetPath",
];

interface TransactionLockContext {
  readonly store: TransactionStore;
  readonly id: string;
  readonly token: string;
  active: boolean;
}

const LOCK_CONTEXT = new AsyncLocalStorage<TransactionLockContext>();

export class TransactionStateError extends Error {
  readonly code = EXIT_CODES.recoveryRequired;

  constructor(message = "transaction state is malformed or incomplete") {
    super(message);
    this.name = "TransactionStateError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isHash(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
}

function isMutation(value: unknown): value is FileMutation {
  if (!isObject(value) || !hasExactKeys(value, MUTATION_KEYS)) return false;
  return (
    typeof value.targetPath === "string" &&
    value.targetPath.length > 0 &&
    isAbsolute(value.targetPath) &&
    !value.targetPath.includes("\0") &&
    (value.operation === "create" ||
      value.operation === "replace" ||
      value.operation === "remove") &&
    isHash(value.expectedBeforeHash) &&
    (value.stagedRelativePath === null ||
      (typeof value.stagedRelativePath === "string" &&
        value.stagedRelativePath.length > 0))
  );
}

function hasValidMutations(
  values: readonly unknown[],
): values is readonly FileMutation[] {
  const targetPaths = new Set<string>();
  return values.every((mutation, index) => {
    if (!isMutation(mutation) || targetPaths.has(mutation.targetPath)) {
      return false;
    }
    targetPaths.add(mutation.targetPath);
    const expectedStagedPath =
      mutation.operation === "remove" ? null : `${String(index)}.bin`;
    const validBeforeHash =
      mutation.operation === "create"
        ? mutation.expectedBeforeHash === null
        : mutation.expectedBeforeHash !== null;
    return (
      validBeforeHash && mutation.stagedRelativePath === expectedStagedPath
    );
  });
}

export function validateJournal(value: unknown): TransactionJournalV1 {
  if (
    !isObject(value) ||
    !hasExactKeys(value, JOURNAL_KEYS) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    !/^[A-Za-z0-9._-]+$/.test(value.id) ||
    typeof value.kind !== "string" ||
    value.kind.length === 0 ||
    typeof value.phase !== "string" ||
    !PHASES.has(value.phase as TransactionPhase) ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.updatedAt) ||
    !Array.isArray(value.mutations) ||
    !hasValidMutations(value.mutations)
  ) {
    throw new TransactionStateError();
  }
  return cloneJournal(value as unknown as TransactionJournalV1);
}

function cloneJournal(journal: TransactionJournalV1): TransactionJournalV1 {
  return {
    schemaVersion: 1,
    id: journal.id,
    kind: journal.kind,
    phase: journal.phase,
    createdAt: journal.createdAt,
    updatedAt: journal.updatedAt,
    mutations: journal.mutations.map((mutation) => ({ ...mutation })),
  };
}

function isMissing(error: unknown): boolean {
  return isObject(error) && error.code === "ENOENT";
}

function isTransactionLockHandle(
  value: unknown,
): value is TransactionLockHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    "release" in value &&
    typeof value.release === "function"
  );
}

async function syncDirectory(
  fs: TransactionStoreDependencies["fs"],
  path: string,
): Promise<void> {
  const handle = await fs.open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class TransactionStore {
  private readonly journalDir: string;
  private readonly fs: TransactionStoreDependencies["fs"];
  private readonly lockProvider: TransactionLockProvider;

  constructor(dependencies: TransactionStoreDependencies) {
    this.journalDir = join(dependencies.stateDir, "transactions");
    this.fs = dependencies.fs;
    this.lockProvider = dependencies.lockProvider;
  }

  async withTransactionLock<T>(
    id: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new TransactionStateError();
    const existing = LOCK_CONTEXT.getStore();
    if (existing?.store === this && existing.id === id && existing.active) {
      return operation();
    }

    let handle: TransactionLockHandle;
    try {
      const acquired = await this.lockProvider.acquire(this.lockPathFor(id));
      if (!isTransactionLockHandle(acquired)) {
        throw new TransactionStateError("transaction lock handle is invalid");
      }
      handle = acquired;
    } catch {
      throw new TransactionStateError("transaction lock is unavailable");
    }

    const context: TransactionLockContext = {
      store: this,
      id,
      token: randomUUID(),
      active: true,
    };
    let result: T;
    try {
      result = await LOCK_CONTEXT.run(context, operation);
    } catch (error) {
      context.active = false;
      try {
        await handle.release();
      } catch {
        // Preserve the primary transaction error.
      }
      throw error;
    }

    context.active = false;
    try {
      await handle.release();
    } catch {
      throw new TransactionStateError("transaction lock release failed");
    }
    return result;
  }

  async create(journal: TransactionJournalV1): Promise<TransactionJournalV1> {
    const candidate = validateJournal(journal);
    if (candidate.phase !== "planned") throw new TransactionStateError();
    return this.withTransactionLock(candidate.id, async () => {
      try {
        await this.fs.stat(this.pathFor(candidate.id));
        throw new TransactionStateError("transaction already exists");
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      await this.write(candidate);
      return cloneJournal(candidate);
    });
  }

  async read(id: string): Promise<TransactionJournalV1> {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new TransactionStateError();
    return this.withTransactionLock(id, async () => {
      let serialized: string;
      try {
        serialized = await this.fs.readFile(this.pathFor(id), "utf8");
      } catch {
        throw new TransactionStateError();
      }
      try {
        return validateJournal(JSON.parse(serialized) as unknown);
      } catch (error) {
        if (error instanceof TransactionStateError) throw error;
        throw new TransactionStateError();
      }
    });
  }

  async transition(
    id: string,
    expectedPhase: TransactionPhase,
    nextPhase: TransactionPhase,
    updatedAt: string,
  ): Promise<TransactionJournalV1> {
    return this.withTransactionLock(id, async () => {
      const current = await this.read(id);
      if (current.phase !== expectedPhase || !isIsoDate(updatedAt)) {
        throw new TransactionStateError("transaction transition is stale");
      }
      const terminal =
        expectedPhase === "finalized" || expectedPhase === "rolled_back";
      const isForward = FORWARD_PHASE[expectedPhase] === nextPhase;
      const isRollback = !terminal && nextPhase === "rolled_back";
      if (terminal || (!isForward && !isRollback)) {
        throw new TransactionStateError("transaction transition is invalid");
      }
      const next: TransactionJournalV1 = {
        ...current,
        phase: nextPhase,
        updatedAt,
        mutations: current.mutations.map((mutation) => ({ ...mutation })),
      };
      await this.write(next);
      return cloneJournal(next);
    });
  }

  private pathFor(id: string): string {
    return join(this.journalDir, `${id}.json`);
  }

  private lockPathFor(id: string): string {
    return join(this.journalDir, `.${id}.lock`);
  }

  private async ensureJournalDirectory(): Promise<void> {
    await this.fs.mkdir(this.journalDir, { recursive: true, mode: 0o700 });
    await this.fs.chmod(this.journalDir, 0o700);
  }

  private async write(journal: TransactionJournalV1): Promise<void> {
    await this.ensureJournalDirectory();
    const destination = this.pathFor(journal.id);
    const context = LOCK_CONTEXT.getStore();
    if (context?.store !== this || context.id !== journal.id) {
      throw new TransactionStateError();
    }
    const temporary = join(
      this.journalDir,
      `.${journal.id}.${context.token}.json.tmp`,
    );
    try {
      const handle = await this.fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(journal)}\n`, "utf8");
        await handle.chmod(0o600);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.fs.rename(temporary, destination);
      await this.fs.chmod(destination, 0o600);
      await syncDirectory(this.fs, this.journalDir);
    } catch {
      try {
        await this.fs.unlink(temporary);
      } catch (cleanupError) {
        if (!isMissing(cleanupError)) throw new TransactionStateError();
      }
      throw new TransactionStateError();
    }
  }
}
