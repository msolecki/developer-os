import type { BrainConfigV1, ChangePlanV1 } from "@developer-os/core";

import type { IndexedNote } from "../indexes/index.js";

/**
 * What a migration is allowed to see: the resolved configuration and the notes
 * discovery found, never the filesystem. A migration that could read arbitrary
 * paths could not be reviewed by reading its own code.
 */
export interface VaultSnapshot {
  readonly vaultRoot: string;
  readonly config: BrainConfigV1;
  readonly notes: readonly IndexedNote[];
}

export interface BrainMigration {
  readonly from: number;
  readonly to: number;
  readonly describe: () => string;
  /**
   * Emits a plan; it does not apply one. Execution goes through Foundation's
   * `TransactionStore`, so `packages/brain` performs no direct filesystem
   * mutation of a user's notes — Brain architecture former §9.
   */
  readonly plan: (snapshot: VaultSnapshot) => ChangePlanV1;
}

/**
 * Deliberately empty. There is no prior schema version to migrate from, and an
 * untested migration path is worse than an absent one — it is code that runs
 * exactly once, on somebody's real vault, having never run before.
 */
export const BRAIN_MIGRATIONS: readonly BrainMigration[] = Object.freeze([]);
