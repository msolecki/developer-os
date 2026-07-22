# Developer OS Kernel Transaction Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Foundation Task 5 with recoverable file transactions whose complete `execute`, `resume`, and `rollback` operations are mutually exclusive through a kernel-managed macOS BSD lock.

**Architecture:** `@developer-os/core` owns a mandatory, platform-neutral `TransactionLockProvider` port and holds one provider handle around the complete transaction operation, reusing it only for same-store/same-transaction reentrancy. A minimal `@developer-os/platform-macos` package opens a stable owner-only file descriptor and invokes absolute `/usr/bin/lockf` in immediate descriptor mode; the parent Node process retains the descriptor and therefore the lock after the helper exits. The existing uncommitted journal, staging, backup, validation, apply, verification, resume, and rollback implementation remains in core, while its lease, heartbeat, stale reclamation, quarantine, and lock-file deletion code is removed.

**Tech Stack:** Node.js 24.16.0, pnpm 11.3.0 workspaces, TypeScript 5.9 strict mode, Vitest 4.1.8, macOS `/usr/bin/lockf`, and Node `fs/promises` plus `child_process.spawn`; no new third-party dependency.

## Global Constraints

- Execute only on the existing `feat/foundation` branch; do not create or discard another worktree because Task 5 already has uncommitted transaction files in this checkout.
- Preserve the current uncommitted transaction journal, durability, backup, staging, validation, apply, verification, recovery, and rollback work unless this plan explicitly changes it.
- `packages/core` must not import `packages/platform-macos`, `node:child_process`, inspect PIDs, calculate expiry, reclaim pathnames, or contain macOS conditionals.
- `TransactionStoreDependencies.lockProvider` and `TransactionExecutorDependencies.lockProvider` are mandatory and the executor passes the same instance to its store.
- Lock acquisition happens before the first journal read, target guard, staged write, backup, apply, rollback, journal transition, or phase hook.
- Reentrancy is allowed only when the existing async context has the same `TransactionStore` object and transaction ID; separate store instances always call the provider.
- Core converts acquisition failure, an invalid provider handle, and release failure without an earlier error to `TransactionStateError` with constant recovery code 6.
- A release failure never replaces an earlier transaction error.
- The macOS provider uses absolute `/usr/bin/lockf`, `shell: false`, timeout `0`, silent descriptor mode, and fixed child FD 3; `EX_TEMPFAIL` is exit 75.
- The lock parent is a non-symlink directory owned by the current UID with mode `0700`; the stable lock path is a non-symlink regular file owned by the current UID with mode `0600`.
- The provider opens with `O_RDWR | O_CREAT | O_NOFOLLOW`, then requires matching `lstat`/`fstat` device and inode before invoking `lockf`.
- Provider code never unlinks the stable lock file during acquisition, release,
  recovery, or ordinary cleanup. Tests assert the path still exists after
  release, then may remove their isolated temporary root during fixture teardown.
- Error objects exposed by the macOS provider contain constant messages and no lock path, stdout, stderr, PID, or child diagnostic.
- Deliberate same-UID replacement of an already validated lock file or ancestor after acquisition is outside the version 1 threat model; final-component symlinks and inode substitution during acquisition fail closed.
- `/usr/bin/lockf` capability integration with OS/architecture/executable discovery remains in Foundation Task 7; this addendum tests that the required executable exists on the supported macOS host.
- Do not run `npm install`; update the workspace-only lockfile with `pnpm install --lockfile-only --offline --ignore-scripts`.
- Never use `git add .`, `git add -A`, recursive staging, or wildcard staging.
- Before the Task 5 commit run the focused suites, `npm run lint && npm test`, `pnpm build`, a frozen offline install check, `git diff --check`, and a redacted `gitleaks` directory scan.
- A fresh agent that received only the reviewer handoff must review the exact working-tree diff and return `VERDICT: APPROVED` with no P0/P1 findings before commit.

## Starting state and file map

The design is committed at `985a40e`. The transaction implementation is intentionally uncommitted: `packages/core/src/index.ts` is modified and `packages/core/src/transactions/` is untracked. Preserve those files while replacing their uncommitted lease protocol.

| Path | Responsibility | Action |
|---|---|---|
| `packages/core/src/transactions/types.ts` | Transaction data types, filesystem port, and platform-neutral lock port | Remove lease types; add mandatory provider/handle contracts |
| `packages/core/src/transactions/store.ts` | Journal validation/persistence and transaction lock lifetime | Delete lease implementation; acquire/release injected handle through async context |
| `packages/core/src/transactions/executor.ts` | Complete execute/resume/rollback orchestration | Pass the executor's provider to its store |
| `packages/core/src/transactions/transactions.test.ts` | Core transaction and deterministic exclusion contract | Remove stale-file tests; inject deterministic provider; add phase/order/error tests |
| `packages/core/src/transactions/index.ts` | Transaction public exports | Export provider/handle; remove lease exports |
| `packages/core/src/index.ts` | Core package public exports | Export provider/handle; remove lease exports |
| `packages/platform-macos/src/transaction-lock.ts` | Safe stable-file acquisition, `lockf` subprocess protocol, and one-shot release | Create |
| `packages/platform-macos/src/transaction-lock.test.ts` | Real-kernel and adversarial file tests | Create |
| `packages/platform-macos/src/index.ts` | Minimal package public surface | Create |
| `packages/platform-macos/package.json` | Workspace package metadata | Create with core-only workspace dependency |
| `packages/platform-macos/tsconfig.json` | Strict build and core project reference | Create |
| `packages/platform-macos/vitest.config.ts` | Test project and core source alias | Create |
| `pnpm-lock.yaml` | Reproducible workspace importer graph | Add platform-macos importer offline |
| `tsconfig.json` | Root project references | Add platform-macos after core |
| `vitest.config.ts` | Root test projects | Add platform-macos suite |
| `docs/superpowers/plans/2026-07-21-developer-os-foundation.md` | Canonical Foundation status | Reference this active Task 5 addendum |

