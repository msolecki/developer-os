import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXIT_CODES } from '../result.js';
import {
  recoverTransaction,
  TransactionBackupRetentionError,
  TransactionExecutor,
  TransactionPlanError,
  TransactionPreconditionError,
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

/**
 * **Denies `unlink` inside the backups directory and nowhere else.** The first version
 * matched any path ending in `.bin`, which isolated the backup prune only by accident: the
 * fixture's own target is `config.bin`, and it escaped the deny purely because
 * `replacePlan` never unlinks its target. A `remove`-shaped plan would have landed the
 * deny on the user's file and the test would have passed for the wrong reason.
 *
 * **Both conditions, and the second is not redundant.** Anchoring on the directory alone
 * also denies the `.tmp` unlink inside `writeDurableFile`, which `backUp` uses to write the
 * payloads in the first place — the fixture then failed in `backUp` with a
 * `TransactionStateError` and never reached the prune at all. `payloads` names what the
 * prune removes: `<index>.bin`, under the backups directory.
 */
function denyingUnlinkUnder(
  directory: string,
  payloads = '.bin',
): TransactionFileSystem {
  return {
    ...nodeFs,
    unlink: (path: Parameters<typeof nodeFs.unlink>[0]) =>
      String(path).startsWith(directory) && String(path).endsWith(payloads)
        ? Promise.reject(
            Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
          )
        : nodeFs.unlink(path),
  };
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

describe('a precondition the caller read', () => {
  /**
   * **The window this closes.** The executor snapshots the target when `execute()` runs, so
   * everything between a caller's own read and that snapshot is invisible to it. For
   * `capture` that is benign — spec §5.2 wants an `O_EXCL` create no transaction-mediated
   * write can deliver, and colliding captures are byte-identical because the id *is* the
   * content hash. For `review --decision edit` it is not: the file is read, re-redacted and
   * written back, and what the window discards is the user's own hand edit, in the one verb
   * that exists to bring a hand edit under this product's guarantees.
   */
  it('refuses when the target changed between the caller read and the execute', async () => {
    const fixture = await createFixture('precondition-changed');
    const targetPath = join(fixture.workspaceDir, 'config.bin');

    try {
      await installOriginal(targetPath);
      /** What the caller read, hashed — and then somebody else writes. */
      const asRead = createHash('sha256').update(ORIGINAL_BYTES).digest('hex');
      await nodeFs.writeFile(targetPath, new TextEncoder().encode('edited by hand'));

      await expect(
        createExecutor(fixture).execute({
          kind: 'replace-test',
          mutations: [
            {
              targetPath,
              operation: 'replace',
              content: NEW_BYTES,
              expectedBeforeHash: asRead,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(TransactionPreconditionError);

      /** And the hand edit is still there: the refusal happens before anything is staged. */
      await expect(nodeFs.readFile(targetPath, 'utf8')).resolves.toBe('edited by hand');
    } finally {
      await removeFixture(fixture);
    }
  });

  /**
   * **Absence keeps the previous behaviour exactly**, which is what makes the field additive.
   * `capture` supplies none and wants none. This must pass on the first run, before the
   * executor honours anything — it is the assertion that the other two tests are the change.
   */
  it('computes its own precondition when the caller supplies none', async () => {
    const fixture = await createFixture('precondition-absent');
    const targetPath = join(fixture.workspaceDir, 'config.bin');

    try {
      await installOriginal(targetPath);

      await expect(
        createExecutor(fixture).execute(replacePlan(targetPath)),
      ).resolves.toMatchObject({ phase: 'finalized' });
    } finally {
      await removeFixture(fixture);
    }
  });

  /**
   * **A supplied hash against a *created* target is a mismatch.** A `create` observes no
   * bytes, so a caller that supplies a precondition for one is describing a file it thinks
   * exists — and this is the case where "no bytes" must not read as "no precondition". The
   * `replace`-with-missing-target case is deliberately *not* the test for this: the plan
   * phase already refuses that as a plan error, so it would pass with the precondition
   * ignored entirely, which is how the first version of this case was vacuous.
   */
  it('refuses a supplied precondition on a create, which observes no bytes', async () => {
    const fixture = await createFixture('precondition-create');
    const targetPath = join(fixture.workspaceDir, 'fresh.bin');

    try {
      await nodeFs.mkdir(fixture.workspaceDir, { recursive: true });
      const asRead = createHash('sha256').update(ORIGINAL_BYTES).digest('hex');

      await expect(
        createExecutor(fixture).execute({
          kind: 'create-test',
          mutations: [
            {
              targetPath,
              operation: 'create',
              content: NEW_BYTES,
              expectedBeforeHash: asRead,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(TransactionPreconditionError);

      await expectMissing(targetPath);
    } finally {
      await removeFixture(fixture);
    }
  });

  /**
   * **A misspelled precondition is refused, not ignored.** The plan validator checks exact
   * keys, and teaching it this field meant widening that check — so the plan carrying
   * `expectedBeforeHsh` must still be a plan error rather than one that silently executes
   * with no precondition at all, which is the failure the widening could have introduced.
   */
  it.each([
    ['a misspelled key', { expectedBeforeHsh: 'abc' }],
    ['a non-string hash', { expectedBeforeHash: 7 }],
    /**
     * The empty string is the shape a caller-side bug actually produces — a digest variable
     * that was declared and never assigned. Accepting it means every call refuses for ever
     * with a message saying the file changed, which is the failure this field spent a review
     * round on; refusing it says so at the first call.
     */
    ['an empty hash', { expectedBeforeHash: '' }],
    ['a hash that is not hex', { expectedBeforeHash: 'z'.repeat(64) }],
    ['a hash of the wrong length', { expectedBeforeHash: 'a'.repeat(63) }],
  ])('refuses %s on a planned mutation', async (_name, extra) => {
    const fixture = await createFixture('precondition-shape');
    const targetPath = join(fixture.workspaceDir, 'config.bin');

    try {
      await installOriginal(targetPath);

      await expect(
        createExecutor(fixture).execute({
          kind: 'replace-test',
          mutations: [
            {
              targetPath,
              operation: 'replace',
              content: NEW_BYTES,
              ...extra,
            } as unknown as PlannedFileMutation,
          ],
        }),
      ).rejects.toBeInstanceOf(TransactionPlanError);
    } finally {
      await removeFixture(fixture);
    }
  });
});

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

  /**
   * **`review --decision edit` exists to remove a secret a user pasted into a vault file
   * by hand — and `backUp` writes that file, raw, to the backup directory before the edit
   * lands, where nothing ever removed it** (BACKLOG, Foundation request 2).
   *
   * They are dead bytes from `finalized` onward: `rollbackLocked` throws on a finalized
   * journal, so nothing in this product can ever read them again. Retaining them undoes
   * the one operation whose whole purpose is removal.
   */
  it('removes the backup payloads once the transaction finalizes', async () => {
    const fixture = await createFixture('backup-pruned-on-finalize');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const backupPath = join(
      fixture.backupsDir,
      'transactions',
      fixture.transactionId,
      '0.bin',
    );

    try {
      await installOriginal(targetPath);
      const journal = await createExecutor(fixture).execute(replacePlan(targetPath));

      expect(journal.phase).toBe('finalized');
      await expect(nodeFs.stat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' });
      /**
       * **The metadata survives, deliberately.** It carries `{existed, mode, atimeMs,
       * mtimeMs}` and no bytes, and it is how a rewound-and-resumed journal learns whether
       * a target existed — which is how eighteen e2e cases build their fixtures. Deleting
       * a description of bytes that are gone buys nothing and costs that.
       */
      await expect(
        nodeFs.stat(backupPath.replace(/\.bin$/u, '.json')),
      ).resolves.toBeDefined();
    } finally {
      await removeFixture(fixture);
    }
  });

  /**
   * **The ordering, pinned — and nothing pinned it until this existed.** Moving the prune
   * *before* the transition leaves the happy path identical, so mutation testing found it
   * green. The difference is only visible in the crash window between the two.
   *
   * **This case used to stop here, asserting the payload survives the crash — which was
   * pinning the defect as the desired outcome.** Every recovery path refused a finalized
   * journal, so those bytes were stranded permanently while the product reported success.
   * The ordering is still right; what was missing is the sweep, so the case now asserts
   * both halves: the payload survives the crash *and* a later resume removes it.
   */
  it('prunes after the finalized transition, and a later resume sweeps the crash window', async () => {
    const fixture = await createFixture('backup-prune-ordering');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const backupPath = join(
      fixture.backupsDir,
      'transactions',
      fixture.transactionId,
      '0.bin',
    );

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'finalized');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(replacePlan(targetPath)),
      ).rejects.toThrow();

      /** The transition landed; the prune did not. The payload is still on disk. */
      await expect(nodeFs.stat(backupPath)).resolves.toBeDefined();

      /**
       * And `repair --resume` on a finalized transaction is no longer a no-op: it is the
       * one path that can reach this state, so it is the one that has to clean it.
       */
      const resumed = await createExecutor(fixture).resume(fixture.transactionId);
      expect(resumed.phase).toBe('finalized');
      await expect(nodeFs.stat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await removeFixture(fixture);
    }
  });

  /**
   * **The mirror crash window, on the rollback side.** `rollbackLocked`'s early return was
   * the same omission as the finalized one, and worse in effect: a retried `rollback`
   * returned `rolled_back` *successfully* while doing nothing, so a user told the command
   * failed would run it again, be told it worked, and still have the payload on disk.
   */
  it('sweeps the rolled-back crash window on a later rollback', async () => {
    const fixture = await createFixture('backup-rollback-crash-window');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const backupPath = join(
      fixture.backupsDir,
      'transactions',
      fixture.transactionId,
      '0.bin',
    );

    try {
      await installOriginal(targetPath);
      const stop = interruptAfter(fixture, 'applied');
      await expect(
        createExecutor(fixture, { afterPhase: stop }).execute(replacePlan(targetPath)),
      ).rejects.toThrow();

      /** Crash between the rolled_back transition and the prune. */
      const crash = interruptAfter(fixture, 'rolled_back');
      await expect(
        createExecutor(fixture, { afterPhase: crash }).rollback(fixture.transactionId),
      ).rejects.toThrow();
      await expect(nodeFs.stat(backupPath)).resolves.toBeDefined();

      const swept = await createExecutor(fixture).rollback(fixture.transactionId);

      expect(swept.phase).toBe('rolled_back');
      await expect(nodeFs.stat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await removeFixture(fixture);
    }
  });

  /**
   * **`execute` does not raise on a payload it could not remove, and that is the fix rather
   * than the hole.** A blanket catch made an `EACCES` on a non-writable backups directory a
   * silent no-op, so the first fix raised — from every prune site, including this one. That
   * was worse: `execute` has seven call sites across six commands and all read a throw as "the transaction
   * did not happen", which is the one thing this failure does not mean. `reindex` skipped
   * `recordArtifacts`, `uninstall` skipped its manifest removal, and `ingest` reported
   * `ok: false` for captures that had all landed (found by fresh-context review,
   * 2026-08-17).
   *
   * So the forward path retains and `doctor`'s transactions check reports it — asserted in
   * `doctor.test.ts`, because a retention nothing surfaces is the original defect back.
   * The case below is the other half: `repair`'s paths still raise.
   */
  it('retains a payload it could not remove without failing the applied change', async () => {
    const fixture = await createFixture('backup-prune-denied');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const backupPath = join(
      fixture.backupsDir,
      'transactions',
      fixture.transactionId,
      '0.bin',
    );

    try {
      await installOriginal(targetPath);
      const journal = await createExecutor(fixture, {
        fs: denyingUnlinkUnder(fixture.backupsDir),
      }).execute(replacePlan(targetPath));

      /** The transaction is complete and the user's file is correct. */
      expect(journal.phase).toBe('finalized');
      expect(await nodeFs.readFile(targetPath, 'utf8')).not.toBe(ORIGINAL_FIXTURE_LABEL);
      /** And the payload is still there, which is the thing `doctor` has to see. */
      await expect(nodeFs.stat(backupPath)).resolves.toBeDefined();
    } finally {
      await removeFixture(fixture);
    }
  });

  /**
   * **The half that raises: `repair`.** `resume` on a terminal journal and both of
   * `rollback`'s prune sites are reached only through `recoverTransaction`, whose only
   * entry point is the `repair` command — nothing downstream has bookkeeping left to skip,
   * so "applied, but a payload survived" is the only thing a throw can mean there.
   *
   * `TransactionStateError` was what this raised first, and its message claims the
   * transaction is malformed when the journal is terminal and the user's file is correct.
   */
  it('raises on the repair path, naming the payload and the applied change', async () => {
    const fixture = await createFixture('backup-prune-denied-repair');
    const targetPath = join(fixture.workspaceDir, 'config.bin');

    try {
      await installOriginal(targetPath);
      const denying = denyingUnlinkUnder(fixture.backupsDir);
      await createExecutor(fixture, { fs: denying }).execute(replacePlan(targetPath));

      const failure = await createExecutor(fixture, { fs: denying })
        .resume(fixture.transactionId)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(TransactionBackupRetentionError);
      expect((failure as Error).message).toContain('the change was applied');
      expect((failure as Error).message).toContain('0.bin');

      /** And it is recoverable: a resume with a working filesystem clears it. */
      const swept = await createExecutor(fixture).resume(fixture.transactionId);
      expect(swept.phase).toBe('finalized');
    } finally {
      await removeFixture(fixture);
    }
  });

  /**
   * **A rollback did not apply the change, and the message said it did.** The text was
   * hardcoded to "the change was applied" while two of the three raising sites are inside
   * `rollbackLocked` — so a rollback that fully succeeded, with the user's original file
   * restored, was reported as a failure whose sentence claimed the opposite. That is the
   * defect the forward-path retention exists to prevent, relocated from `execute` to
   * `repair` rather than removed (found by fresh-context review, 2026-08-17).
   */
  it('says the change was rolled back when it was, not that it was applied', async () => {
    const fixture = await createFixture('backup-prune-denied-rollback');
    const targetPath = join(fixture.workspaceDir, 'config.bin');

    try {
      await installOriginal(targetPath);
      const stop = interruptAfter(fixture, 'applied');
      await expect(
        createExecutor(fixture, { afterPhase: stop }).execute(replacePlan(targetPath)),
      ).rejects.toThrow();

      const failure = await createExecutor(fixture, {
        fs: denyingUnlinkUnder(fixture.backupsDir),
      })
        .rollback(fixture.transactionId)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(TransactionBackupRetentionError);
      expect((failure as Error).message).toContain('the change was rolled back');
      expect((failure as Error).message).not.toContain('the change was applied');
      /** And it really was rolled back: the user's original bytes are back. */
      expect(await nodeFs.readFile(targetPath, 'utf8')).toBe(ORIGINAL_FIXTURE_LABEL);
    } finally {
      await removeFixture(fixture);
    }
  });

  /**
   * **The errno is the only thing from the caught error that reaches the message, and
   * nothing pinned that.** Replacing `errnoOf`'s guarded return with one that appends
   * `error.message` left all 106 cases green — and an fs `unlink` failure's message is
   * `EACCES: permission denied, unlink '/abs/path/.../0.bin'`, which is a second copy of
   * the payload path by a route the caller does not know to redact. The existing
   * `toContain("EACCES")` assertion is satisfied by that longer string too, which is why it
   * could not catch it (found by fresh-context review, 2026-08-17).
   *
   * A `code` that is not a bare errno gets a fixed stand-in rather than being interpolated.
   */
  it('puts the errno in the message and nothing else from the error', async () => {
    const fixture = await createFixture('backup-prune-errno');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const secret = 'sentinel-that-must-not-travel';

    try {
      await installOriginal(targetPath);
      const shouting = {
        ...nodeFs,
        unlink: (path: Parameters<typeof nodeFs.unlink>[0]) =>
          String(path).startsWith(fixture.backupsDir) && String(path).endsWith('.bin')
            ? Promise.reject(
                Object.assign(
                  new Error(`EPERM: operation not permitted, unlink '${secret}'`),
                  { code: 'EPERM' },
                ),
              )
            : nodeFs.unlink(path),
      };
      await createExecutor(fixture, { fs: shouting }).execute(replacePlan(targetPath));

      const failure = await createExecutor(fixture, { fs: shouting })
        .resume(fixture.transactionId)
        .catch((error: unknown) => error);

      expect((failure as Error).message).toContain('(EPERM)');
      expect((failure as Error).message).not.toContain(secret);
      expect((failure as Error).message).not.toContain('operation not permitted');
    } finally {
      await removeFixture(fixture);
    }
  });

  /** A `code` that is not a bare errno is not interpolated into the message either. */
  it('falls back to a fixed phrase when the error carries no errno', async () => {
    const fixture = await createFixture('backup-prune-no-errno');
    const targetPath = join(fixture.workspaceDir, 'config.bin');

    try {
      await installOriginal(targetPath);
      const odd = {
        ...nodeFs,
        unlink: (path: Parameters<typeof nodeFs.unlink>[0]) =>
          String(path).startsWith(fixture.backupsDir) && String(path).endsWith('.bin')
            ? Promise.reject(
                Object.assign(new Error('something went wrong'), {
                  code: 'a sentence, not an errno',
                }),
              )
            : nodeFs.unlink(path),
      };
      await createExecutor(fixture, { fs: odd }).execute(replacePlan(targetPath));

      const failure = await createExecutor(fixture, { fs: odd })
        .resume(fixture.transactionId)
        .catch((error: unknown) => error);

      expect((failure as Error).message).toContain('(unknown error)');
      expect((failure as Error).message).not.toContain('a sentence, not an errno');
    } finally {
      await removeFixture(fixture);
    }
  });

  /**
   * **The same "keep going" rule on the raising path, which nothing pinned.** The case
   * above it drives `execute`, where `raiseOnFailure` is false — so reintroducing a throw
   * inside the loop left all fifty-six core cases green while `repair --resume` on a
   * multi-payload transaction stranded every payload after the first bad one.
   */
  it('keeps pruning past a failure on the repair path too', async () => {
    const fixture = await createFixture('backup-prune-partial-repair');
    const first = join(fixture.workspaceDir, 'config.bin');
    const second = join(fixture.workspaceDir, 'other.bin');
    const backupOf = (index: number): string =>
      join(
        fixture.backupsDir,
        'transactions',
        fixture.transactionId,
        `${String(index)}.bin`,
      );
    const plan = {
      kind: 'replace-test',
      mutations: [
        { targetPath: first, operation: 'replace', content: NEW_BYTES },
        { targetPath: second, operation: 'replace', content: NEW_BYTES },
      ],
    } as const;

    try {
      await installOriginal(first);
      await installOriginal(second);
      /**
       * **Interrupted at `finalized`, so no prune has run yet.** Letting `execute` finish
       * first made this case unable to fail: its forward prune already removed payload 1,
       * so the later `resume` found `ENOENT` either way and a throw reintroduced inside
       * the loop stayed green. The crash window is what leaves both payloads on disk for
       * the raising path to be measured against.
       */
      const stop = interruptAfter(fixture, 'finalized');
      await expect(
        createExecutor(fixture, { afterPhase: stop }).execute(plan),
      ).rejects.toThrow();
      await expect(nodeFs.stat(backupOf(0))).resolves.toBeDefined();
      await expect(nodeFs.stat(backupOf(1))).resolves.toBeDefined();

      const failure = await createExecutor(fixture, {
        fs: denyingUnlinkUnder(fixture.backupsDir, '0.bin'),
      })
        .resume(fixture.transactionId)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(TransactionBackupRetentionError);
      /** Payload 1 is gone even though payload 0 raised. */
      await expect(nodeFs.stat(backupOf(1))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await removeFixture(fixture);
    }
  });

  /**
   * **`<index>.bin.tmp` holds the same bytes and nothing removed it.** `writeDurableFile`
   * writes the payload there before renaming, so a kill inside `backUp` strands the
   * pre-edit file — the secret, in the case this change exists for — under a `.tmp`
   * suffix. `removeOwnedTemp` clears it on a `resume` that re-runs `backUp`, but a
   * `rollback` never re-runs that phase, so `repair --rollback` — the route `doctor` and
   * `init` both print — orphaned it permanently and invisibly.
   */
  it('removes a payload stranded under its .tmp name', async () => {
    const fixture = await createFixture('backup-prune-tmp');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const temporary = join(
      fixture.backupsDir,
      'transactions',
      fixture.transactionId,
      '0.bin.tmp',
    );

    try {
      await installOriginal(targetPath);
      const stop = interruptAfter(fixture, 'applied');
      await expect(
        createExecutor(fixture, { afterPhase: stop }).execute(replacePlan(targetPath)),
      ).rejects.toThrow();
      await nodeFs.writeFile(temporary, ORIGINAL_BYTES);

      const rolled = await createExecutor(fixture).rollback(fixture.transactionId);

      expect(rolled.phase).toBe('rolled_back');
      await expect(nodeFs.stat(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await removeFixture(fixture);
    }
  });

  /**
   * **One payload that cannot be removed must not strand the rest.** The first version
   * threw inside the loop, so a per-file `EACCES` or `EIO` on payload 0 left payloads 1 and
   * 2 on disk untouched — a single-file fault escalating into wholesale retention, on
   * exactly the operation whose purpose is removal.
   */
  it('keeps pruning past a payload it cannot remove', async () => {
    const fixture = await createFixture('backup-prune-partial');
    const first = join(fixture.workspaceDir, 'config.bin');
    const second = join(fixture.workspaceDir, 'other.bin');
    const backupOf = (index: number): string =>
      join(
        fixture.backupsDir,
        'transactions',
        fixture.transactionId,
        `${String(index)}.bin`,
      );

    try {
      await installOriginal(first);
      await installOriginal(second);
      const denying = denyingUnlinkUnder(fixture.backupsDir, '0.bin');

      const journal = await createExecutor(fixture, { fs: denying }).execute({
        kind: 'replace-test',
        mutations: [
          { targetPath: first, operation: 'replace', content: NEW_BYTES },
          { targetPath: second, operation: 'replace', content: NEW_BYTES },
        ],
      });

      expect(journal.phase).toBe('finalized');
      await expect(nodeFs.stat(backupOf(0))).resolves.toBeDefined();
      await expect(nodeFs.stat(backupOf(1))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await removeFixture(fixture);
    }
  });

  /**
   * **The rollback path, which the first version of the prune did not cover at all** — and
   * it is the larger half, because it is the flow the product itself recommends: `review`'s
   * conflict message says to resolve it with `repair` first, and `doctor` and `init` both
   * print `repair --rollback <id>`. So a user removing a pasted secret could be told to
   * roll back, retry, be told the secret was removed, and still have a raw copy on disk.
   *
   * `rolled_back` is as terminal as `finalized`: nothing can resume it, transition out of
   * it, or read the payload again.
   */
  it('removes the backup payloads when a transaction rolls back', async () => {
    const fixture = await createFixture('backup-pruned-on-rollback');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const backupPath = join(
      fixture.backupsDir,
      'transactions',
      fixture.transactionId,
      '0.bin',
    );

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'applied');
      const executor = createExecutor(fixture, { afterPhase });
      await expect(executor.execute(replacePlan(targetPath))).rejects.toThrow();
      /** The payload is what the rollback restores from, so it must be there first. */
      await expect(nodeFs.stat(backupPath)).resolves.toBeDefined();

      const rolled = await createExecutor(fixture).rollback(fixture.transactionId);

      expect(rolled.phase).toBe('rolled_back');
      await expect(nodeFs.stat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' });
      /** Restored first, pruned after: the user's original bytes are back. */
      expect(await nodeFs.readFile(targetPath, 'utf8')).toBe(ORIGINAL_FIXTURE_LABEL);
    } finally {
      await removeFixture(fixture);
    }
  });

  /**
   * **The boundary: while a rollback is still possible, the payload must survive.**
   * Pruning one phase earlier would destroy the only copy of the user's file at exactly
   * the moment the product might need to restore it.
   */
  it('keeps the backup while the transaction can still roll back', async () => {
    const fixture = await createFixture('backup-kept-before-finalize');
    const targetPath = join(fixture.workspaceDir, 'config.bin');
    const backupPath = join(
      fixture.backupsDir,
      'transactions',
      fixture.transactionId,
      '0.bin',
    );

    try {
      await installOriginal(targetPath);
      const afterPhase = interruptAfter(fixture, 'applied');
      await expect(
        createExecutor(fixture, { afterPhase }).execute(replacePlan(targetPath)),
      ).rejects.toThrow();

      await expect(nodeFs.stat(backupPath)).resolves.toBeDefined();
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
