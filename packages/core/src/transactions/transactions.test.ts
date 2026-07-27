import * as nodeFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXIT_CODES } from '../result.js';
import {
  recoverTransaction,
  TransactionExecutor,
  TransactionStore,
  validateJournal,
  type PlannedFileMutation,
  type TransactionFileSystem,
  type TransactionGuards,
  type TransactionJournalV1,
  type TransactionLockHandle,
  type TransactionLockProvider,
  type TransactionPhase,
  type TransactionPlan,
  type TransactionRecoveryResult,
} from './index.js';

const ORIGINAL_FIXTURE_LABEL = 'synthetic-original-byte-material';
const NEW_FIXTURE_LABEL = 'synthetic-new-byte-material';
const ORIGINAL_BYTES = new TextEncoder().encode(ORIGINAL_FIXTURE_LABEL);
const NEW_BYTES = new TextEncoder().encode(NEW_FIXTURE_LABEL);
const USER_BYTES = Uint8Array.from([0x75, 0x73, 0x65, 0x72]);
const CREATED_BYTES = Uint8Array.from([0x63, 0x72, 0x65, 0x61, 0x74, 0x65]);
const PHASE_INTERRUPTION = new Error('synthetic transaction phase interruption');
const ORIGINAL_MODE = 0o640;
const USER_MODE = 0o600;
const ORIGINAL_MTIME_MS = Date.UTC(2026, 0, 2, 3, 4, 5);
const USER_MTIME_MS = Date.UTC(2027, 1, 3, 4, 5, 6);

const RESTARTABLE_PHASES = [
  'planned',
  'backed_up',
  'staged',
  'validated',
  'applied',
  'verified',
] as const satisfies readonly Exclude<
  TransactionPhase,
  'finalized' | 'rolled_back'
>[];

interface Fixture {
  readonly root: string;
  readonly workspaceDir: string;
  readonly stateDir: string;
  readonly stagingDir: string;
  readonly backupsDir: string;
  readonly transactionId: string;
  readonly clock: () => string;
  readonly generateId: () => string;
  readonly lockProvider: DeterministicTransactionLockProvider;
}

interface ExecutorOverrides {
  readonly guards?: TransactionGuards;
  readonly lockProvider?: TransactionLockProvider;
  readonly fs?: TransactionFileSystem;
  readonly afterPhase?: (
    phase: TransactionPhase,
    journal: TransactionJournalV1,
  ) => void | Promise<void>;
}

interface DeferredSignal {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

interface DeterministicLockOptions {
  readonly acquireFailure?: Error;
  readonly releaseFailure?: Error;
  readonly materializeLockFile?: boolean;
}

class DeterministicTransactionLockProvider
  implements TransactionLockProvider
{
  readonly acquisitions: string[] = [];
  readonly releases: string[] = [];
  readonly releaseAttempts: string[] = [];
  private readonly heldPaths = new Set<string>();

  constructor(private readonly options: DeterministicLockOptions = {}) {}

  isHeld(path: string): boolean {
    return this.heldPaths.has(path);
  }

  async acquire(path: string): Promise<TransactionLockHandle> {
    if (this.options.acquireFailure !== undefined) {
      throw this.options.acquireFailure;
    }
    if (this.heldPaths.has(path)) {
      throw new Error('synthetic lock contention');
    }
    this.heldPaths.add(path);
    if (this.options.materializeLockFile === true) {
      await nodeFs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(path, '', { mode: 0o600, flag: 'a' });
    }

    this.acquisitions.push(path);
    let releaseCalled = false;

    return Promise.resolve({
      release: (): Promise<void> => {
        if (releaseCalled) {
          return Promise.reject(new Error('synthetic duplicate release'));
        }
        releaseCalled = true;
        this.releaseAttempts.push(path);
        if (this.options.releaseFailure !== undefined) {
          return Promise.reject(this.options.releaseFailure);
        }
        this.heldPaths.delete(path);
        this.releases.push(path);
        return Promise.resolve();
      },
    });
  }
}

function deferredSignal(): DeferredSignal {
  let resolveSignal = (): void => {
    // Replaced synchronously by the Promise executor below.
  };
  const promise = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });
  return { promise, resolve: resolveSignal };
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => {
        reject(new Error('bounded transaction coordination timed out'));
      },
      2_000,
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function canonicalLockPath(fixture: Fixture): string {
  return join(
    fixture.stateDir,
    'transactions',
    `.${fixture.transactionId}.lock`,
  );
}

async function createFixture(label: string): Promise<Fixture> {
  const root = await nodeFs.mkdtemp(
    join(tmpdir(), `developer-os-transactions-${label}-`),
  );
  const workspaceDir = join(root, 'workspace');
  const stateDir = join(root, 'state');
  const stagingDir = join(root, 'staging');
  const backupsDir = join(root, 'backups');
  await Promise.all([
    nodeFs.mkdir(workspaceDir, { recursive: true }),
    nodeFs.mkdir(stateDir, { recursive: true }),
    nodeFs.mkdir(stagingDir, { recursive: true }),
    nodeFs.mkdir(backupsDir, { recursive: true }),
  ]);

  let clockTick = 0;
  const transactionId = 'tx-0001';

  return {
    root,
    workspaceDir,
    stateDir,
    stagingDir,
    backupsDir,
    transactionId,
    clock: () =>
      new Date(Date.UTC(2026, 6, 22, 12, 0, clockTick++)).toISOString(),
    generateId: () => transactionId,
    lockProvider: new DeterministicTransactionLockProvider(),
  };
}

async function removeFixture(fixture: Fixture): Promise<void> {
  await nodeFs.rm(fixture.root, { recursive: true, force: true });
}

function journalPath(fixture: Fixture): string {
  return join(
    fixture.stateDir,
    'transactions',
    `${fixture.transactionId}.json`,
  );
}