---

### Task 1: Replace the core lease with a mandatory lock-provider port

**Complexity:** L

**Files:**
- Modify: `packages/core/src/transactions/types.ts`
- Modify: `packages/core/src/transactions/store.ts`
- Modify: `packages/core/src/transactions/executor.ts`
- Modify: `packages/core/src/transactions/transactions.test.ts`
- Modify: `packages/core/src/transactions/index.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: an injected `TransactionLockProvider` instance and the existing transaction filesystem/guard/clock/ID dependencies.
- Produces: `TransactionLockHandle`, `TransactionLockProvider`, and a `TransactionStore` that holds exactly one handle across each complete outer transaction operation.

- [ ] **Step 1: Write the deterministic provider and make every core fixture inject it**

  **What:** Replace the lease policy fixtures with a deterministic provider that exposes acquisition, held-state, and release evidence without using time, PIDs, files, or timers.

  **Where:** At the top of `packages/core/src/transactions/transactions.test.ts`, in `Fixture`, `ExecutorOverrides`, `createFixture`, `createExecutor`, and every direct `new TransactionStore(...)` construction.

  **How:** Import `TransactionFileSystem`, `TransactionLockHandle`, and
  `TransactionLockProvider`; remove `LockLifecycleEvent`,
  `TestTransactionLockPolicy`, `createLeaseAwareStore`,
  `installCanonicalLock`, `lockPolicy`, `expiredOwner`, and the complete
  `describe('transaction lock crash recovery', ...)` block. Add this fake:

  ```typescript
  interface DeterministicLockOptions {
    readonly acquireFailure?: unknown;
    readonly releaseFailure?: unknown;
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
      this.acquisitions.push(path);
      let releaseCalled = false;

      return {
        release: async (): Promise<void> => {
          if (releaseCalled) {
            throw new Error('synthetic duplicate release');
          }
          releaseCalled = true;
          this.releaseAttempts.push(path);
          if (this.options.releaseFailure !== undefined) {
            throw this.options.releaseFailure;
          }
          this.heldPaths.delete(path);
          this.releases.push(path);
        },
      };
    }
  }
  ```

  Extend `Fixture` and `ExecutorOverrides`:

  ```typescript
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
  ```

  Return `lockProvider: new DeterministicTransactionLockProvider()` from `createFixture`, and replace `createExecutor` with:

  ```typescript
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
  ```

  Every direct store construction receives `lockProvider: fixture.lockProvider`. Do not create an implicit or no-op production default.

  **Test:** Type-checking must fail until the production dependency types and constructors require and forward `lockProvider`.

- [ ] **Step 2: Add red tests for lock scope, ordering, reentrancy, contention, and failure mapping**

  **What:** Pin the exact core contract before deleting the lease implementation.

  **Where:** Add `describe('transaction lock provider contract', ...)` immediately before `describe('transaction persistence', ...)` in `packages/core/src/transactions/transactions.test.ts`.

  **How:** Add complete tests with the following assertions:

  ```typescript
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
            if (phase === 'applied' || phase === 'verified' || phase === 'finalized') {
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
        if (String(args[0]).endsWith(`${fixture.transactionId}.json`)) {
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
  ```

  Retain the existing `locks a transaction across resume so concurrent rollback cannot reach targets` test, but make both executors share `fixture.lockProvider` through `createExecutor`. In each restartable phase test, add this assertion after the interrupted operation and before constructing the restarted executor:

  ```typescript
  expect(fixture.lockProvider.releaseAttempts).toStrictEqual([
    canonicalLockPath(fixture),
  ]);
  ```

  **Test:** Run `pnpm vitest run packages/core/src/transactions/transactions.test.ts`; expected result is FAIL because the lease-based store does not accept or honor the provider contract.

- [ ] **Step 3: Define the provider port and require it in both dependency contracts**

  **What:** Remove every lease-specific public type and replace it with the approved two-method port.

  **Where:** `packages/core/src/transactions/types.ts`.

  **How:** Delete `TransactionLockLifecycleEvent` and `TransactionLockPolicy`. Add the approved interfaces after `TransactionGuards`, then add `lockProvider` to both dependency objects:

  ```typescript
  export interface TransactionLockHandle {
    release(): Promise<void>;
  }

  export interface TransactionLockProvider {
    acquire(path: string): Promise<TransactionLockHandle>;
  }

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
  ```

  **Test:** `pnpm exec tsc -b packages/core --pretty false` must fail only at production/test call sites that have not yet forwarded the mandatory provider; no lease type may remain exported.

- [ ] **Step 4: Replace the store's lease machinery with provider-bound async context**

  **What:** Make `withTransactionLock` the only acquisition/release boundary and preserve the current outer transaction error when release also fails.

  **Where:** `packages/core/src/transactions/store.ts`.

  **How:** Keep `AsyncLocalStorage`, `randomUUID`, journal validation, `syncDirectory`, journal persistence, and `lockPathFor`. Remove the `node:fs` constants import, `FileHandle` import, lock owner/snapshot/held interfaces, default lock policy, UUID pattern, owner serialization/parsing, stale classification/reclamation, candidate publication, heartbeat, renewal, lock-file unlink, and every lock-policy constructor check. Define context and handle validation as:

  ```typescript
  interface TransactionLockContext {
    readonly store: TransactionStore;
    readonly id: string;
    readonly token: string;
  }

  function isTransactionLockHandle(
    value: unknown,
  ): value is TransactionLockHandle {
    return (
      typeof value === 'object' &&
      value !== null &&
      'release' in value &&
      typeof value.release === 'function'
    );
  }
  ```

  Replace the store fields, constructor, and `withTransactionLock` inside the
  existing class with:

  ```typescript
  private readonly journalDir: string;
  private readonly fs: TransactionStoreDependencies['fs'];
  private readonly lockProvider: TransactionLockProvider;

  constructor(dependencies: TransactionStoreDependencies) {
    this.journalDir = join(dependencies.stateDir, 'transactions');
    this.fs = dependencies.fs;
    this.lockProvider = dependencies.lockProvider;
  }

  async withTransactionLock<T>(
    id: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new TransactionStateError();
    const existing = LOCK_CONTEXT.getStore();
    if (existing?.store === this && existing.id === id) {
      return operation();
    }

    let handle: TransactionLockHandle;
    try {
      const acquired = await this.lockProvider.acquire(this.lockPathFor(id));
      if (!isTransactionLockHandle(acquired)) {
        throw new TransactionStateError('transaction lock handle is invalid');
      }
      handle = acquired;
    } catch {
      throw new TransactionStateError('transaction lock is unavailable');
    }

    let operationFailed = false;
    try {
      return await LOCK_CONTEXT.run(
        { store: this, id, token: randomUUID() },
        operation,
      );
    } catch (error) {
      operationFailed = true;
      throw error;
    } finally {
      try {
        await handle.release();
      } catch {
        if (!operationFailed) {
          throw new TransactionStateError('transaction lock release failed');
        }
      }
    }
  }
  ```

  Keep the existing `create`, `read`, `transition`, `pathFor`, `lockPathFor`,
  `ensureJournalDirectory`, `write`, and journal-helper method bodies byte-for-byte.
  `withTransactionLock` must not call `ensureJournalDirectory`; the platform
  provider owns lock-parent creation, and contention must happen before any core
  journal access.

  **Test:** `rg -n -i 'lease|heartbeat|stale|quarant|processGeneration|leaseExpires|setInterval|unlink\(lockPath' packages/core/src/transactions` must return no production-code matches.

- [ ] **Step 5: Forward the same provider through the executor and public exports**

  **What:** Guarantee that executor reentrant store calls reuse the provider handle and expose the platform-neutral port to adapters.

  **Where:** `packages/core/src/transactions/executor.ts`, `packages/core/src/transactions/index.ts`, and `packages/core/src/index.ts`.

  **How:** Change the executor constructor to:

  ```typescript
  constructor(dependencies: TransactionExecutorDependencies) {
    this.dependencies = dependencies;
    this.store = new TransactionStore({
      stateDir: dependencies.stateDir,
      fs: dependencies.fs,
      lockProvider: dependencies.lockProvider,
    });
  }
  ```

  Export these types from both transaction and package indexes:

  ```typescript
  TransactionLockHandle,
  TransactionLockProvider,
  ```

  Remove these exports from both indexes:

  ```typescript
  TransactionLockLifecycleEvent,
  TransactionLockPolicy,
  ```

  **Test:** `pnpm exec tsc -b packages/core --pretty false` exits 0, and `rg -n '@developer-os/platform-macos|node:child_process|process\.pid|lease|heartbeat|quarant' packages/core/src` returns no lock-implementation match.

- [ ] **Step 6: Run the complete core transaction suite**

  **What:** Prove the provider refactor did not weaken journal durability or recovery behavior.

  **Where:** Core transaction tests only.

  **How:** Run:

  ```bash
  pnpm vitest run packages/core/src/transactions/transactions.test.ts
  pnpm exec tsc -b packages/core --pretty false
  git diff --check -- packages/core/src/index.ts packages/core/src/transactions
  ```

  **Test:** All three commands exit 0. The transaction suite proves phase-by-phase resume/rollback, concurrent edit refusal, symlink refusal, provider exclusion, reentrancy, constant code 6, and release behavior.

---

### Task 2: Add the minimal macOS `lockf` provider

**Complexity:** L

**Files:**
- Create: `packages/platform-macos/package.json`
- Create: `packages/platform-macos/tsconfig.json`
- Create: `packages/platform-macos/vitest.config.ts`
- Create: `packages/platform-macos/src/transaction-lock.ts`
- Create: `packages/platform-macos/src/transaction-lock.test.ts`
- Create: `packages/platform-macos/src/index.ts`
- Modify: `pnpm-lock.yaml`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `TransactionLockProvider` and `TransactionLockHandle` as type-only imports from `@developer-os/core`.
- Produces: `MacOsTransactionLockProvider`, `MacOsTransactionLockUnavailableError`, and `MacOsTransactionLockOperationalError`.

- [ ] **Step 1: Create the minimal workspace package and root references**

  **What:** Add only the package shell needed for the transaction primitive; Foundation Task 7 will extend it with platform facts and executable discovery.

  **Where:** `packages/platform-macos/`, `tsconfig.json`, and `vitest.config.ts`.

  **How:** Create `packages/platform-macos/package.json`:

  ```json
  {
    "name": "@developer-os/platform-macos",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "exports": {
      ".": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      }
    },
    "scripts": {
      "build": "tsc -b",
      "test": "vitest run"
    },
    "dependencies": {
      "@developer-os/core": "workspace:*"
    }
  }
  ```

  Create `packages/platform-macos/tsconfig.json`:

  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "rootDir": "src",
      "outDir": "dist"
    },
    "include": ["src/**/*.ts"],
    "references": [{ "path": "../../packages/core" }]
  }
  ```

  Create `packages/platform-macos/vitest.config.ts`:

  ```typescript
  import { fileURLToPath } from 'node:url';
  import { defineProject } from 'vitest/config';

  export default defineProject({
    resolve: {
      alias: {
        '@developer-os/core': fileURLToPath(
          new URL('../core/src/index.ts', import.meta.url),
        ),
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  });
  ```

  Add `{ "path": "./packages/platform-macos" }` after core in root `tsconfig.json`, and add `"packages/platform-macos/vitest.config.ts"` after the core project in root `vitest.config.ts`.

  **Test:** `pnpm exec tsc -b packages/platform-macos --pretty false` fails because the source index does not exist yet, while existing core/security/CLI project resolution remains unchanged.

- [ ] **Step 2: Write real-kernel and adversarial tests first**

  **What:** Pin descriptor retention, contention, crash recovery, event-loop independence, symlink/inode rejection, permissions, stable-file persistence, and constant diagnostics.

  **Where:** `packages/platform-macos/src/transaction-lock.test.ts`.

  **How:** Use `mkdtemp` under `tmpdir`, never a real product path. Run the real provider tests only on Darwin, but keep a non-skipped capability test that expects `/usr/bin/lockf` to be executable whenever `process.platform === 'darwin'`. Define fixture cleanup that releases any acquired handle before removing the temporary root. The real-kernel tests must contain these exact behaviors:

  ```typescript
  describe.runIf(process.platform === 'darwin')(
    'MacOsTransactionLockProvider real kernel contract',
    () => {
      it('retains contention after lockf exits and reacquires after release', async () => {
        const fixture = await createLockFixture('retained');
        const firstProvider = new MacOsTransactionLockProvider();
        const secondProvider = new MacOsTransactionLockProvider();

        try {
          const first = await firstProvider.acquire(fixture.lockPath);
          await expect(
            secondProvider.acquire(fixture.lockPath),
          ).rejects.toBeInstanceOf(MacOsTransactionLockUnavailableError);

          await first.release();
          const second = await secondProvider.acquire(fixture.lockPath);
          await second.release();

          const stats = await nodeFs.lstat(fixture.lockPath);
          expect(stats.isFile()).toBe(true);
          expect(stats.mode & 0o777).toBe(0o600);
        } finally {
          await removeLockFixture(fixture);
        }
      });

      it('releases automatically when a separate owner process exits', async () => {
        const fixture = await createLockFixture('process-exit');

        try {
          const child = spawnCrashOwner(fixture.lockPath);
          await waitForLine(child.stdout, 'locked');
          await expect(
            new MacOsTransactionLockProvider().acquire(fixture.lockPath),
          ).rejects.toBeInstanceOf(MacOsTransactionLockUnavailableError);
          expect(await waitForExit(child)).toStrictEqual({ code: 0, signal: null });

          const recovered = await new MacOsTransactionLockProvider().acquire(
            fixture.lockPath,
          );
          await recovered.release();
        } finally {
          await removeLockFixture(fixture);
        }
      });

      it('keeps the lock while the owning event loop is synchronously paused', async () => {
        const fixture = await createLockFixture('paused-loop');
        const owner = await new MacOsTransactionLockProvider().acquire(
          fixture.lockPath,
        );

        try {
          const contender = spawn(
            '/usr/bin/lockf',
            ['-s', '-t', '0', '-k', fixture.lockPath, '/usr/bin/true'],
            { shell: false, stdio: 'ignore' },
          );
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
          expect(await waitForExit(contender)).toStrictEqual({
            code: 75,
            signal: null,
          });
        } finally {
          await owner.release();
          await removeLockFixture(fixture);
        }
      });
    },
  );
  ```

  Use these fixture/process helpers so the child owns a genuinely separate open
  file description and exits without calling `close`:

  ```typescript
  import { type ChildProcess, spawn } from 'node:child_process';
  import { constants } from 'node:fs';
  import * as nodeFs from 'node:fs/promises';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';

  import { describe, expect, it } from 'vitest';

  import {
    type LockfResult,
    type LockfRunner,
    type MacOsTransactionLockFileSystem,
    MacOsTransactionLockOperationalError,
    MacOsTransactionLockProvider,
    MacOsTransactionLockUnavailableError,
  } from './transaction-lock.js';

  interface LockFixture {
    readonly root: string;
    readonly parentPath: string;
    readonly lockPath: string;
  }

  async function createLockFixture(label: string): Promise<LockFixture> {
    const root = await nodeFs.mkdtemp(
      join(tmpdir(), `developer-os-lock-${label}-`),
    );
    const parentPath = join(root, 'transactions');
    return {
      root,
      parentPath,
      lockPath: join(parentPath, '.tx-0001.lock'),
    };
  }

  async function removeLockFixture(fixture: LockFixture): Promise<void> {
    await nodeFs.rm(fixture.root, { recursive: true, force: true });
  }

  function currentUid(): number {
    if (process.getuid === undefined) {
      throw new Error('UID inspection is unavailable');
    }
    return process.getuid();
  }

  function waitForExit(child: ChildProcess): Promise<LockfResult> {
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve({
        exitCode: child.exitCode,
        signal: child.signalCode,
      });
    }
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
    });
  }

  function waitForLine(
    stream: NodeJS.ReadableStream | null,
    expected: string,
  ): Promise<void> {
    if (stream === null) throw new Error('child stdout is unavailable');
    return new Promise((resolve, reject) => {
      let output = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        output += chunk;
        if (output.split('\n').includes(expected)) resolve();
      });
      stream.once('error', reject);
      stream.once('end', () => {
        if (!output.split('\n').includes(expected)) {
          reject(new Error('child exited before lock acquisition'));
        }
      });
    });
  }

  function spawnCrashOwner(lockPath: string): ChildProcess {
    const script = String.raw`
      import { spawn } from 'node:child_process';
      import { constants } from 'node:fs';
      import { open } from 'node:fs/promises';
      import { setTimeout as delay } from 'node:timers/promises';

      const handle = await open(
        process.argv[1],
        constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
        0o600,
      );
      const child = spawn(
        '/usr/bin/lockf',
        ['-s', '-t', '0', '3'],
        {
          shell: false,
          stdio: ['ignore', 'ignore', 'ignore', handle.fd],
        },
      );
      const result = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
      });
      if (result.exitCode !== 0 || result.signal !== null) process.exit(2);
      process.stdout.write('locked\n');
      await delay(500);
      process.exit(0);
    `;
    return spawn(
      process.execPath,
      ['--input-type=module', '-e', script, lockPath],
      { shell: false, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  }
  ```

  Add the adversarial tests in the same file:

  ```typescript
  it('requires the lockf capability on a supported macOS host', async () => {
    if (process.platform !== 'darwin') return;
    await expect(
      nodeFs.access('/usr/bin/lockf', constants.X_OK),
    ).resolves.toBeUndefined();
  });

  describe.runIf(process.platform === 'darwin')(
    'MacOsTransactionLockProvider file safety',
    () => {
      it('rejects a final-component symlink without touching its target', async () => {
        const fixture = await createLockFixture('symlink');
        const substitutePath = join(fixture.root, 'substitute');
        const substituteBytes = new TextEncoder().encode('synthetic-substitute');

        try {
          await nodeFs.mkdir(fixture.parentPath, { recursive: true, mode: 0o700 });
          await nodeFs.writeFile(substitutePath, substituteBytes);
          await nodeFs.symlink(substitutePath, fixture.lockPath);

          await expect(
            new MacOsTransactionLockProvider().acquire(fixture.lockPath),
          ).rejects.toBeInstanceOf(MacOsTransactionLockOperationalError);
          expect(await nodeFs.readFile(substitutePath)).toStrictEqual(
            Buffer.from(substituteBytes),
          );
          expect((await nodeFs.lstat(fixture.lockPath)).isSymbolicLink()).toBe(
            true,
          );
        } finally {
          await removeLockFixture(fixture);
        }
      });

      it('rejects inode substitution before invoking lockf', async () => {
        const fixture = await createLockFixture('inode-substitution');
        const openedPath = join(fixture.root, 'opened-original');
        const substituteBytes = new TextEncoder().encode('replacement-inode');
        let runnerCalls = 0;

        try {
          await nodeFs.mkdir(fixture.parentPath, { recursive: true, mode: 0o700 });
          await nodeFs.writeFile(fixture.lockPath, 'original-inode', {
            mode: 0o600,
          });
          const injectedFs: MacOsTransactionLockFileSystem = {
            mkdir: nodeFs.mkdir,
            chmod: nodeFs.chmod,
            lstat: nodeFs.lstat,
            open: async (path, flags, mode) => {
              const handle = await nodeFs.open(path, flags, mode);
              await nodeFs.rename(path, openedPath);
              await nodeFs.writeFile(path, substituteBytes, { mode: 0o600 });
              return handle;
            },
          };
          const runner: LockfRunner = {
            acquire: () => {
              runnerCalls += 1;
              return Promise.resolve({ exitCode: 0, signal: null });
            },
          };
          const provider = new MacOsTransactionLockProvider({
            fs: injectedFs,
            runner,
            getUid: currentUid,
          });

          await expect(provider.acquire(fixture.lockPath)).rejects.toBeInstanceOf(
            MacOsTransactionLockOperationalError,
          );
          expect(runnerCalls).toBe(0);
          expect(await nodeFs.readFile(fixture.lockPath)).toStrictEqual(
            Buffer.from(substituteBytes),
          );
        } finally {
          await removeLockFixture(fixture);
        }
      });

      it('normalizes parent and stable-file permissions without deleting the file', async () => {
        const fixture = await createLockFixture('permissions');

        try {
          await nodeFs.mkdir(fixture.parentPath, { recursive: true, mode: 0o777 });
          await nodeFs.chmod(fixture.parentPath, 0o777);
          await nodeFs.writeFile(fixture.lockPath, '', { mode: 0o666 });
          await nodeFs.chmod(fixture.lockPath, 0o666);

          const handle = await new MacOsTransactionLockProvider().acquire(
            fixture.lockPath,
          );
          await handle.release();

          const [parentStats, fileStats] = await Promise.all([
            nodeFs.lstat(fixture.parentPath),
            nodeFs.lstat(fixture.lockPath),
          ]);
          expect(parentStats.mode & 0o777).toBe(0o700);
          expect(fileStats.mode & 0o777).toBe(0o600);
          expect(parentStats.uid).toBe(currentUid());
          expect(fileStats.uid).toBe(currentUid());
          expect(fileStats.isFile()).toBe(true);
        } finally {
          await removeLockFixture(fixture);
        }
      });

      it.each([
        {
          result: { exitCode: 75, signal: null },
          errorType: MacOsTransactionLockUnavailableError,
          message: 'transaction lock is unavailable',
        },
        {
          result: { exitCode: 70, signal: null },
          errorType: MacOsTransactionLockOperationalError,
          message: 'transaction lock operation failed',
        },
        {
          result: { exitCode: null, signal: 'SIGTERM' as const },
          errorType: MacOsTransactionLockOperationalError,
          message: 'transaction lock operation failed',
        },
      ])('maps lockf result $result without diagnostics', async ({
        result,
        errorType,
        message,
      }) => {
        const fixture = await createLockFixture('result-map');
        const runner: LockfRunner = {
          acquire: () => Promise.resolve(result),
        };

        try {
          const error = await new MacOsTransactionLockProvider({ runner })
            .acquire(fixture.lockPath)
            .then(
              () => undefined,
              (caught: unknown) => caught,
            );
          expect(error).toBeInstanceOf(errorType);
          expect(error).toMatchObject({ message });
          expect(String(error)).not.toContain(fixture.root);
        } finally {
          await removeLockFixture(fixture);
        }
      });

      it('closes a handle exactly once and keeps the stable pathname', async () => {
        const fixture = await createLockFixture('one-shot-release');

        try {
          const handle = await new MacOsTransactionLockProvider().acquire(
            fixture.lockPath,
          );
          await handle.release();
          await expect(handle.release()).rejects.toBeInstanceOf(
            MacOsTransactionLockOperationalError,
          );
          expect((await nodeFs.lstat(fixture.lockPath)).isFile()).toBe(true);
        } finally {
          await removeLockFixture(fixture);
        }
      });
    },
  );
  ```

  **Test:** Run `pnpm vitest run packages/platform-macos/src/transaction-lock.test.ts`; expected result is FAIL because the provider module does not exist.

