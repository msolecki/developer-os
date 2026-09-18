/**
 * Spec 1 §2.3 as amended 2026-09-17 (A1, A12): the global mutation lock at
 * exact `state/.lifecycle.lock` is an owner-only zero-byte regular file opened
 * without following links, is never unlinked, and is created only by Spec 2's
 * fresh `init` — so every acquirer here opens an existing path without
 * `O_CREAT`, and an absent path on a V2 home refuses. §6 step 2 bounds
 * uninstall's lease drain by one absolute ten-minute deadline.
 */
import { EXIT_CODES } from "../result.js";
import type { CanonicalAbsolutePathV1 } from "../update/paths.js";
import type { UInt64DecimalV1 } from "../update/scalars.js";

export interface HeldLifecycleStableLockV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
  release(): Promise<void>;
}

/** §2.3: an interactive command that finds the lock busy refuses through the recovery-required class. */
export class LifecycleLockBusyError extends Error {
  readonly code = EXIT_CODES.recoveryRequired;
  readonly reason = "lifecycle_lock_busy" as const;
  readonly path: string;

  constructor(path: string) {
    super("lifecycle lock is held by another holder");
    this.name = "LifecycleLockBusyError";
    this.path = path;
  }
}

/** A12: on a V2 home an absent lock path refuses; no acquirer may create it. */
export class LifecycleLockMissingError extends Error {
  readonly code = EXIT_CODES.recoveryRequired;
  readonly reason = "lifecycle_lock_missing" as const;
  readonly path: string;

  constructor(path: string) {
    super("lifecycle lock path is absent");
    this.name = "LifecycleLockMissingError";
    this.path = path;
  }
}

/** §2.3: anything but an owner-only zero-byte single-link regular file, or an identity that moved, refuses. */
export class LifecycleLockShapeError extends Error {
  readonly code = EXIT_CODES.securityRefusal;
  readonly reason = "lifecycle_lock_shape" as const;
  readonly path: string;

  constructor(path: string) {
    super("lifecycle lock path is not the exact stable lock file");
    this.name = "LifecycleLockShapeError";
    this.path = path;
  }
}

/**
 * An indeterminate acquisition — the lock helper was killed or exited for an
 * unexplained reason — leaves the hold state unknown, which is §2.3's
 * recovery-required case and not a security verdict: a caller branching on 5
 * versus 6 (§5.4's scheduled-runner silent exit, `doctor`'s provenance
 * classification) must be able to retry or recover a transient kill.
 */
export class LifecycleLockUnavailableError extends Error {
  readonly code = EXIT_CODES.recoveryRequired;
  readonly reason = "lifecycle_lock_unavailable" as const;
  readonly path: string;

  constructor(path: string) {
    super("lifecycle lock acquisition did not complete");
    this.name = "LifecycleLockUnavailableError";
    this.path = path;
  }
}

export interface LifecycleLockDeadlineV1 {
  readonly nowMs: () => number;
  readonly sleepMs: (milliseconds: number) => Promise<void>;
  readonly deadlineMs: number;
}

/** §6 step 2's one absolute ten-minute drain deadline. */
export const LIFECYCLE_LEASE_DRAIN_MS = 600_000;

export const LIFECYCLE_LOCK_RETRY_MS = 250;

export interface LifecycleStableLockProviderV1 {
  /** Non-blocking. Never creates the path, its parent, or changes a mode. */
  acquireExisting(path: CanonicalAbsolutePathV1): Promise<HeldLifecycleStableLockV1>;
  /**
   * Acquires every path in the given order, retrying busy ones until the
   * absolute deadline; on timeout releases all it holds and throws
   * `LifecycleLockBusyError`.
   */
  acquireExistingWithin(
    paths: readonly CanonicalAbsolutePathV1[],
    deadline: LifecycleLockDeadlineV1,
  ): Promise<readonly HeldLifecycleStableLockV1[]>;
}
