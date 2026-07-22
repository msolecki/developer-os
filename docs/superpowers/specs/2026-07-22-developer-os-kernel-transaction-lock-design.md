# Developer OS Kernel Transaction Lock Design

**Date:** 2026-07-22

**Status:** Approved design; implementation pending written-spec review

**Scope:** Foundation Task 5 transaction exclusion and the minimal macOS platform primitive it requires

## Problem

Filesystem transactions must remain mutually exclusive across processes, crashes,
PID reuse, and arbitrarily long event-loop pauses. A lock implemented with PID
files, renewable leases, or stale-file reclamation cannot provide that guarantee:
an expired owner may resume before observing lease loss, and pathname cleanup has
no conditional rename or unlink primitive that can protect a replacement inode.

## Decision

Developer OS will use a kernel-managed BSD advisory lock for transaction
exclusion on macOS. `packages/core` owns only the lock-provider contract;
`packages/platform-macos` owns the `/usr/bin/lockf` implementation. Lease,
heartbeat, PID-liveness, stale-owner, quarantine, and lock-file deletion logic are
not part of the production transaction protocol.

The lock is held on a stable, owner-only file descriptor for the complete
`execute`, `resume`, or `rollback` operation. Closing that descriptor releases
the kernel lock. Process termination closes it automatically.

## Architecture

### Core port

`@developer-os/core` exposes a platform-neutral contract:

```typescript
export interface TransactionLockHandle {
  release(): Promise<void>;
}

export interface TransactionLockProvider {
  acquire(path: string): Promise<TransactionLockHandle>;
}
```

`TransactionStoreDependencies` and `TransactionExecutorDependencies` receive the
same provider instance. The store acquires the per-transaction lock before the
first journal read and retains it across target guards, backups, staging,
validation, apply, verification, rollback, journal transitions, and phase hooks.
Reentrant calls within the same store and transaction reuse the held lock through
the existing async context; separate store instances always contend through the
provider.

Core maps acquisition contention or an invalid/lost lock to constant recovery
code 6. It does not inspect PIDs, calculate expiry, reclaim pathnames, or import a
macOS package.

### macOS adapter

`@developer-os/platform-macos` implements `TransactionLockProvider` with these
steps:

1. Ensure the lock parent is owner-only.
2. Open or create a stable lock file as `0600` with `O_NOFOLLOW`; require a
   regular file and match `lstat` against `fstat` by device and inode.
3. Spawn absolute `/usr/bin/lockf` with `shell: false`, immediate timeout, and the
   already-open descriptor inherited at a fixed child FD.
4. Run `lockf` in descriptor mode. Exit 0 means the kernel attached the exclusive
   BSD lock to the shared open-file description; the short subprocess may exit
   while Node retains the descriptor and therefore the lock.
5. Map `EX_TEMPFAIL` contention to a typed unavailable result without path data or
   child diagnostics. Treat every other exit, signal, or protocol error as a
   fail-closed operational error.
6. Release exactly once by closing the retained descriptor. The stable lock file
   remains in place and is never unlinked during ordinary operation or recovery.

Version 1 is macOS-only, so `/usr/bin/lockf` availability is part of the platform
capability check. A future Linux adapter may implement the same core port with a
native `flock` primitive without changing transaction code.

## Failure semantics

- Concurrent acquire fails immediately and performs no target or journal access.
- A paused event loop still owns the kernel lock because the descriptor remains
  open.
- A normal release closes the descriptor once.
- A crash or forced process termination causes the operating system to close the
  descriptor and release the lock; the persistent lock file requires no repair.
- An absent lock file is created on first use. A symlinked, non-regular, or
  inode-inconsistent lock file fails closed before transaction work.
- A release failure cannot authorize another mutation; it surfaces as code 6
  unless an earlier transaction error is already being preserved.

Developer OS never removes the stable lock file. Deliberate same-UID removal or
replacement of that file or an ancestor while a process holds the descriptor is
outside the v1 threat model, as are the equivalent same-UID ancestor races already
documented for other filesystem paths. Final-component symlinks and inode changes
during acquisition are rejected.

## Test contract

Core tests use a deterministic injected lock provider to prove:

- one provider handle spans every transaction phase and target mutation;
- a second store cannot read a journal, call a guard, or mutate a target while
  the first handle is held;
- reentrant store calls do not deadlock or acquire twice;
- contention and provider failure are constant code 6;
- release occurs once on success and on every error path.

macOS adapter tests use synthetic temporary files and the real `/usr/bin/lockf`
to prove:

- a second provider receives contention while the first descriptor is open;
- ending the short `lockf` subprocess does not release the lock;
- closing the parent descriptor permits immediate reacquisition;
- a separate child process that exits without explicit release leaves the lock
  immediately recoverable;
- an event-loop pause does not permit a second owner;
- symlink and inode-substitution attempts fail without locking the substitute;
- the stable lock file remains `0600` and is not removed after release.

The full repository lint, test, build, frozen-lockfile, and secret-scan gates must
pass before the transaction commit. An independent reviewer must return
`VERDICT: APPROVED` with no P0/P1 findings.

## Scope and sequencing

Only the macOS advisory-lock primitive moves ahead of Foundation Task 7. The rest
of the platform package—OS discovery, architecture, executable discovery, and
later `launchd` behavior—stays in its original task. Foundation Task 7 will extend
the package rather than recreate it.

Foundation Task 5 removes the uncommitted lease implementation and its stale-file
tests, adds the core provider contract and provider-bound transaction tests, and
adds the minimal macOS package files and kernel-lock tests. No third-party native
dependency is introduced.

## Rejected alternatives

- **PID files and stale reclamation:** PID reuse and check-then-rename races make
  ownership ambiguous.
- **Renewable leases with fencing tokens:** ordinary filesystem mutations do not
  enforce a fencing token, so a paused expired owner can still write.
- **Native Node addon such as `fs-ext`:** adds native compilation and release
  complexity that `/usr/bin/lockf` avoids on the macOS-only v1 platform.
- **Long-lived helper process:** unnecessary because descriptor-mode `lockf`
  leaves the BSD lock attached to the open-file description retained by Node.