- [ ] **Step 3: Implement the safe descriptor and `lockf` protocol**

  **What:** Acquire a BSD lock on a stable file description without retaining a helper process or deleting the lock pathname.

  **Where:** `packages/platform-macos/src/transaction-lock.ts`.

  **How:** Define focused injectable boundaries for deterministic protocol/race tests while keeping production defaults fixed:

  ```typescript
  import { type ChildProcess, spawn } from 'node:child_process';
  import { constants } from 'node:fs';
  import {
    chmod,
    lstat,
    mkdir,
    open,
    type FileHandle,
  } from 'node:fs/promises';
  import { dirname, isAbsolute } from 'node:path';

  import type {
    TransactionLockHandle,
    TransactionLockProvider,
  } from '@developer-os/core';

  const LOCKF_PATH = '/usr/bin/lockf';
  const CHILD_LOCK_FD = 3;
  const EX_TEMPFAIL = 75;

  export interface MacOsTransactionLockFileSystem {
    mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
    chmod(path: string, mode: number): Promise<void>;
    lstat(path: string): ReturnType<typeof lstat>;
    open(path: string, flags: number, mode: number): Promise<FileHandle>;
  }

  export interface LockfResult {
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
  }

  export interface LockfRunner {
    acquire(descriptor: number): Promise<LockfResult>;
  }

  export interface MacOsTransactionLockDependencies {
    readonly fs: MacOsTransactionLockFileSystem;
    readonly runner: LockfRunner;
    readonly getUid: () => number;
  }

  const NODE_FILE_SYSTEM: MacOsTransactionLockFileSystem = {
    mkdir,
    chmod,
    lstat,
    open,
  };

  export class MacOsTransactionLockUnavailableError extends Error {
    constructor() {
      super('transaction lock is unavailable');
      this.name = 'MacOsTransactionLockUnavailableError';
    }
  }

  export class MacOsTransactionLockOperationalError extends Error {
    constructor() {
      super('transaction lock operation failed');
      this.name = 'MacOsTransactionLockOperationalError';
    }
  }
  ```

  Implement the real runner with no captured output and no shell:

  ```typescript
  function waitForLockf(child: ChildProcess): Promise<LockfResult> {
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
    });
  }

  export class SpawnLockfRunner implements LockfRunner {
    async acquire(descriptor: number): Promise<LockfResult> {
      const child = spawn(
        LOCKF_PATH,
        ['-s', '-t', '0', String(CHILD_LOCK_FD)],
        {
          shell: false,
          stdio: ['ignore', 'ignore', 'ignore', descriptor],
        },
      );
      return waitForLockf(child);
    }
  }
  ```

  Implement the provider with these exact invariants:

  ```typescript
  export class MacOsTransactionLockProvider
    implements TransactionLockProvider
  {
    private readonly dependencies: MacOsTransactionLockDependencies;

    constructor(
      dependencies: Partial<MacOsTransactionLockDependencies> = {},
    ) {
      this.dependencies = {
        fs: dependencies.fs ?? NODE_FILE_SYSTEM,
        runner: dependencies.runner ?? new SpawnLockfRunner(),
        getUid:
          dependencies.getUid ??
          (() => {
            if (process.getuid === undefined) {
              throw new MacOsTransactionLockOperationalError();
            }
            return process.getuid();
          }),
      };
    }

    async acquire(path: string): Promise<TransactionLockHandle> {
      if (!isAbsolute(path) || path.includes('\0')) {
        throw new MacOsTransactionLockOperationalError();
      }

      let handle: FileHandle | undefined;
      try {
        await this.ensureOwnerOnlyParent(dirname(path));
        handle = await this.dependencies.fs.open(
          path,
          constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
          0o600,
        );
        await handle.chmod(0o600);

        const [pathStats, descriptorStats] = await Promise.all([
          this.dependencies.fs.lstat(path),
          handle.stat(),
        ]);
        const uid = this.dependencies.getUid();
        if (
          pathStats.isSymbolicLink() ||
          !pathStats.isFile() ||
          !descriptorStats.isFile() ||
          pathStats.dev !== descriptorStats.dev ||
          pathStats.ino !== descriptorStats.ino ||
          descriptorStats.uid !== uid ||
          (descriptorStats.mode & 0o777) !== 0o600
        ) {
          throw new MacOsTransactionLockOperationalError();
        }

        const result = await this.dependencies.runner.acquire(handle.fd);
        if (result.exitCode === EX_TEMPFAIL && result.signal === null) {
          throw new MacOsTransactionLockUnavailableError();
        }
        if (result.exitCode !== 0 || result.signal !== null) {
          throw new MacOsTransactionLockOperationalError();
        }

        const retainedHandle = handle;
        handle = undefined;
        let released = false;
        return {
          release: async (): Promise<void> => {
            if (released) {
              throw new MacOsTransactionLockOperationalError();
            }
            released = true;
            try {
              await retainedHandle.close();
            } catch {
              throw new MacOsTransactionLockOperationalError();
            }
          },
        };
      } catch (error) {
        if (handle !== undefined) {
          try {
            await handle.close();
          } catch {
            throw new MacOsTransactionLockOperationalError();
          }
        }
        if (
          error instanceof MacOsTransactionLockUnavailableError ||
          error instanceof MacOsTransactionLockOperationalError
        ) {
          throw error;
        }
        throw new MacOsTransactionLockOperationalError();
      }
    }

    private async ensureOwnerOnlyParent(path: string): Promise<void> {
      try {
        await this.dependencies.fs.mkdir(path, {
          recursive: true,
          mode: 0o700,
        });
        const before = await this.dependencies.fs.lstat(path);
        if (
          before.isSymbolicLink() ||
          !before.isDirectory() ||
          before.uid !== this.dependencies.getUid()
        ) {
          throw new MacOsTransactionLockOperationalError();
        }
        await this.dependencies.fs.chmod(path, 0o700);
        const after = await this.dependencies.fs.lstat(path);
        if (
          after.isSymbolicLink() ||
          !after.isDirectory() ||
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          after.uid !== this.dependencies.getUid() ||
          (after.mode & 0o777) !== 0o700
        ) {
          throw new MacOsTransactionLockOperationalError();
        }
      } catch (error) {
        if (error instanceof MacOsTransactionLockOperationalError) throw error;
        throw new MacOsTransactionLockOperationalError();
      }
    }
  }
  ```

  Do not call `unlink`, `rename`, `utimes`, `setInterval`, `process.kill`, or a shell anywhere in this package.

  **Test:** The implementation must type-check without a runtime import from core beyond the erased type import, and the real runner must pass the second-provider contention test with exit 75.