function defaultGuards(fixture: Fixture): TransactionGuards {
  return {
    assertTarget: (targetPath) => {
      if (!targetPath.startsWith(`${fixture.workspaceDir}${sep}`)) {
        throw Object.assign(new Error('target escaped synthetic workspace'), {
          code: 3,
        });
      }
      return Promise.resolve();
    },
    redactDiagnostic: (text) => text.replaceAll(fixture.root, '<synthetic-root>'),
  };
}

function createExecutor(
  fixture: Fixture,
  overrides: ExecutorOverrides = {},
): TransactionExecutor {
  return new TransactionExecutor({
    stateDir: fixture.stateDir,
    stagingDir: fixture.stagingDir,
    backupsDir: fixture.backupsDir,
    fs: overrides.fs ?? nodeFs,
    clock: fixture.clock,
    generateId: fixture.generateId,
    guards: overrides.guards ?? defaultGuards(fixture),
    lockProvider: overrides.lockProvider ?? fixture.lockProvider,
    afterPhase: overrides.afterPhase,
  });
}

function replacePlan(targetPath: string): TransactionPlan {
  const mutation: PlannedFileMutation = {
    targetPath,
    operation: 'replace',
    content: NEW_BYTES,
  };

  return { kind: 'replace-test', mutations: [mutation] };
}

async function installOriginal(targetPath: string): Promise<void> {
  await nodeFs.mkdir(dirname(targetPath), { recursive: true });
  await nodeFs.writeFile(targetPath, ORIGINAL_BYTES);
  await nodeFs.chmod(targetPath, ORIGINAL_MODE);
  await nodeFs.utimes(
    targetPath,
    ORIGINAL_MTIME_MS / 1000,
    ORIGINAL_MTIME_MS / 1000,
  );
}

async function readMode(targetPath: string): Promise<number> {
  return (await nodeFs.stat(targetPath)).mode & 0o777;
}

async function expectBytes(
  targetPath: string,
  expected: Uint8Array,
): Promise<void> {
  const actual = await nodeFs.readFile(targetPath);
  expect([...actual]).toEqual([...expected]);
}

function interruptAfter(
  fixture: Fixture,
  phaseToInterrupt: TransactionPhase,
): (phase: TransactionPhase, journal: TransactionJournalV1) => Promise<void> {
  return async (phase, journal) => {
    if (phase !== phaseToInterrupt) return;

    const persisted = JSON.parse(
      await nodeFs.readFile(journalPath(fixture), 'utf8'),
    ) as TransactionJournalV1;
    expect(persisted.phase).toBe(phaseToInterrupt);
    expect(persisted).toStrictEqual(journal);
    throw PHASE_INTERRUPTION;
  };
}

