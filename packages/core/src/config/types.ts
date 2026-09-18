/**
 * Vault-shaped configuration, owned here rather than in `packages/brain` because
 * `DeveloperOsConfigV1` must reference it and the other direction would be an
 * import cycle. `packages/brain` owns the defaults and the resolution.
 *
 * Every path-shaped member is a single segment, never a path: they are joined
 * onto the vault root, so accepting `../` would let a configuration file walk
 * out of the vault before any guard sees the result.
 */
export interface BrainConfigV1 {
  readonly schemaVersion: 1;
  readonly contentRoot: string;
  readonly topicFolders: readonly string[];
  readonly topicAliases: Readonly<Record<string, string>>;
  readonly indexesDir: string;
  readonly retrieval: { readonly maxCandidates: number };
  readonly staleness: { readonly reviewAfterDays: number };
}

import type { AutomationConfigV1, GitSyncConfigV1 } from "./lifecycle.js";

export interface DeveloperOsConfigV1 {
  readonly schemaVersion: 1;
  readonly brainPath: string;
  readonly adapters: {
    readonly claude: boolean;
    readonly codex: boolean;
  };
  /**
   * `lifecycle` is optional and `schemaVersion` deliberately stays `1`: this is the
   * additive frozen-interface amendment Spec 1 §2.2 ratifies, so a configuration written
   * before the record existed must keep loading and serializing byte-identically.
   * `enabled: true` without the record is schema-readable but operationally incomplete —
   * it cannot trigger a Git, launchd or network effect.
   */
  readonly git: {
    readonly enabled: boolean;
    readonly lifecycle?: GitSyncConfigV1;
  };
  readonly automation: {
    readonly enabled: boolean;
    readonly lifecycle?: AutomationConfigV1;
  };
  /**
   * Optional, and `schemaVersion` deliberately stays `1`. Every configuration
   * written before this section existed must keep loading: a required section or
   * a version bump would stop an installed product on upgrade.
   */
  readonly brain?: BrainConfigV1;
  /**
   * Spec §8.2's user-extensible redaction class — the one a founder uses for a client
   * name no generic pattern catches. Literal substrings, never expressions; the loader's
   * `redactionSchema` states why, and bounds both the count and the length.
   *
   * Optional for the same reason `brain` is: the schema is `.strict()`, so a required
   * table would refuse every installation that predates it.
   */
  readonly redaction?: { readonly patterns: readonly string[] };
  readonly telemetry: false;
}

export interface RuntimePaths {
  readonly home: string;
  readonly configFile: string;
  readonly manifestFile: string;
  readonly stateDir: string;
  readonly stagingDir: string;
  readonly backupsDir: string;
  readonly logsDir: string;
  readonly brain: string;
}

export interface PathEnvironment {
  readonly HOME: string;
  readonly DEVELOPER_OS_HOME?: string;
  readonly DEVELOPER_OS_BRAIN?: string;
}