- [ ] **Step 4: Export only the supported package surface and update the lockfile offline**

  **What:** Make the provider consumable by the future CLI composition root without exposing the injected test seams from the package root.

  **Where:** `packages/platform-macos/src/index.ts` and `pnpm-lock.yaml`.

  **How:** Create the index:

  ```typescript
  export {
    MacOsTransactionLockOperationalError,
    MacOsTransactionLockProvider,
    MacOsTransactionLockUnavailableError,
  } from './transaction-lock.js';
  ```

  Update the lockfile using the existing offline store:

  ```bash
  pnpm install --lockfile-only --offline --ignore-scripts
  ```

  The resulting importer must be exactly:

  ```yaml
  packages/platform-macos:
    dependencies:
      '@developer-os/core':
        specifier: workspace:*
        version: link:../core
  ```

  **Test:** `pnpm install --frozen-lockfile --offline --ignore-scripts` exits 0 without changing `pnpm-lock.yaml`.

- [ ] **Step 5: Run the macOS package and cross-package gates**

  **What:** Verify the real kernel behavior and ensure the new project reference does not break existing packages.

  **Where:** Platform package plus root build/test configuration.

  **How:** Run:

  ```bash
  test -x /usr/bin/lockf
  pnpm vitest run packages/platform-macos/src/transaction-lock.test.ts
  pnpm exec tsc -b packages/platform-macos --pretty false
  pnpm build
  git diff --check -- packages/platform-macos pnpm-lock.yaml tsconfig.json vitest.config.ts
  ```

  **Test:** Every command exits 0. The test output demonstrates exit 75 while a separately opened descriptor holds the lock and exit 0 immediately after its release.