async function expectMissing(targetPath: string): Promise<void> {
  await expect(nodeFs.stat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
}

function plannedJournal(
  id: string,
  phase: TransactionPhase = 'planned',
): TransactionJournalV1 {
  return {
    schemaVersion: 1,
    id,
    kind: 'store-transition-test',
    phase,
    createdAt: '2026-07-22T12:00:00.000Z',
    updatedAt: '2026-07-22T12:00:00.000Z',
    mutations: [],
  };
}

type PersistedMutation = TransactionJournalV1['mutations'][number];

function validPersistedMutation(
  overrides: Partial<PersistedMutation> = {},
): PersistedMutation {
  return {
    targetPath: '/synthetic/workspace/config.bin',
    operation: 'replace',
    expectedBeforeHash: 'a'.repeat(64),
    stagedRelativePath: '0.bin',
    ...overrides,
  };
}

function validPersistedJournal(
  mutations: readonly PersistedMutation[] = [validPersistedMutation()],
): TransactionJournalV1 {
  return {
    schemaVersion: 1,
    id: 'tx-forged-journal-test',
    kind: 'persisted-validation-test',
    phase: 'planned',
    createdAt: '2026-07-22T12:00:00.000Z',
    updatedAt: '2026-07-22T12:00:00.000Z',
    mutations,
  };
}

describe('TransactionExecutor durable recovery', () => {
  for (const phase of RESTARTABLE_PHASES) {
    it(`resumes an exact-byte replace from durable ${phase}`, async () => {
      const fixture = await createFixture(`resume-${phase}`);
      const targetPath = join(fixture.workspaceDir, 'config.bin');

      try {
        await installOriginal(targetPath);
        const afterPhase = interruptAfter(fixture, phase);
        const interruptedExecutor = createExecutor(fixture, { afterPhase });

        await expect(
          interruptedExecutor.execute(replacePlan(targetPath)),
        ).rejects.toBe(PHASE_INTERRUPTION);
        expect(fixture.lockProvider.releaseAttempts).toStrictEqual([
          canonicalLockPath(fixture),
        ]);

        // A fresh executor receives only the ID; the plan and desired bytes must
        // already be durable, including when interruption happened at planned.
        const restartedExecutor = createExecutor(fixture);
        const journal = await restartedExecutor.resume(fixture.transactionId);

        expect(journal.phase).toBe('finalized');
        await expectBytes(targetPath, NEW_BYTES);
      } finally {
        await removeFixture(fixture);
      }
    });

    it(`rolls back with exact original bytes and mode from durable ${phase}`, async () => {
      const fixture = await createFixture(`rollback-${phase}`);
      const targetPath = join(fixture.workspaceDir, 'config.bin');

      try {
        await installOriginal(targetPath);
        const originalMtimeMs = (await nodeFs.stat(targetPath)).mtimeMs;
        const afterPhase = interruptAfter(fixture, phase);
        const interruptedExecutor = createExecutor(fixture, { afterPhase });

        await expect(
          interruptedExecutor.execute(replacePlan(targetPath)),
        ).rejects.toBe(PHASE_INTERRUPTION);
        expect(fixture.lockProvider.releaseAttempts).toStrictEqual([
          canonicalLockPath(fixture),
        ]);

        const restartedExecutor = createExecutor(fixture);
        const journal = await restartedExecutor.rollback(fixture.transactionId);

        expect(journal.phase).toBe('rolled_back');
        await expectBytes(targetPath, ORIGINAL_BYTES);
        expect(await readMode(targetPath)).toBe(ORIGINAL_MODE);
        expect((await nodeFs.stat(targetPath)).mtimeMs).toBe(originalMtimeMs);
      } finally {
        await removeFixture(fixture);
      }
    });
  }

  it('returns code 3 and preserves a concurrent edit made after backup', async () => {
    const fixture = await createFixture('concurrent-before-apply');
    const targetPath = join(fixture.workspaceDir, 'config.bin');

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'backed_up');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(replacePlan(targetPath)),
      ).rejects.toBe(PHASE_INTERRUPTION);

      await nodeFs.writeFile(targetPath, USER_BYTES);

      await expect(
        createExecutor(fixture).resume(fixture.transactionId),
      ).rejects.toMatchObject({ code: 3 });
      await expectBytes(targetPath, USER_BYTES);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('returns code 3 and preserves a mode-only edit made after backup', async () => {
    const fixture = await createFixture('mode-drift-before-apply');
    const targetPath = join(fixture.workspaceDir, 'config.bin');

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'backed_up');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(replacePlan(targetPath)),
      ).rejects.toBe(PHASE_INTERRUPTION);

      await nodeFs.chmod(targetPath, USER_MODE);

      await expect(
        createExecutor(fixture).resume(fixture.transactionId),
      ).rejects.toMatchObject({ code: 3 });
      await expectBytes(targetPath, ORIGINAL_BYTES);
      expect(await readMode(targetPath)).toBe(USER_MODE);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('returns code 3 and preserves an mtime-only edit made after backup', async () => {
    const fixture = await createFixture('mtime-drift-before-apply');
    const targetPath = join(fixture.workspaceDir, 'config.bin');

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'backed_up');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(replacePlan(targetPath)),
      ).rejects.toBe(PHASE_INTERRUPTION);

      await nodeFs.utimes(
        targetPath,
        USER_MTIME_MS / 1000,
        USER_MTIME_MS / 1000,
      );
      const userMtimeMs = (await nodeFs.stat(targetPath)).mtimeMs;

      await expect(
        createExecutor(fixture).resume(fixture.transactionId),
      ).rejects.toMatchObject({ code: EXIT_CODES.decisionRequired });
      await expectBytes(targetPath, ORIGINAL_BYTES);
      expect(await readMode(targetPath)).toBe(ORIGINAL_MODE);
      expect((await nodeFs.stat(targetPath)).mtimeMs).toBe(userMtimeMs);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('returns code 3 and preserves a concurrent edit made after apply', async () => {
    const fixture = await createFixture('concurrent-before-rollback');
    const targetPath = join(fixture.workspaceDir, 'config.bin');

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'applied');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(replacePlan(targetPath)),
      ).rejects.toBe(PHASE_INTERRUPTION);
      await expectBytes(targetPath, NEW_BYTES);

      await nodeFs.writeFile(targetPath, USER_BYTES);

      await expect(
        createExecutor(fixture).rollback(fixture.transactionId),
      ).rejects.toMatchObject({ code: 3 });
      await expectBytes(targetPath, USER_BYTES);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('returns code 3 and preserves a mode-only edit made after apply', async () => {
    const fixture = await createFixture('mode-drift-before-rollback');
    const targetPath = join(fixture.workspaceDir, 'config.bin');

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'applied');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(replacePlan(targetPath)),
      ).rejects.toBe(PHASE_INTERRUPTION);
      await expectBytes(targetPath, NEW_BYTES);

      await nodeFs.chmod(targetPath, USER_MODE);

      await expect(
        createExecutor(fixture).rollback(fixture.transactionId),
      ).rejects.toMatchObject({ code: 3 });
      await expectBytes(targetPath, NEW_BYTES);
      expect(await readMode(targetPath)).toBe(USER_MODE);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('returns code 3 and preserves an mtime-only edit made after apply', async () => {
    const fixture = await createFixture('mtime-drift-before-rollback');
    const targetPath = join(fixture.workspaceDir, 'config.bin');

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'applied');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(replacePlan(targetPath)),
      ).rejects.toBe(PHASE_INTERRUPTION);
      await expectBytes(targetPath, NEW_BYTES);

      await nodeFs.utimes(
        targetPath,
        USER_MTIME_MS / 1000,
        USER_MTIME_MS / 1000,
      );
      const userMtimeMs = (await nodeFs.stat(targetPath)).mtimeMs;

      await expect(
        createExecutor(fixture).rollback(fixture.transactionId),
      ).rejects.toMatchObject({ code: EXIT_CODES.decisionRequired });
      await expectBytes(targetPath, NEW_BYTES);
      expect(await readMode(targetPath)).toBe(ORIGINAL_MODE);
      expect((await nodeFs.stat(targetPath)).mtimeMs).toBe(userMtimeMs);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('applies create, replace, and remove mutations without Git', async () => {
    const fixture = await createFixture('mutation-semantics');
    const createPath = join(fixture.workspaceDir, 'created.bin');
    const replacePath = join(fixture.workspaceDir, 'replaced.bin');
    const removePath = join(fixture.workspaceDir, 'removed.bin');

    try {
      await installOriginal(replacePath);
      await installOriginal(removePath);

      const mutations: PlannedFileMutation[] = [
        { targetPath: createPath, operation: 'create', content: CREATED_BYTES },
        { targetPath: replacePath, operation: 'replace', content: NEW_BYTES },
        { targetPath: removePath, operation: 'remove', content: null },
      ];
      const journal = await createExecutor(fixture).execute({
        kind: 'all-file-operations',
        mutations,
      });

      expect(journal.phase).toBe('finalized');
      await expectBytes(createPath, CREATED_BYTES);
      await expectBytes(replacePath, NEW_BYTES);
      await expectMissing(removePath);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('rolls back a partially applied multi-mutation transaction from validated', async () => {
    const fixture = await createFixture('partial-apply-crash');
    const firstTarget = join(fixture.workspaceDir, 'first.bin');
    const secondTarget = join(fixture.workspaceDir, 'second.bin');
    const firstOriginal = Uint8Array.from([0x11, 0x12, 0x13]);
    const secondOriginal = Uint8Array.from([0x21, 0x22, 0x23]);
    const firstDesired = Uint8Array.from([0xa1, 0xa2, 0xa3]);
    const secondDesired = Uint8Array.from([0xb1, 0xb2, 0xb3]);
    const firstMode = 0o640;
    const secondMode = 0o644;

    try {
      await nodeFs.writeFile(firstTarget, firstOriginal);
      await nodeFs.chmod(firstTarget, firstMode);
      await nodeFs.writeFile(secondTarget, secondOriginal);
      await nodeFs.chmod(secondTarget, secondMode);
      const plan: TransactionPlan = {
        kind: 'partial-apply-crash-test',
        mutations: [
          {
            targetPath: firstTarget,
            operation: 'replace',
            content: firstDesired,
          },
          {
            targetPath: secondTarget,
            operation: 'replace',
            content: secondDesired,
          },
        ],
      };
      const afterPhase = interruptAfter(fixture, 'validated');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(plan),
      ).rejects.toBe(PHASE_INTERRUPTION);

      // Simulate a crash after the first atomic target rename but before the
      // durable applied transition. The second target was not yet mutated.
      await nodeFs.writeFile(firstTarget, firstDesired);
      await nodeFs.chmod(firstTarget, firstMode);

      const journal = await createExecutor(fixture).rollback(
        fixture.transactionId,
      );

      expect(journal.phase).toBe('rolled_back');
      await expectBytes(firstTarget, firstOriginal);
      await expectBytes(secondTarget, secondOriginal);
      expect(await readMode(firstTarget)).toBe(firstMode);
      expect(await readMode(secondTarget)).toBe(secondMode);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('runs apply-time guards again on resume and refuses drift before mutation', async () => {
    const fixture = await createFixture('resume-guard');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    let guardCalls = 0;
    let refuse = false;
    const guards: TransactionGuards = {
      assertTarget: (candidate) => {
        guardCalls += 1;
        if (candidate !== targetPath || refuse) {
          throw Object.assign(new Error('synthetic guard refusal'), { code: 3 });
        }
        return Promise.resolve();
      },
      redactDiagnostic: (text) => text.replaceAll(fixture.root, '<redacted>'),
    };

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'validated');
      await expect(
        createExecutor(fixture, { guards, afterPhase }).execute(
          replacePlan(targetPath),
        ),
      ).rejects.toBe(PHASE_INTERRUPTION);
      const callsBeforeResume = guardCalls;

      refuse = true;
      await expect(
        createExecutor(fixture, { guards }).resume(fixture.transactionId),
      ).rejects.toMatchObject({ code: 3 });

      expect(guardCalls).toBeGreaterThan(callsBeforeResume);
      await expectBytes(targetPath, ORIGINAL_BYTES);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('rejects a tampered staged payload before target mutation', async () => {
    const fixture = await createFixture('staged-payload-tamper');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const stagedPath = join(
      fixture.stagingDir,
      'transactions',
      fixture.transactionId,
      '0.bin',
    );

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'staged');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(replacePlan(targetPath)),
      ).rejects.toBe(PHASE_INTERRUPTION);

      await nodeFs.writeFile(stagedPath, USER_BYTES);

      await expect(
        createExecutor(fixture).resume(fixture.transactionId),
      ).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
      await expectBytes(targetPath, ORIGINAL_BYTES);
      expect(await readMode(targetPath)).toBe(ORIGINAL_MODE);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('rejects a staged payload symlink even when outside bytes are exact', async () => {
    const fixture = await createFixture('staged-payload-symlink');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const stagedPath = join(
      fixture.stagingDir,
      'transactions',
      fixture.transactionId,
      '0.bin',
    );
    const outsidePath = join(fixture.root, 'outside-desired.bin');

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'staged');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(replacePlan(targetPath)),
      ).rejects.toBe(PHASE_INTERRUPTION);
      await nodeFs.writeFile(outsidePath, NEW_BYTES);
      await nodeFs.unlink(stagedPath);
      await nodeFs.symlink(outsidePath, stagedPath);

      await expect(
        createExecutor(fixture).resume(fixture.transactionId),
      ).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
      expect((await nodeFs.lstat(stagedPath)).isSymbolicLink()).toBe(true);
      await expectBytes(outsidePath, NEW_BYTES);
      await expectBytes(targetPath, ORIGINAL_BYTES);
      expect(await readMode(targetPath)).toBe(ORIGINAL_MODE);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('rejects a backup payload symlink even when outside bytes are exact', async () => {
    const fixture = await createFixture('backup-payload-symlink');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const backupPath = join(
      fixture.backupsDir,
      'transactions',
      fixture.transactionId,
      '0.bin',
    );
    const outsidePath = join(fixture.root, 'outside-original.bin');

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'applied');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(replacePlan(targetPath)),
      ).rejects.toBe(PHASE_INTERRUPTION);
      await nodeFs.writeFile(outsidePath, ORIGINAL_BYTES);
      await nodeFs.unlink(backupPath);
      await nodeFs.symlink(outsidePath, backupPath);

      await expect(
        createExecutor(fixture).rollback(fixture.transactionId),
      ).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
      expect((await nodeFs.lstat(backupPath)).isSymbolicLink()).toBe(true);
      await expectBytes(outsidePath, ORIGINAL_BYTES);
      await expectBytes(targetPath, NEW_BYTES);
      expect(await readMode(targetPath)).toBe(ORIGINAL_MODE);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('rejects a backup metadata symlink even when outside metadata is exact', async () => {
    const fixture = await createFixture('backup-metadata-symlink');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const metadataPath = join(
      fixture.backupsDir,
      'transactions',
      fixture.transactionId,
      '0.json',
    );
    const outsidePath = join(fixture.root, 'outside-metadata.json');

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'applied');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(replacePlan(targetPath)),
      ).rejects.toBe(PHASE_INTERRUPTION);
      const exactMetadata = await nodeFs.readFile(metadataPath);
      await nodeFs.writeFile(outsidePath, exactMetadata);
      await nodeFs.unlink(metadataPath);
      await nodeFs.symlink(outsidePath, metadataPath);

      await expect(
        createExecutor(fixture).rollback(fixture.transactionId),
      ).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
      expect((await nodeFs.lstat(metadataPath)).isSymbolicLink()).toBe(true);
      await expectBytes(outsidePath, exactMetadata);
      await expectBytes(targetPath, NEW_BYTES);
      expect(await readMode(targetPath)).toBe(ORIGINAL_MODE);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('rejects a symlink replacing the complete staged transaction directory', async () => {
    const fixture = await createFixture('staged-directory-symlink');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const stagedDirectory = join(
      fixture.stagingDir,
      'transactions',
      fixture.transactionId,
    );
    const movedDirectory = join(fixture.root, 'moved-staged-transaction');

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'staged');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(replacePlan(targetPath)),
      ).rejects.toBe(PHASE_INTERRUPTION);
      await nodeFs.rename(stagedDirectory, movedDirectory);
      await nodeFs.symlink(movedDirectory, stagedDirectory);

      await expect(
        createExecutor(fixture).resume(fixture.transactionId),
      ).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
      expect((await nodeFs.lstat(stagedDirectory)).isSymbolicLink()).toBe(true);
      await expectBytes(join(movedDirectory, '0.bin'), NEW_BYTES);
      await expectBytes(targetPath, ORIGINAL_BYTES);
      expect(await readMode(targetPath)).toBe(ORIGINAL_MODE);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('locks a transaction across resume so concurrent rollback cannot reach targets', async () => {
    const fixture = await createFixture('resume-rollback-lock');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const guardEntered = deferredSignal();
    const releaseGuard = deferredSignal();
    let rollbackGuardCalls = 0;

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'validated');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(replacePlan(targetPath)),
      ).rejects.toBe(PHASE_INTERRUPTION);

      const resumeGuards: TransactionGuards = {
        assertTarget: async () => {
          guardEntered.resolve();
          await releaseGuard.promise;
        },
        redactDiagnostic: () => 'synthetic resume guard',
      };
      const rollbackGuards: TransactionGuards = {
        assertTarget: () => {
          rollbackGuardCalls += 1;
          return Promise.resolve();
        },
        redactDiagnostic: () => 'synthetic rollback guard',
      };

      const resumePromise = createExecutor(fixture, {
        guards: resumeGuards,
      }).resume(fixture.transactionId);
      await bounded(guardEntered.promise);

      let rollbackError: unknown;
      try {
        await bounded(
          createExecutor(fixture, { guards: rollbackGuards }).rollback(
            fixture.transactionId,
          ),
        );
      } catch (error) {
        rollbackError = error;
      } finally {
        releaseGuard.resolve();
      }

      let resumed: TransactionJournalV1 | undefined;
      let resumeError: unknown;
      try {
        resumed = await bounded(resumePromise);
      } catch (error) {
        resumeError = error;
      }
      expect(rollbackError).toMatchObject({
        code: EXIT_CODES.recoveryRequired,
      });
      expect(rollbackGuardCalls).toBe(0);
      expect(resumeError).toBeUndefined();
      expect(resumed?.phase).toBe('finalized');
      const persisted = await new TransactionStore({
        stateDir: fixture.stateDir,
        fs: nodeFs,
        lockProvider: fixture.lockProvider,
      }).read(fixture.transactionId);
      expect(persisted.phase).toBe('finalized');
      await expectBytes(targetPath, NEW_BYTES);
    } finally {
      releaseGuard.resolve();
      await removeFixture(fixture);
    }
  });

  it('propagates a security refusal for symlink drift before target mutation', async () => {
    const fixture = await createFixture('resume-symlink-guard');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const outsidePath = join(fixture.root, 'synthetic-outside.bin');

    try {
      await installOriginal(targetPath);
      await nodeFs.writeFile(outsidePath, USER_BYTES);
      const afterPhase = interruptAfter(fixture, 'validated');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(replacePlan(targetPath)),
      ).rejects.toBe(PHASE_INTERRUPTION);

      await nodeFs.unlink(targetPath);
      await nodeFs.symlink(outsidePath, targetPath);
      const workspaceRealPath = await nodeFs.realpath(fixture.workspaceDir);
      const guards: TransactionGuards = {
        assertTarget: async (candidate) => {
          const candidateRealPath = await nodeFs.realpath(candidate);
          if (!candidateRealPath.startsWith(`${workspaceRealPath}${sep}`)) {
            throw Object.assign(new Error('synthetic security refusal'), {
              code: EXIT_CODES.securityRefusal,
            });
          }
        },
        redactDiagnostic: () => 'synthetic security refusal',
      };

      await expect(
        createExecutor(fixture, { guards }).resume(fixture.transactionId),
      ).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
      expect((await nodeFs.lstat(targetPath)).isSymbolicLink()).toBe(true);
      expect(await nodeFs.readlink(targetPath)).toBe(outsidePath);
      await expectBytes(outsidePath, USER_BYTES);
    } finally {
      await removeFixture(fixture);
    }
  });
});

describe('transaction lock provider contract', () => {
  it('holds one provider handle across guards, every phase hook, and target mutation', async () => {
    const fixture = await createFixture('provider-scope');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const lockPath = canonicalLockPath(fixture);
    const observedPhases: TransactionPhase[] = [];

    try {
      await installOriginal(targetPath);
      const guards: TransactionGuards = {
        assertTarget: () => {
          expect(fixture.lockProvider.isHeld(lockPath)).toBe(true);
          return Promise.resolve();
        },
        redactDiagnostic: (text) => text,
      };
      const journal = await createExecutor(fixture, {
        guards,
        afterPhase: async (phase) => {
          expect(fixture.lockProvider.isHeld(lockPath)).toBe(true);
          observedPhases.push(phase);
          if (
            phase === 'applied' ||
            phase === 'verified' ||
            phase === 'finalized'
          ) {
            await expectBytes(targetPath, NEW_BYTES);
          }
        },
      }).execute(replacePlan(targetPath));

      expect(journal.phase).toBe('finalized');
      expect(observedPhases).toStrictEqual([
        'planned',
        'backed_up',
        'staged',
        'validated',
        'applied',
        'verified',
        'finalized',
      ]);
      expect(fixture.lockProvider.acquisitions).toStrictEqual([lockPath]);
      expect(fixture.lockProvider.releaseAttempts).toStrictEqual([lockPath]);
      expect(fixture.lockProvider.releases).toStrictEqual([lockPath]);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('reuses the held handle for same-store same-id calls', async () => {
    const fixture = await createFixture('provider-reentrant');
    const lockPath = canonicalLockPath(fixture);
    const store = new TransactionStore({
      stateDir: fixture.stateDir,
      fs: nodeFs,
      lockProvider: fixture.lockProvider,
    });

    try {
      await store.withTransactionLock(fixture.transactionId, async () => {
        await store.create(plannedJournal(fixture.transactionId));
        expect((await store.read(fixture.transactionId)).phase).toBe('planned');
        await store.transition(
          fixture.transactionId,
          'planned',
          'backed_up',
          '2026-07-22T12:01:00.000Z',
        );
      });

      expect(fixture.lockProvider.acquisitions).toStrictEqual([lockPath]);
      expect(fixture.lockProvider.releases).toStrictEqual([lockPath]);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('reacquires after an async descendant escapes the released outer scope', async () => {
    const fixture = await createFixture('provider-escaped-context');
    const lockPath = canonicalLockPath(fixture);
    const resumeDescendant = deferredSignal();
    const store = new TransactionStore({
      stateDir: fixture.stateDir,
      fs: nodeFs,
      lockProvider: fixture.lockProvider,
    });
    let descendant: Promise<TransactionJournalV1> | undefined;

    try {
      await store.withTransactionLock(fixture.transactionId, async () => {
        await store.create(plannedJournal(fixture.transactionId));
        descendant = resumeDescendant.promise.then(() =>
          store.read(fixture.transactionId),
        );
      });

      expect(fixture.lockProvider.acquisitions).toStrictEqual([lockPath]);
      expect(fixture.lockProvider.releases).toStrictEqual([lockPath]);

      resumeDescendant.resolve();
      expect((await descendant)?.phase).toBe('planned');
      expect(fixture.lockProvider.acquisitions).toStrictEqual([
        lockPath,
        lockPath,
      ]);
      expect(fixture.lockProvider.releases).toStrictEqual([
        lockPath,
        lockPath,
      ]);
    } finally {
      resumeDescendant.resolve();
      await descendant?.catch(() => undefined);
      await removeFixture(fixture);
    }
  });

  it('rejects a second store before journal reads, guards, or target mutation', async () => {
    const fixture = await createFixture('provider-contention');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const entered = deferredSignal();
    const releaseOwner = deferredSignal();
    let secondGuardCalls = 0;
    let secondJournalReads = 0;
    const observingReadFile = (async (
      ...args: Parameters<typeof nodeFs.readFile>
    ) => {
        if (
          typeof args[0] === 'string' &&
          args[0].endsWith(`${fixture.transactionId}.json`)
        ) {
        secondJournalReads += 1;
      }
      return nodeFs.readFile(...args);
    }) as typeof nodeFs.readFile;
    const observingFs: TransactionFileSystem = {
      ...nodeFs,
      readFile: observingReadFile,
    };

    try {
      await installOriginal(targetPath);
      await expect(
        createExecutor(fixture, {
          afterPhase: interruptAfter(fixture, 'validated'),
        }).execute(replacePlan(targetPath)),
      ).rejects.toBe(PHASE_INTERRUPTION);

      const first = createExecutor(fixture, {
        guards: {
          assertTarget: async () => {
            entered.resolve();
            await releaseOwner.promise;
          },
          redactDiagnostic: (text) => text,
        },
      }).resume(fixture.transactionId);
      await bounded(entered.promise);

      await expect(
        createExecutor(fixture, {
          fs: observingFs,
          guards: {
            assertTarget: () => {
              secondGuardCalls += 1;
              return Promise.resolve();
            },
            redactDiagnostic: (text) => text,
          },
        }).rollback(fixture.transactionId),
      ).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });

      expect(secondJournalReads).toBe(0);
      expect(secondGuardCalls).toBe(0);
      await expectBytes(targetPath, ORIGINAL_BYTES);
      releaseOwner.resolve();
      expect((await bounded(first)).phase).toBe('finalized');
    } finally {
      releaseOwner.resolve();
      await removeFixture(fixture);
    }
  });

  it('maps acquisition failure and an invalid handle to code 6 before work', async () => {
    const fixture = await createFixture('provider-acquire-failure');
    let operationCalls = 0;
    const failedProvider = new DeterministicTransactionLockProvider({
      acquireFailure: new Error('synthetic provider detail'),
    });
    const invalidProvider: TransactionLockProvider = {
      acquire: () => Promise.resolve({} as TransactionLockHandle),
    };

    try {
      for (const lockProvider of [failedProvider, invalidProvider]) {
        const store = new TransactionStore({
          stateDir: fixture.stateDir,
          fs: nodeFs,
          lockProvider,
        });
        await expect(
          store.withTransactionLock(fixture.transactionId, () => {
            operationCalls += 1;
            return Promise.resolve();
          }),
        ).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
      }
      expect(operationCalls).toBe(0);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('maps release failure to code 6 but preserves an earlier transaction error', async () => {
    const fixture = await createFixture('provider-release-failure');
    const primaryError = Object.assign(new Error('synthetic primary failure'), {
      code: EXIT_CODES.securityRefusal,
    });

    try {
      const failedReleaseStore = new TransactionStore({
        stateDir: fixture.stateDir,
        fs: nodeFs,
        lockProvider: new DeterministicTransactionLockProvider({
          releaseFailure: new Error('synthetic release detail'),
        }),
      });
      await expect(
        failedReleaseStore.withTransactionLock(
          fixture.transactionId,
          () => Promise.resolve('completed'),
        ),
      ).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });

      const preservingStore = new TransactionStore({
        stateDir: fixture.stateDir,
        fs: nodeFs,
        lockProvider: new DeterministicTransactionLockProvider({
          releaseFailure: new Error('synthetic release detail'),
        }),
      });
      await expect(
        preservingStore.withTransactionLock(fixture.transactionId, () => {
          throw primaryError;
        }),
      ).rejects.toBe(primaryError);
    } finally {
      await removeFixture(fixture);
    }
  });
});

describe('transaction persistence', () => {
  const invalidPersistedJournals: ReadonlyArray<{
    readonly name: string;
    readonly journal: TransactionJournalV1;
  }> = [
    {
      name: 'a traversing stagedRelativePath',
      journal: validPersistedJournal([
        validPersistedMutation({ stagedRelativePath: '../../outside.bin' }),
      ]),
    },
    {
      name: 'a non-deterministic stagedRelativePath for its mutation index',
      journal: validPersistedJournal([
        validPersistedMutation({ stagedRelativePath: '1.bin' }),
      ]),
    },
    {
      name: 'a relative targetPath',
      journal: validPersistedJournal([
        validPersistedMutation({ targetPath: 'relative/config.bin' }),
      ]),
    },
    {
      name: 'a NUL-containing targetPath',
      journal: validPersistedJournal([
        validPersistedMutation({
          targetPath: '/synthetic/workspace/\u0000config.bin',
        }),
      ]),
    },
    {
      name: 'a create mutation with a non-null expectedBeforeHash',
      journal: validPersistedJournal([
        validPersistedMutation({ operation: 'create' }),
      ]),
    },
    {
      name: 'a create mutation with a null stagedRelativePath',
      journal: validPersistedJournal([
        validPersistedMutation({
          operation: 'create',
          expectedBeforeHash: null,
          stagedRelativePath: null,
        }),
      ]),
    },
    {
      name: 'a replace mutation with a null expectedBeforeHash',
      journal: validPersistedJournal([
        validPersistedMutation({ expectedBeforeHash: null }),
      ]),
    },
    {
      name: 'a replace mutation with a null stagedRelativePath',
      journal: validPersistedJournal([
        validPersistedMutation({ stagedRelativePath: null }),
      ]),
    },
    {
      name: 'a remove mutation with a non-null stagedRelativePath',
      journal: validPersistedJournal([
        validPersistedMutation({ operation: 'remove' }),
      ]),
    },
    {
      name: 'duplicate target paths',
      journal: validPersistedJournal([
        validPersistedMutation(),
        validPersistedMutation({ stagedRelativePath: '1.bin' }),
      ]),
    },
  ];

  it('accepts the valid persisted-journal baseline', () => {
    expect(validateJournal(validPersistedJournal())).toStrictEqual(
      validPersistedJournal(),
    );
  });

  it.each(invalidPersistedJournals)('rejects $name', ({ journal }) => {
    expect(() => validateJournal(journal)).toThrow();
  });

  it('writes an exact v1 journal at 0600, transaction dirs at 0700, and no temp journal', async () => {
    const fixture = await createFixture('persistence-contract');
    const targetPath = join(fixture.workspaceDir, 'config.bin');

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'staged');
      await expect(
        createExecutor(fixture, {
          afterPhase,
          lockProvider: new DeterministicTransactionLockProvider({
            materializeLockFile: true,
          }),
        }).execute(replacePlan(targetPath)),
      ).rejects.toBe(PHASE_INTERRUPTION);

      const serializedJournal = await nodeFs.readFile(
        journalPath(fixture),
        'utf8',
      );
      const persisted = JSON.parse(serializedJournal) as TransactionJournalV1;
      expect(Object.keys(persisted).sort()).toStrictEqual([
        'createdAt',
        'id',
        'kind',
        'mutations',
        'phase',
        'schemaVersion',
        'updatedAt',
      ]);
      expect(persisted.schemaVersion).toBe(1);
      expect(persisted.id).toBe(fixture.transactionId);
      expect(persisted.kind).toBe('replace-test');
      expect(persisted.phase).toBe('staged');
      expect(persisted.createdAt).toMatch(/^2026-07-22T12:/);
      expect(persisted.updatedAt).toMatch(/^2026-07-22T12:/);
      expect(persisted.mutations).toHaveLength(1);
      const persistedMutation = persisted.mutations[0];
      expect(persistedMutation).toBeDefined();
      if (persistedMutation === undefined) {
        throw new Error('missing persisted mutation');
      }
      expect(Object.keys(persistedMutation).sort()).toStrictEqual([
        'expectedBeforeHash',
        'operation',
        'stagedRelativePath',
        'targetPath',
      ]);
      expect(persistedMutation.targetPath).toBe(targetPath);
      expect(persistedMutation.operation).toBe('replace');
      expect(persistedMutation.expectedBeforeHash).toMatch(/^[a-f0-9]{64}$/);
      expect(persistedMutation.stagedRelativePath).toBe('0.bin');
      expect(serializedJournal).not.toContain(
        JSON.stringify([...ORIGINAL_BYTES]),
      );
      expect(serializedJournal).not.toContain(JSON.stringify([...NEW_BYTES]));
      expect(serializedJournal).not.toContain(ORIGINAL_FIXTURE_LABEL);
      expect(serializedJournal).not.toContain(NEW_FIXTURE_LABEL);

      expect(await readMode(journalPath(fixture))).toBe(0o600);
      expect(
        await readMode(
          join(fixture.stagingDir, 'transactions', fixture.transactionId),
        ),
      ).toBe(0o700);
      expect(
        await readMode(
          join(fixture.backupsDir, 'transactions', fixture.transactionId),
        ),
      ).toBe(0o700);
      expect(
        await readMode(
          join(
            fixture.stagingDir,
            'transactions',
            fixture.transactionId,
            '0.bin',
          ),
        ),
      ).toBe(0o600);
      expect(
        await readMode(
          join(
            fixture.backupsDir,
            'transactions',
            fixture.transactionId,
            '0.bin',
          ),
        ),
      ).toBe(0o600);
      expect(
        await readMode(
          join(
            fixture.backupsDir,
            'transactions',
            fixture.transactionId,
            '0.json',
          ),
        ),
      ).toBe(0o600);

      const journalDirectory = join(fixture.stateDir, 'transactions');
      expect((await nodeFs.readdir(journalDirectory)).sort()).toStrictEqual([
        `.${fixture.transactionId}.lock`,
        `${fixture.transactionId}.json`,
      ]);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('rejects skipped, backward, stale, and terminal journal transitions', async () => {
    const fixture = await createFixture('store-transitions');
    const store = new TransactionStore({
      stateDir: fixture.stateDir,
      fs: nodeFs,
      lockProvider: fixture.lockProvider,
    });
    const id = fixture.transactionId;

    try {
      await store.create(plannedJournal(id));
      expect(await store.read(id)).toStrictEqual(plannedJournal(id));

      await expect(
        store.transition(
          id,
          'planned',
          'staged',
          '2026-07-22T12:01:00.000Z',
        ),
      ).rejects.toThrow();

      await store.transition(
        id,
        'planned',
        'backed_up',
        '2026-07-22T12:01:00.000Z',
      );

      await expect(
        store.transition(
          id,
          'backed_up',
          'planned',
          '2026-07-22T12:02:00.000Z',
        ),
      ).rejects.toThrow();
      await expect(
        store.transition(
          id,
          'planned',
          'staged',
          '2026-07-22T12:02:00.000Z',
        ),
      ).rejects.toThrow();

      const forwardPhases = [
        'staged',
        'validated',
        'applied',
        'verified',
        'finalized',
      ] as const;
      let current: TransactionPhase = 'backed_up';
      for (const next of forwardPhases) {
        await store.transition(
          id,
          current,
          next,
          '2026-07-22T12:03:00.000Z',
        );
        current = next;
      }

      await expect(
        store.transition(
          id,
          'finalized',
          'rolled_back',
          '2026-07-22T12:04:00.000Z',
        ),
      ).rejects.toThrow();

      const rolledBackId = 'tx-rolled-back';
      await store.create(plannedJournal(rolledBackId));
      await store.transition(
        rolledBackId,
        'planned',
        'rolled_back',
        '2026-07-22T12:05:00.000Z',
      );
      await expect(
        store.transition(
          rolledBackId,
          'rolled_back',
          'finalized',
          '2026-07-22T12:06:00.000Z',
        ),
      ).rejects.toThrow();
    } finally {
      await removeFixture(fixture);
    }
  });
});

describe('recoverTransaction', () => {
  it('reports resumed and rolled-back actions with their final phases', async () => {
    const resumeFixture = await createFixture('recovery-wrapper-resume');
    const rollbackFixture = await createFixture('recovery-wrapper-rollback');
    const resumeTarget = join(resumeFixture.workspaceDir, 'config.bin');
    const rollbackTarget = join(rollbackFixture.workspaceDir, 'config.bin');

    try {
      await installOriginal(resumeTarget);
      await installOriginal(rollbackTarget);

      await expect(
        createExecutor(resumeFixture, {
          afterPhase: interruptAfter(resumeFixture, 'backed_up'),
        }).execute(replacePlan(resumeTarget)),
      ).rejects.toBe(PHASE_INTERRUPTION);
      await expect(
        createExecutor(rollbackFixture, {
          afterPhase: interruptAfter(rollbackFixture, 'backed_up'),
        }).execute(replacePlan(rollbackTarget)),
      ).rejects.toBe(PHASE_INTERRUPTION);

      const resumed: TransactionRecoveryResult = await recoverTransaction({
        executor: createExecutor(resumeFixture),
        id: resumeFixture.transactionId,
        action: 'resume',
      });
      const rolledBack: TransactionRecoveryResult = await recoverTransaction({
        executor: createExecutor(rollbackFixture),
        id: rollbackFixture.transactionId,
        action: 'rollback',
      });

      expect(resumed).toStrictEqual({
        id: resumeFixture.transactionId,
        action: 'resumed',
        phase: 'finalized',
      });
      expect(rolledBack).toStrictEqual({
        id: rollbackFixture.transactionId,
        action: 'rolled_back',
        phase: 'rolled_back',
      });
    } finally {
      await Promise.all([
        removeFixture(resumeFixture),
        removeFixture(rollbackFixture),
      ]);
    }
  });
});
