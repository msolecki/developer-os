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

export interface DeveloperOsConfigV1 {
  readonly schemaVersion: 1;
  readonly brainPath: string;
  readonly adapters: {
    readonly claude: boolean;
    readonly codex: boolean;
  };
  readonly git: {
    readonly enabled: boolean;
  };
  readonly automation: {
    readonly enabled: boolean;
  };
  /**
   * Optional, and `schemaVersion` deliberately stays `1`. Every configuration
   * written before this section existed must keep loading: a required section or
   * a version bump would stop an installed product on upgrade.
   */
  readonly brain?: BrainConfigV1;
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