---

### Task 3: Integrate, review, and commit Foundation Task 5

**Complexity:** M

**Files:**
- Verify: every path listed in Tasks 1 and 2
- Verify: `docs/superpowers/specs/2026-07-22-developer-os-kernel-transaction-lock-design.md`
- Modify: `docs/superpowers/plans/2026-07-21-developer-os-foundation.md` only to check off Task 5 steps after evidence exists
- Modify: `docs/superpowers/plans/2026-07-22-developer-os-kernel-transaction-lock.md` to check completed steps and record the next action

**Interfaces:**
- Consumes: reviewed core provider contract, reviewed macOS adapter, and all pre-existing Task 5 durability behavior.
- Produces: one reviewed `feat: add recoverable file transactions` commit with no lease protocol and a still-deployable Foundation branch.

- [ ] **Step 1: Audit the final diff against the approved design**

  **What:** Prove that the implementation contains the kernel protocol and no remnants of the rejected lease protocol.

  **Where:** The complete working-tree diff and untracked transaction/platform paths.

  **How:** Run:

  ```bash
  git status --short
  git diff -- packages/core/src/index.ts docs/superpowers/plans/2026-07-21-developer-os-foundation.md
  git diff --no-index /dev/null packages/core/src/transactions/types.ts
  git diff --no-index /dev/null packages/core/src/transactions/store.ts
  git diff --no-index /dev/null packages/core/src/transactions/executor.ts
  git diff --no-index /dev/null packages/core/src/transactions/recovery.ts
  git diff --no-index /dev/null packages/core/src/transactions/transactions.test.ts
  git diff --no-index /dev/null packages/core/src/transactions/index.ts
  git diff --no-index /dev/null packages/platform-macos/src/transaction-lock.ts
  git diff --no-index /dev/null packages/platform-macos/src/transaction-lock.test.ts
  rg -n -i 'lease|heartbeat|stale.owner|quarant|leaseExpires|processGeneration|process\.pid|setInterval' packages/core/src/transactions packages/platform-macos/src
  rg -n 'unlink|rename|utimes|process\.kill|shell:\s*true' packages/platform-macos/src
  ```

  The first eight diff commands are inspection commands; `git diff --no-index` returns 1 when it reports an untracked file and that exit code is expected. The first `rg` may match test names only when explicitly asserting absence; it must find no production implementation. The second `rg` must return no matches.

  **Test:** Manual comparison maps every design test bullet to a named test and confirms the stable lock file is never removed.

