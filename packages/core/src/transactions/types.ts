import type {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  utimes,
} from "node:fs/promises";

export type TransactionPhase =
  | "planned"
  | "backed_up"
  | "staged"
  | "validated"
  | "applied"
  | "verified"
  | "finalized"
  | "rolled_back";

export interface FileMutation {
  readonly targetPath: string;
  readonly operation: "create" | "replace" | "remove";
  readonly expectedBeforeHash: string | null;
  readonly stagedRelativePath: string | null;
}

export interface TransactionJournalV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly kind: string;
  readonly phase: TransactionPhase;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly mutations: readonly FileMutation[];
}

export interface TransactionGuards {
  assertTarget(path: string): Promise<void>;
  redactDiagnostic(text: string): string;
}

export interface TransactionLockHandle {
  release(): Promise<void>;
}

export interface TransactionLockProvider {
  acquire(path: string): Promise<TransactionLockHandle>;
}

export interface PlannedFileMutation {
  readonly targetPath: string;
  readonly operation: "create" | "replace" | "remove";
  readonly content: Uint8Array | null;
  /**
   * **A precondition the caller read, not one the executor computed.** Without this the
   * executor snapshots the target when `execute()` runs, so everything between a caller's own
   * read and that snapshot is invisible to it — and `review --decision edit` reads the file,
   * re-redacts it and writes it back. What that window discards is the user's own hand edit,
   * in the one verb that exists to bring a hand edit under this product's guarantees.
   *
   * **Optional, and absence keeps the previous behaviour exactly.** `capture` supplies none
   * and wants none: spec §5.2 calls a duplicate an `O_EXCL` create that fails, which no
   * transaction-mediated write delivers, and the residual is benign there because the id *is*
   * the content hash — colliding captures are byte-identical.
   *
   * **A supplied hash against a `create` is a mismatch**: a create observes no bytes, so a
   * caller that supplies a precondition for one is describing a file it believes exists.
   *
   * A `replace` or `remove` whose target has *vanished* never reaches this comparison — the
   * plan phase already refuses a missing target as `TransactionPlanError`, one check earlier.
   * An earlier version of this paragraph claimed the precondition covered that case; it does
   * not, and the user meets "transaction plan is invalid" with no paths and no recovery. That
   * is pre-existing and registered rather than described as handled.
   */
  readonly expectedBeforeHash?: string;
}

export interface TransactionPlan {
  readonly kind: string;
  readonly mutations: readonly PlannedFileMutation[];
}

export interface TransactionFileSystem {
  readonly chmod: typeof chmod;
  readonly link: typeof link;
  readonly lstat: typeof lstat;
  readonly mkdir: typeof mkdir;
  readonly open: typeof open;
  readonly readFile: typeof readFile;
  readonly rename: typeof rename;
  readonly stat: typeof stat;
  readonly unlink: typeof unlink;
  readonly utimes: typeof utimes;
}

export type TransactionAfterPhase = (
  phase: TransactionPhase,
  journal: TransactionJournalV1,
) => void | Promise<void>;

export interface TransactionExecutorDependencies {
  readonly stateDir: string;
  readonly stagingDir: string;
  readonly backupsDir: string;
  readonly fs: TransactionFileSystem;
  readonly clock: () => string;
  readonly generateId: () => string;
  readonly guards: TransactionGuards;
  readonly lockProvider: TransactionLockProvider;
  readonly afterPhase?: TransactionAfterPhase | undefined;
}

export interface TransactionStoreDependencies {
  readonly stateDir: string;
  readonly fs: TransactionFileSystem;
  readonly lockProvider: TransactionLockProvider;
}

export type TransactionRecoveryResult =
  | {
      readonly id: string;
      readonly action: "resumed";
      readonly phase: "finalized";
    }
  | {
      readonly id: string;
      readonly action: "rolled_back";
      readonly phase: "rolled_back";
    };

export interface TransactionRecoveryRequest {
  readonly executor: {
    resume(id: string): Promise<TransactionJournalV1>;
    rollback(id: string): Promise<TransactionJournalV1>;
  };
  readonly id: string;
  readonly action: "resume" | "rollback";
}