- [ ] **Step 2: Run all repository and security gates**

  **What:** Produce fresh evidence required before the transaction commit.

  **Where:** Repository root.

  **How:** Run in this order and report only failures:

  ```bash
  pnpm vitest run packages/core/src/transactions/transactions.test.ts
  pnpm vitest run packages/platform-macos/src/transaction-lock.test.ts
  npm run lint && npm test
  pnpm build
  pnpm install --frozen-lockfile --offline --ignore-scripts
  git diff --check
  gitleaks dir --redact --no-banner .
  ```

  **Test:** Every command exits 0, the frozen install leaves `git status --short` unchanged, and gitleaks reports zero findings without printing a suspect value.

- [ ] **Step 3: Obtain fresh-context code review**

  **What:** Have a reviewer other than the author attack the exact code and tests before commit.

  **Where:** Current `feat/foundation` working tree.

  **How:** Dispatch a fresh agent with no inherited turns and this handoff only:

  ```text
  Objective: Review the uncommitted Foundation Task 5 transaction implementation against docs/superpowers/specs/2026-07-22-developer-os-kernel-transaction-lock-design.md.

  Files: packages/core/src/index.ts; packages/core/src/transactions/**; packages/platform-macos/**; pnpm-lock.yaml; tsconfig.json; vitest.config.ts; docs/superpowers/plans/2026-07-21-developer-os-foundation.md; docs/superpowers/plans/2026-07-22-developer-os-kernel-transaction-lock.md.

  Constraints: Review only; do not edit or commit. Inspect git status and the complete tracked/untracked diff. Treat auth/security changes outside these files as unauthorized. Check that the same provider handle spans execute/resume/rollback; separate stores contend before journal/guard/target access; release errors preserve primary errors; core has no macOS or lease logic; the adapter uses O_NOFOLLOW plus lstat/fstat inode matching, owner-only permissions, absolute /usr/bin/lockf descriptor mode, no shell, constant redacted errors, and never unlinks the stable file. Verify tests pin the contract rather than current behavior. Run focused tests if useful.

  Expected output: Findings ordered P0, P1, P2 with file:line evidence, then exactly one final line: VERDICT: APPROVED or VERDICT: CHANGES_REQUIRED. Approval requires no P0/P1 finding.
  ```

  After the reviewer returns, run `git status --short` and `git diff` yourself to prove the reviewer did not modify the tree. For every accepted finding, add a regression test first, apply the smallest fix, rerun Step 2, and request another fresh verdict.

  **Test:** The final review output ends `VERDICT: APPROVED`, contains no P0/P1 finding, and reviewer/author identities are different agents.

- [ ] **Step 4: Stage exact Task 5 paths and commit**

  **What:** Commit only the reviewed transaction, minimal platform primitive, root reference, lockfile, and plan-state changes.

  **Where:** Exact paths below.

  **How:** Check off completed Task 5 and addendum steps only after their evidence exists, then run:

  ```bash
  git add packages/core/src/index.ts
  git add packages/core/src/transactions/executor.ts
  git add packages/core/src/transactions/index.ts
  git add packages/core/src/transactions/recovery.ts
  git add packages/core/src/transactions/store.ts
  git add packages/core/src/transactions/transactions.test.ts
  git add packages/core/src/transactions/types.ts
  git add packages/platform-macos/package.json
  git add packages/platform-macos/tsconfig.json
  git add packages/platform-macos/vitest.config.ts
  git add packages/platform-macos/src/index.ts
  git add packages/platform-macos/src/transaction-lock.ts
  git add packages/platform-macos/src/transaction-lock.test.ts
  git add pnpm-lock.yaml
  git add tsconfig.json
  git add vitest.config.ts
  git add docs/superpowers/plans/2026-07-21-developer-os-foundation.md
  git add docs/superpowers/plans/2026-07-22-developer-os-kernel-transaction-lock.md
  git diff --cached --check
  npm run lint && npm test
  git commit -m "feat: add recoverable file transactions"
  ```

  **Test:** The commit exits 0. `git status --short` is clean, `git show --stat --oneline HEAD` contains only the exact staged paths, and Foundation Task 6 is the next unchecked implementation task.

## Completion evidence

Record these concise results in the final handoff:

- focused core transaction suite: pass count and exit 0;
- focused macOS lock suite: pass count and exit 0;
- `npm run lint && npm test`: exit 0;
- `pnpm build`: exit 0;
- frozen offline lockfile check: exit 0 and no diff;
- `git diff --check`: exit 0;
- `gitleaks dir --redact --no-banner .`: zero findings;
- fresh review: `VERDICT: APPROVED`, no P0/P1;
- commit: exact hash and subject;
- next action: Foundation Task 6 from `docs/superpowers/plans/2026-07-21-developer-os-foundation.md`.
